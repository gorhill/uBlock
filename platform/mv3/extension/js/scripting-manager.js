/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2022-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/* jshint esversion:11 */

'use strict';

/******************************************************************************/

import { browser, dnr } from './ext.js';
import { fetchJSON } from './fetch.js';
import { getAllTrustedSiteDirectives } from './trusted-sites.js';

import * as ut from './utils.js';

/******************************************************************************/

let scriptingDetailsPromise;

function getScriptingDetails() {
    if ( scriptingDetailsPromise !== undefined ) {
        return scriptingDetailsPromise;
    }
    scriptingDetailsPromise = fetchJSON('/rulesets/scripting-details').then(entries => {
        const out = new Map();
        for ( const entry of entries ) {
            out.set(entry[0], new Map(entry[1]));
        }
        return out;
    });
    return scriptingDetailsPromise;
}

/******************************************************************************/

const toRegisterable = (fname, hostnames, trustedSites) => {
    const directive = {
        id: fname,
        allFrames: true,
        matchOriginAsFallback: true,
    };
    if ( hostnames ) {
        directive.matches = ut.matchesFromHostnames(hostnames);
    } else {
        directive.matches = [ '<all_urls>' ];
    }
    if (
        directive.matches.length === 1 &&
        directive.matches[0] === '<all_urls>'
    ) {
        directive.excludeMatches = ut.matchesFromHostnames(trustedSites);
    }
    directive.js = [ `/rulesets/js/${fname.slice(0,2)}/${fname.slice(2)}.js` ];
    if ( (ut.fidFromFileName(fname) & RUN_AT_END_BIT) !== 0 ) {
        directive.runAt = 'document_end';
    } else {
        directive.runAt = 'document_start';
    }
    if ( (ut.fidFromFileName(fname) & MAIN_WORLD_BIT) !== 0 ) {
        directive.world = 'MAIN';
    }
    return directive;
};

const RUN_AT_END_BIT = 0b10;
const MAIN_WORLD_BIT = 0b01;

/******************************************************************************/

// Important: We need to sort the arrays for fast comparison
const arrayEq = (a, b) => {
    if ( a === undefined ) { return b === undefined; }
    if ( b === undefined ) { return false; }
    const alen = a.length;
    if ( alen !== b.length ) { return false; }
    a.sort(); b.sort();
    for ( let i = 0; i < alen; i++ ) {
        if ( a[i] !== b[i] ) { return false; }
    }
    return true;
};

const shouldUpdate = (registered, afterHostnames, afterExcludeHostnames) => {
    if ( afterHostnames.length === 1 && afterHostnames[0] === '*' ) {
        const beforeExcludeHostnames = registered.excludeMatches &&
            ut.hostnamesFromMatches(registered.excludeMatches) ||
            [];
        if ( arrayEq(beforeExcludeHostnames, afterExcludeHostnames) === false ) { 
            return true;
        }
    }
    const beforeHostnames = registered.matches &&
        ut.hostnamesFromMatches(registered.matches) ||
        [];
    return arrayEq(beforeHostnames, afterHostnames) === false;
};

const isTrustedHostname = (trustedSites, hn) => {
    if ( trustedSites.size === 0 ) { return false; }
    while ( hn ) {
        if ( trustedSites.has(hn) ) { return true; }
        hn = ut.toBroaderHostname(hn);
    }
    return false;
};

/******************************************************************************/

async function getInjectableCount(origin) {
    const url = ut.parsedURLromOrigin(origin);
    if ( url === undefined ) { return 0; }

    const [
        rulesetIds,
        scriptingDetails,
    ] = await Promise.all([
        dnr.getEnabledRulesets(),
        getScriptingDetails(),
    ]);

    let total = 0;

    for ( const rulesetId of rulesetIds ) {
        const hostnamesToFidsMap = scriptingDetails.get(rulesetId);
        if ( hostnamesToFidsMap === undefined ) { continue; }
        let hn = url.hostname;
        while ( hn !== '' ) {
            const fids = hostnamesToFidsMap.get(hn);
            if ( typeof fids === 'number' ) {
                total += 1;
            } else if ( Array.isArray(fids) ) {
                total += fids.length;
            }
            hn = ut.toBroaderHostname(hn);
        }
    }

    return total;
}

/******************************************************************************/

function registerSomeInjectables(args) {
    const {
        hostnamesSet,
        trustedSites,
        rulesetIds,
        scriptingDetails,
    } = args;

    const toRegisterMap = new Map();
    const trustedSitesSet = new Set(trustedSites);

    const checkMatches = (hostnamesToFidsMap, hn) => {
        let fids = hostnamesToFidsMap.get(hn);
        if ( fids === undefined ) { return; }
        if ( typeof fids === 'number' ) { fids = [ fids ]; }
        for ( const fid of fids ) {
            const fname = ut.fnameFromFileId(fid);
            let existing = toRegisterMap.get(fname);
            if ( existing ) {
                if ( existing[0] === '*' ) { continue; }
                existing.push(hn);
            } else {
                toRegisterMap.set(fname, existing = [ hn ]);
            }
            if ( hn !== '*' ) { continue; }
            existing.length = 0;
            existing.push('*');
            break;
        }
    };

    for ( const rulesetId of rulesetIds ) {
        const hostnamesToFidsMap = scriptingDetails.get(rulesetId);
        if ( hostnamesToFidsMap === undefined ) { continue; }
        for ( let hn of hostnamesSet ) {
            if ( isTrustedHostname(trustedSitesSet, hn) ) { continue; }
            while ( hn ) {
                checkMatches(hostnamesToFidsMap, hn);
                hn = ut.toBroaderHostname(hn);
            }
        }
    }

    return toRegisterMap;
}

function registerAllInjectables(args) {
    const {
        trustedSites,
        rulesetIds,
        scriptingDetails,
    } = args;

    const toRegisterMap = new Map();
    const trustedSitesSet = new Set(trustedSites);

    for ( const rulesetId of rulesetIds ) {
        const hostnamesToFidsMap = scriptingDetails.get(rulesetId);
        if ( hostnamesToFidsMap === undefined ) { continue; }
        for ( let [ hn, fids ] of hostnamesToFidsMap ) {
            if ( isTrustedHostname(trustedSitesSet, hn) ) { continue; }
            if ( typeof fids === 'number' ) { fids = [ fids ]; }
            for ( const fid of fids ) {
                const fname = ut.fnameFromFileId(fid);
                let existing = toRegisterMap.get(fname);
                if ( existing ) {
                    if ( existing[0] === '*' ) { continue; }
                    existing.push(hn);
                } else {
                    toRegisterMap.set(fname, existing = [ hn ]);
                }
                if ( hn !== '*' ) { continue; }
                existing.length = 0;
                existing.push('*');
                break;
            }
        }
    }

    return toRegisterMap;
}

/******************************************************************************/

async function registerInjectables(origins) {
    void origins;

    if ( browser.scripting === undefined ) { return false; }

    const [
        hostnamesSet,
        trustedSites,
        rulesetIds,
        scriptingDetails,
        registered,
    ] = await Promise.all([
        browser.permissions.getAll(),
        getAllTrustedSiteDirectives(),
        dnr.getEnabledRulesets(),
        getScriptingDetails(),
        browser.scripting.getRegisteredContentScripts(),
    ]).then(results => {
        results[0] = new Set(ut.hostnamesFromMatches(results[0].origins));
        return results;
    });

    const toRegisterMap = hostnamesSet.has('*')
        ? registerAllInjectables({
            trustedSites,
            rulesetIds,
            scriptingDetails,
        })
        : registerSomeInjectables({
            hostnamesSet,
            trustedSites,
            rulesetIds,
            scriptingDetails,
        });

    const before = new Map(registered.map(entry => [ entry.id, entry ]));

    const toAdd = [];
    const toUpdate = [];
    for ( const [ fname, hostnames ] of toRegisterMap ) {
        if ( before.has(fname) === false ) {
            toAdd.push(toRegisterable(fname, hostnames, trustedSites));
            continue;
        }
        if ( shouldUpdate(before.get(fname), hostnames, trustedSites) ) {
            toUpdate.push(toRegisterable(fname, hostnames, trustedSites));
        }
    }

    const toRemove = [];
    for ( const fname of before.keys() ) {
        if ( toRegisterMap.has(fname) ) { continue; }
        toRemove.push(fname);
    }

    const todo = [];
    if ( toRemove.length !== 0 ) {
        console.info(`Unregistered ${toRemove} content (css/js)`);
        todo.push(
            browser.scripting.unregisterContentScripts({ ids: toRemove })
                .catch(reason => { console.info(reason); })
        );
    }
    if ( toAdd.length !== 0 ) {
        console.info(`Registered ${toAdd.map(v => v.id)} content (css/js)`);
        todo.push(
            browser.scripting.registerContentScripts(toAdd)
                .catch(reason => { console.info(reason); })
        );
    }
    if ( toUpdate.length !== 0 ) {
        console.info(`Updated ${toUpdate.map(v => v.id)} content (css/js)`);
        todo.push(
            browser.scripting.updateContentScripts(toUpdate)
                .catch(reason => { console.info(reason); })
        );
    }
    if ( todo.length === 0 ) { return; }

    return Promise.all(todo);
}

/******************************************************************************/

export {
    getInjectableCount,
    registerInjectables
};

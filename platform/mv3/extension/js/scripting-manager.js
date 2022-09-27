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
        const out = new Map(entries);
        for ( const details of out.values() ) {
            details.matches = new Map(details.matches);
            details.excludeMatches = new Map(details.excludeMatches);
        }
        return out;
    });
    return scriptingDetailsPromise;
}

/******************************************************************************/

const arrayEq = (a, b) => {
    if ( a === undefined ) { return b === undefined; }
    if ( b === undefined ) { return false; }
    if ( a.length !== b.length ) { return false; }
    for ( const i of a ) {
        if ( b.includes(i) === false ) { return false; }
    }
    return true;
};

/******************************************************************************/

const toRegisterable = (fname, entry) => {
    const directive = {
        id: fname,
    };
    if ( entry.matches ) {
        directive.matches = ut.matchesFromHostnames(entry.matches);
    } else {
        directive.matches = [ '<all_urls>' ];
    }
    if ( entry.excludeMatches ) {
        directive.excludeMatches = ut.matchesFromHostnames(entry.excludeMatches);
    }
    directive.js = [ `/rulesets/js/${fname.slice(0,2)}/${fname.slice(2)}.js` ];
    if ( (ut.fidFromFileName(fname) & RUN_AT_BIT) !== 0 ) {
        directive.runAt = 'document_end';
    } else {
        directive.runAt = 'document_start';
    }
    if ( (ut.fidFromFileName(fname) & MAIN_WORLD_BIT) !== 0 ) {
        directive.world = 'MAIN';
    }
    return directive;
};

const RUN_AT_BIT =     0b10;
const MAIN_WORLD_BIT = 0b01;

/******************************************************************************/

const shouldUpdate = (registered, candidate) => {
    const matches = candidate.matches &&
        ut.matchesFromHostnames(candidate.matches);
    if ( arrayEq(registered.matches, matches) === false ) {
        return true;
    }
    const excludeMatches = candidate.excludeMatches &&
        ut.matchesFromHostnames(candidate.excludeMatches);
    if ( arrayEq(registered.excludeMatches, excludeMatches) === false ) {
        return true;
    }
    return false;
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
        if ( scriptingDetails.has(rulesetId) === false ) { continue; }
        const details = scriptingDetails.get(rulesetId);
        let hn = url.hostname;
        while ( hn !== '' ) {
            const fids = details.matches?.get(hn);
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

    const checkMatches = (details, hn) => {
        let fids = details.matches?.get(hn);
        if ( fids === undefined ) { return; }
        if ( typeof fids === 'number' ) { fids = [ fids ]; }
        for ( const fid of fids ) {
            const fname = ut.fnameFromFileId(fid);
            const existing = toRegisterMap.get(fname);
            if ( existing ) {
                existing.matches.push(hn);
            } else {
                toRegisterMap.set(fname, { matches: [ hn ] });
            }
        }
    };

    for ( const rulesetId of rulesetIds ) {
        const details = scriptingDetails.get(rulesetId);
        if ( details === undefined ) { continue; }
        for ( let hn of hostnamesSet ) {
            if ( isTrustedHostname(trustedSites, hn) ) { continue; }
            while ( hn ) {
                checkMatches(details, hn);
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

    for ( const rulesetId of rulesetIds ) {
        const details = scriptingDetails.get(rulesetId);
        if ( details === undefined ) { continue; }
        for ( let [ hn, fids ] of details.matches ) {
            if ( isTrustedHostname(trustedSites, hn) ) { continue; }
            if ( typeof fids === 'number' ) { fids = [ fids ]; }
            for ( const fid of fids ) {
                const fname = ut.fnameFromFileId(fid);
                const existing = toRegisterMap.get(fname);
                if ( existing ) {
                    existing.matches.push(hn);
                } else {
                    toRegisterMap.set(fname, { matches: [ hn ] });
                }
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
        results[1] = new Set(results[1]);
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
    for ( const [ fname, entry ] of toRegisterMap ) {
        if ( before.has(fname) === false ) {
            toAdd.push(toRegisterable(fname, entry));
            continue;
        }
        if ( shouldUpdate(before.get(fname), entry) ) {
            toUpdate.push(toRegisterable(fname, entry));
        }
    }

    const toRemove = [];
    for ( const fname of before.keys() ) {
        if ( toRegisterMap.has(fname) ) { continue; }
        toRemove.push(fname);
    }

    const todo = [];
    if ( toRemove.length !== 0 ) {
        todo.push(browser.scripting.unregisterContentScripts({ ids: toRemove }));
        console.info(`Unregistered ${toRemove} content (css/js)`);
    }
    if ( toAdd.length !== 0 ) {
        todo.push(browser.scripting.registerContentScripts(toAdd));
        console.info(`Registered ${toAdd.map(v => v.id)} content (css/js)`);
    }
    if ( toUpdate.length !== 0 ) {
        todo.push(browser.scripting.updateContentScripts(toUpdate));
        console.info(`Updated ${toUpdate.map(v => v.id)} content (css/js)`);
    }
    if ( todo.length === 0 ) { return; }

    return Promise.all(todo);
}

/******************************************************************************/

export {
    getInjectableCount,
    registerInjectables
};

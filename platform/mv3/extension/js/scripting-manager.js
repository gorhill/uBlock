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
import { getFilteringModeDetails } from './mode-manager.js';
import { getEnabledRulesetsDetails } from './ruleset-manager.js';

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

// Important: We need to sort the arrays for fast comparison
const arrayEq = (a = [], b = []) => {
    const alen = a.length;
    if ( alen !== b.length ) { return false; }
    a.sort(); b.sort();
    for ( let i = 0; i < alen; i++ ) {
        if ( a[i] !== b[i] ) { return false; }
    }
    return true;
};

/******************************************************************************/

const toRegisterableScript = (context, fname, hostnames) => {
    if ( context.before.has(fname) ) {
        return toUpdatableScript(context, fname, hostnames);
    }
    const matches = hostnames
        ? ut.matchesFromHostnames(hostnames)
        : [ '<all_urls>' ];
    const excludeMatches = matches.length === 1 && matches[0] === '<all_urls>'
        ? ut.matchesFromHostnames(context.filteringModeDetails.none)
        : [];
    const runAt = (ut.fidFromFileName(fname) & RUN_AT_END_BIT) !== 0
        ? 'document_end'
        : 'document_start';
    const directive = {
        id: fname,
        allFrames: true,
        matches,
        excludeMatches,
        js: [ `/rulesets/js/${fname.slice(0,2)}/${fname.slice(2)}.js` ],
        runAt,
    };
    if ( (ut.fidFromFileName(fname) & MAIN_WORLD_BIT) !== 0 ) {
        directive.world = 'MAIN';
    }
    context.toAdd.push(directive);
};

const toUpdatableScript = (context, fname, hostnames) => {
    const registered = context.before.get(fname);
    context.before.delete(fname); // Important!
    const directive = { id: fname };
    const matches = hostnames
        ? ut.matchesFromHostnames(hostnames)
        : [ '<all_urls>' ];
    if ( arrayEq(registered.matches, matches) === false ) {
        directive.matches = matches;
    }
    const excludeMatches = matches.length === 1 && matches[0] === '<all_urls>'
        ? ut.matchesFromHostnames(context.filteringModeDetails.none)
        : [];
    if ( arrayEq(registered.excludeMatches, excludeMatches) === false ) {
        directive.excludeMatches = excludeMatches;
    }
    if ( directive.matches || directive.excludeMatches ) {
        context.toUpdate.push(directive);
    }
};

const RUN_AT_END_BIT = 0b10;
const MAIN_WORLD_BIT = 0b01;

/******************************************************************************/

async function registerGeneric(context, args) {
    const { before } = context;
    const registered = before.get('css-generic');
    before.delete('css-generic'); // Important!

    const {
        filteringModeDetails,
        rulesetsDetails,
    } = args;

    const js = [];
    for ( const details of rulesetsDetails ) {
        if ( details.css.generic.count === 0 ) { continue; }
        js.push(`/rulesets/js/${details.id}.generic.js`);
    }

    if ( js.length === 0 ) {
        if ( registered !== undefined ) {
            context.toRemove.push('css-generic');
        }
        return;
    }

    const matches = [];
    const excludeMatches = [];
    if ( filteringModeDetails.extendedGeneric.has('all-urls') ) {
        excludeMatches.push(...ut.matchesFromHostnames(filteringModeDetails.none));
        excludeMatches.push(...ut.matchesFromHostnames(filteringModeDetails.network));
        excludeMatches.push(...ut.matchesFromHostnames(filteringModeDetails.extendedSpecific));
        matches.push('<all_urls>');
    } else {
        matches.push(...ut.matchesFromHostnames(filteringModeDetails.extendedGeneric));
    }

    if ( matches.length === 0 ) {
        if ( registered !== undefined ) {
            context.toRemove.push('css-generic');
        }
        return;
    }

    // register
    if ( registered === undefined ) {
        context.toAdd.push({
            id: 'css-generic',
            js,
            matches,
            excludeMatches,
            runAt: 'document_idle',
        });
        return;
    }

    // update
    const directive = { id: 'css-generic' };
    if ( arrayEq(registered.js, js) === false ) {
        directive.js = js;
    }
    if ( arrayEq(registered.matches, matches) === false ) {
        directive.matches = matches;
    }
    if ( arrayEq(registered.excludeMatches, excludeMatches) === false ) {
        directive.excludeMatches = excludeMatches;
    }
    if ( directive.js || directive.matches || directive.excludeMatches ) {
        context.toUpdate.push(directive);
    }
}

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

function registerSpecific(args) {
    const {
        filteringModeDetails,
        rulesetsDetails,
        scriptingDetails,
    } = args;

    // Combined both specific and generic sets
    if (
        filteringModeDetails.extendedSpecific.has('all-urls') ||
        filteringModeDetails.extendedGeneric.has('all-urls')
    ) {
        return registerAllSpecific(args);
    }

    const targetHostnames = [
        ...filteringModeDetails.extendedSpecific,
        ...filteringModeDetails.extendedGeneric,
    ];

    const toRegisterMap = new Map();

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

    for ( const rulesetDetails of rulesetsDetails ) {
        const hostnamesToFidsMap = scriptingDetails.get(rulesetDetails.id);
        if ( hostnamesToFidsMap === undefined ) { continue; }
        for ( let hn of targetHostnames ) {
            while ( hn ) {
                checkMatches(hostnamesToFidsMap, hn);
                hn = ut.toBroaderHostname(hn);
            }
        }
    }

    return toRegisterMap;
}

function registerAllSpecific(args) {
    const {
        filteringModeDetails,
        rulesetsDetails,
        scriptingDetails,
    } = args;

    const toRegisterMap = new Map();
    const excludeSet = new Set([
        ...filteringModeDetails.network,
        ...filteringModeDetails.none,
    ]);

    for ( const rulesetDetails of rulesetsDetails ) {
        const hostnamesToFidsMap = scriptingDetails.get(rulesetDetails.id);
        if ( hostnamesToFidsMap === undefined ) { continue; }
        for ( let [ hn, fids ] of hostnamesToFidsMap ) {
            if ( excludeSet.has(hn) ) { continue; }
            if ( ut.isDescendantHostnameOfIter(hn, excludeSet) ) { continue; }
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
        filteringModeDetails,
        rulesetsDetails,
        scriptingDetails,
        registered,
    ] = await Promise.all([
        getFilteringModeDetails(),
        getEnabledRulesetsDetails(),
        getScriptingDetails(),
        browser.scripting.getRegisteredContentScripts(),
    ]);

    const before = new Map(registered.map(entry => [ entry.id, entry ]));
    const toAdd = [], toUpdate = [], toRemove = [];
    const promises = [];
    const context = {
        filteringModeDetails,
        before,
        toAdd,
        toUpdate,
        toRemove,
    };

    await registerGeneric(context, { filteringModeDetails, rulesetsDetails, });

    const toRegisterMap = registerSpecific({
        filteringModeDetails,
        rulesetsDetails,
        scriptingDetails,
    });

    for ( const [ fname, hostnames ] of toRegisterMap ) {
        toRegisterableScript(context, fname, hostnames);
    }
    toRemove.push(...Array.from(before.keys()));

    if ( toRemove.length !== 0 ) {
        console.info(`Unregistered ${toRemove} content (css/js)`);
        promises.push(
            browser.scripting.unregisterContentScripts({ ids: toRemove })
                .catch(reason => { console.info(reason); })
        );
    }
    if ( toAdd.length !== 0 ) {
        console.info(`Registered ${toAdd.map(v => v.id)} content (css/js)`);
        promises.push(
            browser.scripting.registerContentScripts(toAdd)
                .catch(reason => { console.info(reason); })
        );
    }
    if ( toUpdate.length !== 0 ) {
        console.info(`Updated ${toUpdate.map(v => v.id)} content (css/js)`);
        promises.push(
            browser.scripting.updateContentScripts(toUpdate)
                .catch(reason => { console.info(reason); })
        );
    }
    if ( promises.length === 0 ) { return; }

    return Promise.all(promises);
}

/******************************************************************************/

export {
    getInjectableCount,
    registerInjectables
};

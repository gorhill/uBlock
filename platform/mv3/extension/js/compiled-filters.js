/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2026-present Raymond Hill

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

import {
    browser,
    localRead,
    localRemove,
    localWrite,
    runtime,
    supportsUserScripts,
} from './ext.js';

import {
    closeOffscreenDocument,
    createOffscreenDocument,
} from './ext-offscreen.js';

import {
    getAllCustomFilters,
    getSandboxFilters,
} from './filter-manager.js';

import {
    getEnabledImportedLists,
    getImportedListCompiledData,
    updateImportedListData,
} from './imported-lists.js';

import {
    isScriptlet,
    matchesFromHostnames,
} from './utils.js';

import { getFilteringModeDetails } from './mode-manager.js';
import { supportsOffscreenDocument } from './ext-offscreen.js';
import { ubolLog } from './debug.js';

/******************************************************************************/

async function getUserList() {
    const customFilters = await getAllCustomFilters();
    const lines = [];
    for ( const [ hostname, selectors ] of customFilters ) {
        for ( const selector of selectors ) {
            if ( isScriptlet(selector) === false ) { continue; }
            lines.push(`${hostname}##${selector}`);
        }
    }
    const sandboxFilters = await getSandboxFilters();
    if ( sandboxFilters ) {
        lines.push(sandboxFilters);
    }
    return lines.join('\n').trim();
}

/******************************************************************************/

async function parseRawFilters() {
    const {
        promise: offscreenPromise,
        resolve: offscreenResolve,
    } = Promise.withResolvers();
    const handler = (request, sender, callback) => {
        if ( typeof request !== 'object' ) { return; }
        switch ( request?.what ) {
        case 'compileFilters:getUserList':
            getUserList().then(text => {
                if ( text ) { ubolLog(`Compiling user filters`); }
                callback(text);
            });
            return true;
        case 'compileFilters:result':
            offscreenResolve(request);
            break;
        case 'compileFilters:getEnabledImportedLists':
            getEnabledImportedLists().then(result => {
                if ( result?.length ) { ubolLog(`Compiling ${result.length} imported lists`); }
                callback(result);
            });
            return true;
        case 'compileFilters:getImportedListCompiledData':
            getImportedListCompiledData(request.listid).then(result => {
                if ( result?.serialized ) { ubolLog(`Reusing cached data for ${result.listid}`); }
                callback(result);
            });
            return true;
        case 'compileFilters:updateImportedListData':
            updateImportedListData(request.listid, request).then(result => {
                if ( result ) { ubolLog(`Updated cached data for ${result.listid}`); }
                callback(result);
            });
            return true;
        default:
            break;
        }
    };
    runtime.onMessage.addListener(handler);
    const {
        promise: timeoutPromise,
        resolve: timeoutResolve,
    } = Promise.withResolvers();
    self.setTimeout(timeoutResolve, 30000);
    const [ result ] = await Promise.all([
        Promise.race([ offscreenPromise, timeoutPromise ]),
        createOffscreenDocument('/js/offscreen/compile-filters.html'),
    ]);
    runtime.onMessage.removeListener(handler);
    await closeOffscreenDocument();
    return result;
}

/******************************************************************************/

function prepareUserScripts(id, none, result) {
    const out = [];
    const excludeHostnames = none.has('all-urls') === false
        ? [ ...none ]
        : [];
    const excludeMatches = excludeHostnames.length !== 0
        ? matchesFromHostnames(excludeHostnames)
        : [];
    if ( result?.ISOLATED?.length ) {
        for ( const script of result.ISOLATED ) {
            const directive = {
                id: script.id,
                world: 'USER_SCRIPT',
                allFrames: true,
                js: [ { code: script.code } ],
                runAt: 'document_start',
                matches: matchesFromHostnames(script.hostnames),
            };
            if ( excludeMatches.length !== 0 ) {
                directive.excludeMatches = excludeMatches.slice();
            }
            out.push(directive);
        }
    }
    if ( result?.MAIN?.length ) {
        for ( const script of result.MAIN ) {
            const directive = {
                id: script.id,
                world: 'MAIN',
                allFrames: true,
                js: [ { code: script.code } ],
                runAt: 'document_start',
                matches: matchesFromHostnames(script.hostnames),
            };
            if ( excludeMatches.length !== 0 ) {
                directive.excludeMatches = excludeMatches.slice();
            }
            out.push(directive);
        }
    }
    return out;
}

/******************************************************************************/

async function saveRules(id, rules) {
    const storageId = `${id}Filters.dnrRules`;
    const beforeRules = await localRead(storageId);
    const afterRules = rules?.length && rules;
    const modified = JSON.stringify(afterRules) !== JSON.stringify(beforeRules);
    if ( modified === false ) { return false; }
    if ( Array.isArray(afterRules) ) {
        await localWrite(storageId, afterRules);
    } else {
        await localRemove(storageId);
    }
    return true;
}

/******************************************************************************/

async function saveUserScripts(result = {}) {
    return Promise.all([
        localWrite('sandboxFilters.userScripts', {
            ISOLATED: result.sandbox?.ISOLATED ?? [],
            MAIN: result.sandbox?.MAIN ?? [],
        }),
        localWrite('importedFilters.userScripts', {
            ISOLATED: result.imported?.ISOLATED ?? [],
            MAIN: result.imported?.MAIN ?? [],
        }),
    ]);
}

async function readUserScripts() {
    const [
        sandbox = {},
        imported = {},
    ] = await Promise.all([
        localRead('sandboxFilters.userScripts'),
        localRead('importedFilters.userScripts'),
    ]);
    return { sandbox, imported };
}

/******************************************************************************/

async function register() {
    if ( supportsUserScripts() ) {
        try {
            const toRemove = await browser.userScripts.getScripts();
            if ( toRemove.length !== 0 ) {
                await browser.userScripts.unregister();
                ubolLog(`Unregistered userscript ${toRemove.map(a => a.id).join()}`);
            }
        } catch {
        }
    }

    const [
        { none, basic },
        { sandbox, imported },
    ] = await Promise.all([
        getFilteringModeDetails(),
        readUserScripts(),
    ]);

    const toAdd = [];
    const sandboxScripts = await prepareUserScripts('sandbox',
        none,
        sandbox
    );
    if ( sandboxScripts.length ) {
        toAdd.push(...sandboxScripts);
    }
    const importedScripts = await prepareUserScripts('imported',
        new Set([ ...none, ...basic ]),
        imported
    );
    if ( importedScripts.length ) {
        toAdd.push(...importedScripts);
    }
    if ( supportsUserScripts() && toAdd.length ) {
        try {
            await browser.userScripts.register(toAdd).then(( ) => {
                ubolLog(`Registered userscript ${toAdd.map(v => v.id)}`);
            });
        } catch {
        }
    }
}

/******************************************************************************/

async function update() {
    const [
        hasUserFilters,
        hasImportedLists,
    ] = await Promise.all([
        getUserList().then(a => Boolean(a)),
        getEnabledImportedLists().then(a => Boolean(a.length)),
    ]);

    let result;
    if ( hasUserFilters || hasImportedLists ) {
        result = await parseRawFilters();
        if ( Boolean(result) === false ) { return; }
    }

    await Promise.all([
        saveRules('sandbox', result?.sandbox?.dnrRules),
        saveRules('imported', result?.imported?.dnrRules),
        saveUserScripts(result),
    ]);
}

/******************************************************************************/

// This recompiles all sandbox and imported filters.

export async function updateCompiledFilters() {
    if ( supportsOffscreenDocument !== true ) { return false; }
    pendingRegister = pendingRegister.then(( ) => update());
    return pendingRegister;
}

/******************************************************************************/

// This registers previously compiled external filters, according to current
// filtering mode details.

export async function registerUserScripts() {
    if ( supportsOffscreenDocument !== true ) { return false; }
    pendingRegister = pendingRegister.then(( ) => register());
    return pendingRegister;
}

/******************************************************************************/

let pendingRegister = Promise.resolve();

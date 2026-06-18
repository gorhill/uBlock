/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
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

import {
    browser,
    localKeys,
    localRead,
    localRemove,
    localWrite,
    runtime,
    supportsUserScripts,
} from './ext.js';

import {
    getCompiledListData,
    getEnabledImportedLists,
    updateImportedListData,
} from './imported-lists.js';

import {
    intersectHostnameIters,
    matchesFromHostnames,
    subtractHostnameIters,
} from './utils.js';

import {
    ubolErr,
    ubolLog,
} from './debug.js';

import { getFilteringModeDetails } from './mode-manager.js';
import { rulesetConfig } from './config.js';

/******************************************************************************/

const isProcedural = a => a.startsWith('{');
const isScriptlet = a => a.startsWith('+js');
const isCSS = a => isProcedural(a) === false && isScriptlet(a) === false;

/******************************************************************************/

async function keysFromStorage() {
    pendingStorageOp = pendingStorageOp.then(( ) => localKeys());
    return pendingStorageOp;
}

async function readFromStorage(key) {
    pendingStorageOp = pendingStorageOp.then(( ) => localRead(key));
    return pendingStorageOp;
}

async function writeToStorage(key, value) {
    pendingStorageOp = pendingStorageOp.then(( ) => localWrite(key, value));
    return pendingStorageOp;
}

async function removeFromStorage(key) {
    pendingStorageOp = pendingStorageOp.then(( ) => localRemove(key));
    return pendingStorageOp;
}

let pendingStorageOp = Promise.resolve();

/******************************************************************************/

export async function customFiltersFromHostname(hostname) {
    const promises = [];
    let hn = hostname;
    while ( hn !== '' ) {
        promises.push(readFromStorage(`site.${hn}`));
        const pos = hn.indexOf('.');
        if ( pos === -1 ) { break; }
        hn = hn.slice(pos + 1);
    }
    const results = await Promise.all(promises);
    const out = [];
    for ( let i = 0; i < promises.length; i++ ) {
        const selectors = results[i];
        if ( selectors === undefined ) { continue; }
        selectors.forEach(selector => {
            out.push(selector);
        });
    }
    return out.sort();
}

/******************************************************************************/

export async function hasCustomFilters(hostname) {
    const selectors = await customFiltersFromHostname(hostname);
    return selectors?.length ?? 0;
}

/******************************************************************************/

async function getAllCustomFilterKeys() {
    const storageKeys = await keysFromStorage() || [];
    return storageKeys.filter(a => a.startsWith('site.'));
}

/******************************************************************************/

export async function getAllCustomFilters() {
    const collect = async key => {
        const selectors = await readFromStorage(key);
        return [ key.slice(5), selectors ?? [] ];
    };
    const keys = await getAllCustomFilterKeys();
    const promises = keys.map(k => collect(k));
    return Promise.all(promises);
}

/******************************************************************************/

export function startCustomFilters(tabId, frameId) {
    return browser.scripting.executeScript({
        files: [ '/js/scripting/css-user.js' ],
        target: { tabId, frameIds: [ frameId ] },
        injectImmediately: true,
    }).catch(reason => {
        ubolErr(`startCustomFilters/${reason}`);
    })
}

export function terminateCustomFilters(tabId, frameId) {
    return browser.scripting.executeScript({
        files: [ '/js/scripting/css-user-terminate.js' ],
        target: { tabId, frameIds: [ frameId ] },
        injectImmediately: true,
    }).catch(reason => {
        ubolErr(`terminateCustomFilters/${reason}`);
    })
}

/******************************************************************************/

export async function injectCustomFilters(tabId, frameId, hostname) {
    const selectors = await customFiltersFromHostname(hostname);
    if ( selectors.length === 0 ) { return; }
    const promises = [];
    const plainSelectors = selectors.filter(a => isCSS(a));
    if ( plainSelectors.length !== 0 ) {
        promises.push(
            browser.scripting.insertCSS({
                css: `${plainSelectors.join(',\n')}{display:none!important;}`,
                origin: 'USER',
                target: { tabId, frameIds: [ frameId ] },
            }).catch(reason => {
                ubolErr(`injectCustomFilters/insertCSS/${reason}`);
            })
        );
    }
    const proceduralSelectors = selectors.filter(a => isProcedural(a));
    if ( proceduralSelectors.length !== 0 ) {
        promises.push(
            browser.scripting.executeScript({
                files: [
                    '/js/scripting/css-api.js',
                    '/js/scripting/css-procedural-api.js',
                ],
                target: { tabId, frameIds: [ frameId ] },
                injectImmediately: true,
            }).catch(reason => {
                ubolErr(`injectCustomFilters/executeScript/${reason}`);
            })
        );
    }
    await Promise.all(promises);
    return { plainSelectors, proceduralSelectors };
}

/******************************************************************************/

export async function registerCustomFilters(context) {
    const customFilters = new Map(await getAllCustomFilters());
    if ( customFilters.size === 0 ) { return; }

    const { none } = context.filteringModeDetails;
    let hostnames = Array.from(customFilters.keys());
    let excludeHostnames = [];
    if ( none.has('all-urls') ) {
        const { basic, optimal, complete } = context.filteringModeDetails;
        hostnames = intersectHostnameIters(hostnames, [
            ...basic, ...optimal, ...complete
        ]);
    } else if ( none.size !== 0 ) {
        hostnames = [ ...subtractHostnameIters(hostnames, none) ];
        excludeHostnames = Array.from(none);
    }
    hostnames = hostnames.filter(a =>
        customFilters.get(a).some(a => isCSS(a) || isProcedural(a))
    );
    if ( hostnames.length === 0 ) { return; }

    const directive = {
        id: 'css-user',
        js: [ '/js/scripting/css-user.js' ],
        matches: matchesFromHostnames(hostnames),
        allFrames: true,
        matchOriginAsFallback: true,
        runAt: 'document_start',
    };
    if ( excludeHostnames.length !== 0 ) {
        directive.excludeMatches = matchesFromHostnames(excludeHostnames);
    }

    context.toAdd.push(directive);
}

/******************************************************************************/

export async function addCustomFilters(hostname, toAdd) {
    if ( hostname === '' ) { return false; }
    const key = `site.${hostname}`;
    const selectors = await readFromStorage(key) || [];
    const countBefore = selectors.length;
    for ( const selector of toAdd ) {
        if ( selectors.includes(selector) ) { continue; }
        selectors.push(selector);
    }
    if ( selectors.length === countBefore ) { return false; }
    selectors.sort();
    writeToStorage(key, selectors);
    return true;
}

/******************************************************************************/

export async function removeAllCustomFilters(hostname) {
    if ( hostname === '*' ) {
        const keys = await getAllCustomFilterKeys();
        if ( keys.length === 0 ) { return false; }
        for ( const key of keys ) {
            removeFromStorage(key);
        }
        return true;
    }
    const key = `site.${hostname}`;
    const selectors = await readFromStorage(key) || [];
    removeFromStorage(key);
    return selectors.length !== 0;
}

export async function removeCustomFilters(hostname, selectors) {
    const promises = [];
    let hn = hostname;
    while ( hn !== '' ) {
        promises.push(removeCustomFiltersByKey(`site.${hn}`, selectors));
        const pos = hn.indexOf('.');
        if ( pos === -1 ) { break; }
        hn = hn.slice(pos + 1);
    }
    const results = await Promise.all(promises);
    return results.some(a => a);
}

async function removeCustomFiltersByKey(key, toRemove) {
    const selectors = await readFromStorage(key);
    if ( selectors === undefined ) { return false; }
    const beforeCount = selectors.length;
    for ( const selector of toRemove ) {
        const i = selectors.indexOf(selector);
        if ( i === -1 ) { continue; }
        selectors.splice(i, 1);
    }
    const afterCount = selectors.length;
    if ( afterCount === beforeCount ) { return false; }
    if ( afterCount !== 0 ) {
        writeToStorage(key, selectors);
    } else {
        removeFromStorage(key);
    }
    return true;
}

/******************************************************************************/

export function getSandboxFilters() {
    return localRead('sandboxFilters');
}

export function setSandboxFilters(text = '') {
    text = text.trim();
    return text !== ''
        ? localWrite('sandboxFilters', text)
        : localRemove('sandboxFilters')
}

/******************************************************************************/

export async function registerSandboxFilters() {
    if ( supportsUserScripts !== true ) { return false; }
    console.trace('registerSandboxFilters');
    registerSandboxFilters.pendingOp =
        registerSandboxFilters.pendingOp.then(( ) => registerSandboxFilters.register());
    return registerSandboxFilters.pendingOp;
}
registerSandboxFilters.pendingOp = Promise.resolve();

async function getUserList() {
    const customFilters = await getAllCustomFilters();
    const lines = [];
    for ( const [ hostname, selectors ] of customFilters ) {
        for ( const selector of selectors ) {
            if ( isScriptlet(selector) === false ) { continue; }
            lines.push(`${hostname}##${selector}`);
        }
    }
    if ( rulesetConfig.developerMode ) {
        const sandboxFilters = await getSandboxFilters();
        if ( sandboxFilters ) {
            lines.push(sandboxFilters);
        }
    }
    return lines.join('\n').trim();
}

registerSandboxFilters.register = async function register() {
    const [
        hasUserFilters,
        hasImportedLists,
    ] = await Promise.all([
        getUserList().then(a => Boolean(a)),
        getEnabledImportedLists().then(a => Boolean(a.length)),
    ]);

    let result;
    if ( hasUserFilters || hasImportedLists ) {
        result = await parseRawFilters() || {};
    }

    const scriptsToRemove = await browser.userScripts.getScripts();
    if ( scriptsToRemove.length !== 0 ) {
        await browser.userScripts.unregister();
        ubolLog(`Unregistered userscript ${scriptsToRemove.map(a => a.id).join()}`);
    }
    if ( Boolean(result) === false ) { return true; }

    const filteringModeDetails = await getFilteringModeDetails();
    const { none, basic } = filteringModeDetails;

    const toAdd = [];
    const {
        scripts: sandboxScripts,
        modified: sandboxModified,
    } = await registerSandboxFilters.prepare('sandbox',
        none,
        result.sandbox
    );
    if ( sandboxScripts.length ) {
        toAdd.push(...sandboxScripts);
    }
    const {
        scripts: importedScripts,
        modified: importedModified,
    } = await registerSandboxFilters.prepare('imported',
        new Set([ ...none, ...basic ]),
        result.imported
    );
    if ( importedScripts.length ) {
        toAdd.push(...importedScripts);
    }
    if ( toAdd.length ) {
        await browser.userScripts.register(toAdd).then(( ) => {
            ubolLog(`Registered userscript ${toAdd.map(v => v.id)}`);
        });
    }
    return sandboxModified || importedModified;
}

registerSandboxFilters.prepare = async function(id, none, result) {
    const scripts = [];
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
            scripts.push(directive);
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
            scripts.push(directive);
        }
    }
    // DNR rules
    const storageId = `${id}Filters.dnrRules`;
    const beforeRules = await localRead(storageId);
    const afterRules = rulesetConfig.developerMode && result?.dnrRules?.length
        ? result.dnrRules
        : undefined;
    const modified = JSON.stringify(afterRules) !== JSON.stringify(beforeRules);
    if ( modified ) {
        if ( Array.isArray(afterRules) ) {
            await localWrite(storageId, afterRules);
        } else {
            await localRemove(storageId);
        }
    }
    return { scripts, modified };
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
                callback(text);
            });
            return true;
        case 'compileFilters:result':
            offscreenResolve(request);
            break;
        case 'compileFilters:getEnabledImportedLists':
            getEnabledImportedLists().then(result => {
                callback(result);
            });
            return true;
        case 'compileFilters:getCompiledListData':
            getCompiledListData(request.listid).then(result => {
                callback(result);
            });
            return true;
        case 'compileFilters:updateImportedListData':
            updateImportedListData(request.listid, request).then(result => {
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
        browser.offscreen.createDocument({
            url: '/js/offscreen/compile-filters.html',
            reasons: [ 'WORKERS' ],
            justification: 'To compile custom & imported filters in a modular way from service worker (service workers do not allow dynamic module import)',
        }),
    ]);
    runtime.onMessage.removeListener(handler);
    await browser.offscreen.closeDocument();
    return result;
}

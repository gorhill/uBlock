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
} from './ext.js';

import {
    intersectHostnameIters,
    matchesFromHostnames,
    subtractHostnameIters,
} from './utils.js';

import {
    ubolErr,
    ubolLog,
} from './debug.js';

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

export function isUserScriptsAvailable() {
    if ( browser.offscreen === undefined ) { return false; }
    try {
        chrome.userScripts.getScripts();
    } catch {
        return false;
    }
    return true;
}

export async function registerCustomScriptlets(context) {
    if ( isUserScriptsAvailable() === false ) { return; }
    const { none, basic, optimal, complete } = context.filteringModeDetails;
    const notNone = [ ...basic, ...optimal, ...complete ];
    if ( registerCustomScriptlets.promise ) {
        registerCustomScriptlets.promise = registerCustomScriptlets.promise.then(
            registerCustomScriptlets.create
        );
    } else {
        registerCustomScriptlets.promise = registerCustomScriptlets.create();
    }
    registerCustomScriptlets.promise = registerCustomScriptlets.promise.then(worlds =>
        registerCustomScriptlets.register(worlds, none, notNone)
    );
    return registerCustomScriptlets.promise;
}

registerCustomScriptlets.register = async function(worlds, none, notNone) {
    if ( Boolean(worlds) === false ) { return; }
    const toAdd = [];
    const prepare = world => {
        let { hostnames } = world;
        let excludeHostnames = [];
        if ( none.has('all-urls') ) {
            hostnames = intersectHostnameIters(hostnames, notNone);
        } else if ( none.size !== 0 ) {
            hostnames = [ ...subtractHostnameIters(hostnames, none) ];
            excludeHostnames = Array.from(none);
        }
        if ( hostnames.length === 0 ) { return; }
        const directive = {
            allFrames: true,
            js: [ { code: world.code } ],
            matches: matchesFromHostnames(hostnames),
            runAt: 'document_start',
        };
        if ( excludeHostnames.length !== 0 ) {
            directive.excludeMatches = matchesFromHostnames(excludeHostnames);
        }
        return directive;
    };
    if ( worlds.ISOLATED ) {
        const directive = prepare(worlds.ISOLATED);
        if ( directive ) {
            directive.id = 'user.isolated';
            directive.world = 'USER_SCRIPT';
            toAdd.push(directive);
        }
    }
    if ( worlds.MAIN ) {
        const directive = prepare(worlds.MAIN);
        if ( directive ) {
            directive.id = 'user.main';
            directive.world = 'MAIN';
            toAdd.push(directive);
        }
    }
    if ( toAdd.length === 0 ) { return; }
    await browser.userScripts.register(toAdd).then(( ) => {
        ubolLog(`Registered userscript ${toAdd.map(v => v.id)}`);
    });
};

registerCustomScriptlets.create = async function() {
    const toRemove = await browser.userScripts.getScripts();
    if ( toRemove.length !== 0 ) {
        await browser.userScripts.unregister();
        ubolLog(`Unregistered userscript ${toRemove.map(v => v.id)}`);
    }
    const customFilters = await getAllCustomFilters();
    if ( customFilters.some(a => a[1].some(b => isScriptlet(b))) === false ) { return; }
    const { promise: offscreenPromise, resolve: offscreenResolve } = Promise.withResolvers();
    const handler = (msg, sender, callback) => {
        if ( typeof msg !== 'object' ) { return; }
        switch ( msg?.what ) {
        case 'getAllCustomFilters':
            getAllCustomFilters().then(result => {
                callback(result);
            });
            break;
        case 'registerCustomScriptlets':
            offscreenResolve(msg);
            break;
        default:
            break;
        }
    };
    const { promise: timeoutPromise, resolve: timeoutResolve } = Promise.withResolvers();
    self.setTimeout(timeoutResolve, 1000);
    runtime.onMessage.addListener(handler);
    const [ worlds ] = await Promise.all([
        Promise.race([ offscreenPromise, timeoutPromise ]),
        browser.offscreen.createDocument({
            url: '/js/offscreen/compile-scriptlets.html',
            reasons: [ 'WORKERS' ],
            justification: 'To compile custom user script-based filters in a modular way from service worker (service workers do not allow dynamic module import)',
        }),
    ]);
    runtime.onMessage.removeListener(handler);
    await browser.offscreen.closeDocument();
    return worlds;
};

registerCustomScriptlets.promise = null;

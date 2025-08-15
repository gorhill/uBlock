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
} from './ext.js';

import {
    intersectHostnameIters,
    matchesFromHostnames,
    strArrayEq,
    subtractHostnameIters,
} from './utils.js';

import { ubolErr } from './debug.js';

/******************************************************************************/

const perSitePendingIO = new Map();

/******************************************************************************/

export async function selectorsFromCustomFilters(hostname) {
    const promises = [];
    let hn = hostname;
    while ( hn !== '' ) {
        promises.push(localRead(`site.${hn}`));
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
            out.push(selector.startsWith('0') ? selector.slice(1) : selector);
        });
    }
    return out.sort();
}

/******************************************************************************/

export async function hasCustomFilters(hostname) {
    const selectors = await selectorsFromCustomFilters(hostname);
    return selectors?.length ?? 0;
}

/******************************************************************************/

async function getAllCustomFilterKeys() {
    const storageKeys = await localKeys() || [];
    return storageKeys.filter(a => a.startsWith('site.'));
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
    const selectors = await selectorsFromCustomFilters(hostname);
    if ( selectors.length === 0 ) { return; }
    const promises = [];
    const plainSelectors = selectors.filter(a => a.startsWith('{') === false);
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
    const proceduralSelectors = selectors.filter(a => a.startsWith('{'));
    if ( proceduralSelectors.length !== 0 ) {
        promises.push(
            browser.scripting.executeScript({
                files: [ '/js/scripting/css-procedural-api.js' ],
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
    if ( perSitePendingIO.size !== 0 ) {
        await Promise.all(Array.from(perSitePendingIO.values()));
    }
    const siteKeys = await getAllCustomFilterKeys();
    if ( siteKeys.length === 0 ) { return; }

    const { none } = context.filteringModeDetails;
    let hostnames = siteKeys.map(a => a.slice(5));
    if ( none.has('all-urls') ) {
        const { basic, optimal, complete } = context.filteringModeDetails;
        hostnames = intersectHostnameIters(hostnames, [
            ...basic, ...optimal, ...complete
        ]);
    } else if ( none.size !== 0 ) {
        hostnames = [ ...subtractHostnameIters(hostnames, none) ];
    }
    if ( hostnames.length === 0 ) { return; }

    const registered = context.before.get('css-user');
    context.before.delete('css-user'); // Important!

    const directive = {
        id: 'css-user',
        js: [ '/js/scripting/css-user.js' ],
        matches: matchesFromHostnames(hostnames),
        runAt: 'document_start',
    };

    if ( registered === undefined ) {
        context.toAdd.push(directive);
    } else if ( strArrayEq(registered.matches, directive.matches) === false ) {
        context.toRemove.push('css-user');
        context.toAdd.push(directive);
    }
}

/******************************************************************************/

export async function addCustomFilter(hostname, selector) {
    const pending = perSitePendingIO.get(hostname);
    const promise = pending
        ? pending.then(( ) => addCustomFilterByHostname(hostname, selector))
        : addCustomFilterByHostname(hostname, selector);
    perSitePendingIO.set(hostname, promise);
    promise.then(( ) => {
        if ( promise !== perSitePendingIO.get(hostname) ) { return; }
        perSitePendingIO.delete(hostname);
    });
    return promise;
}

async function addCustomFilterByHostname(hostname, selector) {
    if ( hostname === '' ) { return false; }
    const key = `site.${hostname}`;
    const selectors = await localRead(key) || [];
    if ( selectors.includes(selector) ) { return false; }
    selectors.push(selector);
    selectors.sort();
    await localWrite(key, selectors);
    return true;
}

/******************************************************************************/

export async function removeCustomFilter(hostname, selector) {
    const promises = [];
    let hn = hostname;
    while ( hn !== '' ) {
        promises.push(removeCustomFilterByHostname(hn, selector));
        const pos = hn.indexOf('.');
        if ( pos === -1 ) { break; }
        hn = hn.slice(pos + 1);
    }
    const results = await Promise.all(promises);
    return results.some(a => a);
}

async function removeCustomFilterByHostname(hostname, selector) {
    const pending = perSitePendingIO.get(hostname);
    const key = `site.${hostname}`;
    const promise = pending
        ? pending.then(( ) => removeCustomFilterByKey(key, selector))
        : removeCustomFilterByKey(key, selector);
    perSitePendingIO.set(hostname, promise);
    promise.then(( ) => {
        if ( promise !== perSitePendingIO.get(hostname) ) { return; }
        perSitePendingIO.delete(hostname);
    });
    return promise;
}

async function removeCustomFilterByKey(key, selector) {
    const selectors = await localRead(key);
    if ( selectors === undefined ) { return false; }
    let i = selectors.indexOf(selector);
    if ( i === -1 ) {
        i = selectors.indexOf(`0${selector}`);
        if ( i === -1 ) { return false; }
    }
    selectors.splice(i, 1);
    if ( selectors.length !== 0 ) {
        await localWrite(key, selectors);
    } else {
        await localRemove(key);
    }
    return true;
}

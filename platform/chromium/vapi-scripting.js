/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
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

/* global browser */

import { hostnameFromURI } from './uri-utils.js';

/******************************************************************************/

const MAX_REGISTERED_SCRIPTLETS_LOW = 256;
const MAX_REGISTERED_SCRIPTLETS_HIGH = MAX_REGISTERED_SCRIPTLETS_LOW >>> 3;
const registeredScriptlets = new Map();
const injectedContextSet = new Set();
let requestScriptletsListener;

/******************************************************************************/

export function addRequestScriptletsListener(listener) {
    requestScriptletsListener = listener;
    browser.webNavigation.onBeforeNavigate.addListener(onBeforeNavigate, {
        url: [ { schemes: [ 'http', 'https' ] } ]
    });
}

export function injectNow(details) {
    details.timestamp = Date.now();
    inject('INJECTNOW', details);
}

export function reset(details = {}) {
    if ( details.hostname ) {
        registeredScriptlets.delete(details.hostname);
    } else {
        registeredScriptlets.clear();
    }
}

/******************************************************************************/

function uBO_isolatedCode(details) {
    if ( self.uBO_scriptletsInjected !== undefined ) { return; }
    self.uBO_scriptletsInjected = details.filters;

    const doc = document;
    const { location } = doc;
    if ( location === null ) { return; }
    const { hostname } = location;
    if ( hostname !== '' && details.hostname !== hostname ) { return; }

    (function isolatedCode(){})();

    let script;
    try {
        script = doc.createElement('script');
        script.appendChild(doc.createTextNode(details.mainCode));
        (doc.head || doc.documentElement).appendChild(script);
    } catch {
    }
    if ( script ) {
        script.remove();
        script.textContent = '';
    }
    return 0;
}

function uBO_assembleIsolatedCode(details) {
    const { hostname, isolatedWorld, mainWorld, filters } = details;
    const code = [
        `(${uBO_isolatedCode.toString()})(`,
        JSON.stringify({ hostname, mainCode: mainWorld, filters }),
        `);`,
    ].join('\n');
    const match = /\(function isolatedCode\(\)\{\}\)\(\)/.exec(code);
    return code.slice(0, match.index) +
        isolatedWorld +
        code.slice(match.index + match[0].length);
}

/******************************************************************************/

function onBeforeNavigate(eventDetails) {
    if ( eventDetails.frameId === 0 ) {
        clearInjectedContexts(eventDetails.tabId);
    } else {
        clearInjectedContexts(eventDetails.tabId, eventDetails.frameId);
    }
    const hostname = hostnameFromURI(eventDetails.url);
    const entry = registeredScriptlets.get(hostname) ?? {};
    entry.t = Date.now();
    if ( entry.code !== undefined ) { return; }
    const scriptletDetails = requestScriptletsListener(eventDetails);
    if ( scriptletDetails ) {
        const { isolatedWorld, mainWorld, filters } = scriptletDetails;
        entry.code = uBO_assembleIsolatedCode({
            hostname,
            isolatedWorld,
            mainWorld,
            filters,
        });
    } else {
        entry.code = '';
    }
    registeredScriptlets.set(hostname, entry);
}

async function inject(context, details) {
    const hostname = hostnameFromURI(details.url);
    const entry = registeredScriptlets.get(hostname);
    if ( entry === undefined ) { return; }
    const key = `${details.tabId}-${details.frameId}`;
    if ( injectedContextSet.has(key) ) {
        return console.info('INJECTED!!!', context, JSON.stringify(details));
    }
    console.info(context, JSON.stringify(details));
    injectedContextSet.add(key);
    if ( entry.code === '' ) { return; }
    try {
        await browser.tabs.executeScript(details.tabId, {
            frameId: details.frameId,
            matchAboutBlank: true,
            runAt: 'document_start',
            code: entry.code,
        });
    } catch {
    }
}

function clearInjectedContexts(tabId, frameId = 0) {
    if ( frameId !== 0 ) {
        return injectedContextSet.delete(`${tabId}-${frameId}`);
    }
    const keyPrefix = `${tabId}-`;
    for ( const key of injectedContextSet ) {
        if ( key.startsWith(keyPrefix) === false ) { continue; }
        injectedContextSet.delete(key);
    }
    if ( registeredScriptlets.size <= MAX_REGISTERED_SCRIPTLETS_HIGH ) { return; }
    const keys = Array.from(registeredScriptlets.keys())
        .sort((a, b) => a.t - b.t)
        .slice(0, -MAX_REGISTERED_SCRIPTLETS_LOW);
    for ( const key of keys ) {
        registeredScriptlets.delete(key)
    }
}

/******************************************************************************/

browser.webNavigation.onCommitted.addListener(details => {
    inject('ONCOMMITTED', details);
});

browser.webNavigation.onCompleted.addListener(details => {
    if ( details.frameId !== 0 ) { return; }
    clearInjectedContexts(details.tabId);
});

browser.webNavigation.onErrorOccurred.addListener(details => {
    clearInjectedContexts(details.tabId, details.frameId);
});

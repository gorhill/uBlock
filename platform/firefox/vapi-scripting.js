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

import { MRUCache } from './mrucache.js';
import { hostnameFromURI } from './uri-utils.js';

/******************************************************************************/

/*const injectorCodeParts = [
    '(',
    function(details) {
        if ( self.runtimeId === details.runtimeId ) { return; }
        self.runtimeId = details.runtimeId;

        self.uBO_scriptletsInjected = details.filters;

        const doc = document;
        const { location } = doc;
        if ( location === null ) { return; }
        const { hostname } = location;
        if ( hostname !== '' && details.hostname !== hostname ) { return; }

        (function isolatedCode(){})();

        let script;
        try {
            const code = [
                `self['${details.runtimeId}'] = true;`,
                details.scriptlets,
            ].join('\n');
            script = doc.createElement('script');
            script.appendChild(doc.createTextNode(code));
            (doc.head || doc.documentElement).appendChild(script);
        } catch {
        }
        if ( script ) {
            script.remove();
            script.textContent = '';
            script = undefined;
        }
        if ( self.wrappedJSObject[details.runtimeId] ) {
            delete self.wrappedJSObject[details.runtimeId];
            return 0;
        }
        // https://github.com/uBlockOrigin/uBlock-issues/issues/235
        //   Fall back to blob injection if execution through direct
        //   injection failed
        let url;
        try {
            const blob = new self.Blob(
                [ details.scriptlets ],
                { type: 'text/javascript; charset=utf-8' }
            );
            url = self.URL.createObjectURL(blob);
            script = doc.createElement('script');
            script.async = false;
            script.src = url;
            (doc.head || doc.documentElement || doc).append(script);
        } catch {
        }
        if ( url ) {
            if ( script ) { script.remove(); }
            self.URL.revokeObjectURL(url);
        }
        return 0;
    }.toString(),
    ')(',
        'details-slot',
    ');',
];*/
const autoInjectorCodeParts = [
    '(',
    function(details) {
        self.uBO_scriptletsInjected = details.filters;

        (function isolatedCode(){})();

        return 0;
    }.toString(),
    ')(',
        'details-slot',
    ');',
];
/*    '(',
    function(details) {
        self.uBO_scriptletsInjected = details.filters;

        (function isolatedCode(){})();

        let script;
        try {
            const code = [
                `self['${details.runtimeId}'] = true;`,
                details.scriptlets,
            ].join('\n');
            script = doc.createElement('script');
            script.appendChild(doc.createTextNode(code));
            (doc.head || doc.documentElement).appendChild(script);
        } catch {
        }
        if ( script ) {
            script.remove();
            script.textContent = '';
            script = undefined;
        }
        if ( self.wrappedJSObject[details.runtimeId] ) {
            delete self.wrappedJSObject[details.runtimeId];
            return 0;
        }
        // https://github.com/uBlockOrigin/uBlock-issues/issues/235
        //   Fall back to blob injection if execution through direct
        //   injection failed
        let url;
        try {
            const blob = new self.Blob(
                [ details.scriptlets ],
                { type: 'text/javascript; charset=utf-8' }
            );
            url = self.URL.createObjectURL(blob);
            script = doc.createElement('script');
            script.async = false;
            script.src = url;
            (doc.head || doc.documentElement || doc).append(script);
        } catch {
        }
        if ( url ) {
            if ( script ) { script.remove(); }
            self.URL.revokeObjectURL(url);
        }
        return 0;
    }.toString(),
    ')(',
        'details-slot',
    ');',
];*/
const detailsSlot = autoInjectorCodeParts.indexOf('details-slot');
const reIsolatedCode = /\(function isolatedCode\(\)\{\}\)\(\)/;
const registeredScriptlets = new MRUCache(256);
const injectedContextSet = new Set();
let requestScriptletsListener;

/******************************************************************************/

export function injectScripts(tabId, frameId, details) {
    const { hostname, isolatedCode, mainCode, filters } = details;
    injectorCodeParts[detailsSlot] = JSON.stringify({ hostname, mainCode, filters });
    const code1 = injectorCodeParts.join('\n');
    const match = reIsolatedCode.exec(code1);
    const code2 = code1.slice(0, match.index) +
        isolatedCode +
        code1.slice(match.index + match[0].length);
    try {
        browser.tabs.executeScript(tabId, {
            frameId,
            matchAboutBlank: true,
            runAt: 'document_start',
            code: code2,
        });
    } catch {
    }
}

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
    registeredScriptlets.reset();
    injectedContextSet.clear();
}

/******************************************************************************/

function onBeforeNavigate(eventDetails) {
    if ( eventDetails.frameId === 0 ) {
        clearInjectedContexts(eventDetails.tabId);
    } else {
        clearInjectedContexts(eventDetails.tabId, eventDetails.frameId);
    }
    const hostname = hostnameFromURI(eventDetails.url);
    const code = registeredScriptlets.lookup(hostname);
    if ( code ) { return; }
    const registerHandles = {};
    const scriptletDetails = requestScriptletsListener(eventDetails);
    const { isolatedWorld, mainWorld, filters } = scriptletDetails
    if ( isolatedWorld ) {
        autoInjectorCodeParts[detailsSlot] = JSON.stringify({ filters });
        const code1 = autoInjectorCodeParts.join('\n');
        const match = reIsolatedCode.exec(code1);
        const code2 = code1.slice(0, match.index) +
            isolatedWorld +
            code1.slice(match.index + match[0].length);
        registerHandles.isolated = browser.contentScripts.register({
            js: [ { code: code2 } ],
            matchOriginAsFallback: true,
            matches: [ `*://*.${hostname}/*` ],
            runAt: 'document_start',
            world: 'ISOLATED',
        }).then(handle => {
            registerHandles.isolated = handle;
        });
    }
    if ( mainWorld ) {
        registerHandles.main = browser.contentScripts.register({
            js: [ { code: mainWorld } ],
            matchOriginAsFallback: true,
            matches: [ `*://*.${hostname}/*` ],
            runAt: 'document_start',
            world: 'MAIN',
        });
    }
    registeredScriptlets.add(hostname, registerHandles);
}

async function inject(context, details) {
    return;
    const hostname = hostnameFromURI(details.url);
    const code = registeredScriptlets.lookup(hostname);
    if ( code === undefined ) { return; }
    const key = `${details.tabId}-${details.frameId}`;
    if ( injectedContextSet.has(key) ) {
        return console.info('INJECTED!!!', context, JSON.stringify(details));
    }
    console.info(context, JSON.stringify(details));
    injectedContextSet.add(key);
    try {
        await browser.tabs.executeScript(details.tabId, {
            frameId: details.frameId,
            matchAboutBlank: true,
            runAt: 'document_start',
            code,
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
}

/******************************************************************************/

browser.webNavigation.onCommitted.addListener(details => {
    //inject('ONCOMMITTED', details);
});

browser.webNavigation.onCompleted.addListener(details => {
    if ( details.frameId !== 0 ) { return; }
    //clearInjectedContexts(details.tabId);
});

browser.webNavigation.onErrorOccurred.addListener(details => {
    //clearInjectedContexts(details.tabId, details.frameId);
});

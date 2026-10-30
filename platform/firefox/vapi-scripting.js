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

function uBO_legacyIsolatedWorldWrapper(details) {

    (function earlyBailoutCode(){})();

    (function isolatedCode(){})();

    // Use a page world sentinel to verify that execution was successful
    if ( details.mainCode ) {
        const doc = document;
        const { sentinel } = details;
        let script;
        try {
            const code = [
                `self['${sentinel}'] = true;`,
                details.mainCode,
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
        if ( self.wrappedJSObject[sentinel] ) {
            delete self.wrappedJSObject[sentinel];
            return 0;
        }
        // https://github.com/uBlockOrigin/uBlock-issues/issues/235
        //   Fall back to blob injection if execution through direct
        //   injection failed
        let url;
        try {
            const blob = new self.Blob(
                [ details.mainCode ],
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
    }
    return 0;
}

/******************************************************************************/

function uBO_assembleLegacyCode(details) {
    const { earlyBailoutCode, isolatedCode, mainCode } = details;
    if ( Boolean(isolatedCode) === false ) {
        if ( Boolean(mainCode) === false ) { return; }
    }
    let wrapperCode = uBO_legacyIsolatedWorldWrapper.toString();
    if ( isolatedCode ) {
        const match = /\(function isolatedCode\(\)\{\}\)\(\);/.exec(wrapperCode);
        wrapperCode = wrapperCode.slice(0, match.index) +
            isolatedCode +
            wrapperCode.slice(match.index + match[0].length);
    }
    if ( earlyBailoutCode ) {
        const match = /\(function earlyBailoutCode\(\)\{\}\)\(\);/.exec(wrapperCode);
        wrapperCode = wrapperCode.slice(0, match.index) +
            earlyBailoutCode +
            wrapperCode.slice(match.index + match[0].length);
    }
    return `// ${details.hostname}\n(${wrapperCode})(${JSON.stringify({ sentinel, mainCode })});`;
}

/******************************************************************************/

function uBO_assembleCode(world, contentScriptCode, details) {
    if ( Boolean(contentScriptCode) === false ) { return; }
    const code = [
        `// ${details.hostname}`,
        `(function uBO_${world}WorldWrapper() {`,
    ];
    if ( details.earlyBailoutCode ) {
        code.push(details.earlyBailoutCode);
    }
    code.push(contentScriptCode);
    code.push('})();');
    return code.join('\n');
}

/******************************************************************************/

const CONTENTSCRIPT_DICT_MAX_LOW = 128;
const CONTENTSCRIPT_DICT_MAX_HIGH = CONTENTSCRIPT_DICT_MAX_LOW +
    (CONTENTSCRIPT_DICT_MAX_LOW >>> 3);
const sentinel = self.crypto.randomUUID();
const reIsHTTP = /^https?:\/\//;
const tabDict = new Map();
const contentScriptDict = new Map();
let getContentScripts;

function getEffectiveURL(tabId, frameId) {
    const tabData = tabDict.get(tabId);
    if ( tabData === undefined ) { return; }
    const { frameDict } = tabData;
    let frameData = frameDict.get(frameId);
    for (;;) {
        if ( /^https?:/.test(frameData.url) ) { break; }
        frameId = frameData.parentId;
        if ( frameId === -1 ) { break; }
        frameData = frameDict.get(frameId);
        if ( Boolean(frameData) === false ) { return; }
    }
    return frameData.url;
}

function prepareContentScript(url) {
    const hostname = hostnameFromURI(url);
    const entry = contentScriptDict.get(hostname) ??
        { t: Date.now(), hostname };
    if ( entry.manuallyInjectedCode !== undefined ) { return entry; }
    if ( hostname !== '' ) {
        const result = getContentScripts(url);
        entry.manuallyInjectedCode = uBO_assembleLegacyCode(result) ?? null;
        if ( vAPI.webextFlavor.major >= 128 ) {
            entry.isolatedCode = uBO_assembleCode('isolated', result.isolatedCode, result);
            entry.mainCode = uBO_assembleCode('main', result.mainCode, result);
        }
    } else {
        entry.manuallyInjectedCode = null;
    }
    contentScriptDict.set(hostname, entry);
    return entry;
}

function registerContentScript(entry) {
    if ( entry.registered ) { return; }
    entry.registered = true;
    if ( Boolean(entry.manuallyInjectedCode) === false ) { return; }
    const { hostname } = entry;
    if ( vAPI.webextFlavor.major >= 128 ) {
        if ( entry.isolatedCode ) {
            entry.isolatedHandle = browser.contentScripts.register({
                allFrames: true,
                js: [ { code: entry.isolatedCode } ],
                matchOriginAsFallback: true,
                matches: [ `http://${hostname}/*`, `https://${hostname}/*` ],
                runAt: 'document_start',
                world: 'ISOLATED',
            }).then(handle => {
                entry.isolatedHandle = handle;
            }).catch(( ) => {
                entry.isolatedHandle = null;
            });
            entry.isolatedCode = null;
        }
        if ( entry.mainCode ) {
            entry.mainHandle = browser.contentScripts.register({
                allFrames: true,
                js: [ { code: entry.mainCode } ],
                matchOriginAsFallback: true,
                matches: [ `http://${hostname}/*`, `https://${hostname}/*` ],
                runAt: 'document_start',
                world: 'MAIN',
            }).then(handle => {
                entry.mainHandle = handle;
            }).catch(( ) => {
                entry.mainHandle = null;
            });
            entry.mainCode = null;
        }
    } else if ( entry.manuallyInjectedCode ) {
        entry.isolatedHandle = browser.contentScripts.register({
            allFrames: true,
            js: [ { code: entry.manuallyInjectedCode } ],
            matchAboutBlank: true,
            matches: [ `http://${hostname}/*`, `https://${hostname}/*` ],
            runAt: 'document_start',
        }).then(handle => {
            entry.isolatedHandle = handle;
        }).catch(( ) => {
            entry.isolatedHandle = null;
        });
    }
    entry.manuallyInjectedCode = null;
}

function unregisterContentScript(hostname) {
    const entry = contentScriptDict.get(hostname);
    if ( entry === undefined ) { return; }
    contentScriptDict.delete(hostname);
    if ( entry.mainHandle ) {
        if ( entry.mainHandle instanceof Promise ) {
            entry.mainHandle.then(( ) => entry.mainHandle?.unregister());
        } else {
            entry.mainHandle.unregister();
        }
    }
    if ( entry.isolatedHandle ) {
        if ( entry.isolatedHandle instanceof Promise ) {
            entry.isolatedHandle.then(( ) => entry.isolatedHandle?.unregister());
        } else {
            entry.isolatedHandle.unregister();
        }
    }
}

function manuallyInject(tabId, frameId, entry) {
    if ( Boolean(entry.manuallyInjectedCode) === false ) { return; }
    return browser.tabs.executeScript(tabId, {
        frameId,
        matchAboutBlank: true,
        runAt: 'document_start',
        code: entry.manuallyInjectedCode,
    });
}

function onCreatedNavigationTarget(details) {
    onBeforeNavigate({
        tabId: details.tabId,
        frameId: 0,
        parentFrameId: -1,
        url: details.url,
    });
}

function onBeforeNavigate(details) {
    const { tabId } = details;
    if ( tabId < 0 ) { return; }
    const tabData = tabDict.get(tabId) ?? { tabId };
    if ( tabData.frameDict === undefined ) {
        tabData.frameDict = new Map();
        tabDict.set(tabId, tabData);
    }
    const { frameDict } = tabData;
    let { frameId, url } = details;
    if ( frameId === 0 ) {
        frameDict.clear();
    }
    frameDict.set(frameId, { frameId, parentId: details.parentFrameId, url });
    // Every 64 frames, we rebuild to ensure no unbound growth as there is no
    // API for removed frames
    // TODO: spin off frames management to be reused across all of uBO
    if ( (frameDict.size & 0b111111) === 0 ) {
        const key = self.crypto.randomUUID();
        tabData.gettingFrames = key;
        browser.webNavigation.getAllFrames({ tabId }).then(frames => {
            if ( tabData.gettingFrames !== key ) { return; }
            if ( tabDict.has(tabId) === false ) { return; }
            frameDict.clear();
            for ( const { frameId, parentFrameId, url } of frames ) {
                frameDict.set(frameId, { frameId, parentId: parentFrameId, url });
            }
        });
    }
    if ( frameId !== 0 && url.startsWith('about:') ) {
        url = getEffectiveURL(tabId, frameId);
        if ( url === undefined ) { return; }
    }
    if ( reIsHTTP.test(url) === false ) { return; }
    prepareContentScript(url);
}

function onCommitted(details) {
    const { tabId } = details;
    if ( tabId < 0 ) { return; }
    let { frameId, url } = details;
    if ( frameId !== 0 && url.startsWith('about:') ) {
        url = getEffectiveURL(tabId, frameId);
        if ( url === undefined ) { return; }
    }
    if ( reIsHTTP.test(url) === false ) { return; }
    const hostname = hostnameFromURI(url);
    if ( hostname === '' ) { return; }
    const entry = contentScriptDict.get(hostname) ?? prepareContentScript(url);
    if ( entry.registered !== true ) {
        manuallyInject(tabId, frameId, entry);
        registerContentScript(entry);
    }
    entry.t = Date.now();
    if ( contentScriptDict.size <= CONTENTSCRIPT_DICT_MAX_HIGH ) { return; }
    const sortedKeys = Array.from(contentScriptDict.keys()).toSorted((a, b) =>
        contentScriptDict.get(a).t - contentScriptDict.get(b).t
    ).slice(0, -CONTENTSCRIPT_DICT_MAX_LOW);
    for ( const key of sortedKeys ) {
        unregisterContentScript(key);
    }
}

function onTabRemoved(tabId) {
    tabDict.delete(tabId);
}

/******************************************************************************/

export async function start(fn) {
    const initialized = Boolean(getContentScripts);
    getContentScripts = fn;
    if ( initialized ) { return; }
    const tabs = await browser.tabs.query({ url: [ 'http://*/*', 'https://*/*' ] });
    for ( const tab of tabs ) {
        if ( tab.discarded ) { continue; }
        if ( tab.status === 'unloaded' ) { continue; }
        const entry = prepareContentScript(tab.url)
        registerContentScript(entry);
    }
    browser.webNavigation.onCreatedNavigationTarget.addListener(onCreatedNavigationTarget);
    browser.webNavigation.onBeforeNavigate.addListener(onBeforeNavigate);
    browser.webNavigation.onCommitted.addListener(onCommitted);
    browser.tabs.onRemoved.addListener(onTabRemoved);
}

export function reset() {
    for ( const hostname of contentScriptDict.keys() ) {
        unregisterContentScript(hostname);
    }
}

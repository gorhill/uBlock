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
import webext from './webext.js';

/******************************************************************************/

function uBO_isolatedCode(mainCode) {
    if ( self.vapiScripting ) { return 0; }
    self.vapiScripting = true;

    (function isolatedCode(){})();

    if ( mainCode ) {
        let script;
        try {
            const doc = document;
            script = doc.createElement('script');
            script.appendChild(doc.createTextNode(mainCode));
            (doc.head || doc.documentElement).appendChild(script);
        } catch {
        }
        if ( script ) {
            script.remove();
            script.textContent = '';
        }
    }

    return 0;
}

function uBO_assembleIsolatedCode(details) {
    const { isolatedCode = '', mainCode = '' } = details;
    if ( Boolean(isolatedCode) === false ) {
        if ( Boolean(mainCode) === false ) { return; }
    }
    let code = [ '(function uBO_isolatedWorldWrapper() {' ];
    if ( details.earlyBailoutCode ) {
        code.push(details.earlyBailoutCode);
    }
    code.push(`(${uBO_isolatedCode.toString()})(`, JSON.stringify(mainCode), `);`);
    code.push('})();');
    code = code.join('\n');
    const match = /\(function isolatedCode\(\)\{\}\)\(\);/.exec(code);
    return code.slice(0, match.index) +
        isolatedCode +
        code.slice(match.index + match[0].length);
}

/******************************************************************************/

const CONTENTSCRIPT_DICT_MAX_LOW = 128;
const CONTENTSCRIPT_DICT_MAX_HIGH = CONTENTSCRIPT_DICT_MAX_LOW +
    (CONTENTSCRIPT_DICT_MAX_LOW >>> 3);
const tabDict = new Map();
const contentScriptDict = new Map();

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
    let frameData = { frameId, parentId: details.parentFrameId, url };
    frameDict.set(frameId, frameData);
    if ( frameId !== 0 && url.startsWith('about:') ) {
        url = getEffectiveURL(tabId, frameId);
        if ( url === undefined ) { return; }
    }
    const hostname = hostnameFromURI(url);
    if ( hostname === '' ) { return; }
    if ( contentScriptDict.has(hostname) ) { return; }
    const result = onGetContentScripts.fn(url);
    const code = uBO_assembleIsolatedCode(result) ?? null;
    contentScriptDict.set(hostname, { code, t: Date.now() });
}

function onCommitted(details) {
    const { tabId, frameId } = details;
    if ( tabId < 0 ) { return; }
    let { url } = details;
    if ( frameId !== 0 && url.startsWith('about:') ) {
        url = getEffectiveURL(tabId, frameId);
        if ( url === undefined ) { return; }
    }
    const hostname = hostnameFromURI(url);
    if ( hostname === '' ) { return; }
    const entry = contentScriptDict.get(hostname);
    if ( Boolean(entry?.code) === false ) { return; }
    webext.tabs.executeScript(tabId, {
        frameId,
        matchAboutBlank: true,
        runAt: 'document_start',
        code: entry.code,
    });
    entry.t = Date.now();
    if ( contentScriptDict.size <= CONTENTSCRIPT_DICT_MAX_HIGH ) { return; }
    const sortedKeys = Array.from(contentScriptDict.keys()).toSorted((a, b) =>
        contentScriptDict.get(a).t - contentScriptDict.get(b).t
    ).slice(0, -CONTENTSCRIPT_DICT_MAX_LOW);
    for ( const key of sortedKeys ) {
        contentScriptDict.delete(key);
    }
}

function onTabRemoved(tabId) {
    tabDict.delete(tabId);
}

/******************************************************************************/

export function onGetContentScripts(fn) {
    const initialized = Boolean(onGetContentScripts.fn);
    onGetContentScripts.fn = fn;
    if ( initialized ) { return; }
    browser.webNavigation.onBeforeNavigate.addListener(onBeforeNavigate);
    browser.webNavigation.onCommitted.addListener(onCommitted);
    browser.tabs.onRemoved.addListener(onTabRemoved);
}

export function reset() {
    contentScriptDict.clear();
}

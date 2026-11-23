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

import * as frameManager from './vapi-contexts.js';
import { hostnameFromURI } from './uri-utils.js';
import webext from './webext.js';

/******************************************************************************/

function uBO_isolatedCode(mainCode) {
    if ( self.vapiScripting ) { return 0; }
    self.vapiScripting = true;

    (function isolatedCode(){})();

    if ( mainCode ) {
        const doc = document;
        const container = doc.createElement('div');
        const shadowRoot = container.attachShadow({ mode: 'closed' });
        try {
            const script = doc.createElement('script');
            script.appendChild(doc.createTextNode(mainCode));
            shadowRoot.append(script);
            (doc.head || doc.documentElement).appendChild(container);
        } catch {
        }
        container.remove();
    }

    return 0;
}

function uBO_assembleIsolatedCode(details) {
    const { isolatedCode = '', mainCode = '' } = details;
    if ( Boolean(isolatedCode) === false ) {
        if ( Boolean(mainCode) === false ) { return; }
    }
    let code = [
        `// ${details.hostname}`,
        '(function uBO_isolatedWorldWrapper() {',
    ];
    if ( details.earlyBailoutCode ) {
        code.push(details.earlyBailoutCode);
    }
    code.push(
        `(${uBO_isolatedCode.toString()})(`,
        JSON.stringify(`// ${details.hostname}\n${mainCode}`),
        `);`
    );
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
const contentScriptDict = new Map();
let getContentScripts;

function registerContentScript(url) {
    const hostname = hostnameFromURI(url);
    if ( hostname === '' ) { return; }
    const entry = contentScriptDict.get(hostname) ??
        { t: Date.now() };
    if ( entry.code !== undefined ) { return entry; }
    const result = getContentScripts(url);
    entry.code = uBO_assembleIsolatedCode(result) ?? null;
    contentScriptDict.set(hostname, entry);
    return entry;
}

function onCommitted(details) {
    const { tabId, frameId } = details;
    let { url } = details;
    if ( frameId !== 0 && frameManager.isHTTP(url) === false ) {
        url = frameManager.getEffectiveURL(tabId, frameId);
        if ( url === undefined ) { return; }
    }
    if ( frameManager.isHTTP(url) === false ) { return; }
    const hostname = hostnameFromURI(url);
    if ( hostname === '' ) { return; }
    const entry = contentScriptDict.get(hostname) ??
        registerContentScript(url);
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

/******************************************************************************/

export async function start(fn) {
    const initialized = Boolean(getContentScripts);
    getContentScripts = fn;
    if ( initialized ) { return; }
    frameManager.addListener((type, details) => {
        if ( type !== 'frame-committed' ) { return; }
        onCommitted(details);
    });
}

export function reset() {
    contentScriptDict.clear();
}

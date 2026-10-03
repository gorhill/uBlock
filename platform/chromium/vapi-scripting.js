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

let contentScriptCode;

let onceFn = async ( ) => {
    if ( Boolean(contentScriptCode) === false ) { return; }
    const tabs = await vAPI.tabs.query({ url: '<all_urls>' });
    for ( const tab of tabs  ) {
        if ( tab.discarded === true ) { continue; }
        if ( tab.status === 'unloaded' ) { continue; }
        browser.tabs.executeScript(tab.id, {
            allFrames: true,
            matchAboutBlank: true,
            runAt: 'document_start',
            code: contentScriptCode,
        }).catch(( ) => {
        });
    }
};

export function registerContentScripts(details) {
    contentScriptCode = uBO_assembleIsolatedCode(details);
    if ( onceFn === undefined ) { return; }
    onceFn();
    onceFn = undefined;
}

export function unregisterContentScripts() {
    contentScriptCode = undefined;
}

/******************************************************************************/

browser.webNavigation.onCommitted.addListener(details => {
    if ( /^https?:|^about:/.test(details.url) === false ) { return; }
    if ( Boolean(contentScriptCode) === false ) { return; }
    browser.tabs.executeScript(details.tabId, {
        frameId: details.frameId,
        matchAboutBlank: true,
        runAt: 'document_start',
        code: contentScriptCode,
    }).catch(( ) => {
    });
});

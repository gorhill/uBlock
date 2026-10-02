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
    let code = [ '(function isolatedWorldWrapper() {' ];
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

export function registerContentScripts(details) {
    registerContentScripts.code = uBO_assembleIsolatedCode(details);
}

export function unregisterContentScripts() {
    registerContentScripts.code = undefined;
}

export function injectNow(/*details*/) {
    /*if ( Boolean(registerContentScripts.code) === false ) { return; }
    browser.tabs.executeScript(details.tabId, {
        frameId: details.frameId,
        matchAboutBlank: true,
        runAt: 'document_start',
        code: registerContentScripts.code,
    });*/
}

/******************************************************************************/

browser.webNavigation.onCommitted.addListener(details => {
    if ( Boolean(registerContentScripts.code) === false ) { return; }
    if ( /^https?:\/\//.test(details.url) === false ) { return; }
    browser.tabs.executeScript(details.tabId, {
        frameId: details.frameId,
        allFrames: true,
        matchAboutBlank: true,
        runAt: 'document_start',
        code: registerContentScripts.code,
    });
});

//browser.webNavigation.onCompleted.addListener(( ) => { });

//browser.webNavigation.onErrorOccurred.addListener(( ) => { });

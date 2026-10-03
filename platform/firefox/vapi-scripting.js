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

function uBO_assembleCode(world, contentScriptCode, details) {
    if ( Boolean(contentScriptCode) === false ) { return; }
    const code = [ `(function uBO_${world}WorldWrapper() {` ];
    if ( details.earlyBailoutCode ) {
        code.push(details.earlyBailoutCode);
    }
    code.push(contentScriptCode);
    code.push('})();');
    return code.join('\n');
}

/******************************************************************************/

export function registerContentScripts(details) {
    unregisterContentScripts();
    const isolatedCode = uBO_assembleCode('isolated', details.isolatedCode, details);
    if ( isolatedCode ) {
        registerContentScripts.isolatedHandle = browser.contentScripts.register({
            allFrames: true,
            js: [ { code: isolatedCode } ],
            matchAboutBlank: true,
            matches: [ 'http://*/*', 'https://*/*' ],
            runAt: 'document_start',
            world: 'ISOLATED',
        }).catch(( ) => {
            registerContentScripts.isolatedHandle = undefined;
        });
    }
    const mainCode = uBO_assembleCode('main', details.mainCode, details);
    if ( mainCode ) {
        registerContentScripts.mainHandle = browser.contentScripts.register({
            allFrames: true,
            js: [ { code: mainCode } ],
            matchAboutBlank: true,
            matches: [ 'http://*/*', 'https://*/*' ],
            runAt: 'document_start',
            world: 'MAIN',
        }).catch(( ) => {
            registerContentScripts.mainHandle = undefined;
        });
    }
}

export function unregisterContentScripts() {
    if ( registerContentScripts.isolatedHandle ) {
        registerContentScripts.isolatedHandle.then(handle => {
            if ( Boolean(handle) === false ) { return; }
            handle.unregister();
        });
        registerContentScripts.isolatedHandle = undefined;
    }
    if ( registerContentScripts.mainHandle ) {
        registerContentScripts.mainHandle.then(handle => {
            if ( Boolean(handle) === false ) { return; }
            handle.unregister();
        });
        registerContentScripts.mainHandle = undefined;
    }
}

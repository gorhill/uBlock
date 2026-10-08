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

function uBO_legacyIsolatedWorldWrapper(details) {

    (function earlyBailoutCode(){})();

    (function isolatedCode(){})();

    // Use a page world sentinel to verify that execution was
    // successful
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
    return `(${wrapperCode})(${JSON.stringify({ sentinel: vAPI.generateSecret(3), mainCode })});`;
}

/******************************************************************************/

function registerLegacyContentScripts(details) {
    const isolatedCode = uBO_assembleLegacyCode(details);
    if ( Boolean(isolatedCode) === false ) { return; }
    registerContentScripts.isolatedHandle = browser.contentScripts.register({
        allFrames: true,
        js: [ { code: isolatedCode } ],
        matchAboutBlank: true,
        matches: [ 'http://*/*', 'https://*/*' ],
        runAt: 'document_start',
    }).catch(( ) => {
        registerContentScripts.isolatedHandle = undefined;
    });
}

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
    if ( vAPI.webextFlavor.major < 128 ) {
        return registerLegacyContentScripts(details);
    }
    const isolatedCode = uBO_assembleCode('isolated', details.isolatedCode, details);
    if ( isolatedCode ) {
        registerContentScripts.isolatedHandle = browser.contentScripts.register({
            allFrames: true,
            js: [ { code: isolatedCode } ],
            matchOriginAsFallback: true,
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
            matchOriginAsFallback: true,
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

/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2019-present Raymond Hill

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

// Important!
// Isolate from global scope
(function uBOL_cssSpecific() {

/******************************************************************************/

const specificImports = self.specificImports || [];
self.specificImports = undefined;
delete self.specificImports;

/******************************************************************************/

const hnParts = [];
try { hnParts.push(...document.location.hostname.split('.')); }
catch { }
const hnpartslen = hnParts.length;
if ( hnpartslen === 0 ) { return; }

const selectors = [];

for ( const { argsList, exceptionsMap, hostnamesMap, entitiesMap } of specificImports ) {
    const todoIndices = new Set();
    const tonotdoIndices = [];
    // Exceptions
    if ( exceptionsMap.size !== 0 ) {
        for ( let i = 0; i < hnpartslen; i++ ) {
            const hn = hnParts.slice(i).join('.');
            const excepted = exceptionsMap.get(hn);
            if ( excepted ) { tonotdoIndices.push(...excepted); }
        }
        exceptionsMap.clear();
    }
    // Hostname-based
    if ( hostnamesMap.size !== 0 ) {
        const collectArgIndices = hn => {
            let argsIndices = hostnamesMap.get(hn);
            if ( argsIndices === undefined ) { return; }
            if ( typeof argsIndices === 'number' ) { argsIndices = [ argsIndices ]; }
            for ( const argsIndex of argsIndices ) {
                if ( tonotdoIndices.includes(argsIndex) ) { continue; }
                todoIndices.add(argsIndex);
            }
        };
        for ( let i = 0; i < hnpartslen; i++ ) {
            const hn = hnParts.slice(i).join('.');
            collectArgIndices(hn);
        }
        collectArgIndices('*');
        hostnamesMap.clear();
    }
    // Entity-based
    if ( entitiesMap.size !== 0 ) {
        const n = hnpartslen - 1;
        for ( let i = 0; i < n; i++ ) {
            for ( let j = n; j > i; j-- ) {
                const en = hnParts.slice(i,j).join('.');
                let argsIndices = entitiesMap.get(en);
                if ( argsIndices === undefined ) { continue; }
                if ( typeof argsIndices === 'number' ) { argsIndices = [ argsIndices ]; }
                for ( const argsIndex of argsIndices ) {
                    if ( tonotdoIndices.includes(argsIndex) ) { continue; }
                    todoIndices.add(argsIndex);
                }
            }
        }
        entitiesMap.clear();
    }
    for ( const i of todoIndices ) {
        selectors.push(argsList[i]);
    }
    argsList.length = 0;
}
specificImports.length = 0;

if ( selectors.length === 0 ) { return; }

/******************************************************************************/

(function uBOL_injectCSS(css, count = 10) {
    chrome.runtime.sendMessage({ what: 'insertCSS', css }).catch(( ) => {
        count -= 1;
        if ( count === 0 ) { return; }
        uBOL_injectCSS(css, count - 1);
    });
})(`${selectors.join(',')}{display:none!important;}`);

/******************************************************************************/

})();

/******************************************************************************/

void 0;

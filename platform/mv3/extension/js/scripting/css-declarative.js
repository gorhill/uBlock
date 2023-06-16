/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-present Raymond Hill

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

/* jshint esversion:11 */

'use strict';

/******************************************************************************/

// Important!
// Isolate from global scope
(function uBOL_cssDeclarative() {

/******************************************************************************/

const declarativeImports = self.declarativeImports || [];
self.declarativeImports = undefined;
delete self.declarativeImports;

/******************************************************************************/

const hnParts = [];
try { hnParts.push(...document.location.hostname.split('.')); }
catch(ex) { }
const hnpartslen = hnParts.length;
if ( hnpartslen === 0 ) { return; }

const selectors = [];

for ( const { argsList, exceptionsMap, hostnamesMap, entitiesMap } of declarativeImports ) {
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
        selectors.push(...argsList[i].map(json => JSON.parse(json)));
    }
    argsList.length = 0;
}
declarativeImports.length = 0;

if ( selectors.length === 0 ) { return; }

/******************************************************************************/

const cssRuleFromProcedural = details => {
    const { tasks, action } = details;
    let mq, selector;
    if ( Array.isArray(tasks) ) {
        if ( tasks[0][0] !== 'matches-media' ) { return; }
        mq = tasks[0][1];
        if ( tasks.length > 2 ) { return; }
        if ( tasks.length === 2 ) {
            if ( tasks[1][0] !== 'spath' ) { return; }
            selector = tasks[1][1];
        }
    }
    let style;
    if ( Array.isArray(action) ) {
        if ( action[0] !== 'style' ) { return; }
        selector = selector || details.selector;
        style = action[1];
    }
    if ( mq === undefined && style === undefined && selector === undefined ) { return; }
    if ( mq === undefined ) {
        return `${selector}\n{${style}}`;
    }
    if ( style === undefined ) {
        return `@media ${mq} {\n${selector}\n{display:none!important;}\n}`;
    }
    return `@media ${mq} {\n${selector}\n{${style}}\n}`;
};

const sheetText = [];
for ( const selector of selectors ) {
    const ruleText = cssRuleFromProcedural(selector);
    if ( ruleText === undefined ) { continue; }
    sheetText.push(ruleText);
}

if ( sheetText.length === 0 ) { return; }

(function uBOL_injectCSS(css, count = 10) {
    chrome.runtime.sendMessage({ what: 'insertCSS', css }).catch(( ) => {
        count -= 1;
        if ( count === 0 ) { return; }
        uBOL_injectCSS(css, count - 1);
    });
})(sheetText.join('\n'));

/******************************************************************************/

})();

/******************************************************************************/

void 0;

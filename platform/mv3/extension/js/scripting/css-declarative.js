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
delete self.declarativeImports;

const lookupSelectors = (hn, out) => {
    for ( const { argsList, hostnamesMap } of declarativeImports ) {
        let argsIndices = hostnamesMap.get(hn);
        if ( argsIndices === undefined ) { continue; }
        if ( typeof argsIndices === 'number' ) { argsIndices = [ argsIndices ]; }
        for ( const argsIndex of argsIndices ) {
            const details = argsList[argsIndex];
            if ( details.n && details.n.includes(hn) ) { continue; }
            out.push(...details.a.map(json => JSON.parse(json)));
        }
    }
};

let hn;
try { hn = document.location.hostname; } catch(ex) { }
const selectors = [];
while ( hn ) {
    lookupSelectors(hn, selectors);
    if ( hn === '*' ) { break; }
    const pos = hn.indexOf('.');
    if ( pos !== -1 ) {
        hn = hn.slice(pos + 1);
    } else {
        hn = '*';
    }
}

declarativeImports.length = 0;

/******************************************************************************/

if ( selectors.length === 0 ) { return; }

const cssRuleFromProcedural = details => {
    const { tasks, action } = details;
    let mq;
    if ( tasks !== undefined ) {
        if ( tasks.length > 1 ) { return; }
        if ( tasks[0][0] !== 'matches-media' ) { return; }
        mq = tasks[0][1];
    }
    let style;
    if ( Array.isArray(action) ) {
        if ( action[0] !== 'style' ) { return; }
        style = action[1];
    }
    if ( mq === undefined && style === undefined ) { return; }
    if ( mq === undefined ) {
        return `${details.selector}\n{${style}}`;
    }
    if ( style === undefined ) {
        return `@media ${mq} {\n${details.selector}\n{display:none!important;}\n}`;
    }
    return `@media ${mq} {\n${details.selector}\n{${style}}\n}`;
};

const sheetText = [];
for ( const selector of selectors ) {
    const ruleText = cssRuleFromProcedural(selector);
    if ( ruleText === undefined ) { continue; }
    sheetText.push(ruleText);
}

if ( sheetText.length === 0 ) { return; }

try {
    const sheet = new CSSStyleSheet();
    sheet.replace(`@layer{${sheetText.join('\n')}}`);
    document.adoptedStyleSheets = [
        ...document.adoptedStyleSheets,
        sheet
    ];
} catch(ex) {
}

/******************************************************************************/

})();

/******************************************************************************/

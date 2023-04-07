/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
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

/* jshint esversion:11 */

'use strict';

/******************************************************************************/

// Important!
// Isolate from global scope
(function uBOL_cssSpecificEntity() {

/******************************************************************************/

// $rulesetId$

const specificEntityImports = self.specificEntityImports || [];
delete self.specificEntityImports;

/******************************************************************************/

const lookupSelectors = (hn, entity, out) => {
    for ( const { argsList, entitiesMap } of specificEntityImports ) {
        let argsIndices = entitiesMap.get(entity);
        if ( argsIndices === undefined ) { continue; }
        if ( typeof argsIndices === 'number' ) { argsIndices = [ argsIndices ]; }
        for ( const argsIndex of argsIndices ) {
            const details = argsList[argsIndex];
            if ( details.n && details.n.includes(hn) ) { continue; }
            out.push(details.a);
        }
    }
};

let hn = '';
try { hn = document.location.hostname; } catch(ex) { }
const selectors = [];
const hnparts = hn.split('.');
const hnpartslen = hnparts.length - 1;
for ( let i = 0; i < hnpartslen; i++ ) {
    for ( let j = hnpartslen; j > i; j-- ) {
        lookupSelectors(
            hnparts.slice(i).join('.'),
            hnparts.slice(i,j).join('.'),
            selectors
        );
    }
}

if ( selectors.length === 0 ) { return; }

try {
    const sheet = new CSSStyleSheet();
    sheet.replace(`@layer{${selectors.join(',')}{display:none!important;}}`);
    document.adoptedStyleSheets = [
        ...document.adoptedStyleSheets,
        sheet
    ];
} catch(ex) {
}

/******************************************************************************/

})();

/******************************************************************************/

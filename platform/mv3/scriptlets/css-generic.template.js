/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
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

// $rulesetId$

// Important!
// Isolate from global scope
(function uBOL_cssGenericImport() {

/******************************************************************************/

const selectorsToImport = self.$genericSelectorMap$;
const exceptionsToImport = self.$genericExceptionMap$;

if ( selectorsToImport ) {
    const map = self.genericSelectorMap =
        self.genericSelectorMap || new Map();

    if ( map.size !== 0 ) {
        for ( const entry of selectorsToImport ) {
            const before = map.get(entry[0]);
            map.set(entry[0],
                before === undefined ? entry[1] : `${before},${entry[1]}`
            );
        }
    } else {
        self.genericSelectorMap = new Map(selectorsToImport);
    }
    selectorsToImport.length = 0;
}

if ( exceptionsToImport ) {
    const map = self.genericExceptionMap =
        self.genericExceptionMap || new Map();

    if ( map.size !== 0 ) {
        for ( const entry of exceptionsToImport ) {
            map.set(entry[0], `${map.get(entry[0]) || ''}${entry[1]}`);
        }
    } else {
        self.genericExceptionMap = new Map(exceptionsToImport);
    }
    exceptionsToImport.length = 0;
}

/******************************************************************************/

})();

/******************************************************************************/

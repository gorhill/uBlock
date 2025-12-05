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

/******************************************************************************/

const isolatedAPI = self.isolatedAPI;
const selectors = new Set();
const exceptions = new Set();

const lookupHostname = (hostname, details) => {
    const listref = isolatedAPI.binarySearch(details.hostnames, hostname);
    if ( listref === -1 ) { return; }
    if ( Array.isArray(details.selectorLists) === false ) {
        details.selectorLists = details.selectorLists.split(';');
        details.selectorListRefs = JSON.parse(`[${details.selectorListRefs}]`);
    }
    const ilist = details.selectorListRefs[listref];
    const list = JSON.parse(`[${details.selectorLists[ilist]}]`);
    for ( const iselector of list ) {
        if ( iselector >= 0 ) {
            selectors.add(details.selectors[iselector]);
        } else {
            exceptions.add(details.selectors[~iselector]);
        }
    }
};

const lookupAll = hostname => {
    for ( const details of specificImports ) {
        lookupHostname(hostname, details);
    }
};

isolatedAPI.forEachHostname(lookupAll, {
    hasEntities: specificImports.some(a => a.hasEntities)
});

specificImports.length = 0;

for ( const selector of exceptions ) {
    selectors.delete(selector);
}

if ( selectors.size === 0 ) { return; }

const css = `${Array.from(selectors).join(',\n')}{display:none!important;}`;
self.cssAPI.insert(css);

/******************************************************************************/

})();

void 0;

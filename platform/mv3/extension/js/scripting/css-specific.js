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

const selectors = [];
const exceptions = [];

const lookupHostname = (hostname, details, out) => {
    let seqi = details.hostnamesMap.get(hostname);
    if ( seqi === undefined ) { return; }
    const { argsList, argsSeqs } = details;
    for (;;) {
        const argi = argsSeqs[seqi++];
        const done = argi > 0;
        out.push(...argsList[done ? argi : -argi].split('\n'));
        if ( done ) { break; }
    }
};

const lookupAll = hostname => {
    for ( const details of specificImports ) {
        lookupHostname(hostname, details, selectors);
        lookupHostname(`~${hostname}`, details, exceptions);
    }
};

self.isolatedAPI.forEachHostname(lookupAll, {
    hasEntities: specificImports.some(a => a.hasEntities)
});

specificImports.length = 0;

if ( selectors.length === 0 ) { return; }

const exceptedSelectors = exceptions.length !== 0
    ? selectors.filter(a => exceptions.includes(a) === false)
    : selectors;
if ( exceptedSelectors.length === 0 ) { return; }

self.cssAPI.insert(`${exceptedSelectors.join(',')}{display:none!important;}`);

/******************************************************************************/

})();

void 0;

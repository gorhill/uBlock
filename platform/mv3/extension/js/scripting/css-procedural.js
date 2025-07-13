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

// Important!
// Isolate from global scope
(async function uBOL_cssProcedural() {

/******************************************************************************/

const proceduralImports = self.proceduralImports || [];
self.proceduralImports = undefined;

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
        out.push(...argsList[done ? argi : -argi]);
        if ( done ) { break; }
    }
};

const lookupAll = hostname => {
    for ( const details of proceduralImports ) {
        lookupHostname(hostname, details, selectors);
        lookupHostname(`~${hostname}`, details, exceptions);
    }
};

self.isolatedAPI.forEachHostname(lookupAll, {
    hasEntities: proceduralImports.some(a => a.hasEntities)
});

proceduralImports.length = 0;

const exceptedSelectors = exceptions.length !== 0
    ? selectors.filter(a => exceptions.includes(a) === false)
    : selectors;
if ( exceptedSelectors.length === 0 ) { return; }

if ( self.cssProceduralAPI === undefined ) {
    self.cssProceduralAPI = chrome.runtime.sendMessage({
        what: 'injectCSSProceduralAPI'
    }).catch(( ) => {
    });
}
if ( self.cssProceduralAPI instanceof Promise ) {
    await self.cssProceduralAPI;
}
if ( self.cssProceduralAPI instanceof Object === false ) { return; }

self.cssProceduralAPI.addSelectors(exceptedSelectors);

/******************************************************************************/

})();

/******************************************************************************/

void 0;

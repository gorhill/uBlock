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

(async function uBOL_cssUser() {

/******************************************************************************/

const docURL = new URL(document.baseURI);
const details = await chrome.runtime.sendMessage({
    what: 'injectCustomFilters',
    hostname: docURL.hostname,
}).catch(( ) => {
});

self.customFilters = details;

if ( Boolean(details?.proceduralSelectors?.length) === false ) { return; }

if ( self.ProceduralFiltererAPI === undefined ) {
    self.ProceduralFiltererAPI = chrome.runtime.sendMessage({
        what: 'injectCSSProceduralAPI'
    }).catch(( ) => {
    });
}

await self.ProceduralFiltererAPI;

self.customProceduralFiltererAPI = new self.ProceduralFiltererAPI();

const selectors = details.proceduralSelectors.map(a => JSON.parse(a));

const declaratives = selectors.filter(a => a.cssable);
if ( declaratives.length !== 0 ) {
    self.customProceduralFiltererAPI.addDeclaratives(declaratives);
}

const procedurals = selectors.filter(a => !a.cssable);
if ( procedurals.length !== 0 ) {
    self.customProceduralFiltererAPI.addProcedurals(procedurals);
}

/******************************************************************************/

})();

void 0;

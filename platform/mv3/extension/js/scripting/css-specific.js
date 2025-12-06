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
(async function uBOL_cssSpecific() {

/******************************************************************************/

const specificImports = self.specificImports || [];
self.specificImports = undefined;

/******************************************************************************/

const isolatedAPI = self.isolatedAPI;

const selectors = [];

self.cssAPI.update('*{visibility:hidden!important;}');

const cachedCSS = await isolatedAPI.sessionGet('css.specific.cache') || {};
if ( cachedCSS[isolatedAPI.docHostname] ) {
    selectors.push(...cachedCSS[isolatedAPI.docHostname]);
} else {
    selectors.push(...await isolatedAPI.getSelectors('specific', specificImports));
    cachedCSS[isolatedAPI.docHostname] = selectors;
    isolatedAPI.sessionSet('css.specific.cache', cachedCSS);
}
const insert = selectors.length !== 0
    ? `${Array.from(selectors).join(',\n')}{display:none!important;}`
    : undefined;
self.cssAPI.update(insert, '*{visibility:hidden!important;}');

/******************************************************************************/

})();

void 0;

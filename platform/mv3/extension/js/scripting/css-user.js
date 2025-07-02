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

const storageKeys = [];
const promises = [];

self.isolatedAPI.forEachHostname(hn => {
    const key = `site.${hn}`;
    storageKeys.push(key);
    promises.push(chrome.storage.local.get(key));
});

const results = await Promise.all(promises);
const selectors = [];
for ( let i = 0; i < storageKeys.length; i++ ) {
    const filters = results[i]?.[storageKeys[i]];
    if ( filters === undefined ) { continue; }
    selectors.push(filters.map(a => a.slice(1)).join(',\n'));
}
if ( selectors.length === 0 ) { return; }

chrome.runtime.sendMessage({
    what: 'insertCSS',
    css: `${selectors.join(',\n')}{display:none!important;}`,
}).catch(( ) => {
});

/******************************************************************************/

})();

void 0;

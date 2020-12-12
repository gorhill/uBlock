/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2020-present Raymond Hill

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

'use strict';

/******************************************************************************/

(( ) => {
    if ( typeof vAPI !== 'object' ) { return; }

    if ( vAPI.load3rdPartyCSS ) { return; }
    vAPI.load3rdPartyCSS = true;

    const links = document.querySelectorAll('link[rel="stylesheet"]');
    if ( links.length === 0 ) { return; }

    const toLoadMaybe = new Map(Array.from(links).map(a => [ a.href, a ]));

    for ( const sheet of Array.from(document.styleSheets) ) {
        let loaded = false;
        try {
            loaded = sheet.rules.length !== 0;
        } catch(ex) {
        }
        if ( loaded ) { continue; }
        const link = toLoadMaybe.get(sheet.href);
        if ( link === undefined ) { continue; }
        toLoadMaybe.delete(sheet.href);
        const clone = link.cloneNode(true);
        link.replaceWith(clone);
    }
})();








/*******************************************************************************

    DO NOT:
    - Remove the following code
    - Add code beyond the following code
    Reason:
    - https://github.com/gorhill/uBlock/pull/3721
    - uBO never uses the return value from injected content scripts

**/

void 0;

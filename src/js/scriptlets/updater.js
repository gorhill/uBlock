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

/* global HTMLDocument */

'use strict';

/******************************************************************************/

// Injected into specific webpages, those which have been pre-selected
// because they are known to contain:
// https://ublockorigin.github.io/uAssets/update-lists?listkeys=[...]

/******************************************************************************/

(( ) => {
// >>>>> start of local scope

/******************************************************************************/

if ( document instanceof HTMLDocument === false ) { return; }

// Maybe uBO has gone away meanwhile.
if ( typeof vAPI !== 'object' || vAPI === null ) { return; }

function updateStockLists(target) {
    if ( vAPI instanceof Object === false ) {
        document.removeEventListener('click', updateStockLists);
        return;
    }
    try {
        const updateURL = new URL(target.href);
        if ( updateURL.hostname !== 'ublockorigin.github.io') { return; }
        if ( updateURL.pathname !== '/uAssets/update-lists.html') { return; }
        const listkeys = updateURL.searchParams.get('listkeys') || '';
        if ( listkeys === '' ) { return true; }
        vAPI.messaging.send('scriptlets', {
            what: 'updateLists',
            listkeys,
            manual: updateURL.searchParams.get('manual') && true || false,
        });
        return true;
    } catch (_) {
    }
}

// https://github.com/easylist/EasyListHebrew/issues/89
//   Ensure trusted events only.

document.addEventListener('click', ev => {
    if ( ev.button !== 0 || ev.isTrusted === false ) { return; }
    const target = ev.target.closest('a');
    if ( target instanceof HTMLAnchorElement === false ) { return; }
    if ( updateStockLists(target) === true ) {
        ev.stopPropagation();
        ev.preventDefault();
    }
});

/******************************************************************************/

// <<<<< end of local scope
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

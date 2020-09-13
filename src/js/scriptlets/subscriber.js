/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-present Raymond Hill

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

// Injected into specific web pages, those which have been pre-selected
// because they are known to contains `abp:subscribe` links.

/******************************************************************************/

(( ) => {
// >>>>> start of local scope

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/464
if ( document instanceof HTMLDocument === false ) { return; }

// Maybe uBO has gone away meanwhile.
if ( typeof vAPI !== 'object' || vAPI === null ) { return; }

// https://github.com/easylist/EasyListHebrew/issues/89
//   Ensure trusted events only.

const onMaybeSubscriptionLinkClicked = function(ev) {
    if ( ev.button !== 0 || ev.isTrusted === false ) { return; }

    const target = ev.target.closest('a');
    if ( target instanceof HTMLAnchorElement === false ) { return; }

    if ( vAPI instanceof Object === false ) {
        document.removeEventListener('click', onMaybeSubscriptionLinkClicked);
        return;
    }

    const href = target.href || '';
    const matches = /^(?:abp|ubo):\/*subscribe\/*\?location=([^&]+).*title=([^&]+)/.exec(href);
    if ( matches === null ) { return; }

    vAPI.messaging.send('scriptlets', {
        what: 'subscribeTo',
        location: decodeURIComponent(matches[1]),
        title: decodeURIComponent(matches[2]),
    });

    ev.stopPropagation();
    ev.preventDefault();
};

document.addEventListener('click', onMaybeSubscriptionLinkClicked);

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

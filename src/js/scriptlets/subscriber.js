/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-2018 Raymond Hill

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

(function() {

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/464
if ( document instanceof HTMLDocument === false ) {
    //console.debug('subscriber.js > not a HTLMDocument');
    return;
}

// Because in case
if ( typeof vAPI !== 'object' ) {
    //console.debug('subscriber.js > vAPI not found');
    return;
}

/******************************************************************************/

var onMaybeAbpLinkClicked = function(ev) {
    if ( ev.button !== 0 ) {
        return;
    }
    // This addresses https://github.com/easylist/EasyListHebrew/issues/89
    // Also, as per feedback to original fix:
    // https://github.com/gorhill/uBlock/commit/99a3d9631047d33dc7a454296ab3dd0a1e91d6f1
    var target = ev.target;
    if (
        ev.isTrusted === false ||
        target instanceof HTMLAnchorElement === false
    ) {
        return;
    }
    var href = target.href || '';
    if ( href === '' ) {
        return;
    }
    var matches = /^(?:abp|ubo):\/*subscribe\/*\?location=([^&]+).*title=([^&]+)/.exec(href);
    if ( matches === null ) {
        matches = /^https?:\/\/.*?[&?]location=([^&]+).*?&title=([^&]+)/.exec(href);
        if ( matches === null ) { return; }
    }

    var location = decodeURIComponent(matches[1]);
    var title = decodeURIComponent(matches[2]);
    var messaging = vAPI.messaging;

    ev.stopPropagation();
    ev.preventDefault();

    var onListsSelectionDone = function() {
        messaging.send('scriptlets', { what: 'reloadAllFilters' });
    };

    var onSubscriberDataReady = function(details) {
        var confirmStr = details.confirmStr
                            .replace('{{url}}', location)
                            .replace('{{title}}', title);
        if ( !window.confirm(confirmStr) ) { return; }
        messaging.send(
            'scriptlets',
            {
                what: 'applyFilterListSelection',
                toImport: location
            },
            onListsSelectionDone
        );
    };

    messaging.send(
        'scriptlets',
        { what: 'subscriberData' },
        onSubscriberDataReady
    );
};

/******************************************************************************/

// Only if at least one subscribe link exists on the page.

setTimeout(function() {
    if (
        document.querySelector('link[rel="canonical"][href="https://filterlists.com/"]') !== null ||
        document.querySelector('a[href^="abp:"],a[href^="ubo:"],a[href^="https://subscribe.adblockplus.org/?"]') !== null
    ) {
        document.addEventListener('click', onMaybeAbpLinkClicked);
    }
}, 997);

/******************************************************************************/

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

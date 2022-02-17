/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2015 The uBlock Origin authors
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

// For background page or non-background pages

'use strict';

/******************************************************************************/
/******************************************************************************/

vAPI.T0 = Date.now();

/******************************************************************************/

vAPI.setTimeout = vAPI.setTimeout || self.setTimeout.bind(self);

/******************************************************************************/

vAPI.webextFlavor = {
    major: 0,
    soup: new Set()
};

(( ) => {
    const ua = navigator.userAgent;
    const flavor = vAPI.webextFlavor;
    const soup = flavor.soup;
    const dispatch = function() {
        window.dispatchEvent(new CustomEvent('webextFlavor'));
    };

    // This is always true.
    soup.add('ublock').add('webext');

    // Whether this is a dev build.
    if ( /^\d+\.\d+\.\d+\D/.test(browser.runtime.getManifest().version) ) {
        soup.add('devbuild');
    }

    if ( /\bMobile\b/.test(ua) ) {
        soup.add('mobile');
    }

    // Asynchronous
    if (
        browser instanceof Object &&
        typeof browser.runtime.getBrowserInfo === 'function'
    ) {
        browser.runtime.getBrowserInfo().then(info => {
            flavor.major = parseInt(info.version, 10) || flavor.major;
            soup.add(info.vendor.toLowerCase())
                .add(info.name.toLowerCase());
            dispatch();
        });
        if ( browser.runtime.getURL('').startsWith('moz-extension://') ) {
            soup.add('firefox')
                .add('user_stylesheet')
                .add('html_filtering');
            flavor.major = 91;
        }
        return;
    }

    // Synchronous -- order of tests is important
    const match = /\bChrom(?:e|ium)\/([\d.]+)/.exec(ua);
    if ( match !== null ) {
        soup.add('chromium')
            .add('user_stylesheet');
        flavor.major = parseInt(match[1], 10) || 0;
    }

    // Don't starve potential listeners
    vAPI.setTimeout(dispatch, 97);
})();

/******************************************************************************/

vAPI.download = function(details) {
    if ( !details.url ) { return; }
    const a = document.createElement('a');
    a.href = details.url;
    a.setAttribute('download', details.filename || '');
    a.setAttribute('type', 'text/plain');
    a.dispatchEvent(new MouseEvent('click'));
};

/******************************************************************************/

vAPI.getURL = browser.runtime.getURL;

/******************************************************************************/

vAPI.i18n = browser.i18n.getMessage;

// http://www.w3.org/International/questions/qa-scripts#directions
document.body.setAttribute(
    'dir',
    ['ar', 'he', 'fa', 'ps', 'ur'].indexOf(vAPI.i18n('@@ui_locale')) !== -1
        ? 'rtl'
        : 'ltr'
);

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/3057
// - webNavigation.onCreatedNavigationTarget become broken on Firefox when we
//   try to make the popup panel close itself using the original
//   `window.open('', '_self').close()`. 

vAPI.closePopup = function() {
    if ( vAPI.webextFlavor.soup.has('firefox') ) {
        window.close();
        return;
    }

    // TODO: try to figure why this was used instead of a plain window.close().
    // https://github.com/gorhill/uBlock/commit/b301ac031e0c2e9a99cb6f8953319d44e22f33d2#diff-bc664f26b9c453e0d43a9379e8135c6a
    window.open('', '_self').close();
};

/******************************************************************************/

// A localStorage-like object which should be accessible from the
// background page or auxiliary pages.
//
// https://github.com/uBlockOrigin/uBlock-issues/issues/899
//   Convert into asynchronous access API.

vAPI.localStorage = {
    clear: function() {
        vAPI.messaging.send('vapi', {
            what: 'localStorage',
            fn: 'clear',
        });
    },
    getItemAsync: function(key) {
        return vAPI.messaging.send('vapi', {
            what: 'localStorage',
            fn: 'getItemAsync',
            args: [ key ],
        });
    },
    removeItem: function(key) {
        return vAPI.messaging.send('vapi', {
            what: 'localStorage',
            fn: 'removeItem',
            args: [ key ],
        });
    },
    setItem: function(key, value = undefined) {
        return vAPI.messaging.send('vapi', {
            what: 'localStorage',
            fn: 'setItem',
            args: [ key, value ]
        });
    },
};








/*******************************************************************************

    DO NOT:
    - Remove the following code
    - Add code beyond the following code
    Reason:
    - https://github.com/gorhill/uBlock/pull/3721
    - uBO never uses the return value from injected content scripts

**/

void 0;

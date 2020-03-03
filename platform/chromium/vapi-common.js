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
            flavor.major = parseInt(info.version, 10) || 60;
            soup.add(info.vendor.toLowerCase())
                .add(info.name.toLowerCase());
            if ( soup.has('firefox') && flavor.major < 57 ) {
                soup.delete('html_filtering');
            }
            dispatch();
        });
        if ( browser.runtime.getURL('').startsWith('moz-extension://') ) {
            soup.add('mozilla')
                .add('firefox')
                .add('user_stylesheet')
                .add('html_filtering');
            flavor.major = 60;
        }
        return;
    }

    // Synchronous -- order of tests is important
    let match;
    if ( (match = /\bEdge\/(\d+)/.exec(ua)) !== null ) {
        flavor.major = parseInt(match[1], 10) || 0;
        soup.add('microsoft').add('edge');
    } else if ( (match = /\bOPR\/(\d+)/.exec(ua)) !== null ) {
        const reEx = /\bChrom(?:e|ium)\/([\d.]+)/;
        if ( reEx.test(ua) ) { match = reEx.exec(ua); }
        flavor.major = parseInt(match[1], 10) || 0;
        soup.add('opera').add('chromium');
    } else if ( (match = /\bChromium\/(\d+)/.exec(ua)) !== null ) {
        flavor.major = parseInt(match[1], 10) || 0;
        soup.add('chromium');
    } else if ( (match = /\bChrome\/(\d+)/.exec(ua)) !== null ) {
        flavor.major = parseInt(match[1], 10) || 0;
        soup.add('google').add('chromium');
    } else if ( (match = /\bSafari\/(\d+)/.exec(ua)) !== null ) {
        flavor.major = parseInt(match[1], 10) || 0;
        soup.add('apple').add('safari');
    }

    // https://github.com/gorhill/uBlock/issues/3588
    if ( soup.has('chromium') && flavor.major >= 66 ) {
        soup.add('user_stylesheet');
    }

    // Don't starve potential listeners
    vAPI.setTimeout(dispatch, 97);
})();

/******************************************************************************/

{
    const punycode = self.punycode;
    const reCommonHostnameFromURL  = /^https?:\/\/([0-9a-z_][0-9a-z._-]*[0-9a-z])\//;
    const reAuthorityFromURI       = /^(?:[^:\/?#]+:)?(\/\/[^\/?#]+)/;
    const reHostFromNakedAuthority = /^[0-9a-z._-]+[0-9a-z]$/i;
    const reHostFromAuthority      = /^(?:[^@]*@)?([^:]+)(?::\d*)?$/;
    const reIPv6FromAuthority      = /^(?:[^@]*@)?(\[[0-9a-f:]+\])(?::\d*)?$/i;
    const reMustNormalizeHostname  = /[^0-9a-z._-]/;

    vAPI.hostnameFromURI = function(uri) {
        let matches = reCommonHostnameFromURL.exec(uri);
        if ( matches !== null ) { return matches[1]; }
        matches = reAuthorityFromURI.exec(uri);
        if ( matches === null ) { return ''; }
        const authority = matches[1].slice(2);
        if ( reHostFromNakedAuthority.test(authority) ) {
            return authority.toLowerCase();
        }
        matches = reHostFromAuthority.exec(authority);
        if ( matches === null ) {
            matches = reIPv6FromAuthority.exec(authority);
            if ( matches === null ) { return ''; }
        }
        let hostname = matches[1];
        while ( hostname.endsWith('.') ) {
            hostname = hostname.slice(0, -1);
        }
        if ( reMustNormalizeHostname.test(hostname) ) {
            hostname = punycode.toASCII(hostname.toLowerCase());
        }
        return hostname;
    };

    const reHostnameFromNetworkURL =
        /^(?:http|ws|ftp)s?:\/\/([0-9a-z_][0-9a-z._-]*[0-9a-z])\//;

    vAPI.hostnameFromNetworkURL = function(url) {
        const matches = reHostnameFromNetworkURL.exec(url);
        return matches !== null ? matches[1] : '';
    };

    const psl = self.publicSuffixList;
    const reIPAddressNaive = /^\d+\.\d+\.\d+\.\d+$|^\[[\da-zA-Z:]+\]$/;

    vAPI.domainFromHostname = function(hostname) {
        return reIPAddressNaive.test(hostname)
            ? hostname
            : psl.getDomain(hostname);
    };
}

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
// This storage is optional, but it is nice to have, for a more polished user
// experience.
//
// https://github.com/gorhill/uBlock/issues/2824
//   Use a dummy localStorage if for some reasons it's not available.
//
// https://github.com/gorhill/uMatrix/issues/840
//   Always use a wrapper to seamlessly handle exceptions
//
// https://github.com/uBlockOrigin/uBlock-issues/issues/899
//   Convert into asynchronous access API.

vAPI.localStorage = {
    start: function() {
        if ( this.cache instanceof Promise ) { return this.cache; }
        if ( this.cache instanceof Object ) { return Promise.resolve(); }
        const onChanged = (changes, area) => {
            if (
                area !== 'local' ||
                changes instanceof Object === false ||
                changes.localStorage instanceof Object === false
            ) {
                return;
            }
            const newValue = changes.localStorage.newValue;
            this.cache = newValue instanceof Object ? newValue : {};
        };
        this.cache = new Promise(resolve => {
            browser.storage.local.get('localStorage', bin => {
                this.cache = undefined;
                try {
                    if (
                        bin instanceof Object === false ||
                        bin.localStorage instanceof Object === false
                    ) {
                        this.cache = {};
                        const ls = self.localStorage;
                        for ( let i = 0; i < ls.length; i++ ) {
                            const key = ls.key(i);
                            this.cache[key] = ls.getItem(key);
                        }
                        browser.storage.local.set({ localStorage: this.cache });
                    } else {
                        this.cache = bin.localStorage;
                    }
                } catch(ex) {
                }
                if ( this.cache instanceof Object === false ) {
                    this.cache = {};
                }
                resolve();
                browser.storage.onChanged.addListener(onChanged);
                self.addEventListener('beforeunload', ( ) => {
                    this.cache = undefined;
                    browser.storage.onChanged.removeListener(onChanged);
                });
            });
        });
        return this.cache;
    },
    clear: function() {
        this.cache = {};
        return browser.storage.local.set({ localStorage: this.cache });
    },
    getItem: function(key) {
        if ( this.cache instanceof Object === false ) {
            console.info(`localStorage.getItem('${key}') not ready`);
            return null;
        }
        const value = this.cache[key];
        return value !== undefined ? value : null;
    },
    getItemAsync: function(key) {
        return this.start().then(( ) => {
            const value = this.cache[key];
            return value !== undefined ? value : null;
        });
    },
    removeItem: function(key) {
        this.setItem(key);
    },
    setItem: function(key, value = undefined) {
        return this.start().then(( ) => {
            if ( value === this.cache[key] ) { return; }
            this.cache[key] = value;
            return browser.storage.local.set({ localStorage: this.cache });
        });
    },
    cache: undefined,
};

vAPI.localStorage.start();






/*******************************************************************************

    DO NOT:
    - Remove the following code
    - Add code beyond the following code
    Reason:
    - https://github.com/gorhill/uBlock/pull/3721
    - uBO never uses the return value from injected content scripts

**/

void 0;

/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2017-present Raymond Hill

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

// For background page

'use strict';

/******************************************************************************/

(function() {
    // https://github.com/uBlockOrigin/uBlock-issues/issues/407
    if ( vAPI.webextFlavor.soup.has('firefox') === false ) { return; }

    // https://github.com/gorhill/uBlock/issues/2950
    // Firefox 56 does not normalize URLs to ASCII, uBO must do this itself.
    // https://bugzilla.mozilla.org/show_bug.cgi?id=945240
    const evalMustPunycode = function() {
        return vAPI.webextFlavor.soup.has('firefox') &&
               vAPI.webextFlavor.major < 57;
    };

    let mustPunycode = evalMustPunycode();

    // The real actual webextFlavor value may not be set in stone, so listen
    // for possible future changes.
    window.addEventListener('webextFlavor', ( ) => {
        mustPunycode = evalMustPunycode();
    }, { once: true });

    const denormalizeTypes = function(aa) {
        if ( aa.length === 0 ) {
            return Array.from(vAPI.net.validTypes);
        }
        const out = new Set();
        let i = aa.length;
        while ( i-- ) {
            let type = aa[i];
            if ( vAPI.net.validTypes.has(type) ) {
                out.add(type);
            }
            if ( type === 'image' && vAPI.net.validTypes.has('imageset') ) {
                out.add('imageset');
            }
            if ( type === 'sub_frame' ) {
                out.add('object');
            }
        }
        return Array.from(out);
    };

    const punycode = self.punycode;
    const reAsciiHostname  = /^https?:\/\/[0-9a-z_.:@-]+[/?#]/;
    const parsedURL = new URL('about:blank');

    vAPI.net.normalizeDetails = function(details) {
        if ( mustPunycode && !reAsciiHostname.test(details.url) ) {
            parsedURL.href = details.url;
            details.url = details.url.replace(
                parsedURL.hostname,
                punycode.toASCII(parsedURL.hostname)
            );
        }

        const type = details.type;

        // https://github.com/gorhill/uBlock/issues/1493
        //   Chromium 49+/WebExtensions support a new request type: `ping`,
        //   which is fired as a result of using `navigator.sendBeacon`.
        if ( type === 'ping' ) {
            details.type = 'beacon';
            return;
        }

        if ( type === 'imageset' ) {
            details.type = 'image';
            return;
        }

        // https://github.com/uBlockOrigin/uBlock-issues/issues/345
        //   Re-categorize an embedded object as a `sub_frame` if its
        //   content type is that of a HTML document.
        if ( type === 'object' && Array.isArray(details.responseHeaders) ) {
            for ( const header of details.responseHeaders ) {
                if ( header.name.toLowerCase() === 'content-type' ) {
                    if ( header.value.startsWith('text/html') ) {
                        details.type = 'sub_frame';
                    }
                    break;
                }
            }
        }
    };

    vAPI.net.denormalizeFilters = function(filters) {
        const urls = filters.urls || [ '<all_urls>' ];
        let types = filters.types;
        if ( Array.isArray(types) ) {
            types = denormalizeTypes(types);
        }
        if (
            (vAPI.net.validTypes.has('websocket')) &&
            (types === undefined || types.indexOf('websocket') !== -1) &&
            (urls.indexOf('<all_urls>') === -1)
        ) {
            if ( urls.indexOf('ws://*/*') === -1 ) {
                urls.push('ws://*/*');
            }
            if ( urls.indexOf('wss://*/*') === -1 ) {
                urls.push('wss://*/*');
            }
        }
        return { types, urls };
    };
})();

/******************************************************************************/

// Related issues:
// - https://github.com/gorhill/uBlock/issues/1327
// - https://github.com/uBlockOrigin/uBlock-issues/issues/128
// - https://bugzilla.mozilla.org/show_bug.cgi?id=1503721

vAPI.net.onBeforeReady = vAPI.net.onBeforeReady || (function() {
    // https://github.com/uBlockOrigin/uBlock-issues/issues/407
    if ( vAPI.webextFlavor.soup.has('firefox') === false ) { return; }

    let pendings;

    const handler = function(details) {
        if ( pendings === undefined ) { return; }
        if ( details.tabId < 0 ) { return; }

        const pending = {
            details: Object.assign({}, details),
            resolve: undefined,
            promise: undefined
        };

        pending.promise = new Promise(function(resolve) {
            pending.resolve = resolve;
        });

        pendings.push(pending);

        return pending.promise;
    };

    return {
        start: function() {
            pendings = [];
            browser.webRequest.onBeforeRequest.addListener(
                handler,
                { urls: [ 'http://*/*', 'https://*/*' ] },
                [ 'blocking' ]
            );
        },
        stop: function(resolver) {
            if ( pendings === undefined ) { return; }
            for ( const pending of pendings ) {
                vAPI.net.normalizeDetails(pending.details);
                pending.resolve(resolver(pending.details));
            }
            pendings = undefined;
        },
    };
})();

/******************************************************************************/

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

(( ) => {
    // https://github.com/uBlockOrigin/uBlock-issues/issues/407
    if ( vAPI.webextFlavor.soup.has('firefox') === false ) { return; }

    // https://github.com/gorhill/uBlock/issues/2950
    // Firefox 56 does not normalize URLs to ASCII, uBO must do this itself.
    // https://bugzilla.mozilla.org/show_bug.cgi?id=945240
    const evalMustPunycode = ( ) => {
        return vAPI.webextFlavor.soup.has('firefox') &&
               vAPI.webextFlavor.major < 57;
    };

    let mustPunycode = evalMustPunycode();

    // The real actual webextFlavor value may not be set in stone, so listen
    // for possible future changes.
    window.addEventListener('webextFlavor', ( ) => {
        mustPunycode = evalMustPunycode();
    }, { once: true });

    const punycode = self.punycode;
    const reAsciiHostname  = /^https?:\/\/[0-9a-z_.:@-]+[/?#]/;
    const parsedURL = new URL('about:blank');

    // Related issues:
    // - https://github.com/gorhill/uBlock/issues/1327
    // - https://github.com/uBlockOrigin/uBlock-issues/issues/128
    // - https://bugzilla.mozilla.org/show_bug.cgi?id=1503721

    // Extend base class to normalize as per platform.

    vAPI.Net = class extends vAPI.Net {
        constructor() {
            super();
            this.pendingRequests = [];
        }
        normalizeDetails(details) {
            if ( mustPunycode && !reAsciiHostname.test(details.url) ) {
                parsedURL.href = details.url;
                details.url = details.url.replace(
                    parsedURL.hostname,
                    punycode.toASCII(parsedURL.hostname)
                );
            }

            const type = details.type;

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
        }
        denormalizeTypes(types) {
            if ( types.length === 0 ) {
                return Array.from(this.validTypes);
            }
            const out = new Set();
            for ( const type of types ) {
                if ( this.validTypes.has(type) ) {
                    out.add(type);
                }
                if ( type === 'image' && this.validTypes.has('imageset') ) {
                    out.add('imageset');
                }
                if ( type === 'sub_frame' ) {
                    out.add('object');
                }
            }
            return Array.from(out);
        }
        suspendOneRequest(details) {
            const pending = {
                details: Object.assign({}, details),
                resolve: undefined,
                promise: undefined
            };
            pending.promise = new Promise(resolve => {
                pending.resolve = resolve;
            });
            this.pendingRequests.push(pending);
            return pending.promise;
        }
        unsuspendAllRequests(resolver) {
            const pendingRequests = this.pendingRequests;
            this.pendingRequests = [];
            for ( const entry of pendingRequests ) {
                entry.resolve(resolver(entry.details));
            }
        }
        canSuspend() {
            return true;
        }
    };
})();

/******************************************************************************/

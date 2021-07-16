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
    if ( vAPI.webextFlavor.soup.has('chromium') === false ) { return; }

    const extToTypeMap = new Map([
        ['eot','font'],['otf','font'],['svg','font'],['ttf','font'],['woff','font'],['woff2','font'],
        ['mp3','media'],['mp4','media'],['webm','media'],
        ['gif','image'],['ico','image'],['jpeg','image'],['jpg','image'],['png','image'],['webp','image']
    ]);

    const headerValue = (headers, name) => {
        let i = headers.length;
        while ( i-- ) {
            if ( headers[i].name.toLowerCase() === name ) {
                return headers[i].value.trim();
            }
        }
        return '';
    };

    const parsedURL = new URL('https://www.example.org/');

    // Extend base class to normalize as per platform.

    vAPI.Net = class extends vAPI.Net {
        constructor() {
            super();
            this.suspendedTabIds = new Set();
        }
        normalizeDetails(details) {
            // Chromium 63+ supports the `initiator` property, which contains
            // the URL of the origin from which the network request was made.
            if (
                typeof details.initiator === 'string' &&
                details.initiator !== 'null'
            ) {
                details.documentUrl = details.initiator;
            }

            let type = details.type;

            if ( type === 'imageset' ) {
                details.type = 'image';
                return;
            }

            // The rest of the function code is to normalize type
            if ( type !== 'other' ) { return; }

            // Try to map known "extension" part of URL to request type.
            parsedURL.href = details.url;
            const path = parsedURL.pathname,
                  pos = path.indexOf('.', path.length - 6);
            if ( pos !== -1 && (type = extToTypeMap.get(path.slice(pos + 1))) ) {
                details.type = type;
                return;
            }

            // Try to extract type from response headers if present.
            if ( details.responseHeaders ) {
                type = headerValue(details.responseHeaders, 'content-type');
                if ( type.startsWith('font/') ) {
                    details.type = 'font';
                    return;
                }
                if ( type.startsWith('image/') ) {
                    details.type = 'image';
                    return;
                }
                if ( type.startsWith('audio/') || type.startsWith('video/') ) {
                    details.type = 'media';
                    return;
                }
            }
        }
        // https://www.reddit.com/r/uBlockOrigin/comments/9vcrk3/
        //   Some types can be mapped from 'other', thus include 'other' if and
        //   only if the caller is interested in at least one of those types.
        denormalizeTypes(types) {
            if ( types.length === 0 ) {
                return Array.from(this.validTypes);
            }
            const out = new Set();
            for ( const type of types ) {
                if ( this.validTypes.has(type) ) {
                    out.add(type);
                }
            }
            if ( out.has('other') === false ) {
                for ( const type of extToTypeMap.values() ) {
                    if ( out.has(type) ) {
                        out.add('other');
                        break;
                    }
                }
            }
            return Array.from(out);
        }
        suspendOneRequest(details) {
            this.suspendedTabIds.add(details.tabId);
            return { cancel: true };
        }
        unsuspendAllRequests() {
            for ( const tabId of this.suspendedTabIds ) {
                vAPI.tabs.reload(tabId);
            }
            this.suspendedTabIds.clear();
        }
    };
})();

/******************************************************************************/

// https://github.com/uBlockOrigin/uBlock-issues/issues/548
//   Use `X-DNS-Prefetch-Control` to workaround Chromium's disregard of the
//   setting "Predict network actions to improve page load performance".

vAPI.prefetching = (( ) => {
    // https://github.com/uBlockOrigin/uBlock-issues/issues/407
    if ( vAPI.webextFlavor.soup.has('chromium') === false ) { return; }

    let listening = false;

    const onHeadersReceived = function(details) {
        details.responseHeaders.push({
            name: 'X-DNS-Prefetch-Control',
            value: 'off'
        });
        return { responseHeaders: details.responseHeaders };
    };

    return state => {
        const wr = chrome.webRequest;
        if ( state && listening ) {
            wr.onHeadersReceived.removeListener(onHeadersReceived);
            listening = false;
        } else if ( !state && !listening ) {
            wr.onHeadersReceived.addListener(
                onHeadersReceived,
                {
                    urls: [ 'http://*/*', 'https://*/*' ],
                    types: [ 'main_frame', 'sub_frame' ]
                },
                [ 'blocking', 'responseHeaders' ]
            );
            listening = true;
        }
    };
})();

/******************************************************************************/

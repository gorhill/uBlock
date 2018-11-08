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
    const extToTypeMap = new Map([
        ['eot','font'],['otf','font'],['svg','font'],['ttf','font'],['woff','font'],['woff2','font'],
        ['mp3','media'],['mp4','media'],['webm','media'],
        ['gif','image'],['ico','image'],['jpeg','image'],['jpg','image'],['png','image'],['webp','image']
    ]);

    // https://www.reddit.com/r/uBlockOrigin/comments/9vcrk3/bug_in_ubo_1173_betas_when_saving_files_hosted_on/
    //   Some types can be mapped from 'other', thus include 'other' if and
    //   only if the caller is interested in at least one of those types.
    const denormalizeTypes = function(aa) {
        if ( aa.length === 0 ) {
            return Array.from(vAPI.net.validTypes);
        }
        const out = new Set();
        let i = aa.length;
        while ( i-- ) {
            const type = aa[i];
            if ( vAPI.net.validTypes.has(type) ) {
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
    };

    const headerValue = function(headers, name) {
        let i = headers.length;
        while ( i-- ) {
            if ( headers[i].name.toLowerCase() === name ) {
                return headers[i].value.trim();
            }
        }
        return '';
    };

    const parsedURL = new URL('https://www.example.org/');

    vAPI.net.normalizeDetails = function(details) {
        // Chromium 63+ supports the `initiator` property, which contains
        // the URL of the origin from which the network request was made.
        if (
            details.tabId === vAPI.noTabId &&
            typeof details.initiator === 'string' &&
            details.initiator !== 'null'
        ) {
            details.tabId = vAPI.anyTabId;
            details.documentUrl = details.initiator;
        }

        let type = details.type;

        // https://github.com/gorhill/uBlock/issues/1493
        // Chromium 49+/WebExtensions support a new request type: `ping`,
        // which is fired as a result of using `navigator.sendBeacon`.
        if ( type === 'ping' ) {
            details.type = 'beacon';
            return;
        }

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

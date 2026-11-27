/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
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

/* global chrome */

import './vapi-network.js';
import * as frameManager from './vapi-contexts.js';

/******************************************************************************/

const extToTypeMap = new Map([
    ['eot','font'],['otf','font'],['ttf','font'],['woff','font'],
        ['woff2','font'],
    ['mp3','media'],['mp4','media'],['webm','media'],
    ['gif','image'],['ico','image'],['jpeg','image'],['jpg','image'],
        ['png','image'],['svg','image'],['webp','image']
]);

const parsedURL = new URL('https://www.example.org/');

// Extend base class to normalize as per platform

vAPI.Net = class extends vAPI.Net {
    normalizeDetails(details) {
        details.tabUrl = frameManager.getTopURL(details.tabId);
        // Chromium 63+ supports the `initiator` property, which contains
        // the URL of the origin from which the network request was made
        if ( details.initiator && details.initiator !== 'null' ) {
            details.documentUrl = details.initiator;
        }
        const type = details.type;
        if ( type === 'imageset' ) {
            details.type = 'image';
            return;
        }
        if ( type !== 'other' ) { return; }
        // Try to map known "extension" part of URL to request type
        if ( details.responseHeaders === undefined ) {
            parsedURL.href = details.url;
            const path = parsedURL.pathname;
            const pos = path.indexOf('.', path.length - 6);
            if ( pos !== -1 ) {
                details.type = extToTypeMap.get(path.slice(pos + 1)) || type;
            }
            return;
        }
        // Try to extract type from response headers
        const ctype = this.headerValue(details.responseHeaders, 'content-type');
        if ( ctype.startsWith('font/') ) {
            details.type = 'font';
        } else if ( ctype.startsWith('image/') ) {
            details.type = 'image';
        } else if ( ctype.startsWith('audio/') || ctype.startsWith('video/') ) {
            details.type = 'media';
        }
    }

    // https://www.reddit.com/r/uBlockOrigin/comments/9vcrk3/
    //   Some types can be mapped from 'other', thus include 'other' if and
    //   only if the caller is interested in at least one of those types
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

    getWarURL(warName = '') {
        const url = super.getWarURL(warName);
        url.searchParams.set('uid', this.#generateSecret());
        return url;
    }

    reuseWarURL(warURL) {
        const url = super.reuseWarURL(warURL);
        url.searchParams.set('uid', this.#generateSecret());
        return url;
    }

    onBeforeWarRequest(details) {
        const url = new URL(details.url);
        const uid = url.searchParams.get('uid') ?? '_';
        const apos = this.#warSecrets.indexOf(uid);
        if ( apos === -1 ) { return { cancel: true }; }
        this.#warSecrets.splice(apos, 1);
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/2063
    //   Do not interfere with root document
    suspendOneRequest(defer, details) {
        if ( details.type === 'main_frame' ) { return; }
        return defer
            ? { details, outcome: { cancel: true } }
            : { details };
    }

    unsuspendManyRequests(tabId, entries, discard = false) {
        if ( discard ) {
            return entries.forEach(a => { a.outcome = undefined; });
        }
        if ( entries.some(a => a.outcome) === false ) { return; }
        vAPI.tabs.reload(tabId);
    }

    #generateSecret() {
        if ( this.#warSecrets.length > 1024 ) {
            this.#warSecrets = this.#warSecrets.slice(-1024);
        }
        const uid = vAPI.generateSecret();
        this.#warSecrets.push(uid);
        return uid;
    }

    #warSecrets = [];
};

vAPI.net = new vAPI.Net();
vAPI.net.start();

/******************************************************************************/

// https://github.com/uBlockOrigin/uBlock-issues/issues/548
//   Use `X-DNS-Prefetch-Control` to workaround Chromium's disregard of the
//   setting "Predict network actions to improve page load performance".

vAPI.prefetching = (( ) => {
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

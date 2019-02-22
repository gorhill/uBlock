/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2017-2018 Raymond Hill

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

vAPI.net = {
    onBeforeRequest: {},
    onBeforeMaybeSpuriousCSPReport: {},
    onHeadersReceived: {},
    nativeCSPReportFiltering: true,
    webRequest: browser.webRequest,
    canFilterResponseBody:
        typeof browser.webRequest === 'object' &&
        typeof browser.webRequest.filterResponseData === 'function'
};

/******************************************************************************/

vAPI.net.registerListeners = function() {

    // https://github.com/gorhill/uBlock/issues/2950
    // Firefox 56 does not normalize URLs to ASCII, uBO must do this itself.
    // https://bugzilla.mozilla.org/show_bug.cgi?id=945240
    let evalMustPunycode = function() {
        return vAPI.webextFlavor.soup.has('firefox') &&
               vAPI.webextFlavor.major < 57;
    };

    let mustPunycode = evalMustPunycode();

    // The real actual webextFlavor value may not be set in stone, so listen
    // for possible future changes.
    window.addEventListener('webextFlavor', function() {
        mustPunycode = evalMustPunycode();
    }, { once: true });

    let wrApi = browser.webRequest;

    // legacy Chromium understands only these network request types.
    let validTypes = new Set([
        'image',
        'main_frame',
        'object',
        'other',
        'script',
        'stylesheet',
        'sub_frame',
        'xmlhttprequest',
    ]);
    // modern Chromium/WebExtensions: more types available.
    if ( wrApi.ResourceType ) {
        for ( let typeKey in wrApi.ResourceType ) {
            if ( wrApi.ResourceType.hasOwnProperty(typeKey) ) {
                validTypes.add(wrApi.ResourceType[typeKey]);
            }
        }
    }

    let denormalizeTypes = function(aa) {
        if ( aa.length === 0 ) {
            return Array.from(validTypes);
        }
        let out = new Set(),
            i = aa.length;
        while ( i-- ) {
            let type = aa[i];
            if ( validTypes.has(type) ) {
                out.add(type);
            }
            if ( type === 'image' && validTypes.has('imageset') ) {
                out.add('imageset');
            }
        }
        return Array.from(out);
    };

    let punycode = self.punycode;
    let reAsciiHostname  = /^https?:\/\/[0-9a-z_.:@-]+[/?#]/;
    let parsedURL = new URL('about:blank');

    let normalizeRequestDetails = function(details) {
        if (
            details.tabId === vAPI.noTabId &&
            typeof details.documentUrl === 'string'
        ) {
            details.tabId = vAPI.anyTabId;
        }

        if ( mustPunycode && !reAsciiHostname.test(details.url) ) {
            parsedURL.href = details.url;
            details.url = details.url.replace(
                parsedURL.hostname,
                punycode.toASCII(parsedURL.hostname)
            );
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
    };

    // This is to work around Firefox's inability to redirect xmlhttprequest
    // requests to data: URIs.
    let pseudoRedirector = {
        filters: new Map(),
        reDataURI: /^data:\w+\/\w+;base64,/,
        dec: null,
        init: function() {
            this.dec = new Uint8Array(128);
            let s = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
            for ( let i = 0, n = s.length; i < n; i++ ) {
                this.dec[s.charCodeAt(i)] = i;
            }
            return this.dec;
        },
        start: function(requestId, redirectUrl) {
            let match = this.reDataURI.exec(redirectUrl);
            if ( match === null ) { return redirectUrl; }
            let s = redirectUrl.slice(match[0].length).replace(/=*$/, '');
            let f = browser.webRequest.filterResponseData(requestId);
            f.onstop = this.done;
            f.onerror = this.disconnect;
            this.filters.set(f, s);
        },
        done: function() {
            let pr = pseudoRedirector;
            let bufIn = pr.filters.get(this);
            if ( bufIn === undefined ) { return pr.disconnect(this); }
            let dec = pr.dec || pr.init();
            let sizeIn = bufIn.length;
            let iIn = 0;
            let sizeOut = sizeIn * 6 >>> 3;
            let bufOut = new Uint8Array(sizeOut);
            let iOut = 0;
            let n = sizeIn & ~3;
            while ( iIn < n ) {
                let b0 = dec[bufIn.charCodeAt(iIn++)];
                let b1 = dec[bufIn.charCodeAt(iIn++)];
                let b2 = dec[bufIn.charCodeAt(iIn++)];
                let b3 = dec[bufIn.charCodeAt(iIn++)];
                bufOut[iOut++] = (b0 << 2) & 0xFC | (b1 >>> 4);
                bufOut[iOut++] = (b1 << 4) & 0xF0 | (b2 >>> 2);
                bufOut[iOut++] = (b2 << 6) & 0xC0 |  b3;
            }
            if ( iIn !== sizeIn ) {
                let b0 = dec[bufIn.charCodeAt(iIn++)];
                let b1 = dec[bufIn.charCodeAt(iIn++)];
                bufOut[iOut++] = (b0 << 2) & 0xFC | (b1 >>> 4);
                if ( iIn !== sizeIn ) {
                    let b2 = dec[bufIn.charCodeAt(iIn++)];
                    bufOut[iOut++] = (b1 << 4) & 0xF0 | (b2 >>> 2);
                }
            }
            this.write(bufOut);
            pr.disconnect(this);
        },
        disconnect: function(f) {
            let pr = pseudoRedirector;
            pr.filters.delete(f);
            f.disconnect();
        }
    };

    let onBeforeRequestClient = this.onBeforeRequest.callback;
    let onBeforeRequest = function(details) {
        normalizeRequestDetails(details);
        return onBeforeRequestClient(details);
    };

    if ( onBeforeRequest ) {
        let urls = this.onBeforeRequest.urls || ['<all_urls>'];
        let types = this.onBeforeRequest.types || undefined;
        if (
            (validTypes.has('websocket')) &&
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
        wrApi.onBeforeRequest.addListener(
            onBeforeRequest,
            { urls: urls, types: types },
            this.onBeforeRequest.extra
        );
    }

    // https://github.com/gorhill/uBlock/issues/3140
    if ( typeof this.onBeforeMaybeSpuriousCSPReport.callback === 'function' ) {
        wrApi.onBeforeRequest.addListener(
            this.onBeforeMaybeSpuriousCSPReport.callback,
            {
                urls: [ 'http://*/*', 'https://*/*' ],
                types: [ 'csp_report' ]
            },
            [ 'blocking', 'requestBody' ]
        );
    }

    let onHeadersReceivedClient = this.onHeadersReceived.callback,
        onHeadersReceivedClientTypes = this.onHeadersReceived.types.slice(0),
        onHeadersReceivedTypes = denormalizeTypes(onHeadersReceivedClientTypes);
    let onHeadersReceived = function(details) {
        normalizeRequestDetails(details);
        if (
            onHeadersReceivedClientTypes.length !== 0 &&
            onHeadersReceivedClientTypes.indexOf(details.type) === -1
        ) {
            return;
        }
        return onHeadersReceivedClient(details);
    };

    if ( onHeadersReceived ) {
        let urls = this.onHeadersReceived.urls || ['<all_urls>'];
        let types = onHeadersReceivedTypes;
        wrApi.onHeadersReceived.addListener(
            onHeadersReceived,
            { urls: urls, types: types },
            this.onHeadersReceived.extra
        );
    }
};

/******************************************************************************/

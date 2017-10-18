/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2017 Raymond Hill

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
    nativeCSPReportFiltering: true
};

/******************************************************************************/

vAPI.net.registerListeners = function() {

    // https://github.com/gorhill/uBlock/issues/2950
    // Firefox 55 does not normalize URLs to ASCII, uBO must do this itself.
    // https://bugzilla.mozilla.org/show_bug.cgi?id=945240
    var mustPunycode = false;
    (function() {
        if ( 
            typeof browser === 'object' &&
            browser !== null &&
            browser.runtime instanceof Object &&
            typeof browser.runtime.getBrowserInfo === 'function'
        ) {
            browser.runtime.getBrowserInfo().then(info => {
                mustPunycode = info.name === 'Firefox' &&
                               /^5[0-6]\./.test(info.version);
            });
        }
    })();

    var wrApi = browser.webRequest;

    // legacy Chromium understands only these network request types.
    var validTypes = {
        main_frame: true,
        sub_frame: true,
        stylesheet: true,
        script: true,
        image: true,
        object: true,
        xmlhttprequest: true,
        other: true
    };
    // modern Chromium/WebExtensions: more types available.
    if ( wrApi.ResourceType ) {
        for ( let typeKey in wrApi.ResourceType ) {
            if ( wrApi.ResourceType.hasOwnProperty(typeKey) ) {
                validTypes[wrApi.ResourceType[typeKey]] = true;
            }
        }
    }

    var denormalizeTypes = function(aa) {
        if ( aa.length === 0 ) {
            return Object.keys(validTypes);
        }
        var out = [];
        var i = aa.length,
            type,
            needOther = true;
        while ( i-- ) {
            type = aa[i];
            if ( validTypes[type] ) {
                out.push(type);
            }
            if ( type === 'other' ) {
                needOther = false;
            }
        }
        if ( needOther ) {
            out.push('other');
        }
        return out;
    };

    var punycode = self.punycode;
    var reAsciiHostname  = /^https?:\/\/[0-9a-z_.:@-]+[/?#]/;
    var parsedURL = new URL('about:blank');

    var normalizeRequestDetails = function(details) {
        details.tabId = details.tabId.toString();

        if ( mustPunycode && !reAsciiHostname.test(details.url) ) {
            parsedURL.href = details.url;
            details.url = details.url.replace(
                parsedURL.hostname,
                punycode.toASCII(parsedURL.hostname)
            );
        }

        var type = details.type;

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

    var onBeforeRequestClient = this.onBeforeRequest.callback;
    var onBeforeRequest = function(details) {
        normalizeRequestDetails(details);
        return onBeforeRequestClient(details);
    };

    if ( onBeforeRequest ) {
        let urls = this.onBeforeRequest.urls || ['<all_urls>'];
        let types = this.onBeforeRequest.types || undefined;
        if (
            (validTypes.websocket) &&
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

    var onHeadersReceivedClient = this.onHeadersReceived.callback,
        onHeadersReceivedClientTypes = this.onHeadersReceived.types.slice(0),
        onHeadersReceivedTypes = denormalizeTypes(onHeadersReceivedClientTypes);
    var onHeadersReceived = function(details) {
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

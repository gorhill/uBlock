/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2018 Raymond Hill

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
    webRequest: chrome.webRequest,
    canFilterResponseBody:
        typeof chrome.webRequest === 'object' &&
        typeof chrome.webRequest.filterResponseData === 'function'
};

/******************************************************************************/

vAPI.net.registerListeners = function() {

    let wrApi = chrome.webRequest;

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

    let normalizeRequestDetails = function(details) {
        if ( details.tabId === vAPI.noTabId ) {
            // Chromium uses `initiator` property.
            if (
                details.documentUrl === undefined &&
                typeof details.initiator === 'string'
            ) {
                details.documentUrl = details.initiator;
            }
            if ( typeof details.documentUrl === 'string' ) {
                details.tabId = vAPI.anyTabId;
            }
        }

        // https://github.com/gorhill/uBlock/issues/1493
        // Chromium 49+/WebExtensions support a new request type: `ping`,
        // which is fired as a result of using `navigator.sendBeacon`.
        if ( details.type === 'ping' ) {
            details.type = 'beacon';
            return;
        }

        if ( details.type === 'imageset' ) {
            details.type = 'image';
            return;
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

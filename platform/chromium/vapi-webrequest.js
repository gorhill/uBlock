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
    nativeCSPReportFiltering: false
};

vAPI.net.registerListeners = function() {

    var µb = µBlock,
        µburi = µb.URI,
        wrApi = chrome.webRequest;

    // https://bugs.chromium.org/p/chromium/issues/detail?id=410382
    // Between Chromium 38-48, plug-ins' network requests were reported as
    // type "other" instead of "object".
    var is_v38_48 = /\bChrom[a-z]+\/(?:3[89]|4[0-8])\.[\d.]+\b/.test(navigator.userAgent);

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
        (function() {
            for ( var typeKey in wrApi.ResourceType ) {
                if ( wrApi.ResourceType.hasOwnProperty(typeKey) ) {
                    validTypes[wrApi.ResourceType[typeKey]] = true;
                }
            }
        })();
    }

    var extToTypeMap = new Map([
        ['eot','font'],['otf','font'],['svg','font'],['ttf','font'],['woff','font'],['woff2','font'],
        ['mp3','media'],['mp4','media'],['webm','media'],
        ['gif','image'],['ico','image'],['jpeg','image'],['jpg','image'],['png','image'],['webp','image']
    ]);

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

    var headerValue = function(headers, name) {
        var i = headers.length;
        while ( i-- ) {
            if ( headers[i].name.toLowerCase() === name ) {
                return headers[i].value.trim();
            }
        }
        return '';
    };

    var normalizeRequestDetails = function(details) {
        details.tabId = details.tabId.toString();

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

        // The rest of the function code is to normalize type
        if ( type !== 'other' ) {
            return;
        }

        // Try to map known "extension" part of URL to request type.
        var path = µburi.pathFromURI(details.url),
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

        // https://github.com/chrisaljoudi/uBlock/issues/862
        //   If no transposition possible, transpose to `object` as per
        //   Chromium bug 410382
        // https://code.google.com/p/chromium/issues/detail?id=410382
        if ( is_v38_48 ) {
            details.type = 'object';
        }
    };

    // https://bugs.chromium.org/p/chromium/issues/detail?id=129353
    // https://github.com/gorhill/uBlock/issues/1497
    // Expose websocket-based network requests to uBO's filtering engine,
    // logger, etc.
    // Counterpart of following block of code is found in "vapi-client.js" --
    // search for "https://github.com/gorhill/uBlock/issues/1497".
    //
    // Once uBO 1.11.1 and uBO-Extra 2.12 are widespread, the image-based
    // handling code can be removed.
    var onBeforeWebsocketRequest = function(details) {
        if ( (details.type !== 'image') &&
             (details.method !== 'HEAD' || details.type !== 'xmlhttprequest')
        ) {
            return;
        }
        var requestURL = details.url,
            matches = /[?&]u(?:rl)?=([^&]+)/.exec(requestURL);
        if ( matches === null ) { return; }
        details.type = 'websocket';
        details.url = decodeURIComponent(matches[1]);
        var r = onBeforeRequestClient(details);
        if ( r && r.cancel ) { return r; }
        // Redirect to the provided URL, or a 1x1 data: URI if none provided.
        matches = /[?&]r=([^&]+)/.exec(requestURL);
        return {
            redirectUrl: matches !== null ?
                decodeURIComponent(matches[1]) :
                'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='
        };
    };

    var onBeforeRequestClient = this.onBeforeRequest.callback;
    var onBeforeRequest = validTypes.websocket
        // modern Chromium/WebExtensions: type 'websocket' is supported
        ? function(details) {
            normalizeRequestDetails(details);
            return onBeforeRequestClient(details);
        }
        // legacy Chromium
        : function(details) {
            // https://github.com/gorhill/uBlock/issues/1497
            if ( details.url.endsWith('ubofix=f41665f3028c7fd10eecf573336216d3') ) {
                var r = onBeforeWebsocketRequest(details);
                if ( r !== undefined ) { return r; }
            }
            normalizeRequestDetails(details);
            return onBeforeRequestClient(details);
        };

    // This is needed for Chromium 49-55.
    var onBeforeSendHeaders = validTypes.csp_report
        // modern Chromium/WebExtensions: type 'csp_report' is supported
        ? null
        // legacy Chromium
        : function(details) {
            if ( details.type !== 'ping' || details.method !== 'POST' ) { return; }
            var type = headerValue(details.requestHeaders, 'content-type');
            if ( type === '' ) { return; }
            if ( type.endsWith('/csp-report') ) {
                details.type = 'csp_report';
                return onBeforeRequestClient(details);
            }
        };

    var onHeadersReceivedClient = this.onHeadersReceived.callback,
        onHeadersReceivedClientTypes = this.onHeadersReceived.types.slice(0),
        onHeadersReceivedTypes = denormalizeTypes(onHeadersReceivedClientTypes);
    var onHeadersReceived = validTypes.font
        // modern Chromium/WebExtensions: type 'font' is supported
        ? function(details) {
            normalizeRequestDetails(details);
            if (
                onHeadersReceivedClientTypes.length !== 0 &&
                onHeadersReceivedClientTypes.indexOf(details.type) === -1
            ) {
                return;
            }
            return onHeadersReceivedClient(details);
        }
        // legacy Chromium
        : function(details) {
            normalizeRequestDetails(details);
            // Hack to work around Chromium API limitations, where requests of
            // type `font` are returned as `other`. For example, our normalization
            // fail at transposing `other` into `font` for URLs which are outside
            // what is expected. At least when headers are received we can check
            // for content type `font/*`. Blocking at onHeadersReceived time is
            // less worse than not blocking at all. Also, due to Chromium bug,
            // `other` always becomes `object` when it can't be normalized into
            // something else. Test case for "unfriendly" font URLs:
            //   https://www.google.com/fonts
            if ( details.type === 'font' ) {
                var r = onBeforeRequestClient(details);
                if ( typeof r === 'object' && r.cancel === true ) {
                    return { cancel: true };
                }
            }
            if (
                onHeadersReceivedClientTypes.length !== 0 &&
                onHeadersReceivedClientTypes.indexOf(details.type) === -1
            ) {
                return;
            }
            return onHeadersReceivedClient(details);
        };

    var urls, types;

    if ( onBeforeRequest ) {
        urls = this.onBeforeRequest.urls || ['<all_urls>'];
        types = this.onBeforeRequest.types || undefined;
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
    this.nativeCSPReportFiltering = validTypes.csp_report;
    if (
        this.nativeCSPReportFiltering &&
        typeof this.onBeforeMaybeSpuriousCSPReport.callback === 'function'
    ) {
        wrApi.onBeforeRequest.addListener(
            this.onBeforeMaybeSpuriousCSPReport.callback,
            {
                urls: [ 'http://*/*', 'https://*/*' ],
                types: [ 'csp_report' ]
            },
            [ 'blocking', 'requestBody' ]
        );
    }

    // Chromium 48 and lower does not support `ping` type.
    // Chromium 56 and higher does support `csp_report` stype.
    if ( onBeforeSendHeaders ) {
        wrApi.onBeforeSendHeaders.addListener(
            onBeforeSendHeaders,
            {
                'urls': [ '<all_urls>' ],
                'types': [ 'ping' ]
            },
            [ 'blocking', 'requestHeaders' ]
        );
    }

    if ( onHeadersReceived ) {
        urls = this.onHeadersReceived.urls || ['<all_urls>'];
        types = onHeadersReceivedTypes;
        wrApi.onHeadersReceived.addListener(
            onHeadersReceived,
            { urls: urls, types: types },
            this.onHeadersReceived.extra
        );
    }
};

/******************************************************************************/

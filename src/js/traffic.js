/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2018 Raymond Hill

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

'use strict';

/******************************************************************************/

// Start isolation from global scope

µBlock.webRequest = (function() {

/******************************************************************************/

var exports = {};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/2067
//   Experimental: Block everything until uBO is fully ready.
// TODO: re-work vAPI code to match more closely how listeners are
//       registered with the webRequest API. This will simplify implementing
//       the feature here: we could have a temporary onBeforeRequest listener
//       which blocks everything until all is ready.
//       This would allow to avoid the permanent special test at the top of
//       the main onBeforeRequest just to implement this.
// https://github.com/gorhill/uBlock/issues/3130
//   Don't block root frame.

var onBeforeReady = null;

µBlock.onStartCompletedQueue.push(function(callback) {
    vAPI.onLoadAllCompleted();
    callback();
});

if ( µBlock.hiddenSettings.suspendTabsUntilReady ) {
    onBeforeReady = (function() {
        var suspendedTabs = new Set();
        µBlock.onStartCompletedQueue.push(function(callback) {
            onBeforeReady = null;
            for ( var tabId of suspendedTabs ) {
                vAPI.tabs.reload(tabId);
            }
            callback();
        });
        return function(details) {
            if (
                details.type !== 'main_frame' &&
                vAPI.isBehindTheSceneTabId(details.tabId) === false
            ) {
                suspendedTabs.add(details.tabId);
                return true;
            }
        };
    })();
}

/******************************************************************************/

// Intercept and filter web requests.

var onBeforeRequest = function(details) {
    if ( onBeforeReady !== null && onBeforeReady(details) ) {
        return { cancel: true };
    }

    // Special handling for root document.
    // https://github.com/chrisaljoudi/uBlock/issues/1001
    // This must be executed regardless of whether the request is
    // behind-the-scene
    var requestType = details.type;
    if ( requestType === 'main_frame' ) {
        return onBeforeRootFrameRequest(details);
    }

    // Special treatment: behind-the-scene requests
    var tabId = details.tabId;
    if ( vAPI.isBehindTheSceneTabId(tabId) ) {
        return onBeforeBehindTheSceneRequest(details);
    }

    // Lookup the page store associated with this tab id.
    var µb = µBlock,
        pageStore = µb.pageStoreFromTabId(tabId);
    if ( !pageStore ) {
        var tabContext = µb.tabContextManager.mustLookup(tabId);
        if ( vAPI.isBehindTheSceneTabId(tabContext.tabId) ) {
            return onBeforeBehindTheSceneRequest(details);
        }
        vAPI.tabs.onNavigation({ tabId: tabId, frameId: 0, url: tabContext.rawURL });
        pageStore = µb.pageStoreFromTabId(tabId);
    }

    // https://github.com/chrisaljoudi/uBlock/issues/886
    // For requests of type `sub_frame`, the parent frame id must be used
    // to lookup the proper context:
    // > If the document of a (sub-)frame is loaded (type is main_frame or
    // > sub_frame), frameId indicates the ID of this frame, not the ID of
    // > the outer frame.
    // > (ref: https://developer.chrome.com/extensions/webRequest)
    var isFrame = requestType === 'sub_frame';

    // https://github.com/chrisaljoudi/uBlock/issues/114
    var requestContext = pageStore.createContextFromFrameId(
        isFrame ? details.parentFrameId : details.frameId
    );

    // Setup context and evaluate
    var requestURL = details.url;
    requestContext.requestURL = requestURL;
    requestContext.requestHostname = µb.URI.hostnameFromURI(requestURL);
    requestContext.requestType = requestType;

    var result = pageStore.filterRequest(requestContext);

    pageStore.journalAddRequest(requestContext.requestHostname, result);

    if ( µb.logger.isEnabled() ) {
        µb.logger.writeOne(
            tabId,
            'net',
            pageStore.logData,
            requestType,
            requestURL,
            requestContext.rootHostname,
            requestContext.pageHostname
        );
    }

    // Not blocked
    if ( result !== 1 ) {
        // https://github.com/chrisaljoudi/uBlock/issues/114
        if ( details.parentFrameId !== -1 && isFrame ) {
            pageStore.setFrame(details.frameId, requestURL);
        }
        requestContext.dispose();
        return;
    }

    // Blocked

    // https://github.com/gorhill/uBlock/issues/949
    // Redirect blocked request?
    if ( µb.hiddenSettings.ignoreRedirectFilters !== true ) {
        var url = µb.redirectEngine.toURL(requestContext);
        if ( url !== undefined ) {
            pageStore.internalRedirectionCount += 1;
            if ( µb.logger.isEnabled() ) {
                µb.logger.writeOne(
                    tabId,
                    'redirect',
                    { source: 'redirect', raw: µb.redirectEngine.resourceNameRegister },
                    requestType,
                    requestURL,
                    requestContext.rootHostname,
                    requestContext.pageHostname
                );
            }
            requestContext.dispose();
            return { redirectUrl: url };
        }
    }

    requestContext.dispose();
    return { cancel: true };
};

/******************************************************************************/

var onBeforeRootFrameRequest = function(details) {
    var tabId = details.tabId,
        requestURL = details.url,
        µb = µBlock;

    µb.tabContextManager.push(tabId, requestURL);

    // Special handling for root document.
    // https://github.com/chrisaljoudi/uBlock/issues/1001
    // This must be executed regardless of whether the request is
    // behind-the-scene
    var µburi = µb.URI,
        requestHostname = µburi.hostnameFromURI(requestURL),
        requestDomain = µburi.domainFromHostname(requestHostname) || requestHostname;
    var context = {
        rootHostname: requestHostname,
        rootDomain: requestDomain,
        pageHostname: requestHostname,
        pageDomain: requestDomain,
        requestURL: requestURL,
        requestHostname: requestHostname,
        requestType: 'main_frame'
    };
    var result = 0,
        logData,
        logEnabled = µb.logger.isEnabled();

    // If the site is whitelisted, disregard strict blocking
    if ( µb.getNetFilteringSwitch(requestURL) === false ) {
        result = 2;
        if ( logEnabled === true ) {
            logData = { engine: 'u', result: 2, raw: 'whitelisted' };
        }
    }

    // Permanently unrestricted?
    if ( result === 0 && µb.hnSwitches.evaluateZ('no-strict-blocking', requestHostname) ) {
        result = 2;
        if ( logEnabled === true ) {
            logData = { engine: 'u', result: 2, raw: 'no-strict-blocking: ' + µb.hnSwitches.z + ' true' };
        }
    }

    // Temporarily whitelisted?
    if ( result === 0 ) {
        result = isTemporarilyWhitelisted(result, requestHostname);
        if ( result === 2 && logEnabled === true ) {
            logData = { engine: 'u', result: 2, raw: 'no-strict-blocking true (temporary)' };
        }
    }

    // Static filtering: We always need the long-form result here.
    var snfe = µb.staticNetFilteringEngine;

    // Check for specific block
    if ( result === 0 ) {
        result = snfe.matchStringExactType(context, requestURL, 'main_frame');
        if ( result !== 0 || logEnabled === true ) {
            logData = snfe.toLogData();
        }
    }

    // Check for generic block
    if ( result === 0 ) {
        result = snfe.matchStringExactType(context, requestURL, 'no_type');
        if ( result !== 0 || logEnabled === true ) {
            logData = snfe.toLogData();
        }
        // https://github.com/chrisaljoudi/uBlock/issues/1128
        // Do not block if the match begins after the hostname, except when
        // the filter is specifically of type `other`.
        // https://github.com/gorhill/uBlock/issues/490
        // Removing this for the time being, will need a new, dedicated type.
        if (
            result === 1 &&
            toBlockDocResult(requestURL, requestHostname, logData) === false
        ) {
            result = 0;
            logData = undefined;
        }
    }

    // Log
    var pageStore = µb.bindTabToPageStats(tabId, 'beforeRequest');
    if ( pageStore ) {
        pageStore.journalAddRootFrame('uncommitted', requestURL);
        pageStore.journalAddRequest(requestHostname, result);
    }

    if ( logEnabled ) {
        µb.logger.writeOne(
            tabId,
            'net',
            logData,
            'main_frame',
            requestURL,
            requestHostname,
            requestHostname
        );
    }

    // Not blocked
    if ( result !== 1 ) { return; }

    // No log data means no strict blocking (because we need to report why
    // the blocking occurs.
    if ( logData === undefined  ) { return; }

    // Blocked
    var query = btoa(JSON.stringify({
        url: requestURL,
        hn: requestHostname,
        dn: requestDomain,
        fc: logData.compiled,
        fs: logData.raw
    }));

    vAPI.tabs.replace(tabId, vAPI.getURL('document-blocked.html?details=') + query);

    return { cancel: true };
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/3208
//   Mind case insensitivity.

var toBlockDocResult = function(url, hostname, logData) {
    if ( typeof logData.regex !== 'string' ) { return false; }
    var re = new RegExp(logData.regex, 'i'),
        match = re.exec(url.toLowerCase());
    if ( match === null ) { return false; }

    // https://github.com/chrisaljoudi/uBlock/issues/1128
    // https://github.com/chrisaljoudi/uBlock/issues/1212
    // Relax the rule: verify that the match is completely before the path part
    return (match.index + match[0].length) <=
           (url.indexOf(hostname) + hostname.length + 1);
};

/******************************************************************************/

// Intercept and filter behind-the-scene requests.

// https://github.com/gorhill/uBlock/issues/870
// Finally, Chromium 49+ gained the ability to report network request of type
// `beacon`, so now we can block them according to the state of the
// "Disable hyperlink auditing/beacon" setting.

var onBeforeBehindTheSceneRequest = function(details) {
    var µb = µBlock,
        pageStore = µb.pageStoreFromTabId(vAPI.noTabId);
    if ( !pageStore ) { return; }

    var result = 0,
        context = pageStore.createContextFromPage(),
        requestType = details.type,
        requestURL = details.url;

    context.requestURL = requestURL;
    context.requestHostname = µb.URI.hostnameFromURI(requestURL);
    context.requestType = requestType;

    // https://bugs.chromium.org/p/chromium/issues/detail?id=637577#c15
    //   Do not filter behind-the-scene network request of type `beacon`: there
    //   is no point. In any case, this will become a non-issue once
    //   <https://bugs.chromium.org/p/chromium/issues/detail?id=522129> is
    //   fixed.

    // Blocking behind-the-scene requests can break a lot of stuff: prevent
    // browser updates, prevent extension updates, prevent extensions from
    // working properly, etc.
    // So we filter if and only if the "advanced user" mode is selected.
    // https://github.com/gorhill/uBlock/issues/3150
    //   Ability to globally block CSP reports MUST also apply to
    //   behind-the-scene network requests.
    if ( µb.userSettings.advancedUserEnabled || requestType === 'csp_report' ) {
        result = pageStore.filterRequest(context);
    }

    pageStore.journalAddRequest(context.requestHostname, result);

    if ( µb.logger.isEnabled() ) {
        µb.logger.writeOne(
            vAPI.noTabId,
            'net',
            pageStore.logData,
            requestType,
            requestURL,
            context.rootHostname,
            context.rootHostname
        );
    }

    context.dispose();

    // Blocked?
    if ( result === 1 ) {
        return { 'cancel': true };
    }
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/3140

var onBeforeMaybeSpuriousCSPReport = function(details) {
    var tabId = details.tabId;

    // Ignore behind-the-scene requests.
    if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }

    // Lookup the page store associated with this tab id.
    var µb = µBlock,
        pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore === null ) { return; }

    // If uBO is disabled for the page, it can't possibly causes CSP reports
    // to be triggered.
    if ( pageStore.getNetFilteringSwitch() === false ) { return; }

    // A resource was redirected to a neutered one?
    // TODO: mind injected scripts/styles as well.
    if ( pageStore.internalRedirectionCount === 0 ) { return; }

    var textDecoder = onBeforeMaybeSpuriousCSPReport.textDecoder;
    if (
        textDecoder === undefined &&
        typeof self.TextDecoder === 'function'
    ) {
        textDecoder =
        onBeforeMaybeSpuriousCSPReport.textDecoder = new TextDecoder();
    }

    // Find out whether the CSP report is a potentially spurious CSP report.
    // If from this point on we are unable to parse the CSP report data, the
    // safest assumption to protect users is to assume the CSP report is
    // spurious.
    if (
        textDecoder !== undefined &&
        details.method === 'POST'
    ) {
        var raw = details.requestBody && details.requestBody.raw;
        if (
            Array.isArray(raw) &&
            raw.length !== 0 &&
            raw[0] instanceof Object &&
            raw[0].bytes instanceof ArrayBuffer
        ) {
            var data;
            try {
                data = JSON.parse(textDecoder.decode(raw[0].bytes));
            } catch (ex) {
            }
            if ( data instanceof Object ) {
                var report = data['csp-report'];
                if ( report instanceof Object ) {
                    var blocked = report['blocked-uri'] || report['blockedURI'],
                        validBlocked = typeof blocked === 'string',
                        source = report['source-file'] || report['sourceFile'],
                        validSource = typeof source === 'string';
                    if (
                        (validBlocked || validSource) &&
                        (!validBlocked || !blocked.startsWith('data')) &&
                        (!validSource || !source.startsWith('data'))
                    ) {
                        return;
                    }
                }
            }
        }
    }

    // Potentially spurious CSP report.
    if ( µb.logger.isEnabled() ) {
        var hostname = µb.URI.hostnameFromURI(details.url);
        µb.logger.writeOne(
            tabId,
            'net',
            { result: 1, source: 'global', raw: 'no-spurious-csp-report' },
            'csp_report',
            details.url,
            hostname,
            hostname
        );
    }

    return { cancel: true };
};

onBeforeMaybeSpuriousCSPReport.textDecoder = undefined;

/******************************************************************************/

// To handle:
// - Media elements larger than n kB
// - Scriptlet injection (requires ability to modify response body)
// - HTML filtering (requires ability to modify response body)
// - CSP injection

var onHeadersReceived = function(details) {
    // Do not interfere with behind-the-scene requests.
    var tabId = details.tabId;
    if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }

    var µb = µBlock,
        requestType = details.type,
        isRootDoc = requestType === 'main_frame',
        isDoc = isRootDoc || requestType === 'sub_frame';

    if ( isRootDoc ) {
        µb.tabContextManager.push(tabId, details.url);
    }

    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore === null ) {
        if ( isRootDoc === false ) { return; }
        pageStore = µb.bindTabToPageStats(tabId, 'beforeRequest');
    }
    if ( pageStore.getNetFilteringSwitch() === false ) { return; }

    if ( requestType === 'image' || requestType === 'media' ) {
        return foilLargeMediaElement(pageStore, details);
    }

    if ( isDoc && µb.canFilterResponseBody ) {
        filterDocument(pageStore, details);
    }

    // https://github.com/gorhill/uBlock/issues/2813
    //   Disable the blocking of large media elements if the document is itself
    //   a media element: the resource was not prevented from loading so no
    //   point to further block large media elements for the current document.
    if ( isRootDoc ) {
        if ( reMediaContentTypes.test(headerValueFromName('content-type', details.responseHeaders)) ) {
            pageStore.allowLargeMediaElementsUntil = Date.now() + 86400000;
        }
        return injectCSP(pageStore, details);
    }

    if ( isDoc ) {
        return injectCSP(pageStore, details);
    }
};

var reMediaContentTypes = /^(?:audio|image|video)\//;

/*******************************************************************************

    The response body filterer is responsible for:

    - Scriptlet filtering
    - HTML filtering

    In the spirit of efficiency, the response body filterer works this way:

    If:
        - HTML filtering: no.
        - Scriptlet filtering: no.
    Then:
        No response body filtering is initiated.

    If:
        - HTML filtering: no.
        - Scriptlet filtering: yes.
    Then:
        Inject scriptlets before first chunk of response body data reported
        then immediately disconnect response body data listener.

    If:
        - HTML filtering: yes.
        - Scriptlet filtering: no/yes.
    Then:
        Assemble all response body data into a single buffer. Once all the
        response data has been received, create a document from it. Then:
        - Inject scriptlets in the resulting DOM.
        - Remove all DOM elements matching HTML filters.
        Then serialize the resulting modified document as the new response
        body.

    This way, the overhead is minimal for when only scriptlets need to be
    injected.

    If the platform does not support response body filtering, the scriptlets
    will be injected the old way, through the content script.

**/

var filterDocument = (function() {
    var µb = µBlock,
        filterers = new Map(),
        domParser, xmlSerializer,
        utf8TextDecoder, textDecoder, textEncoder;

    var reContentTypeDocument = /^(?:text\/html|application\/xhtml+xml)/i,
        reContentTypeCharset = /charset=['"]?([^'" ]+)/i;

    var charsetFromContentType = function(contentType) {
        var match = reContentTypeCharset.exec(contentType);
        if ( match !== null ) {
            return match[1].toLowerCase();
        }
    };

    var charsetFromDoc = function(doc) {
        var meta = doc.querySelector('meta[charset]');
        if ( meta !== null ) {
            return meta.getAttribute('charset').toLowerCase();
        }
        meta = doc.querySelector(
            'meta[http-equiv="content-type" i][content]'
        );
        if ( meta !== null ) {
            return charsetFromContentType(meta.getAttribute('content'));
        }
    };

    // Purpose of following helper is to disconnect from watching the stream
    // if all the following conditions are fulfilled:
    // - Only need to inject scriptlets.
    // - Charset of resource is utf-8.
    // - A well-formed doc type declaration is found at the top.
    //
    // When all the conditions are fulfilled, then the scriptlets are safely
    // injected after the doc type declaration, and the stream listener is
    // disconnected, thus removing overhead from future streaming data.
    //
    // If at least one of the condition is not fulfilled and scriptlets need
    // to be injected, it will be done the longer way when the whole stream
    // has been collated in memory.

    var streamJobDone = function(filterer, responseBytes) {
        if (
            filterer.scriptlets === undefined ||
            filterer.selectors !== undefined ||
            filterer.charset === undefined
        ) {
            return false;
        }
        // We need to insert after DOCTYPE, or else the browser may fall into
        // quirks mode.
        if ( responseBytes.byteLength < 256 ) { return false; }
        var bb = new Uint8Array(responseBytes, 0, 256),
            i = 0, b;
        // Skip BOM if present.
        if ( bb[0] === 0xEF && bb[1] === 0xBB && bb[2] === 0xBF ) { i += 3; }
        // Scan for '<'
        for (;;) {
            b = bb[i++];
            if ( b === 0x3C /* '<' */ ) { break; }
            if ( b > 0x20 || i > 240 ) { return false; }
        }
        // Case insensitively test for '!doctype'.
        if (
              bb[i++]          !== 0x21 /* '!' */ ||
            ( bb[i++] | 0x20 ) !== 0x64 /* 'd' */ ||
            ( bb[i++] | 0x20 ) !== 0x6F /* 'o' */ ||
            ( bb[i++] | 0x20 ) !== 0x63 /* 'c' */ ||
            ( bb[i++] | 0x20 ) !== 0x74 /* 't' */ ||
            ( bb[i++] | 0x20 ) !== 0x79 /* 'y' */ ||
            ( bb[i++] | 0x20 ) !== 0x70 /* 'p' */ ||
            ( bb[i++] | 0x20 ) !== 0x65 /* 'e' */
        ) {
            return false;
        }
        // Scan for '>'.
        var qcount = 0;
        for (;;) {
            b = bb[i++];
            if ( b === 0x3E /* '>' */ ) { break; }
            if ( b === 0x22 /* '"' */ || b === 0x27 /* "'" */ ) { qcount += 1; }
            if ( b > 0x7F || i > 240 ) { return false; }
        }
        // Bail out if mismatched quotes.
        if ( (qcount & 1) !== 0 ) { return false; }
        // We found a valid insertion point.
        if ( textEncoder === undefined ) { textEncoder = new TextEncoder(); }
        filterer.stream.write(new Uint8Array(responseBytes, 0, i));
        filterer.stream.write(
            textEncoder.encode('<script>' + filterer.scriptlets + '</script>')
        );
        filterer.stream.write(new Uint8Array(responseBytes, i));
        filterer.stream.disconnect();
        return true;
    };

    var streamClose = function(filterer, buffer) {
        if ( buffer !== undefined ) {
            filterer.stream.write(buffer);
        } else if ( filterer.buffer !== undefined ) {
            filterer.stream.write(filterer.buffer);
        }
        filterer.stream.close();
    };

    var onStreamData = function(ev) {
        var filterer = filterers.get(this);
        if ( filterer === undefined ) {
            this.write(ev.data);
            this.disconnect();
            return;
        }
        if (
            this.status !== 'transferringdata' &&
            this.status !== 'finishedtransferringdata'
        ) {
            filterers.delete(this);
            this.disconnect();
            return;
        }
        // TODO:
        // - Possibly improve buffer growth, if benchmarking shows it's worth
        //   it.
        // - Also evaluate whether keeping a list of buffers and then decoding
        //   them in sequence using TextDecoder's "stream" option is more
        //   efficient. Can the data buffers be safely kept around for later
        //   use?
        // - Informal, quick benchmarks seem to show most of the overhead is
        //   from calling TextDecoder.decode() and TextEncoder.encode(), and if
        //   confirmed, there is nothing which can be done uBO-side to reduce
        //   overhead.
        if ( filterer.buffer === null ) {
            if ( streamJobDone(filterer, ev.data) ) { return; }
            filterer.buffer = new Uint8Array(ev.data);
            return;
        }
        var buffer = new Uint8Array(
            filterer.buffer.byteLength +
            ev.data.byteLength
        );
        buffer.set(filterer.buffer);
        buffer.set(new Uint8Array(ev.data), filterer.buffer.byteLength);
        filterer.buffer = buffer;
    };

    var onStreamStop = function() {
        var filterer = filterers.get(this);
        filterers.delete(this);
        if ( filterer === undefined || filterer.buffer === null ) {
            this.close();
            return;
        }
        if ( this.status !== 'finishedtransferringdata' ) { return; }

        if ( domParser === undefined ) {
            domParser = new DOMParser();
            xmlSerializer = new XMLSerializer();
        }
        if ( textEncoder === undefined ) {
            textEncoder = new TextEncoder();
        }

        var doc;

        // If stream encoding is still unknnown, try to extract from document.
        if ( filterer.charset === undefined ) {
            if ( utf8TextDecoder === undefined ) {
                utf8TextDecoder = new TextDecoder();
            }
            doc = domParser.parseFromString(
                utf8TextDecoder.decode(filterer.buffer.slice(0, 1024)),
                'text/html'
            );
            filterer.charset = µb.textEncode.normalizeCharset(charsetFromDoc(doc));
            if ( filterer.charset === undefined ) {
                streamClose(filterer);
                return;
            }
        }

        if (
            textDecoder !== undefined &&
            textDecoder.encoding !== filterer.charset
        ) {
            textDecoder = undefined;
        }
        if ( textDecoder === undefined ) {
            textDecoder = new TextDecoder(filterer.charset);
        }

        doc = domParser.parseFromString(
            textDecoder.decode(filterer.buffer),
            'text/html'
        );

        var modified = false;
        if ( filterer.selectors !== undefined ) {
            if ( µb.htmlFilteringEngine.apply(doc, filterer) ) {
                modified = true;
            }
        }
        if ( filterer.scriptlets !== undefined ) {
            if ( µb.scriptletFilteringEngine.apply(doc, filterer) ) {
                modified = true;
            }
        }

        if ( modified === false ) {
            streamClose(filterer);
            return;
        }

        // https://stackoverflow.com/questions/6088972/get-doctype-of-an-html-as-string-with-javascript/10162353#10162353
        var doctypeStr = doc.doctype instanceof Object ?
                xmlSerializer.serializeToString(doc.doctype) + '\n' :
                '';

        // https://github.com/gorhill/uBlock/issues/3391
        var encodedStream = textEncoder.encode(
            doctypeStr +
            doc.documentElement.outerHTML
        );
        if ( filterer.charset !== 'utf-8' ) {
            encodedStream = µb.textEncode.encode(
                filterer.charset,
                encodedStream
            );
        }

        streamClose(filterer, encodedStream);
    };

    var onStreamError = function() {
        filterers.delete(this);
    };

    return function(pageStore, details) {
        var hostname = µb.URI.hostnameFromURI(details.url);
        if ( hostname === '' ) { return; }

        var domain = µb.URI.domainFromHostname(hostname);

        var request = {
            stream: undefined,
            tabId: details.tabId,
            url: details.url,
            hostname: hostname,
            domain: domain,
            entity: µb.URI.entityFromDomain(domain),
            selectors: undefined,
            scriptlets: undefined,
            buffer: null,
            charset: undefined
        };
        request.selectors = µb.htmlFilteringEngine.retrieve(request);
        request.scriptlets = µb.scriptletFilteringEngine.retrieve(request);

        if (
            request.selectors === undefined &&
            request.scriptlets === undefined
        ) {
            return;
        }

        var headers = details.responseHeaders,
            contentType = headerValueFromName('content-type', headers);
        if ( contentType !== '' ) {
            if ( reContentTypeDocument.test(contentType) === false ) { return; }
            var charset = charsetFromContentType(contentType);
            if ( charset !== undefined ) {
                charset = µb.textEncode.normalizeCharset(charset);
                if ( charset === undefined ) { return; }
                request.charset = charset;
            }
        }
        // https://bugzilla.mozilla.org/show_bug.cgi?id=1426789
        if ( headerValueFromName('content-disposition', headers) ) { return; }

        var stream = request.stream =
            vAPI.net.webRequest.filterResponseData(details.requestId);
        stream.ondata = onStreamData;
        stream.onstop = onStreamStop;
        stream.onerror = onStreamError;
        filterers.set(stream, request);
    };
})();

/******************************************************************************/

var injectCSP = function(pageStore, details) {
    var µb = µBlock,
        tabId = details.tabId,
        requestURL = details.url,
        loggerEnabled = µb.logger.isEnabled(),
        logger = µb.logger,
        cspSubsets = [];

    var context = pageStore.createContextFromPage();
    context.requestHostname = µb.URI.hostnameFromURI(requestURL);
    if ( details.type !== 'main_frame' ) {
        context.pageHostname = context.pageDomain = context.requestHostname;
    }
    context.requestURL = requestURL;

    // Start collecting policies >>>>>>>>

    // ======== built-in policies

    var builtinDirectives = [];

    context.requestType = 'inline-script';
    if ( pageStore.filterRequest(context) === 1 ) {
        builtinDirectives.push("script-src 'unsafe-eval' * blob: data:");
    }
    if ( loggerEnabled === true ) {
        logger.writeOne(
            tabId,
            'net',
            pageStore.logData,
            'inline-script',
            requestURL,
            context.rootHostname,
            context.pageHostname
        );
    }

    // https://github.com/gorhill/uBlock/issues/1539
    // - Use a CSP to also forbid inline fonts if remote fonts are blocked.
    context.requestType = 'inline-font';
    if ( pageStore.filterRequest(context) === 1 ) {
        builtinDirectives.push('font-src *');
        if ( loggerEnabled === true ) {
            logger.writeOne(
                tabId,
                'net',
                pageStore.logData,
                'inline-font',
                requestURL,
                context.rootHostname,
                context.pageHostname
            );
        }
    }

    if ( builtinDirectives.length !== 0 ) {
        cspSubsets[0] = builtinDirectives.join('; ');
    }

    // ======== filter-based policies

    // Static filtering.

    var logDataEntries = [];

    µb.staticNetFilteringEngine.matchAndFetchData(
        'csp',
        requestURL,
        cspSubsets,
        loggerEnabled === true ? logDataEntries : undefined
    );

    // URL filtering `allow` rules override static filtering.
    if (
        cspSubsets.length !== 0 &&
        µb.sessionURLFiltering.evaluateZ(context.rootHostname, requestURL, 'csp') === 2
    ) {
        if ( loggerEnabled === true ) {
            logger.writeOne(
                tabId,
                'net',
                µb.sessionURLFiltering.toLogData(),
                'csp',
                requestURL,
                context.rootHostname,
                context.pageHostname
            );
        }
        context.dispose();
        return;
    }

    // Dynamic filtering `allow` rules override static filtering.
    if (
        cspSubsets.length !== 0 &&
        µb.userSettings.advancedUserEnabled &&
        µb.sessionFirewall.evaluateCellZY(context.rootHostname, context.rootHostname, '*') === 2
    ) {
        if ( loggerEnabled === true ) {
            logger.writeOne(
                tabId,
                'net',
                µb.sessionFirewall.toLogData(),
                'csp',
                requestURL,
                context.rootHostname,
                context.pageHostname
            );
        }
        context.dispose();
        return;
    }

    // <<<<<<<< All policies have been collected

    // Static CSP policies will be applied.
    for ( var entry of logDataEntries ) {
        logger.writeOne(
            tabId,
            'net',
            entry,
            'csp',
            requestURL,
            context.rootHostname,
            context.pageHostname
        );
    }

    context.dispose();

    if ( cspSubsets.length === 0 ) {
        return;
    }

    µb.updateBadgeAsync(tabId);

    var csp,
        headers = details.responseHeaders,
        i = headerIndexFromName('content-security-policy', headers);
    if ( i !== -1 ) {
        csp = headers[i].value.trim();
        headers.splice(i, 1);
    }
    cspSubsets = cspSubsets.join(', ');
    // Use comma to add a new subset to potentially existing one(s). This new
    // subset has its own reporting options and won't cause spurious CSP
    // reports to outside world.
    // Ref.: https://www.w3.org/TR/CSP2/#implementation-considerations
    headers.push({
        name: 'Content-Security-Policy',
        value: csp === undefined ? cspSubsets : csp + ', ' + cspSubsets
    });

    return { 'responseHeaders': headers };
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1163
//   "Block elements by size"

var foilLargeMediaElement = function(pageStore, details) {
    var µb = µBlock;

    var i = headerIndexFromName('content-length', details.responseHeaders);
    if ( i === -1 ) { return; }

    var tabId = details.tabId,
        size = parseInt(details.responseHeaders[i].value, 10) || 0,
        result = pageStore.filterLargeMediaElement(size);
    if ( result === 0 ) { return; }

    if ( µb.logger.isEnabled() ) {
        µb.logger.writeOne(
            tabId,
            'net',
            pageStore.logData,
            details.type,
            details.url,
            pageStore.tabHostname,
            pageStore.tabHostname
        );
    }

    return { cancel: true };
};

/******************************************************************************/

// Caller must ensure headerName is normalized to lower case.

var headerIndexFromName = function(headerName, headers) {
    var i = headers.length;
    while ( i-- ) {
        if ( headers[i].name.toLowerCase() === headerName ) {
            return i;
        }
    }
    return -1;
};

var headerValueFromName = function(headerName, headers) {
    var i = headerIndexFromName(headerName, headers);
    return i !== -1 ? headers[i].value : '';
};

/******************************************************************************/

vAPI.net.onBeforeRequest = {
    urls: [
        'http://*/*',
        'https://*/*'
    ],
    extra: [ 'blocking' ],
    callback: onBeforeRequest
};

vAPI.net.onBeforeMaybeSpuriousCSPReport = {
    callback: onBeforeMaybeSpuriousCSPReport
};

vAPI.net.onHeadersReceived = {
    urls: [
        'http://*/*',
        'https://*/*'
    ],
    types: [
        'main_frame',
        'sub_frame',
        'image',
        'media'
    ],
    extra: [ 'blocking', 'responseHeaders' ],
    callback: onHeadersReceived
};

vAPI.net.registerListeners();

/******************************************************************************/

var isTemporarilyWhitelisted = function(result, hostname) {
    var obsolete, pos;

    for (;;) {
        obsolete = documentWhitelists[hostname];
        if ( obsolete !== undefined ) {
            if ( obsolete > Date.now() ) {
                if ( result === 0 ) {
                    return 2;
                }
            } else {
                delete documentWhitelists[hostname];
            }
        }
        pos = hostname.indexOf('.');
        if ( pos === -1 ) { break; }
        hostname = hostname.slice(pos + 1);
    }
    return result;
};

var documentWhitelists = Object.create(null);

/******************************************************************************/

exports.temporarilyWhitelistDocument = function(hostname) {
    if ( typeof hostname !== 'string' || hostname === '' ) {
        return;
    }

    documentWhitelists[hostname] = Date.now() + 60 * 1000;
};

/******************************************************************************/

return exports;

/******************************************************************************/

})();

/******************************************************************************/

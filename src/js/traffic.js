/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 Raymond Hill

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

// Intercept and filter web requests.

var onBeforeRequest = function(details) {
    // Special handling for root document.
    // https://github.com/chrisaljoudi/uBlock/issues/1001
    // This must be executed regardless of whether the request is
    // behind-the-scene
    var requestType = details.type;
    if ( requestType === 'main_frame' ) {
        return onBeforeRootFrameRequest(details);
    }

    // https://github.com/gorhill/uBlock/issues/870
    // This work for Chromium 49+.
    if ( requestType === 'beacon' ) {
        return onBeforeBeacon(details);
    }

    // Special treatment: behind-the-scene requests
    var tabId = details.tabId;
    if ( vAPI.isBehindTheSceneTabId(tabId) ) {
        return onBeforeBehindTheSceneRequest(details);
    }

    // Lookup the page store associated with this tab id.
    var µb = µBlock;
    var pageStore = µb.pageStoreFromTabId(tabId);
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
    var requestContext = pageStore.createContextFromFrameId(isFrame ? details.parentFrameId : details.frameId);

    // Setup context and evaluate
    var requestURL = details.url;
    requestContext.requestURL = requestURL;
    requestContext.requestHostname = µb.URI.hostnameFromURI(requestURL);
    requestContext.requestType = requestType;

    var result = pageStore.filterRequest(requestContext);

    // Possible outcomes: blocked, allowed-passthru, allowed-mirror

    pageStore.logRequest(requestContext, result);

    if ( µb.logger.isEnabled() ) {
        µb.logger.writeOne(
            tabId,
            'net',
            result,
            requestType,
            requestURL,
            requestContext.rootHostname,
            requestContext.pageHostname
        );
    }

    // Not blocked
    if ( µb.isAllowResult(result) ) {
        // https://github.com/chrisaljoudi/uBlock/issues/114
        if ( details.parentFrameId !== -1 && isFrame ) {
            pageStore.setFrame(details.frameId, requestURL);
        }
        requestContext.dispose();
        return;
    }

    // Blocked

    // https://github.com/chrisaljoudi/uBlock/issues/905#issuecomment-76543649
    // No point updating the badge if it's not being displayed.
    if ( µb.userSettings.showIconBadge ) {
        µb.updateBadgeAsync(tabId);
    }

    // https://github.com/gorhill/uBlock/issues/949
    // Redirect blocked request?
    var url = µb.redirectEngine.toURL(requestContext);
    if ( url !== undefined ) {
        if ( µb.logger.isEnabled() ) {
            µb.logger.writeOne(
                tabId,
                'redirect',
                'rr:' + µb.redirectEngine.resourceNameRegister,
                requestType,
                requestURL,
                requestContext.rootHostname,
                requestContext.pageHostname
            );
        }
        requestContext.dispose();
        return { redirectUrl: url };
    }

    requestContext.dispose();
    return { cancel: true };
};

/******************************************************************************/

var onBeforeRootFrameRequest = function(details) {
    var tabId = details.tabId;
    var requestURL = details.url;
    var µb = µBlock;

    µb.tabContextManager.push(tabId, requestURL);

    // Special handling for root document.
    // https://github.com/chrisaljoudi/uBlock/issues/1001
    // This must be executed regardless of whether the request is
    // behind-the-scene
    var µburi = µb.URI;
    var requestHostname = µburi.hostnameFromURI(requestURL);
    var requestDomain = µburi.domainFromHostname(requestHostname) || requestHostname;
    var context = {
        rootHostname: requestHostname,
        rootDomain: requestDomain,
        pageHostname: requestHostname,
        pageDomain: requestDomain,
        requestURL: requestURL,
        requestHostname: requestHostname,
        requestType: 'main_frame'
    };

    var result = '';

    // If the site is whitelisted, disregard strict blocking
    if ( µb.getNetFilteringSwitch(requestURL) === false ) {
        result = 'ua:whitelisted';
    }

    // Permanently unrestricted?
    if ( result === '' && µb.hnSwitches.evaluateZ('no-strict-blocking', requestHostname) ) {
        result = 'ua:no-strict-blocking: ' + µb.hnSwitches.z + ' true';
    }

    // Temporarily whitelisted?
    if ( result === '' ) {
        result = isTemporarilyWhitelisted(result, requestHostname);
        if ( result.charAt(1) === 'a' ) {
            result = 'ua:no-strict-blocking true (temporary)';
        }
    }

    // Static filtering: We always need the long-form result here.
    var snfe = µb.staticNetFilteringEngine;

    // Check for specific block
    if (
        result === '' &&
        snfe.matchStringExactType(context, requestURL, 'main_frame') !== undefined
    ) {
        result = snfe.toResultString(true);
    }

    // Check for generic block
    if (
        result === '' &&
        snfe.matchStringExactType(context, requestURL, 'no_type') !== undefined
    ) {
        result = snfe.toResultString(true);
        // https://github.com/chrisaljoudi/uBlock/issues/1128
        // Do not block if the match begins after the hostname, except when
        // the filter is specifically of type `other`.
        // https://github.com/gorhill/uBlock/issues/490
        // Removing this for the time being, will need a new, dedicated type.
        if ( result.charAt(1) === 'b' ) {
            result = toBlockDocResult(requestURL, requestHostname, result);
        }
    }

    // Log
    var pageStore = µb.bindTabToPageStats(tabId, 'beforeRequest');
    if ( pageStore ) {
        pageStore.logRequest(context, result);
    }

    if ( µb.logger.isEnabled() ) {
        µb.logger.writeOne(
            tabId,
            'net',
            result,
            'main_frame',
            requestURL,
            requestHostname,
            requestHostname
        );
    }

    // Not blocked
    if ( µb.isAllowResult(result) ) {
        return;
    }

    var compiled = result.slice(3);

    // Blocked
    var query = btoa(JSON.stringify({
        url: requestURL,
        hn: requestHostname,
        dn: requestDomain,
        fc: compiled,
        fs: snfe.filterStringFromCompiled(compiled)
    }));

    vAPI.tabs.replace(tabId, vAPI.getURL('document-blocked.html?details=') + query);

    return { cancel: true };
};

/******************************************************************************/

var toBlockDocResult = function(url, hostname, result) {
    // Make a regex out of the result
    var re = µBlock.staticNetFilteringEngine
                   .filterRegexFromCompiled(result.slice(3), 'gi');
    if ( re === null ) {
        return '';
    }
    var matches = re.exec(url);
    if ( matches === null ) {
        return '';
    }

    // https://github.com/chrisaljoudi/uBlock/issues/1128
    // https://github.com/chrisaljoudi/uBlock/issues/1212
    // Relax the rule: verify that the match is completely before the path part
    if ( re.lastIndex <= url.indexOf(hostname) + hostname.length + 1 ) {
        return result;
    }

    return '';
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/870
// Finally, Chromium 49+ gained the ability to report network request of type
// `beacon`, so now we can block them according to the state of the
// "Disable hyperlink auditing/beacon" setting.

var onBeforeBeacon = function(details) {
    var µb = µBlock;
    var tabId = details.tabId;
    var pageStore = µb.mustPageStoreFromTabId(tabId);
    var context = pageStore.createContextFromPage();
    context.requestURL = details.url;
    context.requestHostname = µb.URI.hostnameFromURI(details.url);
    context.requestType = details.type;
    // "g" in "gb:" stands for "global setting"
    var result = µb.userSettings.hyperlinkAuditingDisabled ? 'gb:' : '';
    pageStore.logRequest(context, result);
    if ( µb.logger.isEnabled() ) {
        µb.logger.writeOne(
            tabId,
            'net',
            result,
            details.type,
            details.url,
            context.rootHostname,
            context.rootHostname
        );
    }
    context.dispose();
    if ( result !== '' ) {
        return { cancel: true };
    }
};

/******************************************************************************/

// Intercept and filter behind-the-scene requests.

var onBeforeBehindTheSceneRequest = function(details) {
    var µb = µBlock;
    var pageStore = µb.pageStoreFromTabId(vAPI.noTabId);
    if ( !pageStore ) {
        return;
    }

    var context = pageStore.createContextFromPage();
    var requestURL = details.url;
    context.requestURL = requestURL;
    context.requestHostname = µb.URI.hostnameFromURI(requestURL);
    context.requestType = details.type;

    // Blocking behind-the-scene requests can break a lot of stuff: prevent
    // browser updates, prevent extension updates, prevent extensions from
    // working properly, etc.
    // So we filter if and only if the "advanced user" mode is selected
    var result = '';
    if ( µb.userSettings.advancedUserEnabled ) {
        result = pageStore.filterRequestNoCache(context);
    }

    pageStore.logRequest(context, result);

    if ( µb.logger.isEnabled() ) {
        µb.logger.writeOne(
            vAPI.noTabId,
            'net',
            result,
            details.type,
            requestURL,
            context.rootHostname,
            context.rootHostname
        );
    }

    context.dispose();

    // Not blocked
    if ( µb.isAllowResult(result) ) {
        return;
    }

    // Blocked
    return { 'cancel': true };
};

/******************************************************************************/

// To handle:
// - inline script tags
// - media elements larger than n kB

var onHeadersReceived = function(details) {
    // Do not interfere with behind-the-scene requests.
    var tabId = details.tabId;
    if ( vAPI.isBehindTheSceneTabId(tabId) ) {
        return;
    }

    var requestType = details.type;

    if ( requestType === 'main_frame' ) {
        return onRootFrameHeadersReceived(details);
    }

    if ( requestType === 'sub_frame' ) {
        return onFrameHeadersReceived(details);
    }

    if ( requestType === 'image' || requestType === 'media' ) {
        return foilLargeMediaElement(details);
    }
};

/******************************************************************************/

var onRootFrameHeadersReceived = function(details) {
    var µb = µBlock,
        tabId = details.tabId;

    µb.tabContextManager.push(tabId, details.url);

    // Lookup the page store associated with this tab id.
    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( !pageStore ) {
        pageStore = µb.bindTabToPageStats(tabId, 'beforeRequest');
    }
    // I can't think of how pageStore could be null at this point.

    return processCSP(details, pageStore, pageStore.createContextFromPage());
};

/******************************************************************************/

var onFrameHeadersReceived = function(details) {
    // Lookup the page store associated with this tab id.
    var pageStore = µBlock.pageStoreFromTabId(details.tabId);
    if ( !pageStore ) {
        return;
    }

    // Frame id of frame request is their own id, while the request is made
    // in the context of the parent.
    return processCSP(
        details,
        pageStore,
        pageStore.createContextFromFrameId(details.frameId)
    );
};

/******************************************************************************/

var processCSP = function(details, pageStore, context) {
    var µb = µBlock,
        tabId = details.tabId,
        requestURL = details.url,
        loggerEnabled = µb.logger.isEnabled();

    context.requestURL = requestURL;
    context.requestHostname = µb.URI.hostnameFromURI(requestURL);

    context.requestType = 'inline-script';
    var inlineScriptResult = pageStore.filterRequestNoCache(context),
        blockInlineScript = µb.isBlockResult(inlineScriptResult);

    context.requestType = 'websocket';
    µb.staticNetFilteringEngine.matchStringExactType(context, requestURL, 'websocket');
    var websocketResult = µb.staticNetFilteringEngine.toResultString(loggerEnabled),
        blockWebsocket = µb.isBlockResult(websocketResult);

    var headersChanged = false;
    if ( blockInlineScript || blockWebsocket ) {
        headersChanged = foilWithCSP(
            details.responseHeaders,
            blockInlineScript,
            blockWebsocket
        );
    }

    if ( loggerEnabled ) {
        µb.logger.writeOne(
            tabId,
            'net',
            inlineScriptResult,
            'inline-script',
            requestURL,
            context.rootHostname,
            context.pageHostname
        );
    }

    if ( loggerEnabled && blockWebsocket ) {
        µb.logger.writeOne(
            tabId,
            'net',
            websocketResult,
            'websocket',
            requestURL,
            context.rootHostname,
            context.pageHostname
        );
    }

    context.dispose();

    if ( headersChanged !== true ) {
        return;
    }

    µb.updateBadgeAsync(tabId);

    return { 'responseHeaders': details.responseHeaders };
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1163
// "Block elements by size"

var foilLargeMediaElement = function(details) {
    var µb = µBlock;
    var tabId = details.tabId;
    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore === null ) {
        return;
    }
    if ( pageStore.getNetFilteringSwitch() !== true ) {
        return;
    }
    if ( Date.now() < pageStore.allowLargeMediaElementsUntil ) {
        return;
    }
    if ( µb.hnSwitches.evaluateZ('no-large-media', pageStore.tabHostname) !== true ) {
        return;
    }
    var i = headerIndexFromName('content-length', details.responseHeaders);
    if ( i === -1 ) {
        return;
    }
    var contentLength = parseInt(details.responseHeaders[i].value, 10) || 0;
    if ( (contentLength >>> 10) < µb.userSettings.largeMediaSize ) {
        return;
    }

    pageStore.logLargeMedia();

    if ( µb.logger.isEnabled() ) {
        µb.logger.writeOne(
            tabId,
            'net',
            µb.hnSwitches.toResultString(),
            details.type,
            details.url,
            pageStore.tabHostname,
            pageStore.tabHostname
        );
    }

    return { cancel: true };
};

/******************************************************************************/

var foilWithCSP = function(headers, noInlineScript, noWebsocket) {
    var i = headerIndexFromName('content-security-policy', headers),
        before = i === -1 ? '' : headers[i].value.trim(),
        after = before;

    if ( noInlineScript ) {
        after = foilWithCSPDirective(
            after,
            /script-src[^;]*;?\s*/,
            "script-src 'unsafe-eval' *",
            /'unsafe-inline'\s*|'nonce-[^']+'\s*/g
        );
    }

    if ( noWebsocket ) {
        after = foilWithCSPDirective(
            after,
            /connect-src[^;]*;?\s*/,
            'connect-src http:',
            /wss?:[^\s]*\s*/g
        );
    }

    // https://bugs.chromium.org/p/chromium/issues/detail?id=513860
    //   Bad Chromium bug: web pages can work around CSP directives by
    //   creating data:- or blob:-based URI. So if we must restrict using CSP,
    //   we have no choice but to also prevent the creation of nested browsing
    //   contexts based on data:- or blob:-based URIs.
    if ( vAPI.chrome && (noInlineScript || noWebsocket) ) {
        // https://w3c.github.io/webappsec-csp/#directive-frame-src
        after = foilWithCSPDirective(
            after,
            /frame-src[^;]*;?\s*/,
            'frame-src http:',
            /data:[^\s]*\s*|blob:[^\s]*\s*/g
        );
    }

    var changed = after !== before;
    if ( changed ) {
        if ( i !== -1 ) {
            headers.splice(i, 1);
        }
        headers.push({ name: 'Content-Security-Policy', value: after });
    }

    return changed;
};

/******************************************************************************/

// Past issues to keep in mind:
// - https://github.com/gorhill/uMatrix/issues/129
// - https://github.com/gorhill/uMatrix/issues/320
// - https://github.com/gorhill/uBlock/issues/1909

var foilWithCSPDirective = function(csp, toExtract, toAdd, toRemove) {
    // Set
    if ( csp === '' ) {
        return toAdd;
    }

    var matches = toExtract.exec(csp);

    // Add
    if ( matches === null ) {
        if ( csp.slice(-1) !== ';' ) {
            csp += ';';
        }
        csp += ' ' + toAdd;
        return csp.replace(reReportDirective, '');
    }

    var directive = matches[0];

    // No change
    if ( toRemove.test(directive) === false ) {
        return csp;
    }

    // Remove
    csp = csp.replace(toExtract, '').trim();
    if ( csp.slice(-1) !== ';' ) {
        csp += ';';
    }
    directive = directive.replace(toRemove, '').trim();

    // Check for empty directive after removal
    matches = reEmptyDirective.exec(directive);
    if ( matches ) {
        directive = matches[1] + " 'none';";
    }

    csp += ' ' + directive;
    return csp.replace(reReportDirective, '');
};

// https://w3c.github.io/webappsec-csp/#directives-reporting
var reReportDirective = /report-(?:to|uri)[^;]*;?\s*/;
var reEmptyDirective = /^([a-z-]+)\s*;/;

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

/******************************************************************************/

vAPI.net.onBeforeRequest = {
    urls: [
        'http://*/*',
        'https://*/*'
    ],
    extra: [ 'blocking' ],
    callback: onBeforeRequest
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

//console.log('traffic.js > Beginning to intercept net requests at %s', (new Date()).toISOString());

/******************************************************************************/

var isTemporarilyWhitelisted = function(result, hostname) {
    var obsolete, pos;

    for (;;) {
        obsolete = documentWhitelists[hostname];
        if ( obsolete !== undefined ) {
            if ( obsolete > Date.now() ) {
                if ( result === '' ) {
                    return 'ua:*' + ' ' + hostname + ' doc allow';
                }
            } else {
                delete documentWhitelists[hostname];
            }
        }
        pos = hostname.indexOf('.');
        if ( pos === -1 ) {
            break;
        }
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

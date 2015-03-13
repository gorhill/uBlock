/*******************************************************************************

    µBlock - a browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

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

/* global µBlock, vAPI */

/******************************************************************************/

// Start isolation from global scope

µBlock.webRequest = (function() {

'use strict';

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1001
// This is to be used as last-resort fallback in case a tab is found to not
// be bound while network requests are fired for the tab.

var mostRecentRootDocURL = '';

/******************************************************************************/

// Intercept and filter web requests.

var onBeforeRequest = function(details) {
    //console.debug('µBlock.webRequest/onBeforeRequest(): "%s": %o', details.url, details);
    console.debug('µBlock.webRequest/onBeforeRequest(): "type=%s, id=%d, parent id=%d, url=%s', details.type, details.frameId, details.parentFrameId, details.url);

    var µb = µBlock;
    var tabId = details.tabId;
    var requestType = details.type;
    var requestURL = details.url;

    // Special handling for root document.
    // https://github.com/gorhill/uBlock/issues/1001
    // This must be executed regardless of whether the request is
    // behind-the-scene
    if ( requestType === 'main_frame' && details.parentFrameId === -1 ) {
        pageStore = µb.bindTabToPageStats(tabId, requestURL, 'beforeRequest');
        if ( pageStore !== null ) {
            pageStore.requestURL = requestURL;
            pageStore.requestHostname = pageStore.pageHostname;
            pageStore.requestType = 'main_frame';
            pageStore.logRequest(pageStore, '');
        }
        mostRecentRootDocURL = requestURL;
        return;
    }

    // Special treatment: behind-the-scene requests
    if ( vAPI.isNoTabId(tabId) ) {
        return onBeforeBehindTheSceneRequest(details);
    }

    var pageStore;

    // Lookup the page store associated with this tab id.
    pageStore = µb.pageStoreFromTabId(tabId);
    if ( !pageStore ) {
        // https://github.com/gorhill/uBlock/issues/1001
        // Not a behind-the-scene request, yet no page store found for the
        // tab id: we will thus bind the last-seen root document to the
        // unbound tab. It's a guess, but better than ending up filtering
        // nothing at all.
        if ( mostRecentRootDocURL !== '' ) {
            pageStore = µb.bindTabToPageStats(tabId, mostRecentRootDocURL, 'beforeRequest');
        }
        if ( !pageStore ) {
            return;
        }
    }

    // https://github.com/gorhill/uBlock/issues/114
    var requestContext = pageStore;
    var frameStore;
    // https://github.com/gorhill/uBlock/issues/886
    // For requests of type `sub_frame`, the parent frame id must be used
    // to lookup the proper context:
    // > If the document of a (sub-)frame is loaded (type is main_frame or
    // > sub_frame), frameId indicates the ID of this frame, not the ID of
    // > the outer frame.
    // > (ref: https://developer.chrome.com/extensions/webRequest)
    var isFrame = requestType === 'sub_frame' || requestType === 'main_frame';
    var frameId = isFrame ? details.parentFrameId : details.frameId;
    if ( frameId > 0 ) {
        if ( frameStore = pageStore.getFrame(frameId) ) {
            requestContext = frameStore;
        }
    }

    // Setup context and evaluate
    requestContext.requestURL = requestURL;
    requestContext.requestHostname = details.hostname;
    requestContext.requestType = requestType;

    var result = pageStore.filterRequest(requestContext);

    // Possible outcomes: blocked, allowed-passthru, allowed-mirror

    // Not blocked
    if ( µb.isAllowResult(result) ) {
        //console.debug('traffic.js > onBeforeRequest(): ALLOW "%s" (%o) because "%s"', details.url, details, result);

        // https://github.com/gorhill/uBlock/issues/114
        frameId = details.frameId;
        if ( frameId > 0 ) {
            if ( isFrame  ) {
                pageStore.setFrame(frameId, requestURL);
            } else if ( pageStore.getFrame(frameId) === null ) {
                pageStore.setFrame(frameId, requestURL);
            }
        }

        // https://code.google.com/p/chromium/issues/detail?id=387198
        // Not all redirects will succeed, until bug above is fixed.
        // https://github.com/gorhill/uBlock/issues/540
        // Disabling local mirroring for the time being
        //var redirectURL = pageStore.toMirrorURL(requestURL);
        //if ( redirectURL !== '' ) {
        //    pageStore.logRequest(requestContext, 'ma:');
            //console.debug('traffic.js > "%s" redirected to "%s..."', requestURL.slice(0, 50), redirectURL.slice(0, 50));
        //    return { redirectUrl: redirectURL };
        //}

        pageStore.logRequest(requestContext, result);

        return;
    }

    // Blocked
    //console.debug('traffic.js > onBeforeRequest(): BLOCK "%s" (%o) because "%s"', details.url, details, result);

    pageStore.logRequest(requestContext, result);

    // https://github.com/gorhill/uBlock/issues/905#issuecomment-76543649
    // No point updating the badge if it's not being displayed.
    if ( µb.userSettings.showIconBadge ) {
        µb.updateBadgeAsync(tabId);
    }

    // https://github.com/gorhill/uBlock/issues/18
    // Do not use redirection, we need to block outright to be sure the request
    // will not be made. There can be no such guarantee with redirection.

    return { 'cancel': true };
};

/******************************************************************************/

// Intercept and filter behind-the-scene requests.

var onBeforeBehindTheSceneRequest = function(details) {
    //console.debug('traffic.js > onBeforeBehindTheSceneRequest(): "%s": %o', details.url, details);

    var µb = µBlock;
    var pageStore = µb.pageStoreFromTabId(vAPI.noTabId);
    if ( !pageStore ) {
        return;
    }

    pageStore.requestURL = details.url;
    pageStore.requestHostname = details.hostname;
    pageStore.requestType = details.type;

    // Blocking behind-the-scene requests can break a lot of stuff: prevent
    // browser updates, prevent extension updates, prevent extensions from
    // working properly, etc.
    // So we filter if and only if the "advanced user" mode is selected
    var result = '';
    if ( µb.userSettings.advancedUserEnabled ) {
        result = pageStore.filterRequestNoCache(pageStore);
    }

    pageStore.logRequest(pageStore, result);

    // Not blocked
    if ( µb.isAllowResult(result) ) {
        //console.debug('traffic.js > onBeforeBehindTheSceneRequest(): ALLOW "%s" (%o) because "%s"', details.url, details, result);
        return;
    }

    // Blocked
    //console.debug('traffic.js > onBeforeBehindTheSceneRequest(): BLOCK "%s" (%o) because "%s"', details.url, details, result);

    return { 'cancel': true };
};

/******************************************************************************/

// To handle `inline-script`.

var onHeadersReceived = function(details) {
    // Do not interfere with behind-the-scene requests.
    var tabId = details.tabId;
    if ( vAPI.isNoTabId(tabId) ) {
        return;
    }

    var requestURL = details.url;

    // Lookup the page store associated with this tab id.
    var µb = µBlock;
    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( !pageStore ) {
        if ( details.type === 'main_frame' && details.parentFrameId === -1 ) {
            pageStore = µb.bindTabToPageStats(tabId, requestURL, 'beforeRequest');
        }
        if ( !pageStore ) {
            return;
        }
    }

    // https://github.com/gorhill/uBlock/issues/384
    // https://github.com/gorhill/uBlock/issues/540
    // Disabling local mirroring for the time being
    //if ( details.parentFrameId === -1 ) {
    //    pageStore.skipLocalMirroring = headerStartsWith(details.responseHeaders, 'content-security-policy') !== '';
    //}

    var requestHostname = details.hostname;

    // https://github.com/gorhill/uBlock/issues/525
    // When we are dealing with the root frame, due to fix to issue #516, it
    // is likely the root frame has not been bound yet to the tab, and thus
    // we could end up using the context of the previous page for filtering.
    // So when the request is that of a root frame, simply create an
    // artificial context, this will ensure we are properly filtering
    // inline scripts.
    var context;
    if ( details.parentFrameId === -1 ) {
        var contextDomain = µb.URI.domainFromHostname(requestHostname);
        context = {
            rootHostname: requestHostname,
            rootDomain: contextDomain,
            pageHostname: requestHostname,
            pageDomain: contextDomain
        };
    } else {
        context = pageStore;
    }

    // Concatenating with '{inline-script}' so that the network request cache
    // can distinguish from the document itself
    // The cache should do whatever it takes to not confuse same
    // URLs-different type
    context.requestURL = requestURL + '{inline-script}';
    context.requestHostname = requestHostname;
    context.requestType = 'inline-script';

    var result = pageStore.filterRequest(context);

    pageStore.logRequest(context, result);

    // Don't block
    if ( µb.isAllowResult(result) ) {
        return;
    }

    µb.updateBadgeAsync(tabId);

    details.responseHeaders.push({
        'name': 'Content-Security-Policy',
        'value': "script-src 'unsafe-eval' *"
    });

    return { 'responseHeaders': details.responseHeaders };
};

/******************************************************************************/

vAPI.net.onBeforeRequest = {
    urls: [
        'http://*/*',
        'https://*/*'
    ],
    types: [
        "main_frame",
        "sub_frame",
        'stylesheet',
        "script",
        "image",
        "object",
        "xmlhttprequest",
        "other"
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
        "main_frame",
        "sub_frame"
    ],
    extra: [ 'blocking', 'responseHeaders' ],
    callback: onHeadersReceived
};

vAPI.net.registerListeners();

//console.log('traffic.js > Beginning to intercept net requests at %s', (new Date()).toISOString());

/******************************************************************************/

})();

/******************************************************************************/


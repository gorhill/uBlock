/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
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

// Intercept and filter web requests.

var onBeforeRequest = function(details) {
    //console.debug('traffic.js > onBeforeRequest(): "%s": %o', details.url, details);

    var tabId = details.tabId;

    // Special treatment: behind-the-scene requests
    if ( vAPI.isNoTabId(tabId) ) {
        return onBeforeBehindTheSceneRequest(details);
    }

    var µb = µBlock;
    var requestURL = details.url;
    var requestType = details.type;
    var pageStore;

    // Special handling for root document.
    if ( requestType === 'main_frame' && details.parentFrameId === -1 ) {
        pageStore = µb.bindTabToPageStats(tabId, requestURL, 'beforeRequest');
        // Log for convenience
        if ( pageStore !== null ) {
            pageStore.requestURL = requestURL;
            pageStore.requestHostname = pageStore.pageHostname;
            pageStore.requestType = 'main_frame';
            pageStore.logRequest(pageStore, '');
        }
        return;
    }

    // Lookup the page store associated with this tab id.
    pageStore = µb.pageStoreFromTabId(tabId);
    if ( !pageStore ) {
        return;
    }

    // https://github.com/gorhill/uBlock/issues/114
    var requestContext = pageStore;
    var frameStore;
    var frameId = details.frameId;
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
        if ( frameId > 0 && frameStore === undefined ) {
            pageStore.addFrame(frameId, requestURL);
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

    µb.updateBadgeAsync(tabId);

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

// Intercept root frame requests. This is where we identify and block popups.

var onBeforeSendHeaders = function(details) {
    // TODO: I vaguely remember reading that when pre-fetch is enabled,
    // the tab id could be -1, despite the request not really being a
    // behind-the-scene request. If true, the test below would prevent
    // the popup blocker from working. Need to check this.
    //console.debug('traffic.js > onBeforeSendHeaders(): "%s" (%o) because "%s"', details.url, details, result);

    // Do not block behind the scene requests.
    var tabId = details.tabId;
    if ( vAPI.isNoTabId(tabId) ) {
        return;
    }

    // Only root document.
    if ( details.parentFrameId !== -1 ) {
        return;
    }

    var µb = µBlock;
    var requestURL = details.url;

    // Lookup the page store associated with this tab id.
    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( !pageStore ) {
        // This happens under normal circumstances in Opera.
        return;
    }

    // Heuristic to determine whether we are dealing with a popup:
    // - the page store is new (it's not a reused one)
    // - the referrer is not nil

    // Can't be a popup, the tab was in use previously.
    if ( pageStore.previousPageURL !== '' ) {
        return;
    }

    var referrer = headerValue(details.requestHeaders, 'referer');
    if ( referrer === '' ) {
        return;
    }

    // https://github.com/gorhill/uBlock/issues/323
    if ( pageStore.getNetFilteringSwitch() === false ) {
        return;
    }

    // TODO: I think I should test the switch of the referrer instead, not the
    // switch of the popup. If so, that would require being able to lookup
    // a page store from a URL. Have to keep in mind the same URL can appear
    // in multiple tabs.

    // https://github.com/gorhill/uBlock/issues/67
    // We need to pass the details of the page which opened this popup,
    // so that the `third-party` option works.
    // Create a synthetic context based on the referrer.
    var µburi = µb.URI;
    var referrerHostname = µburi.hostnameFromURI(referrer);
    var pageDetails = {
        pageHostname: referrerHostname,
        pageDomain: µburi.domainFromHostname(referrerHostname)
    };
    pageDetails.rootHostname = pageDetails.pageHostname;
    pageDetails.rootDomain = pageDetails.pageDomain;
    //console.debug('traffic.js > Referrer="%s"', referrer);
    var result = µb.staticNetFilteringEngine.matchStringExactType(pageDetails, requestURL, 'popup');

    // Not blocked?
    if ( µb.isAllowResult(result) ) {
        return;
    }

    // It is a popup, block and remove the tab.
    µb.unbindTabFromPageStats(tabId);
    vAPI.tabs.remove(tabId);

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

    // Lookup the page store associated with this tab id.
    var µb = µBlock;
    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( !pageStore ) {
        return;
    }

    // https://github.com/gorhill/uBlock/issues/384
    // https://github.com/gorhill/uBlock/issues/540
    // Disabling local mirroring for the time being
    //if ( details.parentFrameId === -1 ) {
    //    pageStore.skipLocalMirroring = headerStartsWith(details.responseHeaders, 'content-security-policy') !== '';
    //}

    var requestURL = details.url;
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

var headerValue = function(headers, name) {
    var i = headers.length;
    while ( i-- ) {
        if ( headers[i].name.toLowerCase() === name ) {
            return headers[i].value;
        }
    }
    return '';
};

/******************************************************************************/

var headerStartsWith = function(headers, prefix) {
    var i = headers.length;
    while ( i-- ) {
        if ( headers[i].name.toLowerCase().lastIndexOf(prefix, 0) === 0 ) {
            return headers[i].value;
        }
    }
    return '';
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
    //function(details) {
    //    quickProfiler.start('onBeforeRequest');
    //    var r = onBeforeRequest(details);
    //    quickProfiler.stop();
    //    return r;
    //},
};

vAPI.net.onBeforeSendHeaders = {
    urls: [
        'http://*/*',
        'https://*/*'
    ],
    types: [
        "main_frame"
    ],
    extra: [ 'blocking', 'requestHeaders' ],
    callback: onBeforeSendHeaders
    //function(details) {
    //    quickProfiler.start('onBeforeSendHeaders');
    //    var r = onBeforeSendHeaders(details);
    //    quickProfiler.stop();
    //    return r;
    //},
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


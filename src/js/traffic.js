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

var exports = {};

// https://github.com/gorhill/uBlock/issues/1001
// This is to be used as last-resort fallback in case a tab is found to not
// be bound while network requests are fired for the tab.

var mostRecentRootDocURLTimestamp = 0;
var mostRecentRootDocURL = '';


var documentWhitelists = Object.create(null);

/******************************************************************************/

// Intercept and filter web requests.

var onBeforeRequest = function(details) {
    //console.debug('µBlock.webRequest/onBeforeRequest(): "%s": %o', details.url, details);
    //console.debug('µBlock.webRequest/onBeforeRequest(): "type=%s, id=%d, parent id=%d, url=%s', details.type, details.frameId, details.parentFrameId, details.url);

    // Special handling for root document.
    // https://github.com/gorhill/uBlock/issues/1001
    // This must be executed regardless of whether the request is
    // behind-the-scene
    var requestType = details.type;
    if ( requestType === 'main_frame' ) {
        return onBeforeRootFrameRequest(details);
    }

    // Special treatment: behind-the-scene requests
    var tabId = details.tabId;
    if ( vAPI.isNoTabId(tabId) ) {
        return onBeforeBehindTheSceneRequest(details);
    }

    // Lookup the page store associated with this tab id.
    var µb = µBlock;
    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( !pageStore ) {
        // https://github.com/gorhill/uBlock/issues/1025
        // Google Hangout popup opens without a root frame. So for now we will
        // just discard that best-guess root frame if it is too far in the
        // future, at which point it ceases to be a "best guess".
        if ( (Date.now() - mostRecentRootDocURLTimestamp) >= 500 ) {
            mostRecentRootDocURL = '';
        }
        // https://github.com/gorhill/uBlock/issues/1001
        // Not a behind-the-scene request, yet no page store found for the
        // tab id: we will thus bind the last-seen root document to the
        // unbound tab. It's a guess, but better than ending up filtering
        // nothing at all.
        if ( mostRecentRootDocURL !== '' ) {
            vAPI.tabs.onNavigation({ tabId: tabId, frameId: 0, url: mostRecentRootDocURL });
            pageStore = µb.pageStoreFromTabId(tabId);
        }
        // If all else fail at finding a page store, re-categorize the
        // request as behind-the-scene. At least this ensures that ultimately
        // the user can still inspect/filter those net requests which were
        // about to fall through the cracks.
        // Example: Chromium + case #12 at
        //          http://raymondhill.net/ublock/popup.html
        if ( !pageStore ) {
            return onBeforeBehindTheSceneRequest(details);
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
    var isFrame = requestType === 'sub_frame';
    var frameId = isFrame ? details.parentFrameId : details.frameId;
    if ( frameId > 0 ) {
        if ( frameStore = pageStore.getFrame(frameId) ) {
            requestContext = frameStore;
        }
    }

    // Setup context and evaluate
    var requestURL = details.url;
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

    return { cancel: true };
};

/******************************************************************************/

var onBeforeRootFrameRequest = function(details) {
    mostRecentRootDocURL = requestURL;
    mostRecentRootDocURLTimestamp = Date.now();

    // Special handling for root document.
    // https://github.com/gorhill/uBlock/issues/1001
    // This must be executed regardless of whether the request is
    // behind-the-scene
    var µb = µBlock;
    var requestURL = details.url;
    var requestHostname = details.hostname;
    var requestDomain = µb.URI.domainFromHostname(requestHostname);
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

    // Temporarily whitelisted?
    var obsolete = documentWhitelists[requestHostname];
    if ( obsolete !== undefined ) {
        if ( obsolete > Date.now() ) {
            result = 'da:*' + ' ' + requestHostname + ' doc allow';
        } else {
            delete documentWhitelists[requestHostname];
        }
    }

    // Filtering
    if ( result === '' && µb.getNetFilteringSwitch(requestURL) ) {
        if ( µb.userSettings.advancedUserEnabled ) {
            var df = µb.sessionFirewall.evaluateCellZY(requestHostname, requestHostname, '*');
            if ( df.mustBlockOrAllow() ) {
                result = df.toFilterString();
            }
        }
        if ( result === '' ) {
            result = µb.staticNetFilteringEngine.matchString(context);
        }
    }

    // Log
    var pageStore = µb.bindTabToPageStats(details.tabId, requestURL, 'beforeRequest');
    if ( pageStore ) {
        pageStore.logRequest(context, result);
    }

    // Not blocked
    if ( µb.isAllowResult(result) ) {
        return;
    }

    // Blocked
    var query = btoa(JSON.stringify({
        url: requestURL,
        why: result + '$document'
    }));
    return { redirectUrl: vAPI.getURL('document-blocked.html?details=') + query };
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
        if ( details.type === 'main_frame' ) {
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

exports.temporarilyWhitelistDocument = function(url) {
    var µb = µBlock;
    var hostname = µb.URI.hostnameFromURI(url);
    if ( hostname === '' ) {
        return;
    }

    documentWhitelists[hostname] = Date.now() + 60 * 1000;
};

/******************************************************************************/

return exports;

/******************************************************************************/

})();

/******************************************************************************/


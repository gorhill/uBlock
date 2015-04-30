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

    Home: https://github.com/chrisaljoudi/uBlock
*/

/* global µBlock, vAPI */

/******************************************************************************/

// Start isolation from global scope

µBlock.webRequest = (function() {

'use strict';

/******************************************************************************/

var exports = {};

/******************************************************************************/

// Intercept and filter web requests.

var onBeforeRequest = function(details) {
    //console.debug('µBlock.webRequest/onBeforeRequest(): "%s": %o', details.url, details);
    //console.debug('µBlock.webRequest/onBeforeRequest(): "type=%s, id=%d, parent id=%d, url=%s', details.type, details.frameId, details.parentFrameId, details.url);

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
    var µb = µBlock;
    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( !pageStore ) {
        var tabContext = µb.tabContextManager.lookup(tabId);
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
    var frameId = isFrame ? details.parentFrameId : details.frameId;

    // https://github.com/chrisaljoudi/uBlock/issues/114
    var requestContext = pageStore.createContextFromFrameId(frameId);

    // Setup context and evaluate
    var requestURL = details.url;
    requestContext.requestURL = requestURL;
    requestContext.requestHostname = details.hostname;
    requestContext.requestType = requestType;

    var result = pageStore.filterRequest(requestContext);

    // Possible outcomes: blocked, allowed-passthru, allowed-mirror

    pageStore.logRequest(requestContext, result);
    µb.logger.writeOne(tabId, requestContext, result);

    // Not blocked
    if ( µb.isAllowResult(result) ) {
        //console.debug('traffic.js > onBeforeRequest(): ALLOW "%s" (%o) because "%s"', details.url, details, result);

        // https://github.com/chrisaljoudi/uBlock/issues/114
        frameId = details.frameId;
        if ( frameId > 0 ) {
            if ( isFrame  ) {
                pageStore.setFrame(frameId, requestURL);
            } else if ( pageStore.getFrame(frameId) === null ) {
                pageStore.setFrame(frameId, requestURL);
            }
        }

        return;
    }

    // Blocked
    //console.debug('traffic.js > onBeforeRequest(): BLOCK "%s" (%o) because "%s"', details.url, details, result);

    // https://github.com/chrisaljoudi/uBlock/issues/905#issuecomment-76543649
    // No point updating the badge if it's not being displayed.
    if ( µb.userSettings.showIconBadge ) {
        µb.updateBadgeAsync(tabId);
    }

    // https://github.com/chrisaljoudi/uBlock/issues/18
    // Do not use redirection, we need to block outright to be sure the request
    // will not be made. There can be no such guarantee with redirection.

    return { cancel: true };
};

/******************************************************************************/

var onBeforeRootFrameRequest = function(details) {
    var tabId = details.tabId;
    var requestURL = details.url;
    var µb = µBlock;

    µb.tabContextManager.push(tabId, requestURL);

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
    var pageStore = µb.bindTabToPageStats(tabId, 'beforeRequest');
    if ( pageStore ) {
        pageStore.logRequest(context, result);
    }
    µb.logger.writeOne(tabId, context, result);
};

/******************************************************************************/

var toBlockDocResult = function(url, hostname, result) {
    if ( result.charAt(1) !== 'b' ) {
        return '';
    }

    // Make a regex out of the result
    var reText = result.slice(3);
    var pos = reText.indexOf('$');
    if ( pos > 0 ) {
        reText = reText.slice(0, pos);
    }

    // We are going to have to take the long way to find out
    if ( reText.charAt(0) === '/' && reText.slice(-1) === '/' ) {
        reText = reText.slice(1, -1);
    } else {
        reText = reText
            .replace(/\./g, '\\.')
            .replace(/\?/g, '\\?')
            .replace(/^\|\|/, '')
            .replace(/\^/g, '.')
            .replace(/^\|/g, '^')
            .replace(/\|$/g, '$')
            .replace(/\*/g, '.*');
    }

    var re = new RegExp(reText, 'gi');
    var matches = re.exec(url);
    if ( matches === null ) {
        return '';
    }

    // make sure the match ends before the path-part of the URL (#1212)
    if ( re.lastIndex <= url.indexOf(hostname) + hostname.length + 1 ) {
        return result;
    }

    return '';
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

    var context = pageStore.createContextFromPage();
    context.requestURL = details.url;
    context.requestHostname = details.hostname;
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
    µb.logger.writeOne(vAPI.noTabId, context, result);

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
    if ( vAPI.isBehindTheSceneTabId(tabId) ) {
        return;
    }

    // Special handling for root document.
    if ( details.type === 'main_frame' ) {
        return onRootFrameHeadersReceived(details);
    }

    // If we reach this point, we are dealing with a sub_frame
 
    // Lookup the page store associated with this tab id.
    var µb = µBlock;
    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( !pageStore ) {
        return;
    }
    // Frame id of frame request is the their own id, while the request is made
    // in the context of the parent.
    var context = pageStore.createContextFromFrameId(details.parentFrameId);
    context.requestURL = details.url;
    context.requestHostname = details.hostname;
    context.requestType = 'inline-script';

    var result = pageStore.filterRequestNoCache(context);

    pageStore.logRequest(context, result);
    µb.logger.writeOne(tabId, context, result);

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

var onRootFrameHeadersReceived = function(details) {
    var tabId = details.tabId;
    var requestURL = details.url;
    var requestHostname = details.hostname;
    var µb = µBlock;

    // Check if the main_frame is a download
    // https://github.com/gorhill/uBlock/issues/111
    // We will assume that whatever root document is of type
    //   'application/x-[...]' is a download operation.
    // I confirmed this also work with original issue:
    //   https://github.com/chrisaljoudi/uBlock/issues/516
    if ( headerValue(details.responseHeaders, 'content-type').lastIndexOf('application/x-', 0) === 0 ) {
        µb.tabContextManager.unpush(tabId, requestURL);
    } else {
        µb.tabContextManager.push(tabId, requestURL);
    }

    // Lookup the page store associated with this tab id.
    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( !pageStore ) {
        pageStore = µb.bindTabToPageStats(tabId, 'beforeRequest');
    }

    var context = pageStore.createContextFromPage();
    context.requestURL = requestURL;
    context.requestHostname = requestHostname;
    context.requestType = 'inline-script';

    var result = pageStore.filterRequestNoCache(context);

    pageStore.logRequest(context, result);
    µb.logger.writeOne(tabId, context, result);

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
            return headers[i].value.trim();
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

return exports;

/******************************************************************************/

})();

/******************************************************************************/


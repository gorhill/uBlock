/*******************************************************************************

    uBlock - a browser extension to block requests.
    Copyright (C) 2014-2015 Raymond Hill

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

    // Special handling for root document.
    // https://github.com/chrisaljoudi/uBlock/issues/1001
    // This must be executed regardless of whether the request is
    // behind-the-scene
    var requestHostname = details.hostname;
    var requestDomain = µb.URI.domainFromHostname(requestHostname) || requestHostname;
    var context = {
        rootHostname: requestHostname,
        rootDomain: requestDomain,
        pageHostname: requestHostname,
        pageDomain: requestDomain,
        requestURL: requestURL,
        requestHostname: requestHostname,
        requestType: 'other'
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

    // Filtering
    var snfe = µb.staticNetFilteringEngine;
    if ( result === '' && snfe.matchString(context) !== undefined ) {
        // We always need the long-form result here.
        result = snfe.toResultString(true);
        // https://github.com/chrisaljoudi/uBlock/issues/1128
        // Do not block if the match begins after the hostname, except when
        // the filter is specifically of type `other`.
        if ( result.charAt(1) === 'b' && (snfe.keyRegister & 0xF0) !== 0x80 ) {
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

    if ( µb.logger.isEnabled() ) {
        µb.logger.writeOne(
            vAPI.noTabId,
            'net',
            result,
            details.type,
            details.url,
            context.rootHostname,
            context.rootHostname
        );
    }

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

    // Just in case...
    if ( details.type !== 'sub_frame' ) {
        return;
    }

    // If we reach this point, we are dealing with a sub_frame

    // Lookup the page store associated with this tab id.
    var µb = µBlock;
    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( !pageStore ) {
        return;
    }

    // Frame id of frame request is their own id, while the request is made
    // in the context of the parent.
    var context = pageStore.createContextFromFrameId(details.parentFrameId);
    context.requestURL = details.url;
    context.requestHostname = details.hostname;
    context.requestType = 'inline-script';

    var result = pageStore.filterRequestNoCache(context);

    pageStore.logRequest(context, result);

    if ( µb.logger.isEnabled() ) {
        µb.logger.writeOne(
            tabId,
            'net',
            result,
            'inline-script',
            details.url,
            context.rootHostname,
            context.pageHostname
        );
    }

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
    var µb = µBlock;

    µb.tabContextManager.push(tabId, details.url);

    // Lookup the page store associated with this tab id.
    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( !pageStore ) {
        pageStore = µb.bindTabToPageStats(tabId, 'beforeRequest');
    }
    // I can't think of how pageStore could be null at this point.

    var context = pageStore.createContextFromPage();
    context.requestURL = details.url;
    context.requestHostname = details.hostname;
    context.requestType = 'inline-script';

    var result = pageStore.filterRequestNoCache(context);

    pageStore.logRequest(context, result);

    if ( µb.logger.isEnabled() ) {
        µb.logger.writeOne(
            tabId,
            'net',
            result,
            'inline-script',
            details.url,
            context.rootHostname,
            context.pageHostname
        );
    }

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

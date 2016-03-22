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
    var frameId = isFrame ? details.parentFrameId : details.frameId;

    // https://github.com/chrisaljoudi/uBlock/issues/114
    var requestContext = pageStore.createContextFromFrameId(frameId);

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
        frameId = details.frameId;
        if ( frameId > 0 && isFrame ) {
            pageStore.setFrame(frameId, requestURL);
        }
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
        return { redirectUrl: url };
    }

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

    // Static filtering: We always need the long-form result here.
    var snfe = µb.staticNetFilteringEngine;

    // Check for specific block
    if ( result === '' && snfe.matchStringExactType(context, requestURL, 'main_frame') !== undefined ) {
        result = snfe.toResultString(true);
    }

    // Check for generic block
    if ( result === '' && snfe.matchString(context) !== undefined ) {
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
    var µb = µBlock;
    var tabId = details.tabId;
    var requestURL = details.url;

    µb.tabContextManager.push(tabId, requestURL);

    // Lookup the page store associated with this tab id.
    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( !pageStore ) {
        pageStore = µb.bindTabToPageStats(tabId, 'beforeRequest');
    }
    // I can't think of how pageStore could be null at this point.

    var context = pageStore.createContextFromPage();
    context.requestURL = requestURL;
    context.requestHostname = µb.URI.hostnameFromURI(requestURL);
    context.requestType = 'inline-script';

    var result = pageStore.filterRequestNoCache(context);

    pageStore.logRequest(context, result);

    if ( µb.logger.isEnabled() ) {
        µb.logger.writeOne(
            tabId,
            'net',
            result,
            'inline-script',
            requestURL,
            context.rootHostname,
            context.pageHostname
        );
    }

    // Don't block
    if ( µb.isAllowResult(result) ) {
        return;
    }

    µb.updateBadgeAsync(tabId);

    return { 'responseHeaders': foilInlineScripts(details.responseHeaders) };
};

/******************************************************************************/

var onFrameHeadersReceived = function(details) {
    var µb = µBlock;
    var tabId = details.tabId;

    // Lookup the page store associated with this tab id.
    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( !pageStore ) {
        return;
    }

    // Frame id of frame request is their own id, while the request is made
    // in the context of the parent.
    var context = pageStore.createContextFromFrameId(details.parentFrameId);
    var requestURL = details.url;
    context.requestURL = requestURL;
    context.requestHostname = µb.URI.hostnameFromURI(requestURL);
    context.requestType = 'inline-script';

    var result = pageStore.filterRequestNoCache(context);

    pageStore.logRequest(context, result);

    if ( µb.logger.isEnabled() ) {
        µb.logger.writeOne(
            tabId,
            'net',
            result,
            'inline-script',
            requestURL,
            context.rootHostname,
            context.pageHostname
        );
    }

    // Don't block
    if ( µb.isAllowResult(result) ) {
        return;
    }

    µb.updateBadgeAsync(tabId);

    return { 'responseHeaders': foilInlineScripts(details.responseHeaders) };
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

var foilInlineScripts = function(headers) {
    // Below is copy-pasta from uMatrix's project.

    // If javascript is not allowed, say so through a `Content-Security-Policy`
    // directive.
    // We block only inline-script tags, all the external javascript will be
    // blocked by our request handler.

    // https://github.com/gorhill/uMatrix/issues/129
    // https://github.com/gorhill/uMatrix/issues/320
    //   Modernize CSP injection:
    //   - Do not overwrite blindly possibly already present CSP header
    //   - Add CSP directive to block inline script ONLY if needed
    //   - If we end up modifying an existing CSP, strip out `report-uri`
    //     to prevent spurious CSP violations.

    // Is there a CSP header present?
    // If not, inject a script-src CSP directive to prevent inline javascript
    // from executing.
    var i = headerIndexFromName('content-security-policy', headers);
    if ( i === -1 ) {
        headers.push({
            'name': 'Content-Security-Policy',
            'value': "script-src 'unsafe-eval' *"
        });
        return headers;
    }

    // A CSP header is already present.
    // Remove the CSP header, we will re-inject it after processing it.
    // TODO: We are currently forced to add the CSP header at the end of the
    //       headers array, because this is what the platform specific code
    //       expect (Firefox).
    var csp = headers.splice(i, 1)[0].value.trim();

    // Is there a script-src directive in the CSP header?
    // If not, we simply need to append our script-src directive.
    // https://github.com/gorhill/uMatrix/issues/320
    //   Since we are modifying an existing CSP header, we need to strip out
    //   'report-uri' if it is present, to prevent spurious reporting of CSP
    //   violation, and thus the leakage of information to the remote site.
    var matches = reScriptsrc.exec(csp);
    if ( matches === null ) {
        csp += "; script-src 'unsafe-eval' *";
        headers.push({
            'name': 'Content-Security-Policy',
            'value': csp.replace(reReporturi, '')
        });
        return headers;
    }

    // A `script-src' directive is already present. Extract it.
    var scriptsrc = matches[0];

    // Is there at least one 'unsafe-inline' or 'nonce-' token in the
    // script-src?
    // If not we have no further processing to perform: inline scripts are
    // already forbidden by the site.
    if ( reUnsafeinline.test(scriptsrc) === false ) {
        headers.push({
            'name': 'Content-Security-Policy',
            'value': csp
        });
        return headers;
    }

    // There are tokens enabling inline script tags in the script-src
    // directive, so we have to strip them out.
    // Strip out whole script-src directive, remove the offending tokens
    // from it, then append the resulting script-src directive to the original
    // CSP header.
    // https://github.com/gorhill/uMatrix/issues/320
    //   Since we are modifying an existing CSP header, we need to strip out
    //   'report-uri' if it is present, to prevent spurious reporting of CSP
    //   violation, and thus the leakage of information to the remote site.
    csp = csp.replace(reScriptsrc, '') + scriptsrc.replace(reUnsafeinline, '');
    headers.push({
        'name': 'Content-Security-Policy',
        'value': csp.replace(reReporturi, '')
    });
    return headers;
};

var reReporturi = /report-uri[^;]*;?\s*/;
var reScriptsrc = /script-src[^;]*;?\s*/;
var reUnsafeinline = /'unsafe-inline'\s*|'nonce-[^']+'\s*/g;

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

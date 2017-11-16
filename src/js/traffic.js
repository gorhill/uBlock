/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2017 Raymond Hill

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
// - inline script tags
// - websockets
// - media elements larger than n kB

var onHeadersReceived = function(details) {
    // Do not interfere with behind-the-scene requests.
    var tabId = details.tabId;
    if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }

    var µb = µBlock,
        requestType = details.type;

    if ( requestType === 'main_frame' ) {
        µb.tabContextManager.push(tabId, details.url);
    }

    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore === null ) {
        if ( requestType !== 'main_frame' ) { return; }
        pageStore = µb.bindTabToPageStats(tabId, 'beforeRequest');
    }
    if ( pageStore.getNetFilteringSwitch() === false ) { return; }

    if ( requestType === 'image' || requestType === 'media' ) {
        return foilLargeMediaElement(pageStore, details);
    }

    // https://github.com/gorhill/uBlock/issues/2813
    //   Disable the blocking of large media elements if the document is itself
    //   a media element: the resource was not prevented from loading so no
    //   point to further block large media elements for the current document.
    if ( requestType === 'main_frame' ) {
        if ( reMediaContentTypes.test(headerValueFromName('content-type', details.responseHeaders)) ) {
            pageStore.allowLargeMediaElementsUntil = Date.now() + 86400000;
        }
        return injectCSP(pageStore, details);
    }

    if ( requestType === 'sub_frame' ) {
        return injectCSP(pageStore, details);
    }
};

var reMediaContentTypes = /^(?:audio|image|video)\//;

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

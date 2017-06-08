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

var AcceptHeaders = {
    chrome: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    firefox: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};
var CommonUserAgent = 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/40.0.2214.85 Safari/537.36';

var exports = {};

/********************************* ADN ****************************************/

// Called before each outgoing request (ADN:)
var onBeforeSendHeaders = function (details) {

  var headers = details.requestHeaders, prefs = µBlock.userSettings, adn = µBlock.adnauseam;

  // if clicking/hiding is enabled with DNT, then send the DNT header
  if ((prefs.clickingAds && prefs.disableClickingForDNT) || (prefs.hidingAds && prefs.disableHidingForDNT)) {

    var pageStore = µBlock.mustPageStoreFromTabId(details.tabId);

    // add it only if the browser is not sending it already
    if (pageStore.getNetFilteringSwitch() && !hasDNT(headers)) {

      if (false && details.type === 'main_frame') // minimize logging
        adn.logNetEvent('[HEADER]', 'Append', 'DNT:1', details.url);

      addHeader(headers, 'DNT', '1');
    }
  }

  // Is this an XMLHttpRequest ?
  if (vAPI.isBehindTheSceneTabId(details.tabId)) {

    // If so, is it one of our Ad visits ?
    var ad = adn.lookupAd(details.url, details.requestId);

    // if so, handle the headers (cookies, ua, referer)
    ad && beforeAdVisit(details, headers, prefs, ad);
  }

  // ADN: if this was an adn-allowed request, do we block cookies, etc.? TODO

  return { requestHeaders: headers };
};

// ADN: remove outgoing cookies, reset user-agent, strip referer
var beforeAdVisit = function (details, headers, prefs, ad) {

  var referer = ad.pageUrl, refererIdx = -1, uirIdx = -1, dbug = 0;

  ad.requestId = details.requestId; // needed?

  dbug && console.log('[HEADERS] (Outgoing'+(ad.targetUrl===details.url ? ')' : '-redirect)'), details.url);

  for (var i = headers.length - 1; i >= 0; i--) {

    dbug && console.log(i + ") " + headers[i].name, headers[i].value);
    var name = headers[i].name.toLowerCase();

    if ((name === 'http_x_requested_with') ||
      (name === 'x-devtools-emulate-network-conditions-client-id') ||
      (prefs.noOutgoingCookies && name === 'cookie') ||
      (prefs.noOutgoingUserAgent && name === 'user-agent'))
    {
      setHeader(headers[i], '');

      // Block outgoing cookies and user-agent here if specified
      if (prefs.noOutgoingCookies && name === 'cookie') {

        µBlock.adnauseam.logNetEvent('[COOKIE]', 'Strip', headers[i].value, details.url);
      }

      // Replace user-agent with most common string, if specified
      if (prefs.noOutgoingUserAgent && name === 'user-agent') {

         headers[i].value = CommonUserAgent;
         µBlock.adnauseam.logNetEvent('[UAGENT]', 'Default', headers[i].value, details.url);
      }
    }

    if (name === 'referer') refererIdx = i;

    if (vAPI.chrome && name === 'upgrade-insecure-requests') uirIdx = i;

    if (name === 'accept') { // Set browser-specific accept header
      setHeader(headers[i], vAPI.firefox ? AcceptHeaders.firefox : AcceptHeaders.chrome);
    }
  }

  if (vAPI.chrome && uirIdx < 0) { // Add UIR header if chrome
    addHeader(headers, 'Upgrade-Insecure-Requests', '1');
  }

  if (((prefs.clickingAds && prefs.disableClickingForDNT) || (prefs.hidingAds && prefs.disableHidingForDNT)) && !hasDNT(headers))
    addHeader(headers, 'DNT', '1');

  handleRefererForVisit(prefs, refererIdx, referer, details.url, headers);
};

var handleRefererForVisit = function (prefs, refIdx, referer, url, headers) {

  // console.log('handleRefererForVisit()', arguments);

  // Referer cases (4):
  // noOutgoingReferer=true  / no refIdx:     no-op
  // noOutgoingReferer=true  / have refIdx:   setHeader('')
  // noOutgoingReferer=false / no refIdx:     addHeader(referer)
  // noOutgoingReferer=false / have refIdx:   no-op
  if (refIdx > -1 && prefs.noOutgoingReferer) {

    // will never happen when using XMLHttpRequest
    µBlock.adnauseam.logNetEvent('[REFERER]', 'Strip', referer, url);
    setHeader(headers[refIdx], '');

  } else if (!prefs.noOutgoingReferer && refIdx < 0) {

    µBlock.adnauseam.logNetEvent('[REFERER]', 'Allow', referer, url);
    addHeader(headers, 'Referer', referer);
  }
};

function dumpHeaders(headers) {

  var s = '\n\n';
  for (var i = headers.length - 1; i >= 0; i--) {
    s += headers[i].name + ': ' + headers[i].value + '\n';
  }
  return s;
}

var setHeader = function (header, value) {

  if (header) header.value = value;
};

var addHeader = function (headers, name, value) {

  headers.push({
    name: name,
    value: value
  });
};

var hasDNT = function (headers) {

  for (var i = headers.length - 1; i >= 0; i--) {
    if (headers[i].name === 'DNT' && headers[i].value === '1') {
      return true;
    }
  }
  return false;
}

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/2067
//   Experimental: Block everything until uBO is fully ready.
// TODO: re-work vAPI code to match more closely how listeners are
//       registered with the webRequest API. This will simplify implementing
//       the feature here: we could have a temporary onBeforeRequest listener
//       which blocks everything until all is ready.
//       This would allow to avoid the permanent special test at the top of
//       the main onBeforeRequest just to implement this.
var onBeforeReady = null;

if ( µBlock.hiddenSettings.suspendTabsUntilReady ) {
    onBeforeReady = (function() {
        var suspendedTabs = new Set();
        µBlock.onStartCompletedQueue.push(function(callback) {
            onBeforeReady = null;
            var iter = suspendedTabs.values(),
                entry;
            for (;;) {
                entry = iter.next();
                if ( entry.done ) { break; }
                vAPI.tabs.reload(entry.value);
            }
            callback();
        });
        return function(tabId) {
            if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }
            suspendedTabs.add(tabId);
            return true;
        };
    })();
} else {
    µBlock.onStartCompletedQueue.push(function(callback) {
        vAPI.onLoadAllCompleted();
        callback();
    });
}

/******************************************************************************/

// Intercept and filter web requests.

var onBeforeRequest = function(details) {
    var tabId = details.tabId;
    if ( onBeforeReady !== null && onBeforeReady(tabId) ) {
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

    // ADN: return here (AFTER onPageLoad) if prefs say not to block
    if (µBlock.userSettings.blockingMalware === false) return;

    // Special treatment: behind-the-scene requests
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
    var requestContext = pageStore.createContextFromFrameId(isFrame ? details.parentFrameId : details.frameId);

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

    // https://github.com/gorhill/uBlock/issues/949
    // Redirect blocked request?
    if ( µb.hiddenSettings.ignoreRedirectFilters !== true ) {
        var url = µb.redirectEngine.toURL(requestContext);
        if ( url !== undefined ) {
            µb.adnauseam.logRedirect(requestURL, url); // ADN, log redirects
            pageStore.internalRedirectionCount += 1;
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
        requestDomain = µburi.domainFromHostname(requestHostname) || requestHostname,
        result = '';
    var context = {
        rootHostname: requestHostname,
        rootDomain: requestDomain,
        pageHostname: requestHostname,
        pageDomain: requestDomain,
        requestURL: requestURL,
        requestHostname: requestHostname,
        requestType: 'main_frame'
    };

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

    // ADN: Tell the core we have a new page
    µb.adnauseam.onPageLoad(tabId, requestURL);

    // ADN: return here if prefs say not to block
    if (µb.userSettings.blockingMalware === false) return;

    // Log
    var pageStore = µb.bindTabToPageStats(tabId, 'beforeRequest');
    if ( pageStore ) {
        pageStore.journalAddRootFrame('uncommitted', requestURL);
        pageStore.journalAddRequest(requestHostname, result);
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

// https://github.com/gorhill/uBlock/issues/870
// Finally, Chromium 49+ gained the ability to report network request of type
// `beacon`, so now we can block them according to the state of the
// "Disable hyperlink auditing/beacon" setting.

var onBeforeBehindTheSceneRequest = function(details) {

    if (µBlock.userSettings.blockingMalware === false) return; // ADN

    var µb = µBlock,
        pageStore = µb.pageStoreFromTabId(vAPI.noTabId);
    if ( !pageStore ) { return; }

    var result = '',
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
    // So we filter if and only if the "advanced user" mode is selected
    if ( µb.userSettings.advancedUserEnabled ) {
        result = pageStore.filterRequestNoCache(context);
    }

    pageStore.journalAddRequest(context.requestHostname, result);

    if ( µb.logger.isEnabled() ) {
        µb.logger.writeOne(
            vAPI.noTabId,
            'net',
            result,
            requestType,
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

    // ADN: Blocked xhr
    µb.adnauseam.logNetBlock(details.type, requestURL, JSON.stringify(context));

    // Blocked
    return { 'cancel': true };
};

/******************************************************************************/

// To handle:
// - inline script tags
// - media elements larger than n kB


var onHeadersReceived = function (details) {

//console.log('traffic.onHeadersReceived',details);

    var µb = µBlock, ad, result, tabId = details.tabId, requestType = details.type, dbug = 0;
    //ADN

    if (vAPI.isBehindTheSceneTabId(tabId)) {

      // ADN: handle incoming cookies for our visits (ignore in ff for now)
      if (vAPI.chrome && µBlock.userSettings.noIncomingCookies) {

          dbug && console.log('onHeadersReceived: ', requestType, details.url);

          // ADN
          ad = µBlock.adnauseam.lookupAd(details.url, details.requestId);
          if (ad) {

            // this is an ADN request
            µBlock.adnauseam.blockIncomingCookies(details.responseHeaders, details.url, ad.targetUrl);
          }
          else if (dbug && vAPI.chrome) {

            console.log('Ignoring non-ADN response', requestType, details.url);
          }
      }

      // don't return an empty headers array
      return details.responseHeaders.length ?
        { 'responseHeaders': details.responseHeaders } : null;
    }

    // ADN: check if this was an allowed exception and, if so, block cookies
    var  modified = pageStore && µBlock.adnauseam.checkAllowedException
        (details.responseHeaders, details.url, pageStore.rawURL);

    if (requestType === 'main_frame') {
      µb.tabContextManager.push(tabId, details.url);
    }

     var pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore === null ) {
        if ( requestType !== 'main_frame' ) { return; }
        pageStore = µb.bindTabToPageStats(tabId, 'beforeRequest');
    }
    if ( pageStore.getNetFilteringSwitch() === false ) { return; }

    if ( requestType === 'image' || requestType === 'media' ) {
        result = foilLargeMediaElement(pageStore, details);
    }

    // https://github.com/gorhill/uBO-Extra/issues/19
    //   Turns out scripts must also be considered as potential embedded
    //   contexts (as workers) and as such we may need to inject content
    //   security policy directives.
    if (!result && requestType === 'script' || requestType === 'main_frame' || requestType === 'sub_frame' ) {
        result = processCSP(pageStore, details);
    }

    if (!result) { // ADN

      // ADN: check if this was an allowed exception and, if so, block cookies
      var pageStore = µBlock.pageStoreFromTabId(details.tabId),
          modified = pageStore && µBlock.adnauseam.checkAllowedException
              (details.responseHeaders, details.url, pageStore.rawURL);

      if (modified && details.responseHeaders.length)
          result = { 'responseHeaders': details.responseHeaders };
    }

    return result;
};

/******************************************************************************/

var processCSP = function(pageStore, details) {
    var µb = µBlock,
        tabId = details.tabId,
        requestURL = details.url,
        loggerEnabled = µb.logger.isEnabled();

    var context = pageStore.createContextFromPage();
    context.requestHostname = µb.URI.hostnameFromURI(requestURL);
    if ( details.type !== 'main_frame' ) {
        context.pageHostname = context.pageDomain = context.requestHostname;
    }

    var inlineScriptResult, blockInlineScript,
        workerResult, blockWorker;
    if ( details.type !== 'script' ) {
        context.requestType = 'inline-script';
        context.requestURL = requestURL;
        inlineScriptResult = pageStore.filterRequestNoCache(context);
        blockInlineScript = µb.isBlockResult(inlineScriptResult);
        // https://github.com/gorhill/uBlock/issues/2360
        // https://github.com/gorhill/uBlock/issues/2440
        context.requestType = 'script';
        context.requestURL = 'blob:';
        µb.staticNetFilteringEngine.matchString(context);
        workerResult = µb.staticNetFilteringEngine.toResultString(loggerEnabled);
        blockWorker = µb.isBlockResult(workerResult);
    }

    µb.staticNetFilteringEngine.matchStringExactType(context, requestURL, 'websocket');
    var websocketResult = µb.staticNetFilteringEngine.toResultString(loggerEnabled),
        blockWebsocket = µb.isBlockResult(websocketResult);

    var headersChanged;
    if ( blockInlineScript || blockWebsocket || blockWorker ) {
        headersChanged = foilWithCSP(
            details.responseHeaders,
            blockInlineScript,
            blockWebsocket,
            blockWorker
        );
    }

    if ( loggerEnabled && details.type !== 'script' ) {
        if ( blockInlineScript !== undefined ) {
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
        if ( websocketResult ) {
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
        if ( workerResult ) {
            µb.logger.writeOne(
                tabId,
                'net',
                workerResult,
                'worker',
                requestURL,
                context.rootHostname,
                context.pageHostname
            );
        }
    }

    context.dispose();

    if ( headersChanged !== true ) { return; }

    µb.updateBadgeAsync(tabId);

    return { 'responseHeaders': details.responseHeaders };
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
    if ( result === undefined ) { return; }

    if ( µb.logger.isEnabled() ) {
        µb.logger.writeOne(
            tabId,
            'net',
            result,
            details.type,
            details.url,
            pageStore.tabHostname,
            pageStore.tabHostname
        );
    }

    return { cancel: true };
};

/******************************************************************************/

var foilWithCSP = function(headers, noInlineScript, noWebsocket, noWorker) {
    var me = foilWithCSP,
        i = headerIndexFromName('content-security-policy', headers),
        before = i === -1 ? '' : headers[i].value.trim(),
        after = before;

    if ( noInlineScript ) {
        after = foilWithCSPDirective(
            after,
            me.reScriptSrc,
            "script-src 'unsafe-eval' *",
            me.reScriptSrcRemove
        );
    }

    if ( noWebsocket ) {
        after = foilWithCSPDirective(
            after,
            me.reConnectSrc,
            'connect-src http:',
            me.reConnectSrcRemove
        );
    }

    // https://www.w3.org/TR/CSP2/#directive-child-src
    // https://www.w3.org/TR/CSP3/#directive-worker-src
    if ( noWorker ) {
        after = foilWithCSPDirective(
            after,
            me.reWorkerSrc,
            'child-src http:',
            me.reWorkerSrcRemove
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
            me.reFrameSrc,
            'frame-src http:',
            me.reFrameSrcRemove
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

(function() {
    var fn = foilWithCSP;
    fn.reScriptSrc = /script-src[^;]*;?\s*/;
    fn.reScriptSrcRemove = /'unsafe-inline'\s*|'nonce-[^']+'\s*/g;
    fn.reConnectSrc = /connect-src[^;]*;?\s*/;
    fn.reConnectSrcRemove = /wss?:[^\s]*\s*/g;
    fn.reWorkerSrc = /child-src[^;]*;?\s*/;
    fn.reWorkerSrcRemove = /blob:[^\s]*\s*/g;
    fn.reFrameSrc = /frame-src[^;]*;?\s*/;
    fn.reFrameSrcRemove = /data:[^\s]*\s*|blob:[^\s]*\s*/g;
})();

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
    /*types: [ // ADN
        'main_frame',
        'sub_frame',
        'image',
        'media',
        'script'
    ],*/
    extra: [ 'blocking', 'responseHeaders' ],
    callback: onHeadersReceived
};

vAPI.net.onBeforeSendHeaders = {   // ADN
  urls: [
    'http://*/*',
    'https://*/*'
  ],
  extra: ['blocking', 'requestHeaders'],
  callback: onBeforeSendHeaders
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

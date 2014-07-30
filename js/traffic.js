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

/* global chrome, µBlock */

/******************************************************************************/

// Start isolation from global scope

µBlock.webRequest = (function() {

/******************************************************************************/

// Intercept and filter web requests.

var onBeforeRequest = function(details) {
    //console.debug('onBeforeRequest()> "%s": %o', details.url, details);

    // Do not block behind the scene requests.
    var tabId = details.tabId;
    if ( tabId < 0 ) {
        return;
    }

    var µb = µBlock;
    var requestURL = details.url;
    var requestType = details.type;

    // Special handling for root document.
    if ( requestType === 'main_frame' && details.parentFrameId === -1 ) {
        µb.bindTabToPageStats(tabId, requestURL);
        return;
    }

    var µburi = µb.URI.set(requestURL);
    var requestHostname = µburi.hostname;
    var requestPath = µburi.path;

    // rhill 2013-12-15:
    // Try to transpose generic `other` category into something more
    // meaningful.
    if ( requestType === 'other' ) {
        requestType = µb.transposeType(requestType, requestPath);
    }

    // Lookup the page store associated with this tab id.
    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( !pageStore ) {
        return;
    }

    var reason = false;
    if ( µb.getNetFilteringSwitch(pageStore.pageHostname) ) {
        reason = µb.abpFilters.matchString(pageStore, requestURL, requestType, requestHostname);
    }
    // Record what happened.
    pageStore.recordRequest(requestType, requestURL, reason);

    // Not blocked?
    if ( reason === false || reason.slice(0, 2) === '@@' ) {
        //console.debug('µBlock> onBeforeRequest()> ALLOW "%s" (%o)', details.url, details);
        return;
    }

    // Blocked
    //console.debug('µBlock> onBeforeRequest()> BLOCK "%s" (%o) because "%s"', details.url, details, reason);

    // https://github.com/gorhill/uBlock/issues/18
    // Do not use redirection, we need to block outright to be sure the request
    // will not be made. There can be no such guarantee with redirection.

    return { 'cancel': true };
};

/******************************************************************************/

// Intercept root frame requests. This is where we identify and block popups.

var onBeforeSendHeaders = function(details) {
    // TODO: I vaguely remember reading that when pre-fetch is enabled,
    // the tab id could be -1, despite the request not really being a
    // behind-the-scene request. If true, the test below would prevent 
    // the popup blocker from working. Need to check this.

    // Do not block behind the scene requests.
    var tabId = details.tabId;
    if ( tabId < 0 ) {
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
        console.error('µBlock> onBeforeSendHeaders(): no page store for "%s"', requestURL);
        return;
    }

    // Heuristic to determine whether we are dealing with a popup:
    // - the page store is new (it's not a reused one)
    // - the referrer is not nil

    // Can't be a popup, the tab was in use previously.
    if ( pageStore.previousPageURL !== '' ) {
        return;
    }

    var referrer = referrerFromHeaders(details.requestHeaders);
    if ( referrer === '' ) {
        return;
    }

    // https://github.com/gorhill/uBlock/issues/67
    // We need to pass the details of the page which opened this popup,
    // so that the `third-party` option works.
    var µburi = µb.URI;
    var referrerHostname = µburi.hostnameFromURI(referrer);
    var pageDetails = {
        pageHostname: referrerHostname,
        pageDomain: µburi.domainFromHostname(referrerHostname)
    };
    //console.debug('Referrer="%s"', referrer);

    // TODO: I think I should test the switch of the referrer instead, not the
    // switch of the popup. If so, that would require being able to lookup
    // a page store from a URL. Have to keep in mind the same URL can appear
    // in multiple tabs.
    var reason = false;
    if ( µb.getNetFilteringSwitch(pageStore.pageHostname) ) {
        reason = µb.abpFilters.matchStringExactType(
            pageDetails,
            requestURL,
            'popup',
            µburi.hostnameFromURI(requestURL)
        );
    }

    // Not blocked?
    if ( reason === false || reason.slice(0, 2) === '@@' ) {
        return;
    }

    // It is a popup, block and remove the tab.
    µb.unbindTabFromPageStats(tabId);
    chrome.tabs.remove(tabId);

    return { 'cancel': true };
};

/******************************************************************************/

var referrerFromHeaders = function(headers) {
    var i = headers.length;
    while ( i-- ) {
        if ( headers[i].name.toLowerCase() === 'referer' ) {
            return headers[i].value;
        }
    }
    return '';
};

/******************************************************************************/

chrome.webRequest.onBeforeRequest.addListener(
    //function(details) {
    //    quickProfiler.start('onBeforeRequest');
    //    var r = onBeforeRequest(details);
    //    quickProfiler.stop();
    //    return r;
    //},
    onBeforeRequest,
    {
        "urls": [
            "http://*/*",
            "https://*/*",
        ],
        "types": [
            "main_frame",
            "sub_frame",
            'stylesheet',
            "script",
            "image",
            "object",
            "xmlhttprequest",
            "other"
        ]
    },
    [ "blocking" ]
);

chrome.webRequest.onBeforeSendHeaders.addListener(
    //function(details) {
    //    quickProfiler.start('onBeforeSendHeaders');
    //    var r = onBeforeSendHeaders(details);
    //    quickProfiler.stop();
    //    return r;
    //},
    onBeforeSendHeaders,
    {
        "urls": [
            "http://*/*",
            "https://*/*",
        ],
        "types": [
            "main_frame"
        ]
    },
    [ "blocking", "requestHeaders" ]
);

console.log('µBlock> Beginning to intercept net requests at %s', (new Date()).toISOString());

/******************************************************************************/

})();

/******************************************************************************/


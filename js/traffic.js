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

// Intercept root frame requests. This is where we identify and block popups.

var onBeforeRootDocument = function(tabId, details) {
    var µb = µBlock;

    // Ignore non-http schemes: I don't think this could ever happened
    // because of filters at addListener() time... Will see.
    var requestURL = details.url;
    if ( requestURL.slice(0, 4) !== 'http' ) {
        console.error('onBeforeRootDocument(): Unexpected scheme!');
        µb.unbindTabFromPageStats(tabId);
        return;
    }

    // Lookup the page store associated with this tab id.
    var pageStore = µb.bindTabToPageStats(tabId, requestURL);
    if ( !pageStore ) {
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
    //console.debug('Referrer="%s"', referrer);

    var reason = false;
    if ( µb.getNetFilteringSwitch(pageStore.pageHostname) ) {
        reason = µb.abpFilters.matchString(
            pageStore,
            requestURL,
            'popup',
            µb.URI.hostnameFromURI(requestURL)
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

// Intercept and filter web requests according to white and black lists.

var onBeforeSendHeaders = function(details) {
    //console.debug('onBeforeRequestHandler()> "%s": %o', details.url, details);

    // Do not block behind the scene requests.
    var tabId = details.tabId;
    if ( tabId < 0 ) {
        return;
    }

    // Special handling for root document.
    var requestType = details.type;
    if ( requestType === 'main_frame' && details.parentFrameId === -1 ) {
        return onBeforeRootDocument(tabId, details);
    }

    // Ignore non-http schemes: I don't think this could ever happened
    // because of filters at addListener() time... Will see.
    var requestURL = details.url;
    if ( requestURL.slice(0, 4) !== 'http' ) {
        console.error('onBeforeSendHeaders(): Unexpected scheme!');
        return;
    }

    var µb = µBlock;
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
        return;
    }

    // Blocked
    //console.debug('µBlock> onBeforeSendHeaders()> BLOCK "%s" because "%s"', details.url, reason);

    // https://github.com/gorhill/uBlock/issues/18
    // Do not use redirection, we need to block outright to be sure the request
    // will not be made. There can be no such guarantee with redirection.

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
    [ "blocking", "requestHeaders" ]
);

console.log('µBlock> Beginning to intercept net requests at %s', (new Date()).toISOString());

/******************************************************************************/

})();

/******************************************************************************/


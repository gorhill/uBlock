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

/* jshint multistr: true */
/* global chrome, µBlock */

/******************************************************************************/

// Start isolation from global scope

µBlock.webRequest = (function() {

/******************************************************************************/

// Intercept and filter web requests according to white and black lists.

var onBeforeRequestHandler = function(details) {
    // console.debug('onBeforeRequestHandler()> "%s": %o', details.url, details);

    // Do not block behind the scene requests.
    var tabId = details.tabId;
    if ( tabId < 0 ) {
        return;
    }

    var µb = µBlock;
    var requestType = details.type;

    // Never block root main doc.
    if ( requestType === 'main_frame' && details.parentFrameId < 0 ) {
        µb.bindTabToPageStats(tabId, details.url);
        return;
    }

    var µburi = µb.URI;
    var requestURL = µburi.set(details.url).normalizedURI();

    // Ignore non-http schemes
    var requestScheme = µburi.scheme;
    if ( requestScheme.indexOf('http') !== 0 ) {
        return;
    }

    // Do not block myself from updating assets
    if ( requestType === 'xmlhttprequest' && requestURL.slice(0, µb.projectServerRoot.length) === µb.projectServerRoot ) {
        return;
    }

    var requestHostname = µburi.hostname;
    var requestPath = µburi.path;

    // rhill 2013-12-15:
    // Try to transpose generic `other` category into something more
    // meaningful.
    if ( requestType === 'other' ) {
        requestType = µb.transposeType(requestType, requestPath);
    }

    // Lookup the page store associated with this tab id.
    var pageStore = µb.pageStoreFromTabId(tabId) || {};

    var reason = false;
    if ( µb.getNetFilteringSwitch(pageStore.pageHostname) ) {
        reason = µb.abpFilters.matchString(pageStore, requestURL, requestType, requestHostname);
    }
    // Record what happened.
    if ( pageStore ) {
        pageStore.recordRequest(requestType, requestURL, reason);
    }

    // Not blocked?
    if ( reason === false ) {
        return;
    }

    // Blocked
    //console.debug('µBlock> onBeforeRequestHandler()> BLOCK "%s" because "%s"', details.url, reason);

    // https://github.com/gorhill/uBlock/issues/18
    // Do not use redirection, we need to block outright to be sure the request
    // will not be made. There can be no such guarantee with redirection.

    return { 'cancel': true };
};

/******************************************************************************/

chrome.webRequest.onBeforeRequest.addListener(
    //function(details) {
    //    quickProfiler.start('onBeforeRequest');
    //    var r = onBeforeRequestHandler(details);
    //    quickProfiler.stop();
    //    return r;
    //},
    onBeforeRequestHandler,
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

console.log('µBlock> Beginning to intercept net requests at %s', (new Date()).toISOString());

/******************************************************************************/

})();

/******************************************************************************/


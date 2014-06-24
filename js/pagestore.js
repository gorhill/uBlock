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

/*******************************************************************************

A PageRequestStore object is used to store net requests in two ways:

To record distinct net requests
To create a log of net requests

**/

/******************************************************************************/
/******************************************************************************/

µBlock.PageStore = (function() {

/******************************************************************************/

var µb = µBlock;
var pageStoreJunkyard = [];

/******************************************************************************/

var pageStoreFactory = function(tabId, pageURL) {
    var entry = pageStoreJunkyard.pop();
    if ( entry ) {
        return entry.init(tabId, pageURL);
    }
    return new PageStore(tabId, pageURL);
};

/******************************************************************************/

function PageStore(tabId, pageURL) {
    this.tabId = -1;
    this.pageURL = '';
    this.pageHostname = '';
    this.pageDomain = '';
    this.perLoadBlockedRequestCount = 0;
    this.perLoadAllowedRequestCount = 0;
    this.disposeTime = 0;
    this.init(tabId, pageURL);
}

/******************************************************************************/

PageStore.prototype.init = function(tabId, pageURL) {
    this.tabId = tabId;
    this.pageURL = pageURL;
    this.pageHostname = µb.URI.hostnameFromURI(pageURL);
    this.pageDomain = µb.URI.domainFromHostname(this.pageHostname);
    this.perLoadBlockedRequestCount = 0;
    this.perLoadAllowedRequestCount = 0;
    this.disposeTime = 0;
    return this;
};

/******************************************************************************/

PageStore.prototype.dispose = function() {
    // rhill 2013-11-07: Even though at init time these are reset, I still
    // need to release the memory taken by these, which can amount to
    // sizeable enough chunks (especially requests, through the request URL
    // used as a key).
    this.pageURL = '';
    this.pageHostname = '';
    this.pageDomain = '';
    if ( pageStoreJunkyard.length < 32 ) {
        pageStoreJunkyard.push(this);
    }
};

/******************************************************************************/

PageStore.prototype.recordRequest = function(type, url, block) {
    // rhill 2013-10-26: This needs to be called even if the request is
    // already logged, since the request stats are cached for a while after
    // the page is no longer visible in a browser tab.
    µb.updateBadge(this.tabId);

    if ( block !== false ) {
        this.perLoadBlockedRequestCount++;
        µb.localSettings.blockedRequestCount++;
    } else {
        this.perLoadAllowedRequestCount++;
        µb.localSettings.allowedRequestCount++;
    }
};

/******************************************************************************/

// Update badge, incrementally

// rhill 2013-11-09: well this sucks, I can't update icon/badge
// incrementally, as chromium overwrite the icon at some point without
// notifying me, and this causes internal cached state to be out of sync.

PageStore.prototype.updateBadge = function() {
    var netFilteringSwitch = µb.getNetFilteringSwitch(this.pageHostname);
    var iconPath = netFilteringSwitch ? 'img/browsericons/icon19.png' : 'img/browsericons/icon19-off.png';

    chrome.browserAction.setIcon({ tabId: this.tabId, path: iconPath });

    var iconStr = '';
    if ( µb.userSettings.showIconBadge && netFilteringSwitch && this.perLoadBlockedRequestCount ) {
        iconStr = µb.formatCount(this.perLoadBlockedRequestCount);
    }
    chrome.browserAction.setBadgeText({
        tabId: this.tabId,
        text: iconStr
    });

    if ( iconStr !== '' ) {
        chrome.browserAction.setBadgeBackgroundColor({
            tabId: this.tabId,
            color: '#666'
        });
    }
};

/******************************************************************************/

return {
    factory: pageStoreFactory
};

})();

/******************************************************************************/

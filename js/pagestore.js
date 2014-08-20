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
var frameStoreJunkyard = [];
var pageStoreJunkyard = [];

/******************************************************************************/

var frameStoreFactory = function(frameURL) {
    var entry = frameStoreJunkyard.pop();
    if ( entry ) {
        return entry.init(frameURL);
    }
    return new FrameStore(frameURL);
};

var disposeFrameStores = function(map) {
    for ( var k in map ) {
        if ( map.hasOwnProperty(k) === false ) {
            continue;
        }
        if ( frameStoreJunkyard.length > 50 ) {
            break;
        }
        frameStoreJunkyard.push(map[k].dispose());
    }
    return {};
};

/******************************************************************************/

var FrameStore = function(frameURL) {
    this.init(frameURL);
};

/******************************************************************************/

FrameStore.prototype.init = function(frameURL) {
    var µburi = µb.URI;
    this.pageHostname = µburi.hostnameFromURI(frameURL);
    this.pageDomain = µburi.domainFromHostname(this.pageHostname);
    return this;
};

/******************************************************************************/

FrameStore.prototype.dispose = function() {
    this.pageHostname = this.pageDomain = '';
    return this;
};

/******************************************************************************/

var pageStoreFactory = function(tabId, pageURL) {
    var entry = pageStoreJunkyard.pop();
    if ( entry ) {
        return entry.init(tabId, pageURL);
    }
    return new PageStore(tabId, pageURL);
};

/******************************************************************************/

var PageStore = function(tabId, pageURL) {
    this.init(tabId, pageURL);
};

/******************************************************************************/

PageStore.prototype.init = function(tabId, pageURL) {
    this.tabId = tabId;
    this.previousPageURL = '';
    this.pageURL = pageURL;
    this.pageHostname = µb.URI.hostnameFromURI(pageURL);
    this.pageDomain = µb.URI.domainFromHostname(this.pageHostname);
    this.frames = disposeFrameStores(this.frames);
    this.netFiltering = true;
    this.netFilteringReadTime = 0;
    this.perLoadBlockedRequestCount = 0;
    this.perLoadAllowedRequestCount = 0;
    this.blockedRequests = {};
    this.allowedRequests = {};
    this.disposeTime = 0;
    return this;
};

/******************************************************************************/

PageStore.prototype.reuse = function(pageURL) {
    var previousPageURL = this.pageURL;
    this.init(this.tabId, pageURL);
    this.previousPageURL = previousPageURL;
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
    if ( pageStoreJunkyard.length < 8 ) {
        pageStoreJunkyard.push(this);
    }
};

/******************************************************************************/

PageStore.prototype.addFrame = function(frameId, frameURL) {
    var frameStore = this.frames[frameId];
    if ( frameStore === undefined ) {
        this.frames[frameId] = frameStore = frameStoreFactory(frameURL);
        //console.debug('µBlock> PageStore.addFrame(%d, "%s")', frameId, frameURL);
    }
    return frameStore;
};

/******************************************************************************/

PageStore.prototype.getFrame = function(frameId) {
    return this.frames[frameId];
};

/******************************************************************************/

PageStore.prototype.getNetFilteringSwitch = function() {
    if ( this.netFilteringReadTime < µb.netWhitelistModifyTime ) {
        this.netFiltering = µb.getNetFilteringSwitch(this.pageURL, this.pageDomain);
        this.netFilteringReadTime = Date.now();
    }
    return this.netFiltering;
};

/******************************************************************************/

PageStore.prototype.recordRequest = function(type, url, reason) {
    var blocked = reason !== false && reason.slice(0, 2) !== '@@';

    if ( !blocked ) {
        this.perLoadAllowedRequestCount++;
        µb.localSettings.allowedRequestCount++;
        if ( µb.userSettings.logAllowedRequests ) {
            this.allowedRequests[url] = type + '\t' + (reason || '');
        }
        return;
    }

    µb.updateBadgeAsync(this.tabId);

    this.perLoadBlockedRequestCount++;
    µb.localSettings.blockedRequestCount++;

    // https://github.com/gorhill/uBlock/issues/7
    // https://github.com/gorhill/uBlock/issues/12

    // No need to record blocked requests which are not image or frame, as
    // these are the only ones we try to hide when they are blocked.
    if ( µb.userSettings.logBlockedRequests === false ) {
        if ( type === 'image' || type === 'sub_frame' ) {
            this.blockedRequests[url] = true;
        }
        return;
    }
    this.blockedRequests[url] = type + '\t' + reason;
};

/******************************************************************************/

PageStore.prototype.updateBadgeFromTab = function(tab) {
    if ( !tab ) {
        return;
    }
    var netFiltering = this.getNetFilteringSwitch();
    var iconPath = netFiltering ? 'img/browsericons/icon19.png' : 'img/browsericons/icon19-off.png';

    chrome.browserAction.setIcon({ tabId: tab.id, path: iconPath });

    var iconStr = '';
    if ( µb.userSettings.showIconBadge && netFiltering && this.perLoadBlockedRequestCount ) {
        iconStr = µb.utils.formatCount(this.perLoadBlockedRequestCount);
    }
    chrome.browserAction.setBadgeText({ tabId: tab.id, text: iconStr });

    if ( iconStr !== '' ) {
        chrome.browserAction.setBadgeBackgroundColor({ tabId: tab.id, color: '#666' });
    }
};

PageStore.prototype.updateBadge = function() {
    // https://github.com/gorhill/uBlock/issues/19
    // Since we may be called asynchronously, the tab id may not exist
    // anymore, so this ensures it does still exist.
    chrome.tabs.get(this.tabId, this.updateBadgeFromTab.bind(this));
};

// https://www.youtube.com/watch?v=drW8p_dTLD4

/******************************************************************************/

return {
    factory: pageStoreFactory
};

})();

/******************************************************************************/

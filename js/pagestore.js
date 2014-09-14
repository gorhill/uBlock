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

/* global µBlock */

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

/******************************************************************************/
/******************************************************************************/

// To mitigate memory churning
var netFilteringResultCacheEntryJunkyard = [];
var netFilteringResultCacheEntryJunkyardMax = 200;

/******************************************************************************/

var NetFilteringResultCacheEntry = function(data) {
    this.init(data);
};

/******************************************************************************/

NetFilteringResultCacheEntry.prototype.init = function(data) {
    this.data = data;
    this.time = Date.now();
};

/******************************************************************************/

NetFilteringResultCacheEntry.prototype.dispose = function() {
    this.data = null;
    if ( netFilteringResultCacheEntryJunkyard.length < netFilteringResultCacheEntryJunkyardMax ) {
        netFilteringResultCacheEntryJunkyard.push(this);
    }
};

/******************************************************************************/

NetFilteringResultCacheEntry.factory = function(data) {
    var entry = netFilteringResultCacheEntryJunkyard.pop();
    if ( entry === undefined ) {
        entry = new NetFilteringResultCacheEntry(data);
    } else {
        entry.init(data);
    }
    return entry;
};

/******************************************************************************/
/******************************************************************************/

// To mitigate memory churning
var uidGenerator = 1;
var netFilteringCacheJunkyard = [];
var netFilteringCacheJunkyardMax = 10;

/******************************************************************************/

var NetFilteringResultCache = function() {
    this.init();
};

/******************************************************************************/

NetFilteringResultCache.factory = function() {
    var entry = netFilteringCacheJunkyard.pop();
    if ( entry === undefined ) {
        entry = new NetFilteringResultCache();
    } else {
        entry.init();
    }
    return entry;
};

/******************************************************************************/

NetFilteringResultCache.prototype.init = function() {
    this.uname = 'NetFilteringResultCache:' + uidGenerator++;
    this.urls = {};
    this.count = 0;
    this.shelfLife = 60 * 1000;
};

/******************************************************************************/

NetFilteringResultCache.prototype.dispose = function() {
    for ( var key in this.urls ) {
        if ( this.urls.hasOwnProperty(key) === false ) {
            continue;
        }
        this.urls[key].dispose();
    }
    µBlock.asyncJobs.remove(this.uname);
    this.uname = '';
    this.urls = {};
    this.count = 0;
    if ( netFilteringCacheJunkyard.length < netFilteringCacheJunkyardMax ) {
        netFilteringCacheJunkyard.push(this);
    }
    return null;
};

/******************************************************************************/

NetFilteringResultCache.prototype.add = function(url, data) {
    var entry = this.urls[url];
    if ( entry !== undefined ) {
        entry.data = data;
        entry.time = Date.now();
        return;
    }
    this.urls[url] = NetFilteringResultCacheEntry.factory(data);
    if ( this.count === 0 ) {
        this.pruneAsync();
    }
    this.count += 1;
};

/******************************************************************************/

NetFilteringResultCache.prototype.fetchAll = function() {
    return this.urls;
};

/******************************************************************************/

NetFilteringResultCache.prototype.compareEntries = function(a, b) {
    return this.urls[b].time - this.urls[a].time;
};

/******************************************************************************/

NetFilteringResultCache.prototype.prune = function() {
    var keys = Object.keys(this.urls).sort(this.compareEntries.bind(this));
    var obsolete = Date.now() - this.shelfLife;
    var key, entry;
    var i = keys.length;
    while ( i-- ) {
        key = keys[i];
        entry = this.urls[key];
        if ( entry.time > obsolete ) {
            break;
        }
        entry.dispose();
        delete this.urls[key];
    }
    this.count -= keys.length - i - 1;
    if ( this.count > 0 ) {
        this.pruneAsync();
    }
};

// https://www.youtube.com/watch?v=0vTBZzB_gfY

/******************************************************************************/

NetFilteringResultCache.prototype.pruneAsync = function() {
    µBlock.asyncJobs.add(
        this.uname,
        null,
        this.prune.bind(this),
        this.shelfLife + 120000,
        false
    );
};

/******************************************************************************/

NetFilteringResultCache.prototype.lookup = function(url) {
    var entry = this.urls[url];
    return entry !== undefined ? entry.data : undefined;
};

/******************************************************************************/
/******************************************************************************/

// To mitigate memory churning
var frameStoreJunkyard = [];
var frameStoreJunkyardMax = 50;

/******************************************************************************/

var FrameStore = function(frameURL) {
    this.init(frameURL);
};

/******************************************************************************/

FrameStore.factory = function(frameURL) {
    var entry = frameStoreJunkyard.pop();
    if ( entry === undefined ) {
        entry = new FrameStore(frameURL);
    } else {
        entry.init(frameURL);
    }
    return entry;
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
    if ( frameStoreJunkyard.length < frameStoreJunkyardMax ) {
        frameStoreJunkyard.push(this);
    }
    return null;
};

/******************************************************************************/
/******************************************************************************/

// To mitigate memory churning
var pageStoreJunkyard = [];
var pageStoreJunkyardMax = 10;

/******************************************************************************/

// Cache only what is worth it if logging is disabled
// http://jsperf.com/string-indexof-vs-object
var collapsibleRequestTypes = 'image sub_frame object';

/******************************************************************************/

var PageStore = function(tabId, pageURL) {
    this.init(tabId, pageURL);
};

/******************************************************************************/

PageStore.factory = function(tabId, pageURL) {
    var entry = pageStoreJunkyard.pop();
    if ( entry === undefined ) {
        entry = new PageStore(tabId, pageURL);
    } else {
        entry.init(tabId, pageURL);
    }
    return entry;
};

/******************************************************************************/

PageStore.prototype.init = function(tabId, pageURL) {
    this.tabId = tabId;
    this.previousPageURL = '';
    this.pageURL = pageURL;
    this.pageHostname = µb.URI.hostnameFromURI(pageURL);

    // https://github.com/gorhill/uBlock/issues/185
    // Use hostname if no domain can be extracted
    this.pageDomain = µb.URI.domainFromHostname(this.pageHostname) || this.pageHostname;

    this.frames = {};
    this.netFiltering = true;
    this.netFilteringReadTime = 0;
    this.perLoadBlockedRequestCount = 0;
    this.perLoadAllowedRequestCount = 0;

    this.netFilteringCache = NetFilteringResultCache.factory();
    if ( µb.userSettings.logRequests ) {
        this.netFilteringCache.shelfLife = 30 * 60 * 1000;
    }

    return this;
};

/******************************************************************************/

PageStore.prototype.reuse = function(pageURL) {
    this.disposeFrameStores();
    this.netFilteringCache = this.netFilteringCache.dispose();
    var previousPageURL = this.pageURL;
    this.init(this.tabId, pageURL);
    this.previousPageURL = previousPageURL;
    return this;
};

// https://www.youtube.com/watch?v=dltNSbOupgE

/******************************************************************************/

PageStore.prototype.dispose = function() {
    // rhill 2013-11-07: Even though at init time these are reset, I still
    // need to release the memory taken by these, which can amount to
    // sizeable enough chunks (especially requests, through the request URL
    // used as a key).
    this.pageURL = '';
    this.previousPageURL = '';
    this.pageHostname = '';
    this.pageDomain = '';
    this.disposeFrameStores();
    this.netFilteringCache = this.netFilteringCache.dispose();
    if ( pageStoreJunkyard.length < pageStoreJunkyardMax ) {
        pageStoreJunkyard.push(this);
    }
    return null;
};

/******************************************************************************/

PageStore.prototype.disposeFrameStores = function() {
    var frames = this.frames;
    if ( typeof frames === 'object' ) {
        for ( var k in frames ) {
            if ( frames.hasOwnProperty(k) === false ) {
                continue;
            }
            frames[k].dispose();
        }
    }
    this.frames = {};
};

/******************************************************************************/

PageStore.prototype.addFrame = function(frameId, frameURL) {
    var frameStore = this.frames[frameId];
    if ( frameStore === undefined ) {
        this.frames[frameId] = frameStore = FrameStore.factory(frameURL);
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

PageStore.prototype.filterRequest = function(context, requestType, requestURL) {
    var result = this.netFilteringCache.lookup(requestURL);
    if ( result !== undefined ) {
        return result.slice(result.indexOf('\t') + 1);
    }
    //console.debug('µBlock> PageStore.filterRequest(): "%s" not in cache', requestURL);
    result = µb.netFilteringEngine.matchString(context, requestURL, requestType);
    if ( collapsibleRequestTypes.indexOf(requestType) !== -1 || µb.userSettings.logRequests ) {
        this.netFilteringCache.add(requestURL, requestType + '\t' + result);
    }
    return result;
};

/******************************************************************************/

// false: not blocked
// true: blocked

PageStore.prototype.boolFromResult = function(result) {
    return typeof result === 'string' && result !== '' && result.slice(0, 2) !== '@@';
};

/******************************************************************************/

PageStore.prototype.updateBadge = function() {
    var netFiltering = this.getNetFilteringSwitch();
    var iconPaths = netFiltering ?
        { '19': 'img/browsericons/icon19.png',     '38': 'img/browsericons/icon38.png' } :
        { '19': 'img/browsericons/icon19-off.png', '38': 'img/browsericons/icon38-off.png' };

    var iconStr = '';
    if ( µb.userSettings.showIconBadge && netFiltering && this.perLoadBlockedRequestCount ) {
        iconStr = µb.utils.formatCount(this.perLoadBlockedRequestCount);
    }
    µb.XAL.setIcon(this.tabId, iconPaths, iconStr);
};

// https://www.youtube.com/watch?v=drW8p_dTLD4

/******************************************************************************/

return {
    factory: PageStore.factory
};

})();

/******************************************************************************/

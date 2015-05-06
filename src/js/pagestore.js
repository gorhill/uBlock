/*******************************************************************************

    µBlock - a browser extension to block requests.
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

    Home: https://github.com/chrisaljoudi/uBlock
*/

/* jshint bitwise: false */
/* global µBlock */

/*******************************************************************************

A PageRequestStore object is used to store net requests in two ways:

To record distinct net requests
To create a log of net requests

**/

/******************************************************************************/
/******************************************************************************/

µBlock.PageStore = (function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/
/******************************************************************************/

// To mitigate memory churning
var netFilteringResultCacheEntryJunkyard = [];
var netFilteringResultCacheEntryJunkyardMax = 200;

/******************************************************************************/

var NetFilteringResultCacheEntry = function(result, type) {
    this.init(result, type);
};

/******************************************************************************/

NetFilteringResultCacheEntry.prototype.init = function(result, type) {
    this.result = result;
    this.type = type;
    this.time = Date.now();
};

/******************************************************************************/

NetFilteringResultCacheEntry.prototype.dispose = function() {
    this.result = '';
    this.type = '';
    if ( netFilteringResultCacheEntryJunkyard.length < netFilteringResultCacheEntryJunkyardMax ) {
        netFilteringResultCacheEntryJunkyard.push(this);
    }
};

/******************************************************************************/

NetFilteringResultCacheEntry.factory = function(result, type) {
    var entry = netFilteringResultCacheEntryJunkyard.pop();
    if ( entry === undefined ) {
        entry = new NetFilteringResultCacheEntry(result, type);
    } else {
        entry.init(result, type);
    }
    return entry;
};

/******************************************************************************/
/******************************************************************************/

// To mitigate memory churning
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
    this.urls = {};
    this.count = 0;
    this.shelfLife = 60 * 1000;
    this.timer = null;
    this.boundPruneAsyncCallback = this.pruneAsyncCallback.bind(this);
};

/******************************************************************************/

NetFilteringResultCache.prototype.dispose = function() {
    this.empty();
    this.boundPruneAsyncCallback = null;
    if ( netFilteringCacheJunkyard.length < netFilteringCacheJunkyardMax ) {
        netFilteringCacheJunkyard.push(this);
    }
    return null;
};

/******************************************************************************/

NetFilteringResultCache.prototype.add = function(context, result) {
    var url = context.requestURL;
    var type = context.requestType;
    var entry = this.urls[url];
    if ( entry !== undefined ) {
        entry.result = result;
        entry.type = type;
        entry.time = Date.now();
        return;
    }
    this.urls[url] = NetFilteringResultCacheEntry.factory(result, type);
    if ( this.count === 0 ) {
        this.pruneAsync();
    }
    this.count += 1;
};

/******************************************************************************/

NetFilteringResultCache.prototype.empty = function() {
    for ( var key in this.urls ) {
        if ( this.urls.hasOwnProperty(key) === false ) {
            continue;
        }
        this.urls[key].dispose();
    }
    this.urls = {};
    this.count = 0;
    if ( this.timer !== null ) {
        clearTimeout(this.timer);
        this.timer = null;
    }
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

// https://www.youtube.com/watch?v=hcVpbsDyOhM

/******************************************************************************/

NetFilteringResultCache.prototype.pruneAsync = function() {
    if ( this.timer === null ) {
        this.timer = setTimeout(this.boundPruneAsyncCallback, this.shelfLife * 2);
    }
};

NetFilteringResultCache.prototype.pruneAsyncCallback = function() {
    this.timer = null;
    this.prune();
};

/******************************************************************************/

NetFilteringResultCache.prototype.lookup = function(context) {
    return this.urls[context.requestType + ' ' + context.requestURL];
};

/******************************************************************************/
/******************************************************************************/

// FrameStores are just for associating a
// frame ID with a URL. pageHostname is really
// frameHostname.
// To mitigate memory churning
var frameStoreJunkyard = [];
var frameStoreJunkyardMax = 50;

/******************************************************************************/

var FrameStore = function(rootHostname, frameURL) {
    this.init(rootHostname, frameURL);
};

/******************************************************************************/

FrameStore.factory = function(rootHostname, frameURL) {
    var entry = frameStoreJunkyard.pop();
    if ( entry === undefined ) {
        entry = new FrameStore(rootHostname, frameURL);
    } else {
        entry.init(rootHostname, frameURL);
    }
    return entry;
};

/******************************************************************************/

FrameStore.prototype.init = function(rootHostname, frameURL) {
    var µburi = µb.URI;
    this.pageURL = frameURL;
    this.pageHostname = µburi.hostnameFromURI(frameURL);
    this.pageDomain = µburi.domainFromHostname(this.pageHostname) || this.pageHostname;
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

// To mitigate memory churning
var pageStoreJunkyard = [];
var pageStoreJunkyardMax = 10;

/******************************************************************************/

var PageStore = function(tabId) {
    this.init(tabId);
};

/******************************************************************************/

PageStore.factory = function(tabId) {
    var entry = pageStoreJunkyard.pop();
    if ( entry === undefined ) {
        entry = new PageStore(tabId);
    } else {
        entry.init(tabId);
    }
    return entry;
};

/******************************************************************************/

PageStore.prototype.init = function(tabId) {
    var tabContext = µb.tabContextManager.lookup(tabId);
    this.tabId = tabId;

    this.tabHostname = tabContext.rootHostname;
    this.hostnameToCountMap = {};
    this.contentLastModified = 0;
    this.frames = {};
    this.netFiltering = true;
    this.netFilteringReadTime = 0;
    this.perLoadBlockedRequestCount = 0;
    this.perLoadAllowedRequestCount = 0;
    this.netFilteringCache = NetFilteringResultCache.factory();

    // Support `elemhide` filter option. Called at this point so the required
    // context is all setup at this point.
    var context = this.createContextFromPage();
    this.skipCosmeticFiltering = µb.staticNetFilteringEngine
                                   .matchStringExactType(context, tabContext.normalURL, 'cosmetic-filtering')
                                   .charAt(1) === 'b';

    return this;
};

/******************************************************************************/

PageStore.prototype.reuse = function(context) {
    // We can't do this: when force refreshing a page, the page store data
    // needs to be reset
    //if ( pageURL === this.pageURL ) {
    //    return this;
    //}

    // If the hostname changes, we can't merely just update the context.
    var tabContext = µb.tabContextManager.lookup(this.tabId);
    if ( tabContext.rootHostname !== this.tabHostname ) {
        context = '';
    }

    // If URL changes without a page reload (more and more common), then we
    // need to keep all that we collected for reuse. In particular, not
    // doing so was causing a problem in `videos.foxnews.com`: clicking a
    // video thumbnail would not work, because the frame hierarchy structure
    // was flushed from memory, while not really being flushed on the page.
    if ( context === 'tabUpdated' ) {
        // As part of https://github.com/chrisaljoudi/uBlock/issues/405
        // URL changed, force a re-evaluation of filtering switch
        this.netFilteringReadTime = 0;
        return this;
    }

    // A new page is completely reloaded from scratch, reset all.
    this.disposeFrameStores();
    this.netFilteringCache = this.netFilteringCache.dispose();
    this.init(this.tabId);
    return this;
};

// https://www.youtube.com/watch?v=dltNSbOupgE

/******************************************************************************/

PageStore.prototype.dispose = function() {
    // rhill 2013-11-07: Even though at init time these are reset, I still
    // need to release the memory taken by these, which can amount to
    // sizeable enough chunks (especially requests, through the request URL
    // used as a key).
    this.hostnameToCountMap = null;
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
    for ( var k in frames ) {
        if ( frames.hasOwnProperty(k) ) {
            frames[k].dispose();
        }
    }
    this.frames = {};
};

/******************************************************************************/

PageStore.prototype.getFrame = function(frameId) {
    return this.frames[frameId] || null;
};

/******************************************************************************/

PageStore.prototype.setFrame = function(frameId, frameURL) {
    var frameStore = this.frames[frameId];
    if ( frameStore instanceof FrameStore ) {
        frameStore.init(this.rootHostname, frameURL);
    } else {
        this.frames[frameId] = FrameStore.factory(this.rootHostname, frameURL);
    }
};

/******************************************************************************/

PageStore.prototype.createContextFromPage = function() {
    var context = new µb.tabContextManager.createContext(this.tabId);
    context.pageHostname = context.rootHostname;
    context.pageDomain = context.rootDomain;
    return context;
};

PageStore.prototype.createContextFromFrameId = function(frameId) {
    var context = new µb.tabContextManager.createContext(this.tabId);
    if ( this.frames.hasOwnProperty(frameId) ) {
        var frameStore = this.frames[frameId];
        context.pageHostname = frameStore.pageHostname;
        context.pageDomain = frameStore.pageDomain;
    } else {
        context.pageHostname = context.rootHostname;
        context.pageDomain = context.rootDomain;
    }
    return context;
};

PageStore.prototype.createContextFromFrameHostname = function(frameHostname) {
    var context = new µb.tabContextManager.createContext(this.tabId);
    context.pageHostname = frameHostname;
    context.pageDomain = µb.URI.domainFromHostname(frameHostname) || frameHostname;
    return context;
};

/******************************************************************************/

PageStore.prototype.getNetFilteringSwitch = function() {
    var tabContext = µb.tabContextManager.lookup(this.tabId);
    if (
        this.netFilteringReadTime > µb.netWhitelistModifyTime &&
        this.netFilteringReadTime > tabContext.modifyTime
    ) {
        return this.netFiltering;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/1078
    // Use both the raw and normalized URLs.
    this.netFiltering = µb.getNetFilteringSwitch(tabContext.normalURL);
    if ( this.netFiltering && tabContext.rawURL !== tabContext.normalURL ) {
        this.netFiltering = µb.getNetFilteringSwitch(tabContext.rawURL);
    }
    this.netFilteringReadTime = Date.now();
    return this.netFiltering;
};

/******************************************************************************/

PageStore.prototype.getSpecificCosmeticFilteringSwitch = function() {
    if ( this.getNetFilteringSwitch() === false ) {
        return false;
    }

    var tabContext = µb.tabContextManager.lookup(this.tabId);

    return µb.userSettings.advancedUserEnabled === false ||
           µb.sessionFirewall.mustAllowCellZY(tabContext.rootHostname, tabContext.rootHostname, '*') === false;
};

/******************************************************************************/

PageStore.prototype.getGenericCosmeticFilteringSwitch = function() {
    if ( this.skipCosmeticFiltering ) {
        return false;
    }
    return this.getSpecificCosmeticFilteringSwitch();
};

/******************************************************************************/

PageStore.prototype.toggleNetFilteringSwitch = function(url, scope, state) {
    µb.toggleNetFilteringSwitch(url, scope, state);
    this.netFilteringCache.empty();
};

/******************************************************************************/

PageStore.prototype.filterRequest = function(context) {

    if ( this.getNetFilteringSwitch() === false ) {
        if ( collapsibleRequestTypes.indexOf(context.requestType) !== -1 ) {
            this.netFilteringCache.add(context, '');
        }
        return '';
    }

    var entry = this.netFilteringCache.lookup(context);
    if ( entry !== undefined ) {
        //console.debug('cache HIT: PageStore.filterRequest("%s")', context.requestURL);
        return entry.result;
    }

    var result = '';

    // Given that:
    // - Dynamic filtering override static filtering
    // - Evaluating dynamic filtering is much faster than static filtering
    // We evaluate dynamic filtering first, and hopefully we can skip
    // evaluation of static filtering.
    if ( µb.userSettings.advancedUserEnabled ) {
        var df = µb.sessionFirewall.evaluateCellZY(
            context.rootHostname,
            context.requestHostname,
            context.requestType
        );
        if ( df.mustBlockOrAllow() ) {
            result = df.toFilterString();
        }
    }

    // Static filtering never override dynamic filtering
    if ( result === '' ) {
        result = µb.staticNetFilteringEngine.matchString(context);
    }

    //console.debug('cache MISS: PageStore.filterRequest("%s")', context.requestURL);
    if ( collapsibleRequestTypes.indexOf(context.requestType) !== -1 ) {
        this.netFilteringCache.add(context, result);
    }

    // console.debug('[%s, %s] = "%s"', context.requestHostname, context.requestType, result);

    return result;
};

// http://jsperf.com/string-indexof-vs-object
var collapsibleRequestTypes = 'image sub_frame object';

/******************************************************************************/

PageStore.prototype.filterRequestNoCache = function(context) {
    if ( this.getNetFilteringSwitch() === false ) {
        return '';
    }

    var result = '';

    // Given that:
    // - Dynamic filtering override static filtering
    // - Evaluating dynamic filtering is much faster than static filtering
    // We evaluate dynamic filtering first, and hopefully we can skip
    // evaluation of static filtering.
    if ( µb.userSettings.advancedUserEnabled ) {
        var df = µb.sessionFirewall.evaluateCellZY(
            context.rootHostname,
            context.requestHostname,
            context.requestType
        );
        if ( df.mustBlockOrAllow() ) {
            result = df.toFilterString();
        }
    }

    // Static filtering never override dynamic filtering
    if ( result === '' ) {
        result = µb.staticNetFilteringEngine.matchString(context);
    }

    return result;
};

/******************************************************************************/

PageStore.prototype.logRequest = function(context, result) {
    var requestHostname = context.requestHostname;
    // rhill 20150206:
    // be prepared to handle invalid requestHostname, I've seen this
    // happen: http://./
    if ( requestHostname === '' ) {
        requestHostname = context.rootHostname;
    }
    var now = Date.now();
    if ( this.hostnameToCountMap.hasOwnProperty(requestHostname) === false ) {
        this.hostnameToCountMap[requestHostname] = 0;
        this.contentLastModified = now;
    }
    var c = result.charAt(1);
    if ( c === '' || c === 'a' ) {
        this.hostnameToCountMap[requestHostname] += 0x00010000;
        this.perLoadAllowedRequestCount++;
        µb.localSettings.allowedRequestCount++;
    } else /* if ( c === 'b' ) */ {
        this.hostnameToCountMap[requestHostname] += 0x00000001;
        this.perLoadBlockedRequestCount++;
        µb.localSettings.blockedRequestCount++;
    }
    µb.localSettingsModifyTime = now;
};

// https://www.youtube.com/watch?v=drW8p_dTLD4

/******************************************************************************/

return {
    factory: PageStore.factory
};

})();

/******************************************************************************/

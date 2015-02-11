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

/* jshint bitwise: false */
/* global vAPI, µBlock */

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

var LogEntry = function(details, result) {
    this.init(details, result);
};

/******************************************************************************/

var logEntryFactory = function(details, result) {
    var entry = logEntryJunkyard.pop();
    if ( entry ) {
        return entry.init(details, result);
    }
    return new LogEntry(details, result);
};

var logEntryJunkyard = [];
var logEntryJunkyardMax = 100;

/******************************************************************************/

LogEntry.prototype.init = function(details, result) {
    this.tstamp = Date.now();
    this.url = details.requestURL;
    this.hostname = details.requestHostname;
    this.type = details.requestType;
    this.result = result;
    return this;
};

/******************************************************************************/

LogEntry.prototype.dispose = function() {
    this.url = this.hostname = this.type = this.result = '';
    if ( logEntryJunkyard.length < logEntryJunkyardMax ) {
        logEntryJunkyard.push(this);
    }
};

/******************************************************************************/

var LogBuffer = function() {
    this.lastReadTime = 0;
    this.size = 50;
    this.buffer = null;
    this.readPtr = 0;
    this.writePtr = 0;
};

/******************************************************************************/

var logBufferFactory = function() {
    return new LogBuffer();
};

var liveLogBuffers = [];

/******************************************************************************/

LogBuffer.prototype.dispose = function() {
    if ( this.buffer === null ) {
        return null;
    }
    var entry;
    var i = this.buffer.length;
    while ( i-- ) {
        entry = this.buffer[i];
        if ( entry instanceof LogEntry ) {
            entry.dispose();
        }
    }
    this.buffer = null;
    return null;
};

/******************************************************************************/

LogBuffer.prototype.start = function() {
    if ( this.buffer === null ) {
        this.buffer = new Array(this.size);
        this.readPtr = 0;
        this.writePtr = 0;
        liveLogBuffers.push(this);
    }
};

/******************************************************************************/

LogBuffer.prototype.stop = function() {
    this.dispose();
    this.buffer = null;
    // The janitor will remove us from the live pool eventually.
};

/******************************************************************************/

LogBuffer.prototype.writeOne = function(details, result) {
    if ( this.buffer === null ) {
        return;
    }
    // Reusing log entry = less memory churning
    var entry = this.buffer[this.writePtr];
    if ( entry instanceof LogEntry === false ) {
        this.buffer[this.writePtr] = logEntryFactory(details, result);
    } else {
        entry.init(details, result);
    }
    this.writePtr += 1;
    if ( this.writePtr === this.size ) {
        this.writePtr = 0;
    }
    // Grow the buffer between 1.5x-2x the current size
    if ( this.writePtr === this.readPtr ) {
        var toMove = this.buffer.slice(0, this.writePtr);
        var minSize = Math.ceil(this.size * 1.5);
        this.size += toMove.length;
        if ( this.size < minSize ) {
            this.buffer = this.buffer.concat(toMove, new Array(minSize - this.size));
            this.writePtr = this.size;
        } else {
            this.buffer = this.buffer.concat(toMove);
            this.writePtr = 0;
        }
        this.size = this.buffer.length;
    }
};

/******************************************************************************/

LogBuffer.prototype.readAll = function() {
    var out;
    if ( this.buffer === null ) {
        this.start();
        out = [];
    } else if ( this.readPtr < this.writePtr ) {
        out = this.buffer.slice(this.readPtr, this.writePtr);
    } else if ( this.writePtr < this.readPtr ) {
        out = this.buffer.slice(this.readPtr).concat(this.buffer.slice(0, this.writePtr));
    } else {
        out = [];
    }
    this.readPtr = this.writePtr;
    this.lastReadTime = Date.now();
    return out;
};

/******************************************************************************/

var logBufferJanitor = function() {
    var logBuffer;
    var obsolete = Date.now() - logBufferObsoleteAfter;
    var i = liveLogBuffers.length;
    while ( i-- ) {
        logBuffer = liveLogBuffers[i];
        if ( logBuffer.lastReadTime < obsolete ) {
            logBuffer.stop();
            liveLogBuffers.splice(i, 1);
        }
    }
    setTimeout(logBufferJanitor, logBufferJanitorPeriod);
};

// The janitor will look for stale log buffer every 2 minutes.
var logBufferJanitorPeriod = 2 * 60 * 1000;

// After 30 seconds without being read, a buffer will be considered unused, and
// thus removed from memory.
var logBufferObsoleteAfter = 30 * 1000;

setTimeout(logBufferJanitor, logBufferJanitorPeriod);

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

NetFilteringResultCache.prototype.lookup = function(url) {
    return this.urls[url];
};

/******************************************************************************/
/******************************************************************************/

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
    this.pageHostname = µburi.hostnameFromURI(frameURL);
    this.pageDomain = µburi.domainFromHostname(this.pageHostname) || this.pageHostname;
    this.rootHostname = rootHostname;
    this.rootDomain = µburi.domainFromHostname(rootHostname) || rootHostname;
    // This is part of the filtering evaluation context
    this.requestURL = this.requestHostname = this.requestType = '';

    return this;
};

/******************************************************************************/

FrameStore.prototype.dispose = function() {
    this.pageHostname = this.pageDomain =
    this.rootHostname = this.rootDomain =
    this.requestURL = this.requestHostname = this.requestType = '';
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
    this.rootHostname = this.pageHostname;
    this.rootDomain = this.pageDomain;

    // This is part of the filtering evaluation context
    this.requestURL = this.requestHostname = this.requestType = '';

    this.hostnameToCountMap = {};
    this.contentLastModified = 0;
    this.frames = {};
    this.netFiltering = true;
    this.netFilteringReadTime = 0;
    this.perLoadBlockedRequestCount = 0;
    this.perLoadAllowedRequestCount = 0;
    this.skipLocalMirroring = false;
    this.netFilteringCache = NetFilteringResultCache.factory();

    // Support `elemhide` filter option. Called at this point so the required
    // context is all setup at this point.
    this.skipCosmeticFiltering = µb.staticNetFilteringEngine
                                   .matchStringExactType(this, pageURL, 'cosmetic-filtering')
                                   .charAt(1) === 'b';

    // Preserve old buffer if there is one already, it may be in use, and
    // overwritting it would required another read to restart it.
    if ( this.logBuffer instanceof LogBuffer === false ) {
        this.logBuffer = logBufferFactory();
    }

    return this;
};

/******************************************************************************/

PageStore.prototype.reuse = function(pageURL, context) {
    // If URL changes without a page reload (more and more common), then we
    // need to keep all that we collected for reuse. In particular, not
    // doing so was causing a problem in `videos.foxnews.com`: clicking a
    // video thumbnail would not work, because the frame hierarchy structure
    // was flushed from memory, while not really being flushed on the page.
    if ( context === 'tabUpdated' ) {
        this.previousPageURL = this.pageURL;
        this.pageURL = pageURL;
        this.pageHostname = µb.URI.hostnameFromURI(pageURL);
        this.pageDomain = µb.URI.domainFromHostname(this.pageHostname) || this.pageHostname;
        this.rootHostname = this.pageHostname;
        this.rootDomain = this.pageDomain;

        // As part of https://github.com/gorhill/uBlock/issues/405
        // URL changed, force a re-evaluation of filtering switch
        this.netFilteringReadTime = 0;

        return this;
    }
    // A new page is completely reloaded from scratch, reset all.
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
    this.pageURL = this.previousPageURL =
    this.pageHostname = this.pageDomain =
    this.rootHostname = this.rootDomain =
    this.requestURL = this.requestHostname = this.requestType = '';
    this.hostnameToCountMap = null;
    this.disposeFrameStores();
    this.netFilteringCache = this.netFilteringCache.dispose();
    this.logBuffer = this.logBuffer.dispose();
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

PageStore.prototype.addFrame = function(frameId, frameURL) {
    var frameStore = this.frames[frameId];
    if ( frameStore === undefined ) {
        this.frames[frameId] = frameStore = FrameStore.factory(this.rootHostname, frameURL);
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
        this.netFiltering = µb.getNetFilteringSwitch(this.pageURL);
        this.netFilteringReadTime = Date.now();
    }
    return this.netFiltering;
};

/******************************************************************************/

PageStore.prototype.getSpecificCosmeticFilteringSwitch = function() {
    return this.getNetFilteringSwitch() &&
           (µb.userSettings.advancedUserEnabled &&
            µb.sessionFirewall.mustAllowCellZY(this.rootHostname, this.rootHostname, '*')) === false;
};

/******************************************************************************/

PageStore.prototype.getGenericCosmeticFilteringSwitch = function() {
    return this.getNetFilteringSwitch() &&
           this.skipCosmeticFiltering === false &&
           (µb.userSettings.advancedUserEnabled &&
            µb.sessionFirewall.mustAllowCellZY(this.rootHostname, this.rootHostname, '*')) === false;
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

    var entry = this.netFilteringCache.lookup(context.requestURL);
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
        var df = µb.sessionFirewall.evaluateCellZY(context.rootHostname, context.requestHostname, context.requestType);
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

// Cache only what is worth it if logging is disabled
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
        var df = µb.sessionFirewall.evaluateCellZY(context.rootHostname, context.requestHostname, context.requestType);
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
        requestHostname = context.pageHostname;
    }
    if ( this.hostnameToCountMap.hasOwnProperty(requestHostname) === false ) {
        this.hostnameToCountMap[requestHostname] = 0;
        this.contentLastModified = Date.now();
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
    this.logBuffer.writeOne(context, result);
};

/******************************************************************************/

PageStore.prototype.toMirrorURL = function(requestURL) {
    // https://github.com/gorhill/uBlock/issues/351
    // Bypass experimental features when uBlock is disabled for a site
    if ( µb.userSettings.experimentalEnabled === false ||
         this.getNetFilteringSwitch() === false ||
         this.skipLocalMirroring ) {
        return '';
    }

    // https://code.google.com/p/chromium/issues/detail?id=387198
    // Not all redirects will succeed, until bug above is fixed.
    return µb.mirrors.toURL(requestURL, true);
};

/******************************************************************************/

PageStore.prototype.updateBadge = function() {
    var netFiltering = this.getNetFilteringSwitch();
    var badge = '';
    if ( µb.userSettings.showIconBadge && netFiltering && this.perLoadBlockedRequestCount ) {
        badge = µb.utils.formatCount(this.perLoadBlockedRequestCount);
    }
    vAPI.setIcon(this.tabId, netFiltering ? 'on' : 'off', badge);
};

// https://www.youtube.com/watch?v=drW8p_dTLD4

/******************************************************************************/

return {
    factory: PageStore.factory
};

})();

/******************************************************************************/

/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 Raymond Hill

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

var NetFilteringResultCacheEntry = function(result, type) {
    this.init(result, type);
};

/******************************************************************************/

NetFilteringResultCacheEntry.prototype.init = function(result, type) {
    this.result = result;
    this.type = type;
    this.time = Date.now();
    return this;
};

/******************************************************************************/

NetFilteringResultCacheEntry.prototype.dispose = function() {
    this.result = this.type = '';
    if ( netFilteringResultCacheEntryJunkyard.length < netFilteringResultCacheEntryJunkyardMax ) {
        netFilteringResultCacheEntryJunkyard.push(this);
    }
};

/******************************************************************************/

NetFilteringResultCacheEntry.factory = function(result, type) {
    if ( netFilteringResultCacheEntryJunkyard.length ) {
        return netFilteringResultCacheEntryJunkyard.pop().init(result, type);
    }
    return new NetFilteringResultCacheEntry(result, type);
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
    this.urls = Object.create(null);
    this.count = 0;
    this.shelfLife = 15 * 1000;
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
    var url = context.requestURL,
        type = context.requestType,
        key = type + ' ' + url,
        entry = this.urls[key];
    if ( entry !== undefined ) {
        entry.result = result;
        entry.type = type;
        entry.time = Date.now();
        return;
    }
    this.urls[key] = NetFilteringResultCacheEntry.factory(result, type);
    if ( this.count === 0 ) {
        this.pruneAsync();
    }
    this.count += 1;
};

/******************************************************************************/

NetFilteringResultCache.prototype.empty = function() {
    for ( var key in this.urls ) {
        this.urls[key].dispose();
    }
    this.urls = Object.create(null);
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
        this.timer = vAPI.setTimeout(this.boundPruneAsyncCallback, this.shelfLife * 2);
    }
};

NetFilteringResultCache.prototype.pruneAsyncCallback = function() {
    this.timer = null;
    this.prune();
};

/******************************************************************************/

NetFilteringResultCache.prototype.lookup = function(context) {
    return this.urls[context.requestType + ' ' + context.requestURL] || undefined;
};

/******************************************************************************/
/******************************************************************************/

// Frame stores are used solely to associate a URL with a frame id. The
// name `pageHostname` is used because of historical reasons. A more
// appropriate name is `frameHostname` -- something to do in a future
// refactoring.

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
        return new FrameStore(frameURL);
    }
    return entry.init(frameURL);
};

/******************************************************************************/

FrameStore.prototype.init = function(frameURL) {
    var µburi = µb.URI;
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
    var tabContext = µb.tabContextManager.mustLookup(tabId);
    this.tabId = tabId;

    // If we are navigating from-to same site, remember whether large
    // media elements were temporarily allowed.
    if (
        typeof this.allowLargeMediaElementsUntil !== 'number' ||
        tabContext.rootHostname !== this.tabHostname
    ) {
        this.allowLargeMediaElementsUntil = 0;
    }

    this.tabHostname = tabContext.rootHostname;
    this.title = tabContext.rawURL;
    this.rawURL = tabContext.rawURL;
    this.hostnameToCountMap = {};
    this.contentLastModified = 0;
    this.frames = Object.create(null);
    this.perLoadBlockedRequestCount = 0;
    this.perLoadAllowedRequestCount = 0;
    this.hiddenElementCount = ''; // Empty string means "unknown"
    this.remoteFontCount = 0;
    this.popupBlockedCount = 0;
    this.largeMediaCount = 0;
    this.largeMediaTimer = null;
    this.netFilteringCache = NetFilteringResultCache.factory();

    this.noCosmeticFiltering = µb.hnSwitches.evaluateZ('no-cosmetic-filtering', tabContext.rootHostname) === true;
    if ( µb.logger.isEnabled() && this.noCosmeticFiltering ) {
        µb.logger.writeOne(
            tabId,
            'cosmetic',
            µb.hnSwitches.toResultString(),
            'dom',
            tabContext.rawURL,
            this.tabHostname,
            this.tabHostname
        );
    }

    // Support `generichide` filter option.
    this.noGenericCosmeticFiltering = this.noCosmeticFiltering;
    if ( this.noGenericCosmeticFiltering !== true ) {
        this.noGenericCosmeticFiltering = µb.staticNetFilteringEngine.matchStringExactType(
            this.createContextFromPage(),
            tabContext.normalURL,
            'elemhide'
        ) === false;
        if ( µb.logger.isEnabled() && this.noGenericCosmeticFiltering ) {
            // https://github.com/gorhill/uBlock/issues/370
            // Log using `cosmetic-filtering`, not `elemhide`.
            µb.logger.writeOne(
                tabId,
                'net',
                µb.staticNetFilteringEngine.toResultString(true),
                'elemhide',
                tabContext.rawURL,
                this.tabHostname,
                this.tabHostname
            );
        }
    }

    return this;
};

/******************************************************************************/

PageStore.prototype.reuse = function(context) {
    // When force refreshing a page, the page store data needs to be reset.

    // If the hostname changes, we can't merely just update the context.
    var tabContext = µb.tabContextManager.mustLookup(this.tabId);
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
        this.rawURL = tabContext.rawURL;
        return this;
    }

    // A new page is completely reloaded from scratch, reset all.
    if ( this.largeMediaTimer !== null ) {
        clearTimeout(this.largeMediaTimer);
        this.largeMediaTimer = null;
    }
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
    this.tabHostname = '';
    this.title = '';
    this.rawURL = '';
    this.hostnameToCountMap = null;
    this.allowLargeMediaElementsUntil = 0;
    if ( this.largeMediaTimer !== null ) {
        clearTimeout(this.largeMediaTimer);
        this.largeMediaTimer = null;
    }
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
        frames[k].dispose();
    }
    this.frames = Object.create(null);
};

/******************************************************************************/

PageStore.prototype.getFrame = function(frameId) {
    return this.frames[frameId] || null;
};

/******************************************************************************/

PageStore.prototype.setFrame = function(frameId, frameURL) {
    var frameStore = this.frames[frameId];
    if ( frameStore ) {
        frameStore.init(frameURL);
    } else {
        this.frames[frameId] = FrameStore.factory(frameURL);
    }
};

/******************************************************************************/

PageStore.prototype.createContextFromPage = function() {
    var context = µb.tabContextManager.createContext(this.tabId);
    context.pageHostname = context.rootHostname;
    context.pageDomain = context.rootDomain;
    return context;
};

PageStore.prototype.createContextFromFrameId = function(frameId) {
    var context = µb.tabContextManager.createContext(this.tabId);
    var frameStore = this.frames[frameId];
    if ( frameStore ) {
        context.pageHostname = frameStore.pageHostname;
        context.pageDomain = frameStore.pageDomain;
    } else {
        context.pageHostname = context.rootHostname;
        context.pageDomain = context.rootDomain;
    }
    return context;
};

PageStore.prototype.createContextFromFrameHostname = function(frameHostname) {
    var context = µb.tabContextManager.createContext(this.tabId);
    context.pageHostname = frameHostname;
    context.pageDomain = µb.URI.domainFromHostname(frameHostname) || frameHostname;
    return context;
};

/******************************************************************************/

PageStore.prototype.getNetFilteringSwitch = function() {
    return µb.tabContextManager.mustLookup(this.tabId).getNetFilteringSwitch();
};

/******************************************************************************/

PageStore.prototype.getSpecificCosmeticFilteringSwitch = function() {
    return this.noCosmeticFiltering !== true;
};

/******************************************************************************/

PageStore.prototype.getGenericCosmeticFilteringSwitch = function() {
    return this.noGenericCosmeticFiltering !== true &&
           this.noCosmeticFiltering !== true;
};

/******************************************************************************/

PageStore.prototype.toggleNetFilteringSwitch = function(url, scope, state) {
    µb.toggleNetFilteringSwitch(url, scope, state);
    this.netFilteringCache.empty();
};

/******************************************************************************/

PageStore.prototype.logLargeMedia = (function() {
    var injectScript = function() {
        this.largeMediaTimer = null;
        µb.scriptlets.injectDeep(
            this.tabId,
            'load-large-media-interactive'
        );
        µb.contextMenu.update(this.tabId);
    };
    return function() {
        this.largeMediaCount += 1;
        if ( this.largeMediaTimer === null ) {
            this.largeMediaTimer = vAPI.setTimeout(injectScript.bind(this), 500);
        }
    };
})();

PageStore.prototype.temporarilyAllowLargeMediaElements = function() {
    this.largeMediaCount = 0;
    µb.contextMenu.update(this.tabId);
    this.allowLargeMediaElementsUntil = Date.now() + 86400000;
    µb.scriptlets.injectDeep(this.tabId, 'load-large-media-all');
};

/******************************************************************************/

PageStore.prototype.filterRequest = function(context) {
    var requestType = context.requestType;

    if ( this.getNetFilteringSwitch() === false ) {
        if ( collapsibleRequestTypes.indexOf(requestType) !== -1 ) {
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

    if ( requestType === 'font' ) {
        if ( µb.hnSwitches.evaluateZ('no-remote-fonts', context.rootHostname) !== false ) {
            result = µb.hnSwitches.toResultString();
        }
        this.remoteFontCount += 1;
    }

    if ( result === '' ) {
        µb.sessionURLFiltering.evaluateZ(context.rootHostname, context.requestURL, requestType);
        result = µb.sessionURLFiltering.toFilterString();
    }

    // Given that:
    // - Dynamic filtering override static filtering
    // - Evaluating dynamic filtering is much faster than static filtering
    // We evaluate dynamic filtering first, and hopefully we can skip
    // evaluation of static filtering.
    if ( result === '' && µb.userSettings.advancedUserEnabled ) {
        µb.sessionFirewall.evaluateCellZY( context.rootHostname, context.requestHostname, requestType);
        if ( µb.sessionFirewall.mustBlockOrAllow() ) {
            result = µb.sessionFirewall.toFilterString();
        }
    }

    // Static filtering never override dynamic filtering
    if ( result === '' || result.charAt(1) === 'n' ) {
        if ( µb.staticNetFilteringEngine.matchString(context) !== undefined ) {
            result = µb.staticNetFilteringEngine.toResultString(µb.logger.isEnabled());
        }
    }

    //console.debug('cache MISS: PageStore.filterRequest("%s")', context.requestURL);
    if ( collapsibleRequestTypes.indexOf(requestType) !== -1 ) {
        this.netFilteringCache.add(context, result);
    }

    // console.debug('[%s, %s] = "%s"', context.requestHostname, requestType, result);

    return result;
};

// http://jsperf.com/string-indexof-vs-object
var collapsibleRequestTypes = 'image sub_frame object';

/******************************************************************************/

PageStore.prototype.filterRequestNoCache = function(context) {
    if ( this.getNetFilteringSwitch() === false ) {
        return '';
    }

    var requestType = context.requestType;
    var result = '';

    if ( requestType === 'font' ) {
        if ( µb.hnSwitches.evaluateZ('no-remote-fonts', context.rootHostname) !== false ) {
            result = µb.hnSwitches.toResultString();
        }
        this.remoteFontCount += 1;
    }

    if ( result === '' ) {
        µb.sessionURLFiltering.evaluateZ(context.rootHostname, context.requestURL, requestType);
        result = µb.sessionURLFiltering.toFilterString();
    }

    // Given that:
    // - Dynamic filtering override static filtering
    // - Evaluating dynamic filtering is much faster than static filtering
    // We evaluate dynamic filtering first, and hopefully we can skip
    // evaluation of static filtering.
    if ( result === '' && µb.userSettings.advancedUserEnabled ) {
        µb.sessionFirewall.evaluateCellZY(context.rootHostname, context.requestHostname, requestType);
        if ( µb.sessionFirewall.mustBlockOrAllow() ) {
            result = µb.sessionFirewall.toFilterString();
        }
    }

    // Static filtering never override dynamic filtering
    if ( result === '' || result.charAt(1) === 'n' ) {
        if ( µb.staticNetFilteringEngine.matchString(context) !== undefined ) {
            result = µb.staticNetFilteringEngine.toResultString(µb.logger.isEnabled());
        }
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
    if ( c === 'b' ) {
        this.hostnameToCountMap[requestHostname] += 0x00000001;
        this.perLoadBlockedRequestCount++;
        µb.localSettings.blockedRequestCount++;
    } else /* if ( c === '' || c === 'a' || c === 'n' ) */ {
        this.hostnameToCountMap[requestHostname] += 0x00010000;
        this.perLoadAllowedRequestCount++;
        µb.localSettings.allowedRequestCount++;
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

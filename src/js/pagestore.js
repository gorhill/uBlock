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
    this.journal = [];
    this.journalTimer = null;
    this.journalLastCommitted = this.journalLastUncommitted = undefined;
    this.journalLastUncommittedURL = undefined;
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
    this.hostnameToCountMap = new Map();
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
    this.internalRedirectionCount = 0;

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
    if ( this.journalTimer !== null ) {
        clearTimeout(this.journalTimer);
        this.journalTimer = null;
    }
    this.journal = [];
    this.journalLastUncommittedURL = undefined;
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

// https://github.com/gorhill/uBlock/issues/2053
//   There is no way around using journaling to ensure we deal properly with
//   potentially out of order navigation events vs. network request events.

PageStore.prototype.journalAddRequest = function(hostname, result) {
    if ( hostname === '' ) { return; }
    this.journal.push(
        hostname,
        result.charCodeAt(1) === 0x62 /* 'b' */ ? 0x00000001 : 0x00010000
    );
    if ( this.journalTimer === null ) {
        this.journalTimer = vAPI.setTimeout(this.journalProcess.bind(this, true), 1000);
    }
};

PageStore.prototype.journalAddRootFrame = function(type, url) {
    if ( type === 'committed' ) {
        this.journalLastCommitted = this.journal.length;
        if (
            this.journalLastUncommitted !== undefined &&
            this.journalLastUncommitted < this.journalLastCommitted &&
            this.journalLastUncommittedURL === url
        ) {
            this.journalLastCommitted = this.journalLastUncommitted;
            this.journalLastUncommitted = undefined;
        }
    } else if ( type === 'uncommitted' ) {
        this.journalLastUncommitted = this.journal.length;
        this.journalLastUncommittedURL = url;
    }
    if ( this.journalTimer !== null ) {
        clearTimeout(this.journalTimer);
    }
    this.journalTimer = vAPI.setTimeout(this.journalProcess.bind(this, true), 1000);
};

PageStore.prototype.journalProcess = function(fromTimer) {
    if ( !fromTimer ) {
        clearTimeout(this.journalTimer);
    }
    this.journalTimer = null;

    var journal = this.journal,
        i, n = journal.length,
        hostname, count, hostnameCounts,
        aggregateCounts = 0,
        now = Date.now(),
        pivot = this.journalLastCommitted || 0;

    // Everything after pivot originates from current page.
    for ( i = pivot; i < n; i += 2 ) {
        hostname = journal[i];
        hostnameCounts = this.hostnameToCountMap.get(hostname);
        if ( hostnameCounts === undefined ) {
            hostnameCounts = 0;
            this.contentLastModified = now;
        }
        count = journal[i+1];
        this.hostnameToCountMap.set(hostname, hostnameCounts + count);
        aggregateCounts += count;
    }
    this.perLoadBlockedRequestCount += aggregateCounts & 0xFFFF;
    this.perLoadAllowedRequestCount += aggregateCounts >>> 16 & 0xFFFF;
    this.journalLastCommitted = undefined;

    // https://github.com/chrisaljoudi/uBlock/issues/905#issuecomment-76543649
    //   No point updating the badge if it's not being displayed.
    if ( (aggregateCounts & 0xFFFF) && µb.userSettings.showIconBadge ) {
        µb.updateBadgeAsync(this.tabId);
    }

    // Everything before pivot does not originate from current page -- we still
    // need to bump global blocked/allowed counts.
    for ( i = 0; i < pivot; i += 2 ) {
        aggregateCounts += journal[i+1];
    }
    if ( aggregateCounts !== 0 ) {
        µb.localSettings.blockedRequestCount += aggregateCounts & 0xFFFF;
        µb.localSettings.allowedRequestCount += aggregateCounts >>> 16 & 0xFFFF;
        µb.localSettingsLastModified = now;
    }
    journal.length = 0;
};

/******************************************************************************/

PageStore.prototype.filterRequest = function(context) {
    var requestType = context.requestType;

    // We want to short-term cache filtering results of collapsible types,
    // because they are likely to be reused, from network request handler and
    // from content script handler.
    if ( 'image sub_frame object'.indexOf(requestType) === -1 ) {
        return this.filterRequestNoCache(context);
    }

    if ( this.getNetFilteringSwitch() === false ) {
        this.netFilteringCache.add(context, '');
        return '';
    }

    var entry = this.netFilteringCache.lookup(context);
    if ( entry !== undefined ) {
        //console.debug('cache HIT: PageStore.filterRequest("%s")', context.requestURL);
        return entry.result;
    }

    var result = '';

    // Dynamic URL filtering.
    if ( result === '' ) {
        µb.sessionURLFiltering.evaluateZ(context.rootHostname, context.requestURL, requestType);
        result = µb.sessionURLFiltering.toFilterString();
    }

    // Dynamic hostname/type filtering.
    if ( result === '' && µb.userSettings.advancedUserEnabled ) {
        µb.sessionFirewall.evaluateCellZY( context.rootHostname, context.requestHostname, requestType);
        if ( µb.sessionFirewall.mustBlockOrAllow() ) {
            result = µb.sessionFirewall.toFilterString();
        }
    }

    // Static filtering has lowest precedence.
    if ( result === '' || result.charAt(1) === 'n' ) {
        if ( µb.staticNetFilteringEngine.matchString(context) !== undefined ) {
            result = µb.staticNetFilteringEngine.toResultString(µb.logger.isEnabled());
        }
    }

    //console.debug('cache MISS: PageStore.filterRequest("%s")', context.requestURL);
    this.netFilteringCache.add(context, result);

    return result;
};

/******************************************************************************/

PageStore.prototype.filterRequestNoCache = function(context) {
    if ( this.getNetFilteringSwitch() === false ) {
        return '';
    }

    var requestType = context.requestType,
        result = '';

    if ( requestType === 'csp_report' ) {
        if ( this.internalRedirectionCount !== 0 ) {
            result = 'gb:no-spurious-csp-report';
        }
    } else if ( requestType === 'font' ) {
        if ( µb.hnSwitches.evaluateZ('no-remote-fonts', context.rootHostname) !== false ) {
            result = µb.hnSwitches.toResultString();
        }
        this.remoteFontCount += 1;
    }

    // Dynamic URL filtering.
    if ( result === '' ) {
        µb.sessionURLFiltering.evaluateZ(context.rootHostname, context.requestURL, requestType);
        result = µb.sessionURLFiltering.toFilterString();
    }

    // Dynamic hostname/type filtering.
    if ( result === '' && µb.userSettings.advancedUserEnabled ) {
        µb.sessionFirewall.evaluateCellZY(context.rootHostname, context.requestHostname, requestType);
        if ( µb.sessionFirewall.mustBlockOrAllow() ) {
            result = µb.sessionFirewall.toFilterString();
        }
    }

    // Static filtering has lowest precedence.
    if ( result === '' || result.charAt(1) === 'n' ) {
        if ( µb.staticNetFilteringEngine.matchString(context) !== undefined ) {
            result = µb.staticNetFilteringEngine.toResultString(µb.logger.isEnabled());
        }
    }

    return result;
};

// https://www.youtube.com/watch?v=drW8p_dTLD4

/******************************************************************************/

return {
    factory: PageStore.factory
};

})();

/******************************************************************************/

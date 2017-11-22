/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2017 Raymond Hill

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
var netFilteringCacheJunkyard = [],
    netFilteringCacheJunkyardMax = 10;

/******************************************************************************/

var NetFilteringResultCache = function() {
    this.boundPruneAsyncCallback = this.pruneAsyncCallback.bind(this);
    this.init();
};

/******************************************************************************/

NetFilteringResultCache.prototype.shelfLife = 15 * 1000;

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
    this.blocked = new Map();
    this.results = new Map();
    this.hash = 0;
    this.timer = null;
};

/******************************************************************************/

NetFilteringResultCache.prototype.dispose = function() {
    this.empty();
    if ( netFilteringCacheJunkyard.length < netFilteringCacheJunkyardMax ) {
        netFilteringCacheJunkyard.push(this);
    }
    return null;
};

/******************************************************************************/

NetFilteringResultCache.prototype.rememberResult = function(context, result, logData) {
    if ( this.results.size === 0 ) {
        this.pruneAsync();
    }
    var key = context.pageHostname + ' ' + context.requestType + ' ' + context.requestURL;
    this.results.set(key, {
        result: result,
        logData: logData,
        tstamp: Date.now()
    });
    if ( result !== 1 ) { return; }
    var now = Date.now();
    this.blocked.set(key, now);
    this.hash = now;
};

/******************************************************************************/

NetFilteringResultCache.prototype.rememberBlock = function(details) {
    if ( this.blocked.size === 0 ) {
        this.pruneAsync();
    }
    var now = Date.now();
    this.blocked.set(
        details.pageHostname + ' ' + details.requestType + ' ' + details.requestURL,
        now
    );
    this.hash = now;
};

/******************************************************************************/

NetFilteringResultCache.prototype.empty = function() {
    this.blocked.clear();
    this.results.clear();
    this.hash = 0;
    if ( this.timer !== null ) {
        clearTimeout(this.timer);
        this.timer = null;
    }
};

/******************************************************************************/

NetFilteringResultCache.prototype.pruneAsync = function() {
    if ( this.timer === null ) {
        this.timer = vAPI.setTimeout(this.boundPruneAsyncCallback, this.shelfLife * 2);
    }
};

NetFilteringResultCache.prototype.pruneAsyncCallback = function() {
    this.timer = null;
    var obsolete = Date.now() - this.shelfLife,
        entry;
    for ( entry of this.blocked ) {
        if ( entry[1] <= obsolete ) {
            this.results.delete(entry[0]);
            this.blocked.delete(entry[0]);
        }
    }
    for ( entry of this.results ) {
        if ( entry[1].tstamp <= obsolete ) {
            this.results.delete(entry[0]);
        }
    }
    if ( this.blocked.size !== 0 || this.results.size !== 0 ) {
        this.pruneAsync();
    }
};

/******************************************************************************/

NetFilteringResultCache.prototype.lookupResult = function(context) {
    return this.results.get(
        context.pageHostname + ' ' +
        context.requestType + ' ' +
        context.requestURL
    );
};

/******************************************************************************/

NetFilteringResultCache.prototype.lookupAllBlocked = function(hostname) {
    var result = [],
        pos;
    for ( var entry of this.blocked ) {
        pos = entry[0].indexOf(' ');
        if ( entry[0].slice(0, pos) === hostname ) {
            result[result.length] = entry[0].slice(pos + 1);
        }
    }
    return result;
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

var PageStore = function(tabId, context) {
    this.init(tabId, context);
    this.journal = [];
    this.journalTimer = null;
    this.journalLastCommitted = this.journalLastUncommitted = undefined;
    this.journalLastUncommittedURL = undefined;
};

/******************************************************************************/

PageStore.factory = function(tabId, context) {
    var entry = pageStoreJunkyard.pop();
    if ( entry === undefined ) {
        entry = new PageStore(tabId, context);
    } else {
        entry.init(tabId, context);
    }
    return entry;
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/3201
//   The context is used to determine whether we report behavior change to the
//   logger.

PageStore.prototype.init = function(tabId, context) {
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
    this.logData = undefined;
    this.perLoadBlockedRequestCount = 0;
    this.perLoadAllowedRequestCount = 0;
    this.hiddenElementCount = ''; // Empty string means "unknown"
    this.remoteFontCount = 0;
    this.popupBlockedCount = 0;
    this.largeMediaCount = 0;
    this.largeMediaTimer = null;
    this.netFilteringCache = NetFilteringResultCache.factory();
    this.internalRedirectionCount = 0;

    this.noCosmeticFiltering = µb.hnSwitches.evaluateZ(
        'no-cosmetic-filtering',
        tabContext.rootHostname
    ) === true;
    if (
        this.noCosmeticFiltering &&
        µb.logger.isEnabled() &&
        context === 'tabCommitted'
    ) {
        µb.logger.writeOne(
            tabId,
            'cosmetic',
            µb.hnSwitches.toLogData(),
            'dom',
            tabContext.rawURL,
            this.tabHostname,
            this.tabHostname
        );
    }

    // Support `generichide` filter option.
    this.noGenericCosmeticFiltering = this.noCosmeticFiltering;
    if ( this.noGenericCosmeticFiltering !== true ) {
        var result = µb.staticNetFilteringEngine.matchStringExactType(
            this.createContextFromPage(),
            tabContext.normalURL,
            'generichide'
        );
        this.noGenericCosmeticFiltering = result === 2;
        if (
            result !== 0 &&
            µb.logger.isEnabled() &&
            context === 'tabCommitted'
        ) {
            µb.logger.writeOne(
                tabId,
                'net',
                µb.staticNetFilteringEngine.toLogData(),
                'generichide',
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
    this.init(this.tabId, context);
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

PageStore.prototype.injectLargeMediaElementScriptlet = function() {
    this.largeMediaTimer = null;
    µb.scriptlets.injectDeep(
        this.tabId,
        'load-large-media-interactive'
    );
    µb.contextMenu.update(this.tabId);
};

PageStore.prototype.temporarilyAllowLargeMediaElements = function(state) {
    this.largeMediaCount = 0;
    µb.contextMenu.update(this.tabId);
    this.allowLargeMediaElementsUntil = state ? Date.now() + 86400000 : 0;
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
        result === 1 ? 0x00000001 : 0x00010000
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
    this.logData = undefined;

    if ( this.getNetFilteringSwitch() === false ) {
        return 0;
    }

    var requestType = context.requestType;

    if ( requestType === 'csp_report' && this.filterCSPReport(context) === 1 ) {
        return 1;
    }

    if ( requestType.endsWith('font') && this.filterFont(context) === 1 ) {
        return 1;
    }

    var cacheableResult = this.cacheableResults[requestType] === true;

    if ( cacheableResult ) {
        var entry = this.netFilteringCache.lookupResult(context);
        if ( entry !== undefined ) {
            this.logData = entry.logData;
            return entry.result;
        }
    }

    // Dynamic URL filtering.
    var result = µb.sessionURLFiltering.evaluateZ(context.rootHostname, context.requestURL, requestType);
    if ( result !== 0 && µb.logger.isEnabled() ) {
        this.logData = µb.sessionURLFiltering.toLogData();
    }

    // Dynamic hostname/type filtering.
    if ( result === 0 && µb.userSettings.advancedUserEnabled ) {
        result = µb.sessionFirewall.evaluateCellZY(context.rootHostname, context.requestHostname, requestType);
        if ( result !== 0 && result !== 3 && µb.logger.isEnabled() ) {
            this.logData = µb.sessionFirewall.toLogData();
        }
    }

    // Static filtering has lowest precedence.
    if ( result === 0 || result === 3 ) {
        result = µb.staticNetFilteringEngine.matchString(context);
        if ( result !== 0 && µb.logger.isEnabled() ) {
            this.logData = µb.staticNetFilteringEngine.toLogData();
        }
    }

    if ( cacheableResult ) {
        this.netFilteringCache.rememberResult(context, result, this.logData);
    } else if ( result === 1 && this.collapsibleResources[requestType] === true ) {
        this.netFilteringCache.rememberBlock(context, true);
    }

    return result;
};

PageStore.prototype.cacheableResults = {
    sub_frame: true
};

PageStore.prototype.collapsibleResources = {
    image: true,
    media: true,
    object: true,
    sub_frame: true
};

/******************************************************************************/

PageStore.prototype.filterCSPReport = function(context) {
    if ( µb.hnSwitches.evaluateZ('no-csp-reports', context.requestHostname) ) {
        if ( µb.logger.isEnabled() ) {
            this.logData = µb.hnSwitches.toLogData();
        }
        return 1;
    }
    // https://github.com/gorhill/uBlock/issues/3140
    //   Special handling of CSP reports if and only if these can't be filtered
    //   natively.
    if (
        vAPI.net.nativeCSPReportFiltering !== true &&
        this.internalRedirectionCount !== 0
    ) {
        if ( µb.logger.isEnabled() ) {
            this.logData = {
                result: 1,
                source: 'global',
                raw: 'no-spurious-csp-report'
            };
        }
        return 1;
    }
    return 0;
};

/******************************************************************************/

PageStore.prototype.filterFont = function(context) {
    if ( context.requestType === 'font' ) {
        this.remoteFontCount += 1;
    }
    if ( µb.hnSwitches.evaluateZ('no-remote-fonts', context.rootHostname) !== false ) {
        if ( µb.logger.isEnabled() ) {
            this.logData = µb.hnSwitches.toLogData();
        }
        return 1;
    }
    return 0;
};

/******************************************************************************/

// The caller is responsible to check whether filtering is enabled or not.

PageStore.prototype.filterLargeMediaElement = function(size) {
    this.logData = undefined;

    if ( Date.now() < this.allowLargeMediaElementsUntil ) {
        return 0;
    }
    if ( µb.hnSwitches.evaluateZ('no-large-media', this.tabHostname) !== true ) {
        return 0;
    }
    if ( (size >>> 10) < µb.userSettings.largeMediaSize ) {
        return 0;
    }

    this.largeMediaCount += 1;
    if ( this.largeMediaTimer === null ) {
        this.largeMediaTimer = vAPI.setTimeout(
            this.injectLargeMediaElementScriptlet.bind(this),
            500
        );
    }

    if ( µb.logger.isEnabled() ) {
        this.logData = µb.hnSwitches.toLogData();
    }

    return 1;
};

// https://www.youtube.com/watch?v=drW8p_dTLD4

/******************************************************************************/

PageStore.prototype.getBlockedResources = function(request, response) {
    var µburi = µb.URI,
        normalURL = µb.normalizePageURL(this.tabId, request.frameURL),
        frameHostname = µburi.hostnameFromURI(normalURL),
        resources = request.resources;
    // Force some resources to go through the filtering engine in order to
    // populate the blocked-resources cache. This is required because for
    // some resources it's not possible to detect whether they were blocked
    // content script-side (i.e. `iframes` -- unlike `img`).
    if ( Array.isArray(resources) && resources.length !== 0 ) {
        var context = this.createContextFromFrameHostname(frameHostname);
        for ( var resource of resources ) {
            context.requestType = resource.type;
            context.requestHostname = µburi.hostnameFromURI(resource.url);
            context.requestURL = resource.url;
            this.filterRequest(context);
        }
    }
    if ( this.netFilteringCache.hash === response.hash ) { return; }
    response.hash = this.netFilteringCache.hash;
    response.blockedResources = this.netFilteringCache.lookupAllBlocked(frameHostname);
};

/******************************************************************************/

return {
    factory: PageStore.factory
};

})();

/******************************************************************************/

/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2014-present Raymond Hill

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

/******************************************************************************/

import * as frameManager from './vapi-contexts.js';

import {
    hostnameFromURI,
    isNetworkURI,
} from './uri-utils.js';

import {
    sessionFirewall,
    sessionSwitches,
    sessionURLFiltering,
} from './filtering-engines.js';

import contextMenu from './contextmenu.js';
import logger from './logger.js';
import { orphanizeString } from './text-utils.js';
import { redirectEngine } from './redirect-engine.js';
import staticNetFilteringEngine from './static-net-filtering.js';
import µb from './background.js';

/*******************************************************************************

A PageRequestStore object is used to store net requests in two ways:

To record distinct net requests
To create a log of net requests

**/

/******************************************************************************/

const NetFilteringResultCache = class {
    shelfLife = 15000;
    extensionOriginURL = vAPI.getURL('/');

    constructor() {
        this.pruneTimer = vAPI.defer.create(( ) => {
            this.prune();
        });
        this.init();
    }

    init() {
        this.blocked = new Map();
        this.results = new Map();
        this.hash = 0;
        return this;
    }

    // https://github.com/gorhill/uBlock/issues/3619
    //   Don't collapse redirected resources
    rememberResult(fctxt, result) {
        if ( fctxt.tabId <= 0 ) { return; }
        if ( this.results.size === 0 ) {
            this.pruneAsync();
        }
        const key = `${fctxt.getDocHostname()} ${fctxt.type} ${fctxt.url}`;
        this.results.set(key, {
            result,
            redirectURL: fctxt.redirectURL,
            logData: fctxt.filter,
            tstamp: Date.now()
        });
        if ( result !== 1 || fctxt.redirectURL !== undefined ) { return; }
        const now = Date.now();
        this.blocked.set(key, now);
        this.hash = now;
    }

    rememberBlock(fctxt) {
        if ( fctxt.tabId <= 0 ) { return; }
        if ( this.blocked.size === 0 ) {
            this.pruneAsync();
        }
        if ( fctxt.redirectURL !== undefined ) { return; }
        const now = Date.now();
        this.blocked.set(
            `${fctxt.getDocHostname()} ${fctxt.type} ${fctxt.url}`,
            now
        );
        this.hash = now;
    }

    forgetResult(docHostname, type, url) {
        const key = `${docHostname} ${type} ${url}`;
        this.results.delete(key);
        this.blocked.delete(key);
    }

    empty() {
        this.blocked.clear();
        this.results.clear();
        this.hash = 0;
        this.pruneTimer.off();
    }

    prune() {
        const obsolete = Date.now() - this.shelfLife;
        for ( const entry of this.blocked ) {
            if ( entry[1] <= obsolete ) {
                this.results.delete(entry[0]);
                this.blocked.delete(entry[0]);
            }
        }
        for ( const entry of this.results ) {
            if ( entry[1].tstamp <= obsolete ) {
                this.results.delete(entry[0]);
            }
        }
        if ( this.blocked.size !== 0 || this.results.size !== 0 ) {
            this.pruneAsync();
        }
    }

    pruneAsync() {
        this.pruneTimer.on(this.shelfLife);
    }

    lookupResult(fctxt) {
        const entry = this.results.get(
            fctxt.getDocHostname() + ' ' +
            fctxt.type + ' ' +
            fctxt.url
        );
        if ( entry === undefined ) { return; }
        // We need to use a new WAR secret if one is present since WAR secrets
        // can only be used once.
        if (
            entry.redirectURL !== undefined &&
            entry.redirectURL.startsWith(this.extensionOriginURL)
        ) {
            const redirectURL = new URL(entry.redirectURL);
            redirectURL.searchParams.set('secret', vAPI.warSecret.short());
            entry.redirectURL = redirectURL.href;
        }
        return entry;
    }

    lookupAllBlocked(hostname) {
        const result = [];
        for ( const entry of this.blocked ) {
            const pos = entry[0].indexOf(' ');
            if ( entry[0].slice(0, pos) === hostname ) {
                result[result.length] = entry[0].slice(pos + 1);
            }
        }
        return result;
    }

    static factory() {
        return new NetFilteringResultCache();
    }
};

/******************************************************************************/

const CountDetails = class {
    constructor() {
        this.allowed = { any: 0, frame: 0, script: 0 };
        this.blocked = { any: 0, frame: 0, script: 0 };
    }
    reset() {
        const { allowed, blocked } = this;
        blocked.any = blocked.frame = blocked.script =
        allowed.any = allowed.frame = allowed.script = 0;
    }
    inc(blocked, type = undefined) {
        const stat = blocked ? this.blocked : this.allowed;
        if ( type !== undefined ) { stat[type] += 1; }
        stat.any += 1;
    }
};

const HostnameDetails = class {
    constructor(hostname) {
        this.counts = new CountDetails();
        this.init(hostname);
    }
    init(hostname) {
        this.hostname = hostname;
        this.cname = vAPI.net.canonicalNameFromHostname(hostname);
        this.counts.reset();
        return this;
    }
    dispose() {
        const HD = HostnameDetails;
        if ( HD.junkyard.length >= HD.junkyardMax ) { return; }
        HD.junkyard.push(this);
    }
    static factory(hostname) {
        const HD = HostnameDetails;
        if ( HD.junkyard.length !== 0 ) {
            return HD.junkyard.pop().init(hostname);
        }
        return new HD(hostname);
    }
    static junkyard = [];
    static junkyardMax = 100;
};

const HostnameDetailsMap = class extends Map {
    reset() {
        this.clear();
    }
    dispose() {
        for ( const item of this.values() ) {
            item.dispose();
        }
        this.reset();
    }
};

/******************************************************************************/

const PageStore = class {
    constructor(tabId, details) {
        this.extraData = new Map();
        this.journal = [];
        this.journalLastCommitted = this.journalLastUncommitted = -1;
        this.journalLastUncommittedOrigin = undefined;
        this.netFilteringCache = NetFilteringResultCache.factory();
        this.hostnameDetailsMap = new HostnameDetailsMap();
        this.counts = new CountDetails();
        this.journalTimer = vAPI.defer.create(( ) => {
            this.journalProcess();
        });
        this.largeMediaTimer = vAPI.defer.create(( ) => {
            this.injectLargeMediaElementScriptlet();
        });
        this.init(tabId, details);
    }

    static factory(tabId, details) {
        return new PageStore(tabId, details);
    }

    // https://github.com/gorhill/uBlock/issues/3201
    //   The context is used to determine whether we report behavior change
    //   to the logger.

    init(tabId, details) {
        const topURL = frameManager.getTopURL(tabId);
        const topHostname = hostnameFromURI(topURL);
        this.tabId = tabId;

        // If we are navigating from-to same site, remember whether large
        // media elements were temporarily allowed.
        const now = Date.now();
        if ( typeof this.allowLargeMediaElementsUntil !== 'number' ) {
            this.allowLargeMediaElementsUntil = now;
        } else if ( topHostname !== this.tabHostname ) {
            if ( this.tabHostname.endsWith('about-scheme') === false ) {
                this.allowLargeMediaElementsUntil = now;
            }
        }

        this.tabHostname = topHostname;
        this.rawURL = topURL;
        this.hostnameDetailsMap.reset();
        this.contentLastModified = 0;
        this.logData = undefined;
        this.counts.reset();
        this.remoteFontCount = 0;
        this.popupBlockedCount = 0;
        this.largeMediaCount = 0;
        this.allowLargeMediaElementsRegex = undefined;
        this.extraData.clear();

        this.frameAddCount = 0;
        this.clickedToLoad = new Set();

        if ( this.titleFromDetails(details) === false ) {
            this.title = topURL;
        }

        // Remember if the webpage was potentially improperly filtered, for
        // reporting purpose.
        this.hasUnprocessedRequest = vAPI.net.hasUnprocessedRequest(tabId);

        return this;
    }

    reuse(context, details) {
        // When force refreshing a page, the page store data needs to be reset.

        // If the hostname changes, we can't merely just update the context.
        const topURL = frameManager.getTopURL(this.tabId);
        const topHostname = hostnameFromURI(topURL);
        if ( topHostname !== this.tabHostname ) {
            context = '';
        }

        // If URL changes without a page reload (more and more common), then
        // we need to keep all that we collected for reuse. In particular,
        // not doing so was causing a problem in `videos.foxnews.com`:
        // clicking a video thumbnail would not work, because the frame
        // hierarchy structure was flushed from memory, while not really being
        //  flushed on the page.
        if ( context === 'tabUpdated' ) {
            // As part of https://github.com/chrisaljoudi/uBlock/issues/405
            // URL changed, force a re-evaluation of filtering switch
            this.rawURL = topURL;
            this.titleFromDetails(details);
            return this;
        }

        // A new page is completely reloaded from scratch, reset all.
        this.largeMediaTimer.off();
        this.init(this.tabId, details);
        return this;
    }

    titleFromDetails(details) {
        if (
            details instanceof Object === false ||
            details.title === undefined
        ) {
            return false;
        }
        this.title = orphanizeString(details.title.slice(0, 128));
        return true;
    }

    isTrusted() {
        return this.isNotTrusted() === false;
    }

    isNotTrusted() {
        return µb.isTrustedSite(this.rawURL) !== true;
    }

    toggleTrustedStatus(url, scope, state) {
        const r = µb.toggleTrustedStatus(url, scope, state);
        if ( r === 0 ) { return; }
        this.netFilteringCache.empty();
    }

    getCosmeticFiltering(frameId = 0) {
        if ( this.isTrusted() ) {
            return { specific: false, generic: false };
        }
        const hnSwitch = sessionSwitches.evaluateZ('no-cosmetic-filtering',
            this.tabHostname
        );
        if ( hnSwitch ) {
            if ( logger.enabled ) {
                µb.filteringContext
                    .duplicate()
                    .fromTabId(this.tabId)
                    .setURL(this.rawURL)
                    .setRealm('cosmetic')
                    .setType('dom')
                    .setFilter(sessionSwitches.toLogData())
                    .toLogger();
            }
            return { specific: false, generic: false };
        }
        const out = { specific: true, generic: true };
        const frameURL = frameManager.getEffectiveURL(this.tabId, frameId);
        if ( Boolean(frameURL) === false ) { return out; }
        const fctxt = µb.filteringContext
            .duplicate()
            .fromTabId(this.tabId)
            .setURL(frameURL)
            .setDocOriginFromURL(frameURL)
            .setMethod('')
            .setRealm('network');
        fctxt.setType('specifichide');
        let result = staticNetFilteringEngine.matchRequest(fctxt, 0b11);
        if ( result !== 0 ) {
            out.specific = result !== 2;
            if ( logger.enabled ) {
                fctxt.setFilter(staticNetFilteringEngine.toLogData()).toLogger();
            }
        }
        fctxt.setType('generichide');
        result = staticNetFilteringEngine.matchRequest(fctxt, 0b11);
        if ( result !== 0 ) {
            out.generic = result !== 2;
            if ( logger.enabled ) {
                fctxt.setFilter(staticNetFilteringEngine.toLogData()).toLogger();
            }
        }
        return out;
    }

    // https://github.com/gorhill/uBlock/issues/2105
    //   Be sure to always include the current page's hostname -- it might not
    //   be present when the page itself is pulled from the browser's
    //   short-term memory cache.
    getAllHostnameDetails() {
        if (
            this.hostnameDetailsMap.has(this.tabHostname) === false &&
            isNetworkURI(this.rawURL)
        ) {
            this.hostnameDetailsMap.set(
                this.tabHostname,
                HostnameDetails.factory(this.tabHostname)
            );
        }
        return this.hostnameDetailsMap;
    }

    injectLargeMediaElementScriptlet() {
        vAPI.tabs.executeScript(this.tabId, {
            file: '/js/scriptlets/load-large-media-interactive.js',
            allFrames: true,
            runAt: 'document_idle',
        });
        contextMenu.update(this.tabId);
    }

    temporarilyAllowLargeMediaElements(state) {
        this.largeMediaCount = 0;
        contextMenu.update(this.tabId);
        if ( state ) {
            this.allowLargeMediaElementsUntil = 0;
            this.allowLargeMediaElementsRegex = undefined;
        } else {
            this.allowLargeMediaElementsUntil = Date.now();
        }
        vAPI.tabs.executeScript(this.tabId, {
            file: '/js/scriptlets/load-large-media-all.js',
            allFrames: true,
        });
    }

    // https://github.com/gorhill/uBlock/issues/2053
    //   There is no way around using journaling to ensure we deal properly with
    //   potentially out of order navigation events vs. network request events.
    journalAddRequest(fctxt, result) {
        const hostname = fctxt.getHostname();
        if ( hostname === '' ) { return; }
        this.journal.push(hostname, result, fctxt.itype);
        this.journalTimer.on(µb.hiddenSettings.requestJournalProcessPeriod);
    }

    journalAddRootFrame(type, url) {
        if ( type === 'committed' ) {
            this.journalLastCommitted = this.journal.length;
            if (
                this.journalLastUncommitted !== -1 &&
                this.journalLastUncommitted < this.journalLastCommitted &&
                this.journalLastUncommittedOrigin === hostnameFromURI(url)
            ) {
                this.journalLastCommitted = this.journalLastUncommitted;
            }
        } else if ( type === 'uncommitted' ) {
            const newOrigin = hostnameFromURI(url);
            if (
                this.journalLastUncommitted === -1 ||
                this.journalLastUncommittedOrigin !== newOrigin
            ) {
                this.journalLastUncommitted = this.journal.length;
                this.journalLastUncommittedOrigin = newOrigin;
            }
        }
        this.journalTimer.offon(µb.hiddenSettings.requestJournalProcessPeriod);
    }

    journalProcess() {
        this.journalTimer.off();

        const journal = this.journal;
        const pivot = Math.max(0, this.journalLastCommitted);
        const now = Date.now();
        const { SCRIPT, SUB_FRAME, OBJECT } = µb.FilteringContext;
        let aggregateAllowed = 0;
        let aggregateBlocked = 0;

        // Everything after pivot originates from current page.
        for ( let i = pivot; i < journal.length; i += 3 ) {
            const hostname = journal[i+0];
            let hnDetails = this.hostnameDetailsMap.get(hostname);
            if ( hnDetails === undefined ) {
                hnDetails = HostnameDetails.factory(hostname);
                this.hostnameDetailsMap.set(hostname, hnDetails);
                this.contentLastModified = now;
            }
            const blocked = journal[i+1] === 1;
            const itype = journal[i+2];
            if ( itype === SCRIPT ) {
                hnDetails.counts.inc(blocked, 'script');
                this.counts.inc(blocked, 'script');
            } else if ( itype === SUB_FRAME || itype === OBJECT ) {
                hnDetails.counts.inc(blocked, 'frame');
                this.counts.inc(blocked, 'frame');
            } else {
                hnDetails.counts.inc(blocked);
                this.counts.inc(blocked);
            }
            if ( blocked ) {
                aggregateBlocked += 1;
            } else {
                aggregateAllowed += 1;
            }
        }
        this.journalLastUncommitted = this.journalLastCommitted = -1;

        // https://github.com/chrisaljoudi/uBlock/issues/905#issuecomment-76543649
        //   No point updating the badge if it's not being displayed.
        if ( aggregateBlocked !== 0 && µb.userSettings.showIconBadge ) {
            µb.updateToolbarIcon(this.tabId, 0x02);
        }

        // Everything before pivot does not originate from current page -- we
        // still need to bump global blocked/allowed counts.
        for ( let i = 0; i < pivot; i += 3 ) {
            if ( journal[i+1] === 1 ) {
                aggregateBlocked += 1;
            } else {
                aggregateAllowed += 1;
            }
        }
        if ( aggregateAllowed || aggregateBlocked ) {
            µb.incrementRequestStats(aggregateBlocked, aggregateAllowed);
        }
        journal.length = 0;
    }

    filterRequest(fctxt) {
        fctxt.filter = undefined;
        fctxt.redirectURL = undefined;

        if ( this.isTrusted(fctxt) ) { return 0; }

        if (
            fctxt.itype === fctxt.CSP_REPORT &&
            this.filterCSPReport(fctxt) === 1
        ) {
            return 1;
        }

        if (
            (fctxt.itype & fctxt.FONT_ANY) !== 0 &&
            this.filterFont(fctxt) === 1 )
        {
            return 1;
        }

        if (
            fctxt.itype === fctxt.SCRIPT &&
            this.filterScripting(fctxt, false) === 1
        ) {
            return 1;
        }

        const cacheableResult =
            this.cacheableResults.has(fctxt.itype) &&
            fctxt.aliasURL === undefined;

        if ( cacheableResult ) {
            const entry = this.netFilteringCache.lookupResult(fctxt);
            if ( entry !== undefined ) {
                fctxt.redirectURL = entry.redirectURL;
                fctxt.filter = entry.logData;
                return entry.result;
            }
        }

        const requestType = fctxt.type;
        const loggerEnabled = logger.enabled;

        // Dynamic URL filtering.
        let result = sessionURLFiltering.evaluateZ(
            fctxt.getTabHostname(),
            fctxt.url,
            requestType
        );
        if ( result !== 0 && loggerEnabled ) {
            fctxt.filter = sessionURLFiltering.toLogData();
        }

        // Dynamic hostname/type filtering.
        if ( result === 0 && µb.userSettings.advancedUserEnabled ) {
            result = sessionFirewall.evaluateCellZY(
                fctxt.getTabHostname(),
                fctxt.getHostname(),
                requestType
            );
            if ( result !== 0 && result !== 3 && loggerEnabled ) {
                fctxt.filter = sessionFirewall.toLogData();
            }
        }

        // Static filtering has lowest precedence.
        const snfe = staticNetFilteringEngine;
        if ( result === 0 || result === 3 ) {
            result = snfe.matchRequest(fctxt);
            if ( result !== 0 ) {
                if ( loggerEnabled ) {
                    fctxt.setFilter(snfe.toLogData());
                }
                // https://github.com/uBlockOrigin/uBlock-issues/issues/943
                //   Blanket-except blocked aliased canonical hostnames?
                if (
                    result === 1 &&
                    fctxt.aliasURL !== undefined &&
                    snfe.isBlockImportant() === false &&
                    this.shouldExceptCname(fctxt)
                ) {
                    return 2;
                }
            }
        }

        // Click-to-load?
        // When frameId is not -1, the resource is always sub_frame.
        if ( result === 1 && fctxt.frameId !== -1 ) {
            if ( this.clickedToLoad.has(fctxt.frameId) ) {
                result = 2;
                if ( loggerEnabled ) {
                    fctxt.pushFilter({
                        result,
                        source: 'network',
                        raw: 'click-to-load',
                    });
                }
            }
        }

        // Modifier(s)?
        // A modifier is an action which transform the original network request.
        // https://github.com/gorhill/uBlock/issues/949
        //   Redirect blocked request?
        // https://github.com/uBlockOrigin/uBlock-issues/issues/760
        //   Redirect non-blocked request?
        if ( (fctxt.itype & fctxt.INLINE_ANY) === 0 ) {
            if ( result === 1 ) {
                this.redirectBlockedRequest(fctxt);
            } else {
                this.redirectNonBlockedRequest(fctxt);
            }
        }

        if ( cacheableResult ) {
            this.netFilteringCache.rememberResult(fctxt, result);
        } else if ( result === 1 && this.collapsibleResources.has(fctxt.itype) ) {
            this.netFilteringCache.rememberBlock(fctxt);
        }

        return result;
    }

    filterOnHeaders(fctxt, ...headers) {
        fctxt.filter = undefined;

        if ( this.isTrusted(fctxt) ) { return 0; }

        let result = staticNetFilteringEngine.matchHeaders(fctxt, ...headers);
        if ( result === 0 ) { return 0; }

        const loggerEnabled = logger.enabled;
        if ( loggerEnabled ) {
            fctxt.filter = staticNetFilteringEngine.toLogData();
        }

        // Dynamic filtering allow rules
        // URL filtering
        if (
            result === 1 &&
            sessionURLFiltering.evaluateZ(
                fctxt.getTabHostname(),
                fctxt.url,
                fctxt.type
            ) === 2
        ) {
            result = 2;
            if ( loggerEnabled ) {
                fctxt.filter = sessionURLFiltering.toLogData();
            }
        }
        // Hostname filtering
        if (
            result === 1 &&
            µb.userSettings.advancedUserEnabled &&
            sessionFirewall.evaluateCellZY(
                fctxt.getTabHostname(),
                fctxt.getHostname(),
                fctxt.type
            ) === 2
        ) {
            result = 2;
            if ( loggerEnabled ) {
                fctxt.filter = sessionFirewall.toLogData();
            }
        }

        return result;
    }

    redirectBlockedRequest(fctxt) {
        const directives = staticNetFilteringEngine.redirectRequest(redirectEngine, fctxt) || [];
        if ( this.urlSkippableResources.has(fctxt.itype) ) {
            staticNetFilteringEngine.urlSkip(fctxt, true, directives);
        }
        if ( directives.length === 0 ) { return; }
        if ( logger.enabled !== true ) { return; }
        fctxt.pushFilters(directives.map(a => a.logData()));
        if ( fctxt.redirectURL === undefined ) { return; }
        fctxt.pushFilter({
            source: 'redirect',
            raw: directives[directives.length-1].value
        });
    }

    redirectNonBlockedRequest(fctxt) {
        const directives = [];
        staticNetFilteringEngine.transformURL(fctxt, directives);
        if ( staticNetFilteringEngine.hasQuery(fctxt) ) {
            staticNetFilteringEngine.filterQuery(fctxt, directives);
        }
        if ( this.urlSkippableResources.has(fctxt.itype) ) {
            staticNetFilteringEngine.urlSkip(fctxt, false, directives);
        }
        if ( directives.length === 0 ) { return; }
        if ( logger.enabled !== true ) { return; }
        fctxt.pushFilters(directives.map(a => a.logData()));
        if ( fctxt.redirectURL === undefined ) { return; }
        fctxt.pushFilter({
            source: 'redirect',
            raw: fctxt.redirectURL
        });
    }

    skipMainDocument(fctxt, blocked) {
        const directives = staticNetFilteringEngine.urlSkip(fctxt, blocked);
        if ( directives === undefined ) { return; }
        fctxt.pushFilters(directives.map(a => a.logData()));
        if ( fctxt.redirectURL === undefined ) { return; }
        fctxt.pushFilter({
            source: 'redirect',
            raw: fctxt.redirectURL
        });
    }

    filterCSPReport(fctxt) {
        if (
            sessionSwitches.evaluateZ(
                'no-csp-reports',
                fctxt.getHostname()
            )
        ) {
            if ( logger.enabled ) {
                fctxt.filter = sessionSwitches.toLogData();
            }
            return 1;
        }
        return 0;
    }

    filterFont(fctxt) {
        if ( fctxt.itype === fctxt.FONT ) {
            this.remoteFontCount += 1;
        }
        if (
            sessionSwitches.evaluateZ(
                'no-remote-fonts',
                fctxt.getTabHostname()
            ) !== false
        ) {
            if ( logger.enabled ) {
                fctxt.filter = sessionSwitches.toLogData();
            }
            return 1;
        }
        return 0;
    }

    filterScripting(fctxt, trustedStatus) {
        fctxt.filter = undefined;
        if ( trustedStatus ?? this.isTrusted(fctxt) ) { return 0; }
        const hn = fctxt.getTabHostname();
        if ( sessionSwitches.evaluateZ('no-scripting', hn) === false ) { return 0; }
        if ( logger.enabled ) {
            fctxt.filter = sessionSwitches.toLogData();
        }
        return 1;
    }

    // The caller is responsible to check whether filtering is enabled or not.
    filterLargeMediaElement(fctxt, headers) {
        fctxt.filter = undefined;
        if ( this.allowLargeMediaElementsUntil === 0 ) { return 0; }
        if ( sessionSwitches.evaluateZ('no-large-media', fctxt.getTabHostname() ) !== true ) {
            this.allowLargeMediaElementsUntil = 0;
            return 0;
        }
        // XHR-based streaming is never blocked but we want to prevent autoplay
        if ( fctxt.itype === fctxt.XMLHTTPREQUEST ) {
            const ctype = headers.contentType;
            if ( ctype.startsWith('audio/') || ctype.startsWith('video/') ) {
                this.largeMediaTimer.on(500);
            }
            return 0;
        }
        if ( Date.now() < this.allowLargeMediaElementsUntil ) {
            if ( fctxt.itype === fctxt.MEDIA ) {
                const sources = this.allowLargeMediaElementsRegex instanceof RegExp
                    ? [ this.allowLargeMediaElementsRegex.source ]
                    : [];
                sources.push('^' + µb.escapeRegex(fctxt.url));
                this.allowLargeMediaElementsRegex = new RegExp(sources.join('|'));
            }
            return 0;
        }
        // Disregard large media elements previously allowed: for example, to
        // seek inside a previously allowed audio/video.
        if (
            this.allowLargeMediaElementsRegex instanceof RegExp &&
            this.allowLargeMediaElementsRegex.test(fctxt.url)
        ) {
            return 0;
        }
        // Regardless of whether a media is blocked, we want to prevent autoplay
        if ( fctxt.itype === fctxt.MEDIA ) {
            this.largeMediaTimer.on(500);
        }
        const size = headers.contentLength;
        if ( isNaN(size) ) {
            return µb.userSettings.largeMediaSize === 0 ? 1 : 0;
        }
        if ( (size >>> 10) < µb.userSettings.largeMediaSize ) { return 0; }
        this.largeMediaCount += 1;
        this.largeMediaTimer.on(500);
        if ( logger.enabled ) {
            fctxt.filter = sessionSwitches.toLogData();
        }
        return 1;
    }

    clickToLoad(frameId, frameURL) {
        this.netFilteringCache.forgetResult(this.tabHostname, 'sub_frame', frameURL);
        this.clickedToLoad.add(frameId);
    }

    shouldExceptCname(fctxt) {
        fctxt.setType('cname');
        fctxt.setURL(fctxt.getDocOrigin());
        const result = staticNetFilteringEngine.matchRequest(fctxt, 0b11);
        const exceptCname = result === 2
            ? staticNetFilteringEngine.toLogData()
            : false;
        if ( exceptCname === false ) { return false; }
        if ( exceptCname instanceof Object ) {
            fctxt.setFilter(exceptCname);
        }
        return true;
    }

    getBlockedResources(request, response) {
        const normalURL = µb.normalizeTabURL(this.tabId, request.frameURL);
        const resources = request.resources;
        const fctxt = µb.filteringContext;
        fctxt.fromTabId(this.tabId)
             .setDocOriginFromURL(normalURL);
        // Force some resources to go through the filtering engine in order to
        // populate the blocked-resources cache. This is required because for
        // some resources it's not possible to detect whether they were blocked
        // content script-side (i.e. `iframes` -- unlike `img`).
        if ( Array.isArray(resources) && resources.length !== 0 ) {
            for ( const resource of resources ) {
                this.filterRequest(
                    fctxt.setType(resource.type).setURL(resource.url)
                );
            }
        }
        if ( this.netFilteringCache.hash === response.hash ) { return; }
        response.hash = this.netFilteringCache.hash;
        response.blockedResources =
            this.netFilteringCache.lookupAllBlocked(fctxt.getDocHostname());
    }

    cacheableResults = new Set([
        µb.FilteringContext.SUB_FRAME
    ]);

    collapsibleResources = new Set([
        µb.FilteringContext.IMAGE,
        µb.FilteringContext.MEDIA,
        µb.FilteringContext.OBJECT,
        µb.FilteringContext.SUB_FRAME,
    ]);

    urlSkippableResources = new Set([
        µb.FilteringContext.IMAGE,
        µb.FilteringContext.MAIN_FRAME,
        µb.FilteringContext.MEDIA,
        µb.FilteringContext.OBJECT,
        µb.FilteringContext.OTHER,
        µb.FilteringContext.SUB_FRAME,
    ]);
};

/******************************************************************************/

export { PageStore };

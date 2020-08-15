/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
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

'use strict';

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/httpswitchboard/issues/303
//   Any scheme other than 'http' and 'https' is remapped into a fake
//   URL which trick the rest of µBlock into being able to process an
//   otherwise unmanageable scheme. µBlock needs web page to have a proper
//   hostname to work properly, so just like the 'chromium-behind-the-scene'
//   fake domain name, we map unknown schemes into a fake '{scheme}-scheme'
//   hostname. This way, for a specific scheme you can create scope with
//   rules which will apply only to that scheme.

µBlock.normalizePageURL = function(tabId, pageURL) {
    if ( tabId < 0 ) {
        return 'http://behind-the-scene/';
    }
    const uri = this.URI.set(pageURL);
    const scheme = uri.scheme;
    if ( scheme === 'https' || scheme === 'http' ) {
        return uri.normalizedURI();
    }

    let fakeHostname = scheme + '-scheme';

    if ( uri.hostname !== '' ) {
        fakeHostname = uri.hostname + '.' + fakeHostname;
    } else if ( scheme === 'about' && uri.path !== '' ) {
        fakeHostname = uri.path + '.' + fakeHostname;
    }

    return `http://${fakeHostname}/`;
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/99
// https://github.com/gorhill/uBlock/issues/991
//
// popup:
//   Test/close target URL
// popunder:
//   Test/close opener URL
//
// popup filter match:
//   0 = false
//   1 = true
//
// opener:      0     0     1     1
// target:      0     1     0     1
//           ----  ----  ----  ----
// result:      a     b     c     d
//
// a: do nothing
// b: close target
// c: close opener
// d: close target

µBlock.onPopupUpdated = (( ) => {
    const µb = µBlock;

    // https://github.com/gorhill/uBlock/commit/1d448b85b2931412508aa01bf899e0b6f0033626#commitcomment-14944764
    //   See if two URLs are different, disregarding scheme -- because the
    //   scheme can be unilaterally changed by the browser.
    // https://github.com/gorhill/uBlock/issues/1378
    //   Maybe no link element was clicked.
    // https://github.com/gorhill/uBlock/issues/3287
    //   Do not bail out if the target URL has no hostname.
    const areDifferentURLs = function(a, b) {
        if ( b === '' ) { return true; }
        if ( b.startsWith('about:') ) { return false; }
        let pos = a.indexOf('://');
        if ( pos === -1 ) { return false; }
        a = a.slice(pos);
        pos = b.indexOf('://');
        if ( pos !== -1 ) {
            b = b.slice(pos);
        }
        return b !== a;
    };

    const popupMatch = function(
        fctxt,
        rootOpenerURL,
        localOpenerURL,
        targetURL,
        popupType = 'popup'
    ) {
        fctxt.setTabOriginFromURL(rootOpenerURL)
             .setDocOriginFromURL(localOpenerURL || rootOpenerURL)
             .setURL(targetURL)
             .setType('popup');
        let result;

        // https://github.com/gorhill/uBlock/issues/1735
        //   Do not bail out on `data:` URI, they are commonly used for popups.
        // https://github.com/uBlockOrigin/uAssets/issues/255
        //   Do not bail out on `about:blank`: an `about:blank` popup can be
        //   opened, with the sole purpose to serve as an intermediary in
        //   a sequence of chained popups.
        // https://github.com/uBlockOrigin/uAssets/issues/263#issuecomment-272615772
        //   Do not bail out, period: the static filtering engine must be
        //   able to examine all sorts of URLs for popup filtering purpose.

        // Dynamic filtering makes sense only when we have a valid opener
        // hostname.
        // https://github.com/gorhill/uBlock/commit/1d448b85b2931412508aa01bf899e0b6f0033626#commitcomment-14944764
        //   Ignore bad target URL. On Firefox, an `about:blank` tab may be
        //   opened for a new tab before it is filled in with the real target
        //   URL.
        if ( fctxt.getTabHostname() !== '' && targetURL !== 'about:blank' ) {
            // Check per-site switch first
            // https://github.com/gorhill/uBlock/issues/3060
            // - The no-popups switch must apply only to popups, not to
            //   popunders.
            if (
                popupType === 'popup' &&
                µb.sessionSwitches.evaluateZ(
                    'no-popups',
                    fctxt.getTabHostname()
                )
            ) {
                fctxt.filter = {
                    raw: 'no-popups: ' + µb.sessionSwitches.z + ' true',
                    result: 1,
                    source: 'switch'
                };
                return 1;
            }

            // https://github.com/gorhill/uBlock/issues/581
            //   Take into account popup-specific rules in dynamic URL
            //   filtering, OR generic allow rules.
            result = µb.sessionURLFiltering.evaluateZ(
                fctxt.getTabHostname(),
                targetURL,
                popupType
            );
            if (
                result === 1 && µb.sessionURLFiltering.type === popupType ||
                result === 2
            ) {
                fctxt.filter = µb.sessionURLFiltering.toLogData();
                return result;
            }

            // https://github.com/gorhill/uBlock/issues/581
            //   Take into account `allow` rules in dynamic filtering: `block`
            //   rules are ignored, as block rules are not meant to block
            //   specific types like `popup` (just like with static filters).
            result = µb.sessionFirewall.evaluateCellZY(
                fctxt.getTabHostname(),
                fctxt.getHostname(),
                popupType
            );
            if ( result === 2 ) {
                fctxt.filter = µb.sessionFirewall.toLogData();
                return 2;
            }
        }

        // https://github.com/chrisaljoudi/uBlock/issues/323
        // https://github.com/chrisaljoudi/uBlock/issues/1142
        //   Don't block if uBlock is turned off in popup's context
        if ( µb.getNetFilteringSwitch(targetURL) ) {
            fctxt.type = popupType;
            result = µb.staticNetFilteringEngine.matchString(fctxt, 0b0001);
            if ( result !== 0 ) {
                fctxt.filter = µb.staticNetFilteringEngine.toLogData();
                return result;
            }
        }

        return 0;
    };

    const mapPopunderResult = function(
        fctxt,
        popunderURL,
        popunderHostname,
        result
    ) {
        if (
            fctxt.filter === undefined ||
            fctxt.filter !== 'static' ||
            fctxt.filter.token === µb.staticNetFilteringEngine.noTokenHash
        ) {
            return 0;
        }
        if ( fctxt.filter.token === µb.staticNetFilteringEngine.dotTokenHash ) {
            return result;
        }
        const re = new RegExp(fctxt.filter.regex, 'i');
        const matches = re.exec(popunderURL);
        if ( matches === null ) { return 0; }
        const beg = matches.index;
        const end = beg + matches[0].length;
        const pos = popunderURL.indexOf(popunderHostname);
        if ( pos === -1 ) { return 0; }
        // https://github.com/gorhill/uBlock/issues/1471
        //   We test whether the opener hostname as at least one character
        //   within matched portion of URL.
        // https://github.com/gorhill/uBlock/issues/1903
        //   Ignore filters which cause a match before the start of the
        //   hostname in the URL.
        return beg >= pos && beg < pos + popunderHostname.length && end > pos
            ? result
            : 0;
    };

    const popunderMatch = function(
        fctxt,
        rootOpenerURL,
        localOpenerURL,
        targetURL
    ) {
        let result = popupMatch(
            fctxt,
            targetURL,
            undefined,
            rootOpenerURL,
            'popunder'
        );
        if ( result === 1 ) { return result; }

        // https://github.com/gorhill/uBlock/issues/1010#issuecomment-186824878
        //   Check the opener tab as if it were the newly opened tab: if there
        //   is a hit against a popup filter, and if the matching filter is not
        //   a broad one, we will consider the opener tab to be a popunder tab.
        //   For now, a "broad" filter is one which does not touch any part of
        //   the hostname part of the opener URL.
        let popunderURL = rootOpenerURL,
            popunderHostname = µb.URI.hostnameFromURI(popunderURL);
        if ( popunderHostname === '' ) { return 0; }

        result = mapPopunderResult(
            fctxt,
            popunderURL,
            popunderHostname,
            popupMatch(fctxt, targetURL, undefined, popunderURL)
        );
        if ( result !== 0 ) { return result; }

        // https://github.com/gorhill/uBlock/issues/1598
        //   Try to find a match against origin part of the opener URL.
        popunderURL = µb.URI.originFromURI(popunderURL);
        if ( popunderURL === '' ) { return 0; }

        return mapPopunderResult(
            fctxt,
            popunderURL,
            popunderHostname,
            popupMatch(fctxt, targetURL, undefined, popunderURL)
        );
    };

    return function(targetTabId, openerDetails) {
        // Opener details.
        const openerTabId = openerDetails.tabId;
        let tabContext = µb.tabContextManager.lookup(openerTabId);
        if ( tabContext === null ) { return; }
        const rootOpenerURL = tabContext.rawURL;
        if ( rootOpenerURL === '' ) { return; }
        const localOpenerURL = openerDetails.frameId !== 0
            ? openerDetails.frameURL
            : undefined;

        // Popup details.
        tabContext = µb.tabContextManager.lookup(targetTabId);
        if ( tabContext === null ) { return; }
        let targetURL = tabContext.rawURL;
        if ( targetURL === '' ) { return; }

        // https://github.com/gorhill/uBlock/issues/341
        //   Allow popups if uBlock is turned off in opener's context.
        if ( µb.getNetFilteringSwitch(rootOpenerURL) === false ) { return; }

        // https://github.com/gorhill/uBlock/issues/1538
        if (
            µb.getNetFilteringSwitch(
                µb.normalizePageURL(openerTabId, rootOpenerURL)
            ) === false
        ) {
            return;
        }

        // If the page URL is that of our "blocked page" URL, extract the URL
        // of the page which was blocked.
        if ( targetURL.startsWith(vAPI.getURL('document-blocked.html')) ) {
            const matches = /details=([^&]+)/.exec(targetURL);
            if ( matches !== null ) {
                targetURL = JSON.parse(decodeURIComponent(matches[1])).url;
            }
        }

        // MUST be reset before code below is called.
        const fctxt = µb.filteringContext.duplicate();

        // Popup test.
        let popupType = 'popup',
            result = 0;
        // https://github.com/gorhill/uBlock/issues/2919
        // - If the target tab matches a clicked link, assume it's legit.
        if ( areDifferentURLs(targetURL, openerDetails.trustedURL) ) {
            result = popupMatch(fctxt, rootOpenerURL, localOpenerURL, targetURL);
        }

        // Popunder test.
        if ( result === 0 && openerDetails.popunder ) {
            result = popunderMatch(fctxt, rootOpenerURL, localOpenerURL, targetURL);
            if ( result === 1 ) {
                popupType = 'popunder';
            }
        }

        // Log only for when there was a hit against an actual filter (allow or block).
        // https://github.com/gorhill/uBlock/issues/2776
        if ( µb.logger.enabled ) {
            fctxt.setRealm('network').setType(popupType);
            if ( popupType === 'popup' ) {
                fctxt.setURL(targetURL)
                     .setTabId(openerTabId)
                     .setTabOriginFromURL(rootOpenerURL)
                     .setDocOriginFromURL(localOpenerURL);
            } else {
                fctxt.setURL(rootOpenerURL)
                     .setTabId(targetTabId)
                     .setTabOriginFromURL(targetURL)
                     .setDocOriginFromURL(targetURL);
            }
            fctxt.toLogger();
        }

        // Not blocked
        if ( result !== 1 ) { return; }

        // Only if a popup was blocked do we report it in the dynamic
        // filtering pane.
        const pageStore = µb.pageStoreFromTabId(openerTabId);
        if ( pageStore ) {
            pageStore.journalAddRequest(fctxt.getHostname(), result);
            pageStore.popupBlockedCount += 1;
        }

        // Blocked
        if ( µb.userSettings.showIconBadge ) {
            µb.updateToolbarIcon(openerTabId, 0b010);
        }

        // It is a popup, block and remove the tab.
        if ( popupType === 'popup' ) {
            µb.unbindTabFromPageStats(targetTabId);
            vAPI.tabs.remove(targetTabId, false);
        } else {
            µb.unbindTabFromPageStats(openerTabId);
            vAPI.tabs.remove(openerTabId, true);
        }

        return true;
    };
})();

/******************************************************************************/
/******************************************************************************

To keep track from which context *exactly* network requests are made. This is
often tricky for various reasons, and the challenge is not specific to one
browser.

The time at which a URL is assigned to a tab and the time when a network
request for a root document is made must be assumed to be unrelated: it's all
asynchronous. There is no guaranteed order in which the two events are fired.

Also, other "anomalies" can occur:

- a network request for a root document is fired without the corresponding
tab being really assigned a new URL
<https://github.com/chrisaljoudi/uBlock/issues/516>

- a network request for a secondary resource is labeled with a tab id for
which no root document was pulled for that tab.
<https://github.com/chrisaljoudi/uBlock/issues/1001>

- a network request for a secondary resource is made without the root
document to which it belongs being formally bound yet to the proper tab id,
causing a bad scope to be used for filtering purpose.
<https://github.com/chrisaljoudi/uBlock/issues/1205>
<https://github.com/chrisaljoudi/uBlock/issues/1140>

So the solution here is to keep a lightweight data structure which only
purpose is to keep track as accurately as possible of which root document
belongs to which tab. That's the only purpose, and because of this, there are
no restrictions for when the URL of a root document can be associated to a tab.

Before, the PageStore object was trying to deal with this, but it had to
enforce some restrictions so as to not descend into one of the above issues, or
other issues. The PageStore object can only be associated with a tab for which
a definitive navigation event occurred, because it collects information about
what occurred in the tab (for example, the number of requests blocked for a
page).

The TabContext objects do not suffer this restriction, and as a result they
offer the most reliable picture of which root document URL is really associated
to which tab. Moreover, the TabObject can undo an association from a root
document, and automatically re-associate with the next most recent. This takes
care of <https://github.com/chrisaljoudi/uBlock/issues/516>.

The PageStore object no longer cache the various information about which
root document it is currently bound. When it needs to find out, it will always
defer to the TabContext object, which will provide the real answer. This takes
case of <https://github.com/chrisaljoudi/uBlock/issues/1205>. In effect, the
master switch and dynamic filtering rules can be evaluated now properly even
in the absence of a PageStore object, this was not the case before.

Also, the TabContext object will try its best to find a good candidate root
document URL for when none exists. This takes care of
<https://github.com/chrisaljoudi/uBlock/issues/1001>.

The TabContext manager is self-contained, and it takes care to properly
housekeep itself.

*/

µBlock.tabContextManager = (( ) => {
    const µb = µBlock;
    const tabContexts = new Map();

    // https://github.com/chrisaljoudi/uBlock/issues/1001
    // This is to be used as last-resort fallback in case a tab is found to not
    // be bound while network requests are fired for the tab.
    let mostRecentRootDocURL = '';
    let mostRecentRootDocURLTimestamp = 0;

    const popupCandidates = new Map();

    const PopupCandidate = class {
        constructor(createDetails, openerDetails) {
            this.targetTabId = createDetails.tabId;
            this.opener = {
                tabId: createDetails.sourceTabId,
                tabURL: openerDetails[0].url,
                frameId: createDetails.sourceFrameId,
                frameURL: openerDetails[1].url,
                popunder: false,
                trustedURL: createDetails.sourceTabId === µb.maybeGoodPopup.tabId
                    ? µb.maybeGoodPopup.url
                    : ''
            };
            this.selfDestructionTimer = null;
            this.launchSelfDestruction();
        }

        destroy() {
            if ( this.selfDestructionTimer !== null ) {
                clearTimeout(this.selfDestructionTimer);
            }
            popupCandidates.delete(this.targetTabId);
        }

        launchSelfDestruction() {
            if ( this.selfDestructionTimer !== null ) {
                clearTimeout(this.selfDestructionTimer);
            }
            this.selfDestructionTimer = vAPI.setTimeout(
                ( ) => this.destroy(),
                10000
            );
        }
    };

    const popupCandidateTest = async function(targetTabId) {
        for ( const [ tabId, candidate ] of popupCandidates ) {
            if (
                targetTabId !== tabId &&
                targetTabId !== candidate.opener.tabId
            ) {
                continue;
            }
            // https://github.com/gorhill/uBlock/issues/3129
            //   If the trigger is a change in the opener's URL, mark the entry
            //   as candidate for popunder filtering.
            if ( targetTabId === candidate.opener.tabId ) {
                candidate.opener.popunder = true;
            }
            const result = await µb.onPopupUpdated(tabId, candidate.opener);
            if ( result === true ) {
                candidate.destroy();
            } else {
                candidate.launchSelfDestruction();
            }
        }
    };

    // https://github.com/uBlockOrigin/uBlock-issues/issues/1184
    //   Do not consider a tab opened from `about:newtab` to be a popup
    //   candidate.

    const onTabCreated = async function(createDetails) {
        const { sourceTabId, sourceFrameId, tabId } = createDetails;
        const popup = popupCandidates.get(tabId);
        if ( popup === undefined ) {
            let openerDetails;
            try {
                openerDetails = await Promise.all([
                    webext.webNavigation.getFrame({
                        tabId: createDetails.sourceTabId,
                        frameId: 0,
                    }),
                    webext.webNavigation.getFrame({
                        tabId: sourceTabId,
                        frameId: sourceFrameId,
                    }),
                ]);
            }
            catch (reason) {
                return;
            }
            if (
                Array.isArray(openerDetails) === false ||
                openerDetails.length !== 2 ||
                openerDetails[1].url === 'about:newtab'
            ) {
                return;
            }
            popupCandidates.set(
                tabId,
                new PopupCandidate(createDetails, openerDetails)
            );
        }
        popupCandidateTest(tabId);
    };

    const gcPeriod = 10 * 60 * 1000;

    // A pushed entry is removed from the stack unless it is committed with
    // a set time.
    const StackEntry = function(url, commit) {
        this.url = url;
        this.committed = commit;
        this.tstamp = Date.now();
    };

    const TabContext = function(tabId) {
        this.tabId = tabId;
        this.stack = [];
        this.rawURL =
        this.normalURL =
        this.origin =
        this.rootHostname =
        this.rootDomain = '';
        this.commitTimer = null;
        this.gcTimer = null;
        this.onGCBarrier = false;
        this.netFiltering = true;
        this.netFilteringReadTime = 0;

        tabContexts.set(tabId, this);
    };

    TabContext.prototype.destroy = function() {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) { return; }
        if ( this.gcTimer !== null ) {
            clearTimeout(this.gcTimer);
            this.gcTimer = null;
        }
        tabContexts.delete(this.tabId);
    };

    TabContext.prototype.onGC = async function() {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) { return; }
        // https://github.com/gorhill/uBlock/issues/1713
        //   For unknown reasons, Firefox's setTimeout() will sometimes
        //   causes the callback function to be called immediately, bypassing
        //   the main event loop. For now this should prevent uBO from
        //   crashing as a result of the bad setTimeout() behavior.
        if ( this.onGCBarrier ) { return; }
        this.onGCBarrier = true;
        this.gcTimer = null;
        const tab = await vAPI.tabs.get(this.tabId);
        if ( tab instanceof Object === false || tab.discarded === true ) {
            this.destroy();
        } else {
            this.gcTimer = vAPI.setTimeout(( ) => this.onGC(), gcPeriod);
        }
        this.onGCBarrier = false;
    };

    // https://github.com/gorhill/uBlock/issues/248
    // Stack entries have to be committed to stick. Non-committed stack
    // entries are removed after a set delay.
    TabContext.prototype.onCommit = function() {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) {
            return;
        }
        this.commitTimer = null;
        // Remove uncommitted entries at the top of the stack.
        let i = this.stack.length;
        while ( i-- ) {
            if ( this.stack[i].committed ) { break; }
        }
        // https://github.com/gorhill/uBlock/issues/300
        // If no committed entry was found, fall back on the bottom-most one
        // as being the committed one by default.
        if ( i === -1 && this.stack.length !== 0 ) {
            this.stack[0].committed = true;
            i = 0;
        }
        i += 1;
        if ( i < this.stack.length ) {
            this.stack.length = i;
            this.update();
        }
    };

    // This takes care of orphanized tab contexts. Can't be started for all
    // contexts, as the behind-the-scene context is permanent -- so we do not
    // want to flush it.
    TabContext.prototype.autodestroy = function() {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) { return; }
        this.gcTimer = vAPI.setTimeout(( ) => this.onGC(), gcPeriod);
    };

    // Update just force all properties to be updated to match the most recent
    // root URL.
    TabContext.prototype.update = function() {
        this.netFilteringReadTime = 0;
        if ( this.stack.length === 0 ) {
            this.rawURL =
            this.normalURL =
            this.origin =
            this.rootHostname =
            this.rootDomain = '';
            return;
        }
        const stackEntry = this.stack[this.stack.length - 1];
        this.rawURL = stackEntry.url;
        this.normalURL = µb.normalizePageURL(this.tabId, this.rawURL);
        this.origin = µb.URI.originFromURI(this.normalURL);
        this.rootHostname = µb.URI.hostnameFromURI(this.origin);
        this.rootDomain =
            µb.URI.domainFromHostname(this.rootHostname) ||
            this.rootHostname;
    };

    // Called whenever a candidate root URL is spotted for the tab.
    TabContext.prototype.push = function(url) {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) {
            return;
        }
        const count = this.stack.length;
        if ( count !== 0 && this.stack[count - 1].url === url ) {
            return;
        }
        this.stack.push(new StackEntry(url));
        this.update();
        popupCandidateTest(this.tabId);
        if ( this.commitTimer !== null ) {
            clearTimeout(this.commitTimer);
        }
        this.commitTimer = vAPI.setTimeout(( ) => this.onCommit(), 500);
    };

    // This tells that the url is definitely the one to be associated with the
    // tab, there is no longer any ambiguity about which root URL is really
    // sitting in which tab.
    TabContext.prototype.commit = function(url) {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) { return; }
        if ( this.stack.length !== 0 ) {
            const top = this.stack[this.stack.length - 1];
            if ( top.url === url && top.committed ) { return false; }
        }
        this.stack = [new StackEntry(url, true)];
        this.update();
        return true;
    };

    TabContext.prototype.getNetFilteringSwitch = function() {
        if ( this.netFilteringReadTime > µb.netWhitelistModifyTime ) {
            return this.netFiltering;
        }
        // https://github.com/chrisaljoudi/uBlock/issues/1078
        // Use both the raw and normalized URLs.
        this.netFiltering = µb.getNetFilteringSwitch(this.normalURL);
        if (
            this.netFiltering &&
            this.rawURL !== this.normalURL &&
            this.rawURL !== ''
        ) {
            this.netFiltering = µb.getNetFilteringSwitch(this.rawURL);
        }
        this.netFilteringReadTime = Date.now();
        return this.netFiltering;
    };

    // These are to be used for the API of the tab context manager.

    const push = function(tabId, url) {
        let entry = tabContexts.get(tabId);
        if ( entry === undefined ) {
            entry = new TabContext(tabId);
            entry.autodestroy();
        }
        entry.push(url);
        mostRecentRootDocURL = url;
        mostRecentRootDocURLTimestamp = Date.now();
        return entry;
    };

    // Find a tab context for a specific tab.
    const lookup = function(tabId) {
        return tabContexts.get(tabId) || null;
    };

    // Find a tab context for a specific tab. If none is found, attempt to
    // fix this. When all fail, the behind-the-scene context is returned.
    const mustLookup = function(tabId) {
        const entry = tabContexts.get(tabId);
        if ( entry !== undefined ) {
            return entry;
        }
        // https://github.com/chrisaljoudi/uBlock/issues/1025
        // Google Hangout popup opens without a root frame. So for now we will
        // just discard that best-guess root frame if it is too far in the
        // future, at which point it ceases to be a "best guess".
        if (
            mostRecentRootDocURL !== '' &&
            mostRecentRootDocURLTimestamp + 500 < Date.now()
        ) {
            mostRecentRootDocURL = '';
        }
        // https://github.com/chrisaljoudi/uBlock/issues/1001
        // Not a behind-the-scene request, yet no page store found for the
        // tab id: we will thus bind the last-seen root document to the
        // unbound tab. It's a guess, but better than ending up filtering
        // nothing at all.
        if ( mostRecentRootDocURL !== '' ) {
            return push(tabId, mostRecentRootDocURL);
        }
        // If all else fail at finding a page store, re-categorize the
        // request as behind-the-scene. At least this ensures that ultimately
        // the user can still inspect/filter those net requests which were
        // about to fall through the cracks.
        // Example: Chromium + case #12 at
        //          http://raymondhill.net/ublock/popup.html
        return tabContexts.get(vAPI.noTabId);
    };

    // https://github.com/gorhill/uBlock/issues/1735
    //   Filter for popups if actually committing.
    const commit = function(tabId, url) {
        let entry = tabContexts.get(tabId);
        if ( entry === undefined ) {
            entry = push(tabId, url);
        } else if ( entry.commit(url) ) {
            popupCandidateTest(tabId);
        }
        return entry;
    };

    const exists = function(tabId) {
        return tabContexts.get(tabId) !== undefined;
    };

    // Behind-the-scene tab context
    {
        const entry = new TabContext(vAPI.noTabId);
        entry.stack.push(new StackEntry('', true));
        entry.rawURL = '';
        entry.normalURL = µb.normalizePageURL(entry.tabId);
        entry.origin = µb.URI.originFromURI(entry.normalURL);
        entry.rootHostname = µb.URI.hostnameFromURI(entry.origin);
        entry.rootDomain = µb.URI.domainFromHostname(entry.rootHostname);
    }

    // Context object, typically to be used to feed filtering engines.
    const contextJunkyard = [];
    const Context = class {
        constructor(tabId) {
            this.init(tabId);
        }
        init(tabId) {
            const tabContext = lookup(tabId);
            this.rootHostname = tabContext.rootHostname;
            this.rootDomain = tabContext.rootDomain;
            this.pageHostname =
            this.pageDomain =
            this.requestURL =
            this.origin =
            this.requestHostname =
            this.requestDomain = '';
            return this;
        }
        dispose() {
            contextJunkyard.push(this);
        }
    };

    const createContext = function(tabId) {
        if ( contextJunkyard.length ) {
            return contextJunkyard.pop().init(tabId);
        }
        return new Context(tabId);
    };

    return {
        push,
        commit,
        lookup,
        mustLookup,
        exists,
        createContext,
        onTabCreated,
    };
})();

/******************************************************************************/
/******************************************************************************/

vAPI.Tabs = class extends vAPI.Tabs {
    onActivated(details) {
        super.onActivated(details);
        if ( vAPI.isBehindTheSceneTabId(details.tabId) ) { return; }
        // https://github.com/uBlockOrigin/uBlock-issues/issues/680
        µBlock.updateToolbarIcon(details.tabId);
        µBlock.contextMenu.update(details.tabId);
    }

    onClosed(tabId) {
        super.onClosed(tabId);
        if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }
        µBlock.unbindTabFromPageStats(tabId);
        µBlock.contextMenu.update();
    }

    onCreated(details) {
        super.onCreated(details);
        µBlock.tabContextManager.onTabCreated(details);
    }

    // When the DOM content of root frame is loaded, this means the tab
    // content has changed.
    //
    // The webRequest.onBeforeRequest() won't be called for everything
    // else than http/https. Thus, in such case, we will bind the tab as
    // early as possible in order to increase the likelihood of a context
    // properly setup if network requests are fired from within the tab.
    // Example: Chromium + case #6 at
    //          http://raymondhill.net/ublock/popup.html

    onNavigation(details) {
        super.onNavigation(details);
        const µb = µBlock;
        if ( details.frameId === 0 ) {
            µb.tabContextManager.commit(details.tabId, details.url);
            let pageStore = µb.bindTabToPageStats(details.tabId, 'tabCommitted');
            if ( pageStore ) {
                pageStore.journalAddRootFrame('committed', details.url);
            }
        }
        if ( µb.canInjectScriptletsNow ) {
            let pageStore = µb.pageStoreFromTabId(details.tabId);
            if ( pageStore !== null && pageStore.getNetFilteringSwitch() ) {
                µb.scriptletFilteringEngine.injectNow(details);
            }
        }
    }

    // It may happen the URL in the tab changes, while the page's document
    // stays the same (for instance, Google Maps). Without this listener,
    // the extension icon won't be properly refreshed.

    onUpdated(tabId, changeInfo, tab) {
        super.onUpdated(tabId, changeInfo, tab);
        if ( !tab.url || tab.url === '' ) { return; }
        if ( !changeInfo.url ) { return; }
        µBlock.tabContextManager.commit(tabId, changeInfo.url);
        µBlock.bindTabToPageStats(tabId, 'tabUpdated');
    }
};

vAPI.tabs = new vAPI.Tabs();

/******************************************************************************/
/******************************************************************************/

// Create an entry for the tab if it doesn't exist.

µBlock.bindTabToPageStats = function(tabId, context) {
    µBlock.updateToolbarIcon(tabId);

    // Do not create a page store for URLs which are of no interests
    if ( this.tabContextManager.exists(tabId) === false ) {
        this.unbindTabFromPageStats(tabId);
        return null;
    }

    // Reuse page store if one exists: this allows to guess if a tab is a popup
    let pageStore = this.pageStores.get(tabId);

    // Tab is not bound
    if ( pageStore === undefined ) {
        this.updateTitle(tabId);
        pageStore = this.PageStore.factory(tabId, context);
        this.pageStores.set(tabId, pageStore);
        this.pageStoresToken = Date.now();
        return pageStore;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/516
    //   Never rebind behind-the-scene scope.
    if ( vAPI.isBehindTheSceneTabId(tabId) ) {
        return pageStore;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/516
    //   If context is 'beforeRequest', do not rebind, wait for confirmation.
    if ( context === 'beforeRequest' ) {
        pageStore.netFilteringCache.empty();
        return pageStore;
    }

    // Rebind according to context. We rebind even if the URL did not change,
    // as maybe the tab was force-reloaded, in which case the page stats must
    // be all reset.
    pageStore.reuse(context);

    this.updateTitle(tabId);
    this.pageStoresToken = Date.now();

    return pageStore;
};

/******************************************************************************/

µBlock.unbindTabFromPageStats = function(tabId) {
    //console.debug('µBlock> unbindTabFromPageStats(%d)', tabId);
    const pageStore = this.pageStores.get(tabId);
    if ( pageStore === undefined ) { return; }
    pageStore.dispose();
    this.pageStores.delete(tabId);
    this.pageStoresToken = Date.now();
};

/******************************************************************************/

µBlock.pageStoreFromTabId = function(tabId) {
    return this.pageStores.get(tabId) || null;
};

µBlock.mustPageStoreFromTabId = function(tabId) {
    return this.pageStores.get(tabId) || this.pageStores.get(vAPI.noTabId);
};

/******************************************************************************/

// Permanent page store for behind-the-scene requests. Must never be removed.
//
// https://github.com/uBlockOrigin/uBlock-issues/issues/651
//   The whitelist status of the tabless page store will be determined by
//   the document context (if present) of the network request.

{
    const NoPageStore = class extends µBlock.PageStore {
        getNetFilteringSwitch(fctxt) {
            if ( fctxt && fctxt.docId === 0 ) {
                const docOrigin = fctxt.getDocOrigin();
                if ( docOrigin ) {
                    return µBlock.getNetFilteringSwitch(docOrigin);
                }
            }
            return super.getNetFilteringSwitch();
        }
    };
    const pageStore = new NoPageStore(vAPI.noTabId);
    µBlock.pageStores.set(pageStore.tabId, pageStore);
    pageStore.title = vAPI.i18n('logBehindTheScene');
}

/******************************************************************************/

// Update visual of extension icon.

µBlock.updateToolbarIcon = (( ) => {
    const µb = µBlock;
    const tabIdToDetails = new Map();

    const computeBadgeColor = (bits) => {
        let color = µb.blockingProfileColorCache.get(bits);
        if ( color !== undefined ) { return color; }
        let max = 0;
        for ( const profile of µb.liveBlockingProfiles ) {
            const v = bits & (profile.bits & ~1);
            if ( v < max ) { break; }
            color = profile.color;
            max = v;
        }
        if ( color === undefined ) {
            color = '#666';
        }
        µb.blockingProfileColorCache.set(bits, color);
        return color;
    };

    const updateBadge = (tabId, isClick) => {
        let parts = tabIdToDetails.get(tabId);
        tabIdToDetails.delete(tabId);

        let state = 0;
        let badge = '';
        let color = '#666';
        let count = 0; //ADN

        let pageStore = µb.pageStoreFromTabId(tabId),
            pageDomain = pageStore ? µb.URI.domainFromHostname(pageStore.tabHostname) : null; // ADN;

        if ( pageStore !== null ) {
            state = pageStore.getNetFilteringSwitch() ? 1 : 0;
            if ( state === 1 ) {
                if ( (parts & 0b0010) !== 0 && pageStore.perLoadBlockedRequestCount ) {
                    badge = µb.formatCount(
                        pageStore.perLoadBlockedRequestCount
                    );
                }
                if ( (parts & 0b0100) !== 0 ) {
                    color = computeBadgeColor(
                        µb.blockingModeFromHostname(pageStore.tabHostname)
                    );
                }
            }

          state = µb.adnauseam.getIconState(state, pageDomain, isClick); // ADN
          count = µb.adnauseam.currentCount(pageStore.rawURL); // ADN
          badge = µb.formatCount(count);
        }

        // https://www.reddit.com/r/uBlockOrigin/comments/d33d37/
        if ( µb.userSettings.showIconBadge === false ) {
            parts |= 0b1000;
        }

         vAPI.setIcon(tabId, { parts, state, badge, color });
         isClick && vAPI.setTimeout(( ) => {
             state = µb.adnauseam.getIconState(state, pageDomain, false);
             vAPI.setIcon(tabId, { parts, state, badge, color });
         }, 600);

    };

    // parts: bit 0 = icon
    //        bit 1 = badge text
    //        bit 2 = badge color
    //        bit 3 = hide badge

    return function(tabId, newParts = 0b0111, isClick) {
        if ( typeof tabId !== 'number' ) { return; }
        if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }
        let currentParts = tabIdToDetails.get(tabId);
        if ( currentParts === newParts ) { return; }
        if ( currentParts === undefined ) {
            self.requestIdleCallback(
                ( ) => updateBadge(tabId, isClick),
                { timeout: 701 }
            );
        } else {
            newParts |= currentParts;
        }
        tabIdToDetails.set(tabId, newParts);

    };
})();

/******************************************************************************/

µBlock.updateTitle = (( ) => {
    const tabIdToCount = new Map();
    const delay = 499;

    const updateTitle = async function(tabId) {
        let count = tabIdToCount.get(tabId);
        if ( count === undefined ) { return; }
        tabIdToCount.delete(tabId);
        const tab = await vAPI.tabs.get(tabId);
        if ( tab instanceof Object === false || tab.discarded === true ) {
            return;
        }
        const µb = µBlock;
        const pageStore = µb.pageStoreFromTabId(tabId);
        if ( pageStore === null ) { return; }
        // Firefox needs this: if you detach a tab, the new tab won't have
        // its rawURL set. Concretely, this causes the logger to report an
        // entry to itself in the logger's tab selector.
        // TODO: Investigate for a fix vAPI-side.
        pageStore.rawURL = tab.url;
        µb.pageStoresToken = Date.now();
        // https://github.com/gorhill/uMatrix/issues/225
        //   Sometimes title changes while page is loading.
        const settled =
            typeof tab.title === 'string' &&
            tab.title !== '' &&
            tab.title === pageStore.title;
        pageStore.title = tab.title || tab.url || '';
        if ( settled ) { return; }
        if ( tabIdToCount.has(tabId) ) { return; }
        count -= 1;
        if ( count === 0 ) { return; }
        tabIdToCount.set(tabId, count);
        updateTitleAsync(tabId);
    };

    const updateTitleAsync = function(tabId) {
        vAPI.setTimeout(( ) => { updateTitle(tabId); }, delay);
    };

    return function(tabId) {
        if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }
        const count = tabIdToCount.get(tabId);
        tabIdToCount.set(tabId, 5);
        if ( count === undefined ) {
            updateTitleAsync(tabId);
        }
    };
})();

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/455
//   Stale page store entries janitor

{
    const pageStoreJanitorPeriod = 15 * 60 * 1000;
    let pageStoreJanitorSampleAt = 0;
    let pageStoreJanitorSampleSize = 10;

    const checkTab = async tabId => {
        const tab = await vAPI.tabs.get(tabId);
        if ( tab instanceof Object && tab.discarded !== true ) { return; }
        µBlock.unbindTabFromPageStats(tabId);
    };

    const pageStoreJanitor = function() {
        const tabIds = Array.from(µBlock.pageStores.keys()).sort();
        if ( pageStoreJanitorSampleAt >= tabIds.length ) {
            pageStoreJanitorSampleAt = 0;
        }
        const n = Math.min(
            pageStoreJanitorSampleAt + pageStoreJanitorSampleSize,
            tabIds.length
        );
        for ( let i = pageStoreJanitorSampleAt; i < n; i++ ) {
            const tabId = tabIds[i];
            if ( vAPI.isBehindTheSceneTabId(tabId) ) { continue; }
            checkTab(tabId);
        }
        pageStoreJanitorSampleAt = n;

        vAPI.setTimeout(pageStoreJanitor, pageStoreJanitorPeriod);
    };

    vAPI.setTimeout(pageStoreJanitor, pageStoreJanitorPeriod);
}

/******************************************************************************/

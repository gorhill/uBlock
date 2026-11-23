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

import * as frameManager from './vapi-contexts.js';

import {
    hostnameFromURI,
    originFromURI,
} from './uri-utils.js';

import {
    sessionFirewall,
    sessionSwitches,
    sessionURLFiltering,
} from './filtering-engines.js';

import { PageStore } from './pagestore.js';
import contextMenu from './contextmenu.js';
import { i18n$ } from './i18n.js';
import logger from './logger.js';
import staticNetFilteringEngine from './static-net-filtering.js';
import webext from './webext.js';
import µb from './background.js';

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/httpswitchboard/issues/303
//   Any scheme other than 'http' and 'https' is remapped into a fake
//   URL which trick the rest of µBlock into being able to process an
//   otherwise unmanageable scheme. µBlock needs web page to have a proper
//   hostname to work properly, so just like the 'behind-the-scene'
//   fake domain name, we map unknown schemes into a fake '{scheme}-scheme'
//   hostname. This way, for a specific scheme you can create scope with
//   rules which will apply only to that scheme.

const tabURLNormalizer = new URL('about:blank');

µb.normalizeTabURL = (tabURL, tabId = 0) => {
    if ( tabId < 0 ) {
        return 'https://behind-the-scene/';
    }
    if ( frameManager.isHTTP(tabURL) ) { return tabURL; }
    try {
        tabURLNormalizer.href = tabURL;
    } catch {
        return tabURL;
    }
    const protocol = tabURLNormalizer.protocol.slice(0, -1);
    if ( tabURLNormalizer.hostname !== '' ) {
        return `https://${tabURLNormalizer.hostname}.${protocol}-scheme`;
    }
    if ( protocol === 'about' && tabURLNormalizer.pathname !== '' ) {
        return `https://${tabURLNormalizer.pathname}.${protocol}-scheme`;
    }
    return `https://${protocol}-scheme/`;
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

(( ) => {
    class PopupCandidate {
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
            this.selfDestructionTimer = vAPI.defer.create(( ) => {
                this.destroy();
            });
            this.launchSelfDestruction();
        }

        destroy() {
            this.selfDestructionTimer.off();
            popupCandidates.delete(this.targetTabId);
        }

        launchSelfDestruction() {
            this.selfDestructionTimer.offon(10000);
        }
    }

    // https://github.com/gorhill/uBlock/commit/1d448b85b2931412508aa01bf899e0b6f0033626#commitcomment-14944764
    //   See if two URLs are different, disregarding scheme -- because the
    //   scheme can be unilaterally changed by the browser.
    // https://github.com/gorhill/uBlock/issues/1378
    //   Maybe no link element was clicked.
    // https://github.com/gorhill/uBlock/issues/3287
    //   Do not bail out if the target URL has no hostname.
    function areDifferentURLs(a, b) {
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
    }

    function popupMatch(
        fctxt,
        rootOpenerURL,
        localOpenerURL,
        targetURL,
        popupType = 'popup'
    ) {
        // https://github.com/chrisaljoudi/uBlock/issues/323
        // https://github.com/chrisaljoudi/uBlock/issues/1142
        // https://github.com/uBlockOrigin/uBlock-issues/issues/1616
        //   Don't block if uBO is turned off in popup's context
        if ( µb.isTrustedSite(targetURL) ) { return 0; }
        if ( µb.isTrustedSite(µb.normalizeTabURL(targetURL)) ) { return 0; }

        fctxt.setTabURL(rootOpenerURL)
             .setDocOriginFromURL(localOpenerURL || rootOpenerURL)
             .setURL(targetURL)
             .setType('popup');

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
                sessionSwitches.evaluateZ(
                    'no-popups',
                    fctxt.getTabHostname()
                )
            ) {
                fctxt.filter = {
                    raw: 'no-popups: ' + sessionSwitches.z + ' true',
                    result: 1,
                    source: 'switch'
                };
                return 1;
            }

            // https://github.com/gorhill/uBlock/issues/581
            //   Take into account popup-specific rules in dynamic URL
            //   filtering, OR generic allow rules.
            let result = sessionURLFiltering.evaluateZ(
                fctxt.getTabHostname(),
                targetURL,
                popupType
            );
            if (
                result === 1 && sessionURLFiltering.type === popupType ||
                result === 2
            ) {
                fctxt.filter = sessionURLFiltering.toLogData();
                return result;
            }

            // https://github.com/gorhill/uBlock/issues/581
            //   Take into account `allow` rules in dynamic filtering: `block`
            //   rules are ignored, as block rules are not meant to block
            //   specific types like `popup` (just like with static filters).
            result = sessionFirewall.evaluateCellZY(
                fctxt.getTabHostname(),
                fctxt.getHostname(),
                popupType
            );
            if ( result === 2 ) {
                fctxt.filter = sessionFirewall.toLogData();
                return 2;
            }
        }

        fctxt.type = popupType;
        const result = staticNetFilteringEngine.matchRequest(fctxt, 0b0001);
        if ( result !== 0 ) {
            fctxt.filter = staticNetFilteringEngine.toLogData();
            return result;
        }

        return 0;
    }

    function mapPopunderResult(
        fctxt,
        popunderURL,
        popunderHostname,
        result
    ) {
        if ( fctxt.filter === undefined || fctxt.filter !== 'static' ) {
            return 0;
        }
        if ( fctxt.filter.isUntokenized() ) {
            return 0;
        }
        if ( fctxt.filter.isPureHostname() ) {
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
    }

    function popunderMatch(
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
            popunderHostname = hostnameFromURI(popunderURL);
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
        popunderURL = originFromURI(popunderURL);
        if ( popunderURL === '' ) { return 0; }

        return mapPopunderResult(
            fctxt,
            popunderURL,
            popunderHostname,
            popupMatch(fctxt, targetURL, undefined, popunderURL)
        );
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/1184
    //   Do not consider a tab opened from `about:newtab` to be a popup
    //   candidate.

    async function onTabCreated(createDetails) {
        const { sourceTabId, sourceFrameId, tabId } = createDetails;
        const popup = popupCandidates.get(tabId);
        if ( popup === undefined ) {
            const openerDetails = await Promise.all([
                webext.webNavigation.getFrame({
                    tabId: createDetails.sourceTabId,
                    frameId: 0,
                }),
                webext.webNavigation.getFrame({
                    tabId: sourceTabId,
                    frameId: sourceFrameId,
                }),
            ]).catch(( ) => { });
            if ( Array.isArray(openerDetails) === false ) { return; }
            if ( openerDetails.length !== 2 ) { return; }
            if ( openerDetails[1] === null ) { return; }
            if ( openerDetails[1].url === 'about:newtab' ) { return; }
            // https://github.com/uBlockOrigin/uBlock-issues/issues/2227
            if ( openerDetails[1].url.startsWith('chrome:') ) { return; }
            popupCandidates.set(
                tabId,
                new PopupCandidate(createDetails, openerDetails)
            );
        }
        popupCandidateTest(tabId);
    }

    function onPopupUpdated(targetTabId, openerDetails) {
        // Opener details.
        const openerTabId = openerDetails.tabId;
        const rootOpenerURL = frameManager.getTopURL(openerTabId);
        if ( Boolean(rootOpenerURL) === false ) { return; }
        const pageStore = µb.pageStoreFromTabId(openerTabId);

        // https://github.com/uBlockOrigin/uBlock-issues/discussions/2534#discussioncomment-5264792
        //   An `about:blank` frame's context is that of the parent context
        let localOpenerURL = openerDetails.frameId !== 0
            ? openerDetails.frameURL
            : undefined;
        if ( localOpenerURL === 'about:blank' && pageStore !== null ) {
            localOpenerURL = frameManager.getTopURL(openerTabId, openerDetails.frameId);
        }

        // Popup details.
        let targetURL = frameManager.getTopURL(targetTabId);
        if ( Boolean(targetURL) === false ) { return; }

        // https://github.com/gorhill/uBlock/issues/341
        //   Allow popups if uBlock is turned off in opener's context.
        if ( µb.isTrustedSite(rootOpenerURL) ) { return; }

        // https://github.com/gorhill/uBlock/issues/1538
        if ( µb.isTrustedSite(µb.normalizeTabURL(rootOpenerURL, openerTabId)) ) { return; }

        // If the page URL is that of our document-blocked URL, extract the URL
        // of the page which was blocked.
        targetURL = µb.pageURLFromMaybeDocumentBlockedURL(targetURL);

        // MUST be reset before code below is called.
        const fctxt = µb.filteringContext.duplicate();

        // Popup test.
        let popupType = 'popup',
            result = 0;
        // https://github.com/gorhill/uBlock/issues/2919
        //   If the target tab matches a clicked link, assume it's legit.
        // https://github.com/uBlockOrigin/uBlock-issues/issues/1912
        //   If the target also matches the last clicked link, assume it's
        //   legit.
        if (
            areDifferentURLs(targetURL, openerDetails.trustedURL) &&
            areDifferentURLs(targetURL, µb.maybeGoodPopup.url)
        ) {
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
        if ( logger.enabled ) {
            fctxt.setRealm('network').setType(popupType);
            if ( popupType === 'popup' ) {
                fctxt.setURL(targetURL)
                     .setTabId(openerTabId)
                     .setTabURL(rootOpenerURL)
                     .setDocOriginFromURL(localOpenerURL || rootOpenerURL);
            } else {
                fctxt.setURL(rootOpenerURL)
                     .setTabId(targetTabId)
                     .setTabURL(targetURL)
                     .setDocOriginFromURL(targetURL);
            }
            fctxt.toLogger();
        }

        // Not blocked
        if ( result !== 1 ) { return; }

        // Only if a popup was blocked do we report it in the dynamic
        // filtering pane.
        if ( pageStore ) {
            pageStore.journalAddRequest(fctxt, result);
            pageStore.popupBlockedCount += 1;
        }

        // Blocked
        if ( µb.userSettings.showIconBadge ) {
            µb.updateToolbarIcon(openerTabId, 0b010);
        }

        // It is a popup, block and remove the tab.
        if ( popupType === 'popup' ) {
            µb.unbindTabFromPageStore(targetTabId);
            vAPI.tabs.remove(targetTabId, false);
        } else {
            µb.unbindTabFromPageStore(openerTabId);
            vAPI.tabs.remove(openerTabId, true);
        }

        return true;
    }

    function popupCandidateTest(targetTabId) {
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
            const result = onPopupUpdated(tabId, candidate.opener);
            if ( result === true ) {
                candidate.destroy();
            } else {
                candidate.launchSelfDestruction();
            }
        }
    }

    // These are to be used for the API of the tab context manager.

    const popupCandidates = new Map();

    frameManager.addListener((type, details) => {
        const { tabId } = details;
        if ( tabId === frameManager.TAB_ID_NONE ) { return; }
        switch ( type ) {
        case 'before-tab-created':
            onTabCreated(details);
            break;
        case 'tab-updated':
            if ( Boolean(details.url) === false ) { break; }
            popupCandidateTest(tabId);
            break;
        case 'frame-committed':
            if ( details.frameId !== 0 ) { return; }
            popupCandidateTest(tabId);
            break;
        }
    });
})();

/******************************************************************************/
/******************************************************************************/

frameManager.addListener((type, details) => {
    const { tabId } = details;
    if ( tabId === frameManager.TAB_ID_NONE ) { return; }
    switch ( type ) {
    case 'frame-committed': {
        if ( details.frameId !== 0 ) { break; }
        µb.bindTabToPageStore(tabId, 'tabCommitted', details);
        break;
    }
    case 'tab-removed':
        µb.unbindTabFromPageStore(tabId);
        contextMenu.update();
        break;
    case 'tab-activated': {
        const pageStore = µb.pageStoreFromTabId(tabId);
        if ( pageStore === null ) { break; }
        µb.updateToolbarIcon(tabId);
        contextMenu.update(tabId);
        break;
    }
    case 'tab-created':
    case 'tab-updated':
        if ( Boolean(details.url) === false ) { break; }
        µb.bindTabToPageStore(tabId, 'tabUpdated', details);
        contextMenu.update(tabId);
        break;
    }
});

/******************************************************************************/
/******************************************************************************/

// Create an entry for the tab if it doesn't exist.

µb.bindTabToPageStore = function(tabId, context, details) {
    this.updateToolbarIcon(tabId, 0b111);

    // Do not create a page store for URLs which are of no interests
    if ( frameManager.tabDict.has(tabId) === false ) { return null; }

    // Reuse page store if one exists: this allows to guess if a tab is a popup
    let pageStore = this.pageStores.get(tabId);

    // Tab is not bound
    if ( pageStore === undefined ) {
        pageStore = PageStore.factory(tabId, details);
        this.pageStores.set(tabId, pageStore);
        this.pageStoresToken = Date.now();
        return pageStore;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/516
    //   Never rebind behind-the-scene scope.
    if ( tabId === frameManager.TAB_ID_NONE ) {
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
    pageStore.reuse(context, details);

    this.pageStoresToken = Date.now();

    return pageStore;
};

/******************************************************************************/

µb.unbindTabFromPageStore = function(tabId) {
    const pageStore = this.pageStores.get(tabId);
    if ( pageStore === undefined ) { return; }
    this.pageStores.delete(tabId);
    this.pageStoresToken = Date.now();
};

/******************************************************************************/

µb.pageStoreFromTabId = function(tabId) {
    return this.pageStores.get(tabId) || null;
};

µb.mustPageStoreFromTabId = function(tabId) {
    return this.pageStores.get(tabId) || this.pageStores.get(vAPI.noTabId);
};

/******************************************************************************/

// Permanent page store for behind-the-scene requests. Must never be removed.
//
// https://github.com/uBlockOrigin/uBlock-issues/issues/651
//   The whitelist status of the tabless page store will be determined by
//   the document context (if present) of the network request.

{
    const NoPageStore = class extends PageStore {
        isTrusted(fctxt) {
            return this.isNotTrusted(fctxt) === false;
        }
        isNotTrusted(fctxt) {
            if ( fctxt ) {
                const docOrigin = fctxt.getDocOrigin();
                if ( docOrigin ) {
                    return µb.isNotTrustedSite(docOrigin);
                }
            }
            return super.isNotTrusted();
        }
    };
    const pageStore = new NoPageStore(vAPI.noTabId);
    pageStore.tabHostname = 'behind-the-scene';
    pageStore.rawURL = 'https://behind-the-sccene/';
    pageStore.title = i18n$('logBehindTheScene');
    µb.pageStores.set(pageStore.tabId, pageStore);
}

/******************************************************************************/

// Update visual of extension icon.

{
    const tabIdToDetails = new Map();
    let timer;

    const computeBadgeColor = bits => {
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

    const updateBadges = ( ) => {
        const { showIconBadge } = µb.userSettings;
        for ( let [ tabId, parts ] of tabIdToDetails ) {
            let state = 0;
            let badge = '';
            let color = '#666';
            const pageStore = µb.pageStoreFromTabId(tabId);
            if ( pageStore !== null ) {
                state = pageStore.isNotTrusted() ? 1 : 0;
                if ( state === 1 ) {
                    if ( (parts & 0b0010) !== 0 ) {
                        const blockCount = pageStore.counts.blocked.any;
                        if ( blockCount !== 0 ) {
                            badge = µb.formatCount(blockCount);
                        }
                    }
                    if ( (parts & 0b0100) !== 0 ) {
                        color = computeBadgeColor(
                            µb.blockingModeFromHostname(pageStore.tabHostname)
                        );
                    }
                }
            }
            // https://www.reddit.com/r/uBlockOrigin/comments/d33d37/
            if ( showIconBadge === false ) {
                parts |= 0b1000;
            }
            vAPI.setIcon(tabId, { parts, state, badge, color });
        }
        tabIdToDetails.clear();
        timer = undefined;
    };

    // parts:
    // bit 3         bit 2         bit 1         bit 0
    // |             |             |             |
    // +-hide badge  +-badge color +-badge text  +-icon

    µb.updateToolbarIcon = function(tabId, newParts = 0b0111) {
        if ( this.readyToFilter === false ) { return; }
        if ( typeof tabId !== 'number' ) { return; }
        if ( tabId === frameManager.TAB_ID_NONE ) { return; }
        tabIdToDetails.set(tabId, newParts | (tabIdToDetails.get(tabId) ?? 0));
        if ( timer ) { return; }
        timer = self.requestIdleCallback(updateBadges, { timeout: 701 });
    };
}

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/455
//   Stale page store entries janitor

{
    const pageStoreJanitor = ( ) => {
        for ( const tabId of µb.pageStores.keys() ) {
            if ( tabId === frameManager.TAB_ID_NONE ) { continue; }
            if ( frameManager.tabDict.has(tabId) ) { continue; }
            µb.unbindTabFromPageStore(tabId);
        }
        pageStoreJanitorTimer.on(pageStoreJanitorPeriod);
    };

    const pageStoreJanitorTimer = vAPI.defer.create(pageStoreJanitor);
    const pageStoreJanitorPeriod = { min: 15 };

    pageStoreJanitorTimer.on(pageStoreJanitorPeriod);
}

/******************************************************************************/

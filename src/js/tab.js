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

/* global µBlock, vAPI */
'use strict';

/******************************************************************************/

// When the DOM content of root frame is loaded, this means the tab
// content has changed.
vAPI.tabs.onNavigation = function(details) {
    if ( details.frameId !== 0 ) {
        return;
    }
    µBlock.bindTabToPageStats(details.tabId, details.url);
};

// It may happen the URL in the tab changes, while the page's document
// stays the same (for instance, Google Maps). Without this listener,
// the extension icon won't be properly refreshed.
vAPI.tabs.onUpdated = function(tabId, changeInfo, tab) {
    if ( !tab.url || tab.url === '' ) {
        return;
    }
    if ( !changeInfo.url ) {
        return;
    }
    µBlock.bindTabToPageStats(tabId, changeInfo.url, 'tabUpdated');
};

vAPI.tabs.onClosed = function(tabId) {
    if ( tabId < 0 ) {
        return;
    }
    µBlock.unbindTabFromPageStats(tabId);
};

// https://github.com/gorhill/uBlock/issues/297
vAPI.tabs.onPopup = function(details) {
    var pageStore = µBlock.pageStoreFromTabId(details.sourceTabId);
    if ( !pageStore ) {
        return;
    }
    var requestURL = details.url;
    var result = '';

    // https://github.com/gorhill/uBlock/issues/323
    // If popup URL is whitelisted, do not block it
    if ( µBlock.getNetFilteringSwitch(requestURL) ) {
        result = µBlock.netFilteringEngine.matchStringExactType(pageStore, requestURL, 'popup');
    }

    // https://github.com/gorhill/uBlock/issues/91
        if ( result !== '' ) {
            pageStore.recordResult('popup', requestURL, result);
        }

    // Not blocked
    if ( pageStore.boolFromResult(result) === false ) {
        return;
    }

    // Blocked
    // It is a popup, block and remove the tab.
    µBlock.unbindTabFromPageStats(details.tabId);
    µBlock.XAL.destroyTab(details.tabId);
};

vAPI.tabs.registerListeners();


/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/httpswitchboard/issues/303
// Some kind of trick going on here:
//   Any scheme other than 'http' and 'https' is remapped into a fake
//   URL which trick the rest of µBlock into being able to process an
//   otherwise unmanageable scheme. µBlock needs web page to have a proper
//   hostname to work properly, so just like the 'chromium-behind-the-scene'
//   fake domain name, we map unknown schemes into a fake '{scheme}-scheme'
//   hostname. This way, for a specific scheme you can create scope with
//   rules which will apply only to that scheme.

µBlock.normalizePageURL = function(pageURL) {
    var uri = this.URI.set(pageURL);
    if ( uri.scheme === 'https' || uri.scheme === 'http' ) {
        return uri.normalizedURI();
    }
    return '';
};

/******************************************************************************/

// Create an entry for the tab if it doesn't exist.

µBlock.bindTabToPageStats = function(tabId, pageURL, context) {
    this.updateBadgeAsync(tabId);

    // https://github.com/gorhill/httpswitchboard/issues/303
    // Normalize page URL
    pageURL = this.normalizePageURL(pageURL);

    // Do not create a page store for URLs which are of no interests
    if ( pageURL === '' ) {
        this.unbindTabFromPageStats(tabId);
        return null;
    }

    // Reuse page store if one exists: this allows to guess if a tab is
    // a popup.
    var pageStore = this.pageStores[tabId];

    if ( pageStore ) {
        if ( pageURL !== pageStore.pageURL || context === 'beforeRequest' ) {
            pageStore.reuse(pageURL, context);
        }
    } else {
        pageStore = this.pageStores[tabId] = this.PageStore.factory(tabId, pageURL);
    }

    return pageStore;
};

µBlock.unbindTabFromPageStats = function(tabId) {
    //console.debug('µBlock> unbindTabFromPageStats(%d)', tabId);
    var pageStore = this.pageStores[tabId];
    if ( pageStore !== undefined ) {
        pageStore.dispose();
        delete this.pageStores[tabId];
    }
};

/******************************************************************************/

µBlock.pageUrlFromTabId = function(tabId) {
    var pageStore = this.pageStores[tabId];
    return pageStore ? pageStore.pageURL : '';
};

µBlock.pageUrlFromPageStats = function(pageStats) {
    if ( pageStats ) {
        return pageStats.pageURL;
    }
    return '';
};

µBlock.pageStoreFromTabId = function(tabId) {
    return this.pageStores[tabId];
};

/******************************************************************************/

// µBlock.forceReload = function(pageURL) {
//     var tabId = this.tabIdFromPageUrl(pageURL);
//     if ( tabId ) {
//         chrome.tabs.reload(tabId, { bypassCache: true });
//     }
// };

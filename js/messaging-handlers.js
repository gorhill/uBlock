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

/* global chrome, µBlock, YaMD5 */

/******************************************************************************/

(function() {

// popup.js

/******************************************************************************/

var getStats = function(request) {
    var µb = µBlock;
    var r = {
        globalBlockedRequestCount: µb.localSettings.blockedRequestCount,
        globalAllowedRequestCount: µb.localSettings.allowedRequestCount,
        tabId: request.tabId,
        pageURL: '',
        pageBlockedRequestCount: 0,
        pageAllowedRequestCount: 0,
        netFilteringSwitch: false,
        cosmeticFilteringSwitch: false,
        logBlockedRequests: µb.userSettings.logBlockedRequests,
        logAllowedRequests: µb.userSettings.logAllowedRequests
    };
    var pageStore = µb.pageStoreFromTabId(request.tabId);
    if ( pageStore ) {
        r.pageURL = pageStore.pageURL;
        r.pageHostname = pageStore.pageHostname;
        r.pageBlockedRequestCount = pageStore.perLoadBlockedRequestCount;
        r.pageAllowedRequestCount = pageStore.perLoadAllowedRequestCount;
        r.netFilteringSwitch = pageStore.getNetFilteringSwitch();
    }
    return r;
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {
        case 'stats':
            response = getStats(request);
            break;

        case 'toggleNetFiltering':
            µBlock.toggleNetFilteringSwitch(
                request.url,
                request.scope,
                request.state
            );
            µBlock.updateBadgeAsync(request.tabId);
            break;

        case 'gotoPick':
            chrome.tabs.executeScript(request.tabId, { file: 'js/element-picker.js' });
            break;

        default:
            return µBlock.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µBlock.messaging.listen('popup.js', onMessage);

})();

/******************************************************************************/

// contentscript-start.js

(function() {

var µb = µBlock;

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
        default:
            break;
    }

    // Sync
    var response;

    var pageStore;
    if ( sender && sender.tab ) {
        pageStore = µb.pageStoreFromTabId(sender.tab.id);
    }

    switch ( request.what ) {
        case 'retrieveDomainCosmeticSelectors':
            if ( pageStore && pageStore.getNetFilteringSwitch() ) {
                response = µb.abpHideFilters.retrieveDomainSelectors(request);
            }
            break;

        default:
            return µb.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µb.messaging.listen('contentscript-start.js', onMessage);

})();

/******************************************************************************/

// contentscript-end.js

(function() {

var µb = µBlock;

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
        default:
            break;
    }

    // Sync
    var response;

    var pageStore;
    if ( sender && sender.tab ) {
        pageStore = µb.pageStoreFromTabId(sender.tab.id);
    }

    switch ( request.what ) {
        case 'retrieveGenericCosmeticSelectors':
            if ( pageStore && pageStore.getNetFilteringSwitch() ) {
                response = µb.abpHideFilters.retrieveGenericSelectors(request);
            }
            break;

        case 'injectedSelectors':
            µb.abpHideFilters.addToSelectorCache(request);
            break;

        case 'blockedRequests':
            response = {
                collapse: µb.userSettings.collapseBlocked,
                blockedRequests: pageStore ? pageStore.blockedRequests : {}
            };
            break;

        // Check a single request
        case 'blockedRequest':
            response = {
                collapse: µb.userSettings.collapseBlocked,
                blocked: pageStore && pageStore.blockedRequests[request.url]
            };
            break;

        default:
            return µb.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µb.messaging.listen('contentscript-end.js', onMessage);

})();

/******************************************************************************/

// element-picker.js

(function() {

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {
        case 'i18n':
            response = {
                create: chrome.i18n.getMessage('pickerCreate'),
                pick: chrome.i18n.getMessage('pickerPick'),
                quit: chrome.i18n.getMessage('pickerQuit'),
                netFilters: chrome.i18n.getMessage('pickerNetFilters'),
                cosmeticFilters: chrome.i18n.getMessage('pickerCosmeticFilters')
            };
            break;

        case 'createUserFilter':
            µBlock.appendUserFilters(request.filters);
            break;

        default:
            return µBlock.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µBlock.messaging.listen('element-picker.js', onMessage);

})();

/******************************************************************************/

// 3p-filters.js

(function() {

var getLists = function(callback) {
    var µb = µBlock;
    var r = {
        available: null,
        current: µb.remoteBlacklists,
        cosmetic: µb.userSettings.parseAllABPHideFilters,
        netFilterCount: µb.abpFilters.getFilterCount(),
        cosmeticFilterCount: µb.abpHideFilters.getFilterCount(),
        autoUpdate: µb.userSettings.autoUpdate,
        userFiltersPath: µb.userFiltersPath,
        cache: null
    };
    var onMetadataReady = function(entries) {
        r.cache = entries;
        if ( r.available ) {
            callback(r);
        }
    };
    var onLists = function(lists) {
        r.available = lists;
        if ( r.cache ) {
            callback(r);
        }
    };
    µb.getAvailableLists(onLists);
    µb.assets.metadata(onMetadataReady);
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    var µb = µBlock;

    // Async
    switch ( request.what ) {
        case 'getLists':
            return getLists(callback);

        case 'readUserUbiquitousBlockRules':
            return µb.assets.get(µb.userFiltersPath, callback);

        case 'writeUserUbiquitousBlockRules':
            return µb.assets.put(µb.userFiltersPath, request.content, callback);

        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {
        case 'purgeCache':
            µb.assets.purge(request.path);
            break;

        default:
            return µb.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µBlock.messaging.listen('3p-filters.js', onMessage);

})();

/******************************************************************************/

// 1p-filters.js

(function() {

var onMessage = function(request, sender, callback) {
    var µb = µBlock;

    // Async
    switch ( request.what ) {
        case 'readUserFilters':
            return µb.assets.get(µb.userFiltersPath, callback);

        case 'writeUserFilters':
            return µb.assets.put(µb.userFiltersPath, request.content, callback);

        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {
        default:
            return µb.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µBlock.messaging.listen('1p-filters.js', onMessage);

})();

/******************************************************************************/

// whitelist.js

(function() {

var onMessage = function(request, sender, callback) {
    var µb = µBlock;

    // Async
    switch ( request.what ) {
        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {
        case 'getWhitelist':
            response = µb.stringFromWhitelist(µb.netWhitelist);
            break;

        case 'setWhitelist':
            µb.netWhitelist = µb.whitelistFromString(request.whitelist);
            µb.saveWhitelist();
            break;

        default:
            return µb.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µBlock.messaging.listen('whitelist.js', onMessage);

})();

/******************************************************************************/

// stats.js

(function() {

var getPageDetails = function(µb, tabId) {
    var r = {
        blockedRequests: [],
        allowedRequests: [],
        hash: ''
    };
    var pageStore = µb.pageStores[tabId];
    if ( !pageStore ) {
        return r;
    }
    var prepareRequests = function(requests, hasher) {
        var r = [];
        var details, pos;
        for ( var requestURL in requests ) {
            if ( requests.hasOwnProperty(requestURL) === false ) {
                continue;
            }
            details = requests[requestURL];
            if ( typeof details !== 'string' ) {
                continue;
            }
            hasher.appendStr(requestURL);
            hasher.appendStr(details);
            pos = details.indexOf('\t');
            r.push({
                type: details.slice(0, pos),
                domain: µb.URI.domainFromURI(requestURL),
                url: requestURL,
                reason: details.slice(pos + 1)
            });
        }
        return r;
    };
    var hasher = new YaMD5();
    if ( µb.userSettings.logBlockedRequests ) {
        r.blockedRequests = prepareRequests(pageStore.blockedRequests, hasher);
    }
    if ( µb.userSettings.logAllowedRequests ) {
        r.allowedRequests = prepareRequests(pageStore.allowedRequests, hasher);
    }
    r.hash = hasher.end();
    return r;
};

var onMessage = function(request, sender, callback) {
    var µb = µBlock;

    // Async
    switch ( request.what ) {
        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {
        case 'getPageSelectors':
            response = Object.keys(µb.pageStores);
            break;

        case 'getPageDetails':
            response = getPageDetails(µb, request.tabId);
            break;

        default:
            return µb.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µBlock.messaging.listen('stats.js', onMessage);

})();

/******************************************************************************/

// about.js

(function() {

var onMessage = function(request, sender, callback) {
    var µb = µBlock;

    // Async
    switch ( request.what ) {

        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {

        default:
            return µb.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µBlock.messaging.listen('about.js', onMessage);

})();

// https://www.youtube.com/watch?v=3_WcygKJP1k

/******************************************************************************/

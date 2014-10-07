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
/******************************************************************************/

// popup.js

(function() {

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var getDynamicFilterResults = function(scope) {
    return [
        µb.netFilteringEngine.matchDynamicFilters(scope, 'inline-script', true),
        µb.netFilteringEngine.matchDynamicFilters(scope, 'script', true),
        µb.netFilteringEngine.matchDynamicFilters(scope, 'script', false),
        µb.netFilteringEngine.matchDynamicFilters(scope, 'sub_frame', true),
        µb.netFilteringEngine.matchDynamicFilters(scope, 'sub_frame', false)
    ];
};

/******************************************************************************/

var getStats = function(request) {
    var r = {
        globalBlockedRequestCount: µb.localSettings.blockedRequestCount,
        globalAllowedRequestCount: µb.localSettings.allowedRequestCount,
        tabId: request.tabId,
        pageURL: '',
        pageBlockedRequestCount: 0,
        pageAllowedRequestCount: 0,
        netFilteringSwitch: false,
        cosmeticFilteringSwitch: false,
        logRequests: µb.userSettings.logRequests,
        dynamicFilteringEnabled: µb.userSettings.dynamicFilteringEnabled,
        dynamicFilterResults: {
            '/': getDynamicFilterResults('*')
        }
    };
    var pageStore = µb.pageStoreFromTabId(request.tabId);
    if ( pageStore ) {
        r.pageURL = pageStore.pageURL;
        r.pageHostname = pageStore.pageHostname;
        r.pageBlockedRequestCount = pageStore.perLoadBlockedRequestCount;
        r.pageAllowedRequestCount = pageStore.perLoadAllowedRequestCount;
        r.netFilteringSwitch = pageStore.getNetFilteringSwitch();
        r.dynamicFilterResults['.'] = getDynamicFilterResults(r.pageHostname);
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
        case 'gotoPick':
            // Picker launched from popup: clear context menu args
            µb.contextMenuClientX = -1;
            µb.contextMenuClientY = -1;
            µb.elementPickerExec(request.tabId);
            break;

        case 'stats':
            response = getStats(request);
            break;

        case 'toggleNetFiltering':
            µb.toggleNetFilteringSwitch(
                request.url,
                request.scope,
                request.state
            );
            µb.updateBadgeAsync(request.tabId);
            break;

        case 'toggleDynamicFilter':
            µb.toggleDynamicFilter(request);
            response = { '/': getDynamicFilterResults('*') };
            if ( request.pageHostname ) {
                response['.'] = getDynamicFilterResults(request.pageHostname);
            }
            break;

        default:
            return µb.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µb.messaging.listen('popup.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// contentscript-start.js

(function() {

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

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
                response = µb.cosmeticFilteringEngine.retrieveDomainSelectors(request);
            }
            break;

        default:
            return µb.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µb.messaging.listen('contentscript-start.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// contentscript-end.js

(function() {

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var tagNameToRequestTypeMap = {
     'embed': 'object',
    'iframe': 'sub_frame',
       'img': 'image',
    'object': 'object'
};

/******************************************************************************/

// Evaluate many requests

var filterRequests = function(pageStore, details) {
    details.pageDomain = µb.URI.domainFromHostname(details.pageHostname);
    details.rootHostname = pageStore.rootHostname;
    details.rootDomain = pageStore.rootDomain;

    var inRequests = details.requests;
    var outRequests = [];
    var request, result;
    var i = inRequests.length;
    while ( i-- ) {
        request = inRequests[i];
        if ( tagNameToRequestTypeMap.hasOwnProperty(request.tagName) === false ) {
            continue;
        }
        result = pageStore.filterRequest(
            details,
            tagNameToRequestTypeMap[request.tagName],
            request.url
        );
        if ( pageStore.boolFromResult(result) ) {
            outRequests.push(request);
        }
    }
    return {
        collapse: µb.userSettings.collapseBlocked,
        requests: outRequests
    };
};

/******************************************************************************/

// Evaluate a single request

var filterRequest = function(pageStore, details) {
    if ( tagNameToRequestTypeMap.hasOwnProperty(details.tagName) === false ) {
        return;
    }
    details.pageDomain = µb.URI.domainFromHostname(details.pageHostname);
    details.rootHostname = pageStore.rootHostname;
    details.rootDomain = pageStore.rootDomain;
    var result = pageStore.filterRequest(
        details,
        tagNameToRequestTypeMap[details.tagName],
        details.requestURL
    );
    if ( pageStore.boolFromResult(result) ) {
        return { collapse: µb.userSettings.collapseBlocked };
    }
};

/******************************************************************************/

var onMessage = function(details, sender, callback) {
    // Async
    switch ( details.what ) {
        default:
            break;
    }

    // Sync
    var response;

    var pageStore;
    if ( sender && sender.tab ) {
        pageStore = µb.pageStoreFromTabId(sender.tab.id);
    }

    switch ( details.what ) {
        case 'retrieveGenericCosmeticSelectors':
            if ( pageStore && pageStore.getNetFilteringSwitch() ) {
                response = µb.cosmeticFilteringEngine.retrieveGenericSelectors(details);
            }
            break;

        case 'injectedSelectors':
            µb.cosmeticFilteringEngine.addToSelectorCache(details);
            break;

        // Evaluate many requests
        case 'filterRequests':
            if ( pageStore && pageStore.getNetFilteringSwitch() ) {
                response = filterRequests(pageStore, details);
            }
            break;

        // Evaluate a single request
        case 'filterRequest':
            if ( pageStore && pageStore.getNetFilteringSwitch() ) {
                response = filterRequest(pageStore, details);
            }
            break;

        default:
            return µb.messaging.defaultHandler(details, sender, callback);
    }

    callback(response);
};

µb.messaging.listen('contentscript-end.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// element-picker.js

(function() {

/******************************************************************************/

var µb = µBlock;

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
        case 'elementPickerArguments':
            response = {
                i18n: {
                    create: chrome.i18n.getMessage('pickerCreate'),
                    pick: chrome.i18n.getMessage('pickerPick'),
                    quit: chrome.i18n.getMessage('pickerQuit'),
                    netFilters: chrome.i18n.getMessage('pickerNetFilters'),
                    cosmeticFilters: chrome.i18n.getMessage('pickerCosmeticFilters'),
                    cosmeticFiltersHint: chrome.i18n.getMessage('pickerCosmeticFiltersHint')
                },
                target: µb.contextMenuTarget,
                clientX: µb.contextMenuClientX,
                clientY: µb.contextMenuClientY
            };
            µb.contextMenuTarget = '';
            µb.contextMenuClientX = -1;
            µb.contextMenuClientY = -1;
            break;

        case 'createUserFilter':
            µb.appendUserFilters(request.filters);
            break;

        default:
            return µb.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µb.messaging.listen('element-picker.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// 3p-filters.js

(function() {

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var getLists = function(callback) {
    var r = {
        available: null,
        current: µb.remoteBlacklists,
        cosmetic: µb.userSettings.parseAllABPHideFilters,
        netFilterCount: µb.netFilteringEngine.getFilterCount(),
        cosmeticFilterCount: µb.cosmeticFilteringEngine.getFilterCount(),
        autoUpdate: µb.userSettings.autoUpdate,
        userFiltersPath: µb.userFiltersPath,
        cache: null
    };
    var onMetadataReady = function(entries) {
        r.cache = entries;
        callback(r);
    };
    var onLists = function(lists) {
        r.available = lists;
        µb.assets.metadata(onMetadataReady);
    };
    µb.getAvailableLists(onLists);
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
        case 'getLists':
            return getLists(callback);

        case 'getLists':
            return getLists(callback);

        case 'purgeAllCaches':
            return µb.assets.purgeAll(callback);

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

µb.messaging.listen('3p-filters.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// 1p-filters.js

(function() {

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var onMessage = function(request, sender, callback) {
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

µb.messaging.listen('1p-filters.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// whitelist.js

(function() {

/******************************************************************************/

var µb = µBlock;

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

µb.messaging.listen('whitelist.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// stats.js

(function() {

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

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
    var prepareRequests = function(wantBlocked, hasher) {
        var µburi = µb.URI;
        var dict = pageStore.netFilteringCache.fetchAll();
        var r = [];
        var details, hostname, domain;
        for ( var url in dict ) {
            if ( dict.hasOwnProperty(url) === false ) {
                continue;
            }
            details = dict[url];
            if ( wantBlocked !== pageStore.boolFromResult(details.result) ) {
                continue;
            }
            hasher.appendStr(url);
            hasher.appendStr(details.result);
            hostname = µburi.hostnameFromURI(url);
            domain = µburi.domainFromHostname(hostname) || hostname;
            r.push({
                url: url,
                domain: domain,
                reason: details.result,
                type: details.type,
                flags: details.flags
            });
        }
        return r;
    };
    var hasher = new YaMD5();
    if ( µb.userSettings.logRequests ) {
        r.blockedRequests = prepareRequests(true, hasher);
        r.allowedRequests = prepareRequests(false, hasher);
    }
    r.hash = hasher.end();
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

µb.messaging.listen('stats.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// about.js

(function() {

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var getUserData = function(callback) {
    var onUserFiltersReady = function(details) {
        callback({
            'timeStamp': Date.now(),
            'version': µb.manifest.version,
            'userSettings': µb.userSettings,
            'filterLists': µb.remoteBlacklists,
            'netWhitelist': µb.stringFromWhitelist(µb.netWhitelist),
            'userFilters': details.content
        });
    };
    µb.assets.get('assets/user/filters.txt', onUserFiltersReady);
};

/******************************************************************************/

var restoreUserData = function(userData) {
    // If we are going to restore all, might as well wipe out clean local
    // storage
    µb.XAL.keyvalRemoveAll();
    µBlock.saveLocalSettings();
    µb.XAL.keyvalSetMany(userData.userSettings);
    µb.XAL.keyvalSetOne('remoteBlacklists', userData.filterLists);
    µb.XAL.keyvalSetOne('netWhitelist', userData.netWhitelist);
    µb.assets.put('assets/user/filters.txt', userData.userFilters);
    µb.XAL.restart();
};

/******************************************************************************/

var resetUserData = function() {
    µb.XAL.keyvalRemoveAll();
    // Keep global counts, people can become quite attached to numbers
    µBlock.saveLocalSettings();
    µb.XAL.restart();
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
        case 'getUserData':
            return getUserData(callback);

        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {
        case 'restoreUserData':
            restoreUserData(request.userData);
            break;

        case 'resetUserData':
            resetUserData();
            break;

        default:
            return µb.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µb.messaging.listen('about.js', onMessage);

/******************************************************************************/

})();

// https://www.youtube.com/watch?v=3_WcygKJP1k

/******************************************************************************/

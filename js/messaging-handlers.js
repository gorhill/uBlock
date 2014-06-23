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

/* global chrome, µBlock */

/******************************************************************************/

(function() {

// popup.js

/******************************************************************************/

var getStats = function(request, callback) {
    var µb = µBlock;
    var r = {
        globalBlockedRequestCount: µb.localSettings.blockedRequestCount,
        globalAllowedRequestCount: µb.localSettings.allowedRequestCount,
        tabId: request.tabId,
        pageURL: '',
        pageBlockedRequestCount: 0,
        pageAllowedRequestCount: 0,
        netFilteringSwitch: false,
        cosmeticFilteringSwitch: false
    };
    var pageStore = µb.pageStoreFromTabId(request.tabId);
    if ( pageStore ) {
        r.pageURL = pageStore.pageURL;
        r.pageHostname = pageStore.pageHostname;
        r.pageBlockedRequestCount = pageStore.perLoadBlockedRequestCount;
        r.pageAllowedRequestCount = pageStore.perLoadAllowedRequestCount;
        r.netFilteringSwitch = µb.getNetFilteringSwitch(pageStore.pageHostname);
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
                request.hostname,
                request.state
            );
            µBlock.updateBadge(request.tabId);
            break;

        default:
            return µBlock.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µBlock.messaging.listen('popup.js', onMessage);

})();

/******************************************************************************/

// content scripts

(function() {

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
        pageStore = µBlock.pageStoreFromTabId(sender.tab.id);
    }
    var tabHostname = pageStore ? pageStore.pageHostname : '';

    switch ( request.what ) {
        case 'retrieveDomainCosmeticSelectors':
            response = µBlock.abpHideFilters.retrieveDomainSelectors(tabHostname, request);
            break;

        case 'retrieveGenericCosmeticSelectors':
            response = µBlock.abpHideFilters.retrieveGenericSelectors(tabHostname, request);
            break;

        default:
            return µBlock.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µBlock.messaging.listen('contentscript-start.js', onMessage);
µBlock.messaging.listen('contentscript-end.js', onMessage);

})();

/******************************************************************************/

// 3p-filters.js

(function() {

var onMessage = function(request, sender, callback) {
    var µb = µBlock;

    // Async
    switch ( request.what ) {
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

// about.js

(function() {

var onMessage = function(request, sender, callback) {
    var µb = µBlock;

    // Async
    switch ( request.what ) {
        case 'getAssetUpdaterList':
            return µb.assetUpdater.getList(callback);

        case 'launchAssetUpdater':
            return µb.assetUpdater.update(request.list, callback);

        case 'readUserSettings':
            return chrome.storage.local.get(µb.userSettings, callback);

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
        case 'loadUpdatableAssets':
            response = µb.loadUpdatableAssets();
            break;

        case 'readFilterListSelection':
            response = µb.remoteBlacklists;
            break;

        case 'getSomeStats':
            response = {
                storageQuota: µb.storageQuota,
                storageUsed: µb.storageUsed
            };
            break;

        default:
            return µb.messaging.defaultHandler(request, sender, callback);
    }

    callback(response);
};

µBlock.messaging.listen('about.js', onMessage);

})();

/******************************************************************************/

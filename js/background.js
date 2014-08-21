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

/* global chrome */

/******************************************************************************/

var µBlock = (function() {

/******************************************************************************/

var oneSecond = 1000;
var oneMinute = 60 * oneSecond;
var oneHour = 60 * oneMinute;
var oneDay = 24 * oneHour;

/******************************************************************************/

return {
    manifest: chrome.runtime.getManifest(),

    userSettings: {
        autoUpdate: true,
        collapseBlocked: true,
        externalLists: '',
        logBlockedRequests: false,
        logAllowedRequests: false,
        parseAllABPHideFilters: true,
        netExceptionList: {}, // TODO: remove once all users are up to date
        netWhitelist: '',
        showIconBadge: true
    },
    localSettings: {
        blockedRequestCount: 0,
        allowedRequestCount: 0
    },

    // EasyList, EasyPrivacy and many others have an update frequency
    // of 4 days, as per list headers.
    updateAssetsEvery: 75 * oneHour + 23 * oneMinute + 53 * oneSecond + 605,
    projectServerRoot: 'https://raw.githubusercontent.com/gorhill/uBlock/master/',
    userFiltersPath: 'assets/user/filters.txt',

    // permanent lists
    permanentLists: {
        // User
        'assets/user/filters.txt': {
            group: 'default'
        },
        // uBlock
        'assets/ublock/filters.txt': {
            title: 'µBlock filters',
            group: 'default'
        },
        'assets/ublock/privacy.txt': {
            off: true,
            title: 'µBlock filters - Privacy',
            group: 'default'
        }
    },

    // current lists
    remoteBlacklists: {
    },

    netWhitelist: {},
    netWhitelistModifyTime: 0,
    pageStores: {},

    storageQuota: chrome.storage.local.QUOTA_BYTES,
    storageUsed: 0,

    // so that I don't have to care for last comma
    dummy: 0
};

/******************************************************************************/

})();

/******************************************************************************/


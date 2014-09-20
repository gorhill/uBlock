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
        logRequests: false,
        parseAllABPHideFilters: true,
        showIconBadge: true
    },

    // https://github.com/gorhill/uBlock/issues/180
    // Whitelist directives need to be loaded once the PSL is available
    netExceptionList: {}, // TODO: remove once all users are up to date
    netWhitelist: {},
    netWhitelistModifyTime: 0,

    localSettings: {
        blockedRequestCount: 0,
        allowedRequestCount: 0
    },

    // EasyList, EasyPrivacy and many others have an 4-day update period,
    // as per list headers.
    updateAssetsEvery: 75 * oneHour + 23 * oneMinute + 53 * oneSecond + 605,
    projectServerRoot: 'https://raw.githubusercontent.com/gorhill/uBlock/master/',
    userFiltersPath: 'assets/user/filters.txt',
    pslPath: 'assets/thirdparties/publicsuffix.org/list/effective_tld_names.dat',

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

    firstUpdateAfter: 5 * oneMinute,
    nextUpdateAfter: 7 * oneHour,

    selfieMagic: 'hdnliuyxkoeg',
    selfieAfter: 7 * oneMinute,

    pageStores: {},

    storageQuota: chrome.storage.local.QUOTA_BYTES,
    storageUsed: 0,

    noopFunc: function(){},

    apiErrorCount: 0,

    // so that I don't have to care for last comma
    dummy: 0
};

/******************************************************************************/

})();

/******************************************************************************/


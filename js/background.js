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

return {
    manifest: chrome.runtime.getManifest(),

    userSettings: {
        showIconBadge: true,
        parseAllABPHideFilters: true,
        netExceptionList: {}
    },
    localSettings: {
        blockedRequestCount: 0,
        allowedRequestCount: 0
    },

    updateAssetsEvery: 5 * 24 * 60 * 60 * 1000,
    projectServerRoot: 'https://raw2.github.com/gorhill/ublock/master/',
    userFiltersPath: 'assets/user/filters.txt',

    // list of remote blacklist locations
    remoteBlacklists: {
        // User
        'assets/user/filters.txt': {},

        // 3rd-party lists fetched dynamically
        },

    // urls stats are kept on the back burner while waiting to be reactivated
    // in a tab or another.
    pageStores: {},
    pageStoreDump: {},

    // Power switch to disengage µBlock
    off: false,

    storageQuota: chrome.storage.local.QUOTA_BYTES,
    storageUsed: 0,

    // so that I don't have to care for last comma
    dummy: 0
};

/******************************************************************************/

})();

/******************************************************************************/


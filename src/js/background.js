/*******************************************************************************

    uBlock - a browser extension to block requests.
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

    Home: https://github.com/chrisaljoudi/uBlock
*/

/* global vAPI */
/* exported µBlock */

/******************************************************************************/

var µBlock = (function() {

'use strict';

/******************************************************************************/

var oneSecond = 1000;
var oneMinute = 60 * oneSecond;
var oneHour = 60 * oneMinute;
// var oneDay = 24 * oneHour;

/******************************************************************************/

var defaultExternalLists = [
    '! Examples:',
    '! https://easylist-downloads.adblockplus.org/antiadblockfilters.txt',
    '! https://easylist-downloads.adblockplus.org/fb_annoyances_full.txt',
    '! https://easylist-downloads.adblockplus.org/fb_annoyances_sidebar.txt',
    '! https://easylist-downloads.adblockplus.org/fb_annoyances_newsfeed.txt',
    '! https://easylist-downloads.adblockplus.org/yt_annoyances_full.txt',
    '! https://easylist-downloads.adblockplus.org/yt_annoyances_comments.txt',
    '! https://easylist-downloads.adblockplus.org/yt_annoyances_suggestions.txt',
    '! https://easylist-downloads.adblockplus.org/yt_annoyances_other.txt'
].join('\n');

/******************************************************************************/

return {
    userSettings: {
        advancedUserEnabled: false,
        autoUpdate: true,
        collapseBlocked: true,
        contextMenuEnabled: true,
        dynamicFilteringEnabled: false,
        experimentalEnabled: false,
        externalLists: defaultExternalLists,
        firewallPaneMinimized: true,
        parseAllABPHideFilters: true,
        requestLogMaxEntries: 1000,
        showIconBadge: true
    },

    // https://github.com/chrisaljoudi/uBlock/issues/180
    // Whitelist directives need to be loaded once the PSL is available
    netWhitelist: {},
    netWhitelistModifyTime: 0,
    netWhitelistDefault: [
        'behind-the-scene',
        'chrome-extension-scheme',
        'chrome-scheme',
        'opera-scheme',
        ''
    ].join('\n').trim(),

    localSettings: {
        blockedRequestCount: 0,
        allowedRequestCount: 0,
    },
    localSettingsModifyTime: 0,
    localSettingsSaveTime: 0,

    // read-only
    systemSettings: {
        compiledMagic: 'perhodsoahya',
        selfieMagic: 'spqmeuaftfra'
    },

    restoreBackupSettings: {
        lastRestoreFile: '',
        lastRestoreTime: 0,
        lastBackupFile: '',
        lastBackupTime: 0
    },

    // EasyList, EasyPrivacy and many others have an 4-day update period,
    // as per list headers.
    updateAssetsEvery: 97 * oneHour,
    projectServerRoot: 'https://raw.githubusercontent.com/chrisaljoudi/uBlock/master/',
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
            title: 'uBlock filters',
            group: 'default'
        },
        'assets/ublock/privacy.txt': {
            title: 'uBlock filters – Privacy',
            group: 'default'
        }
    },

    // current lists
    remoteBlacklists: {
    },

    selfieAfter: 23 * oneMinute,

    pageStores: {},

    storageQuota: vAPI.storage.QUOTA_BYTES,
    storageUsed: 0,

    noopFunc: function(){},

    apiErrorCount: 0,
    contextMenuTarget: '',
    contextMenuClientX: -1,
    contextMenuClientY: -1,

    epickerTarget: '',
    epickerEprom: null,

    // so that I don't have to care for last comma
    dummy: 0
};

/******************************************************************************/

})();

/******************************************************************************/


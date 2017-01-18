/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2017 Raymond Hill

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

var µBlock = (function() { // jshint ignore:line

/******************************************************************************/

var oneSecond = 1000;
var oneMinute = 60 * oneSecond;

/******************************************************************************/

var defaultExternalLists = [
    '! Examples:',
    '! https://easylist-downloads.adblockplus.org/fb_annoyances_full.txt',
    '! https://easylist-downloads.adblockplus.org/yt_annoyances_full.txt',
    ''
].join('\n');

/******************************************************************************/

return {
    firstInstall: false,

    userSettings: {
        advancedUserEnabled: false,
        alwaysDetachLogger: false,
        autoUpdate: true,
        cloudStorageEnabled: false,
        collapseBlocked: true,
        colorBlindFriendly: false,
        contextMenuEnabled: true,
        dynamicFilteringEnabled: false,
        externalLists: defaultExternalLists,
        firewallPaneMinimized: true,
        hyperlinkAuditingDisabled: true,
        ignoreGenericCosmeticFilters: false,
        largeMediaSize: 50,
        parseAllABPHideFilters: true,
        prefetchingDisabled: true,
        requestLogMaxEntries: 1000,
        showIconBadge: true,
        tooltipsDisabled: false,
        webrtcIPAddressHidden: false
    },

    hiddenSettingsDefault: {
        assetFetchTimeout: 30,
        autoUpdateAssetFetchPeriod: 120,
        autoUpdatePeriod: 7,
        ignoreRedirectFilters: false,
        ignoreScriptInjectFilters: false,
        manualUpdateAssetFetchPeriod: 2000,
        popupFontSize: 'unset',
        suspendTabsUntilReady: false
    },
    // This will be filled ASAP:
    hiddenSettings: {},

    // Features detection.
    privacySettingsSupported: vAPI.browserSettings instanceof Object,
    cloudStorageSupported: vAPI.cloud instanceof Object,

    // https://github.com/chrisaljoudi/uBlock/issues/180
    // Whitelist directives need to be loaded once the PSL is available
    netWhitelist: {},
    netWhitelistModifyTime: 0,
    netWhitelistDefault: [
        'about-scheme',
        'behind-the-scene',
        'chrome-extension-scheme',
        'chrome-scheme',
        'loopconversation.about-scheme',
        'moz-extension-scheme',
        'opera-scheme',
        'vivaldi-scheme',
        ''
    ].join('\n'),

    localSettings: {
        blockedRequestCount: 0,
        allowedRequestCount: 0
    },
    localSettingsLastModified: 0,
    localSettingsLastSaved: 0,

    // read-only
    systemSettings: {
        compiledMagic: 'zelhzxrhkfjr',
        selfieMagic: 'zelhzxrhkfjr'
    },

    restoreBackupSettings: {
        lastRestoreFile: '',
        lastRestoreTime: 0,
        lastBackupFile: '',
        lastBackupTime: 0
    },

    // Allows to fully customize uBO's assets, typically set through admin
    // settings. The content of 'assets.json' will also tell which filter
    // lists to enable by default when uBO is first installed.
    assetsBootstrapLocation: 'assets/assets.json',

    userFiltersPath: 'user-filters',
    pslAssetKey: 'public_suffix_list.dat',

    availableFilterLists: {},

    selfieAfter: 23 * oneMinute,

    pageStores: {},
    pageStoresToken: 0,

    storageQuota: vAPI.storage.QUOTA_BYTES,
    storageUsed: 0,

    noopFunc: function(){},

    apiErrorCount: 0,
    mouseX: -1,
    mouseY: -1,
    mouseURL: '',
    epickerTarget: '',
    epickerEprom: null,

    scriptlets: {
    },

    // so that I don't have to care for last comma
    dummy: 0
};

/******************************************************************************/

})();

/******************************************************************************/


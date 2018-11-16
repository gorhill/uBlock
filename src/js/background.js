/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
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


'use strict';

/******************************************************************************/

// Not all platforms may have properly declared vAPI.webextFlavor.

if ( vAPI.webextFlavor === undefined ) {
    vAPI.webextFlavor = { major: 0, soup: new Set([ 'ublock' ]) };
}


/******************************************************************************/

const µBlock = (function() { // jshint ignore:line

    const oneSecond = 1000,
          oneMinute = 60 * oneSecond;

    const hiddenSettingsDefault = {
        assetFetchTimeout: 30,
        autoUpdateAssetFetchPeriod: 120,
        autoUpdatePeriod: 7,
        benchmarkingPane: false,
        cacheStorageCompression: true,
        cacheControlForFirefox1376932: 'no-cache, no-store, must-revalidate',
        debugScriptlets: false,
        disableWebAssembly: false,
        ignoreRedirectFilters: false,
        ignoreScriptInjectFilters: false,
        manualUpdateAssetFetchPeriod: 500,
        popupFontSize: 'unset',
        requestJournalProcessPeriod: 1000,
        strictBlockingBypassDuration: 120,
        suspendTabsUntilReady: false,
        userResourcesLocation: 'unset'
    };

    const whitelistDefault = [
        'about-scheme',
        'chrome-extension-scheme',
        'chrome-scheme',
        'moz-extension-scheme',
        'opera-scheme',
        'vivaldi-scheme',
        'wyciwyg-scheme',   // Firefox's "What-You-Cache-Is-What-You-Get"
    ];

    return {
        firstInstall: false,

        userSettings: {
            advancedUserEnabled: false,
            alwaysDetachLogger: true,
            autoUpdate: true,
            cloudStorageEnabled: false,
            collapseBlocked: true,
            colorBlindFriendly: false,
            contextMenuEnabled: true,
            dynamicFilteringEnabled: false,
            externalLists: [],
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

        hiddenSettingsDefault: hiddenSettingsDefault,
        hiddenSettings: (function() {
            let out = Object.assign({}, hiddenSettingsDefault),
                json = vAPI.localStorage.getItem('immediateHiddenSettings');
            if ( typeof json === 'string' ) {
                try {
                    let o = JSON.parse(json);
                    if ( o instanceof Object ) {
                        for ( let k in o ) {
                            if ( out.hasOwnProperty(k) ) {
                                out[k] = o[k];
                            }
                        }
                    }
                }
                catch(ex) {
                }
            }
            // Remove once 1.15.12+ is widespread.
            vAPI.localStorage.removeItem('hiddenSettings');
            return out;
        })(),

        // Features detection.
        privacySettingsSupported: vAPI.browserSettings instanceof Object,
        cloudStorageSupported: vAPI.cloud instanceof Object,
        canFilterResponseData: typeof browser.webRequest.filterResponseData === 'function',
        canInjectScriptletsNow: vAPI.webextFlavor.soup.has('chromium'),

        // https://github.com/chrisaljoudi/uBlock/issues/180
        // Whitelist directives need to be loaded once the PSL is available
        netWhitelist: {},
        netWhitelistModifyTime: 0,
        netWhitelistDefault: whitelistDefault.join('\n'),

        localSettings: {
            blockedRequestCount: 0,
            allowedRequestCount: 0
        },
        localSettingsLastModified: 0,
        localSettingsLastSaved: 0,

        // Read-only
        systemSettings: {
            compiledMagic: 6,   // Increase when compiled format changes
            selfieMagic: 6      // Increase when selfie format changes
        },

        restoreBackupSettings: {
            lastRestoreFile: '',
            lastRestoreTime: 0,
            lastBackupFile: '',
            lastBackupTime: 0
        },

        commandShortcuts: new Map(),

        // Allows to fully customize uBO's assets, typically set through admin
        // settings. The content of 'assets.json' will also tell which filter
        // lists to enable by default when uBO is first installed.
        assetsBootstrapLocation: 'assets/assets.json',

        userFiltersPath: 'user-filters',
        pslAssetKey: 'public_suffix_list.dat',

        selectedFilterLists: [],
        availableFilterLists: {},

        selfieAfter: 17 * oneMinute,

        pageStores: new Map(),
        pageStoresToken: 0,

        storageQuota: vAPI.storage.QUOTA_BYTES,
        storageUsed: 0,

        noopFunc: function(){},

        apiErrorCount: 0,

        mouseEventRegister: {
            tabId: '',
            x: -1,
            y: -1,
            url: ''
        },

        epickerTarget: '',
        epickerZap: false,
        epickerEprom: null,

        scriptlets: {},
    };

})();

/******************************************************************************/

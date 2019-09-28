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

const µBlock = (( ) => { // jshint ignore:line

    const hiddenSettingsDefault = {
        allowGenericProceduralFilters: false,
        assetFetchTimeout: 30,
        autoCommentFilterTemplate: '{{date}} {{origin}}',
        autoUpdateAssetFetchPeriod: 120,
        autoUpdateDelayAfterLaunch: 180,
        autoUpdatePeriod: 7,
        blockingProfiles: '11111/#F00 11011/#C0F 11001/#00F 00001',
        cacheStorageAPI: 'unset',
        cacheStorageCompression: true,
        cacheControlForFirefox1376932: 'no-cache, no-store, must-revalidate',
        consoleLogLevel: 'unset',
        debugScriptlets: false,
        debugScriptletInjector: false,
        disableWebAssembly: false,
        extensionUpdateForceReload: false,
        ignoreRedirectFilters: false,
        ignoreScriptInjectFilters: false,
        filterAuthorMode: false,
        loggerPopupType: 'popup',
        manualUpdateAssetFetchPeriod: 500,
        popupFontSize: 'unset',
        requestJournalProcessPeriod: 1000,
        selfieAfter: 3,
        strictBlockingBypassDuration: 120,
        suspendTabsUntilReady: 'unset',
        updateAssetBypassBrowserCache: false,
        userResourcesLocation: 'unset',
    };

    return {
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
            ignoreGenericCosmeticFilters: vAPI.webextFlavor.soup.has('mobile'),
            largeMediaSize: 50,
            parseAllABPHideFilters: true,
            prefetchingDisabled: true,
            requestLogMaxEntries: 1000,
            showIconBadge: true,
            tooltipsDisabled: false,
            webrtcIPAddressHidden: false,
        },

        hiddenSettingsDefault: hiddenSettingsDefault,
        hiddenSettings: (( ) => {
            const out = Object.assign({}, hiddenSettingsDefault);
            const json = vAPI.localStorage.getItem('immediateHiddenSettings');
            if ( typeof json !== 'string' ) { return out; }
            try {
                const o = JSON.parse(json);
                if ( o instanceof Object ) {
                    for ( const k in o ) {
                        if ( out.hasOwnProperty(k) ) { out[k] = o[k]; }
                    }
                    self.log.verbosity = out.consoleLogLevel;
                    if ( typeof out.suspendTabsUntilReady === 'boolean' ) {
                        out.suspendTabsUntilReady = out.suspendTabsUntilReady
                            ? 'yes'
                            : 'unset';
                    }
                }
            }
            catch(ex) {
            }
            return out;
        })(),

        // Features detection.
        privacySettingsSupported: vAPI.browserSettings instanceof Object,
        cloudStorageSupported: vAPI.cloud instanceof Object,
        canFilterResponseData: typeof browser.webRequest.filterResponseData === 'function',
        canInjectScriptletsNow: vAPI.webextFlavor.soup.has('chromium'),

        // https://github.com/chrisaljoudi/uBlock/issues/180
        // Whitelist directives need to be loaded once the PSL is available
        netWhitelist: new Map(),
        netWhitelistModifyTime: 0,
        netWhitelistDefault: [
            'about-scheme',
            'chrome-extension-scheme',
            'chrome-scheme',
            'moz-extension-scheme',
            'opera-scheme',
            'vivaldi-scheme',
            'wyciwyg-scheme',   // Firefox's "What-You-Cache-Is-What-You-Get"
        ],

        localSettings: {
            blockedRequestCount: 0,
            allowedRequestCount: 0,
        },
        localSettingsLastModified: 0,
        localSettingsLastSaved: 0,

        // Read-only
        systemSettings: {
            compiledMagic: 21,  // Increase when compiled format changes
            selfieMagic: 22,    // Increase when selfie format changes
        },

        restoreBackupSettings: {
            lastRestoreFile: '',
            lastRestoreTime: 0,
            lastBackupFile: '',
            lastBackupTime: 0,
        },

        commandShortcuts: new Map(),

        // Allows to fully customize uBO's assets, typically set through admin
        // settings. The content of 'assets.json' will also tell which filter
        // lists to enable by default when uBO is first installed.
        assetsBootstrapLocation: undefined,

        userFiltersPath: 'user-filters',
        pslAssetKey: 'public_suffix_list.dat',

        selectedFilterLists: [],
        availableFilterLists: {},

        pageStores: new Map(),
        pageStoresToken: 0,

        storageQuota: vAPI.storage.QUOTA_BYTES,
        storageUsed: 0,

        noopFunc: function(){},

        apiErrorCount: 0,

        maybeGoodPopup: {
            tabId: 0,
            url: '',
        },

        epickerArgs: {
            eprom: null,
            mouse: false,
            target: '',
            zap: false,
        },

        scriptlets: {},

        cspNoInlineScript: "script-src 'unsafe-eval' * blob: data:",
        cspNoScripting: 'script-src http: https:',
        cspNoInlineFont: 'font-src *',

        liveBlockingProfiles: [],
        blockingProfileColorCache: new Map(),
    };

})();

/******************************************************************************/

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

import logger from './logger.js';
import { FilteringContext } from './filtering-context.js';

import {
    domainFromHostname,
    hostnameFromURI,
    originFromURI,
} from './uri-utils.js';

/******************************************************************************/

// Not all platforms may have properly declared vAPI.webextFlavor.

if ( vAPI.webextFlavor === undefined ) {
    vAPI.webextFlavor = { major: 0, soup: new Set([ 'ublock' ]) };
}

/******************************************************************************/

const hiddenSettingsDefault = {
    allowGenericProceduralFilters: false,
    assetFetchTimeout: 30,
    autoCommentFilterTemplate: '{{date}} {{origin}}',
    autoUpdateAssetFetchPeriod: 60,
    autoUpdateDelayAfterLaunch: 105,
    autoUpdatePeriod: 4,
    benchmarkDatasetURL: 'unset',
    blockingProfiles: '11111/#F00 11010/#C0F 11001/#00F 00001',
    cacheStorageAPI: 'unset',
    cacheStorageCompression: true,
    cacheControlForFirefox1376932: 'no-cache, no-store, must-revalidate',
    cloudStorageCompression: true,
    cnameIgnoreList: 'unset',
    cnameIgnore1stParty: true,
    cnameIgnoreExceptions: true,
    cnameIgnoreRootDocument: true,
    cnameMaxTTL: 120,
    cnameReplayFullURL: false,
    cnameUncloak: true,
    cnameUncloakProxied: false,
    consoleLogLevel: 'unset',
    debugScriptlets: false,
    debugScriptletInjector: false,
    disableWebAssembly: false,
    extensionUpdateForceReload: false,
    filterAuthorMode: false,
    filterOnHeaders: false,
    loggerPopupType: 'popup',
    manualUpdateAssetFetchPeriod: 500,
    modifyWebextFlavor: 'unset',
    popupFontSize: 'unset',
    popupPanelDisabledSections: 0,
    popupPanelLockedSections: 0,
    popupPanelHeightMode: 0,
    requestJournalProcessPeriod: 1000,
    selfieAfter: 2,
    strictBlockingBypassDuration: 120,
    uiPopupConfig: 'unset',
    uiStyles: 'unset',
    updateAssetBypassBrowserCache: false,
    userResourcesLocation: 'unset',
};

const userSettingsDefault = {
    advancedUserEnabled: false,
    alwaysDetachLogger: true,
    autoUpdate: true,
    cloudStorageEnabled: false,
    cnameUncloakEnabled: true,
    collapseBlocked: true,
    colorBlindFriendly: false,
    contextMenuEnabled: true,
    uiAccentCustom: false,
    uiAccentCustom0: '#aca0f7',
    uiTheme: 'auto',
    externalLists: '',
    firewallPaneMinimized: true,
    hyperlinkAuditingDisabled: true,
    ignoreGenericCosmeticFilters: vAPI.webextFlavor.soup.has('mobile'),
    importedLists: [],
    largeMediaSize: 50,
    parseAllABPHideFilters: true,
    popupPanelSections: 0b111,
    prefetchingDisabled: true,
    requestLogMaxEntries: 1000,
    showIconBadge: true,
    suspendUntilListsAreLoaded: vAPI.Net.canSuspend(),
    tooltipsDisabled: false,
    webrtcIPAddressHidden: false,
};

const dynamicFilteringDefault = [
    'behind-the-scene * * noop',
    'behind-the-scene * image noop',
    'behind-the-scene * 3p noop',
    'behind-the-scene * inline-script noop',
    'behind-the-scene * 1p-script noop',
    'behind-the-scene * 3p-script noop',
    'behind-the-scene * 3p-frame noop',
];

const hostnameSwitchesDefault = [
    'no-large-media: behind-the-scene false',
];
// https://github.com/LiCybora/NanoDefenderFirefox/issues/196
if ( vAPI.webextFlavor.soup.has('firefox') ) {
    hostnameSwitchesDefault.push('no-csp-reports: * true');
}

const µBlock = {  // jshint ignore:line
    userSettingsDefault: userSettingsDefault,
    userSettings: Object.assign({}, userSettingsDefault),

    hiddenSettingsDefault: hiddenSettingsDefault,
    hiddenSettingsAdmin: {},
    hiddenSettings: Object.assign({}, hiddenSettingsDefault),

    dynamicFilteringDefault,
    hostnameSwitchesDefault,

    noDashboard: false,

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
        'edge-scheme',
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
        compiledMagic: 46,  // Increase when compiled format changes
        selfieMagic: 46,    // Increase when selfie format changes
    },

    // https://github.com/uBlockOrigin/uBlock-issues/issues/759#issuecomment-546654501
    //   The assumption is that cache storage state reflects whether
    //   compiled or selfie assets are available or not. The properties
    //   below is to no longer rely on this assumption -- though it's still
    //   not clear how the assumption could be wrong, and it's still not
    //   clear whether relying on those properties will really solve the
    //   issue. It's just an attempt at hardening.
    compiledFormatChanged: false,
    selfieIsInvalid: false,

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
    badLists: new Map(),

    // https://github.com/uBlockOrigin/uBlock-issues/issues/974
    //   This can be used to defer filtering decision-making.
    readyToFilter: false,

    supportStats: {
        allReadyAfter: '',
        maxAssetCacheWait: '0 ms',
    },

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
    uiAccentStylesheet: '',
};

µBlock.domainFromHostname = domainFromHostname;
µBlock.hostnameFromURI = hostnameFromURI;

µBlock.FilteringContext = class extends FilteringContext {
    duplicate() {
        return (new µBlock.FilteringContext(this));
    }

    fromTabId(tabId) {
        const tabContext = µBlock.tabContextManager.mustLookup(tabId);
        this.tabOrigin = tabContext.origin;
        this.tabHostname = tabContext.rootHostname;
        this.tabDomain = tabContext.rootDomain;
        this.tabId = tabContext.tabId;
        return this;
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/459
    //   In case of a request for frame and if ever no context is specified,
    //   assume the origin of the context is the same as the request itself.
    fromWebrequestDetails(details) {
        const tabId = details.tabId;
        this.type = details.type;
        if ( this.itype === this.MAIN_FRAME && tabId > 0 ) {
            µBlock.tabContextManager.push(tabId, details.url);
        }
        this.fromTabId(tabId); // Must be called AFTER tab context management
        this.realm = '';
        this.id = details.requestId;
        this.setURL(details.url);
        this.aliasURL = details.aliasURL || undefined;
        if ( this.itype !== this.SUB_FRAME ) {
            this.docId = details.frameId;
            this.frameId = -1;
        } else {
            this.docId = details.parentFrameId;
            this.frameId = details.frameId;
        }
        if ( this.tabId > 0 ) {
            if ( this.docId === 0 ) {
                this.docOrigin = this.tabOrigin;
                this.docHostname = this.tabHostname;
                this.docDomain = this.tabDomain;
            } else if ( details.documentUrl !== undefined ) {
                this.setDocOriginFromURL(details.documentUrl);
            } else {
                const pageStore = µBlock.pageStoreFromTabId(this.tabId);
                const docStore = pageStore && pageStore.getFrameStore(this.docId);
                if ( docStore ) {
                    this.setDocOriginFromURL(docStore.rawURL);
                } else {
                    this.setDocOrigin(this.tabOrigin);
                }
            }
        } else if ( details.documentUrl !== undefined ) {
            const origin = originFromURI(
                µBlock.normalizeTabURL(0, details.documentUrl)
            );
            this.setDocOrigin(origin).setTabOrigin(origin);
        } else if ( this.docId === -1 || (this.itype & this.FRAME_ANY) !== 0 ) {
            const origin = originFromURI(this.url);
            this.setDocOrigin(origin).setTabOrigin(origin);
        } else {
            this.setDocOrigin(this.tabOrigin);
        }
        this.redirectURL = undefined;
        this.filter = undefined;
        return this;
    }

    getTabOrigin() {
        if ( this.tabOrigin === undefined ) {
            const tabContext = µBlock.tabContextManager.mustLookup(this.tabId);
            this.tabOrigin = tabContext.origin;
            this.tabHostname = tabContext.rootHostname;
            this.tabDomain = tabContext.rootDomain;
        }
        return super.getTabOrigin();
    }

    toLogger() {
        this.tstamp = Date.now();
        if ( this.domain === undefined ) {
            void this.getDomain();
        }
        if ( this.docDomain === undefined ) {
            void this.getDocDomain();
        }
        if ( this.tabDomain === undefined ) {
            void this.getTabDomain();
        }
        const filters = this.filter;
        // Many filters may have been applied to the current context
        if ( Array.isArray(filters) === false ) {
            return logger.writeOne(this);
        }
        for ( const filter of filters ) {
            this.filter = filter;
            logger.writeOne(this);
        }
    }
};

µBlock.filteringContext = new µBlock.FilteringContext();

self.µBlock = µBlock;

/******************************************************************************/

export default µBlock;

/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 Raymond Hill

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

/* global publicSuffixList */

'use strict';

/******************************************************************************/

// Load all: executed once.

µBlock.restart = (function() {

//quickProfiler.start('start.js');

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

vAPI.app.onShutdown = function() {
    µb.staticFilteringReverseLookup.shutdown();
    µb.assetUpdater.shutdown();
    µb.staticNetFilteringEngine.reset();
    µb.cosmeticFilteringEngine.reset();
    µb.sessionFirewall.reset();
    µb.permanentFirewall.reset();
    µb.permanentFirewall.reset();
    µb.sessionURLFiltering.reset();
    µb.permanentURLFiltering.reset();
};

/******************************************************************************/

// Final initialization steps after all needed assets are in memory.
// - Initialize internal state with maybe already existing tabs.
// - Schedule next update operation.

var onAllReady = function() {
    // https://github.com/chrisaljoudi/uBlock/issues/184
    // Check for updates not too far in the future.
    µb.assetUpdater.onStart.addEventListener(µb.updateStartHandler.bind(µb));
    µb.assetUpdater.onCompleted.addEventListener(µb.updateCompleteHandler.bind(µb));
    µb.assetUpdater.onAssetUpdated.addEventListener(µb.assetUpdatedHandler.bind(µb));
    µb.assets.onAssetCacheRemoved.addEventListener(µb.assetCacheRemovedHandler.bind(µb));

    // Important: remove barrier to remote fetching, this was useful only
    // for launch time.
    µb.assets.remoteFetchBarrier -= 1;

    vAPI.cloud.start([
        'tpFiltersPane',
        'myFiltersPane',
        'myRulesPane',
        'whitelistPane'
    ]);

    //quickProfiler.stop(0);

    vAPI.onLoadAllCompleted();
    µb.contextMenu.update(null);
    µb.firstInstall = false;
};

/******************************************************************************/

// Filtering engines dependencies:
// - PSL

var onPSLReady = function() {
    µb.loadFilterLists(onAllReady);
};

/******************************************************************************/

// To bring older versions up to date

var onVersionReady = function(lastVersion) {
    // Whitelist some key scopes by default
    if ( lastVersion.localeCompare('0.8.6.0') < 0 ) {
        µb.netWhitelist = µb.whitelistFromString(
            µb.stringFromWhitelist(µb.netWhitelist) +
            '\n' +
            µb.netWhitelistDefault
        );
        µb.saveWhitelist();
    }
    // https://github.com/gorhill/uBlock/issues/135#issuecomment-96677379
    // `about:loopconversation` is used by Firefox for its Hello service
    if ( lastVersion.localeCompare('0.9.5.2') < 0 ) {
        µb.netWhitelist = µb.whitelistFromString(
            µb.stringFromWhitelist(µb.netWhitelist) +
            '\n' +
            'loopconversation.about-scheme'
        );
        µb.saveWhitelist();
    }
    if ( lastVersion !== vAPI.app.version ) {
        vAPI.storage.set({ version: vAPI.app.version });
    }
};

/******************************************************************************/

var onSelfieReady = function(selfie) {
    if ( selfie === null || selfie.magic !== µb.systemSettings.selfieMagic ) {
        return false;
    }
    if ( publicSuffixList.fromSelfie(selfie.publicSuffixList) !== true ) {
        return false;
    }
    if ( selfie.redirectEngine === undefined ) {
        return false;
    }

    µb.remoteBlacklists = selfie.filterLists;
    µb.staticNetFilteringEngine.fromSelfie(selfie.staticNetFilteringEngine);
    µb.redirectEngine.fromSelfie(selfie.redirectEngine);
    µb.cosmeticFilteringEngine.fromSelfie(selfie.cosmeticFilteringEngine);
    return true;
};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/226
// Whitelist in memory.
// Whitelist parser needs PSL to be ready.
// gorhill 2014-12-15: not anymore

var onNetWhitelistReady = function(netWhitelistRaw) {
    µb.netWhitelist = µb.whitelistFromString(netWhitelistRaw);
    µb.netWhitelistModifyTime = Date.now();
};

/******************************************************************************/

// User settings are in memory

var onUserSettingsReady = function(fetched) {
    var userSettings = µb.userSettings;

    fromFetch(userSettings, fetched);

    // https://github.com/chrisaljoudi/uBlock/issues/426
    // Important: block remote fetching for when loading assets at launch
    // time.
    µb.assets.autoUpdate = userSettings.autoUpdate;
    µb.assets.autoUpdateDelay = µb.updateAssetsEvery;

    vAPI.browserSettings.set({
        'hyperlinkAuditing': !userSettings.hyperlinkAuditingDisabled,
        'prefetching': !userSettings.prefetchingDisabled,
        'webrtcIPAddress': !userSettings.webrtcIPAddressHidden
    });

    µb.permanentFirewall.fromString(fetched.dynamicFilteringString);
    µb.sessionFirewall.assign(µb.permanentFirewall);
    µb.permanentURLFiltering.fromString(fetched.urlFilteringString);
    µb.sessionURLFiltering.assign(µb.permanentURLFiltering);
    µb.hnSwitches.fromString(fetched.hostnameSwitchesString);

    // https://github.com/gorhill/uBlock/issues/1892
    // For first installation on a battery-powered device, disable generic
    // cosmetic filtering.
    if ( µb.firstInstall && vAPI.battery ) {
        userSettings.ignoreGenericCosmeticFilters = true;
    }

    // Remove obsolete setting
    delete userSettings.logRequests;
    vAPI.storage.remove('logRequests');
};

/******************************************************************************/

// Housekeeping, as per system setting changes

var onSystemSettingsReady = function(fetched) {
    var mustSaveSystemSettings = false;
    if ( fetched.compiledMagic !== µb.systemSettings.compiledMagic ) {
        µb.assets.purge(/^cache:\/\/compiled-/);
        mustSaveSystemSettings = true;
    }
    if ( fetched.selfieMagic !== µb.systemSettings.selfieMagic ) {
        mustSaveSystemSettings = true;
    }
    if ( mustSaveSystemSettings ) {
        fetched.selfie = null;
        µb.selfieManager.destroy();
        vAPI.storage.set(µb.systemSettings, µb.noopFunc);
    }
};

/******************************************************************************/

var onFirstFetchReady = function(fetched) {
    // https://github.com/gorhill/uBlock/issues/747
    µb.firstInstall = fetched.version === '0.0.0.0';

    // Order is important -- do not change:
    onSystemSettingsReady(fetched);
    fromFetch(µb.localSettings, fetched);
    onUserSettingsReady(fetched);
    fromFetch(µb.restoreBackupSettings, fetched);
    onNetWhitelistReady(fetched.netWhitelist);
    onVersionReady(fetched.version);

    // If we have a selfie, skip loading PSL, filters
    if ( onSelfieReady(fetched.selfie) ) {
        onAllReady();
        return;
    }

    µb.loadPublicSuffixList(onPSLReady);
};

/******************************************************************************/

var toFetch = function(from, fetched) {
    for ( var k in from ) {
        if ( from.hasOwnProperty(k) === false ) {
            continue;
        }
        fetched[k] = from[k];
    }
};

var fromFetch = function(to, fetched) {
    for ( var k in to ) {
        if ( to.hasOwnProperty(k) === false ) {
            continue;
        }
        if ( fetched.hasOwnProperty(k) === false ) {
            continue;
        }
        to[k] = fetched[k];
    }
};

/******************************************************************************/

var onAdminSettingsRestored = function() {
    // Forbid remote fetching of assets
    µb.assets.remoteFetchBarrier += 1;

    var fetchableProps = {
        'compiledMagic': '',
        'dynamicFilteringString': 'behind-the-scene * 3p noop\nbehind-the-scene * 3p-frame noop',
        'urlFilteringString': '',
        'hostnameSwitchesString': '',
        'lastRestoreFile': '',
        'lastRestoreTime': 0,
        'lastBackupFile': '',
        'lastBackupTime': 0,
        'netWhitelist': '',
        'selfie': null,
        'selfieMagic': '',
        'version': '0.0.0.0'
    };

    toFetch(µb.localSettings, fetchableProps);
    toFetch(µb.userSettings, fetchableProps);
    toFetch(µb.restoreBackupSettings, fetchableProps);

    vAPI.storage.get(fetchableProps, onFirstFetchReady);
};

/******************************************************************************/

return function() {
    // https://github.com/gorhill/uBlock/issues/531
    µb.restoreAdminSettings(onAdminSettingsRestored);
};

/******************************************************************************/

})();

/******************************************************************************/

µBlock.restart();

/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
    Copyright (C) 2014-2015 Raymond Hill

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

/* global publicSuffixList, vAPI, µBlock */

/******************************************************************************/

// Load all: executed once.

(function() {

//quickProfiler.start('start.js');

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

// Final initialization steps after all needed assets are in memory.
// - Initialize internal state with maybe already existing tabs.
// - Schedule next update operation.

var onAllReady = function() {
    // https://github.com/gorhill/uBlock/issues/184
    // Check for updates not too far in the future.
    µb.assetUpdater.onStart.addEventListener(µb.updateStartHandler.bind(µb));
    µb.assetUpdater.onCompleted.addEventListener(µb.updateCompleteHandler.bind(µb));
    µb.assetUpdater.onAssetUpdated.addEventListener(µb.assetUpdatedHandler.bind(µb));
    µb.assets.onAssetCacheRemoved.addEventListener(µb.assetCacheRemovedHandler.bind(µb));

    // Important: remove barrier to remote fetching, this was useful only
    // for launch time.
    µb.assets.allowRemoteFetch = true;

    //quickProfiler.stop(0);

    vAPI.onLoadAllCompleted();
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
    //console.log('start.js/onSelfieReady: selfie looks good');
    µb.remoteBlacklists = selfie.filterLists;
    µb.staticNetFilteringEngine.fromSelfie(selfie.staticNetFilteringEngine);
    µb.cosmeticFilteringEngine.fromSelfie(selfie.cosmeticFilteringEngine);
    return true;
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/226
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

    // https://github.com/gorhill/uBlock/issues/426
    // Important: block remote fetching for when loading assets at launch
    // time.
    µb.assets.allowRemoteFetch = false;
    µb.assets.autoUpdate = userSettings.autoUpdate;

    // https://github.com/gorhill/uBlock/issues/540
    // Disabling local mirroring for the time being
    userSettings.experimentalEnabled = false;
    µb.mirrors.toggle(false /* userSettings.experimentalEnabled */);

    µb.contextMenu.toggle(userSettings.contextMenuEnabled);
    µb.permanentFirewall.fromString(userSettings.dynamicFilteringString);
    µb.sessionFirewall.assign(µb.permanentFirewall);

    // Remove obsolete setting
    delete userSettings.logRequests;
    µb.XAL.keyvalRemoveOne('logRequests');
};

/******************************************************************************/

var onLocalSettingsReady = function(fetched) {
    fromFetch(µb.localSettings, fetched);
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
        fetched.selfie = null;
        µb.destroySelfie();
        mustSaveSystemSettings = true;
    }
    if ( mustSaveSystemSettings ) {
        vAPI.storage.set(µb.systemSettings, µb.noopFunc);
    }
};

/******************************************************************************/

var onFirstFetchReady = function(fetched) {

    // Order is important -- do not change:
    onSystemSettingsReady(fetched);
    onLocalSettingsReady(fetched);
    onUserSettingsReady(fetched);
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

var fetchableProps = {
    'compiledMagic': '',
    'netWhitelist': '',
    'selfie': null,
    'selfieMagic': '',
    'version': '0.0.0.0'
};

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

toFetch(µb.localSettings, fetchableProps);
toFetch(µb.userSettings, fetchableProps);

vAPI.storage.get(fetchableProps, onFirstFetchReady);

/******************************************************************************/

})();

/******************************************************************************/

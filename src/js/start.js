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

/* global vAPI, µBlock */

/******************************************************************************/

// Load all: executed once.

(function() {

quickProfiler.start('start.js');

/******************************************************************************/

// Final initialization steps after all needed assets are in memory.
// - Initialize internal state with maybe already existing tabs.
// - Schedule next update operation.

var onAllReady = function() {
    var µb = µBlock;

    // https://github.com/gorhill/uBlock/issues/184
    // Check for updates not too far in the future.
    µb.assetUpdater.onStart.addEventListener(µb.updateStartHandler.bind(µb));
    µb.assetUpdater.onCompleted.addEventListener(µb.updateCompleteHandler.bind(µb));
    µb.assetUpdater.onAssetUpdated.addEventListener(µb.assetUpdatedHandler.bind(µb));
    µb.assets.onAssetCacheRemoved.addEventListener(µb.assetCacheRemovedHandler.bind(µb));

    // Important: remove barrier to remote fetching, this was useful only
    // for launch time.
    µb.assets.allowRemoteFetch = true;

    quickProfiler.stop(0);

    vAPI.onLoadAllCompleted();
};

/******************************************************************************/

// To bring older versions up to date

var onVersionReady = function(bin) {
    var µb = µBlock;
    var lastVersion = bin.version || '0.0.0.0';

    // Whitelist some key scopes by default
    if ( lastVersion.localeCompare('0.8.6.0') < 0 ) {
        µb.netWhitelist = µb.whitelistFromString(
            µb.stringFromWhitelist(µb.netWhitelist) + 
            '\n' + 
            µb.netWhitelistDefault
        );
        µb.saveWhitelist();
    }

    vAPI.storage.set({ version: vAPI.app.version });
    onAllReady();
};

/******************************************************************************/

// Filter lists
// Whitelist

var countdown = 2;
var doCountdown = function() {
    countdown -= 1;
    if ( countdown !== 0 ) {
        return;
    }
    // Last step: do whatever is necessary when version changes
    vAPI.storage.get('version', onVersionReady);
};

/******************************************************************************/

// Filters are in memory.
// Filter engines need PSL to be ready.

var onFiltersReady = function() {
    doCountdown();
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/226
// Whitelist in memory.
// Whitelist parser needs PSL to be ready.
// gorhill 2014-12-15: not anymore

var onWhitelistReady = function() {
    doCountdown();
};

/******************************************************************************/

// Load order because dependencies:
// User settings -> PSL -> [filter lists]

var onPSLReady = function() {
    µBlock.loadFilterLists(onFiltersReady);
};

/******************************************************************************/

// If no selfie available, take the long way, i.e. load and parse
// raw data.

var onSelfieReady = function(success) {
    if ( success === true ) {
        onFiltersReady();
        return;
    }
    µBlock.loadPublicSuffixList(onPSLReady);
};

/******************************************************************************/

// User settings are in memory

var onUserSettingsReady = function(userSettings) {
    var µb = µBlock;

    // https://github.com/gorhill/uBlock/issues/426
    // Important: block remote fetching for when loading assets at launch
    // time.
    µb.assets.allowRemoteFetch = false;
    µb.assets.autoUpdate = userSettings.autoUpdate;
    µb.fromSelfie(onSelfieReady);

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

// Housekeeping, as per system setting changes

var onSystemSettingsReady = function(system) {
    var µb = µBlock;

    var mustSaveSystemSettings = false;
    if ( system.compiledMagic !== µb.systemSettings.compiledMagic ) {
        µb.assets.purge(/^cache:\/\/compiled-/);
        mustSaveSystemSettings = true;
    }
    if ( system.selfieMagic !== µb.systemSettings.selfieMagic ) {
        µb.destroySelfie();
        mustSaveSystemSettings = true;
    }
    if ( mustSaveSystemSettings ) {
        µb.saveSystemSettings();
    }

    µb.loadUserSettings(onUserSettingsReady);
    µb.loadWhitelist(onWhitelistReady);
    µb.loadLocalSettings();
};

/******************************************************************************/

µBlock.loadSystemSettings(onSystemSettingsReady);

/******************************************************************************/

})();

/******************************************************************************/

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

// Load all: executed once.

µBlock.restart = (function() {

/******************************************************************************/

const µb = µBlock;

/******************************************************************************/

vAPI.app.onShutdown = function() {
    µb.staticFilteringReverseLookup.shutdown();
    µb.assets.updateStop();
    µb.staticNetFilteringEngine.reset();
    µb.staticExtFilteringEngine.reset();
    µb.sessionFirewall.reset();
    µb.permanentFirewall.reset();
    µb.sessionURLFiltering.reset();
    µb.permanentURLFiltering.reset();
    µb.sessionSwitches.reset();
    µb.permanentSwitches.reset();
};

/******************************************************************************/

// Final initialization steps after all needed assets are in memory.
// - Initialize internal state with maybe already existing tabs.
// - Schedule next update operation.

var onAllReady = function() {
    µb.webRequest.start();
    initializeTabs();

    // https://github.com/chrisaljoudi/uBlock/issues/184
    // Check for updates not too far in the future.
    µb.assets.addObserver(µb.assetObserver.bind(µb));
    µb.scheduleAssetUpdater(µb.userSettings.autoUpdate ? 7 * 60 * 1000 : 0);

    // vAPI.cloud is optional.
    if ( µb.cloudStorageSupported ) {
        vAPI.cloud.start([
            'tpFiltersPane',
            'myFiltersPane',
            'myRulesPane',
            'whitelistPane'
        ]);
    }

    µb.contextMenu.update(null);
    µb.firstInstall = false;
};

/******************************************************************************/

// This is called only once, when everything has been loaded in memory after
// the extension was launched. It can be used to inject content scripts
// in already opened web pages, to remove whatever nuisance could make it to
// the web pages before uBlock was ready.

let initializeTabs = function() {
    let handleScriptResponse = function(tabId, results) {
        if (
            Array.isArray(results) === false ||
            results.length === 0 ||
            results[0] !== true
        ) {
            return;
        }
        // Inject dclarative content scripts programmatically.
        let manifest = chrome.runtime.getManifest();
        if ( manifest instanceof Object === false ) { return; }
        for ( let contentScript of manifest.content_scripts ) {
            for ( let file of contentScript.js ) {
                vAPI.tabs.injectScript(tabId, {
                    file: file,
                    allFrames: contentScript.all_frames,
                    runAt: contentScript.run_at
                });
            }
        }
    };
    let bindToTabs = function(tabs) {
        for ( let tab of tabs  ) {
            µb.tabContextManager.commit(tab.id, tab.url);
            µb.bindTabToPageStats(tab.id);
            // https://github.com/chrisaljoudi/uBlock/issues/129
            //   Find out whether content scripts need to be injected
            //   programmatically. This may be necessary for web pages which
            //   were loaded before uBO launched.
            if ( /^https?:\/\//.test(tab.url) === false ) { continue; }
            vAPI.tabs.injectScript(
                tab.id,
                { file: 'js/scriptlets/should-inject-contentscript.js' },
                handleScriptResponse.bind(null, tab.id)
            );
        }
    };

    browser.tabs.query({ url: '<all_urls>' }, bindToTabs);
};

/******************************************************************************/

// Filtering engines dependencies:
// - PSL

var onPSLReady = function() {
    µb.selfieManager.load(function(valid) {
        if ( valid === true ) {
            return onAllReady();
        }
        µb.loadFilterLists(onAllReady);
    });
};

/******************************************************************************/

var onCommandShortcutsReady = function(commandShortcuts) {
    if ( Array.isArray(commandShortcuts) === false ) { return; }
    µb.commandShortcuts = new Map(commandShortcuts);
    if ( µb.canUpdateShortcuts === false ) { return; }
    for ( let entry of commandShortcuts ) {
        vAPI.commands.update({ name: entry[0], shortcut: entry[1] });
    }
};

/******************************************************************************/

// To bring older versions up to date

var onVersionReady = function(lastVersion) {
    if ( lastVersion === vAPI.app.version ) { return; }

    // Since AMO does not allow updating resources.txt, force a reload when a
    // new version is detected, as resources.txt may have changed since last
    // release. This will be done only for release versions of Firefox.
    if (
        vAPI.webextFlavor.soup.has('firefox') &&
        vAPI.webextFlavor.soup.has('devbuild') === false
    ) {
        µb.redirectEngine.invalidateResourcesSelfie();
    }

    // If unused, just comment out for when we need to compare versions in the
    // future.
    let intFromVersion = function(s) {
        let parts = s.match(/(?:^|\.|b|rc)\d+/g);
        if ( parts === null ) { return 0; }
        let vint = 0;
        for ( let i = 0; i < 4; i++ ) {
            let pstr = parts[i] || '';
            let pint;
            if ( pstr === '' ) {
                pint = 0;
            } else if ( pstr.startsWith('.') || pstr.startsWith('b') ) {
                pint = parseInt(pstr.slice(1), 10);
            } else if ( pstr.startsWith('rc') ) {
                pint = parseInt(pstr.slice(2), 10) + 100;
            } else {
                pint = parseInt(pstr, 10);
            }
            vint = vint * 1000 + pint;
        }
        return vint;
    };

    let lastVersionInt = intFromVersion(lastVersion);

    if ( lastVersionInt <= 1016021007 ) {
        µb.sessionSwitches.toggle('no-scripting', 'behind-the-scene', 2);
        µb.permanentSwitches.toggle('no-scripting', 'behind-the-scene', 2);
        µb.saveHostnameSwitches();
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/212#issuecomment-419741324
    if ( lastVersionInt <= 1015024000 ) {
        if ( µb.hiddenSettings.manualUpdateAssetFetchPeriod === 2000 ) {
            µb.hiddenSettings.manualUpdateAssetFetchPeriod = 500;
            µb.saveHiddenSettings();
        }
    }

    vAPI.storage.set({ version: vAPI.app.version });
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

    if ( µb.privacySettingsSupported ) {
        vAPI.browserSettings.set({
            'hyperlinkAuditing': !userSettings.hyperlinkAuditingDisabled,
            'prefetching': !userSettings.prefetchingDisabled,
            'webrtcIPAddress': !userSettings.webrtcIPAddressHidden
        });
    }

    µb.permanentFirewall.fromString(fetched.dynamicFilteringString);
    µb.sessionFirewall.assign(µb.permanentFirewall);
    µb.permanentURLFiltering.fromString(fetched.urlFilteringString);
    µb.sessionURLFiltering.assign(µb.permanentURLFiltering);
    µb.permanentSwitches.fromString(fetched.hostnameSwitchesString);
    µb.sessionSwitches.assign(µb.permanentSwitches);

    // https://github.com/gorhill/uBlock/issues/1892
    // For first installation on a battery-powered device, disable generic
    // cosmetic filtering.
    if ( µb.firstInstall && vAPI.webextFlavor.soup.has('mobile') ) {
        userSettings.ignoreGenericCosmeticFilters = true;
    }
};

/******************************************************************************/

// Housekeeping, as per system setting changes

var onSystemSettingsReady = function(fetched) {
    var mustSaveSystemSettings = false;
    if ( fetched.compiledMagic !== µb.systemSettings.compiledMagic ) {
        µb.assets.remove(/^compiled\//);
        mustSaveSystemSettings = true;
    }
    if ( fetched.selfieMagic !== µb.systemSettings.selfieMagic ) {
        mustSaveSystemSettings = true;
    }
    if ( mustSaveSystemSettings ) {
        fetched.selfie = null;
        µb.selfieManager.destroy();
        vAPI.storage.set(µb.systemSettings);
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
    onCommandShortcutsReady(fetched.commandShortcuts);

    Promise.all([
        µb.loadPublicSuffixList(),
        µb.staticNetFilteringEngine.readyToUse()
    ]).then(( ) => {
        onPSLReady();
    });
    µb.loadRedirectResources();
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

var onSelectedFilterListsLoaded = function() {
    var fetchableProps = {
        'commandShortcuts': [],
        'compiledMagic': 0,
        'dynamicFilteringString': [
            'behind-the-scene * * noop',
            'behind-the-scene * image noop',
            'behind-the-scene * 3p noop',
            'behind-the-scene * inline-script noop',
            'behind-the-scene * 1p-script noop',
            'behind-the-scene * 3p-script noop',
            'behind-the-scene * 3p-frame noop'
        ].join('\n'),
        'urlFilteringString': '',
        'hostnameSwitchesString': [
            'no-large-media: behind-the-scene false',
            'no-scripting: behind-the-scene false'
        ].join('\n'),
        'lastRestoreFile': '',
        'lastRestoreTime': 0,
        'lastBackupFile': '',
        'lastBackupTime': 0,
        'netWhitelist': µb.netWhitelistDefault,
        'selfieMagic': 0,
        'version': '0.0.0.0'
    };

    toFetch(µb.localSettings, fetchableProps);
    toFetch(µb.userSettings, fetchableProps);
    toFetch(µb.restoreBackupSettings, fetchableProps);

    vAPI.storage.get(fetchableProps, onFirstFetchReady);
};

/******************************************************************************/

// TODO(seamless migration):
// Eventually selected filter list keys will be loaded as a fetchable
// property. Until then we need to handle backward and forward
// compatibility, this means a special asynchronous call to load selected
// filter lists.

var onAdminSettingsRestored = function() {
    µb.loadSelectedFilterLists(onSelectedFilterListsLoaded);
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

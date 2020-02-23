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

(async ( ) => {
// >>>>> start of private scope

const µb = µBlock;

/******************************************************************************/

vAPI.app.onShutdown = function() {
    const µb = µBlock;
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

// This is called only once, when everything has been loaded in memory after
// the extension was launched. It can be used to inject content scripts
// in already opened web pages, to remove whatever nuisance could make it to
// the web pages before uBlock was ready.

const initializeTabs = async function() {
    const manifest = browser.runtime.getManifest();
    if ( manifest instanceof Object === false ) { return; }

    const tabs = await vAPI.tabs.query({ url: '<all_urls>' });
    const toCheck = [];
    const checker = {
        file: 'js/scriptlets/should-inject-contentscript.js'
    };
    for ( const tab of tabs  ) {
        µb.tabContextManager.commit(tab.id, tab.url);
        µb.bindTabToPageStats(tab.id);
        // https://github.com/chrisaljoudi/uBlock/issues/129
        //   Find out whether content scripts need to be injected
        //   programmatically. This may be necessary for web pages which
        //   were loaded before uBO launched.
        toCheck.push(
            /^https?:\/\//.test(tab.url)
                ? vAPI.tabs.executeScript(tab.id, checker)
                : false
        );
    }
    const results = await Promise.all(toCheck);
    for ( let i = 0; i < results.length; i++ ) {
        const result = results[i];
        if ( result.length === 0 || result[0] !== true ) { continue; }
        // Inject dclarative content scripts programmatically.
        const tabId = tabs[i].id;
        for ( const contentScript of manifest.content_scripts ) {
            for ( const file of contentScript.js ) {
                vAPI.tabs.executeScript(tabId, {
                    file: file,
                    allFrames: contentScript.all_frames,
                    runAt: contentScript.run_at
                });
            }
        }
    }
};

/******************************************************************************/

const onCommandShortcutsReady = function(commandShortcuts) {
    if ( Array.isArray(commandShortcuts) === false ) { return; }
    µb.commandShortcuts = new Map(commandShortcuts);
    if ( µb.canUpdateShortcuts === false ) { return; }
    for ( const entry of commandShortcuts ) {
        vAPI.commands.update({ name: entry[0], shortcut: entry[1] });
    }
};

/******************************************************************************/

// To bring older versions up to date

const onVersionReady = function(lastVersion) {
    if ( lastVersion === vAPI.app.version ) { return; }

    // Since built-in resources may have changed since last version, we
    // force a reload of all resources.
    µb.redirectEngine.invalidateResourcesSelfie();

    const lastVersionInt = vAPI.app.intFromVersion(lastVersion);

    // https://github.com/uBlockOrigin/uBlock-issues/issues/494
    //   Remove useless per-site switches.
    if ( lastVersionInt <= 1019003007 ) {
        µb.sessionSwitches.toggle('no-scripting', 'behind-the-scene', 0);
        µb.permanentSwitches.toggle('no-scripting', 'behind-the-scene', 0);
        µb.saveHostnameSwitches();
    }

    vAPI.storage.set({ version: vAPI.app.version });
};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/226
// Whitelist in memory.
// Whitelist parser needs PSL to be ready.
// gorhill 2014-12-15: not anymore

const onNetWhitelistReady = function(netWhitelistRaw) {
    if ( typeof netWhitelistRaw === 'string' ) {
        netWhitelistRaw = netWhitelistRaw.split('\n');
    }
    µb.netWhitelist = µb.whitelistFromArray(netWhitelistRaw);
    µb.netWhitelistModifyTime = Date.now();
};

/******************************************************************************/

// User settings are in memory

const onUserSettingsReady = function(fetched) {
    const userSettings = µb.userSettings;

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
};

/******************************************************************************/

// https://bugzilla.mozilla.org/show_bug.cgi?id=1588916
//   Save magic format numbers into the cache storage itself.

const onCacheSettingsReady = function(fetched) {
    if ( fetched.compiledMagic !== µb.systemSettings.compiledMagic ) {
        µb.assets.remove(/^compiled\//);
        µb.compiledFormatChanged = true;
        µb.selfieIsInvalid = true;
    }
    if ( fetched.selfieMagic !== µb.systemSettings.selfieMagic ) {
        µb.selfieIsInvalid = true;
    }
    if ( µb.selfieIsInvalid ) {
        µb.selfieManager.destroy();
        µb.cacheStorage.set(µb.systemSettings);
    }
};

/******************************************************************************/

const onFirstFetchReady = function(fetched) {
    // https://github.com/uBlockOrigin/uBlock-issues/issues/507
    //   Firefox-specific: somehow `fetched` is undefined under certain
    //   circumstances even though we asked to load with default values.
    if ( fetched instanceof Object === false ) {
        fetched = createDefaultProps();
    }

    // Order is important -- do not change:
    fromFetch(µb.localSettings, fetched);
    onUserSettingsReady(fetched);
    fromFetch(µb.restoreBackupSettings, fetched);
    onNetWhitelistReady(fetched.netWhitelist);
    onVersionReady(fetched.version);
    onCommandShortcutsReady(fetched.commandShortcuts);
};

/******************************************************************************/

const toFetch = function(from, fetched) {
    for ( const k in from ) {
        if ( from.hasOwnProperty(k) === false ) { continue; }
        fetched[k] = from[k];
    }
};

const fromFetch = function(to, fetched) {
    for ( const k in to ) {
        if ( to.hasOwnProperty(k) === false ) { continue; }
        if ( fetched.hasOwnProperty(k) === false ) { continue; }
        to[k] = fetched[k];
    }
};

const createDefaultProps = function() {
    const fetchableProps = {
        'commandShortcuts': [],
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
        ].join('\n'),
        'lastRestoreFile': '',
        'lastRestoreTime': 0,
        'lastBackupFile': '',
        'lastBackupTime': 0,
        'netWhitelist': µb.netWhitelistDefault,
        'version': '0.0.0.0'
    };
    toFetch(µb.localSettings, fetchableProps);
    toFetch(µb.userSettings, fetchableProps);
    toFetch(µb.restoreBackupSettings, fetchableProps);
    return fetchableProps;
};

/******************************************************************************/

try {
    // https://github.com/gorhill/uBlock/issues/531
    await µb.restoreAdminSettings();
    log.info(`Admin settings ready ${Date.now()-vAPI.T0} ms after launch`);

    await µb.loadHiddenSettings();
    log.info(`Hidden settings ready ${Date.now()-vAPI.T0} ms after launch`);

    // By default network requests are always suspended, so we must
    // unsuspend immediately if commanded by platform + advanced settings.
    if (
        vAPI.net.canSuspend() &&
            µb.hiddenSettings.suspendTabsUntilReady === 'no' ||
        vAPI.net.canSuspend() !== true &&
            µb.hiddenSettings.suspendTabsUntilReady !== 'yes'
    ) {
        vAPI.net.unsuspend(true);
    }

    if ( µb.hiddenSettings.disableWebAssembly !== true ) {
        µb.staticNetFilteringEngine.enableWASM().then(( ) => {
            log.info(`WASM modules ready ${Date.now()-vAPI.T0} ms after launch`);
        });
    }

    const cacheBackend = await µb.cacheStorage.select(
        µb.hiddenSettings.cacheStorageAPI
    );
    log.info(`Backend storage for cache will be ${cacheBackend}`);

    await Promise.all([
        µb.loadSelectedFilterLists().then(( ) => {
            log.info(`List selection ready ${Date.now()-vAPI.T0} ms after launch`);
        }),
        µb.cacheStorage.get(
            { compiledMagic: 0, selfieMagic: 0 }
        ).then(fetched => {
            log.info(`Cache magic numbers ready ${Date.now()-vAPI.T0} ms after launch`);
            onCacheSettingsReady(fetched);
        }),
        vAPI.storage.get(createDefaultProps()).then(fetched => {
            log.info(`First fetch ready ${Date.now()-vAPI.T0} ms after launch`);
            onFirstFetchReady(fetched);
        }),
        µb.loadPublicSuffixList().then(( ) => {
            log.info(`PSL ready ${Date.now()-vAPI.T0} ms after launch`);
        }),
    ]);
} catch (ex) {
    console.trace(ex);
}

// Prime the filtering engines before first use.
µb.staticNetFilteringEngine.prime();

// https://github.com/uBlockOrigin/uBlock-issues/issues/817#issuecomment-565730122
//   Still try to load filter lists regardless of whether a serious error
//   occurred in the previous initialization steps.
let selfieIsValid = false;
try {
    selfieIsValid = await µb.selfieManager.load();
    if ( selfieIsValid === true ) {
        log.info(`Selfie ready ${Date.now()-vAPI.T0} ms after launch`);
    }
} catch (ex) {
    console.trace(ex);
}
if ( selfieIsValid !== true ) {
    try {
        await µb.loadFilterLists();
        log.info(`Filter lists ready ${Date.now()-vAPI.T0} ms after launch`);
    } catch (ex) {
        console.trace(ex);
    }
}

// Final initialization steps after all needed assets are in memory.

// Start network observers.
µb.webRequest.start();

// Ensure that the resources allocated for decompression purpose (likely
// large buffers) are garbage-collectable immediately after launch.
// Otherwise I have observed that it may take quite a while before the
// garbage collection of these resources kicks in. Relinquishing as soon
// as possible ensure minimal memory usage baseline.
µb.lz4Codec.relinquish();

// Initialize internal state with maybe already existing tabs.
initializeTabs();

// https://github.com/chrisaljoudi/uBlock/issues/184
//   Check for updates not too far in the future.
µb.assets.addObserver(µb.assetObserver.bind(µb));
µb.scheduleAssetUpdater(
    µb.userSettings.autoUpdate
        ? µb.hiddenSettings.autoUpdateDelayAfterLaunch * 1000
        : 0
);

// Force an update of the context menu according to the currently
// active tab.
µb.contextMenu.update();

// Maybe install non-default popup document, or automatically select
// default UI according to platform.
if (
    browser.browserAction instanceof Object &&
    browser.browserAction.setPopup instanceof Function
) {
    let uiFlavor = µb.hiddenSettings.uiFlavor;
    if ( uiFlavor === 'unset' && vAPI.webextFlavor.soup.has('mobile') ) {
        uiFlavor = 'fenix';
    }
    if ( uiFlavor !== 'unset' && /\w+/.test(uiFlavor) ) {
        browser.browserAction.setPopup({
            popup: vAPI.getURL(`popup-${uiFlavor}.html`)
        });
    }
}

// https://github.com/uBlockOrigin/uBlock-issues/issues/717
//   Prevent the extension from being restarted mid-session.
browser.runtime.onUpdateAvailable.addListener(details => {
    const toInt = vAPI.app.intFromVersion;
    if (
        µBlock.hiddenSettings.extensionUpdateForceReload === true ||
        toInt(details.version) <= toInt(vAPI.app.version)
    ) {
        vAPI.app.restart();
    }
});

log.info(`All ready ${Date.now()-vAPI.T0} ms after launch`);

// <<<<< end of private scope
})();

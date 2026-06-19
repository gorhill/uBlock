/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2022-present Raymond Hill

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

import * as scrmgr from './scripting-manager.js';

import {
    MODE_BASIC,
    MODE_OPTIMAL,
    defaultFilteringModes,
    getDefaultFilteringMode,
    getFilteringMode,
    getFilteringModeDetails,
    persistHostPermissions,
    setDefaultFilteringMode,
    setFilteringMode,
    setFilteringModeDetails,
    syncWithBrowserPermissions,
} from './mode-manager.js';

import {
    addCustomFilters,
    customFiltersFromHostname,
    getAllCustomFilters,
    getSandboxFilters,
    hasCustomFilters,
    injectCustomFilters,
    removeAllCustomFilters,
    removeCustomFilters,
    setSandboxFilters,
    startCustomFilters,
    terminateCustomFilters,
} from './filter-manager.js';

import {
    addImportedList,
    getImportedLists,
    removeImportedLists,
} from './imported-lists.js';

import {
    adminReadEx,
    getAdminRulesets,
    loadAdminConfig,
} from './admin.js';

import {
    broadcastMessage,
    hostnameFromMatch,
    hostnamesFromMatches,
    intFromVersion,
} from './utils.js';

import {
    browser,
    localRead, localRemove, localWrite,
    runtime,
    sessionAccessLevel,
    supportsUserScripts,
    webextFlavor,
} from './ext.js';

import {
    defaultConfig,
    loadRulesetConfig,
    process,
    rulesetConfig,
    saveRulesetConfig,
} from './config.js';

import {
    enableRulesets,
    excludeFromStrictBlock,
    getDefaultRulesetsFromEnv,
    getEffectiveUserRules,
    getEnabledRulesets,
    getEnabledRulesetsDetails,
    getRulesetDetails,
    patchDefaultRulesets,
    setStrictBlockMode,
    updateDynamicAndSessionRules,
    updateSessionRules,
    updateUserRules,
} from './ruleset-manager.js';

import {
    getConsoleOutput,
    getMatchedRules,
    isSideloaded,
    toggleDeveloperMode,
    ubolErr,
    ubolLog,
} from './debug.js';

import {
    gotoURL,
    hasBroadHostPermissions,
} from './ext-utils.js';

import { dnr } from './ext-compat.js';
import { registerCompiledFilters } from './compiled-filters.js';
import { setPopupBlockMode } from './prevent-popup.js';
import { toggleToolbarIcon } from './action.js';

/******************************************************************************/

const UBOL_ORIGIN = runtime.getURL('').replace(/\/$/, '').toLowerCase();
const canShowBlockedCount = typeof dnr.setExtensionActionOptions === 'function';
const { registerContentScripts } = scrmgr;

let pendingPermissionRequest;

/******************************************************************************/

function getCurrentVersion() {
    return runtime.getManifest().version;
}

/******************************************************************************/

async function reloadTab(tabId, url = '') {
    return new Promise(resolve => {
        self.setTimeout(( ) => {
            if ( url !== '' ) {
                browser.tabs.update(tabId, { url });
            } else {
                browser.tabs.reload(tabId);
            }
            resolve();
        }, 437);
    });
}

// When a new host permission is granted through the popup panel
async function onPermissionGrantedThruExtension(details, origins) {
    await persistHostPermissions();
    const defaultMode = await getDefaultFilteringMode();
    if ( defaultMode >= MODE_OPTIMAL ) { return; }
    if ( Array.isArray(origins) === false ) { return; }
    const hostnames = hostnamesFromMatches(origins);
    if ( hostnames.includes(details.hostname) === false ) { return; }
    const beforeLevel = await getFilteringMode(details.hostname);
    if ( beforeLevel === details.afterLevel ) { return; }
    const afterLevel = await setFilteringMode(details.hostname, details.afterLevel);
    if ( afterLevel !== details.afterLevel ) { return; }
    await registerContentScripts();
    if ( rulesetConfig.autoReload !== true ) { return; }
    await reloadTab(details.tabId, details.url);
}

// When a new host permission is granted through the browser
async function onPermissionGrantedThruBrowser(origins) {
    const modified = await syncWithBrowserPermissions();
    if ( modified === false ) { return; }
    await registerContentScripts();
    if ( rulesetConfig.autoReload !== true ) { return; }
    if ( origins.length !== 1 ) { return; }
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs?.[0]?.id;
    if ( typeof tabId !== 'number' || tabId === -1 ) { return; }
    const results = await browser.scripting.executeScript({
        target: { tabId, frameIds: [ 0 ] },
        func: ( ) => document.location.hostname,
    }).catch(( ) => {
    });
    const tabHostname = results?.[0]?.result;
    if ( typeof tabHostname !== 'string' ) { return; }
    const hostname = hostnameFromMatch(origins[0]);
    if ( tabHostname.endsWith(hostname) === false ) { return; }
    const pos = tabHostname.length - hostname.length;
    if ( pos !== 0 && tabHostname.charAt(pos-1) !== '.' ) { return; }
    await reloadTab(tabId);
}

// https://github.com/uBlockOrigin/uBOL-home/issues/280
async function onPermissionsAdded(permissions) {
    const details = pendingPermissionRequest;
    pendingPermissionRequest = undefined;
    const { origins = [] } = permissions;
    return details !== undefined
        ? onPermissionGrantedThruExtension(details, origins)
        : onPermissionGrantedThruBrowser(origins);
}

async function onPermissionsRemoved() {
    const modified = await syncWithBrowserPermissions();
    if ( modified === false ) { return false; }
    registerContentScripts();
    return true;
}

async function onPermissionsChanged(op, permissions) {
    await isFullyInitialized;
    const { pending } = onPermissionsChanged;
    await Promise.all(pending);
    const promise = op === 'removed'
        ? onPermissionsRemoved()
        : onPermissionsAdded(permissions);
    pending.push(promise);
}
onPermissionsChanged.pending = [];

/******************************************************************************/

async function registerDeclarativeAssets(
    contentScripts = true,
    userScripts = true,
    userRules = true
) {
    const [ shouldUpdateUserRules ] = await Promise.all([
        userScripts ? registerCompiledFilters() : false,
        contentScripts ? registerContentScripts() : false,
    ]);
    if ( userRules && shouldUpdateUserRules ) {
        await updateUserRules();
    }
}

/******************************************************************************/

async function applyRulesets(rulesets) {
    const result = await enableRulesets(rulesets);
    const stockUpdated = result.stockUpdated ?? false;
    const importedUpdated = result.importedUpdated ?? false;
    if ( stockUpdated === false && importedUpdated === false ) { return; }
    rulesetConfig.enabledRulesets = result.enabledRulesets;
    await saveRulesetConfig();
    await registerDeclarativeAssets(stockUpdated, importedUpdated);
    broadcastMessage({ enabledRulesets: rulesetConfig.enabledRulesets });
}

/******************************************************************************/

async function setDeveloperMode(state) {
    rulesetConfig.developerMode = state === true;
    toggleDeveloperMode(rulesetConfig.developerMode);
    broadcastMessage({ developerMode: rulesetConfig.developerMode });
    await saveRulesetConfig();
    await registerDeclarativeAssets(false, true, true);
    await updateUserRules();
    return rulesetConfig.developerMode;
}

/******************************************************************************/

async function onMessage(request, sender) {

    const tabId = sender?.tab?.id ?? false;
    const frameId = tabId && (sender?.frameId ?? false);

    // Does not require extension to be fully initialized

    // Does not require a trusted origin.

    switch ( request.what ) {

    case 'insertCSS':
        if ( frameId === false ) { return false; }
        // https://bugs.webkit.org/show_bug.cgi?id=262491
        if ( frameId !== 0 && webextFlavor === 'safari' ) { return; }
        return browser.scripting.insertCSS({
            css: request.css,
            origin: 'USER',
            target: { tabId, frameIds: [ frameId ] },
        }).catch(reason => {
            ubolErr(`insertCSS/${reason}`);
        });

    case 'removeCSS':
        if ( frameId === false ) { return false; }
        // https://bugs.webkit.org/show_bug.cgi?id=262491
        if ( frameId !== 0 && webextFlavor === 'safari' ) { return; }
        return browser.scripting.removeCSS({
            css: request.css,
            origin: 'USER',
            target: { tabId, frameIds: [ frameId ] },
        }).catch(reason => {
            ubolErr(`removeCSS/${reason}`);
        });

    case 'injectCSSProceduralAPI':
        return browser.scripting.executeScript({
            files: [ '/js/scripting/css-procedural-api.js' ],
            target: { tabId, frameIds: [ frameId ] },
            injectImmediately: true,
        }).catch(reason => {
            ubolErr(`executeScript/${reason}`);
        });

    default:
        break;
    }

    // Requires extension to be fully initialized

    await isFullyInitialized;

    // Does not require a trusted origin.

    switch ( request.what ) {

    case 'toggleToolbarIcon': {
        if ( tabId ) {
            toggleToolbarIcon(tabId);
        }
        return;
    }

    case 'startCustomFilters':
        if ( frameId === false ) { return; }
        return startCustomFilters(tabId, frameId);

    case 'terminateCustomFilters':
        if ( frameId === false ) { return; }
        return terminateCustomFilters(tabId, frameId);

    case 'injectCustomFilters':
        if ( frameId === false ) { return; }
        return injectCustomFilters(tabId, frameId, request.hostname);

    default:
        break;
    }

    // Requires a trusted origin.

    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/MessageSender
    //   Firefox API does not set `sender.origin`
    const isTrustedOrigin = sender.origin === undefined ||
        sender.origin.toLowerCase() === UBOL_ORIGIN;
    if ( isTrustedOrigin === false ) { return; }

    switch ( request.what ) {

    case 'applyRulesets': {
        await applyRulesets(request.enabledRulesets);
        if ( request.toRemove ) {
            await removeImportedLists(request.toRemove);
        }
        return;
    }

    case 'getDefaultConfig': {
        const rulesets = await getDefaultRulesetsFromEnv();
        return {
            autoReload: defaultConfig.autoReload,
            developerMode: defaultConfig.developerMode,
            showBlockedCount: defaultConfig.showBlockedCount,
            strictBlockMode: defaultConfig.strictBlockMode,
            popupBlockMode: defaultConfig.popupBlockMode,
            rulesets,
            filteringModes: Object.assign(defaultFilteringModes),
        };
    }

    case 'getCurrentConfig':
        return rulesetConfig;

    case 'getOptionsPageData': {
        const [
            hasOmnipotence,
            defaultFilteringMode,
            rulesetDetails,
            enabledRulesets,
            adminRulesets,
            disabledFeatures,
        ] = await Promise.all([
            hasBroadHostPermissions(),
            getDefaultFilteringMode(),
            getRulesetDetails(),
            getEnabledRulesets(),
            getAdminRulesets(),
            adminReadEx('disabledFeatures'),
        ]);
        process.firstRun = false;
        return {
            hasOmnipotence,
            defaultFilteringMode,
            enabledRulesets,
            adminRulesets,
            maxNumberOfEnabledRulesets: dnr.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS,
            rulesetDetails: Array.from(rulesetDetails.values()),
            autoReload: rulesetConfig.autoReload,
            showBlockedCount: rulesetConfig.showBlockedCount,
            canShowBlockedCount,
            strictBlockMode: rulesetConfig.strictBlockMode,
            popupBlockMode: rulesetConfig.popupBlockMode,
            firstRun: process.firstRun,
            isSideloaded,
            developerMode: rulesetConfig.developerMode,
            disabledFeatures,
            supportsUserScripts,
        };
    }

    case 'getEnabledRulesets':
        return getEnabledRulesets();

    case 'getRulesetDetails': {
        const rulesetDetails = await getRulesetDetails();
        return Array.from(rulesetDetails.values());
    }

    case 'getEnabledRulesetsDetails':
        return getEnabledRulesetsDetails();

    case 'hasBroadHostPermissions':
        return hasBroadHostPermissions();

    case 'setAutoReload':
        rulesetConfig.autoReload = request.state && true || false;
        await saveRulesetConfig();
        broadcastMessage({ autoReload: rulesetConfig.autoReload });
        return;

    case 'setShowBlockedCount':
        rulesetConfig.showBlockedCount = request.state && true || false;
        if ( canShowBlockedCount ) {
            dnr.setExtensionActionOptions({
                displayActionCountAsBadgeText: rulesetConfig.showBlockedCount,
            });
        }
        await saveRulesetConfig();
        broadcastMessage({ showBlockedCount: rulesetConfig.showBlockedCount });
        return;

    case 'setStrictBlockMode':
        await setStrictBlockMode(request.state);
        broadcastMessage({ strictBlockMode: rulesetConfig.strictBlockMode });
        return;

    case 'setPopupBlockMode':
        await setPopupBlockMode(request.state);
        await registerContentScripts();
        broadcastMessage({ popupBlockMode: rulesetConfig.popupBlockMode });
        return;

    case 'setDeveloperMode':
        return setDeveloperMode(request.state);

    case 'popupPanelData': {
        const results = await Promise.all([
            hasBroadHostPermissions(),
            getFilteringMode(request.hostname),
            adminReadEx('disabledFeatures'),
            hasCustomFilters(request.hostname),
        ]);
        return {
            hasOmnipotence: results[0],
            level: results[1],
            autoReload: rulesetConfig.autoReload,
            isSideloaded,
            developerMode: rulesetConfig.developerMode,
            disabledFeatures: results[2],
            hasCustomFilters: results[3],
        };
    }

    case 'getFilteringMode': {
        return getFilteringMode(request.hostname);
    }

    case 'gotoURL':
        return gotoURL(request.url, request.type);

    case 'setFilteringMode': {
        const beforeLevel = await getFilteringMode(request.hostname);
        if ( request.level === beforeLevel ) { return beforeLevel; }
        const afterLevel = await setFilteringMode(request.hostname, request.level);
        await registerDeclarativeAssets();
        return afterLevel;
    }

    case 'setPendingFilteringMode':
        pendingPermissionRequest = request;
        return;

    case 'getDefaultFilteringMode': {
        return getDefaultFilteringMode();
    }

    case 'setDefaultFilteringMode': {
        const beforeLevel = await getDefaultFilteringMode();
        const afterLevel = await setDefaultFilteringMode(request.level);
        if ( afterLevel !== beforeLevel ) {
            await registerDeclarativeAssets();
        }
        return afterLevel;
    }

    case 'getFilteringModeDetails':
        return getFilteringModeDetails(true);

    case 'setFilteringModeDetails': {
        await setFilteringModeDetails(request.modes);
        await registerDeclarativeAssets();
        const defaultFilteringMode = await getDefaultFilteringMode();
        broadcastMessage({ defaultFilteringMode });
        return getFilteringModeDetails(true);
    }

    case 'excludeFromStrictBlock':
        return excludeFromStrictBlock(request.hostname, request.permanent);

    case 'getMatchedRules':
        return getMatchedRules(request.tabId);

    case 'showMatchedRules':
        browser.windows.create({
            type: 'popup',
            url: `/matched-rules.html?tab=${request.tabId}`,
        });
        return;

    case 'getAllDynamicRules':
        return dnr.getDynamicRules();

    case 'getAllSessionRules':
        return dnr.getSessionRules();

    case 'getEffectiveUserRules':
        return getEffectiveUserRules();

    case 'updateUserDnrRules':
        return updateUserRules();

    case 'getAllCustomFilters':
        return getAllCustomFilters();

    case 'addCustomFilters': {
        const modified = await addCustomFilters(request.hostname, request.selectors);
        if ( modified !== true ) { return; }
        return registerDeclarativeAssets();
    }

    case 'addManyCustomFilters': {
        const promises = [];
        for ( const [ hostname, selectors ] of request.entries ) {
            if ( typeof hostname !== 'string' ) { continue; }
            if ( hostname === '' ) { continue; }
            if ( Array.isArray(selectors) === false ) { continue; }
            if ( selectors.length === 0 ) { continue; }
            promises.push(addCustomFilters(hostname, selectors));
        }
        const results = await Promise.all(promises);
        if ( results.some(a => a) === false ) { return; }
        return registerDeclarativeAssets();
    }

    case 'removeCustomFilters': {
        const modified = await removeCustomFilters(request.hostname, request.selectors);
        if ( modified !== true ) { return; }
        return registerDeclarativeAssets();
    }

    case 'removeAllCustomFilters': {
        const modified = await removeAllCustomFilters(request.hostname);
        if ( modified !== true ) { return; }
        return registerDeclarativeAssets();
    }

    case 'getSandboxFilters':
        return getSandboxFilters();

    case 'setSandboxFilters': {
        await setSandboxFilters(request.text);
        return registerDeclarativeAssets(false);
    }

    case 'customFiltersFromHostname':
        return customFiltersFromHostname(request.hostname);

    case 'getRegisteredContentScripts':
        return scrmgr.getRegisteredContentScripts();

    case 'getConsoleOutput':
        return getConsoleOutput();

    case 'importFilterList': {
        const modified = await addImportedList(request.url);
        if ( modified !== true ) { break; }
        const rulesets = await getEnabledRulesets();
        rulesets.push(request.url);
        applyRulesets(rulesets);
        if ( modified ) {
            return registerDeclarativeAssets(false);
        }
        break;
    }

    case 'getImportedLists': {   
        return getImportedLists();
    }

    default:
        break;
    }
}

/******************************************************************************/

function onCommand(command, tab) {
    switch ( command ) {
    case 'enter-zapper-mode': {
        if ( browser.scripting === undefined ) { return; }
        browser.scripting.executeScript({
            files: [ '/js/scripting/tool-overlay.js', '/js/scripting/zapper.js' ],
            target: { tabId: tab.id },
        });
        break;
    }
    case 'enter-picker-mode': {
        if ( browser.scripting === undefined ) { return; }
        browser.scripting.executeScript({
            files: [
                '/js/scripting/css-procedural-api.js',
                '/js/scripting/tool-overlay.js',
                '/js/scripting/picker.js',
            ],
            target: { tabId: tab.id },
        });
        break;
    }
    default:
        break;
    }
}

/******************************************************************************/

async function startSession() {
    const currentVersion = getCurrentVersion();
    const isNewVersion = currentVersion !== rulesetConfig.version;

    // Admin settings override user settings
    await loadAdminConfig();

    // The default rulesets may have changed, find out new ruleset to enable,
    // obsolete ruleset to remove.
    if ( isNewVersion ) {
        const previousVersion = rulesetConfig.version;
        ubolLog(`Version change: ${rulesetConfig.version} => ${currentVersion}`);
        rulesetConfig.version = currentVersion;
        await patchDefaultRulesets();
        saveRulesetConfig();
        // https://github.com/uBlockOrigin/uBOL-home/issues/670
        if ( intFromVersion(previousVersion) <= intFromVersion('2026.423.0000') ) {
            const promises = [];
            const customFilters = await getAllCustomFilters();
            for ( const [ hostname, selectors ] of customFilters ) {
                let modified = false;
                for ( let i = 0; i < selectors.length; i++ ) {
                    const selector = selectors[i];
                    if ( selector.startsWith('0') === false ) { continue; }
                    selectors[i] = selector.slice(1);
                    modified = true;
                }
                if ( modified === false ) { continue; }
                promises.push(
                    removeAllCustomFilters(hostname).then(( ) =>
                        addCustomFilters(hostname, selectors)
                    )
                );
            }
            if ( promises.length !== 0 ) {
                await Promise.all(promises);
            }
        }
    }

    const {
        stockUpdated,
        importedUpdated,
        enabledRulesets,
    } = await enableRulesets(rulesetConfig.enabledRulesets);
    if ( stockUpdated || importedUpdated ) {
        rulesetConfig.enabledRulesets = enabledRulesets;
        await saveRulesetConfig();
    }

    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest#rulesets
    // "The set of enabled static rulesets is persisted across sessions but not across extension updates"
    // "[Dynamic] rules persist across sessions and extension updates"
    // "[Session] rules do not persist across browser sessions"
    if ( isNewVersion ) {
        updateDynamicAndSessionRules();
    } else {
        updateSessionRules();
    }

    // Permissions may have been removed while the extension was disabled
    const permissionsUpdated = await syncWithBrowserPermissions();

    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/RegisteredContentScript#persistacrosssessions
    // "When an extension updates, content scripts are cleared"
    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/userScripts#extension_updates
    // "User scripts are cleared when an extension updates"
    const shouldInject = isNewVersion || permissionsUpdated ||
        isSideloaded && rulesetConfig.developerMode;
    if ( shouldInject || stockUpdated || importedUpdated ) {
        await registerDeclarativeAssets(
            shouldInject || stockUpdated,
            shouldInject || importedUpdated,
            false
        );
        if ( importedUpdated ) {
            await updateUserRules();
        }
    }

    // Cosmetic filtering-related content scripts cache fitlering data in
    // session storage.
    sessionAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest
    //   Firefox API does not support `dnr.setExtensionActionOptions`
    if ( canShowBlockedCount ) {
        dnr.setExtensionActionOptions({
            displayActionCountAsBadgeText: rulesetConfig.showBlockedCount,
        });
    }

    // Switch to basic filtering if uBOL doesn't have broad permissions at
    // install time.
    if ( process.firstRun ) {
        const enableOptimal = await hasBroadHostPermissions();
        if ( enableOptimal === false ) {
            const afterLevel = await setDefaultFilteringMode(MODE_BASIC);
            if ( afterLevel === MODE_BASIC ) {
                await registerContentScripts();
                process.firstRun = false;
            }
        }
    }

    // Required to ensure up to date properties are available when needed
    adminReadEx('disabledFeatures').then(items => {
        if ( Array.isArray(items) === false ) { return; }
        if ( items.includes('develop') ) {
            if ( rulesetConfig.developerMode ) {
                setDeveloperMode(false);
            }
        }
    });
}

/******************************************************************************/

async function start() {
    await loadRulesetConfig();

    if ( process.wakeupRun === false ) {
        await startSession();
    } else {
        scrmgr.onWakeupRun();
    }

    const scripts = await scrmgr.getRegisteredContentScripts();
    if ( scripts.length === 0 ) {
        await registerContentScripts();
    }

    toggleDeveloperMode(rulesetConfig.developerMode);
}

/******************************************************************************/

// https://github.com/uBlockOrigin/uBOL-home/issues/199
// Force a restart of the extension once when an "internal error" occurs

const isFullyInitialized = start().then(( ) => {
    localRemove('goodStart');
    return false;
}).catch(reason => {
    ubolErr(reason);
    if ( process.wakeupRun ) { return; }
    return localRead('goodStart').then(goodStart => {
        if ( goodStart === false ) {
            localRemove('goodStart');
            return false;
        }
        return localWrite('goodStart', false).then(( ) => true);
    });
}).then(restart => {
    if ( restart !== true ) { return; }
    runtime.reload();
});

runtime.onMessage.addListener((request, sender, callback) => {
    if ( request.what.includes(':') ) { return; }
    onMessage(request, sender).then(callback);
    return true;
});

if ( supportsUserScripts && runtime.onUserScriptMessage ) {
    browser.userScripts.configureWorld({ messaging: true });
    runtime.onUserScriptMessage.addListener((request, sender, callback) => {
        onMessage(request, sender).then(callback);
        return true;
    });
}

browser.permissions.onRemoved.addListener((...args) => {
    isFullyInitialized.then(( ) => {
        onPermissionsChanged('removed', ...args);
    });
});

browser.permissions.onAdded.addListener((...args) => {
    isFullyInitialized.then(( ) => {
        onPermissionsChanged('added', ...args);
    });
});

browser.commands.onCommand.addListener((...args) => {
    isFullyInitialized.then(( ) => {
        onCommand(...args);
    });
});

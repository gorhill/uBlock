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

import {
    MODE_BASIC,
    MODE_OPTIMAL,
    defaultFilteringModes,
    getDefaultFilteringMode,
    getFilteringMode,
    getFilteringModeDetails,
    setDefaultFilteringMode,
    setFilteringMode,
    setFilteringModeDetails,
    syncWithBrowserPermissions,
} from './mode-manager.js';

import {
    addCustomFilters,
    customFiltersFromHostname,
    getAllCustomFilters,
    hasCustomFilters,
    injectCustomFilters,
    removeAllCustomFilters,
    removeCustomFilters,
    startCustomFilters,
    terminateCustomFilters,
} from './filter-manager.js';

import {
    adminReadEx,
    getAdminRulesets,
    loadAdminConfig,
} from './admin.js';

import {
    broadcastMessage,
    gotoURL,
    hasBroadHostPermissions,
    hostnamesFromMatches,
} from './utils.js';

import {
    browser,
    localRead, localRemove, localWrite,
    runtime,
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
    getEffectiveDynamicRules,
    getEffectiveSessionRules,
    getEffectiveUserRules,
    getRulesetDetails,
    patchDefaultRulesets,
    setStrictBlockMode,
    updateDynamicRules,
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

import { dnr } from './ext-compat.js';
import { registerInjectables } from './scripting-manager.js';
import { toggleToolbarIcon } from './action.js';

/******************************************************************************/

const UBOL_ORIGIN = runtime.getURL('').replace(/\/$/, '').toLowerCase();

const canShowBlockedCount = typeof dnr.setExtensionActionOptions === 'function';

let pendingPermissionRequest;

/******************************************************************************/

function getCurrentVersion() {
    return runtime.getManifest().version;
}

/******************************************************************************/

async function onPermissionsRemoved() {
    const modified = await syncWithBrowserPermissions();
    if ( modified === false ) { return false; }
    registerInjectables();
    return true;
}

// https://github.com/uBlockOrigin/uBOL-home/issues/280
async function onPermissionsAdded(permissions) {
    const details = pendingPermissionRequest;
    pendingPermissionRequest = undefined;
    if ( details === undefined ) {
        const modified = await syncWithBrowserPermissions();
        if ( modified === false ) { return; }
        return Promise.all([
            updateSessionRules(),
            registerInjectables(),
        ]);
    }
    const defaultMode = await getDefaultFilteringMode();
    if ( defaultMode >= MODE_OPTIMAL ) { return; }
    if ( Array.isArray(permissions.origins) === false ) { return; }
    const hostnames = hostnamesFromMatches(permissions.origins);
    if ( hostnames.includes(details.hostname) === false ) { return; }
    const beforeLevel = await getFilteringMode(details.hostname);
    if ( beforeLevel === details.afterLevel ) { return; }
    const afterLevel = await setFilteringMode(details.hostname, details.afterLevel);
    if ( afterLevel !== details.afterLevel ) { return; }
    await registerInjectables();
    if ( rulesetConfig.autoReload ) {
        self.setTimeout(( ) => {
            browser.tabs.update(details.tabId, {
                url: details.url,
            });
        }, 437);
    }
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

function setDeveloperMode(state) {
    rulesetConfig.developerMode = state === true;
    toggleDeveloperMode(rulesetConfig.developerMode);
    broadcastMessage({ developerMode: rulesetConfig.developerMode });
    return Promise.all([
        updateUserRules(),
        saveRulesetConfig(),
    ]);
}

/******************************************************************************/

function onMessage(request, sender, callback) {

    const tabId = sender?.tab?.id ?? false;
    const frameId = tabId && (sender?.frameId ?? false);

    // Does not require trusted origin.

    switch ( request.what ) {

    case 'insertCSS': {
        if ( frameId === false ) { return false; }
        // https://bugs.webkit.org/show_bug.cgi?id=262491
        if ( frameId !== 0 && webextFlavor === 'safari' ) { return false; }
        browser.scripting.insertCSS({
            css: request.css,
            origin: 'USER',
            target: { tabId, frameIds: [ frameId ] },
        }).catch(reason => {
            ubolErr(`insertCSS/${reason}`);
        });
        return false;
    }

    case 'removeCSS': {
        if ( frameId === false ) { return false; }
        browser.scripting.removeCSS({
            css: request.css,
            origin: 'USER',
            target: { tabId, frameIds: [ frameId ] },
        }).catch(reason => {
            ubolErr(`removeCSS/${reason}`);
        });
        return false;
    }

    case 'toggleToolbarIcon': {
        if ( tabId ) {
            toggleToolbarIcon(tabId);
        }
        return false;
    }

    case 'startCustomFilters':
        if ( frameId === false ) { return false; }
        startCustomFilters(tabId, frameId).then(( ) => {
            callback();
        });
        return true;

    case 'terminateCustomFilters':
        if ( frameId === false ) { return false; }
        terminateCustomFilters(tabId, frameId).then(( ) => {
            callback();
        });
        return true;

    case 'injectCustomFilters':
        if ( frameId === false ) { return false; }
        injectCustomFilters(tabId, frameId, request.hostname).then(selectors => {
            callback(selectors);
        });
        return true;

    case 'injectCSSProceduralAPI':
        browser.scripting.executeScript({
            files: [ '/js/scripting/css-procedural-api.js' ],
            target: { tabId, frameIds: [ frameId ] },
            injectImmediately: true,
        }).catch(reason => {
            ubolErr(`executeScript/${reason}`);
        }).then(( ) => {
            callback();
        });
        return true;

    default:
        break;
    }

    // Does require trusted origin.

    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/MessageSender
    //   Firefox API does not set `sender.origin`
    if ( sender.origin !== undefined ) {
        if ( sender.origin.toLowerCase() !== UBOL_ORIGIN ) { return; }
    }

    switch ( request.what ) {

    case 'applyRulesets': {
        enableRulesets(request.enabledRulesets).then(result => {
            if ( result === undefined || result.error ) {
                callback(result);
                return;
            }
            rulesetConfig.enabledRulesets = result.enabledRulesets;
            return saveRulesetConfig().then(( ) => {
                return registerInjectables();
            }).then(( ) => {
                callback(result);
            });
        }).finally(( ) => {
            broadcastMessage({ enabledRulesets: rulesetConfig.enabledRulesets });
        });
        return true;
    }

    case 'getDefaultConfig':
        getDefaultRulesetsFromEnv().then(rulesets => {
            callback({
                autoReload: defaultConfig.autoReload,
                developerMode: defaultConfig.developerMode,
                showBlockedCount: defaultConfig.showBlockedCount,
                strictBlockMode: defaultConfig.strictBlockMode,
                rulesets,
                filteringModes: Object.assign(defaultFilteringModes),
            });
        });
        return true;

    case 'getOptionsPageData':
        Promise.all([
            hasBroadHostPermissions(),
            getDefaultFilteringMode(),
            getRulesetDetails(),
            dnr.getEnabledRulesets(),
            getAdminRulesets(),
            adminReadEx('disabledFeatures'),
        ]).then(results => {
            const [
                hasOmnipotence,
                defaultFilteringMode,
                rulesetDetails,
                enabledRulesets,
                adminRulesets,
                disabledFeatures,
            ] = results;
            callback({
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
                firstRun: process.firstRun,
                isSideloaded,
                developerMode: rulesetConfig.developerMode,
                disabledFeatures,
            });
            process.firstRun = false;
        });
        return true;

    case 'getEnabledRulesets':
        dnr.getEnabledRulesets().then(rulesets => {
            callback(rulesets);
        });
        return true;

    case 'getRulesetDetails':
        getRulesetDetails().then(rulesetDetails => {
            callback(Array.from(rulesetDetails.values()));
        });
        return true;

    case 'hasBroadHostPermissions':
        hasBroadHostPermissions().then(result => {
            callback(result);
        });
        return true;

    case 'setAutoReload':
        rulesetConfig.autoReload = request.state && true || false;
        saveRulesetConfig().then(( ) => {
            callback();
            broadcastMessage({ autoReload: rulesetConfig.autoReload });
        });
        return true;

    case 'setShowBlockedCount':
        rulesetConfig.showBlockedCount = request.state && true || false;
        if ( canShowBlockedCount ) {
            dnr.setExtensionActionOptions({
                displayActionCountAsBadgeText: rulesetConfig.showBlockedCount,
            });
        }
        saveRulesetConfig().then(( ) => {
            callback();
            broadcastMessage({ showBlockedCount: rulesetConfig.showBlockedCount });
        });
        return true;

    case 'setStrictBlockMode':
        setStrictBlockMode(request.state).then(( ) => {
            callback();
            broadcastMessage({ strictBlockMode: rulesetConfig.strictBlockMode });
        });
        return true;

    case 'setDeveloperMode':
        setDeveloperMode(request.state).then(( ) => {
            callback();
        });
        return true;

    case 'popupPanelData': {
        Promise.all([
            hasBroadHostPermissions(),
            getFilteringMode(request.hostname),
            adminReadEx('disabledFeatures'),
            hasCustomFilters(request.hostname),
        ]).then(results => {
            callback({
                hasOmnipotence: results[0],
                level: results[1],
                autoReload: rulesetConfig.autoReload,
                isSideloaded,
                developerMode: rulesetConfig.developerMode,
                disabledFeatures: results[2],
                hasCustomFilters: results[3],
            });
        });
        return true;
    }

    case 'getFilteringMode': {
        getFilteringMode(request.hostname).then(actualLevel => {
            callback(actualLevel);
        });
        return true;
    }

    case 'gotoURL':
        gotoURL(request.url, request.type);
        break;

    case 'setFilteringMode': {
        getFilteringMode(request.hostname).then(beforeLevel => {
            if ( request.level === beforeLevel ) { return beforeLevel; }
            return setFilteringMode(request.hostname, request.level);
        }).then(afterLevel => {
            registerInjectables();
            callback(afterLevel);
        });
        return true;
    }

    case 'setPendingFilteringMode':
        pendingPermissionRequest = request;
        break;

    case 'getDefaultFilteringMode': {
        getDefaultFilteringMode().then(level => {
            callback(level);
        });
        return true;
    }

    case 'setDefaultFilteringMode':
        getDefaultFilteringMode().then(beforeLevel =>
            setDefaultFilteringMode(request.level).then(afterLevel =>
                ({ beforeLevel, afterLevel })
            )
        ).then(({ beforeLevel, afterLevel }) => {
            if ( afterLevel !== beforeLevel ) {
                registerInjectables();
            }
            callback(afterLevel);
        });
        return true;

    case 'getFilteringModeDetails':
        getFilteringModeDetails(true).then(details => {
            callback(details);
        });
        return true;

    case 'setFilteringModeDetails':
        setFilteringModeDetails(request.modes).then(( ) => {
            registerInjectables();
            getDefaultFilteringMode().then(defaultFilteringMode => {
                broadcastMessage({ defaultFilteringMode });
            });
            getFilteringModeDetails(true).then(details => {
                callback(details);
            });
        });
        return true;

    case 'excludeFromStrictBlock': {
        excludeFromStrictBlock(request.hostname, request.permanent).then(( ) => {
            callback();
        });
        return true;
    }

    case 'getMatchedRules':
        getMatchedRules(request.tabId).then(entries => {
            callback(entries);
        });
        return true;

    case 'showMatchedRules':
        browser.windows.create({
            type: 'popup',
            url: `/matched-rules.html?tab=${request.tabId}`,
        });
        break;

    case 'getEffectiveDynamicRules':
        getEffectiveDynamicRules().then(result => {
            callback(result);
        });
        return true;

    case 'getEffectiveSessionRules':
        getEffectiveSessionRules().then(result => {
            callback(result);
        });
        return true;

    case 'getEffectiveUserRules':
        getEffectiveUserRules().then(result => {
            callback(result);
        });
        return true;

    case 'updateUserDnrRules':
        updateUserRules().then(result => {
            callback(result);
        });
        return true;

    case 'addCustomFilters':
        addCustomFilters(request.hostname, request.selectors).then(modified => {
            if ( modified !== true ) { return; }
            return registerInjectables();
        }).then(( ) => {
            callback();
        })
        return true;

    case 'removeCustomFilters':
        removeCustomFilters(request.hostname, request.selectors).then(modified => {
            if ( modified !== true ) { return; }
            return registerInjectables();
        }).then(( ) => {
            callback();
        });
        return true;

    case 'removeAllCustomFilters':
        removeAllCustomFilters(request.hostname).then(modified => {
            if ( modified !== true ) { return; }
            return registerInjectables();
        }).then(( ) => {
            callback();
        });
        return true;

    case 'customFiltersFromHostname':
        customFiltersFromHostname(request.hostname).then(selectors => {
            callback(selectors);
        });
        return true;

    case 'getAllCustomFilters':
        getAllCustomFilters().then(data => {
            callback(data);
        });
        return true;

    case 'getConsoleOutput':
        callback(getConsoleOutput());
        break;

    default:
        break;
    }

    return false;
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
        ubolLog(`Version change: ${rulesetConfig.version} => ${currentVersion}`);
        rulesetConfig.version = currentVersion;
        await patchDefaultRulesets();
        saveRulesetConfig();
    }

    const rulesetsUpdated = await enableRulesets(rulesetConfig.enabledRulesets);

    // We need to update the regex rules only when ruleset version changes.
    if ( rulesetsUpdated === undefined ) {
        if ( isNewVersion ) {
            updateDynamicRules();
        } else {
            updateSessionRules();
        }
    }

    // Permissions may have been removed while the extension was disabled
    await syncWithBrowserPermissions();

    // Unsure whether the browser remembers correctly registered css/scripts
    // after we quit the browser. For now uBOL will check unconditionally at
    // launch time whether content css/scripts are properly registered.
    registerInjectables();

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
                registerInjectables();
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
    isFullyInitialized.then(( ) => {
        const r = onMessage(request, sender, callback);
        if ( r !== true ) { callback(); }
    });
    return true;
});

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

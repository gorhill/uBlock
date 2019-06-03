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

/******************************************************************************/
/******************************************************************************/

'use strict';

// Default handler

(function() {

/******************************************************************************/

const µb = µBlock;

/******************************************************************************/

const getDomainNames = function(targets) {
    const µburi = µb.URI;
    return targets.map(target => {
        if ( typeof target !== 'string' ) { return ''; }
        return target.indexOf('/') !== -1
            ? µburi.domainFromURI(target) || ''
            : µburi.domainFromHostname(target) || target;
    });
};

/******************************************************************************/

const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'getAssetContent':
        // https://github.com/chrisaljoudi/uBlock/issues/417
        µb.assets.get(
            request.url,
            { dontCache: true, needSourceURL: true },
            callback
        );
        return;

    case 'listsFromNetFilter':
        µb.staticFilteringReverseLookup.fromNetFilter(
            request.compiledFilter,
            request.rawFilter,
            callback
        );
        return;

    case 'listsFromCosmeticFilter':
        µb.staticFilteringReverseLookup.fromCosmeticFilter(request, callback);
        return;

    case 'reloadAllFilters':
        µb.loadFilterLists();
        return;

    case 'scriptlet':
        µb.scriptlets.inject(request.tabId, request.scriptlet, callback);
        return;

    default:
        break;
    }

    const tabId = sender && sender.tab ? sender.tab.id : 0;

    // Sync
    var response;

    switch ( request.what ) {
    case 'applyFilterListSelection':
        response = µb.applyFilterListSelection(request);
        break;

    case 'compileCosmeticFilterSelector':
        response = µb.staticExtFilteringEngine.compileSelector(request.selector);
        break;

    case 'cosmeticFiltersInjected':
        µb.cosmeticFilteringEngine.addToSelectorCache(request);
        break;

    case 'createUserFilter':
        µb.appendUserFilters(request.filters, request);
        // https://github.com/gorhill/uBlock/issues/1786
        µb.cosmeticFilteringEngine.removeFromSelectorCache(request.pageDomain);
        break;

    case 'forceUpdateAssets':
        µb.scheduleAssetUpdater(0);
        µb.assets.updateStart({
            delay: µb.hiddenSettings.manualUpdateAssetFetchPeriod
        });
        break;

    case 'getAppData':
        response = {
            name: chrome.runtime.getManifest().name,
            version: vAPI.app.version
        };
        break;

    case 'getDomainNames':
        response = getDomainNames(request.targets);
        break;

    case 'getWhitelist':
        response = {
            whitelist: µb.arrayFromWhitelist(µb.netWhitelist),
            whitelistDefault: µb.netWhitelistDefault,
            reBadHostname: µb.reWhitelistBadHostname.source,
            reHostnameExtractor: µb.reWhitelistHostnameExtractor.source
        };
        break;

    case 'launchElementPicker':
        // Launched from some auxiliary pages, clear context menu coords.
        µb.mouseEventRegister.x = µb.mouseEventRegister.y = -1;
        µb.elementPickerExec(request.tabId, request.targetURL, request.zap);
        break;

    case 'gotoURL':
        µb.openNewTab(request.details);
        break;

    case 'mouseClick':
        µb.mouseEventRegister.tabId = tabId;
        µb.mouseEventRegister.x = request.x;
        µb.mouseEventRegister.y = request.y;
        µb.mouseEventRegister.url = request.url;
        break;

    case 'reloadTab':
        if ( vAPI.isBehindTheSceneTabId(request.tabId) === false ) {
            vAPI.tabs.reload(request.tabId, request.bypassCache === true);
            if ( request.select && vAPI.tabs.select ) {
                vAPI.tabs.select(request.tabId);
            }
        }
        break;

    case 'scriptletResponse':
        µb.scriptlets.report(tabId, request.scriptlet, request.response);
        break;

    case 'setWhitelist':
        µb.netWhitelist = µb.whitelistFromString(request.whitelist);
        µb.saveWhitelist();
        break;

    case 'toggleHostnameSwitch':
        µb.toggleHostnameSwitch(request);
        break;

    case 'userSettings':
        response = µb.changeUserSettings(request.name, request.value);
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.setup(onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// channel: popupPanel

(function() {

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var getHostnameDict = function(hostnameToCountMap) {
    var r = Object.create(null),
        domainEntry,
        domainFromHostname = µb.URI.domainFromHostname,
        domain, blockCount, allowCount,
        hostname, counts;
    // Note: destructuring assignment not supported before Chromium 49.
    for ( var entry of hostnameToCountMap ) {
        hostname = entry[0];
        if ( r[hostname] !== undefined ) { continue; }
        domain = domainFromHostname(hostname) || hostname;
        counts = hostnameToCountMap.get(domain) || 0;
        blockCount = counts & 0xFFFF;
        allowCount = counts >>> 16 & 0xFFFF;
        if ( r[domain] === undefined ) {
            domainEntry = r[domain] = {
                domain: domain,
                blockCount: blockCount,
                allowCount: allowCount,
                totalBlockCount: blockCount,
                totalAllowCount: allowCount
            };
        } else {
            domainEntry = r[domain];
        }
        counts = entry[1];
        blockCount = counts & 0xFFFF;
        allowCount = counts >>> 16 & 0xFFFF;
        domainEntry.totalBlockCount += blockCount;
        domainEntry.totalAllowCount += allowCount;
        if ( hostname === domain ) { continue; }
        r[hostname] = {
            domain: domain,
            blockCount: blockCount,
            allowCount: allowCount,
            totalBlockCount: 0,
            totalAllowCount: 0
        };
    }
    return r;
};

/******************************************************************************/

var getFirewallRules = function(srcHostname, desHostnames) {
    var r = {};
    var df = µb.sessionFirewall;
    r['/ * *'] = df.lookupRuleData('*', '*', '*');
    r['/ * image'] = df.lookupRuleData('*', '*', 'image');
    r['/ * 3p'] = df.lookupRuleData('*', '*', '3p');
    r['/ * inline-script'] = df.lookupRuleData('*', '*', 'inline-script');
    r['/ * 1p-script'] = df.lookupRuleData('*', '*', '1p-script');
    r['/ * 3p-script'] = df.lookupRuleData('*', '*', '3p-script');
    r['/ * 3p-frame'] = df.lookupRuleData('*', '*', '3p-frame');
    if ( typeof srcHostname !== 'string' ) {
        return r;
    }

    r['. * *'] = df.lookupRuleData(srcHostname, '*', '*');
    r['. * image'] = df.lookupRuleData(srcHostname, '*', 'image');
    r['. * 3p'] = df.lookupRuleData(srcHostname, '*', '3p');
    r['. * inline-script'] = df.lookupRuleData(srcHostname, '*', 'inline-script');
    r['. * 1p-script'] = df.lookupRuleData(srcHostname, '*', '1p-script');
    r['. * 3p-script'] = df.lookupRuleData(srcHostname, '*', '3p-script');
    r['. * 3p-frame'] = df.lookupRuleData(srcHostname, '*', '3p-frame');

    for ( var desHostname in desHostnames ) {
        r['/ ' + desHostname + ' *'] = df.lookupRuleData('*', desHostname, '*');
        r['. ' + desHostname + ' *'] = df.lookupRuleData(srcHostname, desHostname, '*');
    }
    return r;
};

/******************************************************************************/

var popupDataFromTabId = function(tabId, tabTitle) {
    let tabContext = µb.tabContextManager.mustLookup(tabId),
        rootHostname = tabContext.rootHostname;

    let r = {
        advancedUserEnabled: µb.userSettings.advancedUserEnabled,
        appName: vAPI.app.name,
        appVersion: vAPI.app.version,
        colorBlindFriendly: µb.userSettings.colorBlindFriendly,
        cosmeticFilteringSwitch: false,
        dfEnabled: µb.userSettings.dynamicFilteringEnabled,
        firewallPaneMinimized: µb.userSettings.firewallPaneMinimized,
        globalAllowedRequestCount: µb.localSettings.allowedRequestCount,
        globalBlockedRequestCount: µb.localSettings.blockedRequestCount,
        fontSize: µb.hiddenSettings.popupFontSize,
        netFilteringSwitch: false,
        rawURL: tabContext.rawURL,
        pageURL: tabContext.normalURL,
        pageHostname: rootHostname,
        pageDomain: tabContext.rootDomain,
        pageAllowedRequestCount: 0,
        pageBlockedRequestCount: 0,
        popupBlockedCount: 0,
        tabId: tabId,
        tabTitle: tabTitle,
        tooltipsDisabled: µb.userSettings.tooltipsDisabled
    };

    let pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore ) {
        // https://github.com/gorhill/uBlock/issues/2105
        //   Be sure to always include the current page's hostname -- it might
        //   not be present when the page itself is pulled from the browser's
        //   short-term memory cache. This needs to be done before calling
        //   getHostnameDict().
        if (
            pageStore.hostnameToCountMap.has(rootHostname) === false &&
            µb.URI.isNetworkURI(tabContext.rawURL)
        ) {
            pageStore.hostnameToCountMap.set(rootHostname, 0);
        }
        r.pageBlockedRequestCount = pageStore.perLoadBlockedRequestCount;
        r.pageAllowedRequestCount = pageStore.perLoadAllowedRequestCount;
        r.netFilteringSwitch = pageStore.getNetFilteringSwitch();
        r.hostnameDict = getHostnameDict(pageStore.hostnameToCountMap);
        r.contentLastModified = pageStore.contentLastModified;
        r.firewallRules = getFirewallRules(rootHostname, r.hostnameDict);
        r.canElementPicker = µb.URI.isNetworkURI(r.rawURL);
        r.noPopups = µb.sessionSwitches.evaluateZ('no-popups', rootHostname);
        r.popupBlockedCount = pageStore.popupBlockedCount;
        r.noCosmeticFiltering = µb.sessionSwitches.evaluateZ('no-cosmetic-filtering', rootHostname);
        r.noLargeMedia = µb.sessionSwitches.evaluateZ('no-large-media', rootHostname);
        r.largeMediaCount = pageStore.largeMediaCount;
        r.noRemoteFonts = µb.sessionSwitches.evaluateZ('no-remote-fonts', rootHostname);
        r.remoteFontCount = pageStore.remoteFontCount;
        r.noScripting = µb.sessionSwitches.evaluateZ('no-scripting', rootHostname);
    } else {
        r.hostnameDict = {};
        r.firewallRules = getFirewallRules();
    }

    r.matrixIsDirty = µb.sessionFirewall.hasSameRules(
        µb.permanentFirewall,
        rootHostname,
        r.hostnameDict
    ) === false;
    if ( r.matrixIsDirty === false ) {
        r.matrixIsDirty = µb.sessionSwitches.hasSameRules(
            µb.permanentSwitches,
            rootHostname
        ) === false;
    }
    return r;
};

/******************************************************************************/

var popupDataFromRequest = function(request, callback) {
    if ( request.tabId ) {
        callback(popupDataFromTabId(request.tabId, ''));
        return;
    }

    // Still no target tab id? Use currently selected tab.
    vAPI.tabs.get(null, function(tab) {
        var tabId = '';
        var tabTitle = '';
        if ( tab ) {
            tabId = tab.id;
            tabTitle = tab.title || '';
        }
        callback(popupDataFromTabId(tabId, tabTitle));
    });
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    var pageStore;

    // Async
    switch ( request.what ) {
    case 'getPopupData':
        popupDataFromRequest(request, callback);
        return;

    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    case 'getPopupLazyData':
        pageStore = µb.pageStoreFromTabId(request.tabId);
        if ( pageStore !== null ) {
            pageStore.hiddenElementCount = 0;
            pageStore.scriptCount = 0;
            vAPI.tabs.injectScript(request.tabId, {
                allFrames: true,
                file: '/js/scriptlets/dom-survey.js',
                runAt: 'document_end'
            });
        }
        break;

    case 'hasPopupContentChanged':
        pageStore = µb.pageStoreFromTabId(request.tabId);
        var lastModified = pageStore ? pageStore.contentLastModified : 0;
        response = lastModified !== request.contentLastModified;
        break;

    case 'revertFirewallRules':
        µb.sessionFirewall.copyRules(
            µb.permanentFirewall,
            request.srcHostname,
            request.desHostnames
        );
        µb.sessionSwitches.copyRules(
            µb.permanentSwitches,
            request.srcHostname
        );
        // https://github.com/gorhill/uBlock/issues/188
        µb.cosmeticFilteringEngine.removeFromSelectorCache(
            request.srcHostname,
            'net'
        );
        response = popupDataFromTabId(request.tabId);
        break;

    case 'saveFirewallRules':
        if (
            µb.permanentFirewall.copyRules(
                µb.sessionFirewall,
                request.srcHostname,
                request.desHostnames
            )
        ) {
            µb.savePermanentFirewallRules();
        }
        if (
            µb.permanentSwitches.copyRules(
                µb.sessionSwitches,
                request.srcHostname
            )
        ) {
            µb.saveHostnameSwitches();
        }
        break;

    case 'toggleHostnameSwitch':
        µb.toggleHostnameSwitch(request);
        response = popupDataFromTabId(request.tabId);
        break;

    case 'toggleFirewallRule':
        µb.toggleFirewallRule(request);
        response = popupDataFromTabId(request.tabId);
        break;

    case 'toggleNetFiltering':
        pageStore = µb.pageStoreFromTabId(request.tabId);
        if ( pageStore ) {
            pageStore.toggleNetFilteringSwitch(request.url, request.scope, request.state);
            µb.updateToolbarIcon(request.tabId, 0x03);
        }
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('popupPanel', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// channel: contentscript

(function() {

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    default:
        break;
    }

    // Sync
    const µb = µBlock;
    let response,
        tabId, frameId,
        pageStore = null;

    if ( sender && sender.tab ) {
        tabId = sender.tab.id;
        frameId = sender.frameId;
        pageStore = µb.pageStoreFromTabId(tabId);
    }

    switch ( request.what ) {
    case 'getCollapsibleBlockedRequests':
        response = {
            id: request.id,
            hash: request.hash,
            netSelectorCacheCountMax:
                µb.cosmeticFilteringEngine.netSelectorCacheCountMax
        };
        if (
            µb.userSettings.collapseBlocked &&
            pageStore &&
            pageStore.getNetFilteringSwitch()
        ) {
            pageStore.getBlockedResources(request, response);
        }
        break;

    case 'shouldRenderNoscriptTags':
        if ( pageStore === null ) { break; }
        const fctxt = µb.filteringContext.fromTabId(tabId);
        if ( pageStore.filterScripting(fctxt, undefined) ) {
            vAPI.tabs.injectScript(
                tabId,
                {
                    file: '/js/scriptlets/noscript-spoof.js',
                    frameId: frameId,
                    runAt: 'document_end'
                }
            );
        }
        break;

    case 'retrieveContentScriptParameters':
        if (
            pageStore === null ||
            pageStore.getNetFilteringSwitch() === false ||
            !request.url
        ) {
            break;
        }
        const noCosmeticFiltering = pageStore.noCosmeticFiltering === true;
        response = {
            collapseBlocked: µb.userSettings.collapseBlocked,
            noCosmeticFiltering,
            noGenericCosmeticFiltering: noCosmeticFiltering,
        };
        // https://github.com/uBlockOrigin/uAssets/issues/5704
        //   `generichide` must be evaluated in the frame context.
        if ( noCosmeticFiltering === false ) {
            const genericHide =
                µb.staticNetFilteringEngine.matchStringGenericHide(request.url);
            response.noGenericCosmeticFiltering = genericHide === 2;
            if ( genericHide !== 0 && µb.logger.enabled ) {
                µBlock.filteringContext
                    .duplicate()
                    .fromTabId(tabId)
                    .setURL(request.url)
                    .setRealm('network')
                    .setType('generichide')
                    .setFilter(µb.staticNetFilteringEngine.toLogData())
                    .toLogger();
            }
        }
        request.tabId = tabId;
        request.frameId = frameId;
        request.hostname = µb.URI.hostnameFromURI(request.url);
        request.domain = µb.URI.domainFromHostname(request.hostname);
        request.entity = µb.URI.entityFromDomain(request.domain);
        response.specificCosmeticFilters =
            µb.cosmeticFilteringEngine.retrieveSpecificSelectors(
                request,
                response
            );
        if ( µb.canInjectScriptletsNow === false ) {
            response.scriptlets = µb.scriptletFilteringEngine.retrieve(request);
        }
        if ( µb.logger.enabled && response.noCosmeticFiltering !== true ) {
            µb.logCosmeticFilters(tabId, frameId);
        }
        break;

    case 'retrieveGenericCosmeticSelectors':
        request.tabId = tabId;
        request.frameId = frameId;
        response = {
            result: µb.cosmeticFilteringEngine.retrieveGenericSelectors(request)
        };
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('contentscript', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// channel: elementPicker

(function() {

/******************************************************************************/

const onMessage = function(request, sender, callback) {
    const µb = µBlock;

    // Async
    switch ( request.what ) {
    case 'elementPickerArguments':
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'epicker.html', true);
        xhr.overrideMimeType('text/html;charset=utf-8');
        xhr.responseType = 'text';
        xhr.onload = function() {
            this.onload = null;
            var i18n = {
                bidi_dir: document.body.getAttribute('dir'),
                create: vAPI.i18n('pickerCreate'),
                pick: vAPI.i18n('pickerPick'),
                quit: vAPI.i18n('pickerQuit'),
                preview: vAPI.i18n('pickerPreview'),
                netFilters: vAPI.i18n('pickerNetFilters'),
                cosmeticFilters: vAPI.i18n('pickerCosmeticFilters'),
                cosmeticFiltersHint: vAPI.i18n('pickerCosmeticFiltersHint')
            };
            const reStrings = /\{\{(\w+)\}\}/g;
            const replacer = function(a0, string) {
                return i18n[string];
            };

            callback({
                frameContent: this.responseText.replace(reStrings, replacer),
                target: µb.epickerTarget,
                clientX: µb.mouseEventRegister.x,
                clientY: µb.mouseEventRegister.y,
                zap: µb.epickerZap,
                eprom: µb.epickerEprom
            });

            µb.epickerTarget = '';
            µb.mouseEventRegister.x = µb.mouseEventRegister.y = -1;
        };
        xhr.send();
        return;

    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'elementPickerEprom':
        µb.epickerEprom = request;
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('elementPicker', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// channel: cloudWidget

(function() {

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Cloud storage support is optional.
    if ( µBlock.cloudStorageSupported !== true ) {
        callback();
        return;
    }

    // Async
    switch ( request.what ) {
    case 'cloudGetOptions':
        vAPI.cloud.getOptions(function(options) {
            options.enabled = µBlock.userSettings.cloudStorageEnabled === true;
            callback(options);
        });
        return;

    case 'cloudSetOptions':
        vAPI.cloud.setOptions(request.options, callback);
        return;

    case 'cloudPull':
        return vAPI.cloud.pull(request.datakey, callback);

    case 'cloudPush':
        return vAPI.cloud.push(request.datakey, request.data, callback);

    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    // For when cloud storage is disabled.
    case 'cloudPull':
        // fallthrough
    case 'cloudPush':
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('cloudWidget', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// channel: dashboard

(function() {

/******************************************************************************/

const µb = µBlock;

/******************************************************************************/

// Settings

var getLocalData = function(callback) {
    var onStorageInfoReady = function(bytesInUse) {
        var o = µb.restoreBackupSettings;
        callback({
            storageUsed: bytesInUse,
            lastRestoreFile: o.lastRestoreFile,
            lastRestoreTime: o.lastRestoreTime,
            lastBackupFile: o.lastBackupFile,
            lastBackupTime: o.lastBackupTime,
            cloudStorageSupported: µb.cloudStorageSupported,
            privacySettingsSupported: µb.privacySettingsSupported
        });
    };

    µb.getBytesInUse(onStorageInfoReady);
};

var backupUserData = function(callback) {
    var userData = {
        timeStamp: Date.now(),
        version: vAPI.app.version,
        userSettings: µb.userSettings,
        selectedFilterLists: µb.selectedFilterLists,
        hiddenSettings: µb.hiddenSettings,
        netWhitelist: µb.stringFromWhitelist(µb.netWhitelist),
        dynamicFilteringString: µb.permanentFirewall.toString(),
        urlFilteringString: µb.permanentURLFiltering.toString(),
        hostnameSwitchesString: µb.permanentSwitches.toString(),
        userFilters: ''
    };

    var onUserFiltersReady = function(details) {
        userData.userFilters = details.content;
        var filename = vAPI.i18n('aboutBackupFilename')
            .replace('{{datetime}}', µb.dateNowToSensibleString())
            .replace(/ +/g, '_');
        µb.restoreBackupSettings.lastBackupFile = filename;
        µb.restoreBackupSettings.lastBackupTime = Date.now();
        vAPI.storage.set(µb.restoreBackupSettings);
        getLocalData(function(localData) {
            callback({ localData: localData, userData: userData });
        });
    };

    µb.assets.get(µb.userFiltersPath, onUserFiltersReady);
};

const restoreUserData = function(request) {
    const userData = request.userData;

    const restart = function() {
        vAPI.app.restart();
    };

    let countdown = 2;

    const onAllRemoved = function() {
        countdown -= 1;
        if ( countdown !== 0 ) { return; }
        µBlock.saveLocalSettings();
        vAPI.storage.set(userData.userSettings);
        let hiddenSettings = userData.hiddenSettings;
        if ( hiddenSettings instanceof Object === false ) {
            hiddenSettings = µBlock.hiddenSettingsFromString(
                userData.hiddenSettingsString || ''
            );
        }
        vAPI.storage.set({
            hiddenSettings: hiddenSettings,
            netWhitelist: userData.netWhitelist || '',
            dynamicFilteringString: userData.dynamicFilteringString || '',
            urlFilteringString: userData.urlFilteringString || '',
            hostnameSwitchesString: userData.hostnameSwitchesString || '',
            lastRestoreFile: request.file || '',
            lastRestoreTime: Date.now(),
            lastBackupFile: '',
            lastBackupTime: 0
        });
        µb.assets.put(µb.userFiltersPath, userData.userFilters);
        if ( Array.isArray(userData.selectedFilterLists) ) {
            µb.saveSelectedFilterLists(userData.selectedFilterLists, restart);
        } else {
            restart();
        }
    };

    // https://github.com/chrisaljoudi/uBlock/issues/1102
    // Ensure all currently cached assets are flushed from storage AND memory.
    µb.assets.rmrf();

    // If we are going to restore all, might as well wipe out clean local
    // storage
    µb.cacheStorage.clear().then(( ) => { onAllRemoved(); });
    vAPI.storage.clear(onAllRemoved);
    vAPI.localStorage.removeItem('immediateHiddenSettings');
};

// Remove all stored data but keep global counts, people can become
// quite attached to numbers

const resetUserData = function() {
    let count = 3;
    const countdown = ( ) => {
        count -= 1;
        if ( count === 0 ) {
            vAPI.app.restart();
        }
    };
    µb.cacheStorage.clear().then(( ) => countdown());   // 1
    vAPI.storage.clear(countdown);                      // 2
    µb.saveLocalSettings(countdown);                    // 3
    vAPI.localStorage.removeItem('immediateHiddenSettings');
};

/******************************************************************************/

// 3rd-party filters

const prepListEntries = function(entries) {
    const µburi = µb.URI;
    for ( const k in entries ) {
        if ( entries.hasOwnProperty(k) === false ) { continue; }
        const entry = entries[k];
        if ( typeof entry.supportURL === 'string' && entry.supportURL !== '' ) {
            entry.supportName = µburi.hostnameFromURI(entry.supportURL);
        } else if ( typeof entry.homeURL === 'string' && entry.homeURL !== '' ) {
            const hn = µburi.hostnameFromURI(entry.homeURL);
            entry.supportURL = `http://${hn}/`;
            entry.supportName = µburi.domainFromHostname(hn);
        }
    }
};

const getLists = function(callback) {
    const r = {
        autoUpdate: µb.userSettings.autoUpdate,
        available: null,
        cache: null,
        cosmeticFilterCount: µb.cosmeticFilteringEngine.getFilterCount(),
        current: µb.availableFilterLists,
        externalLists: µb.userSettings.externalLists,
        ignoreGenericCosmeticFilters: µb.userSettings.ignoreGenericCosmeticFilters,
        isUpdating: µb.assets.isUpdating(),
        netFilterCount: µb.staticNetFilteringEngine.getFilterCount(),
        parseCosmeticFilters: µb.userSettings.parseAllABPHideFilters,
        userFiltersPath: µb.userFiltersPath
    };
    const onMetadataReady = function(entries) {
        r.cache = entries;
        prepListEntries(r.cache);
        callback(r);
    };
    const onLists = function(lists) {
        r.available = lists;
        prepListEntries(r.available);
        µb.assets.metadata(onMetadataReady);
    };
    µb.getAvailableLists(onLists);
};

/******************************************************************************/

// My rules

const getRules = function() {
    return {
        permanentRules:
            µb.permanentFirewall.toArray().concat(
                µb.permanentSwitches.toArray(),
                µb.permanentURLFiltering.toArray()
            ),
        sessionRules:
            µb.sessionFirewall.toArray().concat(
                µb.sessionSwitches.toArray(),
                µb.sessionURLFiltering.toArray()
            )
    };
};

const modifyRuleset = function(details) {
    let swRuleset, hnRuleset, urlRuleset;
    if ( details.permanent ) {
        swRuleset = µb.permanentSwitches;
        hnRuleset = µb.permanentFirewall;
        urlRuleset = µb.permanentURLFiltering;
    } else {
        swRuleset = µb.sessionSwitches;
        hnRuleset = µb.sessionFirewall;
        urlRuleset = µb.sessionURLFiltering;
    }
    let toRemove = new Set(details.toRemove.trim().split(/\s*[\n\r]+\s*/));
    for ( let rule of toRemove ) {
        if ( rule === '' ) { continue; }
        let parts = rule.split(/\s+/);
        if ( hnRuleset.removeFromRuleParts(parts) === false ) {
            if ( swRuleset.removeFromRuleParts(parts) === false ) {
                urlRuleset.removeFromRuleParts(parts);
            }
        }
    }
    let toAdd = new Set(details.toAdd.trim().split(/\s*[\n\r]+\s*/));
    for ( let rule of toAdd ) {
        if ( rule === '' ) { continue; }
        let parts = rule.split(/\s+/);
        if ( hnRuleset.addFromRuleParts(parts) === false ) {
            if ( swRuleset.addFromRuleParts(parts) === false ) {
                urlRuleset.addFromRuleParts(parts);
            }
        }
    }
    if ( details.permanent ) {
        if ( swRuleset.changed ) {
            µb.saveHostnameSwitches();
            swRuleset.changed = false;
        }
        if ( hnRuleset.changed ) {
            µb.savePermanentFirewallRules();
            hnRuleset.changed = false;
        }
        if ( urlRuleset.changed ) {
            µb.savePermanentURLFilteringRules();
            urlRuleset.changed = false;
        }
    }
};

/******************************************************************************/

// Shortcuts pane

const getShortcuts = function(callback) {
    if ( µb.canUseShortcuts === false ) {
        return callback([]);
    }

    vAPI.commands.getAll(commands => {
        let response = [];
        for ( let command of commands ) {
            let desc = command.description;
            let match = /^__MSG_(.+?)__$/.exec(desc);
            if ( match !== null ) {
                desc = vAPI.i18n(match[1]);
            }
            if ( desc === '' ) { continue; }
            command.description = desc;
            response.push(command);
        }
        callback(response);
    });
};

const setShortcut = function(details) {
    if  ( µb.canUpdateShortcuts === false ) { return; }
    if ( details.shortcut === undefined ) {
        vAPI.commands.reset(details.name);
        µb.commandShortcuts.delete(details.name);
    } else {
        vAPI.commands.update({ name: details.name, shortcut: details.shortcut });
        µb.commandShortcuts.set(details.name, details.shortcut);
    }
    vAPI.storage.set({ commandShortcuts: Array.from(µb.commandShortcuts) });
};

/******************************************************************************/

const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'backupUserData':
        return backupUserData(callback);

    case 'getLists':
        return getLists(callback);

    case 'getLocalData':
        return getLocalData(callback);

    case 'getShortcuts':
        return getShortcuts(callback);

    case 'readUserFilters':
        return µb.loadUserFilters(callback);

    case 'writeUserFilters':
        return µb.saveUserFilters(request.content, callback);

    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    case 'canUpdateShortcuts':
        response = µb.canUpdateShortcuts;
        break;

    case 'getRules':
        response = getRules();
        break;

    case 'modifyRuleset':
        // https://github.com/chrisaljoudi/uBlock/issues/772
        µb.cosmeticFilteringEngine.removeFromSelectorCache('*');
        modifyRuleset(request);
        response = getRules();
        break;

    case 'purgeAllCaches':
        if ( request.hard ) {
            µb.assets.remove(/./);
        } else {
            µb.assets.purge(/./, 'public_suffix_list.dat');
        }
        break;

    case 'purgeCache':
        µb.assets.purge(request.assetKey);
        µb.assets.remove('compiled/' + request.assetKey);
        // https://github.com/gorhill/uBlock/pull/2314#issuecomment-278716960
        if ( request.assetKey === 'ublock-filters' ) {
            µb.assets.purge('ublock-resources');
            µb.redirectEngine.invalidateResourcesSelfie();
        }
        break;

    case 'readHiddenSettings':
        response = µb.stringFromHiddenSettings();
        break;

    case 'restoreUserData':
        restoreUserData(request);
        break;

    case 'resetUserData':
        resetUserData();
        break;

    case 'setShortcut':
        setShortcut(request);
        break;

    case 'writeHiddenSettings':
        µb.changeHiddenSettings(µb.hiddenSettingsFromString(request.content));
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('dashboard', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// channel: loggerUI

(function() {

/******************************************************************************/

const µb = µBlock;
const extensionOriginURL = vAPI.getURL('');

/******************************************************************************/

const getLoggerData = function(details, activeTabId, callback) {
    const response = {
        colorBlind: µb.userSettings.colorBlindFriendly,
        entries: µb.logger.readAll(details.ownerId),
        maxEntries: µb.userSettings.requestLogMaxEntries,
        activeTabId: activeTabId,
        tabIdsToken: µb.pageStoresToken,
        tooltips: µb.userSettings.tooltipsDisabled === false
    };
    if ( µb.pageStoresToken !== details.tabIdsToken ) {
        const tabIds = new Map();
        for ( const entry of µb.pageStores ) {
            const pageStore = entry[1];
            if ( pageStore.rawURL.startsWith(extensionOriginURL) ) { continue; }
            tabIds.set(entry[0], pageStore.title);
        }
        response.tabIds = Array.from(tabIds);
    }
    if ( activeTabId ) {
        const pageStore = µb.pageStoreFromTabId(activeTabId);
        if (
            pageStore === null ||
            pageStore.rawURL.startsWith(extensionOriginURL)
        ) {
            response.activeTabId = undefined;
        }
    }
    if ( details.popupLoggerBoxChanged && browser.windows instanceof Object ) {
        browser.tabs.query(
            { url: vAPI.getURL('/logger-ui.html?popup=1') },
            tabs => {
                if ( Array.isArray(tabs) === false ) { return; }
                if ( tabs.length === 0 ) { return; }
                browser.windows.get(tabs[0].windowId, win => {
                    if ( win instanceof Object === false ) { return; }
                    vAPI.localStorage.setItem(
                        'popupLoggerBox',
                        JSON.stringify({
                            left: win.left,
                            top: win.top,
                            width: win.width,
                            height: win.height,
                        })
                    );
                });
            }
        );
    }
    callback(response);
};

/******************************************************************************/

const getURLFilteringData = function(details) {
    const colors = {};
    const response = {
        dirty: false,
        colors: colors
    };
    const suf = µb.sessionURLFiltering;
    const puf = µb.permanentURLFiltering;
    const urls = details.urls;
    const context = details.context;
    const type = details.type;
    for ( const url of urls ) {
        const colorEntry = colors[url] = { r: 0, own: false };
        if ( suf.evaluateZ(context, url, type).r !== 0 ) {
            colorEntry.r = suf.r;
            colorEntry.own = suf.r !== 0 &&
                             suf.context === context &&
                             suf.url === url &&
                             suf.type === type;
        }
        if ( response.dirty ) { continue; }
        puf.evaluateZ(context, url, type);
        response.dirty = colorEntry.own !== (
            puf.r !== 0 &&
            puf.context === context &&
            puf.url === url &&
            puf.type === type
        );
    }
    return response;
};

/******************************************************************************/

const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'readAll':
        if (
            µb.logger.ownerId !== undefined &&
            µb.logger.ownerId !== request.ownerId
        ) {
            callback({ unavailable: true });
            return;
        }
        vAPI.tabs.get(null, function(tab) {
            getLoggerData(request, tab && tab.id, callback);
        });
        return;

    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'releaseView':
        if ( request.ownerId === µb.logger.ownerId ) {
            µb.logger.ownerId = undefined;
        }
        break;

    case 'saveURLFilteringRules':
        response = µb.permanentURLFiltering.copyRules(
            µb.sessionURLFiltering,
            request.context,
            request.urls,
            request.type
        );
        if ( response ) {
            µb.savePermanentURLFilteringRules();
        }
        break;

    case 'setURLFilteringRule':
        µb.toggleURLFilteringRule(request);
        break;

    case 'getURLFilteringData':
        response = getURLFilteringData(request);
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('loggerUI', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// channel: documentBlocked

(( ) => {

/******************************************************************************/

const onMessage = function(request, sender, callback) {
    const tabId = sender && sender.tab ? sender.tab.id : 0;

    // Async
    switch ( request.what ) {
    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'closeThisTab':
        vAPI.tabs.remove(tabId);
        break;

    case 'temporarilyWhitelistDocument':
        µBlock.webRequest.strictBlockBypass(request.hostname);
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('documentBlocked', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// channel: scriptlets

(function() {

/******************************************************************************/

const µb = µBlock;
const broadcastTimers = new Map();

/******************************************************************************/

const domSurveyFinalReport = function(tabId) {
    broadcastTimers.delete(tabId + '-domSurveyReport');

    const pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore === null ) { return; }

    vAPI.messaging.broadcast({
        what: 'domSurveyFinalReport',
        tabId: tabId,
        affectedElementCount: pageStore.hiddenElementCount,
        scriptCount: pageStore.scriptCount,
    });
};

/******************************************************************************/

const logCosmeticFilters = function(tabId, details) {
    if ( µb.logger.enabled === false ) { return; }

    const filter = { source: 'cosmetic', raw: '' };
    const fctxt = µb.filteringContext.duplicate();
    fctxt.fromTabId(tabId)
         .setRealm('cosmetic')
         .setType('dom')
         .setURL(details.frameURL)
         .setDocOriginFromURL(details.frameURL)
         .setFilter(filter);
    for ( const selector of details.matchedSelectors.sort() ) {
        filter.raw = selector;
        fctxt.toLogger();
    }
};

/******************************************************************************/

const logCSPViolations = function(pageStore, request) {
    if ( µb.logger.enabled === false || pageStore === null ) {
        return false;
    }
    if ( request.violations.length === 0 ) {
        return true;
    }

    const fctxt = µb.filteringContext.duplicate();
    fctxt.fromTabId(pageStore.tabId)
         .setRealm('network')
         .setDocOriginFromURL(request.docURL)
         .setURL(request.docURL);

    let cspData = pageStore.extraData.get('cspData');
    if ( cspData === undefined ) {
        cspData = new Map();

        const policies = [];
        const logData = [];
        µb.staticNetFilteringEngine.matchAndFetchData(
            'csp',
            request.docURL,
            policies,
            logData
        );
        for ( let i = 0; i < policies.length; i++ ) {
            cspData.set(policies[i], logData[i]);
        }
        
        fctxt.type = 'inline-script';
        fctxt.filter = undefined;
        if ( pageStore.filterRequest(fctxt) === 1 ) {
            cspData.set(µb.cspNoInlineScript, fctxt.filter);
        }

        fctxt.type = 'script';
        fctxt.filter = undefined;
        if ( pageStore.filterScripting(fctxt, true) === 1 ) {
            cspData.set(µb.cspNoScripting, fctxt.filter);
        }
    
        fctxt.type = 'inline-font';
        fctxt.filter = undefined;
        if ( pageStore.filterRequest(fctxt) === 1 ) {
            cspData.set(µb.cspNoInlineFont, fctxt.filter);
        }

        if ( cspData.size === 0 ) { return false; }

        pageStore.extraData.set('cspData', cspData);
    }

    const typeMap = logCSPViolations.policyDirectiveToTypeMap;
    for ( const json of request.violations ) {
        const violation = JSON.parse(json);
        let type = typeMap.get(violation.directive);
        if ( type === undefined ) { continue; }
        const logData = cspData.get(violation.policy);
        if ( logData === undefined ) { continue; }
        if ( /^[\w.+-]+:\/\//.test(violation.url) === false ) {
            violation.url = request.docURL;
            if ( type === 'script' ) { type = 'inline-script'; }
            else if ( type === 'font' ) { type = 'inline-font'; }
        }
        fctxt.setURL(violation.url)
             .setType(type)
             .setFilter(logData)
             .toLogger();
    }

    return true;
};

logCSPViolations.policyDirectiveToTypeMap = new Map([
    [ 'img-src', 'image' ],
    [ 'connect-src', 'xmlhttprequest' ],
    [ 'font-src', 'font' ],
    [ 'frame-src', 'sub_frame' ],
    [ 'media-src', 'media' ],
    [ 'object-src', 'object' ],
    [ 'script-src', 'script' ],
    [ 'script-src-attr', 'script' ],
    [ 'script-src-elem', 'script' ],
    [ 'style-src', 'stylesheet' ],
    [ 'style-src-attr', 'stylesheet' ],
    [ 'style-src-elem', 'stylesheet' ],
]);

/******************************************************************************/

const onMessage = function(request, sender, callback) {
    const tabId = sender && sender.tab ? sender.tab.id : 0;
    const pageStore = µb.pageStoreFromTabId(tabId);

    // Async
    switch ( request.what ) {
    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'domSurveyTransientReport':
        if ( pageStore !== null ) {
            if ( request.filteredElementCount ) {
                pageStore.hiddenElementCount += request.filteredElementCount;
            }
            if ( request.scriptCount ) {
                pageStore.scriptCount += request.scriptCount;
            }
            let broadcastKey = tabId + '-domSurveyReport';
            if ( broadcastTimers.has(broadcastKey) === false ) {
                broadcastTimers.set(broadcastKey, vAPI.setTimeout(
                    ( ) => { domSurveyFinalReport(tabId); },
                    53
                ));
            }
        }
        break;

    case 'inlinescriptFound':
        if ( µb.logger.enabled && pageStore !== null ) {
            const fctxt = µb.filteringContext.duplicate();
            fctxt.fromTabId(tabId)
                .setType('inline-script')
                .setURL(request.docURL)
                .setDocOriginFromURL(request.docURL);
            if ( pageStore.filterRequest(fctxt) === 0 ) {
                fctxt.setRealm('network').toLogger();
            }
        }
        break;

    case 'logCosmeticFilteringData':
        logCosmeticFilters(tabId, request);
        break;

    case 'securityPolicyViolation':
        response = logCSPViolations(pageStore, request);
        break;

    case 'temporarilyAllowLargeMediaElement':
        if ( pageStore !== null ) {
            pageStore.allowLargeMediaElementsUntil = Date.now() + 2000;
        }
        break;

    case 'subscriberData':
        response = {
            confirmStr: vAPI.i18n('subscriberConfirm')
        };
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('scriptlets', onMessage);

/******************************************************************************/

})();


/******************************************************************************/
/******************************************************************************/

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

// https://github.com/uBlockOrigin/uBlock-issues/issues/710
//   Listeners have a name and a "privileged" status.
//   The nameless default handler is always deemed "privileged".
//   Messages from privileged ports must never relayed to listeners
//   which are not privileged.

/******************************************************************************/
/******************************************************************************/

// Default handler
//      priviledged

{
// >>>>> start of local scope

const µb = µBlock;

const getDomainNames = function(targets) {
    const µburi = µb.URI;
    return targets.map(target => {
        if ( typeof target !== 'string' ) { return ''; }
        return target.indexOf('/') !== -1
            ? µburi.domainFromURI(target) || ''
            : µburi.domainFromHostname(target) || target;
    });
};

const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'getAssetContent':
        // https://github.com/chrisaljoudi/uBlock/issues/417
        µb.assets.get(
            request.url,
            { dontCache: true, needSourceURL: true }
        ).then(result => {
            callback(result);
        });
        return;

    case 'listsFromNetFilter':
        µb.staticFilteringReverseLookup.fromNetFilter(
            request.rawFilter
        ).then(response => {
            callback(response);
        });
        return;

    case 'listsFromCosmeticFilter':
        µb.staticFilteringReverseLookup.fromCosmeticFilter(
            request
        ).then(response => {
            callback(response);
        });
        return;

    case 'reloadAllFilters':
        µb.loadFilterLists().then(( ) => { callback(); });
        return;

    case 'scriptlet':
        µb.scriptlets.inject(request.tabId, request.scriptlet, callback);
        return;

    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    case 'applyFilterListSelection':
        response = µb.applyFilterListSelection(request);
        break;

    case 'createUserFilter':
        µb.createUserFilters(request);
        break;

    case 'forceUpdateAssets':
        µb.scheduleAssetUpdater(0);
        µb.assets.updateStart({
            delay: µb.hiddenSettings.manualUpdateAssetFetchPeriod
        });
        break;

    case 'getAppData':
        response = {
            name: browser.runtime.getManifest().name,
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
        µb.epickerArgs.mouse = false;
        µb.elementPickerExec(request.tabId, request.targetURL, request.zap);
        break;

    case 'gotoURL':
        µb.openNewTab(request.details);
        break;

    case 'reloadTab':
        if ( vAPI.isBehindTheSceneTabId(request.tabId) === false ) {
            vAPI.tabs.reload(request.tabId, request.bypassCache === true);
            if ( request.select && vAPI.tabs.select ) {
                vAPI.tabs.select(request.tabId);
            }
        }
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

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      popupPanel
//      privileged

{
// >>>>> start of local scope

const µb = µBlock;

const getHostnameDict = function(hostnameToCountMap, out) {
    const hnDict = Object.create(null);
    const cnMap = [];
    for ( const [ hostname, hnCounts ] of hostnameToCountMap ) {
        if ( hnDict[hostname] !== undefined ) { continue; }
        const domain = vAPI.domainFromHostname(hostname) || hostname;
        const dnCounts = hostnameToCountMap.get(domain) || 0;
        let blockCount = dnCounts & 0xFFFF;
        let allowCount = dnCounts >>> 16 & 0xFFFF;
        if ( hnDict[domain] === undefined ) {
            hnDict[domain] = {
                domain,
                blockCount,
                allowCount,
                totalBlockCount: blockCount,
                totalAllowCount: allowCount,
            };
            const cname = vAPI.net.canonicalNameFromHostname(domain);
            if ( cname !== undefined ) {
                cnMap.push([ cname, domain ]);
            }
        }
        const domainEntry = hnDict[domain];
        blockCount = hnCounts & 0xFFFF;
        allowCount = hnCounts >>> 16 & 0xFFFF;
        domainEntry.totalBlockCount += blockCount;
        domainEntry.totalAllowCount += allowCount;
        if ( hostname === domain ) { continue; }
        hnDict[hostname] = {
            domain,
            blockCount,
            allowCount,
            totalBlockCount: 0,
            totalAllowCount: 0,
        };
        const cname = vAPI.net.canonicalNameFromHostname(hostname);
        if ( cname !== undefined ) {
            cnMap.push([ cname, hostname ]);
        }
    }
    out.hostnameDict = hnDict;
    out.cnameMap = cnMap;
};

const getFirewallRules = function(srcHostname, desHostnames) {
    const out = {};
    const df = µb.sessionFirewall;
    out['/ * *'] = df.lookupRuleData('*', '*', '*');
    out['/ * image'] = df.lookupRuleData('*', '*', 'image');
    out['/ * 3p'] = df.lookupRuleData('*', '*', '3p');
    out['/ * inline-script'] = df.lookupRuleData('*', '*', 'inline-script');
    out['/ * 1p-script'] = df.lookupRuleData('*', '*', '1p-script');
    out['/ * 3p-script'] = df.lookupRuleData('*', '*', '3p-script');
    out['/ * 3p-frame'] = df.lookupRuleData('*', '*', '3p-frame');
    if ( typeof srcHostname !== 'string' ) { return out; }

    out['. * *'] = df.lookupRuleData(srcHostname, '*', '*');
    out['. * image'] = df.lookupRuleData(srcHostname, '*', 'image');
    out['. * 3p'] = df.lookupRuleData(srcHostname, '*', '3p');
    out['. * inline-script'] = df.lookupRuleData(srcHostname,
        '*',
        'inline-script'
    );
    out['. * 1p-script'] = df.lookupRuleData(srcHostname, '*', '1p-script');
    out['. * 3p-script'] = df.lookupRuleData(srcHostname, '*', '3p-script');
    out['. * 3p-frame'] = df.lookupRuleData(srcHostname, '*', '3p-frame');

    for ( const desHostname in desHostnames ) {
        out[`/ ${desHostname} *`] = df.lookupRuleData('*', desHostname, '*');
        out[`. ${desHostname} *`] = df.lookupRuleData(srcHostname, desHostname, '*');
    }
    return out;
};

const popupDataFromTabId = function(tabId, tabTitle) {
    const tabContext = µb.tabContextManager.mustLookup(tabId);
    const rootHostname = tabContext.rootHostname;
    const µbus = µb.userSettings;
    const r = {
        advancedUserEnabled: µbus.advancedUserEnabled,
        appName: vAPI.app.name,
        appVersion: vAPI.app.version,
        colorBlindFriendly: µbus.colorBlindFriendly,
        cosmeticFilteringSwitch: false,
        firewallPaneMinimized: µbus.firewallPaneMinimized,
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
        popupPanelSections: µbus.popupPanelSections,
        popupPanelDisabledSections: µb.hiddenSettings.popupPanelDisabledSections,
        popupPanelLockedSections: µb.hiddenSettings.popupPanelLockedSections,
        tabId: tabId,
        tabTitle: tabTitle,
        tooltipsDisabled: µbus.tooltipsDisabled
    };

    if ( µb.hiddenSettings.uiPopupConfig !== 'undocumented' ) {
        r.uiPopupConfig = µb.hiddenSettings.uiPopupConfig;
    }

    const pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore ) {
        // https://github.com/gorhill/uBlock/issues/2105
        //   Be sure to always include the current page's hostname -- it
        //   might not be present when the page itself is pulled from the
        //   browser's short-term memory cache. This needs to be done
        //   before calling getHostnameDict().
        if (
            pageStore.hostnameToCountMap.has(rootHostname) === false &&
            µb.URI.isNetworkURI(tabContext.rawURL)
        ) {
            pageStore.hostnameToCountMap.set(rootHostname, 0);
        }
        r.pageBlockedRequestCount = pageStore.perLoadBlockedRequestCount;
        r.pageAllowedRequestCount = pageStore.perLoadAllowedRequestCount;
        r.netFilteringSwitch = pageStore.getNetFilteringSwitch();
        getHostnameDict(pageStore.hostnameToCountMap, r);
        r.contentLastModified = pageStore.contentLastModified;
        r.firewallRules = getFirewallRules(rootHostname, r.hostnameDict);
        r.canElementPicker = µb.URI.isNetworkURI(r.rawURL);
        r.noPopups = µb.sessionSwitches.evaluateZ(
            'no-popups',
            rootHostname
        );
        r.popupBlockedCount = pageStore.popupBlockedCount;
        r.noCosmeticFiltering = µb.sessionSwitches.evaluateZ(
            'no-cosmetic-filtering',
            rootHostname
        );
        r.noLargeMedia = µb.sessionSwitches.evaluateZ(
            'no-large-media',
            rootHostname
        );
        r.largeMediaCount = pageStore.largeMediaCount;
        r.noRemoteFonts = µb.sessionSwitches.evaluateZ(
            'no-remote-fonts',
            rootHostname
        );
        r.remoteFontCount = pageStore.remoteFontCount;
        r.noScripting = µb.sessionSwitches.evaluateZ(
            'no-scripting',
            rootHostname
        );
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

const popupDataFromRequest = async function(request) {
    if ( request.tabId ) {
        return popupDataFromTabId(request.tabId, '');
    }

    // Still no target tab id? Use currently selected tab.
    const tab = await vAPI.tabs.getCurrent();
    let tabId = '';
    let tabTitle = '';
    if ( tab instanceof Object ) {
        tabId = tab.id;
        tabTitle = tab.title || '';
    }
    return popupDataFromTabId(tabId, tabTitle);
};

const getElementCount = async function(tabId, what) {
    const results = await vAPI.tabs.executeScript(tabId, {
        allFrames: true,
        file: `/js/scriptlets/dom-survey-${what}.js`,
        runAt: 'document_end',
    });

    let total = 0;
    for ( const count of results ) {
        if ( typeof count !== 'number' ) { continue; }
        if ( count === -1 ) { return -1; }
        total += count;
    }

    return total;
};

const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'getHiddenElementCount':
        getElementCount(request.tabId, 'elements').then(count => {
            callback(count);
        });
        return;

    case 'getScriptCount':
        getElementCount(request.tabId, 'scripts').then(count => {
            callback(count);
        });
        return;

    case 'getPopupData':
        popupDataFromRequest(request).then(popupData => {
            callback(popupData);
        });
        return;

    default:
        break;
    }

    // Sync
    let response;
    let pageStore;

    switch ( request.what ) {
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
        µb.updateToolbarIcon(request.tabId, 0b100);
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
            pageStore.toggleNetFilteringSwitch(
                request.url,
                request.scope,
                request.state
            );
            µb.updateToolbarIcon(request.tabId, 0b111);
        }
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen({
    name: 'popupPanel',
    listener: onMessage,
    privileged: true,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      contentscript
//      unprivileged

{
// >>>>> start of local scope

const µb = µBlock;

const retrieveContentScriptParameters = function(senderDetails, request) {
    if ( µb.readyToFilter !== true ) { return; }
    const { url, tabId, frameId } = senderDetails;
    if ( url === undefined || tabId === undefined || frameId === undefined ) {
        return;
    }
    if ( request.url !== url ) { return; }
    const pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore === null || pageStore.getNetFilteringSwitch() === false ) {
        return;
    }

    const noCosmeticFiltering = pageStore.noCosmeticFiltering === true;

    const response = {
        collapseBlocked: µb.userSettings.collapseBlocked,
        noCosmeticFiltering,
        noGenericCosmeticFiltering: noCosmeticFiltering,
        noSpecificCosmeticFiltering: noCosmeticFiltering,
    };

    // https://github.com/uBlockOrigin/uAssets/issues/5704
    //   `generichide` must be evaluated in the frame context.
    if ( noCosmeticFiltering === false ) {
        const genericHide =
            µb.staticNetFilteringEngine.matchStringReverse(
                'generichide',
                request.url
            );
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

    // https://www.reddit.com/r/uBlockOrigin/comments/d6vxzj/
    //   Add support for `specifichide`.
    if ( noCosmeticFiltering === false ) {
        const specificHide =
            µb.staticNetFilteringEngine.matchStringReverse(
                'specifichide',
                request.url
            );
        response.noSpecificCosmeticFiltering = specificHide === 2;
        if ( specificHide !== 0 && µb.logger.enabled ) {
            µBlock.filteringContext
                .duplicate()
                .fromTabId(tabId)
                .setURL(request.url)
                .setRealm('network')
                .setType('specifichide')
                .setFilter(µb.staticNetFilteringEngine.toLogData())
                .toLogger();
        }
    }

    // Cosmetic filtering can be effectively disabled when both specific and
    // generic cosmetic filtering are disabled.
    if (
        noCosmeticFiltering === false &&
        response.noGenericCosmeticFiltering &&
        response.noSpecificCosmeticFiltering
    ) {
        response.noCosmeticFiltering = true;
    }

    response.specificCosmeticFilters =
        µb.cosmeticFilteringEngine.retrieveSpecificSelectors(request, response);

    if ( µb.canInjectScriptletsNow === false ) {
        response.scriptlets = µb.scriptletFilteringEngine.retrieve(request);
    }

    if ( µb.logger.enabled && response.noCosmeticFiltering !== true ) {
        µb.logCosmeticFilters(tabId, frameId);
    }

    return response;
};

const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    default:
        break;
    }

    const senderDetails = µb.getMessageSenderDetails(sender);
    const pageStore = µb.pageStoreFromTabId(senderDetails.tabId);

    // Sync
    let response;

    switch ( request.what ) {
    case 'cosmeticFiltersInjected':
        µb.cosmeticFilteringEngine.addToSelectorCache(request);
        break;

    case 'getCollapsibleBlockedRequests':
        response = {
            id: request.id,
            hash: request.hash,
            netSelectorCacheCountMax:
                µb.cosmeticFilteringEngine.netSelectorCacheCountMax,
        };
        if (
            µb.userSettings.collapseBlocked &&
            pageStore && pageStore.getNetFilteringSwitch()
        ) {
            pageStore.getBlockedResources(request, response);
        }
        break;

    case 'maybeGoodPopup':
        µb.maybeGoodPopup.tabId = senderDetails.tabId;
        µb.maybeGoodPopup.url = request.url;
        break;

    case 'shouldRenderNoscriptTags':
        if ( pageStore === null ) { break; }
        const fctxt = µb.filteringContext.fromTabId(senderDetails.tabId);
        if ( pageStore.filterScripting(fctxt, undefined) ) {
            vAPI.tabs.executeScript(senderDetails.tabId, {
                file: '/js/scriptlets/noscript-spoof.js',
                frameId: senderDetails.frameId,
                runAt: 'document_end',
            });
        }
        break;

    case 'retrieveContentScriptParameters':
        response = retrieveContentScriptParameters(senderDetails, request);
        break;

    case 'retrieveGenericCosmeticSelectors':
        request.tabId = senderDetails.tabId;
        request.frameId = senderDetails.frameId;
        response = {
            result: µb.cosmeticFilteringEngine.retrieveGenericSelectors(request),
        };
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen({
    name: 'contentscript',
    listener: onMessage,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      elementPicker
//      unprivileged

{
// >>>>> start of local scope

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
                target: µb.epickerArgs.target,
                mouse: µb.epickerArgs.mouse,
                zap: µb.epickerArgs.zap,
                eprom: µb.epickerArgs.eprom,
            });

            µb.epickerArgs.target = '';
        };
        xhr.send();
        return;

    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'compileCosmeticFilterSelector':
        response = µb.staticExtFilteringEngine.compileSelector(
            request.selector
        );
        break;

    // https://github.com/gorhill/uBlock/issues/3497
    //   This needs to be removed once issue is fixed.
    case 'createUserFilter':
        µb.createUserFilters(request);
        break;

    case 'elementPickerEprom':
        µb.epickerArgs.eprom = request;
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen({
    name: 'elementPicker',
    listener: onMessage,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      cloudWidget
//      privileged

{
// >>>>> start of local scope

const onMessage = function(request, sender, callback) {
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
        return vAPI.cloud.pull(request.datakey).then(result => {
            callback(result);
        });

    case 'cloudPush':
        return vAPI.cloud.push(request.datakey, request.data).then(result => {
            callback(result);
        });

    default:
        break;
    }

    // Sync
    let response;

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

vAPI.messaging.listen({
    name: 'cloudWidget',
    listener: onMessage,
    privileged: true,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      dashboard
//      privileged

{
// >>>>> start of local scope

const µb = µBlock;

// Settings
const getLocalData = async function() {
    const data = Object.assign({}, µb.restoreBackupSettings);
    data.storageUsed = await µb.getBytesInUse();
    data.cloudStorageSupported = µb.cloudStorageSupported;
    data.privacySettingsSupported = µb.privacySettingsSupported;
    return data;
};

const backupUserData = async function() {
    const userFilters = await µb.loadUserFilters();

    const userData = {
        timeStamp: Date.now(),
        version: vAPI.app.version,
        userSettings: µb.userSettings,
        selectedFilterLists: µb.selectedFilterLists,
        hiddenSettings: µb.hiddenSettings,
        whitelist: µb.arrayFromWhitelist(µb.netWhitelist),
        // String representation eventually to be deprecated
        netWhitelist: µb.stringFromWhitelist(µb.netWhitelist),
        dynamicFilteringString: µb.permanentFirewall.toString(),
        urlFilteringString: µb.permanentURLFiltering.toString(),
        hostnameSwitchesString: µb.permanentSwitches.toString(),
        userFilters: userFilters.content,
    };

    const filename = vAPI.i18n('aboutBackupFilename')
        .replace('{{datetime}}', µb.dateNowToSensibleString())
        .replace(/ +/g, '_');
    µb.restoreBackupSettings.lastBackupFile = filename;
    µb.restoreBackupSettings.lastBackupTime = Date.now();
    vAPI.storage.set(µb.restoreBackupSettings);

    const localData = await getLocalData();

    return { localData, userData };
};

const restoreUserData = async function(request) {
    const userData = request.userData;

    // https://github.com/chrisaljoudi/uBlock/issues/1102
    //   Ensure all currently cached assets are flushed from storage AND memory.
    µb.assets.rmrf();

    // If we are going to restore all, might as well wipe out clean local
    // storages
    await Promise.all([
        µb.cacheStorage.clear(),
        vAPI.storage.clear(),
    ]);

    // Restore block stats
    µBlock.saveLocalSettings();

    // Restore user data
    vAPI.storage.set(userData.userSettings);
    let hiddenSettings = userData.hiddenSettings;
    if ( hiddenSettings instanceof Object === false ) {
        hiddenSettings = µBlock.hiddenSettingsFromString(
            userData.hiddenSettingsString || ''
        );
    }
    // Whitelist directives can be represented as an array or as a
    // (eventually to be deprecated) string.
    let whitelist = userData.whitelist;
    if (
        Array.isArray(whitelist) === false &&
        typeof userData.netWhitelist === 'string' &&
        userData.netWhitelist !== ''
    ) {
        whitelist = userData.netWhitelist.split('\n');
    }
    vAPI.storage.set({
        hiddenSettings: hiddenSettings,
        netWhitelist: whitelist || [],
        dynamicFilteringString: userData.dynamicFilteringString || '',
        urlFilteringString: userData.urlFilteringString || '',
        hostnameSwitchesString: userData.hostnameSwitchesString || '',
        lastRestoreFile: request.file || '',
        lastRestoreTime: Date.now(),
        lastBackupFile: '',
        lastBackupTime: 0
    });
    µb.saveUserFilters(userData.userFilters);
    if ( Array.isArray(userData.selectedFilterLists) ) {
         await µb.saveSelectedFilterLists(userData.selectedFilterLists);
    }

    vAPI.app.restart();
};

// Remove all stored data but keep global counts, people can become
// quite attached to numbers
const resetUserData = async function() {
    await Promise.all([
        µb.cacheStorage.clear(),
        vAPI.storage.clear(),
    ]);

    await µb.saveLocalSettings();

    vAPI.app.restart();
};

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

const getLists = async function(callback) {
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
    const [ lists, metadata ] = await Promise.all([
        µb.getAvailableLists(),
        µb.assets.metadata(),
    ]);
    r.available = lists;
    prepListEntries(r.available);
    r.cache = metadata;
    prepListEntries(r.cache);
    callback(r);
};

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

const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'backupUserData':
        return backupUserData().then(data => {
            callback(data);
        });

    case 'getLists':
        return getLists(callback);

    case 'getLocalData':
        return getLocalData().then(localData => {
            callback(localData);
        });

    case 'getShortcuts':
        return getShortcuts(callback);

    case 'readUserFilters':
        return µb.loadUserFilters().then(result => {
            callback(result);
        });

    case 'writeUserFilters':
        return µb.saveUserFilters(request.content).then(result => {
            callback(result);
        });

    default:
        break;
    }

    // Sync
    let response;

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
        break;

    case 'readHiddenSettings':
        response = {
            current: µb.hiddenSettings,
            default: µb.hiddenSettingsDefault,
        };
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

vAPI.messaging.listen({
    name: 'dashboard',
    listener: onMessage,
    privileged: true,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      loggerUI
//      privileged

{
// >>>>> start of local scope

const µb = µBlock;
const extensionOriginURL = vAPI.getURL('');

const getLoggerData = async function(details, activeTabId, callback) {
    const response = {
        activeTabId,
        colorBlind: µb.userSettings.colorBlindFriendly,
        entries: µb.logger.readAll(details.ownerId),
        filterAuthorMode: µb.hiddenSettings.filterAuthorMode,
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
    if ( details.popupLoggerBoxChanged && vAPI.windows instanceof Object ) {
        const tabs = await vAPI.tabs.query({
            url: vAPI.getURL('/logger-ui.html?popup=1')
        });
        if ( tabs.length !== 0 ) {
            const win = await vAPI.windows.get(tabs[0].windowId);
            if ( win === null ) { return; }
            vAPI.localStorage.setItem('popupLoggerBox', JSON.stringify({
                left: win.left,
                top: win.top,
                width: win.width,
                height: win.height,
            }));
        }
    }
    callback(response);
};

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

const compileTemporaryException = function(filter) {
    const match = /#@?#/.exec(filter);
    if ( match === null ) { return; }
    let selector = filter.slice(match.index + match[0].length).trim();
    let session;
    if ( selector.startsWith('+js') ) {
        session = µb.scriptletFilteringEngine.getSession();
    } else {
        if ( selector.startsWith('^') ) {
            session = µb.htmlFilteringEngine.getSession();
        } else {
            session = µb.cosmeticFilteringEngine.getSession();
        }
    }
    return { session, selector: session.compile(selector) };
};

const toggleTemporaryException = function(details) {
    const { session, selector } = compileTemporaryException(details.filter);
    if ( session.has(1, selector) ) {
        session.remove(1, selector);
        return false;
    }
    session.add(1, selector);
    return true;
};

const hasTemporaryException = function(details) {
    const { session, selector } = compileTemporaryException(details.filter);
    return session && session.has(1, selector);
};

const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'readAll':
        if (
            µb.logger.ownerId !== undefined &&
            µb.logger.ownerId !== request.ownerId
        ) {
            return callback({ unavailable: true });
        }
        vAPI.tabs.getCurrent().then(tab => {
            getLoggerData(request, tab && tab.id, callback);
        });
        return;

    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'hasTemporaryException':
        response = hasTemporaryException(request);
        break;

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

    case 'toggleTemporaryException':
        response = toggleTemporaryException(request);
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen({
    name: 'loggerUI',
    listener: onMessage,
    privileged: true,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      documentBlocked
//      privileged

{
// >>>>> start of local scope

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

vAPI.messaging.listen({
    name: 'documentBlocked',
    listener: onMessage,
    privileged: true,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      scriptlets
//      unprivileged

{
// >>>>> start of local scope

const µb = µBlock;

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

        const staticDirectives =
            µb.staticNetFilteringEngine.matchAndFetchData(fctxt, 'csp');
        for ( const directive of staticDirectives ) {
            if ( directive.result !== 1 ) { continue; }
            cspData.set(directive.getData('csp'), directive.logData());
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
    case 'applyFilterListSelection':
        response = µb.applyFilterListSelection(request);
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

    case 'reloadAllFilters':
        µb.loadFilterLists();
        return;

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

vAPI.messaging.listen({
    name: 'scriptlets',
    listener: onMessage,
});

// <<<<< end of local scope
}


/******************************************************************************/
/******************************************************************************/

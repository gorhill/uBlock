/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
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

import * as frameManager from './vapi-contexts.js';
import * as s14e from './s14e-serializer.js';
import * as sfp from './static-filtering-parser.js';

import {
    domainFromHostname,
    domainFromURI,
    hostnameFromURI,
    isNetworkURI,
} from './uri-utils.js';

import {
    permanentFirewall,
    permanentSwitches,
    permanentURLFiltering,
    sessionFirewall,
    sessionSwitches,
    sessionURLFiltering,
} from './filtering-engines.js';

import cacheStorage from './cachestorage.js';
import cosmeticFilteringEngine from './cosmetic-filtering.js';
import { denseBase64 } from './base64-custom.js';
import { filteringBehaviorChanged } from './broadcast.js';
import { getTrustedTokens } from './trusted-tokens.js';
import htmlFilteringEngine from './html-filtering.js';
import { i18n$ } from './i18n.js';
import io from './assets.js';
import logger from './logger.js';
import lz4Codec from './lz4.js';
import publicSuffixList from './publicsuffix.js';
import punycode from '../lib/punycode.js';
import { redirectEngine } from './redirect-engine.js';
import scriptletFilteringEngine from './scriptlet-filtering.js';
import { staticFilteringReverseLookup } from './reverselookup.js';
import staticNetFilteringEngine from './static-net-filtering.js';
import webRequest from './traffic.js';
import µb from './background.js';

/******************************************************************************/

// https://github.com/uBlockOrigin/uBlock-issues/issues/710
//   Listeners have a name and a "privileged" status.
//   The nameless default handler is always deemed "privileged".
//   Messages from privileged ports must never relayed to listeners
//   which are not privileged.

/******************************************************************************/
/******************************************************************************/

const browser = globalThis.browser ?? globalThis.chrome;

// Default handler
//      privileged

{
// >>>>> start of local scope

function clickToLoad(request, sender) {
    const { tabId, frameId } = sender;
    if ( tabId === undefined || frameId === undefined ) { return false; }
    const pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore === null ) { return false; }
    pageStore.clickToLoad(frameId, request.frameURL);
    return true;
}

function getDomainNames(targets) {
    return targets.map(target => {
        if ( typeof target !== 'string' ) { return ''; }
        return target.indexOf('/') !== -1
            ? domainFromURI(target) || ''
            : domainFromHostname(target) || target;
    });
}

async function onMessage(request, sender) {
    switch ( request.what ) {
    case 'getAssetContent': {
        const result = await io.get(request.url, {
            dontCache: true,
            needSourceURL: true,
        });
        result.trustedSource = µb.isTrustedList(result.assetKey);
        return result;
    }

    case 'listsFromNetFilter':
        return staticFilteringReverseLookup.fromNetFilter(request.rawFilter);

    case 'listsFromCosmeticFilter':
        return staticFilteringReverseLookup.fromExtendedFilter(request);

    case 'reloadAllFilters':
        await µb.loadFilterLists();
        return;

    case 'scriptlet': {
        return vAPI.tabs.executeScript(request.tabId, {
            file: `/js/scriptlets/${request.scriptlet}.js`
        });
    }

    case 'applyFilterListSelection':
        return µb.applyFilterListSelection(request);

    case 'clickToLoad':
        return clickToLoad(request, sender);

    case 'createUserFilter':
        µb.createUserFilters(request);
        break;

    case 'getAppData':
        return {
            name: self.browser.runtime.getManifest().name,
            version: vAPI.app.version,
            canBenchmark: µb.hiddenSettings.benchmarkDatasetURL !== 'unset',
        };

    case 'getDomainNames':
        return getDomainNames(request.targets);

    case 'getTrustedTokens':
        return Array.from(getTrustedTokens());

    case 'getWhitelist':
        return {
            whitelist: µb.trustedSites.toLines(),
            whitelistDefault: µb.defaultTrustedSiteDirectives,
        };

    case 'launchElementPicker':
        // Launched from some auxiliary pages, clear context menu coords.
        µb.epickerArgs.mouse = false;
        µb.elementPickerExec(request.tabId, 0, request.targetURL, request.zap);
        break;

    case 'loggerDisabled':
        µb.clearInMemoryFilters();
        break;

    case 'gotoURL':
        µb.openNewTab(request.details);
        break;

    case 'readyToFilter':
        return µb.readyToFilter;

    // https://github.com/uBlockOrigin/uBlock-issues/issues/1954
    //   In case of document-blocked page, navigate to blocked URL instead
    //   of forcing a reload.
    case 'reloadTab': {
        if ( request.tabId === frameManager.TAB_ID_NONE ) { break; }
        const { tabId, bypassCache, url, select } = request;
        const tab = await vAPI.tabs.get(tabId);
        if ( url && tab && url !== tab.url ) {
            vAPI.tabs.replace(tabId, url);
        } else {
            vAPI.tabs.reload(tabId, bypassCache === true);
        }
        if ( select && vAPI.tabs.select ) {
            vAPI.tabs.select(tabId);
        }
        break;
    }
    case 'setWhitelist':
        µb.trustedSites.fromText(request.whitelist);
        µb.saveWhitelist();
        filteringBehaviorChanged();
        break;

    case 'toggleHostnameSwitch':
        µb.toggleHostnameSwitch(request);
        break;

    case 'uiAccentStylesheet':
        µb.uiAccentStylesheet = request.stylesheet;
        break;

    case 'uiStyles':
        return {
            uiAccentCustom: µb.userSettings.uiAccentCustom,
            uiAccentCustom0: µb.userSettings.uiAccentCustom0,
            uiAccentStylesheet: µb.uiAccentStylesheet,
            uiStyles: µb.hiddenSettings.uiStyles,
            uiTheme: µb.userSettings.uiTheme,
        };

    case 'userSettings': {
        const response = µb.changeUserSettings(request.name, request.value);
        if ( response instanceof Object ) {
            if ( vAPI.net.canUncloakCnames !== true ) {
                response.cnameUncloakEnabled = undefined;
            }
            response.canLeakLocalIPAddresses =
                vAPI.browserSettings.canLeakLocalIPAddresses === true;
        }
        return response;
    }

    default:
        return vAPI.messaging.UNHANDLED;
    }
}

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

function createCounts() {
    return {
        blocked: { any: 0, frame: 0, script: 0 },
        allowed: { any: 0, frame: 0, script: 0 },
    };
}

function getHostnameDict(hostnameDetailsMap, out) {
    const hnDict = Object.create(null);
    const cnMap = [];

    const createDictEntry = (domain, hostname, details) => {
        if ( details.cname ) {
            cnMap.push([ details.cname, hostname ]);
        }
        hnDict[hostname] = { domain, counts: details.counts };
    };

    for ( const hnDetails of hostnameDetailsMap.values() ) {
        const hostname = hnDetails.hostname;
        if ( hnDict[hostname] !== undefined ) { continue; }
        const domain = domainFromHostname(hostname) || hostname;
        const dnDetails =
            hostnameDetailsMap.get(domain) || { counts: createCounts() };
        if ( hnDict[domain] === undefined ) {
            createDictEntry(domain, domain, dnDetails);
        }
        if ( hostname === domain ) { continue; }
        createDictEntry(domain, hostname, hnDetails);
    }

    out.hostnameDict = hnDict;
    out.cnameMap = cnMap;
}

const firewallRuleTypes = [
    '*',
    'image',
    '3p',
    'inline-script',
    '1p-script',
    '3p-script',
    '3p-frame',
];

function getFirewallRules(src, out) {
    const ruleset = out.firewallRules = {};
    const df = sessionFirewall;

    for ( const type of firewallRuleTypes ) {
        const r = df.lookupRuleData('*', '*', type);
        if ( r === undefined ) { continue; }
        ruleset[`/ * ${type}`] = r;
    }
    if ( typeof src !== 'string' ) { return; }

    for ( const type of firewallRuleTypes ) {
        const r = df.lookupRuleData(src, '*', type);
        if ( r === undefined ) { continue; }
        ruleset[`. * ${type}`] = r;
    }

    const { hostnameDict } = out;
    for ( const des in hostnameDict ) {
        let r = df.lookupRuleData('*', des, '*');
        if ( r !== undefined ) { ruleset[`/ ${des} *`] = r; }
        r = df.lookupRuleData(src, des, '*');
        if ( r !== undefined ) { ruleset[`. ${des} *`] = r; }
    }
}

function popupDataFromTabId(tabId, tabTitle) {
    const topURL = frameManager.getTopURL(tabId) ?? 'https://behind-the-scene/';
    const normalizedURL = µb.normalizeTabURL(topURL, tabId);
    const rootHostname = hostnameFromURI(normalizedURL);
    const µbus = µb.userSettings;
    const µbhs = µb.hiddenSettings;
    const r = {
        advancedUserEnabled: µbus.advancedUserEnabled,
        appName: vAPI.app.name,
        appVersion: vAPI.app.version,
        colorBlindFriendly: µbus.colorBlindFriendly,
        cosmeticFilteringSwitch: false,
        firewallPaneMinimized: µbus.firewallPaneMinimized,
        globalAllowedRequestCount: µb.requestStats.allowedCount,
        globalBlockedRequestCount: µb.requestStats.blockedCount,
        fontSize: µbhs.popupFontSize,
        godMode: µbhs.filterAuthorMode,
        isTrustedSite: true,
        userFiltersAreEnabled: µb.userFiltersAreEnabled(),
        rawURL: topURL,
        pageURL: normalizedURL,
        pageHostname: rootHostname,
        pageDomain: domainFromHostname(rootHostname),
        popupBlockedCount: 0,
        popupPanelSections: µbus.popupPanelSections,
        popupPanelDisabledSections: µbhs.popupPanelDisabledSections,
        popupPanelLockedSections: µbhs.popupPanelLockedSections,
        popupPanelHeightMode: µbhs.popupPanelHeightMode,
        popupPanelOrientation: µbhs.popupPanelOrientation,
        tabId,
        tabTitle,
        tooltipsDisabled: µbus.tooltipsDisabled,
    };

    if ( µbhs.uiPopupConfig !== 'unset' ) {
        r.uiPopupConfig = µbhs.uiPopupConfig;
    }

    const pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore ) {
        r.hasUnprocessedRequest = pageStore.hasUnprocessedRequest;
        r.pageCounts = pageStore.counts;
        r.isTrustedSite = pageStore.isTrusted();
        getHostnameDict(pageStore.getAllHostnameDetails(), r);
        r.contentLastModified = pageStore.contentLastModified;
        getFirewallRules(rootHostname, r);
        r.canElementPicker = isNetworkURI(r.rawURL);
        r.noPopups = sessionSwitches.evaluateZ(
            'no-popups',
            rootHostname
        );
        r.popupBlockedCount = pageStore.popupBlockedCount;
        r.noCosmeticFiltering = sessionSwitches.evaluateZ(
            'no-cosmetic-filtering',
            rootHostname
        );
        r.noLargeMedia = sessionSwitches.evaluateZ(
            'no-large-media',
            rootHostname
        );
        r.largeMediaCount = pageStore.largeMediaCount;
        r.noRemoteFonts = sessionSwitches.evaluateZ(
            'no-remote-fonts',
            rootHostname
        );
        r.remoteFontCount = pageStore.remoteFontCount;
        r.noScripting = sessionSwitches.evaluateZ(
            'no-scripting',
            rootHostname
        );
    } else {
        r.hostnameDict = {};
        getFirewallRules(undefined, r);
    }

    r.matrixIsDirty = sessionFirewall.hasSameRules(
        permanentFirewall,
        rootHostname,
        r.hostnameDict
    ) === false;
    if ( r.matrixIsDirty === false ) {
        r.matrixIsDirty = sessionSwitches.hasSameRules(
            permanentSwitches,
            rootHostname
        ) === false;
    }
    return r;
}

async function popupDataFromRequest(request) {
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
}

async function getElementCount(tabId, what) {
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
}

async function launchReporter(request) {
    const pageStore = µb.pageStoreFromTabId(request.tabId);
    if ( pageStore === null ) { return; }
    if ( pageStore.hasUnprocessedRequest ) {
        request.popupPanel.hasUnprocessedRequest = true;
    }

    const entries = await io.getUpdateAges({
        filters: µb.selectedFilterLists.slice()
    });
    const shouldUpdateLists = [];
    for ( const entry of entries ) {
        if ( entry.age < (2 * 60 * 60 * 1000) ) { continue; }
        shouldUpdateLists.push(entry.assetKey);
    }

    // https://github.com/gorhill/uBlock/commit/6efd8eb#commitcomment-107523558
    //   Important: for whatever reason, not using `document_start` causes the
    //   Promise returned by `tabs.executeScript()` to resolve only when the
    //   associated tab is closed.
    const cosmeticSurveyResults = await vAPI.tabs.executeScript(request.tabId, {
        allFrames: true,
        file: '/js/scriptlets/cosmetic-report.js',
        matchAboutBlank: true,
        runAt: 'document_start',
    });

    const filters = cosmeticSurveyResults.reduce((a, v) => {
        if ( Array.isArray(v) ) { a.push(...v); }
        return a;
    }, []);
    // Remove duplicate, truncate too long filters.
    if ( filters.length !== 0 ) {
        request.popupPanel.extended = Array.from(
            new Set(filters.map(s => s.length <= 64 ? s : `${s.slice(0, 64)}…`))
        );
    }

    const supportURL = new URL(vAPI.getURL('support.html'));
    supportURL.searchParams.set('pageURL', request.pageURL);
    supportURL.searchParams.set('popupPanel', JSON.stringify(request.popupPanel));
    if ( shouldUpdateLists.length ) {
        supportURL.searchParams.set('shouldUpdateLists', JSON.stringify(shouldUpdateLists));
    }
    return supportURL.href;
}

async function onMessage(request) {
    switch ( request.what ) {
    case 'getHiddenElementCount':
        return getElementCount(request.tabId, 'elements');

    case 'getScriptCount':
        return getElementCount(request.tabId, 'scripts');

    case 'getPopupData':
        return popupDataFromRequest(request);

    case 'dismissUnprocessedRequest': {
        const pageStore = µb.pageStoreFromTabId(request.tabId);
        if ( pageStore === null ) { break; }
        pageStore.hasUnprocessedRequest = false;
        µb.updateToolbarIcon(request.tabId, 0b110);
        break;
    }

    case 'hasPopupContentChanged': {
        const pageStore = µb.pageStoreFromTabId(request.tabId);
        const lastModified = pageStore?.contentLastModified ?? 0;
        return lastModified !== request.contentLastModified;
    }

    case 'launchReporter': {
        launchReporter(request).then(url => {
            if ( typeof url !== 'string' ) { return; }
            µb.openNewTab({ url, select: true, index: -1 });
        });
        break;
    }

    case 'revertFirewallRules':
        // TODO: use Set() to message around sets of hostnames
        sessionFirewall.copyRules(
            permanentFirewall,
            request.srcHostname,
            Object.assign(Object.create(null), request.desHostnames)
        );
        sessionSwitches.copyRules(
            permanentSwitches,
            request.srcHostname
        );
        // https://github.com/gorhill/uBlock/issues/188
        cosmeticFilteringEngine.removeFromSelectorCache(
            request.srcHostname,
            'net'
        );
        µb.updateToolbarIcon(request.tabId, 0b100);
        return popupDataFromTabId(request.tabId);

    case 'saveFirewallRules':
        // TODO: use Set() to message around sets of hostnames
        if (
            permanentFirewall.copyRules(
                sessionFirewall,
                request.srcHostname,
                Object.assign(Object.create(null), request.desHostnames)
            )
        ) {
            µb.savePermanentFirewallRules();
        }
        if (
            permanentSwitches.copyRules(
                sessionSwitches,
                request.srcHostname
            )
        ) {
            µb.saveHostnameSwitches();
        }
        break;

    case 'toggleHostnameSwitch':
        µb.toggleHostnameSwitch(request);
        return popupDataFromTabId(request.tabId);

    case 'toggleFirewallRule':
        µb.toggleFirewallRule(request);
        return popupDataFromTabId(request.tabId);

    case 'toggleTrustedStatus': {
        const pageStore = µb.pageStoreFromTabId(request.tabId);
        if ( pageStore ) {
            pageStore.toggleTrustedStatus(request.url, request.scope, request.state);
            µb.updateToolbarIcon(request.tabId, 0b111);
        }
        break;
    }
    default:
        return vAPI.messaging.UNHANDLED;
    }
}

vAPI.messaging.listen({ name: 'popupPanel',
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

async function retrieveContentScriptParameters(sender, request) {
    if ( µb.readyToFilter !== true ) { return; }
    const { tabId, frameId } = sender;
    if ( tabId === undefined || frameId === undefined ) { return; }

    const pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore === null || pageStore.isTrusted() ) { return; }

    // A content script may not always be able to successfully look up the
    // effective context, hence in such case we try again to look up here
    // using cached information about embedded frames.
    if ( frameId !== 0 ) {
        request.url = frameManager.getEffectiveURL(tabId, frameId);
    }

    const cosmeticFiltering = pageStore.getCosmeticFiltering(frameId);
    const response = {
        collapseBlocked: µb.userSettings.collapseBlocked,
        noGenericCosmeticFiltering: cosmeticFiltering.generic !== true,
        noSpecificCosmeticFiltering: cosmeticFiltering.specific !== true,
    };

    request.tabId = tabId;
    request.frameId = frameId;
    request.hostname = hostnameFromURI(request.url);
    request.domain = domainFromHostname(request.hostname);
    request.ancestors = frameManager.getAncestors({ tabId, frameId }).map(a => {
        a.hostname = hostnameFromURI(a.url);
        a.domain = domainFromHostname(a.hostname);
    });

    const scf = response.specificCosmeticFilters =
        cosmeticFilteringEngine.retrieveSpecificSelectors(request, response);

    // The procedural filterer's code is loaded only when needed and must be
    // present before returning response to caller.
    if (
        scf.proceduralFilters.length !== 0 || (
            logger.enabled && (
                scf.convertedProceduralFilters.length !== 0 ||
                scf.exceptedFilters.length !== 0                
            )
        )
    ) {
        await vAPI.tabs.executeScript(tabId, {
            allFrames: false,
            file: '/js/contentscript-extra.js',
            frameId,
            matchAboutBlank: true,
            runAt: 'document_start',
        });
    }

    // https://github.com/NanoMeow/QuickReports/issues/6#issuecomment-414516623
    //   Inject as early as possible to make the cosmetic logger code less
    //   sensitive to the removal of DOM nodes which may match injected
    //   cosmetic filters.
    if ( logger.enabled ) {
        const filters = scriptletFilteringEngine.retrieve(request);
        if ( filters ) {
            scriptletFilteringEngine.toLogger(request, filters);
        }
        if ( cosmeticFiltering.specific || cosmeticFiltering.generic ) {
            vAPI.tabs.executeScript(tabId, {
                allFrames: false,
                file: '/js/scriptlets/cosmetic-logger.js',
                frameId,
                matchAboutBlank: true,
                runAt: 'document_start',
            });
        }
    }

    return response;
}

async function onMessage(request, sender) {
    const pageStore = µb.pageStoreFromTabId(sender.tabId);

    switch ( request.what ) {
    case 'retrieveContentScriptParameters':
        return retrieveContentScriptParameters(sender, request);

    case 'cosmeticFiltersInjected':
        cosmeticFilteringEngine.addToSelectorCache(request);
        break;

    case 'disableGenericCosmeticFilteringSurveyor':
        cosmeticFilteringEngine.disableSurveyor(request);
        break;

    case 'getCollapsibleBlockedRequests': {
        const response = {
            id: request.id,
            hash: request.hash,
            netSelectorCacheCountMax:
                cosmeticFilteringEngine.netSelectorCacheCountMax,
        };
        if ( µb.userSettings.collapseBlocked ) {
            if ( pageStore && pageStore.isNotTrusted() ) {
                pageStore.getBlockedResources(request, response);
            }
        }
        return response;
    }

    case 'maybeGoodPopup':
        µb.maybeGoodPopup.tabId = sender.tabId;
        µb.maybeGoodPopup.url = request.url;
        break;

    case 'messageToLogger':
        if ( logger.enabled !== true ) { break; }
        logger.writeOne({
            tabId: sender.tabId,
            realm: 'message',
            type: request.type || 'info',
            keywords: [ 'scriptlet' ],
            text: request.text,
        });
        break;

    case 'shouldRenderNoscriptTags': {
        if ( pageStore === null ) { break; }
        if ( µb.hiddenSettings.noScriptingCSP !== µb.hiddenSettingsDefault.noScriptingCSP ) {
            break;
        }
        const fctxt = µb.filteringContext.fromTabId(sender.tabId);
        if ( pageStore.filterScripting(fctxt) ) {
            vAPI.tabs.executeScript(sender.tabId, {
                file: '/js/scriptlets/noscript-spoof.js',
                frameId: sender.frameId,
                runAt: 'document_end',
            });
        }
        break;
    }
    case 'retrieveGenericCosmeticSelectors':
        request.tabId = sender.tabId;
        request.frameId = sender.frameId;
        return {
            result: cosmeticFilteringEngine.retrieveGenericSelectors(request),
        };

    default:
        return vAPI.messaging.UNHANDLED;
    }
}

vAPI.messaging.listen({ name: 'contentscript',
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

// Pairing content script with extension page (picker user interface):
// 1. Content script requests pairing
// 2. Main process receives request from content script and stores data
//    required to message back content script directly
// 3. Extension page (picker user interface) requests pairing
// 4. Main process receives request from extension page: message back
//    pending content script that the extension page is paired
// 5. Content script established direct communication with extension page
//    using unique one-time pairing password
// This avoids having to rely on `onload` events to establish communication.
const contextPairing = {
    password: '',
    tabId: 0,
    frameId: 0,
    time: 0
};

async function onMessage(request, sender) {
    switch ( request.what ) {
    // The procedural filterer must be present in case the user wants to
    // type-in custom filters.
    case 'elementPickerArguments': {
        await vAPI.tabs.executeScript(sender.tabId, {
            allFrames: false,
            file: '/js/contentscript-extra.js',
            frameId: sender.frameId,
            matchAboutBlank: true,
            runAt: 'document_start',
        });
        const response = {
            target: µb.epickerArgs.target,
            mouse: µb.epickerArgs.mouse,
            zap: µb.epickerArgs.zap,
            eprom: µb.epickerArgs.eprom,
            url: `${vAPI.net.getWarURL('epicker-ui.html')}`,
        };
        µb.epickerArgs.target = '';
        return response;
    }

    case 'elementPickerPairing': {
        const now = Date.now();
        if ( request.contentScript ) {
            contextPairing.password = self.crypto.randomUUID();
            contextPairing.tabId = sender.tabId;
            contextPairing.frameId = sender.frameId;
            contextPairing.time = now;
            return { password: contextPairing.password };
        }
        const succeed = (now - contextPairing.time) < 2000;
        if ( succeed === false ) { return; }
        browser.tabs.sendMessage(contextPairing.tabId,
            { what: 'elementPickerPairing', succeed },
            { frameId: contextPairing.frameId }
        );
        return { password: contextPairing.password };
    }
    case 'elementPickerEprom':
        µb.epickerArgs.eprom = request;
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }
}

vAPI.messaging.listen({ name: 'elementPicker',
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

function fromBase64(encoded) {
    if ( typeof encoded !== 'string' ) {
        return Promise.resolve(encoded);
    }
    let u8array;
    try {
        u8array = denseBase64.decode(encoded);
    } catch {
    }
    return Promise.resolve(u8array !== undefined ? u8array : encoded);
}

async function onMessage(request) {
    // Cloud storage support is optional.
    if ( µb.cloudStorageSupported !== true ) { return; }

    switch ( request.what ) {
    case 'cloudGetOptions': {
        const options = vAPI.cloud.getOptions();
        options.enabled = µb.userSettings.cloudStorageEnabled === true;
        return options;
    }

    case 'cloudSetOptions':
        return vAPI.cloud.setOptions(request.options);

    case 'cloudPull':
        request.decode = encoded => {
            if ( s14e.isSerialized(encoded) ) {
                return s14e.deserializeAsync(encoded, { thread: true });
            }
            // Legacy decoding: needs to be kept around for the foreseeable future.
            return lz4Codec.decode(encoded, fromBase64);
        };
        return vAPI.cloud.pull(request);

    case 'cloudPush':
        request.encode = data => {
            const options = {
                compress: µb.hiddenSettings.cloudStorageCompression,
                thread: true,
            };
            return s14e.serializeAsync(data, options);
        };
        return vAPI.cloud.push(request);

    case 'cloudUsed':
        return vAPI.cloud.used(request.datakey);

    default:
        return vAPI.messaging.UNHANDLED;
    }
}

vAPI.messaging.listen({ name: 'cloudWidget',
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

// Settings
async function getLocalData() {
    const data = Object.assign({}, µb.restoreBackupSettings);
    data.storageUsed = await µb.getBytesInUse();
    data.cloudStorageSupported = µb.cloudStorageSupported;
    data.privacySettingsSupported = µb.privacySettingsSupported;
    return data;
}

async function backupUserData() {
    const userFilters = await µb.loadUserFilters();

    const userData = {
        timeStamp: Date.now(),
        version: vAPI.app.version,
        userSettings:
            µb.getModifiedSettings(µb.userSettings, µb.userSettingsDefault),
        selectedFilterLists: µb.selectedFilterLists,
        hiddenSettings:
            µb.getModifiedSettings(µb.hiddenSettings, µb.hiddenSettingsDefault),
        whitelist: µb.trustedSites.toLines(),
        dynamicFilteringString: permanentFirewall.toString(),
        urlFilteringString: permanentURLFiltering.toString(),
        hostnameSwitchesString: permanentSwitches.toString(),
        userFilters: userFilters.content.split('\n'),
    };

    const filename = i18n$('aboutBackupFilename')
        .replace('{{datetime}}', µb.dateNowToSensibleString())
        .replace(/ +/g, '_');
    µb.restoreBackupSettings.lastBackupFile = filename;
    µb.restoreBackupSettings.lastBackupTime = Date.now();
    vAPI.storage.set(µb.restoreBackupSettings);

    const localData = await getLocalData();

    return { localData, userData };
}

async function restoreUserData(request) {
    const userData = request.userData;

    // https://github.com/LiCybora/NanoDefenderFirefox/issues/196
    //   Backup data could be from Chromium platform or from an older
    //   Firefox version.
    if (
        vAPI.webextFlavor.soup.has('firefox') &&
        vAPI.app.intFromVersion(userData.version) <= 1031003011
    ) {
        userData.hostnameSwitchesString += '\nno-csp-reports: * true';
    }

    // List of external lists is meant to be a string.
    if ( Array.isArray(userData.externalLists) ) {
        userData.externalLists = userData.externalLists.join('\n');
    }

    // https://github.com/chrisaljoudi/uBlock/issues/1102
    //   Ensure all currently cached assets are flushed from storage AND memory.
    io.rmrf();

    // If we are going to restore all, might as well wipe out clean local
    // storages
    await Promise.all([
        cacheStorage.clear(),
        vAPI.storage.clear(),
    ]);

    // Restore block stats
    µb.saveLocalSettings();

    // Restore user data
    vAPI.storage.set(userData.userSettings);

    // Restore advanced settings.
    let hiddenSettings = userData.hiddenSettings;
    if ( hiddenSettings instanceof Object === false ) {
        hiddenSettings = µb.hiddenSettingsFromString(
            userData.hiddenSettingsString || ''
        );
    }
    // Discard unknown setting or setting with default value.
    for ( const key in hiddenSettings ) {
        if (
            Object.hasOwn(µb.hiddenSettingsDefault, key) === false ||
            hiddenSettings[key] === µb.hiddenSettingsDefault[key]
        ) {
            delete hiddenSettings[key];
        }
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
        hiddenSettings,
        netWhitelist: whitelist || [],
        dynamicFilteringString: userData.dynamicFilteringString || '',
        urlFilteringString: userData.urlFilteringString || '',
        hostnameSwitchesString: userData.hostnameSwitchesString || '',
        lastRestoreFile: request.file || '',
        lastRestoreTime: Date.now(),
        lastBackupFile: '',
        lastBackupTime: 0
    });
    const userFilters = Array.isArray(userData.userFilters)
        ? userData.userFilters.join('\n')
        : userData.userFilters;
    µb.saveUserFilters(userFilters);
    if ( Array.isArray(userData.selectedFilterLists) ) {
        await µb.saveSelectedFilterLists(userData.selectedFilterLists);
    }

    vAPI.app.restart();
}

// Remove all stored data but keep global counts, people can become
// quite attached to numbers
async function resetUserData() {
    await Promise.all([
        cacheStorage.clear(),
        vAPI.storage.clear(),
    ]);

    await µb.saveLocalSettings();

    vAPI.app.restart();
}

// Filter lists
function prepListEntries(entries) {
    for ( const k in entries ) {
        if ( Object.hasOwn(entries, k) === false ) { continue; }
        const entry = entries[k];
        if ( typeof entry.supportURL === 'string' && entry.supportURL !== '' ) {
            entry.supportName = hostnameFromURI(entry.supportURL);
        } else if ( typeof entry.homeURL === 'string' && entry.homeURL !== '' ) {
            const hn = hostnameFromURI(entry.homeURL);
            entry.supportURL = `http://${hn}/`;
            entry.supportName = domainFromHostname(hn);
        }
    }
}

async function getLists() {
    const r = {
        autoUpdate: µb.userSettings.autoUpdate,
        available: null,
        cache: null,
        cosmeticFilterCount: cosmeticFilteringEngine.getFilterCount(),
        current: µb.availableFilterLists,
        ignoreGenericCosmeticFilters: µb.userSettings.ignoreGenericCosmeticFilters,
        isUpdating: io.isUpdating(),
        netFilterCount: staticNetFilteringEngine.getFilterCount(),
        parseCosmeticFilters: µb.userSettings.parseAllABPHideFilters,
        suspendUntilListsAreLoaded: µb.userSettings.suspendUntilListsAreLoaded,
        userFiltersPath: µb.userFiltersPath
    };
    const [ lists, metadata ] = await Promise.all([
        µb.getAvailableLists(),
        io.metadata(),
    ]);
    r.available = lists;
    prepListEntries(r.available);
    r.cache = metadata;
    prepListEntries(r.cache);
    return r;
}

// My filters

// TODO: also return origin of embedded frames?
function getOriginHints() {
    const out = new Set();
    for ( const tabId of µb.pageStores.keys() ) {
        if ( tabId === -1 ) { continue; }
        const topURL = frameManager.getTopURL(tabId);
        if ( Boolean(topURL) === false ) { continue; }
        const rootHostname = hostnameFromURI(topURL);
        const rootDomain = domainFromHostname(rootHostname);
        if ( rootDomain.endsWith('-scheme') ) { continue; }
        const isPunycode = rootHostname.includes('xn--');
        out.add(isPunycode ? punycode.toUnicode(rootDomain) : rootDomain);
        if ( rootHostname === rootDomain ) { continue; }
        out.add(isPunycode ? punycode.toUnicode(rootHostname) : rootHostname);
    }
    return Array.from(out);
}

// My rules
function getRules() {
    return {
        permanentRules:
            permanentFirewall.toArray().concat(
                permanentSwitches.toArray(),
                permanentURLFiltering.toArray()
            ),
        sessionRules:
            sessionFirewall.toArray().concat(
                sessionSwitches.toArray(),
                sessionURLFiltering.toArray()
            ),
        pslSelfie: publicSuffixList.toSelfie?.(),
    };
}

function modifyRuleset(details) {
    let swRuleset, hnRuleset, urlRuleset;
    if ( details.permanent ) {
        swRuleset = permanentSwitches;
        hnRuleset = permanentFirewall;
        urlRuleset = permanentURLFiltering;
    } else {
        swRuleset = sessionSwitches;
        hnRuleset = sessionFirewall;
        urlRuleset = sessionURLFiltering;
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
}

// Support
async function getSupportData() {
    const diffArrays = function(modified, original) {
        const modifiedSet = new Set(modified);
        const originalSet = new Set(original);
        let added = [];
        let removed = [];
        for ( const item of modifiedSet ) {
            if ( originalSet.has(item) ) { continue; }
            added.push(item);
        }
        for ( const item of originalSet ) {
            if ( modifiedSet.has(item) ) { continue; }
            removed.push(item);
        }
        if ( added.length === 0 ) {
            added = undefined;
        }
        if ( removed.length === 0 ) {
            removed = undefined;
        }
        if ( added !== undefined || removed !== undefined ) {
            return { added, removed };
        }
    };

    const modifiedUserSettings = µb.getModifiedSettings(
        µb.userSettings,
        µb.userSettingsDefault
    );

    const modifiedHiddenSettings = µb.getModifiedSettings(
        µb.hiddenSettings,
        µb.hiddenSettingsDefault
    );

    let filterset = [];
    const userFilters = await µb.loadUserFilters();
    for ( const line of userFilters.content.split(/\s*\n+\s*/) ) {
        if ( /^($|![^#])/.test(line) ) { continue; }
        filterset.push(line);
    }

    const now = Date.now();

    const formatDelayFromNow = list => {
        const time = list.writeTime;
        if ( typeof time !== 'number' || time === 0 ) { return 'never'; }
        if ( (time || 0) === 0 ) { return '?'; }
        const delayInSec = (now - time) / 1000;
        const days = (delayInSec / 86400) | 0;
        const hours = (delayInSec % 86400) / 3600 | 0;
        const minutes = (delayInSec % 3600) / 60 | 0;
        const parts = [];
        if ( days > 0 ) { parts.push(`${days}d`); }
        if ( hours > 0 ) { parts.push(`${hours}h`); }
        if ( minutes > 0 ) { parts.push(`${minutes}m`); }
        if ( parts.length === 0 ) { parts.push('now'); }
        const out = parts.join('.');
        if ( list.diffUpdated ) { return `${out} Δ`; }
        return out;
    };

    const lists = µb.availableFilterLists;
    let defaultListset = {};
    let addedListset = {};
    let removedListset = {};
    for ( const listKey in lists ) {
        if ( Object.hasOwn(lists, listKey) === false ) { continue; }
        const list = lists[listKey];
        if ( list.content !== 'filters' ) { continue; }
        const used = µb.selectedFilterLists.includes(listKey);
        const listDetails = [];
        if ( used ) {
            if ( typeof list.entryCount === 'number' ) {
                listDetails.push(`${list.entryCount}-${list.entryCount-list.entryUsedCount}`);
            }
            listDetails.push(formatDelayFromNow(list));
        }
        if ( list.isDefault || listKey === µb.userFiltersPath ) {
            if ( used ) {
                defaultListset[listKey] = listDetails.join(', ');
            } else {
                removedListset[listKey] = null;
            }
        } else if ( used ) {
            addedListset[listKey] = listDetails.join(', ');
        }
    }
    if ( Object.keys(defaultListset).length === 0 ) {
        defaultListset = undefined;
    }
    if ( Object.keys(addedListset).length === 0 ) {
        addedListset = undefined;
    } else {
        const added = Object.keys(addedListset);
        const truncated = added.slice(12);
        for ( const key of truncated ) {
            delete addedListset[key];
        }
        if ( truncated.length !== 0 ) {
            addedListset[`[${truncated.length} lists not shown]`] = '[too many]';
        }
    }
    if ( Object.keys(removedListset).length === 0 ) {
        removedListset = undefined;
    }

    let browserFamily = (( ) => {
        if ( vAPI.webextFlavor.soup.has('firefox') ) { return 'Firefox'; }
        if ( vAPI.webextFlavor.soup.has('chromium') ) { return 'Chromium'; }
        return 'Unknown';
    })();
    if ( vAPI.webextFlavor.soup.has('mobile') ) {
        browserFamily += ' Mobile';
    }

    return {
        [`${vAPI.app.name}`]: `${vAPI.app.version}`,
        [`${browserFamily}`]: `${vAPI.webextFlavor.major}`,
        'filterset (summary)': {
            network: staticNetFilteringEngine.getFilterCount(),
            cosmetic: cosmeticFilteringEngine.getFilterCount(),
            scriptlet: scriptletFilteringEngine.getFilterCount(),
            html: htmlFilteringEngine.getFilterCount(),
        },
        'listset (total-discarded, last-updated)': {
            removed: removedListset,
            added: addedListset,
            default: defaultListset,
        },
        'filterset (user)': filterset,
        trustedset: diffArrays(
            µb.trustedSites.toLines(),
            µb.defaultTrustedSiteDirectives
        ),
        switchRuleset: diffArrays(
            sessionSwitches.toArray(),
            µb.hostnameSwitchesDefault
        ),
        hostRuleset: diffArrays(
            sessionFirewall.toArray(),
            µb.dynamicFilteringDefault
        ),
        urlRuleset: diffArrays(
            sessionURLFiltering.toArray(),
            []
        ),
        'userSettings': modifiedUserSettings,
        'hiddenSettings': modifiedHiddenSettings,
        supportStats: µb.supportStats,
    };
}

async function onMessage(request) {
    switch ( request.what ) {
    case 'backupUserData':
        return backupUserData();

    case 'getLists':
        await µb.isReadyPromise;
        return getLists();

    case 'getLocalData':
        return getLocalData();

    case 'getSupportData': {
        return getSupportData();
    }

    case 'readUserFilters': {
        const result = await µb.loadUserFilters();
        result.enabled = µb.selectedFilterLists.includes(µb.userFiltersPath);
        result.trusted = µb.isTrustedList(µb.userFiltersPath);
        return result;
    }

    case 'writeUserFilters':
        if ( request.enabled ) {
            µb.applyFilterListSelection({
                toSelect: [ µb.userFiltersPath ],
                merge: true,
            });
        } else {
            µb.applyFilterListSelection({
                toRemove: [ µb.userFiltersPath ],
            });
        }
        µb.changeUserSettings('userFiltersTrusted', request.trusted || false);
        return µb.saveUserFilters(request.content);

    case 'dashboardConfig':
        return { noDashboard: µb.noDashboard };

    case 'getAutoCompleteDetails': {
        const response = {};
        if ( (request.hintUpdateToken || 0) === 0 ) {
            response.redirectResources = redirectEngine.getResourceDetails();
            response.preparseDirectiveEnv = vAPI.webextFlavor.env.slice();
            response.preparseDirectiveHints = sfp.utils.preparser.getHints();
        }
        if ( request.hintUpdateToken !== µb.pageStoresToken ) {
            response.originHints = getOriginHints();
            response.hintUpdateToken = µb.pageStoresToken;
        }
        return response;
    }

    case 'getRules':
        return getRules();

    case 'modifyRuleset':
        // https://github.com/chrisaljoudi/uBlock/issues/772
        cosmeticFilteringEngine.removeFromSelectorCache('*');
        modifyRuleset(request);
        return getRules();

    case 'supportUpdateNow': {
        const { assetKeys } = request;
        if ( assetKeys.length === 0 ) { return; }
        for ( const assetKey of assetKeys ) {
            io.purge(assetKey);
        }
        µb.scheduleAssetUpdater({ now: true, fetchDelay: 100 });
        break;
    }

    case 'listsUpdateNow': {
        const { assetKeys, preferOrigin = false } = request;
        if ( assetKeys.length === 0 ) { return; }
        for ( const assetKey of assetKeys ) {
            io.purge(assetKey);
        }
        µb.scheduleAssetUpdater({ now: true, fetchDelay: 100, auto: preferOrigin !== true });
        break;
    }

    case 'readHiddenSettings':
        return {
            'default': µb.hiddenSettingsDefault,
            'admin': µb.hiddenSettingsAdmin,
            'current': µb.hiddenSettings,
        };

    case 'restoreUserData':
        restoreUserData(request);
        break;

    case 'resetUserData':
        resetUserData();
        break;

    case 'updateNow':
        µb.scheduleAssetUpdater({ now: true, fetchDelay: 100, auto: true });
        break;

    case 'writeHiddenSettings':
        µb.changeHiddenSettings(µb.hiddenSettingsFromString(request.content));
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }
}

vAPI.messaging.listen({ name: 'dashboard',
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

const extensionOriginURL = vAPI.getURL('');
const documentBlockedURL = vAPI.getURL('document-blocked.html');

async function getLoggerData(details, activeTabId) {
    const response = {
        activeTabId,
        colorBlind: µb.userSettings.colorBlindFriendly,
        entries: logger.readAll(details.ownerId),
        tabIdsToken: µb.pageStoresToken,
        tooltips: µb.userSettings.tooltipsDisabled === false
    };
    if ( µb.pageStoresToken !== details.tabIdsToken ) {
        response.tabIds = [];
        for ( const [ tabId, pageStore ] of µb.pageStores ) {
            const { rawURL, title } = pageStore;
            if ( rawURL.startsWith(extensionOriginURL) ) {
                if ( rawURL.startsWith(documentBlockedURL) === false ) { continue; }
            }
            response.tabIds.push([ tabId, title ]);
        }
    }
    if ( activeTabId ) {
        const pageStore = µb.pageStoreFromTabId(activeTabId);
        const rawURL = pageStore && pageStore.rawURL;
        if (
            rawURL === null ||
            rawURL.startsWith(extensionOriginURL) &&
                rawURL.startsWith(documentBlockedURL) === false
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
    return response;
}

function getURLFilteringData(details) {
    const colors = {};
    const response = {
        dirty: false,
        colors: colors
    };
    const suf = sessionURLFiltering;
    const puf = permanentURLFiltering;
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
        const pown = (
            puf.r !== 0 &&
            puf.context === context &&
            puf.url === url &&
            puf.type === type
        );
        response.dirty = colorEntry.own !== pown || colorEntry.r !== puf.r;
    }
    return response;
}

async function onMessage(request) {
    switch ( request.what ) {
    case 'readAll': {
        if ( logger.ownerId !== undefined && logger.ownerId !== request.ownerId ) {
            return { unavailable: true };
        }
        const tab = await vAPI.tabs.getCurrent();
        return getLoggerData(request, tab && tab.id);
    }

    case 'toggleInMemoryFilter':
        return µb.hasInMemoryFilter(request.filter)
            ? µb.removeInMemoryFilter(request.filter)
            : µb.addInMemoryFilter(request.filter);

    case 'hasInMemoryFilter':
        return µb.hasInMemoryFilter(request.filter);

    case 'releaseView':
        if ( request.ownerId !== logger.ownerId ) { break; }
        logger.ownerId = undefined;
        µb.clearInMemoryFilters();
        break;

    case 'saveURLFilteringRules': {
        const response = permanentURLFiltering.copyRules(
            sessionURLFiltering,
            request.context,
            request.urls,
            request.type
        );
        if ( response ) {
            µb.savePermanentURLFilteringRules();
        }
        return response;
    }

    case 'setURLFilteringRule':
        µb.toggleURLFilteringRule(request);
        break;

    case 'getURLFilteringData':
        return getURLFilteringData(request);

    default:
        return vAPI.messaging.UNHANDLED;
    }
}

vAPI.messaging.listen({ name: 'loggerUI',
    listener: onMessage,
    privileged: true,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      domInspectorContent
//      unprivileged

{
// >>>>> start of local scope

async function onMessage(request, sender) {
    switch ( request.what ) {
    case 'getInspectorArgs': {
        const bc = new globalThis.BroadcastChannel('contentInspectorChannel');
        bc.postMessage({
            what: 'contentInspectorChannel',
            tabId: sender.tabId ?? 0,
            frameId: sender.frameId ?? 0,
        });
        return {
            url: `${vAPI.net.getWarURL('dom-inspector.html')}`,
        };
    }
    default:
        return vAPI.messaging.UNHANDLED;
    }
}

vAPI.messaging.listen({ name: 'domInspectorContent',
    listener: onMessage,
    rivileged: false,
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

async function onMessage(request, sender) {
    const tabId = sender.tabId ?? 0;

    switch ( request.what ) {
    case 'closeThisTab':
        vAPI.tabs.remove(tabId);
        break;

    case 'temporarilyWhitelistDocument':
        webRequest.strictBlockBypass(request.hostname);
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }
}

vAPI.messaging.listen({ name: 'documentBlocked',
    listener: onMessage,
    privileged: true,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      devTools
//      privileged

{
// >>>>> start of local scope

async function onMessage(request) {
    switch ( request.what ) {
    case 'purgeAllCaches': {
        const bytesInUseBefore = await µb.getBytesInUse();
        await io.remove(/./);
        const bytesInUseAfter = await µb.getBytesInUse();
        return [
            `Storage used before: ${µb.formatCount(bytesInUseBefore)}B`,
            `Storage used after: ${µb.formatCount(bytesInUseAfter)}B`,
        ].join('\n');
    }

    case 'snfeBenchmark': {
        const module = await import('/js/benchmarks.js');
        return module.benchmarkStaticNetFiltering({ redirectEngine });
    }

    case 'cfeBenchmark': {
        const module = await import('/js/benchmarks.js');
        return module.benchmarkCosmeticFiltering();
    }

    case 'sfeBenchmark': {
        const module = await import('/js/benchmarks.js');
        return module.benchmarkScriptletFiltering();
    }

    case 'snfeToDNR': {
        const listPromises = [];
        const listNames = [];
        for ( const assetKey of µb.selectedFilterLists ) {
            listPromises.push(
                io.get(assetKey, { dontCache: true }).then(details => {
                    listNames.push(assetKey);
                    return {
                        name: assetKey,
                        text: details.content,
                        trustedSource: assetKey.startsWith('ublock-') ||
                            assetKey === µb.userFiltersPath &&
                                µb.userSettings.userFiltersTrusted,
                    };
                })
            );
        }
        const options = {
            extensionPaths: redirectEngine.getResourceDetails().filter(e =>
                typeof e[1].extensionPath === 'string' && e[1].extensionPath !== ''
            ).map(e =>
                [ e[0], e[1].extensionPath ]
            ),
            env: vAPI.webextFlavor.env,
        };
        const module = await import('./static-dnr-filtering.js');
        const t0 = Date.now();
        const dnrdata = await module.dnrRulesetFromRawLists(listPromises, options);
        dnrdata.listNames = listNames;
        dnrdata.runtime = Date.now() - t0;
        return s14e.serialize(dnrdata);
    }

    case 'snfeDump':
        return staticNetFilteringEngine.dump();

    case 'snfeQuery':
        return staticNetFilteringEngine.test(
            Object.assign({ redirectEngine }, request.query)
        );

    case 'cfeDump':
        return cosmeticFilteringEngine.dump();

    default:
        return vAPI.messaging.UNHANDLED;
    }
}

vAPI.messaging.listen({ name: 'devTools',
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

function logCosmeticFilters(tabId, details) {
    if ( logger.enabled === false ) { return; }

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
}

function logCSPViolations(pageStore, request) {
    if ( logger.enabled === false || pageStore === null ) {
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
            staticNetFilteringEngine.matchAndFetchModifiers(fctxt, 'csp');
        if ( staticDirectives !== undefined ) {
            for ( const directive of staticDirectives ) {
                if ( directive.result !== 1 ) { continue; }
                cspData.set(directive.value, directive.logData());
            }
        }

        fctxt.type = 'inline-script';
        fctxt.filter = undefined;
        if ( pageStore.filterRequest(fctxt) === 1 ) {
            cspData.set(µb.cspNoInlineScript, fctxt.filter);
        }

        fctxt.type = 'script';
        fctxt.filter = undefined;
        if ( pageStore.filterScripting(fctxt, false) === 1 ) {
            cspData.set(µb.hiddenSettings.noScriptingCSP, fctxt.filter);
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
        // The resource was blocked as a result of applying a CSP directive
        // elsewhere rather than to the resource itself.
        logData.modifier = undefined;
        fctxt.setURL(violation.url)
             .setType(type)
             .setFilter(logData)
             .toLogger();
    }

    return true;
}

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

async function onMessage(request, sender) {
    const tabId = sender.tabId ?? 0;
    const pageStore = µb.pageStoreFromTabId(tabId);

    switch ( request.what ) {
    case 'inlinescriptFound':
        if ( logger.enabled && pageStore !== null ) {
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
        return logCSPViolations(pageStore, request);

    case 'temporarilyAllowLargeMediaElement':
        if ( pageStore === null ) { break; }
        pageStore.allowLargeMediaElementsUntil = Date.now() + 5000;
        break;

    case 'subscribeTo': {
        // https://github.com/uBlockOrigin/uBlock-issues/issues/1797
        if ( /^(file|https?):\/\//.test(request.location) === false ) { break; }
        const url = encodeURIComponent(request.location);
        const title = encodeURIComponent(request.title);
        const hash = µb.selectedFilterLists.indexOf(request.location) !== -1
            ? '#subscribed'
            : '';
        vAPI.tabs.open({
            url: `/asset-viewer.html?url=${url}&title=${title}&subscribe=1${hash}`,
            select: true,
        });
        break;
    }
    case 'updateLists': {
        const listkeys = request.listkeys.split(',').filter(s => s !== '');
        if ( listkeys.length === 0 ) { return; }
        if ( listkeys.includes('all') ) {
            io.purge(/./, 'public_suffix_list.dat');
        } else {
            for ( const listkey of listkeys ) {
                io.purge(listkey);
            }
        }
        µb.openNewTab({
            url: 'dashboard.html#3p-filters.html',
            select: true,
        });
        µb.scheduleAssetUpdater({ now: true, fetchDelay: 100, auto: request.auto });
        break;
    }
    default:
        return vAPI.messaging.UNHANDLED;
    }
}

vAPI.messaging.listen({ name: 'scriptlets',
    listener: onMessage,
});

// <<<<< end of local scope
}


/******************************************************************************/
/******************************************************************************/

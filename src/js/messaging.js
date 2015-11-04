/*******************************************************************************

    uBlock - a browser extension to block requests.
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

/* global µBlock, vAPI */

/******************************************************************************/
/******************************************************************************/

// Default handler

(function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var getDomainNames = function(targets) {
    var out = [];
    var µburi = µb.URI;
    var target, domain;
    for ( var i = 0; i < targets.length; i++ ) {
        target = targets[i];
        if ( target.indexOf('/') !== -1 ) {
            domain = µburi.domainFromURI(target) || '';
        } else {
            domain = µburi.domainFromHostname(target) || target;
        }
        out.push(domain);
    }
    return out;
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'getAssetContent':
        // https://github.com/chrisaljoudi/uBlock/issues/417
        µb.assets.get(request.url, callback);
        return;

    case 'listsFromNetFilter':
        µb.staticFilteringReverseLookup.fromNetFilter(
            request.compiledFilter,
            request.rawFilter,
            callback
        );
        return;

    case 'listsFromCosmeticFilter':
        µb.staticFilteringReverseLookup.fromCosmeticFilter(
            request.hostname,
            request.rawFilter,
            callback
        );
        return;

    case 'reloadAllFilters':
        µb.reloadAllFilters(callback);
        return;

    case 'scriptlet':
        µb.scriptlets.inject(request.tabId, request.scriptlet, callback);
        return;

    default:
        break;
    }

    var tabId = sender && sender.tab ? sender.tab.id : 0;

    // Sync
    var response;

    switch ( request.what ) {
    case 'mouseClick':
        µb.mouseX = request.x;
        µb.mouseY = request.y;
        µb.mouseURL = request.url;
        break;

    case 'cosmeticFiltersInjected':
        µb.cosmeticFilteringEngine.addToSelectorCache(request);
        /* falls through */
    case 'cosmeticFiltersActivated':
        // Net-based cosmetic filters are of no interest for logging purpose.
        if ( µb.logger.isEnabled() && request.type !== 'net' ) {
            µb.logCosmeticFilters(tabId);
        }
        break;

    case 'createUserFilter':
        µb.appendUserFilters(request.filters);
        break;

    case 'forceUpdateAssets':
        µb.assetUpdater.force();
        break;

    case 'getAppData':
        response = {name: vAPI.app.name, version: vAPI.app.version};
        break;

    case 'getDomainNames':
        response = getDomainNames(request.targets);
        break;

    case 'getUserSettings':
        response = µb.userSettings;
        break;

    case 'launchElementPicker':
        // Launched from some auxiliary pages, clear context menu coords.
        µb.mouseX = µb.mouseY = -1;
        µb.elementPickerExec(request.tabId, request.targetURL);
        break;

    case 'gotoURL':
        vAPI.tabs.open(request.details);
        break;

    case 'reloadTab':
        if ( vAPI.isBehindTheSceneTabId(request.tabId) === false ) {
            vAPI.tabs.reload(request.tabId);
            if ( request.select && vAPI.tabs.select ) {
                vAPI.tabs.select(request.tabId);
            }
        }
        break;

    case 'scriptletResponse':
        µb.scriptlets.report(tabId, request.scriptlet, request.response);
        break;

    case 'selectFilterLists':
        µb.selectFilterLists(request.switches);
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

// popup.js

(function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var getHostnameDict = function(hostnameToCountMap) {
    var r = {}, de;
    var domainFromHostname = µb.URI.domainFromHostname;
    var domain, counts, blockCount, allowCount;
    for ( var hostname in hostnameToCountMap ) {
        if ( hostnameToCountMap.hasOwnProperty(hostname) === false ) {
            continue;
        }
        if ( r.hasOwnProperty(hostname) ) {
            continue;
        }
        domain = domainFromHostname(hostname) || hostname;
        counts = hostnameToCountMap[domain] || 0;
        blockCount = counts & 0xFFFF;
        allowCount = counts >>> 16 & 0xFFFF;
        if ( r.hasOwnProperty(domain) === false ) {
            de = r[domain] = {
                domain: domain,
                blockCount: blockCount,
                allowCount: allowCount,
                totalBlockCount: 0,
                totalAllowCount: 0
            };
        } else {
            de = r[domain];
        }
        counts = hostnameToCountMap[hostname] || 0;
        blockCount = counts & 0xFFFF;
        allowCount = counts >>> 16 & 0xFFFF;
        de.totalBlockCount += blockCount;
        de.totalAllowCount += allowCount;
        if ( hostname === domain ) {
            continue;
        }
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
    r['/ * *'] = df.evaluateCellZY('*', '*', '*').toFilterString();
    r['/ * image'] = df.evaluateCellZY('*', '*', 'image').toFilterString();
    r['/ * 3p'] = df.evaluateCellZY('*', '*', '3p').toFilterString();
    r['/ * inline-script'] = df.evaluateCellZY('*', '*', 'inline-script').toFilterString();
    r['/ * 1p-script'] = df.evaluateCellZY('*', '*', '1p-script').toFilterString();
    r['/ * 3p-script'] = df.evaluateCellZY('*', '*', '3p-script').toFilterString();
    r['/ * 3p-frame'] = df.evaluateCellZY('*', '*', '3p-frame').toFilterString();
    if ( typeof srcHostname !== 'string' ) {
        return r;
    }

    r['. * *'] = df.evaluateCellZY(srcHostname, '*', '*').toFilterString();
    r['. * image'] = df.evaluateCellZY(srcHostname, '*', 'image').toFilterString();
    r['. * 3p'] = df.evaluateCellZY(srcHostname, '*', '3p').toFilterString();
    r['. * inline-script'] = df.evaluateCellZY(srcHostname, '*', 'inline-script').toFilterString();
    r['. * 1p-script'] = df.evaluateCellZY(srcHostname, '*', '1p-script').toFilterString();
    r['. * 3p-script'] = df.evaluateCellZY(srcHostname, '*', '3p-script').toFilterString();
    r['. * 3p-frame'] = df.evaluateCellZY(srcHostname, '*', '3p-frame').toFilterString();

    for ( var desHostname in desHostnames ) {
        if ( desHostnames.hasOwnProperty(desHostname) ) {
            r['/ ' + desHostname + ' *'] = df.evaluateCellZY('*', desHostname, '*').toFilterString();
            r['. ' + desHostname + ' *'] = df.evaluateCellZY(srcHostname, desHostname, '*').toFilterString();
        }
    }
    return r;
};

/******************************************************************************/

var popupDataFromTabId = function(tabId, tabTitle) {
    var tabContext = µb.tabContextManager.lookup(tabId);
    var r = {
        advancedUserEnabled: µb.userSettings.advancedUserEnabled,
        appName: vAPI.app.name,
        appVersion: vAPI.app.version,
        colorBlindFriendly: µb.userSettings.colorBlindFriendly,
        cosmeticFilteringSwitch: false,
        dfEnabled: µb.userSettings.dynamicFilteringEnabled,
        firewallPaneMinimized: µb.userSettings.firewallPaneMinimized,
        globalAllowedRequestCount: µb.localSettings.allowedRequestCount,
        globalBlockedRequestCount: µb.localSettings.blockedRequestCount,
        netFilteringSwitch: false,
        rawURL: tabContext.rawURL,
        pageURL: tabContext.normalURL,
        pageHostname: tabContext.rootHostname,
        pageDomain: tabContext.rootDomain,
        pageAllowedRequestCount: 0,
        pageBlockedRequestCount: 0,
        tabId: tabId,
        tabTitle: tabTitle
    };

    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore ) {
        r.pageBlockedRequestCount = pageStore.perLoadBlockedRequestCount;
        r.pageAllowedRequestCount = pageStore.perLoadAllowedRequestCount;
        r.netFilteringSwitch = pageStore.getNetFilteringSwitch();
        r.hostnameDict = getHostnameDict(pageStore.hostnameToCountMap);
        r.contentLastModified = pageStore.contentLastModified;
        r.firewallRules = getFirewallRules(tabContext.rootHostname, r.hostnameDict);
        r.canElementPicker = tabContext.rootHostname.indexOf('.') !== -1;
        r.noPopups = µb.hnSwitches.evaluateZ('no-popups', tabContext.rootHostname);
        r.noStrictBlocking = µb.hnSwitches.evaluateZ('no-strict-blocking', tabContext.rootHostname);
        r.noCosmeticFiltering = µb.hnSwitches.evaluateZ('no-cosmetic-filtering', tabContext.rootHostname);
        r.noRemoteFonts = µb.hnSwitches.evaluateZ('no-remote-fonts', tabContext.rootHostname);
        r.remoteFontCount = pageStore.remoteFontCount;
    } else {
        r.hostnameDict = {};
        r.firewallRules = getFirewallRules();
    }
    r.matrixIsDirty = !µb.sessionFirewall.hasSameRules(
        µb.permanentFirewall,
        tabContext.rootHostname,
        r.hostnameDict
    );
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

var getPopupDataLazy = function(tabId, callback) {
    var r = {
        hiddenElementCount: ''
    };
    var pageStore = µb.pageStoreFromTabId(tabId);

    if ( !pageStore ) {
        callback(r);
        return;
    }

    µb.scriptlets.inject(tabId, 'cosmetic-survey', function() {
        r.hiddenElementCount = pageStore.hiddenElementCount;
        callback(r);
    });
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'getPopupDataLazy':
        getPopupDataLazy(request.tabId, callback);
        return;

    case 'getPopupData':
        popupDataFromRequest(request, callback);
        return;

    default:
        break;
    }

    // Sync
    var pageStore;
    var response;

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
        // https://github.com/gorhill/uBlock/issues/188
        µb.cosmeticFilteringEngine.removeFromSelectorCache(request.srcHostname, 'net');
        response = popupDataFromTabId(request.tabId);
        break;

    case 'saveFirewallRules':
        µb.permanentFirewall.copyRules(
            µb.sessionFirewall,
            request.srcHostname,
            request.desHostnames
        );
        µb.savePermanentFirewallRules();
        break;

    case 'toggleFirewallRule':
        µb.toggleFirewallRule(request);
        response = popupDataFromTabId(request.tabId);
        break;

    case 'toggleNetFiltering':
        pageStore = µb.pageStoreFromTabId(request.tabId);
        if ( pageStore ) {
            pageStore.toggleNetFilteringSwitch(request.url, request.scope, request.state);
            µb.updateBadgeAsync(request.tabId);
        }
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('popup.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// contentscript-start.js

(function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    default:
        break;
    }

    // Sync
    var response;

    var pageStore;
    if ( sender && sender.tab ) {
        pageStore = µb.pageStoreFromTabId(sender.tab.id);
    }

    switch ( request.what ) {
    case 'retrieveDomainCosmeticSelectors':
        if ( pageStore && pageStore.getSpecificCosmeticFilteringSwitch() ) {
            response = µb.cosmeticFilteringEngine.retrieveDomainSelectors(request);
        }
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('contentscript-start.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// contentscript-end.js

(function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var tagNameToRequestTypeMap = {
     'embed': 'object',
    'iframe': 'sub_frame',
       'img': 'image',
    'object': 'object'
};

/******************************************************************************/

// Evaluate many requests

var filterRequests = function(pageStore, details) {
    var requests = details.requests;
    if ( µb.userSettings.collapseBlocked === false ) {
        return requests;
    }

    //console.debug('messaging.js/contentscript-end.js: processing %d requests', requests.length);

    var µburi = µb.URI;
    var isBlockResult = µb.isBlockResult;

    // Create evaluation context
    var context = pageStore.createContextFromFrameHostname(details.pageHostname);

    var request;
    var i = requests.length;
    while ( i-- ) {
        request = requests[i];
        context.requestURL = vAPI.punycodeURL(request.url);
        context.requestHostname = µburi.hostnameFromURI(request.url);
        context.requestType = tagNameToRequestTypeMap[request.tagName];
        if ( isBlockResult(pageStore.filterRequest(context)) ) {
            request.collapse = true;
        }
    }
    return requests;
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    default:
        break;
    }

    // Sync
    var response;

    var pageStore;
    if ( sender && sender.tab ) {
        pageStore = µb.pageStoreFromTabId(sender.tab.id);
    }

    switch ( request.what ) {
    case 'retrieveGenericCosmeticSelectors':
        response = {
            shutdown: !pageStore || !pageStore.getNetFilteringSwitch(),
            result: null
        };
        if ( !response.shutdown && pageStore.getGenericCosmeticFilteringSwitch() ) {
            response.result = µb.cosmeticFilteringEngine.retrieveGenericSelectors(request);
        }
        break;

    case 'filterRequests':
        response = {
            shutdown: !pageStore || !pageStore.getNetFilteringSwitch(),
            result: null
        };
        if ( !response.shutdown ) {
            response.result = filterRequests(pageStore, request);
        }
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('contentscript-end.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// element-picker.js

(function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'elementPickerArguments':
        var xhr = new XMLHttpRequest();
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
                netFilters: vAPI.i18n('pickerNetFilters'),
                cosmeticFilters: vAPI.i18n('pickerCosmeticFilters'),
                cosmeticFiltersHint: vAPI.i18n('pickerCosmeticFiltersHint')
            };
            var reStrings = /\{\{(\w+)\}\}/g;
            var replacer = function(a0, string) {
                return i18n[string];
            };

            callback({
                frameContent: this.responseText.replace(reStrings, replacer),
                target: µb.epickerTarget,
                clientX: µb.mouseX,
                clientY: µb.mouseY,
                eprom: µb.epickerEprom
            });

            µb.epickerTarget = '';
            µb.mouseX = -1;
            µb.mouseY = -1;
        };
        xhr.send();
        return;

    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    case 'elementPickerEprom':
        µb.epickerEprom = request;
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('element-picker.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// cloud-ui.js

(function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'cloudGetOptions':
        vAPI.cloud.getOptions(function(options) {
            options.enabled = µb.userSettings.cloudStorageEnabled === true;
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

vAPI.messaging.listen('cloud-ui.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// 3p-filters.js

(function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var prepEntries = function(entries) {
    var µburi = µb.URI;
    var entry, hn;
    for ( var k in entries ) {
        if ( entries.hasOwnProperty(k) === false ) {
            continue;
        }
        entry = entries[k];
        if ( typeof entry.supportURL === 'string' && entry.supportURL !== '' ) {
            entry.supportName = µburi.hostnameFromURI(entry.supportURL);
        } else if ( typeof entry.homeURL === 'string' && entry.homeURL !== '' ) {
            hn = µburi.hostnameFromURI(entry.homeURL);
            entry.supportURL = 'http://' + hn + '/';
            entry.supportName = µburi.domainFromHostname(hn);
        }
    }
};

/******************************************************************************/

var getLists = function(callback) {
    var r = {
        autoUpdate: µb.userSettings.autoUpdate,
        available: null,
        cache: null,
        cosmetic: µb.userSettings.parseAllABPHideFilters,
        cosmeticFilterCount: µb.cosmeticFilteringEngine.getFilterCount(),
        current: µb.remoteBlacklists,
        manualUpdate: false,
        netFilterCount: µb.staticNetFilteringEngine.getFilterCount(),
        userFiltersPath: µb.userFiltersPath
    };
    var onMetadataReady = function(entries) {
        r.cache = entries;
        r.manualUpdate = µb.assetUpdater.manualUpdate;
        r.manualUpdateProgress = µb.assetUpdater.manualUpdateProgress;
        prepEntries(r.cache);
        callback(r);
    };
    var onLists = function(lists) {
        r.available = lists;
        prepEntries(r.available);
        µb.assets.metadata(onMetadataReady);
    };
    µb.getAvailableLists(onLists);
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'getLists':
        return getLists(callback);

    case 'purgeAllCaches':
        return µb.assets.purgeAll(callback);

    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    case 'purgeCache':
        µb.assets.purgeCacheableAsset(request.path);
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('3p-filters.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// 1p-filters.js

(function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'readUserFilters':
        return µb.assets.get(µb.userFiltersPath, callback);

    case 'writeUserFilters':
        return µb.assets.put(µb.userFiltersPath, request.content, callback);

    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('1p-filters.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// dyna-rules.js

(function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var getRules = function() {
    return {
        permanentRules: µb.permanentFirewall.toString() + '\n' + µb.permanentURLFiltering.toString(),
        sessionRules: µb.sessionFirewall.toString() + '\n' + µb.sessionURLFiltering.toString(),
        hnSwitches: µb.hnSwitches.toString()
    };
};

// Untangle firewall rules, url rules and switches.
var untangle = function(s) {
    var textEnd = s.length;
    var lineBeg = 0, lineEnd;
    var line;
    var firewallRules = [];
    var urlRules = [];
    var switches = [];

    while ( lineBeg < textEnd ) {
        lineEnd = s.indexOf('\n', lineBeg);
        if ( lineEnd < 0 ) {
            lineEnd = s.indexOf('\r', lineBeg);
            if ( lineEnd < 0 ) {
                lineEnd = textEnd;
            }
        }
        line = s.slice(lineBeg, lineEnd).trim();
        lineBeg = lineEnd + 1;

        if ( line.indexOf('://') !== -1 ) {
            urlRules.push(line);
        } else if ( line.indexOf(':') === -1 ) {
            firewallRules.push(line);
        } else {
            switches.push(line);
        }
    }

    return {
        firewallRules: firewallRules.join('\n'),
        urlRules: urlRules.join('\n'),
        switches: switches.join('\n')
    };
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    default:
        break;
    }

    // Sync
    var r;
    var response;

    switch ( request.what ) {
    case 'getRules':
        response = getRules();
        break;

    case 'setSessionRules':
        // https://github.com/chrisaljoudi/uBlock/issues/772
        µb.cosmeticFilteringEngine.removeFromSelectorCache('*');
        r = untangle(request.rules);
        µb.sessionFirewall.fromString(r.firewallRules);
        µb.sessionURLFiltering.fromString(r.urlRules);
        µb.hnSwitches.fromString(r.switches);
        µb.saveHostnameSwitches();
        response = getRules();
        break;

    case 'setPermanentRules':
        r = untangle(request.rules);
        µb.permanentFirewall.fromString(r.firewallRules);
        µb.savePermanentFirewallRules();
        µb.permanentURLFiltering.fromString(r.urlRules);
        µb.savePermanentURLFilteringRules();
        µb.hnSwitches.fromString(r.switches);
        µb.saveHostnameSwitches();
        response = getRules();
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('dyna-rules.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// whitelist.js

(function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    case 'getWhitelist':
        response = µb.stringFromWhitelist(µb.netWhitelist);
        break;

    case 'setWhitelist':
        µb.netWhitelist = µb.whitelistFromString(request.whitelist);
        µb.saveWhitelist();
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('whitelist.js', onMessage);

/******************************************************************************/

})();


/******************************************************************************/
/******************************************************************************/

// settings.js

(function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var getLocalData = function(callback) {
    var onStorageInfoReady = function(bytesInUse) {
        var o = µb.restoreBackupSettings;
        callback({
            storageUsed: bytesInUse,
            lastRestoreFile: o.lastRestoreFile,
            lastRestoreTime: o.lastRestoreTime,
            lastBackupFile: o.lastBackupFile,
            lastBackupTime: o.lastBackupTime
        });
    };

    µb.getBytesInUse(onStorageInfoReady);
};

/******************************************************************************/

var backupUserData = function(callback) {
    var userData = {
        timeStamp: Date.now(),
        version: vAPI.app.version,
        userSettings: µb.userSettings,
        filterLists: {},
        netWhitelist: µb.stringFromWhitelist(µb.netWhitelist),
        dynamicFilteringString: µb.permanentFirewall.toString(),
        urlFilteringString: µb.permanentURLFiltering.toString(),
        hostnameSwitchesString: µb.hnSwitches.toString(),
        userFilters: ''
    };

    var onSelectedListsReady = function(filterLists) {
        userData.filterLists = filterLists;

        var now = new Date();
        var filename = vAPI.i18n('aboutBackupFilename')
            .replace('{{datetime}}', now.toLocaleString())
            .replace(/ +/g, '_');

        vAPI.download({
            'url': 'data:text/plain;charset=utf-8,' + encodeURIComponent(JSON.stringify(userData, null, '  ')),
            'filename': filename
        });

        µb.restoreBackupSettings.lastBackupFile = filename;
        µb.restoreBackupSettings.lastBackupTime = Date.now();
        vAPI.storage.set(µb.restoreBackupSettings);

        getLocalData(callback);
    };

    var onUserFiltersReady = function(details) {
        userData.userFilters = details.content;
        µb.extractSelectedFilterLists(onSelectedListsReady);
    };

    µb.assets.get('assets/user/filters.txt', onUserFiltersReady);
};

/******************************************************************************/

var restoreUserData = function(request) {
    var userData = request.userData;
    var countdown = 8;
    var onCountdown = function() {
        countdown -= 1;
        if ( countdown === 0 ) {
            vAPI.app.restart();
        }
    };

    var onAllRemoved = function() {
        // Be sure to adjust `countdown` if adding/removing anything below
        µb.keyvalSetOne('version', userData.version);
        µBlock.saveLocalSettings(true);
        vAPI.storage.set(userData.userSettings, onCountdown);
        µb.keyvalSetOne('remoteBlacklists', userData.filterLists, onCountdown);
        µb.keyvalSetOne('netWhitelist', userData.netWhitelist || '', onCountdown);

        // With versions 0.9.2.4-, dynamic rules were saved within the
        // `userSettings` object. No longer the case.
        var s = userData.dynamicFilteringString || userData.userSettings.dynamicFilteringString || '';
        µb.keyvalSetOne('dynamicFilteringString', s, onCountdown);

        µb.keyvalSetOne('urlFilteringString', userData.urlFilteringString || '', onCountdown);
        µb.keyvalSetOne('hostnameSwitchesString', userData.hostnameSwitchesString || '', onCountdown);
        µb.assets.put('assets/user/filters.txt', userData.userFilters, onCountdown);
        vAPI.storage.set({
            lastRestoreFile: request.file || '',
            lastRestoreTime: Date.now(),
            lastBackupFile: '',
            lastBackupTime: 0
        }, onCountdown);
    };

    // https://github.com/chrisaljoudi/uBlock/issues/1102
    // Ensure all currently cached assets are flushed from storage AND memory.
    µb.assets.rmrf();

    // If we are going to restore all, might as well wipe out clean local
    // storage
    vAPI.storage.clear(onAllRemoved);
};

/******************************************************************************/

var resetUserData = function() {
    vAPI.storage.clear();

    // Keep global counts, people can become quite attached to numbers
    µb.saveLocalSettings(true);

    vAPI.app.restart();
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'backupUserData':
        return backupUserData(callback);

    case 'getLocalData':
        return getLocalData(callback);

    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    case 'restoreUserData':
        restoreUserData(request);
        break;

    case 'resetUserData':
        resetUserData();
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('settings.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// logger-ui.js

(function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var getURLFilteringData = function(details) {
    var colors = {};
    var response = {
        dirty: false,
        colors: colors
    };
    var suf = µb.sessionURLFiltering;
    var puf = µb.permanentURLFiltering;
    var urls = details.urls,
        context = details.context,
        type = details.type;
    var url, colorEntry;
    var i = urls.length;
    while ( i-- ) {
        url = urls[i];
        colorEntry = colors[url] = { r: 0, own: false };
        if ( suf.evaluateZ(context, url, type).r !== 0 ) {
            colorEntry.r = suf.r;
            colorEntry.own = suf.context === context && suf.url === url && suf.type === type;
        }
        if ( response.dirty ) {
            continue;
        }
        puf.evaluateZ(context, url, type);
        response.dirty = colorEntry.own !== (puf.context === context && puf.url === url && puf.type === type);
    }
    return response;
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    case 'readAll':
        var tabIds = {}, pageStore;
        var loggerURL = vAPI.getURL('logger-ui.html');
        for ( var tabId in µb.pageStores ) {
            pageStore = µb.pageStoreFromTabId(tabId);
            if ( pageStore === null ) {
                continue;
            }
            if ( pageStore.rawURL.lastIndexOf(loggerURL, 0) === 0 ) {
                continue;
            }
            tabIds[tabId] = pageStore.title;
        }
        response = {
            colorBlind: µb.userSettings.colorBlindFriendly,
            entries: µb.logger.readAll(),
            maxEntries: µb.userSettings.requestLogMaxEntries,
            noTabId: vAPI.noTabId,
            tabIds: tabIds,
            tabIdsToken: µb.pageStoresToken
        };
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

vAPI.messaging.listen('logger-ui.js', onMessage);

/******************************************************************************/

})();

// https://www.youtube.com/watch?v=3_WcygKJP1k

/******************************************************************************/
/******************************************************************************/

// subscriber.js

(function() {

'use strict';

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    case 'subscriberData':
        response = {
            confirmStr: vAPI.i18n('subscriberConfirm'),
            externalLists: µBlock.userSettings.externalLists
        };
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('subscriber.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// document-blocked.js

(function() {

'use strict';

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    case 'temporarilyWhitelistDocument':
        µBlock.webRequest.temporarilyWhitelistDocument(request.hostname);
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('document-blocked.js', onMessage);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

// scriptlets

(function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var logCosmeticFilters = function(tabId, details) {
    if ( µb.logger.isEnabled() === false ) {
        return;
    }

    var selectors = details.matchedSelectors;

    selectors.sort();

    for ( var i = 0; i < selectors.length; i++ ) {
        µb.logger.writeOne(
            tabId,
            'cosmetic',
            'cb:##' + selectors[i],
            'dom',
            details.frameURL,
            null,
            details.frameHostname
        );
    }
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    var tabId = sender && sender.tab ? sender.tab.id : 0;

    // Async
    switch ( request.what ) {
    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    case 'liveCosmeticFilteringData':
        var pageStore = µb.pageStoreFromTabId(tabId);
        if ( pageStore ) {
            pageStore.hiddenElementCount = request.filteredElementCount;
        }
        break;

    case 'logCosmeticFilteringData':
        logCosmeticFilters(tabId, request);
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

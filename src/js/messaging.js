/*******************************************************************************

    µBlock - a browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

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

    Home: https://github.com/chrisaljoudi/uBlock
*/

/* global µBlock, vAPI */

/******************************************************************************/
/******************************************************************************/

// Default handler

(function() {

'use strict';

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    var µb = µBlock;

    // Async
    switch ( request.what ) {
        case 'getAssetContent':
            // https://github.com/chrisaljoudi/uBlock/issues/417
            µb.assets.get(request.url, callback);
            return;

        case 'reloadAllFilters':
            µb.reloadAllFilters(callback);
            return;

        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {
        case 'contextMenuEvent':
            µb.contextMenuClientX = request.clientX;
            µb.contextMenuClientY = request.clientY;
            break;

        case 'forceUpdateAssets':
            µb.assetUpdater.force();
            break;

        case 'getAppData':
            response = {name: vAPI.app.name, version: vAPI.app.version};
            break;

        case 'getUserSettings':
            response = µb.userSettings;
            break;

        case 'gotoURL':
            vAPI.tabs.open(request.details);
            break;

        case 'reloadTab':
            if ( vAPI.isNoTabId(request.tabId) === false ) {
                vAPI.tabs.reload(request.tabId);
                if ( request.select && vAPI.tabs.select ) {
                    vAPI.tabs.select(request.tabId);
                }
            }
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
            allowCount: allowCount
        };
    }
    return r;
};

/******************************************************************************/

var getFirewallRules = function(srcHostname, desHostnames) {
    var r = {};
    var dFiltering = µb.sessionFirewall;
    r['/ * *'] = dFiltering.evaluateCellZY('*', '*', '*').toFilterString();
    r['/ * image'] = dFiltering.evaluateCellZY('*', '*', 'image').toFilterString();
    r['/ * 3p'] = dFiltering.evaluateCellZY('*', '*', '3p').toFilterString();
    r['/ * inline-script'] = dFiltering.evaluateCellZY('*', '*', 'inline-script').toFilterString();
    r['/ * 1p-script'] = dFiltering.evaluateCellZY('*', '*', '1p-script').toFilterString();
    r['/ * 3p-script'] = dFiltering.evaluateCellZY('*', '*', '3p-script').toFilterString();
    r['/ * 3p-frame'] = dFiltering.evaluateCellZY('*', '*', '3p-frame').toFilterString();
    if ( typeof srcHostname !== 'string' ) {
        return r;
    }

    r['. * *'] = dFiltering.evaluateCellZY(srcHostname, '*', '*').toFilterString();
    r['. * image'] = dFiltering.evaluateCellZY(srcHostname, '*', 'image').toFilterString();
    r['. * 3p'] = dFiltering.evaluateCellZY(srcHostname, '*', '3p').toFilterString();
    r['. * inline-script'] = dFiltering.evaluateCellZY(srcHostname, '*', 'inline-script').toFilterString();
    r['. * 1p-script'] = dFiltering.evaluateCellZY(srcHostname, '*', '1p-script').toFilterString();
    r['. * 3p-script'] = dFiltering.evaluateCellZY(srcHostname, '*', '3p-script').toFilterString();
    r['. * 3p-frame'] = dFiltering.evaluateCellZY(srcHostname, '*', '3p-frame').toFilterString();

    for ( var desHostname in desHostnames ) {
        if ( desHostnames.hasOwnProperty(desHostname) ) {
            r['/ ' + desHostname + ' *'] = dFiltering.evaluateCellZY('*', desHostname, '*').toFilterString();
            r['. ' + desHostname + ' *'] = dFiltering.evaluateCellZY(srcHostname, desHostname, '*').toFilterString();
        }
    }
    return r;
};

/******************************************************************************/

var getStats = function(tabId, tabTitle) {
    var r = {
        advancedUserEnabled: µb.userSettings.advancedUserEnabled,
        appName: vAPI.app.name,
        appVersion: vAPI.app.version,
        cosmeticFilteringSwitch: false,
        dfEnabled: µb.userSettings.dynamicFilteringEnabled,
        firewallPaneMinimized: µb.userSettings.firewallPaneMinimized,
        globalAllowedRequestCount: µb.localSettings.allowedRequestCount,
        globalBlockedRequestCount: µb.localSettings.blockedRequestCount,
        netFilteringSwitch: false,
        pageURL: '',
        pageAllowedRequestCount: 0,
        pageBlockedRequestCount: 0,
        tabId: tabId,
        tabTitle: tabTitle
    };
    var pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore ) {
        r.rawURL = pageStore.rawURL;
        r.pageURL = pageStore.pageURL;
        r.pageDomain = pageStore.pageDomain;
        r.pageHostname = pageStore.pageHostname;
        r.pageBlockedRequestCount = pageStore.perLoadBlockedRequestCount;
        r.pageAllowedRequestCount = pageStore.perLoadAllowedRequestCount;
        r.netFilteringSwitch = pageStore.getNetFilteringSwitch();
        r.hostnameDict = getHostnameDict(pageStore.hostnameToCountMap);
        r.contentLastModified = pageStore.contentLastModified;
        r.firewallRules = getFirewallRules(pageStore.pageHostname, r.hostnameDict);
        r.canElementPicker = r.pageHostname.indexOf('.') !== -1;
        r.canRequestLog = canRequestLog;
        r.doBlockAllPopups = µb.hnSwitches.evaluateZ('doBlockAllPopups', r.pageHostname);
        r.dontBlockDoc = µb.hnSwitches.evaluateZ('dontBlockDoc', r.pageHostname);
    } else {
        r.hostnameDict = {};
        r.firewallRules = getFirewallRules();
    }
    if ( r.pageHostname ) {
        r.matrixIsDirty = !µb.sessionFirewall.hasSameRules(
            µb.permanentFirewall,
            r.pageHostname,
            r.hostnameDict
        );
    }
    return r;
};

// Not the most elegant approach, but it does keep everything simple:
// This will be set by getTargetTabId() and used by getStats().
var canRequestLog = true;

/******************************************************************************/

var getTargetTabId = function(tab) {
    canRequestLog = true;

    if ( !tab ) {
        return '';
    }

    if ( tab.url.lastIndexOf(vAPI.getURL('devtools.html'), 0) !== 0 ) {
        return tab.id;
    }

    // If the URL is that of the network request logger, fill the popup with
    // the data from the tab being observed by the logger.
    // This allows a user to actually modify filtering profile for
    // behind-the-scene requests.

    canRequestLog = false;

    // Extract the target tab id from the URL
    var matches = tab.url.match(/[\?&]tabId=([^&]+)/);
    if ( matches && matches.length === 2 ) {
        return matches[1];
    }

    return tab.id;
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
        case 'getPopupData':
            if ( request.tabId === vAPI.noTabId ) {
                callback(getStats(vAPI.noTabId, ''));
                return;
            }
            vAPI.tabs.get(request.tabId, function(tab) {
                // https://github.com/chrisaljoudi/uBlock/issues/1012
                callback(getStats(getTargetTabId(tab), tab ? tab.title : ''));
            });
            return;

        default:
            break;
    }

    // Sync
    var pageStore;
    var response;

    switch ( request.what ) {
        case 'gotoPick':
            // Picker launched from popup: clear context menu args
            µb.contextMenuClientX = -1;
            µb.contextMenuClientY = -1;
            µb.elementPickerExec(request.tabId);
            if ( request.select && vAPI.tabs.select ) {
                vAPI.tabs.select(request.tabId);
            }
            break;

        case 'hasPopupContentChanged':
            pageStore = µb.pageStoreFromTabId(request.tabId);
            var lastModified = pageStore ? pageStore.contentLastModified : 0;
            response = lastModified !== request.contentLastModified;
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
            response = getStats(request.tabId);
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
    if ( !pageStore || !pageStore.getNetFilteringSwitch() ) {
        return requests;
    }
    if ( µb.userSettings.collapseBlocked === false ) {
        return requests;
    }

    //console.debug('messaging.js/contentscript-end.js: processing %d requests', requests.length);

    var µburi = µb.URI;
    var isBlockResult = µb.isBlockResult;

    // Create evaluation context
    var context = {
        pageHostname: vAPI.punycodeHostname(details.pageHostname),
        pageDomain: µburi.domainFromHostname(details.pageHostname),
        rootHostname: pageStore.rootHostname,
        rootDomain: pageStore.rootDomain,
        requestURL: '',
        requestHostname: '',
        requestType: ''
    };

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

var onMessage = function(details, sender, callback) {
    // Async
    switch ( details.what ) {
        default:
            break;
    }

    // Sync
    var response;

    var pageStore, frameStore = false;
    if ( sender && sender.tab ) {
        pageStore = µb.pageStoreFromTabId(sender.tab.id);
        var frameId = sender.frameId;
        if(frameId && frameId > 0) {
            frameStore = pageStore.getFrame(frameId);
        }
    }

    switch ( details.what ) {
        case 'retrieveGenericCosmeticSelectors':
            if ( pageStore && pageStore.getGenericCosmeticFilteringSwitch()
                && (!frameStore || frameStore.getNetFilteringSwitch()) ) {
                response = µb.cosmeticFilteringEngine.retrieveGenericSelectors(details);
            }
            break;

        case 'injectedSelectors':
            µb.cosmeticFilteringEngine.addToSelectorCache(details);
            break;

        // Evaluate many requests
        case 'filterRequests':
            response = filterRequests(pageStore, details);
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
                    target: µb.contextMenuTarget,
                    clientX: µb.contextMenuClientX,
                    clientY: µb.contextMenuClientY,
                    eprom: µb.epickerEprom
                });

                µb.contextMenuTarget = '';
                µb.contextMenuClientX = -1;
                µb.contextMenuClientY = -1;
            };
            xhr.send();
            return;

        default:
            break;
    }

    // Sync
    var response;

    switch ( request.what ) {
        case 'createUserFilter':
            µb.appendUserFilters(request.filters);
            break;

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

// 3p-filters.js

(function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var prepEntries = function(entries) {
    var µburi = µb.URI;
    var entry;
    for ( var k in entries ) {
        if ( entries.hasOwnProperty(k) === false ) {
            continue;
        }
        entry = entries[k];
        if ( typeof entry.homeURL === 'string' ) {
            entry.homeHostname = µburi.hostnameFromURI(entry.homeURL);
            entry.homeDomain = µburi.domainFromHostname(entry.homeHostname);
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
            µb.assets.purge(request.path);
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

var getFirewallRules = function() {
    return {
        permanentRules: µb.permanentFirewall.toString(),
        sessionRules: µb.sessionFirewall.toString()
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
    var response;

    switch ( request.what ) {
        case 'getFirewallRules':
            response = getFirewallRules();
            break;

        case 'setSessionFirewallRules':
            // https://github.com/chrisaljoudi/uBlock/issues/772
            µb.cosmeticFilteringEngine.removeFromSelectorCache('*');

            µb.sessionFirewall.fromString(request.rules);
            response = getFirewallRules();
            break;

        case 'setPermanentFirewallRules':
            µb.permanentFirewall.fromString(request.rules);
            µb.savePermanentFirewallRules();
            response = getFirewallRules();
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
            // #1208
            µb.cosmeticFilteringEngine.removeFromSelectorCache('*');
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

// devtools.js

(function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var getPageDetails = function(callback) {
    var out = {};
    var tabIds = Object.keys(µb.pageStores);

    // Special case: behind-the-scene virtual tab (does not really exist)
    var pos = tabIds.indexOf(vAPI.noTabId);
    if ( pos !== -1 ) {
        tabIds.splice(pos, 1);
        out[vAPI.noTabId] = vAPI.i18n('logBehindTheScene');
    }

    // This can happen
    if ( tabIds.length === 0 ) {
        callback(out);
        return;
    }

    var countdown = tabIds.length;
    var doCountdown = function() {
        countdown -= 1;
        if ( countdown === 0 ) {
            callback(out);
        }
    };

    // Let's not populate the page selector with reference to self
    var devtoolsURL = vAPI.getURL('devtools.html');

    var onTabDetails = function(tab) {
        if ( tab && tab.url.lastIndexOf(devtoolsURL, 0) !== 0 ) {
            out[tab.id] = tab.title;
        }
        doCountdown();
    };

    var i = countdown;
    while ( i-- ) {
        vAPI.tabs.get(tabIds[i], onTabDetails);
    }
};

/******************************************************************************/

var onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
        case 'getPageDetails':
            getPageDetails(callback);
            return;

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

vAPI.messaging.listen('devtools.js', onMessage);

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
    var onUserFiltersReady = function(details) {
        var userData = {
            timeStamp: Date.now(),
            version: vAPI.app.version,
            userSettings: µb.userSettings,
            filterLists: µb.extractSelectedFilterLists(),
            netWhitelist: µb.stringFromWhitelist(µb.netWhitelist),
            dynamicFilteringString: µb.permanentFirewall.toString(),
            hostnameSwitchesString: µb.hnSwitches.toString(),
            userFilters: details.content
        };
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
        µb.XAL.keyvalSetMany(µb.restoreBackupSettings);

        getLocalData(callback);
    };

    µb.assets.get('assets/user/filters.txt', onUserFiltersReady);
};

/******************************************************************************/

var restoreUserData = function(request) {
    var userData = request.userData;
    var countdown = 7;
    var onCountdown = function() {
        countdown -= 1;
        if ( countdown === 0 ) {
            vAPI.app.restart();
        }
    };

    var onAllRemoved = function() {
        // Be sure to adjust `countdown` if adding/removing anything below
        µb.XAL.keyvalSetOne('version', userData.version);
        µBlock.saveLocalSettings(true);
        µb.XAL.keyvalSetMany(userData.userSettings, onCountdown);
        µb.XAL.keyvalSetOne('remoteBlacklists', userData.filterLists, onCountdown);
        µb.XAL.keyvalSetOne('netWhitelist', userData.netWhitelist || '', onCountdown);

        // With versions 0.9.2.4-, dynamic rules were saved within the
        // `userSettings` object. No longer the case.
        var s = userData.dynamicFilteringString || userData.userSettings.dynamicFilteringString || '';
        µb.XAL.keyvalSetOne('dynamicFilteringString', s, onCountdown);

        µb.XAL.keyvalSetOne('hostnameSwitchesString', userData.hostnameSwitchesString || '', onCountdown);
        µb.assets.put('assets/user/filters.txt', userData.userFilters, onCountdown);
        µb.XAL.keyvalSetMany({
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
    µb.XAL.keyvalRemoveAll(onAllRemoved);
};

/******************************************************************************/

var resetUserData = function() {
    µb.XAL.keyvalRemoveAll();

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

// devtool-log.js

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
        case 'readLogBuffer':
            var pageStore = µb.pageStoreFromTabId(request.tabId);
            if ( pageStore ) {
                response = pageStore.logBuffer.readAll();
            }
            break;

        default:
            return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen('devtool-log.js', onMessage);

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
            µBlock.webRequest.temporarilyWhitelistDocument(request.url);
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

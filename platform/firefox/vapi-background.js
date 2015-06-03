/*******************************************************************************

    µBlock - a browser extension to block requests.
    Copyright (C) 2014 The µBlock authors

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

/* jshint esnext: true, bitwise: false */
/* global self, Components, punycode, µBlock */

// For background page

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
const {Services} = Cu.import('resource://gre/modules/Services.jsm', null);

/******************************************************************************/

var vAPI = self.vAPI = self.vAPI || {};
vAPI.firefox = true;
vAPI.fennec = Services.appinfo.ID === '{aa3c5121-dab2-40e2-81ca-7ea25febc110}';

/******************************************************************************/

vAPI.app = {
    name: 'uBlock Origin',
    version: location.hash.slice(1)
};

/******************************************************************************/

vAPI.app.restart = function() {
    // Listening in bootstrap.js
    Cc['@mozilla.org/childprocessmessagemanager;1']
        .getService(Ci.nsIMessageSender)
        .sendAsyncMessage(location.host + '-restart');
};

/******************************************************************************/

// List of things that needs to be destroyed when disabling the extension
// Only functions should be added to it

var cleanupTasks = [];

// This must be updated manually, every time a new task is added/removed

// Fixed by github.com/AlexVallat:
//   https://github.com/AlexVallat/uBlock/commit/7b781248f00cbe3d61b1cc367c440db80fa06049
//   7 instances of cleanupTasks.push, but one is unique to fennec, and one to desktop.
var expectedNumberOfCleanups = 6;

window.addEventListener('unload', function() {
    if ( typeof vAPI.app.onShutdown === 'function' ) {
        vAPI.app.onShutdown();
    }

    for ( var cleanup of cleanupTasks ) {
        cleanup();
    }

    if ( cleanupTasks.length < expectedNumberOfCleanups ) {
        console.error(
            'uBlock> Cleanup tasks performed: %s (out of %s)',
            cleanupTasks.length,
            expectedNumberOfCleanups
        );
    }

    // frameModule needs to be cleared too
    var frameModule = {};
    Cu.import(vAPI.getURL('frameModule.js'), frameModule);
    frameModule.contentObserver.unregister();
    Cu.unload(vAPI.getURL('frameModule.js'));
});

/******************************************************************************/

vAPI.browserSettings = {

    setBool: function(branch, setting, value) {
        try {
            Services.prefs
                    .getBranch(branch + '.')
                    .setBoolPref(setting, value);
        } catch (ex) {
        }
    },

    set: function(details) {
        for ( var setting in details ) {
            if ( details.hasOwnProperty(setting) === false ) {
                continue;
            }
            switch ( setting ) {
            case 'prefetching':
                this.setBool('network', 'prefetch-next', !!details[setting]);
                break;

            case 'hyperlinkAuditing':
                this.setBool('browser', 'send_pings', !!details[setting]);
                this.setBool('beacon', 'enabled', !!details[setting]);
                break;

            default:
                break;
            }
        }
    }
};

/******************************************************************************/

// API matches that of chrome.storage.local:
//   https://developer.chrome.com/extensions/storage

vAPI.storage = (function() {
    var db = null;
    var vacuumTimer = null;

    var close = function() {
        if ( vacuumTimer !== null ) {
            clearTimeout(vacuumTimer);
            vacuumTimer = null;
        }
        if ( db === null ) {
            return;
        }
        db.asyncClose();
        db = null;
    };

    var open = function() {
        if ( db !== null ) {
            return db;
        }

        // Create path
        var path = Services.dirsvc.get('ProfD', Ci.nsIFile);
        path.append('extension-data');
        if ( !path.exists() ) {
            path.create(Ci.nsIFile.DIRECTORY_TYPE, parseInt('0774', 8));
        }
        if ( !path.isDirectory() ) {
            throw Error('Should be a directory...');
        }
        path.append(location.host + '.sqlite');

        // Open database
        try {
            db = Services.storage.openDatabase(path);
            if ( db.connectionReady === false ) {
                db.asyncClose();
                db = null;
            }
        } catch (ex) {
        }

        if ( db === null ) {
            return null;
        }

        // Database was opened, register cleanup task
        cleanupTasks.push(close);

        // Setup database
        db.createAsyncStatement('CREATE TABLE IF NOT EXISTS "settings" ("name" TEXT PRIMARY KEY NOT NULL, "value" TEXT);')
          .executeAsync();

        if ( vacuum !== null ) {
            vacuumTimer = vAPI.setTimeout(vacuum, 60000);
        }

        return db;
    };

    // https://developer.mozilla.org/en-US/docs/Storage/Performance#Vacuuming_and_zero-fill
    // Vacuum only once, and only while idle
    var vacuum = function() {
        vacuumTimer = null;
        if ( db === null ) {
            return;
        }
        var idleSvc = Cc['@mozilla.org/widget/idleservice;1']
                       .getService(Ci.nsIIdleService);
        if ( idleSvc.idleTime < 60000 ) {
            vacuumTimer = vAPI.setTimeout(vacuum, 60000);
            return;
        }
        db.createAsyncStatement('VACUUM').executeAsync();
        vacuum = null;
    };

    // Execute a query
    var runStatement = function(stmt, callback) {
        var result = {};

        stmt.executeAsync({
            handleResult: function(rows) {
                if ( !rows || typeof callback !== 'function' ) {
                    return;
                }

                var row;

                while ( row = rows.getNextRow() ) {
                    // we assume that there will be two columns, since we're
                    // using it only for preferences
                    result[row.getResultByIndex(0)] = row.getResultByIndex(1);
                }
            },
            handleCompletion: function(reason) {
                if ( typeof callback === 'function' && reason === 0 ) {
                    callback(result);
                }
            },
            handleError: function(error) {
                console.error('SQLite error ', error.result, error.message);
                // Caller expects an answer regardless of failure.
                if ( typeof callback === 'function' ) {
                    callback(null);
                }
            }
        });
    };

    var bindNames = function(stmt, names) {
        if ( Array.isArray(names) === false || names.length === 0 ) {
            return;
        }
        var params = stmt.newBindingParamsArray();
        var i = names.length, bp;
        while ( i-- ) {
            bp = params.newBindingParams();
            bp.bindByName('name', names[i]);
            params.addParams(bp);
        }
        stmt.bindParameters(params);
    };

    var clear = function(callback) {
        if ( open() === null ) {
            if ( typeof callback === 'function' ) {
                callback();
            }
            return;
        }
        runStatement(db.createAsyncStatement('DELETE FROM "settings";'), callback);
    };

    var getBytesInUse = function(keys, callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }

        if ( open() === null ) {
            callback(0);
            return;
        }

        var stmt;
        if ( Array.isArray(keys) ) {
            stmt = db.createAsyncStatement('SELECT "size" AS "size", SUM(LENGTH("value")) FROM "settings" WHERE "name" = :name');
            bindNames(keys);
        } else {
            stmt = db.createAsyncStatement('SELECT "size" AS "size", SUM(LENGTH("value")) FROM "settings"');
        }

        runStatement(stmt, function(result) {
            callback(result.size);
        });
    };

    var read = function(details, callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }

        var prepareResult = function(result) {
            var key;
            for ( key in result ) {
                if ( result.hasOwnProperty(key) === false ) {
                    continue;
                }
                result[key] = JSON.parse(result[key]);
            }
            if ( typeof details === 'object' && details !== null ) {
                for ( key in details ) {
                    if ( result.hasOwnProperty(key) === false ) {
                        result[key] = details[key];
                    }
                }
            }
            callback(result);
        };

        if ( open() === null ) {
            prepareResult({});
            return;
        }

        var names = [];
        if ( details !== null ) {
            if ( Array.isArray(details) ) {
                names = details;
            } else if ( typeof details === 'object' ) {
                names = Object.keys(details);
            } else {
                names = [details.toString()];
            }
        }

        var stmt;
        if ( names.length === 0 ) {
            stmt = db.createAsyncStatement('SELECT * FROM "settings"');
        } else {
            stmt = db.createAsyncStatement('SELECT * FROM "settings" WHERE "name" = :name');
            bindNames(stmt, names);
        }

        runStatement(stmt, prepareResult);
    };

    var remove = function(keys, callback) {
        if ( open() === null ) {
            if ( typeof callback === 'function' ) {
                callback();
            }
            return;
        }
        var stmt = db.createAsyncStatement('DELETE FROM "settings" WHERE "name" = :name');
        bindNames(stmt, typeof keys === 'string' ? [keys] : keys);
        runStatement(stmt, callback);
    };

    var write = function(details, callback) {
        if ( open() === null ) {
            if ( typeof callback === 'function' ) {
                callback();
            }
            return;
        }

        var stmt = db.createAsyncStatement('INSERT OR REPLACE INTO "settings" ("name", "value") VALUES(:name, :value)');
        var params = stmt.newBindingParamsArray(), bp;
        for ( var key in details ) {
            if ( details.hasOwnProperty(key) === false ) {
                continue;
            }
            bp = params.newBindingParams();
            bp.bindByName('name', key);
            bp.bindByName('value', JSON.stringify(details[key]));
            params.addParams(bp);
        }
        if ( params.length === 0 ) {
            return;
        }

        stmt.bindParameters(params);
        runStatement(stmt, callback);
    };

    // Export API
    var api = {
        QUOTA_BYTES: 100 * 1024 * 1024,
        clear: clear,
        get: read,
        getBytesInUse: getBytesInUse,
        remove: remove,
        set: write
    };
    return api;
})();

/******************************************************************************/

var getTabBrowser = function(win) {
    return vAPI.fennec && win.BrowserApp || win.gBrowser || null;
};

/******************************************************************************/

var getOwnerWindow = function(target) {
    if ( target.ownerDocument ) {
        return target.ownerDocument.defaultView;
    }

    // Fennec
    for ( var win of vAPI.tabs.getWindows() ) {
        for ( var tab of win.BrowserApp.tabs) {
            if ( tab === target || tab.window === target ) {
                return win;
            }
        }
    }

    return null;
};

/******************************************************************************/

vAPI.isBehindTheSceneTabId = function(tabId) {
    return tabId.toString() === '-1';
};

vAPI.noTabId = '-1';

/******************************************************************************/

vAPI.tabs = {};

/******************************************************************************/

vAPI.tabs.registerListeners = function() {
    tabWatcher.start();
};

/******************************************************************************/

// Firefox:
//   https://developer.mozilla.org/en-US/Add-ons/Code_snippets/Tabbed_browser
//
// browser --> ownerDocument --> defaultView --> gBrowser --> browsers --+
//    ^                                                                  |
//    |                                                                  |
//    +-------------------------------------------------------------------
//
// browser (browser)
//   contentTitle
//   currentURI
//   ownerDocument (XULDocument)
//     defaultView (ChromeWindow)
//     gBrowser (tabbrowser OR browser)
//       browsers (browser)
//       selectedBrowser
//       selectedTab
//       tabs (tab.tabbrowser-tab)
//
// Fennec: (what I figured so far)
//
//   tab --> browser     windows --> window --> BrowserApp --> tabs --+
//    ^      window                                                   |
//    |                                                               |
//    +---------------------------------------------------------------+
//
// tab
//   browser
// [manual search to go back to tab from list of windows]

vAPI.tabs.get = function(tabId, callback) {
    var browser;

    if ( tabId === null ) {
        browser = tabWatcher.currentBrowser();
        tabId = tabWatcher.tabIdFromTarget(browser);
    } else {
        browser = tabWatcher.browserFromTabId(tabId);
    }

    // For internal use
    if ( typeof callback !== 'function' ) {
        return browser;
    }

    if ( !browser ) {
        callback();
        return;
    }

    var win = getOwnerWindow(browser);
    var tabBrowser = getTabBrowser(win);
    var windows = this.getWindows();

    callback({
        id: tabId,
        index: tabWatcher.indexFromTarget(browser),
        windowId: windows.indexOf(win),
        active: browser === tabBrowser.selectedBrowser,
        url: browser.currentURI.asciiSpec,
        title: browser.contentTitle
    });
};

/******************************************************************************/

vAPI.tabs.getAll = function(window) {
    var win, tab;
    var tabs = [];

    for ( win of this.getWindows() ) {
        if ( window && window !== win ) {
            continue;
        }

        var tabBrowser = getTabBrowser(win);
        if ( tabBrowser === null ) {
            continue;
        }

        for ( tab of tabBrowser.tabs ) {
            tabs.push(tab);
        }
    }

    return tabs;
};

/******************************************************************************/

vAPI.tabs.getWindows = function() {
    var winumerator = Services.wm.getEnumerator('navigator:browser');
    var windows = [];

    while ( winumerator.hasMoreElements() ) {
        var win = winumerator.getNext();

        if ( !win.closed ) {
            windows.push(win);
        }
    }

    return windows;
};

/******************************************************************************/

// properties of the details object:
//   url: 'URL', // the address that will be opened
//   tabId: 1, // the tab is used if set, instead of creating a new one
//   index: -1, // undefined: end of the list, -1: following tab, or after index
//   active: false, // opens the tab in background - true and undefined: foreground
//   select: true // if a tab is already opened with that url, then select it instead of opening a new one

vAPI.tabs.open = function(details) {
    if ( !details.url ) {
        return null;
    }
    // extension pages
    if ( /^[\w-]{2,}:/.test(details.url) === false ) {
        details.url = vAPI.getURL(details.url);
    }

    var tab;

    if ( details.select ) {
        var URI = Services.io.newURI(details.url, null, null);

        for ( tab of this.getAll() ) {
            var browser = tabWatcher.browserFromTarget(tab);

            // Or simply .equals if we care about the fragment
            if ( URI.equalsExceptRef(browser.currentURI) === false ) {
                continue;
            }

            this.select(tab);
            return;
        }
    }

    if ( details.active === undefined ) {
        details.active = true;
    }

    if ( details.tabId ) {
        tab = tabWatcher.browserFromTabId(details.tabId);
        if ( tab ) {
            tabWatcher.browserFromTarget(tab).loadURI(details.url);
            return;
        }
    }

    var win = Services.wm.getMostRecentWindow('navigator:browser');
    var tabBrowser = getTabBrowser(win);

    if ( vAPI.fennec ) {
        tabBrowser.addTab(details.url, {selected: details.active !== false});
        // Note that it's impossible to move tabs on Fennec, so don't bother
        return;
    }

    if ( details.index === -1 ) {
        details.index = tabBrowser.browsers.indexOf(tabBrowser.selectedBrowser) + 1;
    }

    tab = tabBrowser.loadOneTab(details.url, {inBackground: !details.active});

    if ( details.index !== undefined ) {
        tabBrowser.moveTabTo(tab, details.index);
    }
};

/******************************************************************************/

// Replace the URL of a tab. Noop if the tab does not exist.

vAPI.tabs.replace = function(tabId, url) {
    var targetURL = url;

    // extension pages
    if ( /^[\w-]{2,}:/.test(targetURL) !== true ) {
        targetURL = vAPI.getURL(targetURL);
    }

    var browser = tabWatcher.browserFromTabId(tabId);
    if ( browser ) {
        browser.loadURI(targetURL);
    }
};

/******************************************************************************/

vAPI.tabs._remove = function(tab, tabBrowser) {
    if ( vAPI.fennec ) {
        tabBrowser.closeTab(tab);
        return;
    }
    tabBrowser.removeTab(tab);
};

/******************************************************************************/

vAPI.tabs.remove = function(tabId) {
    var browser = tabWatcher.browserFromTabId(tabId);
    if ( !browser ) {
        return;
    }
    var tab = tabWatcher.tabFromBrowser(browser);
    if ( !tab ) {
        return;
    }
    this._remove(tab, getTabBrowser(getOwnerWindow(browser)));
};

/******************************************************************************/

vAPI.tabs.reload = function(tabId) {
    var browser = tabWatcher.browserFromTabId(tabId);
    if ( !browser ) {
        return;
    }

    browser.webNavigation.reload(Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE);
};

/******************************************************************************/

vAPI.tabs.select = function(tab) {
    if ( typeof tab !== 'object' ) {
        tab = tabWatcher.tabFromBrowser(tabWatcher.browserFromTabId(tab));
    }
    if ( !tab ) {
        return;
    }

    var tabBrowser = getTabBrowser(getOwnerWindow(tab));

    if ( vAPI.fennec ) {
        tabBrowser.selectTab(tab);
    } else {
        tabBrowser.selectedTab = tab;
    }
};

/******************************************************************************/

vAPI.tabs.injectScript = function(tabId, details, callback) {
    var browser = tabWatcher.browserFromTabId(tabId);
    if ( !browser ) {
        return;
    }

    if ( typeof details.file !== 'string' ) {
        return;
    }

    details.file = vAPI.getURL(details.file);
    browser.messageManager.sendAsyncMessage(
        location.host + ':broadcast',
        JSON.stringify({
            broadcast: true,
            channelName: 'vAPI',
            msg: {
                cmd: 'injectScript',
                details: details
            }
        })
    );

    if ( typeof callback === 'function' ) {
        vAPI.setTimeout(callback, 13);
    }
};

/******************************************************************************/

var tabWatcher = (function() {
    // TODO: find out whether we need a janitor to take care of stale entries.
    var browserToTabIdMap = new Map();
    var tabIdToBrowserMap = new Map();
    var tabIdGenerator = 1;

    var indexFromBrowser = function(browser) {
        var win = getOwnerWindow(browser);
        if ( !win ) {
            return -1;
        }
        var tabbrowser = getTabBrowser(win);
        if ( !tabbrowser ) {
            return -1;
        }
        // This can happen, for example, the `view-source:` window, there is
        // no tabbrowser object, the browser object sits directly in the
        // window.
        if ( tabbrowser === browser ) {
            return 0;
        }
        // Fennec
        // https://developer.mozilla.org/en-US/Add-ons/Firefox_for_Android/API/BrowserApp
        if ( vAPI.fennec ) {
            return tabbrowser.tabs.indexOf(tabbrowser.getTabForBrowser(browser));
        }
        return tabbrowser.browsers.indexOf(browser);
    };

    var indexFromTarget = function(target) {
        return indexFromBrowser(browserFromTarget(target));
    };

    var tabFromBrowser = function(browser) {
        var i = indexFromBrowser(browser);
        if ( i === -1 ) {
            return null;
        }
        var win = getOwnerWindow(browser);
        if ( !win ) {
            return null;
        }
        var tabbrowser = getTabBrowser(win);
        if ( !tabbrowser ) {
            return null;
        }
        if ( !tabbrowser.tabs || i >= tabbrowser.tabs.length ) {
            return null;
        }
        return tabbrowser.tabs[i];
    };

    var browserFromTarget = function(target) {
        if ( !target ) {
            return null;
        }
        if ( vAPI.fennec ) {
            if ( target.browser ) {         // target is a tab
                target = target.browser;
            }
        } else if ( target.linkedPanel ) {  // target is a tab
            target = target.linkedBrowser;
        }
        if ( target.localName !== 'browser' ) {
            return null;
        }
        return target;
    };

    var tabIdFromTarget = function(target) {
        var browser = browserFromTarget(target);
        if ( browser === null ) {
            return vAPI.noTabId;
        }
        var tabId = browserToTabIdMap.get(browser);
        if ( tabId === undefined ) {
            tabId = 't' + tabIdGenerator++;
            browserToTabIdMap.set(browser, tabId);
            tabIdToBrowserMap.set(tabId, browser);
        }
        return tabId;
    };

    var browserFromTabId = function(tabId) {
        var browser = tabIdToBrowserMap.get(tabId);
        if ( browser === undefined ) {
            return null;
        }
        // Verify that the browser is still live
        if ( indexFromBrowser(browser) !== -1 ) {
            return browser;
        }
        removeBrowserEntry(tabId, browser);
        return null;
    };

    var currentBrowser = function() {
        var win = Services.wm.getMostRecentWindow('navigator:browser');
        return browserFromTarget(getTabBrowser(win).selectedTab);
    };

    var removeBrowserEntry = function(tabId, browser) {
        if ( tabId && tabId !== vAPI.noTabId ) {
            vAPI.tabs.onClosed(tabId);
            delete vAPI.toolbarButton.tabs[tabId];
            tabIdToBrowserMap.delete(tabId);
        }
        if ( browser ) {
            browserToTabIdMap.delete(browser);
        }
    };

    // https://developer.mozilla.org/en-US/docs/Web/Events/TabOpen
    var onOpen = function({target}) {
        var tabId = tabIdFromTarget(target);
        var browser = browserFromTabId(tabId);
        vAPI.tabs.onNavigation({
            frameId: 0,
            tabId: tabId,
            url: browser.currentURI.asciiSpec,
        });
    };

    // https://developer.mozilla.org/en-US/docs/Web/Events/TabShow
    var onShow = function({target}) {
        tabIdFromTarget(target);
    };

    // https://developer.mozilla.org/en-US/docs/Web/Events/TabClose
    var onClose = function({target}) {
        // target is tab in Firefox, browser in Fennec
        var browser = browserFromTarget(target);
        var tabId = browserToTabIdMap.get(browser);
        removeBrowserEntry(tabId, browser);
    };

    // https://developer.mozilla.org/en-US/docs/Web/Events/TabSelect
    var onSelect = function({target}) {
        vAPI.setIcon(tabIdFromTarget(target), getOwnerWindow(target));
    };

    var onWindowLoad = function(ev) {
        if ( ev ) {
            this.removeEventListener(ev.type, onWindowLoad);
        }

        var wintype = this.document.documentElement.getAttribute('windowtype');
        if ( wintype !== 'navigator:browser' ) {
            return;
        }

        var tabBrowser = getTabBrowser(this);
        if ( !tabBrowser ) {
            return;
        }

        var tabContainer;
        if ( tabBrowser.deck ) {
            // Fennec
            tabContainer = tabBrowser.deck;
        } else if ( tabBrowser.tabContainer ) {
            // desktop Firefox
            tabContainer = tabBrowser.tabContainer;
            vAPI.contextMenu.register(this.document);
        } else {
            return;
        }
        tabContainer.addEventListener('TabOpen', onOpen);
        tabContainer.addEventListener('TabShow', onShow);
        tabContainer.addEventListener('TabClose', onClose);
        tabContainer.addEventListener('TabSelect', onSelect);

        // when new window is opened TabSelect doesn't run on the selected tab?
    };

    var onWindowUnload = function() {
        vAPI.contextMenu.unregister(this.document);
        this.removeEventListener('DOMContentLoaded', onWindowLoad);

        var tabBrowser = getTabBrowser(this);
        if ( !tabBrowser ) {
            return;
        }

        var tabContainer = null;
        if ( tabBrowser.deck ) {
            // Fennec
            tabContainer = tabBrowser.deck;
        } else if ( tabBrowser.tabContainer ) {
            tabContainer = tabBrowser.tabContainer;
        }
        if ( tabContainer ) {
            tabContainer.removeEventListener('TabOpen', onOpen);
            tabContainer.removeEventListener('TabShow', onShow);
            tabContainer.removeEventListener('TabClose', onClose);
            tabContainer.removeEventListener('TabSelect', onSelect);
        }

        // Close extension tabs
        var browser, URI, tabId;
        for ( var tab of tabBrowser.tabs ) {
            browser = tabWatcher.browserFromTarget(tab);
            if ( browser === null ) {
                continue;
            }
            URI = browser.currentURI;
            if ( URI.schemeIs('chrome') && URI.host === location.host ) {
                vAPI.tabs._remove(tab, getTabBrowser(this));
            }
            browser = browserFromTarget(tab);
            tabId = browserToTabIdMap.get(browser);
            if ( tabId !== undefined ) {
                tabIdToBrowserMap.delete(tabId);
            }
            browserToTabIdMap.delete(browser);
        }
    };

    // https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIWindowWatcher
    var windowWatcher = {
        observe: function(win, topic) {
            if ( topic === 'domwindowopened' ) {
                win.addEventListener('DOMContentLoaded', onWindowLoad);
            }
        }
    };

    // Initialize map with existing active tabs
    var start = function() {
        var tabBrowser, tab;
        for ( var win of vAPI.tabs.getWindows() ) {
            onWindowLoad.call(win);
            tabBrowser = getTabBrowser(win);
            if ( tabBrowser === null ) {
                continue;
            }
            for ( tab of tabBrowser.tabs ) {
                if ( vAPI.fennec || !tab.hasAttribute('pending') ) {
                    tabIdFromTarget(tab);
                }
            }
        }

        Services.ww.registerNotification(windowWatcher);
    };

    var stop = function() {
        Services.ww.unregisterNotification(windowWatcher);

        for ( var win of vAPI.tabs.getWindows() ) {
            onWindowUnload.call(win);
        }

        browserToTabIdMap.clear();
        tabIdToBrowserMap.clear();
    };

    cleanupTasks.push(stop);

    return {
        browsers: function() { return browserToTabIdMap.keys(); },
        browserFromTabId: browserFromTabId,
        browserFromTarget: browserFromTarget,
        currentBrowser: currentBrowser,
        indexFromTarget: indexFromTarget,
        start: start,
        tabFromBrowser: tabFromBrowser,
        tabIdFromTarget: tabIdFromTarget
    };
})();

/******************************************************************************/

vAPI.setIcon = function(tabId, iconStatus, badge) {
    // If badge is undefined, then setIcon was called from the TabSelect event
    var win = badge === undefined
        ? iconStatus
        : Services.wm.getMostRecentWindow('navigator:browser');
    var curTabId = tabWatcher.tabIdFromTarget(getTabBrowser(win).selectedTab);
    var tb = vAPI.toolbarButton;

    // from 'TabSelect' event
    if ( tabId === undefined ) {
        tabId = curTabId;
    } else if ( badge !== undefined ) {
        tb.tabs[tabId] = { badge: badge, img: iconStatus === 'on' };
    }

    if ( tabId === curTabId ) {
        tb.updateState(win, tabId);
    }
};

/******************************************************************************/

vAPI.messaging = {
    get globalMessageManager() {
        return Cc['@mozilla.org/globalmessagemanager;1']
                .getService(Ci.nsIMessageListenerManager);
    },
    frameScript: vAPI.getURL('frameScript.js'),
    listeners: {},
    defaultHandler: null,
    NOOPFUNC: function(){},
    UNHANDLED: 'vAPI.messaging.notHandled'
};

/******************************************************************************/

vAPI.messaging.listen = function(listenerName, callback) {
    this.listeners[listenerName] = callback;
};

/******************************************************************************/

vAPI.messaging.onMessage = function({target, data}) {
    var messageManager = target.messageManager;

    if ( !messageManager ) {
        // Message came from a popup, and its message manager is not usable.
        // So instead we broadcast to the parent window.
        messageManager = getOwnerWindow(
            target.webNavigation.QueryInterface(Ci.nsIDocShell).chromeEventHandler
        ).messageManager;
    }

    var channelNameRaw = data.channelName;
    var pos = channelNameRaw.indexOf('|');
    var channelName = channelNameRaw.slice(pos + 1);

    var callback = vAPI.messaging.NOOPFUNC;
    if ( data.requestId !== undefined ) {
        callback = CallbackWrapper.factory(
            messageManager,
            channelName,
            channelNameRaw.slice(0, pos),
            data.requestId
        ).callback;
    }

    var sender = {
        tab: {
            id: tabWatcher.tabIdFromTarget(target)
        }
    };

    // Specific handler
    var r = vAPI.messaging.UNHANDLED;
    var listener = vAPI.messaging.listeners[channelName];
    if ( typeof listener === 'function' ) {
        r = listener(data.msg, sender, callback);
    }
    if ( r !== vAPI.messaging.UNHANDLED ) {
        return;
    }

    // Default handler
    r = vAPI.messaging.defaultHandler(data.msg, sender, callback);
    if ( r !== vAPI.messaging.UNHANDLED ) {
        return;
    }

    console.error('uBlock> messaging > unknown request: %o', data);

    // Unhandled:
    // Need to callback anyways in case caller expected an answer, or
    // else there is a memory leak on caller's side
    callback();
};

/******************************************************************************/

vAPI.messaging.setup = function(defaultHandler) {
    // Already setup?
    if ( this.defaultHandler !== null ) {
        return;
    }

    if ( typeof defaultHandler !== 'function' ) {
        defaultHandler = function(){ return vAPI.messaging.UNHANDLED; };
    }
    this.defaultHandler = defaultHandler;

    this.globalMessageManager.addMessageListener(
        location.host + ':background',
        this.onMessage
    );

    this.globalMessageManager.loadFrameScript(this.frameScript, true);

    cleanupTasks.push(function() {
        var gmm = vAPI.messaging.globalMessageManager;

        gmm.removeDelayedFrameScript(vAPI.messaging.frameScript);
        gmm.removeMessageListener(
            location.host + ':background',
            vAPI.messaging.onMessage
        );

        vAPI.messaging.defaultHandler = null;
    });
};

/******************************************************************************/

vAPI.messaging.broadcast = function(message) {
    this.globalMessageManager.broadcastAsyncMessage(
        location.host + ':broadcast',
        JSON.stringify({broadcast: true, msg: message})
    );
};

/******************************************************************************/

// This allows to avoid creating a closure for every single message which
// expects an answer. Having a closure created each time a message is processed
// has been always bothering me. Another benefit of the implementation here
// is to reuse the callback proxy object, so less memory churning.
//
// https://developers.google.com/speed/articles/optimizing-javascript
// "Creating a closure is significantly slower then creating an inner
//  function without a closure, and much slower than reusing a static
//  function"
//
// http://hacksoflife.blogspot.ca/2015/01/the-four-horsemen-of-performance.html
// "the dreaded 'uniformly slow code' case where every function takes 1%
//  of CPU and you have to make one hundred separate performance optimizations
//  to improve performance at all"
//
// http://jsperf.com/closure-no-closure/2

var CallbackWrapper = function(messageManager, channelName, listenerId, requestId) {
    this.callback = this.proxy.bind(this); // bind once
    this.init(messageManager, channelName, listenerId, requestId);
};

CallbackWrapper.junkyard = [];

CallbackWrapper.factory = function(messageManager, channelName, listenerId, requestId) {
    var wrapper = CallbackWrapper.junkyard.pop();
    if ( wrapper ) {
        wrapper.init(messageManager, channelName, listenerId, requestId);
        return wrapper;
    }
    return new CallbackWrapper(messageManager, channelName, listenerId, requestId);
};

CallbackWrapper.prototype.init = function(messageManager, channelName, listenerId, requestId) {
    this.messageManager = messageManager;
    this.channelName = channelName;
    this.listenerId = listenerId;
    this.requestId = requestId;
};

CallbackWrapper.prototype.proxy = function(response) {
    var message = JSON.stringify({
        requestId: this.requestId,
        channelName: this.channelName,
        msg: response !== undefined ? response : null
    });

    if ( this.messageManager.sendAsyncMessage ) {
        this.messageManager.sendAsyncMessage(this.listenerId, message);
    } else {
        this.messageManager.broadcastAsyncMessage(this.listenerId, message);
    }

    // Mark for reuse
    this.messageManager =
    this.channelName =
    this.requestId =
    this.listenerId = null;
    CallbackWrapper.junkyard.push(this);
};

/******************************************************************************/

var httpObserver = {
    classDescription: 'net-channel-event-sinks for ' + location.host,
    classID: Components.ID('{dc8d6319-5f6e-4438-999e-53722db99e84}'),
    contractID: '@' + location.host + '/net-channel-event-sinks;1',
    REQDATAKEY: location.host + 'reqdata',
    ABORT: Components.results.NS_BINDING_ABORTED,
    ACCEPT: Components.results.NS_SUCCEEDED,
    // Request types:
    // https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIContentPolicy#Constants
    MAIN_FRAME: Ci.nsIContentPolicy.TYPE_DOCUMENT,
    VALID_CSP_TARGETS: 1 << Ci.nsIContentPolicy.TYPE_DOCUMENT |
                       1 << Ci.nsIContentPolicy.TYPE_SUBDOCUMENT,
    typeMap: {
        1: 'other',
        2: 'script',
        3: 'image',
        4: 'stylesheet',
        5: 'object',
        6: 'main_frame',
        7: 'sub_frame',
        11: 'xmlhttprequest',
        12: 'object',
        14: 'font',
        21: 'image'
    },

    get componentRegistrar() {
        return Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    },

    get categoryManager() {
        return Cc['@mozilla.org/categorymanager;1']
                .getService(Ci.nsICategoryManager);
    },

    QueryInterface: (function() {
        var {XPCOMUtils} = Cu.import('resource://gre/modules/XPCOMUtils.jsm', null);

        return XPCOMUtils.generateQI([
            Ci.nsIFactory,
            Ci.nsIObserver,
            Ci.nsIChannelEventSink,
            Ci.nsISupportsWeakReference
        ]);
    })(),

    createInstance: function(outer, iid) {
        if ( outer ) {
            throw Components.results.NS_ERROR_NO_AGGREGATION;
        }

        return this.QueryInterface(iid);
    },

    register: function() {
        this.pendingRingBufferInit();

        Services.obs.addObserver(this, 'http-on-opening-request', true);
        Services.obs.addObserver(this, 'http-on-examine-response', true);

        // Guard against stale instances not having been unregistered
        if ( this.componentRegistrar.isCIDRegistered(this.classID) ) {
            try {
                this.componentRegistrar.unregisterFactory(this.classID, Components.manager.getClassObject(this.classID, Ci.nsIFactory));
            } catch (ex) {
                console.error('uBlock> httpObserver > unable to unregister stale instance: ', ex);
            }
        }

        this.componentRegistrar.registerFactory(
            this.classID,
            this.classDescription,
            this.contractID,
            this
        );
        this.categoryManager.addCategoryEntry(
            'net-channel-event-sinks',
            this.contractID,
            this.contractID,
            false,
            true
        );
    },

    unregister: function() {
        Services.obs.removeObserver(this, 'http-on-opening-request');
        Services.obs.removeObserver(this, 'http-on-examine-response');

        this.componentRegistrar.unregisterFactory(this.classID, this);
        this.categoryManager.deleteCategoryEntry(
            'net-channel-event-sinks',
            this.contractID,
            false
        );
    },

    PendingRequest: function() {
        this.frameId = 0;
        this.parentFrameId = 0;
        this.rawtype = 0;
        this.sourceTabId = null;
        this.tabId = 0;
        this._key = ''; // key is url, from URI.spec
    },

    // If all work fine, this map should not grow indefinitely. It can have
    // stale items in it, but these will be taken care of when entries in
    // the ring buffer are overwritten.
    pendingURLToIndex: new Map(),
    pendingWritePointer: 0,
    pendingRingBuffer: new Array(32),
    pendingRingBufferInit: function() {
        // Use and reuse pre-allocated PendingRequest objects = less memory
        // churning.
        var i = this.pendingRingBuffer.length;
        while ( i-- ) {
            this.pendingRingBuffer[i] = new this.PendingRequest();
        }
    },

    createPendingRequest: function(url) {
        var bucket;
        var i = this.pendingWritePointer;
        this.pendingWritePointer = i + 1 & 31;
        var preq = this.pendingRingBuffer[i];
        // Cleanup unserviced pending request
        if ( preq._key !== '' ) {
            bucket = this.pendingURLToIndex.get(preq._key);
            if ( Array.isArray(bucket) ) {
                // Assuming i in array
                var pos = bucket.indexOf(i);
                bucket.splice(pos, 1);
                if ( bucket.length === 1 ) {
                    this.pendingURLToIndex.set(preq._key, bucket[0]);
                }
            } else if ( typeof bucket === 'number' ) {
                // Assuming bucket === i
                this.pendingURLToIndex.delete(preq._key);
            }
        }
        // Would be much simpler if a url could not appear more than once.
        bucket = this.pendingURLToIndex.get(url);
        if ( bucket === undefined ) {
            this.pendingURLToIndex.set(url, i);
        } else if ( Array.isArray(bucket) ) {
            bucket = bucket.push(i);
        } else {
            bucket = [bucket, i];
        }
        preq._key = url;
        return preq;
    },

    lookupPendingRequest: function(url) {
        var i = this.pendingURLToIndex.get(url);
        if ( i === undefined ) {
            return null;
        }
        if ( Array.isArray(i) ) {
            var bucket = i;
            i = bucket.shift();
            if ( bucket.length === 1 ) {
                this.pendingURLToIndex.set(url, bucket[0]);
            }
        } else {
            this.pendingURLToIndex.delete(url);
        }
        var preq = this.pendingRingBuffer[i];
        preq._key = ''; // mark as "serviced"
        return preq;
    },

    handlePopup: function(URI, tabId, sourceTabId) {
        if ( !sourceTabId ) {
            return false;
        }

        if ( !URI.schemeIs('http') && !URI.schemeIs('https') ) {
            return false;
        }

        var result = vAPI.tabs.onPopup({
            targetTabId: tabId,
            openerTabId: sourceTabId,
            targetURL: URI.asciiSpec
        });

        return result === true;
    },

    handleRequest: function(channel, URI, details) {
        var onBeforeRequest = vAPI.net.onBeforeRequest;
        var type = this.typeMap[details.rawtype] || 'other';

        if ( onBeforeRequest.types && onBeforeRequest.types.has(type) === false ) {
            return false;
        }

        var result = onBeforeRequest.callback({
            frameId: details.frameId,
            hostname: URI.asciiHost,
            parentFrameId: details.parentFrameId,
            tabId: details.tabId,
            type: type,
            url: URI.asciiSpec
        });

        if ( !result || typeof result !== 'object' ) {
            return false;
        }

        if ( result.cancel === true ) {
            channel.cancel(this.ABORT);
            return true;
        }

        return false;
    },

    observe: function(channel, topic) {
        if ( channel instanceof Ci.nsIHttpChannel === false ) {
            return;
        }

        var URI = channel.URI;
        var channelData, result;

        if ( topic === 'http-on-examine-response' ) {
            if ( !(channel instanceof Ci.nsIWritablePropertyBag) ) {
                return;
            }

            try {
                channelData = channel.getProperty(this.REQDATAKEY);
            } catch (ex) {
                return;
            }

            if ( !channelData ) {
                return;
            }

            if ( (1 << channelData[4] & this.VALID_CSP_TARGETS) === 0 ) {
                return;
            }

            topic = 'Content-Security-Policy';

            try {
                result = channel.getResponseHeader(topic);
            } catch (ex) {
                result = null;
            }

            result = vAPI.net.onHeadersReceived.callback({
                hostname: URI.asciiHost,
                parentFrameId: channelData[1],
                responseHeaders: result ? [{name: topic, value: result}] : [],
                tabId: channelData[3],
                type: this.typeMap[channelData[4]] || 'other',
                url: URI.asciiSpec
            });

            if ( result ) {
                channel.setResponseHeader(
                    topic,
                    result.responseHeaders.pop().value,
                    true
                );
            }

            return;
        }

        // http-on-opening-request

        //console.log('http-on-opening-request:', URI.spec);

        var pendingRequest = this.lookupPendingRequest(URI.spec);

        // Behind-the-scene request
        if ( pendingRequest === null ) {
            var rawtype = channel.loadInfo && channel.loadInfo.contentPolicyType || 1;
            if ( this.handleRequest(channel, URI, { tabId: vAPI.noTabId, rawtype: rawtype }) ) {
                return;
            }

            // Carry data for behind-the-scene redirects
            if ( channel instanceof Ci.nsIWritablePropertyBag ) {
                channel.setProperty( this.REQDATAKEY, [0, -1, null, vAPI.noTabId, rawtype]);
            }

            return;
        }

        if ( this.handleRequest(channel, URI, pendingRequest) ) {
            return;
        }

        // If request is not handled we may use the data in on-modify-request
        if ( channel instanceof Ci.nsIWritablePropertyBag ) {
            channel.setProperty(this.REQDATAKEY, [
                pendingRequest.frameId,
                pendingRequest.parentFrameId,
                pendingRequest.sourceTabId,
                pendingRequest.tabId,
                pendingRequest.rawtype
            ]);
        }
    },

    // contentPolicy.shouldLoad doesn't detect redirects, this needs to be used
    asyncOnChannelRedirect: function(oldChannel, newChannel, flags, callback) {
        var result = this.ACCEPT;

        // If error thrown, the redirect will fail
        try {
            var URI = newChannel.URI;

            if ( !URI.schemeIs('http') && !URI.schemeIs('https') ) {
                return;
            }

            if ( !(oldChannel instanceof Ci.nsIWritablePropertyBag) ) {
                return;
            }

            var channelData = oldChannel.getProperty(this.REQDATAKEY);

            if ( this.handlePopup(URI, channelData[3], channelData[2]) ) {
                result = this.ABORT;
                return;
            }

            var details = {
                frameId: channelData[0],
                parentFrameId: channelData[1],
                tabId: channelData[3],
                rawtype: channelData[4]
            };

            if ( this.handleRequest(newChannel, URI, details) ) {
                result = this.ABORT;
                return;
            }

            // Carry the data on in case of multiple redirects
            if ( newChannel instanceof Ci.nsIWritablePropertyBag ) {
                newChannel.setProperty(this.REQDATAKEY, channelData);
            }
        } catch (ex) {
            // console.error(ex);
        } finally {
            callback.onRedirectVerifyCallback(result);
        }
    }
};

/******************************************************************************/

vAPI.net = {};

/******************************************************************************/

vAPI.net.registerListeners = function() {
    // Since it's not used
    this.onBeforeSendHeaders = null;

    this.onBeforeRequest.types = this.onBeforeRequest.types ?
        new Set(this.onBeforeRequest.types) :
        null;

    var shouldLoadListenerMessageName = location.host + ':shouldLoad';
    var shouldLoadListener = function(e) {
        // Non blocking: it is assumed that the http observer is fired after
        // shouldLoad recorded the pending requests. If this is not the case,
        // a request would end up being categorized as a behind-the-scene
        // requests.
        var details = e.data;
        var tabId = tabWatcher.tabIdFromTarget(e.target);
        var sourceTabId = null;

        // Popup candidate
        if ( details.openerURL ) {
            for ( var browser of tabWatcher.browsers() ) {
                var URI = browser.currentURI;

                // Probably isn't the best method to identify the source tab.
                // Apparently URI can be undefined under some circumstances: I
                // believe this may have to do with those very temporary
                // browser objects created when opening a new tab, i.e. related
                // to https://github.com/gorhill/uBlock/issues/212
                if ( URI && URI.spec !== details.openerURL ) {
                    continue;
                }

                sourceTabId = tabWatcher.tabIdFromTarget(browser);

                if ( sourceTabId === tabId ) {
                    sourceTabId = null;
                    continue;
                }

                URI = Services.io.newURI(details.url, null, null);

                if ( httpObserver.handlePopup(URI, tabId, sourceTabId) ) {
                    return;
                }

                break;
            }
        }

        //console.log('shouldLoadListener:', details.url);

        var pendingReq = httpObserver.createPendingRequest(details.url);
        pendingReq.frameId = details.frameId;
        pendingReq.parentFrameId = details.parentFrameId;
        pendingReq.rawtype = details.rawtype;
        pendingReq.sourceTabId = sourceTabId;
        pendingReq.tabId = tabId;
    };

    vAPI.messaging.globalMessageManager.addMessageListener(
        shouldLoadListenerMessageName,
        shouldLoadListener
    );

    var locationChangedListenerMessageName = location.host + ':locationChanged';
    var locationChangedListener = function(e) {
        var details = e.data;
        var browser = e.target;
        var tabId = tabWatcher.tabIdFromTarget(browser);

        // Ignore notifications related to our popup
        if ( details.url.lastIndexOf(vAPI.getURL('popup.html'), 0) === 0 ) {
            return;
        }

        //console.debug("nsIWebProgressListener: onLocationChange: " + details.url + " (" + details.flags + ")");        

        // LOCATION_CHANGE_SAME_DOCUMENT = "did not load a new document"
        if ( details.flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT ) {
            vAPI.tabs.onUpdated(tabId, {url: details.url}, {
                frameId: 0,
                tabId: tabId,
                url: browser.currentURI.asciiSpec
            });
            return;
        }

        // https://github.com/chrisaljoudi/uBlock/issues/105
        // Allow any kind of pages
        vAPI.tabs.onNavigation({
            frameId: 0,
            tabId: tabId,
            url: details.url,
        });
    };

    vAPI.messaging.globalMessageManager.addMessageListener(
        locationChangedListenerMessageName,
        locationChangedListener
    );

    httpObserver.register();

    cleanupTasks.push(function() {
        vAPI.messaging.globalMessageManager.removeMessageListener(
            shouldLoadListenerMessageName,
            shouldLoadListener
        );

        vAPI.messaging.globalMessageManager.removeMessageListener(
            locationChangedListenerMessageName,
            locationChangedListener
        );

        httpObserver.unregister();
    });
};

/******************************************************************************/

vAPI.toolbarButton = {
    id: location.host + '-button',
    type: 'view',
    viewId: location.host + '-panel',
    label: vAPI.app.name,
    tooltiptext: vAPI.app.name,
    tabs: {/*tabId: {badge: 0, img: boolean}*/}
};

/******************************************************************************/

// Toolbar button UI for desktop Firefox
vAPI.toolbarButton.init = function() {
    if ( vAPI.fennec ) {
        // Menu UI for Fennec
        var tb = {
            menuItemIds: new WeakMap(),
            label: vAPI.app.name,
            tabs: {}
        };
        vAPI.toolbarButton = tb;

        tb.getMenuItemLabel = function(tabId) {
            var label = this.label;
            if ( tabId === undefined ) {
                return label;
            }
            var tabDetails = this.tabs[tabId];
            if ( !tabDetails ) {
                return label;
            }
            if ( !tabDetails.img ) {
                label += ' (' + vAPI.i18n('fennecMenuItemBlockingOff') + ')';
            } else if ( tabDetails.badge ) {
                label += ' (' + tabDetails.badge + ')';
            }
            return label;
        };

        tb.onClick = function() {
            var win = Services.wm.getMostRecentWindow('navigator:browser');
            var curTabId = tabWatcher.tabIdFromTarget(getTabBrowser(win).selectedTab);
            vAPI.tabs.open({
                url: 'popup.html?tabId=' + curTabId,
                index: -1,
                select: true
            });
        };

        tb.updateState = function(win, tabId) {
            var id = this.menuItemIds.get(win);
            if ( !id ) {
                return;
            }
            win.NativeWindow.menu.update(id, {
                name: this.getMenuItemLabel(tabId)
            });
        };

        // Only actually expecting one window under Fennec (note, not tabs, windows)
        for ( var win of vAPI.tabs.getWindows() ) {
            var label = tb.getMenuItemLabel();
            var id = win.NativeWindow.menu.add({
                name: label,
                callback: tb.onClick
            });
            tb.menuItemIds.set(win, id);
        }

        cleanupTasks.push(function() {
            for ( var win of vAPI.tabs.getWindows() ) {
                var id = tb.menuItemIds.get(win);
                if ( id ) {
                    win.NativeWindow.menu.remove(id);
                    tb.menuItemIds.delete(win);
                }
            }
        });

        return;
    }

    var CustomizableUI;
    try {
        CustomizableUI = Cu.import('resource:///modules/CustomizableUI.jsm', null).CustomizableUI;
    } catch (ex) {
        return;
    }

    this.defaultArea = CustomizableUI.AREA_NAVBAR;
    this.styleURI = [
        '#' + this.id + ' {',
            'list-style-image: url(',
                vAPI.getURL('img/browsericons/icon16-off.svg'),
            ');',
        '}',
        '#' + this.viewId + ', #' + this.viewId + ' > iframe {',
            'width: 160px;',
            'height: 290px;',
            'overflow: hidden !important;',
        '}'
    ];

    var platformVersion = Services.appinfo.platformVersion;

    if ( Services.vc.compare(platformVersion, '36.0') < 0 ) {
        this.styleURI.push(
            '#' + this.id + '[badge]:not([badge=""])::after {',
                'position: absolute;',
                'margin-left: -16px;',
                'margin-top: 3px;',
                'padding: 1px 2px;',
                'font-size: 9px;',
                'font-weight: bold;',
                'color: #fff;',
                'background: #666;',
                'content: attr(badge);',
            '}'
        );
    } else {
        this.CUIEvents = {};
        var updateBadge = function() {
            var wId = vAPI.toolbarButton.id;
            var buttonInPanel = CustomizableUI.getWidget(wId).areaType === CustomizableUI.TYPE_MENU_PANEL;

            for ( var win of vAPI.tabs.getWindows() ) {
                var button = win.document.getElementById(wId);
                if ( buttonInPanel ) {
                    button.classList.remove('badged-button');
                    continue;
                }
                if ( button === null ) {
                    continue;
                }
                button.classList.add('badged-button');
            }

            if ( buttonInPanel ) {
                return;
            }

            // Anonymous elements need some time to be reachable
            vAPI.setTimeout(this.updateBadgeStyle, 250);
        }.bind(this.CUIEvents);

        // https://developer.mozilla.org/en-US/docs/Mozilla/JavaScript_code_modules/CustomizableUI.jsm#Listeners
        this.CUIEvents.onCustomizeEnd = updateBadge;
        this.CUIEvents.onWidgetAdded = updateBadge;
        this.CUIEvents.onWidgetUnderflow = updateBadge;

        this.CUIEvents.updateBadgeStyle = function() {
            var css = [
                'background: #666',
                'color: #fff'
            ].join(';');

            for ( var win of vAPI.tabs.getWindows() ) {
                var button = win.document.getElementById(vAPI.toolbarButton.id);
                if ( button === null ) {
                    continue;
                }
                var badge = button.ownerDocument.getAnonymousElementByAttribute(
                    button,
                    'class',
                    'toolbarbutton-badge'
                );
                if ( !badge ) {
                    return;
                }

                badge.style.cssText = css;
            }
        };

        this.onCreated = function(button) {
            button.setAttribute('badge', '');
            vAPI.setTimeout(updateBadge, 250);
        };

        CustomizableUI.addListener(this.CUIEvents);
    }

    this.styleURI = Services.io.newURI(
        'data:text/css,' + encodeURIComponent(this.styleURI.join('')),
        null,
        null
    );

    this.closePopup = function({target}) {
        CustomizableUI.hidePanelForNode(
            target.ownerDocument.getElementById(vAPI.toolbarButton.viewId)
        );
    };

    CustomizableUI.createWidget(this);
    vAPI.messaging.globalMessageManager.addMessageListener(
        location.host + ':closePopup',
        this.closePopup
    );

    cleanupTasks.push(function() {
        if ( this.CUIEvents ) {
            CustomizableUI.removeListener(this.CUIEvents);
        }

        CustomizableUI.destroyWidget(this.id);
        vAPI.messaging.globalMessageManager.removeMessageListener(
            location.host + ':closePopup',
            this.closePopup
        );

        for ( var win of vAPI.tabs.getWindows() ) {
            var panel = win.document.getElementById(this.viewId);
            panel.parentNode.removeChild(panel);
            win.QueryInterface(Ci.nsIInterfaceRequestor)
                .getInterface(Ci.nsIDOMWindowUtils)
                .removeSheet(this.styleURI, 1);
        }
    }.bind(this));

    this.init = null;
};

/******************************************************************************/

vAPI.toolbarButton.onBeforeCreated = function(doc) {
    var panel = doc.createElement('panelview');
    panel.setAttribute('id', this.viewId);

    var iframe = doc.createElement('iframe');
    iframe.setAttribute('type', 'content');

    doc.getElementById('PanelUI-multiView')
        .appendChild(panel)
        .appendChild(iframe);

    var updateTimer = null;
    var delayedResize = function() {
        if ( updateTimer ) {
            return;
        }

        updateTimer = vAPI.setTimeout(resizePopup, 10);
    };
    var resizePopup = function() {
        updateTimer = null;
        var body = iframe.contentDocument.body;
        panel.parentNode.style.maxWidth = 'none';
        // https://github.com/chrisaljoudi/uBlock/issues/730
        // Voodoo programming: this recipe works
        panel.style.height = iframe.style.height = body.clientHeight.toString() + 'px';
        panel.style.width = iframe.style.width = body.clientWidth.toString() + 'px';
        if ( iframe.clientHeight !== body.clientHeight || iframe.clientWidth !== body.clientWidth ) {
            delayedResize();
        }
    };
    var onPopupReady = function() {
        var win = this.contentWindow;

        if ( !win || win.location.host !== location.host ) {
            return;
        }

        // https://github.com/gorhill/uBlock/issues/83
        // Add `portrait` class if width is constrained.
        try {
            var CustomizableUI = Cu.import('resource:///modules/CustomizableUI.jsm', null).CustomizableUI;
            iframe.contentDocument.body.classList.toggle(
                'portrait',
                CustomizableUI.getWidget(vAPI.toolbarButton.id).areaType === CustomizableUI.TYPE_MENU_PANEL
            );
        } catch (ex) {
            /* noop */
        }

        new win.MutationObserver(delayedResize).observe(win.document.body, {
            attributes: true,
            characterData: true,
            subtree: true
        });

        delayedResize();
    };

    iframe.addEventListener('load', onPopupReady, true);

    doc.defaultView.QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsIDOMWindowUtils)
        .loadSheet(this.styleURI, 1);
};

/******************************************************************************/

vAPI.toolbarButton.onViewShowing = function({target}) {
    target.firstChild.setAttribute('src', vAPI.getURL('popup.html'));
};

/******************************************************************************/

vAPI.toolbarButton.onViewHiding = function({target}) {
    target.parentNode.style.maxWidth = '';
    target.firstChild.setAttribute('src', 'about:blank');
};

/******************************************************************************/

vAPI.toolbarButton.updateState = function(win, tabId) {
    var button = win.document.getElementById(this.id);

    if ( !button ) {
        return;
    }

    var icon = this.tabs[tabId];
    button.setAttribute('badge', icon && icon.badge || '');

    if ( !icon || !icon.img ) {
        icon = '';
    }
    else {
        icon = 'url(' + vAPI.getURL('img/browsericons/icon16.svg') + ')';
    }

    button.style.listStyleImage = icon;
};

/******************************************************************************/

vAPI.toolbarButton.init();

/******************************************************************************/

vAPI.contextMenu = {
    contextMap: {
        frame: 'inFrame',
        link: 'onLink',
        image: 'onImage',
        audio: 'onAudio',
        video: 'onVideo',
        editable: 'onEditableArea'
    }
};

/******************************************************************************/

vAPI.contextMenu.displayMenuItem = function({target}) {
    var doc = target.ownerDocument;
    var gContextMenu = doc.defaultView.gContextMenu;

    if ( !gContextMenu.browser ) {
        return;
    }

    var menuitem = doc.getElementById(vAPI.contextMenu.menuItemId);
    var currentURI = gContextMenu.browser.currentURI;

    // https://github.com/chrisaljoudi/uBlock/issues/105
    // TODO: Should the element picker works on any kind of pages?
    if ( !currentURI.schemeIs('http') && !currentURI.schemeIs('https') ) {
        menuitem.hidden = true;
        return;
    }

    var ctx = vAPI.contextMenu.contexts;

    if ( !ctx ) {
        menuitem.hidden = false;
        return;
    }

    var ctxMap = vAPI.contextMenu.contextMap;

    for ( var context of ctx ) {
        if ( context === 'page' && !gContextMenu.onLink && !gContextMenu.onImage
            && !gContextMenu.onEditableArea && !gContextMenu.inFrame
            && !gContextMenu.onVideo && !gContextMenu.onAudio ) {
            menuitem.hidden = false;
            return;
        }

        if ( gContextMenu[ctxMap[context]] ) {
            menuitem.hidden = false;
            return;
        }
    }

    menuitem.hidden = true;
};

/******************************************************************************/

vAPI.contextMenu.register = function(doc) {
    if ( !this.menuItemId ) {
        return;
    }

    if ( vAPI.fennec ) {
        // TODO https://developer.mozilla.org/en-US/Add-ons/Firefox_for_Android/API/NativeWindow/contextmenus/add
        /*var nativeWindow = doc.defaultView.NativeWindow;
        contextId = nativeWindow.contextmenus.add(
            this.menuLabel,
            nativeWindow.contextmenus.linkOpenableContext,
            this.onCommand
        );*/
        return;
    }

    var contextMenu = doc.getElementById('contentAreaContextMenu');
    var menuitem = doc.createElement('menuitem');
    menuitem.setAttribute('id', this.menuItemId);
    menuitem.setAttribute('label', this.menuLabel);
    menuitem.setAttribute('image', vAPI.getURL('img/browsericons/icon16.svg'));
    menuitem.setAttribute('class', 'menuitem-iconic');
    menuitem.addEventListener('command', this.onCommand);
    contextMenu.addEventListener('popupshowing', this.displayMenuItem);
    contextMenu.insertBefore(menuitem, doc.getElementById('inspect-separator'));
};

/******************************************************************************/

vAPI.contextMenu.unregister = function(doc) {
    if ( !this.menuItemId ) {
        return;
    }

    if ( vAPI.fennec ) {
        // TODO
        return;
    }

    var menuitem = doc.getElementById(this.menuItemId);
    var contextMenu = menuitem.parentNode;
    menuitem.removeEventListener('command', this.onCommand);
    contextMenu.removeEventListener('popupshowing', this.displayMenuItem);
    contextMenu.removeChild(menuitem);
};

/******************************************************************************/

vAPI.contextMenu.create = function(details, callback) {
    this.menuItemId = details.id;
    this.menuLabel = details.title;
    this.contexts = details.contexts;

    if ( Array.isArray(this.contexts) && this.contexts.length ) {
        this.contexts = this.contexts.indexOf('all') === -1 ? this.contexts : null;
    } else {
        // default in Chrome
        this.contexts = ['page'];
    }

    this.onCommand = function() {
        var gContextMenu = getOwnerWindow(this).gContextMenu;
        var details = {
            menuItemId: this.id
        };

        if ( gContextMenu.inFrame ) {
            details.tagName = 'iframe';
            // Probably won't work with e10s
            details.frameUrl = gContextMenu.focusedWindow && gContextMenu.focusedWindow.location.href || '';
        } else if ( gContextMenu.onImage ) {
            details.tagName = 'img';
            details.srcUrl = gContextMenu.mediaURL;
        } else if ( gContextMenu.onAudio ) {
            details.tagName = 'audio';
            details.srcUrl = gContextMenu.mediaURL;
        } else if ( gContextMenu.onVideo ) {
            details.tagName = 'video';
            details.srcUrl = gContextMenu.mediaURL;
        } else if ( gContextMenu.onLink ) {
            details.tagName = 'a';
            details.linkUrl = gContextMenu.linkURL;
        }

        callback(details, {
            id: tabWatcher.tabIdFromTarget(gContextMenu.browser),
            url: gContextMenu.browser.currentURI.asciiSpec
        });
    };

    for ( var win of vAPI.tabs.getWindows() ) {
        this.register(win.document);
    }
};

/******************************************************************************/

vAPI.contextMenu.remove = function() {
    for ( var win of vAPI.tabs.getWindows() ) {
        this.unregister(win.document);
    }

    this.menuItemId = null;
    this.menuLabel = null;
    this.contexts = null;
    this.onCommand = null;
};

/******************************************************************************/

var optionsObserver = {
    addonId: 'uBlock0@raymondhill.net',

    register: function() {
        Services.obs.addObserver(this, 'addon-options-displayed', false);
        cleanupTasks.push(this.unregister.bind(this));

        var browser = tabWatcher.currentBrowser();
        if ( browser && browser.currentURI && browser.currentURI.spec === 'about:addons' ) {
            this.observe(browser.contentDocument, 'addon-enabled', this.addonId);
        }
    },

    unregister: function() {
        Services.obs.removeObserver(this, 'addon-options-displayed');
    },

    setupOptionsButton: function(doc, id, page) {
        var button = doc.getElementById(id);
        if ( button === null ) {
            return;
        }
        button.addEventListener('command', function() {
            vAPI.tabs.open({ url: page, index: -1 });
        });
        button.label = vAPI.i18n(id);
    },

    observe: function(doc, topic, addonId) {
        if ( addonId !== this.addonId ) {
            return;
        }

        this.setupOptionsButton(doc, 'showDashboardButton', 'dashboard.html');
        this.setupOptionsButton(doc, 'showNetworkLogButton', 'logger-ui.html');
    }
};

optionsObserver.register();

/******************************************************************************/

vAPI.lastError = function() {
    return null;
};

/******************************************************************************/

// This is called only once, when everything has been loaded in memory after
// the extension was launched. It can be used to inject content scripts
// in already opened web pages, to remove whatever nuisance could make it to
// the web pages before uBlock was ready.

vAPI.onLoadAllCompleted = function() {
    var µb = µBlock;
    var tabId;
    for ( var browser of tabWatcher.browsers() ) {
        tabId = tabWatcher.tabIdFromTarget(browser);
        µb.tabContextManager.commit(tabId, browser.currentURI.asciiSpec);
        µb.bindTabToPageStats(tabId);
        browser.messageManager.sendAsyncMessage(
            location.host + '-load-completed'
        );
    }
};

/******************************************************************************/

// Likelihood is that we do not have to punycode: given punycode overhead,
// it's faster to check and skip than do it unconditionally all the time.

var punycodeHostname = punycode.toASCII;
var isNotASCII = /[^\x21-\x7F]/;

vAPI.punycodeHostname = function(hostname) {
    return isNotASCII.test(hostname) ? punycodeHostname(hostname) : hostname;
};

vAPI.punycodeURL = function(url) {
    if ( isNotASCII.test(url) ) {
        return Services.io.newURI(url, null, null).asciiSpec;
    }
    return url;
};

/******************************************************************************/

})();

/******************************************************************************/

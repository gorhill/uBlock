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

// Set default preferences for user to find in about:config
vAPI.localStorage.setDefaultBool('forceLegacyToolbarButton', false);

/******************************************************************************/

// List of things that needs to be destroyed when disabling the extension
// Only functions should be added to it

var cleanupTasks = [];

// This must be updated manually, every time a new task is added/removed
var expectedNumberOfCleanups = 7;

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

// For now, only booleans.

vAPI.browserSettings = {
    originalValues: {},

    rememberOriginalValue: function(path, setting) {
        var key = path + '.' + setting;
        if ( this.originalValues.hasOwnProperty(key) ) {
            return;
        }
        var hasUserValue;
        var branch = Services.prefs.getBranch(path + '.');
        try {
            hasUserValue = branch.prefHasUserValue(setting);
        } catch (ex) {
        }
        if ( hasUserValue !== undefined ) {
            this.originalValues[key] = hasUserValue ? this.getValue(path, setting) : undefined;
        }
    },

    clear: function(path, setting) {
        var key = path + '.' + setting;

        // Value was not overriden -- nothing to restore
        if ( this.originalValues.hasOwnProperty(key) === false ) {
            return;
        }

        var value = this.originalValues[key];
        // https://github.com/gorhill/uBlock/issues/292#issuecomment-109621979
        // Forget the value immediately, it may change outside of
        // uBlock control.
        delete this.originalValues[key];

        // Original value was a default one
        if ( value === undefined ) {
            try {
                Services.prefs.getBranch(path + '.').clearUserPref(setting);
            } catch (ex) {
            }
            return;
        }

        // Reset to original value
        this.setValue(path, setting, value);
    },

    getValue: function(path, setting) {
        var branch = Services.prefs.getBranch(path + '.');
        var getMethod;

        // https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIPrefBranch#getPrefType%28%29
        switch ( branch.getPrefType(setting) ) {
        case  64: // PREF_INT
            getMethod = 'getIntPref';
            break;
        case 128: // PREF_BOOL
            getMethod = 'getBoolPref';
            break;
        default:  // not supported
            return;
        }

        try {
            return branch[getMethod](setting);
        } catch (ex) {
        }
    },

    setValue: function(path, setting, value) {
        var setMethod;
        switch ( typeof value ) {
        case  'number':
            setMethod = 'setIntPref';
            break;
        case 'boolean':
            setMethod = 'setBoolPref';
            break;
        default:  // not supported
            return;
        }

        try {
            Services.prefs.getBranch(path + '.')[setMethod](setting, value);
        } catch (ex) {
        }
    },

    set: function(details) {
        var value;
        for ( var setting in details ) {
            if ( details.hasOwnProperty(setting) === false ) {
                continue;
            }
            switch ( setting ) {
            case 'prefetching':
                this.rememberOriginalValue('network', 'prefetch-next');
                // http://betanews.com/2015/08/15/firefox-stealthily-loads-webpages-when-you-hover-over-links-heres-how-to-stop-it/
                // https://bugzilla.mozilla.org/show_bug.cgi?id=814169
                // Sigh.
                this.rememberOriginalValue('network.http', 'speculative-parallel-limit');
                value = !!details[setting];
                // https://github.com/gorhill/uBlock/issues/292
                // "true" means "do not disable", i.e. leave entry alone
                if ( value === true ) {
                    this.clear('network', 'prefetch-next');
                    this.clear('network.http', 'speculative-parallel-limit');
                } else {
                    this.setValue('network', 'prefetch-next', false);
                    this.setValue('network.http', 'speculative-parallel-limit', 0);
                }
                break;

            case 'hyperlinkAuditing':
                this.rememberOriginalValue('browser', 'send_pings');
                this.rememberOriginalValue('beacon', 'enabled');
                value = !!details[setting];
                // https://github.com/gorhill/uBlock/issues/292
                // "true" means "do not disable", i.e. leave entry alone
                if ( value === true ) {
                    this.clear('browser', 'send_pings');
                    this.clear('beacon', 'enabled');
                } else {
                    this.setValue('browser', 'send_pings', false);
                    this.setValue('beacon', 'enabled', false);
                }
                break;

            case 'webrtcIPAddress':
                this.rememberOriginalValue('media.peerconnection', 'enabled');
                value = !!details[setting];
                if ( value === true ) {
                    this.clear('media.peerconnection', 'enabled');
                } else {
                    this.setValue('media.peerconnection', 'enabled', false);
                }
                break;

            default:
                break;
            }
        }
    },

    restoreAll: function() {
        var pos;
        for ( var key in this.originalValues ) {
            if ( this.originalValues.hasOwnProperty(key) === false ) {
                continue;
            }
            pos = key.lastIndexOf('.');
            this.clear(key.slice(0, pos), key.slice(pos + 1));
        }
    }
};

cleanupTasks.push(vAPI.browserSettings.restoreAll.bind(vAPI.browserSettings));

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

                while ( (row = rows.getNextRow()) ) {
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

            // Or simply .equals if we care about the fragment
            if ( URI.equalsExceptRef(browser.currentURI) === false ) {
                continue;
            }

            this.select(tab);

            // Update URL if fragment is different
            if ( URI.equals(browser.currentURI) === false ) {
                browser.loadURI(URI.asciiSpec);
            }
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

    // Open in a standalone window
    if ( details.popup === true ) {
        Services.ww.openWindow(
            self,
            details.url,
            null,
            'location=1,menubar=1,personalbar=1,resizable=1,toolbar=1',
            null
        );
        return;
    }

    if ( details.index === -1 ) {
        details.index = tabBrowser.browsers.indexOf(tabBrowser.selectedBrowser) + 1;
    }

    tab = tabBrowser.loadOneTab(details.url, { inBackground: !details.active });

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

    // https://github.com/gorhill/uBlock/issues/470
    var win = getOwnerWindow(tab);
    win.focus();

    var tabBrowser = getTabBrowser(win);

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
            tabId = '' + tabIdGenerator++;
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
        // https://github.com/gorhill/uBlock/issues/399
        // getTabBrowser() can return null at browser launch time.
        var tabBrowser = getTabBrowser(win);
        if ( tabBrowser === null ) {
            return null;
        }
        return browserFromTarget(tabBrowser.selectedTab);
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

    var attachToTabBrowser = function(window) {
        var tabBrowser = getTabBrowser(window);
        if ( !tabBrowser ) {
            return false;
        }

        var tabContainer;
        if ( tabBrowser.deck ) {                    // Fennec
            tabContainer = tabBrowser.deck;
        } else if ( tabBrowser.tabContainer ) {     // Firefox
            tabContainer = tabBrowser.tabContainer;
            vAPI.contextMenu.register(window.document);
        } else {
            return true;
        }

        if ( typeof vAPI.toolbarButton.attachToNewWindow === 'function' ) {
            vAPI.toolbarButton.attachToNewWindow(window);
        }

        tabContainer.addEventListener('TabOpen', onOpen);
        tabContainer.addEventListener('TabShow', onShow);
        tabContainer.addEventListener('TabClose', onClose);
        // when new window is opened TabSelect doesn't run on the selected tab?
        tabContainer.addEventListener('TabSelect', onSelect);

        return true;
    };

    var onWindowLoad = function(ev) {
        if ( ev ) {
            this.removeEventListener(ev.type, onWindowLoad);
        }

        var wintype = this.document.documentElement.getAttribute('windowtype');
        if ( wintype !== 'navigator:browser' ) {
            return;
        }

        // On some platforms, the tab browser isn't immediately available,
        // try waiting a bit if this happens.
        var win = this;
        if ( attachToTabBrowser(win) === false ) {
            vAPI.setTimeout(attachToTabBrowser.bind(null, win), 250);
        }
    };

    var onWindowUnload = function() {
        vAPI.contextMenu.unregister(this.document);
        this.removeEventListener('DOMContentLoaded', onWindowLoad);

        var tabBrowser = getTabBrowser(this);
        if ( !tabBrowser ) {
            return;
        }

        var tabContainer;
        if ( tabBrowser.deck ) {                    // Fennec
            tabContainer = tabBrowser.deck;
        } else if ( tabBrowser.tabContainer ) {     // Firefox
            tabContainer = tabBrowser.tabContainer;
        }
        if ( tabContainer ) {
            tabContainer.removeEventListener('TabOpen', onOpen);
            tabContainer.removeEventListener('TabShow', onShow);
            tabContainer.removeEventListener('TabClose', onClose);
            tabContainer.removeEventListener('TabSelect', onSelect);
        }

        // https://github.com/gorhill/uBlock/issues/574
        // To keep in mind: not all windows are tab containers,
        // sometimes the window IS the tab.
        var tabs;
        if ( tabBrowser.tabs ) {
            tabs = tabBrowser.tabs;
        } else if ( tabBrowser.localName === 'browser' ) {
            tabs = [tabBrowser];
        } else {
            tabs = [];
        }

        var browser, URI, tabId;
        for ( var tab of tabs ) {
            browser = tabWatcher.browserFromTarget(tab);
            if ( browser === null ) {
                continue;
            }
            URI = browser.currentURI;
            // Close extension tabs
            if ( URI.schemeIs('chrome') && URI.host === location.host ) {
                vAPI.tabs._remove(tab, getTabBrowser(this));
            }
            browser = browserFromTarget(tab);
            tabId = browserToTabIdMap.get(browser);
            if ( tabId !== undefined ) {
                removeBrowserEntry(tabId, browser);
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
                return;
            }
            if ( topic === 'domwindowclosed' ) {
                onWindowUnload.call(win);
                return;
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

vAPI.messaging.onMessage = (function() {
    var messaging = vAPI.messaging;
    var toAuxPending = {};

    // Use a wrapper to avoid closure and to allow reuse.
    var CallbackWrapper = function(messageManager, listenerId, channelName, auxProcessId, timeout) {
        this.callback = this.proxy.bind(this); // bind once
        this.init(messageManager, listenerId, channelName, auxProcessId, timeout);
    };

    CallbackWrapper.prototype.init = function(messageManager, listenerId, channelName, auxProcessId, timeout) {
        this.messageManager = messageManager;
        this.listenerId = listenerId;
        this.channelName = channelName;
        this.auxProcessId = auxProcessId;
        this.timerId = timeout !== undefined ?
                            vAPI.setTimeout(this.callback, timeout) :
                            null;
        return this;
    };

    CallbackWrapper.prototype.proxy = function(response) {
        if ( this.timerId !== null ) {
            clearTimeout(this.timerId);
            delete toAuxPending[this.timerId];
            this.timerId = null;
        }
        var message = JSON.stringify({
            auxProcessId: this.auxProcessId,
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
        this.listenerId =
        this.channelName =
        this.auxProcessId = null;
        callbackWrapperJunkyard.push(this);
    };

    var callbackWrapperJunkyard = [];

    var callbackWrapperFactory = function(messageManager, listenerId, channelName, auxProcessId, timeout) {
        var wrapper = callbackWrapperJunkyard.pop();
        if ( wrapper ) {
            return wrapper.init(messageManager, listenerId, channelName, auxProcessId, timeout);
        }
        return new CallbackWrapper(messageManager, listenerId, channelName, auxProcessId, timeout);
    };

    // "Auxiliary process": any process other than main process.
    var toAux = function(target, details) {
        var messageManagerFrom = target.messageManager;

        // Message came from a popup, and its message manager is not usable.
        // So instead we broadcast to the parent window.
        if ( !messageManagerFrom ) {
            messageManagerFrom = getOwnerWindow(
                target.webNavigation.QueryInterface(Ci.nsIDocShell).chromeEventHandler
            ).messageManager;
        }

        var wrapper;
        if ( details.auxProcessId !== undefined ) {
            var channelNameRaw = details.channelName;
            var pos = channelNameRaw.indexOf('|');
            wrapper = callbackWrapperFactory(
                messageManagerFrom,
                channelNameRaw.slice(0, pos),
                channelNameRaw.slice(pos + 1),
                details.auxProcessId,
                1023
            );
        }

        var messageManagerTo = null;
        var browser = tabWatcher.browserFromTabId(details.toTabId);
        if ( browser !== null && browser.messageManager ) {
            messageManagerTo = browser.messageManager;
        }
        if ( messageManagerTo === null ) {
            if ( wrapper !== undefined ) {
                wrapper.callback();
            }
            return;
        }

        // As per HTML5, timer id is always an integer, thus suitable to be used
        // as a key, and which value is safe to use across process boundaries.
        if ( wrapper !== undefined ) {
            toAuxPending[wrapper.timerId] = wrapper;
        }

        var targetId = location.host + ':broadcast';
        var payload = JSON.stringify({
            mainProcessId: wrapper && wrapper.timerId,
            channelName: details.toChannel,
            msg: details.msg
        });

        if ( messageManagerTo.sendAsyncMessage ) {
            messageManagerTo.sendAsyncMessage(targetId, payload);
        } else {
            messageManagerTo.broadcastAsyncMessage(targetId, payload);
        }
    };

    var toAuxResponse = function(details) {
        var mainProcessId = details.mainProcessId;
        if ( mainProcessId === undefined ) {
            return;
        }
        if ( toAuxPending.hasOwnProperty(mainProcessId) === false ) {
            return;
        }
        var wrapper = toAuxPending[mainProcessId];
        delete toAuxPending[mainProcessId];
        wrapper.callback(details.msg);
    };

    return function({target, data}) {
        // Auxiliary process to auxiliary process
        if ( data.toTabId !== undefined ) {
            toAux(target, data);
            return;
        }

        // Auxiliary process to auxiliary process: response
        if ( data.mainProcessId !== undefined ) {
            toAuxResponse(data);
            return;
        }

        // Auxiliary process to main process
        var messageManager = target.messageManager;

        // Message came from a popup, and its message manager is not usable.
        // So instead we broadcast to the parent window.
        if ( !messageManager ) {
            messageManager = getOwnerWindow(
                target.webNavigation.QueryInterface(Ci.nsIDocShell).chromeEventHandler
            ).messageManager;
        }

        var channelNameRaw = data.channelName;
        var pos = channelNameRaw.indexOf('|');
        var channelName = channelNameRaw.slice(pos + 1);

        // Auxiliary process to main process: prepare response
        var callback = messaging.NOOPFUNC;
        if ( data.auxProcessId !== undefined ) {
            callback = callbackWrapperFactory(
                messageManager,
                channelNameRaw.slice(0, pos),
                channelName,
                data.auxProcessId
            ).callback;
        }

        var sender = {
            tab: {
                id: tabWatcher.tabIdFromTarget(target)
            }
        };

        // Auxiliary process to main process: specific handler
        var r = messaging.UNHANDLED;
        var listener = messaging.listeners[channelName];
        if ( typeof listener === 'function' ) {
            r = listener(data.msg, sender, callback);
        }
        if ( r !== messaging.UNHANDLED ) {
            return;
        }

        // Auxiliary process to main process: default handler
        r = messaging.defaultHandler(data.msg, sender, callback);
        if ( r !== messaging.UNHANDLED ) {
            return;
        }

        // Auxiliary process to main process: no handler
        console.error('uBlock> messaging > unknown request: %o', data);

        // Need to callback anyways in case caller expected an answer, or
        // else there is a memory leak on caller's side
        callback();
    };
})();

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

        gmm.broadcastAsyncMessage(
            location.host + ':broadcast',
            JSON.stringify({
                broadcast: true,
                channelName: 'vAPI',
                msg: { cmd: 'shutdownSandbox' }
            })
        );

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
        10: 'ping',
        11: 'xmlhttprequest',
        12: 'object',
        14: 'font',
        15: 'media',
        16: 'websocket',
        19: 'beacon',
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

                // https://github.com/gorhill/uBlock/issues/450
                // Skip entry if no valid URI available.
                // Apparently URI can be undefined under some circumstances: I
                // believe this may have to do with those very temporary
                // browser objects created when opening a new tab, i.e. related
                // to https://github.com/gorhill/uBlock/issues/212
                if ( !URI || URI.spec !== details.openerURL ) {
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
/******************************************************************************/

vAPI.toolbarButton = {
    id: location.host + '-button',
    type: 'view',
    viewId: location.host + '-panel',
    label: vAPI.app.name,
    tooltiptext: vAPI.app.name,
    tabs: {/*tabId: {badge: 0, img: boolean}*/},
    init: null,
    codePath: ''
};

/******************************************************************************/

// Fennec

(function() {
    if ( !vAPI.fennec ) {
        return;
    }

    var tbb = vAPI.toolbarButton;

    tbb.codePath = 'fennec';

    var menuItemIds = new WeakMap();

    var shutdown = function() {
        for ( var win of vAPI.tabs.getWindows() ) {
            var id = menuItemIds.get(win);
            if ( !id ) {
                continue;
            }
            win.NativeWindow.menu.remove(id);
            menuItemIds.delete(win);
        }
    };

    tbb.getMenuItemLabel = function(tabId) {
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

    tbb.onClick = function() {
        var win = Services.wm.getMostRecentWindow('navigator:browser');
        var curTabId = tabWatcher.tabIdFromTarget(getTabBrowser(win).selectedTab);
        vAPI.tabs.open({
            url: 'popup.html?tabId=' + curTabId,
            index: -1,
            select: true
        });
    };

    tbb.updateState = function(win, tabId) {
        var id = menuItemIds.get(win);
        if ( !id ) {
            return;
        }
        win.NativeWindow.menu.update(id, {
            name: this.getMenuItemLabel(tabId)
        });
    };

    tbb.init = function() {
        // Only actually expecting one window under Fennec (note, not tabs, windows)
        for ( var win of vAPI.tabs.getWindows() ) {
            var label = this.getMenuItemLabel();
            var id = win.NativeWindow.menu.add({
                name: label,
                callback: this.onClick
            });
            menuItemIds.set(win, id);
        }

        cleanupTasks.push(shutdown);
    };
})();

/******************************************************************************/

// Non-Fennec: common code paths.

(function() {
    if ( vAPI.fennec ) {
        return;
    }

    var tbb = vAPI.toolbarButton;

    tbb.onViewShowing = function({target}) {
        target.firstChild.setAttribute('src', vAPI.getURL('popup.html'));
    };

    tbb.onViewHiding = function({target}) {
        target.parentNode.style.maxWidth = '';
        target.firstChild.setAttribute('src', 'about:blank');
    };

    tbb.updateState = function(win, tabId) {
        var button = win.document.getElementById(this.id);

        if ( !button ) {
            return;
        }

        var icon = this.tabs[tabId];

        button.setAttribute('badge', icon && icon.badge || '');
        button.classList.toggle('off', !icon || !icon.img);
    };

    tbb.populatePanel = function(doc, panel) {
        panel.setAttribute('id', this.viewId);

        var iframe = doc.createElement('iframe');
        iframe.setAttribute('type', 'content');

        panel.appendChild(iframe);

        var toPx = function(pixels) {
            return pixels.toString() + 'px';
        };

        var resizeTimer = null;
        var resizePopupDelayed = function(attempts) {
            if ( resizeTimer !== null ) {
                return;
            }

            // Sanity check
            attempts = (attempts || 0) + 1;
            if ( attempts > 1/*000*/ ) {
                console.error('uBlock0> resizePopupDelayed: giving up after too many attempts');
                return;
            }

            resizeTimer = vAPI.setTimeout(resizePopup, 10, attempts);
        };

        var resizePopup = function(attempts) {
            resizeTimer = null;
            var body = iframe.contentDocument.body;
            panel.parentNode.style.maxWidth = 'none';
            // https://github.com/chrisaljoudi/uBlock/issues/730
            // Voodoo programming: this recipe works

            var clientHeight = body.clientHeight;
            iframe.style.height = toPx(clientHeight);
            panel.style.height = toPx(clientHeight + panel.boxObject.height - panel.clientHeight);

            var clientWidth = body.clientWidth;
            iframe.style.width = toPx(clientWidth);
            panel.style.width = toPx(clientWidth + panel.boxObject.width - panel.clientWidth);

            if ( iframe.clientHeight !== body.clientHeight || iframe.clientWidth !== body.clientWidth ) {
                resizePopupDelayed(attempts);
            }
        };

        var onPopupReady = function() {
            var win = this.contentWindow;

            if ( !win || win.location.host !== location.host ) {
                return;
            }

            if ( typeof tbb.onBeforePopupReady === 'function' ) {
                tbb.onBeforePopupReady.call(this);
            }

            new win.MutationObserver(resizePopupDelayed).observe(win.document.body, {
                attributes: true,
                characterData: true,
                subtree: true
            });

            resizePopupDelayed();
        };

        iframe.addEventListener('load', onPopupReady, true);
    };
})();

/******************************************************************************/

// Firefox 28 and less

(function() {
    var tbb = vAPI.toolbarButton;
    if ( tbb.init !== null ) {
        return;
    }
    var CustomizableUI = null;
    var forceLegacyToolbarButton = vAPI.localStorage.getBool('forceLegacyToolbarButton');
    if ( !forceLegacyToolbarButton ) {
        try {
            CustomizableUI = Cu.import('resource:///modules/CustomizableUI.jsm', null).CustomizableUI;
        } catch (ex) {
        }
    }
    if ( CustomizableUI !== null ) {
        return;
    }

    tbb.codePath = 'legacy';
    tbb.id = 'uBlock0-legacy-button';   // NOTE: must match legacy-toolbar-button.css
    tbb.viewId = tbb.id + '-panel';

    var sss = null;
    var styleSheetUri = null;

    var addLegacyToolbarButton = function(window) {
        var document = window.document;

        var toolbox = document.getElementById('navigator-toolbox') || document.getElementById('mail-toolbox');
        if ( !toolbox ) {
            return;
        }

        // palette might take a little longer to appear on some platforms,
        // give it a small delay and try again.
        var palette = toolbox.palette;
        if ( !palette ) {
            vAPI.setTimeout(function() {
                if ( toolbox.palette ) {
                    addLegacyToolbarButton(window);
                }
            }, 250);
            return;
        }

        var toolbarButton = document.createElement('toolbarbutton');
        toolbarButton.setAttribute('id', tbb.id);
        // type = panel would be more accurate, but doesn't look as good
        toolbarButton.setAttribute('type', 'menu');
        toolbarButton.setAttribute('removable', 'true');
        toolbarButton.setAttribute('class', 'toolbarbutton-1 chromeclass-toolbar-additional');
        toolbarButton.setAttribute('label', tbb.label);
        toolbarButton.setAttribute('tooltiptext', tbb.label);

        var toolbarButtonPanel = document.createElement('panel');
        // NOTE: Setting level to parent breaks the popup for PaleMoon under
        // linux (mouse pointer misaligned with content). For some reason.
        // toolbarButtonPanel.setAttribute('level', 'parent');
        tbb.populatePanel(document, toolbarButtonPanel);
        toolbarButtonPanel.addEventListener('popupshowing', tbb.onViewShowing);
        toolbarButtonPanel.addEventListener('popuphiding', tbb.onViewHiding);
        toolbarButton.appendChild(toolbarButtonPanel);

        palette.appendChild(toolbarButton);

        tbb.closePopup = function() {
            toolbarButtonPanel.hidePopup();
        };

        // No button yet so give it a default location. If forcing the button,
        // just put in in the palette rather than on any specific toolbar (who
        // knows what toolbars will be available or visible!)
        var toolbar;
        if ( !vAPI.localStorage.getBool('legacyToolbarButtonAdded') ) {
            vAPI.localStorage.setBool('legacyToolbarButtonAdded', 'true');
            toolbar = document.getElementById('nav-bar');
            if ( toolbar === null ) {
                return;
            }
            // https://github.com/gorhill/uBlock/issues/264
            // Find a child customizable palette, if any.
            toolbar = toolbar.querySelector('.customization-target') || toolbar;
            toolbar.appendChild(toolbarButton);
            toolbar.setAttribute('currentset', toolbar.currentSet);
            document.persist(toolbar.id, 'currentset');
            return;
        }

        // Find the place to put the button
        var toolbars = toolbox.externalToolbars.slice();
        for ( var child of toolbox.children ) {
            if ( child.localName === 'toolbar' ) {
                toolbars.push(child);
            }
        }

        for ( toolbar of toolbars ) {
            var currentsetString = toolbar.getAttribute('currentset');
            if ( !currentsetString ) {
                continue;
            }
            var currentset = currentsetString.split(',');
            var index = currentset.indexOf(tbb.id);
            if ( index === -1 ) {
                continue;
            }
            // Found our button on this toolbar - but where on it?
            var before = null;
            for ( var i = index + 1; i < currentset.length; i++ ) {
                before = document.getElementById(currentset[i]);
                if ( before === null ) {
                    continue;
                }
                toolbar.insertItem(tbb.id, before);
                break;
            }
            if ( before === null ) {
                toolbar.insertItem(tbb.id);
            }
        }
    };

    var onPopupCloseRequested = function({target}) {
        if ( typeof tbb.closePopup === 'function' ) {
            tbb.closePopup(target);
        }
    };

    var shutdown = function() {
        for ( var win of vAPI.tabs.getWindows() ) {
            var toolbarButton = win.document.getElementById(tbb.id);
            if ( toolbarButton ) {
                toolbarButton.parentNode.removeChild(toolbarButton);
            }
        }
        if ( sss === null ) {
            return;
        }
        if ( sss.sheetRegistered(styleSheetUri, sss.AUTHOR_SHEET) ) {
            sss.unregisterSheet(styleSheetUri, sss.AUTHOR_SHEET);
        }
        sss = null;
        styleSheetUri = null;

        vAPI.messaging.globalMessageManager.removeMessageListener(
            location.host + ':closePopup',
            onPopupCloseRequested
        );
    };

    tbb.attachToNewWindow = function(win) {
        addLegacyToolbarButton(win);
    };

    tbb.init = function() {
        vAPI.messaging.globalMessageManager.addMessageListener(
            location.host + ':closePopup',
            onPopupCloseRequested
        );

        sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
        styleSheetUri = Services.io.newURI(vAPI.getURL("css/legacy-toolbar-button.css"), null, null);

        // Register global so it works in all windows, including palette
        if ( !sss.sheetRegistered(styleSheetUri, sss.AUTHOR_SHEET) ) {
            sss.loadAndRegisterSheet(styleSheetUri, sss.AUTHOR_SHEET);
        }

        cleanupTasks.push(shutdown);
    };
})();

/******************************************************************************/

// Firefox Australis < 36.

(function() {
    var tbb = vAPI.toolbarButton;
    if ( tbb.init !== null ) {
        return;
    }
    if ( Services.vc.compare(Services.appinfo.platformVersion, '36.0') >= 0 ) {
        return null;
    }
    if ( vAPI.localStorage.getBool('forceLegacyToolbarButton') ) {
        return null;
    }
    var CustomizableUI = null;
    try {
        CustomizableUI = Cu.import('resource:///modules/CustomizableUI.jsm', null).CustomizableUI;
    } catch (ex) {
    }
    if ( CustomizableUI === null ) {
        return;
    }
    tbb.codePath = 'australis';
    tbb.CustomizableUI = CustomizableUI;
    tbb.defaultArea = CustomizableUI.AREA_NAVBAR;

    var styleURI = null;

    var onPopupCloseRequested = function({target}) {
        if ( typeof tbb.closePopup === 'function' ) {
            tbb.closePopup(target);
        }
    };

    var shutdown = function() {
        CustomizableUI.destroyWidget(tbb.id);

        for ( var win of vAPI.tabs.getWindows() ) {
            var panel = win.document.getElementById(tbb.viewId);
            panel.parentNode.removeChild(panel);
            win.QueryInterface(Ci.nsIInterfaceRequestor)
               .getInterface(Ci.nsIDOMWindowUtils)
               .removeSheet(styleURI, 1);
        }

        vAPI.messaging.globalMessageManager.removeMessageListener(
            location.host + ':closePopup',
            onPopupCloseRequested
        );
    };

    tbb.onBeforeCreated = function(doc) {
        var panel = doc.createElement('panelview');

        this.populatePanel(doc, panel);

        doc.getElementById('PanelUI-multiView').appendChild(panel);

        doc.defaultView.QueryInterface(Ci.nsIInterfaceRequestor)
            .getInterface(Ci.nsIDOMWindowUtils)
            .loadSheet(styleURI, 1);
    };

    tbb.onBeforePopupReady = function() {
        // https://github.com/gorhill/uBlock/issues/83
        // Add `portrait` class if width is constrained.
        try {
            this.contentDocument.body.classList.toggle(
                'portrait',
                CustomizableUI.getWidget(tbb.id).areaType === CustomizableUI.TYPE_MENU_PANEL
            );
        } catch (ex) {
            /* noop */
        }
    };

    tbb.init = function() {
        vAPI.messaging.globalMessageManager.addMessageListener(
            location.host + ':closePopup',
            onPopupCloseRequested
        );

        var style = [
            '#' + this.id + '.off {',
                'list-style-image: url(',
                    vAPI.getURL('img/browsericons/icon16-off.svg'),
                ');',
            '}',
            '#' + this.id + ' {',
                'list-style-image: url(',
                    vAPI.getURL('img/browsericons/icon16.svg'),
                ');',
            '}',
            '#' + this.viewId + ',',
            '#' + this.viewId + ' > iframe {',
                'width: 160px;',
                'height: 290px;',
                'overflow: hidden !important;',
            '}',
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
        ];

        styleURI = Services.io.newURI(
            'data:text/css,' + encodeURIComponent(style.join('')),
            null,
            null
        );

        this.closePopup = function(tabBrowser) {
            CustomizableUI.hidePanelForNode(
                tabBrowser.ownerDocument.getElementById(this.viewId)
            );
        };

        CustomizableUI.createWidget(this);

        cleanupTasks.push(shutdown);
    };
})();

/******************************************************************************/

// Firefox Australis >= 36.

(function() {
    var tbb = vAPI.toolbarButton;
    if ( tbb.init !== null ) {
        return;
    }
    if ( Services.vc.compare(Services.appinfo.platformVersion, '36.0') < 0 ) {
        return null;
    }
    if ( vAPI.localStorage.getBool('forceLegacyToolbarButton') ) {
        return null;
    }
    var CustomizableUI = null;
    try {
        CustomizableUI = Cu.import('resource:///modules/CustomizableUI.jsm', null).CustomizableUI;
    } catch (ex) {
    }
    if ( CustomizableUI === null ) {
        return null;
    }
    tbb.codePath = 'australis';
    tbb.CustomizableUI = CustomizableUI;
    tbb.defaultArea = CustomizableUI.AREA_NAVBAR;

    var CUIEvents = {};

    var badgeCSSRules = [
        'background: #666',
        'color: #fff'
    ].join(';');

    var updateBadgeStyle = function() {
        for ( var win of vAPI.tabs.getWindows() ) {
            var button = win.document.getElementById(tbb.id);
            if ( button === null ) {
                continue;
            }
            var badge = button.ownerDocument.getAnonymousElementByAttribute(
                button,
                'class',
                'toolbarbutton-badge'
            );
            if ( !badge ) {
                continue;
            }

            badge.style.cssText = badgeCSSRules;
        }
    };

    var updateBadge = function() {
        var wId = tbb.id;
        var buttonInPanel = CustomizableUI.getWidget(wId).areaType === CustomizableUI.TYPE_MENU_PANEL;

        for ( var win of vAPI.tabs.getWindows() ) {
            var button = win.document.getElementById(wId);
            if ( button === null ) {
                continue;
            }
            if ( buttonInPanel ) {
                button.classList.remove('badged-button');
                continue;
            }
            button.classList.add('badged-button');
        }

        if ( buttonInPanel ) {
            return;
        }

        // Anonymous elements need some time to be reachable
        vAPI.setTimeout(updateBadgeStyle, 250);
    }.bind(CUIEvents);

    // https://developer.mozilla.org/en-US/docs/Mozilla/JavaScript_code_modules/CustomizableUI.jsm#Listeners
    CUIEvents.onCustomizeEnd = updateBadge;
    CUIEvents.onWidgetAdded = updateBadge;
    CUIEvents.onWidgetUnderflow = updateBadge;

    var onPopupCloseRequested = function({target}) {
        if ( typeof tbb.closePopup === 'function' ) {
            tbb.closePopup(target);
        }
    };

    var shutdown = function() {
        CustomizableUI.removeListener(CUIEvents);
        CustomizableUI.destroyWidget(tbb.id);

        for ( var win of vAPI.tabs.getWindows() ) {
            var panel = win.document.getElementById(tbb.viewId);
            panel.parentNode.removeChild(panel);
            win.QueryInterface(Ci.nsIInterfaceRequestor)
                .getInterface(Ci.nsIDOMWindowUtils)
                .removeSheet(styleURI, 1);
        }


        vAPI.messaging.globalMessageManager.removeMessageListener(
            location.host + ':closePopup',
            onPopupCloseRequested
        );
    };

    var styleURI = null;

    tbb.onBeforeCreated = function(doc) {
        var panel = doc.createElement('panelview');

        this.populatePanel(doc, panel);

        doc.getElementById('PanelUI-multiView').appendChild(panel);

        doc.defaultView.QueryInterface(Ci.nsIInterfaceRequestor)
            .getInterface(Ci.nsIDOMWindowUtils)
            .loadSheet(styleURI, 1);
    };

    tbb.onCreated = function(button) {
        button.setAttribute('badge', '');
        vAPI.setTimeout(updateBadge, 250);
    };

    tbb.onBeforePopupReady = function() {
        // https://github.com/gorhill/uBlock/issues/83
        // Add `portrait` class if width is constrained.
        try {
            this.contentDocument.body.classList.toggle(
                'portrait',
                CustomizableUI.getWidget(tbb.id).areaType === CustomizableUI.TYPE_MENU_PANEL
            );
        } catch (ex) {
            /* noop */
        }
    };

    tbb.closePopup = function(tabBrowser) {
        CustomizableUI.hidePanelForNode(
            tabBrowser.ownerDocument.getElementById(tbb.viewId)
        );
    };

    tbb.init = function() {
        vAPI.messaging.globalMessageManager.addMessageListener(
            location.host + ':closePopup',
            onPopupCloseRequested
        );

        CustomizableUI.addListener(CUIEvents);

        var style = [
            '#' + this.id + '.off {',
                'list-style-image: url(',
                    vAPI.getURL('img/browsericons/icon16-off.svg'),
                ');',
            '}',
            '#' + this.id + ' {',
                'list-style-image: url(',
                    vAPI.getURL('img/browsericons/icon16.svg'),
                ');',
            '}',
            '#' + this.viewId + ',',
            '#' + this.viewId + ' > iframe {',
                'width: 160px;',
                'height: 290px;',
                'overflow: hidden !important;',
            '}'
        ];

        styleURI = Services.io.newURI(
            'data:text/css,' + encodeURIComponent(style.join('')),
            null,
            null
        );

        CustomizableUI.createWidget(this);

        cleanupTasks.push(shutdown);
    };
})();

/******************************************************************************/

// No toolbar button.

(function() {
    // Just to ensure the number of cleanup tasks is as expected: toolbar
    // button code is one single cleanup task regardless of platform.
    if ( vAPI.toolbarButton.init === null ) {
        cleanupTasks.push(function(){});
    }
})();

/******************************************************************************/

if ( vAPI.toolbarButton.init !== null ) {
    vAPI.toolbarButton.init();
}

/******************************************************************************/
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
        if (
            context === 'page' &&
            !gContextMenu.onLink &&
            !gContextMenu.onImage &&
            !gContextMenu.onEditableArea &&
            !gContextMenu.inFrame &&
            !gContextMenu.onVideo &&
            !gContextMenu.onAudio
        ) {
            menuitem.hidden = false;
            return;
        }
        if (
            ctxMap.hasOwnProperty(context) &&
            gContextMenu[ctxMap[context]]
        ) {
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

    // Not guarantee the menu item was actually registered.
    if ( menuitem === null ) {
        return;
    }

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
/******************************************************************************/

vAPI.cloud = (function() {
    var extensionBranchPath = 'extensions.' + location.host;
    var cloudBranchPath = extensionBranchPath + '.cloudStorage';

    // https://github.com/gorhill/uBlock/issues/80#issuecomment-132081658
    //   We must use get/setComplexValue in order to properly handle strings
    //   with unicode characters.
    var iss = Ci.nsISupportsString;
    var argstr = Components.classes['@mozilla.org/supports-string;1']
                           .createInstance(iss);

    var options = {
        defaultDeviceName: '',
        deviceName: ''
    };

    // User-supplied device name.
    try {
        options.deviceName = Services.prefs
                                     .getBranch(extensionBranchPath + '.')
                                     .getComplexValue('deviceName', iss)
                                     .data;
    } catch(ex) {
    }

    var getDefaultDeviceName = function() {
        var name = '';
        try {
            name = Services.prefs
                           .getBranch('services.sync.client.')
                           .getComplexValue('name', iss)
                           .data;
        } catch(ex) {
        }

        return name || window.navigator.platform || window.navigator.oscpu;
    };

    var start = function(dataKeys) {
        var extensionBranch = Services.prefs.getBranch(extensionBranchPath + '.');
        var syncBranch = Services.prefs.getBranch('services.sync.prefs.sync.');

        // Mark config entries as syncable
        argstr.data = '';
        var dataKey;
        for ( var i = 0; i < dataKeys.length; i++ ) {
            dataKey = dataKeys[i];
            if ( extensionBranch.prefHasUserValue('cloudStorage.' + dataKey) === false ) {
                extensionBranch.setComplexValue('cloudStorage.' + dataKey, iss, argstr);
            }
            syncBranch.setBoolPref(cloudBranchPath + '.' + dataKey, true);
        }
    };

    var push = function(datakey, data, callback) {
        var branch = Services.prefs.getBranch(cloudBranchPath + '.');
        var bin = {
            'source': options.deviceName || getDefaultDeviceName(),
            'tstamp': Date.now(),
            'data': data,
            'size': 0
        };
        bin.size = JSON.stringify(bin).length;
        argstr.data = JSON.stringify(bin);
        branch.setComplexValue(datakey, iss, argstr);
        if ( typeof callback === 'function' ) {
            callback();
        }
    };

    var pull = function(datakey, callback) {
        var result = null;
        var branch = Services.prefs.getBranch(cloudBranchPath + '.');
        try {
            var json = branch.getComplexValue(datakey, iss).data;
            if ( typeof json === 'string' ) {
                result = JSON.parse(json);
            }
        } catch(ex) {
        }
        callback(result);
    };

    var getOptions = function(callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }
        options.defaultDeviceName = getDefaultDeviceName();
        callback(options);
    };

    var setOptions = function(details, callback) {
        if ( typeof details !== 'object' || details === null ) {
            return;
        }

        var branch = Services.prefs.getBranch(extensionBranchPath + '.');

        if ( typeof details.deviceName === 'string' ) {
            argstr.data = details.deviceName;
            branch.setComplexValue('deviceName', iss, argstr);
            options.deviceName = details.deviceName;
        }

        getOptions(callback);
    };

    return {
        start: start,
        push: push,
        pull: pull,
        getOptions: getOptions,
        setOptions: setOptions
    };
})();

/******************************************************************************/
/******************************************************************************/

})();

/******************************************************************************/

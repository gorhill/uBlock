/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2106 The uBlock Origin authors

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
/* global punycode */

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
vAPI.thunderbird = Services.appinfo.ID === '{3550f703-e582-4d05-9a08-453d09bdfdc6}';

/******************************************************************************/

var deferUntil = function(testFn, mainFn, details) {
    if ( typeof details !== 'object' ) {
        details = {};
    }

    var now = 0;
    var next = details.next || 200;
    var until = details.until || 2000;

    var check = function() {
        if ( testFn() === true || now >= until ) {
            mainFn();
            return;
        }
        now += next;
        vAPI.setTimeout(check, next);
    };

    if ( 'sync' in details && details.sync === true ) {
        check();
    } else {
        vAPI.setTimeout(check, 1);
    }
};

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
var expectedNumberOfCleanups = 9;

window.addEventListener('unload', function() {
    if ( typeof vAPI.app.onShutdown === 'function' ) {
        vAPI.app.onShutdown();
    }

    // IMPORTANT: cleanup tasks must be executed using LIFO order.
    var i = cleanupTasks.length;
    while ( i-- ) {
        cleanupTasks[i]();
    }

    if ( cleanupTasks.length < expectedNumberOfCleanups ) {
        console.error(
            'uBlock> Cleanup tasks performed: %s (out of %s)',
            cleanupTasks.length,
            expectedNumberOfCleanups
        );
    }

    // frameModule needs to be cleared too
    var frameModuleURL = vAPI.getURL('frameModule.js');
    var frameModule = {};

    // https://github.com/gorhill/uBlock/issues/1004
    // For whatever reason, `Cu.import` can throw -- at least this was
    // reported as happening for Pale Moon 25.8.
    try {
        Cu.import(frameModuleURL, frameModule);
        frameModule.contentObserver.unregister();
        Cu.unload(frameModuleURL);
    } catch (ex) {
    }
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
        var settingVal;
        var prefName, prefVal;
        for ( var setting in details ) {
            if ( details.hasOwnProperty(setting) === false ) {
                continue;
            }
            settingVal = !!details[setting];
            switch ( setting ) {
            case 'prefetching':
                this.rememberOriginalValue('network', 'prefetch-next');
                // http://betanews.com/2015/08/15/firefox-stealthily-loads-webpages-when-you-hover-over-links-heres-how-to-stop-it/
                // https://bugzilla.mozilla.org/show_bug.cgi?id=814169
                // Sigh.
                this.rememberOriginalValue('network.http', 'speculative-parallel-limit');
                // https://github.com/gorhill/uBlock/issues/292
                // "true" means "do not disable", i.e. leave entry alone
                if ( settingVal ) {
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
                // https://github.com/gorhill/uBlock/issues/292
                // "true" means "do not disable", i.e. leave entry alone
                if ( settingVal ) {
                    this.clear('browser', 'send_pings');
                    this.clear('beacon', 'enabled');
                } else {
                    this.setValue('browser', 'send_pings', false);
                    this.setValue('beacon', 'enabled', false);
                }
                break;

            // https://github.com/gorhill/uBlock/issues/894
            // Do not disable completely WebRTC if it can be avoided. FF42+
            // has a `media.peerconnection.ice.default_address_only` pref which
            // purpose is to prevent local IP address leakage.
            case 'webrtcIPAddress':
                if ( this.getValue('media.peerconnection', 'ice.default_address_only') !== undefined ) {
                    prefName = 'ice.default_address_only';
                    prefVal = true;
                } else {
                    prefName = 'enabled';
                    prefVal = false;
                }

                this.rememberOriginalValue('media.peerconnection', prefName);
                if ( settingVal ) {
                    this.clear('media.peerconnection', prefName);
                } else {
                    this.setValue('media.peerconnection', prefName, prefVal);
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
                result = null;
            },
            handleError: function(error) {
                console.error('SQLite error ', error.result, error.message);
                // Caller expects an answer regardless of failure.
                if ( typeof callback === 'function' ) {
                    callback(null);
                }
                result = null;
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

// This must be executed/setup early.

var winWatcher = (function() {
    var chromeWindowType = vAPI.thunderbird ? 'mail:3pane' : 'navigator:browser';
    var windowToIdMap = new Map();
    var windowIdGenerator = 1;
    var api = {
        onOpenWindow: null,
        onCloseWindow: null
    };

    api.getWindows = function() {
        return windowToIdMap.keys();
    };

    api.idFromWindow = function(win) {
        return windowToIdMap.get(win) || 0;
    };

    api.getCurrentWindow = function() {
        return Services.wm.getMostRecentWindow(chromeWindowType) || null;
    };

    var addWindow = function(win) {
        if ( !win || windowToIdMap.has(win) ) {
            return;
        }
        windowToIdMap.set(win, windowIdGenerator++);
        if ( typeof api.onOpenWindow === 'function' ) {
            api.onOpenWindow(win);
        }
    };

    var removeWindow = function(win) {
        if ( !win || windowToIdMap.delete(win) !== true ) {
            return;
        }
        if ( typeof api.onCloseWindow === 'function' ) {
            api.onCloseWindow(win);
        }
    };

    // https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIWindowMediator
    // https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIWindowWatcher
    // https://github.com/gorhill/uMatrix/issues/357
    // Use nsIWindowMediator for being notified of opened/closed windows.
    var listeners = {
        onOpenWindow: function(aWindow) {
            var win;
            try {
                win = aWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                             .getInterface(Ci.nsIDOMWindow);
            } catch (ex) {
            }
            addWindow(win);
        },

        onCloseWindow: function(aWindow) {
            var win;
            try {
                win = aWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                             .getInterface(Ci.nsIDOMWindow);
            } catch (ex) {
            }
            removeWindow(win);
        },

        observe: function(aSubject, topic) {
            // https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIWindowWatcher#registerNotification%28%29
            //   "aSubject - the window being opened or closed, sent as an
            //   "nsISupports which can be ... QueryInterfaced to an
            //   "nsIDOMWindow."
            var win;
            try {
                win = aSubject.QueryInterface(Ci.nsIInterfaceRequestor)
                              .getInterface(Ci.nsIDOMWindow);
            } catch (ex) {
            }
            if ( !win ) { return; }
            if ( topic === 'domwindowopened' ) {
                addWindow(win);
                return;
            }
            if ( topic === 'domwindowclosed' ) {
                removeWindow(win);
                return;
            }
        }
    };

    (function() {
        var winumerator, win;

        // https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIWindowMediator#getEnumerator%28%29
        winumerator = Services.wm.getEnumerator(null);
        while ( winumerator.hasMoreElements() ) {
            win = winumerator.getNext();
            if ( !win.closed ) {
                windowToIdMap.set(win, windowIdGenerator++);
            }
        }

        // https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIWindowWatcher#getWindowEnumerator%28%29
        winumerator = Services.ww.getWindowEnumerator();
        while ( winumerator.hasMoreElements() ) {
            win = winumerator.getNext()
                             .QueryInterface(Ci.nsIInterfaceRequestor)
                             .getInterface(Ci.nsIDOMWindow);
            if ( !win.closed ) {
                windowToIdMap.set(win, windowIdGenerator++);
            }
        }

        Services.wm.addListener(listeners);
        Services.ww.registerNotification(listeners);
    })();

    cleanupTasks.push(function() {
        Services.wm.removeListener(listeners);
        Services.ww.unregisterNotification(listeners);
        windowToIdMap.clear();
    });

    return api;
})();

/******************************************************************************/

var getTabBrowser = (function() {
    if ( vAPI.fennec ) {
        return function(win) {
            return win.BrowserApp || null;
        };
    }

    if ( vAPI.thunderbird ) {
        return function(win) {
            return win.document.getElementById('tabmail') || null;
        };
    }

    // https://github.com/gorhill/uBlock/issues/1004
    //   Merely READING the `gBrowser` property causes the issue -- no
    //   need to even use its returned value... This really should be fixed
    //   in the browser.
    //   Meanwhile, the workaround is to check whether the document is
    //   ready. This is hacky, as the code below has to make assumption
    //   about the browser's inner working -- specifically that the `gBrowser`
    //   property should NOT be accessed before the document of the window is
    //   in its ready state.

    return function(win) {
        if ( win ) {
            var doc = win.document;
            if ( doc && doc.readyState === 'complete' ) {
                return win.gBrowser || null;
            }
        }
        return null;
    };
})();

/******************************************************************************/

var getOwnerWindow = function(target) {
    if ( target.ownerDocument ) {
        return target.ownerDocument.defaultView;
    }

    // Fennec
    for ( var win of winWatcher.getWindows() ) {
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

    callback({
        id: tabId,
        index: tabWatcher.indexFromTarget(browser),
        windowId: winWatcher.idFromWindow(win),
        active: tabBrowser !== null && browser === tabBrowser.selectedBrowser,
        url: browser.currentURI.asciiSpec,
        title: browser.contentTitle
    });
};

/******************************************************************************/

vAPI.tabs.getAll = function(window) {
    var win, tab;
    var tabs = [];

    for ( win of winWatcher.getWindows() ) {
        if ( window && window !== win ) {
            continue;
        }

        var tabBrowser = getTabBrowser(win);
        if ( tabBrowser === null ) {
            continue;
        }

        // This can happens if a tab-less window is currently opened.
        // Example of a tab-less window: one opened from clicking
        //   "View Page Source".
        if ( !tabBrowser.tabs ) {
            continue;
        }

        for ( tab of tabBrowser.tabs ) {
            tabs.push(tab);
        }
    }

    return tabs;
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

    var win = winWatcher.getCurrentWindow();
    var tabBrowser = getTabBrowser(win);
    if ( tabBrowser === null ) {
        return;
    }

    if ( vAPI.fennec ) {
        tabBrowser.addTab(details.url, {
            selected: details.active !== false
        });
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

    if ( vAPI.thunderbird ) {
        tabBrowser.openTab('contentTab', {
            contentPage: details.url,
            background: !details.active
        });
        // TODO: Should be possible to move tabs on Thunderbird
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

vAPI.tabs._remove = (function() {
    if ( vAPI.fennec || vAPI.thunderbird ) {
        return function(tab, tabBrowser) {
            tabBrowser.closeTab(tab);
        };
    }
    return function(tab, tabBrowser, nuke) {
        if ( !tabBrowser ) {
            return;
        }
        if ( tabBrowser.tabs.length === 1 && nuke ) {
            getOwnerWindow(tab).close();
        } else {
            tabBrowser.removeTab(tab);
        }
    };
})();

/******************************************************************************/

vAPI.tabs.remove = (function() {
    var remove = function(tabId, nuke) {
        var browser = tabWatcher.browserFromTabId(tabId);
        if ( !browser ) {
            return;
        }
        var tab = tabWatcher.tabFromBrowser(browser);
        if ( !tab ) {
            return;
        }
        this._remove(tab, getTabBrowser(getOwnerWindow(browser)), nuke);
    };

    // Do this asynchronously
    return function(tabId, nuke) {
        vAPI.setTimeout(remove.bind(this, tabId, nuke), 1);
    };
})();

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

    var win = getOwnerWindow(tab);
    var tabBrowser = getTabBrowser(win);
    if ( tabBrowser === null ) {
        return;
    }

    // https://github.com/gorhill/uBlock/issues/470
    win.focus();

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
        // TODO: Add support for this
        if ( vAPI.thunderbird ) {
            return -1;
        }
        var win = getOwnerWindow(browser);
        if ( !win ) {
            return -1;
        }
        var tabbrowser = getTabBrowser(win);
        if ( tabbrowser === null ) {
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
        if ( tabbrowser === null ) {
            return null;
        }
        if ( !tabbrowser.tabs || i >= tabbrowser.tabs.length ) {
            return null;
        }
        return tabbrowser.tabs[i];
    };

    var browserFromTarget = (function() {
        if ( vAPI.fennec ) {
            return function(target) {
                if ( !target ) { return null; }
                if ( target.browser ) {     // target is a tab
                    target = target.browser;
                }
                return target.localName === 'browser' ? target : null;
            };
        }
        if ( vAPI.thunderbird ) {
            return function(target) {
                if ( !target ) { return null; }
                if ( target.mode ) {        // target is object with tab info
                    var browserFunc = target.mode.getBrowser || target.mode.tabType.getBrowser;
                    if ( browserFunc ) {
                        return browserFunc.call(target.mode.tabType, target);
                    }
                }
                return target.localName === 'browser' ? target : null;
            };
        }
        return function(target) {
            if ( !target ) { return null; }
            if ( target.linkedPanel ) {     // target is a tab
                target = target.linkedBrowser;
            }
            return target.localName === 'browser' ? target : null;
        };
    })();

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
        var win = winWatcher.getCurrentWindow();
        // https://github.com/gorhill/uBlock/issues/399
        // getTabBrowser() can return null at browser launch time.
        var tabBrowser = getTabBrowser(win);
        if ( tabBrowser === null ) {
            return null;
        }
        if ( vAPI.thunderbird ) {
            // Directly at startup the first tab may not be initialized
            if ( tabBrowser.tabInfo.length === 0 ) {
                return null;
            }
            return tabBrowser.getBrowserForSelectedTab() || null;
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

    var removeTarget = function(target) {
        onClose({ target: target });
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
        if ( typeof vAPI.toolbarButton.attachToNewWindow === 'function' ) {
            vAPI.toolbarButton.attachToNewWindow(window);
        }

        var tabBrowser = getTabBrowser(window);
        if ( tabBrowser === null ) {
            return;
        }

        var tabContainer;
        if ( tabBrowser.deck ) {                    // Fennec
            tabContainer = tabBrowser.deck;
        } else if ( tabBrowser.tabContainer ) {     // Firefox
            tabContainer = tabBrowser.tabContainer;
            vAPI.contextMenu.register(window);
        }

        // https://github.com/gorhill/uBlock/issues/697
        // Ignore `TabShow` events: unfortunately the `pending` attribute is
        // not set when a tab is opened as a result of session restore -- it is
        // set *after* the event is fired in such case.
        if ( tabContainer ) {
            tabContainer.addEventListener('TabShow', onShow);
            tabContainer.addEventListener('TabClose', onClose);
            // when new window is opened TabSelect doesn't run on the selected tab?
            tabContainer.addEventListener('TabSelect', onSelect);
        }
    };

    // https://github.com/gorhill/uBlock/issues/906
    // Ensure the environment is ready before trying to attaching.
    var canAttachToTabBrowser = function(window) {
        var document = window && window.document;
        if ( !document || document.readyState !== 'complete' ) {
            return false;
        }

        // On some platforms, the tab browser isn't immediately available,
        // try waiting a bit if this happens.
        // https://github.com/gorhill/uBlock/issues/763
        // Not getting a tab browser should not prevent from attaching ourself
        // to the window.
        var tabBrowser = getTabBrowser(window);
        if ( tabBrowser === null ) {
            return false;
        }

        var docElement = document.documentElement;
        return docElement && docElement.getAttribute('windowtype') === 'navigator:browser';
    };

    var onWindowLoad = function(win) {
        deferUntil(
            canAttachToTabBrowser.bind(null, win),
            attachToTabBrowser.bind(null, win)
        );
    };

    var onWindowUnload = function(win) {
        vAPI.contextMenu.unregister(win);

        var tabBrowser = getTabBrowser(win);
        if ( tabBrowser === null ) {
            return;
        }

        var tabContainer;
        if ( tabBrowser.deck ) {                    // Fennec
            tabContainer = tabBrowser.deck;
        } else if ( tabBrowser.tabContainer ) {     // Firefox
            tabContainer = tabBrowser.tabContainer;
        }
        if ( tabContainer ) {
            tabContainer.removeEventListener('TabShow', onShow);
            tabContainer.removeEventListener('TabClose', onClose);
            tabContainer.removeEventListener('TabSelect', onSelect);
        }

        // https://github.com/gorhill/uBlock/issues/574
        // To keep in mind: not all windows are tab containers,
        // sometimes the window IS the tab.
        var tabs;
        if ( vAPI.thunderbird ) {
            tabs = tabBrowser.tabInfo;
        } else if ( tabBrowser.tabs ) {
            tabs = tabBrowser.tabs;
        } else if ( tabBrowser.localName === 'browser' ) {
            tabs = [tabBrowser];
        } else {
            tabs = [];
        }

        var browser, URI, tabId;
        var tabindex = tabs.length, tab;
        while ( tabindex-- ) {
            tab = tabs[tabindex];
            browser = browserFromTarget(tab);
            if ( browser === null ) {
                continue;
            }
            URI = browser.currentURI;
            // Close extension tabs
            if ( URI.schemeIs('chrome') && URI.host === location.host ) {
                vAPI.tabs._remove(tab, getTabBrowser(win));
            }
            tabId = browserToTabIdMap.get(browser);
            if ( tabId !== undefined ) {
                removeBrowserEntry(tabId, browser);
                tabIdToBrowserMap.delete(tabId);
            }
            browserToTabIdMap.delete(browser);
        }
    };

    // Initialize map with existing active tabs
    var start = function() {
        var tabBrowser, tabs, tab;
        for ( var win of winWatcher.getWindows() ) {
            onWindowLoad(win);
            tabBrowser = getTabBrowser(win);
            if ( tabBrowser === null ) {
                continue;
            }
            // `tabBrowser.tabs` may not exist (Thunderbird).
            tabs = tabBrowser.tabs;
            if ( !tabs ) {
                continue;
            }
            for ( tab of tabs ) {
                if ( vAPI.fennec || !tab.hasAttribute('pending') ) {
                    tabIdFromTarget(tab);
                }
            }
        }

        winWatcher.onOpenWindow = onWindowLoad;
        winWatcher.onCloseWindow = onWindowUnload;
    };

    var stop = function() {
        winWatcher.onOpenWindow = null;
        winWatcher.onCloseWindow = null;

        for ( var win of winWatcher.getWindows() ) {
            onWindowUnload(win);
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
        removeTarget: removeTarget,
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
        : winWatcher.getCurrentWindow();
    var curTabId;
    var tabBrowser = getTabBrowser(win);
    if ( tabBrowser !== null ) {
        curTabId = tabWatcher.tabIdFromTarget(tabBrowser.selectedTab);
    }
    var tb = vAPI.toolbarButton;

    // from 'TabSelect' event
    if ( tabId === undefined ) {
        tabId = curTabId;
    } else if ( badge !== undefined ) {
        tb.tabs[tabId] = { badge: badge, img: iconStatus === 'on' };
    }

    if ( curTabId && tabId === curTabId ) {
        tb.updateState(win, tabId);
        vAPI.contextMenu.onMustUpdate(tabId);
    }
};

/******************************************************************************/

vAPI.messaging = {
    get globalMessageManager() {
        return Cc['@mozilla.org/globalmessagemanager;1']
                .getService(Ci.nsIMessageListenerManager);
    },
    frameScriptURL: vAPI.getURL('frameScript.js'),
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

    this.globalMessageManager.loadFrameScript(this.frameScriptURL, true);

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

        gmm.removeDelayedFrameScript(vAPI.messaging.frameScriptURL);
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
/******************************************************************************/

// Synchronous messaging: Firefox allows this. Chromium does not allow this.

// Sometimes there is no way around synchronous messaging, as long as:
// - the code at the other end execute fast and return quickly.
// - it's not abused.
// Original rationale is <https://github.com/gorhill/uBlock/issues/756>.
// Synchronous messaging is a good solution for this case because:
// - It's done only *once* per page load. (Keep in mind there is already a
//   sync message sent for each single network request on a page and it's not
//   an issue, because the code executed is trivial, which is the key -- see
//   shouldLoadListener below).
// - The code at the other end is fast.
// Though vAPI.rpcReceiver was brought forth because of this one case, I
// generalized the concept for whatever future need for synchronous messaging
// which might arise.

// https://developer.mozilla.org/en-US/Firefox/Multiprocess_Firefox/Message_Manager/Message_manager_overview#Content_frame_message_manager

vAPI.rpcReceiver = (function() {
    var calls = Object.create(null);
    var childProcessMessageName = location.host + ':child-process-message';

    var onChildProcessMessage = function(ev) {
        var msg = ev.data;
        if ( !msg ) { return; }
        var fn = calls[msg.fnName];
        if ( typeof fn === 'function' ) {
            return fn(msg);
        }
    };

    var ppmm = Services.ppmm;
    if ( !ppmm ) {
        ppmm = Cc['@mozilla.org/parentprocessmessagemanager;1'];
        if ( ppmm ) {
            ppmm = ppmm.getService(Ci.nsIMessageListenerManager);
        }
    }

    if ( ppmm ) {
        ppmm.addMessageListener(
            childProcessMessageName,
            onChildProcessMessage
        );
    }

    cleanupTasks.push(function() {
        if ( ppmm ) {
            ppmm.removeMessageListener(
                childProcessMessageName,
                onChildProcessMessage
            );
        }
    });

    return calls;
})();

/******************************************************************************/
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
    onBeforeRequest: function(){},
    onBeforeRequestTypes: null,
    onHeadersReceived: function(){},
    onHeadersReceivedTypes: null,

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

    // Pending request ring buffer:
    // +-------+-------+-------+-------+-------+-------+-------
    // |0      |1      |2      |3      |4      |5      |...      
    // +-------+-------+-------+-------+-------+-------+-------
    //
    // URL to ring buffer index map:
    // { k = URL, s = ring buffer indices }
    //
    // s is a string which character codes map to ring buffer indices -- for
    // when the same URL is received multiple times by shouldLoadListener()
    // before the existing one is serviced by the network request observer.
    // I believe the use of a string in lieu of an array reduces memory
    // churning.

    createPendingRequest: function(url) {
        var bucket;
        var i = this.pendingWritePointer;
        this.pendingWritePointer = i + 1 & 31;
        var preq = this.pendingRingBuffer[i];
        var si = String.fromCharCode(i);
        // Cleanup unserviced pending request
        if ( preq._key !== '' ) {
            bucket = this.pendingURLToIndex.get(preq._key);
            if ( bucket.length === 1 ) {
                this.pendingURLToIndex.delete(preq._key);
            } else {
                var pos = bucket.indexOf(si);
                this.pendingURLToIndex.set(preq._key, bucket.slice(0, pos) + bucket.slice(pos + 1));
            }
        }
        bucket = this.pendingURLToIndex.get(url);
        this.pendingURLToIndex.set(url, bucket === undefined ? si : bucket + si);
        preq._key = url;
        return preq;
    },

    lookupPendingRequest: function(url) {
        var bucket = this.pendingURLToIndex.get(url);
        if ( bucket === undefined ) {
            return null;
        }
        var i = bucket.charCodeAt(0);
        if ( bucket.length === 1 ) {
            this.pendingURLToIndex.delete(url);
        } else {
            this.pendingURLToIndex.set(url, bucket.slice(1));
        }
        var preq = this.pendingRingBuffer[i];
        preq._key = ''; // mark as "serviced"
        return preq;
    },

    // https://github.com/gorhill/uMatrix/issues/165
    // https://developer.mozilla.org/en-US/Firefox/Releases/3.5/Updating_extensions#Getting_a_load_context_from_a_request
    // Not sure `umatrix:shouldLoad` is still needed, uMatrix does not
    //   care about embedded frames topography.
    // Also:
    //   https://developer.mozilla.org/en-US/Firefox/Multiprocess_Firefox/Limitations_of_chrome_scripts
    tabIdFromChannel: function(channel) {
        var lc;
        try {
            lc = channel.notificationCallbacks.getInterface(Ci.nsILoadContext);
        } catch(ex) {
        }
        if ( !lc ) {
            try {
                lc = channel.loadGroup.notificationCallbacks.getInterface(Ci.nsILoadContext);
            } catch(ex) {
            }
            if ( !lc ) {
                return vAPI.noTabId;
            }
        }
        if ( lc.topFrameElement ) {
            return tabWatcher.tabIdFromTarget(lc.topFrameElement);
        }
        var win;
        try {
            win = lc.associatedWindow;
        } catch (ex) { }
        if ( !win ) {
            return vAPI.noTabId;
        }
        if ( win.top ) {
            win = win.top;
        }
        var tabBrowser;
        try {
            tabBrowser = getTabBrowser(
                win.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation)
                   .QueryInterface(Ci.nsIDocShell).rootTreeItem
                   .QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow)
            );
        } catch (ex) { }
        if ( !tabBrowser ) {
            return vAPI.noTabId;
        }
        if ( tabBrowser.getBrowserForContentWindow ) {
            return tabWatcher.tabIdFromTarget(tabBrowser.getBrowserForContentWindow(win));
        }
        // Falling back onto _getTabForContentWindow to ensure older versions
        // of Firefox work well.
        return tabBrowser._getTabForContentWindow ?
               tabWatcher.tabIdFromTarget(tabBrowser._getTabForContentWindow(win)) :
               vAPI.noTabId;
    },

    // https://github.com/gorhill/uBlock/issues/959
    //   Try to synthesize a pending request from a behind-the-scene request.
    synthesizePendingRequest: function(channel, rawtype) {
        var tabId = this.tabIdFromChannel(channel);
        if ( tabId === vAPI.noTabId ) {
            return null;
        }
        return {
            frameId: 0,
            parentFrameId: -1,
            tabId: tabId,
            rawtype: rawtype
        };
    },

    handleRequest: function(channel, URI, details) {
        var type = this.typeMap[details.rawtype] || 'other';
        if ( this.onBeforeRequestTypes && this.onBeforeRequestTypes.has(type) === false ) {
            return false;
        }

        var result = this.onBeforeRequest({
            frameId: details.frameId,
            parentFrameId: details.parentFrameId,
            tabId: details.tabId,
            type: type,
            url: URI.asciiSpec
        });

        if ( !result || typeof result !== 'object' ) {
            return false;
        }

        if ( 'cancel' in result && result.cancel === true ) {
            channel.cancel(this.ABORT);
            return true;
        }

        if ( 'redirectUrl' in result ) {
            channel.redirectionLimit = 1;
            channel.redirectTo(Services.io.newURI(result.redirectUrl, null, null));
            return true;
        }

        return false;
    },

    getResponseHeader: function(channel, name) {
        var value;
        try {
            value = channel.getResponseHeader(name);
        } catch (ex) {
        }
        return value;
    },

    handleResponseHeaders: function(channel, URI, channelData) {
        var requestType = this.typeMap[channelData[3]] || 'other';
        if ( this.onHeadersReceivedTypes && this.onHeadersReceivedTypes.has(requestType) === false ) {
            return;
        }

        // 'Content-Security-Policy' MUST come last in the array. Need to
        // revised this eventually.
        var responseHeaders = [];
        var value = channel.contentLength;
        if ( value !== -1 ) {
            responseHeaders.push({ name: 'Content-Length', value: value });
        }
        if ( requestType.endsWith('_frame') ) {
            value = this.getResponseHeader(channel, 'Content-Security-Policy');
            if ( value !== undefined ) {
                responseHeaders.push({ name: 'Content-Security-Policy', value: value });
            }
        }

        var result = this.onHeadersReceived({
            parentFrameId: channelData[1],
            responseHeaders: responseHeaders,
            tabId: channelData[2],
            type: requestType,
            url: URI.asciiSpec
        });

        if ( !result ) {
            return;
        }

        if ( result.cancel ) {
            channel.cancel(this.ABORT);
            return;
        }

        if ( result.responseHeaders ) {
            channel.setResponseHeader(
                'Content-Security-Policy',
                result.responseHeaders.pop().value,
                true
            );
            return;
        }
    },

    observe: function(channel, topic) {
        if ( channel instanceof Ci.nsIHttpChannel === false ) {
            return;
        }

        var URI = channel.URI;

        if ( topic === 'http-on-examine-response' ) {
            if ( channel instanceof Ci.nsIWritablePropertyBag === false ) {
                return;
            }

            var channelData;
            try {
                channelData = channel.getProperty(this.REQDATAKEY);
            } catch (ex) {
            }
            if ( !channelData ) {
                return;
            }

            this.handleResponseHeaders(channel, URI, channelData);

            return;
        }

        // http-on-opening-request

        var pendingRequest = this.lookupPendingRequest(URI.spec);

        // https://github.com/gorhill/uMatrix/issues/390#issuecomment-155759004
        var rawtype = 1;
        var loadInfo = channel.loadInfo;
        if ( loadInfo ) {
            rawtype = loadInfo.externalContentPolicyType !== undefined ?
                loadInfo.externalContentPolicyType :
                loadInfo.contentPolicyType;
            if ( !rawtype ) {
                rawtype = 1;
            }
        }

        // IMPORTANT:
        // If this is a main frame, ensure that the proper tab id is being
        // used: it can happen that the wrong tab id was looked up at
        // `shouldLoadListener` time. Without this, the popup blocker may
        // not work properly, and also a tab opened from a link may end up
        // being wrongly reported as an embedded element.
        if ( pendingRequest !== null && pendingRequest.rawtype === 6 ) {
            var tabId = this.tabIdFromChannel(channel);
            if ( tabId !== vAPI.noTabId ) {
                pendingRequest.tabId = tabId;
            }
        }

        // Behind-the-scene request... Really?
        if ( pendingRequest === null ) {
            pendingRequest = this.synthesizePendingRequest(channel, rawtype);
        }

        // Behind-the-scene request... Yes, really.
        if ( pendingRequest === null ) {
            if ( this.handleRequest(channel, URI, { tabId: vAPI.noTabId, rawtype: rawtype }) ) {
                return;
            }

            // Carry data for behind-the-scene redirects
            if ( channel instanceof Ci.nsIWritablePropertyBag ) {
                channel.setProperty(this.REQDATAKEY, [0, -1, vAPI.noTabId, rawtype]);
            }

            return;
        }

        // https://github.com/gorhill/uBlock/issues/654
        // Use the request type from the HTTP observer point of view.
        if ( rawtype !== 1 ) {
            pendingRequest.rawtype = rawtype;
        }

        if ( this.handleRequest(channel, URI, pendingRequest) ) {
            return;
        }

        // If request is not handled we may use the data in on-modify-request
        if ( channel instanceof Ci.nsIWritablePropertyBag ) {
            channel.setProperty(this.REQDATAKEY, [
                pendingRequest.frameId,
                pendingRequest.parentFrameId,
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

            var details = {
                frameId: channelData[0],
                parentFrameId: channelData[1],
                tabId: channelData[2],
                rawtype: channelData[3]
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
/******************************************************************************/

vAPI.net = {};

/******************************************************************************/

vAPI.net.registerListeners = function() {
    // Since it's not used
    this.onBeforeSendHeaders = null;

    if ( typeof this.onBeforeRequest.callback === 'function' ) {
        httpObserver.onBeforeRequest = this.onBeforeRequest.callback;
        httpObserver.onBeforeRequestTypes = this.onBeforeRequest.types ?
            new Set(this.onBeforeRequest.types) :
            null;
    }

    if ( typeof this.onHeadersReceived.callback === 'function' ) {
        httpObserver.onHeadersReceived = this.onHeadersReceived.callback;
        httpObserver.onHeadersReceivedTypes = this.onHeadersReceived.types ?
            new Set(this.onHeadersReceived.types) :
            null;
    }

    var shouldLoadPopupListenerMessageName = location.host + ':shouldLoadPopup';
    var shouldLoadPopupListener = function(e) {
        if ( typeof vAPI.tabs.onPopupCreated !== 'function' ) {
            return;
        }

        var openerURL = e.data;
        var popupTabId = tabWatcher.tabIdFromTarget(e.target);
        var uri, openerTabId;

        for ( var browser of tabWatcher.browsers() ) {
            uri = browser.currentURI;

            // Probably isn't the best method to identify the source tab.

            // https://github.com/gorhill/uBlock/issues/450
            // Skip entry if no valid URI available.
            // Apparently URI can be undefined under some circumstances: I
            // believe this may have to do with those very temporary
            // browser objects created when opening a new tab, i.e. related
            // to https://github.com/gorhill/uBlock/issues/212
            if ( !uri || uri.spec !== openerURL ) {
                continue;
            }

            openerTabId = tabWatcher.tabIdFromTarget(browser);
            if ( openerTabId !== popupTabId ) {
                vAPI.tabs.onPopupCreated(popupTabId, openerTabId);
                break;
            }
        }
    };

    vAPI.messaging.globalMessageManager.addMessageListener(
        shouldLoadPopupListenerMessageName,
        shouldLoadPopupListener
    );

    var shouldLoadListenerMessageName = location.host + ':shouldLoad';
    var shouldLoadListener = function(e) {
        // Non blocking: it is assumed that the http observer is fired after
        // shouldLoad recorded the pending requests. If this is not the case,
        // a request would end up being categorized as a behind-the-scene
        // requests.
        var details = e.data;

        // We are being called synchronously from the content process, so we
        // must return ASAP. The code below merely record the details of the
        // request into a ring buffer for later retrieval by the HTTP observer.
        var pendingReq = httpObserver.createPendingRequest(details.url);
        pendingReq.frameId = details.frameId;
        pendingReq.parentFrameId = details.parentFrameId;
        pendingReq.rawtype = details.rawtype;
        pendingReq.tabId = tabWatcher.tabIdFromTarget(e.target);
    };

    vAPI.messaging.globalMessageManager.addMessageListener(
        shouldLoadListenerMessageName,
        shouldLoadListener
    );

    var locationChangedListenerMessageName = location.host + ':locationChanged';
    var locationChangedListener = function(e) {
        var browser = e.target;

        // I have seen this happens (at startup time)
        if ( !browser.currentURI ) {
            return;
        }

        // https://github.com/gorhill/uBlock/issues/697
        // Dismiss event if the associated tab is pending.
        var tab = tabWatcher.tabFromBrowser(browser);
        if ( !vAPI.fennec && tab && tab.hasAttribute('pending') ) {
            // https://github.com/gorhill/uBlock/issues/820
            // Firefox quirk: it happens the `pending` attribute was not
            // present for certain tabs at startup -- and this can cause
            // unwanted [browser <--> tab id] associations internally.
            // Dispose of these if it is found the `pending` attribute is
            // set.
            tabWatcher.removeTarget(tab);
            return;
        }

        var details = e.data;
        var tabId = tabWatcher.tabIdFromTarget(browser);

        // Ignore notifications related to our popup
        if ( details.url.startsWith(vAPI.getURL('popup.html')) ) {
            return;
        }

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
            url: details.url
        });
    };

    vAPI.messaging.globalMessageManager.addMessageListener(
        locationChangedListenerMessageName,
        locationChangedListener
    );

    httpObserver.register();

    cleanupTasks.push(function() {
        vAPI.messaging.globalMessageManager.removeMessageListener(
            shouldLoadPopupListenerMessageName,
            shouldLoadPopupListener
        );

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
        for ( var win of winWatcher.getWindows() ) {
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
        var win = winWatcher.getCurrentWindow();
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

    // https://github.com/gorhill/uBlock/issues/955
    // Defer until `NativeWindow` is available.
    tbb.initOne = function(win) {
        if ( !win.NativeWindow ) {
            return;
        }
        var label = this.getMenuItemLabel();
        var id = win.NativeWindow.menu.add({
            name: label,
            callback: this.onClick
        });
        menuItemIds.set(win, id);
    };

    tbb.canInit = function(win) {
        return !!win.NativeWindow;
    };

    tbb.init = function() {
        // Only actually expecting one window under Fennec (note, not tabs, windows)
        for ( var win of winWatcher.getWindows() ) {
            deferUntil(
                this.canInit.bind(this, win),
                this.initOne.bind(this, win)
            );
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

            // https://github.com/gorhill/uMatrix/issues/362
            panel.parentNode.style.opacity = '1';

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

// Firefox 35 and less: use legacy toolbar button.

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
    if (
        CustomizableUI !== null &&
        Services.vc.compare(Services.appinfo.platformVersion, '36.0') >= 0
    ) {
        return;
    }

    tbb.codePath = 'legacy';
    tbb.id = 'uBlock0-legacy-button';   // NOTE: must match legacy-toolbar-button.css
    tbb.viewId = tbb.id + '-panel';

    var styleSheetUri = null;

    var createToolbarButton = function(window) {
        var document = window.document;

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

        return toolbarButton;
    };

    var addLegacyToolbarButton = function(window) {
        // uBO's stylesheet lazily added.
        if ( styleSheetUri === null ) {
            var sss = Cc['@mozilla.org/content/style-sheet-service;1']
                        .getService(Ci.nsIStyleSheetService);
            styleSheetUri = Services.io.newURI(vAPI.getURL('css/legacy-toolbar-button.css'), null, null);

            // Register global so it works in all windows, including palette
            if ( !sss.sheetRegistered(styleSheetUri, sss.AUTHOR_SHEET) ) {
                sss.loadAndRegisterSheet(styleSheetUri, sss.AUTHOR_SHEET);
            }
        }

        var document = window.document;

        // https://github.com/gorhill/uMatrix/issues/357
        // Already installed?
        if ( document.getElementById(tbb.id) !== null ) {
            return;
        }

        var toolbox = document.getElementById('navigator-toolbox') ||
                      document.getElementById('mail-toolbox');
        if ( toolbox === null ) {
            return;
        }

        var toolbarButton = createToolbarButton(window);

        // https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XUL/toolbarpalette
        var palette = toolbox.palette;
        if ( palette && palette.querySelector('#' + tbb.id) === null ) {
            palette.appendChild(toolbarButton);
        }

        // Find the place to put the button.
        // Pale Moon: `toolbox.externalToolbars` can be undefined. Seen while
        //   testing popup test number 3:
        //   http://raymondhill.net/ublock/popup.html
        var toolbars = toolbox.externalToolbars ? toolbox.externalToolbars.slice() : [];
        for ( var child of toolbox.children ) {
            if ( child.localName === 'toolbar' ) {
                toolbars.push(child);
            }
        }

        for ( var toolbar of toolbars ) {
            var currentsetString = toolbar.getAttribute('currentset');
            if ( !currentsetString ) {
                continue;
            }
            var currentset = currentsetString.split(/\s*,\s*/);
            var index = currentset.indexOf(tbb.id);
            if ( index === -1 ) {
                continue;
            }
            // This can occur with Pale Moon:
            //   "TypeError: toolbar.insertItem is not a function"
            if ( typeof toolbar.insertItem !== 'function' ) {
                continue;
            }
            // Found our button on this toolbar - but where on it?
            var before = null;
            for ( var i = index + 1; i < currentset.length; i++ ) {
                before = toolbar.querySelector('[id="' + currentset[i] + '"]');
                if ( before !== null ) {
                    break;
                }
            }
            // https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XUL/Method/insertItem
            toolbar.insertItem(tbb.id, before);
            break;
        }

        // https://github.com/gorhill/uBlock/issues/763
        // We are done if our toolbar button is already installed in one of the
        // toolbar.
        if ( palette !== null && toolbarButton.parentElement !== palette ) {
            return;
        }

        // No button yet so give it a default location. If forcing the button,
        // just put in in the palette rather than on any specific toolbar (who
        // knows what toolbars will be available or visible!)
        var navbar = document.getElementById('nav-bar');
        if ( navbar !== null && !vAPI.localStorage.getBool('legacyToolbarButtonAdded') ) {
            // https://github.com/gorhill/uBlock/issues/264
            // Find a child customizable palette, if any.
            navbar = navbar.querySelector('.customization-target') || navbar;
            navbar.appendChild(toolbarButton);
            navbar.setAttribute('currentset', navbar.currentSet);
            document.persist(navbar.id, 'currentset');
            vAPI.localStorage.setBool('legacyToolbarButtonAdded', 'true');
        }
    };

    var canAddLegacyToolbarButton = function(window) {
        var document = window.document;
        if (
            !document ||
            document.readyState !== 'complete' ||
            document.getElementById('nav-bar') === null
        ) {
            return false;
        }
        var toolbox = document.getElementById('navigator-toolbox') ||
                      document.getElementById('mail-toolbox');
        return toolbox !== null && !!toolbox.palette;
    };

    var onPopupCloseRequested = function({target}) {
        var document = target.ownerDocument;
        if ( !document ) {
            return;
        }
        var toolbarButtonPanel = document.getElementById(tbb.viewId);
        if ( toolbarButtonPanel === null ) {
            return;
        }
        // `hidePopup` reported as not existing while testing legacy button
        //  on FF 41.0.2.
        // https://bugzilla.mozilla.org/show_bug.cgi?id=1151796
        if ( typeof toolbarButtonPanel.hidePopup === 'function' ) {
            toolbarButtonPanel.hidePopup();
        }
    };

    var shutdown = function() {
        for ( var win of winWatcher.getWindows() ) {
            var toolbarButton = win.document.getElementById(tbb.id);
            if ( toolbarButton ) {
                toolbarButton.parentNode.removeChild(toolbarButton);
            }
        }

        vAPI.messaging.globalMessageManager.removeMessageListener(
            location.host + ':closePopup',
            onPopupCloseRequested
        );

        if ( styleSheetUri !== null ) {
            var sss = Cc['@mozilla.org/content/style-sheet-service;1']
                        .getService(Ci.nsIStyleSheetService);
            if ( sss.sheetRegistered(styleSheetUri, sss.AUTHOR_SHEET) ) {
                sss.unregisterSheet(styleSheetUri, sss.AUTHOR_SHEET);
            }
            styleSheetUri = null;
        }
    };

    tbb.attachToNewWindow = function(win) {
        deferUntil(
            canAddLegacyToolbarButton.bind(null, win),
            addLegacyToolbarButton.bind(null, win)
        );
    };

    tbb.init = function() {
        vAPI.messaging.globalMessageManager.addMessageListener(
            location.host + ':closePopup',
            onPopupCloseRequested
        );

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
        for ( var win of winWatcher.getWindows() ) {
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

        for ( var win of winWatcher.getWindows() ) {
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
        for ( var win of winWatcher.getWindows() ) {
            var panel = win.document.getElementById(tbb.viewId);
            if ( panel !== null && panel.parentNode !== null ) {
                panel.parentNode.removeChild(panel);
            }
            win.QueryInterface(Ci.nsIInterfaceRequestor)
                .getInterface(Ci.nsIDOMWindowUtils)
                .removeSheet(styleURI, 1);
        }

        CustomizableUI.removeListener(CUIEvents);
        CustomizableUI.destroyWidget(tbb.id);

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

vAPI.contextMenu = (function() {
    var clientCallback = null;
    var clientEntries = [];

    var contextMap = {
        frame: 'inFrame',
        link: 'onLink',
        image: 'onImage',
        audio: 'onAudio',
        video: 'onVideo',
        editable: 'onEditableArea'
    };

    var onCommand = function() {
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

        clientCallback(details, {
            id: tabWatcher.tabIdFromTarget(gContextMenu.browser),
            url: gContextMenu.browser.currentURI.asciiSpec
        });
    };

    var menuItemMatchesContext = function(contextMenu, clientEntry) {
        if ( !clientEntry.contexts ) {
            return false;
        }
        for ( var context of clientEntry.contexts ) {
            if ( context === 'all' ) {
                return true;
            }
            if (
                contextMap.hasOwnProperty(context) &&
                contextMenu[contextMap[context]]
            ) {
                return true;
            }
        }
        return false;
    };

    var onMenuShowing = function({target}) {
        var doc = target.ownerDocument;
        var gContextMenu = doc.defaultView.gContextMenu;
        if ( !gContextMenu.browser ) {
            return;
        }

        // https://github.com/chrisaljoudi/uBlock/issues/105
        // TODO: Should the element picker works on any kind of pages?
        var currentURI = gContextMenu.browser.currentURI,
            isHTTP = currentURI.schemeIs('http') || currentURI.schemeIs('https'),
            layoutChanged = false,
            contextMenu = doc.getElementById('contentAreaContextMenu'),
            newEntries = clientEntries,
            oldMenuitems = contextMenu.querySelectorAll('[data-uBlock0="menuitem"]'),
            newMenuitems = [],
            n = Math.max(clientEntries.length, oldMenuitems.length),
            menuitem, newEntry;
        for ( var i = 0; i < n; i++ ) {
            menuitem = oldMenuitems[i];
            newEntry = newEntries[i];
            if ( menuitem && !newEntry ) {
                menuitem.parentNode.removeChild(menuitem);
                menuitem.removeEventListener('command', onCommand);
                menuitem = null;
                layoutChanged = true;
            } else if ( !menuitem && newEntry ) {
                menuitem = doc.createElement('menuitem');
                menuitem.setAttribute('data-uBlock0', 'menuitem');
                menuitem.addEventListener('command', onCommand);
            }
            if ( !menuitem ) {
                continue;
            }
            if ( menuitem.id !== newEntry.id ) {
                menuitem.setAttribute('id', newEntry.id);
                menuitem.setAttribute('label', newEntry.title);
                layoutChanged = true;
            }
            menuitem.setAttribute('hidden', !isHTTP || !menuItemMatchesContext(gContextMenu, newEntry));
            newMenuitems.push(menuitem);
        }
        // No changes?
        if ( layoutChanged === false ) {
            return;
        }
        // No entry: remove submenu if present.
        var menu = contextMenu.querySelector('[data-uBlock0="menu"]');
        if ( newMenuitems.length === 0 ) {
            if ( menu !== null ) {
                menu.parentNode.removeChild(menuitem);
            }
            return;
        }
        // Only one entry: no need for a submenu.
        if ( newMenuitems.length === 1 ) {
            if ( menu !== null ) {
                menu.parentNode.removeChild(menu);
            }
            menuitem = newMenuitems[0];
            menuitem.setAttribute('class', 'menuitem-iconic');
            menuitem.setAttribute('image', vAPI.getURL('img/browsericons/icon16.svg'));
            contextMenu.insertBefore(menuitem, doc.getElementById('inspect-separator'));
            return;
        }
        // More than one entry: we need a submenu.
        if ( menu === null ) {
            menu = doc.createElement('menu');
            menu.setAttribute('label', vAPI.app.name);
            menu.setAttribute('data-uBlock0', 'menu');
            menu.setAttribute('class', 'menu-iconic');
            menu.setAttribute('image', vAPI.getURL('img/browsericons/icon16.svg'));
            contextMenu.insertBefore(menu, doc.getElementById('inspect-separator'));
        }
        var menupopup = contextMenu.querySelector('[data-uBlock0="menupopup"]');
        if ( menupopup === null ) {
            menupopup = doc.createElement('menupopup');
            menupopup.setAttribute('data-uBlock0', 'menupopup');
            menu.appendChild(menupopup);
        }
        for ( i = 0; i < newMenuitems.length; i++ ) {
            menuitem = newMenuitems[i];
            menuitem.setAttribute('class', 'menuitem-non-iconic');
            menuitem.removeAttribute('image');
            menupopup.appendChild(menuitem);
        }
    };

    // https://github.com/gorhill/uBlock/issues/906
    // Be sure document.readyState is 'complete': it could happen at launch
    // time that we are called by vAPI.contextMenu.create() directly before
    // the environment is properly initialized.
    var canRegister = function(win) {
        return win && win.document.readyState === 'complete';
    };

    var register = function(window) {
        if ( canRegister(window) !== true ) {
            return;
        }

        var contextMenu = window.document.getElementById('contentAreaContextMenu');
        if ( contextMenu === null ) {
            return;
        }
        contextMenu.addEventListener('popupshowing', onMenuShowing);
    };

    var registerAsync = function(win) {
        // TODO https://developer.mozilla.org/en-US/Add-ons/Firefox_for_Android/API/NativeWindow/contextmenus/add
        // var nativeWindow = doc.defaultView.NativeWindow;
        // contextId = nativeWindow.contextmenus.add(
        //    this.menuLabel,
        //    nativeWindow.contextmenus.linkOpenableContext,
        //    this.onCommand
        // );
        if ( vAPI.fennec ) {
            return;
        }
        deferUntil(
            canRegister.bind(null, win),
            register.bind(null, win)
        );
    };

    var unregister = function(win) {
        // TODO
        if ( vAPI.fennec ) {
            return;
        }
        var contextMenu = win.document.getElementById('contentAreaContextMenu');
        if ( contextMenu !== null ) {
            contextMenu.removeEventListener('popupshowing', onMenuShowing);
        }
        var menuitems = win.document.querySelectorAll('[data-uBlock0]'),
            menuitem;
        for ( var i = 0; i < menuitems.length; i++ ) {
            menuitem = menuitems[i];
            menuitem.parentNode.removeChild(menuitem);
            menuitem.removeEventListener('command', onCommand);
        }
    };

    var setEntries = function(entries, callback) {
        clientEntries = entries || [];
        clientCallback  = callback || null;
    };

    return {
        onMustUpdate: function() {},
        register: registerAsync,
        unregister: unregister,
        setEntries: setEntries
    };
})();

/******************************************************************************/
/******************************************************************************/

var optionsObserver = (function() {
    var addonId = 'uBlock0@raymondhill.net';

    var commandHandler = function() {
        switch ( this.id ) {
        case 'showDashboardButton':
            vAPI.tabs.open({ url: 'dashboard.html', index: -1 });
            break;
        case 'showNetworkLogButton':
            vAPI.tabs.open({ url: 'logger-ui.html', index: -1 });
            break;
        default:
            break;
        }
    };

    var setupOptionsButton = function(doc, id) {
        var button = doc.getElementById(id);
        if ( button === null ) {
            return;
        }
        button.addEventListener('command', commandHandler);
        button.label = vAPI.i18n(id);
    };

    var setupOptionsButtons = function(doc) {
        setupOptionsButton(doc, 'showDashboardButton');
        setupOptionsButton(doc, 'showNetworkLogButton');
    };

    var observer = {
        observe: function(doc, topic, id) {
            if ( id !== addonId ) {
                return;
            }

            setupOptionsButtons(doc);
        }
    };

    // https://github.com/gorhill/uBlock/issues/948
    // Older versions of Firefox can throw here when looking up `currentURI`.

    var canInit = function() {
        try {
            var tabBrowser = tabWatcher.currentBrowser();
            return tabBrowser &&
                   tabBrowser.currentURI &&
                   tabBrowser.currentURI.spec === 'about:addons' &&
                   tabBrowser.contentDocument &&
                   tabBrowser.contentDocument.readyState === 'complete';
        } catch (ex) {
        }
    };

    // Manually add the buttons if the `about:addons` page is already opened.

    var init = function() {
        if ( canInit() ) {
            setupOptionsButtons(tabWatcher.currentBrowser().contentDocument);
        }
    };

    var unregister = function() {
        Services.obs.removeObserver(observer, 'addon-options-displayed');
    };

    var register = function() {
        Services.obs.addObserver(observer, 'addon-options-displayed', false);
        cleanupTasks.push(unregister);
        deferUntil(canInit, init, { next: 463 });
    };

    return {
        register: register,
        unregister: unregister
    };
})();

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
    // TODO: vAPI shouldn't know about uBlock. Just like in uMatrix, uBlock
    // should collect on its side all the opened tabs whenever it is ready.
    var µb = µBlock;
    var tabId;
    for ( var browser of tabWatcher.browsers() ) {
        tabId = tabWatcher.tabIdFromTarget(browser);
        µb.tabContextManager.commit(tabId, browser.currentURI.asciiSpec);
        µb.bindTabToPageStats(tabId);
    }
    // Inject special frame script, which sole purpose is to inject
    // content scripts into *already* opened tabs. This allows to unclutter
    // the main frame script.
    vAPI.messaging
        .globalMessageManager
        .loadFrameScript(vAPI.getURL('frameScript0.js'), false);
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

// https://github.com/gorhill/uBlock/issues/531
// Storage area dedicated to admin settings. Read-only.

vAPI.adminStorage = {
    getItem: function(key, callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }
        callback(vAPI.localStorage.getItem(key));
    }
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

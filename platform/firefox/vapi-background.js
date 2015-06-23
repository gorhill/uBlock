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

    Home: https://github.com/chrisaljoudi/uBlock
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
    name: 'uBlock',
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
vAPI.localStorage.setDefaultBool("forceLegacyToolbarButton", false);

/******************************************************************************/

// List of things that needs to be destroyed when disabling the extension
// Only functions should be added to it

var cleanupTasks = [];

// This must be updated manually, every time a new task is added/removed
var expectedNumberOfCleanups = vAPI.fennec ? 7 : 9; // several instances of cleanupTasks.push, but one is unique to fennec, and three to desktop.

window.addEventListener('unload', function() {
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

var SQLite = {
    open: function() {
        var path = Services.dirsvc.get('ProfD', Ci.nsIFile);
        path.append('extension-data');

        if ( !path.exists() ) {
            path.create(Ci.nsIFile.DIRECTORY_TYPE, parseInt('0774', 8));
        }

        if ( !path.isDirectory() ) {
            throw Error('Should be a directory...');
        }

        path.append(location.host + '.sqlite');
        this.db = Services.storage.openDatabase(path);
        this.db.executeSimpleSQL(
            'CREATE TABLE IF NOT EXISTS settings' +
            '(name TEXT PRIMARY KEY NOT NULL, value TEXT);'
        );

        cleanupTasks.push(function() {
            // VACUUM somewhere else, instead on unload?
            SQLite.run('VACUUM');
            SQLite.db.asyncClose();
        });
    },

    run: function(query, values, callback) {
        if ( !this.db ) {
            this.open();
        }

        var result = {};

        query = this.db.createAsyncStatement(query);

        if ( Array.isArray(values) && values.length ) {
            var i = values.length;

            while ( i-- ) {
                query.bindByIndex(i, values[i]);
            }
        }

        query.executeAsync({
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
            }
        });
    }
};

/******************************************************************************/

vAPI.storage = {
    QUOTA_BYTES: 100 * 1024 * 1024,

    sqlWhere: function(col, params) {
        if ( params > 0 ) {
            params = new Array(params + 1).join('?, ').slice(0, -2);
            return ' WHERE ' + col + ' IN (' + params + ')';
        }

        return '';
    },

    get: function(details, callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }

        var values = [], defaults = false;

        if ( details !== null ) {
            if ( Array.isArray(details) ) {
                values = details;
            } else if ( typeof details === 'object' ) {
                defaults = true;
                values = Object.keys(details);
            } else {
                values = [details.toString()];
            }
        }

        SQLite.run(
            'SELECT * FROM settings' + this.sqlWhere('name', values.length),
            values,
            function(result) {
                var key;

                for ( key in result ) {
                    result[key] = JSON.parse(result[key]);
                }

                if ( defaults ) {
                    for ( key in details ) {
                        if ( result[key] === undefined ) {
                            result[key] = details[key];
                        }
                    }
                }

                callback(result);
            }
        );
    },

    set: function(details, callback) {
        var key, values = [], placeholders = [];

        for ( key in details ) {
            if ( !details.hasOwnProperty(key) ) {
                continue;
            }
            values.push(key);
            values.push(JSON.stringify(details[key]));
            placeholders.push('?, ?');
        }

        if ( !values.length ) {
            return;
        }

        SQLite.run(
            'INSERT OR REPLACE INTO settings (name, value) SELECT ' +
                placeholders.join(' UNION SELECT '),
            values,
            callback
        );
    },

    remove: function(keys, callback) {
        if ( typeof keys === 'string' ) {
            keys = [keys];
        }

        SQLite.run(
            'DELETE FROM settings' + this.sqlWhere('name', keys.length),
            keys,
            callback
        );
    },

    clear: function(callback) {
        SQLite.run('DELETE FROM settings');
        SQLite.run('VACUUM', null, callback);
    },

    getBytesInUse: function(keys, callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }

        SQLite.run(
            'SELECT "size" AS size, SUM(LENGTH(value)) FROM settings' +
                this.sqlWhere('name', Array.isArray(keys) ? keys.length : 0),
            keys,
            function(result) {
                callback(result.size);
            }
        );
    }
};

vAPI.storage.preferences = vAPI.storage;

/******************************************************************************/

var windowWatcher = {
    onReady: function(e) {
        if ( e ) {
            this.removeEventListener(e.type, windowWatcher.onReady);
        }

        var wintype = this.document.documentElement.getAttribute('windowtype');

        if ( wintype !== 'navigator:browser' ) {
            return;
        }

        var attachToTabBrowser = function(window, tabBrowser) {
            if (!tabBrowser) {
                return;
            }

            var tabContainer;
            if ( tabBrowser.deck ) {
                // Fennec
                tabContainer = tabBrowser.deck;
            } else if ( tabBrowser.tabContainer ) {
                // desktop Firefox
                tabContainer = tabBrowser.tabContainer;
                vAPI.contextMenu.register(window.document);
                if (vAPI.toolbarButton.attachToNewWindow) {
                    vAPI.toolbarButton.attachToNewWindow(window);
                }
            } else {
                return;
            }

            tabContainer.addEventListener('TabClose', tabWatcher.onTabClose);
            tabContainer.addEventListener('TabSelect', tabWatcher.onTabSelect);
            // when new window is opened TabSelect doesn't run on the selected tab?
        }

        var win = this;
        var tabBrowser = getTabBrowser(win);
        if ( !tabBrowser ) {
            // On some platforms, the tab browser isn't immediately available, try waiting a bit
            win.setTimeout(function() {
                attachToTabBrowser(win, getTabBrowser(win));
            }, 250);
        } else {
            attachToTabBrowser(win, tabBrowser);
        }
        
    },

    onClosed: function(win) {
        win.removeEventListener('DOMContentLoaded', this.onReady);

        var tabContainer;
        var tabBrowser = getTabBrowser(win);
        if ( !tabBrowser ) {
            return;
        }

        if ( tabBrowser.deck ) {
            // Fennec
            tabContainer = tabBrowser.deck;
        } else if ( tabBrowser.tabContainer ) {
            tabContainer = tabBrowser.tabContainer;
        }

        tabContainer.removeEventListener('TabClose', tabWatcher.onTabClose);
        tabContainer.removeEventListener('TabSelect', tabWatcher.onTabSelect);

        for ( var tab of tabBrowser.tabs ) {
            tabWatcher.onTabClose({ target: tab });

            var browser = getBrowserForTab(tab);
            if ( browser === null ) {
                continue;
            }

            // Close extension tabs
            var URI = browser.currentURI;
            if ( URI.schemeIs('chrome') && URI.host === location.host ) {
                vAPI.tabs._remove(tab, getTabBrowser(win));
            }
        }
    },

    observe: function(win, topic) {
        if ( topic === 'domwindowopened' ) {
            win.addEventListener('DOMContentLoaded', this.onReady);
        } else if (topic === 'domwindowclosed') {
            this.onClosed(win);
        }
    }
};

/******************************************************************************/

var tabWatcher = {
    onTabClose: function({target}) {
        // target is tab in Firefox, browser in Fennec
        var tabId = vAPI.tabs.getTabId(target);
        vAPI.tabs.onClosed(tabId);
        delete vAPI.toolbarButton.tabs[tabId];
        vAPI.tabs.tabLookup.delete(tabId);
    },

    onTabSelect: function({target}) {
        vAPI.setIcon(vAPI.tabs.getTabId(target), getOwnerWindow(target));
    },
};

/******************************************************************************/

vAPI.isBehindTheSceneTabId = function(tabId) {
    return tabId.toString() === '-1';
};

vAPI.noTabId = '-1';

/******************************************************************************/

var getTabBrowser = function(win) {
    return vAPI.fennec && win.BrowserApp || win.gBrowser || null;
};

/******************************************************************************/

var getBrowserForTab = function(tab) {
    if ( !tab ) {
        return null;
    }
    return vAPI.fennec && tab.browser || tab.linkedBrowser || null;
};

/******************************************************************************/

var getTabForBrowser = function(browser) {
    if ( !browser ) {
        return null;
    }
    var win = browser.ownerGlobal;
    if ( !win ) {
        return null;
    }
    if (vAPI.fennec) {
        return win.BrowserApp && win.BrowserApp.getTabForBrowser(browser);
    } else {
        var gBrowser = win.gBrowser;
        if (gBrowser) {
            if (typeof gBrowser.getTabForBrowser === 'function') {
                return gBrowser.getTabForBrowser(browser);
            } else if (gBrowser.browsers && gBrowser.tabs) {
                // Fallback to manual searching if the browser doesn't support getTabForBrowser
                for (var i = 0; i < gBrowser.browsers.length; i++) {
                    if (gBrowser.browsers[i] === browser) {
                        return gBrowser.tabs[i];
                    }
                }
            }
        }
    }

    return null;
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

vAPI.tabs = {};

/******************************************************************************/

vAPI.tabs.registerListeners = function() {
    // onClosed - handled in tabWatcher.onTabClose
    // onPopup - handled in httpObserver.handlePopup

    for ( var win of this.getWindows() ) {
        windowWatcher.onReady.call(win);
    }

    Services.ww.registerNotification(windowWatcher);

    cleanupTasks.push(function() {
        Services.ww.unregisterNotification(windowWatcher);

        vAPI.contextMenu.remove();

        for ( var win of vAPI.tabs.getWindows() ) {
            windowWatcher.onClosed(win);
        }
    });
};

/******************************************************************************/

vAPI.tabs.stack = new WeakMap();
vAPI.tabs.tabLookup = new Map();
vAPI.tabs.stackId = 1;

/******************************************************************************/

vAPI.tabs.getTabId = function(target) {
    if ( !target ) {
        return vAPI.noTabId;
    }

    var tab = null;
    var browser;

    if ( vAPI.fennec ) {
        if (target.browser) {
            // target is a tab
            tab = target;
            browser = target.browser;
        } else {
            browser = target;
        }
    } else if ( target.linkedPanel ) {
        // target is a tab
        tab = target;
        browser = target.linkedBrowser;
    } else {
        browser = target;
    }

    if ( browser.localName !== 'browser' ) {
        return vAPI.noTabId;
    }

    var tabId = this.stack.get(browser);
    if ( !tabId ) {
        tabId = '' + this.stackId++;
        this.stack.set(browser, tabId);

        this.tabLookup.set(tabId, tab || browser); // If the tab is not know, record the browser instead and find the tab later
    }
    return tabId;
};

/******************************************************************************/

vAPI.tabs.tabFromTabId = function(tabId) {
    var target = this.tabLookup.get(tabId);

    if (!target) {
        return null;
    }

    // Check if this is actually a tab
    if (vAPI.fennec && target.browser ||
        target.linkedPanel) {
        return target;
    }
    // This isn't a tab. No tab for this browser is yet known.
    var tab = getTabForBrowser(target);
    if (tab) {
        // Found the tab now, so record it
        this.tabLookup.set(tabId, tab);
    }
    return tab;
};

/******************************************************************************/

vAPI.tabs.get = function(tabId, callback) {
    var tab, win;

    if ( tabId === null ) {
        win = Services.wm.getMostRecentWindow('navigator:browser');
        var tabBrowser = getTabBrowser(win);
        if (tabBrowser) {
            tab = tabBrowser.selectedTab;
            tabId = this.getTabId(tab);
        }
    } else {
        tab = this.tabFromTabId(tabId);
        if ( tab ) {
            win = getOwnerWindow(tab);
        }
    }

    // For internal use
    if ( typeof callback !== 'function' ) {
        return tab;
    }

    if ( !tab ) {
        callback();
        return;
    }

    var windows = this.getWindows();
    var browser = getBrowserForTab(tab);
    var tabBrowser = getTabBrowser(win);
    var tabIndex, tabTitle;
    if ( vAPI.fennec ) {
        tabIndex = tabBrowser.tabs.indexOf(tab);
        tabTitle = browser.contentTitle;
    } else {
        tabIndex = tabBrowser.browsers.indexOf(browser);
        tabTitle = tab.label;
    }

    callback({
        id: tabId,
        index: tabIndex,
        windowId: windows.indexOf(win),
        active: tab === tabBrowser.selectedTab,
        url: browser.currentURI.asciiSpec,
        title: tabTitle
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

    var win, tab, tabBrowser;

    if ( details.select ) {
        var URI = Services.io.newURI(details.url, null, null);

        for ( tab of this.getAll() ) {
            var browser = getBrowserForTab(tab);

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
        tab = this.tabFromTabId(details.tabId);
        if ( tab ) {
            getBrowserForTab(tab).loadURI(details.url);
            return;
        }
    }

    win = Services.wm.getMostRecentWindow('navigator:browser');
    tabBrowser = getTabBrowser(win);

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

    var tab = this.tabFromTabId(tabId);
    if ( tab ) {
        getBrowserForTab(tab).loadURI(targetURL);
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
    var tab = this.tabFromTabId(tabId);
    if ( tab ) {
        this._remove(tab, getTabBrowser(getOwnerWindow(tab)));
    }
};

/******************************************************************************/

vAPI.tabs.reload = function(tabId) {
    var tab = this.get(tabId);

    if ( !tab ) {
        return;
    }

    getBrowserForTab(tab).webNavigation.reload(
        Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE
    );
};

/******************************************************************************/

vAPI.tabs.select = function(tab) {
    tab = typeof tab === 'object' ? tab : this.get(tab);

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
    var tab = this.get(tabId);

    if ( !tab ) {
        return;
    }

    if ( typeof details.file !== 'string' ) {
        return;
    }

    details.file = vAPI.getURL(details.file);
    getBrowserForTab(tab).messageManager.sendAsyncMessage(
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
        setTimeout(callback, 13);
    }
};

/******************************************************************************/

vAPI.setIcon = function(tabId, iconStatus, badge) {
    // If badge is undefined, then setIcon was called from the TabSelect event
    var win = badge === undefined
        ? iconStatus
        : Services.wm.getMostRecentWindow('navigator:browser');
    var curTabId = vAPI.tabs.getTabId(getTabBrowser(win).selectedTab);
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
            id: vAPI.tabs.getTabId(target)
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
    // Request types: https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIContentPolicy#Constants
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
    lastRequest: [{}, {}],

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
        var type = this.typeMap[details.type] || 'other';

        if ( onBeforeRequest.types.has(type) === false ) {
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

        /*if ( result.redirectUrl ) {
            channel.redirectionLimit = 1;
            channel.redirectTo(
                Services.io.newURI(result.redirectUrl, null, null)
            );
            return true;
        }*/

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

        var lastRequest = this.lastRequest[0];

        if ( lastRequest.url !== URI.spec ) {
            if ( this.lastRequest[1].url === URI.spec ) {
                lastRequest = this.lastRequest[1];
            } else {
                lastRequest.url = null;
            }
        }

        if ( lastRequest.url === null ) {
            lastRequest.type = channel.loadInfo && channel.loadInfo.contentPolicyType || 1;
            result = this.handleRequest(channel, URI, {
                tabId: vAPI.noTabId,
                type: lastRequest.type
            });

            if ( result === true ) {
                return;
            }

            if ( channel instanceof Ci.nsIWritablePropertyBag === false ) {
                return;
            }

            // Carry data for behind-the-scene redirects
            channel.setProperty(
                this.REQDATAKEY,
                [0, -1, null, vAPI.noTabId, lastRequest.type]
            );
            return;
        }

        // Important! When loading file via XHR for mirroring,
        // the URL will be the same, so it could fall into an infinite loop
        lastRequest.url = null;

        if ( this.handleRequest(channel, URI, lastRequest) ) {
            return;
        }

        // If request is not handled we may use the data in on-modify-request
        if ( channel instanceof Ci.nsIWritablePropertyBag ) {
            channel.setProperty(this.REQDATAKEY, [
                lastRequest.frameId,
                lastRequest.parentFrameId,
                lastRequest.sourceTabId,
                lastRequest.tabId,
                lastRequest.type
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
                type: channelData[4]
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

    this.onBeforeRequest.types = new Set(this.onBeforeRequest.types);

    var shouldLoadListenerMessageName = location.host + ':shouldLoad';
    var shouldLoadListener = function(e) {
        var details = e.data;
        var tabId = vAPI.tabs.getTabId(e.target);
        var sourceTabId = null;

        // Popup candidate
        if ( details.openerURL ) {
            for ( var tab of vAPI.tabs.getAll() ) {
                var URI = getBrowserForTab(tab).currentURI;

                // Probably isn't the best method to identify the source tab
                if ( URI.spec !== details.openerURL ) {
                    continue;
                }

                sourceTabId = vAPI.tabs.getTabId(tab);

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

        var lastRequest = httpObserver.lastRequest;
        lastRequest[1] = lastRequest[0];
        lastRequest[0] = {
            frameId: details.frameId,
            parentFrameId: details.parentFrameId,
            sourceTabId: sourceTabId,
            tabId: tabId,
            type: details.type,
            url: details.url
        };
    };

    vAPI.messaging.globalMessageManager.addMessageListener(
        shouldLoadListenerMessageName,
        shouldLoadListener
    );

    var locationChangedListenerMessageName = location.host + ':locationChanged';
    var locationChangedListener = function(e) {
        var details = e.data;
        var browser = e.target;
        
        if (details.noRefresh && details.url === browser.currentURI.asciiSpec) { // If the location changed message specified not to refresh, and the URL is the same, no need to do anything
            //console.debug("nsIWebProgressListener: ignoring onLocationChange: " + details.url);
            return;
        }

        var tabId = vAPI.tabs.getTabId(browser);
        if (tabId === vAPI.noTabId) {
            return; // Do not navigate for behind the scenes
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
            var curTabId = vAPI.tabs.getTabId(getTabBrowser(win).selectedTab);
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

    vAPI.messaging.globalMessageManager.addMessageListener(
        location.host + ':closePopup',
        vAPI.toolbarButton.onPopupCloseRequested
    );

    cleanupTasks.push(function() {
       vAPI.messaging.globalMessageManager.removeMessageListener(
            location.host + ':closePopup',
            vAPI.toolbarButton.onPopupCloseRequested
        );
    });

    var CustomizableUI;

    var forceLegacyToolbarButton = vAPI.localStorage.getBool("forceLegacyToolbarButton");
    if (!forceLegacyToolbarButton) {
        try {
            CustomizableUI = Cu.import('resource:///modules/CustomizableUI.jsm', null).CustomizableUI;
        } catch (ex) {
        }
    }

    if (!CustomizableUI) {
        // Create a fallback non-customizable UI button
        var sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
        var styleSheetUri = Services.io.newURI(vAPI.getURL("css/legacy-toolbar-button.css"), null, null);
        var legacyButtonId = "uBlock-legacy-button"; // NOTE: must match legacy-toolbar-button.css
        this.id = legacyButtonId;
        this.viewId = legacyButtonId + "-panel";
                
        if (!sss.sheetRegistered(styleSheetUri, sss.AUTHOR_SHEET)) {
            sss.loadAndRegisterSheet(styleSheetUri, sss.AUTHOR_SHEET); // Register global so it works in all windows, including palette
        }

        var addLegacyToolbarButton = function(window) {
            var document = window.document;
            var toolbox = document.getElementById('navigator-toolbox') || document.getElementById('mail-toolbox');
            
            if (toolbox) {
                var palette = toolbox.palette;

                if (!palette) {
                    // palette might take a little longer to appear on some platforms, give it a small delay and try again
                    window.setTimeout(function() {
                        if (toolbox.palette) {
                            addLegacyToolbarButton(window);
                        }
                    }, 250);
                    return;
                }

                var toolbarButton = document.createElement('toolbarbutton');
                toolbarButton.setAttribute('id', legacyButtonId);
                toolbarButton.setAttribute('type', 'menu'); // type = panel would be more accurate, but doesn't look as good
                toolbarButton.setAttribute('removable', 'true');
                toolbarButton.setAttribute('class', 'toolbarbutton-1 chromeclass-toolbar-additional');
                toolbarButton.setAttribute('label', vAPI.toolbarButton.label);

                var toolbarButtonPanel = document.createElement("panel");
                // toolbarButtonPanel.setAttribute('level', 'parent'); NOTE: Setting level to parent breaks the popup for PaleMoon under linux (mouse pointer misaligned with content). For some reason.
                vAPI.toolbarButton.populatePanel(document, toolbarButtonPanel);
                toolbarButtonPanel.addEventListener('popupshowing', vAPI.toolbarButton.onViewShowing);
                toolbarButtonPanel.addEventListener('popuphiding', vAPI.toolbarButton.onViewHiding);
                toolbarButton.appendChild(toolbarButtonPanel);
                
                palette.appendChild(toolbarButton);

                vAPI.toolbarButton.closePopup = function() {
                    toolbarButtonPanel.hidePopup();
                }

                if (!vAPI.localStorage.getBool('legacyToolbarButtonAdded')) {
                    // No button yet so give it a default location. If forcing the button, just put in in the palette rather than on any specific toolbar (who knows what toolbars will be available or visible!)
                    var toolbar = !forceLegacyToolbarButton && document.getElementById('nav-bar');
                    if (toolbar) {
                        toolbar.appendChild(toolbarButton);
                        toolbar.setAttribute('currentset', toolbar.currentSet);
                        document.persist(toolbar.id, 'currentset');
                    }
                    vAPI.localStorage.setBool('legacyToolbarButtonAdded', 'true');
                } else {
                    // Find the place to put the button
                    var toolbars = toolbox.externalToolbars.slice();
                    for (var child of toolbox.children) {
                        if (child.localName === 'toolbar') {
                            toolbars.push(child);
                        }
                    }

                    for (var toolbar of toolbars) {
                        var currentsetString = toolbar.getAttribute('currentset');
                        if (currentsetString) {
                            var currentset = currentsetString.split(',');
                            var index = currentset.indexOf(legacyButtonId);
                            if (index >= 0) {
                                // Found our button on this toolbar - but where on it?
                                var before = null;
                                for (var i = index + 1; i < currentset.length; i++) {
                                    before = document.getElementById(currentset[i]);
                                    if (before) {
                                        toolbar.insertItem(legacyButtonId, before);
                                        break;
                                    }
                                }
                                if (!before) {
                                    toolbar.insertItem(legacyButtonId);
                                }
                            }
                        }
                    }
                }
            }
        }
        
        vAPI.toolbarButton.attachToNewWindow = function(win) {
            addLegacyToolbarButton(win);
        }

        cleanupTasks.push(function() {
            for ( var win of vAPI.tabs.getWindows() ) {
                var toolbarButton = win.document.getElementById(legacyButtonId);
                if (toolbarButton) {
                    toolbarButton.parentNode.removeChild(toolbarButton);
                }
            }

            if (sss.sheetRegistered(styleSheetUri, sss.AUTHOR_SHEET)) {
                sss.unregisterSheet(styleSheetUri, sss.AUTHOR_SHEET);
            }
        }.bind(this));
        return;
    }

    this.CustomizableUI = CustomizableUI;

    this.defaultArea = CustomizableUI.AREA_NAVBAR;
    this.styleURI = [
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
        '#' + this.viewId + ' {',
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
            setTimeout(this.updateBadgeStyle, 250);
        }.bind(this.CUIEvents);
        this.CUIEvents.onCustomizeEnd = updateBadge;
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
            setTimeout(updateBadge, 250);
        };

        CustomizableUI.addListener(this.CUIEvents);
    }

    this.styleURI = Services.io.newURI(
        'data:text/css,' + encodeURIComponent(this.styleURI.join('')),
        null,
        null
    );

    this.closePopup = function(tabBrowser) {
        CustomizableUI.hidePanelForNode(
            tabBrowser.ownerDocument.getElementById(vAPI.toolbarButton.viewId)
        );
    };

    CustomizableUI.createWidget(this);
    

    cleanupTasks.push(function() {
        if ( this.CUIEvents ) {
            CustomizableUI.removeListener(this.CUIEvents);
        }

        CustomizableUI.destroyWidget(this.id);
        
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

vAPI.toolbarButton.onPopupCloseRequested = function({target}) {
    if (vAPI.toolbarButton.closePopup) {
        vAPI.toolbarButton.closePopup(target);
    }
}

/******************************************************************************/

vAPI.toolbarButton.onBeforeCreated = function(doc) {
    var panel = doc.createElement('panelview');
    
    vAPI.toolbarButton.populatePanel(doc, panel);

    doc.getElementById('PanelUI-multiView').appendChild(panel);

    doc.defaultView.QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsIDOMWindowUtils)
        .loadSheet(this.styleURI, 1);
};

vAPI.toolbarButton.populatePanel = function(doc, panel) {
    panel.setAttribute('id', this.viewId);

    var iframe = doc.createElement('iframe');
    iframe.setAttribute('type', 'content');

    panel.appendChild(iframe);

    var updateTimer = null;
    var delayedResize = function(attempts) {
        if ( updateTimer ) {
            return;
        }

        // Sanity check
        attempts = (attempts || 0) + 1;
        if (attempts > 1000) {
            console.error('uBlock> delayedResize: giving up after too many attemps');
            return;
        }

        updateTimer = setTimeout(resizePopup, 10, attempts);
    };
    var resizePopup = function(attempts) {
        updateTimer = null;
        var body = iframe.contentDocument.body;
        panel.parentNode.style.maxWidth = 'none';
        // https://github.com/chrisaljoudi/uBlock/issues/730
        // Voodoo programming: this recipe works
        var toPixelString = pixels => pixels.toString() + 'px';

        var clientHeight = body.clientHeight;
        iframe.style.height = toPixelString(clientHeight);
        panel.style.height = toPixelString(clientHeight + (panel.boxObject.height - panel.clientHeight));

        var clientWidth = body.clientWidth;
        iframe.style.width = toPixelString(clientWidth);
        panel.style.width = toPixelString(clientWidth + (panel.boxObject.width - panel.clientWidth));

        if ( iframe.clientHeight !== body.clientHeight || iframe.clientWidth !== body.clientWidth ) {
            delayedResize(attempts);
        }
    };

    var CustomizableUI = this.CustomizableUI;
    var widgetId = this.id;
    var onPopupReady = function() {
        var win = this.contentWindow;

        if ( !win || win.location.host !== location.host ) {
            return;
        }

        if (CustomizableUI) {
            var placement = CustomizableUI.getPlacementOfWidget(widgetId);
            if (placement.area === CustomizableUI.AREA_PANEL) {
                // Add some overrides for displaying the popup correctly in a panel
                win.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils)
                    .loadSheet(Services.io.newURI(vAPI.getURL("css/popup-vertical.css"), null, null), Ci.nsIDOMWindowUtils.AUTHOR_SHEET);
            }
        }

        new win.MutationObserver(delayedResize).observe(win.document.body, {
            attributes: true,
            characterData: true,
            subtree: true
        });

        delayedResize();
    };

    iframe.addEventListener('load', onPopupReady, true);
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
        button.classList.add('off');
    }
    else {
        button.classList.remove('off');
    }
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

vAPI.contextMenu.createContextMenuItem = function(doc) {
    var menuitem = doc.createElement('menuitem');
    menuitem.setAttribute('id', this.menuItemId);
    menuitem.setAttribute('label', this.menuLabel);
    menuitem.setAttribute('image', vAPI.getURL('img/browsericons/icon16.svg'));
    menuitem.setAttribute('class', 'menuitem-iconic');
    return menuitem;
}

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

    if (doc.getElementById(this.menuItemId)) {
        // Context menu already registered for this window
        return;
    }

    var contextMenu = doc.getElementById('contentAreaContextMenu');
    if (contextMenu) {
        var menuitem = this.createContextMenuItem(doc);
        menuitem.addEventListener('command', this.onCommand);
        contextMenu.addEventListener('popupshowing', this.displayMenuItem);
        contextMenu.insertBefore(menuitem, doc.getElementById('inspect-separator'));
    }
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

vAPI.contextMenu.registerForWebInspector = function(eventName, toolbox, panel) {
    var menuPopup = panel.panelDoc.getElementById("inspector-node-popup");
    var deleteMenuItem = panel.panelDoc.getElementById("node-menu-delete");
    var tiltButton = toolbox.toolboxButtons.filter(tool => tool.id === "command-button-tilt")[0];
    tiltButton = tiltButton && tiltButton.button;

    if (menuPopup && deleteMenuItem) {
        var menuitem = vAPI.contextMenu.createContextMenuItem(panel.panelDoc);
        menuitem.addEventListener('command', function() {
            var selectedNodeFront = panel.selection.nodeFront;
            while (selectedNodeFront && selectedNodeFront.baseURI !== panel.walker.rootNode.baseURI) {
                // This is an iFrame, so we can't select it directly. Walk up the parent stack until we do
                selectedNodeFront = selectedNodeFront.parentNode();
            }
            if (selectedNodeFront) {
                selectedNodeFront.getUniqueSelector().then(selector => µBlock.elementPickerExec(vAPI.tabs.getTabId(panel.browser), { type: 'element', value: selector}));

                // Turn off 3D view, if it's turned on.
                if (tiltButton && tiltButton.checked) {
                    tiltButton.click();
                }
            }
        });

        menuPopup.insertBefore(menuitem, deleteMenuItem);
    }
}

vAPI.contextMenu.registerForNetMonitor = function(eventName, toolbox, panel) {
    var doc = panel.panelWin.document;
    var menuPopup = doc.getElementById("network-request-popup");
    var insertBeforeMenuItem = doc.getElementById("request-menu-context-separator");
    
    if (menuPopup && insertBeforeMenuItem) {
        var menuitem = vAPI.contextMenu.createContextMenuItem(doc);
        menuitem.addEventListener('command', function() {
            var selectedRequest = panel.panelWin.NetMonitorView.RequestsMenu.selectedAttachment;
            if (selectedRequest) {
                µBlock.elementPickerExec(vAPI.tabs.getTabId(toolbox.target.tab), { type: 'url', value: selectedRequest.url });
            }
        });

        menuPopup.insertBefore(menuitem, insertBeforeMenuItem);
    }
}

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
            details.frameUrl = gContextMenu.focusedWindow.location.href;
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
            id: vAPI.tabs.getTabId(gContextMenu.browser),
            url: gContextMenu.browser.currentURI.asciiSpec
        });
    };

    // Also add a context menu to the web inspector
    if (!vAPI.fennec) {
        try {
            this.gDevTools = Cu.import('resource:///modules/devtools/gDevTools.jsm', null).gDevTools;
        } catch (ex) {
            // console.error(ex);
        }

        if (this.gDevTools) {
            this.gDevTools.on("inspector-ready", this.registerForWebInspector);
            this.gDevTools.on("netmonitor-ready", this.registerForNetMonitor);
        }
    }

    for ( var win of vAPI.tabs.getWindows() ) {
        this.register(win.document);
    }
};

/******************************************************************************/

vAPI.contextMenu.remove = function() {
    for ( var win of vAPI.tabs.getWindows() ) {
        this.unregister(win.document);
    }

    if (!vAPI.fennec && this.gDevTools) {
        this.gDevTools.off("inspector-ready", this.registerForWebInspector);
        this.gDevTools.off("netmonitor-ready", this.registerForNetMonitor);
    }

    this.menuItemId = null;
    this.menuLabel = null;
    this.contexts = null;
    this.onCommand = null;
};

/******************************************************************************/

var optionsObserver = {
    addonId: '{2b10c1c8-a11f-4bad-fe9c-1c11e82cac42}',

    register: function() {
        Services.obs.addObserver(this, 'addon-options-displayed', false);
        cleanupTasks.push(this.unregister.bind(this));

        var browser = getBrowserForTab(vAPI.tabs.get(null));
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
        this.setupOptionsButton(doc, 'showNetworkLogButton', 'devtools.html');
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
    for ( var tab of this.tabs.getAll() ) {
        // We're insterested in only the tabs that were already loaded
        if ( !vAPI.fennec && tab.hasAttribute('pending') ) {
            continue;
        }

        var tabId = this.tabs.getTabId(tab);
        var browser = getBrowserForTab(tab);
        µb.tabContextManager.commit(tabId);
        µb.bindTabToPageStats(tabId, browser.currentURI.asciiSpec);
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

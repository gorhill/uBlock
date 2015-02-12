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
/* global self, Components, punycode */

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

/******************************************************************************/

vAPI.app = {
    name: 'µBlock',
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

        if ( !this.gBrowser || !this.gBrowser.tabContainer ) {
            return;
        }

        var tC = this.gBrowser.tabContainer;

        this.gBrowser.addTabsProgressListener(tabWatcher);
        tC.addEventListener('TabClose', tabWatcher.onTabClose);
        tC.addEventListener('TabSelect', tabWatcher.onTabSelect);

        vAPI.contextMenu.register(this.document);

        // when new window is opened TabSelect doesn't run on the selected tab?
    },

    observe: function(win, topic) {
        if ( topic === 'domwindowopened' ) {
            win.addEventListener('DOMContentLoaded', this.onReady);
        }
    }
};

/******************************************************************************/

var tabWatcher = {
    onTabClose: function({target: tab}) {
        var tabId = vAPI.tabs.getTabId(tab);
        vAPI.tabs.onClosed(tabId);
        delete vAPI.toolbarButton.tabs[tabId];
    },

    onTabSelect: function({target: tab}) {
        var URI = tab.linkedBrowser.currentURI;
        var aboutPath = URI.schemeIs('about') && URI.path;
        var tabId = vAPI.tabs.getTabId(tab);

        if ( !aboutPath || (aboutPath !== 'blank' && aboutPath !== 'newtab') ) {
            vAPI.setIcon(tabId, tab.ownerDocument.defaultView);
            return;
        }

        vAPI.tabs.onNavigation({
            frameId: 0,
            tabId: tabId,
            url: URI.asciiSpec
        });
    },

    onLocationChange: function(browser, webProgress, request, location, flags) {
        if ( !webProgress.isTopLevel ) {
            return;
        }

        var tabId = vAPI.tabs.getTabId(browser);

        // LOCATION_CHANGE_SAME_DOCUMENT = "did not load a new document"
        if ( flags & 1 ) {
            vAPI.tabs.onUpdated(tabId, {url: location.asciiSpec}, {
                frameId: 0,
                tabId: tabId,
                url: browser.currentURI.asciiSpec
            });
            return;
        }

        // https://github.com/gorhill/uBlock/issues/105
        // Allow any kind of pages
        vAPI.tabs.onNavigation({
            frameId: 0,
            tabId: tabId,
            url: location.asciiSpec
        });
    }
};

/******************************************************************************/

vAPI.isNoTabId = function(tabId) {
    return tabId.toString() === '-1';
};

vAPI.noTabId = '-1';

/******************************************************************************/

vAPI.tabs = {};

/******************************************************************************/

vAPI.tabs.registerListeners = function() {
    // onNavigation and onUpdated handled with tabWatcher.onLocationChange
    // onClosed - handled in tabWatcher.onTabClose
    // onPopup - handled in httpObserver.handlePopup

    for ( var win of this.getWindows() ) {
        windowWatcher.onReady.call(win);
    }

    Services.ww.registerNotification(windowWatcher);

    cleanupTasks.push(function() {
        Services.ww.unregisterNotification(windowWatcher);

        for ( var win of vAPI.tabs.getWindows() ) {
            vAPI.contextMenu.unregister(win.document);

            win.removeEventListener('DOMContentLoaded', windowWatcher.onReady);
            win.gBrowser.removeTabsProgressListener(tabWatcher);

            var tC = win.gBrowser.tabContainer;
            tC.removeEventListener('TabClose', tabWatcher.onTabClose);
            tC.removeEventListener('TabSelect', tabWatcher.onTabSelect);

            // close extension tabs
            for ( var tab of win.gBrowser.tabs ) {
                var URI = tab.linkedBrowser.currentURI;

                if ( URI.schemeIs('chrome') && URI.host === location.host ) {
                    win.gBrowser.removeTab(tab);
                }
            }
        }
    });
};

/******************************************************************************/

vAPI.tabs.getTabId = function(target) {
    if ( target.linkedPanel ) {
        return target.linkedPanel;
    }

    var i, gBrowser = target.ownerDocument.defaultView.gBrowser;

    if ( !gBrowser ) {
        return -1;
    }

    // This should be more efficient from version 35
    if ( gBrowser.getTabForBrowser ) {
        i = gBrowser.getTabForBrowser(target);
        return i ? i.linkedPanel : -1;
    }

    if ( !gBrowser.browsers ) {
        return -1;
    }

    i = gBrowser.browsers.indexOf(target);

    if ( i !== -1 ) {
        i = gBrowser.tabs[i].linkedPanel;
    }

    return i;
};

/******************************************************************************/

vAPI.tabs.get = function(tabId, callback) {
    var tab, windows;

    if ( tabId === null ) {
        tab = Services.wm.getMostRecentWindow('navigator:browser').gBrowser.selectedTab;
        tabId = vAPI.tabs.getTabId(tab);
    } else {
        windows = this.getWindows();

        for ( var win of windows ) {
            tab = win.gBrowser.tabContainer.querySelector(
                'tab[linkedpanel="' + tabId + '"]'
            );

            if ( tab ) {
                break;
            }
        }
    }

    // for internal use
    if ( typeof callback !== 'function' ) {
        return tab;
    }

    if ( !tab ) {
        callback();
        return;
    }

    var browser = tab.linkedBrowser;
    var gBrowser = browser.ownerDocument.defaultView.gBrowser;

    if ( !windows ) {
        windows = this.getWindows();
    }

    callback({
        id: tabId,
        index: gBrowser.browsers.indexOf(browser),
        windowId: windows.indexOf(browser.ownerDocument.defaultView),
        active: tab === gBrowser.selectedTab,
        url: browser.currentURI.asciiSpec,
        title: tab.label
    });
};

/******************************************************************************/

vAPI.tabs.getAll = function(window) {
    var win, tab, tabs = [];

    for ( win of this.getWindows() ) {
        if ( window && window !== win ) {
            continue;
        }

        for ( tab of win.gBrowser.tabs ) {
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

    var tab, tabs;

    if ( details.select ) {
        var URI = Services.io.newURI(details.url, null, null);
        tabs = this.getAll();

        for ( tab of tabs ) {
            var browser = tab.linkedBrowser;

            // Or simply .equals if we care about the fragment
            if ( URI.equalsExceptRef(browser.currentURI) ) {
                browser.ownerDocument.defaultView.gBrowser.selectedTab = tab;
                return;
            }
        }
    }

    if ( details.active === undefined ) {
        details.active = true;
    }

    var gBrowser = Services.wm.getMostRecentWindow('navigator:browser').gBrowser;

    if ( details.index === -1 ) {
        details.index = gBrowser.browsers.indexOf(gBrowser.selectedBrowser) + 1;
    }

    if ( details.tabId ) {
        tabs = tabs || this.getAll();

        for ( tab of tabs ) {
            if ( vAPI.tabs.getTabId(tab) === details.tabId ) {
                tab.linkedBrowser.loadURI(details.url);
                return;
            }
        }
    }

    tab = gBrowser.loadOneTab(details.url, {inBackground: !details.active});

    if ( details.index !== undefined ) {
        gBrowser.moveTabTo(tab, details.index);
    }
};

/******************************************************************************/

vAPI.tabs.remove = function(tabIds) {
    if ( !Array.isArray(tabIds) ) {
        tabIds = [tabIds];
    }

    tabIds = tabIds.map(function(tabId) {
        return 'tab[linkedpanel="' + tabId + '"]';
    }).join(',');

    for ( var win of this.getWindows() ) {
        var tabs = win.gBrowser.tabContainer.querySelectorAll(tabIds);

        if ( !tabs ) {
            continue;
        }

        for ( var tab of tabs ) {
            win.gBrowser.removeTab(tab);
        }
    }
};

/******************************************************************************/

vAPI.tabs.reload = function(tabId) {
    var tab = this.get(tabId);

    if ( tab ) {
        tab.ownerDocument.defaultView.gBrowser.reloadTab(tab);
    }
};

/******************************************************************************/

vAPI.tabs.injectScript = function(tabId, details, callback) {
    var tab = vAPI.tabs.get(tabId);

    if ( !tab ) {
        return;
    }

    if ( typeof details.file !== 'string' ) {
        return;
    }

    details.file = vAPI.getURL(details.file);
    tab.linkedBrowser.messageManager.sendAsyncMessage(
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
    var curTabId = vAPI.tabs.getTabId(win.gBrowser.selectedTab);
    var tb = vAPI.toolbarButton;

    // from 'TabSelect' event
    if ( tabId === undefined ) {
        tabId = curTabId;
    } else if ( badge !== undefined ) {
        tb.tabs[tabId] = { badge: badge, img: iconStatus === 'on' };
    }

    if ( tabId !== curTabId ) {
        return;
    }

    var button = win.document.getElementById(tb.id);

    if ( !button ) {
        return;
    }

    var icon = tb.tabs[tabId];
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
        messageManager = target
            .webNavigation.QueryInterface(Ci.nsIDocShell)
            .chromeEventHandler.ownerDocument.defaultView.messageManager;
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

    console.error('µBlock> messaging > unknown request: %o', data);

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
        14: 'font'
    },
    lastRequest: {
        url: null,
        type: null,
        tabId: null,
        frameId: null,
        parentFrameId: null,
        openerURL: null
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
        Services.obs.addObserver(this, 'http-on-opening-request', true);
        Services.obs.addObserver(this, 'http-on-examine-response', true);

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
            tabId: tabId,
            sourceTabId: sourceTabId,
            url: URI.asciiSpec
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

        if ( result.redirectUrl ) {
            channel.redirectionLimit = 1;
            channel.redirectTo(
                Services.io.newURI(result.redirectUrl, null, null)
            );
            return true;
        }

        return false;
    },

    observe: function(channel, topic) {
        if ( !(channel instanceof Ci.nsIHttpChannel) ) {
            return;
        }

        var URI = channel.URI;
        var channelData, result;

        if ( topic === 'http-on-examine-response' ) {
            if ( !(channel instanceof Ci.nsIWritablePropertyBag) ) {
                return;
            }

            try {
                /*[
                    type,
                    tabId,
                    sourceTabId - given if it was a popup,
                    frameId,
                    parentFrameId
                ]*/
                channelData = channel.getProperty(location.host + 'reqdata');
            } catch (ex) {
                return;
            }

            if ( !channelData ) {
                return;
            }

            if ( (1 << channelData[0] & this.VALID_CSP_TARGETS) === 0 ) {
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
                parentFrameId: channelData[4],
                responseHeaders: result ? [{name: topic, value: result}] : [],
                tabId: channelData[1],
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

        var lastRequest = this.lastRequest;

        if ( lastRequest.url === null ) {
            this.handleRequest(channel, URI, {tabId: vAPI.noTabId, type: 1});
            return;
        }

        // Important! When loading file via XHR for mirroring,
        // the URL will be the same, so it could fall into an infinite loop
        lastRequest.url = null;

        var sourceTabId = null;

        // Popup candidate (only for main_frame type)
        if ( lastRequest.openerURL ) {
            for ( var tab of vAPI.tabs.getAll() ) {
                var tabURI = tab.linkedBrowser.currentURI;

                // Probably isn't the best method to identify the source tab
                if ( tabURI.spec !== lastRequest.openerURL ) {
                    continue;
                }

                sourceTabId = vAPI.tabs.getTabId(tab);

                if ( sourceTabId !== lastRequest.tabId ) {
                    break;
                }

                sourceTabId = null;
            }

            if ( this.handlePopup(channel.URI, lastRequest.tabId, sourceTabId) ) {
                channel.cancel(this.ABORT);
                return;
            }
        }

        if ( this.handleRequest(channel, URI, lastRequest) ) {
            return;
        }

        // If request is not handled we may use the data in on-modify-request
        if ( channel instanceof Ci.nsIWritablePropertyBag ) {
            channel.setProperty(
                location.host + 'reqdata',
                [
                    lastRequest.type,
                    lastRequest.tabId,
                    sourceTabId,
                    lastRequest.frameId,
                    lastRequest.parentFrameId
                ]
            );
        }
    },

    // contentPolicy.shouldLoad doesn't detect redirects, this needs to be used
    asyncOnChannelRedirect: function(oldChannel, newChannel, flags, callback) {
        var result = this.ACCEPT;

        // If error thrown, the redirect will fail
        try {
            // skip internal redirects?
            /*if ( flags & 4 ) {
                console.log('internal redirect skipped');
                return;
            }*/

            var URI = newChannel.URI;

            if ( !URI.schemeIs('http') && !URI.schemeIs('https') ) {
                return;
            }

            if ( !(oldChannel instanceof Ci.nsIWritablePropertyBag) ) {
                return;
            }

            // TODO: what if a behind-the-scene request is being redirected?
            // This data is present only for tabbed requests, so if this throws,
            // the redirection won't be evaluated and canceled (if necessary)
            var channelData = oldChannel.getProperty(location.host + 'reqdata');

            if ( this.handlePopup(URI, channelData[1], channelData[2]) ) {
                result = this.ABORT;
                return;
            }

            var details = {
                type: channelData[0],
                tabId: channelData[1],
                frameId: channelData[3],
                parentFrameId: channelData[4]
            };

            if ( this.handleRequest(newChannel, URI, details) ) {
                result = this.ABORT;
                return;
            }

            // Carry the data on in case of multiple redirects
            if ( newChannel instanceof Ci.nsIWritablePropertyBag ) {
                newChannel.setProperty(location.host + 'reqdata', channelData);
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
        var lastRequest = httpObserver.lastRequest;
        lastRequest.url = details.url;
        lastRequest.type = details.type;
        lastRequest.tabId = vAPI.tabs.getTabId(e.target);
        lastRequest.frameId = details.frameId;
        lastRequest.parentFrameId = details.parentFrameId;
        lastRequest.openerURL = details.openerURL;
    };

    vAPI.messaging.globalMessageManager.addMessageListener(
        shouldLoadListenerMessageName,
        shouldLoadListener
    );

    httpObserver.register();

    cleanupTasks.push(function() {
        vAPI.messaging.globalMessageManager.removeMessageListener(
            shouldLoadListenerMessageName,
            shouldLoadListener
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

vAPI.toolbarButton.init = function() {
    try {
        var {CustomizableUI} = Cu.import('resource:///modules/CustomizableUI.jsm', null);
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

        updateTimer = setTimeout(resizePopup, 10);
    };
    var resizePopup = function() {
        updateTimer = null;
        var body = iframe.contentDocument.body;
        panel.parentNode.style.maxWidth = 'none';
        // https://github.com/gorhill/uBlock/issues/730
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

vAPI.toolbarButton.onCreated = function(button) {
    var platformVersion = Services.appinfo.platformVersion;

    if ( Services.vc.compare(platformVersion, '36.0') < 0 ) {
        return;
    }

    button.setAttribute('badge', '');
    button.classList.add('badged-button');

    setTimeout(function() {
        var badge = button.ownerDocument.getAnonymousElementByAttribute(
            button,
            'class',
            'toolbarbutton-badge'
        );

        if ( !badge ) {
            return;
        }

        badge.style.cssText = [
            'position: absolute;',
            'bottom: 0;',
            'right: 0;',
            'padding: 1px;',
            'background: #666;',
            'color: #fff;',
            'font-size: 9px;',
            'font-weight: bold;'
        ].join('');
    }, 1000);
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

vAPI.contextMenu.displayMenuItem = function(e) {
    var doc = e.target.ownerDocument;
    var gContextMenu = doc.defaultView.gContextMenu;

    if ( !gContextMenu.browser ) {
        return;
    }

    var menuitem = doc.getElementById(vAPI.contextMenu.menuItemId);
    var currentURI = gContextMenu.browser.currentURI;

    // https://github.com/gorhill/uBlock/issues/105
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
        var gContextMenu = this.ownerDocument.defaultView.gContextMenu;
        var details = {
            menuItemId: this.id
        };

        if ( gContextMenu.inFrame ) {
            details.tagName = 'iframe';
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

vAPI.lastError = function() {
    return null;
};

/******************************************************************************/

// This is called only once, when everything has been loaded in memory after
// the extension was launched. It can be used to inject content scripts
// in already opened web pages, to remove whatever nuisance could make it to
// the web pages before uBlock was ready.

vAPI.onLoadAllCompleted = function() {};

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

// clean up when the extension is disabled

window.addEventListener('unload', function() {
    for ( var cleanup of cleanupTasks ) {
        cleanup();
    }

    // frameModule needs to be cleared too
    var frameModule = {};
    Cu.import(vAPI.getURL('frameModule.js'), frameModule);
    frameModule.contentObserver.unregister();
    Cu.unload(vAPI.getURL('frameModule.js'));
});

/******************************************************************************/

})();

/******************************************************************************/

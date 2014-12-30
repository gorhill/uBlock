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

/* global Services, CustomizableUI */

// For background page

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu['import']('resource://gre/modules/Services.jsm');
Cu['import']('resource:///modules/CustomizableUI.jsm');

/******************************************************************************/

self.vAPI = self.vAPI || {};
vAPI.firefox = true;

/******************************************************************************/

// TODO: read these data from somewhere...
vAPI.app = {
    name: 'µBlock',
    version: '0.8.2.3'
};

/******************************************************************************/

vAPI.app.restart = function() {
    // Observing in bootstrap.js
    Services.obs.notifyObservers(null, location.host + '-restart', null);
};

/******************************************************************************/

// List of things that needs to be destroyed when disabling the extension
// Only functions should be added to it

vAPI.unload = [];

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

        vAPI.unload.push(function() {
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
            params = Array(params + 1).join('?, ').slice(0, -2);
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
    onTabClose: function(e) {
        var tabId = vAPI.tabs.getTabId(e.target);
        vAPI.tabs.onClosed(tabId);
        delete vAPI.tabIcons[tabId];
    },

    onTabSelect: function(e) {
        vAPI.setIcon(
            vAPI.tabs.getTabId(e.target),
            e.target.ownerDocument.defaultView
        );
    },

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

        this.gBrowser.addTabsProgressListener(tabsProgressListener);
        tC.addEventListener('TabClose', windowWatcher.onTabClose);
        tC.addEventListener('TabSelect', windowWatcher.onTabSelect);

        vAPI.toolbarButton.register(this.document);
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

var tabsProgressListener = {
    onLocationChange: function(browser, webProgress, request, location, flags) {
        if ( !webProgress.isTopLevel ) {
            return;
        }

        var tabId = vAPI.tabs.getTabId(browser);

        if ( flags & 1 ) {
            vAPI.tabs.onUpdated(tabId, {url: location.spec}, {
                frameId: 0,
                tabId: tabId,
                url: browser.currentURI.spec
            });
        } else {
            vAPI.tabs.onNavigation({
                frameId: 0,
                tabId: tabId,
                url: location.spec
            });
        }
    }
};

/******************************************************************************/

vAPI.tabs = {};

/******************************************************************************/

vAPI.tabs.registerListeners = function() {
    // onNavigation and onUpdated handled with tabsProgressListener
    // onClosed - handled in windowWatcher.onTabClose
    // onPopup ?

    for ( var win of this.getWindows() ) {
        windowWatcher.onReady.call(win);
    }

    Services.ww.registerNotification(windowWatcher);
    vAPI.toolbarButton.init();

    vAPI.unload.push(function() {
        Services.ww.unregisterNotification(windowWatcher);

        for ( var win of vAPI.tabs.getWindows() ) {
            vAPI.toolbarButton.unregister(win.document);
            vAPI.contextMenu.unregister(win.document);

            win.removeEventListener('DOMContentLoaded', windowWatcher.onReady);
            win.gBrowser.removeTabsProgressListener(tabsProgressListener);

            var tC = win.gBrowser.tabContainer;
            tC.removeEventListener('TabClose', windowWatcher.onTabClose);
            tC.removeEventListener('TabSelect', windowWatcher.onTabSelect);

            // close extension tabs
            for ( var tab of win.gBrowser.tabs ) {
                var URI = tab.linkedBrowser.currentURI;

                if ( URI.scheme === 'chrome' && URI.host === location.host ) {
                    win.gBrowser.removeTab(tab);
                }
            }
        }
    });
};

/******************************************************************************/

vAPI.tabs.getTabId = function(target) {
    if ( target.linkedPanel ) {
        return target.linkedPanel.slice(6);
    }

    var i, gBrowser = target.ownerDocument.defaultView.gBrowser;

    // This should be more efficient from version 35
    if ( gBrowser.getTabForBrowser ) {
        i = gBrowser.getTabForBrowser(target);
        return i ? i.linkedPanel.slice(6) : -1;
    }

    i = gBrowser.browsers.indexOf(target);

    if ( i !== -1 ) {
        i = gBrowser.tabs[i].linkedPanel.slice(6);
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
                'tab[linkedpanel="panel-' + tabId + '"]'
            );

            if ( tab ) {
                break;
            }
        }
    }

    // for internal use
    if ( tab && typeof callback !== 'function' ) {
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
        url: browser.currentURI.spec,
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
        var rgxHash = /#.*/;
        // this is questionable
        var url = details.url.replace(rgxHash, '');
        tabs = this.getAll();

        for ( tab of tabs ) {
            var browser = tab.linkedBrowser;

            if ( browser.currentURI.spec.replace(rgxHash, '') === url ) {
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

vAPI.tabs.close = function(tabIds) {
    if ( !Array.isArray(tabIds) ) {
        tabIds = [tabIds];
    }

    tabIds = tabIds.map(function(tabId) {
        return 'tab[linkedpanel="panel-' + tabId + '"]';
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

vAPI.tabs.injectScript = function(tabId, details, callback) {
    var tab = vAPI.tabs.get(tabId);

    if ( !tab ) {
        return;
    }

    if ( details.file ) {
        details.file = vAPI.getURL(details.file);
    }

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

vAPI.tabIcons = { /*tabId: {badge: 0, img: boolean}*/ };
vAPI.setIcon = function(tabId, iconStatus, badge) {
    // If badge is undefined, then setIcon was called from the TabSelect event
    var curWin = badge === undefined
        ? iconStatus
        : Services.wm.getMostRecentWindow('navigator:browser');
    var curTabId = vAPI.tabs.getTabId(curWin.gBrowser.selectedTab);

    // from 'TabSelect' event
    if ( tabId === undefined ) {
        tabId = curTabId;
    } else if ( badge !== undefined ) {
        vAPI.tabIcons[tabId] = {
            badge: badge,
            img: iconStatus === 'on'
        };
    }

    if ( tabId !== curTabId ) {
        return;
    }

    var button = curWin.document.getElementById(vAPI.toolbarButton.widgetId);

    if ( !button ) {
        return;
    }

    /*if ( !button.classList.contains('badged-button') ) {
        button.classList.add('badged-button');
    }*/

    var icon = vAPI.tabIcons[tabId];
    button.setAttribute('badge', icon && icon.badge || '');
    iconStatus = !button.image || !icon || !icon.img ? '-off' : '';
    button.image = vAPI.getURL('img/browsericons/icon16' + iconStatus + '.svg');
};

/******************************************************************************/

vAPI.toolbarButton = {
    widgetId: location.host + '-button',
    panelId: location.host + '-panel'
};

/******************************************************************************/

vAPI.toolbarButton.init = function() {
    CustomizableUI.createWidget({
        id: this.widgetId,
        type: 'view',
        viewId: this.panelId,
        defaultArea: CustomizableUI.AREA_NAVBAR,
        label: vAPI.app.name,
        tooltiptext: vAPI.app.name,
        onViewShowing: function({target}) {
            var hash = CustomizableUI.getWidget(vAPI.toolbarButton.widgetId)
                .areaType === CustomizableUI.TYPE_TOOLBAR ? '' : '#body';

            target.firstChild.setAttribute(
                'src',
                vAPI.getURL('popup.html' + hash)
            );
        },
        onViewHiding: function({target}) {
            target.firstChild.setAttribute('src', 'about:blank');
        }
    });

    this.closePopup = function({target}) {
        CustomizableUI.hidePanelForNode(
            target.ownerDocument.getElementById(vAPI.toolbarButton.panelId)
        );
    };

    vAPI.messaging.globalMessageManager.addMessageListener(
        location.host + ':closePopup',
        this.closePopup
    );

    vAPI.unload.push(function() {
        CustomizableUI.destroyWidget(vAPI.toolbarButton.widgetId);
        vAPI.messaging.globalMessageManager.removeMessageListener(
            location.host + ':closePopup',
            vAPI.toolbarButton.closePopup
        );
    });
};

/******************************************************************************/

// it runs with windowWatcher when a window is opened
// vAPI.tabs.registerListeners initializes it

vAPI.toolbarButton.register = function(doc) {
    var panel = doc.createElement('panelview');
    panel.setAttribute('id', this.panelId);

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

        updateTimer = setTimeout(resizePopup, 20);
    };

    var resizePopup = function() {
        var panelStyle = panel.style;
        var body = iframe.contentDocument.body;
        panelStyle.width = iframe.style.width = body.clientWidth + 'px';
        panelStyle.height = iframe.style.height = body.clientHeight + 'px';
        updateTimer = null;
    };

    var onPopupReady = function() {
        var win = this.contentWindow;

        if ( !win || win.location.host !== location.host ) {
            return;
        }

        new win.MutationObserver(delayedResize).observe(win.document, {
            childList: true,
            attributes: true,
            characterData: true,
            subtree: true
        });

        delayedResize();
    };

    iframe.addEventListener('load', onPopupReady, true);

    if ( !this.styleURI ) {
        this.styleURI = 'data:text/css,' + encodeURIComponent([
            '#' + this.widgetId + ' {',
                'list-style-image: url(',
                    vAPI.getURL('img/browsericons/icon16-off.svg'),
                ');',
            '}',
            '#' + this.widgetId + '[badge]:not([badge=""])::after {',
                'position: absolute;',
                'margin-left: -16px;',
                'margin-top: 3px;',
                'padding: 1px 2px;',
                'font-size: 9px;',
                'font-weight: bold;',
                'color: #fff;',
                'background: #666;',
                'content: attr(badge);',
            '}',
            '#' + this.panelId + ', #' + this.panelId + ' > iframe {',
                'width: 180px;',
                'height: 310px;',
                'overflow: hidden !important;',
            '}'
        ].join(''));

        this.styleURI = Services.io.newURI(this.styleURI, null, null);
    }

    doc.defaultView.QueryInterface(Ci.nsIInterfaceRequestor).
        getInterface(Ci.nsIDOMWindowUtils).loadSheet(this.styleURI, 1);
};

/******************************************************************************/

vAPI.toolbarButton.unregister = function(doc) {
    var panel = doc.getElementById(this.panelId);
    panel.parentNode.removeChild(panel);
    doc.defaultView.QueryInterface(Ci.nsIInterfaceRequestor).
        getInterface(Ci.nsIDOMWindowUtils).removeSheet(this.styleURI, 1);
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

    var listenerId = data.channelName.split('|');
    var requestId = data.requestId;
    var channelName = listenerId[1];
    listenerId = listenerId[0];

    var callback = vAPI.messaging.NOOPFUNC;
    if ( requestId !== undefined ) {
        callback = function(response) {
            var message = JSON.stringify({
                requestId: requestId,
                channelName: channelName,
                msg: response !== undefined ? response : null
            });

            if ( messageManager.sendAsyncMessage ) {
                messageManager.sendAsyncMessage(listenerId, message);
            } else {
                messageManager.broadcastAsyncMessage(listenerId, message);
            }
        };
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

    vAPI.unload.push(function() {
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

var httpObserver = {
    ABORT: Components.results.NS_BINDING_ABORTED,
    lastRequest: {
        url: null,
        type: null,
        tabId: null,
        frameId: null,
        parentFrameId: null
    },

    QueryInterface: (function() {
        var {XPCOMUtils} = Cu['import']('resource://gre/modules/XPCOMUtils.jsm', {});
        return XPCOMUtils.generateQI([
            Ci.nsIObserver,
            Ci.nsISupportsWeakReference
        ]);
    })(),

    register: function() {
        Services.obs.addObserver(httpObserver, 'http-on-opening-request', true);
        // Services.obs.addObserver(httpObserver, 'http-on-modify-request', true);
        Services.obs.addObserver(httpObserver, 'http-on-examine-response', true);
    },

    unregister: function() {
        Services.obs.removeObserver(httpObserver, 'http-on-opening-request');
        // Services.obs.removeObserver(httpObserver, 'http-on-modify-request');
        Services.obs.removeObserver(httpObserver, 'http-on-examine-response');
    },

    observe: function(httpChannel, topic) {
        // No need for QueryInterface if this check is performed?
        if ( !(httpChannel instanceof Ci.nsIHttpChannel) ) {
            return;
        }

        var URI = httpChannel.URI, tabId, result;

        if ( topic === 'http-on-modify-request' ) {
            // var onHeadersReceived = vAPI.net.onHeadersReceived;

            return;
        }

        if ( topic === 'http-on-examine-request' ) {
            try {
                tabId = httpChannel.getProperty('tabId');
            } catch (ex) {
                return;
            }

            if ( !tabId ) {
                return;
            }

            topic = 'Content-Security-Policy';

            try {
                result = httpChannel.getResponseHeader(topic);
            } catch (ex) {
                result = null;
            }

            result = vAPI.net.onHeadersReceived.callback({
                url: URI.spec,
                tabId: tabId,
                parentFrameId: -1,
                responseHeaders: result ? [{name: topic, value: result}] : []
            });

            if ( result ) {
                httpChannel.setResponseHeader(
                    topic,
                    result.responseHeaders.pop().value,
                    true
                );
            }

            return;
        }

        // http-on-opening-request

        var lastRequest = this.lastRequest;

        if ( !lastRequest.url || lastRequest.url !== URI.spec ) {
            lastRequest.url = null;
            return;
        }

        // Important! When loading file via XHR for mirroring,
        // the URL will be the same, so it could fall into an infinite loop
        lastRequest.url = null;

        if ( lastRequest.type === 'main_frame'
            && httpChannel instanceof Ci.nsIWritablePropertyBag ) {
            httpChannel.setProperty('tabId', lastRequest.tabId);
        }

        var onBeforeRequest = vAPI.net.onBeforeRequest;

        if ( !onBeforeRequest.types.has(lastRequest.type) ) {
            return;
        }

        result = onBeforeRequest.callback({
            url: URI.spec,
            type: lastRequest.type,
            tabId: lastRequest.tabId,
            frameId: lastRequest.frameId,
            parentFrameId: lastRequest.parentFrameId
        });

        if ( !result || typeof result !== 'object' ) {
            return;
        }

        if ( result.cancel === true ) {
            httpChannel.cancel(this.ABORT);
        } else if ( result.redirectUrl ) {
            httpChannel.redirectionLimit = 1;
            httpChannel.redirectTo(
                Services.io.newURI(result.redirectUrl, null, null)
            );
        }
    }
};

/******************************************************************************/

vAPI.net = {};

/******************************************************************************/

vAPI.net.registerListeners = function() {
    var typeMap = {
        2: 'script',
        3: 'image',
        4: 'stylesheet',
        5: 'object',
        6: 'main_frame',
        7: 'sub_frame',
        11: 'xmlhttprequest'
    };

    this.onBeforeRequest.types = new Set(this.onBeforeRequest.types);

    var shouldLoadListenerMessageName = location.host + ':shouldLoad';
    var shouldLoadListener = function(e) {
        var lastRequest = httpObserver.lastRequest;
        lastRequest.url = e.data.url;
        lastRequest.type = typeMap[e.data.type] || 'other';
        lastRequest.tabId = vAPI.tabs.getTabId(e.target);
        lastRequest.frameId = e.data.frameId;
        lastRequest.parentFrameId = e.data.parentFrameId;
    };

    vAPI.messaging.globalMessageManager.addMessageListener(
        shouldLoadListenerMessageName,
        shouldLoadListener
    );

    httpObserver.register();

    vAPI.unload.push(function() {
        vAPI.messaging.globalMessageManager.removeMessageListener(
            shouldLoadListenerMessageName,
            shouldLoadListener
        );

        httpObserver.unregister();
    });
};

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
    var menuitem = doc.getElementById(vAPI.contextMenu.menuItemId);

    if ( /^https?$/.test(gContextMenu.browser.currentURI.scheme) === false) {
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
            menuItemId: this.id,
            tagName: gContextMenu.target.tagName.toLowerCase()
        };

        if ( gContextMenu.inFrame ) {
            details.frameUrl = gContextMenu.focusedWindow.location.href;
        } else if ( gContextMenu.onImage || gContextMenu.onAudio || gContextMenu.onVideo ) {
            details.srcUrl = gContextMenu.mediaURL;
        } else if ( gContextMenu.onLink ) {
            details.linkUrl = gContextMenu.linkURL;
        }

        callback(details, {
            id: vAPI.tabs.getTabId(gContextMenu.browser),
            url: gContextMenu.browser.currentURI.spec
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

// clean up when the extension is disabled

window.addEventListener('unload', function() {
    for ( var unload of vAPI.unload ) {
        unload();
    }

    // frameModule needs to be cleared too
    var frameModule = {};
    Cu['import'](vAPI.getURL('frameModule.js'), frameModule);
    frameModule.contentPolicy.unregister();
    frameModule.docObserver.unregister();
    Cu.unload(vAPI.getURL('frameModule.js'));
});

/******************************************************************************/

})();

/******************************************************************************/

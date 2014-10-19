// for background page only

(function() {
'use strict';

window.vAPI = window.vAPI || {};

if (window.chrome) {
    var chrome = window.chrome;

    vAPI.chrome = true;

    vAPI.storage = chrome.storage.local;

    vAPI.tabs = {
        registerListeners: function() {
            if (typeof this.onNavigation === 'function') {
             chrome.webNavigation.onCommitted.addListener(this.onNavigation);
            }

            if (typeof this.onUpdated === 'function') {
                chrome.tabs.onUpdated.addListener(this.onUpdated);
            }

            if (typeof this.onClosed === 'function') {
                chrome.tabs.onRemoved.addListener(this.onClosed);
            }

            if (typeof this.onPopup === 'function') {
                chrome.webNavigation.onCreatedNavigationTarget.addListener(this.onPopup);
            }
        },
        get: function(tabId, callback) {
            if (tabId === null) {
                chrome.tabs.query(
                    {
                        active: true,
                        currentWindow: true
                    },
                    function(tabs) {
                        callback(tabs[0]);
                    }
                );
            }
            else {
                chrome.tabs.get(tabId, callback);
            }
        },
        /*open: function(details) {
            // to keep incognito context?
            chrome.windows.getCurrent(function(win) {
                details.windowId = win.windowId;
                chrome.tabs.create(details);
            });
        },*/
        open: function(details) {
            if (!details.url) {
                return null;
            }
            // extension pages
            else if (!details.url.match(/^\w{2,20}:/)) {
                details.url = vAPI.getURL(details.url);
            }

            // dealing with Chrome's asynhronous API
            var wrapper = function() {
                if (details.active === undefined) {
                    details.active = true;
                }

                var subWrapper = function() {
                    var _details = {
                        url: details.url,
                        active: !!details.active
                    };

                    if (details.tabId) {
                        // update doesn't accept index, must use move
                        chrome.tabs.update(details.tabId, _details, function(tab) {
                            // if the tab doesn't exist
                            if (chrome.runtime.lastError) {
                                chrome.tabs.create(_details);
                            }
                            else if (details.index !== undefined) {
                                chrome.tabs.move(tab.id, {index: details.index});
                            }
                        });
                    }
                    else {
                        if (details.index !== undefined) {
                            _details.index = details.index;
                        }

                        chrome.tabs.create(_details);
                    }
                };

                if (details.index === -1) {
                    vAPI.tabs.get(null, function(tab) {
                        if (tab) {
                            details.index = tab.index + 1;
                        }
                        else {
                            delete details.index;
                        }

                        subWrapper();
                    });
                }
                else {
                    subWrapper();
                }
            };

            if (details.select) {
                // note that currentWindow may be even the window of Developer Tools
                // so, test with setTimeout...
                chrome.tabs.query({currentWindow: true}, function(tabs) {
                    var url = details.url.replace(rgxHash, '');
                    // this is questionable
                    var rgxHash = /#.*/;

                    tabs = tabs.some(function(tab) {
                        if (tab.url.replace(rgxHash, '') === url) {
                            chrome.tabs.update(tab.id, {active: true});
                            return true;
                        }
                    });

                    if (!tabs) {
                        wrapper();
                    }
                });
            }
            else {
                wrapper();
            }
        },
        close: chrome.tabs.remove.bind(chrome.tabs)
    };

    // Must read: https://code.google.com/p/chromium/issues/detail?id=410868#c8

    // https://github.com/gorhill/uBlock/issues/19
    // https://github.com/gorhill/uBlock/issues/207
    // Since we may be called asynchronously, the tab id may not exist
    // anymore, so this ensures it does still exist.

    vAPI.setIcon = function(tabId, img, badge) {
        var onIconReady = function() {
            if ( chrome.runtime.lastError ) {
                return;
            }

            chrome.browserAction.setBadgeText({ tabId: tabId, text: badge });

            if ( badge !== '' ) {
                chrome.browserAction.setBadgeBackgroundColor({ tabId: tabId, color: '#666' });
            }
        };
        chrome.browserAction.setIcon({ tabId: tabId, path: img }, onIconReady);
    };

    vAPI.messaging = {
        ports: {},
        listeners: {},
        listen: function(name, callback) {
            this.listeners[name] = callback;
        },
        setup: function(connector) {
            if (this.connector) {
                return;
            }

            this.connector = function(port) {
                var onMessage = function(request) {
                    var callback = function(response) {
                        // stfu
                        if (chrome.runtime.lastError) {
                            return;
                        }

                        if (request.requestId) {
                            port.postMessage({
                                requestId: request.requestId,
                                portName: request.portName,
                                msg: response
                            });
                        }
                    };

                    var listener = connector(request.msg, port.sender, callback);

                    if (listener === null) {
                        listener = vAPI.messaging.listeners[request.portName];

                        if (typeof listener === 'function') {
                            listener(request.msg, port.sender, callback);
                        } else {
                            console.error('µBlock> messaging > unknown request: %o', request);
                        }
                    }
                };

                var onDisconnect = function(port) {
                    port.onDisconnect.removeListener(onDisconnect);
                    port.onMessage.removeListener(onMessage);
                    delete vAPI.messaging.ports[port.name];
                };

                port.onDisconnect.addListener(onDisconnect);
                port.onMessage.addListener(onMessage);
                vAPI.messaging.ports[port.name] = port;
            };

            chrome.runtime.onConnect.addListener(this.connector);
        },
        broadcast: function(message) {
            message = {
                broadcast: true,
                msg: message
            };

            for (var portName in this.ports) {
                this.ports[portName].postMessage(message);
            }
        }
    };

    vAPI.net = {
        registerListeners: function() {
            var listeners = [
                'onBeforeRequest',
                'onBeforeSendHeaders',
                'onHeadersReceived'
            ];

            for (var i = 0; i < listeners.length; ++i) {
                chrome.webRequest[listeners[i]].addListener(
                    this[listeners[i]].callback,
                    {
                        'urls': this[listeners[i]].urls || ['<all_urls>'],
                        'types': this[listeners[i]].types || []
                    },
                    this[listeners[i]].extra
                );
            }
        }
    };

    vAPI.contextMenu = {
        create: function(details, callback) {
            this.menuId = details.id;
            this.callback = callback;
            chrome.contextMenus.create(details);
            chrome.contextMenus.onClicked.addListener(this.callback);
        },
        remove: function() {
            chrome.contextMenus.onClicked.removeListener(this.callback);
            chrome.contextMenus.remove(this.menuId);
        }
    };
} else if (window.safari) {
    vAPI.safari = true;

    vAPI.storage = {
        _storage: safari.extension.settings,
        QUOTA_BYTES: 52428800, // copied from Info.plist
        get: function(keys, callback) {
            if (typeof callback !== 'function') {
                return;
            }

            var i, value, result = {};

            if (keys === null) {
                for (i in this._storage) {
                    value = this._storage[i];

                    if (typeof value === 'string') {
                        result[i] = JSON.parse(value);
                    }
                }
            }
            else if (typeof keys === 'string') {
                value = this._storage[keys];

                if (typeof value === 'string') {
                    result[keys] = JSON.parse(value);
                }
            }
            else if (Array.isArray(keys)) {
                for ( i = 0; i < keys.length; ++i) {
                    value = this._storage[i];

                    if (typeof value === 'string') {
                        result[keys[i]] = JSON.parse(value);
                    }
                }
            }
            else if (typeof keys === 'object') {
                for (i in keys) {
                    value = this._storage[i];

                    if (typeof value === 'string') {
                        result[i] = JSON.parse(value);
                    }
                    else {
                        result[i] = keys[i];
                    }
                }
            }

            callback(result);
        },
        set: function(details, callback) {
            for (var key in details) {
                this._storage.setItem(key, JSON.stringify(details[key]));
            }

            if (typeof callback === 'function') {
                callback();
            }
        },
        remove: function(keys) {
            if (typeof keys === 'string') {
                keys = [keys];
            }

            for (var i = 0; i < keys.length; ++i) {
                this._storage.removeItem(keys[i]);
            }
        },
        clear: function(callback) {
            this._storage.clear();
            callback();
        },
        getBytesInUse: function(keys, callback) {
            var key, size = 0;

            if (keys === null) {
                for (key in this._storage) {
                    size += (this._storage[key] || '').length;
                }
            }
            else {
                if (typeof keys === 'string') {
                    keys = [keys];
                }

                for (key = 0; key < keys.length; ++key) {
                    size += (this._storage[keys[key]] || '').length;
                }
            }

            callback(size);
        }
    };

    vAPI.tabs = {
        stack: {},
        stackID: 1,
        registerListeners: function() {
            var onNavigation = this.onNavigation;

            if (typeof onNavigation === 'function') {
                this.onNavigation = function(e) {
                    // e.url is not present for local files or data URIs
                    if (!e.target || !e.target.url) {
                        return;
                    }

                    onNavigation({
                        frameId: 0,
                        tabId: vAPI.tabs.getTabId(e.target),
                        url: e.target.url
                    });
                };

                safari.application.addEventListener('navigate', this.onNavigation, true);
            }

            // ??
            /*if (typeof onUpdated === 'function') {
                chrome.tabs.onUpdated.addListener(this.onUpdated);
            }*/

            // onClosed handled in the main tab-close event

            // maybe intercept window.open on web-pages?
            /*if (typeof onPopup === 'function') {
                chrome.webNavigation.onCreatedNavigationTarget.addListener(this.onPopup);
            }*/
        },
        getTabId: function(tab) {
            for (var i in vAPI.tabs.stack) {
                if (vAPI.tabs.stack[i] === tab) {
                    return +i;
                }
            }

            return -1;
        },
        get: function(tabId, callback) {
            var tab;

            if (tabId === null) {
                tab = safari.application.activeBrowserWindow.activeTab;
                tabId = this.getTabId(tab);
            }
            else {
                tab = this.stack[tabId];
            }

            if (!tab) {
                callback();
                return;
            }

            callback({
                id: tabId,
                index: tab.browserWindow.tabs.indexOf(tab),
                windowId: safari.application.browserWindows.indexOf(tab.browserWindow),
                active: tab === tab.browserWindow.activeTab,
                url: tab.url,
                title: tab.title
            });
        },
        open: function(details) {
            if (!details.url) {
                return null;
            }
            // extension pages
            else if (!details.url.match(/^\w{2,20}:/)) {
                details.url = vAPI.getURL(details.url);
            }

            // properties of the details object:
                // url: 'URL', // the address that will be opened
                // tabId: 1, // the tab is used if set, instead of creating a new one
                // index: -1, // undefined: end of the list, -1: following tab, or after index
                // active: false, // opens the tab in background - true and undefined: foreground
                // select: true // if a tab is already opened with that url, then select it instead of opening a new one

            var curWin, tab;

            if (details.select) {
                tab = safari.application.browserWindows.some(function(win) {
                    var rgxHash = /#.*/;
                    // this is questionable
                    var url = details.url.replace(rgxHash, '');

                    for (var i = 0; i < win.tabs.length; ++i) {
                        if (win.tabs[i].url.replace(rgxHash, '') === url) {
                            win.tabs[i].activate();
                            return true;
                        }
                    }
                });

                if (tab) {
                    return;
                }
            }

            if (details.active === undefined) {
                details.active = true;
            }

            curWin = safari.application.activeBrowserWindow;

            // it must be calculated before opening a new tab,
            // otherwise the new tab will be the active tab here
            if (details.index === -1) {
                details.index = curWin.tabs.indexOf(curWin.activeTab) + 1;
            }

            tab = details.tabId && this.stack[details.tabId]
                || curWin.openTab(details.active ? 'foreground' : 'background');

            if (details.index !== undefined) {
                curWin.insertTab(tab, details.index);
            }

            tab.url = details.url;
        },
        close: function(tab) {
            if (!(tab instanceof SafariBrowserTab)) {
                tab = this.stack[tab];
            }

            if (tab) {
                tab.close();
            }
        }
    };


    // bind tabs to unique IDs
    (function() {
        var wins = safari.application.browserWindows, i = wins.length, j;
        var tabs = [];

        while (i--) {
            j = wins[i].tabs.length;

            while (j--) {
                tabs.push(wins[i].tabs[j]);
            }
        }

        return tabs;
    })().forEach(function(tab) {
        vAPI.tabs.stack[vAPI.tabs.stackID++] = tab;
    });

    safari.application.addEventListener('open', function(e) {
        // ignore windows
        if (e.target instanceof SafariBrowserTab) {
            vAPI.tabs.stack[vAPI.tabs.stackID++] = e.target;
        }
    }, true);

    safari.application.addEventListener('close', function(e) {
        // ignore windows
        if (!(e.target instanceof SafariBrowserTab)) {
            return;
        }

        var tabId = vAPI.tabs.getTabId(e.target);

        if (tabId > -1) {
            // to not add another listener, put this here
            // instead of vAPI.tabs.registerListeners
            if (typeof vAPI.tabs.onClosed === 'function') {
                vAPI.tabs.onClosed(tabId);
            }

            delete vAPI.tabIcons[tabId];
            delete vAPI.tabs.stack[tabId];
        }
    }, true);


    // update badge when tab is activated
    safari.application.addEventListener('activate', function(e) {
        // hide popover, since in some cases won't close by itself
        var items = safari.extension.toolbarItems;

        for (var i = 0; i < items.length; ++i) {
            if (items[i].browserWindow === safari.application.activeBrowserWindow) {
                if (items[i].popover) {
                    items[i].popover.hide();
                }

                break;
            }
        }

        // ignore windows
        if (!(e.target instanceof SafariBrowserTab)) {
            return;
        }

        // update the badge, when tab is selected
        vAPI.setIcon();
    }, true);

    // reload the popup when that is opened
    safari.application.addEventListener('popover', function(e) {
        e.target.contentWindow.document.body.textContent = '';
        e.target.contentWindow.location.reload();
    }, true);

    vAPI.tabIcons = { /*tabId: {badge: 0, img: dict}*/ };
    vAPI.setIcon = function(tabId, img, badge) {
        var curTabId = vAPI.tabs.getTabId(safari.application.activeBrowserWindow.activeTab);

        // from 'activate' event
        if (tabId === undefined) {
            tabId = curTabId;
        }
        else {
            vAPI.tabIcons[tabId] = {
                badge: badge || 0/*,
                img: img*/
            };
        }

        // if the selected tab has the same ID, then update the badge too,
        // or always update it when changing tabs ('activate' event)
        if (tabId === curTabId) {
            var items = safari.extension.toolbarItems, i = items.length;

            while (i--) {
                if (items[i].browserWindow === safari.application.activeBrowserWindow) {
                    if (vAPI.tabIcons[tabId]) {
                        items[i].badge = vAPI.tabIcons[tabId].badge;
                        // items[i].img = vAPI.tabIcons[tabId].img;
                    }
                    else {
                        items[i].badge = 0;
                    }

                    return;
                }
            }
        }
    };

    vAPI.messaging = {
        listeners: {},
        listen: function(name, callback) {
            this.listeners[name] = callback;
        },
        setup: function(connector) {
            if (this.connector) {
                return;
            }

            this.connector = function(request) {
                if (request.name === 'canLoad') {
                    return;
                }

                var callback = function(response) {
                    if (request.message.requestId) {
                        request.target.page.dispatchMessage(
                            'message',
                            {
                                requestId: request.message.requestId,
                                portName: request.message.portName,
                                msg: response
                            }
                        );
                    }
                };

                var sender = {
                    tab: {
                        id: vAPI.tabs.getTabId(request.target)
                    }
                };

                var listener = connector(request.message.msg, sender, callback);

                if (listener === null) {
                    listener = vAPI.messaging.listeners[request.message.portName];

                    if (typeof listener === 'function') {
                        listener(request.message.msg, sender, callback);
                    } else {
                        console.error('µBlock> messaging > unknown request: %o', request.message);
                    }
                }
            };

            safari.application.addEventListener('message', this.connector, false);
        },
        broadcast: function(message) {
            message = {
                broadcast: true,
                msg: message
            };

            for (var tabId in vAPI.tabs.stack) {
                vAPI.tabs.stack[tabId].page.dispatchMessage('message', message);
            }
        }
    };

    vAPI.net = {
        registerListeners: function() {
            // onBeforeRequest is used in the messaging above, in the connector method
            // in order to use only one listener
            var onBeforeRequest = this.onBeforeRequest;

            if (typeof onBeforeRequest.callback === 'function') {
                if (!Array.isArray(onBeforeRequest.types)) {
                    onBeforeRequest.types = [];
                }

                onBeforeRequest = onBeforeRequest.callback;
                this.onBeforeRequest.callback = function(request) {
                    if (request.name !== 'canLoad') {
                        return;
                    }

                    // no stopPropagation if it was called from beforeNavigate event
                    if (request.stopPropagation) {
                        request.stopPropagation();
                    }

                    var block = vAPI.net.onBeforeRequest;

                    if (block.types.indexOf(request.message.type) < 0) {
                        return;
                    }

                    request.message.tabId = vAPI.tabs.getTabId(request.target);
                    block = onBeforeRequest(request.message);

                    // truthy return value will allow the request,
                    // except when redirectUrl is present
                    if (block && typeof block === 'object') {
                        if (block.cancel) {
                            request.message = false;
                        }
                        else if (typeof block.redirectUrl === "string") {
                            request.message = block.redirectUrl;
                        }
                        else {
                            request.message = true;
                        }
                    }
                    else {
                        request.message = true;
                    }

                    return request.message;
                };
                safari.application.addEventListener('message', this.onBeforeRequest.callback, true);

                // 'main_frame' simulation, since this isn't available in beforeload
                safari.application.addEventListener('beforeNavigate', function(e) {
                    // e.url is not present for local files or data URIs
                    if (!e.url) {
                        return;
                    }

                    vAPI.net.onBeforeRequest.callback({
                        name: 'canLoad',
                        target: e.target,
                        message: {
                            url: e.url,
                            type: 'main_frame',
                            frameId: 0,
                            parentFrameId: -1,
                            timeStamp: e.timeStamp
                        }
                    }) || e.preventDefault();
                }, true);
            }
        }
    };

    vAPI.contextMenu = {
        create: function(details, callback) {
            var contexts = details.contexts;
            var menuItemId = details.id;
            var menuTitle = details.title;

            if (Array.isArray(contexts) && contexts.length) {
                contexts = contexts.indexOf('all') === -1 ? contexts : null;
            }
            else {
                // default in Chrome
                contexts = ['page'];
            }

            this.onContextMenu = function(e) {
                var uI = e.userInfo;

                if (uI && /^https?:\/\//i.test(uI.pageUrl)) {
                    if (contexts) {
                        var invalidContext = true;

                        for (var i = 0; i < contexts.length; ++i) {
                            if (contexts[i] === 'frame') {
                                if (uI.insideFrame) {
                                    invalidContext = false;
                                    break;
                                }
                            }
                            else if (contexts[i] === 'link') {
                                if (uI.linkHref) {
                                    invalidContext = false;
                                    break;
                                }
                            }
                            else if (contexts[i] === 'image') {
                                if (uI.srcUrl) {
                                    invalidContext = false;
                                    break;
                                }
                            }
                            else if (contexts[i] === 'audio' || contexts[i] === 'video') {
                                if (uI.srcUrl && uI.tagName === contexts[i]) {
                                    invalidContext = false;
                                    break;
                                }
                            }
                            else if (contexts[i] === 'editable') {
                                if (uI.editable) {
                                    invalidContext = false;
                                    break;
                                }
                            }
                            else if (contexts[i] === 'page') {
                                if (!(uI.insideFrame || uI.linkHref || uI.mediaType || uI.editable)) {
                                    invalidContext = false;
                                    break;
                                }
                            }
                        }

                        if (invalidContext) {
                            return;
                        }
                    }

                    e.contextMenu.appendContextMenuItem(menuItemId, menuTitle);
                }
            };

            this.onContextMenuCommand = function(e) {
                if (e.command === menuItemId) {
                    var tab = e.currentTarget.activeBrowserWindow.activeTab;
                    e.userInfo.menuItemId = menuItemId;
                    callback(e.userInfo, tab ? {
                        id: vAPI.tabs.getTabId(tab),
                        url: tab.url
                    } : undefined);
                }
            };

            safari.application.addEventListener('contextmenu', this.onContextMenu);
            safari.application.addEventListener("command", this.onContextMenuCommand);
        },
        remove: function(argument) {
            safari.application.removeEventListener('contextmenu', this.onContextMenu);
            safari.application.removeEventListener("command", this.onContextMenuCommand);
            this.onContextMenu = null;
            this.onContextMenuCommand = null;
        }
    };
}

if (!window.chrome) {
    window.chrome = { runtime: { lastError: null } };
}
})();

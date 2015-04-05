/*******************************************************************************

    uBlock - a browser extension to block requests.
    Copyright (C) 2015 The uBlock authors

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

/* global self, safari, SafariBrowserTab, µBlock */

// For background page

/******************************************************************************/


(function() {

    "use strict";

    var vAPI = self.vAPI = self.vAPI || {};
 
    vAPI.isMainProcess = true;
    vAPI.safari = true;

    /******************************************************************************/

    vAPI.app = {
        name: "uBlock",
        version: safari.extension.displayVersion
    };

    /******************************************************************************/

    if(navigator.userAgent.indexOf("Safari/6") === -1) { // If we're not on at least Safari 8
        var _open = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(m, u) {
            if(u.lastIndexOf("safari-extension:", 0) === 0) {
                var i = u.length, seeDot = false;
                while(i --) {
                    if(u[i] === ".") {
                        seeDot = true;
                    }
                    else if(u[i] === "/") {
                        break;
                    }
                }
                if(seeDot === false) {
                    throw 'InvalidAccessError'; // Avoid crash
                    return;
                }
            }
            _open.apply(this, arguments);
        };
    }
    /******************************************************************************/

    vAPI.app.restart = function() {
        µBlock.restart();
    };

    /******************************************************************************/

    safari.extension.addContentScriptFromURL(vAPI.getURL("js/subscriber.js"), [
        "https://*.adblockplus.org/*",
        "https://*.adblockplus.me/*",
        "https://www.fanboy.co.nz/*",
        "http://*.adblockplus.org/*",
        "http://*.adblockplus.me/*",
        "http://www.fanboy.co.nz/*"
    ], [], true);

    /******************************************************************************/

    safari.extension.settings.addEventListener('change', function(e) {
        if(e.key === 'open_prefs') {
            vAPI.tabs.open({
                url: 'dashboard.html',
                active: true
            });
        }
    }, false);

    /******************************************************************************/

    initStorageLib(); // Initialize storage library
    
    /******************************************************************************/

    var storageQuota = 104857600; // copied from Info.plist
    localforage.config({
        name: "ublock",
        size: storageQuota,
        storeName: "keyvaluepairs"
    });
    var oldSettings = safari.extension.settings; // To smoothly transition users
    if(oldSettings.hasOwnProperty("version")) { // Old 'storage'!
        for(var key in oldSettings) {
            if(!oldSettings.hasOwnProperty(key) || key === "open_prefs") {
                continue;
            }
            localforage.setItem(key, oldSettings[key]);
        }
        oldSettings.clear();
    }
    vAPI.storage = {
        QUOTA_BYTES: storageQuota, // copied from Info.plist

        get: function(keys, callback) {
            if(typeof callback !== "function") {
                return;
            }
            
            var result = {};

            if(keys === null) {
                localforage.iterate(function(value, key) {
                    if(typeof value === "string") {
                        result[key] = JSON.parse(value);
                    }
                }, function() {
                    callback(result);
                });
            }
            else if(typeof keys === "string") {
                localforage.getItem(keys, function(err, value) {
                    if(typeof value === "string") {
                        result[keys] = JSON.parse(value);
                    }
                    callback(result);
                });
            }
            else if(Array.isArray(keys)) {
                var toSatisfy = keys.length, n = toSatisfy;
                if(n === 0) {
                    callback(result);
                    return;
                }
                for(var i = 0; i < n; i++) {
                    var key = keys[i];
                    var func = function(err, value) {
                        toSatisfy--;
                        if(typeof value === "string") {
                            result[arguments.callee.myKey] = JSON.parse(value);
                        }
                        if(toSatisfy === 0) {
                            callback(result);
                        }
                    };
                    func.myKey = key;
                    localforage.getItem(key, func);
                }
            }
            else if(typeof keys === "object") {
                for(var key in keys) {
                    if(!keys.hasOwnProperty(key)) {
                        continue;
                    }
                    result[key] = keys[key];
                }
                localforage.iterate(function(value, key) {
                    if(!keys.hasOwnProperty(key)) return;
                    if(typeof value === "string") {
                        result[key] = JSON.parse(value);
                    }
                }, function() {
                    callback(result);
                });
            }
        },

        set: function(details, callback) {
            var toSatisfy = 0;
            for(var key in details) {
                if(!details.hasOwnProperty(key)) {
                    continue;
                }
                toSatisfy++;
            }
            for(var key in details) {
                if(!details.hasOwnProperty(key)) {
                    continue;
                }
                localforage.setItem(key, JSON.stringify(details[key]), function() {
                    if(--toSatisfy === 0) {
                        callback && callback();
                    }
                });
            }
        },

        remove: function(keys) {
            if(typeof keys === "string") {
                keys = [keys];
            }

            for(var i = 0, n = keys.length; i < n; i++) {
                localforage.removeItem(keys[i]);
            }
        },

        clear: function(callback) {
            localforage.clear(function() {
                callback();
            });
        },

        getBytesInUse: function(keys, callback) {
            if(typeof callback !== "function") {
                return;
            }
            var size = 0;
            localforage.iterate(function(value, key) {
                size += (value || "").length;
            }, function() {
                callback(size);
            });
        }
    };

    /******************************************************************************/

    vAPI.tabs = {
        stack: {},
        stackId: 1
    };

    /******************************************************************************/

    vAPI.isBehindTheSceneTabId = function(tabId) {
        return tabId.toString() === this.noTabId;
    };

    vAPI.noTabId = '-1';

    /******************************************************************************/

    vAPI.tabs.registerListeners = function() {
        safari.application.addEventListener("beforeNavigate", function(e) {
            if(!vAPI.tabs.popupCandidate || !e.target || e.url === "about:blank") {
                return;
            }
            var url = e.url,
                tabId = vAPI.tabs.getTabId(e.target);
            var details = {
                targetURL: url,
                targetTabId: tabId,
                openerTabId: vAPI.tabs.popupCandidate
            };
            if(vAPI.tabs.onPopup(details)) {
                e.preventDefault();
                if(vAPI.tabs.stack[details.openerTabId]) {
                    vAPI.tabs.stack[details.openerTabId].activate();
                }
            }
        }, true);
        // onClosed handled in the main tab-close event
        // onUpdated handled via monitoring the history.pushState on web-pages
        // onPopup is handled in window.open on web-pages
    };

    /******************************************************************************/

    vAPI.tabs.getTabId = function(tab) {
        if(typeof tab.uBlockCachedID !== "undefined") {
            return tab.uBlockCachedID;
        }
        for(var i in vAPI.tabs.stack) {
            if(vAPI.tabs.stack[i] === tab) {
                return (tab.uBlockCachedID = +i);
            }
        }

        return -1;
    };

    /******************************************************************************/

    vAPI.tabs.get = function(tabId, callback) {
        var tab;

        if(tabId === null) {
            tab = safari.application.activeBrowserWindow.activeTab;
            tabId = this.getTabId(tab);
        } else {
            tab = this.stack[tabId];
        }

        if(!tab) {
            callback();
            return;
        }

        callback({
            id: tabId,
            index: tab.browserWindow.tabs.indexOf(tab),
            windowId: safari.application.browserWindows.indexOf(tab.browserWindow),
            active: tab === tab.browserWindow.activeTab,
            url: tab.url || "about:blank",
            title: tab.title
        });
    };

    /******************************************************************************/

    // properties of the details object:
    //   url: 'URL', // the address that will be opened
    //   tabId: 1, // the tab is used if set, instead of creating a new one
    //   index: -1, // undefined: end of the list, -1: following tab, or after index
    //   active: false, // opens the tab in background - true and undefined: foreground
    //   select: true // if a tab is already opened with that url, then select it instead of opening a new one

    vAPI.tabs.open = function(details) {
        if(!details.url) {
            return null;
        }
        // extension pages
        if(/^[\w-]{2,}:/.test(details.url) === false) {
            details.url = vAPI.getURL(details.url);
        }

        var curWin, tab;

        if(details.select) {
            tab = safari.application.browserWindows.some(function(win) {
                var rgxHash = /#.*/;
                // this is questionable
                var url = details.url.replace(rgxHash, '');

                for(var i = 0; i < win.tabs.length; i++) {
                    // Some tabs don't have a URL
                    if(win.tabs[i].url &&
                       win.tabs[i].url.replace(rgxHash, '') === url) {
                        win.tabs[i].activate();
                        return true;
                    }
                }
            });

            if(tab) {
                return;
            }
        }

        if(details.active === undefined) {
            details.active = true;
        }

        curWin = safari.application.activeBrowserWindow;

        // it must be calculated before opening a new tab,
        // otherwise the new tab will be the active tab here
        if(details.index === -1) {
            details.index = curWin.tabs.indexOf(curWin.activeTab) + 1;
        }

        tab = (details.tabId ? this.stack[details.tabId] : curWin.openTab(details.active ? 'foreground' : 'background'));

        if(details.index !== undefined) {
            curWin.insertTab(tab, details.index);
        }

        tab.url = details.url;
    };

    /******************************************************************************/

    // Replace the URL of a tab. Noop if the tab does not exist.

    vAPI.tabs.replace = function(tabId, url) {
        var targetURL = url;

        // extension pages
        if ( /^[\w-]{2,}:/.test(targetURL) !== true ) {
            targetURL = vAPI.getURL(targetURL);
        }

        var tab = this.stack[tabId];
        if ( tab ) {
            tab.url = targetURL;
        }
    };

    /******************************************************************************/

    vAPI.tabs.remove = function(tabIds) {
        if(tabIds instanceof SafariBrowserTab) {
            tabIds = this.getTabId(tabIds);
        }

        if(!Array.isArray(tabIds)) {
            tabIds = [tabIds];
        }

        for(var i = 0; i < tabIds.length; i++) {
            if(this.stack[tabIds[i]]) {
                this.stack[tabIds[i]].close();
            }
        }
    };

    /******************************************************************************/

    vAPI.tabs.reload = function(tabId) {
        var tab = this.stack[tabId];

        if(tab) {
            tab.url = tab.url;
        }
    };

    /******************************************************************************/

    vAPI.tabs.injectScript = function(tabId, details, callback) {
        var tab;

        if(tabId) {
            tab = this.stack[tabId];
        } else {
            tab = safari.application.activeBrowserWindow.activeTab;
        }

        if(details.file) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', details.file, true);
            xhr.addEventListener("readystatechange", function() {
                if(this.readyState === 4) {
                    details.code = xhr.responseText;
                    tab.page.dispatchMessage('broadcast', {
                        channelName: 'vAPI',
                        msg: {
                            cmd: 'injectScript',
                            details: details
                        }
                    });
                    if(typeof callback === 'function') {
                        setTimeout(callback, 13);
                    }
                }
            });
            xhr.send();
        }
    };

    /******************************************************************************/

    // bind tabs to unique IDs

    (function() {
        var wins = safari.application.browserWindows,
            i = wins.length,
            j;

        while(i --) {
            j = wins[i].tabs.length;

            while(j--) {
                vAPI.tabs.stack[vAPI.tabs.stackId++] = wins[i].tabs[j];
            }
        }
    })();

    /******************************************************************************/

    safari.application.addEventListener('open', function(e) {
        // ignore windows
        if(e.target instanceof SafariBrowserTab) {
            vAPI.tabs.stack[vAPI.tabs.stackId++] = e.target;
        }
    }, true);

    /******************************************************************************/

    safari.application.addEventListener('close', function(e) {
        // ignore windows
        if(!(e.target instanceof SafariBrowserTab)) {
            return;
        }

        var tabId = vAPI.tabs.getTabId(e.target);

        if(tabId !== -1) {
            // to not add another listener, put this here
            // instead of vAPI.tabs.registerListeners
            if(typeof vAPI.tabs.onClosed === 'function') {
                vAPI.tabs.onClosed(tabId);
            }

            delete vAPI.tabIconState[tabId];
            delete vAPI.tabs.stack[tabId];
        }
    }, true);

    /******************************************************************************/

    vAPI.toolbarItem = false;
    safari.application.addEventListener("validate", function(event) {
        if(vAPI.toolbarItem === event.target) {
            return;
        }
        vAPI.toolbarItem = event.target;
    }, true);
    safari.application.addEventListener("activate", function(event) {
        if(!(event.target instanceof SafariBrowserTab)) {
            return;
        }
        vAPI.updateIcon(vAPI.toolbarItem);
    }, true);

    /******************************************************************************/

    // reload the popup when it's opened
    safari.application.addEventListener("popover", function(event) {
        var w = event.target.contentWindow, body = w.document.body, child;
        while(child = body.firstChild) {
            body.removeChild(child);
        }
        w.location.reload();
    }, true);

    /******************************************************************************/

    function TabIconState() {}
    TabIconState.prototype.badge = 0;
    TabIconState.prototype.img = "";

    vAPI.tabIconState = { /*tabId: {badge: 0, img: suffix}*/ };
    vAPI.updateIcon = function(icon) {
        var tabId = vAPI.tabs.getTabId(icon.browserWindow.activeTab),
            state = vAPI.tabIconState[tabId];
        if(typeof state === "undefined") {
            state = vAPI.tabIconState[tabId] = new TabIconState();
        }
        icon.badge = state.badge;
        icon.image = vAPI.getURL("img/browsericons/safari-icon16" + state.img + ".png");
    };
    vAPI.setIcon = function(tabId, iconStatus, badge) {
        var state = vAPI.tabIconState[tabId];
        if(typeof state === "undefined") {
            state = vAPI.tabIconState[tabId] = new TabIconState();
        }
        state.badge = badge || 0;
        state.img = (iconStatus === "on" ? "" : "-off");
        vAPI.updateIcon(vAPI.toolbarItem);
    };

    /******************************************************************************/

    vAPI.messaging = {
        listeners: {},
        defaultHandler: null,
        NOOPFUNC: function() {},
        UNHANDLED: 'vAPI.messaging.notHandled'
    };

    /******************************************************************************/

    vAPI.messaging.listen = function(listenerName, callback) {
        this.listeners[listenerName] = callback;
    };

    /******************************************************************************/

    var CallbackWrapper = function(request, port) {
        // No need to bind every single time
        this.callback = this.proxy.bind(this);
        this.messaging = vAPI.messaging;
        this.init(request, port);
    };
    CallbackWrapper.junkyard = [];

    CallbackWrapper.factory = function(request, port) {
        var wrapper = CallbackWrapper.junkyard.pop();
        if(wrapper) {
            wrapper.init(request, port);
            return wrapper;
        }
        return new CallbackWrapper(request, port);
    };
    CallbackWrapper.prototype.init = function(request, port) {
        this.request = request;
        this.port = port;
    };
    CallbackWrapper.prototype.proxy = function(response) {
        this.port.dispatchMessage(this.request.name, {
            requestId: this.request.message.requestId,
            channelName: this.request.message.channelName,
            msg: response !== undefined ? response: null
        });
        this.port = this.request = null;
        CallbackWrapper.junkyard.push(this);
    };

    vAPI.messaging.onMessage = function(request) {
        var callback = vAPI.messaging.NOOPFUNC;
        if(request.message.requestId !== undefined) {
            callback = CallbackWrapper.factory(request, request.target.page).callback;
        }

        var sender = {
            tab: {
                id: vAPI.tabs.getTabId(request.target)
            }
        };

        // Specific handler
        var r = vAPI.messaging.UNHANDLED;
        var listener = vAPI.messaging.listeners[request.message.channelName];
        if(typeof listener === 'function') {
            r = listener(request.message.msg, sender, callback);
        }
        if(r !== vAPI.messaging.UNHANDLED) {
            return;
        }

        // Default handler
        r = vAPI.messaging.defaultHandler(request.message.msg, sender, callback);
        if(r !== vAPI.messaging.UNHANDLED) {
            return;
        }

        console.error('µBlock> messaging > unknown request: %o', request.message);

        // Unhandled:
        // Need to callback anyways in case caller expected an answer, or
        // else there is a memory leak on caller's side
        callback();
    };

    /******************************************************************************/

    vAPI.messaging.setup = function(defaultHandler) {
        // Already setup?
        if(this.defaultHandler !== null) {
            return;
        }

        if(typeof defaultHandler !== 'function') {
            defaultHandler = function() {
                return vAPI.messaging.UNHANDLED;
            };
        }
        this.defaultHandler = defaultHandler;

        // the third parameter must stay false (bubbling), so later
        // onBeforeRequest will use true (capturing), where we can invoke
        // stopPropagation() (this way this.onMessage won't be fired)
        safari.application.addEventListener('message', this.onMessage, false);
    };

    /******************************************************************************/

    vAPI.messaging.broadcast = function(message) {
        message = {
            broadcast: true,
            msg: message
        };

        for(var tabId in vAPI.tabs.stack) {
            vAPI.tabs.stack[tabId].page.dispatchMessage('broadcast', message);
        }
    };

    /******************************************************************************/

    vAPI.net = {};

    /******************************************************************************/

    // Fast `contains`

    Array.prototype.contains = function(a) {
        var b = this.length;
        while(b--) {
            if(this[b] === a) {
                return true;
            }
        }
        return false;
    };

    /******************************************************************************/

    vAPI.net.registerListeners = function() {
        var µb = µBlock;

        // Until Safari has more specific events, those are instead handled
        // in the onBeforeRequestAdapter; clean them up so they're garbage-collected
        vAPI.net.onBeforeSendHeaders = null;
        vAPI.net.onHeadersReceived = null;

        var onBeforeRequest = vAPI.net.onBeforeRequest,
            onBeforeRequestClient = onBeforeRequest.callback,
            blockableTypes = onBeforeRequest.types;

        var onBeforeRequestAdapter = function(e) {
            if(e.name !== "canLoad") {
                return;
            }
            e.stopPropagation && e.stopPropagation();
            if(e.message.type === "main_frame") {
                vAPI.tabs.onNavigation({
                    url: e.message.url,
                    frameId: 0,
                    tabId: vAPI.tabs.getTabId(e.target)
                });
                e.message.hostname = µb.URI.hostnameFromURI(e.message.url);
                e.message.tabId = vAPI.tabs.getTabId(e.target);
                var blockVerdict = onBeforeRequestClient(e.message);
                if(blockVerdict && blockVerdict.redirectUrl) {
                    e.target.url = blockVerdict.redirectUrl;
                    e.message = false;
                }
                else {
                    e.message = true;
                }
                return;
            }
            switch(e.message.type) {
                case "popup":
                    vAPI.tabs.popupCandidate = vAPI.tabs.getTabId(e.target);
                    if(e.message.url === "about:blank") {
                        e.message = false;
                        return;
                    }
                    else {
                        e.message = !vAPI.tabs.onPopup({
                            targetURL: e.message.url,
                            targetTabId: 0,
                            openerTabId: vAPI.tabs.getTabId(e.target)
                        });
                    }
                    break;
                case "popstate":
                    vAPI.tabs.onUpdated(vAPI.tabs.getTabId(e.target), {
                        url: e.message.url
                    }, {
                        url: e.message.url
                    });
                    break;
                default:
                    e.message.hostname = µb.URI.hostnameFromURI(e.message.url);
                    e.message.tabId = vAPI.tabs.getTabId(e.target);
                    var blockVerdict = onBeforeRequestClient(e.message);
                    if(blockVerdict && blockVerdict.cancel) {
                        e.message = false;
                        return;
                    }
                    else {
                        e.message = true;
                        return;
                    }
            }
            return;
        };
        safari.application.addEventListener("message", onBeforeRequestAdapter, true);
    };

    /******************************************************************************/

    vAPI.contextMenu = {
        contextMap: {
            frame: 'insideFrame',
            link: 'linkHref',
            image: 'srcUrl',
            editable: 'editable'
        }
    };

    /******************************************************************************/

    vAPI.contextMenu.create = function(details, callback) {
        var contexts = details.contexts;
        var menuItemId = details.id;
        var menuTitle = details.title;

        if(Array.isArray(contexts) && contexts.length) {
            contexts = contexts.indexOf('all') === -1 ? contexts : null;
        } else {
            // default in Chrome
            contexts = ['page'];
        }

        this.onContextMenu = function(e) {
            var uI = e.userInfo;

            if(!uI || /^https?:\/\//i.test(uI.pageUrl) === false) {
                return;
            }

            if(contexts) {
                var invalidContext = true;
                var ctxMap = vAPI.contextMenu.contextMap;

                for(var i = 0; i < contexts.length; i++) {
                    var ctx = contexts[i];

                    if(ctx === 'audio' || ctx === 'video') {
                        if(uI[ctxMap['image']] && uI.tagName === ctx) {
                            invalidContext = false;
                            break;
                        }
                    } else if(uI[ctxMap[ctx]]) {
                        invalidContext = false;
                        break;
                    } else if(ctx === 'page') {
                        if(!(uI.insideFrame || uI.linkHref || uI.mediaType || uI.editable)) {
                            invalidContext = false;
                            break;
                        }
                    }
                }

                if(invalidContext) {
                    return;
                }
            }

            e.contextMenu.appendContextMenuItem(menuItemId, menuTitle);
        };

        this.onContextMenuCmd = function(e) {
            if(e.command === menuItemId) {
                var tab = e.currentTarget.activeBrowserWindow.activeTab;
                e.userInfo.menuItemId = menuItemId;
                callback(e.userInfo, tab ? {
                    id: vAPI.tabs.getTabId(tab),
                    url: tab.url
                } : undefined);
            }
        };

        safari.application.addEventListener('contextmenu', this.onContextMenu);
        safari.application.addEventListener('command', this.onContextMenuCmd);
    };

    /******************************************************************************/

    vAPI.contextMenu.remove = function() {
        safari.application.removeEventListener('contextmenu', this.onContextMenu);
        safari.application.removeEventListener('command', this.onContextMenuCmd);
        this.onContextMenu = null;
        this.onContextMenuCmd = null;
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

    vAPI.punycodeHostname = function(hostname) {
        return hostname;
    };

    vAPI.punycodeURL = function(url) {
        return url;
    };

    /******************************************************************************/
    
    function initStorageLib() {
       /*!
    localForage -- Offline Storage, Improved
    Version 1.2.2
    https://mozilla.github.io/localForage
    (c) 2013-2015 Mozilla, Apache License 2.0
*/
!function(){var a,b,c,d;!function(){var e={},f={};a=function(a,b,c){e[a]={deps:b,callback:c}},d=c=b=function(a){function c(b){if("."!==b.charAt(0))return b;for(var c=b.split("/"),d=a.split("/").slice(0,-1),e=0,f=c.length;f>e;e++){var g=c[e];if(".."===g)d.pop();else{if("."===g)continue;d.push(g)}}return d.join("/")}if(d._eak_seen=e,f[a])return f[a];if(f[a]={},!e[a])throw new Error("Could not find module "+a);for(var g,h=e[a],i=h.deps,j=h.callback,k=[],l=0,m=i.length;m>l;l++)k.push("exports"===i[l]?g={}:b(c(i[l])));var n=j.apply(this,k);return f[a]=g||n}}(),a("promise/all",["./utils","exports"],function(a,b){"use strict";function c(a){var b=this;if(!d(a))throw new TypeError("You must pass an array to all.");return new b(function(b,c){function d(a){return function(b){f(a,b)}}function f(a,c){h[a]=c,0===--i&&b(h)}var g,h=[],i=a.length;0===i&&b([]);for(var j=0;j<a.length;j++)g=a[j],g&&e(g.then)?g.then(d(j),c):f(j,g)})}var d=a.isArray,e=a.isFunction;b.all=c}),a("promise/asap",["exports"],function(a){"use strict";function b(){return function(){process.nextTick(e)}}function c(){var a=0,b=new i(e),c=document.createTextNode("");return b.observe(c,{characterData:!0}),function(){c.data=a=++a%2}}function d(){return function(){j.setTimeout(e,1)}}function e(){for(var a=0;a<k.length;a++){var b=k[a],c=b[0],d=b[1];c(d)}k=[]}function f(a,b){var c=k.push([a,b]);1===c&&g()}var g,h="undefined"!=typeof window?window:{},i=h.MutationObserver||h.WebKitMutationObserver,j="undefined"!=typeof global?global:void 0===this?window:this,k=[];g="undefined"!=typeof process&&"[object process]"==={}.toString.call(process)?b():i?c():d(),a.asap=f}),a("promise/config",["exports"],function(a){"use strict";function b(a,b){return 2!==arguments.length?c[a]:void(c[a]=b)}var c={instrument:!1};a.config=c,a.configure=b}),a("promise/polyfill",["./promise","./utils","exports"],function(a,b,c){"use strict";function d(){var a;a="undefined"!=typeof global?global:"undefined"!=typeof window&&window.document?window:self;var b="Promise"in a&&"resolve"in a.Promise&&"reject"in a.Promise&&"all"in a.Promise&&"race"in a.Promise&&function(){var b;return new a.Promise(function(a){b=a}),f(b)}();b||(a.Promise=e)}var e=a.Promise,f=b.isFunction;c.polyfill=d}),a("promise/promise",["./config","./utils","./all","./race","./resolve","./reject","./asap","exports"],function(a,b,c,d,e,f,g,h){"use strict";function i(a){if(!v(a))throw new TypeError("You must pass a resolver function as the first argument to the promise constructor");if(!(this instanceof i))throw new TypeError("Failed to construct 'Promise': Please use the 'new' operator, this object constructor cannot be called as a function.");this._subscribers=[],j(a,this)}function j(a,b){function c(a){o(b,a)}function d(a){q(b,a)}try{a(c,d)}catch(e){d(e)}}function k(a,b,c,d){var e,f,g,h,i=v(c);if(i)try{e=c(d),g=!0}catch(j){h=!0,f=j}else e=d,g=!0;n(b,e)||(i&&g?o(b,e):h?q(b,f):a===D?o(b,e):a===E&&q(b,e))}function l(a,b,c,d){var e=a._subscribers,f=e.length;e[f]=b,e[f+D]=c,e[f+E]=d}function m(a,b){for(var c,d,e=a._subscribers,f=a._detail,g=0;g<e.length;g+=3)c=e[g],d=e[g+b],k(b,c,d,f);a._subscribers=null}function n(a,b){var c,d=null;try{if(a===b)throw new TypeError("A promises callback cannot return that same promise.");if(u(b)&&(d=b.then,v(d)))return d.call(b,function(d){return c?!0:(c=!0,void(b!==d?o(a,d):p(a,d)))},function(b){return c?!0:(c=!0,void q(a,b))}),!0}catch(e){return c?!0:(q(a,e),!0)}return!1}function o(a,b){a===b?p(a,b):n(a,b)||p(a,b)}function p(a,b){a._state===B&&(a._state=C,a._detail=b,t.async(r,a))}function q(a,b){a._state===B&&(a._state=C,a._detail=b,t.async(s,a))}function r(a){m(a,a._state=D)}function s(a){m(a,a._state=E)}var t=a.config,u=(a.configure,b.objectOrFunction),v=b.isFunction,w=(b.now,c.all),x=d.race,y=e.resolve,z=f.reject,A=g.asap;t.async=A;var B=void 0,C=0,D=1,E=2;i.prototype={constructor:i,_state:void 0,_detail:void 0,_subscribers:void 0,then:function(a,b){var c=this,d=new this.constructor(function(){});if(this._state){var e=arguments;t.async(function(){k(c._state,d,e[c._state-1],c._detail)})}else l(this,d,a,b);return d},"catch":function(a){return this.then(null,a)}},i.all=w,i.race=x,i.resolve=y,i.reject=z,h.Promise=i}),a("promise/race",["./utils","exports"],function(a,b){"use strict";function c(a){var b=this;if(!d(a))throw new TypeError("You must pass an array to race.");return new b(function(b,c){for(var d,e=0;e<a.length;e++)d=a[e],d&&"function"==typeof d.then?d.then(b,c):b(d)})}var d=a.isArray;b.race=c}),a("promise/reject",["exports"],function(a){"use strict";function b(a){var b=this;return new b(function(b,c){c(a)})}a.reject=b}),a("promise/resolve",["exports"],function(a){"use strict";function b(a){if(a&&"object"==typeof a&&a.constructor===this)return a;var b=this;return new b(function(b){b(a)})}a.resolve=b}),a("promise/utils",["exports"],function(a){"use strict";function b(a){return c(a)||"object"==typeof a&&null!==a}function c(a){return"function"==typeof a}function d(a){return"[object Array]"===Object.prototype.toString.call(a)}var e=Date.now||function(){return(new Date).getTime()};a.objectOrFunction=b,a.isFunction=c,a.isArray=d,a.now=e}),b("promise/polyfill").polyfill()}(),function(){"use strict";function a(a,b){var c="";if(a&&(c=a.toString()),a&&("[object ArrayBuffer]"===a.toString()||a.buffer&&"[object ArrayBuffer]"===a.buffer.toString())){var e,g=f;a instanceof ArrayBuffer?(e=a,g+=h):(e=a.buffer,"[object Int8Array]"===c?g+=j:"[object Uint8Array]"===c?g+=k:"[object Uint8ClampedArray]"===c?g+=l:"[object Int16Array]"===c?g+=m:"[object Uint16Array]"===c?g+=o:"[object Int32Array]"===c?g+=n:"[object Uint32Array]"===c?g+=p:"[object Float32Array]"===c?g+=q:"[object Float64Array]"===c?g+=r:b(new Error("Failed to get type for BinaryArray"))),b(g+d(e))}else if("[object Blob]"===c){var s=new FileReader;s.onload=function(){var a=d(this.result);b(f+i+a)},s.readAsArrayBuffer(a)}else try{b(JSON.stringify(a))}catch(t){window.console.error("Couldn't convert value into a JSON string: ",a),b(null,t)}}function b(a){if(a.substring(0,g)!==f)return JSON.parse(a);var b=a.substring(s),d=a.substring(g,s),e=c(b);switch(d){case h:return e;case i:return new Blob([e]);case j:return new Int8Array(e);case k:return new Uint8Array(e);case l:return new Uint8ClampedArray(e);case m:return new Int16Array(e);case o:return new Uint16Array(e);case n:return new Int32Array(e);case p:return new Uint32Array(e);case q:return new Float32Array(e);case r:return new Float64Array(e);default:throw new Error("Unkown type: "+d)}}function c(a){var b,c,d,f,g,h=.75*a.length,i=a.length,j=0;"="===a[a.length-1]&&(h--,"="===a[a.length-2]&&h--);var k=new ArrayBuffer(h),l=new Uint8Array(k);for(b=0;i>b;b+=4)c=e.indexOf(a[b]),d=e.indexOf(a[b+1]),f=e.indexOf(a[b+2]),g=e.indexOf(a[b+3]),l[j++]=c<<2|d>>4,l[j++]=(15&d)<<4|f>>2,l[j++]=(3&f)<<6|63&g;return k}function d(a){var b,c=new Uint8Array(a),d="";for(b=0;b<c.length;b+=3)d+=e[c[b]>>2],d+=e[(3&c[b])<<4|c[b+1]>>4],d+=e[(15&c[b+1])<<2|c[b+2]>>6],d+=e[63&c[b+2]];return c.length%3===2?d=d.substring(0,d.length-1)+"=":c.length%3===1&&(d=d.substring(0,d.length-2)+"=="),d}var e="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",f="__lfsc__:",g=f.length,h="arbf",i="blob",j="si08",k="ui08",l="uic8",m="si16",n="si32",o="ur16",p="ui32",q="fl32",r="fl64",s=g+h.length,t={serialize:a,deserialize:b,stringToBuffer:c,bufferToString:d};"undefined"!=typeof module&&module.exports?module.exports=t:"function"==typeof define&&define.amd?define("localforageSerializer",function(){return t}):this.localforageSerializer=t}.call(window),function(){"use strict";function a(a){var b=this,c={db:null};if(a)for(var d in a)c[d]=a[d];return new m(function(a,d){var e=n.open(c.name,c.version);e.onerror=function(){d(e.error)},e.onupgradeneeded=function(){e.result.createObjectStore(c.storeName)},e.onsuccess=function(){c.db=e.result,b._dbInfo=c,a()}})}function b(a,b){var c=this;"string"!=typeof a&&(window.console.warn(a+" used as a key, but it is not a string."),a=String(a));var d=new m(function(b,d){c.ready().then(function(){var e=c._dbInfo,f=e.db.transaction(e.storeName,"readonly").objectStore(e.storeName),g=f.get(a);g.onsuccess=function(){var a=g.result;void 0===a&&(a=null),b(a)},g.onerror=function(){d(g.error)}})["catch"](d)});return k(d,b),d}function c(a,b){var c=this,d=new m(function(b,d){c.ready().then(function(){var e=c._dbInfo,f=e.db.transaction(e.storeName,"readonly").objectStore(e.storeName),g=f.openCursor(),h=1;g.onsuccess=function(){var c=g.result;if(c){var d=a(c.value,c.key,h++);void 0!==d?b(d):c["continue"]()}else b()},g.onerror=function(){d(g.error)}})["catch"](d)});return k(d,b),d}function d(a,b,c){var d=this;"string"!=typeof a&&(window.console.warn(a+" used as a key, but it is not a string."),a=String(a));var e=new m(function(c,e){d.ready().then(function(){var f=d._dbInfo,g=f.db.transaction(f.storeName,"readwrite"),h=g.objectStore(f.storeName);null===b&&(b=void 0);var i=h.put(b,a);g.oncomplete=function(){void 0===b&&(b=null),c(b)},g.onabort=g.onerror=function(){e(i.error)}})["catch"](e)});return k(e,c),e}function e(a,b){var c=this;"string"!=typeof a&&(window.console.warn(a+" used as a key, but it is not a string."),a=String(a));var d=new m(function(b,d){c.ready().then(function(){var e=c._dbInfo,f=e.db.transaction(e.storeName,"readwrite"),g=f.objectStore(e.storeName),h=g["delete"](a);f.oncomplete=function(){b()},f.onerror=function(){d(h.error)},f.onabort=function(a){var b=a.target.error;"QuotaExceededError"===b&&d(b)}})["catch"](d)});return k(d,b),d}function f(a){var b=this,c=new m(function(a,c){b.ready().then(function(){var d=b._dbInfo,e=d.db.transaction(d.storeName,"readwrite"),f=e.objectStore(d.storeName),g=f.clear();e.oncomplete=function(){a()},e.onabort=e.onerror=function(){c(g.error)}})["catch"](c)});return k(c,a),c}function g(a){var b=this,c=new m(function(a,c){b.ready().then(function(){var d=b._dbInfo,e=d.db.transaction(d.storeName,"readonly").objectStore(d.storeName),f=e.count();f.onsuccess=function(){a(f.result)},f.onerror=function(){c(f.error)}})["catch"](c)});return j(c,a),c}function h(a,b){var c=this,d=new m(function(b,d){return 0>a?void b(null):void c.ready().then(function(){var e=c._dbInfo,f=e.db.transaction(e.storeName,"readonly").objectStore(e.storeName),g=!1,h=f.openCursor();h.onsuccess=function(){var c=h.result;return c?void(0===a?b(c.key):g?b(c.key):(g=!0,c.advance(a))):void b(null)},h.onerror=function(){d(h.error)}})["catch"](d)});return j(d,b),d}function i(a){var b=this,c=new m(function(a,c){b.ready().then(function(){var d=b._dbInfo,e=d.db.transaction(d.storeName,"readonly").objectStore(d.storeName),f=e.openCursor(),g=[];f.onsuccess=function(){var b=f.result;return b?(g.push(b.key),void b["continue"]()):void a(g)},f.onerror=function(){c(f.error)}})["catch"](c)});return j(c,a),c}function j(a,b){b&&a.then(function(a){b(null,a)},function(a){b(a)})}function k(a,b){b&&a.then(function(a){l(b,a)},function(a){b(a)})}function l(a,b){return a?setTimeout(function(){return a(null,b)},0):void 0}var m="undefined"!=typeof module&&module.exports?require("promise"):this.Promise,n=n||this.indexedDB||this.webkitIndexedDB||this.mozIndexedDB||this.OIndexedDB||this.msIndexedDB;if(n){var o={_driver:"asyncStorage",_initStorage:a,iterate:c,getItem:b,setItem:d,removeItem:e,clear:f,length:g,key:h,keys:i};"undefined"!=typeof module&&module.exports?module.exports=o:"function"==typeof define&&define.amd?define("asyncStorage",function(){return o}):this.asyncStorage=o}}.call(window),function(){"use strict";function a(a){var b=this,c={};if(a)for(var d in a)c[d]=a[d];c.keyPrefix=c.name+"/",b._dbInfo=c;var e=new k(function(a){q===p.DEFINE?require(["localforageSerializer"],a):a(q===p.EXPORT?require("./../utils/serializer"):l.localforageSerializer)});return e.then(function(a){return m=a,k.resolve()})}function b(a){var b=this,c=b.ready().then(function(){for(var a=b._dbInfo.keyPrefix,c=n.length-1;c>=0;c--){var d=n.key(c);0===d.indexOf(a)&&n.removeItem(d)}});return j(c,a),c}function c(a,b){var c=this;"string"!=typeof a&&(window.console.warn(a+" used as a key, but it is not a string."),a=String(a));var d=c.ready().then(function(){var b=c._dbInfo,d=n.getItem(b.keyPrefix+a);return d&&(d=m.deserialize(d)),d});return j(d,b),d}function d(a,b){var c=this,d=c.ready().then(function(){for(var b=c._dbInfo.keyPrefix,d=b.length,e=n.length,f=0;e>f;f++){var g=n.key(f),h=n.getItem(g);if(h&&(h=m.deserialize(h)),h=a(h,g.substring(d),f+1),void 0!==h)return h}});return j(d,b),d}function e(a,b){var c=this,d=c.ready().then(function(){var b,d=c._dbInfo;try{b=n.key(a)}catch(e){b=null}return b&&(b=b.substring(d.keyPrefix.length)),b});return j(d,b),d}function f(a){var b=this,c=b.ready().then(function(){for(var a=b._dbInfo,c=n.length,d=[],e=0;c>e;e++)0===n.key(e).indexOf(a.keyPrefix)&&d.push(n.key(e).substring(a.keyPrefix.length));return d});return j(c,a),c}function g(a){var b=this,c=b.keys().then(function(a){return a.length});return j(c,a),c}function h(a,b){var c=this;"string"!=typeof a&&(window.console.warn(a+" used as a key, but it is not a string."),a=String(a));var d=c.ready().then(function(){var b=c._dbInfo;n.removeItem(b.keyPrefix+a)});return j(d,b),d}function i(a,b,c){var d=this;"string"!=typeof a&&(window.console.warn(a+" used as a key, but it is not a string."),a=String(a));var e=d.ready().then(function(){void 0===b&&(b=null);var c=b;return new k(function(e,f){m.serialize(b,function(b,g){if(g)f(g);else try{var h=d._dbInfo;n.setItem(h.keyPrefix+a,b),e(c)}catch(i){("QuotaExceededError"===i.name||"NS_ERROR_DOM_QUOTA_REACHED"===i.name)&&f(i),f(i)}})})});return j(e,c),e}function j(a,b){b&&a.then(function(a){b(null,a)},function(a){b(a)})}var k="undefined"!=typeof module&&module.exports?require("promise"):this.Promise,l=this,m=null,n=null;try{if(!(this.localStorage&&"setItem"in this.localStorage))return;n=this.localStorage}catch(o){return}var p={DEFINE:1,EXPORT:2,WINDOW:3},q=p.WINDOW;"undefined"!=typeof module&&module.exports?q=p.EXPORT:"function"==typeof define&&define.amd&&(q=p.DEFINE);var r={_driver:"localStorageWrapper",_initStorage:a,iterate:d,getItem:c,setItem:i,removeItem:h,clear:b,length:g,key:e,keys:f};q===p.EXPORT?module.exports=r:q===p.DEFINE?define("localStorageWrapper",function(){return r}):this.localStorageWrapper=r}.call(window),function(){"use strict";function a(a){var b=this,c={db:null};if(a)for(var d in a)c[d]="string"!=typeof a[d]?a[d].toString():a[d];var e=new k(function(a){p===o.DEFINE?require(["localforageSerializer"],a):a(p===o.EXPORT?require("./../utils/serializer"):l.localforageSerializer)}),f=new k(function(d,e){try{c.db=n(c.name,String(c.version),c.description,c.size)}catch(f){return b.setDriver(b.LOCALSTORAGE).then(function(){return b._initStorage(a)}).then(d)["catch"](e)}c.db.transaction(function(a){a.executeSql("CREATE TABLE IF NOT EXISTS "+c.storeName+" (id INTEGER PRIMARY KEY, key unique, value)",[],function(){b._dbInfo=c,d()},function(a,b){e(b)})})});return e.then(function(a){return m=a,f})}function b(a,b){var c=this;"string"!=typeof a&&(window.console.warn(a+" used as a key, but it is not a string."),a=String(a));var d=new k(function(b,d){c.ready().then(function(){var e=c._dbInfo;e.db.transaction(function(c){c.executeSql("SELECT * FROM "+e.storeName+" WHERE key = ? LIMIT 1",[a],function(a,c){var d=c.rows.length?c.rows.item(0).value:null;d&&(d=m.deserialize(d)),b(d)},function(a,b){d(b)})})})["catch"](d)});return j(d,b),d}function c(a,b){var c=this,d=new k(function(b,d){c.ready().then(function(){var e=c._dbInfo;e.db.transaction(function(c){c.executeSql("SELECT * FROM "+e.storeName,[],function(c,d){for(var e=d.rows,f=e.length,g=0;f>g;g++){var h=e.item(g),i=h.value;if(i&&(i=m.deserialize(i)),i=a(i,h.key,g+1),void 0!==i)return void b(i)}b()},function(a,b){d(b)})})})["catch"](d)});return j(d,b),d}function d(a,b,c){var d=this;"string"!=typeof a&&(window.console.warn(a+" used as a key, but it is not a string."),a=String(a));var e=new k(function(c,e){d.ready().then(function(){void 0===b&&(b=null);var f=b;m.serialize(b,function(b,g){if(g)e(g);else{var h=d._dbInfo;h.db.transaction(function(d){d.executeSql("INSERT OR REPLACE INTO "+h.storeName+" (key, value) VALUES (?, ?)",[a,b],function(){c(f)},function(a,b){e(b)})},function(a){a.code===a.QUOTA_ERR&&e(a)})}})})["catch"](e)});return j(e,c),e}function e(a,b){var c=this;"string"!=typeof a&&(window.console.warn(a+" used as a key, but it is not a string."),a=String(a));var d=new k(function(b,d){c.ready().then(function(){var e=c._dbInfo;e.db.transaction(function(c){c.executeSql("DELETE FROM "+e.storeName+" WHERE key = ?",[a],function(){b()},function(a,b){d(b)})})})["catch"](d)});return j(d,b),d}function f(a){var b=this,c=new k(function(a,c){b.ready().then(function(){var d=b._dbInfo;d.db.transaction(function(b){b.executeSql("DELETE FROM "+d.storeName,[],function(){a()},function(a,b){c(b)})})})["catch"](c)});return j(c,a),c}function g(a){var b=this,c=new k(function(a,c){b.ready().then(function(){var d=b._dbInfo;d.db.transaction(function(b){b.executeSql("SELECT COUNT(key) as c FROM "+d.storeName,[],function(b,c){var d=c.rows.item(0).c;a(d)},function(a,b){c(b)})})})["catch"](c)});return j(c,a),c}function h(a,b){var c=this,d=new k(function(b,d){c.ready().then(function(){var e=c._dbInfo;e.db.transaction(function(c){c.executeSql("SELECT key FROM "+e.storeName+" WHERE id = ? LIMIT 1",[a+1],function(a,c){var d=c.rows.length?c.rows.item(0).key:null;b(d)},function(a,b){d(b)})})})["catch"](d)});return j(d,b),d}function i(a){var b=this,c=new k(function(a,c){b.ready().then(function(){var d=b._dbInfo;d.db.transaction(function(b){b.executeSql("SELECT key FROM "+d.storeName,[],function(b,c){for(var d=[],e=0;e<c.rows.length;e++)d.push(c.rows.item(e).key);a(d)},function(a,b){c(b)})})})["catch"](c)});return j(c,a),c}function j(a,b){b&&a.then(function(a){b(null,a)},function(a){b(a)})}var k="undefined"!=typeof module&&module.exports?require("promise"):this.Promise,l=this,m=null,n=this.openDatabase;if(n){var o={DEFINE:1,EXPORT:2,WINDOW:3},p=o.WINDOW;"undefined"!=typeof module&&module.exports?p=o.EXPORT:"function"==typeof define&&define.amd&&(p=o.DEFINE);var q={_driver:"webSQLStorage",_initStorage:a,iterate:c,getItem:b,setItem:d,removeItem:e,clear:f,length:g,key:h,keys:i};p===o.DEFINE?define("webSQLStorage",function(){return q}):p===o.EXPORT?module.exports=q:this.webSQLStorage=q}}.call(window),function(){"use strict";function a(a,b){a[b]=function(){var c=arguments;return a.ready().then(function(){return a[b].apply(a,c)})}}function b(){for(var a=1;a<arguments.length;a++){var b=arguments[a];if(b)for(var c in b)b.hasOwnProperty(c)&&(arguments[0][c]=n(b[c])?b[c].slice():b[c])}return arguments[0]}function c(a){for(var b in g)if(g.hasOwnProperty(b)&&g[b]===a)return!0;return!1}function d(c){this._config=b({},k,c),this._driverSet=null,this._ready=!1,this._dbInfo=null;for(var d=0;d<i.length;d++)a(this,i[d]);this.setDriver(this._config.driver)}var e="undefined"!=typeof module&&module.exports?require("promise"):this.Promise,f={},g={INDEXEDDB:"asyncStorage",LOCALSTORAGE:"localStorageWrapper",WEBSQL:"webSQLStorage"},h=[g.INDEXEDDB,g.WEBSQL,g.LOCALSTORAGE],i=["clear","getItem","iterate","key","keys","length","removeItem","setItem"],j={DEFINE:1,EXPORT:2,WINDOW:3},k={description:"",driver:h.slice(),name:"localforage",size:4980736,storeName:"keyvaluepairs",version:1},l=j.WINDOW;"undefined"!=typeof module&&module.exports?l=j.EXPORT:"function"==typeof define&&define.amd&&(l=j.DEFINE);var m=function(a){var b=b||a.indexedDB||a.webkitIndexedDB||a.mozIndexedDB||a.OIndexedDB||a.msIndexedDB,c={};return c[g.WEBSQL]=!!a.openDatabase,c[g.INDEXEDDB]=!!function(){if("undefined"!=typeof a.openDatabase&&a.navigator&&a.navigator.userAgent&&/Safari/.test(a.navigator.userAgent)&&!/Chrome/.test(a.navigator.userAgent))return!1;try{return b&&"function"==typeof b.open&&"undefined"!=typeof a.IDBKeyRange}catch(c){return!1}}(),c[g.LOCALSTORAGE]=!!function(){try{return a.localStorage&&"setItem"in a.localStorage&&a.localStorage.setItem}catch(b){return!1}}(),c}(this),n=Array.isArray||function(a){return"[object Array]"===Object.prototype.toString.call(a)},o=this;d.prototype.INDEXEDDB=g.INDEXEDDB,d.prototype.LOCALSTORAGE=g.LOCALSTORAGE,d.prototype.WEBSQL=g.WEBSQL,d.prototype.config=function(a){if("object"==typeof a){if(this._ready)return new Error("Can't call config() after localforage has been used.");for(var b in a)"storeName"===b&&(a[b]=a[b].replace(/\W/g,"_")),this._config[b]=a[b];return"driver"in a&&a.driver&&this.setDriver(this._config.driver),!0}return"string"==typeof a?this._config[a]:this._config},d.prototype.defineDriver=function(a,b,d){var g=new e(function(b,d){try{var g=a._driver,h=new Error("Custom driver not compliant; see https://mozilla.github.io/localForage/#definedriver"),j=new Error("Custom driver name already in use: "+a._driver);if(!a._driver)return void d(h);if(c(a._driver))return void d(j);for(var k=i.concat("_initStorage"),l=0;l<k.length;l++){var n=k[l];if(!n||!a[n]||"function"!=typeof a[n])return void d(h)}var o=e.resolve(!0);"_support"in a&&(o=a._support&&"function"==typeof a._support?a._support():e.resolve(!!a._support)),o.then(function(c){m[g]=c,f[g]=a,b()},d)}catch(p){d(p)}});return g.then(b,d),g},d.prototype.driver=function(){return this._driver||null},d.prototype.ready=function(a){var b=this,c=new e(function(a,c){b._driverSet.then(function(){null===b._ready&&(b._ready=b._initStorage(b._config)),b._ready.then(a,c)})["catch"](c)});return c.then(a,a),c},d.prototype.setDriver=function(a,b,d){function g(){h._config.driver=h.driver()}var h=this;return"string"==typeof a&&(a=[a]),this._driverSet=new e(function(b,d){var g=h._getFirstSupportedDriver(a),i=new Error("No available storage method found.");if(!g)return h._driverSet=e.reject(i),void d(i);if(h._dbInfo=null,h._ready=null,c(g)){if(l===j.DEFINE)return void require([g],function(a){h._extend(a),b()});if(l===j.EXPORT){var k;switch(g){case h.INDEXEDDB:k=require("./drivers/indexeddb");break;case h.LOCALSTORAGE:k=require("./drivers/localstorage");break;case h.WEBSQL:k=require("./drivers/websql")}h._extend(k)}else h._extend(o[g])}else{if(!f[g])return h._driverSet=e.reject(i),void d(i);h._extend(f[g])}b()}),this._driverSet.then(g,g),this._driverSet.then(b,d),this._driverSet},d.prototype.supports=function(a){return!!m[a]},d.prototype._extend=function(a){b(this,a)},d.prototype._getFirstSupportedDriver=function(a){if(a&&n(a))for(var b=0;b<a.length;b++){var c=a[b];if(this.supports(c))return c}return null},d.prototype.createInstance=function(a){return new d(a)};var p=new d;l===j.DEFINE?define("localforage",function(){return p}):l===j.EXPORT?module.exports=p:this.localforage=p}.call(window); 
    }

})();

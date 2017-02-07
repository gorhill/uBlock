/*******************************************************************************

    uBlock - a browser extension to block requests.
    Copyright (C) 2014-2016 The uBlock authors

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

'use strict';

/******************************************************************************/

(function() {

var vAPI = self.vAPI = self.vAPI || {};

vAPI.isMainProcess = true;
vAPI.safari = true;

/******************************************************************************/

vAPI.app = {
    name: 'uBlock',
    version: safari.extension.displayVersion
};

/******************************************************************************/

if ( navigator.userAgent.indexOf('Safari/6') === -1 ) { // If we're not on at least Safari 8
    var _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, u) {
        if ( u.lastIndexOf('safari-extension:', 0) === 0 ) {
            var i = u.length, seeDot = false;
            while ( i-- ) {
                if ( u[i] === '.' ) {
                    seeDot = true;
                } else if ( u[i] === '/' ) {
                    break;
                }
            }
            if ( seeDot === false ) {
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

safari.extension.addContentScriptFromURL(vAPI.getURL('js/scriptlets/subscriber.js'), [
    'https://*.adblockplus.org/*',
    'https://*.adblockplus.me/*',
    'https://www.fanboy.co.nz/*',
    'http://*.adblockplus.org/*',
    'http://*.adblockplus.me/*',
    'http://www.fanboy.co.nz/*'
], [], true);

/******************************************************************************/

safari.extension.settings.addEventListener('change', function(e) {
    if ( e.key === 'open_prefs' ) {
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
    name: 'ublock',
    size: storageQuota,
    storeName: 'keyvaluepairs'
});

vAPI.cacheStorage = {
    QUOTA_BYTES: storageQuota, // copied from Info.plist

    get: function(keys, callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }

        var result = {};

        if ( keys === null ) {
            localforage.iterate(function(value, key) {
                if ( typeof value === 'string' ) {
                    result[key] = JSON.parse(value);
                }
            }, function() {
                callback(result);
            });
        } else if ( typeof keys === 'string' ) {
            localforage.getItem(keys, function(err, value) {
                if ( typeof value === 'string' ) {
                    result[keys] = JSON.parse(value);
                }
                callback(result);
            });
        } else if ( Array.isArray(keys) ) {
            var toSatisfy = keys.length, n = toSatisfy;
            if ( n === 0 ) {
                callback(result);
                return;
            }
            var key;
            for ( var i = 0; i < n; i++ ) {
                key = keys[i];
                localforage.getItem(key, (function(key) {
                    return function(err, value) {
                        toSatisfy--;
                        if ( typeof value === 'string' ) {
                            result[key] = JSON.parse(value);
                        }
                        if ( toSatisfy === 0 ) {
                            callback(result);
                        }
                    }
                })(key));
            }
        } else if ( typeof keys === 'object' ) {
            for ( var key in keys ) {
                if ( !keys.hasOwnProperty(key) ) {
                    continue;
                }
                result[key] = keys[key];
            }
            localforage.iterate(function(value, key) {
                if ( !keys.hasOwnProperty(key) ) return;
                if ( typeof value === 'string' ) {
                    result[key] = JSON.parse(value);
                }
            }, function() {
                callback(result);
            });
        }
    },

    set: function(details, callback) {
        var key, toSatisfy = 0;
        for ( key in details ) {
            if ( !details.hasOwnProperty(key) ) {
                continue;
            }
            toSatisfy++;
        }
        if ( toSatisfy === 0 ) {
            // Nothing to set
            callback && callback();
            return;
        }
        var callbackCaller = function() {
            if ( --toSatisfy === 0 ) {
                callback && callback();
            }
        };
        for ( key in details ) {
            if ( !details.hasOwnProperty(key) ) {
                continue;
            }
            localforage.setItem(key, JSON.stringify(details[key]), callbackCaller);
        }
    },

    remove: function(keys) {
        if ( typeof keys === 'string' ) {
            keys = [keys];
        }

        for ( var i = 0, n = keys.length; i < n; i++ ) {
            localforage.removeItem(keys[i]);
        }
    },

    clear: function(callback) {
        localforage.clear(function() {
            typeof callback === 'function' && callback();
        });
    },

    getBytesInUse: function(keys, callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }
        var size = 0;
        if ( Array.isArray(keys) ) {
            var toSatisfy = keys.length, n = toSatisfy;
            if ( n === 0 ) {
                callback(0);
                return;
            }
            var callbackCaller = function(err, value) {
                size += (value || '').length;
                if ( --toSatisfy === 0 ) {
                    callback(size);
                }
            };
            for ( var i = 0; i < n; i++ ) {
                localforage.getItem(keys[i], callbackCaller);
            }
        } else {
            localforage.iterate(function(value, key) {
                size += (value || '').length;
            }, function() {
                callback(size);
            });
        }
    }
};

vAPI.storage = {
    _storage: safari.extension.settings,
    get: function(keys, callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }

        var i, value, result = {};

        if ( keys === null ) {
            for ( i in this._storage ) {
                if ( !this._storage.hasOwnProperty(i) ) continue;
                value = this._storage[i];
                if ( typeof value === 'string' ) {
                    result[i] = JSON.parse(value);
                }
            }
        } else if ( typeof keys === 'string' ) {
            value = this._storage[keys];
            if ( typeof value === 'string' ) {
                result[keys] = JSON.parse(value);
            }
        } else if ( Array.isArray(keys) ) {
            for ( i = 0; i < keys.length; i++ ) {
                value = this._storage[keys[i]];

                if ( typeof value === 'string' ) {
                    result[keys[i]] = JSON.parse(value);
                }
            }
        } else if ( typeof keys === 'object' ) {
            for ( i in keys ) {
                if ( !keys.hasOwnProperty(i) ) {
                    continue;
                }
                value = this._storage[i];

                if ( typeof value === 'string' ) {
                    result[i] = JSON.parse(value);
                } else {
                    result[i] = keys[i];
                }
            }
        }
        callback(result);
    },
    set: function(details, callback) {
        for ( var key in details ) {
            if ( !details.hasOwnProperty(key) ) {
                continue;
            }
            this._storage.setItem(key, JSON.stringify(details[key]));
        }
        if ( typeof callback === 'function' ) {
            callback();
        }
    },
    remove: function(keys) {
        if ( typeof keys === 'string' ) {
            keys = [keys];
        }
        for ( var i = 0; i < keys.length; i++ ) {
            this._storage.removeItem(keys[i]);
        }
    },
    clear: function(callback) {
        this._storage.clear();
        // Assuming callback will be called after clear
        if ( typeof callback === 'function' ) {
            callback();
        }
    }
    // No getBytesInUse; too slow
};

/******************************************************************************/

vAPI.tabs = {
    stack: {},
    stackId: 1
};

/******************************************************************************/

vAPI.isBehindTheSceneTabId = function(tabId) {
    return tabId.toString() === '-1';
};

vAPI.noTabId = '-1';

/******************************************************************************/

vAPI.tabs.registerListeners = function() {
    safari.application.addEventListener('beforeNavigate', function(e) {
        if ( !vAPI.tabs.popupCandidate || !e.target || e.url === 'about:blank' ) {
            return;
        }
        var targetUrl = e.url,
            targetTabId = vAPI.tabs.getTabId(e.target).toString(),
            openerTabId = vAPI.tabs.popupCandidate;
        vAPI.tabs.popupCandidate = false;
        if ( vAPI.tabs.onPopupUpdated(targetTabId, openerTabId, targetUrl) ) {
            e.preventDefault();
            if ( vAPI.tabs.stack[openerTabId] ) {
                vAPI.tabs.stack[openerTabId].activate();
            }
        }
    }, true);
    // onClosed handled in the main tab-close event
    // onUpdated handled via monitoring the history.pushState on web-pages
    // onPopup is handled in window.open on web-pages
    safari.application.addEventListener('activate', function(e) {
        vAPI.contextMenu.onMustUpdate(vAPI.tabs.getTabId(e.target));
    }, true);
};

/******************************************************************************/

vAPI.tabs.getTabId = function(tab) {
    if ( typeof tab.uBlockCachedID !== 'undefined' ) {
        return tab.uBlockCachedID;
    }
    for ( var i in vAPI.tabs.stack ) {
        if ( vAPI.tabs.stack[i] === tab ) {
            return (tab.uBlockCachedID = +i);
        }
    }

    return -1;
};

/******************************************************************************/

vAPI.tabs.get = function(tabId, callback) {
    var tab;

    if ( tabId === null ) {
        tab = safari.application.activeBrowserWindow.activeTab;
        tabId = this.getTabId(tab);
    } else {
        tab = this.stack[tabId];
    }

    if ( !tab ) {
        callback();
        return;
    }

    callback({
        id: tabId,
        index: tab.browserWindow.tabs.indexOf(tab),
        windowId: safari.application.browserWindows.indexOf(tab.browserWindow),
        active: tab === tab.browserWindow.activeTab,
        url: tab.url || 'about:blank',
        title: tab.title
    });
};

/******************************************************************************/

// properties of the details object:
//   url: 'URL', // the address that will be opened
//   tabId: 1, // the tab is used if set, instead of creating a new one
//   index: -1, // undefined: end of the list, -1: following tab, or after index
//   active: false, // opens the tab in background - true and undefined: foreground
//   select: true, // if a tab is already opened with that url, then select it instead of opening a new one
//   popup: true // open in a new window

vAPI.tabs.open = function(details) {
    if ( !details.url ) {
        return null;
    }
    // extension pages
    if ( /^[\w-]{2,}:/.test(details.url) === false ) {
        details.url = vAPI.getURL(details.url);
    }

    var curWin, tab;

    // Open in a standalone window
    if ( details.popup === true ) {
        tab = safari.application.openBrowserWindow().activeTab;
        tab.url = details.url;
        return tab;
    }

    if ( details.select ) {
        var findTab;
        var pos = details.url.indexOf('#');
        var url = details.url;
        if ( pos === -1 ) {
            findTab = function(win) {
                for ( var i = 0; i < win.tabs.length; i++ ) {
                    if ( win.tabs[i].url === url ) {
                        win.tabs[i].activate();
                        tab = win.tabs[i];
                        return true;
                    }
                }
            }
        } else {
            // Remove fragment identifiers
            url = url.slice(0, pos);
            findTab = function(win) {
                for ( var i = 0; i < win.tabs.length; i++ ) {
                    // Some tabs don't have a URL
                    if ( win.tabs[i].url &&
                        win.tabs[i].url.slice(0, pos) === url ) {
                        win.tabs[i].activate();
                        tab = win.tabs[i];
                        return true;
                    }
                }
            }
        }

        if ( safari.application.browserWindows.some(findTab) ) {
            return tab;
        }
    }

    if ( details.active === undefined ) {
        details.active = true;
    }

    curWin = safari.application.activeBrowserWindow;

    // it must be calculated before opening a new tab,
    // otherwise the new tab will be the active tab here
    if ( details.index === -1 ) {
        details.index = curWin.tabs.indexOf(curWin.activeTab) + 1;
    }

    tab = (details.tabId ? this.stack[details.tabId] : curWin.openTab(details.active ? 'foreground' : 'background'));

    if ( details.index !== undefined ) {
        curWin.insertTab(tab, details.index);
    }

    tab.url = details.url;
    return tab;
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
    if ( tabIds instanceof SafariBrowserTab ) {
        tabIds = this.getTabId(tabIds);
    }

    if ( !Array.isArray(tabIds) ) {
        tabIds = [tabIds];
    }

    for ( var i = 0; i < tabIds.length; i++ ) {
        if ( this.stack[tabIds[i]] ) {
            this.stack[tabIds[i]].close();
        }
    }
};

/******************************************************************************/

vAPI.tabs.reload = function(tabId) {
    var tab = this.stack[tabId];

    if ( tab ) {
        tab.url = tab.url;
    }
};

/******************************************************************************/

vAPI.tabs.select = function(tabId) {
    if ( tabId === 0 ) return;
    this.stack[tabId].activate();
};

/******************************************************************************/

vAPI.tabs.injectScript = function(tabId, details, callback) {
    var tab;

    if ( tabId ) {
        tab = this.stack[tabId];
    } else {
        tab = safari.application.activeBrowserWindow.activeTab;
    }

    if ( details.file ) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', details.file, true);
        xhr.addEventListener('readystatechange', function() {
            if ( this.readyState === 4 ) {
                details.code = xhr.responseText;
                tab.page.dispatchMessage('broadcast', {
                    channelName: 'vAPI',
                    msg: {
                        cmd: 'injectScript',
                        details: details
                    }
                });
                if ( typeof callback === 'function' ) {
                    setTimeout(callback, 13);
                }
            }
        });
        xhr.send();
    }
};

/******************************************************************************/

// reload the popup when it's opened
safari.application.addEventListener('popover', function(event) {
    var w = event.target.contentWindow, body = w.document.body, child;
    while ( child = body.firstChild ) {
        body.removeChild(child);
    }
    w.location.reload();
}, true);

/******************************************************************************/

var ICON_URLS = {
    'on': vAPI.getURL('img/browsericons/safari-icon16.png'),
    'off': vAPI.getURL('img/browsericons/safari-icon16-off.png')
};

var IconState = function(badge, img, icon) {
    this.badge = badge;
    // ^ a number -- the badge 'value'
    this.img = img;
    // ^ a string -- 'on' or 'off'
    this.active = false;
    // ^ is this IconState active for rendering?
    this.icon = typeof icon !== 'undefined' ? icon : null;
    // ^ the corresponding browser toolbar-icon object
    this.dirty = (1 << 1) | (1 << 0);
    /* ^ bitmask AB: two bits, A and B
     where A is whether img has changed and needs render
     and B is whether badge has changed and needs render */
};

var iconStateForTabId = {}; // {tabId: IconState}

var getIconForWindow = function(whichWindow) {
    // do we already have the right icon cached?
    if ( typeof whichWindow.uBlockIcon !== 'undefined' ) {
        return whichWindow.uBlockIcon;
    }

    // iterate through the icons to find the one which
    // belongs to this window (whichWindow)
    var items = safari.extension.toolbarItems;
    for ( var i = 0; i < items.length; i++ ) {
        if ( items[i].browserWindow === whichWindow ) {
            return (whichWindow.uBlockIcon = items[i]);
        }
    }
};

safari.application.addEventListener('activate', function(event) {
    if ( !(event.target instanceof SafariBrowserTab) ) {
        return;
    }

    // when a tab is activated...
    var tab = event.target;
    if ( tab.browserWindow !== tab.oldBrowserWindow ) {
        // looks like tab is now associated with a new window
        tab.oldBrowserWindow = tab.browserWindow;
        // so, unvalidate icon
        tab.uBlockKnowsIcon = false;
    }

    var tabId = vAPI.tabs.getTabId(tab),
        state = iconStateForTabId[tabId];
    if ( typeof state === 'undefined' ) {
        state = iconStateForTabId[tabId] = new IconState(0, 'on');
        // need to get the icon for this newly-encountered tab...
        // uBlockKnowsIcon should be undefined here, so in theory
        // we don't need this -- but to be sure,
        // go ahead and explicitly unvalidate
        tab.uBlockKnowsIcon = false;
    }

    if ( !tab.uBlockKnowsIcon ) {
        // need to find the icon for this tab's window
        state.icon = getIconForWindow(tab.browserWindow);
        tab.uBlockKnowsIcon = true;
    }
    state.active = true;
    // force re-render since we probably switched tabs
    state.dirty = (1 << 1) | (1 << 0);
    renderIcon(state);
}, true);

safari.application.addEventListener('deactivate', function(event) {
    if ( !(event.target instanceof SafariBrowserTab) ) {
        return;
    }
    // when a tab is deactivated...
    var tabId = vAPI.tabs.getTabId(event.target),
        state = iconStateForTabId[tabId];
    if ( typeof state === 'undefined' ) {
        return;
    }
    // mark its iconState as inactive so we don't visually
    // render changes for now
    state.active = false;
}, true);

var renderIcon = function(iconState) {
    if ( iconState.dirty === 0 ) {
        // quit if we don't need to touch the 'DOM'
        return;
    }
    var icon = iconState.icon;
    // only update the image if needed:
    if ( iconState.dirty & 2 ) {
        icon.badge = iconState.badge;
    }
    if ( (iconState.dirty & 1) && icon.image !== ICON_URLS[iconState.img] ) {
        icon.image = ICON_URLS[iconState.img];
    }
    iconState.dirty = 0;
};

vAPI.setIcon = function(tabId, iconStatus, badge) {
    badge = badge || 0;

    var state = iconStateForTabId[tabId];
    if ( typeof state === 'undefined' ) {
        state = iconStateForTabId[tabId] = new IconState(badge, iconStatus);
    } else {
        state.dirty = ((state.badge !== badge) << 1) | ((state.img !== iconStatus) << 0);
        state.badge = badge;
        state.img = iconStatus;
    }
    if ( state.active === true ) {
        renderIcon(state);
    }
    vAPI.contextMenu.onMustUpdate(tabId);
};

/******************************************************************************/

// bind tabs to unique IDs

(function() {
    var wins = safari.application.browserWindows,
        i = wins.length,
        j,
        curTab,
        curTabId,
        curWindow;
    while ( i-- ) {
        curWindow = wins[i];
        j = curWindow.tabs.length;
        while ( j-- ) {
            curTab = wins[i].tabs[j];
            curTabId = vAPI.tabs.stackId++;
            iconStateForTabId[curTabId] = new IconState(0, 'on', getIconForWindow(curWindow));
            curTab.uBlockKnowsIcon = true;
            if ( curWindow.activeTab === curTab ) {
                iconStateForTabId[curTabId].active = true;
            }
            vAPI.tabs.stack[curTabId] = curTab;
        }
    }
})();

/******************************************************************************/

safari.application.addEventListener('open', function(e) {
    // ignore windows
    if ( e.target instanceof SafariBrowserTab ) {
        vAPI.tabs.stack[vAPI.tabs.stackId++] = e.target;
    }
}, true);

/******************************************************************************/

safari.application.addEventListener('close', function(e) {
    // ignore windows
    if ( !(e.target instanceof SafariBrowserTab) ) {
        return;
    }

    var tabId = vAPI.tabs.getTabId(e.target);

    if ( tabId !== -1 ) {
        // to not add another listener, put this here
        // instead of vAPI.tabs.registerListeners
        if ( typeof vAPI.tabs.onClosed === 'function' ) {
            vAPI.tabs.onClosed(tabId);
        }

        delete vAPI.tabs.stack[tabId];
        delete iconStateForTabId[tabId];
    }
}, true);

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

// CallbackWrapper.prototype.proxy = function(response) {
//     this.port.dispatchMessage(this.request.name, {
//         requestId: this.request.message.requestId,
//         channelName: this.request.message.channelName,
//         msg: response !== undefined ? response: null
//     });
//     this.port = this.request = null;
//     CallbackWrapper.junkyard.push(this);
// };

vAPI.messaging.onMessage = (function() {
    var messaging = vAPI.messaging;
    var toAuxPending = {};

    // Use a wrapper to avoid closure and to allow reuse.
    var CallbackWrapper = function(port, request, timeout) {
        this.callback = this.proxy.bind(this); // bind once
        this.init(port, request, timeout);
    };

    CallbackWrapper.prototype.init = function(port, request, timeout) {
        this.port = port;
        // port.target.page could be undefined at this point, but be valid later
        // e.g. when preloading a page on a new tab
        this.request = request || port;
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
        // If page is undefined, we cannot send a message to it (and probably don't want to)
        var page = this.port.target.page;
        if ( page && typeof page.dispatchMessage === 'function' ) {
            page.dispatchMessage(this.request.name, {
                auxProcessId: this.request.message.auxProcessId,
                channelName: this.request.message.channelName,
                msg: response !== undefined ? response : null
            });
        }
        // Mark for reuse
        this.port = this.request = null;
        callbackWrapperJunkyard.push(this);
    };

    var callbackWrapperJunkyard = [];

    var callbackWrapperFactory = function(port, request, timeout) {
        var wrapper = callbackWrapperJunkyard.pop();
        if ( wrapper ) {
            return wrapper.init(port, request, timeout);
        }
        return new CallbackWrapper(port, request, timeout);
    };

    var toAux = function(details, portFrom) {
        var port, portTo;
        // var chromiumTabId = details.toTabId; //toChromiumTabId(details.toTabId);

        // TODO: This could be an issue with a lot of tabs: easy to address
        //       with a port name to tab id map.
        // for ( var portName in messaging.ports ) {
        //     if ( messaging.ports.hasOwnProperty(portName) === false ) {
        //         continue;
        //     }
        //     // When sending to an auxiliary process, the target is always the
        //     // port associated with the root frame.
        //     port = messaging.ports[portName];
        //     if ( port.sender.frameId === 0 && port.sender.tab.id === chromiumTabId ) {
        //         portTo = port;
        //         break;
        //     }
        // }

        var wrapper;
        if ( details.auxProcessId !== undefined ) {
            wrapper = callbackWrapperFactory(portFrom, details, 1023);
        }

        // Destination not found:
        if ( portTo === undefined ) {
            if ( wrapper !== undefined ) {
                wrapper.callback();
            }
            return;
        }

        // As per HTML5, timer id is always an integer, thus suitable to be
        // used as a key, and which value is safe to use across process
        // boundaries.
        if ( wrapper !== undefined ) {
            toAuxPending[wrapper.timerId] = wrapper;
        }

        // portTo.postMessage({
        //     mainProcessId: wrapper && wrapper.timerId,
        //     channelName: details.toChannel,
        //     msg: details.msg
        // });
        portTo.dispatchMessage(wrapper && wrapper.timerId, {
            mainProcessId: wrapper && wrapper.timerId,
            channelName: details.toChannel,
            msg: details.msg
        });
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

    return function(request) {
        var message = request.message;

        // Auxiliary process to auxiliary process
        if ( message.toTabId !== undefined ) {
            // TODO: this doesn't work.
            toAux(message, request);
            return;
        }

        // Auxiliary process to auxiliary process: response
        if ( message.mainProcessId !== undefined ) {
            toAuxResponse(message);
            return;
        }

        // Auxiliary process to main process: prepare response
        var callback = messaging.NOOPFUNC;
        if ( message.auxProcessId !== undefined ) {
            callback = callbackWrapperFactory(request).callback;
        }

        var sender = {
            tab: {
                id: vAPI.tabs.getTabId(request.target)
            }
        };

        // Auxiliary process to main process: specific handler
        var r = messaging.UNHANDLED;
        var listener = messaging.listeners[message.channelName];
        if ( typeof listener === 'function' ) {
            r = listener(message.msg, sender, callback);
            if ( r !== messaging.UNHANDLED ) {
                return;
            }
        }

        // Auxiliary process to main process: default handler
        r = messaging.defaultHandler(message.msg, sender, callback);
        if ( r !== messaging.UNHANDLED ) {
            return;
        }

        // Auxiliary process to main process: no handler
        console.error('uBlock> messaging > unknown request: %o', message);

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
    var page;
    for ( var tabId in vAPI.tabs.stack ) {
        if ( vAPI.tabs.stack.hasOwnProperty(tabId) ) {
            page = vAPI.tabs.stack[tabId].page;
            // page is undefined on new tabs
            if ( page && typeof page.dispatchMessage === 'function' ) {
                page.dispatchMessage('broadcast', message);
            }
        }
    }
};

/******************************************************************************/

vAPI.net = {};

/******************************************************************************/

// Fast `contains`

Array.prototype.contains = function(a) {
    var b = this.length;
    while ( b-- ) {
        if ( this[b] === a ) {
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

    var onBeforeRequest = vAPI.net.onBeforeRequest,
        onBeforeRequestClient = onBeforeRequest.callback,
        onHeadersReceivedClient = vAPI.net.onHeadersReceived.callback;

    var onBeforeRequestAdapter = function(e) {
        if ( e.name !== 'canLoad' ) {
            return;
        }
        e.stopPropagation && e.stopPropagation();
        if ( e.message.type === 'main_frame' ) {
            vAPI.tabs.onNavigation({
                url: e.message.url,
                frameId: 0,
                tabId: vAPI.tabs.getTabId(e.target).toString()
            });
            e.message.hostname = µb.URI.hostnameFromURI(e.message.url);
            e.message.tabId = vAPI.tabs.getTabId(e.target);
            e.message.responseHeaders = [];
            onBeforeRequestClient(e.message);
            var blockVerdict = onHeadersReceivedClient(e.message);
            e.message = {
                shouldBlock: blockVerdict && blockVerdict.responseHeaders
            };
            return;
        }
        switch ( e.message.type ) {
            case 'popup':
                var openerTabId = vAPI.tabs.getTabId(e.target).toString();
                var shouldBlock = !!vAPI.tabs.onPopupUpdated('preempt', openerTabId, e.message.url);
                if ( !shouldBlock ) {
                    vAPI.tabs.popupCandidate = openerTabId;
                }
                e.message = {
                    shouldBlock: shouldBlock
                };
                break;
            case 'popstate':
                // No return value/message
                vAPI.tabs.onUpdated(vAPI.tabs.getTabId(e.target), {
                    url: e.message.url
                }, {
                    url: e.message.url
                });
                break;
            default:
                e.message.hostname = µb.URI.hostnameFromURI(e.message.url);
                e.message.tabId = vAPI.tabs.getTabId(e.target);
                var blockVerdict = onBeforeRequestClient(e.message) || {};
                blockVerdict.shouldBlock = blockVerdict.cancel === true || blockVerdict.redirectUrl !== undefined;
                e.message = blockVerdict;
                return;
        }
    };
    safari.application.addEventListener('message', onBeforeRequestAdapter, true);
};

/******************************************************************************/

vAPI.contextMenu = {
    _callback: null,
    _entries: [],
    _contextMap: {
        frame: 'insideFrame',
        link: 'linkHref',
        image: 'srcUrl',
        editable: 'editable'
    },
    onContextMenu: function(e) {
        var uI = e.userInfo;

        if ( !uI || /^https?:\/\//i.test(uI.pageUrl) === false ) {
            return;
        }

        var invalidContext, entry, ctx;
        var entries = vAPI.contextMenu._entries,
            ctxMap = vAPI.contextMenu._contextMap;
        for ( var i = 0; i < entries.length; i++ ) {
            entry = entries[i];
            invalidContext = true;

            for ( var j = 0; j < entry.contexts.length; j++ ) {
                ctx = entry.contexts[j];

                if ( uI[ctxMap[ctx]] || ctx === 'all' ) {
                    invalidContext = false;
                    break;
                } else if ( ctx === 'audio' || ctx === 'video' ) {
                    if ( uI[ctxMap['image']] && uI.tagName === ctx ) {
                        invalidContext = false;
                        break;
                    }
                } else if ( ctx === 'page' ) {
                    if ( !(uI.insideFrame || uI.linkHref || uI.mediaType || uI.editable) ) {
                        invalidContext = false;
                        break;
                    }
                }
            }

            if ( invalidContext ) {
                continue;
            }
            e.contextMenu.appendContextMenuItem(entry.id, entry.title);
        }
    },
    onContextMenuCmd: function(e) {
        var entryId;
        var entries = vAPI.contextMenu._entries;
        for ( var i = 0; i < entries.length; i++ ) {
            entryId = entries[i].id;
            if ( e.command === entryId ) {
                var tab = e.currentTarget.activeBrowserWindow.activeTab;
                e.userInfo.menuItemId = entryId;
                vAPI.contextMenu._callback(e.userInfo, tab ? {
                        id: vAPI.tabs.getTabId(tab),
                        url: tab.url
                    } : undefined);
            }
        }
    },
    onMustUpdate: function() {},
    setEntries: function(entries, callback) {
        entries = entries || [];
        this._entries = entries;
        callback = callback || null;
        if ( callback === this._callback ) {
            return;
        }
        if ( entries.length !== 0 && callback !== null ) {
            safari.application.addEventListener('contextmenu', this.onContextMenu);
            safari.application.addEventListener('command', this.onContextMenuCmd);
            this._callback = callback;
        } else if ( entries.length === 0 && this._callback !== null ) {
            safari.application.removeEventListener('contextmenu', this.onContextMenu);
            safari.application.removeEventListener('command', this.onContextMenuCmd);
            this._callback = null;
        }
    }
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
/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/531
// Storage area dedicated to admin settings. Read-only.

vAPI.adminStorage = {
    getItem: function(key, callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }
        // skip functionality
        callback(vAPI.localStorage.getItem(key));
    }
};

/******************************************************************************/
/******************************************************************************/

function initStorageLib() {
    /*!
     localForage -- Offline Storage, Improved
     Version 1.4.3
     https://localforage.github.io/localForage
     (c) 2013-2016 Mozilla, Apache License 2.0
     */
    !function(a){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=a();else if("function"==typeof define&&define.amd)define([],a);else{var b;b="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this,b.localforage=a()}}(function(){return function a(b,c,d){function e(g,h){if(!c[g]){if(!b[g]){var i="function"==typeof require&&require;if(!h&&i)return i(g,!0);if(f)return f(g,!0);var j=new Error("Cannot find module '"+g+"'");throw j.code="MODULE_NOT_FOUND",j}var k=c[g]={exports:{}};b[g][0].call(k.exports,function(a){var c=b[g][1][a];return e(c?c:a)},k,k.exports,a,b,c,d)}return c[g].exports}for(var f="function"==typeof require&&require,g=0;g<d.length;g++)e(d[g]);return e}({1:[function(a,b,c){"use strict";function d(){}function e(a){if("function"!=typeof a)throw new TypeError("resolver must be a function");this.state=s,this.queue=[],this.outcome=void 0,a!==d&&i(this,a)}function f(a,b,c){this.promise=a,"function"==typeof b&&(this.onFulfilled=b,this.callFulfilled=this.otherCallFulfilled),"function"==typeof c&&(this.onRejected=c,this.callRejected=this.otherCallRejected)}function g(a,b,c){o(function(){var d;try{d=b(c)}catch(b){return p.reject(a,b)}d===a?p.reject(a,new TypeError("Cannot resolve promise with itself")):p.resolve(a,d)})}function h(a){var b=a&&a.then;if(a&&"object"==typeof a&&"function"==typeof b)return function(){b.apply(a,arguments)}}function i(a,b){function c(b){f||(f=!0,p.reject(a,b))}function d(b){f||(f=!0,p.resolve(a,b))}function e(){b(d,c)}var f=!1,g=j(e);"error"===g.status&&c(g.value)}function j(a,b){var c={};try{c.value=a(b),c.status="success"}catch(a){c.status="error",c.value=a}return c}function k(a){return a instanceof this?a:p.resolve(new this(d),a)}function l(a){var b=new this(d);return p.reject(b,a)}function m(a){function b(a,b){function d(a){g[b]=a,++h!==e||f||(f=!0,p.resolve(j,g))}c.resolve(a).then(d,function(a){f||(f=!0,p.reject(j,a))})}var c=this;if("[object Array]"!==Object.prototype.toString.call(a))return this.reject(new TypeError("must be an array"));var e=a.length,f=!1;if(!e)return this.resolve([]);for(var g=new Array(e),h=0,i=-1,j=new this(d);++i<e;)b(a[i],i);return j}function n(a){function b(a){c.resolve(a).then(function(a){f||(f=!0,p.resolve(h,a))},function(a){f||(f=!0,p.reject(h,a))})}var c=this;if("[object Array]"!==Object.prototype.toString.call(a))return this.reject(new TypeError("must be an array"));var e=a.length,f=!1;if(!e)return this.resolve([]);for(var g=-1,h=new this(d);++g<e;)b(a[g]);return h}var o=a(2),p={},q=["REJECTED"],r=["FULFILLED"],s=["PENDING"];b.exports=c=e,e.prototype.catch=function(a){return this.then(null,a)},e.prototype.then=function(a,b){if("function"!=typeof a&&this.state===r||"function"!=typeof b&&this.state===q)return this;var c=new this.constructor(d);if(this.state!==s){var e=this.state===r?a:b;g(c,e,this.outcome)}else this.queue.push(new f(c,a,b));return c},f.prototype.callFulfilled=function(a){p.resolve(this.promise,a)},f.prototype.otherCallFulfilled=function(a){g(this.promise,this.onFulfilled,a)},f.prototype.callRejected=function(a){p.reject(this.promise,a)},f.prototype.otherCallRejected=function(a){g(this.promise,this.onRejected,a)},p.resolve=function(a,b){var c=j(h,b);if("error"===c.status)return p.reject(a,c.value);var d=c.value;if(d)i(a,d);else{a.state=r,a.outcome=b;for(var e=-1,f=a.queue.length;++e<f;)a.queue[e].callFulfilled(b)}return a},p.reject=function(a,b){a.state=q,a.outcome=b;for(var c=-1,d=a.queue.length;++c<d;)a.queue[c].callRejected(b);return a},c.resolve=k,c.reject=l,c.all=m,c.race=n},{2:2}],2:[function(a,b,c){(function(a){"use strict";function c(){k=!0;for(var a,b,c=l.length;c;){for(b=l,l=[],a=-1;++a<c;)b[a]();c=l.length}k=!1}function d(a){1!==l.push(a)||k||e()}var e,f=a.MutationObserver||a.WebKitMutationObserver;if(f){var g=0,h=new f(c),i=a.document.createTextNode("");h.observe(i,{characterData:!0}),e=function(){i.data=g=++g%2}}else if(a.setImmediate||"undefined"==typeof a.MessageChannel)e="document"in a&&"onreadystatechange"in a.document.createElement("script")?function(){var b=a.document.createElement("script");b.onreadystatechange=function(){c(),b.onreadystatechange=null,b.parentNode.removeChild(b),b=null},a.document.documentElement.appendChild(b)}:function(){setTimeout(c,0)};else{var j=new a.MessageChannel;j.port1.onmessage=c,e=function(){j.port2.postMessage(0)}}var k,l=[];b.exports=d}).call(this,"undefined"!=typeof global?global:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}],3:[function(a,b,c){(function(b){"use strict";"function"!=typeof b.Promise&&(b.Promise=a(1))}).call(this,"undefined"!=typeof global?global:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{1:1}],4:[function(a,b,c){"use strict";function d(a,b){if(!(a instanceof b))throw new TypeError("Cannot call a class as a function")}function e(){try{if("undefined"!=typeof indexedDB)return indexedDB;if("undefined"!=typeof webkitIndexedDB)return webkitIndexedDB;if("undefined"!=typeof mozIndexedDB)return mozIndexedDB;if("undefined"!=typeof OIndexedDB)return OIndexedDB;if("undefined"!=typeof msIndexedDB)return msIndexedDB}catch(a){}}function f(){try{return!!fa&&(!("undefined"!=typeof openDatabase&&"undefined"!=typeof navigator&&navigator.userAgent&&/Safari/.test(navigator.userAgent)&&!/Chrome/.test(navigator.userAgent))&&(fa&&"function"==typeof fa.open&&"undefined"!=typeof IDBKeyRange))}catch(a){return!1}}function g(){return"function"==typeof openDatabase}function h(){try{return"undefined"!=typeof localStorage&&"setItem"in localStorage&&localStorage.setItem}catch(a){return!1}}function i(a,b){a=a||[],b=b||{};try{return new Blob(a,b)}catch(f){if("TypeError"!==f.name)throw f;for(var c="undefined"!=typeof BlobBuilder?BlobBuilder:"undefined"!=typeof MSBlobBuilder?MSBlobBuilder:"undefined"!=typeof MozBlobBuilder?MozBlobBuilder:WebKitBlobBuilder,d=new c,e=0;e<a.length;e+=1)d.append(a[e]);return d.getBlob(b.type)}}function j(a,b){b&&a.then(function(a){b(null,a)},function(a){b(a)})}function k(a,b,c){"function"==typeof b&&a.then(b),"function"==typeof c&&a.catch(c)}function l(a){for(var b=a.length,c=new ArrayBuffer(b),d=new Uint8Array(c),e=0;e<b;e++)d[e]=a.charCodeAt(e);return c}function m(a){return new ia(function(b){var c=i([""]);a.objectStore(ja).put(c,"key"),a.onabort=function(a){a.preventDefault(),a.stopPropagation(),b(!1)},a.oncomplete=function(){var a=navigator.userAgent.match(/Chrome\/(\d+)/),c=navigator.userAgent.match(/Edge\//);b(c||!a||parseInt(a[1],10)>=43)}}).catch(function(){return!1})}function n(a){return"boolean"==typeof ga?ia.resolve(ga):m(a).then(function(a){return ga=a})}function o(a){var b=ha[a.name],c={};c.promise=new ia(function(a){c.resolve=a}),b.deferredOperations.push(c),b.dbReady?b.dbReady=b.dbReady.then(function(){return c.promise}):b.dbReady=c.promise}function p(a){var b=ha[a.name],c=b.deferredOperations.pop();c&&c.resolve()}function q(a,b){return new ia(function(c,d){if(a.db){if(!b)return c(a.db);o(a),a.db.close()}var e=[a.name];b&&e.push(a.version);var f=fa.open.apply(fa,e);b&&(f.onupgradeneeded=function(b){var c=f.result;try{c.createObjectStore(a.storeName),b.oldVersion<=1&&c.createObjectStore(ja)}catch(c){if("ConstraintError"!==c.name)throw c;console.warn('The database "'+a.name+'" has been upgraded from version '+b.oldVersion+" to version "+b.newVersion+', but the storage "'+a.storeName+'" already exists.')}}),f.onerror=function(){d(f.error)},f.onsuccess=function(){c(f.result),p(a)}})}function r(a){return q(a,!1)}function s(a){return q(a,!0)}function t(a,b){if(!a.db)return!0;var c=!a.db.objectStoreNames.contains(a.storeName),d=a.version<a.db.version,e=a.version>a.db.version;if(d&&(a.version!==b&&console.warn('The database "'+a.name+"\" can't be downgraded from version "+a.db.version+" to version "+a.version+"."),a.version=a.db.version),e||c){if(c){var f=a.db.version+1;f>a.version&&(a.version=f)}return!0}return!1}function u(a){return new ia(function(b,c){var d=new FileReader;d.onerror=c,d.onloadend=function(c){var d=btoa(c.target.result||"");b({__local_forage_encoded_blob:!0,data:d,type:a.type})},d.readAsBinaryString(a)})}function v(a){var b=l(atob(a.data));return i([b],{type:a.type})}function w(a){return a&&a.__local_forage_encoded_blob}function x(a){var b=this,c=b._initReady().then(function(){var a=ha[b._dbInfo.name];if(a&&a.dbReady)return a.dbReady});return k(c,a,a),c}function y(a){function b(){return ia.resolve()}var c=this,d={db:null};if(a)for(var e in a)d[e]=a[e];ha||(ha={});var f=ha[d.name];f||(f={forages:[],db:null,dbReady:null,deferredOperations:[]},ha[d.name]=f),f.forages.push(c),c._initReady||(c._initReady=c.ready,c.ready=x);for(var g=[],h=0;h<f.forages.length;h++){var i=f.forages[h];i!==c&&g.push(i._initReady().catch(b))}var j=f.forages.slice(0);return ia.all(g).then(function(){return d.db=f.db,r(d)}).then(function(a){return d.db=a,t(d,c._defaultConfig.version)?s(d):a}).then(function(a){d.db=f.db=a,c._dbInfo=d;for(var b=0;b<j.length;b++){var e=j[b];e!==c&&(e._dbInfo.db=d.db,e._dbInfo.version=d.version)}})}function z(a,b){var c=this;"string"!=typeof a&&(console.warn(a+" used as a key, but it is not a string."),a=String(a));var d=new ia(function(b,d){c.ready().then(function(){var e=c._dbInfo,f=e.db.transaction(e.storeName,"readonly").objectStore(e.storeName),g=f.get(a);g.onsuccess=function(){var a=g.result;void 0===a&&(a=null),w(a)&&(a=v(a)),b(a)},g.onerror=function(){d(g.error)}}).catch(d)});return j(d,b),d}function A(a,b){var c=this,d=new ia(function(b,d){c.ready().then(function(){var e=c._dbInfo,f=e.db.transaction(e.storeName,"readonly").objectStore(e.storeName),g=f.openCursor(),h=1;g.onsuccess=function(){var c=g.result;if(c){var d=c.value;w(d)&&(d=v(d));var e=a(d,c.key,h++);void 0!==e?b(e):c.continue()}else b()},g.onerror=function(){d(g.error)}}).catch(d)});return j(d,b),d}function B(a,b,c){var d=this;"string"!=typeof a&&(console.warn(a+" used as a key, but it is not a string."),a=String(a));var e=new ia(function(c,e){var f;d.ready().then(function(){return f=d._dbInfo,"[object Blob]"===ka.call(b)?n(f.db).then(function(a){return a?b:u(b)}):b}).then(function(b){var d=f.db.transaction(f.storeName,"readwrite"),g=d.objectStore(f.storeName),h=g.put(b,a);null===b&&(b=void 0),d.oncomplete=function(){void 0===b&&(b=null),c(b)},d.onabort=d.onerror=function(){var a=h.error?h.error:h.transaction.error;e(a)}}).catch(e)});return j(e,c),e}function C(a,b){var c=this;"string"!=typeof a&&(console.warn(a+" used as a key, but it is not a string."),a=String(a));var d=new ia(function(b,d){c.ready().then(function(){var e=c._dbInfo,f=e.db.transaction(e.storeName,"readwrite"),g=f.objectStore(e.storeName),h=g.delete(a);f.oncomplete=function(){b()},f.onerror=function(){d(h.error)},f.onabort=function(){var a=h.error?h.error:h.transaction.error;d(a)}}).catch(d)});return j(d,b),d}function D(a){var b=this,c=new ia(function(a,c){b.ready().then(function(){var d=b._dbInfo,e=d.db.transaction(d.storeName,"readwrite"),f=e.objectStore(d.storeName),g=f.clear();e.oncomplete=function(){a()},e.onabort=e.onerror=function(){var a=g.error?g.error:g.transaction.error;c(a)}}).catch(c)});return j(c,a),c}function E(a){var b=this,c=new ia(function(a,c){b.ready().then(function(){var d=b._dbInfo,e=d.db.transaction(d.storeName,"readonly").objectStore(d.storeName),f=e.count();f.onsuccess=function(){a(f.result)},f.onerror=function(){c(f.error)}}).catch(c)});return j(c,a),c}function F(a,b){var c=this,d=new ia(function(b,d){return a<0?void b(null):void c.ready().then(function(){var e=c._dbInfo,f=e.db.transaction(e.storeName,"readonly").objectStore(e.storeName),g=!1,h=f.openCursor();h.onsuccess=function(){var c=h.result;return c?void(0===a?b(c.key):g?b(c.key):(g=!0,c.advance(a))):void b(null)},h.onerror=function(){d(h.error)}}).catch(d)});return j(d,b),d}function G(a){var b=this,c=new ia(function(a,c){b.ready().then(function(){var d=b._dbInfo,e=d.db.transaction(d.storeName,"readonly").objectStore(d.storeName),f=e.openCursor(),g=[];f.onsuccess=function(){var b=f.result;return b?(g.push(b.key),void b.continue()):void a(g)},f.onerror=function(){c(f.error)}}).catch(c)});return j(c,a),c}function H(a){var b,c,d,e,f,g=.75*a.length,h=a.length,i=0;"="===a[a.length-1]&&(g--,"="===a[a.length-2]&&g--);var j=new ArrayBuffer(g),k=new Uint8Array(j);for(b=0;b<h;b+=4)c=ma.indexOf(a[b]),d=ma.indexOf(a[b+1]),e=ma.indexOf(a[b+2]),f=ma.indexOf(a[b+3]),k[i++]=c<<2|d>>4,k[i++]=(15&d)<<4|e>>2,k[i++]=(3&e)<<6|63&f;return j}function I(a){var b,c=new Uint8Array(a),d="";for(b=0;b<c.length;b+=3)d+=ma[c[b]>>2],d+=ma[(3&c[b])<<4|c[b+1]>>4],d+=ma[(15&c[b+1])<<2|c[b+2]>>6],d+=ma[63&c[b+2]];return c.length%3===2?d=d.substring(0,d.length-1)+"=":c.length%3===1&&(d=d.substring(0,d.length-2)+"=="),d}function J(a,b){var c="";if(a&&(c=Da.call(a)),a&&("[object ArrayBuffer]"===c||a.buffer&&"[object ArrayBuffer]"===Da.call(a.buffer))){var d,e=pa;a instanceof ArrayBuffer?(d=a,e+=ra):(d=a.buffer,"[object Int8Array]"===c?e+=ta:"[object Uint8Array]"===c?e+=ua:"[object Uint8ClampedArray]"===c?e+=va:"[object Int16Array]"===c?e+=wa:"[object Uint16Array]"===c?e+=ya:"[object Int32Array]"===c?e+=xa:"[object Uint32Array]"===c?e+=za:"[object Float32Array]"===c?e+=Aa:"[object Float64Array]"===c?e+=Ba:b(new Error("Failed to get type for BinaryArray"))),b(e+I(d))}else if("[object Blob]"===c){var f=new FileReader;f.onload=function(){var c=na+a.type+"~"+I(this.result);b(pa+sa+c)},f.readAsArrayBuffer(a)}else try{b(JSON.stringify(a))}catch(c){console.error("Couldn't convert value into a JSON string: ",a),b(null,c)}}function K(a){if(a.substring(0,qa)!==pa)return JSON.parse(a);var b,c=a.substring(Ca),d=a.substring(qa,Ca);if(d===sa&&oa.test(c)){var e=c.match(oa);b=e[1],c=c.substring(e[0].length)}var f=H(c);switch(d){case ra:return f;case sa:return i([f],{type:b});case ta:return new Int8Array(f);case ua:return new Uint8Array(f);case va:return new Uint8ClampedArray(f);case wa:return new Int16Array(f);case ya:return new Uint16Array(f);case xa:return new Int32Array(f);case za:return new Uint32Array(f);case Aa:return new Float32Array(f);case Ba:return new Float64Array(f);default:throw new Error("Unkown type: "+d)}}function L(a){var b=this,c={db:null};if(a)for(var d in a)c[d]="string"!=typeof a[d]?a[d].toString():a[d];var e=new ia(function(a,d){try{c.db=openDatabase(c.name,String(c.version),c.description,c.size)}catch(a){return d(a)}c.db.transaction(function(e){e.executeSql("CREATE TABLE IF NOT EXISTS "+c.storeName+" (id INTEGER PRIMARY KEY, key unique, value)",[],function(){b._dbInfo=c,a()},function(a,b){d(b)})})});return c.serializer=Ea,e}function M(a,b){var c=this;"string"!=typeof a&&(console.warn(a+" used as a key, but it is not a string."),a=String(a));var d=new ia(function(b,d){c.ready().then(function(){var e=c._dbInfo;e.db.transaction(function(c){c.executeSql("SELECT * FROM "+e.storeName+" WHERE key = ? LIMIT 1",[a],function(a,c){var d=c.rows.length?c.rows.item(0).value:null;d&&(d=e.serializer.deserialize(d)),b(d)},function(a,b){d(b)})})}).catch(d)});return j(d,b),d}function N(a,b){var c=this,d=new ia(function(b,d){c.ready().then(function(){var e=c._dbInfo;e.db.transaction(function(c){c.executeSql("SELECT * FROM "+e.storeName,[],function(c,d){for(var f=d.rows,g=f.length,h=0;h<g;h++){var i=f.item(h),j=i.value;if(j&&(j=e.serializer.deserialize(j)),j=a(j,i.key,h+1),void 0!==j)return void b(j)}b()},function(a,b){d(b)})})}).catch(d)});return j(d,b),d}function O(a,b,c){var d=this;"string"!=typeof a&&(console.warn(a+" used as a key, but it is not a string."),a=String(a));var e=new ia(function(c,e){d.ready().then(function(){void 0===b&&(b=null);var f=b,g=d._dbInfo;g.serializer.serialize(b,function(b,d){d?e(d):g.db.transaction(function(d){d.executeSql("INSERT OR REPLACE INTO "+g.storeName+" (key, value) VALUES (?, ?)",[a,b],function(){c(f)},function(a,b){e(b)})},function(a){a.code===a.QUOTA_ERR&&e(a)})})}).catch(e)});return j(e,c),e}function P(a,b){var c=this;"string"!=typeof a&&(console.warn(a+" used as a key, but it is not a string."),a=String(a));var d=new ia(function(b,d){c.ready().then(function(){var e=c._dbInfo;e.db.transaction(function(c){c.executeSql("DELETE FROM "+e.storeName+" WHERE key = ?",[a],function(){b()},function(a,b){d(b)})})}).catch(d)});return j(d,b),d}function Q(a){var b=this,c=new ia(function(a,c){b.ready().then(function(){var d=b._dbInfo;d.db.transaction(function(b){b.executeSql("DELETE FROM "+d.storeName,[],function(){a()},function(a,b){c(b)})})}).catch(c)});return j(c,a),c}function R(a){var b=this,c=new ia(function(a,c){b.ready().then(function(){var d=b._dbInfo;d.db.transaction(function(b){b.executeSql("SELECT COUNT(key) as c FROM "+d.storeName,[],function(b,c){var d=c.rows.item(0).c;a(d)},function(a,b){c(b)})})}).catch(c)});return j(c,a),c}function S(a,b){var c=this,d=new ia(function(b,d){c.ready().then(function(){var e=c._dbInfo;e.db.transaction(function(c){c.executeSql("SELECT key FROM "+e.storeName+" WHERE id = ? LIMIT 1",[a+1],function(a,c){var d=c.rows.length?c.rows.item(0).key:null;b(d)},function(a,b){d(b)})})}).catch(d)});return j(d,b),d}function T(a){var b=this,c=new ia(function(a,c){b.ready().then(function(){var d=b._dbInfo;d.db.transaction(function(b){b.executeSql("SELECT key FROM "+d.storeName,[],function(b,c){for(var d=[],e=0;e<c.rows.length;e++)d.push(c.rows.item(e).key);a(d)},function(a,b){c(b)})})}).catch(c)});return j(c,a),c}function U(a){var b=this,c={};if(a)for(var d in a)c[d]=a[d];return c.keyPrefix=c.name+"/",c.storeName!==b._defaultConfig.storeName&&(c.keyPrefix+=c.storeName+"/"),b._dbInfo=c,c.serializer=Ea,ia.resolve()}function V(a){var b=this,c=b.ready().then(function(){for(var a=b._dbInfo.keyPrefix,c=localStorage.length-1;c>=0;c--){var d=localStorage.key(c);0===d.indexOf(a)&&localStorage.removeItem(d)}});return j(c,a),c}function W(a,b){var c=this;"string"!=typeof a&&(console.warn(a+" used as a key, but it is not a string."),a=String(a));var d=c.ready().then(function(){var b=c._dbInfo,d=localStorage.getItem(b.keyPrefix+a);return d&&(d=b.serializer.deserialize(d)),d});return j(d,b),d}function X(a,b){var c=this,d=c.ready().then(function(){for(var b=c._dbInfo,d=b.keyPrefix,e=d.length,f=localStorage.length,g=1,h=0;h<f;h++){var i=localStorage.key(h);if(0===i.indexOf(d)){var j=localStorage.getItem(i);if(j&&(j=b.serializer.deserialize(j)),j=a(j,i.substring(e),g++),void 0!==j)return j}}});return j(d,b),d}function Y(a,b){var c=this,d=c.ready().then(function(){var b,d=c._dbInfo;try{b=localStorage.key(a)}catch(a){b=null}return b&&(b=b.substring(d.keyPrefix.length)),b});return j(d,b),d}function Z(a){var b=this,c=b.ready().then(function(){for(var a=b._dbInfo,c=localStorage.length,d=[],e=0;e<c;e++)0===localStorage.key(e).indexOf(a.keyPrefix)&&d.push(localStorage.key(e).substring(a.keyPrefix.length));return d});return j(c,a),c}function $(a){var b=this,c=b.keys().then(function(a){return a.length});return j(c,a),c}function _(a,b){var c=this;"string"!=typeof a&&(console.warn(a+" used as a key, but it is not a string."),a=String(a));var d=c.ready().then(function(){var b=c._dbInfo;localStorage.removeItem(b.keyPrefix+a)});return j(d,b),d}function aa(a,b,c){var d=this;"string"!=typeof a&&(console.warn(a+" used as a key, but it is not a string."),a=String(a));var e=d.ready().then(function(){void 0===b&&(b=null);var c=b;return new ia(function(e,f){var g=d._dbInfo;g.serializer.serialize(b,function(b,d){if(d)f(d);else try{localStorage.setItem(g.keyPrefix+a,b),e(c)}catch(a){"QuotaExceededError"!==a.name&&"NS_ERROR_DOM_QUOTA_REACHED"!==a.name||f(a),f(a)}})})});return j(e,c),e}function ba(a,b){a[b]=function(){var c=arguments;return a.ready().then(function(){return a[b].apply(a,c)})}}function ca(){for(var a=1;a<arguments.length;a++){var b=arguments[a];if(b)for(var c in b)b.hasOwnProperty(c)&&(Na(b[c])?arguments[0][c]=b[c].slice():arguments[0][c]=b[c])}return arguments[0]}function da(a){for(var b in Ia)if(Ia.hasOwnProperty(b)&&Ia[b]===a)return!0;return!1}var ea="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(a){return typeof a}:function(a){return a&&"function"==typeof Symbol&&a.constructor===Symbol&&a!==Symbol.prototype?"symbol":typeof a},fa=e();"undefined"==typeof Promise&&"undefined"!=typeof a&&a(3);var ga,ha,ia=Promise,ja="local-forage-detect-blob-support",ka=Object.prototype.toString,la={_driver:"asyncStorage",_initStorage:y,iterate:A,getItem:z,setItem:B,removeItem:C,clear:D,length:E,key:F,keys:G},ma="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",na="~~local_forage_type~",oa=/^~~local_forage_type~([^~]+)~/,pa="__lfsc__:",qa=pa.length,ra="arbf",sa="blob",ta="si08",ua="ui08",va="uic8",wa="si16",xa="si32",ya="ur16",za="ui32",Aa="fl32",Ba="fl64",Ca=qa+ra.length,Da=Object.prototype.toString,Ea={serialize:J,deserialize:K,stringToBuffer:H,bufferToString:I},Fa={_driver:"webSQLStorage",_initStorage:L,iterate:N,getItem:M,setItem:O,removeItem:P,clear:Q,length:R,key:S,keys:T},Ga={_driver:"localStorageWrapper",_initStorage:U,iterate:X,getItem:W,setItem:aa,removeItem:_,clear:V,length:$,key:Y,keys:Z},Ha={},Ia={INDEXEDDB:"asyncStorage",LOCALSTORAGE:"localStorageWrapper",WEBSQL:"webSQLStorage"},Ja=[Ia.INDEXEDDB,Ia.WEBSQL,Ia.LOCALSTORAGE],Ka=["clear","getItem","iterate","key","keys","length","removeItem","setItem"],La={description:"",driver:Ja.slice(),name:"localforage",size:4980736,storeName:"keyvaluepairs",version:1},Ma={};Ma[Ia.INDEXEDDB]=f(),Ma[Ia.WEBSQL]=g(),Ma[Ia.LOCALSTORAGE]=h();var Na=Array.isArray||function(a){return"[object Array]"===Object.prototype.toString.call(a)},Oa=function(){function a(b){d(this,a),this.INDEXEDDB=Ia.INDEXEDDB,this.LOCALSTORAGE=Ia.LOCALSTORAGE,this.WEBSQL=Ia.WEBSQL,this._defaultConfig=ca({},La),this._config=ca({},this._defaultConfig,b),this._driverSet=null,this._initDriver=null,this._ready=!1,this._dbInfo=null,this._wrapLibraryMethodsWithReady(),this.setDriver(this._config.driver)}return a.prototype.config=function(a){if("object"===("undefined"==typeof a?"undefined":ea(a))){if(this._ready)return new Error("Can't call config() after localforage has been used.");for(var b in a){if("storeName"===b&&(a[b]=a[b].replace(/\W/g,"_")),"version"===b&&"number"!=typeof a[b])return new Error("Database version must be a number.");this._config[b]=a[b]}return"driver"in a&&a.driver&&this.setDriver(this._config.driver),!0}return"string"==typeof a?this._config[a]:this._config},a.prototype.defineDriver=function(a,b,c){var d=new ia(function(b,c){try{var d=a._driver,e=new Error("Custom driver not compliant; see https://mozilla.github.io/localForage/#definedriver"),f=new Error("Custom driver name already in use: "+a._driver);if(!a._driver)return void c(e);if(da(a._driver))return void c(f);for(var g=Ka.concat("_initStorage"),h=0;h<g.length;h++){var i=g[h];if(!i||!a[i]||"function"!=typeof a[i])return void c(e)}var j=ia.resolve(!0);"_support"in a&&(j=a._support&&"function"==typeof a._support?a._support():ia.resolve(!!a._support)),j.then(function(c){Ma[d]=c,Ha[d]=a,b()},c)}catch(a){c(a)}});return k(d,b,c),d},a.prototype.driver=function(){return this._driver||null},a.prototype.getDriver=function(a,b,c){var d=this,e=ia.resolve().then(function(){if(!da(a)){if(Ha[a])return Ha[a];throw new Error("Driver not found.")}switch(a){case d.INDEXEDDB:return la;case d.LOCALSTORAGE:return Ga;case d.WEBSQL:return Fa}});return k(e,b,c),e},a.prototype.getSerializer=function(a){var b=ia.resolve(Ea);return k(b,a),b},a.prototype.ready=function(a){var b=this,c=b._driverSet.then(function(){return null===b._ready&&(b._ready=b._initDriver()),b._ready});return k(c,a,a),c},a.prototype.setDriver=function(a,b,c){function d(){g._config.driver=g.driver()}function e(a){return g._extend(a),d(),g._ready=g._initStorage(g._config),g._ready}function f(a){return function(){function b(){for(;c<a.length;){var f=a[c];return c++,g._dbInfo=null,g._ready=null,g.getDriver(f).then(e).catch(b)}d();var h=new Error("No available storage method found.");return g._driverSet=ia.reject(h),g._driverSet}var c=0;return b()}}var g=this;Na(a)||(a=[a]);var h=this._getSupportedDrivers(a),i=null!==this._driverSet?this._driverSet.catch(function(){return ia.resolve()}):ia.resolve();return this._driverSet=i.then(function(){var a=h[0];return g._dbInfo=null,g._ready=null,g.getDriver(a).then(function(a){g._driver=a._driver,d(),g._wrapLibraryMethodsWithReady(),g._initDriver=f(h)})}).catch(function(){d();var a=new Error("No available storage method found.");return g._driverSet=ia.reject(a),g._driverSet}),k(this._driverSet,b,c),this._driverSet},a.prototype.supports=function(a){return!!Ma[a]},a.prototype._extend=function(a){ca(this,a)},a.prototype._getSupportedDrivers=function(a){for(var b=[],c=0,d=a.length;c<d;c++){var e=a[c];this.supports(e)&&b.push(e)}return b},a.prototype._wrapLibraryMethodsWithReady=function(){for(var a=0;a<Ka.length;a++)ba(this,Ka[a])},a.prototype.createInstance=function(b){return new a(b)},a}(),Pa=new Oa;b.exports=Pa},{3:3}]},{},[4])(4)});
}

})();

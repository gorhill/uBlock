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

/* global self, µBlock */

// For background page

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var vAPI = self.vAPI = self.vAPI || {};

var chrome = self.chrome;
var manifest = chrome.runtime.getManifest();

vAPI.chrome = true;

var noopFunc = function(){};

/******************************************************************************/

vAPI.app = {
    name: manifest.name,
    version: manifest.version
};

/******************************************************************************/

vAPI.app.restart = function() {
    chrome.runtime.reload();
};

/******************************************************************************/

vAPI.storage = chrome.storage.local;

/******************************************************************************/

vAPI.tabs = {};

/******************************************************************************/

vAPI.isNoTabId = function(tabId) {
    return tabId.toString() === '-1';
};

vAPI.noTabId = '-1';

/******************************************************************************/

vAPI.tabs.registerListeners = function() {
    if ( typeof this.onNavigation === 'function' ) {
        chrome.webNavigation.onCommitted.addListener(this.onNavigation);
    }

    if ( typeof this.onUpdated === 'function' ) {
        chrome.tabs.onUpdated.addListener(this.onUpdated);
    }

    if ( typeof this.onClosed === 'function' ) {
        chrome.tabs.onRemoved.addListener(this.onClosed);
    }

    if ( typeof this.onPopup === 'function' ) {
        chrome.webNavigation.onCreatedNavigationTarget.addListener(this.onPopup);
    }
};

/******************************************************************************/

vAPI.tabs.get = function(tabId, callback) {
    var onTabReady = function(tab) {
        // https://code.google.com/p/chromium/issues/detail?id=410868#c8
        if ( chrome.runtime.lastError ) {
            /* noop */
        }
        // Caller must be prepared to deal with nil tab value
        callback(tab);
    };
    if ( tabId !== null ) {
        if ( typeof tabId === 'string' ) {
            tabId = parseInt(tabId, 10);
        }
        chrome.tabs.get(tabId, onTabReady);
        return;
    }
    var onTabReceived = function(tabs) {
        // https://code.google.com/p/chromium/issues/detail?id=410868#c8
        if ( chrome.runtime.lastError ) {
            /* noop */
        }
        callback(tabs[0]);
    };
    chrome.tabs.query({ active: true, currentWindow: true }, onTabReceived);
};

/******************************************************************************/

// properties of the details object:
//   url: 'URL', // the address that will be opened
//   tabId: 1, // the tab is used if set, instead of creating a new one
//   index: -1, // undefined: end of the list, -1: following tab, or after index
//   active: false, // opens the tab in background - true and undefined: foreground
//   select: true // if a tab is already opened with that url, then select it instead of opening a new one

vAPI.tabs.open = function(details) {
    var targetURL = details.url;
    if ( typeof targetURL !== 'string' || targetURL === '' ) {
        return null;
    }
    // extension pages
    if ( /^[\w-]{2,}:/.test(targetURL) !== true ) {
        targetURL = vAPI.getURL(targetURL);
    }

    // dealing with Chrome's asynchronous API
    var wrapper = function() {
        if ( details.active === undefined ) {
            details.active = true;
        }

        var subWrapper = function() {
            var _details = {
                url: targetURL,
                active: !!details.active
            };

            if ( details.tabId ) {
                // update doesn't accept index, must use move
                chrome.tabs.update(parseInt(details.tabId, 10), _details, function(tab) {
                    // if the tab doesn't exist
                    if ( vAPI.lastError() ) {
                        chrome.tabs.create(_details);
                    } else if ( details.index !== undefined ) {
                        chrome.tabs.move(tab.id, {index: details.index});
                    }
                });
            } else {
                if ( details.index !== undefined ) {
                    _details.index = details.index;
                }

                chrome.tabs.create(_details);
            }
        };

        if ( details.index === -1 ) {
            vAPI.tabs.get(null, function(tab) {
                if ( tab ) {
                    details.index = tab.index + 1;
                } else {
                    delete details.index;
                }

                subWrapper();
            });
        }
        else {
            subWrapper();
        }
    };

    if ( details.select ) {
        chrome.tabs.query({ currentWindow: true }, function(tabs) {
            var rgxHash = /#.*/;
            // this is questionable
            var url = targetURL.replace(rgxHash, '');
            var selected = tabs.some(function(tab) {
                if ( tab.url.replace(rgxHash, '') === url ) {
                    chrome.tabs.update(tab.id, { active: true });
                    return true;
                }
            });

            if ( !selected ) {
                wrapper();
            }
        });
    }
    else {
        wrapper();
    }
};

/******************************************************************************/

vAPI.tabs.remove = function(tabId) {
    var onTabRemoved = function() {
        if ( vAPI.lastError() ) {
        }
    };
    chrome.tabs.remove(parseInt(tabId, 10), onTabRemoved);
};

/******************************************************************************/

vAPI.tabs.reload = function(tabId /*, flags*/) {
    if ( typeof tabId === 'string' ) {
        tabId = parseInt(tabId, 10);
    }
    chrome.tabs.reload(tabId);
};

/******************************************************************************/

vAPI.tabs.injectScript = function(tabId, details, callback) {
    var onScriptExecuted = function() {
        // https://code.google.com/p/chromium/issues/detail?id=410868#c8
        if ( chrome.runtime.lastError ) {
        }
        if ( typeof callback === 'function' ) {
            callback();
        }
    };
    if ( tabId ) {
        tabId = parseInt(tabId, 10);
        chrome.tabs.executeScript(tabId, details, onScriptExecuted);
    } else {
        chrome.tabs.executeScript(details, onScriptExecuted);
    }
};

/******************************************************************************/

// Must read: https://code.google.com/p/chromium/issues/detail?id=410868#c8

// https://github.com/gorhill/uBlock/issues/19
// https://github.com/gorhill/uBlock/issues/207
// Since we may be called asynchronously, the tab id may not exist
// anymore, so this ensures it does still exist.

vAPI.setIcon = function(tabId, iconStatus, badge) {
    tabId = parseInt(tabId, 10);
    var onIconReady = function() {
        if ( vAPI.lastError() ) {
            return;
        }
        chrome.browserAction.setBadgeText({ tabId: tabId, text: badge });
        if ( badge !== '' ) {
            chrome.browserAction.setBadgeBackgroundColor({
                tabId: tabId,
                color: '#666'
            });
        }
    };

    var iconPaths = iconStatus === 'on' ?
        { '19': 'img/browsericons/icon19.png',     '38': 'img/browsericons/icon38.png' } :
        { '19': 'img/browsericons/icon19-off.png', '38': 'img/browsericons/icon38-off.png' };

    chrome.browserAction.setIcon({ tabId: tabId, path: iconPaths }, onIconReady);
};

/******************************************************************************/

vAPI.messaging = {
    ports: {},
    listeners: {},
    defaultHandler: null,
    NOOPFUNC: noopFunc,
    UNHANDLED: 'vAPI.messaging.notHandled'
};

/******************************************************************************/

vAPI.messaging.listen = function(listenerName, callback) {
    this.listeners[listenerName] = callback;
};

/******************************************************************************/

vAPI.messaging.onPortMessage = function(request, port) {
    var callback = vAPI.messaging.NOOPFUNC;
    if ( request.requestId !== undefined ) {
        callback = CallbackWrapper.factory(port, request).callback;
    }

    // Specific handler
    var r = vAPI.messaging.UNHANDLED;
    var listener = vAPI.messaging.listeners[request.channelName];
    if ( typeof listener === 'function' ) {
        r = listener(request.msg, port.sender, callback);
    }
    if ( r !== vAPI.messaging.UNHANDLED ) {
        return;
    }

    // Default handler
    r = vAPI.messaging.defaultHandler(request.msg, port.sender, callback);
    if ( r !== vAPI.messaging.UNHANDLED ) {
        return;
    }

    console.error('µBlock> messaging > unknown request: %o', request);

    // Unhandled:
    // Need to callback anyways in case caller expected an answer, or
    // else there is a memory leak on caller's side
    callback();
};

/******************************************************************************/

vAPI.messaging.onPortDisconnect = function(port) {
    port.onDisconnect.removeListener(vAPI.messaging.onPortDisconnect);
    port.onMessage.removeListener(vAPI.messaging.onPortMessage);
    delete vAPI.messaging.ports[port.name];
};

/******************************************************************************/

vAPI.messaging.onPortConnect = function(port) {
    port.onDisconnect.addListener(vAPI.messaging.onPortDisconnect);
    port.onMessage.addListener(vAPI.messaging.onPortMessage);
    vAPI.messaging.ports[port.name] = port;
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

    chrome.runtime.onConnect.addListener(this.onPortConnect);
};

/******************************************************************************/

vAPI.messaging.broadcast = function(message) {
    var messageWrapper = {
        broadcast: true,
        msg: message
    };

    for ( var portName in this.ports ) {
        if ( this.ports.hasOwnProperty(portName) === false ) {
            continue;
        }
        this.ports[portName].postMessage(messageWrapper);
    }
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

var CallbackWrapper = function(port, request) {
    // No need to bind every single time
    this.callback = this.proxy.bind(this);
    this.messaging = vAPI.messaging;
    this.init(port, request);
};

CallbackWrapper.junkyard = [];

CallbackWrapper.factory = function(port, request) {
    var wrapper = CallbackWrapper.junkyard.pop();
    if ( wrapper ) {
        wrapper.init(port, request);
        return wrapper;
    }
    return new CallbackWrapper(port, request);
};

CallbackWrapper.prototype.init = function(port, request) {
    this.port = port;
    this.request = request;
};

CallbackWrapper.prototype.proxy = function(response) {
    // https://github.com/gorhill/uBlock/issues/383
    if ( this.messaging.ports.hasOwnProperty(this.port.name) ) {
        this.port.postMessage({
            requestId: this.request.requestId,
            channelName: this.request.channelName,
            msg: response !== undefined ? response : null
        });
    }
    // Mark for reuse
    this.port = this.request = null;
    CallbackWrapper.junkyard.push(this);
};

/******************************************************************************/

vAPI.net = {};

/******************************************************************************/

vAPI.net.registerListeners = function() {
    var µb = µBlock;
    var µburi = µb.URI;

    var normalizeRequestDetails = function(details) {
        µburi.set(details.url);

        details.tabId = details.tabId.toString();
        details.hostname = µburi.hostnameFromURI(details.url);

        // The rest of the function code is to normalize type
        var type = details.type;
        if ( type !== 'other' ) {
            return;
        }
        var path = µburi.path;
        var pos = path.lastIndexOf('.');
        if ( pos === -1 ) {
            return;
        }
        var ext = path.slice(pos) + '.';
        if ( '.eot.ttf.otf.svg.woff.woff2.'.indexOf(ext) !== -1 ) {
            details.type = 'font';
            return;
        }
        // Still need this because often behind-the-scene requests are wrongly
        // categorized as 'other'
        if ( '.ico.png.gif.jpg.jpeg.webp.'.indexOf(ext) !== -1 ) {
            details.type = 'image';
            return;
        }
        // https://code.google.com/p/chromium/issues/detail?id=410382
        if ( type === 'other' ) {
            details.type = 'object';
            return;
        }
    };

    var onBeforeRequestClient = this.onBeforeRequest.callback;
    var onBeforeRequest = function(details) {
        normalizeRequestDetails(details);
        return onBeforeRequestClient(details);
    };
    chrome.webRequest.onBeforeRequest.addListener(
        onBeforeRequest,
        {
            'urls': this.onBeforeRequest.urls || ['<all_urls>'],
            'types': this.onBeforeRequest.types || []
        },
        this.onBeforeRequest.extra
    );

    chrome.webRequest.onBeforeSendHeaders.addListener(
        this.onBeforeSendHeaders.callback,
        {
            'urls': this.onBeforeSendHeaders.urls || ['<all_urls>'],
            'types': this.onBeforeSendHeaders.types || []
        },
        this.onBeforeSendHeaders.extra
    );

    var onHeadersReceivedClient = this.onHeadersReceived.callback;
    var onHeadersReceived = function(details) {
        normalizeRequestDetails(details);
        return onHeadersReceivedClient(details);
    };
    chrome.webRequest.onHeadersReceived.addListener(
        onHeadersReceived,
        {
            'urls': this.onHeadersReceived.urls || ['<all_urls>'],
            'types': this.onHeadersReceived.types || []
        },
        this.onHeadersReceived.extra
    );
};

/******************************************************************************/

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

/******************************************************************************/

vAPI.lastError = function() {
    return chrome.runtime.lastError;
};

/******************************************************************************/

// This is called only once, when everything has been loaded in memory after
// the extension was launched. It can be used to inject content scripts
// in already opened web pages, to remove whatever nuisance could make it to
// the web pages before uBlock was ready.

vAPI.onLoadAllCompleted = function() {
    // http://code.google.com/p/chromium/issues/detail?id=410868#c11
    // Need to be sure to access `vAPI.lastError()` to prevent
    // spurious warnings in the console.
    var scriptDone = function() {
        vAPI.lastError();
    };
    var scriptEnd = function(tabId) {
        if ( vAPI.lastError() ) {
            return;
        }
        vAPI.tabs.injectScript(tabId, {
            file: 'js/contentscript-end.js',
            allFrames: true,
            runAt: 'document_idle'
        }, scriptDone);
    };
    var scriptStart = function(tabId) {
        vAPI.tabs.injectScript(tabId, {
            file: 'js/vapi-client.js',
            allFrames: true,
            runAt: 'document_start'
        }, function(){ });
        vAPI.tabs.injectScript(tabId, {
            file: 'js/contentscript-start.js',
            allFrames: true,
            runAt: 'document_start'
        }, function(){ scriptEnd(tabId); });
    };
    var bindToTabs = function(tabs) {
        var µb = µBlock;
        var i = tabs.length, tab;
        while ( i-- ) {
            tab = tabs[i];
            µb.bindTabToPageStats(tab.id, tab.url);
            // https://github.com/gorhill/uBlock/issues/129
            scriptStart(tab.id);
        }
    };

    chrome.tabs.query({ url: 'http://*/*' }, bindToTabs);
    chrome.tabs.query({ url: 'https://*/*' }, bindToTabs);
};

/******************************************************************************/

vAPI.punycodeHostname = function(hostname) {
    return hostname;
};

vAPI.punycodeURL = function(url) {
    return url;
};

/******************************************************************************/

})();

/******************************************************************************/

/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
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

/* global self */

// For background page

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

self.vAPI = self.vAPI || {};

var vAPI = self.vAPI;
var chrome = self.chrome;

vAPI.chrome = true;

/******************************************************************************/

vAPI.storage = chrome.storage.local;

/******************************************************************************/

vAPI.tabs = {};

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
    if ( tabId !== null ) {
        chrome.tabs.get(tabId, callback);
        return;
    }
    var onTabReceived = function(tabs) {
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
                chrome.tabs.update(details.tabId, _details, function(tab) {
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
            var url = targetURL.replace(rgxHash, '');
            // this is questionable
            var rgxHash = /#.*/;
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
    chrome.tabs.remove(tabId, onTabRemoved);
};

/******************************************************************************/

vAPI.tabs.injectScript = function(tabId, details, callback) {
    if ( typeof callback !== 'function' ) {
        callback = function(){};
    }

    if ( tabId ) {
        chrome.tabs.executeScript(tabId, details, callback);
    } else {
        chrome.tabs.executeScript(details, callback);
    }
};

/******************************************************************************/

// Must read: https://code.google.com/p/chromium/issues/detail?id=410868#c8

// https://github.com/gorhill/uBlock/issues/19
// https://github.com/gorhill/uBlock/issues/207
// Since we may be called asynchronously, the tab id may not exist
// anymore, so this ensures it does still exist.

vAPI.setIcon = function(tabId, img, badge) {
    var onIconReady = function() {
        if ( vAPI.lastError() ) {
            return;
        }
        chrome.browserAction.setBadgeText({ tabId: tabId, text: badge });
        if ( badge !== '' ) {
            chrome.browserAction.setBadgeBackgroundColor({ tabId: tabId, color: '#666' });
        }
    };
    chrome.browserAction.setIcon({ tabId: tabId, path: img }, onIconReady);
};

/******************************************************************************/

vAPI.messaging = {
    ports: {},
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

vAPI.messaging.onPortMessage = function(request, port) {
    var callback = vAPI.messaging.NOOPFUNC;
    if ( request.requestId !== undefined ) {
        callback = function(response) {
            port.postMessage({
                requestId: request.requestId,
                portName: request.portName,
                msg: response !== undefined ? response : null
            });
        };
    }

    // Specific handler
    var r = vAPI.messaging.UNHANDLED;
    var listener = vAPI.messaging.listeners[request.portName];
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

})();

/******************************************************************************/

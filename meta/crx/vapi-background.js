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

// For background page

/* global SafariBrowserTab, Services, XPCOMUtils */

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
                        if ( vAPI.lastError() ) {
                            chrome.tabs.create(_details);
                        } else if ( details.index !== undefined ) {
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
    close: chrome.tabs.remove.bind(chrome.tabs),
    injectScript: function(tabId, details, callback) {
        if (!callback) {
            callback = function(){};
        }

        if (tabId) {
            chrome.tabs.executeScript(tabId, details, callback);
        }
        else {
            chrome.tabs.executeScript(details, callback);
        }
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
    connector: null,

    listen: function(listenerName, callback) {
        this.listeners[listenerName] = callback;
    },

    setup: function(connector) {
        if ( this.connector ) {
            return;
        }

        this.connector = function(port) {
            var onMessage = function(request) {
                var callback = function(response) {
                    if ( vAPI.lastError() || response === undefined ) {
                        return;
                    }

                    if ( request.requestId ) {
                        port.postMessage({
                            requestId: request.requestId,
                            portName: request.portName,
                            msg: response
                        });
                    }
                };

                // Default handler
                var listener = connector(request.msg, port.sender, callback);
                if ( listener !== null ) {
                    return;
                }

                // Specific handler
                listener = vAPI.messaging.listeners[request.portName];
                if ( typeof listener === 'function' ) {
                    listener(request.msg, port.sender, callback);
                } else {
                    console.error('µBlock> messaging > unknown request: %o', request);
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

        for ( var portName in this.ports ) {
            this.ports[portName].postMessage(message);
        }
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

/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2018 The uBlock Origin authors

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

'use strict';

/******************************************************************************/

(function() {

/******************************************************************************/
/******************************************************************************/

var chrome = self.chrome;
var manifest = chrome.runtime.getManifest();

vAPI.chrome = true;
vAPI.chromiumVersion = (function(){
    var matches = /\bChrom(?:e|ium)\/(\d+)\b/.exec(navigator.userAgent);
    return matches !== null ? parseInt(matches[1], 10) : NaN;
    })();

vAPI.cantWebsocket =
    chrome.webRequest.ResourceType instanceof Object === false  ||
    chrome.webRequest.ResourceType.WEBSOCKET !== 'websocket';

vAPI.webextFlavor = '';
if (
    self.browser instanceof Object &&
    typeof self.browser.runtime.getBrowserInfo === 'function'
) {
    self.browser.runtime.getBrowserInfo().then(function(info) {
        vAPI.webextFlavor = info.vendor + '-' + info.name + '-' + info.version;
    });
}

// https://issues.adblockplus.org/ticket/5695
// - Good idea, adopted: cleaner way to detect user-stylesheet support.
vAPI.supportsUserStylesheets = 
    chrome.extensionTypes instanceof Object &&
    chrome.extensionTypes.CSSOrigin instanceof Object &&
    'USER' in chrome.extensionTypes.CSSOrigin;
vAPI.insertCSS = chrome.tabs.insertCSS;

var noopFunc = function(){};

/******************************************************************************/

vAPI.app = {
    name: manifest.name.replace(' dev build', ''),
    version: manifest.version
};

/******************************************************************************/

vAPI.app.restart = function() {
    chrome.runtime.reload();
};

/******************************************************************************/
/******************************************************************************/

// chrome.storage.local.get(null, function(bin){ console.debug('%o', bin); });

vAPI.storage = chrome.storage.local;
vAPI.cacheStorage = chrome.storage.local;

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/uMatrix/issues/234
// https://developer.chrome.com/extensions/privacy#property-network

// 2015-08-12: Wrapped Chrome API in try-catch statements. I had a fluke
// event in which it appeared Chrome 46 decided to restart uBlock (for
// unknown reasons) and again for unknown reasons the browser acted as if
// uBlock did not declare the `privacy` permission in its manifest, putting
// uBlock in a bad, non-functional state -- because call to `chrome.privacy`
// API threw an exception.

// https://github.com/gorhill/uBlock/issues/2048
//   Do not mess up with existing settings if not assigning them stricter
//   values.

vAPI.browserSettings = (function() {
    // Not all platforms support `chrome.privacy`.
    if ( chrome.privacy instanceof Object === false ) {
        return;
    }

    return {
        webRTCSupported: undefined,

        // https://github.com/gorhill/uBlock/issues/875
        // Must not leave `lastError` unchecked.
        noopCallback: function() {
            void chrome.runtime.lastError;
        },

        // Calling with `true` means IP address leak is not prevented.
        // https://github.com/gorhill/uBlock/issues/533
        //   We must first check wether this Chromium-based browser was compiled
        //   with WebRTC support. To do this, we use an iframe, this way the
        //   empty RTCPeerConnection object we create to test for support will
        //   be properly garbage collected. This prevents issues such as
        //   a computer unable to enter into sleep mode, as reported in the
        //   Chrome store:
        // https://github.com/gorhill/uBlock/issues/533#issuecomment-167931681
        setWebrtcIPAddress: function(setting) {
            // We don't know yet whether this browser supports WebRTC: find out.
            if ( this.webRTCSupported === undefined ) {
                this.webRTCSupported = { setting: setting };
                var iframe = document.createElement('iframe');
                var me = this;
                var messageHandler = function(ev) {
                    if ( ev.origin !== self.location.origin ) {
                        return;
                    }
                    window.removeEventListener('message', messageHandler);
                    var setting = me.webRTCSupported.setting;
                    me.webRTCSupported = ev.data === 'webRTCSupported';
                    me.setWebrtcIPAddress(setting);
                    iframe.parentNode.removeChild(iframe);
                    iframe = null;
                };
                window.addEventListener('message', messageHandler);
                iframe.src = 'is-webrtc-supported.html';
                document.body.appendChild(iframe);
                return;
            }

            // We are waiting for a response from our iframe. This makes the code
            // safe to re-entrancy.
            if ( typeof this.webRTCSupported === 'object' ) {
                this.webRTCSupported.setting = setting;
                return;
            }

            // https://github.com/gorhill/uBlock/issues/533
            // WebRTC not supported: `webRTCMultipleRoutesEnabled` can NOT be
            // safely accessed. Accessing the property will cause full browser
            // crash.
            if ( this.webRTCSupported !== true ) {
                return;
            }

            var cp = chrome.privacy,
                cpn = cp.network;

            // Older version of Chromium do not support this setting, and is
            // marked as "deprecated" since Chromium 48.
            if ( typeof cpn.webRTCMultipleRoutesEnabled === 'object' ) {
                try {
                    if ( setting ) {
                        cpn.webRTCMultipleRoutesEnabled.clear({
                            scope: 'regular'
                        }, this.noopCallback);
                    } else {
                        cpn.webRTCMultipleRoutesEnabled.set({
                            value: false,
                            scope: 'regular'
                        }, this.noopCallback);
                    }
                } catch(ex) {
                    console.error(ex);
                }
            }

            // This setting became available in Chromium 48.
            if ( typeof cpn.webRTCIPHandlingPolicy === 'object' ) {
                try {
                    if ( setting ) {
                        cpn.webRTCIPHandlingPolicy.clear({
                            scope: 'regular'
                        }, this.noopCallback);
                    } else {
                        // https://github.com/uBlockOrigin/uAssets/issues/333#issuecomment-289426678
                        // - Leverage virtuous side-effect of strictest setting.
                        cpn.webRTCIPHandlingPolicy.set({
                            value: 'disable_non_proxied_udp',
                            scope: 'regular'
                        }, this.noopCallback);
                    }
                } catch(ex) {
                    console.error(ex);
                }
            }
        },

        set: function(details) {
            for ( var setting in details ) {
                if ( details.hasOwnProperty(setting) === false ) {
                    continue;
                }
                switch ( setting ) {
                case 'prefetching':
                    try {
                        if ( !!details[setting] ) {
                            chrome.privacy.network.networkPredictionEnabled.clear({
                                scope: 'regular'
                            }, this.noopCallback);
                        } else {
                            chrome.privacy.network.networkPredictionEnabled.set({
                                value: false,
                                scope: 'regular'
                            }, this.noopCallback);
                        }
                    } catch(ex) {
                        console.error(ex);
                    }
                    break;

                case 'hyperlinkAuditing':
                    try {
                        if ( !!details[setting] ) {
                            chrome.privacy.websites.hyperlinkAuditingEnabled.clear({
                                scope: 'regular'
                            }, this.noopCallback);
                        } else {
                            chrome.privacy.websites.hyperlinkAuditingEnabled.set({
                                value: false,
                                scope: 'regular'
                            }, this.noopCallback);
                        }
                    } catch(ex) {
                        console.error(ex);
                    }
                    break;

                case 'webrtcIPAddress':
                    this.setWebrtcIPAddress(!!details[setting]);
                    break;

                default:
                    break;
                }
            }
        }
    };
})();

/******************************************************************************/
/******************************************************************************/

vAPI.tabs = {};

/******************************************************************************/

vAPI.isBehindTheSceneTabId = function(tabId) {
    return tabId.toString() === '-1';
};

vAPI.noTabId = '-1';

/******************************************************************************/

var toChromiumTabId = function(tabId) {
    if ( typeof tabId === 'string' ) {
        tabId = parseInt(tabId, 10);
    }
    if ( typeof tabId !== 'number' || isNaN(tabId) || tabId === -1 ) {
        return 0;
    }
    return tabId;
};

/******************************************************************************/

vAPI.tabs.registerListeners = function() {
    var onNavigationClient = this.onNavigation || noopFunc;
    var onUpdatedClient = this.onUpdated || noopFunc;

    // https://developer.chrome.com/extensions/webNavigation
    // [onCreatedNavigationTarget ->]
    //  onBeforeNavigate ->
    //  onCommitted ->
    //  onDOMContentLoaded ->
    //  onCompleted

    // The chrome.webRequest.onBeforeRequest() won't be called for everything
    // else than `http`/`https`. Thus, in such case, we will bind the tab as
    // early as possible in order to increase the likelihood of a context
    // properly setup if network requests are fired from within the tab.
    // Example: Chromium + case #6 at
    //          http://raymondhill.net/ublock/popup.html
    var reGoodForWebRequestAPI = /^https?:\/\//;

    // https://forums.lanik.us/viewtopic.php?f=62&t=32826
    //   Chromium-based browsers: sanitize target URL. I've seen data: URI with
    //   newline characters in standard fields, possibly as a way of evading
    //   filters. As per spec, there should be no whitespaces in a data: URI's
    //   standard fields.
    var sanitizeURL = function(url) {
        if ( url.startsWith('data:') === false ) { return url; }
        var pos = url.indexOf(',');
        if ( pos === -1 ) { return url; }
        var s = url.slice(0, pos);
        if ( s.search(/\s/) === -1 ) { return url; }
        return s.replace(/\s+/, '') + url.slice(pos);
    };

    var onCreatedNavigationTarget = function(details) {
        if ( typeof details.url !== 'string' ) {
            details.url = '';
        }
        if ( reGoodForWebRequestAPI.test(details.url) === false ) {
            details.frameId = 0;
            details.url = sanitizeURL(details.url);
            onNavigationClient(details);
        }
        if ( typeof vAPI.tabs.onPopupCreated === 'function' ) {
            vAPI.tabs.onPopupCreated(
                details.tabId.toString(),
                details.sourceTabId.toString()
            );
        }
    };

    var onBeforeNavigate = function(details) {
        if ( details.frameId !== 0 ) {
            return;
        }
    };

    var onCommitted = function(details) {
        if ( details.frameId !== 0 ) {
            return;
        }
        details.url = sanitizeURL(details.url);
        onNavigationClient(details);
    };

    var onActivated = function(details) {
        if ( vAPI.contextMenu instanceof Object ) {
            vAPI.contextMenu.onMustUpdate(details.tabId);
        }
    };

    // https://github.com/gorhill/uBlock/issues/3073
    // - Fall back to `tab.url` when `changeInfo.url` is not set.
    var onUpdated = function(tabId, changeInfo, tab) {
        if ( typeof changeInfo.url !== 'string' ) {
            changeInfo.url = tab && tab.url;
        }
        if ( changeInfo.url ) {
            changeInfo.url = sanitizeURL(changeInfo.url);
        }
        onUpdatedClient(tabId.toString(), changeInfo, tab);
    };

    chrome.webNavigation.onBeforeNavigate.addListener(onBeforeNavigate);
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    // Not supported on Firefox WebExtensions yet.
    if ( chrome.webNavigation.onCreatedNavigationTarget instanceof Object ) {
        chrome.webNavigation.onCreatedNavigationTarget.addListener(onCreatedNavigationTarget);
    }
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);

    if ( typeof this.onClosed === 'function' ) {
        chrome.tabs.onRemoved.addListener(this.onClosed);
    }

};

/******************************************************************************/

// Caller must be prepared to deal with nil tab argument.

// https://code.google.com/p/chromium/issues/detail?id=410868#c8

vAPI.tabs.get = function(tabId, callback) {
    if ( tabId === null ) {
        chrome.tabs.query(
            { active: true, currentWindow: true },
            function(tabs) {
                if ( chrome.runtime.lastError ) { /* noop */ }
                callback(
                    Array.isArray(tabs) && tabs.length !== 0 ? tabs[0] : null
                );
            }
        );
        return;
    }

    tabId = toChromiumTabId(tabId);
    if ( tabId === 0 ) {
        callback(null);
        return;
    }

    chrome.tabs.get(tabId, function(tab) {
        if ( chrome.runtime.lastError ) { /* noop */ }
        callback(tab);
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

            // Opening a tab from incognito window won't focus the window
            // in which the tab was opened
            var focusWindow = function(tab) {
                if ( tab.active ) {
                    chrome.windows.update(tab.windowId, { focused: true });
                }
            };

            if ( !details.tabId ) {
                if ( details.index !== undefined ) {
                    _details.index = details.index;
                }

                chrome.tabs.create(_details, focusWindow);
                return;
            }

            // update doesn't accept index, must use move
            chrome.tabs.update(toChromiumTabId(details.tabId), _details, function(tab) {
                // if the tab doesn't exist
                if ( vAPI.lastError() ) {
                    chrome.tabs.create(_details, focusWindow);
                } else if ( details.index !== undefined ) {
                    chrome.tabs.move(tab.id, {index: details.index});
                }
            });
        };

        // Open in a standalone window
        if ( details.popup === true ) {
            chrome.windows.create({ url: details.url, type: 'popup' });
            return;
        }

        if ( details.index !== -1 ) {
            subWrapper();
            return;
        }

        vAPI.tabs.get(null, function(tab) {
            if ( tab ) {
                details.index = tab.index + 1;
            } else {
                delete details.index;
            }

            subWrapper();
        });
    };

    if ( !details.select ) {
        wrapper();
        return;
    }

    // https://github.com/gorhill/uBlock/issues/3053#issuecomment-332276818
    // - Do not try to lookup uBO's own pages with FF 55 or less.
    if ( /^Mozilla-Firefox-5[2-5]\./.test(vAPI.webextFlavor) ) {
        wrapper();
        return;
    }

    // https://developer.chrome.com/extensions/tabs#method-query
    // "Note that fragment identifiers are not matched."
    // It's a lie, fragment identifiers ARE matched. So we need to remove the
    // fragment.
    var pos = targetURL.indexOf('#'),
        targetURLWithoutHash = pos === -1 ? targetURL : targetURL.slice(0, pos);

    chrome.tabs.query({ url: targetURLWithoutHash }, function(tabs) {
        if ( chrome.runtime.lastError ) { /* noop */ }
        var tab = Array.isArray(tabs) && tabs[0];
        if ( !tab ) {
            wrapper();
            return;
        }
        var _details = {
            active: true,
            url: undefined
        };
        if ( targetURL !== tab.url ) {
            _details.url = targetURL;
        }
        chrome.tabs.update(tab.id, _details, function(tab) {
            chrome.windows.update(tab.windowId, { focused: true });
        });
    });
};

/******************************************************************************/

// Replace the URL of a tab. Noop if the tab does not exist.

vAPI.tabs.replace = function(tabId, url) {
    tabId = toChromiumTabId(tabId);
    if ( tabId === 0 ) {
        return;
    }

    var targetURL = url;

    // extension pages
    if ( /^[\w-]{2,}:/.test(targetURL) !== true ) {
        targetURL = vAPI.getURL(targetURL);
    }

    chrome.tabs.update(tabId, { url: targetURL }, function() {
        // https://code.google.com/p/chromium/issues/detail?id=410868#c8
        if ( chrome.runtime.lastError ) {
            /* noop */
        }
    });
};

/******************************************************************************/

vAPI.tabs.remove = function(tabId) {
    tabId = toChromiumTabId(tabId);
    if ( tabId === 0 ) {
        return;
    }

    var onTabRemoved = function() {
        // https://code.google.com/p/chromium/issues/detail?id=410868#c8
        if ( chrome.runtime.lastError ) {
            /* noop */
        }
    };

    chrome.tabs.remove(tabId, onTabRemoved);
};

/******************************************************************************/

vAPI.tabs.reload = function(tabId, bypassCache) {
    tabId = toChromiumTabId(tabId);
    if ( tabId === 0 ) { return; }

    var onReloaded = function() {
        // https://code.google.com/p/chromium/issues/detail?id=410868#c8
        if ( chrome.runtime.lastError ) {
            /* noop */
        }
    };

    chrome.tabs.reload(
        tabId,
        { bypassCache: bypassCache === true },
        onReloaded
    );
};

/******************************************************************************/

// Select a specific tab.

vAPI.tabs.select = function(tabId) {
    tabId = toChromiumTabId(tabId);
    if ( tabId === 0 ) {
        return;
    }

    chrome.tabs.update(tabId, { active: true }, function(tab) {
        if ( chrome.runtime.lastError ) {
            /* noop */
        }
        if ( !tab ) {
            return;
        }
        chrome.windows.update(tab.windowId, { focused: true });
    });
};

/******************************************************************************/

vAPI.tabs.injectScript = function(tabId, details, callback) {
    var onScriptExecuted = function() {
        // https://code.google.com/p/chromium/issues/detail?id=410868#c8
        if ( chrome.runtime.lastError ) {
            /* noop */
        }
        if ( typeof callback === 'function' ) {
            callback();
        }
    };
    if ( tabId ) {
        chrome.tabs.executeScript(toChromiumTabId(tabId), details, onScriptExecuted);
    } else {
        chrome.tabs.executeScript(details, onScriptExecuted);
    }
};

/******************************************************************************/
/******************************************************************************/

// Must read: https://code.google.com/p/chromium/issues/detail?id=410868#c8

// https://github.com/chrisaljoudi/uBlock/issues/19
// https://github.com/chrisaljoudi/uBlock/issues/207
// Since we may be called asynchronously, the tab id may not exist
// anymore, so this ensures it does still exist.

// https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/browserAction#Browser_compatibility
//   Firefox for Android does no support browser.browserAction.setIcon().

vAPI.setIcon = (function() {
    var browserAction = chrome.browserAction,
        titleTemplate = chrome.runtime.getManifest().name + ' ({badge})';
    var iconPaths = [
        {
            '19': 'img/browsericons/icon19-off.png',
            '38': 'img/browsericons/icon38-off.png'
        },
        {
            '19': 'img/browsericons/icon19.png',
            '38': 'img/browsericons/icon38.png'
        }
    ];

    var onTabReady = function(tab, status, badge) {
        if ( vAPI.lastError() || !tab ) { return; }

        if ( browserAction.setIcon !== undefined ) {
            browserAction.setIcon({
                tabId: tab.id,
                path: iconPaths[status === 'on' ? 1 : 0]
            });
            browserAction.setBadgeText({
                tabId: tab.id,
                text: badge
            });
            if ( badge !== '' ) {
                browserAction.setBadgeBackgroundColor({
                    tabId: tab.id,
                    color: '#666'
                });
            }
        }

        if ( browserAction.setTitle !== undefined ) {
            browserAction.setTitle({
                tabId: tab.id,
                title: titleTemplate.replace(
                    '{badge}',
                    status === 'on' ? (badge !== '' ? badge : '0') : 'off'
                )
            });
        }
    };

    return function(tabId, iconStatus, badge) {
        tabId = toChromiumTabId(tabId);
        if ( tabId === 0 ) { return; }

        chrome.tabs.get(tabId, function(tab) {
            onTabReady(tab, iconStatus, badge);
        });

        if ( vAPI.contextMenu instanceof Object ) {
            vAPI.contextMenu.onMustUpdate(tabId);
        }
    };
})();

chrome.browserAction.onClicked.addListener(function(tab) {
    vAPI.tabs.open({
        select: true,
        url: 'popup.html?tabId=' + tab.id + '&mobile=1'
    });
});

/******************************************************************************/
/******************************************************************************/

vAPI.messaging = {
    ports: new Map(),
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

vAPI.messaging.onPortMessage = (function() {
    var messaging = vAPI.messaging,
        supportsUserStylesheets = vAPI.supportsUserStylesheets;

    // Use a wrapper to avoid closure and to allow reuse.
    var CallbackWrapper = function(port, request) {
        this.callback = this.proxy.bind(this); // bind once
        this.init(port, request);
    };

    CallbackWrapper.prototype = {
        init: function(port, request) {
            this.port = port;
            this.request = request;
            return this;
        },
        proxy: function(response) {
            // https://github.com/chrisaljoudi/uBlock/issues/383
            if ( messaging.ports.has(this.port.name) ) {
                this.port.postMessage({
                    auxProcessId: this.request.auxProcessId,
                    channelName: this.request.channelName,
                    msg: response !== undefined ? response : null
                });
            }
            // Mark for reuse
            this.port = this.request = null;
            callbackWrapperJunkyard.push(this);
        }
    };

    var callbackWrapperJunkyard = [];

    var callbackWrapperFactory = function(port, request) {
        var wrapper = callbackWrapperJunkyard.pop();
        if ( wrapper ) {
            return wrapper.init(port, request);
        }
        return new CallbackWrapper(port, request);
    };

    var toFramework = function(request, port, callback) {
        var sender = port && port.sender;
        if ( !sender ) { return; }
        var tabId = sender.tab && sender.tab.id || undefined;
        var msg = request.msg,
            toPort;
        switch ( msg.what ) {
        case 'connectionAccepted':
        case 'connectionRefused':
            toPort = messaging.ports.get(msg.fromToken);
            if ( toPort !== undefined ) {
                msg.tabId = tabId && tabId.toString();
                toPort.postMessage(request);
            } else {
                msg.what = 'connectionBroken';
                port.postMessage(request);
            }
            break;
        case 'connectionRequested':
            msg.tabId = tabId && tabId.toString();
            for ( toPort of messaging.ports.values() ) {
                toPort.postMessage(request);
            }
            break;
        case 'connectionBroken':
        case 'connectionCheck':
        case 'connectionMessage':
            toPort = messaging.ports.get(
                port.name === msg.fromToken ? msg.toToken : msg.fromToken
            );
            if ( toPort !== undefined ) {
                msg.tabId = tabId && tabId.toString();
                toPort.postMessage(request);
            } else {
                msg.what = 'connectionBroken';
                port.postMessage(request);
            }
            break;
        case 'userCSS':
            if ( tabId === undefined ) { break; }
            var details = {
                code: undefined,
                frameId: sender.frameId,
                matchAboutBlank: true
            };
            if ( supportsUserStylesheets ) {
                details.cssOrigin = 'user';
            }
            if ( msg.add ) {
                details.runAt = 'document_start';
            }
            var cssText;
            const cssPromises = [];
            for ( cssText of msg.add ) {
                details.code = cssText;
                cssPromises.push(chrome.tabs.insertCSS(tabId, details));
            }
            for ( cssText of msg.remove ) {
                details.code = cssText;
                cssPromises.push(chrome.tabs.removeCSS(tabId, details));
            }
            if ( typeof callback === 'function' ) {
                Promise.all(cssPromises).then(() => {
                    callback();
                }, null);
            }
            break;
        }
    };

    // https://bugzilla.mozilla.org/show_bug.cgi?id=1392067
    //   Workaround: manually remove ports matching removed tab.
    chrome.tabs.onRemoved.addListener(function(tabId) {
        for ( var port of messaging.ports.values() ) {
            var tab = port.sender && port.sender.tab;
            if ( !tab ) { continue; }
            if ( tab.id === tabId ) {
                vAPI.messaging.onPortDisconnect(port);
            }
        }
    });

    return function(request, port) {
        // prepare response
        var callback = this.NOOPFUNC;
        if ( request.auxProcessId !== undefined ) {
            callback = callbackWrapperFactory(port, request).callback;
        }

        // Content process to main process: framework handler.
        if ( request.channelName === 'vapi' ) {
            toFramework(request, port, callback);
            return;
        }

        // Auxiliary process to main process: specific handler
        var r = this.UNHANDLED,
            listener = this.listeners[request.channelName];
        if ( typeof listener === 'function' ) {
            r = listener(request.msg, port.sender, callback);
        }
        if ( r !== this.UNHANDLED ) { return; }

        // Auxiliary process to main process: default handler
        r = this.defaultHandler(request.msg, port.sender, callback);
        if ( r !== this.UNHANDLED ) { return; }

        // Auxiliary process to main process: no handler
        console.error(
            'vAPI.messaging.onPortMessage > unhandled request: %o',
            request
        );

        // Need to callback anyways in case caller expected an answer, or
        // else there is a memory leak on caller's side
        callback();
    }.bind(vAPI.messaging);
})();

/******************************************************************************/

vAPI.messaging.onPortDisconnect = function(port) {
    port.onDisconnect.removeListener(this.onPortDisconnect);
    port.onMessage.removeListener(this.onPortMessage);
    this.ports.delete(port.name);
}.bind(vAPI.messaging);

/******************************************************************************/

vAPI.messaging.onPortConnect = function(port) {
    port.onDisconnect.addListener(this.onPortDisconnect);
    port.onMessage.addListener(this.onPortMessage);
    this.ports.set(port.name, port);
}.bind(vAPI.messaging);

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
    for ( var port of this.ports.values() ) {
        port.postMessage(messageWrapper);
    }
};

/******************************************************************************/
/******************************************************************************/

// https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/contextMenus#Browser_compatibility
//   Firefox for Android does no support browser.contextMenus.

vAPI.contextMenu = chrome.contextMenus && {
    _callback: null,
    _entries: [],
    _createEntry: function(entry) {
        chrome.contextMenus.create(JSON.parse(JSON.stringify(entry)), function() {
            void chrome.runtime.lastError;
        });
    },
    onMustUpdate: function() {},
    setEntries: function(entries, callback) {
        entries = entries || [];
        var n = Math.max(this._entries.length, entries.length),
            oldEntryId, newEntry;
        for ( var i = 0; i < n; i++ ) {
            oldEntryId = this._entries[i];
            newEntry = entries[i];
            if ( oldEntryId && newEntry ) {
                if ( newEntry.id !== oldEntryId ) {
                    chrome.contextMenus.remove(oldEntryId);
                    this._createEntry(newEntry);
                    this._entries[i] = newEntry.id;
                }
            } else if ( oldEntryId && !newEntry ) {
                chrome.contextMenus.remove(oldEntryId);
            } else if ( !oldEntryId && newEntry ) {
                this._createEntry(newEntry);
                this._entries[i] = newEntry.id;
            }
        }
        n = this._entries.length = entries.length;
        callback = callback || null;
        if ( callback === this._callback ) {
            return;
        }
        if ( n !== 0 && callback !== null ) {
            chrome.contextMenus.onClicked.addListener(callback);
            this._callback = callback;
        } else if ( n === 0 && this._callback !== null ) {
            chrome.contextMenus.onClicked.removeListener(this._callback);
            this._callback = null;
        }
    }
};

/******************************************************************************/
/******************************************************************************/

vAPI.commands = chrome.commands;

/******************************************************************************/
/******************************************************************************/

vAPI.lastError = function() {
    return chrome.runtime.lastError;
};

/******************************************************************************/
/******************************************************************************/

// This is called only once, when everything has been loaded in memory after
// the extension was launched. It can be used to inject content scripts
// in already opened web pages, to remove whatever nuisance could make it to
// the web pages before uBlock was ready.

vAPI.onLoadAllCompleted = function() {
    // http://code.google.com/p/chromium/issues/detail?id=410868#c11
    // Need to be sure to access `vAPI.lastError()` to prevent
    // spurious warnings in the console.
    var onScriptInjected = function() {
        vAPI.lastError();
    };
    var scriptStart = function(tabId) {
        var manifest = chrome.runtime.getManifest();
        if ( manifest instanceof Object === false ) { return; }
        for ( var contentScript of manifest.content_scripts ) {
            for ( var file of contentScript.js ) {
                vAPI.tabs.injectScript(tabId, {
                    file: file,
                    allFrames: contentScript.all_frames,
                    runAt: contentScript.run_at
                }, onScriptInjected);
            }
        }
    };
    var bindToTabs = function(tabs) {
        var µb = µBlock;
        var i = tabs.length, tab;
        while ( i-- ) {
            tab = tabs[i];
            µb.tabContextManager.commit(tab.id, tab.url);
            µb.bindTabToPageStats(tab.id);
            // https://github.com/chrisaljoudi/uBlock/issues/129
            if ( /^https?:\/\//.test(tab.url) ) {
                scriptStart(tab.id);
            }
        }
    };

    chrome.tabs.query({ url: '<all_urls>' }, bindToTabs);
};

/******************************************************************************/
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

// https://github.com/gorhill/uBlock/commit/43a5ed735b95a575a9339b6e71a1fcb27a99663b#commitcomment-13965030
// Not all Chromium-based browsers support managed storage. Merely testing or
// exception handling in this case does NOT work: I don't know why. The
// extension on Opera ends up in a non-sensical state, whereas vAPI become
// undefined out of nowhere. So only solution left is to test explicitly for
// Opera.
// https://github.com/gorhill/uBlock/issues/900
// Also, UC Browser: http://www.upsieutoc.com/image/WXuH

vAPI.adminStorage = chrome.storage.managed && {
    getItem: function(key, callback) {
        var onRead = function(store) {
            var data;
            if (
                !chrome.runtime.lastError &&
                typeof store === 'object' &&
                store !== null
            ) {
                data = store[key];
            }
            callback(data);
        };
        try {
            chrome.storage.managed.get(key, onRead);
        } catch (ex) {
            callback();
        }
    }
};

/******************************************************************************/
/******************************************************************************/

vAPI.cloud = (function() {
    // Not all platforms support `chrome.storage.sync`.
    if ( chrome.storage.sync instanceof Object === false ) {
        return;
    }

    var chunkCountPerFetch = 16; // Must be a power of 2

    // Mind chrome.storage.sync.MAX_ITEMS (512 at time of writing)
    var maxChunkCountPerItem = Math.floor(512 * 0.75) & ~(chunkCountPerFetch - 1);

    // Mind chrome.storage.sync.QUOTA_BYTES_PER_ITEM (8192 at time of writing)
    var maxChunkSize = chrome.storage.sync.QUOTA_BYTES_PER_ITEM || 8192;

    // Mind chrome.storage.sync.QUOTA_BYTES (128 kB at time of writing)
    // Firefox:
    // https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/storage/sync
    // > You can store up to 100KB of data using this API/
    var maxStorageSize = chrome.storage.sync.QUOTA_BYTES || 102400;

    // Flavor-specific handling needs to be done here. Reason: to allow time
    // for vAPI.webextFlavor to be properly set.
    // https://github.com/gorhill/uBlock/issues/3006
    //  For Firefox, we will use a lower ratio to allow for more overhead for
    //  the infrastructure. Unfortunately this leads to less usable space for
    //  actual data, but all of this is provided for free by browser vendors,
    //  so we need to accept and deal with these limitations.
    var initialize = function() {
        var ratio = vAPI.webextFlavor.startsWith('Mozilla-Firefox-') ? 0.6 : 0.75;
        maxChunkSize = Math.floor(maxChunkSize * ratio);
        initialize = function(){};
    };

    var options = {
        defaultDeviceName: window.navigator.platform,
        deviceName: vAPI.localStorage.getItem('deviceName') || ''
    };

    // This is used to find out a rough count of how many chunks exists:
    // We "poll" at specific index in order to get a rough idea of how
    // large is the stored string.
    // This allows reading a single item with only 2 sync operations -- a
    // good thing given chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE
    // and chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR.

    var getCoarseChunkCount = function(dataKey, callback) {
        var bin = {};
        for ( var i = 0; i < maxChunkCountPerItem; i += 16 ) {
            bin[dataKey + i.toString()] = '';
        }

        chrome.storage.sync.get(bin, function(bin) {
            if ( chrome.runtime.lastError ) {
                callback(0, chrome.runtime.lastError.message);
                return;
            }

            var chunkCount = 0;
            for ( var i = 0; i < maxChunkCountPerItem; i += 16 ) {
                if ( bin[dataKey + i.toString()] === '' ) {
                    break;
                }
                chunkCount = i + 16;
            }

            callback(chunkCount);
        });
    };

    var deleteChunks = function(dataKey, start) {
        var keys = [];

        // No point in deleting more than:
        // - The max number of chunks per item
        // - The max number of chunks per storage limit
        var n = Math.min(
            maxChunkCountPerItem,
            Math.ceil(maxStorageSize / maxChunkSize)
        );
        for ( var i = start; i < n; i++ ) {
            keys.push(dataKey + i.toString());
        }
        if ( keys.length !== 0 ) {
            chrome.storage.sync.remove(keys);
        }
    };

    var start = function(/* dataKeys */) {
    };

    var push = function(dataKey, data, callback) {
        initialize();

        var bin = {
            'source': options.deviceName || options.defaultDeviceName,
            'tstamp': Date.now(),
            'data': data,
            'size': 0
        };
        bin.size = JSON.stringify(bin).length;
        var item = JSON.stringify(bin);

        // Chunkify taking into account QUOTA_BYTES_PER_ITEM:
        //   https://developer.chrome.com/extensions/storage#property-sync
        //   "The maximum size (in bytes) of each individual item in sync
        //   "storage, as measured by the JSON stringification of its value
        //   "plus its key length."
        bin = {};
        var chunkCount = Math.ceil(item.length / maxChunkSize);
        for ( var i = 0; i < chunkCount; i++ ) {
            bin[dataKey + i.toString()] = item.substr(i * maxChunkSize, maxChunkSize);
        }
        bin[dataKey + i.toString()] = ''; // Sentinel

        chrome.storage.sync.set(bin, function() {
            var errorStr;
            if ( chrome.runtime.lastError ) {
                errorStr = chrome.runtime.lastError.message;
                // https://github.com/gorhill/uBlock/issues/3006#issuecomment-332597677
                // - Delete all that was pushed in case of failure.
                // - It's unknown whether such issue applies only to Firefox:
                //   until such cases are reported for other browsers, we will
                //   reset the (now corrupted) content of the cloud storage
                //   only on Firefox.
                if ( vAPI.webextFlavor.startsWith('Mozilla-Firefox-') ) {
                    chunkCount = 0;
                }
            }
            callback(errorStr);

            // Remove potentially unused trailing chunks
            deleteChunks(dataKey, chunkCount);
        });
    };

    var pull = function(dataKey, callback) {
        initialize();

        var assembleChunks = function(bin) {
            if ( chrome.runtime.lastError ) {
                callback(null, chrome.runtime.lastError.message);
                return;
            }

            // Assemble chunks into a single string.
            var json = [], jsonSlice;
            var i = 0;
            for (;;) {
                jsonSlice = bin[dataKey + i.toString()];
                if ( jsonSlice === '' ) {
                    break;
                }
                json.push(jsonSlice);
                i += 1;
            }

            var entry = null;
            try {
                entry = JSON.parse(json.join(''));
            } catch(ex) {
            }
            callback(entry);
        };

        var fetchChunks = function(coarseCount, errorStr) {
            if ( coarseCount === 0 || typeof errorStr === 'string' ) {
                callback(null, errorStr);
                return;
            }

            var bin = {};
            for ( var i = 0; i < coarseCount; i++ ) {
                bin[dataKey + i.toString()] = '';
            }

            chrome.storage.sync.get(bin, assembleChunks);
        };

        getCoarseChunkCount(dataKey, fetchChunks);
    };

    var getOptions = function(callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }
        callback(options);
    };

    var setOptions = function(details, callback) {
        if ( typeof details !== 'object' || details === null ) {
            return;
        }

        if ( typeof details.deviceName === 'string' ) {
            vAPI.localStorage.setItem('deviceName', details.deviceName);
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

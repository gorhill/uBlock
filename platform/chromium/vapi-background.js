/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2018 The uBlock Origin authors
    Copyright (C) 2014-present Raymond Hill

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

vAPI.cantWebsocket =
    chrome.webRequest.ResourceType instanceof Object === false  ||
    chrome.webRequest.ResourceType.WEBSOCKET !== 'websocket';

vAPI.lastError = function() {
    return chrome.runtime.lastError;
};

// https://github.com/gorhill/uBlock/issues/875
// https://code.google.com/p/chromium/issues/detail?id=410868#c8
//   Must not leave `lastError` unchecked.
vAPI.resetLastError = function() {
    void chrome.runtime.lastError;
};

vAPI.supportsUserStylesheets = vAPI.webextFlavor.soup.has('user_stylesheet');
// The real actual webextFlavor value may not be set in stone, so listen
// for possible future changes.
window.addEventListener('webextFlavor', function() {
    vAPI.supportsUserStylesheets =
        vAPI.webextFlavor.soup.has('user_stylesheet');
}, { once: true });

vAPI.insertCSS = function(tabId, details) {
    return chrome.tabs.insertCSS(tabId, details, vAPI.resetLastError);
};

var noopFunc = function(){};

/******************************************************************************/

vAPI.app = (function() {
    let version = manifest.version;
    let match = /(\d+\.\d+\.\d+)(?:\.(\d+))?/.exec(version);
    if ( match && match[2] ) {
        let v = parseInt(match[2], 10);
        version = match[1] + (v < 100 ? 'b' + v : 'rc' + (v - 100));
    }

    return {
        name: manifest.name.replace(/ dev\w+ build/, ''),
        version: version
    };
})();

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
        // Whether the WebRTC-related privacy API is crashy is an open question
        // only for Chromium proper (because it can be compiled without the
        // WebRTC feature): hence avoid overhead of the evaluation (which uses
        // an iframe) for platforms where it's a non-issue.
        // https://github.com/uBlockOrigin/uBlock-issues/issues/9
        //   Some Chromium builds are made to look like a Chrome build.
        webRTCSupported: (function() {
            if ( vAPI.webextFlavor.soup.has('chromium') === false ) {
                return true;
            }
        })(),

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
                // If asked to leave WebRTC setting alone at this point in the
                // code, this means we never grabbed the setting in the first
                // place.
                if ( setting ) { return; }
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
                        }, vAPI.resetLastError);
                    } else {
                        cpn.webRTCMultipleRoutesEnabled.set({
                            value: false,
                            scope: 'regular'
                        }, vAPI.resetLastError);
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
                        }, vAPI.resetLastError);
                    } else {
                        // https://github.com/uBlockOrigin/uAssets/issues/333#issuecomment-289426678
                        // - Leverage virtuous side-effect of strictest setting.
                        cpn.webRTCIPHandlingPolicy.set({
                            value: 'disable_non_proxied_udp',
                            scope: 'regular'
                        }, vAPI.resetLastError);
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
                            }, vAPI.resetLastError);
                        } else {
                            chrome.privacy.network.networkPredictionEnabled.set({
                                value: false,
                                scope: 'regular'
                            }, vAPI.resetLastError);
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
                            }, vAPI.resetLastError);
                        } else {
                            chrome.privacy.websites.hyperlinkAuditingEnabled.set({
                                value: false,
                                scope: 'regular'
                            }, vAPI.resetLastError);
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

// https://github.com/gorhill/uBlock/issues/3546
//   Added a new flavor of behind-the-scene tab id: vAPI.anyTabId.
//   vAPI.anyTabId will be used for network requests which can be filtered,
//   because they comes with enough contextual information. It's just not
//   possible to pinpoint exactly from which tab it comes from. For example,
//   with Firefox/webext, the `documentUrl` property is available for every
//   network requests.

vAPI.isBehindTheSceneTabId = function(tabId) {
    return tabId < 0;
};

vAPI.unsetTabId = 0;
vAPI.noTabId = -1;      // definitely not any existing tab
vAPI.anyTabId = -2;     // one of the existing tab

/******************************************************************************/

// To remove when tabId-as-integer has been tested enough.

var toChromiumTabId = function(tabId) {
    return typeof tabId === 'number' && !isNaN(tabId) && tabId > 0 ?
        tabId :
        0;
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
                details.tabId,
                details.sourceTabId
            );
        }
    };

    var onCommitted = function(details) {
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
        onUpdatedClient(tabId, changeInfo, tab);
    };

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
                void chrome.runtime.lastError;
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
        void chrome.runtime.lastError;
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
                if ( tab.active && chrome.windows instanceof Object ) {
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
        // https://github.com/uBlockOrigin/uBlock-issues/issues/168#issuecomment-413038191
        //   Not all platforms support browser.windows API.
        if ( details.popup === true && chrome.windows instanceof Object ) {
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
    if (
        vAPI.webextFlavor.soup.has('firefox') &&
        vAPI.webextFlavor.major < 56
    ) {
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
        void chrome.runtime.lastError;
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
            if ( chrome.windows instanceof Object === false ) { return; }
            chrome.windows.update(tab.windowId, { focused: true });
        });
    });
};

/******************************************************************************/

// Replace the URL of a tab. Noop if the tab does not exist.

vAPI.tabs.replace = function(tabId, url) {
    tabId = toChromiumTabId(tabId);
    if ( tabId === 0 ) { return; }

    var targetURL = url;

    // extension pages
    if ( /^[\w-]{2,}:/.test(targetURL) !== true ) {
        targetURL = vAPI.getURL(targetURL);
    }

    chrome.tabs.update(tabId, { url: targetURL }, vAPI.resetLastError);
};

/******************************************************************************/

vAPI.tabs.remove = function(tabId) {
    tabId = toChromiumTabId(tabId);
    if ( tabId === 0 ) { return; }

    chrome.tabs.remove(tabId, vAPI.resetLastError);
};

/******************************************************************************/

vAPI.tabs.reload = function(tabId, bypassCache) {
    tabId = toChromiumTabId(tabId);
    if ( tabId === 0 ) { return; }

    chrome.tabs.reload(
        tabId,
        { bypassCache: bypassCache === true },
        vAPI.resetLastError
    );
};

/******************************************************************************/

// Select a specific tab.

vAPI.tabs.select = function(tabId) {
    tabId = toChromiumTabId(tabId);
    if ( tabId === 0 ) { return; }

    chrome.tabs.update(tabId, { active: true }, function(tab) {
        void chrome.runtime.lastError;
        if ( !tab ) { return; }
        if ( chrome.windows instanceof Object === false ) { return; }
        chrome.windows.update(tab.windowId, { focused: true });
    });
};

/******************************************************************************/

vAPI.tabs.injectScript = function(tabId, details, callback) {
    var onScriptExecuted = function() {
        // https://code.google.com/p/chromium/issues/detail?id=410868#c8
        void chrome.runtime.lastError;
        if ( typeof callback === 'function' ) {
            callback.apply(null, arguments);
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
//   Performance: use ImageData for platforms supporting it.

// https://github.com/uBlockOrigin/uBlock-issues/issues/32
//   Ensure ImageData for toolbar icon is valid before use.

vAPI.setIcon = (function() {
    const browserAction = chrome.browserAction,
        titleTemplate =
            chrome.runtime.getManifest().browser_action.default_title +
            ' ({badge})';
    const icons = [
        {
            path: { '16': 'img/icon_16-off.png', '32': 'img/icon_32-off.png' }
        },
        {
            path: { '16': 'img/icon_16.png', '32': 'img/icon_32.png' }
        }
    ];

    (function() {
        if ( browserAction.setIcon === undefined ) { return; }

        // The global badge background color.
        if ( browserAction.setBadgeBackgroundColor !== undefined ) {
            browserAction.setBadgeBackgroundColor({
                color: [ 0x66, 0x66, 0x66, 0xFF ]
            });
        }

        // As of 2018-05, benchmarks show that only Chromium benefits for sure
        // from using ImageData.
        //
        // Chromium creates a new ImageData instance every call to setIcon
        // with paths:
        // https://cs.chromium.org/chromium/src/extensions/renderer/resources/set_icon.js?l=56&rcl=99be185c25738437ecfa0dafba72a26114196631
        //
        // Firefox uses an internal cache for each setIcon's paths:
        // https://searchfox.org/mozilla-central/rev/5ff2d7683078c96e4b11b8a13674daded935aa44/browser/components/extensions/parent/ext-browserAction.js#631
        if ( vAPI.webextFlavor.soup.has('chromium') === false ) { return; }

        const imgs = [];
        for ( let i = 0; i < icons.length; i++ ) {
            let path = icons[i].path;
            for ( const key in path ) {
                if ( path.hasOwnProperty(key) === false ) { continue; }
                imgs.push({ i: i, p: key });
            }
        }

        // https://github.com/uBlockOrigin/uBlock-issues/issues/296
        const safeGetImageData = function(ctx, w, h) {
            let data;
            try {
                data = ctx.getImageData(0, 0, w, h);
            } catch(ex) {
            }
            return data;
        };

        const onLoaded = function() {
            for ( const img of imgs ) {
                if ( img.r.complete === false ) { return; }
            }
            let ctx = document.createElement('canvas').getContext('2d');
            let iconData = [ null, null ];
            for ( const img of imgs ) {
                let w = img.r.naturalWidth, h = img.r.naturalHeight;
                ctx.width = w; ctx.height = h;
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(img.r, 0, 0);
                if ( iconData[img.i] === null ) { iconData[img.i] = {}; }
                const imgData = safeGetImageData(ctx, w, h);
                if (
                    imgData instanceof Object === false ||
                    imgData.data instanceof Uint8ClampedArray === false ||
                    imgData.data[0] !== 0 ||
                    imgData.data[1] !== 0 ||
                    imgData.data[2] !== 0 ||
                    imgData.data[3] !== 0
                ) {
                    return;
                }
                iconData[img.i][img.p] = imgData;
            }
            for ( let i = 0; i < iconData.length; i++ ) {
                if ( iconData[i] ) {
                    icons[i] = { imageData: iconData[i] };
                }
            }
        };
        for ( const img of imgs ) {
            img.r = new Image();
            img.r.addEventListener('load', onLoaded, { once: true });
            img.r.src = icons[img.i].path[img.p];
        }
    })();

    var onTabReady = function(tab, state, badge, parts) {
        if ( vAPI.lastError() || !tab ) { return; }

        if ( browserAction.setIcon !== undefined ) {
            if ( parts === undefined || (parts & 0x01) !== 0 ) {
                browserAction.setIcon(
                    Object.assign({ tabId: tab.id }, icons[state])
                );
            }
            browserAction.setBadgeText({ tabId: tab.id, text: badge });
        }

        if ( browserAction.setTitle !== undefined ) {
            browserAction.setTitle({
                tabId: tab.id,
                title: titleTemplate.replace(
                    '{badge}',
                    state === 1 ? (badge !== '' ? badge : '0') : 'off'
                )
            });
        }
    };

    // parts: bit 0 = icon
    //        bit 1 = badge

    return function(tabId, state, badge, parts) {
        tabId = toChromiumTabId(tabId);
        if ( tabId === 0 ) { return; }

        chrome.tabs.get(tabId, function(tab) {
            onTabReady(tab, state, badge, parts);
        });

        if ( vAPI.contextMenu instanceof Object ) {
            vAPI.contextMenu.onMustUpdate(tabId);
        }
    };
})();

chrome.browserAction.onClicked.addListener(function(tab) {
    vAPI.tabs.open({
        select: true,
        url: 'popup.html?tabId=' + tab.id + '&responsive=1'
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
    var messaging = vAPI.messaging;

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
                msg.tabId = tabId;
                toPort.postMessage(request);
            } else {
                msg.what = 'connectionBroken';
                port.postMessage(request);
            }
            break;
        case 'connectionRequested':
            msg.tabId = tabId;
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
                msg.tabId = tabId;
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
            if ( vAPI.supportsUserStylesheets ) {
                details.cssOrigin = 'user';
            }
            if ( msg.add ) {
                details.runAt = 'document_start';
            }
            var cssText;
            var countdown = 0;
            var countdownHandler = function() {
                void chrome.runtime.lastError;
                countdown -= 1;
                if ( countdown === 0 && typeof callback === 'function' ) {
                    callback();
                }
            };
            for ( cssText of msg.add ) {
                countdown += 1;
                details.code = cssText;
                chrome.tabs.insertCSS(tabId, details, countdownHandler);
            }
            if ( typeof chrome.tabs.removeCSS === 'function' ) {
                for ( cssText of msg.remove ) {
                    countdown += 1;
                    details.code = cssText;
                    chrome.tabs.removeCSS(tabId, details, countdownHandler);
                }
            }
            if ( countdown === 0 && typeof callback === 'function' ) {
                callback();
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

// https://github.com/gorhill/uBlock/issues/3474
// https://github.com/gorhill/uBlock/issues/2823
// - foil ability of web pages to identify uBO through
//   its web accessible resources.
// https://github.com/gorhill/uBlock/issues/3497
// - prevent web pages from interfering with uBO's element picker

(function() {
    vAPI.warSecret =
        Math.floor(Math.random() * 982451653 + 982451653).toString(36) +
        Math.floor(Math.random() * 982451653 + 982451653).toString(36);

    var key = 'secret=' + vAPI.warSecret;
    var root = vAPI.getURL('/');
    var guard = function(details) {
        if ( details.url.indexOf(key) === -1 ) {
            return { redirectUrl: root };
        }
    };

    chrome.webRequest.onBeforeRequest.addListener(
        guard,
        {
            urls: [ root + 'web_accessible_resources/*' ]
        },
        [ 'blocking' ]
    );
})();

vAPI.net = {
    listenerMap: new WeakMap(),
    // legacy Chromium understands only these network request types.
    validTypes: (function() {
        let types = new Set([
            'main_frame',
            'sub_frame',
            'stylesheet',
            'script',
            'image',
            'object',
            'xmlhttprequest',
            'other'
        ]);
        let wrrt = browser.webRequest.ResourceType;
        if ( wrrt instanceof Object ) {
            for ( let typeKey in wrrt ) {
                if ( wrrt.hasOwnProperty(typeKey) ) {
                    types.add(wrrt[typeKey]);
                }
            }
        }
        return types;
    })(),
    denormalizeFilters: null,
    normalizeDetails: null,
    addListener: function(which, clientListener, filters, options) {
        if ( typeof this.denormalizeFilters === 'function' ) {
            filters = this.denormalizeFilters(filters);
        }
        let actualListener;
        if ( typeof this.normalizeDetails === 'function' ) {
            actualListener = function(details) {
                vAPI.net.normalizeDetails(details);
                return clientListener(details);
            };
            this.listenerMap.set(clientListener, actualListener);
        }
        browser.webRequest[which].addListener(
            actualListener || clientListener,
            filters,
            options
        );
    },
    removeListener: function(which, clientListener) {
        let actualListener = this.listenerMap.get(clientListener);
        if ( actualListener !== undefined ) {
            this.listenerMap.delete(clientListener);
        }
        browser.webRequest[which].removeListener(
            actualListener || clientListener
        );
    },
};

/******************************************************************************/
/******************************************************************************/

// https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/contextMenus#Browser_compatibility
//   Firefox for Android does no support browser.contextMenus.

vAPI.contextMenu = chrome.contextMenus && {
    _callback: null,
    _entries: [],
    _createEntry: function(entry) {
        chrome.contextMenus.create(
            JSON.parse(JSON.stringify(entry)),
            vAPI.resetLastError
        );
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

    let chunkCountPerFetch = 16; // Must be a power of 2

    // Mind chrome.storage.sync.MAX_ITEMS (512 at time of writing)
    let maxChunkCountPerItem = Math.floor(512 * 0.75) & ~(chunkCountPerFetch - 1);

    // Mind chrome.storage.sync.QUOTA_BYTES_PER_ITEM (8192 at time of writing)
    // https://github.com/gorhill/uBlock/issues/3006
    //  For Firefox, we will use a lower ratio to allow for more overhead for
    //  the infrastructure. Unfortunately this leads to less usable space for
    //  actual data, but all of this is provided for free by browser vendors,
    //  so we need to accept and deal with these limitations.
    let evalMaxChunkSize = function() {
        return Math.floor(
            (chrome.storage.sync.QUOTA_BYTES_PER_ITEM || 8192) *
            (vAPI.webextFlavor.soup.has('firefox') ? 0.6 : 0.75)
        );
    };

    let maxChunkSize = evalMaxChunkSize();

    // The real actual webextFlavor value may not be set in stone, so listen
    // for possible future changes.
    window.addEventListener('webextFlavor', function() {
        maxChunkSize = evalMaxChunkSize();
    }, { once: true });

    // Mind chrome.storage.sync.QUOTA_BYTES (128 kB at time of writing)
    // Firefox:
    // https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/storage/sync
    // > You can store up to 100KB of data using this API/
    let maxStorageSize = chrome.storage.sync.QUOTA_BYTES || 102400;

    let options = {
        defaultDeviceName: window.navigator.platform,
        deviceName: vAPI.localStorage.getItem('deviceName') || ''
    };

    // This is used to find out a rough count of how many chunks exists:
    // We "poll" at specific index in order to get a rough idea of how
    // large is the stored string.
    // This allows reading a single item with only 2 sync operations -- a
    // good thing given chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE
    // and chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR.

    let getCoarseChunkCount = function(dataKey, callback) {
        let bin = {};
        for ( let i = 0; i < maxChunkCountPerItem; i += 16 ) {
            bin[dataKey + i.toString()] = '';
        }

        chrome.storage.sync.get(bin, function(bin) {
            if ( chrome.runtime.lastError ) {
                return callback(0, chrome.runtime.lastError.message);
            }

            let chunkCount = 0;
            for ( let i = 0; i < maxChunkCountPerItem; i += 16 ) {
                if ( bin[dataKey + i.toString()] === '' ) { break; }
                chunkCount = i + 16;
            }

            callback(chunkCount);
        });
    };

    let deleteChunks = function(dataKey, start) {
        let keys = [];

        // No point in deleting more than:
        // - The max number of chunks per item
        // - The max number of chunks per storage limit
        let n = Math.min(
            maxChunkCountPerItem,
            Math.ceil(maxStorageSize / maxChunkSize)
        );
        for ( let i = start; i < n; i++ ) {
            keys.push(dataKey + i.toString());
        }
        if ( keys.length !== 0 ) {
            chrome.storage.sync.remove(keys);
        }
    };

    let start = function(/* dataKeys */) {
    };

    let push = function(dataKey, data, callback) {

        let bin = {
            'source': options.deviceName || options.defaultDeviceName,
            'tstamp': Date.now(),
            'data': data,
            'size': 0
        };
        bin.size = JSON.stringify(bin).length;
        let item = JSON.stringify(bin);

        // Chunkify taking into account QUOTA_BYTES_PER_ITEM:
        //   https://developer.chrome.com/extensions/storage#property-sync
        //   "The maximum size (in bytes) of each individual item in sync
        //   "storage, as measured by the JSON stringification of its value
        //   "plus its key length."
        bin = {};
        let chunkCount = Math.ceil(item.length / maxChunkSize);
        for ( let i = 0; i < chunkCount; i++ ) {
            bin[dataKey + i.toString()] = item.substr(i * maxChunkSize, maxChunkSize);
        }
        bin[dataKey + chunkCount.toString()] = ''; // Sentinel

        chrome.storage.sync.set(bin, function() {
            let errorStr;
            if ( chrome.runtime.lastError ) {
                errorStr = chrome.runtime.lastError.message;
                // https://github.com/gorhill/uBlock/issues/3006#issuecomment-332597677
                // - Delete all that was pushed in case of failure.
                // - It's unknown whether such issue applies only to Firefox:
                //   until such cases are reported for other browsers, we will
                //   reset the (now corrupted) content of the cloud storage
                //   only on Firefox.
                if ( vAPI.webextFlavor.soup.has('firefox') ) {
                    chunkCount = 0;
                }
            }
            callback(errorStr);

            // Remove potentially unused trailing chunks
            deleteChunks(dataKey, chunkCount);
        });
    };

    let pull = function(dataKey, callback) {

        let assembleChunks = function(bin) {
            if ( chrome.runtime.lastError ) {
                callback(null, chrome.runtime.lastError.message);
                return;
            }

            // Assemble chunks into a single string.
            // https://www.reddit.com/r/uMatrix/comments/8lc9ia/my_rules_tab_hangs_with_cloud_storage_support/
            //   Explicit sentinel is not necessarily present: this can
            //   happen when the number of chunks is a multiple of
            //   chunkCountPerFetch. Hence why we must also test against
            //   undefined.
            let json = [], jsonSlice;
            let i = 0;
            for (;;) {
                jsonSlice = bin[dataKey + i.toString()];
                if ( jsonSlice === '' || jsonSlice === undefined ) { break; }
                json.push(jsonSlice);
                i += 1;
            }

            let entry = null;
            try {
                entry = JSON.parse(json.join(''));
            } catch(ex) {
            }
            callback(entry);
        };

        let fetchChunks = function(coarseCount, errorStr) {
            if ( coarseCount === 0 || typeof errorStr === 'string' ) {
                callback(null, errorStr);
                return;
            }

            let bin = {};
            for ( let i = 0; i < coarseCount; i++ ) {
                bin[dataKey + i.toString()] = '';
            }

            chrome.storage.sync.get(bin, assembleChunks);
        };

        getCoarseChunkCount(dataKey, fetchChunks);
    };

    let getOptions = function(callback) {
        if ( typeof callback !== 'function' ) { return; }
        callback(options);
    };

    let setOptions = function(details, callback) {
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

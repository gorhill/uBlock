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

(( ) => {

/******************************************************************************/
/******************************************************************************/

const chrome = self.chrome;
const manifest = chrome.runtime.getManifest();

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

const noopFunc = function(){};

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
    if ( chrome.privacy instanceof Object === false ) { return; }

    return {
        // Whether the WebRTC-related privacy API is crashy is an open question
        // only for Chromium proper (because it can be compiled without the
        // WebRTC feature): hence avoid overhead of the evaluation (which uses
        // an iframe) for platforms where it's a non-issue.
        // https://github.com/uBlockOrigin/uBlock-issues/issues/9
        //   Some Chromium builds are made to look like a Chrome build.
        webRTCSupported: vAPI.webextFlavor.soup.has('chromium') === false || undefined,

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
                let iframe = document.createElement('iframe');
                const messageHandler = ev => {
                    if ( ev.origin !== self.location.origin ) { return; }
                    window.removeEventListener('message', messageHandler);
                    const setting = this.webRTCSupported.setting;
                    this.webRTCSupported = ev.data === 'webRTCSupported';
                    this.setWebrtcIPAddress(setting);
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
            if ( this.webRTCSupported !== true ) { return; }

            const cp = chrome.privacy;
            const cpn = cp.network;

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
                        //   Leverage virtuous side-effect of strictest setting.
                        // https://github.com/gorhill/uBlock/issues/3009
                        //   Firefox currently works differently, use
                        //   `default_public_interface_only` for now.
                        cpn.webRTCIPHandlingPolicy.set({
                            value: vAPI.webextFlavor.soup.has('chromium')
                                ? 'disable_non_proxied_udp'
                                : 'default_public_interface_only',
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
                    const enabled = !!details[setting];
                    try {
                        if ( enabled ) {
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
                    if ( vAPI.prefetching instanceof Function ) {
                        vAPI.prefetching(enabled);
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

vAPI.isBehindTheSceneTabId = function(tabId) {
    return tabId < 0;
};

vAPI.unsetTabId = 0;
vAPI.noTabId = -1;      // definitely not any existing tab

// To remove when tabId-as-integer has been tested enough.

const toChromiumTabId = function(tabId) {
    return typeof tabId === 'number' && isNaN(tabId) === false
        ? tabId
        : 0;
};

// https://developer.chrome.com/extensions/webNavigation
// https://developer.chrome.com/extensions/tabs

vAPI.Tabs = class {
    constructor() {
        browser.webNavigation.onCreatedNavigationTarget.addListener(details => {
            if ( typeof details.url !== 'string' ) {
                details.url = '';
            }
            if ( /^https?:\/\//.test(details.url) === false ) {
                details.frameId = 0;
                details.url = this.sanitizeURL(details.url);
                this.onNavigation(details);
            }
            this.onCreated(
                details.tabId,
                details.sourceTabId
            );
<<<<<<< HEAD
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
        onUpdatedClient(tabId, changeInfo, tab);
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
=======
        });
>>>>>>> upstream1.22.0

        browser.webNavigation.onCommitted.addListener(details => {
            details.url = this.sanitizeURL(details.url);
            this.onNavigation(details);
        });

        // https://github.com/gorhill/uBlock/issues/3073
        //   Fall back to `tab.url` when `changeInfo.url` is not set.
        browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if ( typeof changeInfo.url !== 'string' ) {
                changeInfo.url = tab && tab.url;
            }
            if ( changeInfo.url ) {
                changeInfo.url = this.sanitizeURL(changeInfo.url);
            }
            this.onUpdated(tabId, changeInfo, tab);
        });

        browser.tabs.onActivated.addListener(details => {
            this.onActivated(details);
        });

        // https://github.com/uBlockOrigin/uBlock-issues/issues/151
        // https://github.com/uBlockOrigin/uBlock-issues/issues/680#issuecomment-515215220
        if ( browser.windows instanceof Object ) {
            browser.windows.onFocusChanged.addListener(windowId => {
                if ( windowId === browser.windows.WINDOW_ID_NONE ) { return; }
                browser.tabs.query({ active: true, windowId }, tabs => {
                    if ( Array.isArray(tabs) === false ) { return; }
                    if ( tabs.length === 0 ) { return; }
                    const tab = tabs[0];
                    this.onActivated({
                        tabId: tab.id,
                        windowId: tab.windowId,
                    });
                });
            });
        }

        browser.tabs.onRemoved.addListener((tabId, details) => {
            this.onClosed(tabId, details);
        });
     }

    get(tabId, callback) {
        if ( tabId === null ) {
            browser.tabs.query(
                { active: true, currentWindow: true },
                tabs => {
                    void browser.runtime.lastError;
                    callback(
                        Array.isArray(tabs) && tabs.length !== 0
                            ? tabs[0]
                            : null
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

        browser.tabs.get(tabId, function(tab) {
            void browser.runtime.lastError;
            callback(tab);
        });
    }

    // Properties of the details object:
    // - url: 'URL',    => the address that will be opened
    // - index: -1,     => undefined: end of the list, -1: following tab, or
    //                     after index
    // - active: false, => opens the tab in background - true and undefined:
    //                     foreground
    // - popup: true    => open in a new window

    create(url, details) {
        if ( details.active === undefined ) {
            details.active = true;
        }

        const subWrapper = ( ) => {
            const updateDetails = {
                url: url,
                active: !!details.active
            };

            // Opening a tab from incognito window won't focus the window
            // in which the tab was opened
            const focusWindow = tab => {
                if ( tab && tab.active && browser.windows instanceof Object ) {
                    browser.windows.update(tab.windowId, { focused: true });
                }
            };

            if ( !details.tabId ) {
                if ( details.index !== undefined ) {
                    updateDetails.index = details.index;
                }
                browser.tabs.create(updateDetails, focusWindow);
                return;
            }

            // update doesn't accept index, must use move
            browser.tabs.update(
                toChromiumTabId(details.tabId),
                updateDetails,
                tab => {
                    // if the tab doesn't exist
                    if ( vAPI.lastError() ) {
                        browser.tabs.create(updateDetails, focusWindow);
                    } else if ( details.index !== undefined ) {
                        browser.tabs.move(tab.id, { index: details.index });
                    }
                }
            );
        };

        // Open in a standalone window
        //
        // https://github.com/uBlockOrigin/uBlock-issues/issues/168#issuecomment-413038191
        //   Not all platforms support browser.windows API.
        //
        // For some reasons, some platforms do not honor the left,top
        // position when specified. I found that further calling
        // windows.update again with the same position _may_ help.
        if ( details.popup === true && browser.windows instanceof Object ) {
            const createDetails = {
                url: details.url,
                type: 'popup',
            };
            if ( details.box instanceof Object ) {
                Object.assign(createDetails, details.box);
            }
            browser.windows.create(createDetails, win => {
                if ( win instanceof Object === false ) { return; }
                if ( details.box instanceof Object === false ) { return; }
                if (
                    win.left === details.box.left &&
                    win.top === details.box.top
                ) {
                    return;
                }
                browser.windows.update(win.id, {
                    left: details.box.left,
                    top: details.box.top
                });
            });
            return;
        }

        if ( details.index !== -1 ) {
            subWrapper();
            return;
        }

        vAPI.tabs.get(null, tab => {
            if ( tab ) {
                details.index = tab.index + 1;
            } else {
                delete details.index;
            }

            subWrapper();
        });
    }

    // Properties of the details object:
    // - url: 'URL',    => the address that will be opened
    // - tabId: 1,      => the tab is used if set, instead of creating a new one
    // - index: -1,     => undefined: end of the list, -1: following tab, or
    //                     after index
    // - active: false, => opens the tab in background - true and undefined:
    //                     foreground
    // - select: true,  => if a tab is already opened with that url, then select
    //                     it instead of opening a new one
    // - popup: true    => open in a new window

    open(details) {
        let targetURL = details.url;
        if ( typeof targetURL !== 'string' || targetURL === '' ) {
            return null;
        }

        // extension pages
        if ( /^[\w-]{2,}:/.test(targetURL) !== true ) {
            targetURL = vAPI.getURL(targetURL);
        }

        if ( !details.select ) {
            this.create(targetURL, details);
            return;
        }

        // https://github.com/gorhill/uBlock/issues/3053#issuecomment-332276818
        //   Do not try to lookup uBO's own pages with FF 55 or less.
        if (
            vAPI.webextFlavor.soup.has('firefox') &&
            vAPI.webextFlavor.major < 56
        ) {
            this.create(targetURL, details);
            return;
        }

        // https://developer.chrome.com/extensions/tabs#method-query
        //   "Note that fragment identifiers are not matched."
        //   It's a lie, fragment identifiers ARE matched. So we need to remove
        //   the fragment.
        const pos = targetURL.indexOf('#');
        const targetURLWithoutHash = pos === -1
            ? targetURL
            : targetURL.slice(0, pos);

        browser.tabs.query({ url: targetURLWithoutHash }, tabs => {
            void browser.runtime.lastError;
            const tab = Array.isArray(tabs) && tabs[0];
            if ( !tab ) {
                this.create(targetURL, details);
                return;
            }
            const updateDetails = { active: true };
            // https://github.com/uBlockOrigin/uBlock-issues/issues/592
            if ( tab.url.startsWith(targetURL) === false ) {
                updateDetails.url = targetURL;
            }
            browser.tabs.update(tab.id, updateDetails, tab => {
                if ( browser.windows instanceof Object === false ) { return; }
                browser.windows.update(tab.windowId, { focused: true });
            });
        });
    }

    // Replace the URL of a tab. Noop if the tab does not exist.

    replace(tabId, url) {
        tabId = toChromiumTabId(tabId);
        if ( tabId === 0 ) { return; }

        let targetURL = url;

        // extension pages
        if ( /^[\w-]{2,}:/.test(targetURL) !== true ) {
            targetURL = vAPI.getURL(targetURL);
        }

        browser.tabs.update(tabId, { url: targetURL }, vAPI.resetLastError);
    }

    remove(tabId) {
        tabId = toChromiumTabId(tabId);
        if ( tabId === 0 ) { return; }

        browser.tabs.remove(tabId, vAPI.resetLastError);
    }

    reload(tabId, bypassCache = false) {
        tabId = toChromiumTabId(tabId);
        if ( tabId === 0 ) { return; }

        browser.tabs.reload(
            tabId,
            { bypassCache: bypassCache === true },
            vAPI.resetLastError
        );
    }

    select(tabId) {
        tabId = toChromiumTabId(tabId);
        if ( tabId === 0 ) { return; }

        browser.tabs.update(tabId, { active: true }, function(tab) {
            void browser.runtime.lastError;
            if ( !tab ) { return; }
            if ( browser.windows instanceof Object === false ) { return; }
            browser.windows.update(tab.windowId, { focused: true });
        });
    }

    injectScript(tabId, details, callback) {
        const onScriptExecuted = function() {
            // https://code.google.com/p/chromium/issues/detail?id=410868#c8
            void browser.runtime.lastError;
            if ( typeof callback === 'function' ) {
                callback.apply(null, arguments);
            }
        };
        if ( tabId ) {
            browser.tabs.executeScript(
                toChromiumTabId(tabId),
                details,
                onScriptExecuted
            );
        } else {
            browser.tabs.executeScript(
                details,
                onScriptExecuted
            );
        }
    }

    // https://forums.lanik.us/viewtopic.php?f=62&t=32826
    //   Chromium-based browsers: sanitize target URL. I've seen data: URI with
    //   newline characters in standard fields, possibly as a way of evading
    //   filters. As per spec, there should be no whitespaces in a data: URI's
    //   standard fields.

    sanitizeURL(url) {
        if ( url.startsWith('data:') === false ) { return url; }
        const pos = url.indexOf(',');
        if ( pos === -1 ) { return url; }
        const s = url.slice(0, pos);
        if ( s.search(/\s/) === -1 ) { return url; }
        return s.replace(/\s+/, '') + url.slice(pos);
    }

    onActivated(/* details */) {
    }

<<<<<<< HEAD
    chrome.tabs.update(tabId, { active: true }, function(tab) {
        void chrome.runtime.lastError;
        if ( !tab ) { return; }
        chrome.windows.update(tab.windowId, { focused: true });
    });
};
=======
    onClosed(/* tabId, details */) {
    }
>>>>>>> upstream1.22.0

    onCreated(/* openedTabId, openerTabId */) {
    }

<<<<<<< HEAD
vAPI.tabs.injectScript = function(tabId, details, callback) {
    var onScriptExecuted = function() {
        // https://code.google.com/p/chromium/issues/detail?id=410868#c8
        void chrome.runtime.lastError;
        if ( typeof callback === 'function' ) {
            callback.apply(null, arguments);
        }
    };
    if ( tabId ) {
        //if (details.frameId) console.log('vAPI.tabs.injectScript: '+details.frameId);
        chrome.tabs.executeScript(toChromiumTabId(tabId), details, onScriptExecuted);
    } else {
        chrome.tabs.executeScript(details, onScriptExecuted);
=======
    onNavigation(/* details */) {
    }

    onUpdated(/* tabId, changeInfo, tab */) {
>>>>>>> upstream1.22.0
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
<<<<<<< HEAD
/*
vAPI.setIcon = (function() {
    const browserAction = chrome.browserAction,
        titleTemplate =
            chrome.runtime.getManifest().browser_action.default_title +
            ' ({badge})';
    const icons = [
        {
            tabId: 0,
            path: { '16': 'img/icon_16-off.png', '32': 'img/icon_32-off.png' }
        },
        {
            tabId: 0,
            path: { '16': 'img/icon_16.png', '32': 'img/icon_32.png' }
        }
=======

vAPI.setIcon = (( ) => {
    const browserAction = chrome.browserAction;
    const  titleTemplate =
        browser.runtime.getManifest().browser_action.default_title +
        ' ({badge})';
    const icons = [
        { path: { '16': 'img/icon_16-off.png', '32': 'img/icon_32-off.png' } },
        { path: { '16':     'img/icon_16.png', '32':     'img/icon_32.png' } },
>>>>>>> upstream1.22.0
    ];

    (( ) => {
        if ( browserAction.setIcon === undefined ) { return; }

        // The global badge text and background color.
        if ( browserAction.setBadgeBackgroundColor !== undefined ) {
            browserAction.setBadgeBackgroundColor({ color: '#666666' });
        }
        if ( browserAction.setBadgeTextColor !== undefined ) {
            browserAction.setBadgeTextColor({ color: '#FFFFFF' });
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
            const path = icons[i].path;
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
            const ctx = document.createElement('canvas').getContext('2d');
            const iconData = [ null, null ];
            for ( const img of imgs ) {
                const w = img.r.naturalWidth, h = img.r.naturalHeight;
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
            icons[0] = { tabId: 0, imageData: iconData[0] };
            icons[1] = { tabId: 0, imageData: iconData[1] };
        };
        for ( const img of imgs ) {
            img.r = new Image();
            img.r.addEventListener('load', onLoaded, { once: true });
            img.r.src = icons[img.i].path[img.p];
        }
    })();

    const onTabReady = function(tab, details) {
        if ( vAPI.lastError() || !tab ) { return; }

        const { parts, state, badge, color } = details;

        if ( browserAction.setIcon !== undefined ) {
<<<<<<< HEAD
            if ( parts === undefined || (parts & 0x01) !== 0 ) {
                icons[state].tabId = tab.id;
                browserAction.setIcon(icons[state]);
=======
            if ( parts === undefined || (parts & 0b001) !== 0 ) {
                browserAction.setIcon(
                    Object.assign({ tabId: tab.id }, icons[state])
                );
>>>>>>> upstream1.22.0
            }
            if ( (parts & 0b010) !== 0 ) {
                browserAction.setBadgeText({ tabId: tab.id, text: badge });
            }
            if ( (parts & 0b100) !== 0 ) {
                browserAction.setBadgeBackgroundColor({ tabId: tab.id, color });
            }
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
    //        bit 2 = badge color

    return function(tabId, details) {
        tabId = toChromiumTabId(tabId);
        if ( tabId === 0 ) { return; }

        browser.tabs.get(tabId, tab => onTabReady(tab, details));

    var iconPaths;
};*/

vAPI.setIcon = (function() {
    var browserAction = chrome.browserAction,
        titleTemplate = chrome.runtime.getManifest().name + ' ({badge})';

    return function(tabId, iconStatus, badge) {

        var iconPaths; // ADN

        switch(iconStatus) { // ADN
            case 'dnt':
                iconPaths = { '16': 'img/adn_dnt_on_16.png', '32': 'img/adn_dnt_on_32.png' };
                break;
            case 'dntactive':
                iconPaths = { '16': 'img/adn_dnt_active_16.png', '32': 'img/adn_dnt_active_32.png' };
                break;
            case 'onactive':
                iconPaths = { '16': 'img/adn_active_16.png', '32': 'img/adn_active_32.png'};
                break;
            case 'on':
                iconPaths = { '16': 'img/adn_on_16.png', '32': 'img/adn_on_32.png'};
                break;
            case 'off':
                iconPaths = { '16': 'img/adn_off_16.png', '32': 'img/adn_off_32.png'};
                break;
        }

        tabId = toChromiumTabId(tabId);
        if ( tabId === 0 ) { return; }

        if ( browserAction && typeof browserAction.setIcon === 'function' ) {

            browserAction.setIcon(
                {
                    tabId: tabId,
                    path: iconPaths // ADN
                },
                function onIconReady() {
                    if ( vAPI.lastError() ) { return; }
                    chrome.browserAction.setBadgeText({
                        tabId: tabId,
                        text: badge
                    });
                    if ( badge !== '' ) {
                        chrome.browserAction.setBadgeBackgroundColor({
                            tabId: tabId,
                            color: '#666'
                        });
                    }
                }
            );
        }

        if ( browserAction && typeof browserAction.setTitle === 'function' ) {
            browserAction.setTitle({
                tabId: tabId,
                title: titleTemplate.replace(
                    '{badge}',
                    iconStatus.indexOf('on') > -1 || iconStatus.indexOf('dnt') > -1  ? (badge !== '' ? badge : '0') : 'off'
                )
            });
        }

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
        let callback = this.NOOPFUNC;
        if ( request.auxProcessId !== undefined ) {
            callback = callbackWrapperFactory(port, request).callback;
        }

        // Content process to main process: framework handler.
        if ( request.channelName === 'vapi' ) {
            toFramework(request, port, callback);
            return;
        }

        // Auxiliary process to main process: specific handler
        let r = this.UNHANDLED,
            listener = this.listeners[request.channelName];
        if ( typeof listener === 'function' ) {
            r = listener(request.msg, port.sender, callback);
        }
        if ( r !== this.UNHANDLED ) { return; }

        // Auxiliary process to main process: default handler
        r = this.defaultHandler(request.msg, port.sender, callback);
        if ( r !== this.UNHANDLED ) { return; }

        // Auxiliary process to main process: no handler
        log.info(
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

    if (message.what === 'notifications') { // ADN

      makeCloneable(message.notifications); // #1163
    }

    const messageWrapper = {
        broadcast: true,
        msg: message
    };
    for ( const port of this.ports.values() ) {
      try {
          port.postMessage(messageWrapper);
      } catch(ex) {
          this.ports.delete(port.name);
      }
    }
};

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/3474
// https://github.com/gorhill/uBlock/issues/2823
//   Foil ability of web pages to identify uBO through
//   its web accessible resources.
// https://github.com/gorhill/uBlock/issues/3497
//   Prevent web pages from interfering with uBO's element picker
// https://github.com/uBlockOrigin/uBlock-issues/issues/550
//   Support using a new secret for every network request.

vAPI.warSecret = (( ) => {
    const generateSecret = ( ) => {
        return Math.floor(Math.random() * 982451653 + 982451653).toString(36) +
               Math.floor(Math.random() * 982451653 + 982451653).toString(36);
    };

    const root = vAPI.getURL('/');
    const secrets = [];
    let lastSecretTime = 0;

    const guard = function(details) {
        const url = details.url;
        const pos = secrets.findIndex(secret =>
            url.lastIndexOf(`?secret=${secret}`) !== -1
        );
        if ( pos === -1 ) {
            return { redirectUrl: root };
        }
        secrets.splice(pos, 1);
    };

    browser.webRequest.onBeforeRequest.addListener(
        guard,
        {
            urls: [ root + 'web_accessible_resources/*' ]
        },
        [ 'blocking' ]
    );

    return ( ) => {
        if ( secrets.length !== 0 ) {
            if ( (Date.now() - lastSecretTime) > 5000 ) {
                secrets.splice(0);
            } else if ( secrets.length > 256 ) {
                secrets.splice(0, secrets.length - 192);
            }
        }
        lastSecretTime = Date.now();
        const secret = generateSecret();
        secrets.push(secret);
        return `?secret=${secret}`;
    };
})();

/******************************************************************************/

vAPI.Net = class {
    constructor() {
        this.validTypes = new Set();
        {
            const wrrt = browser.webRequest.ResourceType;
            for ( const typeKey in wrrt ) {
                if ( wrrt.hasOwnProperty(typeKey) ) {
                    this.validTypes.add(wrrt[typeKey]);
                }
            }
        }
        this.suspendableListener = undefined;
        this.listenerMap = new WeakMap();
        this.suspendDepth = 0;

        browser.webRequest.onBeforeRequest.addListener(
            details => {
                this.normalizeDetails(details);
                if ( this.suspendDepth === 0 ) {
                    if ( this.suspendableListener === undefined ) { return; }
                    return this.suspendableListener(details);
                }
                if ( details.tabId < 0 ) { return; }
                return this.suspendOneRequest(details);
            },
            this.denormalizeFilters({ urls: [ 'http://*/*', 'https://*/*' ] }),
            [ 'blocking' ]
        );
    }
    normalizeDetails(/* details */) {
    }
    denormalizeFilters(filters) {
        const urls = filters.urls || [ '<all_urls>' ];
        let types = filters.types;
        if ( Array.isArray(types) ) {
            types = this.denormalizeTypes(types);
        }
        if (
            (this.validTypes.has('websocket')) &&
            (types === undefined || types.indexOf('websocket') !== -1) &&
            (urls.indexOf('<all_urls>') === -1)
        ) {
            if ( urls.indexOf('ws://*/*') === -1 ) {
                urls.push('ws://*/*');
            }
            if ( urls.indexOf('wss://*/*') === -1 ) {
                urls.push('wss://*/*');
            }
        }
        return { types, urls };
    }
    denormalizeTypes(types) {
        return types;
    }
    addListener(which, clientListener, filters, options) {
        const actualFilters = this.denormalizeFilters(filters);
        const actualListener = this.makeNewListenerProxy(clientListener);
        browser.webRequest[which].addListener(
            actualListener,
            actualFilters,
            options
        );
    }
    setSuspendableListener(listener) {
        this.suspendableListener = listener;
    }
    removeListener(which, clientListener) {
        const actualListener = this.listenerMap.get(clientListener);
        if ( actualListener === undefined ) { return; }
        this.listenerMap.delete(clientListener);
        browser.webRequest[which].removeListener(actualListener);
    }
    makeNewListenerProxy(clientListener) {
        const actualListener = details => {
            this.normalizeDetails(details);
            return clientListener(details);
        };
        this.listenerMap.set(clientListener, actualListener);
        return actualListener;
    }
    suspendOneRequest() {
    }
    unsuspendAllRequests() {
    }
    suspend(force = false) {
        if ( this.canSuspend() || force ) {
            this.suspendDepth += 1;
        }
    }
    unsuspend() {
        if ( this.suspendDepth === 0 ) { return; }
        this.suspendDepth -= 1;
        if ( this.suspendDepth !== 0 ) { return; }
        this.unsuspendAllRequests(this.suspendableListener);
    }
    canSuspend() {
        return false;
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
        if (typeof chrome.contextMenus !== 'object') return; // ADN
        chrome.contextMenus.create(JSON.parse(JSON.stringify(entry)), function() {
            void chrome.runtime.lastError;
        });
    },
    onMustUpdate: function() {},
    setEntries: function(entries, callback) {
        if (typeof chrome.contextMenus !== 'object') return; // ADN
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

// This is called only once, when everything has been loaded in memory after
// the extension was launched. It can be used to inject content scripts
// in already opened web pages, to remove whatever nuisance could make it to
// the web pages before uBlock was ready.
//
// Also being used by ADN to inject content-scripts into dynamically-created
// iframes, as Chrome does not inject into these by default. This is needed
// because we often can't block the iframe outright, as we need the ads inside.
//
vAPI.onLoadAllCompleted = function(tabId, frameId) { //ADN

    // console.log('C.onLoadAllCompleted: '+tabId, frameId);

    // http://code.google.com/p/chromium/issues/detail?id=410868#c11
    // Need to be sure to access `vAPI.lastError()` to prevent
    // spurious warnings in the console.
    var onScriptInjected = function() {
        var err = vAPI.lastError();
        // console.log('C.onScriptInjected: ',err);
    };

    var scriptStart = function(tabId, frameId) {
        var manifest = chrome.runtime.getManifest();
        if ( manifest instanceof Object === false ) { return; }
        for ( var contentScript of manifest.content_scripts ) {
            for ( var file of contentScript.js ) {
                injectOne(tabId, frameId, file, 0);
            }
        }
    };
    var startInTab = function(tab, frameId) { // ADN
        var µb = µBlock;
        µb.tabContextManager.commit(tab.id, tab.url);
        µb.bindTabToPageStats(tab.id);
        // https://github.com/chrisaljoudi/uBlock/issues/129
        if ( /^https?:\/\//.test(tab.url) ) { // added in ub/1.10.0
          scriptStart(tab.id, frameId); //why scriptStart itself only take in one parameter?
        }
    };
    var injectOne = function(tabId, frameId, script, cb)  {

      var details = {
          file: script,
          allFrames: true,
          runAt: 'document_idle',
          matchAboutBlank:true
      }
      if (frameId) {
        details.frameId = frameId;
        details.matchAboutBlank = true;
      }
      vAPI.tabs.injectScript(tabId, details, cb || function(){});
    };
    var bindToTabs = function(tabs) {
        var i = tabs.length;
        while ( i-- ) {
            startInTab(tabs[i]);
        }
    };

    if (tabId)  {
// console.log('tabId: ');

        chrome.tabs.get(tabId, function(tab) {
          if (tab) startInTab(tab, frameId); }
        ); // ADN
    }
    else {
// console.log('no-tab: ');

        chrome.tabs.query({ url: '<all_urls>' }, bindToTabs);
    }
};


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
    // https://github.com/gorhill/uBlock/issues/3006
    //  For Firefox, we will use a lower ratio to allow for more overhead for
    //  the infrastructure. Unfortunately this leads to less usable space for
    //  actual data, but all of this is provided for free by browser vendors,
    //  so we need to accept and deal with these limitations.
    var evalMaxChunkSize = function() {
        return Math.floor(
            (chrome.storage.sync.QUOTA_BYTES_PER_ITEM || 8192) *
            (vAPI.webextFlavor.soup.has('firefox') ? 0.6 : 0.75)
        );
    };

    var maxChunkSize = evalMaxChunkSize();

    // The real actual webextFlavor value may not be set in stone, so listen
    // for possible future changes.
    window.addEventListener('webextFlavor', function() {
        maxChunkSize = evalMaxChunkSize();
    }, { once: true });

    // Mind chrome.storage.sync.QUOTA_BYTES (128 kB at time of writing)
    // Firefox:
    // https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/storage/sync
    // > You can store up to 100KB of data using this API/
    var maxStorageSize = chrome.storage.sync.QUOTA_BYTES || 102400;

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
                if ( vAPI.webextFlavor.soup.has('firefox') ) {
                    chunkCount = 0;
                }
            }
            callback(errorStr);

            // Remove potentially unused trailing chunks
            deleteChunks(dataKey, chunkCount);
        });
    };

    var pull = function(dataKey, callback) {

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

vAPI.getAddonInfo = function (callback) {

  var uBlockConflict = false, adBlockConflict = false;

  // Note this is not yet implemented in Firefox/WebExtensions
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1282981
  // See https://github.com/dhowe/AdNauseam/issues/801
  if (typeof chrome.management.getAll === 'function') {

    chrome.management.getAll(function (extensions) {

      if (chrome.runtime.lastError) {

        // do nothing

      } else {

        extensions.forEach(function (extension) {

          if ((extension.name.startsWith("Adblock") || extension.name.startsWith("AdBlock")) && extension.enabled)
            adBlockConflict = true;
          else if (extension.name.startsWith("uBlock") && extension.enabled)
            uBlockConflict = true;
        });

        callback(uBlockConflict, adBlockConflict);
      }
    });
  }
}

})();

/******************************************************************************/

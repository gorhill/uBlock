/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2015 The uBlock Origin authors
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

{
// >>>>> start of local scope

/******************************************************************************/
/******************************************************************************/

const browser = self.browser;
const manifest = browser.runtime.getManifest();

vAPI.cantWebsocket =
    browser.webRequest.ResourceType instanceof Object === false  ||
    browser.webRequest.ResourceType.WEBSOCKET !== 'websocket';

vAPI.supportsUserStylesheets = vAPI.webextFlavor.soup.has('user_stylesheet');
// The real actual webextFlavor value may not be set in stone, so listen
// for possible future changes.
window.addEventListener('webextFlavor', function() {
    vAPI.supportsUserStylesheets =
        vAPI.webextFlavor.soup.has('user_stylesheet');
}, { once: true });

/******************************************************************************/

vAPI.app = {
    name: manifest.name.replace(/ dev\w+ build/, ''),
    version: (( ) => {
        let version = manifest.version;
        const match = /(\d+\.\d+\.\d+)(?:\.(\d+))?/.exec(version);
        if ( match && match[2] ) {
            const v = parseInt(match[2], 10);
            version = match[1] + (v < 100 ? 'b' + v : 'rc' + (v - 100));
        }
        return version;
    })(),

    intFromVersion: function(s) {
        const parts = s.match(/(?:^|\.|b|rc)\d+/g);
        if ( parts === null ) { return 0; }
        let vint = 0;
        for ( let i = 0; i < 4; i++ ) {
            const pstr = parts[i] || '';
            let pint;
            if ( pstr === '' ) {
                pint = 0;
            } else if ( pstr.startsWith('.') || pstr.startsWith('b') ) {
                pint = parseInt(pstr.slice(1), 10);
            } else if ( pstr.startsWith('rc') ) {
                pint = parseInt(pstr.slice(2), 10) + 100;
            } else {
                pint = parseInt(pstr, 10);
            }
            vint = vint * 1000 + pint;
        }
        return vint;
    },

    restart: function() {
        browser.runtime.reload();
    },
};

/******************************************************************************/
/******************************************************************************/

vAPI.storage = webext.storage.local;

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/uMatrix/issues/234
// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/privacy/network

// https://github.com/gorhill/uBlock/issues/2048
//   Do not mess up with existing settings if not assigning them stricter
//   values.

vAPI.browserSettings = (( ) => {
    // Not all platforms support `browser.privacy`.
    const bp = webext.privacy;
    if ( bp instanceof Object === false ) { return; }

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

            const bpn = bp.network;

            if ( setting ) {
                bpn.webRTCIPHandlingPolicy.clear({
                    scope: 'regular',
                });
            } else {
                // https://github.com/uBlockOrigin/uAssets/issues/333#issuecomment-289426678
                //   Leverage virtuous side-effect of strictest setting.
                // https://github.com/gorhill/uBlock/issues/3009
                //   Firefox currently works differently, use
                //   `default_public_interface_only` for now.
                bpn.webRTCIPHandlingPolicy.set({
                    value: vAPI.webextFlavor.soup.has('chromium')
                        ? 'disable_non_proxied_udp'
                        : 'default_public_interface_only',
                    scope: 'regular',
                });
            }
        },

        set: function(details) {
            for ( const setting in details ) {
                if ( details.hasOwnProperty(setting) === false ) { continue; }
                switch ( setting ) {
                case 'prefetching':
                    const enabled = !!details[setting];
                    if ( enabled ) {
                        bp.network.networkPredictionEnabled.clear({
                            scope: 'regular',
                        });
                    } else {
                        bp.network.networkPredictionEnabled.set({
                            value: false,
                            scope: 'regular',
                        });
                    }
                    if ( vAPI.prefetching instanceof Function ) {
                        vAPI.prefetching(enabled);
                    }
                    break;

                case 'hyperlinkAuditing':
                    if ( !!details[setting] ) {
                        bp.websites.hyperlinkAuditingEnabled.clear({
                            scope: 'regular',
                        });
                    } else {
                        bp.websites.hyperlinkAuditingEnabled.set({
                            value: false,
                            scope: 'regular',
                        });
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

// To ensure we always use a good tab id
const toTabId = function(tabId) {
    return typeof tabId === 'number' && isNaN(tabId) === false
        ? tabId
        : 0;
};

// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webNavigation
// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs

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
            this.onCreated(details);
        });

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
            browser.windows.onFocusChanged.addListener(async windowId => {
                if ( windowId === browser.windows.WINDOW_ID_NONE ) { return; }
                const tabs = await vAPI.tabs.query({ active: true, windowId });
                if ( tabs.length === 0 ) { return; }
                const tab = tabs[0];
                this.onActivated({ tabId: tab.id, windowId: tab.windowId });
            });
        }

        browser.tabs.onRemoved.addListener((tabId, details) => {
            this.onClosed(tabId, details);
        });
     }

    async executeScript() {
        let result;
        try {
            result = await webext.tabs.executeScript(...arguments);
        }
        catch(reason) {
        }
        return Array.isArray(result) ? result : [];
    }

    async get(tabId) {
        if ( tabId === null ) {
            return this.getCurrent();
        }
        if ( tabId <= 0 ) { return null; }
        let tab;
        try {
            tab = await webext.tabs.get(tabId);
        }
        catch(reason) {
        }
        return tab instanceof Object ? tab : null;
    }

    async getCurrent() {
        const tabs = await this.query({ active: true, currentWindow: true });
        return tabs.length !== 0 ? tabs[0] : null;
    }

    async insertCSS() {
        try {
            await webext.tabs.insertCSS(...arguments);
        }
        catch(reason) {
        }
    }

    async query(queryInfo) {
        let tabs;
        try {
            tabs = await webext.tabs.query(queryInfo);
        }
        catch(reason) {
        }
        return Array.isArray(tabs) ? tabs : [];
    }

    async removeCSS() {
        try {
            await webext.tabs.removeCSS(...arguments);
        }
        catch(reason) {
        }
    }

    // Properties of the details object:
    // - url: 'URL',    => the address that will be opened
    // - index: -1,     => undefined: end of the list, -1: following tab,
    //                     or after index
    // - active: false, => opens the tab... in background: true,
    //                     foreground: undefined
    // - popup: 'popup' => open in a new window

    async create(url, details) {
        if ( details.active === undefined ) {
            details.active = true;
        }

        const subWrapper = async ( ) => {
            const updateDetails = {
                url: url,
                active: !!details.active
            };

            // Opening a tab from incognito window won't focus the window
            // in which the tab was opened
            const focusWindow = tab => {
                if ( tab.active && vAPI.windows instanceof Object ) {
                    vAPI.windows.update(tab.windowId, { focused: true });
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
            const tab = await vAPI.tabs.update(
                toTabId(details.tabId),
                updateDetails
            );
            // if the tab doesn't exist
            if ( tab === null ) {
                browser.tabs.create(updateDetails, focusWindow);
            } else if ( details.index !== undefined ) {
                browser.tabs.move(tab.id, { index: details.index });
            }
        };

        // Open in a standalone window
        //
        // https://github.com/uBlockOrigin/uBlock-issues/issues/168#issuecomment-413038191
        //   Not all platforms support vAPI.windows.
        //
        // For some reasons, some platforms do not honor the left,top
        // position when specified. I found that further calling
        // windows.update again with the same position _may_ help.
        if ( details.popup !== undefined && vAPI.windows instanceof Object ) {
            const createDetails = {
                url: details.url,
                type: details.popup,
            };
            if ( details.box instanceof Object ) {
                Object.assign(createDetails, details.box);
            }
            const win = await vAPI.windows.create(createDetails);
            if ( win === null ) { return; }
            if ( details.box instanceof Object === false ) { return; }
            if (
                win.left === details.box.left &&
                win.top === details.box.top
            ) {
                return;
            }
            vAPI.windows.update(win.id, {
                left: details.box.left,
                top: details.box.top
            });
            return;
        }

        if ( details.index !== -1 ) {
            subWrapper();
            return;
        }

        const tab = await vAPI.tabs.getCurrent();
        if ( tab !== null ) {
            details.index = tab.index + 1;
        } else {
            details.index = undefined;
        }
        subWrapper();
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

    async open(details) {
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

        // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/query#Parameters
        //   "Note that fragment identifiers are not matched."
        //   Fragment identifiers ARE matched -- we need to remove the fragment.
        const pos = targetURL.indexOf('#');
        const targetURLWithoutHash = pos === -1
            ? targetURL
            : targetURL.slice(0, pos);

        const tabs = await vAPI.tabs.query({ url: targetURLWithoutHash });
        if ( tabs.length === 0 ) {
            this.create(targetURL, details);
            return;
        }
        let tab = tabs[0];
        const updateDetails = { active: true };
        // https://github.com/uBlockOrigin/uBlock-issues/issues/592
        if ( tab.url.startsWith(targetURL) === false ) {
            updateDetails.url = targetURL;
        }
        tab = await vAPI.tabs.update(tab.id, updateDetails);
        if ( vAPI.windows instanceof Object === false ) { return; }
        vAPI.windows.update(tab.windowId, { focused: true });
    }

    async update() {
        let tab;
        try {
            tab = await webext.tabs.update(...arguments);
        }
        catch (reason) {
        }
        return tab instanceof Object ? tab : null;
    }

    // Replace the URL of a tab. Noop if the tab does not exist.
    replace(tabId, url) {
        tabId = toTabId(tabId);
        if ( tabId === 0 ) { return; }

        let targetURL = url;

        // extension pages
        if ( /^[\w-]{2,}:/.test(targetURL) !== true ) {
            targetURL = vAPI.getURL(targetURL);
        }

        vAPI.tabs.update(tabId, { url: targetURL });
    }

    async remove(tabId) {
        tabId = toTabId(tabId);
        if ( tabId === 0 ) { return; }
        try {
            await webext.tabs.remove(tabId);
        }
        catch (reason) {
        }
    }

    async reload(tabId, bypassCache = false) {
        tabId = toTabId(tabId);
        if ( tabId === 0 ) { return; }
        try {
            await webext.tabs.reload(
                tabId,
                { bypassCache: bypassCache === true }
            );
        }
        catch (reason) {
        }
    }

    async select(tabId) {
        tabId = toTabId(tabId);
        if ( tabId === 0 ) { return; }
        const tab = await vAPI.tabs.update(tabId, { active: true });
        if ( tab === null ) { return; }
        if ( vAPI.windows instanceof Object === false ) { return; }
        vAPI.windows.update(tab.windowId, { focused: true });
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

    onClosed(/* tabId, details */) {
    }

    onCreated(/* details */) {
    }

    onNavigation(/* details */) {
    }

    onUpdated(/* tabId, changeInfo, tab */) {
    }
};

/******************************************************************************/
/******************************************************************************/

if ( webext.windows instanceof Object ) {
    vAPI.windows = {
        get: async function() {
            let win;
            try {
                win = await webext.windows.get(...arguments);
            }
            catch (reason) {
            }
            return win instanceof Object ? win : null;
        },
        create: async function() {
            let win;
            try {
                win = await webext.windows.create(...arguments);
            }
            catch (reason) {
            }
            return win instanceof Object ? win : null;
        },
        update: async function() {
            let win;
            try {
                win = await webext.windows.update(...arguments);
            }
            catch (reason) {
            }
            return win instanceof Object ? win : null;
        },
    };
}

/******************************************************************************/
/******************************************************************************/

if ( webext.browserAction instanceof Object ) {
    vAPI.browserAction = {
        setTitle: async function() {
            try {
                await webext.browserAction.setTitle(...arguments);
            }
            catch (reason) {
            }
        },
    };
    // Not supported on Firefox for Android
    if ( webext.browserAction.setIcon ) {
        vAPI.browserAction.setBadgeTextColor = async function() {
            try {
                await webext.browserAction.setBadgeTextColor(...arguments);
            }
            catch (reason) {
            }
        };
        vAPI.browserAction.setBadgeBackgroundColor = async function() {
            try {
                await webext.browserAction.setBadgeBackgroundColor(...arguments);
            }
            catch (reason) {
            }
        };
        vAPI.browserAction.setBadgeText = async function() {
            try {
                await webext.browserAction.setBadgeText(...arguments);
            }
            catch (reason) {
            }
        };
        vAPI.browserAction.setIcon = async function() {
            try {
                await webext.browserAction.setIcon(...arguments);
            }
            catch (reason) {
            }
        };
    }
}

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

vAPI.setIcon = (( ) => {
    const browserAction = vAPI.browserAction;
    const  titleTemplate =
        browser.runtime.getManifest().browser_action.default_title +
        ' ({badge})';
    const icons = [
        { path: { '16': 'img/icon_16-off.png', '32': 'img/icon_32-off.png' } },
        { path: { '16':     'img/icon_16.png', '32':     'img/icon_32.png' } },
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

    // parts: bit 0 = icon
    //        bit 1 = badge text
    //        bit 2 = badge color
    //        bit 3 = hide badge

    return async function(tabId, details) {
        tabId = toTabId(tabId);
        if ( tabId === 0 ) { return; }

        const tab = await vAPI.tabs.get(tabId);
        if ( tab === null ) { return; }

        const { parts, state, badge, color } = details;

        if ( browserAction.setIcon !== undefined ) {
            if ( parts === undefined || (parts & 0b0001) !== 0 ) {
                browserAction.setIcon(
                    Object.assign({ tabId: tab.id }, icons[state])
                );
            }
            if ( (parts & 0b0010) !== 0 ) {
                browserAction.setBadgeText({
                    tabId: tab.id,
                    text: (parts & 0b1000) === 0 ? badge : ''
                });
            }
            if ( (parts & 0b0100) !== 0 ) {
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

        if ( vAPI.contextMenu instanceof Object ) {
            vAPI.contextMenu.onMustUpdate(tabId);
        }
    };
})();

browser.browserAction.onClicked.addListener(function(tab) {
    vAPI.tabs.open({
        select: true,
        url: 'popup.html?tabId=' + tab.id + '&responsive=1'
    });
});

/******************************************************************************/
/******************************************************************************/

// https://github.com/uBlockOrigin/uBlock-issues/issues/710
//   uBO uses only ports to communicate with its auxiliary pages and
//   content scripts. Whether a message can trigger a privileged operation is
//   decided based on whether the port from which a message is received is
//   privileged, which is a status evaluated once, at port connection time.

vAPI.messaging = {
    ports: new Map(),
    listeners: new Map(),
    defaultHandler: null,
    PRIVILEGED_URL: vAPI.getURL(''),
    NOOPFUNC: function(){},
    UNHANDLED: 'vAPI.messaging.notHandled',

    listen: function(details) {
        this.listeners.set(details.name, {
            fn: details.listener,
            privileged: details.privileged === true
        });
    },

    onPortDisconnect: function(port) {
        this.ports.delete(port.name);
    },

    onPortConnect: function(port) {
        port.onDisconnect.addListener(
            port => this.onPortDisconnect(port)
        );
        port.onMessage.addListener(
            (request, port) => this.onPortMessage(request, port)
        );
        this.ports.set(port.name, {
            port,
            privileged: port.sender.url.startsWith(this.PRIVILEGED_URL)
        });
    },

    setup: function(defaultHandler) {
        if ( this.defaultHandler !== null ) { return; }

        if ( typeof defaultHandler !== 'function' ) {
            defaultHandler = function() {
                return this.UNHANDLED;
            };
        }
        this.defaultHandler = defaultHandler;

        browser.runtime.onConnect.addListener(
            port => this.onPortConnect(port)
        );

        // https://bugzilla.mozilla.org/show_bug.cgi?id=1392067
        //   Workaround: manually remove ports matching removed tab.
        if (
            vAPI.webextFlavor.soup.has('firefox') &&
            vAPI.webextFlavor.major < 61
        ) {
            browser.tabs.onRemoved.addListener(tabId => {
                for ( const { port } of this.ports.values() ) {
                    const tab = port.sender && port.sender.tab;
                    if ( !tab ) { continue; }
                    if ( tab.id === tabId ) {
                        this.onPortDisconnect(port);
                    }
                }
            });
        }
    },

    broadcast: function(message) {
        const messageWrapper = { broadcast: true, msg: message };
        for ( const { port } of this.ports.values() ) {
            try {
                port.postMessage(messageWrapper);
            } catch(ex) {
                this.ports.delete(port.name);
            }
        }
    },

    onFrameworkMessage: function(request, port, callback) {
        const sender = port && port.sender;
        if ( !sender ) { return; }
        const tabId = sender.tab && sender.tab.id || undefined;
        const msg = request.msg;
        switch ( msg.what ) {
        case 'connectionAccepted':
        case 'connectionRefused': {
            const toPort = this.ports.get(msg.fromToken);
            if ( toPort !== undefined ) {
                msg.tabId = tabId;
                toPort.port.postMessage(request);
            } else {
                msg.what = 'connectionBroken';
                port.postMessage(request);
            }
            break;
        }
        case 'connectionRequested':
            msg.tabId = tabId;
            for ( const { port: toPort } of this.ports.values() ) {
                if ( toPort === port ) { continue; }
                toPort.postMessage(request);
            }
            break;
        case 'connectionBroken':
        case 'connectionCheck':
        case 'connectionMessage': {
            const toPort = this.ports.get(
                port.name === msg.fromToken ? msg.toToken : msg.fromToken
            );
            if ( toPort !== undefined ) {
                msg.tabId = tabId;
                toPort.port.postMessage(request);
            } else {
                msg.what = 'connectionBroken';
                port.postMessage(request);
            }
            break;
        }
        case 'extendClient':
            vAPI.tabs.executeScript(tabId, {
                file: '/js/vapi-client-extra.js',
            }).then(( ) => {
                callback();
            });
            break;
        case 'userCSS':
            if ( tabId === undefined ) { break; }
            const details = {
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
            const promises = [];
            for ( const cssText of msg.add ) {
                details.code = cssText;
                promises.push(vAPI.tabs.insertCSS(tabId, details));
            }
            if ( typeof webext.tabs.removeCSS === 'function' ) {
                for ( const cssText of msg.remove ) {
                    details.code = cssText;
                    promises.push(vAPI.tabs.removeCSS(tabId, details));
                }
            }
            Promise.all(promises).then(( ) => {
                callback();
            });
            break;
        }
    },

    // Use a wrapper to avoid closure and to allow reuse.
    CallbackWrapper: class {
        constructor(messaging, port, msgId) {
            this.messaging = messaging;
            this.callback = this.proxy.bind(this); // bind once
            this.init(port, msgId);
        }
        init(port, msgId) {
            this.port = port;
            this.msgId = msgId;
            return this;
        }
        proxy(response) {
            // https://github.com/chrisaljoudi/uBlock/issues/383
            if ( this.messaging.ports.has(this.port.name) ) {
                this.port.postMessage({
                    msgId: this.msgId,
                    msg: response !== undefined ? response : null,
                });
            }
            // Store for reuse
            this.port = null;
            this.messaging.callbackWrapperJunkyard.push(this);
        }
    },

    callbackWrapperJunkyard: [],

    callbackWrapperFactory: function(port, msgId) {
        return this.callbackWrapperJunkyard.length !== 0
            ? this.callbackWrapperJunkyard.pop().init(port, msgId)
            : new this.CallbackWrapper(this, port, msgId);
    },

    onPortMessage: function(request, port) {
        // prepare response
        let callback = this.NOOPFUNC;
        if ( request.msgId !== undefined ) {
            callback = this.callbackWrapperFactory(port, request.msgId).callback;
        }

        // Content process to main process: framework handler.
        if ( request.channel === 'vapi' ) {
            this.onFrameworkMessage(request, port, callback);
            return;
        }

        // Auxiliary process to main process: specific handler
        const fromDetails = this.ports.get(port.name);
        if ( fromDetails === undefined ) { return; }

        const listenerDetails = this.listeners.get(request.channel);
        let r = this.UNHANDLED;
        if (
            (listenerDetails !== undefined) &&
            (listenerDetails.privileged === false || fromDetails.privileged)
            
        ) {
            r = listenerDetails.fn(request.msg, port.sender, callback);
        }
        if ( r !== this.UNHANDLED ) { return; }

        // Auxiliary process to main process: default handler
        if ( fromDetails.privileged ) {
            r = this.defaultHandler(request.msg, port.sender, callback);
            if ( r !== this.UNHANDLED ) { return; }
        }

        // Auxiliary process to main process: no handler
        log.info(
            `vAPI.messaging.onPortMessage > unhandled request: ${JSON.stringify(request.msg)}`,
            request
        );

        // Need to callback anyways in case caller expected an answer, or
        // else there is a memory leak on caller's side
        callback();
    },
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
        return Math.floor(Math.random() * 982451653 + 982451653).toString(36);
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
                if ( this.suspendDepth === 0 || details.tabId < 0 ) {
                    if ( this.suspendableListener === undefined ) { return; }
                    return this.suspendableListener(details);
                }
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

vAPI.contextMenu = webext.menus && {
    _callback: null,
    _entries: [],
    _createEntry: function(entry) {
        webext.menus.create(JSON.parse(JSON.stringify(entry)));
    },
    onMustUpdate: function() {},
    setEntries: function(entries, callback) {
        entries = entries || [];
        let n = Math.max(this._entries.length, entries.length);
        for ( let i = 0; i < n; i++ ) {
            const oldEntryId = this._entries[i];
            const newEntry = entries[i];
            if ( oldEntryId && newEntry ) {
                if ( newEntry.id !== oldEntryId ) {
                    webext.menus.remove(oldEntryId);
                    this._createEntry(newEntry);
                    this._entries[i] = newEntry.id;
                }
            } else if ( oldEntryId && !newEntry ) {
                webext.menus.remove(oldEntryId);
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
            webext.menus.onClicked.addListener(callback);
            this._callback = callback;
        } else if ( n === 0 && this._callback !== null ) {
            webext.menus.onClicked.removeListener(this._callback);
            this._callback = null;
        }
    }
};

/******************************************************************************/
/******************************************************************************/

vAPI.commands = browser.commands;

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/531
//   Storage area dedicated to admin settings. Read-only.

// https://github.com/gorhill/uBlock/commit/43a5ed735b95a575a9339b6e71a1fcb27a99663b#commitcomment-13965030
// Not all Chromium-based browsers support managed storage. Merely testing or
// exception handling in this case does NOT work: I don't know why. The
// extension on Opera ends up in a non-sensical state, whereas vAPI become
// undefined out of nowhere. So only solution left is to test explicitly for
// Opera.
// https://github.com/gorhill/uBlock/issues/900
// Also, UC Browser: http://www.upsieutoc.com/image/WXuH

vAPI.adminStorage = (( ) => {
    if ( webext.storage.managed instanceof Object === false ) {
        return {
            getItem: function() {
                return Promise.resolve();
            },
        };
    }
    return {
        getItem: async function(key) {
            let bin;
            try {
                bin = await webext.storage.managed.get(key);
            } catch(ex) {
            }
            if ( bin instanceof Object ) {
                return bin[key];
            }
        }
    };
})();

/******************************************************************************/
/******************************************************************************/

// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync

vAPI.cloud = (( ) => {
    // Not all platforms support `webext.storage.sync`.
    if ( webext.storage.sync instanceof Object === false ) { return; }

    // Currently, only Chromium supports the following constants -- these
    // values will be assumed for platforms which do not define them.
    // https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/storage/sync
    //   > You can store up to 100KB of data using this API
    const MAX_ITEMS =
        webext.storage.sync.MAX_ITEMS || 512;
    const QUOTA_BYTES =
        webext.storage.sync.QUOTA_BYTES || 102400;
    const QUOTA_BYTES_PER_ITEM =
        webext.storage.sync.QUOTA_BYTES_PER_ITEM || 8192;

    const chunkCountPerFetch = 16; // Must be a power of 2
    const maxChunkCountPerItem = Math.floor(MAX_ITEMS * 0.75) & ~(chunkCountPerFetch - 1);

    // https://github.com/gorhill/uBlock/issues/3006
    //   For Firefox, we will use a lower ratio to allow for more overhead for
    //   the infrastructure. Unfortunately this leads to less usable space for
    //   actual data, but all of this is provided for free by browser vendors,
    //   so we need to accept and deal with these limitations.
    const evalMaxChunkSize = function() {
        return Math.floor(
            QUOTA_BYTES_PER_ITEM *
            (vAPI.webextFlavor.soup.has('firefox') ? 0.6 : 0.75)
        );
    };

    let maxChunkSize = evalMaxChunkSize();

    // The real actual webextFlavor value may not be set in stone, so listen
    // for possible future changes.
    window.addEventListener('webextFlavor', function() {
        maxChunkSize = evalMaxChunkSize();
    }, { once: true });

    const maxStorageSize = QUOTA_BYTES;

    const options = {
        defaultDeviceName: window.navigator.platform,
        deviceName: vAPI.localStorage.getItem('deviceName') || ''
    };

    // This is used to find out a rough count of how many chunks exists:
    // We "poll" at specific index in order to get a rough idea of how
    // large is the stored string.
    // This allows reading a single item with only 2 sync operations -- a
    // good thing given chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE
    // and chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR.

    const getCoarseChunkCount = async function(dataKey) {
        const keys = {};
        for ( let i = 0; i < maxChunkCountPerItem; i += 16 ) {
            keys[dataKey + i.toString()] = '';
        }
        let bin;
        try {
            bin = await webext.storage.sync.get(keys);
        } catch (reason) {
            return reason;
        }
        let chunkCount = 0;
        for ( let i = 0; i < maxChunkCountPerItem; i += 16 ) {
            if ( bin[dataKey + i.toString()] === '' ) { break; }
            chunkCount = i + 16;
        }
        return chunkCount;
    };

    const deleteChunks = function(dataKey, start) {
        const keys = [];

        // No point in deleting more than:
        // - The max number of chunks per item
        // - The max number of chunks per storage limit
        const n = Math.min(
            maxChunkCountPerItem,
            Math.ceil(maxStorageSize / maxChunkSize)
        );
        for ( let i = start; i < n; i++ ) {
            keys.push(dataKey + i.toString());
        }
        if ( keys.length !== 0 ) {
            webext.storage.sync.remove(keys);
        }
    };

    const push = async function(dataKey, data) {

        let bin = {
            'source': options.deviceName || options.defaultDeviceName,
            'tstamp': Date.now(),
            'data': data,
            'size': 0
        };
        bin.size = JSON.stringify(bin).length;
        const item = JSON.stringify(bin);

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

        let result;
        let errorStr;
        try {
            result = await webext.storage.sync.set(bin);
        } catch (reason) {
            errorStr = reason;
        }

        // https://github.com/gorhill/uBlock/issues/3006#issuecomment-332597677
        // - Delete all that was pushed in case of failure.
        // - It's unknown whether such issue applies only to Firefox:
        //   until such cases are reported for other browsers, we will
        //   reset the (now corrupted) content of the cloud storage
        //   only on Firefox.
        if ( errorStr !== undefined && vAPI.webextFlavor.soup.has('firefox') ) {
            chunkCount = 0;
        }

        // Remove potentially unused trailing chunks
        deleteChunks(dataKey, chunkCount);

        return errorStr;
    };

    const pull = async function(dataKey) {

        const result = await getCoarseChunkCount(dataKey);
        if ( typeof result !== 'number' ) {
            return result;
        }
        const chunkKeys = {};
        for ( let i = 0; i < result; i++ ) {
            chunkKeys[dataKey + i.toString()] = '';
        }

        let bin;
        try {
            bin = await webext.storage.sync.get(chunkKeys);
        } catch (reason) {
            return reason;
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
        return entry;
    };

    const getOptions = function(callback) {
        if ( typeof callback !== 'function' ) { return; }
        callback(options);
    };

    const setOptions = function(details, callback) {
        if ( typeof details !== 'object' || details === null ) { return; }

        if ( typeof details.deviceName === 'string' ) {
            vAPI.localStorage.setItem('deviceName', details.deviceName);
            options.deviceName = details.deviceName;
        }

        getOptions(callback);
    };

    return { push, pull, getOptions, setOptions };
})();

/******************************************************************************/
/******************************************************************************/

// <<<<< end of local scope
}

/******************************************************************************/

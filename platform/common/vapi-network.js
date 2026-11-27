/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
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

import * as frameManager from './vapi-contexts.js';

/******************************************************************************/

const browser = globalThis.browser ?? globalThis.chrome;

// https://github.com/gorhill/uBlock/issues/3474
// https://github.com/gorhill/uBlock/issues/2823
//   Foil ability of web pages to identify uBO through its web accessible resources.
// https://github.com/gorhill/uBlock/issues/3497
//   Prevent web pages from interfering with uBO's element picker

vAPI.Net = class {
    constructor() {
        this.validTypes = new Set();
        {
            const wrrt = browser.webRequest.ResourceType;
            for ( const typeKey in wrrt ) {
                if ( Object.hasOwn(wrrt, typeKey) ) {
                    this.validTypes.add(wrrt[typeKey]);
                }
            }
        }
        this.warOrigin = vAPI.Net.warOrigin;
        this.suspendableListener = undefined;
        this.deferredSuspendableListener = undefined;
        this.listenerMap = new WeakMap();
        this.suspendDepth = 0;
        this.unprocessedTabs = new Map();
    }

    start() {
        browser.webRequest.onBeforeRequest.addListener(
            details => {
                if ( details.tabId !== frameManager.TAB_ID_NONE ) {
                    const { type } = details;
                    if ( type === 'main_frame' || type === 'sub_frame' ) {
                        frameManager.addFrame(details);
                    }
                }
                this.normalizeDetails(details);
                if ( details.url.startsWith(this.warOrigin) ) {
                    return this.onBeforeWarRequest(details);
                }
                return this.onBeforeSuspendableRequest(details);
            },
            this.denormalizeFilters({ urls: [
                'http://*/*',
                'https://*/*',
                `${this.warOrigin}/*`,
            ] }),
            [ 'blocking' ]
        );
    }

    getWarOrigin() {
        return this.warOrigin;
    }

    getWarURL(warName = '') {
        return new URL(`${this.warOrigin}/${warName}`);
    }

    reuseWarURL(warURL) {
        return new URL(warURL);
    }

    onBeforeWarRequest() {
    }

    setOptions(/* options */) {
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

    canonicalNameFromHostname(/* hn */) {
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

    onBeforeSuspendableRequest(details) {
        if ( this.suspendableListener === undefined ) {
            if ( details.tabId < 0 ) { return; }
            return this.onSuspendedRequest(details);
        }
        return this.suspendableListener(details);
    }

    setSuspendableListener(listener) {
        this.suspendableListener = listener;
        vAPI.setDefaultIcon('', null);
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

    handlerBehaviorChanged() {
        browser.webRequest.handlerBehaviorChanged();
    }

    onSuspendedRequest(details) {
        const defer = this.suspendDepth !== 0;
        const entry = this.suspendOneRequest(defer, details);
        if ( entry === undefined ) { return; }
        const { tabId } = details;
        const requests = this.unprocessedTabs.get(tabId) ?? [];
        if ( requests.length === 0 ) {
            this.unprocessedTabs.set(tabId, requests);
        }
        requests.push(entry);
        if ( entry.outcome ) {
            return entry.outcome;
        }
        if ( this.defaultBadgeText === '!' ) { return; }
        vAPI.setDefaultIcon(null, '!');
    }

    hasUnprocessedRequest(tabId) {
        if ( this.unprocessedTabs.size === 0 ) { return false; }
        if ( tabId === undefined ) { return true; }
        const requests = this.unprocessedTabs.get(tabId);
        if ( requests === undefined ) { return false; }
        return requests.some(a => a.outcome === undefined);
    }

    suspendOneRequest() {
    }

    unsuspendManyRequests() {
    }

    suspend() {
        this.suspendDepth += 1;
    }

    unsuspend(details = {}) {
        const { all = false, discard = false, clear = true } = details;
        if ( all ) {
            this.suspendDepth = 0;
        } else if ( this.suspendDepth > 0 ) {
            this.suspendDepth -= 1;
        }
        if ( this.suspendDepth !== 0 ) { return; }
        const unprocessedTabs = this.unprocessedTabs;
        if ( clear ) {
            this.unprocessedTabs = new Map();
        }
        for ( const [ tabId, requests ] of unprocessedTabs ) {
            this.unsuspendManyRequests(tabId, requests, discard);
        }
    }

    headerValue(headers, name) {
        for ( const header of headers ) {
            if ( header.name.toLowerCase() === name ) {
                return header.value.trim();
            }
        }
        return '';
    }

    static canSuspend() {
        return false;
    }

    static warOrigin = vAPI.getURL('/web_accessible_resources').replace(/\/$/, '');
};

/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2026-present Raymond Hill

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

/* global browser */

import webext from './webext.js';

/******************************************************************************/

export const tabDict = new Map();
export const TAB_ID_NONE = browser.tabs.TAB_ID_NONE;
export let activeTabId = 0;

const listeners = new Set();
const reIsHTTP = /^https?:\/\//;

/******************************************************************************/

function onCreatedNavigationTarget(details) {
    if ( details.tabId === TAB_ID_NONE ) { return; }
    Object.assign(details, { frameId: 0, parentFrameId: -1 });
    addFrame(details);
    for ( const listener of listeners ) {
        listener('before-tab-created', details);
    }
}

function onBeforeNavigate(details) {
    if ( details.tabId === TAB_ID_NONE ) { return; }
    addFrame(details);
    for ( const listener of listeners ) {
        listener('before-frame-committed', details);
    }
}

function onCommitted(details) {
    if ( details.tabId === TAB_ID_NONE ) { return; }
    addFrame(details);
    for ( const listener of listeners ) {
        listener('frame-committed', details);
    }
}

function onFrameRemoved(tabId, frameId) {
    const tabData = tabDict.get(tabId);
    if ( tabData === undefined ) { return; }
    const frameData = tabData.frameDict.get(frameId);
    if ( frameData === undefined ) { return; }
    tabData.frameDict.delete(frameId);
    const details = { tabId, frameId };
    for ( const listener of listeners ) {
        listener('frame-removed', details);
    }
}

function onTabCreated(tab) {
    const details = { tabId: tab.id, frameId: 0, parentFrameId: -1, url: tab.url };
    if ( tab.active ) { activeTabId = details.tabId; }
    addFrame(details);
    for ( const listener of listeners ) {
        listener('tab-created', details);
        listener('before-frame-committed', details);
    }
    return tabDict.get(tab.id);
}

async function onTabActivated(details) {
    const { tabId } = details;
    activeTabId = tabId;
    if ( tabDict.has(tabId) === false ) {
        const tab = await browser.tabs.get(tabId);
        onTabCreated(tab);
    }
    for ( const listener of listeners ) {
        listener('tab-activated', details);
    }
}

function onWindowFocused(windowId) {
    if ( windowId === browser.windows.WINDOW_ID_NONE ) { return; }
    if ( windowId === onWindowFocused.windowId ) { return; }
    onWindowFocused.windowId = windowId;
    webext.tabs.query({ active: true, windowId }).then(tabs => {
        if ( tabs.length === 0 ) { return; }
        const tabId = tabs[0].id;
        activeTabId = tabId;
        onTabActivated({ tabId, windowId });
    });
}

function onTabUpdated(tabId, changeInfo, tab) {
    const changedProps = Object.keys(changeInfo).filter(a =>
        onTabUpdated.filters.includes(a)
    );
    if ( changedProps.length === 0 ) { return; }
    const tabData = tabDict.get(tabId) ?? onTabCreated(tab);
    if ( changeInfo.discarded ) {
        tabData.discarded = tab.changeInfo;
    }
    if ( changeInfo.title ) {
        tabData.title = tab.title;
    }
    if ( changeInfo.url ) {
        tabData.frameDict.get(0).url = tab.url;
    }
    if ( tab.active ) {
        activeTabId = tabId;
    }
    const details = Object.assign({ tabId, changeInfo }, tab);
    for ( const listener of listeners ) {
        listener('tab-updated', details);
    }
}
onTabUpdated.filters = [ 'discarded', 'status', 'title', 'url' ];

function onTabRemoved(tabId) {
    const tabData = tabDict.get(tabId);
    if ( tabData === undefined ) { return; }
    tabDict.delete(tabId);
    const details = { tabId };
    for ( const listener of listeners ) {
        listener('tab-removed', details);
    }
}

/******************************************************************************/

export function addListener(listener) {
    listeners.add(listener);
}

export function removeListener(listener) {
    listeners.delete(listener);
}

export function addFrame(details) {
    const { tabId } = details;
    const tabData = tabDict.get(tabId) ?? { tabId };
    if ( tabData.frameDict === undefined ) {
        tabData.frameDict = new Map();
        tabDict.set(tabId, tabData);
    } else {
        tabData.gettingFrames = undefined;
    }
    const { frameDict } = tabData;
    const { frameId, url } = details;
    if ( frameId === 0 ) {
        frameDict.clear();
    }
    frameDict.set(frameId, {
        frameId,
        parentId: details.parentFrameId ?? -1,
        url,
    });
    // Every 64 frames, we check for removed frames to prevent unbound growth
    // as there is no API listener for removed frames
    if ( (frameDict.size & 0b111111) !== 0 ) { return; }
    const key = self.crypto.randomUUID();
    tabData.gettingFrames = key;
    webext.webNavigation.getAllFrames({ tabId }).then(frames => {
        if ( Array.isArray(frames) === false ) { return; }
        if ( tabData.gettingFrames !== key ) { return; }
        if ( tabDict.has(tabId) === false ) { return; }
        const frameIds = new Set(frames.map(a => a.frameId));
        for ( const frameId of frameDict.keys() ) {
            if ( frameIds.has(frameId) ) { continue; }
            onFrameRemoved(tabId, frameId);
        }
    }, ( ) => { });
}

export function isHTTP(url) {
    return reIsHTTP.test(url);
}

export function getEffectiveURL(tabId, frameId) {
    const tabData = tabDict.get(tabId);
    if ( tabData === undefined ) { return; }
    const { frameDict } = tabData;
    let frameData = frameDict.get(frameId);
    for (;;) {
        if ( Boolean(frameData) === false ) { return; }
        if ( reIsHTTP.test(frameData.url) ) { break; }
        frameId = frameData.parentId;
        if ( frameId === -1 ) { break; }
        frameData = frameDict.get(frameId);
    }
    return frameData.url;
}

export function getAncestors(details) {
    const out = [];
    if ( details.frameId === 0 ) { return out; }
    const tabData = tabDict.get(details.tabId);
    if ( tabData === undefined ) { return out; }
    const { frameDict } = tabData;
    let { frameId } = details;
    do {
        const frameData = frameDict.get(frameId);
        if ( frameData === undefined ) { break; }
        out.push({ frameId: frameData.frameId, url: frameData.url });
        frameId = frameData.parentId;
    } while ( frameId !== -1 );
    return out.slice(1).filter(a => isHTTP(a));
}

export function getTopURL(tabId) {
    try {
        const url = new URL(tabDict.get(tabId)?.frameDict.get(0)?.url);
        return url.href;
    } catch {
    }
}

export function getTopOrigin(tabId) {
    try {
        const url = new URL(tabDict.get(tabId)?.frameDict.get(0)?.url);
        return url.origin;
    } catch {
    }
}

/******************************************************************************/

export async function start() {
    // https://github.com/chrisaljoudi/uBlock/issues/129
    //  Inject content scripts programmatically. This may be necessary for web
    // pages which were loaded before uBO launched.
    const manifest = browser.runtime.getManifest();
    const injectDeclarativeContentScripts = tabId => {
        for ( const contentScript of manifest.content_scripts ) {
            for ( const file of contentScript.js ) {
                browser.tabs.executeScript(tabId, {
                    file,
                    allFrames: contentScript.all_frames,
                    runAt: contentScript.run_at,
                });
            }
        }
    };

    const tabs = await webext.tabs.query({ discarded: false });
    for ( const tab of tabs ) {
        if ( tab.status === 'unloaded' ) { continue; }
        onTabCreated(tab);
        if ( isHTTP(tab.url) === false ) { continue; }
        injectDeclarativeContentScripts(tab.id);
    }

    browser.webNavigation.onCreatedNavigationTarget.addListener(onCreatedNavigationTarget);
    browser.webNavigation.onBeforeNavigate.addListener(onBeforeNavigate);
    browser.webNavigation.onCommitted.addListener(onCommitted);
    browser.tabs.onActivated.addListener(onTabActivated);
    if ( browser?.windows?.onFocusChanged ) {
        browser.windows.onFocusChanged.addListener(onWindowFocused);
    }
    browser.tabs.onCreated.addListener(onTabCreated);
    browser.tabs.onUpdated.addListener(onTabUpdated);
    browser.tabs.onRemoved.addListener(onTabRemoved);
}

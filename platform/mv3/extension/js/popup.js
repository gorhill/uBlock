/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
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

'use strict';

/******************************************************************************/

let currentTab = {};
let originalTrustedState = false;

/******************************************************************************/

async function toggleTrustedSiteDirective() {
    let url;
    try {
        url = new URL(currentTab.url);
    } catch(ex) {
        return;
    }
    if ( url instanceof URL === false ) { return; }
    const targetTrustedState = document.body.classList.contains('off');
    const newTrustedState = await chrome.runtime.sendMessage({
        what: 'toggleTrustedSiteDirective',
        origin: url.origin,
        state: targetTrustedState,
        tabId: currentTab.id,
    }).catch(( ) => targetTrustedState === false);
    document.body.classList.toggle('off', newTrustedState === true);
    document.body.classList.toggle(
        'needReload',
        newTrustedState !== originalTrustedState
    );
}

/******************************************************************************/

function reloadTab(ev) {
    chrome.tabs.reload(currentTab.id, {
        bypassCache: ev.ctrlKey || ev.metaKey || ev.shiftKey,
    });
    document.body.classList.remove('needReload');
    originalTrustedState = document.body.classList.contains('off');
}

/******************************************************************************/

async function init() {
    const [ tab ] = await chrome.tabs.query({ active: true });
    if ( tab instanceof Object === false ) { return true; }
    currentTab = tab;

    let url;
    try {
        url = new URL(currentTab.url);
    } catch(ex) {
    }

    if ( url !== undefined ) {
        originalTrustedState = await chrome.runtime.sendMessage({
            what: 'matchesTrustedSiteDirective',
            origin: url.origin,
        }) === true;
    }

    const body = document.body;
    body.classList.toggle('off', originalTrustedState);
    const elemHn = document.querySelector('#hostname');

    elemHn.textContent = url && url.hostname || '';

    document.querySelector('#switch').addEventListener(
        'click',
        toggleTrustedSiteDirective
    );

    document.querySelector('#refresh').addEventListener(
        'click',
        reloadTab
    );

    document.body.classList.remove('loading');

    return true;
}

async function tryInit() {
    try {
        await init();
    } catch(ex) {
        setTimeout(tryInit, 100);
    }
}

tryInit();

/******************************************************************************/

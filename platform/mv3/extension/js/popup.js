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

class safeLocalStorage {
    static getItem(k) {
        try {
            return self.localStorage.getItem(k);
        }
        catch(ex) {
        }
        return null;
    }
    static setItem(k, v) {
        try {
            self.localStorage.setItem(k, v);
        }
        catch(ex) {
        }
    }
}

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
    }).catch(( ) =>
        targetTrustedState === false
    );
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

    let popupPanelData;
    if ( url !== undefined ) {
        popupPanelData = await chrome.runtime.sendMessage({
            what: 'popupPanelData',
            origin: url.origin,
        });
        originalTrustedState = popupPanelData.isTrusted === true;
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

    if ( popupPanelData ) {
        const parent = document.querySelector('#rulesetStats');
        for ( const details of popupPanelData.rulesetDetails ) {
            const h1 = document.createElement('h1');
            h1.textContent = details.name;
            parent.append(h1);
            const p = document.createElement('p');
            p.textContent = `${details.ruleCount.toLocaleString()} rules, converted from ${details.filterCount.toLocaleString()} network filters`;
            parent.append(p);
        }
    }

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

// The popup panel is made of sections. Visibility of sections can be
// toggled on/off.

const maxNumberOfSections = 1;

const sectionBitsFromAttribute = function() {
    const attr = document.body.dataset.section;
    if ( attr === '' ) { return 0; }
    let bits = 0;
    for ( const c of attr.split(' ') ) {
        bits |= 1 << (c.charCodeAt(0) - 97);
    }
    return bits;
};

const sectionBitsToAttribute = function(bits) {
    if ( typeof bits !== 'number' ) { return; }
    if ( isNaN(bits) ) { return; }
    const attr = [];
    for ( let i = 0; i < maxNumberOfSections; i++ ) {
        const bit = 1 << i;
        if ( (bits & bit) === 0 ) { continue; }
        attr.push(String.fromCharCode(97 + i));
    }
    document.body.dataset.section = attr.join(' ');
};

async function toggleSections(more) {
    let currentBits = sectionBitsFromAttribute();
    let newBits = currentBits;
    for ( let i = 0; i < maxNumberOfSections; i++ ) {
        const bit = 1 << (more ? i : maxNumberOfSections - i - 1);
        if ( more ) {
            newBits |= bit;
        } else {
            newBits &= ~bit;
        }
        if ( newBits !== currentBits ) { break; }
    }
    if ( newBits === currentBits ) { return; }
    sectionBitsToAttribute(newBits);
    safeLocalStorage.setItem('popupPanelSections', newBits);
}

sectionBitsToAttribute(
    parseInt(safeLocalStorage.getItem('popupPanelSections'), 10)
);

document.querySelector('#moreButton').addEventListener('click', ( ) => {
    toggleSections(true);
});

document.querySelector('#lessButton').addEventListener('click', ( ) => {
    toggleSections(false);
});

/******************************************************************************/


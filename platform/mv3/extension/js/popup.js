/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2022-present Raymond Hill

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

/* jshint esversion:11 */

'use strict';

/******************************************************************************/

import { browser, sendMessage } from './ext.js';
import { dom, qs$ } from './dom.js';
import { i18n$ } from './i18n.js';
import { simpleStorage } from './storage.js';

/******************************************************************************/

let currentTab = {};
let tabHostname = '';


/******************************************************************************/

let originalStateHash = '';

function getCurrentStateHash() {
    const parts = [
        dom.cl.has(dom.body, 'off'),
        dom.cl.has(dom.body, 'hasGreatPowers'),
    ];
    return parts.join('\t');
}

function onStateHashChanged() {
    dom.cl.toggle(
        dom.body, 
        'needReload',
        getCurrentStateHash() !== originalStateHash
    );
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

    const targetTrustedState = dom.cl.has(dom.body, 'off');

    const newTrustedState = await sendMessage({
        what: 'toggleTrustedSiteDirective',
        origin: url.origin,
        state: targetTrustedState,
        tabId: currentTab.id,
    }).catch(( ) =>
        targetTrustedState === false
    );

    dom.cl.toggle(dom.body, 'off', newTrustedState === true);
    onStateHashChanged();
}

dom.on(qs$('#switch'), 'click', toggleTrustedSiteDirective);

/******************************************************************************/

function reloadTab(ev) {
    browser.tabs.reload(currentTab.id, {
        bypassCache: ev.ctrlKey || ev.metaKey || ev.shiftKey,
    });
    dom.cl.remove(dom.body, 'needReload');
    originalStateHash = getCurrentStateHash();
}

dom.on(qs$('#refresh'), 'click', reloadTab);

/******************************************************************************/

// The popup panel is made of sections. Visibility of sections can be
// toggled on/off.

const maxNumberOfSections = 2;

const sectionBitsFromAttribute = function() {
    const value = dom.body.dataset.section;
    if ( value === '' ) { return 0; }
    let bits = 0;
    for ( const c of value.split(' ') ) {
        bits |= 1 << (c.charCodeAt(0) - 97);
    }
    return bits;
};

const sectionBitsToAttribute = function(bits) {
    if ( typeof bits !== 'number' ) { return; }
    if ( isNaN(bits) ) { return; }
    const value = [];
    for ( let i = 0; i < maxNumberOfSections; i++ ) {
        const bit = 1 << i;
        if ( (bits & bit) === 0 ) { continue; }
        value.push(String.fromCharCode(97 + i));
    }
    dom.body.dataset.section = value.join(' ');
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
    simpleStorage.setItem('popupPanelSections', newBits);
}

simpleStorage.getItem('popupPanelSections').then(s => {
    sectionBitsToAttribute(parseInt(s, 10) || 0);
});

dom.on(qs$('#moreButton'), 'click', ( ) => {
    toggleSections(true);
});

dom.on(qs$('#lessButton'), 'click', ( ) => {
    toggleSections(false);
});

/******************************************************************************/

async function grantGreatPowers() {
    if ( tabHostname === '' ) { return; }
    const targetHostname = tabHostname.replace(/^www\./, '');
    const granted = await browser.permissions.request({
        origins: [ `*://*.${targetHostname}/*` ],
    });
    if ( granted !== true ) { return; }
    dom.cl.add(dom.body, 'hasGreatPowers');
    onStateHashChanged();
}

async function revokeGreatPowers() {
    if ( tabHostname === '' ) { return; }
    const targetHostname = tabHostname.replace(/^www\./, '');
    const removed = await browser.permissions.remove({
        origins: [ `*://*.${targetHostname}/*` ],
    });
    if ( removed !== true ) { return; }
    dom.cl.remove(dom.body, 'hasGreatPowers');
    onStateHashChanged();
}

dom.on(qs$('#toggleGreatPowers'), 'click', ( ) => {
    if ( dom.cl.has(dom.body, 'hasGreatPowers' ) ) {
        revokeGreatPowers();
    } else {
        grantGreatPowers();
    }
});

/******************************************************************************/

async function init() {
    const [ tab ] = await browser.tabs.query({ active: true });
    if ( tab instanceof Object === false ) { return true; }
    currentTab = tab;

    let url;
    try {
        url = new URL(currentTab.url);
        tabHostname = url.hostname || '';
    } catch(ex) {
    }

    let popupPanelData = {};
    if ( url !== undefined ) {
        popupPanelData = await sendMessage({
            what: 'popupPanelData',
            origin: url.origin,
        });
    }

    dom.cl.toggle(
        dom.body,
        'off',
        popupPanelData.isTrusted === true
    );

    dom.cl.toggle(
        dom.body,
        'hasOmnipotence',
        popupPanelData.hasOmnipotence === true
    );

    dom.cl.toggle(
        dom.body,
        'hasGreatPowers',
        popupPanelData.hasGreatPowers === true
    );

    dom.text(qs$('#hostname'), tabHostname);
    dom.text(
        qs$('#toggleGreatPowers .badge'),
        popupPanelData.injectableCount || ''
    );

    const parent = qs$('#rulesetStats');
    for ( const details of popupPanelData.rulesetDetails || [] ) {
        const div = qs$('#templates .rulesetDetails').cloneNode(true);
        dom.text(qs$('h1', div), details.name);
        const { rules, filters, css } = details;
        let ruleCount = rules.plain + rules.regexes;
        if ( popupPanelData.hasOmnipotence ) {
            ruleCount += rules.removeparams;
        }
        dom.text(
            qs$('p', div),
            i18n$('perRulesetStats')
                .replace('{{ruleCount}}', ruleCount.toLocaleString())
                .replace('{{filterCount}}', filters.accepted.toLocaleString())
                .replace('{{cssSpecificCount}}', css.specific.toLocaleString())
        );
        parent.append(div);
    }

    dom.cl.remove(dom.body, 'loading');

    originalStateHash = getCurrentStateHash();

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


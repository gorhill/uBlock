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

import {
    browser,
    runtime,
    sendMessage,
    localRead, localWrite,
} from './ext.js';

import { dom, qs$ } from './dom.js';
import { i18n,  i18n$ } from './i18n.js';
import punycode from './punycode.js';

/******************************************************************************/

const popupPanelData = {};
const  currentTab = {};
let tabHostname = '';

/******************************************************************************/

function normalizedHostname(hn) {
    return hn.replace(/^www\./, '');
}

/******************************************************************************/

const BLOCKING_MODE_MAX = 3;

function setFilteringMode(level, commit = false) {
    const modeSlider = qs$('.filteringModeSlider');
    modeSlider.dataset.level = level;
    if ( qs$('.filteringModeSlider.moving') === null ) {
        dom.text(
            '#filteringModeText > span:nth-of-type(1)',
            i18n$(`filteringMode${level}Name`)
        );
    }
    if ( commit !== true ) { return; }
    commitFilteringMode();
}

async function commitFilteringMode() {
    if ( tabHostname === '' ) { return; }
    const targetHostname = normalizedHostname(tabHostname);
    const modeSlider = qs$('.filteringModeSlider');
    const afterLevel = parseInt(modeSlider.dataset.level, 10);
    const beforeLevel = parseInt(modeSlider.dataset.levelBefore, 10);
    if ( afterLevel > 1 ) {
        let granted = false;
        try {
            granted = await browser.permissions.request({
                origins: [ `*://*.${targetHostname}/*` ],
            });
        } catch(ex) {
        }
        if ( granted !== true ) {
            setFilteringMode(beforeLevel);
            return;
        }
    }
    dom.text(
        '#filteringModeText > span:nth-of-type(1)',
        i18n$(`filteringMode${afterLevel}Name`)
    );
    const actualLevel = await sendMessage({
        what: 'setFilteringMode',
        hostname: targetHostname,
        level: afterLevel,
    });
    if ( actualLevel !== afterLevel ) {
        setFilteringMode(actualLevel);
    }
    if ( actualLevel !== beforeLevel && popupPanelData.autoReload ) {
        browser.tabs.reload(currentTab.id);
    }
}

{
    let mx0 = 0;
    let mx1 = 0;
    let l0 = 0;
    let lMax = 0;
    let timer;

    const move = ( ) => {
        timer = undefined;
        const l1 = Math.min(Math.max(l0 + mx1 - mx0, 0), lMax);
        let level = Math.floor(l1 * BLOCKING_MODE_MAX / lMax);
        if ( qs$('body[dir="rtl"]') !== null ) {
            level = 3 - level;
        }
        const modeSlider = qs$('.filteringModeSlider');
        if ( `${level}` === modeSlider.dataset.level ) { return; }
        dom.text(
            '#filteringModeText > span:nth-of-type(2)',
            i18n$(`filteringMode${level}Name`)
        );
        setFilteringMode(level);
    };

    const moveAsync = ev => {
        if ( timer !== undefined ) { return; }
        mx1 = ev.pageX;
        timer = self.requestAnimationFrame(move);
    };

    const stop = ev => {
        if ( ev.button !== 0 ) { return; }
        const modeSlider = qs$('.filteringModeSlider');
        if ( dom.cl.has(modeSlider, 'moving') === false ) { return; }
        dom.cl.remove(modeSlider, 'moving');
        self.removeEventListener('mousemove', moveAsync, { capture: true });
        self.removeEventListener('mouseup', stop, { capture: true });
        dom.text('#filteringModeText > span:nth-of-type(2)', '');
        commitFilteringMode();
        ev.stopPropagation();
        ev.preventDefault();
        if ( timer !== undefined ) {
            self.cancelAnimationFrame(timer);
            timer = undefined;
        }
    };

    const startSliding = ev => {
        if ( ev.button !== 0 ) { return; }
        const modeButton = qs$('.filteringModeButton');
        if ( ev.currentTarget !== modeButton ) { return; }
        const modeSlider = qs$('.filteringModeSlider');
        if ( dom.cl.has(modeSlider, 'moving') ) { return; }
        modeSlider.dataset.levelBefore = modeSlider.dataset.level;
        mx0 = ev.pageX;
        const buttonRect = modeButton.getBoundingClientRect();
        l0 = buttonRect.left + buttonRect.width / 2;
        const sliderRect = modeSlider.getBoundingClientRect();
        lMax = sliderRect.width - buttonRect.width ;
        dom.cl.add(modeSlider, 'moving');
        self.addEventListener('mousemove', moveAsync, { capture: true });
        self.addEventListener('mouseup', stop, { capture: true });
        ev.stopPropagation();
        ev.preventDefault();
    };

    dom.on('.filteringModeButton', 'mousedown', startSliding);
}

dom.on(
    '.filteringModeSlider',
    'click',
    '.filteringModeSlider span[data-level]',
    ev => {
        const modeSlider = qs$('.filteringModeSlider');
        modeSlider.dataset.levelBefore = modeSlider.dataset.level;
        const span = ev.target;
        const level = parseInt(span.dataset.level, 10);
        setFilteringMode(level, true);
    }
);

dom.on(
    '.filteringModeSlider',
    'mouseenter',
    '.filteringModeSlider span[data-level]',
    ev => {
        const span = ev.target;
        const level = parseInt(span.dataset.level, 10);
        dom.text(
            '#filteringModeText > span:nth-of-type(2)',
            i18n$(`filteringMode${level}Name`)
        );
    }
);

dom.on(
    '.filteringModeSlider',
    'mouseleave',
    '.filteringModeSlider span[data-level]',
    ( ) => {
        dom.text('#filteringModeText > span:nth-of-type(2)', '');
    }
);

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
    localWrite('popupPanelSections', newBits);
}

localRead('popupPanelSections').then(bits => {
    sectionBitsToAttribute(bits || 0);
});

dom.on('#moreButton', 'click', ( ) => {
    toggleSections(true);
});

dom.on('#lessButton', 'click', ( ) => {
    toggleSections(false);
});

/******************************************************************************/

dom.on('[data-i18n-title="popupTipDashboard"]', 'click', ev => {
    if ( ev.isTrusted !== true ) { return; }
    if ( ev.button !== 0 ) { return; }
    runtime.openOptionsPage();
});

/******************************************************************************/

async function init() {
    const [ tab ] = await browser.tabs.query({
        active: true,
        currentWindow: true,
    });
    if ( tab instanceof Object === false ) { return true; }
    Object.assign(currentTab, tab);

    let url;
    try {
        url = new URL(currentTab.url);
        tabHostname = url.hostname || '';
    } catch(ex) {
    }

    if ( url !== undefined ) {
        const response = await sendMessage({
            what: 'popupPanelData',
            origin: url.origin,
            hostname: normalizedHostname(tabHostname),
        });
        if ( response instanceof Object ) {
            Object.assign(popupPanelData, response);
        }
    }

    setFilteringMode(popupPanelData.level);

    dom.text('#hostname', punycode.toUnicode(tabHostname));

    const parent = qs$('#rulesetStats');
    for ( const details of popupPanelData.rulesetDetails || [] ) {
        const div = dom.clone('#templates .rulesetDetails');
        qs$(div, 'h1').append(i18n.patchUnicodeFlags(details.name));
        const { rules, filters, css } = details;
        let ruleCount = rules.plain + rules.regex;
        if ( popupPanelData.hasOmnipotence ) {
            ruleCount += rules.removeparam + rules.redirect + rules.csp;
        }
        let specificCount = 0;
        if ( typeof css.specific === 'number' ) {
            specificCount += css.specific;
        }
        if ( typeof css.declarative === 'number' ) {
            specificCount += css.declarative;
        }
        if ( typeof css.procedural === 'number' ) {
            specificCount += css.procedural;
        }
        dom.text(
            qs$(div, 'p'),
            i18n$('perRulesetStats')
                .replace('{{ruleCount}}', ruleCount.toLocaleString())
                .replace('{{filterCount}}', filters.accepted.toLocaleString())
                .replace('{{cssSpecificCount}}', specificCount.toLocaleString())
        );
        parent.append(div);
    }

    dom.cl.remove(dom.body, 'loading');

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


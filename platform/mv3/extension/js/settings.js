/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
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

import { browser, sendMessage } from './ext.js';
import { dom, qs$ } from './dom.js';
import punycode from './punycode.js';
import { renderFilterLists } from './filter-lists.js';

/******************************************************************************/

let cachedRulesetData = {};

/******************************************************************************/

function hashFromIterable(iter) {
    return Array.from(iter).sort().join('\n');
}

/******************************************************************************/

function renderAdminRules() {
    const { disabledFeatures: forbid = [] } = cachedRulesetData;
    if ( forbid.length === 0 ) { return; }
    dom.body.dataset.forbid = forbid.join(' ');
    if ( forbid.includes('dashboard') ) {
        dom.body.dataset.pane = 'about';
    }
}

/******************************************************************************/

function renderWidgets() {
    if ( cachedRulesetData.firstRun ) {
        dom.cl.add(dom.body, 'firstRun');
    }

    renderDefaultMode();
    renderTrustedSites();

    qs$('#autoReload input[type="checkbox"]').checked = cachedRulesetData.autoReload;

    {
        const input = qs$('#showBlockedCount input[type="checkbox"]');
        if ( cachedRulesetData.canShowBlockedCount ) {
            input.checked = cachedRulesetData.showBlockedCount;
        } else {
            input.checked = false;
            dom.attr(input, 'disabled', '');
        }
    }

    {
        dom.prop('#developerMode input[type="checkbox"]', 'checked',
            Boolean(cachedRulesetData.developerMode)
        );
        if ( cachedRulesetData.isSideloaded ) {
            dom.attr('#developerMode', 'hidden', null);
        }
    }
}

/******************************************************************************/

function renderDefaultMode() {
    const defaultLevel = cachedRulesetData.defaultFilteringMode;
    if ( defaultLevel !== 0 ) {
        qs$(`.filteringModeCard input[type="radio"][value="${defaultLevel}"]`).checked = true;
    } else {
        dom.prop('.filteringModeCard input[type="radio"]', 'checked', false);
    }
}

/******************************************************************************/

async function onFilteringModeChange(ev) {
    const input = ev.target;
    const newLevel = parseInt(input.value, 10);

    switch ( newLevel ) {
    case 1: { // Revoke broad permissions
        await browser.permissions.remove({
            origins: [ '<all_urls>' ]
        });
        cachedRulesetData.defaultFilteringMode = 1;
        break;
    }
    case 2:
    case 3: { // Request broad permissions
        const granted = await browser.permissions.request({
            origins: [ '<all_urls>' ]
        });
        if ( granted ) {
            const actualLevel = await sendMessage({
                what: 'setDefaultFilteringMode',
                level: newLevel,
            });
            cachedRulesetData.defaultFilteringMode = actualLevel;
        }
        break;
    }
    default:
        break;
    }
    renderFilterLists(cachedRulesetData);
    renderWidgets();
}

dom.on(
    '#defaultFilteringMode',
    'change',
    '.filteringModeCard input[type="radio"]',
    ev => { onFilteringModeChange(ev); }
);

/******************************************************************************/

dom.on('#autoReload input[type="checkbox"]', 'change', ev => {
    sendMessage({
        what: 'setAutoReload',
        state: ev.target.checked,
    });
});

dom.on('#showBlockedCount input[type="checkbox"]', 'change', ev => {
    sendMessage({
        what: 'setShowBlockedCount',
        state: ev.target.checked,
    });
});

dom.on('#developerMode input[type="checkbox"]', 'change', ev => {
    sendMessage({
        what: 'setDeveloperMode',
        state: ev.target.checked,
    });
});

/******************************************************************************/

function renderTrustedSites() {
    const textarea = qs$('#trustedSites');
    const hostnames = cachedRulesetData.trustedSites || [];
    textarea.value = hostnames.map(hn => punycode.toUnicode(hn)).join('\n');
    if ( textarea.value !== '' ) {
        textarea.value += '\n';
    }
}

function changeTrustedSites() {
    const hostnames = getStagedTrustedSites();
    const hash = hashFromIterable(cachedRulesetData.trustedSites || []);
    if ( hashFromIterable(hostnames) === hash ) { return; }
    sendMessage({
        what: 'setTrustedSites',
        hostnames,
    });
}

function getStagedTrustedSites() {
    const textarea = qs$('#trustedSites');
    return textarea.value.split(/\s/).map(hn => {
        try {
            return punycode.toASCII(
                (new URL(`https://${hn}/`)).hostname
            );
        } catch(_) {
        }
        return '';
    }).filter(hn => hn !== '');
}

dom.on('#trustedSites', 'blur', changeTrustedSites);

self.addEventListener('beforeunload', changeTrustedSites);

/******************************************************************************/

function listen() {
    const bc = new self.BroadcastChannel('uBOL');
    bc.onmessage = listen.onmessage;
}

listen.onmessage = ev => {
    const message = ev.data;
    if ( message instanceof Object === false ) { return; }
    const local = cachedRulesetData;
    let render = false;

    // Keep added sites which have not yet been committed
    if ( message.trustedSites !== undefined ) {
        if ( hashFromIterable(message.trustedSites) !== hashFromIterable(local.trustedSites) ) {
            const current = new Set(local.trustedSites);
            const staged = new Set(getStagedTrustedSites());
            for ( const hn of staged ) {
                if ( current.has(hn) === false ) { continue; }
                staged.delete(hn);
            }
            const combined = Array.from(new Set([ ...message.trustedSites, ...staged ]));
            local.trustedSites = combined;
            render = true;
        }
    }

    if ( message.defaultFilteringMode !== undefined ) {
        if ( message.defaultFilteringMode !== local.defaultFilteringMode ) {
            local.defaultFilteringMode = message.defaultFilteringMode;
            render = true;
        }
    }

    if ( message.autoReload !== undefined ) {
        if ( message.autoReload !== local.autoReload ) {
            local.autoReload = message.autoReload;
            render = true;
        }
    }

    if ( message.showBlockedCount !== undefined ) {
        if ( message.showBlockedCount !== local.showBlockedCount ) {
            local.showBlockedCount = message.showBlockedCount;
            render = true;
        }
    }

    if ( message.adminRulesets !== undefined ) {
        if ( hashFromIterable(message.adminRulesets) !== hashFromIterable(local.adminRulesets) ) {
            local.adminRulesets = message.adminRulesets;
            render = true;
        }
    }

    if ( message.enabledRulesets !== undefined ) {
        if ( hashFromIterable(message.enabledRulesets) !== hashFromIterable(local.enabledRulesets) ) {
            local.enabledRulesets = message.enabledRulesets;
            render = true;
        }
    }

    if ( render === false ) { return; }
    renderFilterLists(cachedRulesetData);
    renderWidgets();
};

/******************************************************************************/

sendMessage({
    what: 'getOptionsPageData',
}).then(data => {
    if ( !data ) { return; }
    cachedRulesetData = data;
    try {
        renderAdminRules();
        renderFilterLists(cachedRulesetData);
        renderWidgets();
        dom.cl.remove(dom.body, 'loading');
    } catch(ex) {
    }
    listen();
}).catch(reason => {
    console.trace(reason);
});

/******************************************************************************/

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
import { hashFromIterable } from './dashboard.js';
import { renderFilterLists } from './filter-lists.js';

/******************************************************************************/

let cachedRulesetData = {};

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
        const input = qs$('#strictBlockMode input[type="checkbox"]');
        const canStrictBlock = cachedRulesetData.hasOmnipotence;
        input.checked = canStrictBlock && cachedRulesetData.strictBlockMode;
        dom.attr(input, 'disabled', canStrictBlock ? null : '');
    }

    {
        const state = Boolean(cachedRulesetData.developerMode) &&
            cachedRulesetData.disabledFeatures?.includes('develop') !== true;
        dom.body.dataset.develop = `${state}`;
        dom.prop('#developerMode input[type="checkbox"]', 'checked', state);
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
    case 1: {
        const actualLevel = await sendMessage({
            what: 'setDefaultFilteringMode',
            level: newLevel,
        });
        cachedRulesetData.defaultFilteringMode = actualLevel;
        break;
    }
    case 2:
    case 3: {
        const granted = await browser.permissions.request({
            origins: [ '<all_urls>' ],
        });
        if ( granted ) {
            const actualLevel = await sendMessage({
                what: 'setDefaultFilteringMode',
                level: newLevel,
            });
            cachedRulesetData.defaultFilteringMode = actualLevel;
            cachedRulesetData.hasOmnipotence = true;
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

async function backupSettings() {
    const api = await import('./backup-restore.js');
    const data = await api.backupToObject(cachedRulesetData);
    if ( data instanceof Object === false ) { return; }
    const json = JSON.stringify(data, null, 2)  + '\n';
    const a = document.createElement('a');
    a.href = `data:text/plain;charset=utf-8,${encodeURIComponent(json)}`;
    dom.attr(a, 'download', 'my-ubol-settings.json');
    dom.attr(a, 'type', 'application/json');
    a.click();
}

async function restoreSettings() {
    const input = qs$('section[data-pane="settings"] input[type="file"]');
    input.onchange = ev => {
        input.onchange = null;
        const file = ev.target.files[0];
        if ( file === undefined || file.name === '' ) { return; }
        const fr = new FileReader();
        fr.onload = ( ) => {
            fr.onload = null;
            if ( typeof fr.result !== 'string' ) { return; }
            let data;
            try {
                data = JSON.parse(fr.result);
            } catch {
            }
            if ( data instanceof Object === false ) { return; }
            import('./backup-restore.js').then(api => {
                api.restoreFromObject(data);
            });
        };
        fr.readAsText(file);
    };
    // Reset to empty string, this will ensure a change event is properly
    // triggered if the user pick a file, even if it's the same as the last
    // one picked.
    input.value = '';
    input.click();
}

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

dom.on('#strictBlockMode input[type="checkbox"]', 'change', ev => {
    sendMessage({
        what: 'setStrictBlockMode',
        state: ev.target.checked,
    });
});

dom.on('#developerMode input[type="checkbox"]', 'change', ev => {
    const state = ev.target.checked;
    sendMessage({ what: 'setDeveloperMode', state });
    dom.body.dataset.develop = `${state}`;
});

dom.on('section[data-pane="settings"] [data-i18n="backupButton"]', 'click', ( ) => {
    backupSettings();
});

dom.on('section[data-pane="settings"] [data-i18n="restoreButton"]', 'click', ( ) => {
    restoreSettings();
});

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

    if ( message.hasOmnipotence !== undefined ) {
        if ( message.hasOmnipotence !== local.hasOmnipotence ) {
            local.hasOmnipotence = message.hasOmnipotence;
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

    if ( message.strictBlockMode !== undefined ) {
        if ( message.strictBlockMode !== local.strictBlockMode ) {
            local.strictBlockMode = message.strictBlockMode;
            render = true;
        }
    }

    if ( message.developerMode !== undefined ) {
        if ( message.developerMode !== local.developerMode ) {
            local.developerMode = message.developerMode;
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
        local.enabledRulesets = message.enabledRulesets;
        render = true;
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
    } catch(reason) {
        console.error(reason);
    } finally {
        dom.cl.remove(dom.body, 'loading');
    }
    listen();
}).catch(reason => {
    console.error(reason);
});

/******************************************************************************/

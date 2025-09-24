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

import { dom, qs$ } from './dom.js';
import {
    localRead,
    localRemove,
    localWrite,
    runtime,
    sendMessage,
    webextFlavor,
} from './ext.js';
import { faIconsInit } from './fa-icons.js';
import { i18n } from './i18n.js';

/******************************************************************************/

dom.body.dataset.platform = webextFlavor;

{
    const manifest = runtime.getManifest();
    dom.text('#aboutNameVer', `${manifest.name} ${manifest.version}`);
}

dom.attr('a', 'target', '_blank');

dom.on('#dashboard-nav', 'click', '.tabButton', ev => {
    const { pane } = ev.target.dataset;
    dom.body.dataset.pane = pane;
    if ( pane === 'settings' ) {
        localRemove('dashboard.activePane');
    } else {
        localWrite('dashboard.activePane', pane);
    }
});

localRead('dashboard.activePane').then(pane => {
    if ( typeof pane !== 'string' ) { return; }
    dom.body.dataset.pane = pane;
});

// Update troubleshooting on-demand
const tsinfoObserver = new IntersectionObserver(entries => {
    if ( entries.every(a => a.isIntersecting === false) ) { return; }
    sendMessage({ what: 'getTroubleshootingInfo' }).then(config => {
        qs$('[data-i18n="supportS5H"] + pre').textContent = config;
    });
});
tsinfoObserver.observe(qs$('[data-i18n="supportS5H"] + pre'));

/******************************************************************************/

export function nodeFromTemplate(templateId, nodeSelector) {
    const template = qs$(`template#${templateId}`);
    const fragment = template.content.cloneNode(true);
    const node = nodeSelector !== undefined
        ? qs$(fragment, nodeSelector)
        : fragment.firstElementChild;
    faIconsInit(node);
    i18n.render(node);
    return node;
}

/******************************************************************************/

export function hashFromIterable(iter) {
    if ( Boolean(iter) === false ) { return ''; }
    return Array.from(iter).sort().join('\n');
}

/******************************************************************************/

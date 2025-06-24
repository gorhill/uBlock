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
} from './ext.js';

import { getTroubleshootingInfo } from './troubleshooting.js';
import { runtime } from './ext.js';

/******************************************************************************/

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

getTroubleshootingInfo().then(config => {
    qs$('[data-i18n="supportS5H"] + pre').textContent = config;
});

/******************************************************************************/

export function hashFromIterable(iter) {
    return Array.from(iter).sort().join('\n');
}

/******************************************************************************/

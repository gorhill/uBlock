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
import { sendMessage } from './ext.js';

/******************************************************************************/

const url = new URL(document.location.href);
const tabId = parseInt(url.searchParams.get('tab'), 10) || 0;

const entries = await sendMessage({
    what: 'getMatchedRules',
    tabId,
});

const fragment = new DocumentFragment();
const template = qs$('#matchInfo');
for ( const entry of (entries || []) ) {
    if ( entry instanceof Object === false ) { continue; }
    const row = template.content.cloneNode(true);
    qs$(row, '.requestInfo').textContent = JSON.stringify(entry.request, null, 2);
    qs$(row, '.ruleInfo').textContent = JSON.stringify(entry.rule, null, 2);
    fragment.append(row);
}

dom.empty('#matchedEntries');
qs$('#matchedEntries').append(fragment);

/******************************************************************************/

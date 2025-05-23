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
import { localRead } from './ext.js';
import { rulesFromText } from './dnr-parser.js';

/******************************************************************************/

function updateWidgets() {
    const changed = cmRules.state.doc.toString().trim() !== 
        lastSavedText.trim();
    dom.attr('#dnrRulesApply', 'disabled', changed ? null : '');
    dom.attr('#dnrRulesRevert', 'disabled', changed ? null : '');
}

function updateWidgetsAsync() {
    if ( updateWidgetsAsync.timer !== undefined ) { return; }
    updateWidgetsAsync.timer = self.setTimeout(( ) => {
        updateWidgetsAsync.timer = undefined;
        updateWidgets();
    }, 71);
}

/******************************************************************************/

let lastSavedText = '';

const cm6 = self.cm6;
const cmRules = (( ) => {
    const options = {
        yaml: true,
        oneDark: dom.cl.has(':root', 'dark'),
        updateListener: function(info) {
            if ( info.docChanged === false ) { return; }
            updateWidgetsAsync();
        },
    };
    return cm6.createEditorView(
        cm6.createEditorState(`# bla bla bla
action:
  type: redirect
  redirect:
    url: https://cdn.jsdelivr.net/gh/uBlockOrigin/uBOL-home/chromium/web_accessible_resources/noop-1s.mp4
condition:
  initiatorDomains:
    - open.spotify.com
  resourceTypes:
    - media
  urlFilter: ||spotifycdn.com/audio/
priority: 1000
---
# bla bla bla
action:
  type: block
condition:
  toto: lol
  initiatorDomains:
    - open.spotify.com
  resourceTypes:
    - media
  urlFilter: ||spotifycdn.com/audio/
...
`, options),
        qs$('#cm-dnrRules')
    );
})();

/******************************************************************************/

localRead('userDNRRules').then(text => {
    if ( text === undefined ) { return; }
    if ( text !== '' ) { text += '\n'; }
    lastSavedText = text;
    cmRules.dispatch({
        changes: {
            from: 0, to: cmRules.state.doc.length,
            insert: text
        },
    });
});

/******************************************************************************/

dom.on('#dnrRulesApply', 'click', ( ) => {
    const text = cmRules.state.doc.toString();
    lastSavedText = text;
    const rules = rulesFromText(text);
    console.log(rules);
    updateWidgets();
});

dom.on('#dnrRulesRevert', 'click', ( ) => {
    cmRules.dispatch({
        changes: {
            from: 0, to: cmRules.state.doc.length,
            insert: lastSavedText,
        },
    });
});

/******************************************************************************/

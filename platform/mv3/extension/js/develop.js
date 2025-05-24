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
    sendMessage,
} from './ext.js';
import { rulesFromText } from './dnr-parser.js';

/******************************************************************************/

function setEditorText(text) {
    if ( text === undefined ) { return; }
    if ( text !== '' ) { text += '\n'; }
    cmRules.dispatch({
        changes: {
            from: 0, to: cmRules.state.doc.length,
            insert: text
        },
    });
}

function getEditorText() {
    return cmRules.state.doc.toString();
}

/******************************************************************************/

function saveEditorText() {
    const text = getEditorText().trim();
    const promise = text.length !== 0
        ? localWrite('userDnrRules', text)
        : localRemove('userDnrRules');
    promise.then(( ) => {
        lastSavedText = text;
        updateWidgets();
    }).then(( ) => {
        sendMessage({ what: 'updateUserDnrRules' });
    });
}

/******************************************************************************/

function updateWidgets() {
    const changed = cmRules.state.doc.toString().trim() !== 
        lastSavedText.trim();
    dom.attr('#dnrRulesApply', 'disabled', changed ? null : '');
    dom.attr('#dnrRulesRevert', 'disabled', changed ? null : '');
    const { bad } = rulesFromText(getEditorText());
    self.cm6.lineErrorClear(cmRules);
    if ( bad?.length ) {
        self.cm6.lineErrorAt(cmRules, bad);
    }
}

function updateWidgetsAsync() {
    if ( updateWidgetsAsync.timer !== undefined ) { return; }
    updateWidgetsAsync.timer = self.setTimeout(( ) => {
        updateWidgetsAsync.timer = undefined;
        updateWidgets();
    }, 71);
}

/******************************************************************************/

const cmRules = (( ) => {
    return self.cm6.createEditorView({
        yaml: true,
        oneDark: dom.cl.has(':root', 'dark'),
        updateListener: function(info) {
            if ( info.docChanged === false ) { return; }
            const doc = info.state.doc;
            info.changes.desc.iterChangedRanges((fromA, toA, fromB, toB) => {
                linesToLint.push([
                    doc.lineAt(fromA).number - 1,
                    doc.lineAt(toA).number - 1,
                ], [
                    doc.lineAt(fromB).number - 1,
                    doc.lineAt(toB).number - 1,
                ]);
            });
            updateWidgetsAsync();
        },
        saveListener: function() {
            saveEditorText();
        },
        lineError: 'bad',
    }, qs$('#cm-dnrRules'));
})();

/******************************************************************************/

const linesToLint = [];
let lastSavedText = '';

localRead('userDnrRules').then(text => {
    text ||= '';
    setEditorText(text);
    lastSavedText = text;
});

/******************************************************************************/

dom.on('#dnrRulesApply', 'click', ( ) => {
    saveEditorText();
});

dom.on('#dnrRulesRevert', 'click', ( ) => {
    setEditorText(lastSavedText);
    sendMessage({ what: 'updateUserDnrRules' });
});

/******************************************************************************/

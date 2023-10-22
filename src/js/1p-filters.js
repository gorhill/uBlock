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

/* global CodeMirror, uBlockDashboard */

'use strict';

import { i18n$ } from './i18n.js';
import { dom, qs$ } from './dom.js';
import './codemirror/ubo-static-filtering.js';

/******************************************************************************/

const cmEditor = new CodeMirror(qs$('#userFilters'), {
    autoCloseBrackets: true,
    autofocus: true,
    extraKeys: {
        'Ctrl-Space': 'autocomplete',
        'Tab': 'toggleComment',
    },
    foldGutter: true,
    gutters: [
        'CodeMirror-linenumbers',
        { className: 'CodeMirror-lintgutter', style: 'width: 11px' },
    ],
    lineNumbers: true,
    lineWrapping: true,
    matchBrackets: true,
    maxScanLines: 1,
    styleActiveLine: {
        nonEmpty: true,
    },
});

uBlockDashboard.patchCodeMirrorEditor(cmEditor);

let cachedUserFilters = '';

/******************************************************************************/

// Add auto-complete ability to the editor. Polling is used as the suggested
// hints also depend on the tabs currently opened.

{
    let hintUpdateToken = 0;

    const getHints = async function() {
        const hints = await vAPI.messaging.send('dashboard', {
            what: 'getAutoCompleteDetails',
            hintUpdateToken
        });
        if ( hints instanceof Object === false ) { return; }
        if ( hints.hintUpdateToken !== undefined ) {
            cmEditor.setOption('uboHints', hints);
            hintUpdateToken = hints.hintUpdateToken;
        }
        timer.on(2503);
    };

    const timer = vAPI.defer.create(( ) => {
        getHints();
    });

    getHints();
}

vAPI.messaging.send('dashboard', {
    what: 'getTrustedScriptletTokens',
}).then(tokens => {
    cmEditor.setOption('trustedScriptletTokens', tokens);
});

/******************************************************************************/

function getEditorText() {
    const text = cmEditor.getValue().replace(/\s+$/, '');
    return text === '' ? text : text + '\n';
}

function setEditorText(text) {
    cmEditor.setValue(text.replace(/\s+$/, '') + '\n\n');
}

/******************************************************************************/

function userFiltersChanged(changed) {
    if ( typeof changed !== 'boolean' ) {
        changed = self.hasUnsavedData();
    }
    qs$('#userFiltersApply').disabled = !changed;
    qs$('#userFiltersRevert').disabled = !changed;
}

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/3704
//   Merge changes to user filters occurring in the background with changes
//   made in the editor. The code assumes that no deletion occurred in the
//   background.

function threeWayMerge(newContent) {
    const prvContent = cachedUserFilters.trim().split(/\n/);
    const differ = new self.diff_match_patch();
    const newChanges = differ.diff(
        prvContent,
        newContent.trim().split(/\n/)
    );
    const usrChanges = differ.diff(
        prvContent,
        getEditorText().trim().split(/\n/)
    );
    const out = [];
    let i = 0, j = 0, k = 0;
    while ( i < prvContent.length ) {
        for ( ; j < newChanges.length; j++ ) {
            const change = newChanges[j];
            if ( change[0] !== 1 ) { break; }
            out.push(change[1]);
        }
        for ( ; k < usrChanges.length; k++ ) {
            const change = usrChanges[k];
            if ( change[0] !== 1 ) { break; }
            out.push(change[1]);
        }
        if ( k === usrChanges.length || usrChanges[k][0] !== -1 ) {
            out.push(prvContent[i]);
        }
        i += 1; j += 1; k += 1;
    }
    for ( ; j < newChanges.length; j++ ) {
        const change = newChanges[j];
        if ( change[0] !== 1 ) { continue; }
        out.push(change[1]);
    }
    for ( ; k < usrChanges.length; k++ ) {
        const change = usrChanges[k];
        if ( change[0] !== 1 ) { continue; }
        out.push(change[1]);
    }
    return out.join('\n');
}

/******************************************************************************/

async function renderUserFilters(merge = false) {
    const details = await vAPI.messaging.send('dashboard', {
        what: 'readUserFilters',
    });
    if ( details instanceof Object === false || details.error ) { return; }

    cmEditor.setOption('trustedSource', details.trustedSource === true);

    const newContent = details.content.trim();

    if ( merge && self.hasUnsavedData() ) {
        setEditorText(threeWayMerge(newContent));
        userFiltersChanged(true);
    } else {
        setEditorText(newContent);
        userFiltersChanged(false);
    }

    cachedUserFilters = newContent;
}

/******************************************************************************/

function handleImportFilePicker(ev) {
    const file = ev.target.files[0];
    if ( file === undefined || file.name === '' ) { return; }
    if ( file.type.indexOf('text') !== 0 ) { return; }
    const fr = new FileReader();
    fr.onload = function() {
        if ( typeof fr.result !== 'string' ) { return; }
        const content = uBlockDashboard.mergeNewLines(getEditorText(), fr.result);
        cmEditor.operation(( ) => {
            const cmPos = cmEditor.getCursor();
            setEditorText(content);
            cmEditor.setCursor(cmPos);
            cmEditor.focus();
        });
    };
    fr.readAsText(file);
}

dom.on('#importFilePicker', 'change', handleImportFilePicker);

function startImportFilePicker() {
    const input = qs$('#importFilePicker');
    // Reset to empty string, this will ensure an change event is properly
    // triggered if the user pick a file, even if it is the same as the last
    // one picked.
    input.value = '';
    input.click();
}

dom.on('#importUserFiltersFromFile', 'click', startImportFilePicker);

/******************************************************************************/

function exportUserFiltersToFile() {
    const val = getEditorText();
    if ( val === '' ) { return; }
    const filename = i18n$('1pExportFilename')
        .replace('{{datetime}}', uBlockDashboard.dateNowToSensibleString())
        .replace(/ +/g, '_');
    vAPI.download({
        'url': 'data:text/plain;charset=utf-8,' + encodeURIComponent(val + '\n'),
        'filename': filename
    });
}

/******************************************************************************/

async function applyChanges() {
    const details = await vAPI.messaging.send('dashboard', {
        what: 'writeUserFilters',
        content: getEditorText(),
    });
    if ( details instanceof Object === false || details.error ) { return; }

    cachedUserFilters = details.content.trim();
    userFiltersChanged(false);
    vAPI.messaging.send('dashboard', {
        what: 'reloadAllFilters',
    });
}

function revertChanges() {
    setEditorText(cachedUserFilters);
}

/******************************************************************************/

function getCloudData() {
    return getEditorText();
}

function setCloudData(data, append) {
    if ( typeof data !== 'string' ) { return; }
    if ( append ) {
        data = uBlockDashboard.mergeNewLines(getEditorText(), data);
    }
    cmEditor.setValue(data);
}

self.cloud.onPush = getCloudData;
self.cloud.onPull = setCloudData;

/******************************************************************************/

self.hasUnsavedData = function() {
    return getEditorText().trim() !== cachedUserFilters;
};

/******************************************************************************/

// Handle user interaction
dom.on('#exportUserFiltersToFile', 'click', exportUserFiltersToFile);
dom.on('#userFiltersApply', 'click', ( ) => { applyChanges(); });
dom.on('#userFiltersRevert', 'click', revertChanges);

(async ( ) => {
    await renderUserFilters();

    cmEditor.clearHistory();

    // https://github.com/gorhill/uBlock/issues/3706
    //   Save/restore cursor position
    {
        const line = await vAPI.localStorage.getItemAsync('myFiltersCursorPosition');
        if ( typeof line === 'number' ) {
            cmEditor.setCursor(line, 0);
        }
        cmEditor.focus();
    }

    // https://github.com/gorhill/uBlock/issues/3706
    //   Save/restore cursor position
    {
        let curline = 0;
        cmEditor.on('cursorActivity', ( ) => {
            if ( timer.ongoing() ) { return; }
            if ( cmEditor.getCursor().line === curline ) { return; }
            timer.on(701);
        });
        const timer = vAPI.defer.create(( ) => {
            curline = cmEditor.getCursor().line;
            vAPI.localStorage.setItem('myFiltersCursorPosition', curline);
        });
    }

    // https://github.com/gorhill/uBlock/issues/3704
    //   Merge changes to user filters occurring in the background
    vAPI.broadcastListener.add(msg => {
        switch ( msg.what ) {
        case 'userFiltersUpdated': {
            cmEditor.startOperation();
            const scroll = cmEditor.getScrollInfo();
            const selections = cmEditor.listSelections();
            renderUserFilters(true).then(( ) => {
                cmEditor.clearHistory();
                cmEditor.setSelection(selections[0].anchor, selections[0].head);
                cmEditor.scrollTo(scroll.left, scroll.top);
                cmEditor.endOperation();
            });
            break;
        }
        default:
            break;
        }
    });
})();

cmEditor.on('changes', userFiltersChanged);
CodeMirror.commands.save = applyChanges;

/******************************************************************************/

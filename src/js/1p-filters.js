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

/* global CodeMirror, uDom, uBlockDashboard */

'use strict';

/******************************************************************************/

import './codemirror/ubo-static-filtering.js';

/******************************************************************************/

const cmEditor = new CodeMirror(document.getElementById('userFilters'), {
    autoCloseBrackets: true,
    autofocus: true,
    extraKeys: {
        'Ctrl-Space': 'autocomplete',
        'Tab': 'toggleComment',
    },
    foldGutter: true,
    gutters: [ 'CodeMirror-linenumbers', 'CodeMirror-foldgutter' ],
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

// Add auto-complete ability to the editor.

{
    let hintUpdateToken = 0;

    const responseHandler = function(response) {
        if ( response instanceof Object === false ) { return; }
        if ( response.hintUpdateToken !== undefined ) {
            const mode = cmEditor.getMode();
            if ( mode.setHints instanceof Function ) {
                mode.setHints(response);
            }
            if ( hintUpdateToken === 0 ) {
                mode.parser.expertMode = response.expertMode !== false;
            }
            hintUpdateToken = response.hintUpdateToken;
        }
        vAPI.setTimeout(getHints, 2503);
    };

    const getHints = function() {
        vAPI.messaging.send('dashboard', {
            what: 'getAutoCompleteDetails',
            hintUpdateToken
        }).then(responseHandler);
    };

    getHints();
}

/******************************************************************************/

const getEditorText = function() {
    const text = cmEditor.getValue().replace(/\s+$/, '');
    return text === '' ? text : text + '\n';
};

const setEditorText = function(text) {
    cmEditor.setValue(text.replace(/\s+$/, '') + '\n\n');
};

/******************************************************************************/

// This is to give a visual hint that the content of user blacklist has changed.

const userFiltersChanged = function(changed) {
    if ( typeof changed !== 'boolean' ) {
        changed = self.hasUnsavedData();
    }
    uDom.nodeFromId('userFiltersApply').disabled = !changed;
    uDom.nodeFromId('userFiltersRevert').disabled = !changed;
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/3704
//   Merge changes to user filters occurring in the background with changes
//   made in the editor. The code assumes that no deletion occurred in the
//   background.

const threeWayMerge = function(newContent) {
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
};

/******************************************************************************/

const renderUserFilters = async function(merge = false) {
    const details = await vAPI.messaging.send('dashboard', {
        what: 'readUserFilters',
    });
    if ( details instanceof Object === false || details.error ) { return; }

    const newContent = details.content.trim();

    if ( merge && self.hasUnsavedData() ) {
        setEditorText(threeWayMerge(newContent));
        userFiltersChanged(true);
    } else {
        setEditorText(newContent);
        userFiltersChanged(false);
    }

    cachedUserFilters = newContent;
};

/******************************************************************************/

const handleImportFilePicker = function() {
    // https://github.com/chrisaljoudi/uBlock/issues/1004
    // Support extraction of filters from ABP backup file
    const abpImporter = function(s) {
        const reAbpSubscriptionExtractor = /\n\[Subscription\]\n+url=~[^\n]+([\x08-\x7E]*?)(?:\[Subscription\]|$)/ig;
        const reAbpFilterExtractor = /\[Subscription filters\]([\x08-\x7E]*?)(?:\[Subscription\]|$)/i;
        let matches = reAbpSubscriptionExtractor.exec(s);
        // Not an ABP backup file
        if ( matches === null ) { return s; }
        const out = [];
        do {
            if ( matches.length === 2 ) {
                let filterMatch = reAbpFilterExtractor.exec(matches[1].trim());
                if ( filterMatch !== null && filterMatch.length === 2 ) {
                    out.push(filterMatch[1].trim().replace(/\\\[/g, '['));
                }
            }
            matches = reAbpSubscriptionExtractor.exec(s);
        } while ( matches !== null );
        return out.join('\n');
    };

    const fileReaderOnLoadHandler = function() {
        let content = abpImporter(this.result);
        content = uBlockDashboard.mergeNewLines(getEditorText(), content);
        cmEditor.operation(( ) => {
            const cmPos = cmEditor.getCursor();
            setEditorText(content);
            cmEditor.setCursor(cmPos);
            cmEditor.focus();
        });
    };
    const file = this.files[0];
    if ( file === undefined || file.name === '' ) { return; }
    if ( file.type.indexOf('text') !== 0 ) { return; }
    const fr = new FileReader();
    fr.onload = fileReaderOnLoadHandler;
    fr.readAsText(file);
};

/******************************************************************************/

const startImportFilePicker = function() {
    const input = document.getElementById('importFilePicker');
    // Reset to empty string, this will ensure an change event is properly
    // triggered if the user pick a file, even if it is the same as the last
    // one picked.
    input.value = '';
    input.click();
};

/******************************************************************************/

const exportUserFiltersToFile = function() {
    const val = getEditorText();
    if ( val === '' ) { return; }
    const filename = vAPI.i18n('1pExportFilename')
        .replace('{{datetime}}', uBlockDashboard.dateNowToSensibleString())
        .replace(/ +/g, '_');
    vAPI.download({
        'url': 'data:text/plain;charset=utf-8,' + encodeURIComponent(val + '\n'),
        'filename': filename
    });
};

/******************************************************************************/

const applyChanges = async function() {
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
};

const revertChanges = function() {
    setEditorText(cachedUserFilters);
};

/******************************************************************************/

const getCloudData = function() {
    return getEditorText();
};

const setCloudData = function(data, append) {
    if ( typeof data !== 'string' ) { return; }
    if ( append ) {
        data = uBlockDashboard.mergeNewLines(getEditorText(), data);
    }
    cmEditor.setValue(data);
};

self.cloud.onPush = getCloudData;
self.cloud.onPull = setCloudData;

/******************************************************************************/

self.hasUnsavedData = function() {
    return getEditorText().trim() !== cachedUserFilters;
};

/******************************************************************************/

// Handle user interaction
uDom('#importUserFiltersFromFile').on('click', startImportFilePicker);
uDom('#importFilePicker').on('change', handleImportFilePicker);
uDom('#exportUserFiltersToFile').on('click', exportUserFiltersToFile);
uDom('#userFiltersApply').on('click', ( ) => { applyChanges(); });
uDom('#userFiltersRevert').on('click', revertChanges);

(async ( ) => {
    await renderUserFilters();

    cmEditor.clearHistory();

    // https://github.com/gorhill/uBlock/issues/3706
    //   Save/restore cursor position
    {
        const line =
            await vAPI.localStorage.getItemAsync('myFiltersCursorPosition');
        if ( typeof line === 'number' ) {
            cmEditor.setCursor(line, 0);
        }
    }

    // https://github.com/gorhill/uBlock/issues/3706
    //   Save/restore cursor position
    {
        let curline = 0;
        let timer;
        cmEditor.on('cursorActivity', ( ) => {
            if ( timer !== undefined ) { return; }
            if ( cmEditor.getCursor().line === curline ) { return; }
            timer = vAPI.setTimeout(( ) => {
                timer = undefined;
                curline = cmEditor.getCursor().line;
                vAPI.localStorage.setItem('myFiltersCursorPosition', curline);
            }, 701);
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

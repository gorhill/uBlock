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

(( ) => {

/******************************************************************************/

const cmEditor = new CodeMirror(
    document.getElementById('userFilters'),
    {
        autofocus: true,
        lineNumbers: true,
        lineWrapping: true,
        styleActiveLine: true,
    }
);

uBlockDashboard.patchCodeMirrorEditor(cmEditor);

let cachedUserFilters = '';

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

const renderUserFilters = async function() {
    const details = await vAPI.messaging.send('dashboard', {
        what: 'readUserFilters',
    });
    if ( details instanceof Object === false || details.error ) { return; }

    let content = details.content.trim();
    cachedUserFilters = content;
    if ( content.length !== 0 ) {
        content += '\n';
    }
    cmEditor.setValue(content);

    userFiltersChanged(false);
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
        content = uBlockDashboard.mergeNewLines(
            cmEditor.getValue().trim(),
            content
        );
        cmEditor.operation(( ) => {
            const cmPos = cmEditor.getCursor();
            cmEditor.setValue(`${content}\n`);
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
    const val = cmEditor.getValue().trim();
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
        content: cmEditor.getValue(),
    });
    if ( details instanceof Object === false || details.error ) { return; }

    cachedUserFilters = details.content.trim();
    userFiltersChanged(false);
    vAPI.messaging.send('dashboard', {
        what: 'reloadAllFilters',
    });
};

const revertChanges = function() {
    let content = cachedUserFilters;
    if ( content.length !== 0 ) {
        content += '\n';
    }
    cmEditor.setValue(content);
};

/******************************************************************************/

const getCloudData = function() {
    return cmEditor.getValue();
};

const setCloudData = function(data, append) {
    if ( typeof data !== 'string' ) { return; }
    if ( append ) {
        data = uBlockDashboard.mergeNewLines(cmEditor.getValue(), data);
    }
    cmEditor.setValue(data);
};

self.cloud.onPush = getCloudData;
self.cloud.onPull = setCloudData;

/******************************************************************************/

self.hasUnsavedData = function() {
    return cmEditor.getValue().trim() !== cachedUserFilters;
};

/******************************************************************************/

// Handle user interaction
uDom('#importUserFiltersFromFile').on('click', startImportFilePicker);
uDom('#importFilePicker').on('change', handleImportFilePicker);
uDom('#exportUserFiltersToFile').on('click', exportUserFiltersToFile);
uDom('#userFiltersApply').on('click', ( ) => { applyChanges(); });
uDom('#userFiltersRevert').on('click', revertChanges);

// https://github.com/gorhill/uBlock/issues/3706
//   Save/restore cursor position
//
// CodeMirror reference: https://codemirror.net/doc/manual.html#api_selection
{
    let curline = 0;
    let timer;

    renderUserFilters().then(( ) => {
        cmEditor.clearHistory();
        return vAPI.localStorage.getItemAsync('myFiltersCursorPosition');
    }).then(line => {
        if ( typeof line === 'number' ) {
            cmEditor.setCursor(line, 0);
        }
        cmEditor.on('cursorActivity', ( ) => {
            if ( timer !== undefined ) { return; }
            if ( cmEditor.getCursor().line === curline ) { return; }
            timer = vAPI.setTimeout(( ) => {
                timer = undefined;
                curline = cmEditor.getCursor().line;
                vAPI.localStorage.setItem('myFiltersCursorPosition', curline);
            }, 701);
        });
    });
}

cmEditor.on('changes', userFiltersChanged);
CodeMirror.commands.save = applyChanges;

/******************************************************************************/

})();

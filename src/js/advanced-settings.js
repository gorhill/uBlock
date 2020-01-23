/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2016-present Raymond Hill

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
// >>>> Start of private namespace

/******************************************************************************/

const noopFunc = function(){};

let beforeHash = '';

const cmEditor = new CodeMirror(
    document.getElementById('advancedSettings'),
    {
        autofocus: true,
        lineNumbers: true,
        lineWrapping: true,
        styleActiveLine: true
    }
);

uBlockDashboard.patchCodeMirrorEditor(cmEditor);

/******************************************************************************/

const hashFromAdvancedSettings = function(raw) {
    return raw.trim().replace(/\s*[\n\r]+\s*/g, '\n').replace(/[ \t]+/g, ' ');
};

/******************************************************************************/

// This is to give a visual hint that the content of user blacklist has changed.

const advancedSettingsChanged = (( ) => {
    let timer;

    const handler = ( ) => {
        timer = undefined;
        const changed =
            hashFromAdvancedSettings(cmEditor.getValue()) !== beforeHash;
        uDom.nodeFromId('advancedSettingsApply').disabled = !changed;
        CodeMirror.commands.save = changed ? applyChanges : noopFunc;
    };

    return function() {
        if ( timer !== undefined ) { clearTimeout(timer); }
        timer = vAPI.setTimeout(handler, 100);
    };
})();

cmEditor.on('changes', advancedSettingsChanged);

/******************************************************************************/

const renderAdvancedSettings = async function(first) {
    const raw = await vAPI.messaging.send('dashboard', {
        what: 'readHiddenSettings',
    });

    beforeHash = hashFromAdvancedSettings(raw);
    const pretty = [];
    const lines = raw.split('\n');
    let max = 0;
    for ( const line of lines ) {
        const pos = line.indexOf(' ');
        if ( pos > max ) { max = pos; }
    }
    for ( const line of lines ) {
        const pos = line.indexOf(' ');
        pretty.push(' '.repeat(max - pos) + line);
    }
    pretty.push('');
    cmEditor.setValue(pretty.join('\n'));
    if ( first ) {
        cmEditor.clearHistory();
    }
    advancedSettingsChanged();
    cmEditor.focus();
};

/******************************************************************************/

const applyChanges = async function() {
    await vAPI.messaging.send('dashboard', {
        what: 'writeHiddenSettings',
        content: cmEditor.getValue(),
    });
    renderAdvancedSettings();
};

/******************************************************************************/

uDom.nodeFromId('advancedSettings').addEventListener(
    'input',
    advancedSettingsChanged
);
uDom.nodeFromId('advancedSettingsApply').addEventListener('click', ( ) => {
    applyChanges();
});

renderAdvancedSettings(true);

/******************************************************************************/

// <<<< End of private namespace
})();

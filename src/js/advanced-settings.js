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

(function() {                           // >>>> Start of private namespace

/******************************************************************************/

let messaging = vAPI.messaging;
let noopFunc = function(){};

let beforeHash = '';

let cmEditor = new CodeMirror(
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

let hashFromAdvancedSettings = function(raw) {
    return raw.trim().replace(/\s+/g, '|');
};

/******************************************************************************/

// This is to give a visual hint that the content of user blacklist has changed.

let advancedSettingsChanged = (function () {
    let timer = null;

    let handler = ( ) => {
        timer = null;
        let changed = hashFromAdvancedSettings(cmEditor.getValue()) !== beforeHash;
        uDom.nodeFromId('advancedSettingsApply').disabled = !changed;
        CodeMirror.commands.save = changed ? applyChanges : noopFunc;
    };

    return function() {
        if ( timer !== null ) { clearTimeout(timer); }
        timer = vAPI.setTimeout(handler, 100);
    };
})();

cmEditor.on('changes', advancedSettingsChanged);

/******************************************************************************/

let renderAdvancedSettings = function(first) {
    let onRead = function(raw) {
        beforeHash = hashFromAdvancedSettings(raw);
        let pretty = [],
            whitespaces = '                                ',
            lines = raw.split('\n'),
            max = 0;
        for ( let line of lines ) {
            let pos = line.indexOf(' ');
            if ( pos > max ) { max = pos; }
        }
        for ( let line of lines ) {
            let pos = line.indexOf(' ');
            pretty.push(whitespaces.slice(0, max - pos) + line);
        }
        cmEditor.setValue(pretty.join('\n') + '\n');
        if ( first ) {
            cmEditor.clearHistory();
        }
        advancedSettingsChanged();
        cmEditor.focus();
    };
    messaging.send('dashboard', { what: 'readHiddenSettings' }, onRead);
};

/******************************************************************************/

let applyChanges = function() {
    messaging.send(
        'dashboard',
        {
            what: 'writeHiddenSettings',
            content: cmEditor.getValue()
        },
        renderAdvancedSettings
    );
};

/******************************************************************************/

uDom.nodeFromId('advancedSettings').addEventListener(
    'input',
    advancedSettingsChanged
);
uDom.nodeFromId('advancedSettingsApply').addEventListener(
    'click',
    applyChanges
);

renderAdvancedSettings(true);

/******************************************************************************/

})();                                   // <<<< End of private namespace

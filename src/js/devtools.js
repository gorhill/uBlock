/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2018 Raymond Hill

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

const cmEditor = new CodeMirror(
    document.getElementById('console'),
    {
        autofocus: true,
        lineNumbers: true,
        lineWrapping: true,
        styleActiveLine: true,
        undoDepth: 5,
    }
);

uBlockDashboard.patchCodeMirrorEditor(cmEditor);

/******************************************************************************/

function log(text) {
    cmEditor.replaceRange(text.trim() + '\n\n', { line: 0, ch: 0 });
}

/******************************************************************************/

uDom.nodeFromId('console-clear').addEventListener('click', ( ) => {
        cmEditor.setValue('');
});

uDom.nodeFromId('snfe-dump').addEventListener('click', ev => {
        const button = ev.target;
        button.setAttribute('disabled', '');
        vAPI.messaging.send('dashboard', {
            what: 'sfneDump',
        }).then(result => {
            log(result);
            button.removeAttribute('disabled');
        });
});

vAPI.messaging.send('dashboard', {
    what: 'getAppData',
}).then(appData => {
    if ( appData.canBenchmark !== true ) { return; }
    uDom.nodeFromId('snfe-benchmark').removeAttribute('disabled');
    uDom.nodeFromId('snfe-benchmark').addEventListener('click', ev => {
        const button = ev.target;
        button.setAttribute('disabled', '');
        vAPI.messaging.send('dashboard', {
            what: 'sfneBenchmark',
        }).then(result => {
            log(result);
            button.removeAttribute('disabled');
        });
    });
});

/******************************************************************************/

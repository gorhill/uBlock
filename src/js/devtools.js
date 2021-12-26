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

const reFoldable = /^ *(?=\+ \S)/;

/******************************************************************************/

CodeMirror.registerGlobalHelper(
    'fold',
    'ubo-dump',
    ( ) => true,
    (cm, start) => {
        const startLineNo = start.line;
        const startLine = cm.getLine(startLineNo);
        let endLineNo = startLineNo;
        let endLine = startLine;
        const match = reFoldable.exec(startLine);
        if ( match === null ) { return; }
        const foldCandidate = '  ' + match[0];
        const lastLineNo = cm.lastLine();
        let nextLineNo = startLineNo + 1;
        while ( nextLineNo < lastLineNo ) {
            const nextLine = cm.getLine(nextLineNo);
            if ( nextLine.startsWith(foldCandidate) === false ) {
                if ( startLineNo >= endLineNo ) { return; }
                return {
                    from: CodeMirror.Pos(startLineNo, startLine.length),
                    to: CodeMirror.Pos(endLineNo, endLine.length)
                };
            }
            endLine = nextLine;
            endLineNo = nextLineNo;
            nextLineNo += 1;
        }
    }
);

const cmEditor = new CodeMirror(
    document.getElementById('console'),
    {
        autofocus: true,
        foldGutter: true,
        gutters: [ 'CodeMirror-linenumbers', 'CodeMirror-foldgutter' ],
        lineNumbers: true,
        lineWrapping: true,
        mode: 'ubo-dump',
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

uDom.nodeFromId('console-fold').addEventListener('click', ( ) => {
    const unfolded = [];
    let maxUnfolded = -1;
    cmEditor.eachLine(handle => {
        const match = reFoldable.exec(handle.text);
        if ( match === null ) { return; }
        const depth = match[0].length;
        const line = handle.lineNo();
        const isFolded = cmEditor.isFolded({ line, ch: handle.text.length });
        if ( isFolded === true ) { return; }
        unfolded.push({ line, depth });
        maxUnfolded = Math.max(maxUnfolded, depth);
    });
    if ( maxUnfolded === -1 ) { return; }
    cmEditor.startOperation();
    for ( const details of unfolded ) {
        if ( details.depth !== maxUnfolded ) { continue; }
        cmEditor.foldCode(details.line, null, 'fold');
    }
    cmEditor.endOperation();
});

uDom.nodeFromId('console-unfold').addEventListener('click', ( ) => {
    const folded = [];
    let minFolded = Number.MAX_SAFE_INTEGER;
    cmEditor.eachLine(handle => {
        const match = reFoldable.exec(handle.text);
        if ( match === null ) { return; }
        const depth = match[0].length;
        const line = handle.lineNo();
        const isFolded = cmEditor.isFolded({ line, ch: handle.text.length });
        if ( isFolded !== true ) { return; }
        folded.push({ line, depth });
        minFolded = Math.min(minFolded, depth);
    });
    if ( minFolded === Number.MAX_SAFE_INTEGER ) { return; }
    cmEditor.startOperation();
    for ( const details of folded ) {
        if ( details.depth !== minFolded ) { continue; }
        cmEditor.foldCode(details.line, null, 'unfold');
    }
    cmEditor.endOperation();
});

uDom.nodeFromId('snfe-dump').addEventListener('click', ev => {
        const button = ev.target;
        button.setAttribute('disabled', '');
        vAPI.messaging.send('dashboard', {
            what: 'snfeDump',
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
            what: 'snfeBenchmark',
        }).then(result => {
            log(result);
            button.removeAttribute('disabled');
        });
    });
});

uDom.nodeFromId('cfe-dump').addEventListener('click', ev => {
        const button = ev.target;
        button.setAttribute('disabled', '');
        vAPI.messaging.send('dashboard', {
            what: 'cfeDump',
        }).then(result => {
            log(result);
            button.removeAttribute('disabled');
        });
});

/******************************************************************************/

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

    Home: https://github.com/gorhill/uMatrix
*/

/* global diff_match_patch, CodeMirror, uDom, uBlockDashboard */

'use strict';

/******************************************************************************/

(function() {

/******************************************************************************/

var messaging = vAPI.messaging;

var mergeView = new CodeMirror.MergeView(
    document.querySelector('.codeMirrorMergeContainer'),
    {
        allowEditingOriginals: true,
        connect: 'align',
        lineNumbers: true,
        lineWrapping: false,
        origLeft: '',
        revertButtons: true,
        value: ''
    }
);
mergeView.editor().setOption('styleActiveLine', true);
mergeView.editor().setOption('lineNumbers', false);
mergeView.leftOriginal().setOption('readOnly', 'nocursor');

var cleanToken = 0;
var cleanEditText = '';

var differ;

/******************************************************************************/

// Incrementally update text in a CodeMirror editor for best user experience:
// - Scroll position preserved
// - Minimum amount of text updated

var rulesToDoc = function(doc, rules) {
    if ( doc.getValue() === '' || rules.length === 0 ) {
        doc.setValue(rules.length !== 0 ? rules.join('\n') : '');
        return;
    }
    if ( differ === undefined ) { differ = new diff_match_patch(); }
    var beforeText = doc.getValue();
    var afterText = rules.join('\n');
    var diffs = differ.diff_main(beforeText, afterText);
    doc.startOperation();
    var i = diffs.length,
        iedit = beforeText.length;
    while ( i-- ) {
        var diff = diffs[i];
        if ( diff[0] === 0 ) {
            iedit -= diff[1].length;
            continue;
        }
        var end = doc.posFromIndex(iedit);
        if ( diff[0] === 1 ) {
            doc.replaceRange(diff[1], end, end);
            continue;
        }
        /* diff[0] === -1 */
        iedit -= diff[1].length;
        var beg = doc.posFromIndex(iedit);
        doc.replaceRange('', beg, end);
    }
    doc.endOperation();
};

/******************************************************************************/

var renderRules = (function() {
    var firstVisit = true;

    return function(details) {
        details.hnSwitches.sort();
        details.permanentRules.sort();
        details.sessionRules.sort();
        var orig = details.hnSwitches.concat(details.permanentRules),
            edit = details.hnSwitches.concat(details.sessionRules);
        rulesToDoc(mergeView.leftOriginal(), orig);
        rulesToDoc(mergeView.editor(), edit);
        cleanEditText = mergeView.editor().getValue().trim();
        if ( firstVisit ) {
            mergeView.editor().clearHistory();
            firstVisit = false;
            mergeView.editor().execCommand('goNextDiff');
        }
        cleanToken = mergeView.editor().changeGeneration();
        onChange(true);
    };
})();

/******************************************************************************/

var applyDiff = function(permanent, toAdd, toRemove, callback) {
    messaging.send(
        'dashboard',
        {
            what: 'modifyRuleset',
            permanent: permanent,
            toAdd: toAdd,
            toRemove: toRemove
        },
        callback
    );
};

/******************************************************************************/

// CodeMirror quirk: sometimes fromStart.ch and/or toStart.ch is undefined.
// When this happens, use 0.

mergeView.options.revertChunk = function(
    mv,
    from, fromStart, fromEnd,
    to, toStart, toEnd
) {
    // https://github.com/gorhill/uBlock/issues/3611
    if ( document.body.getAttribute('dir') === 'rtl' ) {
        var tmp;
        tmp = from; from = to; to = tmp;
        tmp = fromStart; fromStart = toStart; toStart = tmp;
        tmp = fromEnd; fromEnd = toEnd; toEnd = tmp;
    }
    if ( typeof fromStart.ch !== 'number' ) { fromStart.ch = 0; }
    if ( fromEnd.ch !== 0 ) { fromEnd.line += 1; }
    var toAdd = from.getRange(
        { line: fromStart.line, ch: 0 },
        { line: fromEnd.line, ch: 0 }
    );
    if ( typeof toStart.ch !== 'number' ) { toStart.ch = 0; }
    if ( toEnd.ch !== 0 ) { toEnd.line += 1; }
    var toRemove = to.getRange(
        { line: toStart.line, ch: 0 },
        { line: toEnd.line, ch: 0 }
    );
    applyDiff(from === mv.editor(), toAdd, toRemove);
    to.replaceRange(toAdd, toStart, toEnd);
    cleanToken = mergeView.editor().changeGeneration();
    cleanEditText = mergeView.editor().getValue().trim();
};

/******************************************************************************/

function handleImportFilePicker() {
    var fileReaderOnLoadHandler = function() {
        if ( typeof this.result !== 'string' || this.result === '' ) {
            return;
        }
        // https://github.com/chrisaljoudi/uBlock/issues/757
        // Support RequestPolicy rule syntax
        var result = this.result;
        var matches = /\[origins-to-destinations\]([^\[]+)/.exec(result);
        if ( matches && matches.length === 2 ) {
            result = matches[1].trim()
                               .replace(/\|/g, ' ')
                               .replace(/\n/g, ' * noop\n');
        }
        applyDiff(false, result, '', renderRules);
    };
    var file = this.files[0];
    if ( file === undefined || file.name === '' ) { return; }
    if ( file.type.indexOf('text') !== 0 ) { return; }
    var fr = new FileReader();
    fr.onload = fileReaderOnLoadHandler;
    fr.readAsText(file);
}

/******************************************************************************/

var startImportFilePicker = function() {
    var input = document.getElementById('importFilePicker');
    // Reset to empty string, this will ensure an change event is properly
    // triggered if the user pick a file, even if it is the same as the last
    // one picked.
    input.value = '';
    input.click();
};

/******************************************************************************/

function exportUserRulesToFile() {
    var filename = vAPI.i18n('rulesDefaultFileName')
        .replace('{{datetime}}', uBlockDashboard.dateNowToSensibleString())
        .replace(/ +/g, '_');
    vAPI.download({
        url: 'data:text/plain,' + encodeURIComponent(
            mergeView.leftOriginal().getValue().trim() + '\n'
        ),
        filename: filename,
        saveAs: true
    });
}

/******************************************************************************/

/*
var onFilter = (function() {
    var timer;

    var process = function() {
        timer = undefined;
    };

    return function() {
        if ( timer !== undefined ) { clearTimeout(timer); }
        timer = vAPI.setTimeout(process, 577);
    };
})();
*/

/******************************************************************************/

var onChange = (function() {
    var timer;

    var process = function(now) {
        timer = undefined;
        var isClean = mergeView.editor().isClean(cleanToken);
        var diff = document.getElementById('diff');
        if (
            now &&
            isClean === false &&
            mergeView.editor().getValue().trim() === cleanEditText
        ) {
            cleanToken = mergeView.editor().changeGeneration();
            isClean = true;
        }
        diff.classList.toggle('editing', isClean === false);
        diff.classList.toggle('dirty', mergeView.leftChunks().length !== 0);
        CodeMirror.commands.save = isClean ? undefined : editSaveHandler;
    };

    return function(now) {
        if ( timer !== undefined ) { clearTimeout(timer); }
        timer = now ? process(now) : vAPI.setTimeout(process, 57);
    };
})();

/******************************************************************************/

var revertAllHandler = function() {
    var toAdd = [], toRemove = [];
    var left = mergeView.leftOriginal(),
        edit = mergeView.editor();
    for ( var chunk of mergeView.leftChunks() ) {
        var addedLines = left.getRange(
            { line: chunk.origFrom, ch: 0 },
            { line: chunk.origTo, ch: 0 }
        );
        var removedLines = edit.getRange(
            { line: chunk.editFrom, ch: 0 },
            { line: chunk.editTo, ch: 0 }
        );
        toAdd.push(addedLines.trim());
        toRemove.push(removedLines.trim());
    }
    applyDiff(false, toAdd.join('\n'), toRemove.join('\n'), renderRules);
};

/******************************************************************************/

var commitAllHandler = function() {
    var toAdd = [], toRemove = [];
    var left = mergeView.leftOriginal(),
        edit = mergeView.editor();
    for ( var chunk of mergeView.leftChunks() ) {
        var addedLines = edit.getRange(
            { line: chunk.editFrom, ch: 0 },
            { line: chunk.editTo, ch: 0 }
        );
        var removedLines = left.getRange(
            { line: chunk.origFrom, ch: 0 },
            { line: chunk.origTo, ch: 0 }
        );
        toAdd.push(addedLines.trim());
        toRemove.push(removedLines.trim());
    }
    applyDiff(true, toAdd.join('\n'), toRemove.join('\n'), renderRules);
};

/******************************************************************************/

var editSaveHandler = function() {
    var editor = mergeView.editor();
    var editText = editor.getValue().trim();
    if ( editText === cleanEditText ) {
        onChange(true);
        return;
    }
    if ( differ === undefined ) { differ = new diff_match_patch(); }
    var toAdd = [], toRemove = [];
    var diffs = differ.diff_main(cleanEditText, editText);
    for ( var diff of diffs ) {
        if ( diff[0] === 1 ) {
            toAdd.push(diff[1]);
        } else if ( diff[0] === -1 ) {
            toRemove.push(diff[1]);
        }
    }
    applyDiff(false, toAdd.join(''), toRemove.join(''), renderRules);
};

/******************************************************************************/

var getCloudData = function() {
    return mergeView.leftOriginal().getValue().trim();
};

var setCloudData = function(data, append) {
    if ( typeof data !== 'string' ) { return; }
    applyDiff(
        false,
        data,
        append ? '' : mergeView.editor().getValue().trim(),
        renderRules
    );
};

self.cloud.onPush = getCloudData;
self.cloud.onPull = setCloudData;

/******************************************************************************/

messaging.send('dashboard', { what: 'getRules' }, renderRules);

// Handle user interaction
uDom('#importButton').on('click', startImportFilePicker);
uDom('#importFilePicker').on('change', handleImportFilePicker);
uDom('#exportButton').on('click', exportUserRulesToFile);
uDom('#revertButton').on('click', revertAllHandler);
uDom('#commitButton').on('click', commitAllHandler);
uDom('#editSaveButton').on('click', editSaveHandler);

// https://groups.google.com/forum/#!topic/codemirror/UQkTrt078Vs
mergeView.editor().on('updateDiff', function() { onChange(); });

/******************************************************************************/

})();


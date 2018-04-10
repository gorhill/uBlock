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

(function() {

/******************************************************************************/

var messaging = vAPI.messaging;
var cachedUserFilters = '';

var cmEditor = new CodeMirror(
    document.getElementById('userFilters'),
    {
        autofocus: true,
        lineNumbers: true,
        lineWrapping: true,
        styleActiveLine: true
    }
);

uBlockDashboard.patchCodeMirrorEditor(cmEditor);

/******************************************************************************/

// This is to give a visual hint that the content of user blacklist has changed.

function userFiltersChanged(changed) {
    if ( typeof changed !== 'boolean' ) {
        changed = cmEditor.getValue().trim() !== cachedUserFilters;
    }
    uDom.nodeFromId('userFiltersApply').disabled = !changed;
    uDom.nodeFromId('userFiltersRevert').disabled = !changed;
}

/******************************************************************************/

function renderUserFilters(first) {
    var onRead = function(details) {
        if ( details.error ) { return; }
        var content = details.content.trim();
        cachedUserFilters = content;
        if ( content.length !== 0 ) {
            content += '\n';
        }
        cmEditor.setValue(content);
        if ( first ) {
            cmEditor.clearHistory();
        }
        userFiltersChanged(false);
    };
    messaging.send('dashboard', { what: 'readUserFilters' }, onRead);
}

/******************************************************************************/

function allFiltersApplyHandler() {
    messaging.send('dashboard', { what: 'reloadAllFilters' });
    uDom('#userFiltersApply').prop('disabled', true );
}

/******************************************************************************/

var handleImportFilePicker = function() {
    // https://github.com/chrisaljoudi/uBlock/issues/1004
    // Support extraction of filters from ABP backup file
    var abpImporter = function(s) {
        var reAbpSubscriptionExtractor = /\n\[Subscription\]\n+url=~[^\n]+([\x08-\x7E]*?)(?:\[Subscription\]|$)/ig;
        var reAbpFilterExtractor = /\[Subscription filters\]([\x08-\x7E]*?)(?:\[Subscription\]|$)/i;
        var matches = reAbpSubscriptionExtractor.exec(s);
        // Not an ABP backup file
        if ( matches === null ) {
            return s;
        }
        // 
        var out = [];
        var filterMatch;
        while ( matches !== null ) {
            if ( matches.length === 2 ) {
                filterMatch = reAbpFilterExtractor.exec(matches[1].trim());
                if ( filterMatch !== null && filterMatch.length === 2 ) {
                    out.push(filterMatch[1].trim().replace(/\\\[/g, '['));
                }
            }
            matches = reAbpSubscriptionExtractor.exec(s);
        }
        return out.join('\n');
    };

    var fileReaderOnLoadHandler = function() {
        var sanitized = abpImporter(this.result);
        cmEditor.setValue(cmEditor.getValue().trim() + '\n' + sanitized);
    };
    var file = this.files[0];
    if ( file === undefined || file.name === '' ) {
        return;
    }
    if ( file.type.indexOf('text') !== 0 ) {
        return;
    }
    var fr = new FileReader();
    fr.onload = fileReaderOnLoadHandler;
    fr.readAsText(file);
};

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

var exportUserFiltersToFile = function() {
    var val = cmEditor.getValue().trim();
    if ( val === '' ) { return; }
    var filename = vAPI.i18n('1pExportFilename')
        .replace('{{datetime}}', uBlockDashboard.dateNowToSensibleString())
        .replace(/ +/g, '_');
    vAPI.download({
        'url': 'data:text/plain;charset=utf-8,' + encodeURIComponent(val + '\n'),
        'filename': filename
    });
};

/******************************************************************************/

var applyChanges = function() {
    var onWritten = function(details) {
        if ( details.error ) { return; }
        cachedUserFilters = details.content.trim();
        allFiltersApplyHandler();
    };
    messaging.send(
        'dashboard',
        {
            what: 'writeUserFilters',
            content: cmEditor.getValue()
        },
        onWritten
    );
};

var revertChanges = function() {
    var content = cachedUserFilters;
    if ( content.length !== 0 ) {
        content += '\n';
    }
    cmEditor.setValue(content);
};

/******************************************************************************/

var getCloudData = function() {
    return cmEditor.getValue();
};

var setCloudData = function(data, append) {
    if ( typeof data !== 'string' ) { return; }
    if ( append ) {
        data = uBlockDashboard.mergeNewLines(cmEditor.getValue(), data);
    }
    cmEditor.setValue(data);
};

self.cloud.onPush = getCloudData;
self.cloud.onPull = setCloudData;

/******************************************************************************/

// Handle user interaction
uDom('#importUserFiltersFromFile').on('click', startImportFilePicker);
uDom('#importFilePicker').on('change', handleImportFilePicker);
uDom('#exportUserFiltersToFile').on('click', exportUserFiltersToFile);
uDom('#userFiltersApply').on('click', applyChanges);
uDom('#userFiltersRevert').on('click', revertChanges);

renderUserFilters(true);

cmEditor.on('changes', userFiltersChanged);
CodeMirror.commands.save = applyChanges;

/******************************************************************************/

// https://www.youtube.com/watch?v=UNilsLf6eW4

})();

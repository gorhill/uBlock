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

CodeMirror.defineMode("ubo-whitelist-directives", function() {
    var reComment = /^\s*#/,
        reRegex = /^\/.+\/$/;

    return {
        token: function(stream) {
            var line = stream.string.trim();
            stream.skipToEnd();
            if ( reBadHostname === undefined ) {
                return null;
            }
            if ( reComment.test(line) ) {
                return 'comment';
            }
            if ( line.indexOf('/') === -1 ) {
                return reBadHostname.test(line) ? 'error' : null;
            }
            if ( reRegex.test(line) ) {
                try {
                    new RegExp(line.slice(1, -1));
                } catch(ex) {
                    return 'error';
                }
                return null;
            }
            return reHostnameExtractor.test(line) ? null : 'error';
        }
    };
});

var reBadHostname,
    reHostnameExtractor;

/******************************************************************************/

var messaging = vAPI.messaging,
    cachedWhitelist = '',
    noopFunc = function(){};

var cmEditor = new CodeMirror(
    document.getElementById('whitelist'),
    {
        autofocus: true,
        lineNumbers: true,
        lineWrapping: true,
        styleActiveLine: true
    }
);

uBlockDashboard.patchCodeMirrorEditor(cmEditor);

/******************************************************************************/

var whitelistChanged = function() {
    var whitelistElem = uDom.nodeFromId('whitelist');
    var bad = whitelistElem.querySelector('.cm-error') !== null;
    var changedWhitelist = cmEditor.getValue().trim();
    var changed = changedWhitelist !== cachedWhitelist;
    uDom.nodeFromId('whitelistApply').disabled = !changed || bad;
    uDom.nodeFromId('whitelistRevert').disabled = !changed;
    CodeMirror.commands.save = changed && !bad ? applyChanges : noopFunc;
};

cmEditor.on('changes', whitelistChanged);

/******************************************************************************/

var renderWhitelist = function() {
    var onRead = function(details) {
        var first = reBadHostname === undefined;
        if ( first ) {
            reBadHostname = new RegExp(details.reBadHostname);
            reHostnameExtractor = new RegExp(details.reHostnameExtractor);
        }
        cachedWhitelist = details.whitelist.trim();
        cmEditor.setValue(cachedWhitelist + '\n');
        if ( first ) {
            cmEditor.clearHistory();
        }
    };
    messaging.send('dashboard', { what: 'getWhitelist' }, onRead);
};

/******************************************************************************/

var handleImportFilePicker = function() {
    var fileReaderOnLoadHandler = function() {
        cmEditor.setValue(
            [
                cmEditor.getValue().trim(),
                this.result.trim()
            ].join('\n').trim()
        );
    };
    var file = this.files[0];
    if ( file === undefined || file.name === '' ) { return; }
    if ( file.type.indexOf('text') !== 0 ) { return; }
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

var exportWhitelistToFile = function() {
    var val = cmEditor.getValue().trim();
    if ( val === '' ) { return; }
    var filename = vAPI.i18n('whitelistExportFilename')
        .replace('{{datetime}}', uBlockDashboard.dateNowToSensibleString())
        .replace(/ +/g, '_');
    vAPI.download({
        'url': 'data:text/plain;charset=utf-8,' + encodeURIComponent(val + '\n'),
        'filename': filename
    });
};

/******************************************************************************/

var applyChanges = function() {
    cachedWhitelist = cmEditor.getValue().trim();
    messaging.send(
        'dashboard',
        {
            what: 'setWhitelist',
            whitelist: cachedWhitelist
        },
        renderWhitelist
    );
};

var revertChanges = function() {
    var content = cachedWhitelist;
    if ( content !== '' ) { content += '\n'; }
    cmEditor.setValue(content);
};

/******************************************************************************/

var getCloudData = function() {
    return cmEditor.getValue();
};

var setCloudData = function(data, append) {
    if ( typeof data !== 'string' ) { return; }
    if ( append ) {
        data = uBlockDashboard.mergeNewLines(cmEditor.getValue().trim(), data);
    }
    cmEditor.setValue(data.trim() + '\n');
};

self.cloud.onPush = getCloudData;
self.cloud.onPull = setCloudData;

/******************************************************************************/

uDom('#importWhitelistFromFile').on('click', startImportFilePicker);
uDom('#importFilePicker').on('change', handleImportFilePicker);
uDom('#exportWhitelistToFile').on('click', exportWhitelistToFile);
uDom('#whitelistApply').on('click', applyChanges);
uDom('#whitelistRevert').on('click', revertChanges);

renderWhitelist();

/******************************************************************************/

})();

/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 Raymond Hill

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

/* global uDom, uBlockDashboard */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var messaging = vAPI.messaging,
    cachedWhitelist = '';

/******************************************************************************/

var getTextareaNode = function() {
    var me = getTextareaNode,
        node = me.theNode;
    if ( node === undefined ) {
        node = me.theNode = uDom.nodeFromSelector('#whitelist textarea');
    }
    return node;
};

var setErrorNodeHorizontalOffset = function(px) {
    var me = setErrorNodeHorizontalOffset,
        offset = me.theOffset || 0;
    if ( px === offset ) { return; }
    var node = me.theNode;
    if ( node === undefined ) {
        node = me.theNode = uDom.nodeFromSelector('#whitelist textarea + div');
    }
    node.style.right = px + 'px';
    me.theOffset = px;
};

/******************************************************************************/

var whitelistChanged = (function() {
    var changedWhitelist, changed, timer;

    var updateUI = function(good) {
        uDom.nodeFromId('whitelistApply').disabled = changed || !good;
        uDom.nodeFromId('whitelistRevert').disabled = changed;
        uDom.nodeFromId('whitelist').classList.toggle('invalid', !good);
    };

    var validate = function() {
        timer = undefined;
        messaging.send(
            'dashboard',
            { what: 'validateWhitelistString', raw: changedWhitelist },
            updateUI
        );
    };

    return function() {
        changedWhitelist = getTextareaNode().value.trim();
        changed = changedWhitelist === cachedWhitelist;
        if ( timer !== undefined ) { clearTimeout(timer); }
        timer = vAPI.setTimeout(validate, 251);
        var textarea = getTextareaNode();
        setErrorNodeHorizontalOffset(textarea.offsetWidth - textarea.clientWidth);
    };
})();

/******************************************************************************/

var renderWhitelist = function() {
    var onRead = function(whitelist) {
        cachedWhitelist = whitelist.trim();
        getTextareaNode().value = cachedWhitelist + '\n';
        whitelistChanged();
    };
    messaging.send('dashboard', { what: 'getWhitelist' }, onRead);
};

/******************************************************************************/

var handleImportFilePicker = function() {
    var fileReaderOnLoadHandler = function() {
        var textarea = getTextareaNode();
        textarea.value = [textarea.value.trim(), this.result.trim()].join('\n').trim();
        whitelistChanged();
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

var exportWhitelistToFile = function() {
    var val = getTextareaNode().value.trim();
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
    cachedWhitelist = getTextareaNode().value.trim();
    var request = {
        what: 'setWhitelist',
        whitelist: cachedWhitelist
    };
    messaging.send('dashboard', request, renderWhitelist);
};

var revertChanges = function() {
    getTextareaNode().value = cachedWhitelist + '\n';
    whitelistChanged();
};

/******************************************************************************/

var getCloudData = function() {
    return getTextareaNode().value;
};

var setCloudData = function(data, append) {
    if ( typeof data !== 'string' ) {
        return;
    }
    var textarea = getTextareaNode();
    if ( append ) {
        data = uBlockDashboard.mergeNewLines(textarea.value.trim(), data);
    }
    textarea.value = data.trim() + '\n';
    whitelistChanged();
};

self.cloud.onPush = getCloudData;
self.cloud.onPull = setCloudData;

/******************************************************************************/

uDom('#importWhitelistFromFile').on('click', startImportFilePicker);
uDom('#importFilePicker').on('change', handleImportFilePicker);
uDom('#exportWhitelistToFile').on('click', exportWhitelistToFile);
uDom('#whitelist textarea').on('input', whitelistChanged);
uDom('#whitelistApply').on('click', applyChanges);
uDom('#whitelistRevert').on('click', revertChanges);

renderWhitelist();

/******************************************************************************/

})();

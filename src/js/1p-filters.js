/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

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

/* global vAPI, uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var cachedUserFilters = '';

/******************************************************************************/

var messager = vAPI.messaging.channel('1p-filters.js');

/******************************************************************************/

// This is to give a visual hint that the content of user blacklist has changed.

function userFiltersChanged() {
    uDom('#userFiltersApply').prop(
        'disabled',
        uDom('#userFilters').val().trim() === cachedUserFilters
    );
}

/******************************************************************************/

function renderUserFilters() {
    var onRead = function(details) {
        if ( details.error ) {
            return;
        }
        cachedUserFilters = details.content.trim();
        uDom('#userFilters').val(details.content);
    };
    messager.send({ what: 'readUserFilters' }, onRead);
}

/******************************************************************************/

function allFiltersApplyHandler() {
    messager.send({ what: 'reloadAllFilters' });
    uDom('#userFiltersApply').prop('disabled', true );
}

/******************************************************************************/

var handleImportFilePicker = function() {
    var fileReaderOnLoadHandler = function() {
        var textarea = uDom('#userFilters');
        textarea.val([textarea.val(), this.result].join('\n').trim());
        userFiltersChanged();
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
    var val = uDom('#userFilters').val().trim();
    if ( val === '' ) {
        return;
    }
    var now = new Date();
    vAPI.download({
        'url': 'data:text/plain;charset=utf-8,' + encodeURIComponent(val),
        'filename': 'ublock-filters_' + now.toLocaleString().replace(/ +/g, '_') + '.txt'
    });
};

/******************************************************************************/

var userFiltersApplyHandler = function() {
    var onWritten = function(details) {
        if ( details.error ) {
            return;
        }
        cachedUserFilters = details.content.trim();
        userFiltersChanged();
        allFiltersApplyHandler();
    };
    var request = {
        what: 'writeUserFilters',
        content: uDom('#userFilters').val()
    };
    messager.send(request, onWritten);
};

/******************************************************************************/

uDom.onLoad(function() {
    // Handle user interaction
    uDom('#importUserFiltersFromFile').on('click', startImportFilePicker);
    uDom('#importFilePicker').on('change', handleImportFilePicker);
    uDom('#exportUserFiltersToFile').on('click', exportUserFiltersToFile);
    uDom('#userFilters').on('input', userFiltersChanged);
    uDom('#userFiltersApply').on('click', userFiltersApplyHandler);

    renderUserFilters();
});

/******************************************************************************/

// https://www.youtube.com/watch?v=UNilsLf6eW4

})();


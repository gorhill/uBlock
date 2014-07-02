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

/* global chrome, messaging, uDom */

/******************************************************************************/

(function() {

/******************************************************************************/

var cachedUserFilters = '';

/******************************************************************************/

messaging.start('1p-filters.js');

/******************************************************************************/

// This is to give a visual hint that the content of user blacklist has changed.

function userFiltersChanged(ev) {
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
    messaging.ask({ what: 'readUserFilters' }, onRead);
}

/******************************************************************************/

function allFiltersApplyHandler() {
    messaging.tell({ what: 'reloadAllFilters' });
    uDom('#userFiltersApply').prop('disabled', true );
}

/******************************************************************************/

function appendToUserFiltersFromFile() {
    var input = uDom('<input />').attr({
        type: 'file',
        accept: 'text/plain'
    });
    var fileReaderOnLoadHandler = function() {
        var textarea = uDom('#userFilters');
        textarea.val([textarea.val(), this.result].join('\n').trim());
        userFiltersChanged();
    };
    var filePickerOnChangeHandler = function() {
        var file = this.files[0];
        if ( !file ) {
            return;
        }
        if ( file.type.indexOf('text') !== 0 ) {
            return;
        }
        var fr = new FileReader();
        fr.onload = fileReaderOnLoadHandler;
        fr.readAsText(file);
        input.off('change', filePickerOnChangeHandler);
    };
    input.on('change', filePickerOnChangeHandler);
    input.trigger('click');
}

/******************************************************************************/

function exportUserFiltersToFile() {
    chrome.downloads.download({
        'url': 'data:text/plain,' + encodeURIComponent(uDom('#userFilters').val()),
        'filename': 'my-ublock-filters.txt',
        'saveAs': true
    });
}

/******************************************************************************/

function userFiltersApplyHandler() {
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
    messaging.ask(request, onWritten);
}

/******************************************************************************/

uDom.onLoad(function() {
    // Handle user interaction
    uDom('#importUserFiltersFromFile').on('click', appendToUserFiltersFromFile);
    uDom('#exportUserFiltersToFile').on('click', exportUserFiltersToFile);
    uDom('#userFilters').on('input', userFiltersChanged);
    uDom('#userFiltersApply').on('click', userFiltersApplyHandler);

    renderUserFilters();
});

/******************************************************************************/

})();


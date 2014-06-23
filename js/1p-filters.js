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

/* global chrome, $ */

/******************************************************************************/

(function() {

/******************************************************************************/

var cachedUserFilters = '';

/******************************************************************************/

messaging.start('1p-filters.js');

/******************************************************************************/

// This is to give a visual hint that the content of user blacklist has changed.

function userFiltersChanged() {
    $('#userFiltersApply')
        .attr(
            'disabled',
            $('#userFilters').val().trim() === cachedUserFilters
        );
}

/******************************************************************************/

function renderUserFilters() {
    var onRead = function(details) {
        if ( details.error ) {
            return;
        }
        cachedUserFilters = details.content.trim();
        $('#userFilters').val(details.content);
    };
    messaging.ask({ what: 'readUserFilters' }, onRead);
}

/******************************************************************************/

function allFiltersApplyHandler() {
    messaging.tell({ what: 'reloadAllFilters' });
    $('#userFiltersApply').attr('disabled', true );
}

/******************************************************************************/

function appendToUserFiltersFromFile() {
    var input = $('<input />').attr({
        type: 'file',
        accept: 'text/plain'
    });
    var fileReaderOnLoadHandler = function() {
        var textarea = $('#userFilters');
        textarea.val(textarea.val() + '\n' + this.result);
        userFiltersChanged();
    };
    var filePickerOnChangeHandler = function() {
        $(this).off('change', filePickerOnChangeHandler);
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
        'url': 'data:text/plain,' + encodeURIComponent($('#userFilters').val()),
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
        content: $('#userFilters').val()
    };
    messaging.ask(request, onWritten);
}

/******************************************************************************/

$(function() {
    // Handle user interaction
    $('#importUserFiltersFromFile').on('click', appendToUserFiltersFromFile);
    $('#exportUserFiltersToFile').on('click', exportUserFiltersToFile);
    $('#userFilters').on('input propertychange', userFiltersChanged);
    $('#userFiltersApply').on('click', userFiltersApplyHandler);

    renderUserFilters();
});

/******************************************************************************/

})();


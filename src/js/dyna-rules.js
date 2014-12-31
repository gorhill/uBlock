/*******************************************************************************

    µMatrix - a Chromium browser extension to block requests.
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

    Home: https://github.com/gorhill/uMatrix
*/

/* global chrome, messaging, uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var messager = vAPI.messaging.channel('dyna-rules.js');

/******************************************************************************/

// Switches before, rules after

var normalizeRawRules = function(s) {
    return s.replace(/[ \t]+/g, ' ')
            .split(/\s*\n+\s*/)
            .sort(directiveSort)
            .join('\n')
            .trim();
};

/******************************************************************************/

// This is to give a visual hint that the content of user blacklist has changed.

function rulesChanged() {
    uDom('#rulesApply').prop(
        'disabled',
        normalizeRawRules(uDom('#rulesEditor').val()) === cachedRawRules
    );
}

var cachedRawRules = '';

/******************************************************************************/

// Switches before, rules after

var directiveSort = function(a, b) {
    var aIsSwitch = a.indexOf(':') !== -1;
    var bIsSwitch = b.indexOf(':') !== -1;
    if ( aIsSwitch === bIsSwitch ) {
        return a.localeCompare(b);
    }
    return aIsSwitch ? -1 : 1;
};

/******************************************************************************/

var processRules = function(rawRules) {
    cachedRawRules = normalizeRawRules(rawRules);
    uDom('#rulesEditor').val(cachedRawRules);
};

/******************************************************************************/

var rulesApplyHandler = function() {
    var onWritten = function(response) {
        processRules(response);
        rulesChanged();
    };
    var request = {
        what: 'setDynamicRules',
        rawRules: uDom('#rulesEditor').val()
    };
    messager.send(request, onWritten);
};

/******************************************************************************/

function handleImportFilePicker() {
    var fileReaderOnLoadHandler = function() {
        if ( typeof this.result !== 'string' || this.result === '' ) {
            return;
        }
        var request = {
            'what': 'setDynamicRules',
            'rawRules': uDom('#rulesEditor').val()
        };
        messager.send(request, processRules);
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
    chrome.downloads.download({
        'url': 'data:text/plain,' + encodeURIComponent(rulesFromHTML('#diff .left li')),
        'filename': uDom('[data-i18n="userRulesDefaultFileName"]').text(),
        'saveAs': true
    });
}

/******************************************************************************/

uDom.onLoad(function() {
    // Handle user interaction
    uDom('#importButton').on('click', startImportFilePicker);
    uDom('#importFilePicker').on('change', handleImportFilePicker);
    uDom('#exportButton').on('click', exportUserRulesToFile);
    uDom('#rulesEditor').on('input', rulesChanged);
    uDom('#rulesApply').on('click', rulesApplyHandler);

    messager.send({ what: 'getDynamicRules' }, processRules);
});

/******************************************************************************/

})();


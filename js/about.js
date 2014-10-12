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

uDom.onLoad(function() {

/******************************************************************************/

messaging.start('about.js');

/******************************************************************************/

var exportToFile = function() {
    var onUserDataReady = function(userData) {
        chrome.downloads.download({
            'url': 'data:text/plain,' + encodeURIComponent(JSON.stringify(userData)),
            'filename': 'ublock-backup.txt',
            'saveAs': true
        });
    };

    messaging.ask({ what: 'getUserData' }, onUserDataReady);
};

/******************************************************************************/

var handleImportFilePicker = function() {
    var fileReaderOnLoadHandler = function() {
        var userData;
        try {
            userData = JSON.parse(this.result);
        }
        catch (e) {
        }
        if ( userData === undefined ) {
            return;
        }
        var time = new Date(userData.timeStamp);
        var msg = chrome.i18n
            .getMessage('aboutRestoreDataConfirm')
            .replace('{{time}}', time.toLocaleString());
        var proceed = window.confirm(msg);
        if ( proceed ) {
            messaging.tell({ what: 'restoreUserData', userData: userData });
        }
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
    var input = document.getElementById('restoreFilePicker');
    // Reset to empty string, this will ensure an change event is properly
    // triggered if the user pick a file, even if it is the same as the last
    // one picked.
    input.value = '';
    input.click();
};

/******************************************************************************/

var resetUserData = function() {
    var msg = chrome.i18n.getMessage('aboutResetDataConfirm');
    var proceed = window.confirm(msg);
    if ( proceed ) {
        messaging.tell({ what: 'resetUserData' });
    }
};

/******************************************************************************/

uDom('#aboutVersion').html(chrome.runtime.getManifest().version);
uDom('#export').on('click', exportToFile);
uDom('#import').on('click', startImportFilePicker);
uDom('#reset').on('click', resetUserData);
uDom('#restoreFilePicker').on('change', handleImportFilePicker);

/******************************************************************************/

});

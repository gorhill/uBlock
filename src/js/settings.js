/*******************************************************************************

    µBlock - a browser extension to block requests.
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
    along with this program.  If not, see {https://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/* global vAPI, uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var messager = vAPI.messaging.channel('settings.js');

/******************************************************************************/

var handleImportFilePicker = function() {
    var file = this.files[0];
    if ( file === undefined || file.name === '' ) {
        return;
    }
    if ( file.type.indexOf('text') !== 0 ) {
        return;
    }
    var filename = file.name;

    var fileReaderOnLoadHandler = function() {
        var userData;
        try {
            userData = JSON.parse(this.result);
            if ( typeof userData !== 'object' ) {
                throw 'Invalid';
            }
            if ( typeof userData.userSettings !== 'object' ) {
                throw 'Invalid';
            }
            if ( typeof userData.netWhitelist !== 'string' ) {
                throw 'Invalid';
            }
            if ( typeof userData.filterLists !== 'object' ) {
                throw 'Invalid';
            }
        }
        catch (e) {
            userData = undefined;
        }
        if ( userData === undefined ) {
            window.alert(vAPI.i18n('aboutRestoreDataError'));
            return;
        }
        var time = new Date(userData.timeStamp);
        var msg = vAPI.i18n('aboutRestoreDataConfirm')
                      .replace('{{time}}', time.toLocaleString());
        var proceed = window.confirm(msg);
        if ( proceed ) {
            messager.send({
                what: 'restoreUserData',
                userData: userData,
                file: filename
            });
        }
    };

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

var exportToFile = function() {
    messager.send({ what: 'backupUserData' }, onLocalDataReceived);
};

/******************************************************************************/

var onLocalDataReceived = function(details) {
    uDom('#localData > ul > li:nth-of-type(1)').text(
        vAPI.i18n('settingsStorageUsed').replace('{{value}}', details.storageUsed.toLocaleString())
    );

    var elem, dt;
    var timeOptions = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        timeZoneName: 'short'
    };
    var lastBackupFile = details.lastBackupFile || '';
    if ( lastBackupFile !== '' ) {
        dt = new Date(details.lastBackupTime);
        uDom('#localData > ul > li:nth-of-type(2) > ul > li:nth-of-type(1)').text(dt.toLocaleString('fullwide', timeOptions));
        //uDom('#localData > ul > li:nth-of-type(2) > ul > li:nth-of-type(2)').text(lastBackupFile);
        uDom('#localData > ul > li:nth-of-type(2)').css('display', '');
    }

    var lastRestoreFile = details.lastRestoreFile || '';
    elem = uDom('#localData > p:nth-of-type(3)');
    if ( lastRestoreFile !== '' ) {
        dt = new Date(details.lastRestoreTime);
        uDom('#localData > ul > li:nth-of-type(3) > ul > li:nth-of-type(1)').text(dt.toLocaleString('fullwide', timeOptions));
        uDom('#localData > ul > li:nth-of-type(3) > ul > li:nth-of-type(2)').text(lastRestoreFile);
        uDom('#localData > ul > li:nth-of-type(3)').css('display', '');
    }
};

/******************************************************************************/

var resetUserData = function() {
    var msg = vAPI.i18n('aboutResetDataConfirm');
    var proceed = window.confirm(msg);
    if ( proceed ) {
        messager.send({ what: 'resetUserData' });
    }
};

/******************************************************************************/

var changeUserSettings = function(name, value) {
    messager.send({
        what: 'userSettings',
        name: name,
        value: value
    });
};

/******************************************************************************/

// TODO: use data-* to declare simple settings

var onUserSettingsReceived = function(details) {
    uDom('[data-setting-type="bool"]').forEach(function(uNode) {
        var input = uNode.nodeAt(0);
        uNode.prop('checked', details[input.getAttribute('data-setting-name')] === true)
             .on('change', function() {
                changeUserSettings(
                    this.getAttribute('data-setting-name'),
                    this.checked
                );
            });
    });

    uDom('#export').on('click', exportToFile);
    uDom('#import').on('click', startImportFilePicker);
    uDom('#reset').on('click', resetUserData);
    uDom('#restoreFilePicker').on('change', handleImportFilePicker);
};

/******************************************************************************/

uDom.onLoad(function() {
    messager.send({ what: 'userSettings' }, onUserSettingsReceived);
    messager.send({ what: 'getLocalData' }, onLocalDataReceived);
});

/******************************************************************************/

})();

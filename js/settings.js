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

/* global messaging, uDom */

/******************************************************************************/

uDom.onLoad(function() {

/******************************************************************************/

messaging.start('settings.js');

/******************************************************************************/

var changeUserSettings = function(name, value) {
    messaging.tell({
        what: 'userSettings',
        name: name,
        value: value
    });
};

/******************************************************************************/

// TODO: use data-* to declare simple settings

var onUserSettingsReceived = function(details) {
    uDom('#collapse-blocked')
        .prop('checked', details.collapseBlocked === true)
        .on('change', function(){
            changeUserSettings('collapseBlocked', this.checked);
        });

    uDom('#icon-badge')
        .prop('checked', details.showIconBadge === true)
        .on('change', function(){
            changeUserSettings('showIconBadge', this.checked);
        });
};

messaging.ask({ what: 'userSettings' }, onUserSettingsReceived);

/******************************************************************************/

});

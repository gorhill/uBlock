/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2017 The uBlock Origin authors

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

// For background page or non-background pages

'use strict';

/******************************************************************************/
/******************************************************************************/

(function(self) {

// https://bugs.chromium.org/p/project-zero/issues/detail?id=1225&desc=6#c10
if ( !self.vAPI || self.vAPI.uBO !== true ) {
    self.vAPI = { uBO: true };
}

var vAPI = self.vAPI;
var chrome = self.chrome;

/******************************************************************************/

vAPI.setTimeout = vAPI.setTimeout || self.setTimeout.bind(self);

/******************************************************************************/

// http://www.w3.org/International/questions/qa-scripts#directions

var setScriptDirection = function(language) {
    document.body.setAttribute(
        'dir',
        ['ar', 'he', 'fa', 'ps', 'ur'].indexOf(language) !== -1 ? 'rtl' : 'ltr'
    );
};

/******************************************************************************/

vAPI.download = function(details) {
    if ( !details.url ) {
        return;
    }

    var a = document.createElement('a');
    a.href = details.url;
    a.setAttribute('download', details.filename || '');
    a.setAttribute('type', 'text/plain');
    a.dispatchEvent(new MouseEvent('click'));
};

/******************************************************************************/

vAPI.getURL = chrome.runtime.getURL;

/******************************************************************************/

vAPI.i18n = chrome.i18n.getMessage;

setScriptDirection(vAPI.i18n('@@ui_locale'));

/******************************************************************************/

vAPI.closePopup = function() {
    window.open('','_self').close();
};

/******************************************************************************/

// A localStorage-like object which should be accessible from the
// background page or auxiliary pages.
// This storage is optional, but it is nice to have, for a more polished user
// experience.

// This can throw in some contexts (like in devtool).
try {
    vAPI.localStorage = window.localStorage;
} catch (ex) {
}

// https://github.com/gorhill/uBlock/issues/2824
//   Use a dummy localStorage if for some reasons it's not available.
if ( vAPI.localStorage instanceof Object === false ) {
    vAPI.localStorage = {
        length: 0,
        clear: function() {
        },
        getItem: function() {
            return null;
        },
        key: function() {
            throw new RangeError();
        },
        removeItem: function() {
        },
        setItem: function() {
        }
    };
}

/******************************************************************************/

})(this);

/******************************************************************************/

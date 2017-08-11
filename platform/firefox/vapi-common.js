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

/* global sendAsyncMessage */

// For background page or non-background pages

'use strict';

/******************************************************************************/

(function(self) {

/******************************************************************************/

const {Services} = Components.utils.import(
    'resource://gre/modules/Services.jsm',
    null
);

// https://bugs.chromium.org/p/project-zero/issues/detail?id=1225&desc=6#c10
if ( !self.vAPI || self.vAPI.uBO !== true ) {
    self.vAPI = { uBO: true };
}

var vAPI = self.vAPI;

/******************************************************************************/

vAPI.setTimeout = vAPI.setTimeout || function(callback, delay, extra) {
    return setTimeout(function(a) { callback(a); }, delay, extra);
};

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
    a.dispatchEvent(new MouseEvent('click'));
};

/******************************************************************************/

vAPI.getURL = function(path) {
    return 'chrome://' + location.host + '/content/' + path.replace(/^\/+/, '');
};

/******************************************************************************/

vAPI.i18n = (function() {
    var stringBundle = Services.strings.createBundle(
        'chrome://' + location.host + '/locale/messages.properties'
    );

    return function(s) {
        try {
            return stringBundle.GetStringFromName(s);
        } catch (ex) {
            return '';
        }
    };
})();

setScriptDirection(navigator.language);

/******************************************************************************/

vAPI.closePopup = function() {
    sendAsyncMessage(location.host + ':closePopup');
};

/******************************************************************************/

// A localStorage-like object which should be accessible from the
// background page or auxiliary pages.
// This storage is optional, but it is nice to have, for a more polished user
// experience.

vAPI.localStorage = {
    pbName: '',
    pb: null,
    str: Components.classes['@mozilla.org/supports-string;1']
                   .createInstance(Components.interfaces.nsISupportsString),
    init: function(pbName) {
        this.pbName = pbName;
        this.pb = Services.prefs.getBranch(pbName);
    },
    getItem: function(key) {
        try {
            return this.pb.getComplexValue(
                key,
                Components.interfaces.nsISupportsString
            ).data;
        } catch (ex) {
            return null;
        }
    },
    setItem: function(key, value) {
        this.str.data = value;
        this.pb.setComplexValue(
            key,
            Components.interfaces.nsISupportsString,
            this.str
        );
    },
    getBool: function(key) {
        try {
            return this.pb.getBoolPref(key);
        } catch (ex) {
            return null;
        }
    },
    setBool: function(key, value) {
        this.pb.setBoolPref(key, value);
    },
    setDefaultBool: function(key, defaultValue) {
        Services.prefs.getDefaultBranch(this.pbName).setBoolPref(key, defaultValue);
    },
    removeItem: function(key) {
        this.pb.clearUserPref(key);
    },
    clear: function() {
        this.pb.deleteBranch('');
    }
};

vAPI.localStorage.init('extensions.' + location.host + '.');

/******************************************************************************/

})(this);

/******************************************************************************/

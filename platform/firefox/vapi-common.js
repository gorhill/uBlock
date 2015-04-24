/*******************************************************************************

    µBlock - a browser extension to block requests.
    Copyright (C) 2014 The µBlock authors

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

    Home: https://github.com/chrisaljoudi/uBlock
*/

/* global sendAsyncMessage */

// For background page or non-background pages

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

const {Services} = Components.utils.import(
    'resource://gre/modules/Services.jsm',
    null
);

self.vAPI = self.vAPI || {};

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

vAPI.insertHTML = (function() {
    const parser = Components.classes['@mozilla.org/parserutils;1']
        .getService(Components.interfaces.nsIParserUtils);

    return function(node, html) {
        while ( node.firstChild ) {
            node.removeChild(node.firstChild);
        }

        node.appendChild(parser.parseFragment(
            html,
            parser.SanitizerAllowStyle,
            false,
            Services.io.newURI(document.baseURI, null, null),
            document.documentElement
        ));
    };
})();

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
const branchName = 'extensions.' + location.host + '.';
vAPI.localStorage = {
    PB: Services.prefs.getBranch(branchName),
    str: Components.classes['@mozilla.org/supports-string;1']
        .createInstance(Components.interfaces.nsISupportsString),
    getItem: function(key) {
        try {
            return this.PB.getComplexValue(
                key,
                Components.interfaces.nsISupportsString
            ).data;
        } catch (ex) {
            return null;
        }
    },
    setItem: function(key, value) {
        this.str.data = value;
        this.PB.setComplexValue(
            key,
            Components.interfaces.nsISupportsString,
            this.str
        );
    },
    getBool: function(key) {
        try {
            return this.PB.getBoolPref(key);
        } catch (ex) {
            return null;
        }
    },
    setBool: function(key, value) {
        this.PB.setBoolPref(key, value);
    },
    setDefaultBool: function(key, defaultValue) {
        Services.prefs.getDefaultBranch(branchName).setBoolPref(key, defaultValue);
    },
    removeItem: function(key) {
        this.PB.clearUserPref(key);
    },
    clear: function() {
        this.PB.deleteBranch('');
    }
};

/******************************************************************************/

})();

/******************************************************************************/

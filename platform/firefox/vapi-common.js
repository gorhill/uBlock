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

    Home: https://github.com/gorhill/uBlock
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

Object.defineProperty(vAPI, 'localStorage', {
    get: function() {
        if ( this._localStorage ) {
            return this._localStorage;
        }

        this._localStorage = Services.domStorageManager.getLocalStorageForPrincipal(
            Services.scriptSecurityManager.getCodebasePrincipal(
                Services.io.newURI('http://ublock.raymondhill.net/', null, null)
            ),
            ''
        );
        return this._localStorage;
    }
});

/******************************************************************************/

})();

/******************************************************************************/

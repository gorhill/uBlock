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

    if ( 'download' in a ) {
        a.href = details.url;
        a.setAttribute('download', details.filename || '');
        a.dispatchEvent(new MouseEvent('click'));
        return;
    }
    var messager = vAPI.messaging.channel('_download');
    messager.send({
        what: 'gotoURL',
        details: {
            url: details.url,
            index: -1
        }
    });
    messager.close();
};

/******************************************************************************/

vAPI.insertHTML = (function() {
    const {classes: Cc, interfaces: Ci} = Components;
    const parser = Cc['@mozilla.org/parserutils;1'].getService(Ci.nsIParserUtils);
    const io = Cc['@mozilla.org/network/io-service;1'].getService(Ci.nsIIOService);

    return function(node, html) {
        while ( node.firstChild ) {
          node.removeChild(node.firstChild);
        }

        node.appendChild(parser.parseFragment(
            html,
            parser.SanitizerAllowStyle,
            false,
            io.newURI(document.baseURI, null, null),
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
    var stringBundle = Components.classes['@mozilla.org/intl/stringbundle;1']
        .getService(Components.interfaces.nsIStringBundleService)
        .createBundle('chrome://' + location.host + '/locale/messages.properties');

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

})();

/******************************************************************************/

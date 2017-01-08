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

// For background page or non-background pages

'use strict';

/******************************************************************************/

(function() {

var vAPI = self.vAPI = self.vAPI || {};

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

    if ( 'download' in a ) {
        a.href = details.url;
        a.setAttribute('download', details.filename || '');
        a.dispatchEvent(new MouseEvent('click'));
        return;
    }
    var request = {
        what: 'gotoURL',
        details: {
            url: details.url,
            index: -1
        }
    };

    if ( vAPI.isMainProcess ) {
        vAPI.tabs.open(request.details);
        return;
    }

    var messenger = vAPI.messaging.channel('_download');
    messenger.send(request);
    messenger.close();
};

/******************************************************************************/

vAPI.insertHTML = function(node, html) {
    node.innerHTML = html;
};

/******************************************************************************/

vAPI.getURL = function(path) {
    // https://github.com/el1t/uBlock-Safari/issues/4
    // Add extensions to extensionless assets
    if (path.match(/^assets\/thirdparties\/.*\/[^\/.]*$/)) {
        path += '.txt';
    }
    return safari.extension.baseURI + path;
};

/******************************************************************************/

// Supported languages
// First language is the default

vAPI.i18nData = [
    'en', 'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'eo', 'es', 'et', 'eu',
    'fa', 'fi', 'fil', 'fr', 'fy', 'gl', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko',
    'lt', 'lv', 'mr', 'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sk', 'sl', 'sq',
    'sr', 'sv', 'ta', 'te', 'tr', 'uk', 'vi', 'zh-CN', 'zh-TW'
];

// Force uppercase after hyphen
vAPI.i18n = navigator.language.slice(0, 2) + navigator.language.slice(2).toUpperCase();

// Attempt removing hyphen
if ( vAPI.i18nData.indexOf(vAPI.i18n) === -1 ) {
    vAPI.i18n = vAPI.i18n.slice(0, 2);

    // Default to first
    if ( vAPI.i18nData.indexOf(vAPI.i18n) === -1 ) {
        vAPI.i18n = vAPI.i18nData[0];
    }
}

setScriptDirection(vAPI.i18n);

var xhr = new XMLHttpRequest;
xhr.overrideMimeType('application/json;charset=utf-8');
xhr.open('GET', './_locales/' + vAPI.i18n + '.json', false);
xhr.send();
vAPI.i18nData = JSON.parse(xhr.responseText);

vAPI.i18n = function(s) {
    return this.i18nData[s] || '';
};

/******************************************************************************/

vAPI.closePopup = function() {
    var popover = safari.extension.popovers[0];
    if ( popover ) {
        popover.hide();
    }
};

/******************************************************************************/

Number.prototype._toLocaleString = Number.prototype.toLocaleString;
Number.prototype.toLocaleString = function() {
    // some parts expect comma-formatting; Safari doesn't do it automatically
    return this._toLocaleString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

/******************************************************************************/

// A localStorage-like object which should be accessible from the
// background page or auxiliary pages.
// This storage is optional, but it is nice to have, for a more polished user
// experience.

vAPI.localStorage = self.localStorage;

// Disable localStorage.setItem in Private Browsing mode (throws error)
// https://gist.github.com/philfreo/68ea3cd980d72383c951
if (typeof self.localStorage === 'object') {
    try {
        self.localStorage.setItem('localStorage', 1);
        self.localStorage.removeItem('localStorage');
    } catch (e) {
        Storage.prototype._setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function() {};
    }
}

})();

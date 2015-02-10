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

/******************************************************************************/

(function() {

'use strict';

var vAPI = self.vAPI = self.vAPI || {};

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

vAPI.insertHTML = function(node, html) {
    node.innerHTML = html;
};

/******************************************************************************/

vAPI.getURL = function(path) {
    return safari.extension.baseURI + path;
};

/******************************************************************************/

// Supported languages
// First language is the default

vAPI.i18nData = [
    'en', 'ar', 'ca', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fil',
    'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'mr', 'nb', 'nl', 'pl',
    'pt-BR', 'pt-PT', 'ro', 'ru', 'sv', 'tr', 'uk', 'vi', 'zh-CN', 'zh-TW'
];

vAPI.i18n = navigator.language;

if ( vAPI.i18nData.indexOf(vAPI.i18n) === -1 ) {
    vAPI.i18n = vAPI.i18n.slice(0, 2);

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

})();

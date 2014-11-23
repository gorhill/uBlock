/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
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

self.vAPI = self.vAPI || {};

/******************************************************************************/

// http://www.w3.org/International/questions/qa-scripts#directions

var setScriptDirection = function(language) {
    document.body.setAttribute(
        'dir',
        ~['ar', 'he', 'fa', 'ps', 'ur'].indexOf(language) ? 'rtl' : 'ltr'
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

vAPI.getURL = function(path) {
    return safari.extension.baseURI + path;
};

/******************************************************************************/

// supported languages
// first language is the default
vAPI.i18nData = [
    "en", "ar", "cs", "da", "de", "el", "es", "et", "fi", "fr", "he", "hi",
    "hr", "hu", "id", "it", "ja", "mr", "nb", "nl", "pl", "pt_BR", "pt_PT",
    "ro", "ru", "sv", "tr", "uk", "vi", "zh_CN"
];

vAPI.i18n = navigator.language.replace('-', '_');

if (vAPI.i18nData.indexOf(vAPI.i18n) === -1) {
    vAPI.i18n = vAPI.i18n.slice(0, 2);

    if (vAPI.i18nData.indexOf(vAPI.i18n) === -1) {
        vAPI.i18n = vAPI.i18nData[0];
    }
}

setScriptDirection(vAPI.i18n);

var xhr = new XMLHttpRequest;
xhr.overrideMimeType('application/json;charset=utf-8');
xhr.open('GET', './_locales/' + vAPI.i18n + '/messages.json', false);
xhr.send();
vAPI.i18nData = JSON.parse(xhr.responseText);

for (var i18nKey in vAPI.i18nData) {
    vAPI.i18nData[i18nKey] = vAPI.i18nData[i18nKey].message;
}

vAPI.i18n = function(s) {
    return this.i18nData[s] || s;
};

/******************************************************************************/

// update popover size to its content
if (safari.self.identifier === 'popover') {
    var onLoaded = function() {
        // Initial dimensions are set in Info.plist
        var pWidth = safari.self.width;
        var pHeight = safari.self.height;
        var upadteTimer = null;
        var resizePopover = function() {
            if (upadteTimer) {
                return;
            }

            upadteTimer = setTimeout(function() {
                safari.self.width = Math.max(pWidth, document.body.clientWidth);
                safari.self.height = Math.max(pHeight, document.body.clientHeight);
                upadteTimer = null;
            }, 20);
        };

        var mutObs = window.MutationObserver || window.WebkitMutationObserver;

        if (mutObs) {
            (new mutObs(resizePopover)).observe(document, {
                childList: true,
                attributes: true,
                characterData: true,
                subtree: true
            });
        }
        else {
            // Safari doesn't support DOMAttrModified
            document.addEventListener('DOMSubtreeModified', resizePopover);
        }
    };

    window.addEventListener('load', onLoaded);
}

/******************************************************************************/

})();

/******************************************************************************/

// only for background and other extension pages
/* global chrome, Components, BeforeLoadEvent */

(function() {
'use strict';

window.vAPI = window.vAPI || {};

if (window.chrome) {
    var chrome = window.chrome;

    vAPI.getURL = function(path) {
        return chrome.runtime.getURL(path);
    };

    vAPI.i18n = function(s) {
        return chrome.i18n.getMessage(s) || s;
    };
} else if (window.safari) {
    vAPI.getURL = function(path) {
        return safari.extension.baseURI + path;
    };

    var xhr = new XMLHttpRequest;
    xhr.overrideMimeType('application/json;charset=utf-8');
    xhr.open('GET', './locales.json', false);
    xhr.send();
    vAPI.i18nData = JSON.parse(xhr.responseText);

    if (vAPI.i18nData[vAPI.i18n = navigator.language.replace('-', '_')]
        || vAPI.i18nData[vAPI.i18n = vAPI.i18n.slice(0, 2)]) {
        vAPI.i18nAlpha2 = vAPI.i18n;
    } else {
        vAPI.i18nAlpha2 = vAPI.i18nData._;
    }

    xhr = new XMLHttpRequest;
    xhr.overrideMimeType('application/json;charset=utf-8');
    xhr.open('GET', './_locales/' + vAPI.i18nAlpha2 + '/messages.json', false);
    xhr.send();
    vAPI.i18nData = JSON.parse(xhr.responseText);

    for (var i18nKey in vAPI.i18nData) {
        vAPI.i18nData[i18nKey] = vAPI.i18nData[i18nKey].message;
    }

    vAPI.i18n = function(s) {
        return this.i18nData[s] || s;
    };

    // update popover size to its content
    if (safari.self.identifier === 'popover' && safari.self) {
        vAPI.updatePopoverSize = function() {
            safari.self.width = document.body.clientWidth;
            safari.self.height = document.body.clientHeight;
        };

        setTimeout(vAPI.updatePopoverSize, 200);
    }
}

})();
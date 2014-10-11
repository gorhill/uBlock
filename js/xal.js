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

/* global chrome, µBlock */

/******************************************************************************/

µBlock.XAL = (function(){

/******************************************************************************/

var exports = {};
var noopFunc = function(){};

/******************************************************************************/

// Must read: https://code.google.com/p/chromium/issues/detail?id=410868#c8

// https://github.com/gorhill/uBlock/issues/19
// https://github.com/gorhill/uBlock/issues/207
// Since we may be called asynchronously, the tab id may not exist
// anymore, so this ensures it does still exist.

exports.setIcon = function(id, imgDict, overlayStr) {
    var onIconReady = function() {
        if ( chrome.runtime.lastError ) {
            return;
        }
        chrome.browserAction.setBadgeText({ tabId: id, text: overlayStr });
        if ( overlayStr !== '' ) {
            chrome.browserAction.setBadgeBackgroundColor({ tabId: id, color: '#666' });
        }
    };
    chrome.browserAction.setIcon({ tabId: id, path: imgDict }, onIconReady);
};

/******************************************************************************/

exports.injectScript = function(id, details) {
    chrome.tabs.executeScript(id, details);
};

/******************************************************************************/

exports.keyvalSetOne = function(key, val, callback) {
    var bin = {};
    bin[key] = val;
    chrome.storage.local.set(bin, callback || noopFunc);
};

/******************************************************************************/

exports.keyvalSetMany = function(dict, callback) {
    chrome.storage.local.set(dict, callback || noopFunc);
};

/******************************************************************************/

exports.keyvalRemoveAll = function(callback) {
    chrome.storage.local.clear(callback || noopFunc);
};

/******************************************************************************/

exports.restart = function() {
    chrome.runtime.reload();
};

/******************************************************************************/

exports.destroyTab = function(tabId) {
    chrome.tabs.remove(tabId, function() {
        // required by chrome API, or else warnings at console (also, mind jshint)
        if ( chrome.runtime.lastError ) {
        }
    });
};

/******************************************************************************/

return exports;

/******************************************************************************/

})();

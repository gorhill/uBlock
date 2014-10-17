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

// This will inserted as a module in the µBlock object.

µBlock.utils = (function() {

/******************************************************************************/

var exports = {};


/******************************************************************************/

/*exports.gotoExtensionURL = function(url) {

    var hasQuery = function(url) {
        return url.indexOf('?') >= 0;
    };

    var removeQuery = function(url) {
        var pos = url.indexOf('?');
        if ( pos < 0 ) {
            return url;
        }
        return url.slice(0, pos);
    };
    var removeFragment = function(url) {
        var pos = url.indexOf('#');
        if ( pos < 0 ) {
            return url;
        }
        return url.slice(0, pos);
    };

    var tabIndex = 9999;
    var targetUrl = vAPI.getURL(url);

    var currentWindow = function(tabs) {
        var updateProperties = { active: true };
        var i = tabs.length;
        while ( i-- ) {
            if ( removeQuery(tabs[i].url) !== removeQuery(targetUrl) ) {
                continue;
            }
            // If current tab in dashboard is different, force the new one, if
            // there is one, to be activated.
            if ( tabs[i].url !== targetUrl ) {
                updateProperties.url = targetUrl;
            }
            chrome.tabs.update(tabs[i].id, updateProperties);
            return;
        }
        chrome.tabs.create({ 'url': targetUrl, index: tabIndex + 1 });
    };

    var currentTab = function(tabs) {
        if ( tabs.length ) {
            tabIndex = tabs[0].index;
        }
        chrome.tabs.query({ currentWindow: true }, currentWindow);
    };

    // https://github.com/gorhill/httpswitchboard/issues/150
    // Logic:
    // - If URL is already opened in a tab, just activate tab
    // - Otherwise find the current active tab and open in a tab immediately
    //   to the right of the active tab
    chrome.tabs.query({ active: true }, currentTab);
};*/

/******************************************************************************/

exports.formatCount = function(count) {
    if ( typeof count !== 'number' ) {
        return '';
    }
    var s = count.toFixed(0);
    if ( count >= 1000 ) {
        if ( count < 10000 ) {
            s = '>' + s.slice(0,1) + 'K';
        } else if ( count < 100000 ) {
            s = s.slice(0,2) + 'K';
        } else if ( count < 1000000 ) {
            s = s.slice(0,3) + 'K';
        } else if ( count < 10000000 ) {
            s = s.slice(0,1) + 'M';
        } else {
            s = s.slice(0,-6) + 'M';
        }
    }
    return s;
};

// https://www.youtube.com/watch?v=DyvzfyqYm_s

/******************************************************************************/

return exports;

/******************************************************************************/

})();

/******************************************************************************/

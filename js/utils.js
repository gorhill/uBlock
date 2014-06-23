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

var gotoURL = function(details) {
    if ( details.tabId ) {
        chrome.tabs.update(details.tabId, { url: details.url });
    } else {
        chrome.tabs.create({ url: details.url });
    }
};

/******************************************************************************/

var gotoExtensionURL = function(url) {
    var hasFragment = function(url) {
        return url.indexOf('#') >= 0;
    };

    var removeFragment = function(url) {
        var pos = url.indexOf('#');
        if ( pos < 0 ) {
            return url;
        }
        return url.slice(0, pos);
    };

    var tabIndex = 9999;
    var targetUrl = chrome.extension.getURL(url);
    var urlToFind = removeFragment(targetUrl);

    var currentWindow = function(tabs) {
        var updateProperties = { active: true };
        var i = tabs.length;
        while ( i-- ) {
            if ( removeFragment(tabs[i].url) !== urlToFind ) {
                continue;
            }
            // If current tab in dashboard is different, force the new one, if
            // there is one, to be activated.
            if ( tabs[i].url !== targetUrl ) {
                if ( hasFragment(targetUrl) ) {
                    updateProperties.url = targetUrl;
                }
            }
            // Activate found matching tab
            // Commented out as per:
            // https://github.com/gorhill/httpswitchboard/issues/150#issuecomment-32683726
            // chrome.tabs.move(tabs[0].id, { index: index + 1 });
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
};

/******************************************************************************/

return {
    gotoURL: gotoURL,
    gotoExtensionURL: gotoExtensionURL
};

/******************************************************************************/

})();

/******************************************************************************/

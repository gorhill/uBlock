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

/* jshint bitwise: false */
/* global vAPI, uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var messager = vAPI.messaging.channel('stats.js');

/******************************************************************************/

var renderPageSelector = function(targetTabId) {
    var selectedTabId = targetTabId || uDom('#pageSelector').val();
    var onTabReceived = function(tabId, tabTitle) {
        uDom('#pageSelector').append('<option value="' + tabId + '">' + tabTitle);
        if ( tabId.toString() === selectedTabId ) {
            uDom('#pageSelector').val(tabId);
        }
    };
    var onDataReceived = function(pageDetails) {
        uDom('#pageSelector option').remove();
        if ( pageDetails.hasOwnProperty(selectedTabId) === false ) {
            selectedTabId = pageDetails[0];
        }
        for ( var tabId in pageDetails ) {
            if ( pageDetails.hasOwnProperty(tabId) ) {
                onTabReceived(tabId, pageDetails[tabId]);
            }
        }
        selectPage();
    };
    messager.send({ what: 'getPageDetails' }, onDataReceived);
};

/******************************************************************************/

var pageSelectorChanged = function() {
    selectPage();
};

/******************************************************************************/

var selectPage = function() {
    var tabId = uDom('#pageSelector').val() || '';
    var inspector = uDom('#content');
    var currentSrc = inspector.attr('src');
    var targetSrc = 'devtool-log.html?tabId=' + tabId;
    if ( targetSrc !== currentSrc ) {
        inspector.attr('src', targetSrc); 
    }
};

/******************************************************************************/

uDom.onLoad(function() {
    var tabId;

    // Extract the tab id of the page we need to pull the log
    var matches = window.location.search.match(/[\?&]tabId=([^&]+)/);
    if ( matches && matches.length === 2 ) {
        tabId = matches[1];
    }

    renderPageSelector(tabId);

    uDom('#pageSelector').on('change', pageSelectorChanged);
    uDom('#refresh').on('click', function() { renderPageSelector(); } );
});

/******************************************************************************/

})();


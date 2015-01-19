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

var messager = vAPI.messaging.channel('devtools.js');

/******************************************************************************/

var renderPageSelector = function(targetTabId) {
    var selectedTabId = targetTabId || uDom('#pageSelector').val();
    var onDataReceived = function(pageTitles) {
        if ( pageTitles.hasOwnProperty(selectedTabId) === false ) {
            selectedTabId = pageTitles[0];
        }
        var select = uDom('#pageSelector').empty();
        var option;
        for ( var tabId in pageTitles ) {
            if ( pageTitles.hasOwnProperty(tabId) === false ) {
                continue;
            }
            option = uDom('<option>').text(pageTitles[tabId])
                                     .prop('value', tabId);
            if ( tabId === selectedTabId ) {
                option.prop('selected', true);
            }
            select.append(option);
        }
        // This must be done after inserting all option tags, or else Firefox
        // will refuse values which do not exist yet.
        select.prop('value', selectedTabId);
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
    if ( targetSrc === currentSrc ) {
        return;
    }
    inspector.attr('src', targetSrc); 

    // This is useful for when the user force-refresh the page: this will
    // prevent a reset to the original request log.
    // This is also useful for an outside observer to find out which tab is
    // being logged, i.e. the popup menu can initialize itself according to
    // what tab is currently being logged.
    window.history.pushState(
        {},
        '',
        window.location.href.replace(/^(.+[\?&])tabId=([^&]+)(.*)$/, '$1tabId=' + tabId + '$3')
    );
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


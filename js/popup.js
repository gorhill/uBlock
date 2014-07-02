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

/******************************************************************************/
/******************************************************************************/

(function() {

/******************************************************************************/

var stats;

/******************************************************************************/

// https://github.com/gorhill/httpswitchboard/issues/345

messaging.start('popup.js');

/******************************************************************************/

formatNumber = function(count) {
    if ( typeof count !== 'number' ) {
        return '';
    }
    var s = count.toFixed(0);
    if ( count >= 1000 ) {
        if ( count < 10000 ) {
            s = s.slice(0,1) + '.' + s.slice(1,3) + 'K';
        } else if ( count < 100000 ) {
            s = s.slice(0,2) + '.' + s.slice(2,3) + 'K';
        } else if ( count < 1000000 ) {
            s = s.slice(0,3) + 'K';
        } else if ( count < 10000000 ) {
            s = s.slice(0,1) + '.' + s.slice(1,3) + 'M';
        } else if ( count < 100000000 ) {
            s = s.slice(0,2) + '.' + s.slice(2,3) + 'M';
        } else if ( count < 1000000000 ) {
            s = s.slice(0,3) + 'M';
        } else {
            s = s.slice(0,-9) + 'G';
        }
    }
    return s;
};

/******************************************************************************/

var renderStats = function() {
    if ( !stats ) {
        return;
    }

    uDom('#gotoLog').toggleClass(
        'enabled',
        stats.netFilteringSwitch && stats.logBlockedRequests
    );

    var blocked = stats.pageBlockedRequestCount;
    var total = stats.pageAllowedRequestCount + blocked;
    var html = [];
    if ( total === 0 ) {
        html.push('0');
    } else {
        html.push(
            formatNumber(blocked),
            '<span class="dim">&nbsp;or&nbsp;',
            (blocked * 100 / total).toFixed(0),
            '%</span>'
        );
    }
    uDom('#page-blocked').html(html.join(''));

    blocked = stats.globalBlockedRequestCount;
    total = stats.globalAllowedRequestCount + blocked;
    html = [];
    if ( total === 0 ) {
        html.push('0');
    } else {
        html.push(
            formatNumber(blocked),
            '<span class="dim">&nbsp;or&nbsp;',
            (blocked * 100 / total).toFixed(0),
            '%</span>'
        );
    }
    uDom('#total-blocked').html(html.join(''));

    uDom('#switch .fa').toggleClass(
        'off',
        stats.pageURL === '' || !stats.netFilteringSwitch
    );
};

/******************************************************************************/

var onStatsReceived = function(details) {
    stats = details;
    renderStats();
};

/******************************************************************************/

var onTabsReceived = function(tabs) {
    if ( tabs.length === 0 ) {
        return;
    }
    var q = {
        what: 'stats',
        tabId: tabs[0].id
    };
    messaging.ask( q, onStatsReceived );
};

chrome.tabs.query({ active: true }, onTabsReceived);

/******************************************************************************/

var handleNetFilteringSwitch = function() {
    if ( !stats || !stats.pageURL ) {
        return;
    }
    var off = uDom(this).toggleClass('off').hasClassName('off');
    messaging.tell({
        what: 'toggleNetFiltering',
        hostname: stats.pageHostname,
        state: !off,
        tabId: stats.tabId
    });
};

/******************************************************************************/

var gotoDashboard = function() {
    messaging.tell({
        what: 'gotoExtensionURL',
        url: 'dashboard.html'
    });
};

/******************************************************************************/

var gotoStats = function() {
    messaging.tell({
        what: 'gotoExtensionURL',
        url: 'dashboard.html?tab=stats&which=' + stats.tabId
    });
};

/******************************************************************************/

var renderHeader = function() {
    var hdr = uDom('#version');
    hdr.html(hdr.html() + 'v' + chrome.runtime.getManifest().version);
};

/******************************************************************************/

var installEventHandlers = function() {
    uDom('h1,h2,h3,h4').on('click', gotoDashboard);
    uDom('#switch .fa').on('click', handleNetFilteringSwitch);
    uDom('#gotoLog').on('click', gotoStats);
};

/******************************************************************************/

// Make menu only when popup html is fully loaded

uDom.onLoad(function() {
    renderHeader();
    renderStats();
    installEventHandlers();
});

/******************************************************************************/

})();

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
/******************************************************************************/

var stats;

/******************************************************************************/
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

var hasClassName = function(elem, className) {
    var re = new RegExp('(^| )' + className + '( |$)', 'g');
    return re.test(elem.className);
};

var toggleClassName = function(elem, className, newState) {
    var re = new RegExp('(^| )' + className + '( |$)', 'g');
    var currentState = re.test(elem.className);
    if ( newState === undefined ) {
        newState = !currentState;
    }
    if ( newState !== currentState ) {
        if ( newState ) {
            elem.className += ' ' + className;
        } else {
            elem.className = elem.className.replace(re, '').trim();
        }
    }
};

/******************************************************************************/

var renderStats = function() {
    if ( !stats || !document.getElementById('switch') ) {
        return;
    }
    var blocked = stats.pageBlockedRequestCount;
    var total = stats.pageAllowedRequestCount + blocked;
    var elem = document.getElementById('page-blocked');
    if ( total === 0 ) {
        elem.innerHTML = '0';
    } else {
        elem.innerHTML = [
            formatNumber(blocked),
            '<span class="dim">&nbsp;or&nbsp;',
            (blocked * 100 / total).toFixed(0),
            '%</span>'
        ].join('');
    }

    blocked = stats.globalBlockedRequestCount;
    total = stats.globalAllowedRequestCount + blocked;
    elem = document.getElementById('total-blocked');
    if ( total === 0 ) {
        elem.innerHTML = '0';
    } else {
        elem.innerHTML = [
            formatNumber(blocked),
            '<span class="dim">&nbsp;or&nbsp;',
            (blocked * 100 / total).toFixed(0),
            '%</span>'
        ].join('');
    }

    toggleClassName(
        document.querySelector('#switch .fa'),
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
    toggleClassName(this, 'off');
    messaging.tell({
        what: 'toggleNetFiltering',
        hostname: stats.pageHostname,
        state: !hasClassName(this, 'off'),
        tabId: stats.tabId
    });
};

/******************************************************************************/

var renderHeader = function() {
    var hdr = document.getElementById('version');
    hdr.innerHTML = hdr.innerHTML + 'v' + chrome.runtime.getManifest().version;
};


/******************************************************************************/

var installEventHandlers = function() {
    document.querySelector('#switch .fa').addEventListener('click', handleNetFilteringSwitch);
};

/******************************************************************************/

// Make menu only when popup html is fully loaded

window.addEventListener('load', function() {
    renderHeader();
    renderStats();
    installEventHandlers();
});

/******************************************************************************/

})();

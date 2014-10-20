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

/* global vAPI, uDom */
'use strict';

/******************************************************************************/

(function() {

/******************************************************************************/

var stats;
var reResultParser = /^(@@)?(\*|\|\|([^$^]+)\^)\$(.+)$/;

/******************************************************************************/

// https://github.com/gorhill/httpswitchboard/issues/345

var messager = vAPI.messaging.channel('popup.js');


/******************************************************************************/

var formatNumber = function(count) {
    if ( typeof count !== 'number' ) {
        return '';
    }
    return count.toLocaleString();
};

/******************************************************************************/

var syncDynamicFilter = function(scope, i, result) {
    var el = uDom('[data-scope="' + scope + '"] > div:nth-of-type(' + i + ')');
    var matches = reResultParser.exec(result) || [];
    var blocked = matches.length !== 0 && matches[1] !== '@@';
    el.toggleClass('blocked', blocked);

    // https://github.com/gorhill/uBlock/issues/340
    // Use dark shade visual cue if the filter is specific to the page hostname
    // or one of the ancestor hostname.
    var ownFilter = false;
    // There might be no page hostname on pages where uBlock can't be active,
    // like on browser's built-in pages, etc.
    if ( stats.pageHostname ) {
        var filterHostname = matches[3] || '*';
        if ( stats.pageHostname.slice(0 - filterHostname.length) === filterHostname ) {
            ownFilter = (stats.pageHostname.length === filterHostname.length) ||
                        (stats.pageHostname.substr(0 - filterHostname.length - 1, 1) === '.');
        }
    }
    el.toggleClass('ownFilter', ownFilter);
};

/******************************************************************************/

var syncAllDynamicFilters = function() {
    var scopes = ['.', '/'];
    var scope, results, i;
    while ( scope = scopes.pop() ) {
        if ( stats.dynamicFilterResults.hasOwnProperty(scope) === false ) {
            continue;
        }
        results = stats.dynamicFilterResults[scope];
        i = 5;
        while ( i-- ) {
            syncDynamicFilter(scope, i + 1, results[i]);
        }
    }
};

/******************************************************************************/

var renderStats = function(details) {
    if ( details ) {
        stats = details;
    }

    if ( !stats ) {
        return;
    }

    var isHTTP = /^https?:\/\/[0-9a-z]/.test(stats.pageURL);

    // Conditions for request log:
    //   - `http` or `https` scheme
    //   - logging of requests enabled
    uDom('#gotoLog').toggleClass(
        'enabled',
        isHTTP && stats.logRequests
    );

    // Conditions for element picker:
    //   - `http` or `https` scheme
    uDom('#gotoPick').toggleClass(
        'enabled',
        isHTTP
    );

    var or = vAPI.i18n('popupOr');
    var blocked = stats.pageBlockedRequestCount;
    var total = stats.pageAllowedRequestCount + blocked;
    var html = [];
    if ( total === 0 ) {
        html.push('0');
    } else {
        html.push(
            formatNumber(blocked),
            '<span class="dim">&nbsp;',
            or,
            '&nbsp;',
            formatNumber(Math.floor(blocked * 100 / total)),
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
            '<span class="dim">&nbsp;',
            or,
            '&nbsp;',
            formatNumber(Math.floor(blocked * 100 / total)),
            '%</span>'
        );
    }

    syncAllDynamicFilters();

    uDom('#total-blocked').html(html.join(''));
    uDom('#switch .fa').toggleClass('off', stats.pageURL === '' || !stats.netFilteringSwitch);
    uDom('#dynamicFilteringToggler').toggleClass('on', stats.dynamicFilteringEnabled);
};

messager.send( {
    what: 'activeTabStats'
}, renderStats );

/******************************************************************************/

var toggleNetFilteringSwitch = function(ev) {
    if ( !stats || !stats.pageURL ) {
        return;
    }
    var off = uDom(this).toggleClass('off').hasClassName('off');
    messager.send({
        what: 'toggleNetFiltering',
        url: stats.pageURL,
        scope: ev.ctrlKey || ev.metaKey ? 'page' : '',
        state: !off,
        tabId: stats.tabId
    });
};

/******************************************************************************/

var renderHeader = function() {
    var hdr = uDom('#version');
    hdr.nodes[0].previousSibling.textContent = vAPI.app.name;
    hdr.html(hdr.html() + 'v' + vAPI.app.version);
};

/******************************************************************************/

var gotoDashboard = function() {
    messager.send({
        what: 'gotoURL',
        details: {
            url: 'dashboard.html',
            select: true,
            index: -1
        }
    });
};

/******************************************************************************/

var gotoStats = function() {
    messager.send({
        what: 'gotoURL',
        details: {
            url: 'dashboard.html?tab=stats&which=' + stats.tabId,
            select: true,
            index: -1
        }
    });
};

/******************************************************************************/

var gotoPick = function() {
    messager.send({
        what: 'gotoPick',
        tabId: stats.tabId
    });
    window.open('','_self').close();
};

/******************************************************************************/

var gotoLink = function(ev) {
    if (!ev.target.href) {
        return;
    }

    ev.preventDefault();

    messager.send({
        what: 'gotoURL',
        details: {
            url: ev.target.href,
            select: true,
            index: -1
        }
    });
};

/******************************************************************************/

var onDynamicFilterClicked = function(ev) {
    var elScope = uDom(ev.currentTarget);
    var scope = elScope.attr('data-scope') === '/' ? '*' : stats.pageHostname;
    var elFilter = uDom(ev.target);
    var onDynamicFilterChanged = function(details) {
        stats.dynamicFilterResults = details;
        syncAllDynamicFilters();
    };
    messager.send({
        what: 'toggleDynamicFilter',
        hostname: scope,
        requestType: elFilter.attr('data-type'),
        firstParty: elFilter.attr('data-first-party') !== null,
        block: elFilter.hasClassName('blocked') === false,
        pageHostname: stats.pageHostname
    }, onDynamicFilterChanged);

};

/******************************************************************************/

var toggleDynamicFiltering = function(ev) {
    // Discard events destined to child elements.
    if ( ev !== undefined && ev.target !== this ) {
        return;
    }
    var el = uDom('#dynamicFilteringToggler');
    el.toggleClass('on');
    messager.send({
        what: 'userSettings',
        name: 'dynamicFilteringEnabled',
        value: el.hasClassName('on')
    });
};

/******************************************************************************/

var installEventHandlers = function() {
    uDom('h1,h2,h3,h4').on('click', gotoDashboard);
    uDom('#switch .fa').on('click', toggleNetFilteringSwitch);
    uDom('#gotoLog').on('click', gotoStats);
    uDom('#gotoPick').on('click', gotoPick);
    uDom('a[href^=http]').on('click', gotoLink);
    uDom('#dynamicFilteringToggler').on('click', toggleDynamicFiltering);
    uDom('.dynamicFiltering').on('click', 'div', onDynamicFilterClicked);
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

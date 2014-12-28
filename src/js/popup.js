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

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var stats;

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

var syncDynamicFilter = function(scope, des, type, result) {
    var el = uDom('span[data-src="' + scope + '"][data-des="' + des + '"][data-type="' + type + '"]');
    var blocked = result.charAt(1) === 'b';
    el.toggleClass('blocked', blocked);

    // https://github.com/gorhill/uBlock/issues/340
    // Use dark shade visual cue if the filter is specific to the page hostname
    // or one of the ancestor hostname.
    var ownFilter = false;
    var matches = /^d[abn]:([^ ]+)/.exec(result);
    if ( matches !== null ) {
        var thisSrc = scope === 'local' ? stats.pageHostname : '*';
        var otherSrc = matches[1];
        ownFilter = thisSrc.slice(0 - otherSrc.length) === thisSrc;
        if ( ownFilter && thisSrc.length !== otherSrc.length ) {
            var c = thisSrc.substr(0 - otherSrc.length - 1, 1);
            ownFilter = c === '' || c === '.';
        }
    }
    el.toggleClass('ownFilter', ownFilter);
};

/******************************************************************************/

var syncAllDynamicFilters = function() {
    var hasBlock = false;
    var scopes = ['*', 'local'];
    var scope, results, i, result;
    while ( scope = scopes.pop() ) {
        if ( stats.dynamicFilterResults.hasOwnProperty(scope) === false ) {
            continue;
        }
        results = stats.dynamicFilterResults[scope];
        for ( var type in results ) {
            if ( results.hasOwnProperty(type) === false ) {
                continue;
            }
            result = results[type];
            syncDynamicFilter(scope, '*', type, result);
            if ( scope === 'local' && result.charAt(1) === 'b' ) {
                hasBlock = true;
            }
        }
    }
    uDom('body').toggleClass('hasDynamicBlock', hasBlock);
};

/******************************************************************************/

var renderPopup = function(details) {
    if ( details ) {
        stats = details;
    }

    if ( !stats ) {
        return;
    }

    var hdr = uDom('#version');
    hdr.nodes[0].previousSibling.textContent = details.appName;
    hdr.html(hdr.html() + 'v' + details.appVersion);

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
    uDom('body').toggleClass('dynamicFilteringEnabled', stats.dynamicFilteringEnabled);
};

/******************************************************************************/

var toggleNetFilteringSwitch = function(ev) {
    if ( !stats || !stats.pageURL ) {
        return;
    }
    messager.send({
        what: 'toggleNetFiltering',
        url: stats.pageURL,
        scope: ev.ctrlKey || ev.metaKey ? 'page' : '',
        state: !uDom(this).toggleClass('off').hasClass('off'),
        tabId: stats.tabId
    });
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
    // This can happen on pages where uBlock does not work
    if ( typeof stats.pageHostname !== 'string' || stats.pageHostname === '' ) {
        return;
    }
    var elFilter = uDom(ev.target);
    var scope = elFilter.attr('data-src') === '*' ? '*' : stats.pageHostname;
    var onDynamicFilterChanged = function(details) {
        stats.dynamicFilterResults = details;
        syncAllDynamicFilters();
    };
    messager.send({
        what: 'toggleDynamicFilter',
        pageHostname: stats.pageHostname,
        srcHostname: scope,
        desHostname: elFilter.attr('data-des'),
        requestType: elFilter.attr('data-type'),
        block: elFilter.hasClassName('blocked') === false
    }, onDynamicFilterChanged);
};

/******************************************************************************/

var toggleDynamicFiltering = function(ev) {
    var el = uDom('body');
    el.toggleClass('dynamicFilteringEnabled');
    messager.send({
        what: 'userSettings',
        name: 'dynamicFilteringEnabled',
        value: el.hasClassName('dynamicFilteringEnabled')
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
    uDom('#dynamicFilteringContainer').on('click', 'span[data-type]', onDynamicFilterClicked);
};

/******************************************************************************/

// Make menu only when popup html is fully loaded

uDom.onLoad(function() {
    messager.send({ what: 'activeTabStats' }, renderPopup);
    installEventHandlers();
});

/******************************************************************************/

})();

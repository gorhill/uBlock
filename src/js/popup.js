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
var dynaTypes = [
    'image',
    'inline-script',
    '1p-script',
    '3p-script',
    '3p-frame'
];
var popupHeight;
var reIP = /^\d+(?:\.\d+){1,3}$/;
var reSrcHostnameFromResult = /^d[abn]:([^ ]+) ([^ ]+)/;
var touchedDomains = {};
var scopeToSrcHostnameMap = {
    '/': '*',
    '.': ''
};
var threePlus = '+++';
var threeMinus = '\u2012\u2012\u2012';
var sixSpace = '\u2007\u2007\u2007\u2007\u2007\u2007';

/******************************************************************************/

// https://github.com/gorhill/httpswitchboard/issues/345

var messager = vAPI.messaging.channel('popup.js');

/******************************************************************************/

var cachePopupData = function(data) {
    if ( data ) {
        stats = data;
        scopeToSrcHostnameMap['.'] = data.pageHostname || '';
    }
    return data;
};

/******************************************************************************/

var formatNumber = function(count) {
    if ( typeof count !== 'number' ) {
        return '';
    }
    return count.toLocaleString();
};

/******************************************************************************/

var rulekeyCompare = function(a, b) {
    var ha = a.slice(2, a.indexOf(' ', 2));
    if ( !reIP.test(ha) ) {
        ha = ha.split('.').reverse().join('.').replace(reRulekeyCompareNoise, '~');
    }
    var hb = b.slice(2, b.indexOf(' ', 2));
    if ( !reIP.test(hb) ) {
        hb = hb.split('.').reverse().join('.').replace(reRulekeyCompareNoise, '~');
    }
    return ha.localeCompare(hb);
};

var reRulekeyCompareNoise = /[^a-z0-9.]/g;

/******************************************************************************/

var addDynamicFilterRow = function(des) {
    var row = uDom('#templates > div:nth-of-type(1)').clone();
    row.descendants('[data-des]').attr('data-des', des);
    row.descendants('div > span:nth-of-type(1)').text(des);

    var hnDetails = stats.hostnameDict[des] || {};
    var isDomain = des === hnDetails.domain;
    row.toggleClass('isDomain', isDomain);
    if ( hnDetails.allowCount !== 0 ) {
        touchedDomains[hnDetails.domain] = true;
    }

    row.appendTo('#dynamicFilteringContainer');

    // Hacky? I couldn't figure a CSS recipe for this problem.
    // I do not want the left pane -- optional and hidden by defaut -- to
    // dictate the height of the popup. The right pane dictates the height 
    // of the popup, and the left pane will have a scrollbar if ever its 
    // height is larger than what is available.
    if ( popupHeight === undefined ) {
        popupHeight = uDom('body > div:nth-of-type(2)').nodeAt(0).offsetHeight;
        uDom('body > div:nth-of-type(1)').css('height', popupHeight + 'px');
    }
    return row;
};

/******************************************************************************/

var syncDynamicFilter = function(scope, des, type, result) {
    var selector = '#dynamicFilteringContainer span[data-src="' + scope + '"][data-des="' + des + '"][data-type="' + type + '"]';
    var cell = uDom(selector);

    // Create the row?
    if ( cell.length === 0 ) {
        cell = addDynamicFilterRow(des).descendants(selector);
    }

    var blocked = result.charAt(1) === 'b';
    cell.toggleClass('blocked', blocked);

    // Use dark shade visual cue if the filter is specific to the cell.
    var ownFilter = false;
    var matches = reSrcHostnameFromResult.exec(result);
    if ( matches !== null ) {
        ownFilter =  matches[2] === des &&
                     matches[1] === scopeToSrcHostnameMap[scope];
    }
    cell.toggleClass('ownFilter', ownFilter);

    if ( scope !== '.' || type !== '*' ) {
        return;
    }
    if ( stats.hostnameDict.hasOwnProperty(des) === false ) {
        return;
    }
    var hnDetails = stats.hostnameDict[des];
    var aCount = Math.min(Math.ceil(Math.log10(hnDetails.allowCount + 1)), 3);
    var bCount = Math.min(Math.ceil(Math.log10(hnDetails.blockCount + 1)), 3);
    cell.text(
        threePlus.slice(0, aCount) +
        sixSpace.slice(aCount + bCount) +
        threeMinus.slice(0, bCount)
    );
};

/******************************************************************************/

var syncAllDynamicFilters = function() {
    var hasBlock = false;
    var rules = stats.dynamicFilterRules;
    var type, result;
    var types = dynaTypes;
    var i = types.length;
    while ( i-- ) {
        type = types[i];
        syncDynamicFilter('/', '*', type, rules['/ * ' + type] || '');
        result = rules['. * ' + type] || '';
        if ( result.charAt(1) === 'b' ) {
            hasBlock = true;
        }
        syncDynamicFilter('.', '*', type, result);
    }

    // Sort hostnames. First-party hostnames must always appear at the top
    // of the list.
    var keys = Object.keys(rules).sort(rulekeyCompare);
    var key;
    for ( var i = 0; i < keys.length; i++ ) {
        key = keys[i];
        // Specific-type rules -- they were processed above
        if ( key.slice(-1) !== '*' ) {
            continue;
        }
        syncDynamicFilter(key.charAt(0), key.slice(2, key.indexOf(' ', 2)), '*', rules[key]);
    }

    uDom('body').toggleClass('hasDynamicBlock', hasBlock);
    uDom('#privacyInfo > b').text(Object.keys(touchedDomains).length);
};

/******************************************************************************/

var renderPopup = function(details) {
    if ( !cachePopupData(details) ) {
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
    var cell = uDom(ev.target);
    var scope = cell.attr('data-src') === '/' ? '*' : stats.pageHostname;
    var onDynamicFilterChanged = function(details) {
        cachePopupData(details);
        syncAllDynamicFilters();
    };
    messager.send({
        what: 'toggleDynamicFilter',
        tabId: stats.tabId,
        pageHostname: stats.pageHostname,
        srcHostname: scope,
        desHostname: cell.attr('data-des'),
        requestType: cell.attr('data-type'),
        block: cell.hasClass('blocked') === false
    }, onDynamicFilterChanged);
};

/******************************************************************************/

var toggleDynamicFiltering = function(ev) {
    var el = uDom('body');
    el.toggleClass('dynamicFilteringEnabled');
    messager.send({
        what: 'userSettings',
        name: 'dynamicFilteringEnabled',
        value: el.hasClass('dynamicFilteringEnabled')
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

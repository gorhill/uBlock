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

var popupData;
var dfPaneBuilt = false;
var dfTypes = [
    'image',
    'inline-script',
    '1p-script',
    '3p-script',
    '3p-frame'
];
var popupHeight;
var reIP = /^\d+(?:\.\d+){1,3}$/;
var reSrcHostnameFromResult = /^d[abn]:([^ ]+) ([^ ]+)/;
var scopeToSrcHostnameMap = {
    '/': '*',
    '.': ''
};
var threePlus = '+++';
var threeMinus = '−−−';
var sixSpace = '\u2007\u2007\u2007\u2007\u2007\u2007';
var dfHotspots = null;
var hostnameToSortableTokenMap = {};
var allDomains = {};
var allDomainCount = 0;
var touchedDomainCount = 0;

/******************************************************************************/

// https://github.com/gorhill/httpswitchboard/issues/345

var messager = vAPI.messaging.channel('popup.js');

/******************************************************************************/

var cachePopupData = function(data) {
    popupData = {};
    scopeToSrcHostnameMap['.'] = '';
    hostnameToSortableTokenMap = {};

    if ( typeof data !== 'object' ) {
        return popupData;
    } 
    popupData = data;
    scopeToSrcHostnameMap['.'] = popupData.pageHostname || '';
    var hostnameDict = popupData.hostnameDict;
    if ( typeof hostnameDict !== 'object' ) {
        return popupData;
    }
    var domain, prefix;
    for ( var hostname in hostnameDict ) {
        if ( hostnameDict.hasOwnProperty(hostname) === false ) {
            continue;
        }
        domain = hostnameDict[hostname].domain;
        if ( domain === popupData.pageDomain ) {
            domain = '\u0020';
        }
        prefix = hostname.slice(0, 0 - domain.length);
        hostnameToSortableTokenMap[hostname] = domain + prefix.split('.').reverse().join('.');
    }
    return popupData;
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
        ha = hostnameToSortableTokenMap[ha] || '';
    }
    var hb = b.slice(2, b.indexOf(' ', 2));
    if ( !reIP.test(hb) ) {
        hb = hostnameToSortableTokenMap[hb] || '';
    }
    return ha.localeCompare(hb);
};

var reRulekeyCompareNoise = /[^a-z0-9.]/g;

/******************************************************************************/

var addDynamicFilterRow = function(des) {
    var row = uDom('#templates > div:nth-of-type(1)').clone();
    row.descendants('[data-des]').attr('data-des', des);
    row.descendants('span:nth-of-type(1)').text(des);

    var hnDetails = popupData.hostnameDict[des] || {};
    var isDomain = des === hnDetails.domain;
    row.toggleClass('isDomain', isDomain);
    if ( allDomains.hasOwnProperty(hnDetails.domain) === false ) {
        allDomains[hnDetails.domain] = false;
        allDomainCount += 1;
    }
    if ( hnDetails.allowCount !== 0 ) {
        if ( allDomains[hnDetails.domain] === false ) {
            allDomains[hnDetails.domain] = true;
            touchedDomainCount += 1;
        }
        row.addClass('allowed');
    }
    if ( hnDetails.blockCount !== 0 ) {
        row.addClass('blocked');
    }

    row.appendTo('#dynamicFilteringContainer');

    // Hacky? I couldn't figure a CSS recipe for this problem.
    // I do not want the left pane -- optional and hidden by defaut -- to
    // dictate the height of the popup. The right pane dictates the height 
    // of the popup, and the left pane will have a scrollbar if ever its 
    // height is larger than what is available.
    if ( popupHeight === undefined ) {
        popupHeight = uDom('#panes > div:nth-of-type(1)').nodeAt(0).offsetHeight;
        uDom('#panes > div:nth-of-type(2)').css('height', popupHeight + 'px');
    }
    return row;
};

/******************************************************************************/

var syncDynamicFilterCell = function(scope, des, type, result) {
    var selector = '#dynamicFilteringContainer span[data-src="' + scope + '"][data-des="' + des + '"][data-type="' + type + '"]';
    var cell = uDom(selector);

    // Create the row?
    if ( cell.length === 0 ) {
        cell = addDynamicFilterRow(des).descendants(selector);
    }

    cell.removeClass();
    var action = result.charAt(1);
    if ( action !== '' ) {
        cell.toggleClass(action + 'Rule', true);
    }

    // Use dark shade visual cue if the filter is specific to the cell.
    var ownRule = false;
    var matches = reSrcHostnameFromResult.exec(result);
    if ( matches !== null ) {
        ownRule =  matches[2] === des &&
                   matches[1] === scopeToSrcHostnameMap[scope];
    }
    cell.toggleClass('ownRule', ownRule);

    if ( scope !== '.' || type !== '*' ) {
        return;
    }
    if ( popupData.hostnameDict.hasOwnProperty(des) === false ) {
        return;
    }
    var hnDetails = popupData.hostnameDict[des];
    var aCount = hnDetails.allowCount;
    var bCount = hnDetails.blockCount;
    if ( aCount === 0 && bCount === 0 ) {
        return;
    }
    aCount = Math.min(Math.ceil(Math.log10(aCount + 1)), 3);
    bCount = Math.min(Math.ceil(Math.log10(bCount + 1)), 3);
    // IMPORTANT: It is completely assumed the first node is a TEXT_NODE, so
    //            ensure this in the HTML file counterpart when you make
    //            changes
    cell.nodeAt(0).firstChild.nodeValue = threePlus.slice(0, aCount) +
                                          sixSpace.slice(aCount + bCount) +
                                          threeMinus.slice(0, bCount);
};

/******************************************************************************/

var syncAllDynamicFilters = function() {
    var hasRule = false;
    var rules = popupData.dynamicFilterRules;
    var type, result;
    var types = dfTypes;
    var i = types.length;
    while ( i-- ) {
        type = types[i];
        syncDynamicFilterCell('/', '*', type, rules['/ * ' + type] || '');
        result = rules['. * ' + type] || '';
        if ( result.charAt(1) !== '' ) {
            hasRule = true;
        }
        syncDynamicFilterCell('.', '*', type, result);
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
        syncDynamicFilterCell(key.charAt(0), key.slice(2, key.indexOf(' ', 2)), '*', rules[key]);
    }

    var summary = vAPI.i18n('popupHitDomainCountPrompt')
                      .replace('{{count}}', touchedDomainCount.toLocaleString())
                      .replace('{{total}}', allDomainCount.toLocaleString());
    uDom('#privacyInfo').text(summary);

    if ( dfPaneBuilt !== true ) {
        uDom('#dynamicFilteringContainer')
            .on('click', 'span[data-src]', unsetDynamicFilterHandler)
            .on('mouseenter', '[data-src]', mouseenterCellHandler)
            .on('mouseleave', '[data-src]', mouseleaveCellHandler);
        dfHotspots = uDom('#actionSelector')
            .on('click', 'span', setDynamicFilterHandler)
            .detach();
        dfPaneBuilt = true;
    }
};

/******************************************************************************/

var renderPopup = function() {
    uDom('#appname').text(popupData.appName);
    uDom('#version').text(popupData.appVersion);

    var isHTTP = /^https?:\/\/[0-9a-z]/.test(popupData.pageURL);

    // Condition for dynamic filtering toggler:
    // - Advanced user
    uDom('body').toggleClass('advancedUser', popupData.advancedUserEnabled);

    // Conditions for request log:
    // - `http` or `https` scheme
    uDom('#gotoLog').toggleClass('enabled', isHTTP);

    // Conditions for element picker:
    // - `http` or `https` scheme
    uDom('#gotoPick').toggleClass('enabled', isHTTP);

    var or = vAPI.i18n('popupOr');
    var blocked = popupData.pageBlockedRequestCount;
    var total = popupData.pageAllowedRequestCount + blocked;
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

    blocked = popupData.globalBlockedRequestCount;
    total = popupData.globalAllowedRequestCount + blocked;
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
    uDom('#total-blocked').html(html.join(''));

    // Build dynamic filtering pane only if in use
    if ( popupData.dfEnabled && popupData.advancedUserEnabled ) {
        syncAllDynamicFilters();
    }

    uDom('#switch .fa').toggleClass('off', popupData.pageURL === '' || !popupData.netFilteringSwitch);
    uDom('#panes').toggleClass('dfEnabled', popupData.dfEnabled && popupData.advancedUserEnabled);
};

/******************************************************************************/

var toggleNetFilteringSwitch = function(ev) {
    if ( !popupData || !popupData.pageURL ) {
        return;
    }
    messager.send({
        what: 'toggleNetFiltering',
        url: popupData.pageURL,
        scope: ev.ctrlKey || ev.metaKey ? 'page' : '',
        state: !uDom(this).toggleClass('off').hasClass('off'),
        tabId: popupData.tabId
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

var gotoDevTools = function() {
    messager.send({
        what: 'gotoURL',
        details: {
            url: 'devtools.html?tabId=' + popupData.tabId,
            select: true,
            index: -1
        }
    });
};

/******************************************************************************/

var gotoPick = function() {
    messager.send({
        what: 'gotoPick',
        tabId: popupData.tabId
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

var toggleDynamicFiltering = function(ev) {
    if ( uDom('body').hasClass('advancedUser') === false ) {
        return;
    }
    var el = uDom('#panes');
    popupData.dfEnabled = !popupData.dfEnabled;
    messager.send({
        what: 'userSettings',
        name: 'dynamicFilteringEnabled',
        value: popupData.dfEnabled
    }, renderPopup);
};

/******************************************************************************/

var mouseenterCellHandler = function() {
    if ( uDom(this).hasClass('ownRule') === false ) {
        dfHotspots.appendTo(this);
    }
};

var mouseleaveCellHandler = function() {
    dfHotspots.detach();
};

/******************************************************************************/

var setDynamicFilter = function(src, des, type, action) {
    // This can happen on pages where uBlock does not work
    if ( typeof popupData.pageHostname !== 'string' || popupData.pageHostname === '' ) {
        return;
    }
    var onDynamicFilterChanged = function(response) {
        cachePopupData(response);
        syncAllDynamicFilters();
    };
    messager.send({
        what: 'toggleDynamicFilter',
        tabId: popupData.tabId,
        pageHostname: popupData.pageHostname,
        srcHostname: src,
        desHostname: des,
        requestType: type,
        action: action
    }, onDynamicFilterChanged);
};

/******************************************************************************/

var unsetDynamicFilterHandler = function() {
    var cell = uDom(this);
    setDynamicFilter(
        cell.attr('data-src') === '/' ? '*' : popupData.pageHostname,
        cell.attr('data-des'),
        cell.attr('data-type'),
        0
    );
    dfHotspots.appendTo(cell);
};

/******************************************************************************/

var setDynamicFilterHandler = function() {
    var hotspot = uDom(this);
    var cell = hotspot.ancestors('[data-src]');
    if ( cell.length === 0 ) {
        return;
    }
    var action = 0;
    var hotspotId = hotspot.attr('id');
    if ( hotspotId === 'dynaAllow' ) {
        action = 2;
    } else if ( hotspotId === 'dynaNoop' ) {
        action = 3
    } else {
        action = 1;
    }
    setDynamicFilter(
        cell.attr('data-src') === '/' ? '*' : popupData.pageHostname,
        cell.attr('data-des'),
        cell.attr('data-type'),
        action
    );
    dfHotspots.detach();
};

/******************************************************************************/

// Make menu only when popup html is fully loaded

uDom.onLoad(function() {
    messager.send({ what: 'activeTabStats' }, function(response) {
        if ( !cachePopupData(response) ) {
            return;
        }
        renderPopup();
    });
    uDom('h1,h2,h3,h4').on('click', gotoDashboard);
    uDom('#switch .fa').on('click', toggleNetFilteringSwitch);
    uDom('#gotoLog').on('click', gotoDevTools);
    uDom('#gotoPick').on('click', gotoPick);
    uDom('a[href^=http]').on('click', gotoLink);
    uDom('#dfToggler').on('click', toggleDynamicFiltering);
});

/******************************************************************************/

})();

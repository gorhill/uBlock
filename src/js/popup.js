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
var popupHeight;
var reIP = /^\d+(?:\.\d+){1,3}$/;
var reSrcHostnameFromRule = /^d[abn]:([^ ]+) ([^ ]+) ([^ ]+)/;
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
var allHostnameRows = [];
var touchedDomainCount = 0;
var rowsToRecycle = uDom();
var cachedPopupHash = '';
var orStr = vAPI.i18n('popupOr');
var domainsHitStr = vAPI.i18n('popupHitDomainCount');

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

var hashFromPopupData = function(reset) {
    // It makes no sense to offer to refresh the behind-the-scene scope
    if ( popupData.pageHostname === 'behind-the-scene' ) {
        uDom('body').toggleClass('dirty', false);
        return;
    }

    var hasher = [];
    var rules = popupData.firewallRules;
    var rule;
    for ( var key in rules ) {
        if ( rules.hasOwnProperty(key) === false ) {
            continue;
        }
        rule = rules[key];
        if ( rule !== '' ) {
            hasher.push(rule);
        }
    }
    hasher.push(uDom('body').hasClass('off'));

    var hash = hasher.sort().join('');
    if ( reset ) {
        cachedPopupHash = hash;
    }
    uDom('body').toggleClass('dirty', hash !== cachedPopupHash);
};

/******************************************************************************/

var formatNumber = function(count) {
    return typeof count === 'number' ? count.toLocaleString() : '';
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

/******************************************************************************/

var addFirewallRow = function(des) {
    var row = rowsToRecycle.pop();
    if ( row.length === 0 ) {
        row = uDom('#templates > div:nth-of-type(1)').clone();
    }

    row.descendants('[data-des]').attr('data-des', des);
    row.descendants('span:nth-of-type(1)').text(punycode.toUnicode(des));

    var hnDetails = popupData.hostnameDict[des] || {};

    row.toggleClass('isDomain', des === hnDetails.domain);
    row.toggleClass('allowed', hnDetails.allowCount !== 0);
    row.toggleClass('blocked', hnDetails.blockCount !== 0);
    row.appendTo('#firewallContainer');

    // Hacky? I couldn't figure a CSS recipe for this problem.
    // I do not want the left pane -- optional and hidden by defaut -- to
    // dictate the height of the popup. The right pane dictates the height
    // of the popup, and the left pane will have a scrollbar if ever its
    // height is larger than what is available.
    if ( popupHeight === undefined ) {
        popupHeight = uDom('#panes > div:nth-of-type(1)').nodeAt(0).offsetHeight;
        uDom('#panes > div:nth-of-type(2)').css('height', popupHeight + 'px');

        // The padlock must be manually positioned:
        // - It's vertical position depends on the height on the title bar.
        var rect = document.getElementById('gotoPrefs').getBoundingClientRect();
        document.getElementById('saveRules').style.setProperty('top', (rect.bottom + 4) + 'px');
    }
    return row;
};

/******************************************************************************/

var updateFirewallCell = function(scope, des, type, rule) {
    var selector = '#firewallContainer span[data-src="' + scope + '"][data-des="' + des + '"][data-type="' + type + '"]';
    var cell = uDom(selector);

    // This should not happen
    if ( cell.length === 0 ) {
        return;
    }

    cell.removeClass();
    var action = rule.charAt(1);
    if ( action !== '' ) {
        cell.toggleClass(action + 'Rule', true);
    }

    // Use dark shade visual cue if the filter is specific to the cell.
    var ownRule = false;
    var matches = reSrcHostnameFromRule.exec(rule);
    if ( matches !== null ) {
        ownRule = (matches[2] !== '*' || matches[3] === type) &&
                  (matches[2] === des) &&
                  (matches[1] === scopeToSrcHostnameMap[scope]);
    }
    cell.toggleClass('ownRule', ownRule);

    if ( scope !== '.' || des === '*' ) {
        return;
    }

    // IMPORTANT: It is completely assumed the first node is a TEXT_NODE, so
    //            ensure this in the HTML file counterpart when you make
    //            changes
    var textNode = cell.nodeAt(0).firstChild;

    // Remember this may be a cell from a reused row, we need to clear text
    // content if we can't compute request counts.
    if ( popupData.hostnameDict.hasOwnProperty(des) === false ) {
        textNode.nodeValue = ' ';
        return;
    }

    var hnDetails = popupData.hostnameDict[des];
    var aCount = hnDetails.allowCount;
    var bCount = hnDetails.blockCount;
    if ( aCount === 0 && bCount === 0 ) {
        textNode.nodeValue = ' ';
        return;
    }

    // https://github.com/gorhill/uBlock/issues/471
    aCount = Math.min(Math.ceil(Math.log(aCount + 1) / Math.LN10), 3);
    bCount = Math.min(Math.ceil(Math.log(bCount + 1) / Math.LN10), 3);
    textNode.nodeValue = threePlus.slice(0, aCount) +
                         sixSpace.slice(aCount + bCount) +
                         threeMinus.slice(0, bCount);
};

/******************************************************************************/

var updateAllFirewallCells = function() {
    var rules = popupData.firewallRules;
    for ( var key in rules ) {
        if ( rules.hasOwnProperty(key) === false ) {
            continue;
        }
        updateFirewallCell(
            key.charAt(0),
            key.slice(2, key.indexOf(' ', 2)),
            key.slice(key.lastIndexOf(' ') + 1),
            rules[key]
        );
    }

    uDom('#firewallContainer').toggleClass(
        'dirty',
        popupData.matrixIsDirty === true
    );
};

/******************************************************************************/

var buildAllFirewallRows = function() {
    // Do this before removing the rows
    if ( dfHotspots === null ) {
        dfHotspots = uDom('#actionSelector').on('click', 'span', setFirewallRuleHandler);
    }
    dfHotspots.detach();

    // Remove and reuse all rows: the order may have changed, we can't just
    // reuse them in-place.
    rowsToRecycle = uDom('#firewallContainer > div:nth-of-type(7) ~ div').detach();

    var n = allHostnameRows.length;
    for ( var i = 0; i < n; i++ ) {
        addFirewallRow(allHostnameRows[i]);
    }

    if ( dfPaneBuilt !== true ) {
        uDom('#firewallContainer')
            .on('click', 'span[data-src]', unsetFirewallRuleHandler)
            .on('mouseenter', '[data-src]', mouseenterCellHandler)
            .on('mouseleave', '[data-src]', mouseleaveCellHandler);
        dfPaneBuilt = true;
    }

    // The padlock must be manually positioned:
    // - Its horizontal position depends on whether there is a vertical
    //   scrollbar.
    var rect = document.getElementById('firewallContainer').getBoundingClientRect();
    document.getElementById('saveRules').style.setProperty('left', (rect.left + 4) + 'px');

    updateAllFirewallCells();
};

/******************************************************************************/

var renderPrivacyExposure = function() {
    allDomains = {};
    allDomainCount = touchedDomainCount = 0;
    allHostnameRows = [];

    // Sort hostnames. First-party hostnames must always appear at the top
    // of the list.
    var desHostnameDone = {};
    var keys = Object.keys(popupData.firewallRules)
                     .sort(rulekeyCompare);
    var key, des, hnDetails;
    for ( var i = 0; i < keys.length; i++ ) {
        key = keys[i];
        des = key.slice(2, key.indexOf(' ', 2));
        // Specific-type rules -- these are built-in
        if ( des === '*' || desHostnameDone.hasOwnProperty(des) ) {
            continue;
        }
        hnDetails = popupData.hostnameDict[des] || {};
        if ( allDomains.hasOwnProperty(hnDetails.domain) === false ) {
            allDomains[hnDetails.domain] = false;
            allDomainCount += 1;
        }
        if ( hnDetails.allowCount !== 0 ) {
            if ( allDomains[hnDetails.domain] === false ) {
                allDomains[hnDetails.domain] = true;
                touchedDomainCount += 1;
            }
        }
        allHostnameRows.push(des);
        desHostnameDone[des] = true;
    }

    // The root page domain must always be counted as connected: that's from 
    // where the root document was fetched.
    // https://github.com/gorhill/uBlock/issues/759
    // The root page domain must be counted if and only if it was actually
    // obtained through a network request.
    if ( allDomainCount !== 0 && allDomains[popupData.pageDomain] !== true ) {
        allDomains[popupData.pageDomain] = true;
        touchedDomainCount += 1;
    }

    var summary = domainsHitStr.replace('{{count}}', touchedDomainCount.toLocaleString())
                               .replace('{{total}}', allDomainCount.toLocaleString());
    uDom('#popupHitDomainCount').text(summary);
};

/******************************************************************************/

// Assume everything has to be done incrementally.

var renderPopup = function() {
    uDom('#appname').text(popupData.appName);
    uDom('#version').text(popupData.appVersion);
    uDom('body').toggleClass('advancedUser', popupData.advancedUserEnabled);

    uDom('body').toggleClass(
        'off',
        (popupData.pageURL === '') ||
        (!popupData.netFilteringSwitch) ||
        (popupData.pageHostname === 'behind-the-scene' && !popupData.advancedUserEnabled)
    );

    // If you think the `=== true` is pointless, you are mistaken
    uDom('#gotoLog').toggleClass('enabled', popupData.canRequestLog === true)
                    .attr('href', 'devtools.html?tabId=' + popupData.tabId);
    uDom('#gotoPick').toggleClass('enabled', popupData.canElementPicker === true);

    var blocked = popupData.pageBlockedRequestCount;
    var total = popupData.pageAllowedRequestCount + blocked;
    var text = [];
    if ( total === 0 ) {
        text.push(formatNumber(0));
    } else {
        text.push(
            formatNumber(blocked),
            '\u00a0', orStr, '\u00a0',
            formatNumber(Math.floor(blocked * 100 / total)), '%'
        );
    }
    uDom('#page-blocked').text(text.join(''));

    blocked = popupData.globalBlockedRequestCount;
    total = popupData.globalAllowedRequestCount + blocked;
    text = [];
    if ( total === 0 ) {
        text.push(formatNumber(0));
    } else {
        text.push(
            formatNumber(blocked),
            '\u00a0', orStr, '\u00a0',
            formatNumber(Math.floor(blocked * 100 / total)), '%'
        );
    }
    uDom('#total-blocked').text(text.join(''));

    // This will collate all domains, touched or not
    renderPrivacyExposure();

    // https://github.com/gorhill/uBlock/issues/470
    // This must be done here, to be sure the popup is resized properly
    var dfPaneVisible = popupData.dfEnabled && popupData.advancedUserEnabled;

    uDom('#panes').toggleClass('dfEnabled', dfPaneVisible);

    // Build dynamic filtering pane only if in use
    if ( dfPaneVisible ) {
        buildAllFirewallRows();
    }
};

/******************************************************************************/

var toggleNetFilteringSwitch = function(ev) {
    if ( !popupData || !popupData.pageURL ) {
        return;
    }
    if ( popupData.pageHostname === 'behind-the-scene' && !popupData.advancedUserEnabled ) {
        return;
    }
    messager.send({
        what: 'toggleNetFiltering',
        url: popupData.pageURL,
        scope: ev.ctrlKey || ev.metaKey ? 'page' : '',
        state: !uDom('body').toggleClass('off').hasClass('off'),
        tabId: popupData.tabId
    });

    hashFromPopupData();
};

/******************************************************************************/

var gotoPick = function() {
    messager.send({
        what: 'gotoPick',
        tabId: popupData.tabId
    });

    vAPI.closePopup();
};

/******************************************************************************/

var gotoURL = function(ev) {
    if ( this.hasAttribute('href') === false) {
        return;
    }

    ev.preventDefault();

    messager.send({
        what: 'gotoURL',
        details: {
            url: this.getAttribute('href'),
            select: true,
            index: -1
        }
    });

    vAPI.closePopup();
};

/******************************************************************************/

var toggleFirewallPane = function() {
    if ( popupData.advancedUserEnabled === false ) {
        return;
    }
    popupData.dfEnabled = !popupData.dfEnabled;

    messager.send({
        what: 'userSettings',
        name: 'dynamicFilteringEnabled',
        value: popupData.dfEnabled
    });

    // Dynamic filtering pane may not have been built yet
    uDom('#panes').toggleClass('dfEnabled', popupData.dfEnabled);
    if ( popupData.dfEnabled && dfPaneBuilt === false ) {
        buildAllFirewallRows();
    }
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

var setFirewallRule = function(src, des, type, action, persist) {
    // This can happen on pages where uBlock does not work
    if ( typeof popupData.pageHostname !== 'string' || popupData.pageHostname === '' ) {
        return;
    }
    var onFirewallRuleChanged = function(response) {
        cachePopupData(response);
        updateAllFirewallCells();
        hashFromPopupData();
    };
    messager.send({
        what: 'toggleFirewallRule',
        tabId: popupData.tabId,
        pageHostname: popupData.pageHostname,
        srcHostname: src,
        desHostname: des,
        requestType: type,
        action: action,
        persist: persist
    }, onFirewallRuleChanged);
};

/******************************************************************************/

var unsetFirewallRuleHandler = function(ev) {
    var cell = uDom(this);
    setFirewallRule(
        cell.attr('data-src') === '/' ? '*' : popupData.pageHostname,
        cell.attr('data-des'),
        cell.attr('data-type'),
        0,
        ev.ctrlKey || ev.metaKey
    );
    dfHotspots.appendTo(cell);
};

/******************************************************************************/

var setFirewallRuleHandler = function(ev) {
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
        action = 3;
    } else {
        action = 1;
    }
    setFirewallRule(
        cell.attr('data-src') === '/' ? '*' : popupData.pageHostname,
        cell.attr('data-des'),
        cell.attr('data-type'),
        action,
        ev.ctrlKey || ev.metaKey
    );
    dfHotspots.detach();
};

/******************************************************************************/

var reloadTab = function() {
    messager.send({ what: 'reloadTab', tabId: popupData.tabId });

    // Polling will take care of refreshing the popup content

    // https://github.com/gorhill/uBlock/issues/748
    // User forces a reload, assume the popup has to be updated regardless if
    // there were changes or not.
    popupData.contentLastModified = -1;

    // No need to wait to remove this.
    uDom('body').toggleClass('dirty', false);
};

/******************************************************************************/

var saveFirewallRules = function() {
    messager.send({
        what: 'saveFirewallRules',
        srcHostname: popupData.pageHostname,
        desHostnames: popupData.hostnameDict
    });
    uDom('#firewallContainer').removeClass('dirty');
};

/******************************************************************************/

// Poll for changes.
//
// I couldn't find a better way to be notified of changes which can affect
// popup content, as the messaging API doesn't support firing events accurately
// from the main extension process to a specific auxiliary extension process:
//
// - broadcasting() is not an option given there could be a lot of tabs opened,
//   and maybe even many frames within these tabs, i.e. unacceptable overhead
//   regardless of whether the popup is opened or not.
//
// - Modifying the messaging API is not an option, as this would require
//   revisiting all platform-specific code to support targeted broadcasting,
//   which who knows could be not so trivial for some platforms.
//
// A well done polling is a better anyways IMO, I prefer that data is pulled
// on demand rather than forcing the main process to assume a client may need
// it and thus having to push it all the time unconditionally.

var pollForContentChange = (function() {
    var pollTimer = null;

    var pollCallback = function() {
        pollTimer = null;
        messager.send(
            {
                what: 'hasPopupContentChanged',
                tabId: popupData.tabId,
                contentLastModified: popupData.contentLastModified
            },
            queryCallback
        );
    };

    var queryCallback = function(response) {
        if ( response ) {
            getPopupData();
            return;
        }
        poll();
    };

    var poll = function() {
        if ( pollTimer !== null ) {
            return;
        }
        pollTimer = setTimeout(pollCallback, 1500);
    };

    return poll;
})();

/******************************************************************************/

var getPopupData = function() {
    var onDataReceived = function(response) {
        cachePopupData(response);
        renderPopup();
        hashFromPopupData(true);
        pollForContentChange();
    };
    messager.send({ what: 'getPopupData' }, onDataReceived);
};

/******************************************************************************/

// Make menu only when popup html is fully loaded

uDom.onLoad(function() {
    getPopupData();
    uDom('#switch').on('click', toggleNetFilteringSwitch);
    uDom('#gotoPick').on('click', gotoPick);
    uDom('a[href]').on('click', gotoURL);
    uDom('h2').on('click', toggleFirewallPane);
    uDom('#refresh').on('click', reloadTab);
    uDom('#saveRules').on('click', saveFirewallRules);
});

/******************************************************************************/

})();

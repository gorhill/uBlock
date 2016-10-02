/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 Raymond Hill

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

/* global punycode, uDom */

'use strict';

/******************************************************************************/

(function() {

/******************************************************************************/

// Ensure the popup is properly sized as soon as possible. It is assume the DOM
// content is ready at this point, which should be the case given where this
// script file is included in the HTML file.

var dfPaneVisibleStored = vAPI.localStorage.getItem('popupFirewallPane') === 'true';

// Hacky? I couldn't figure a CSS recipe for this problem.
// I do not want the left pane -- optional and hidden by defaut -- to
// dictate the height of the popup. The right pane dictates the height
// of the popup, and the left pane will have a scrollbar if ever its
// height is more than what is available.
(function() {
    // No restriction on vertical size?
    if ( /[\?&]fullsize=1/.test(window.location.search) ) {
        document.body.classList.add('fullsize');
        return;
    }

    var rpane = document.querySelector('#panes > div:nth-of-type(1)');
    if ( typeof rpane.offsetHeight === 'number' ) {
        document.querySelector('#panes > div:nth-of-type(2)').style.setProperty(
            'height',
            rpane.offsetHeight + 'px'
        );
    }
})();

// The padlock/eraser must be manually positioned:
// - Its vertical position depends on the height of the popup title bar
// - Its horizontal position depends on whether there is a vertical scrollbar.
document.getElementById('rulesetTools').style.setProperty(
    'top',
    (document.getElementById('gotoPrefs').getBoundingClientRect().bottom + 3) + 'px'
);

var positionRulesetTools = function() {
    document.getElementById('rulesetTools').style.setProperty(
        'left',
        (document.getElementById('firewallContainer').getBoundingClientRect().left + 3) + 'px'
    );
};

// https://github.com/chrisaljoudi/uBlock/issues/996
// Experimental: mitigate glitchy popup UI: immediately set the firewall pane
// visibility to its last known state. By default the pane is hidden.
// Will remove if it makes no difference.
if ( dfPaneVisibleStored ) {
    document.getElementById('panes').classList.add('dfEnabled');
}

/******************************************************************************/

var messaging = vAPI.messaging;
var popupData = {};
var dfPaneBuilt = false;
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
var statsStr = vAPI.i18n('popupBlockedStats');
var domainsHitStr = vAPI.i18n('popupHitDomainCount');
var reNetworkRelatedURL = /^(?:ftps?|https?|wss?):\/\//;

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
        prefix = hostname.slice(0, 0 - domain.length);
        // Prefix with space char for 1st-party hostnames: this ensure these
        // will come first in list.
        if ( domain === popupData.pageDomain ) {
            domain = '\u0020';
        }
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
    hasher.sort();
    hasher.push(uDom('body').hasClass('off'));
    hasher.push(uDom.nodeFromId('no-large-media').classList.contains('on'));
    hasher.push(uDom.nodeFromId('no-cosmetic-filtering').classList.contains('on'));
    hasher.push(uDom.nodeFromId('no-remote-fonts').classList.contains('on'));

    var hash = hasher.join('');
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
        ha = hostnameToSortableTokenMap[ha] || ' ';
    }
    var hb = b.slice(2, b.indexOf(' ', 2));
    if ( !reIP.test(hb) ) {
        hb = hostnameToSortableTokenMap[hb] || ' ';
    }
    var ca = ha.charCodeAt(0),
        cb = hb.charCodeAt(0);
    if ( ca !== cb ) {
        return ca - cb;
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
    var isDomain = des === hnDetails.domain;
    row.toggleClass('isDomain', isDomain)
       .toggleClass('isSubDomain', !isDomain)
       .toggleClass('allowed', hnDetails.allowCount !== 0)
       .toggleClass('blocked', hnDetails.blockCount !== 0)
       .toggleClass('totalAllowed', hnDetails.totalAllowCount !== 0)
       .toggleClass('totalBlocked', hnDetails.totalBlockCount !== 0);

    row.appendTo('#firewallContainer');

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

    // Use dark shade visual cue if the rule is specific to the cell.
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
    if ( aCount !== 0 || bCount !== 0 ) {
        // https://github.com/chrisaljoudi/uBlock/issues/471
        aCount = Math.min(Math.ceil(Math.log(aCount + 1) / Math.LN10), 3);
        bCount = Math.min(Math.ceil(Math.log(bCount + 1) / Math.LN10), 3);
        textNode.nodeValue = threePlus.slice(0, aCount) +
                             sixSpace.slice(aCount + bCount) +
                             threeMinus.slice(0, bCount);
    } else {
        textNode.nodeValue = ' ';
    }

    if ( hnDetails.domain !== des ) {
        return;
    }

    textNode = cell.nodeAt(1).firstChild;
    aCount = hnDetails.totalAllowCount;
    bCount = hnDetails.totalBlockCount;
    if ( aCount !== 0 || bCount !== 0 ) {
        // https://github.com/chrisaljoudi/uBlock/issues/471
        aCount = Math.min(Math.ceil(Math.log(aCount + 1) / Math.LN10), 3);
        bCount = Math.min(Math.ceil(Math.log(bCount + 1) / Math.LN10), 3);
        textNode.nodeValue = threePlus.slice(0, aCount) +
                             sixSpace.slice(aCount + bCount) +
                             threeMinus.slice(0, bCount);
    } else {
        textNode.nodeValue = ' ';
    }
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

    positionRulesetTools();

    uDom.nodeFromId('firewallContainer').classList.toggle(
        'dirty',
        popupData.matrixIsDirty === true
    );
};

/******************************************************************************/

var buildAllFirewallRows = function() {
    // Do this before removing the rows
    if ( dfHotspots === null ) {
        dfHotspots = uDom('#actionSelector')
            .toggleClass('colorBlind', popupData.colorBlindFriendly)
            .on('click', 'span', setFirewallRuleHandler);
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

    // Domain of the page must always be included (if there is one)
    if (
        allDomains.hasOwnProperty(popupData.pageDomain) === false &&
        reNetworkRelatedURL.test(popupData.rawURL)
    ) {
        allHostnameRows.push(popupData.pageDomain);
        allDomains[popupData.pageDomain] = false;
        allDomainCount += 1;
    }

    var summary = domainsHitStr.replace('{{count}}', touchedDomainCount.toLocaleString())
                               .replace('{{total}}', allDomainCount.toLocaleString());
    uDom.nodeFromId('popupHitDomainCount').textContent = summary;
};

/******************************************************************************/

// Assume everything has to be done incrementally.

var renderPopup = function() {
    if ( popupData.tabTitle ) {
        document.title = popupData.appName + ' - ' + popupData.tabTitle;
    }

    uDom.nodeFromId('appname').textContent = popupData.appName;
    uDom.nodeFromId('version').textContent = popupData.appVersion;
    uDom('body')
        .toggleClass('advancedUser', popupData.advancedUserEnabled)
        .toggleClass(
            'off',
            (popupData.pageURL === '') ||
            (!popupData.netFilteringSwitch) ||
            (popupData.pageHostname === 'behind-the-scene' && !popupData.advancedUserEnabled)
        );

    // If you think the `=== true` is pointless, you are mistaken
    uDom.nodeFromId('gotoPick').classList.toggle('enabled', popupData.canElementPicker === true);

    var text;
    var blocked = popupData.pageBlockedRequestCount;
    var total = popupData.pageAllowedRequestCount + blocked;
    if ( total === 0 ) {
        text = formatNumber(0);
    } else {
        text = statsStr.replace('{{count}}', formatNumber(blocked))
                       .replace('{{percent}}', formatNumber(Math.floor(blocked * 100 / total)));
    }
    uDom.nodeFromId('page-blocked').textContent = text;

    blocked = popupData.globalBlockedRequestCount;
    total = popupData.globalAllowedRequestCount + blocked;
    if ( total === 0 ) {
        text = formatNumber(0);
    } else {
        text = statsStr.replace('{{count}}', formatNumber(blocked))
                       .replace('{{percent}}', formatNumber(Math.floor(blocked * 100 / total)));
    }
    uDom.nodeFromId('total-blocked').textContent = text;

    // https://github.com/gorhill/uBlock/issues/507
    // Convenience: open the logger with current tab automatically selected
    if ( popupData.tabId ) {
        uDom.nodeFromSelector('.statName > a[href^="logger-ui.html"]').setAttribute(
            'href',
            'logger-ui.html#tab_' + popupData.tabId
        );
    }

    // This will collate all domains, touched or not
    renderPrivacyExposure();

    // Extra tools
    uDom.nodeFromId('no-popups').classList.toggle('on', popupData.noPopups === true);
    uDom.nodeFromId('no-large-media').classList.toggle('on', popupData.noLargeMedia === true);
    uDom.nodeFromId('no-cosmetic-filtering').classList.toggle('on', popupData.noCosmeticFiltering === true);
    uDom.nodeFromId('no-remote-fonts').classList.toggle('on', popupData.noRemoteFonts === true);

    // Report blocked popup count on badge
    total = popupData.popupBlockedCount;
    uDom.nodeFromSelector('#no-popups > span.badge')
        .textContent = total ? total.toLocaleString() : '';

    // Report large media count on badge
    total = popupData.largeMediaCount;
    uDom.nodeFromSelector('#no-large-media > span.badge')
        .textContent = total ? total.toLocaleString() : '';

    // Report remote font count on badge
    total = popupData.remoteFontCount;
    uDom.nodeFromSelector('#no-remote-fonts > span.badge')
        .textContent = total ? total.toLocaleString() : '';

    // https://github.com/chrisaljoudi/uBlock/issues/470
    // This must be done here, to be sure the popup is resized properly
    var dfPaneVisible = popupData.dfEnabled && popupData.advancedUserEnabled;

    // https://github.com/chrisaljoudi/uBlock/issues/1068
    // Remember the last state of the firewall pane. This allows to
    // configure the popup size early next time it is opened, which means a
    // less glitchy popup at open time.
    if ( dfPaneVisible !== dfPaneVisibleStored ) {
        dfPaneVisibleStored = dfPaneVisible;
        vAPI.localStorage.setItem('popupFirewallPane', dfPaneVisibleStored);
    }

    uDom.nodeFromId('panes').classList.toggle('dfEnabled', dfPaneVisible);
    uDom('#firewallContainer')
        .toggleClass('minimized', popupData.firewallPaneMinimized)
        .toggleClass('colorBlind', popupData.colorBlindFriendly);

    // Build dynamic filtering pane only if in use
    if ( dfPaneVisible ) {
        buildAllFirewallRows();
    }
};

/******************************************************************************/

var renderPopupLazy = function() {
    messaging.send('popupPanel', { what: 'getPopupLazyData', tabId: popupData.tabId });
};

var onPopupMessage = function(data) {
    if ( !data ) { return; }
    if ( data.tabId !== popupData.tabId ) { return; }

    switch ( data.what ) {
    case 'cosmeticallyFilteredElementCountChanged':
        var v = data.count || '';
        uDom.nodeFromSelector('#no-cosmetic-filtering > span.badge')
            .textContent = typeof v === 'number' ? v.toLocaleString() : v;
        break;
    }
};

messaging.addChannelListener('popup', onPopupMessage);

/******************************************************************************/

var toggleNetFilteringSwitch = function(ev) {
    if ( !popupData || !popupData.pageURL ) {
        return;
    }
    if ( popupData.pageHostname === 'behind-the-scene' && !popupData.advancedUserEnabled ) {
        return;
    }
    messaging.send(
        'popupPanel',
        {
            what: 'toggleNetFiltering',
            url: popupData.pageURL,
            scope: ev.ctrlKey || ev.metaKey ? 'page' : '',
            state: !uDom('body').toggleClass('off').hasClass('off'),
            tabId: popupData.tabId
        }
    );

    hashFromPopupData();
};

/******************************************************************************/

var gotoPick = function() {
    messaging.send(
        'popupPanel',
        {
            what: 'launchElementPicker',
            tabId: popupData.tabId
        }
    );

    vAPI.closePopup();
};

/******************************************************************************/

var gotoURL = function(ev) {
    if ( this.hasAttribute('href') === false) {
        return;
    }

    ev.preventDefault();

    messaging.send(
        'popupPanel',
        {
            what: 'gotoURL',
            details: {
                url: this.getAttribute('href'),
                select: true,
                index: -1,
                shiftKey: ev.shiftKey
            }
        }
    );

    vAPI.closePopup();
};

/******************************************************************************/

var toggleFirewallPane = function() {
    if ( popupData.advancedUserEnabled === false ) {
        return;
    }
    popupData.dfEnabled = !popupData.dfEnabled;

    messaging.send(
        'popupPanel',
        {
            what: 'userSettings',
            name: 'dynamicFilteringEnabled',
            value: popupData.dfEnabled
        }
    );

    // https://github.com/chrisaljoudi/uBlock/issues/996
    // Remember the last state of the firewall pane. This allows to
    // configure the popup size early next time it is opened, which means a
    // less glitchy popup at open time.
    dfPaneVisibleStored = popupData.dfEnabled;
    vAPI.localStorage.setItem('popupFirewallPane', dfPaneVisibleStored);

    // Dynamic filtering pane may not have been built yet
    uDom.nodeFromId('panes').classList.toggle('dfEnabled', popupData.dfEnabled);
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
    messaging.send(
        'popupPanel',
        {
            what: 'toggleFirewallRule',
            tabId: popupData.tabId,
            pageHostname: popupData.pageHostname,
            srcHostname: src,
            desHostname: des,
            requestType: type,
            action: action,
            persist: persist
        },
        onFirewallRuleChanged
    );
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
    messaging.send(
        'popupPanel',
        {
            what: 'reloadTab',
            tabId: popupData.tabId,
            select: true
        }
    );

    // Polling will take care of refreshing the popup content

    // https://github.com/chrisaljoudi/uBlock/issues/748
    // User forces a reload, assume the popup has to be updated regardless if
    // there were changes or not.
    popupData.contentLastModified = -1;

    // No need to wait to remove this.
    uDom('body').toggleClass('dirty', false);
};

/******************************************************************************/

var toggleMinimize = function(ev) {
    // Special display mode: in its own tab/window, with no vertical restraint.
    // Useful to take snapshots of the whole list of domains -- example:
    //   https://github.com/gorhill/uBlock/issues/736#issuecomment-178879944
    if ( ev.shiftKey && ev.ctrlKey ) {
        messaging.send(
            'popupPanel',
            {
                what: 'gotoURL',
                details: {
                    url: 'popup.html?tabId=' + popupData.tabId + '&fullsize=1',
                    select: true,
                    index: -1
                }
            }
        );
        vAPI.closePopup();
        return;
    }

    popupData.firewallPaneMinimized = uDom.nodeFromId('firewallContainer')
                                          .classList
                                          .toggle('minimized');
    messaging.send(
        'popupPanel',
        {
            what: 'userSettings',
            name: 'firewallPaneMinimized',
            value: popupData.firewallPaneMinimized
        }
    );
    positionRulesetTools();
};

/******************************************************************************/

var saveFirewallRules = function() {
    messaging.send(
        'popupPanel',
        {
            what: 'saveFirewallRules',
            srcHostname: popupData.pageHostname,
            desHostnames: popupData.hostnameDict
        }
    );
    uDom.nodeFromId('firewallContainer').classList.remove('dirty');
};

/******************************************************************************/

var revertFirewallRules = function() {
    var onFirewallRuleChanged = function(response) {
        cachePopupData(response);
        updateAllFirewallCells();
        hashFromPopupData();
    };
    messaging.send(
        'popupPanel',
        {
            what: 'revertFirewallRules',
            srcHostname: popupData.pageHostname,
            desHostnames: popupData.hostnameDict,
            tabId: popupData.tabId
        },
        onFirewallRuleChanged
    );
    uDom.nodeFromId('firewallContainer').classList.remove('dirty');
};

/******************************************************************************/

var toggleHostnameSwitch = function(ev) {
    var target = ev.currentTarget;
    var switchName = target.getAttribute('id');
    if ( !switchName ) {
        return;
    }
    target.classList.toggle('on');
    messaging.send(
        'popupPanel',
        {
            what: 'toggleHostnameSwitch',
            name: switchName,
            hostname: popupData.pageHostname,
            state: target.classList.contains('on'),
            tabId: popupData.tabId
        }
    );
    hashFromPopupData();
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
        messaging.send(
            'popupPanel',
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
            getPopupData(popupData.tabId);
            return;
        }
        poll();
    };

    var poll = function() {
        if ( pollTimer !== null ) {
            return;
        }
        pollTimer = vAPI.setTimeout(pollCallback, 1500);
    };

    return poll;
})();

/******************************************************************************/

var getPopupData = function(tabId) {
    var onDataReceived = function(response) {
        cachePopupData(response);
        renderPopup();
        renderPopupLazy(); // low priority rendering
        hashFromPopupData(true);
        pollForContentChange();
    };
    messaging.send(
        'popupPanel',
        { what: 'getPopupData', tabId: tabId },
        onDataReceived
    );
};

/******************************************************************************/

var onShowTooltip = function() {
    if ( popupData.tooltipsDisabled ) {
        return;
    }

    var target = this;

    // Tooltip container
    var ttc = uDom(target).ancestors('.tooltipContainer').nodeAt(0) ||
              document.body;
    var ttcRect = ttc.getBoundingClientRect();

    // Tooltip itself
    var tip = uDom.nodeFromId('tooltip');
    tip.textContent = target.getAttribute('data-tip');
    tip.style.removeProperty('top');
    tip.style.removeProperty('bottom');
    ttc.appendChild(tip);

    // Target rect
    var targetRect = target.getBoundingClientRect();

    // Default is "over"
    var pos;
    var over = target.getAttribute('data-tip-position') !== 'under';
    if ( over ) {
        pos = ttcRect.height - targetRect.top + ttcRect.top;
        tip.style.setProperty('bottom', pos + 'px');
    } else {
        pos = targetRect.bottom - ttcRect.top;
        tip.style.setProperty('top', pos + 'px');
    }

    tip.classList.add('show');
};

var onHideTooltip = function() {
    uDom.nodeFromId('tooltip').classList.remove('show');
};

/******************************************************************************/

// Popup DOM is assumed to be loaded at this point -- because this script
// is loaded after everything else..

(function() {
    // If there's no tab id specified in the query string,
    // it will default to current tab.
    var tabId = null;

    // Extract the tab id of the page this popup is for
    var matches = window.location.search.match(/[\?&]tabId=([^&]+)/);
    if ( matches && matches.length === 2 ) {
        tabId = matches[1];
    }
    getPopupData(tabId);

    uDom('#switch').on('click', toggleNetFilteringSwitch);
    uDom('#gotoPick').on('click', gotoPick);
    uDom('a[href]').on('click', gotoURL);
    uDom('h2').on('click', toggleFirewallPane);
    uDom('#refresh').on('click', reloadTab);
    uDom('.hnSwitch').on('click', toggleHostnameSwitch);
    uDom('#saveRules').on('click', saveFirewallRules);
    uDom('#revertRules').on('click', revertFirewallRules);
    uDom('[data-i18n="popupAnyRulePrompt"]').on('click', toggleMinimize);

    uDom('body').on('mouseenter', '[data-tip]', onShowTooltip)
                .on('mouseleave', '[data-tip]', onHideTooltip);
})();

/******************************************************************************/

})();

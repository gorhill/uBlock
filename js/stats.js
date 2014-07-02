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

/* global chrome, uDom, messaging */

/******************************************************************************/

(function() {

/******************************************************************************/

messaging.start('stats.js');

/******************************************************************************/

var logSettingChanged = function() {
    messaging.tell({
        what: 'userSettings',
        name: 'logBlockedRequests',
        value: this.checked
    });
    uDom('#blockedRequests').toggleClass('logEnabled', this.checked);
    renderPageSelector();
};

/******************************************************************************/

var cachedPageSelectors = {};
var cachedPageHash = '';

var toPrettyTypeNames = {
         'sub_frame': 'frame',
            'object': 'plugin',
    'xmlhttprequest': 'XHR'
};

/******************************************************************************/

var renderURL = function(url, filter) {
    var chunkSize = 50;
    // make a regex out of the filter
    var reText = filter;
    var pos = reText.indexOf('$');
    if ( pos > 0 ) {
        reText = reText.slice(0, pos);
    }
    reText = reText
        .replace(/\./g, '\\.')
        .replace(/\?/g, '\\?')
        .replace('||', '')
        .replace(/\^/g, '.')
        .replace(/\*/g, '.*')
        ;
    var re = new RegExp(reText, 'gi');
    var matches = re.exec(url);

    var renderedURL = [];
    while ( url.length ) {
        renderedURL.push(url.slice(0, chunkSize));
        url = url.slice(chunkSize);
    }

    if ( matches && matches[0].length ) {
        var index = (re.lastIndex / chunkSize) | 0;
        var offset = re.lastIndex % chunkSize;
        if ( index > 0 && offset === 0 ) {
            offset = 0;
            index -= 1;
        }
        var segment = renderedURL[index];
        renderedURL[index] = segment.slice(0, offset) + '</b>' + segment.slice(offset);

        index = (matches.index / chunkSize) | 0;
        offset = matches.index % chunkSize;
        if ( index > 0 && offset === 0 ) {
            offset = chunkSize;
            index -= 1;
        }
        segment = renderedURL[index];
        renderedURL[index] = segment.slice(0, offset) + '<b>' + segment.slice(offset);
    }

    return renderedURL.join('\n');
};

/******************************************************************************/

var renderPageDetails = function(tabId) {
    if ( !cachedPageSelectors[tabId] ) {
        return;
    }

    var onDataReceived = function(details) {
        if ( details.hash === cachedPageHash ) {
            return;
        }
        var blockedRequests = details.requests || [];
        blockedRequests.sort(function(a, b) {
            var r = a.domain.localeCompare(b.domain);
            if ( r === 0 ) {
                r = a.reason.localeCompare(b.reason);
                if ( r === 0 ) {
                    r = a.type.localeCompare(b.type);
                }
            }
            return r;
        });

        uDom('#tableHeader ~ tr').remove();

        var blockedRequest, requestURL;
        var html = [];

        for ( var i = 0; i < blockedRequests.length; i++ ) {
            blockedRequest = blockedRequests[i];
            html.push(
                '<tr>',
                '<td>', toPrettyTypeNames[blockedRequest.type] || blockedRequest.type,
                '<td>', blockedRequest.domain,
                '<td>', renderURL(blockedRequest.url, blockedRequest.reason),
                '<td>', blockedRequest.reason
            );
        }
        if ( !html.length ) {
            html.push(
                '<tr><td colspan="4">',
                chrome.i18n.getMessage('logBlockedRequestsEmpty')
            );
        }
        uDom('#tableHeader').insertAfter(html.join(''));
        cachedPageHash = details.hash;
    };

    messaging.ask({ what: 'getPageDetails', tabId: tabId }, onDataReceived);
};

/******************************************************************************/

var pageSelectorChanged = function() {
    renderPageDetails(this.value);
};

/******************************************************************************/

var renderPageSelector = function(targetTabId) {
    if ( uDom('#logBlockedRequests').prop('checked') !== true ) {
        return;
    }
    var selectedTabId = targetTabId || parseInt(uDom('#pageSelector').val(), 10);
    var onTabReceived = function(tab) {
        var html = [
            '<option value="',
            tab.id,
            '">',
            tab.title
        ];
        uDom('#pageSelector').append(html.join(''));
        if ( tab.id === selectedTabId ) {
            uDom('#pageSelector').val(tab.id);
        }
    };
    var onDataReceived = function(pageSelectors) {
        uDom('#pageSelector option').remove();
        cachedPageSelectors = {};
        pageSelectors.sort().map(function(tabId) {
            cachedPageSelectors[tabId] = true;
        });
        if ( !cachedPageSelectors[selectedTabId] ) {
            selectedTabId = pageSelectors[0];
        }
        for ( var i = 0; i < pageSelectors.length; i++ ) {
            chrome.tabs.get(parseInt(pageSelectors[i], 10), onTabReceived);
        }
        if ( selectedTabId ) {
            renderPageDetails(selectedTabId);
        }
    };
    messaging.ask({ what: 'getPageSelectors' }, onDataReceived);
};

/******************************************************************************/

var onUserSettingsReceived = function(details) {
    uDom('#logBlockedRequests').prop('checked', details.logBlockedRequests);
    uDom('#blockedRequests').toggleClass('logEnabled', details.logBlockedRequests);

    var matches = window.location.search.slice(1).match(/(?:^|&)which=(\d+)/);
    var tabId = matches && matches.length === 2 ? parseInt(matches[1], 10) : 0;
    renderPageSelector(tabId);

    uDom('#logBlockedRequests').on('change', logSettingChanged);
    uDom('#refresh').on('click', function() { renderPageSelector(); });
    uDom('#pageSelector').on('change', pageSelectorChanged);
};

/******************************************************************************/

uDom.onLoad(function() {
    messaging.ask({ what: 'userSettings' }, onUserSettingsReceived);
});

/******************************************************************************/

})();


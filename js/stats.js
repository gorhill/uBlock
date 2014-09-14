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
        name: 'logRequests',
        value: this.checked
    });
    uDom('#requests').toggleClass('logEnabled', this.checked);
    renderPageSelector();
};

/******************************************************************************/

var cachedPageSelectors = {};
var cachedPageHash = '';

var toPrettyTypeNames = {
         'stylesheet': 'css',
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
    if ( reText.slice(0, 2) === '@@' ) {
        reText = reText.slice(2);
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
            offset = chunkSize;
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
        cachedPageHash = details.hash;
        var renderRequests = function(requests, className) {
            requests.sort(function(a, b) {
                var r = a.domain.localeCompare(b.domain);
                if ( r ) { return r; }
                r = a.reason.localeCompare(b.reason);
                if ( r ) { return r; }
                r = a.type.localeCompare(b.type);
                if ( r ) { return r; }
                return a.url.localeCompare(b.url);
            });
            var html = [], request;
            html.push(
                '<tr class="header ', className, '">',
                '<td colspan="4"><h3>',
                chrome.i18n.getMessage(className + (requests.length ? 'RequestsHeader' : 'RequestsEmpty')),
                '</h3>'
            );
            var currentDomain = '';
            for ( var i = 0; i < requests.length; i++ ) {
                request = requests[i];
                if ( request.domain !== currentDomain ) {
                    currentDomain = request.domain;
                    html.push(
                        '<tr class="', className, ' domainHeader">',
                        '<td colspan="4">', currentDomain
                    );
                }
                html.push(
                    '<tr class="', className, ' requestEntry">',
                    '<td>',
                    '<td>', toPrettyTypeNames[request.type] || request.type,
                    '<td>', renderURL(request.url, request.reason),
                    '<td>', request.reason || ''
                );
            }
            return html;
        };
        uDom('#requests .tableHeader ~ tr').remove();
        var htmlBlocked = renderRequests(details.blockedRequests || [], 'logBlocked');
        var htmlAllowed = renderRequests(details.allowedRequests || [], 'logAllowed');
        uDom('#requests .tableHeader').insertAfter(htmlBlocked.concat(htmlAllowed).join(''));
    };

    messaging.ask({ what: 'getPageDetails', tabId: tabId }, onDataReceived);
};

/******************************************************************************/

var pageSelectorChanged = function() {
    renderPageDetails(this.value);
};

/******************************************************************************/

var renderPageSelector = function(targetTabId) {
    if ( !uDom('#logRequests').prop('checked') ) {
        return;
    }
    var selectedTabId = targetTabId || parseInt(uDom('#pageSelector').val(), 10);
    var onTabReceived = function(tab) {
        if ( !tab ) {
            return;
        }
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
        uDom('#requests').toggleClass('empty', pageSelectors.length === 0);
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
        if ( pageSelectors.length > 0 ) {
            renderPageDetails(selectedTabId);
        }
    };
    messaging.ask({ what: 'getPageSelectors' }, onDataReceived);
};

/******************************************************************************/

var onUserSettingsReceived = function(details) {
    uDom('#logRequests').prop('checked', details.logRequests);
    uDom('#requests').toggleClass('logEnabled', details.logRequests);

    var matches = window.location.search.slice(1).match(/(?:^|&)which=(\d+)/);
    var tabId = matches && matches.length === 2 ? parseInt(matches[1], 10) : 0;
    renderPageSelector(tabId);

    uDom('#logRequests').on('change', logSettingChanged);
    uDom('#refresh').on('click', function() { renderPageSelector(); });
    uDom('#pageSelector').on('change', pageSelectorChanged);
};

/******************************************************************************/

uDom.onLoad(function() {
    messaging.ask({ what: 'userSettings' }, onUserSettingsReceived);
});

/******************************************************************************/

})();


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

/* global chrome, messaging, uDom */

/******************************************************************************/

(function() {

/******************************************************************************/

var userListName = chrome.i18n.getMessage('1pPageName');
var selectedBlacklistsHash = '';

/******************************************************************************/

messaging.start('lists.js');

var onMessage = function(msg) {
    switch ( msg.what ) {
        case 'loadUbiquitousBlacklistCompleted':
            renderBlacklists();
            selectedBlacklistsChanged();
            break;

        default:
            break;
    }
};

messaging.listen(onMessage);

/******************************************************************************/

var getµb = function() {
    return chrome.extension.getBackgroundPage().µBlock;
};

/******************************************************************************/

var renderNumber = function(value) {
    return value.toLocaleString();
};

/******************************************************************************/

// TODO: get rid of background page dependencies

var renderBlacklists = function() {
    // empty list first
    uDom('#lists .listDetails').remove();

    var µb = getµb();

    uDom('#listsOfBlockedHostsPrompt').text(
        chrome.i18n.getMessage('3pListsOfBlockedHostsPrompt')
            .replace('{{netFilterCount}}', renderNumber(µb.abpFilters.getFilterCount()))
            .replace('{{cosmeticFilterCount}}', renderNumber(µb.abpHideFilters.getFilterCount()))
    );

    // Assemble a pretty blacklist name if possible
    var htmlFromListName = function(blacklistTitle, blacklistHref) {
        if ( blacklistHref === µb.userFiltersPath ) {
            return userListName;
        }
        if ( !blacklistTitle ) {
            return blacklistHref;
        }
        if ( blacklistHref.indexOf('assets/thirdparties/') !== 0 ) {
            return blacklistTitle;
        }
        var matches = blacklistHref.match(/^assets\/thirdparties\/([^\/]+)/);
        if ( matches === null || matches.length !== 2 ) {
            return blacklistTitle;
        }
        var hostname = matches[1];
        var domain = µb.URI.domainFromHostname(hostname);
        if ( domain === '' ) {
            return blacklistTitle;
        }
        var html = [
            blacklistTitle,
            ' <i>(<a href="http://',
            hostname,
            '" target="_blank">',
            domain,
            '</a>)</i>'
        ];
        return html.join('');
    };

    var listStatsTemplate = chrome.i18n.getMessage('3pListsOfBlockedHostsPerListStats');

    var htmlFromBranch = function(groupKey, listKeys, lists) {
        listKeys.sort(function(a, b) {
            return lists[a].title.localeCompare(lists[b].title);
        });
        var html = [
            '<li>',
            chrome.i18n.getMessage('3pGroup' + groupKey.charAt(0).toUpperCase() + groupKey.slice(1)),
            '<ul>'
        ];
        var listEntryTemplate = [
            '<li class="listDetails">',
            '<input type="checkbox" {{checked}}>',
            '&thinsp;',
            '<a href="{{URL}}" type="text/plain">',
            '{{name}}',
            '</a>',
            ': ',
            '<span class="dim">',
            listStatsTemplate,
            '</span>'
        ].join('');
        var listKey, list, listEntry;
        for ( var i = 0; i < listKeys.length; i++ ) {
            listKey = listKeys[i];
            list = lists[listKey];
            listEntry = listEntryTemplate
                .replace('{{checked}}', list.off ? '' : 'checked')
                .replace('{{URL}}', encodeURI(listKey))
                .replace('{{name}}', htmlFromListName(list.title, listKey))
                .replace('{{used}}', !list.off && !isNaN(+list.entryUsedCount) ? renderNumber(list.entryUsedCount) : '0')
                .replace('{{total}}', !isNaN(+list.entryCount) ? renderNumber(list.entryCount) : '?')
            html.push(listEntry);
        }
        html.push('</ul>');
        return html.join('');
    };

    var groupsFromLists = function(lists) {
        var groups = {};
        var listKeys = Object.keys(lists);
        var i = listKeys.length;
        var listKey, list, groupKey;
        while ( i-- ) {
            listKey = listKeys[i];
            list = lists[listKey];
            groupKey = list.group || 'nogroup';
            if ( groups[groupKey] === undefined ) {
                groups[groupKey] = [];
            }
            groups[groupKey].push(listKey);
        }
        return groups;
    };

    var html = [];
    var groups = groupsFromLists(µb.remoteBlacklists);
    var groupKey;
    var groupKeys = [
        'default',
        'ads',
        'privacy',
        'malware',
        'social',
        'multipurpose',
        'regions'
    ];
    for ( var i = 0; i < groupKeys.length; i++ ) {
        groupKey = groupKeys[i];
        html.push(htmlFromBranch(groupKey, groups[groupKey], µb.remoteBlacklists));
        delete groups[groupKey];
    }
    // For all groups not covered above (if any left)
    groupKeys = Object.keys(groups);
    for ( var i = 0; i < groupKeys.length; i++ ) {
        groupKey = groupKeys[i];
        html.push(htmlFromBranch(groupKey, groups[groupKey], µb.remoteBlacklists));
        delete groups[groupKey];
    }

    uDom('#lists').html(html.join(''));
    uDom('#parseAllABPHideFilters').prop('checked', µb.userSettings.parseAllABPHideFilters === true);
    uDom('#ubiquitousParseAllABPHideFiltersPrompt2').text(
        chrome.i18n.getMessage("listsParseAllABPHideFiltersPrompt2")
            .replace('{{abpHideFilterCount}}', renderNumber(µb.abpHideFilters.getFilterCount()))
    );

    selectedBlacklistsHash = getSelectedBlacklistsHash();
};

/******************************************************************************/

// Create a hash so that we know whether the selection of preset blacklists
// has changed.

var getSelectedBlacklistsHash = function() {
    var hash = '';
    var inputs = uDom('#lists .listDetails > input');
    var i = inputs.length();
    while ( i-- ) {
        hash += inputs.subset(i).prop('checked').toString();
    }
    // Factor in whether cosmetic filters are to be processed
    hash += uDom('#parseAllABPHideFilters').prop('checked').toString();

    return hash;
};

/******************************************************************************/

// This is to give a visual hint that the selection of blacklists has changed.

var selectedBlacklistsChanged = function() {
    uDom('#blacklistsApply').prop(
        'disabled',
        getSelectedBlacklistsHash() === selectedBlacklistsHash
    );
};

/******************************************************************************/

var onListLinkClicked = function(ev) {
    messaging.tell({
        what: 'gotoExtensionURL',
        url: 'asset-viewer.html?url=' + uDom(this).attr('href')
    });
    ev.preventDefault();
};

/******************************************************************************/

var blacklistsApplyHandler = function() {
    var newHash = getSelectedBlacklistsHash();
    if ( newHash === selectedBlacklistsHash ) {
        return;
    }
    // Reload blacklists
    var switches = [];
    var lis = uDom('#lists .listDetails');
    var i = lis.length();
    var path;
    while ( i-- ) {
        path = lis.subset(i).find('a').attr('href');
        switches.push({
            location: path,
            off: lis.subset(i).find('input').prop('checked') === false
        });
    }
    messaging.tell({
        what: 'reloadAllFilters',
        switches: switches
    });
    uDom('#blacklistsApply').prop('disabled', true );
};

/******************************************************************************/

var abpHideFiltersCheckboxChanged = function() {
    messaging.tell({
        what: 'userSettings',
        name: 'parseAllABPHideFilters',
        value: this.checked
    });
    selectedBlacklistsChanged();
};

/******************************************************************************/

uDom.onLoad(function() {
    // Handle user interaction
    uDom('#lists').on('change', '.listDetails', selectedBlacklistsChanged);
    uDom('#lists').on('click', '.listDetails > a:first-child', onListLinkClicked);
    uDom('#blacklistsApply').on('click', blacklistsApplyHandler);
    uDom('#parseAllABPHideFilters').on('change', abpHideFiltersCheckboxChanged);

    renderBlacklists();
});

/******************************************************************************/

})();


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
    // TODO: localization
    if ( +value > 1000 ) {
        value = value.toString();
        var i = value.length - 3;
        while ( i > 0 ) {
            value = value.slice(0, i) + ',' + value.slice(i);
            i -= 3;
        }
    }
    return value;
};

/******************************************************************************/

// TODO: get rid of background page dependencies

var renderBlacklists = function() {
    // empty list first
    uDom('#blacklists .blacklistDetails').remove();

    var µb = getµb();

    uDom('#listsOfBlockedHostsPrompt').text(
        chrome.i18n.getMessage('3pListsOfBlockedHostsPrompt')
            .replace('{{ubiquitousBlacklistCount}}', renderNumber(µb.abpFilters.getFilterCount()))
    );

    // Assemble a pretty blacklist name if possible
    var prettifyListName = function(blacklistTitle, blacklistHref) {
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
    var blacklists = µb.remoteBlacklists;
    var ul = uDom('#blacklists');
    var keys = Object.keys(blacklists);
    var i = keys.length;
    var blacklist, blacklistHref;
    var liTemplate = uDom('#blacklistTemplate .blacklistDetails').first();
    var li, text;
    while ( i-- ) {
        blacklistHref = keys[i];
        blacklist = blacklists[blacklistHref];
        li = liTemplate.clone();
        li.find('input').prop('checked', !blacklist.off);
        li.find('a')
            .attr('href', encodeURI(blacklistHref))
            .html(prettifyListName(blacklist.title, blacklistHref));
        text = listStatsTemplate
            .replace('{{used}}', !blacklist.off && !isNaN(+blacklist.entryUsedCount) ? renderNumber(blacklist.entryUsedCount) : '0')
            .replace('{{total}}', !isNaN(+blacklist.entryCount) ? renderNumber(blacklist.entryCount) : '?')
            ;
        li.find('span').text(text);
        ul.prepend(li);
    }
    uDom('#parseAllABPHideFilters').attr('checked', µb.userSettings.parseAllABPHideFilters === true);
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
    var inputs = uDom('#blacklists .blacklistDetails > input');
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
    var lis = uDom('#blacklists .blacklistDetails');
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
    uDom('#blacklistsApply').attr('disabled', true );
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
    uDom('#blacklists').on('change', '.blacklistDetails', selectedBlacklistsChanged);
    uDom('#blacklists').on('click', '.blacklistDetails > a:first-child', onListLinkClicked);
    uDom('#blacklistsApply').on('click', blacklistsApplyHandler);
    uDom('#parseAllABPHideFilters').on('change', abpHideFiltersCheckboxChanged);

    renderBlacklists();
});

/******************************************************************************/

})();


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

/* global chrome, $ */

/******************************************************************************/

(function() {

/******************************************************************************/

var userListName = chrome.i18n.getMessage('1pPageName');
var cachedUserUbiquitousBlacklistedHosts = '';
var cachedUserUbiquitousWhitelistedHosts = '';
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

function getµb() {
    return chrome.extension.getBackgroundPage().µBlock;
}

/******************************************************************************/

function renderNumber(value) {
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
}

/******************************************************************************/

// TODO: get rid of background page dependencies

function renderBlacklists() {
    // empty list first
    $('#blacklists .blacklistDetails').remove();

    var µb = getµb();

    $('#3pListsOfBlockedHostsPrompt2').text(
        chrome.i18n.getMessage('3pListsOfBlockedHostsPrompt2')
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

    var blacklists = µb.remoteBlacklists;
    var ul = $('#blacklists');
    var keys = Object.keys(blacklists);
    var i = keys.length;
    var blacklist, blacklistHref;
    var liTemplate = $('#blacklistTemplate .blacklistDetails').first();
    var li, child, text;
    while ( i-- ) {
        blacklistHref = keys[i];
        blacklist = blacklists[blacklistHref];
        li = liTemplate.clone();
        child = $('input', li);
        child.prop('checked', !blacklist.off);
        child = $('a', li);
        child.attr('href', encodeURI(blacklistHref));
        child.html(prettifyListName(blacklist.title, blacklistHref));
        child = $('span', li);
        text = chrome.i18n.getMessage('3pListsOfBlockedHostsPerListStats')
            .replace('{{used}}', !blacklist.off && !isNaN(+blacklist.entryUsedCount) ? renderNumber(blacklist.entryUsedCount) : '0')
            .replace('{{total}}', !isNaN(+blacklist.entryCount) ? renderNumber(blacklist.entryCount) : '?')
            ;
        child.text(text);
        ul.prepend(li);
    }
    $('#parseAllABPHideFilters').attr('checked', µb.userSettings.parseAllABPHideFilters === true);
    $('#ubiquitousParseAllABPHideFiltersPrompt2').text(
        chrome.i18n.getMessage("listsParseAllABPHideFiltersPrompt2")
            .replace('{{abpHideFilterCount}}', renderNumber(µb.abpHideFilters.getFilterCount()))
    );

    selectedBlacklistsHash = getSelectedBlacklistsHash();
}

/******************************************************************************/

// Create a hash so that we know whether the selection of preset blacklists
// has changed.

function getSelectedBlacklistsHash() {
    var hash = '';
    var inputs = $('#blacklists .blacklistDetails > input');
    var i = inputs.length;
    var entryHash;
    while ( i-- ) {
        entryHash = $(inputs[i]).prop('checked').toString();
        hash += entryHash;
    }
    // Factor in whether ABP filters are to be processed
    hash += $('#parseAllABPHideFilters').prop('checked').toString();

    return hash;
}

/******************************************************************************/

// This is to give a visual hint that the selection of blacklists has changed.

function selectedBlacklistsChanged() {
    $('#blacklistsApply').attr(
        'disabled',
        getSelectedBlacklistsHash() === selectedBlacklistsHash
    );
}

/******************************************************************************/

function blacklistsApplyHandler() {
    var newHash = getSelectedBlacklistsHash();
    if ( newHash === selectedBlacklistsHash ) {
        return;
    }
    // Reload blacklists
    var switches = [];
    var lis = $('#blacklists .blacklistDetails');
    var i = lis.length;
    var path;
    while ( i-- ) {
        path = $(lis[i]).children('a').attr('href');
        switches.push({
            location: path,
            off: $(lis[i]).children('input').prop('checked') === false
        });
    }
    messaging.tell({
        what: 'reloadAllFilters',
        switches: switches
    });
    $('#blacklistsApply').attr('disabled', true );
}

/******************************************************************************/

function abpHideFiltersCheckboxChanged() {
    messaging.tell({
        what: 'userSettings',
        name: 'parseAllABPHideFilters',
        value: $(this).is(':checked')
    });
    selectedBlacklistsChanged();
}

/******************************************************************************/

window.addEventListener('load', function() {
    // Handle user interaction
    $('#blacklists').on('change', '.blacklistDetails', selectedBlacklistsChanged);
    $('#blacklistsApply').on('click', blacklistsApplyHandler);
    $('#parseAllABPHideFilters').on('change', abpHideFiltersCheckboxChanged);

    renderBlacklists();
});

/******************************************************************************/

})();


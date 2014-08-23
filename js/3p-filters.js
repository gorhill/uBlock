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
var listDetails = {};
var cosmeticSwitch = true;
var externalLists = '';
var cacheWasPurged = false;
var needUpdate = false;

/******************************************************************************/

messaging.start('3p-filters.js');

var onMessage = function(msg) {
    switch ( msg.what ) {
        case 'loadUbiquitousBlacklistCompleted':
            uDom('body').toggleClass('loading', false);
            renderBlacklists();
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
    var µb = getµb();

    // Assemble a pretty blacklist name if possible
    var htmlFromListName = function(blacklistTitle, blacklistHref) {
        if ( blacklistHref === listDetails.userFiltersPath ) {
            return userListName;
        }
        if ( !blacklistTitle ) {
            return blacklistHref;
        }
        return blacklistTitle;
    };

    // Assemble a pretty blacklist name if possible
    var htmlFromHomeURL = function(blacklistHref) {
        if ( blacklistHref.indexOf('assets/thirdparties/') !== 0 ) {
            return '';
        }
        var matches = blacklistHref.match(/^assets\/thirdparties\/([^\/]+)/);
        if ( matches === null || matches.length !== 2 ) {
            return '';
        }
        var hostname = matches[1];
        var domain = µb.URI.domainFromHostname(hostname);
        if ( domain === '' ) {
            return '';
        }
        var html = [
            ' <a href="http://',
            hostname,
            '" target="_blank">(',
            domain,
            ')</a>'
        ];
        return html.join('');
    };

    var listStatsTemplate = chrome.i18n.getMessage('3pListsOfBlockedHostsPerListStats');
    var purgeButtontext = chrome.i18n.getMessage('3pExternalListPurge');
    var updateButtontext = chrome.i18n.getMessage('3pExternalListNew');
    var obsoleteButtontext = chrome.i18n.getMessage('3pExternalListObsolete');

    var htmlFromBranch = function(groupKey, listKeys, lists) {
        var html = [
            '<li>',
            chrome.i18n.getMessage('3pGroup' + groupKey.charAt(0).toUpperCase() + groupKey.slice(1)),
            '<ul>'
        ];
        if ( !listKeys ) {
            return html.join('');
        }
        listKeys.sort(function(a, b) {
            return lists[a].title.localeCompare(lists[b].title);
        });
        var listEntryTemplate = [
            '<li class="listDetails">',
            '<input type="checkbox" {{checked}}>',
            ' ',
            '<a href="{{URL}}" type="text/plain">',
            '{{name}}',
            '\u200E</a>',
            '{{homeURL}}',
            ': ',
            '<span class="dim">',
            listStatsTemplate,
            '</span>'
        ].join('');
        var listKey, list, listEntry, entryDetails;
        for ( var i = 0; i < listKeys.length; i++ ) {
            listKey = listKeys[i];
            list = lists[listKey];
            listEntry = listEntryTemplate
                .replace('{{checked}}', list.off ? '' : 'checked')
                .replace('{{URL}}', encodeURI(listKey))
                .replace('{{name}}', htmlFromListName(list.title, listKey))
                .replace('{{homeURL}}', htmlFromHomeURL(listKey))
                .replace('{{used}}', !list.off && !isNaN(+list.entryUsedCount) ? renderNumber(list.entryUsedCount) : '0')
                .replace('{{total}}', !isNaN(+list.entryCount) ? renderNumber(list.entryCount) : '?');
            html.push(listEntry);
            // https://github.com/gorhill/uBlock/issues/104
            entryDetails = listDetails.cache[listKey];
            if ( entryDetails === undefined ) {
                continue;
            }
            // Update status
            if ( !list.off && (entryDetails.repoObsolete || entryDetails.cacheObsolete) ) {
                html.push(
                    '&ensp;',
                    '<span class="status obsolete">',
                    entryDetails.repoObsolete ? updateButtontext : obsoleteButtontext,
                    '</span>'
                );
                needUpdate = true;
            }
            // In cache
            else if ( entryDetails.cached ) {
                html.push(
                    '&ensp;',
                    '<span class="status purge">',
                    purgeButtontext,
                    '</span>'
                );
            }
        }
        html.push('</ul>');
        return html.join('');
    };

    // https://www.youtube.com/watch?v=unCVi4hYRlY#t=30m18s

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

    var onListsReceived = function(details) {
        listDetails = details;
        cosmeticSwitch = details.cosmetic;
        needUpdate = false;

        var lists = details.available;
        var html = [];
        var groups = groupsFromLists(lists);
        var groupKey, i;
        var groupKeys = [
            'default',
            'ads',
            'privacy',
            'malware',
            'social',
            'multipurpose',
            'regions',
            'custom'
        ];
        for ( i = 0; i < groupKeys.length; i++ ) {
            groupKey = groupKeys[i];
            html.push(htmlFromBranch(groupKey, groups[groupKey], lists));
            delete groups[groupKey];
        }
        // For all groups not covered above (if any left)
        groupKeys = Object.keys(groups);
        for ( i = 0; i < groupKeys.length; i++ ) {
            groupKey = groupKeys[i];
            html.push(htmlFromBranch(groupKey, groups[groupKey], lists));
            delete groups[groupKey];
        }

        uDom('#listsOfBlockedHostsPrompt').text(
            chrome.i18n.getMessage('3pListsOfBlockedHostsPrompt')
                .replace('{{netFilterCount}}', renderNumber(details.netFilterCount))
                .replace('{{cosmeticFilterCount}}', renderNumber(details.cosmeticFilterCount))
        );
        uDom('#autoUpdate').prop('checked', listDetails.autoUpdate === true);
        uDom('#parseCosmeticFilters').prop('checked', listDetails.cosmetic === true);
        uDom('#lists').html(html.join(''));
        uDom('a').attr('target', '_blank');

        updateWidgets();
    };

    messaging.ask({ what: 'getLists' }, onListsReceived);
};

/******************************************************************************/

// Return whether selection of lists changed.

var listsSelectionChanged = function() {
    if ( listDetails.cosmetic !== cosmeticSwitch ) {
        return true;
    }
    if ( cacheWasPurged ) {
        return true;
    }
    var availableLists = listDetails.available;
    var currentLists = listDetails.current;
    var location, availableOff, currentOff;
    // This check existing entries
    for ( location in availableLists ) {
        if ( availableLists.hasOwnProperty(location) === false ) {
            continue;
        }
        availableOff = availableLists[location].off === true;
        currentOff = currentLists[location] === undefined || currentLists[location].off === true;
        if ( availableOff !== currentOff ) {
            return true;
        }
    }
    // This check removed entries
    for ( location in currentLists ) {
        if ( currentLists.hasOwnProperty(location) === false ) {
            continue;
        }
        currentOff = currentLists[location].off === true;
        availableOff = availableLists[location] === undefined || availableLists[location].off === true;
        if ( availableOff !== currentOff ) {
            return true;
        }
    }
    return false;
};

/******************************************************************************/

// Return whether content need update.

var listsContentChanged = function() {
    return needUpdate;
};

/******************************************************************************/

// This is to give a visual hint that the selection of blacklists has changed.

var updateWidgets = function() {
    uDom('#buttonApply').toggleClass('enabled', listsSelectionChanged());
    uDom('#buttonUpdate').toggleClass('enabled', listsContentChanged());
};

/******************************************************************************/

var onListCheckboxChanged = function() {
    var href = uDom(this).parent().find('a').first().attr('href');
    if ( typeof href !== 'string' ) {
        return;
    }
    if ( listDetails.available[href] === undefined ) {
        return;
    }
    listDetails.available[href].off = !this.checked;
    updateWidgets();
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

var onPurgeClicked = function() {
    var button = uDom(this);
    var li = button.parent();
    var href = li.find('a').first().attr('href');
    if ( !href ) {
        return;
    }
    messaging.tell({ what: 'purgeCache', path: href });
    button.remove();
    if ( li.find('input').first().prop('checked') ) {
        cacheWasPurged = true;
        updateWidgets();
    }
};

/******************************************************************************/

var reloadAll = function(update) {
    // Loading may take a while when resoruces are fetched from remote
    // servers. We do not want the user to force reload while we are reloading.
    uDom('body').toggleClass('loading', true);

    // Reload blacklists
    messaging.tell({
        what: 'userSettings',
        name: 'parseAllABPHideFilters',
        value: listDetails.cosmetic
    });
    // Reload blacklists
    var switches = [];
    var lis = uDom('#lists .listDetails');
    var i = lis.length();
    var path;
    while ( i-- ) {
        path = lis
            .subset(i)
            .find('a')
            .attr('href');
        switches.push({
            location: path,
            off: lis.subset(i).find('input').prop('checked') === false
        });
    }
    messaging.tell({
        what: 'reloadAllFilters',
        switches: switches,
        update: update
    });
    cacheWasPurged = false;
};

/******************************************************************************/

var buttonApplyHandler = function() {
    reloadAll();
    uDom('#buttonApply').toggleClass('enabled', false);
};

/******************************************************************************/

var buttonUpdateHandler = function() {
    if ( needUpdate ) {
        reloadAll(true);
    }
};

/******************************************************************************/

var autoUpdateCheckboxChanged = function() {
    messaging.tell({
        what: 'userSettings',
        name: 'autoUpdate',
        value: this.checked
    });
};

/******************************************************************************/

var cosmeticSwitchChanged = function() {
    listDetails.cosmetic = this.checked;
    updateWidgets();
};

/******************************************************************************/

var renderExternalLists = function() {
    var onReceived = function(details) {
        uDom('#externalLists').val(details);
        externalLists = details;
    };
    messaging.ask({ what: 'userSettings', name: 'externalLists' }, onReceived);
};

/******************************************************************************/

var externalListsChangeHandler = function() {
    uDom('#externalListsApply').prop(
        'disabled',
        this.value.trim() === externalLists
    );
};

/******************************************************************************/

var externalListsApplyHandler = function() {
    externalLists = uDom('#externalLists').val();
    messaging.tell({
        what: 'userSettings',
        name: 'externalLists',
        value: externalLists
    });
    renderBlacklists();
    uDom('#externalListsApply').prop('disabled', true);
};

/******************************************************************************/

uDom.onLoad(function() {
    // Handle user interaction
    uDom('#autoUpdate').on('change', autoUpdateCheckboxChanged);
    uDom('#parseCosmeticFilters').on('change', cosmeticSwitchChanged);
    uDom('#buttonApply').on('click', buttonApplyHandler);
    uDom('#buttonUpdate').on('click', buttonUpdateHandler);
    uDom('#lists').on('change', '.listDetails > input', onListCheckboxChanged);
    uDom('#lists').on('click', '.listDetails > a:nth-of-type(1)', onListLinkClicked);
    uDom('#lists').on('click', 'span.purge', onPurgeClicked);
    uDom('#externalLists').on('input', externalListsChangeHandler);
    uDom('#externalListsApply').on('click', externalListsApplyHandler);

    renderBlacklists();
    renderExternalLists();
});

/******************************************************************************/

})();


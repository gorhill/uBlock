/*******************************************************************************

    µBlock - a browser extension to block requests.
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

var userListName = vAPI.i18n('1pPageName');
var listDetails = {};
var cosmeticSwitch = true;
var externalLists = '';
var cacheWasPurged = false;
var needUpdate = false;
var hasCachedContent = false;

/******************************************************************************/

var onMessage = function(msg) {
    switch ( msg.what ) {
        case 'allFilterListsReloaded':
            renderBlacklists();
            break;

        default:
            break;
    }
};

var messager = vAPI.messaging.channel('3p-filters.js', onMessage);

/******************************************************************************/

var renderNumber = function(value) {
    return value.toLocaleString();
};

/******************************************************************************/

// TODO: get rid of background page dependencies

var renderBlacklists = function() {
    uDom('body').toggleClass('busy', true);

    var listGroupTemplate = uDom('#templates .groupEntry');
    var listEntryTemplate = uDom('#templates .listEntry');
    var listStatsTemplate = vAPI.i18n('3pListsOfBlockedHostsPerListStats');
    var renderElapsedTimeToString = vAPI.i18n.renderElapsedTimeToString;

    // Assemble a pretty blacklist name if possible
    var listNameFromListKey = function(listKey) {
        if ( listKey === listDetails.userFiltersPath ) {
            return userListName;
        }
        var list = listDetails.current[listKey] || listDetails.available[listKey];
        var listTitle = list ? list.title : '';
        if ( listTitle === '' ) {
            return listKey;
        }
        return listTitle;
    };

    var liFromListEntry = function(listKey) {
        var elem, text;
        var entry = listDetails.available[listKey];
        var li = listEntryTemplate.clone();

        if ( entry.off !== true ) {
            li.descendants('input').attr('checked', '');
        }

        elem = li.descendants('a:nth-of-type(1)');
        elem.attr('href', encodeURI(listKey));
        elem.text(listNameFromListKey(listKey) + '\u200E');

        elem = li.descendants('a:nth-of-type(2)');
        if ( entry.homeDomain ) {
            elem.attr('href', 'http://' + encodeURI(entry.homeHostname));
            elem.text('(' + entry.homeDomain + ')');
            elem.css('display', '');
        }

        elem = li.descendants('span:nth-of-type(1)');
        text = listStatsTemplate
            .replace('{{used}}', renderNumber(!entry.off && !isNaN(+entry.entryUsedCount) ? entry.entryUsedCount : 0))
            .replace('{{total}}', !isNaN(+entry.entryCount) ? renderNumber(entry.entryCount) : '?');
        elem.text(text);

        // https://github.com/gorhill/uBlock/issues/104
        var asset = listDetails.cache[listKey] || {};

        // Update status
        if ( entry.off !== true ) {
            if ( asset.repoObsolete ) {
                li.descendants('span.status.new').css('display', '');
                needUpdate = true;
            } else if ( asset.cacheObsolete ) {
                li.descendants('span.status.obsolete').css('display', '');
                needUpdate = true;
            } else if ( entry.external && !asset.cached ) {
                li.descendants('span.status.obsolete').css('display', '');
                needUpdate = true;
            }
        }

        // In cache
        if ( asset.cached ) {
            elem = li.descendants('span.status.purge');
            elem.css('display', '');
            elem.attr('title', renderElapsedTimeToString(asset.lastModified));
            hasCachedContent = true;
        }
        return li;
    };

    var liFromListGroup = function(groupKey, listKeys) {
        var liGroup = listGroupTemplate.clone();
        liGroup.descendants('span').text(vAPI.i18n('3pGroup' + groupKey.charAt(0).toUpperCase() + groupKey.slice(1)));
        var ulGroup = liGroup.descendants('ul');
        if ( !listKeys ) {
            return liGroup;
        }
        listKeys.sort(function(a, b) {
            return (listDetails.available[a].title || "").localeCompare(listDetails.available[b].title || "");
        });
        for ( var i = 0; i < listKeys.length; i++ ) {
            ulGroup.append(liFromListEntry(listKeys[i]));
        }
        return liGroup;
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
        // Before all, set context vars
        listDetails = details;
        cosmeticSwitch = details.cosmetic;
        needUpdate = false;
        hasCachedContent = false;

        // Visually split the filter lists in purpose-based groups
        var ulLists = uDom('#lists').empty();
        var groups = groupsFromLists(details.available);
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
            ulLists.append(liFromListGroup(groupKey, groups[groupKey]));
            delete groups[groupKey];
        }
        // For all groups not covered above (if any left)
        groupKeys = Object.keys(groups);
        for ( i = 0; i < groupKeys.length; i++ ) {
            groupKey = groupKeys[i];
            ulLists.append(liFromListGroup(groupKey, groups[groupKey]));
        }

        uDom('#listsOfBlockedHostsPrompt').text(
            vAPI.i18n('3pListsOfBlockedHostsPrompt')
                .replace('{{netFilterCount}}', renderNumber(details.netFilterCount))
                .replace('{{cosmeticFilterCount}}', renderNumber(details.cosmeticFilterCount))
        );
        uDom('#autoUpdate').prop('checked', listDetails.autoUpdate === true);
        uDom('#parseCosmeticFilters').prop('checked', listDetails.cosmetic === true);

        updateWidgets();
    };

    messager.send({ what: 'getLists' }, onListsReceived);
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
    uDom('#buttonApply').toggleClass('disabled', !listsSelectionChanged());
    uDom('#buttonUpdate').toggleClass('disabled', !listsContentChanged());
    uDom('#buttonPurgeAll').toggleClass('disabled', !hasCachedContent);
    uDom('body').toggleClass('busy', false);
};

/******************************************************************************/

var onListCheckboxChanged = function() {
    var href = uDom(this).parent().descendants('a').first().attr('href');
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
    messager.send({
        what: 'gotoURL',
        details: {
            url: 'asset-viewer.html?url=' + uDom(this).attr('href'),
            select: true,
            index: -1
        }
    });
    ev.preventDefault();
};

/******************************************************************************/

var onPurgeClicked = function() {
    var button = uDom(this);
    var li = button.parent();
    var href = li.descendants('a').first().attr('href');
    if ( !href ) {
        return;
    }
    messager.send({ what: 'purgeCache', path: href });
    button.remove();
    if ( li.descendants('input').first().prop('checked') ) {
        cacheWasPurged = true;
        updateWidgets();
    }
};

/******************************************************************************/

var reloadAll = function(update) {
    // Loading may take a while when resources are fetched from remote
    // servers. We do not want the user to force reload while we are reloading.
    uDom('body').toggleClass('busy', true);

    // Reload blacklists
    messager.send({
        what: 'userSettings',
        name: 'parseAllABPHideFilters',
        value: listDetails.cosmetic
    });
    // Reload blacklists
    var switches = [];
    var lis = uDom('#lists .listEntry');
    var i = lis.length;
    var path;
    while ( i-- ) {
        path = lis
            .subset(i, 1)
            .descendants('a')
            .attr('href');
        switches.push({
            location: path,
            off: lis.subset(i, 1).descendants('input').prop('checked') === false
        });
    }
    messager.send({
        what: 'reloadAllFilters',
        switches: switches,
        update: update
    });
    cacheWasPurged = false;
};

/******************************************************************************/

var buttonApplyHandler = function() {
    reloadAll(false);
    uDom('#buttonApply').toggleClass('enabled', false);
};

/******************************************************************************/

var buttonUpdateHandler = function() {
    if ( needUpdate ) {
        reloadAll(true);
    }
};

/******************************************************************************/

var buttonPurgeAllHandler = function() {
    var onCompleted = function() {
        renderBlacklists();
    };
    messager.send({ what: 'purgeAllCaches' }, onCompleted);
};

/******************************************************************************/

var autoUpdateCheckboxChanged = function() {
    messager.send({
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
    messager.send({ what: 'userSettings', name: 'externalLists' }, onReceived);
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
    messager.send({
        what: 'userSettings',
        name: 'externalLists',
        value: externalLists
    });
    renderBlacklists();
    uDom('#externalListsApply').prop('disabled', true);
};

/******************************************************************************/

uDom.onLoad(function() {
    uDom('#autoUpdate').on('change', autoUpdateCheckboxChanged);
    uDom('#parseCosmeticFilters').on('change', cosmeticSwitchChanged);
    uDom('#buttonApply').on('click', buttonApplyHandler);
    uDom('#buttonUpdate').on('click', buttonUpdateHandler);
    uDom('#buttonPurgeAll').on('click', buttonPurgeAllHandler);
    uDom('#lists').on('change', '.listEntry > input', onListCheckboxChanged);
    uDom('#lists').on('click', '.listEntry > a:nth-of-type(1)', onListLinkClicked);
    uDom('#lists').on('click', 'span.purge', onPurgeClicked);
    uDom('#externalLists').on('input', externalListsChangeHandler);
    uDom('#externalListsApply').on('click', externalListsApplyHandler);

    renderBlacklists();
    renderExternalLists();
});

/******************************************************************************/

})();


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

    Home: https://github.com/chrisaljoudi/uBlock
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
            renderFilterLists();
            break;

        case 'forceUpdateAssetsProgress':
            renderBusyOverlay(true, msg.progress);
            if ( msg.done ) {
                messager.send({ what: 'reloadAllFilters' });
            }
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

var renderFilterLists = function() {
    var listGroupTemplate = uDom('#templates .groupEntry');
    var listEntryTemplate = uDom('#templates .listEntry');
    var listStatsTemplate = vAPI.i18n('3pListsOfBlockedHostsPerListStats');
    var renderElapsedTimeToString = vAPI.i18n.renderElapsedTimeToString;
    var lastUpdateString = vAPI.i18n('3pLastUpdate');

    // Don't lose the custom filter textbox
    uDom('#templates').append(uDom('#externalListsDiv'));

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
        if(entry.homeURL) {
            if(entry.homeURL.lastIndexOf("https:", 0) === 0) {
                li.addClass("secure", true);
            }
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

        // https://github.com/chrisaljoudi/uBlock/issues/104
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
            elem.attr('title', lastUpdateString.replace('{{ago}}', renderElapsedTimeToString(asset.lastModified)));
            hasCachedContent = true;
        }
        return li;
    };

    var listEntryCountFromGroup = function(listKeys) {
        if ( Array.isArray(listKeys) === false ) {
            return '';
        }
        var count = 0;
        var i = listKeys.length;
        while ( i-- ) {
            if ( listDetails.available[listKeys[i]].off !== true ) {
                count += 1;
            }
        }
        return count === 0 ? '' : '(' + count.toLocaleString() + ')';
    };

    var liFromListGroup = function(groupKey, listKeys) {
        var liGroup = listGroupTemplate.clone();
        if(groupKey === 'custom') {
            liGroup.append(uDom('#externalListsDiv'));
        }
        var groupName = vAPI.i18n('3pGroup' + groupKey.charAt(0).toUpperCase() + groupKey.slice(1));
        if ( groupName !== '' ) {
            liGroup.descendants('span.geName').text(groupName);
            liGroup.descendants('span.geCount').text(listEntryCountFromGroup(listKeys));
        }
        var ulGroup = liGroup.descendants('ul');
        if ( !listKeys ) {
            return liGroup;
        }
        listKeys.sort(function(a, b) {
            return (listDetails.available[a].title || '').localeCompare(listDetails.available[b].title || '');
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
        var ulLists = uDom('#lists').empty(), liGroup;
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
            liGroup = liFromListGroup(groupKey, groups[groupKey]);
            liGroup.toggleClass(
                'collapsed',
                vAPI.localStorage.getItem('collapseGroup' + (i + 1)) === 'y'
            );
            ulLists.append(liGroup);
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

        renderExternalLists();
        renderWidgets();
        renderBusyOverlay(details.manualUpdate, details.manualUpdateProgress);
    };

    messager.send({ what: 'getLists' }, onListsReceived);
};

/******************************************************************************/

// Progress must be normalized to [0, 1], or can be undefined.

var renderBusyOverlay = function(state, progress) {
    progress = progress || {};
    var showProgress = typeof progress.value === 'number';
    if ( showProgress ) {
        uDom('#busyOverlay > div:nth-of-type(2) > div:first-child').css(
            'width',
            (progress.value * 100).toFixed(1) + '%'
        );
        var text = progress.text || '';
        if ( text !== '' ) {
            uDom('#busyOverlay > div:nth-of-type(2) > div:last-child').text(text);
        }
    }
    uDom('#busyOverlay > div:nth-of-type(2)').css('display', showProgress ? '' : 'none');
    uDom('body').toggleClass('busy', !!state);
};

/******************************************************************************/

// This is to give a visual hint that the selection of blacklists has changed.

var renderWidgets = function() {
    uDom('#buttonApply').toggleClass('disabled', !listsSelectionChanged());
    uDom('#buttonUpdate').toggleClass('disabled', !listsContentChanged());
    uDom('#buttonPurgeAll').toggleClass('disabled', !hasCachedContent);
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

var onListCheckboxChanged = function() {
    var href = uDom(this).parent().descendants('a').first().attr('href');
    if ( typeof href !== 'string' ) {
        return;
    }
    if ( listDetails.available[href] === undefined ) {
        return;
    }
    listDetails.available[href].off = !this.checked;
    renderWidgets();
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
        renderWidgets();
    }
};

/******************************************************************************/

var selectFilterLists = function(callback) {
    // Cosmetic filtering switch
    messager.send({
        what: 'userSettings',
        name: 'parseAllABPHideFilters',
        value: listDetails.cosmetic
    });

    // Filter lists
    var switches = [];
    var lis = uDom('#lists .listEntry'), li;
    var i = lis.length;
    while ( i-- ) {
        li = lis.at(i);
        switches.push({
            location: li.descendants('a').attr('href'),
            off: li.descendants('input').prop('checked') === false
        });
    }

    messager.send({
        what: 'selectFilterLists',
        switches: switches
    }, callback);
};

/******************************************************************************/

var buttonApplyHandler = function() {
    uDom('#buttonApply').removeClass('enabled');

    renderBusyOverlay(true);

    var onSelectionDone = function() {
        messager.send({ what: 'reloadAllFilters' });
    };

    selectFilterLists(onSelectionDone);

    cacheWasPurged = false;
};

/******************************************************************************/

var buttonUpdateHandler = function() {
    uDom('#buttonUpdate').removeClass('enabled');

    if ( needUpdate ) {
        renderBusyOverlay(true);

        var onSelectionDone = function() {
            messager.send({ what: 'forceUpdateAssets' });
        };

        selectFilterLists(onSelectionDone);

        cacheWasPurged = false;
    }
};

/******************************************************************************/

var buttonPurgeAllHandler = function() {
    uDom('#buttonPurgeAll').removeClass('enabled');

    renderBusyOverlay(true);

    var onCompleted = function() {
        cacheWasPurged = true;
        renderFilterLists();
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
    renderWidgets();
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
    renderFilterLists();
    uDom('#externalListsApply').prop('disabled', true);
};

/******************************************************************************/

var groupEntryClickHandler = function() {
    var li = uDom(this).ancestors('.groupEntry');
    li.toggleClass('collapsed');
    var key = 'collapseGroup' + li.nthOfType();
    if ( li.hasClass('collapsed') ) {
        vAPI.localStorage.setItem(key, 'y');
    } else {
        vAPI.localStorage.removeItem(key);
    }
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
    uDom('#lists').on('click', '.groupEntry > span', groupEntryClickHandler);

    renderFilterLists();
});

/******************************************************************************/

})();


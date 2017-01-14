/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2017 Raymond Hill

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

/* global uDom */

'use strict';

/******************************************************************************/

(function() {

/******************************************************************************/

var listDetails = {};
var parseCosmeticFilters = true;
var ignoreGenericCosmeticFilters = false;
var externalLists = '';

/******************************************************************************/

var onMessage = function(msg) {
    switch ( msg.what ) {
    case 'assetUpdated':
        updateAssetStatus(msg);
        break;
    case 'staticFilteringDataChanged':
        renderFilterLists();
        break;
    default:
        break;
    }
};

var messaging = vAPI.messaging;
messaging.addChannelListener('dashboard', onMessage);

/******************************************************************************/

var renderNumber = function(value) {
    return value.toLocaleString();
};

/******************************************************************************/

var renderFilterLists = function() {
    var listGroupTemplate = uDom('#templates .groupEntry');
    var listEntryTemplate = uDom('#templates .listEntry');
    var listStatsTemplate = vAPI.i18n('3pListsOfBlockedHostsPerListStats');
    var renderElapsedTimeToString = vAPI.i18n.renderElapsedTimeToString;
    var lastUpdateString = vAPI.i18n('3pLastUpdate');

    // Assemble a pretty blacklist name if possible
    var listNameFromListKey = function(listKey) {
        var list = listDetails.current[listKey] || listDetails.available[listKey];
        var listTitle = list ? list.title : '';
        if ( listTitle === '' ) {
            return listKey;
        }
        return listTitle;
    };

    var liFromListEntry = function(listKey) {
        var entry = listDetails.available[listKey];
        var li = listEntryTemplate.clone();

        if ( entry.off !== true ) {
            li.descendants('input').attr('checked', '');
        }

        var elem = li.descendants('a:nth-of-type(1)');
        elem.attr('href', 'asset-viewer.html?url=' + encodeURI(listKey));
        elem.attr('type', 'text/html');
        elem.attr('data-listkey', listKey);
        elem.text(listNameFromListKey(listKey) + '\u200E');

        if ( entry.instructionURL ) {
            elem = li.descendants('a:nth-of-type(2)');
            elem.attr('href', entry.instructionURL);
            elem.css('display', '');
        }

        if ( entry.supportName ) {
            elem = li.descendants('a:nth-of-type(3)');
            elem.attr('href', entry.supportURL);
            elem.text('(' + entry.supportName + ')');
            elem.css('display', '');
        }

        elem = li.descendants('span.counts');
        var text = listStatsTemplate
            .replace('{{used}}', renderNumber(!entry.off && !isNaN(+entry.entryUsedCount) ? entry.entryUsedCount : 0))
            .replace('{{total}}', !isNaN(+entry.entryCount) ? renderNumber(entry.entryCount) : '?');
        elem.text(text);

        // https://github.com/chrisaljoudi/uBlock/issues/104
        var asset = listDetails.cache[listKey] || {};

        // https://github.com/gorhill/uBlock/issues/78
        // Badge for non-secure connection
        var remoteURL = asset.remoteURL;
        li.toggleClass(
            'unsecure',
            typeof remoteURL === 'string' && remoteURL.lastIndexOf('http:', 0) === 0
        );

        // Badge for update status
        li.toggleClass('obsolete', entry.off !== true && asset.obsolete === true);

        // Badge for cache status
        li.toggleClass('cached', asset.cached === true && asset.writeTime > 0);

        if ( asset.cached ) {
            elem = li.descendants('.status.purge').attr(
                'title',
                lastUpdateString.replace('{{ago}}', renderElapsedTimeToString(asset.writeTime))
            );
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
        parseCosmeticFilters = details.parseCosmeticFilters;
        ignoreGenericCosmeticFilters = details.ignoreGenericCosmeticFilters;

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

        uDom('#buttonUpdate').toggleClass('disabled', document.querySelector('#lists .listEntry.obsolete') === null);
        uDom('#autoUpdate').prop('checked', listDetails.autoUpdate === true);
        uDom('#parseCosmeticFilters').prop('checked', listDetails.parseCosmeticFilters === true);
        uDom('#ignoreGenericCosmeticFilters').prop('checked', listDetails.ignoreGenericCosmeticFilters === true);
        uDom('#listsOfBlockedHostsPrompt').text(
            vAPI.i18n('3pListsOfBlockedHostsPrompt')
                .replace('{{netFilterCount}}', renderNumber(details.netFilterCount))
                .replace('{{cosmeticFilterCount}}', renderNumber(details.cosmeticFilterCount))
        );

        renderWidgets();
    };

    messaging.send('dashboard', { what: 'getLists' }, onListsReceived);
};

/******************************************************************************/

// This is to give a visual hint that the selection of blacklists has changed.

var renderWidgets = function() {
    uDom('#buttonApply').toggleClass('disabled', !listsSelectionChanged());
    uDom('#buttonPurgeAll').toggleClass('disabled', document.querySelector('#lists .listEntry.cached') === null);
};

/******************************************************************************/

var updateAssetStatus = function(details) {
    var li = uDom('#lists .listEntry a[data-listkey="' + details.key + '"]').ancestors('.listEntry');
    li.toggleClass('obsolete', !details.cached);
    li.toggleClass('cached', details.cached);
};

/******************************************************************************/

// Return whether selection of lists changed.

var listsSelectionChanged = function() {
    if (
        listDetails.parseCosmeticFilters !== parseCosmeticFilters ||
        listDetails.parseCosmeticFilters &&
        listDetails.ignoreGenericCosmeticFilters !== ignoreGenericCosmeticFilters
    ) {
        return true;
    }

    var availableLists = listDetails.available,
        currentLists = listDetails.current,
        listKey, availableOff, currentOff;
    
    // This checks existing entries
    for ( listKey in availableLists ) {
        if ( availableLists.hasOwnProperty(listKey) === false ) { continue; }
        availableOff = availableLists[listKey].off === true;
        currentOff = currentLists[listKey] === undefined || currentLists[listKey].off === true;
        if ( availableOff !== currentOff ) { return true; }
    }

    // This checks removed entries
    for ( listKey in currentLists ) {
        if ( currentLists.hasOwnProperty(listKey) === false ) { continue; }
        currentOff = currentLists[listKey].off === true;
        availableOff = availableLists[listKey] === undefined || availableLists[listKey].off === true;
        if ( availableOff !== currentOff ) { return true; }
    }

    return false;
};

/******************************************************************************/

var onListCheckboxChanged = function() {
    var href = uDom(this).parent().descendants('a').first().attr('data-listkey');
    if ( typeof href !== 'string' ) { return; }
    if ( listDetails.available[href] === undefined ) { return; }
    listDetails.available[href].off = !this.checked;
    renderWidgets();
};

/******************************************************************************/

var onPurgeClicked = function() {
    var button = uDom(this);
    var li = button.parent();
    var listKey = li.descendants('a').first().attr('data-listkey');
    if ( !listKey ) { return; }

    messaging.send('dashboard', { what: 'purgeCache', path: listKey });
    button.remove();

    // If the cached version is purged, the installed version must be assumed
    // to be obsolete.
    // https://github.com/gorhill/uBlock/issues/1733
    // An external filter list must not be marked as obsolete, they will always
    // be fetched anyways if there is no cached copy.
    var entry = listDetails.current && listDetails.current[listKey];
    if ( entry && entry.off !== true ) {
        li.addClass('obsolete');
        uDom('#buttonUpdate').removeClass('disabled');
    }
    li.removeClass('cached');

    if ( li.descendants('input').first().prop('checked') ) {
        renderWidgets();
    }
};

/******************************************************************************/

var selectFilterLists = function(callback) {
    // Cosmetic filtering switch
    messaging.send('dashboard', {
        what: 'userSettings',
        name: 'parseAllABPHideFilters',
        value: listDetails.parseCosmeticFilters
    });
    messaging.send('dashboard', {
        what: 'userSettings',
        name: 'ignoreGenericCosmeticFilters',
        value: listDetails.ignoreGenericCosmeticFilters
    });

    // Filter lists
    var listKeys = [],
        lis = uDom('#lists .listEntry'), li,
        i = lis.length;
    while ( i-- ) {
        li = lis.at(i);
        if ( li.descendants('input').prop('checked') ) {
            listKeys.push(li.descendants('a').attr('data-listkey'));
        }
    }

    messaging.send(
        'dashboard',
        {
            what: 'selectFilterLists',
            keys: listKeys
        },
        callback
    );
};

/******************************************************************************/

var buttonApplyHandler = function() {
    uDom('#buttonApply').removeClass('enabled');
    var onSelectionDone = function() {
        messaging.send('dashboard', { what: 'reloadAllFilters' });
    };
    selectFilterLists(onSelectionDone);
};

/******************************************************************************/

var buttonUpdateHandler = function(ev) {
    uDom('#buttonUpdate').removeClass('enabled');
    var onSelectionDone = function() {
        messaging.send('dashboard', {
            what: 'forceUpdateAssets',
            fast: ev.ctrlKey
        });
        uDom('#buttonUpdate').addClass('disabled');
    };
    selectFilterLists(onSelectionDone);
};

/******************************************************************************/

var buttonPurgeAllHandler = function(ev) {
    uDom('#buttonPurgeAll').removeClass('enabled');
    messaging.send(
        'dashboard',
        {
            what: 'purgeAllCaches',
            hard: ev.ctrlKey && ev.shiftKey
        },
        renderFilterLists   
    );
};

/******************************************************************************/

var autoUpdateCheckboxChanged = function() {
    messaging.send(
        'dashboard',
        {
            what: 'userSettings',
            name: 'autoUpdate',
            value: this.checked
        }
    );
};

/******************************************************************************/

var cosmeticSwitchChanged = function() {
    listDetails.parseCosmeticFilters = uDom.nodeFromId('parseCosmeticFilters').checked;
    listDetails.ignoreGenericCosmeticFilters = uDom.nodeFromId('ignoreGenericCosmeticFilters').checked;
    renderWidgets();
};

/******************************************************************************/

var renderExternalLists = function() {
    var onReceived = function(details) {
        uDom('#externalLists').val(details);
        externalLists = details;
    };
    messaging.send(
        'dashboard',
        { what: 'userSettings', name: 'externalLists' },
        onReceived
    );
};

/******************************************************************************/

var externalListsChangeHandler = function() {
    uDom.nodeFromId('externalListsApply').disabled =
        uDom.nodeFromId('externalLists').value.trim() === externalLists.trim();
};

/******************************************************************************/

var externalListsApplyHandler = function() {
    externalLists = uDom.nodeFromId('externalLists').value;
    messaging.send(
        'dashboard',
        {
            what: 'userSettings',
            name: 'externalLists',
            value: externalLists
        }
    );
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

var getCloudData = function() {
    var bin = {
        parseCosmeticFilters: uDom.nodeFromId('parseCosmeticFilters').checked,
        ignoreGenericCosmeticFilters: uDom.nodeFromId('ignoreGenericCosmeticFilters').checked,
        selectedLists: [],
        externalLists: externalLists
    };

    var lis = uDom('#lists .listEntry'), li;
    var i = lis.length;
    while ( i-- ) {
        li = lis.at(i);
        if ( li.descendants('input').prop('checked') ) {
            bin.selectedLists.push(li.descendants('a').attr('data-listkey'));
        }
    }

    return bin;
};

var setCloudData = function(data, append) {
    if ( typeof data !== 'object' || data === null ) {
        return;
    }

    var elem, checked;

    elem = uDom.nodeFromId('parseCosmeticFilters');
    checked = data.parseCosmeticFilters === true || append && elem.checked;
    elem.checked = listDetails.parseCosmeticFilters = checked;

    elem = uDom.nodeFromId('ignoreGenericCosmeticFilters');
    checked = data.ignoreGenericCosmeticFilters === true || append && elem.checked;
    elem.checked = listDetails.ignoreGenericCosmeticFilters = checked;

    var lis = uDom('#lists .listEntry'), li, listKey;
    var i = lis.length;
    while ( i-- ) {
        li = lis.at(i);
        elem = li.descendants('input');
        listKey = li.descendants('a').attr('data-listkey');
        checked = data.selectedLists.indexOf(listKey) !== -1 ||
                  append && elem.prop('checked');
        elem.prop('checked', checked);
        listDetails.available[listKey].off = !checked;
    }

    elem = uDom.nodeFromId('externalLists');
    if ( !append ) {
        elem.value = '';
    }
    elem.value += data.externalLists || '';

    renderWidgets();
    externalListsChangeHandler();
};

self.cloud.onPush = getCloudData;
self.cloud.onPull = setCloudData;

/******************************************************************************/

uDom('#autoUpdate').on('change', autoUpdateCheckboxChanged);
uDom('#parseCosmeticFilters').on('change', cosmeticSwitchChanged);
uDom('#ignoreGenericCosmeticFilters').on('change', cosmeticSwitchChanged);
uDom('#buttonApply').on('click', buttonApplyHandler);
uDom('#buttonUpdate').on('click', buttonUpdateHandler);
uDom('#buttonPurgeAll').on('click', buttonPurgeAllHandler);
uDom('#lists').on('change', '.listEntry > input', onListCheckboxChanged);
uDom('#lists').on('click', 'span.purge', onPurgeClicked);
uDom('#externalLists').on('input', externalListsChangeHandler);
uDom('#externalListsApply').on('click', externalListsApplyHandler);
uDom('#lists').on('click', '.groupEntry > span', groupEntryClickHandler);

renderFilterLists();
renderExternalLists();

/******************************************************************************/

})();


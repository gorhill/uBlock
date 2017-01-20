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

var listDetails = {},
    filteringSettingsHash = '',
    externalLists = '';

/******************************************************************************/

var onMessage = function(msg) {
    switch ( msg.what ) {
    case 'assetUpdated':
        updateAssetStatus(msg);
        break;
    case 'staticFilteringDataChanged':
        filteringSettingsHash = [
            msg.parseCosmeticFilters,
            msg.ignoreGenericCosmeticFilters
        ].concat(msg.listKeys.sort()).join();
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

var renderFilterLists = function(first) {
    var listGroupTemplate = uDom('#templates .groupEntry'),
        listEntryTemplate = uDom('#templates .listEntry'),
        listStatsTemplate = vAPI.i18n('3pListsOfBlockedHostsPerListStats'),
        renderElapsedTimeToString = vAPI.i18n.renderElapsedTimeToString,
        lastUpdateString = vAPI.i18n('3pLastUpdate');

    // Assemble a pretty list name if possible
    var listNameFromListKey = function(listKey) {
        var list = listDetails.current[listKey] || listDetails.available[listKey];
        var listTitle = list ? list.title : '';
        if ( listTitle === '' ) { return listKey; }
        return listTitle;
    };

    var liFromListEntry = function(listKey, li) {
        var entry = listDetails.available[listKey],
            elem;
        if ( !li ) {
            li = listEntryTemplate.clone().nodeAt(0);
        }
        if ( li.getAttribute('data-listkey') !== listKey ) {
            li.setAttribute('data-listkey', listKey);
            elem = li.querySelector('input[type="checkbox"]');
            elem.checked = entry.off !== true;
            elem = li.querySelector('a:nth-of-type(1)');
            elem.setAttribute('href', 'asset-viewer.html?url=' + encodeURI(listKey));
            elem.setAttribute('type', 'text/html');
            elem.textContent = listNameFromListKey(listKey) + '\u200E';
            elem = li.querySelector('a:nth-of-type(2)');
            if ( entry.instructionURL ) {
                elem.setAttribute('href', entry.instructionURL);
                elem.style.setProperty('display', '');
            } else {
                elem.style.setProperty('display', 'none');
            }
            elem = li.querySelector('a:nth-of-type(3)');
            if ( entry.supportName ) {
                elem.setAttribute('href', entry.supportURL);
                elem.textContent = '(' + entry.supportName + ')';
                elem.style.setProperty('display', '');
            } else {
                elem.style.setProperty('display', 'none');
            }
        }
        elem = li.querySelector('span.counts');
        var text = listStatsTemplate
            .replace('{{used}}', renderNumber(!entry.off && !isNaN(+entry.entryUsedCount) ? entry.entryUsedCount : 0))
            .replace('{{total}}', !isNaN(+entry.entryCount) ? renderNumber(entry.entryCount) : '?');
        elem.textContent = text;

        // https://github.com/chrisaljoudi/uBlock/issues/104
        var asset = listDetails.cache[listKey] || {};

        // https://github.com/gorhill/uBlock/issues/78
        // Badge for non-secure connection
        var remoteURL = asset.remoteURL;
        li.classList.toggle(
            'unsecure',
            typeof remoteURL === 'string' && remoteURL.lastIndexOf('http:', 0) === 0
        );
        // Badge for update status
        li.classList.toggle('obsolete', entry.off !== true && asset.obsolete === true);
        // Badge for cache status
        li.classList.toggle('cached', asset.cached === true && asset.writeTime > 0);
        if ( asset.cached ) {
            li.querySelector('.status.purge').setAttribute(
                'title',
                lastUpdateString.replace('{{ago}}', renderElapsedTimeToString(asset.writeTime))
            );
        }
        li.classList.remove('updating');
        li.classList.remove('discard');
        return li;
    };

    var listEntryCountFromGroup = function(listKeys) {
        if ( Array.isArray(listKeys) === false ) { return ''; }
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
        var liGroup = document.querySelector('#lists > .groupEntry[data-groupkey="' + groupKey + '"]');
        if ( liGroup === null ) {
            liGroup = listGroupTemplate.clone().nodeAt(0);
            var groupName = vAPI.i18n('3pGroup' + groupKey.charAt(0).toUpperCase() + groupKey.slice(1));
            if ( groupName !== '' ) {
                liGroup.querySelector('.geName').textContent = groupName;
            }
        }
        if ( liGroup.querySelector('.geName:empty') === null ) {
            liGroup.querySelector('.geCount').textContent = listEntryCountFromGroup(listKeys);
        }
        var ulGroup = liGroup.querySelector('.listEntries');
        if ( !listKeys ) { return liGroup; }
        listKeys.sort(function(a, b) {
            return (listDetails.available[a].title || '').localeCompare(listDetails.available[b].title || '');
        });
        for ( var i = 0; i < listKeys.length; i++ ) {
            var liEntry = liFromListEntry(listKeys[i], ulGroup.children[i]);
            if ( liEntry.parentElement === null ) {
                ulGroup.appendChild(liEntry);
            }
        }
        return liGroup;
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

    var onListsReceived = function(details) {
        // Before all, set context vars
        listDetails = details;

        // Incremental rendering: this will allow us to easily discard unused
        // DOM list entries.
        uDom('#lists .listEntries .listEntry').addClass('discard');

        // Visually split the filter lists in purpose-based groups
        var ulLists = document.querySelector('#lists'),
            groups = groupsFromLists(details.available),
            liGroup, i, groupKey,
            groupKeys = [
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
            liGroup.setAttribute('data-groupkey', groupKey);
            liGroup.classList.toggle(
                'collapsed',
                vAPI.localStorage.getItem('collapseGroup' + (i + 1)) === 'y'
            );
            if ( liGroup.parentElement === null ) {
                ulLists.appendChild(liGroup);
            }
            delete groups[groupKey];
        }
        // For all groups not covered above (if any left)
        groupKeys = Object.keys(groups);
        for ( i = 0; i < groupKeys.length; i++ ) {
            groupKey = groupKeys[i];
            ulLists.appendChild(liFromListGroup(groupKey, groups[groupKey]));
        }

        uDom('#lists .listEntries .listEntry.discard').remove();
        uDom('#buttonUpdate').toggleClass('disabled', document.querySelector('#lists .listEntry.obsolete') === null);
        uDom('#autoUpdate').prop('checked', listDetails.autoUpdate === true);
        uDom('#listsOfBlockedHostsPrompt').text(
            vAPI.i18n('3pListsOfBlockedHostsPrompt')
                .replace('{{netFilterCount}}', renderNumber(details.netFilterCount))
                .replace('{{cosmeticFilterCount}}', renderNumber(details.cosmeticFilterCount))
        );

        // Compute a hash of the settings so that we can keep track of changes
        // affecting the loading of filter lists.
        if ( first ) {
            uDom('#parseCosmeticFilters').prop('checked', listDetails.parseCosmeticFilters === true);
            uDom('#ignoreGenericCosmeticFilters').prop('checked', listDetails.ignoreGenericCosmeticFilters === true);
            filteringSettingsHash = hashFromCurrentFromSettings();
        }
        renderWidgets();
    };

    messaging.send('dashboard', { what: 'getLists' }, onListsReceived);
};

/******************************************************************************/

// This is to give a visual hint that the selection of blacklists has changed.

var renderWidgets = function() {
    uDom('#buttonApply').toggleClass('disabled', filteringSettingsHash === hashFromCurrentFromSettings());
    uDom('#buttonPurgeAll').toggleClass('disabled', document.querySelector('#lists .listEntry.cached') === null);
    uDom('#buttonUpdate').toggleClass('disabled', document.querySelector('#lists .listEntry.obsolete > input[type="checkbox"]:checked') === null);
};

/******************************************************************************/

var updateAssetStatus = function(details) {
    var li = uDom('#lists .listEntry[data-listkey="' + details.key + '"]');
    li.toggleClass('obsolete', !details.cached);
    li.toggleClass('cached', details.cached);
    li.removeClass('updating');
    renderWidgets();
};

/*******************************************************************************

    Compute a hash from all the settings affecting how filter lists are loaded
    in memory.

**/

var hashFromCurrentFromSettings = function() {
    var hash = [
        document.getElementById('parseCosmeticFilters').checked,
        document.getElementById('ignoreGenericCosmeticFilters').checked
    ];
    var listHash = [],
        listEntries = document.querySelectorAll('#lists .listEntry[data-listkey]'),
        liEntry,
        i = listEntries.length;
    while ( i-- ) {
        liEntry = listEntries[i];
        if ( liEntry.querySelector('input[type="checkbox"]:checked') !== null ) {
            listHash.push(liEntry.getAttribute('data-listkey'));
        }
    }
    return hash.concat(listHash.sort()).join();
};

/******************************************************************************/

var onFilteringSettingsChanged = function() {
    renderWidgets();
};

/******************************************************************************/

var onPurgeClicked = function() {
    var button = uDom(this),
        liEntry = button.ancestors('[data-listkey]'),
        listKey = liEntry.attr('data-listkey');
    if ( !listKey ) { return; }

    messaging.send('dashboard', { what: 'purgeCache', assetKey: listKey });

    // If the cached version is purged, the installed version must be assumed
    // to be obsolete.
    // https://github.com/gorhill/uBlock/issues/1733
    // An external filter list must not be marked as obsolete, they will always
    // be fetched anyways if there is no cached copy.
    var entry = listDetails.current && listDetails.current[listKey];
    if ( entry && entry.off !== true ) {
        liEntry.addClass('obsolete');
        uDom('#buttonUpdate').removeClass('disabled');
    }
    liEntry.removeClass('cached');

    if ( liEntry.descendants('input').first().prop('checked') ) {
        renderWidgets();
    }
};

/******************************************************************************/

var selectFilterLists = function(callback) {
    // Cosmetic filtering switch
    messaging.send('dashboard', {
        what: 'userSettings',
        name: 'parseAllABPHideFilters',
        value: document.getElementById('parseCosmeticFilters').checked
    });
    messaging.send('dashboard', {
        what: 'userSettings',
        name: 'ignoreGenericCosmeticFilters',
        value: document.getElementById('ignoreGenericCosmeticFilters').checked
    });

    // Filter lists
    var listKeys = [],
        liEntries = document.querySelectorAll('#lists .listEntry[data-listkey]'),
        i = liEntries.length,
        liEntry;
    while ( i-- ) {
        liEntry = liEntries[i];
        if ( liEntry.querySelector('input[type="checkbox"]:checked') !== null ) {
            listKeys.push(liEntry.getAttribute('data-listkey'));
        }
    }

    messaging.send(
        'dashboard',
        { what: 'selectFilterLists', keys: listKeys },
        callback
    );

    filteringSettingsHash = hashFromCurrentFromSettings();
};

/******************************************************************************/

var buttonApplyHandler = function() {
    uDom('#buttonApply').removeClass('enabled');
    var onSelectionDone = function() {
        messaging.send('dashboard', { what: 'reloadAllFilters' });
    };
    selectFilterLists(onSelectionDone);
    renderWidgets();
};

/******************************************************************************/

var buttonUpdateHandler = function() {
    var onSelectionDone = function() {
        uDom('#lists .listEntry.obsolete').addClass('updating');
        messaging.send('dashboard', { what: 'forceUpdateAssets' });
    };
    selectFilterLists(onSelectionDone);
    renderWidgets();
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

var toCloudData = function() {
    var bin = {
        parseCosmeticFilters: uDom.nodeFromId('parseCosmeticFilters').checked,
        ignoreGenericCosmeticFilters: uDom.nodeFromId('ignoreGenericCosmeticFilters').checked,
        selectedLists: [],
        externalLists: externalLists
    };

    var liEntries = uDom('#lists .listEntry'), liEntry;
    var i = liEntries.length;
    while ( i-- ) {
        liEntry = liEntries.at(i);
        if ( liEntry.descendants('input').prop('checked') ) {
            bin.selectedLists.push(liEntry.attr('data-listkey'));
        }
    }

    return bin;
};

var fromCloudData = function(data, append) {
    if ( typeof data !== 'object' || data === null ) { return; }

    var elem, checked, i, n;

    elem = uDom.nodeFromId('parseCosmeticFilters');
    checked = data.parseCosmeticFilters === true || append && elem.checked;
    elem.checked = listDetails.parseCosmeticFilters = checked;

    elem = uDom.nodeFromId('ignoreGenericCosmeticFilters');
    checked = data.ignoreGenericCosmeticFilters === true || append && elem.checked;
    elem.checked = listDetails.ignoreGenericCosmeticFilters = checked;

    var listKey;
    for ( i = 0, n = data.selectedLists.length; i < n; i++ ) {
        listKey = data.selectedLists[i];
        if ( listDetails.aliases[listKey] ) {
            data.selectedLists[i] = listDetails.aliases[listKey];
        }
    }
    var selectedSet = new Set(data.selectedLists),
        listEntries = uDom('#lists .listEntry'),
        listEntry, input;
    for ( i = 0, n = listEntries.length; i < n; i++ ) {
        listEntry = listEntries.at(i);
        listKey = listEntry.attr('data-listkey');
        input = listEntry.descendants('input').first();
        if ( append && input.prop('checked') ) { continue; }
        input.prop('checked', selectedSet.has(listKey) );
    }

    elem = uDom.nodeFromId('externalLists');
    if ( !append ) { elem.value = ''; }
    elem.value += data.externalLists || '';

    renderWidgets();
    externalListsChangeHandler();
};

self.cloud.onPush = toCloudData;
self.cloud.onPull = fromCloudData;

/******************************************************************************/

uDom('#autoUpdate').on('change', autoUpdateCheckboxChanged);
uDom('#parseCosmeticFilters').on('change', onFilteringSettingsChanged);
uDom('#ignoreGenericCosmeticFilters').on('change', onFilteringSettingsChanged);
uDom('#buttonApply').on('click', buttonApplyHandler);
uDom('#buttonUpdate').on('click', buttonUpdateHandler);
uDom('#buttonPurgeAll').on('click', buttonPurgeAllHandler);
uDom('#lists').on('change', '.listEntry > input', onFilteringSettingsChanged);
uDom('#lists').on('click', 'span.purge', onPurgeClicked);
uDom('#externalLists').on('input', externalListsChangeHandler);
uDom('#externalListsApply').on('click', externalListsApplyHandler);
uDom('#lists').on('click', '.groupEntry > span', groupEntryClickHandler);

renderFilterLists(true);
renderExternalLists();

/******************************************************************************/

})();


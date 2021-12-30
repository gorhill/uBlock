/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-present Raymond Hill

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

{
// >>>>> start of local scope

/******************************************************************************/

const lastUpdateTemplateString = vAPI.i18n('3pLastUpdate');
const obsoleteTemplateString = vAPI.i18n('3pExternalListObsolete');
const reValidExternalList = /^[a-z-]+:\/\/(?:\S+\/\S*|\/\S+)/m;

let listDetails = {};
let filteringSettingsHash = '';
let hideUnusedSet = new Set([ '*' ]);

/******************************************************************************/

const messaging = vAPI.messaging;

vAPI.broadcastListener.add(msg => {
    switch ( msg.what ) {
    case 'assetUpdated':
        updateAssetStatus(msg);
        break;
    case 'assetsUpdated':
        document.body.classList.remove('updating');
        renderWidgets();
        break;
    case 'staticFilteringDataChanged':
        renderFilterLists();
        break;
    default:
        break;
    }
});

/******************************************************************************/

const renderNumber = function(value) {
    return value.toLocaleString();
};

/******************************************************************************/

const renderFilterLists = function(soft) {
    const listGroupTemplate = uDom('#templates .groupEntry');
    const listEntryTemplate = uDom('#templates .listEntry');
    const listStatsTemplate = vAPI.i18n('3pListsOfBlockedHostsPerListStats');
    const renderElapsedTimeToString = vAPI.i18n.renderElapsedTimeToString;
    const groupNames = new Map([ [ 'user', '' ] ]);

    // Assemble a pretty list name if possible
    const listNameFromListKey = function(listKey) {
        const list = listDetails.current[listKey] || listDetails.available[listKey];
        const listTitle = list ? list.title : '';
        if ( listTitle === '' ) { return listKey; }
        return listTitle;
    };

    const liFromListEntry = function(listKey, li, hideUnused) {
        const entry = listDetails.available[listKey];
        if ( !li ) {
            li = listEntryTemplate.clone().nodeAt(0);
        }
        const on = entry.off !== true;
        li.classList.toggle('checked', on);
        let elem;
        if ( li.getAttribute('data-listkey') !== listKey ) {
            li.setAttribute('data-listkey', listKey);
            elem = li.querySelector('input[type="checkbox"]');
            elem.checked = on;
            elem = li.querySelector('.listname');
            elem.textContent = listNameFromListKey(listKey);
            elem = li.querySelector('a.content');
            elem.setAttribute('href', 'asset-viewer.html?url=' + encodeURIComponent(listKey));
            elem.setAttribute('type', 'text/html');
            li.classList.remove('toRemove');
            if ( entry.supportName ) {
                li.classList.add('support');
                elem = li.querySelector('a.support');
                elem.setAttribute('href', entry.supportURL);
                elem.setAttribute('title', entry.supportName);
            } else {
                li.classList.remove('support');
            }
            if ( entry.external ) {
                li.classList.add('external');
            } else {
                li.classList.remove('external');
            }
            if ( entry.instructionURL ) {
                li.classList.add('mustread');
                elem = li.querySelector('a.mustread');
                elem.setAttribute('href', entry.instructionURL);
            } else {
                li.classList.remove('mustread');
            }
            li.classList.toggle('isDefault', entry.isDefault === true);
            li.classList.toggle('unused', hideUnused && !on);
        }
        // https://github.com/gorhill/uBlock/issues/1429
        if ( !soft ) {
            li.querySelector('input[type="checkbox"]').checked = on;
        }
        elem = li.querySelector('span.counts');
        let text = '';
        if ( !isNaN(+entry.entryUsedCount) && !isNaN(+entry.entryCount) ) {
            text = listStatsTemplate
                .replace('{{used}}', renderNumber(on ? entry.entryUsedCount : 0))
                .replace('{{total}}', renderNumber(entry.entryCount));
        }
        elem.textContent = text;
        // https://github.com/chrisaljoudi/uBlock/issues/104
        const asset = listDetails.cache[listKey] || {};
        const remoteURL = asset.remoteURL;
        li.classList.toggle(
            'unsecure',
            typeof remoteURL === 'string' && remoteURL.lastIndexOf('http:', 0) === 0
        );
        li.classList.toggle('failed', asset.error !== undefined);
        li.classList.toggle('obsolete', asset.obsolete === true);
        const lastUpdateString = lastUpdateTemplateString.replace(
            '{{ago}}',
            renderElapsedTimeToString(asset.writeTime || 0)
        );
        if ( asset.obsolete === true ) {
            let title = obsoleteTemplateString;
            if ( asset.cached && asset.writeTime !== 0 ) {
                title += '\n' + lastUpdateString;
            }
            li.querySelector('.status.obsolete').setAttribute('title', title);
        }
        if ( asset.cached === true ) {
            li.classList.add('cached');
            li.querySelector('.status.cache').setAttribute(
                'title',
                lastUpdateString
            );
        } else {
            li.classList.remove('cached');
        }
        li.classList.remove('discard');
        return li;
    };

    const listEntryCountFromGroup = function(listKeys) {
        if ( Array.isArray(listKeys) === false ) { return ''; }
        let count = 0,
            total = 0;
        for ( const listKey of listKeys ) {
            if ( listDetails.available[listKey].off !== true ) {
                count += 1;
            }
            total += 1;
        }
        return total !== 0 ?
            `(${count.toLocaleString()}/${total.toLocaleString()})` :
            '';
    };

    const liFromListGroup = function(groupKey, listKeys) {
        let liGroup = document.querySelector(`#lists > .groupEntry[data-groupkey="${groupKey}"]`);
        if ( liGroup === null ) {
            liGroup = listGroupTemplate.clone().nodeAt(0);
            let groupName = groupNames.get(groupKey);
            if ( groupName === undefined ) {
                groupName = vAPI.i18n('3pGroup' + groupKey.charAt(0).toUpperCase() + groupKey.slice(1));
                groupNames.set(groupKey, groupName);
            }
            if ( groupName !== '' ) {
                liGroup.querySelector('.geName').textContent = groupName;
            }
        }
        if ( liGroup.querySelector('.geName:empty') === null ) {
            liGroup.querySelector('.geCount').textContent = listEntryCountFromGroup(listKeys);
        }
        let hideUnused = mustHideUnusedLists(groupKey);
        liGroup.classList.toggle('hideUnused', hideUnused);
        let ulGroup = liGroup.querySelector('.listEntries');
        if ( !listKeys ) { return liGroup; }
        listKeys.sort(function(a, b) {
            return (listDetails.available[a].title || '').localeCompare(listDetails.available[b].title || '');
        });
        for ( let i = 0; i < listKeys.length; i++ ) {
            let liEntry = liFromListEntry(
                listKeys[i],
                ulGroup.children[i],
                hideUnused
            );
            if ( liEntry.parentElement === null ) {
                ulGroup.appendChild(liEntry);
            }
        }
        return liGroup;
    };

    const groupsFromLists = function(lists) {
        let groups = new Map();
        let listKeys = Object.keys(lists);
        for ( let listKey of listKeys ) {
            let list = lists[listKey];
            let groupKey = list.group || 'nogroup';
            if ( groupKey === 'social' ) {
                groupKey = 'annoyances';
            }
            let memberKeys = groups.get(groupKey);
            if ( memberKeys === undefined ) {
                groups.set(groupKey, (memberKeys = []));
            }
            memberKeys.push(listKey);
        }
        return groups;
    };

    const onListsReceived = function(details) {
        // Before all, set context vars
        listDetails = details;

        // "My filters" will now sit in its own group. The following code
        // ensures smooth transition.
        listDetails.available['user-filters'].group = 'user';

        // Incremental rendering: this will allow us to easily discard unused
        // DOM list entries.
        uDom('#lists .listEntries .listEntry[data-listkey]').addClass('discard');

        // Remove import widget while we recreate list of lists.
        const importWidget = uDom('.listEntry.toImport').detach();

        // Visually split the filter lists in purpose-based groups
        const ulLists = document.querySelector('#lists');
        const groups = groupsFromLists(details.available);
        const groupKeys = [
            'user',
            'default',
            'ads',
            'privacy',
            'malware',
            'annoyances',
            'multipurpose',
            'regions',
            'custom'
        ];
        document.body.classList.toggle('hideUnused', mustHideUnusedLists('*'));
        for ( let i = 0; i < groupKeys.length; i++ ) {
            let groupKey = groupKeys[i];
            let liGroup = liFromListGroup(groupKey, groups.get(groupKey));
            liGroup.setAttribute('data-groupkey', groupKey);
            if ( liGroup.parentElement === null ) {
                ulLists.appendChild(liGroup);
            }
            groups.delete(groupKey);
        }
        // For all groups not covered above (if any left)
        for ( const groupKey of Object.keys(groups) ) {
            ulLists.appendChild(liFromListGroup(groupKey, groupKey));
        }

        uDom('#lists .listEntries .listEntry.discard').remove();

        // Re-insert import widget.
        uDom('[data-groupkey="custom"] .listEntries').append(importWidget);

        uDom.nodeFromId('autoUpdate').checked =
            listDetails.autoUpdate === true;
        uDom.nodeFromId('listsOfBlockedHostsPrompt').textContent =
            vAPI.i18n('3pListsOfBlockedHostsPrompt')
                .replace(
                    '{{netFilterCount}}',
                    renderNumber(details.netFilterCount)
                )
                .replace(
                    '{{cosmeticFilterCount}}',
                    renderNumber(details.cosmeticFilterCount)
                );
        uDom.nodeFromId('parseCosmeticFilters').checked =
            listDetails.parseCosmeticFilters === true;
        uDom.nodeFromId('ignoreGenericCosmeticFilters').checked =
            listDetails.ignoreGenericCosmeticFilters === true;
        uDom.nodeFromId('suspendUntilListsAreLoaded').checked =
            listDetails.suspendUntilListsAreLoaded === true;

        // Compute a hash of the settings so that we can keep track of changes
        // affecting the loading of filter lists.
        if ( !soft ) {
            filteringSettingsHash = hashFromCurrentFromSettings();
        }

        // https://github.com/gorhill/uBlock/issues/2394
        document.body.classList.toggle('updating', listDetails.isUpdating);

        renderWidgets();
    };

    messaging.send('dashboard', {
        what: 'getLists',
    }).then(details => {
        onListsReceived(details);
    });
};

/******************************************************************************/

const renderWidgets = function() {
    let cl = uDom.nodeFromId('buttonApply').classList;
    cl.toggle(
        'disabled',
        filteringSettingsHash === hashFromCurrentFromSettings()
    );
    const updating = document.body.classList.contains('updating');
    cl = uDom.nodeFromId('buttonUpdate').classList;
    cl.toggle('active', updating);
    cl.toggle(
        'disabled',
        updating === false &&
        document.querySelector('#lists .listEntry.obsolete:not(.toRemove) input[type="checkbox"]:checked') === null
        );
    cl = uDom.nodeFromId('buttonPurgeAll').classList;
    cl.toggle(
        'disabled',
        updating || document.querySelector('#lists .listEntry.cached:not(.obsolete)') === null
    );
};

/******************************************************************************/

const updateAssetStatus = function(details) {
    const li = document.querySelector(
        '#lists .listEntry[data-listkey="' + details.key + '"]'
    );
    if ( li === null ) { return; }
    li.classList.toggle('failed', !!details.failed);
    li.classList.toggle('obsolete', !details.cached);
    li.classList.toggle('cached', !!details.cached);
    if ( details.cached ) {
        li.querySelector('.status.cache').setAttribute(
            'title',
            lastUpdateTemplateString.replace(
                '{{ago}}',
                vAPI.i18n.renderElapsedTimeToString(Date.now())
            )
        );
    }
    renderWidgets();
};

/*******************************************************************************

    Compute a hash from all the settings affecting how filter lists are loaded
    in memory.

**/

const hashFromCurrentFromSettings = function() {
    const hash = [
        uDom.nodeFromId('parseCosmeticFilters').checked,
        uDom.nodeFromId('ignoreGenericCosmeticFilters').checked
    ];
    const listHash = [];
    const listEntries = document.querySelectorAll('#lists .listEntry[data-listkey]:not(.toRemove)');
    for ( const liEntry of listEntries ) {
        if ( liEntry.querySelector('input[type="checkbox"]:checked') !== null ) {
            listHash.push(liEntry.getAttribute('data-listkey'));
        }
    }
    hash.push(
        listHash.sort().join(),
        uDom.nodeFromId('importLists').checked &&
            reValidExternalList.test(uDom.nodeFromId('externalLists').value),
        document.querySelector('#lists .listEntry.toRemove') !== null
    );
    return hash.join();
};

/******************************************************************************/

const onListsetChanged = function(ev) {
    const input = ev.target;
    const li = input.closest('.listEntry');
    li.classList.toggle('checked', input.checked);
    onFilteringSettingsChanged();
};

/******************************************************************************/

const onFilteringSettingsChanged = function() {
    renderWidgets();
};

/******************************************************************************/

const onRemoveExternalList = function(ev) {
    const liEntry = ev.target.closest('[data-listkey]');
    if ( liEntry === null ) { return; }
    liEntry.classList.toggle('toRemove');
    renderWidgets();
};

/******************************************************************************/

const onPurgeClicked = function(ev) {
    const liEntry = ev.target.closest('[data-listkey]');
    const listKey = liEntry.getAttribute('data-listkey') || '';
    if ( listKey === '' ) { return; }

    messaging.send('dashboard', {
        what: 'purgeCache',
        assetKey: listKey,
    });

    // If the cached version is purged, the installed version must be assumed
    // to be obsolete.
    // https://github.com/gorhill/uBlock/issues/1733
    //   An external filter list must not be marked as obsolete, they will
    //   always be fetched anyways if there is no cached copy.
    liEntry.classList.add('obsolete');
    liEntry.classList.remove('cached');

    if ( liEntry.querySelector('input[type="checkbox"]').checked ) {
        renderWidgets();
    }
};

/******************************************************************************/

const selectFilterLists = async function() {
    // Cosmetic filtering switch
    messaging.send('dashboard', {
        what: 'userSettings',
        name: 'parseAllABPHideFilters',
        value: uDom.nodeFromId('parseCosmeticFilters').checked,
    });
    messaging.send('dashboard', {
        what: 'userSettings',
        name: 'ignoreGenericCosmeticFilters',
        value: uDom.nodeFromId('ignoreGenericCosmeticFilters').checked,
    });

    // Filter lists to select
    const toSelect = [];
    for (
        const liEntry of
        document.querySelectorAll('#lists .listEntry[data-listkey]:not(.toRemove)')
    ) {
        if ( liEntry.querySelector('input[type="checkbox"]:checked') !== null ) {
            toSelect.push(liEntry.getAttribute('data-listkey'));
        }
    }

    // External filter lists to remove
    const toRemove = [];
    for (
        const liEntry of
        document.querySelectorAll('#lists .listEntry.toRemove[data-listkey]')
    ) {
        toRemove.push(liEntry.getAttribute('data-listkey'));
    }

    // External filter lists to import
    const externalListsElem = document.getElementById('externalLists');
    const toImport = externalListsElem.value.trim();
    {
        const liEntry = externalListsElem.closest('.listEntry');
        liEntry.classList.remove('checked');
        liEntry.querySelector('input[type="checkbox"]').checked = false;
        externalListsElem.value = '';
    }

    await messaging.send('dashboard', {
        what: 'applyFilterListSelection',
        toSelect: toSelect,
        toImport: toImport,
        toRemove: toRemove,
    });

    filteringSettingsHash = hashFromCurrentFromSettings();
};

/******************************************************************************/

const buttonApplyHandler = async function() {
    uDom('#buttonApply').removeClass('enabled');
    await selectFilterLists();
    renderWidgets();
    messaging.send('dashboard', { what: 'reloadAllFilters' });
};

/******************************************************************************/

const buttonUpdateHandler = async function() {
    await selectFilterLists();
    document.body.classList.add('updating');
    renderWidgets();
    messaging.send('dashboard', { what: 'forceUpdateAssets' });
};

/******************************************************************************/

const buttonPurgeAllHandler = async function(hard) {
    uDom('#buttonPurgeAll').removeClass('enabled');
    await messaging.send('dashboard', {
        what: 'purgeAllCaches',
        hard,
    });
    renderFilterLists(true);
};

/******************************************************************************/

const userSettingCheckboxChanged = function() {
    const target = event.target;
    messaging.send('dashboard', {
        what: 'userSettings',
        name: target.id,
        value: target.checked,
    });
};

/******************************************************************************/

// Collapsing of unused lists.

const mustHideUnusedLists = function(which) {
    const hideAll = hideUnusedSet.has('*');
    if ( which === '*' ) { return hideAll; }
    return hideUnusedSet.has(which) !== hideAll;
};

const toggleHideUnusedLists = function(which) {
    const doesHideAll = hideUnusedSet.has('*');
    let groupSelector;
    let mustHide;
    if ( which === '*' ) {
        mustHide = doesHideAll === false;
        groupSelector = '';
        hideUnusedSet.clear();
        if ( mustHide ) {
            hideUnusedSet.add(which);
        }
        document.body.classList.toggle('hideUnused', mustHide);
        uDom('.groupEntry[data-groupkey]').toggleClass('hideUnused', mustHide);
    } else {
        const doesHide = hideUnusedSet.has(which);
        if ( doesHide ) {
            hideUnusedSet.delete(which);
        } else {
            hideUnusedSet.add(which);
        }
        mustHide = doesHide === doesHideAll;
        groupSelector = '.groupEntry[data-groupkey="' + which + '"] ';
        uDom(groupSelector).toggleClass('hideUnused', mustHide);
    }
    uDom(groupSelector + '.listEntry input[type="checkbox"]:not(:checked)')
        .ancestors('.listEntry[data-listkey]')
        .toggleClass('unused', mustHide);
    vAPI.localStorage.setItem(
        'hideUnusedFilterLists',
        Array.from(hideUnusedSet)
    );
};

const revealHiddenUsedLists = function() {
    uDom('#lists .listEntry.unused input[type="checkbox"]:checked')
        .ancestors('.listEntry[data-listkey]')
        .removeClass('unused');
};

uDom('#listsOfBlockedHostsPrompt').on('click', function() {
    toggleHideUnusedLists('*');
});

uDom('#lists').on('click', '.groupEntry[data-groupkey] > .geDetails', function(ev) {
    toggleHideUnusedLists(
        uDom(ev.target)
            .ancestors('.groupEntry[data-groupkey]')
            .attr('data-groupkey')
    );
});

// Initialize from saved state.
vAPI.localStorage.getItemAsync('hideUnusedFilterLists').then(value => {
    if ( Array.isArray(value) ) {
        hideUnusedSet = new Set(value);
    }
});

/******************************************************************************/

// Cloud-related.

const toCloudData = function() {
    const bin = {
        parseCosmeticFilters: uDom.nodeFromId('parseCosmeticFilters').checked,
        ignoreGenericCosmeticFilters: uDom.nodeFromId('ignoreGenericCosmeticFilters').checked,
        selectedLists: []
    };

    const liEntries = document.querySelectorAll('#lists .listEntry');
    for ( const liEntry of liEntries ) {
        if ( liEntry.querySelector('input').checked ) {
            bin.selectedLists.push(liEntry.getAttribute('data-listkey'));
        }
    }

    return bin;
};

const fromCloudData = function(data, append) {
    if ( typeof data !== 'object' || data === null ) { return; }

    let elem, checked;

    elem = uDom.nodeFromId('parseCosmeticFilters');
    checked = data.parseCosmeticFilters === true || append && elem.checked;
    elem.checked = listDetails.parseCosmeticFilters = checked;

    elem = uDom.nodeFromId('ignoreGenericCosmeticFilters');
    checked = data.ignoreGenericCosmeticFilters === true || append && elem.checked;
    elem.checked = listDetails.ignoreGenericCosmeticFilters = checked;

    const selectedSet = new Set(data.selectedLists);
    const listEntries = uDom('#lists .listEntry');
    for ( let i = 0, n = listEntries.length; i < n; i++ ) {
        const listEntry = listEntries.at(i);
        const listKey = listEntry.attr('data-listkey');
        const hasListKey = selectedSet.has(listKey);
        selectedSet.delete(listKey);
        const input = listEntry.descendants('input').first();
        if ( append && input.prop('checked') ) { continue; }
        input.prop('checked', hasListKey);
    }

    // If there are URL-like list keys left in the selected set, import them.
    for ( const listKey of selectedSet ) {
        if ( reValidExternalList.test(listKey) === false ) {
            selectedSet.delete(listKey);
        }
    }
    if ( selectedSet.size !== 0 ) {
        elem = uDom.nodeFromId('externalLists');
        if ( append ) {
            if ( elem.value.trim() !== '' ) { elem.value += '\n'; }
        } else {
            elem.value = '';
        }
        elem.value += Array.from(selectedSet).join('\n');
        uDom.nodeFromId('importLists').checked = true;
    }

    revealHiddenUsedLists();
    renderWidgets();
};

self.cloud.onPush = toCloudData;
self.cloud.onPull = fromCloudData;

/******************************************************************************/

self.hasUnsavedData = function() {
    return hashFromCurrentFromSettings() !== filteringSettingsHash;
};

/******************************************************************************/

uDom('#autoUpdate').on('change', userSettingCheckboxChanged);
uDom('#parseCosmeticFilters').on('change', onFilteringSettingsChanged);
uDom('#ignoreGenericCosmeticFilters').on('change', onFilteringSettingsChanged);
uDom('#suspendUntilListsAreLoaded').on('change', userSettingCheckboxChanged);
uDom('#buttonApply').on('click', ( ) => { buttonApplyHandler(); });
uDom('#buttonUpdate').on('click', ( ) => { buttonUpdateHandler(); });
uDom('#buttonPurgeAll').on('click', ev => {
    buttonPurgeAllHandler(ev.shiftKey);
});
uDom('#lists').on('change', '.listEntry input', onListsetChanged);
uDom('#lists').on('click', '.listEntry .remove', onRemoveExternalList);
uDom('#lists').on('click', 'span.cache', onPurgeClicked);
uDom('#externalLists').on('input', onFilteringSettingsChanged);

uDom('#lists').on('click', '.listEntry label *', ev => {
    if ( ev.target.matches('a,input,.forinput') ) { return; }
    ev.preventDefault();
});

/******************************************************************************/

renderFilterLists();

/******************************************************************************/

// <<<<< end of local scope
}


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

'use strict';

import { i18n, i18n$ } from './i18n.js';
import { dom, qs$, qsa$ } from './dom.js';

/******************************************************************************/

const lastUpdateTemplateString = i18n$('3pLastUpdate');
const obsoleteTemplateString = i18n$('3pExternalListObsolete');
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
        dom.cl.remove(dom.body, 'updating');
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
    const listGroupTemplate = qs$('#templates .groupEntry');
    const listEntryTemplate = qs$('#templates .listEntry');
    const listStatsTemplate = i18n$('3pListsOfBlockedHostsPerListStats');
    const renderElapsedTimeToString = i18n.renderElapsedTimeToString;
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
            li = dom.clone(listEntryTemplate);
        }
        const on = entry.off !== true;
        dom.cl.toggle(li, 'checked', on);
        let elem;
        if ( dom.attr(li, 'data-listkey') !== listKey ) {
            dom.attr(li, 'data-listkey', listKey);
            elem = qs$(li, 'input[type="checkbox"]');
            elem.checked = on;
            dom.text(qs$(li, '.listname'), listNameFromListKey(listKey));
            elem = qs$(li, 'a.content');
            dom.attr(elem, 'href', 'asset-viewer.html?url=' + encodeURIComponent(listKey));
            dom.attr(elem, 'type', 'text/html');
            dom.cl.remove(li, 'toRemove');
            if ( entry.supportName ) {
                dom.cl.add(li, 'support');
                elem = qs$(li, 'a.support');
                dom.attr(elem, 'href', entry.supportURL);
                dom.attr(elem, 'title', entry.supportName);
            } else {
                dom.cl.remove(li, 'support');
            }
            if ( entry.external ) {
                dom.cl.add(li, 'external');
            } else {
                dom.cl.remove(li, 'external');
            }
            if ( entry.instructionURL ) {
                dom.cl.add(li, 'mustread');
                dom.attr(qs$(li, 'a.mustread'), 'href', entry.instructionURL);
            } else {
                dom.cl.remove(li, 'mustread');
            }
            dom.cl.toggle(li, 'isDefault', entry.isDefault === true);
            dom.cl.toggle(li, 'unused', hideUnused && !on);
        }
        // https://github.com/gorhill/uBlock/issues/1429
        if ( !soft ) {
            qs$(li, 'input[type="checkbox"]').checked = on;
        }
        elem = qs$(li, 'span.counts');
        let text = '';
        if ( !isNaN(+entry.entryUsedCount) && !isNaN(+entry.entryCount) ) {
            text = listStatsTemplate
                .replace('{{used}}', renderNumber(on ? entry.entryUsedCount : 0))
                .replace('{{total}}', renderNumber(entry.entryCount));
        }
        dom.text(elem, text);
        // https://github.com/chrisaljoudi/uBlock/issues/104
        const asset = listDetails.cache[listKey] || {};
        const remoteURL = asset.remoteURL;
        dom.cl.toggle(li, 'unsecure',
            typeof remoteURL === 'string' && remoteURL.lastIndexOf('http:', 0) === 0
        );
        dom.cl.toggle(li, 'failed', asset.error !== undefined);
        dom.cl.toggle(li, 'obsolete', asset.obsolete === true);
        const lastUpdateString = lastUpdateTemplateString.replace(
            '{{ago}}',
            renderElapsedTimeToString(asset.writeTime || 0)
        );
        if ( asset.obsolete === true ) {
            let title = obsoleteTemplateString;
            if ( asset.cached && asset.writeTime !== 0 ) {
                title += '\n' + lastUpdateString;
            }
            dom.attr(qs$(li, '.status.obsolete'), 'title', title);
        }
        if ( asset.cached === true ) {
            dom.cl.add(li, 'cached');
            dom.attr(qs$(li, '.status.cache'), 'title', lastUpdateString);
        } else {
            dom.cl.remove(li, 'cached');
        }
        dom.cl.remove(li, 'discard');
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
        let liGroup = qs$(`#lists > .groupEntry[data-groupkey="${groupKey}"]`);
        if ( liGroup === null ) {
            liGroup = dom.clone(listGroupTemplate);
            let groupName = groupNames.get(groupKey);
            if ( groupName === undefined ) {
                groupName = i18n$('3pGroup' + groupKey.charAt(0).toUpperCase() + groupKey.slice(1));
                groupNames.set(groupKey, groupName);
            }
            if ( groupName !== '' ) {
                dom.text(qs$(liGroup, '.geName'), groupName);
            }
        }
        if ( qs$(liGroup, '.geName:empty') === null ) {
            dom.text(qs$(liGroup, '.geCount'), listEntryCountFromGroup(listKeys));
        }
        let hideUnused = mustHideUnusedLists(groupKey);
        dom.cl.toggle(liGroup, 'hideUnused', hideUnused);
        let ulGroup = qs$(liGroup, '.listEntries');
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
        dom.cl.add('#lists .listEntries .listEntry[data-listkey]', 'discard');

        // Remove import widget while we recreate list of lists.
        const importWidget = qs$('.listEntry.toImport');
        importWidget.remove();

        // Visually split the filter lists in purpose-based groups
        const ulLists = qs$('#lists');
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
        dom.cl.toggle(dom.body, 'hideUnused', mustHideUnusedLists('*'));
        for ( let i = 0; i < groupKeys.length; i++ ) {
            let groupKey = groupKeys[i];
            let liGroup = liFromListGroup(groupKey, groups.get(groupKey));
            dom.attr(liGroup, 'data-groupkey', groupKey);
            if ( liGroup.parentElement === null ) {
                ulLists.appendChild(liGroup);
            }
            groups.delete(groupKey);
        }
        // For all groups not covered above (if any left)
        for ( const groupKey of Object.keys(groups) ) {
            ulLists.appendChild(liFromListGroup(groupKey, groupKey));
        }

        dom.remove('#lists .listEntries .listEntry.discard');

        // Re-insert import widget.
        qs$('[data-groupkey="custom"] .listEntries').append(importWidget);

        qs$('#autoUpdate').checked = listDetails.autoUpdate === true;
        dom.text(
            '#listsOfBlockedHostsPrompt',
            i18n$('3pListsOfBlockedHostsPrompt')
                .replace('{{netFilterCount}}', renderNumber(details.netFilterCount))
                .replace('{{cosmeticFilterCount}}', renderNumber(details.cosmeticFilterCount))
        );
        qs$('#parseCosmeticFilters').checked =
            listDetails.parseCosmeticFilters === true;
        qs$('#ignoreGenericCosmeticFilters').checked =
            listDetails.ignoreGenericCosmeticFilters === true;
        qs$('#suspendUntilListsAreLoaded').checked =
            listDetails.suspendUntilListsAreLoaded === true;

        // Compute a hash of the settings so that we can keep track of changes
        // affecting the loading of filter lists.
        if ( !soft ) {
            filteringSettingsHash = hashFromCurrentFromSettings();
        }

        // https://github.com/gorhill/uBlock/issues/2394
        dom.cl.toggle(dom.body, 'updating', listDetails.isUpdating);

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
    dom.cl.toggle('#buttonApply', 'disabled',
        filteringSettingsHash === hashFromCurrentFromSettings()
    );
    const updating = dom.cl.has(dom.body, 'updating');
    dom.cl.toggle('#buttonUpdate', 'active', updating);
    dom.cl.toggle('#buttonUpdate', 'disabled',
        updating === false &&
        qs$('#lists .listEntry.obsolete:not(.toRemove) input[type="checkbox"]:checked') === null
    );
    dom.cl.toggle('#buttonPurgeAll', 'disabled',
        updating || qs$('#lists .listEntry.cached:not(.obsolete)') === null
    );
};

/******************************************************************************/

const updateAssetStatus = function(details) {
    const li = qs$(`#lists .listEntry[data-listkey="${details.key}"]`);
    if ( li === null ) { return; }
    dom.cl.toggle(li, 'failed', !!details.failed);
    dom.cl.toggle(li, 'obsolete', !details.cached);
    dom.cl.toggle(li, 'cached', !!details.cached);
    if ( details.cached ) {
        dom.attr(qs$(li, '.status.cache'), 'title',
            lastUpdateTemplateString.replace(
                '{{ago}}',
                i18n.renderElapsedTimeToString(Date.now())
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
        qs$('#parseCosmeticFilters').checked,
        qs$('#ignoreGenericCosmeticFilters').checked
    ];
    const listHash = [];
    const listEntries = qsa$('#lists .listEntry[data-listkey]:not(.toRemove)');
    for ( const liEntry of listEntries ) {
        if ( qs$(liEntry, 'input[type="checkbox"]:checked') !== null ) {
            listHash.push(dom.attr(liEntry, 'data-listkey'));
        }
    }
    hash.push(
        listHash.sort().join(),
        qs$('#importLists').checked &&
            reValidExternalList.test(qs$('#externalLists').value.trim()),
        qs$('#lists .listEntry.toRemove') !== null
    );
    return hash.join();
};

/******************************************************************************/

const onListsetChanged = function(ev) {
    const input = ev.target;
    dom.cl.toggle(input.closest('.listEntry'), 'checked', input.checked);
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
    dom.cl.toggle(liEntry, 'toRemove');
    renderWidgets();
};

/******************************************************************************/

const onPurgeClicked = function(ev) {
    const liEntry = ev.target.closest('[data-listkey]');
    const listKey = dom.attr(liEntry, 'data-listkey') || '';
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
    dom.cl.add(liEntry, 'obsolete');
    dom.cl.remove(liEntry, 'cached');

    if ( qs$(liEntry, 'input[type="checkbox"]').checked ) {
        renderWidgets();
    }
};

/******************************************************************************/

const selectFilterLists = async function() {
    // Cosmetic filtering switch
    messaging.send('dashboard', {
        what: 'userSettings',
        name: 'parseAllABPHideFilters',
        value: qs$('#parseCosmeticFilters').checked,
    });
    messaging.send('dashboard', {
        what: 'userSettings',
        name: 'ignoreGenericCosmeticFilters',
        value: qs$('#ignoreGenericCosmeticFilters').checked,
    });

    // Filter lists to select
    const toSelect = [];
    for ( const liEntry of qsa$('#lists .listEntry[data-listkey]:not(.toRemove)') ) {
        if ( qs$(liEntry, 'input[type="checkbox"]:checked') !== null ) {
            toSelect.push(dom.attr(liEntry, 'data-listkey'));
        }
    }

    // External filter lists to remove
    const toRemove = [];
    for ( const liEntry of qsa$('#lists .listEntry.toRemove[data-listkey]') ) {
        toRemove.push(dom.attr(liEntry, 'data-listkey'));
    }

    // External filter lists to import
    const externalListsElem = qs$('#externalLists');
    const toImport = externalListsElem.value.trim();
    {
        const liEntry = externalListsElem.closest('.listEntry');
        dom.cl.remove(liEntry, 'checked');
        qs$(liEntry, 'input[type="checkbox"]').checked = false;
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
    dom.cl.remove('#buttonApply', 'enabled');
    await selectFilterLists();
    renderWidgets();
    messaging.send('dashboard', { what: 'reloadAllFilters' });
};

/******************************************************************************/

const buttonUpdateHandler = async function() {
    await selectFilterLists();
    dom.cl.add(dom.body, 'updating');
    renderWidgets();
    messaging.send('dashboard', { what: 'forceUpdateAssets' });
};

/******************************************************************************/

const buttonPurgeAllHandler = async function(hard) {
    dom.cl.remove('#buttonPurgeAll', 'enabled');
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
        dom.cl.toggle(dom.body, 'hideUnused', mustHide);
        dom.cl.toggle('.groupEntry[data-groupkey]', 'hideUnused', mustHide);
    } else {
        const doesHide = hideUnusedSet.has(which);
        if ( doesHide ) {
            hideUnusedSet.delete(which);
        } else {
            hideUnusedSet.add(which);
        }
        mustHide = doesHide === doesHideAll;
        groupSelector = `.groupEntry[data-groupkey="${which}"] `;
        dom.cl.toggle(groupSelector, 'hideUnused', mustHide);
    }
    qsa$(`${groupSelector}.listEntry input[type="checkbox"]:not(:checked)`)
        .forEach(elem => {
            dom.cl.toggle(elem.closest('.listEntry[data-listkey]'), 'unused', mustHide);
        });
    vAPI.localStorage.setItem(
        'hideUnusedFilterLists',
        Array.from(hideUnusedSet)
    );
};

const revealHiddenUsedLists = function() {
    qsa$('#lists .listEntry.unused input[type="checkbox"]:checked')
        .forEach(elem => {
            dom.cl.remove(elem.closest('.listEntry[data-listkey]'), 'unused');
        });
};

dom.on('#listsOfBlockedHostsPrompt', 'click', ( ) => {
    toggleHideUnusedLists('*');
});

dom.on('#lists', 'click', '.groupEntry[data-groupkey] > .geDetails', ev => {
    toggleHideUnusedLists(
        dom.attr(ev.target.closest('.groupEntry[data-groupkey]'), 'data-groupkey')
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
        parseCosmeticFilters: qs$('#parseCosmeticFilters').checked,
        ignoreGenericCosmeticFilters: qs$('#ignoreGenericCosmeticFilters').checked,
        selectedLists: []
    };

    const liEntries = qsa$('#lists .listEntry');
    for ( const liEntry of liEntries ) {
        if ( qs$(liEntry, 'input').checked ) {
            bin.selectedLists.push(dom.attr(liEntry, 'data-listkey'));
        }
    }

    return bin;
};

const fromCloudData = function(data, append) {
    if ( typeof data !== 'object' || data === null ) { return; }

    let elem, checked;

    elem = qs$('#parseCosmeticFilters');
    checked = data.parseCosmeticFilters === true || append && elem.checked;
    elem.checked = listDetails.parseCosmeticFilters = checked;

    elem = qs$('#ignoreGenericCosmeticFilters');
    checked = data.ignoreGenericCosmeticFilters === true || append && elem.checked;
    elem.checked = listDetails.ignoreGenericCosmeticFilters = checked;

    const selectedSet = new Set(data.selectedLists);
    for ( const listEntry of qsa$('#lists .listEntry') ) {
        const listKey = dom.attr(listEntry, 'data-listkey');
        const hasListKey = selectedSet.has(listKey);
        selectedSet.delete(listKey);
        const input = qs$(listEntry, 'input');
        if ( append && input.checked ) { continue; }
        input.checked = hasListKey;
    }

    // If there are URL-like list keys left in the selected set, import them.
    for ( const listKey of selectedSet ) {
        if ( reValidExternalList.test(listKey) === false ) {
            selectedSet.delete(listKey);
        }
    }
    if ( selectedSet.size !== 0 ) {
        elem = qs$('#externalLists');
        if ( append ) {
            if ( elem.value.trim() !== '' ) { elem.value += '\n'; }
        } else {
            elem.value = '';
        }
        elem.value += Array.from(selectedSet).join('\n');
        qs$('#importLists').checked = true;
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

dom.on('#autoUpdate', 'change', userSettingCheckboxChanged);
dom.on('#parseCosmeticFilters', 'change', onFilteringSettingsChanged);
dom.on('#ignoreGenericCosmeticFilters', 'change', onFilteringSettingsChanged);
dom.on('#suspendUntilListsAreLoaded', 'change', userSettingCheckboxChanged);
dom.on('#buttonApply', 'click', ( ) => { buttonApplyHandler(); });
dom.on('#buttonUpdate', 'click', ( ) => { buttonUpdateHandler(); });
dom.on('#buttonPurgeAll', 'click', ev => { buttonPurgeAllHandler(ev.shiftKey); });
dom.on('#lists', 'change', '.listEntry input', onListsetChanged);
dom.on('#lists', 'click', '.listEntry .remove', onRemoveExternalList);
dom.on('#lists', 'click', 'span.cache', onPurgeClicked);
dom.on('#externalLists', 'input', onFilteringSettingsChanged);
dom.on('#lists','click', '.listEntry label *', ev => {
    if ( ev.target.matches('a,input,.forinput') ) { return; }
    ev.preventDefault();
});

/******************************************************************************/

renderFilterLists();

/******************************************************************************/

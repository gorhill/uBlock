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

/******************************************************************************/

import { sendMessage } from './ext.js';
import { i18n$ } from './i18n.js';
import { dom, qs$, qsa$ } from './dom.js';
import { simpleStorage } from './storage.js';

/******************************************************************************/

let cachedRulesetData = {};
let filteringSettingsHash = '';
let hideUnusedSet = new Set([ 'regions' ]);

/******************************************************************************/

const renderNumber = function(value) {
    return value.toLocaleString();
};

/******************************************************************************/

const renderFilterLists = function(soft) {
    const { enabledRulesets, rulesetDetails } = cachedRulesetData;
    const listGroupTemplate = qs$('#templates .groupEntry');
    const listEntryTemplate = qs$('#templates .listEntry');
    const listStatsTemplate = i18n$('perRulesetStats');
    const groupNames = new Map([ [ 'user', '' ] ]);

    const liFromListEntry = function(ruleset, li, hideUnused) {
        if ( !li ) {
            li = listEntryTemplate.cloneNode(true);
        }
        const on = enabledRulesets.includes(ruleset.id);
        li.classList.toggle('checked', on);
        let elem;
        if ( dom.attr(li, 'data-listkey') !== ruleset.id ) {
            dom.attr(li, 'data-listkey', ruleset.id);
            qs$('input[type="checkbox"]', li).checked = on;
            qs$('.listname', li).textContent = ruleset.name || ruleset.id;
            dom.removeClass(li, 'toRemove');
            if ( ruleset.supportName ) {
                dom.addClass(li, 'support');
                elem = qs$('a.support', li);
                dom.attr(elem, 'href', ruleset.supportURL);
                dom.attr(elem, 'title', ruleset.supportName);
            } else {
                dom.removeClass(li, 'support');
            }
            if ( ruleset.instructionURL ) {
                dom.addClass(li, 'mustread');
                dom.attr(qs$('a.mustread', li), 'href', ruleset.instructionURL);
            } else {
                dom.removeClass(li, 'mustread');
            }
            dom.toggleClass(li, 'isDefault', ruleset.isDefault === true);
            dom.toggleClass(li, 'unused', hideUnused && !on);
        }
        // https://github.com/gorhill/uBlock/issues/1429
        if ( !soft ) {
            qs$('input[type="checkbox"]', li).checked = on;
        }
        li.title = listStatsTemplate
            .replace('{{ruleCount}}', renderNumber(ruleset.rules.accepted))
            .replace('{{filterCount}}', renderNumber(ruleset.filters.accepted));
        return li;
    };

    const listEntryCountFromGroup = function(groupRulesets) {
        if ( Array.isArray(groupRulesets) === false ) { return ''; }
        let count = 0,
            total = 0;
        for ( const ruleset of groupRulesets ) {
            if ( enabledRulesets.includes(ruleset.id) ) {
                count += 1;
            }
            total += 1;
        }
        return total !== 0 ?
            `(${count.toLocaleString()}/${total.toLocaleString()})` :
            '';
    };

    const liFromListGroup = function(groupKey, groupRulesets) {
        let liGroup = qs$(`#lists > .groupEntry[data-groupkey="${groupKey}"]`);
        if ( liGroup === null ) {
            liGroup = listGroupTemplate.cloneNode(true);
            let groupName = groupNames.get(groupKey);
            if ( groupName === undefined ) {
                groupName = i18n$('3pGroup' + groupKey.charAt(0).toUpperCase() + groupKey.slice(1));
                groupNames.set(groupKey, groupName);
            }
            if ( groupName !== '' ) {
                qs$('.geName', liGroup).textContent = groupName;
            }
        }
        if ( qs$('.geName:empty', liGroup) === null ) {
            qs$('.geCount', liGroup).textContent = listEntryCountFromGroup(groupRulesets);
        }
        const hideUnused = mustHideUnusedLists(groupKey);
        liGroup.classList.toggle('hideUnused', hideUnused);
        const ulGroup = qs$('.listEntries', liGroup);
        if ( !groupRulesets ) { return liGroup; }
        groupRulesets.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });
        for ( let i = 0; i < groupRulesets.length; i++ ) {
            const liEntry = liFromListEntry(
                groupRulesets[i],
                ulGroup.children[i],
                hideUnused
            );
            if ( liEntry.parentElement === null ) {
                ulGroup.appendChild(liEntry);
            }
        }
        return liGroup;
    };

    // Incremental rendering: this will allow us to easily discard unused
    // DOM list entries.
    dom.addClass(
        qsa$('#lists .listEntries .listEntry[data-listkey]'),
        'discard'
    );

    // Visually split the filter lists in three groups
    const ulLists = qs$('#lists');
    const groups = new Map([
        [
            'default',
            rulesetDetails.filter(ruleset =>
                ruleset.id === 'default' 
            ),
        ],
        [
            'misc',
            rulesetDetails.filter(ruleset =>
                ruleset.id !== 'default' && typeof ruleset.lang !== 'string' 
            ),
        ],
        [
            'regions',
            rulesetDetails.filter(ruleset =>
                typeof ruleset.lang === 'string' 
            ),
        ],
    ]);

    dom.toggleClass(dom.body, 'hideUnused', mustHideUnusedLists('*'));

    for ( const [ groupKey, groupRulesets ] of groups ) {
        let liGroup = liFromListGroup(groupKey, groupRulesets);
        liGroup.setAttribute('data-groupkey', groupKey);
        if ( liGroup.parentElement === null ) {
            ulLists.appendChild(liGroup);
        }
    }

    dom.remove(qsa$('#lists .listEntries .listEntry.discard'));

    // Compute a hash of the settings so that we can keep track of changes
    // affecting the loading of filter lists.
    if ( !soft ) {
        filteringSettingsHash = hashFromCurrentFromSettings();
    }

    renderWidgets();
};

/******************************************************************************/

const renderWidgets = function() {
    dom.toggleClass(
        qs$('#buttonApply'),
        'disabled',
        filteringSettingsHash === hashFromCurrentFromSettings()
    );

    // Compute total counts
    const rulesetMap = new Map(
        cachedRulesetData.rulesetDetails.map(rule => [ rule.id, rule ])
    );
    let filterCount = 0;
    let ruleCount = 0;
    for ( const liEntry of qsa$('#lists .listEntry[data-listkey]') ) {
        if ( qs$('input[type="checkbox"]:checked', liEntry)  === null ) { continue; }
        const ruleset = rulesetMap.get(liEntry.dataset.listkey);
        if ( ruleset === undefined ) { continue; }
        filterCount += ruleset.filters.accepted;
        ruleCount += ruleset.rules.accepted;
    }
    qs$('#listsOfBlockedHostsPrompt').textContent = i18n$('perRulesetStats')
        .replace('{{ruleCount}}', ruleCount.toLocaleString())
        .replace('{{filterCount}}', filterCount.toLocaleString());
};

/******************************************************************************/

const hashFromCurrentFromSettings = function() {
    const hash = [];
    const listHash = [];
    for ( const liEntry of qsa$('#lists .listEntry[data-listkey]') ) {
        if ( qs$('input[type="checkbox"]:checked', liEntry) ) {
            listHash.push(dom.attr(liEntry, 'data-listkey'));
        }
    }
    hash.push(listHash.sort().join());
    return hash.join();
};

/******************************************************************************/

function onListsetChanged(ev) {
    const input = ev.target;
    const li = input.closest('.listEntry');
    dom.toggleClass(li, 'checked', input.checked);
    renderWidgets();
}

dom.on(
    qs$('#lists'),
    'change',
    '.listEntry input',
    onListsetChanged
);

/******************************************************************************/

const applyEnabledRulesets = async function() {
    const enabledRulesets = [];
    for ( const liEntry of qsa$('#lists .listEntry[data-listkey]') ) {
        if ( qs$('input[type="checkbox"]:checked', liEntry) === null ) { continue; }
        enabledRulesets.push(liEntry.dataset.listkey);
    }

    await sendMessage({
        what: 'applyRulesets',
        enabledRulesets,
    });

    filteringSettingsHash = hashFromCurrentFromSettings();
};

const buttonApplyHandler = async function() {
    dom.removeClass(qs$('#buttonApply'), 'enabled');
    await applyEnabledRulesets();
    renderWidgets();
};

dom.on(
    qs$('#buttonApply'),
    'click',
    ( ) => { buttonApplyHandler(); }
);

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
        dom.toggleClass(qsa$('.groupEntry[data-groupkey]'), 'hideUnused', mustHide);
    } else {
        const doesHide = hideUnusedSet.has(which);
        if ( doesHide ) {
            hideUnusedSet.delete(which);
        } else {
            hideUnusedSet.add(which);
        }
        mustHide = doesHide === doesHideAll;
        groupSelector = `.groupEntry[data-groupkey="${which}"]`;
        dom.toggleClass(qsa$(groupSelector), 'hideUnused', mustHide);
    }

    for ( const elem of qsa$(`#lists ${groupSelector} .listEntry[data-listkey] input[type="checkbox"]:not(:checked)`) ) {
        dom.toggleClass(
            elem.closest('.listEntry[data-listkey]'),
            'unused',
            mustHide
        );
    }

    simpleStorage.setItem(
        'hideUnusedFilterLists',
        Array.from(hideUnusedSet)
    );
};

dom.on(
    qs$('#lists'),
    'click',
    '.groupEntry[data-groupkey] > .geDetails',
    ev => {
        toggleHideUnusedLists(
            dom.attr(ev.target.closest('[data-groupkey]'), 'data-groupkey')
        );
    }
);

// Initialize from saved state.
simpleStorage.getItem('hideUnusedFilterLists').then(value => {
    if ( Array.isArray(value) ) {
        hideUnusedSet = new Set(value);
    }
});

/******************************************************************************/

self.hasUnsavedData = function() {
    return hashFromCurrentFromSettings() !== filteringSettingsHash;
};

/******************************************************************************/

dom.on(
    qs$('#lists'),
    'click',
    '.listEntry label *',
    ev => {
        if ( ev.target.matches('input,.forinput') ) { return; }
        ev.preventDefault();
    }
);

/******************************************************************************/

sendMessage({
    what: 'getRulesetData',
}).then(data => {
    if ( !data ) { return; }
    cachedRulesetData = data;
    try {
        renderFilterLists();
    } catch(ex) {
    }
}).catch(reason => {
    console.trace(reason);
});

/******************************************************************************/

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

import { browser, sendMessage } from './ext.js';
import { i18n$ } from './i18n.js';
import { dom, qs$, qsa$ } from './dom.js';
import { simpleStorage } from './storage.js';

/******************************************************************************/

const rulesetMap = new Map();
let cachedRulesetData = {};
let hideUnusedSet = new Set([ 'regions' ]);

/******************************************************************************/

function renderNumber(value) {
    return value.toLocaleString();
}

/******************************************************************************/

function rulesetStats(rulesetId) {
    const canRemoveParams = cachedRulesetData.defaultFilteringMode > 1;
    const rulesetDetails = rulesetMap.get(rulesetId);
    if ( rulesetDetails === undefined ) { return; }
    const { rules, filters } = rulesetDetails;
    let ruleCount = rules.plain + rules.regex;
    if ( canRemoveParams ) {
        ruleCount += rules.removeparam + rules.redirect;
    }
    const filterCount = filters.accepted;
    return { ruleCount, filterCount };
}

/******************************************************************************/

function renderFilterLists(soft = false) {
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
        if ( dom.attr(li, 'data-listkey') !== ruleset.id ) {
            dom.attr(li, 'data-listkey', ruleset.id);
            qs$('input[type="checkbox"]', li).checked = on;
            qs$('.listname', li).textContent = ruleset.name || ruleset.id;
            dom.cl.remove(li, 'toRemove');
            if ( ruleset.homeURL ) {
                dom.cl.add(li, 'support');
                const elem = qs$('a.support', li);
                dom.attr(elem, 'href', ruleset.homeURL);
            } else {
                dom.cl.remove(li, 'support');
            }
            if ( ruleset.instructionURL ) {
                dom.cl.add(li, 'mustread');
                dom.attr(qs$('a.mustread', li), 'href', ruleset.instructionURL);
            } else {
                dom.cl.remove(li, 'mustread');
            }
            dom.cl.toggle(li, 'isDefault', ruleset.isDefault === true);
            dom.cl.toggle(li, 'unused', hideUnused && !on);
        }
        // https://github.com/gorhill/uBlock/issues/1429
        if ( soft !== true ) {
            qs$('input[type="checkbox"]', li).checked = on;
        }
        const stats = rulesetStats(ruleset.id);
        li.title = listStatsTemplate
            .replace('{{ruleCount}}', renderNumber(stats.ruleCount))
            .replace('{{filterCount}}', renderNumber(stats.filterCount));
        dom.attr(
            qs$('.input.checkbox', li),
            'disabled',
            stats.ruleCount === 0 ? '' : null
        );
        dom.cl.remove(li, 'discard');
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
    dom.cl.add(
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

    dom.cl.toggle(dom.body, 'hideUnused', mustHideUnusedLists('*'));

    for ( const [ groupKey, groupRulesets ] of groups ) {
        let liGroup = liFromListGroup(groupKey, groupRulesets);
        liGroup.setAttribute('data-groupkey', groupKey);
        if ( liGroup.parentElement === null ) {
            ulLists.appendChild(liGroup);
        }
    }

    dom.remove(qsa$('#lists .listEntries .listEntry.discard'));

    renderWidgets();
}

/******************************************************************************/

const renderWidgets = function() {
    if ( cachedRulesetData.firstRun ) {
        dom.cl.add(dom.body, 'firstRun');
    }

    const defaultLevel = cachedRulesetData.defaultFilteringMode;
    qs$(`.filteringModeCard input[type="radio"][value="${defaultLevel}"]`).checked = true;

    qs$('#autoReload input[type="checkbox"').checked = cachedRulesetData.autoReload;

    // Compute total counts
    let filterCount = 0;
    let ruleCount = 0;
    for ( const liEntry of qsa$('#lists .listEntry[data-listkey]') ) {
        if ( qs$('input[type="checkbox"]:checked', liEntry)  === null ) { continue; }
        const stats = rulesetStats(liEntry.dataset.listkey);
        if ( stats === undefined ) { continue; }
        ruleCount += stats.ruleCount;
        filterCount += stats.filterCount;
    }
    qs$('#listsOfBlockedHostsPrompt').textContent = i18n$('perRulesetStats')
        .replace('{{ruleCount}}', ruleCount.toLocaleString())
        .replace('{{filterCount}}', filterCount.toLocaleString());
};

/******************************************************************************/

async function onFilteringModeChange(ev) {
    const input = ev.target;
    const newLevel = parseInt(input.value, 10);
    let granted = false;

    switch ( newLevel ) {
    case 1: { // Revoke broad permissions
        granted = await browser.permissions.remove({
            origins: [ '<all_urls>' ]
        });
        break;
    }
    case 2:
    case 3: { // Request broad permissions
        granted = await browser.permissions.request({
            origins: [ '<all_urls>' ]
        });
        break;
    }
    default:
        break;
    }
    if ( granted ) {
        const actualLevel = await sendMessage({
            what: 'setDefaultFilteringMode',
            level: newLevel,
        });
        cachedRulesetData.defaultFilteringMode = actualLevel;
    }
    renderFilterLists(true);
    renderWidgets();
}

dom.on(
    qs$('#defaultFilteringMode'),
    'change',
    '.filteringModeCard input[type="radio"]',
    ev => { onFilteringModeChange(ev); }
);

/******************************************************************************/

dom.on(qs$('#autoReload input[type="checkbox"'), 'change', ev => {
    sendMessage({
        what: 'setAutoReload',
        state: ev.target.checked,
    });
});

/******************************************************************************/

async function applyEnabledRulesets() {
    const enabledRulesets = [];
    for ( const liEntry of qsa$('#lists .listEntry[data-listkey]') ) {
        if ( qs$('input[type="checkbox"]:checked', liEntry) === null ) { continue; }
        enabledRulesets.push(liEntry.dataset.listkey);
    }

    await sendMessage({
        what: 'applyRulesets',
        enabledRulesets,
    });

    renderWidgets();
}

dom.on(qs$('#lists'), 'change', '.listEntry input[type="checkbox"]', ( ) => {
    applyEnabledRulesets();
});

/******************************************************************************/

// Collapsing of unused lists.

function mustHideUnusedLists(which) {
    const hideAll = hideUnusedSet.has('*');
    if ( which === '*' ) { return hideAll; }
    return hideUnusedSet.has(which) !== hideAll;
}

function toggleHideUnusedLists(which) {
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
        dom.cl.toggle(qsa$('.groupEntry[data-groupkey]'), 'hideUnused', mustHide);
    } else {
        const doesHide = hideUnusedSet.has(which);
        if ( doesHide ) {
            hideUnusedSet.delete(which);
        } else {
            hideUnusedSet.add(which);
        }
        mustHide = doesHide === doesHideAll;
        groupSelector = `.groupEntry[data-groupkey="${which}"]`;
        dom.cl.toggle(qsa$(groupSelector), 'hideUnused', mustHide);
    }

    for ( const elem of qsa$(`#lists ${groupSelector} .listEntry[data-listkey] input[type="checkbox"]:not(:checked)`) ) {
        dom.cl.toggle(
            elem.closest('.listEntry[data-listkey]'),
            'unused',
            mustHide
        );
    }

    simpleStorage.setItem(
        'hideUnusedFilterLists',
        Array.from(hideUnusedSet)
    );
}

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

sendMessage({
    what: 'getOptionsPageData',
}).then(data => {
    if ( !data ) { return; }
    cachedRulesetData = data;
    rulesetMap.clear();
    cachedRulesetData.rulesetDetails.forEach(rule => rulesetMap.set(rule.id, rule));
    try {
        renderFilterLists();
    } catch(ex) {
    }
}).catch(reason => {
    console.trace(reason);
});

/******************************************************************************/

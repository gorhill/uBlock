/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
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

import { dom, qs$, qsa$ } from './dom.js';
import { i18n, i18n$ } from './i18n.js';
import { localRead, localWrite, sendMessage } from './ext.js';

/******************************************************************************/

export const rulesetMap = new Map();

let cachedRulesetData = {};
let hideUnusedSet = new Set([ 'regions' ]);

/******************************************************************************/

function renderNumber(value) {
    return value.toLocaleString();
}

function renderRuleCounts() {
    let rulesetCount = 0;
    let filterCount = 0;
    let ruleCount = 0;
    for ( const liEntry of qsa$('#lists .listEntry[data-role="leaf"][data-rulesetid]') ) {
        if ( qs$(liEntry, 'input[type="checkbox"]:checked') === null ) { continue; }
        rulesetCount += 1;
        const stats = rulesetStats(liEntry.dataset.rulesetid);
        if ( stats === undefined ) { continue; }
        ruleCount += stats.ruleCount;
        filterCount += stats.filterCount;
    }
    dom.text('#listsOfBlockedHostsPrompt', i18n$('perRulesetStats')
        .replace('{{ruleCount}}', ruleCount.toLocaleString())
        .replace('{{filterCount}}', filterCount.toLocaleString())
    );

    dom.cl.toggle(dom.body, 'noMoreRuleset',
        rulesetCount === cachedRulesetData.maxNumberOfEnabledRulesets
    );
}

/******************************************************************************/

function updateNodes(listEntries) {
    listEntries = listEntries || qs$('#lists');
    for ( const listEntry of qsa$(listEntries, '.listEntry[data-nodeid]') ) {
        const totalCount = qsa$(listEntry, '.listEntry[data-rulesetid] input').length;
        const checkedCount = qsa$(listEntry, '.listEntry[data-rulesetid] input:checked').length;
        dom.text(qs$(listEntry, '.detailbar .count'), `${checkedCount}/${totalCount}`);
        const checkbox = qs$(listEntry, ':scope > .detailbar .checkbox');
        if ( checkbox === null ) { continue; }
        dom.prop(qs$(checkbox, 'input'), 'checked', checkedCount !== 0);
        dom.cl.toggle(checkbox, 'partial',
            checkedCount !== 0 && checkedCount !== totalCount
        );
    }
}

/******************************************************************************/

function rulesetStats(rulesetId) {
    const hasOmnipotence = cachedRulesetData.defaultFilteringMode > 1;
    const rulesetDetails = rulesetMap.get(rulesetId);
    if ( rulesetDetails === undefined ) { return; }
    const { rules, filters } = rulesetDetails;
    let ruleCount = rules.plain + rules.regex;
    if ( hasOmnipotence ) {
        ruleCount += rules.removeparam + rules.redirect + rules.modifyHeaders;
    }
    const filterCount = filters.accepted;
    return { ruleCount, filterCount };
}

/******************************************************************************/

function isAdminRuleset(listkey) {
    const { adminRulesets = [] } = cachedRulesetData;
    for ( const id of adminRulesets ) {
        const pos = id.indexOf(listkey);
        if ( pos === 0 ) { return true; }
        if ( pos !== 1 ) { continue; }
        const c = id.charAt(0);
        if ( c === '+' || c === '-' ) { return true; }
    }
    return false;
}

/******************************************************************************/

export function renderFilterLists(rulesetData) {
    cachedRulesetData = rulesetData;
    const { enabledRulesets, rulesetDetails } = cachedRulesetData;

    const shouldUpdate = rulesetMap.size !== 0;

    rulesetDetails.forEach(rule => rulesetMap.set(rule.id, rule));

    const listStatsTemplate = i18n$('perRulesetStats');

    const initializeListEntry = (ruleset, listEntry) => {
        const on = enabledRulesets.includes(ruleset.id);
        dom.prop(qs$(listEntry, ':scope > .detailbar input'), 'checked', on);
        if ( ruleset.homeURL ) {
            dom.attr(qs$(listEntry, 'a.support'), 'href', ruleset.homeURL);
        }
        dom.cl.toggle(listEntry, 'isDefault', ruleset.id === 'default');
        const stats = rulesetStats(ruleset.id);
        listEntry.title = listStatsTemplate
            .replace('{{ruleCount}}', renderNumber(stats.ruleCount))
            .replace('{{filterCount}}', renderNumber(stats.filterCount));
        const fromAdmin = isAdminRuleset(ruleset.id);
        dom.cl.toggle(listEntry, 'fromAdmin', fromAdmin);
        const disabled = stats.ruleCount === 0 || fromAdmin;
        dom.attr(
            qs$(listEntry, '.input.checkbox input'),
            'disabled',
            disabled ? '' : null
        );
        return listEntry;
    };

    // Update already rendered DOM lists
    if ( shouldUpdate ) {
        for ( const listEntry of qsa$('#lists .listEntry[data-rulesetid]') ) {
            const rulesetid = listEntry.dataset.rulesetid;
            const ruleset = rulesetMap.get(rulesetid);
            initializeListEntry(ruleset, listEntry);
        }
        updateNodes();
        renderRuleCounts();
        return;
    }

    const createListEntry = (listDetails, depth) => {
        if ( listDetails.lists === undefined ) {
            return dom.clone('#templates .listEntry[data-role="leaf"]');
        }
        if ( depth !== 0 ) {
            return dom.clone('#templates .listEntry[data-role="node"]');
        }
        return dom.clone('#templates .listEntry[data-role="rootnode"]');
    };

    const createListEntries = (parentkey, listTree, depth = 0) => {
        const listEntries = dom.clone('#templates .listEntries');
        const treeEntries = Object.entries(listTree);
        if ( depth !== 0 ) {
            const reEmojis = /\p{Emoji}+/gu;
            treeEntries.sort((a ,b) => {
                const ap = a[1].preferred === true;
                const bp = b[1].preferred === true;
                if ( ap !== bp ) { return ap ? -1 : 1; }
                const as = (a[1].title || a[0]).replace(reEmojis, '');
                const bs = (b[1].title || b[0]).replace(reEmojis, '');
                return as.localeCompare(bs);
            });
        }
        for ( const [ listkey, listDetails ] of treeEntries ) {
            const listEntry = createListEntry(listDetails, depth);
            if ( listDetails.lists === undefined ) {
                listEntry.dataset.rulesetid = listkey;
            } else {
                listEntry.dataset.nodeid = listkey;
                dom.cl.toggle(listEntry, 'hideUnused', hideUnusedSet.has(listkey));
            }
            qs$(listEntry, ':scope > .detailbar .listname').append(
                i18n.patchUnicodeFlags(listDetails.name)
            );
            if ( listDetails.lists !== undefined ) {
                listEntry.append(createListEntries(listkey, listDetails.lists, depth+1));
                dom.cl.toggle(listEntry, 'expanded', true/*listIsExpanded(listkey)*/);
                //updateListNode(listEntry);
            } else {
                initializeListEntry(listDetails, listEntry);
            }
            listEntries.append(listEntry);
        }
        return listEntries;
    };

    // Visually split the filter lists in groups
    const groups = new Map([
        [
            'default',
            rulesetDetails.filter(ruleset =>
                ruleset.id === 'default' 
            ),
        ], [
            'annoyances',
            rulesetDetails.filter(ruleset =>
                ruleset.group === 'annoyances'
            ),
        ], [
            'misc',
            rulesetDetails.filter(ruleset =>
                ruleset.id !== 'default' &&
                ruleset.group === undefined &&
                typeof ruleset.lang !== 'string' 
            ),
        ], [
            'regions',
            rulesetDetails.filter(ruleset =>
                ruleset.group === 'regions' 
            ),
        ],
    ]);

    dom.cl.toggle(dom.body, 'hideUnused', mustHideUnusedLists('*'));

    // Build list tree
    const listTree = {};
    const groupNames = new Map();
    for ( const [ groupKey, groupRulesets ] of groups ) {
        let groupName = groupNames.get(groupKey);
        if ( groupName === undefined ) {
            groupName = i18n$('3pGroup' + groupKey.charAt(0).toUpperCase() + groupKey.slice(1));
            groupNames.set(groupKey, groupName);
        }
        const groupDetails = {
            name: groupName,
            lists: {},
        };
        listTree[groupKey] = groupDetails;
        for ( const ruleset of groupRulesets ) {
            if ( ruleset.parent !== undefined ) {
                let lists = groupDetails.lists;
                for ( const parent of ruleset.parent.split('|') ) {
                    if ( lists[parent] === undefined ) {
                        lists[parent] = { name: parent, lists: {} };
                    }
                    lists = lists[parent].lists;
                }
                lists[ruleset.id] = ruleset;
            } else {
                groupDetails.lists[ruleset.id] = ruleset;
            }
        }
    }
    // Move lonely sublist to list level
    const promoteLonelySublist = (parent, depth = 0) => {
        if ( Boolean(parent.lists) === false ) { return parent; }
        const childKeys = Object.keys(parent.lists);
        for ( const childKey of childKeys ) {
            const child = promoteLonelySublist(parent.lists[childKey], depth + 1);
            if ( child === parent.lists[childKey] ) { continue; }
            parent.lists[child.id] = child;
            delete parent.lists[childKey];
        }
        if ( depth === 0 ) { return parent; }
        if ( childKeys.length > 1 ) { return parent; }
        return parent.lists[childKeys[0]]
    };
    for ( const key of Object.keys(listTree) ) {
        promoteLonelySublist(listTree[key]);
    }
    const listEntries = createListEntries('root', listTree);

    updateNodes(listEntries);

    dom.clear('#lists');
    qs$('#lists').append(listEntries);

    renderRuleCounts();
}

/******************************************************************************/

// Collapsing of unused lists.

function mustHideUnusedLists(which) {
    const hideAll = hideUnusedSet.has('*');
    if ( which === '*' ) { return hideAll; }
    return hideUnusedSet.has(which) !== hideAll;
}

function toggleHideUnusedLists(which) {
    const doesHideAll = hideUnusedSet.has('*');
    if ( which === '*' ) {
        const mustHide = doesHideAll === false;
        hideUnusedSet.clear();
        if ( mustHide ) {
            hideUnusedSet.add(which);
        }
        dom.cl.toggle('#lists', 'hideUnused', mustHide);
        dom.cl.toggle('.listEntry[data-nodeid]', 'hideUnused', mustHide);
    } else {
        const doesHide = hideUnusedSet.has(which);
        if ( doesHide ) {
            hideUnusedSet.delete(which);
        } else {
            hideUnusedSet.add(which);
        }
        const mustHide = doesHide === doesHideAll;
        const groupSelector = `.listEntry[data-nodeid="${which}"]`;
        dom.cl.toggle(groupSelector, 'hideUnused', mustHide);
    }

    localWrite('hideUnusedFilterLists', Array.from(hideUnusedSet));
}

dom.on('#lists', 'click', '.listEntry[data-nodeid] > .detailbar, .listExpander', ev => {
    toggleHideUnusedLists(
        dom.attr(ev.target.closest('[data-nodeid]'), 'data-nodeid')
    );
});

// Initialize from saved state.
localRead('hideUnusedFilterLists').then(value => {
    if ( Array.isArray(value) === false ) { return; }
    hideUnusedSet = new Set(value);
    for ( const listEntry of qsa$('[data-nodeid]') ) {
        dom.cl.toggle(listEntry, 'hideUnused',
            hideUnusedSet.has(listEntry.dataset.nodeid)
        );
    }
});

/******************************************************************************/

const searchFilterLists = ( ) => {
    const pattern = dom.prop('.searchfield input', 'value') || '';
    dom.cl.toggle('#lists', 'searchMode', pattern !== '');
    if ( pattern === '' ) { return; }
    const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    for ( const listEntry of qsa$('#lists [data-role="leaf"]') ) {
        const rulesetid = listEntry.dataset.rulesetid;
        const rulesetDetails = rulesetMap.get(rulesetid);
        if ( rulesetDetails === undefined ) { continue; }
        let haystack = perListHaystack.get(rulesetDetails);
        if ( haystack === undefined ) {
            haystack = [
                rulesetDetails.name,
                listEntry.dataset.nodeid,
                rulesetDetails.tags || '',
            ].join(' ').trim();
            perListHaystack.set(rulesetDetails, haystack);
        }
        dom.cl.toggle(listEntry, 'searchMatch', re.test(haystack));
    }
    for ( const listEntry of qsa$('#lists .listEntry:not([data-role="leaf"])') ) {
        dom.cl.toggle(listEntry, 'searchMatch',
            qs$(listEntry, '.listEntries .listEntry.searchMatch') !== null
        );
    }
};

const perListHaystack = new WeakMap();

dom.on('.searchfield input', 'input', searchFilterLists);

/******************************************************************************/

async function applyEnabledRulesets() {
    const enabledRulesets = [];
    for ( const liEntry of qsa$('#lists .listEntry[data-role="leaf"][data-rulesetid]') ) {
        const checked = qs$(liEntry, 'input[type="checkbox"]:checked') !== null;
        if ( checked === false ) { continue; }
        const { rulesetid } = liEntry.dataset;
        if ( dom.cl.has(liEntry, 'fromAdmin') ) { continue; }
        enabledRulesets.push(rulesetid);
    }

    await sendMessage({
        what: 'applyRulesets',
        enabledRulesets,
    });
}

dom.on('#lists', 'change', '.listEntry input[type="checkbox"]', ev => {
    const input = ev.target;
    const listEntry = input.closest('.listEntry');
    if ( listEntry === null ) { return; }
    if ( listEntry.dataset.nodeid !== undefined ) {
        let checkAll = input.checked ||
            dom.cl.has(qs$(listEntry, ':scope > .detailbar .checkbox'), 'partial');
        for ( const input of qsa$(listEntry, '.listEntries input') ) {
            input.checked = checkAll;
        }
    }
    renderRuleCounts();
    updateNodes();
    applyEnabledRulesets();
});

/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2026-present Raymond Hill

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

import {
    localKeys,
    localRead,
    localRemove,
    localWrite,
} from './ext.js';

import {
    registerJob,
    removeJob,
} from './utils.js';

import { ubolLog } from './debug.js';

/******************************************************************************/

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/******************************************************************************/

async function getCompiledListIds() {
    const out = [];
    const prefix = 'rulesets.imported.compiled.';
    const keys = await localKeys();
    for ( const key of keys ) {
        if ( key.startsWith(prefix) === false ) { continue; }
        out.push(key.slice(prefix.length));
    }
    return out;
}

/******************************************************************************/

async function scheduleImportedListsUpdate(lists) {
    let earlierTime = 0;
    for ( const list of lists ) {
        const updateTime = list.time.updated + list.expires * MS_PER_DAY;
        if ( earlierTime !== 0 && earlierTime < updateTime ) { continue; }
        earlierTime = updateTime;
    }
    if ( earlierTime ) {
        return registerJob('updateImportedLists', earlierTime);
    }
    return removeJob('updateImportedLists');
}

/******************************************************************************/

export async function getEnabledImportedLists() {
    const importedLists = await localRead('rulesets.imported') || [];
    return importedLists.filter(a => a.enabled);
}

/******************************************************************************/

export async function getImportedLists() {
    const importedLists = await localRead('rulesets.imported') || [];
    return importedLists || [];
}

/******************************************************************************/

export async function updateEnabledImportedLists(toEnable, toDisable) {
    const importedLists = await getImportedLists();
    const reImported = /^[a-z-]+:\/\//;
    const enableRulesetIds = toEnable.filter(a => reImported.test(a));
    const disableRulesetIds = toDisable.filter(a => reImported.test(a));
    if ( enableRulesetIds.length === 0 ) {
        if ( disableRulesetIds.length === 0 ) { return false; }
    }
    let modified = false;
    for ( const list of importedLists ) {
        if ( toEnable.includes(list.id) ) {
            if ( list.enabled === true ) { continue; }
            list.enabled = true;
            modified = true;
        } else if ( toDisable.includes(list.id) ) {
            if ( list.enabled !== true ) { continue; }
            list.enabled = false;
            modified = true;
        }
    }
    if ( modified ) {
        await saveImportedLists(importedLists);
    }
    return modified;
}

/******************************************************************************/

export async function saveImportedLists(lists) {
    const compiledLists = await getCompiledListIds();
    const enabledListIds = lists.filter(a => a.enabled).map(a => a.id);
    const toRemove = [];
    for ( const listid of compiledLists ) {
        if ( enabledListIds.includes(listid) ) { continue; }
        toRemove.push(`rulesets.imported.compiled.${listid}`);
    }
    await Promise.all([
        toRemove.length ? localRemove(toRemove) : false,
        localWrite('rulesets.imported', lists),
        scheduleImportedListsUpdate(lists),
    ]);
}

/******************************************************************************/

export async function enableImportedRulesets(rulesets) {
    const toEnable = new Set(rulesets);
    const importedLists = await getImportedLists();
    let modified = 0;
    for ( const list of importedLists ) {
        if ( toEnable.has(list.id) ) {
            if ( list.enabled === true ) { continue; }
            list.enabled = true;
            modified += 1;
        } else {
            if ( list.enabled !== true ) { continue; }
            list.enabled = false;
            modified += 1;
        }
    }
    if ( modified ) {
        await saveImportedLists(importedLists);
    }
    return modified;
}

/******************************************************************************/

export async function getImportedListCompiledData(listid) {
    return {
        listid,
        serialized: await localRead(`rulesets.imported.compiled.${listid}`),
    };
}

/******************************************************************************/

export async function updateImportedListData(listid, details) {
    if ( details.compiled ) {
        await localWrite(`rulesets.imported.compiled.${listid}`, details.compiled);
    } else {
        await localRemove(`rulesets.imported.compiled.${listid}`);
    }
    const lists = await getImportedLists();
    const list = lists.find(a => listid === a.id);
    if ( list === undefined ) { return; }
    list.time.updated = Date.now();
    if ( details.title ) { list.name = details.title; }
    if ( details.homeURL ) { list.homeURL = details.homeURL; }
    if ( details.expires ) { list.expires = details.expires; }
    if ( details.filterStats ) { list.filters = details.filterStats; }
    if ( details.ruleStats ) { list.rules = details.ruleStats; }
    await saveImportedLists(lists);
    return { listid };
}

/******************************************************************************/

// URL will be ruleset id

export async function addImportedLists(urls) {
    const lists = await getImportedLists();
    const beforeCount = lists.length;
    for ( const url of urls ) {
        if ( lists.some(a => a.id === url) ) { continue; }
        lists.push({
            id: url,
            name: url,
            group: 'imported',
            enabled: false,
            homeURL: '',
            expires: 7,
            time: {
                added: Date.now(),
                updated: 0,
            },
            filters: {
                total: 0,
                accepted: 0,
                rejected: 0,
            },
            rules: {
                total: 0,
                plain: 0,
                regex: 0,
            },
        });
    }
    if ( lists.length !== beforeCount ) {
        await saveImportedLists(lists);
    }
    return true;
}

/******************************************************************************/

export async function removeImportedLists(ids) {
    const setOfIds = new Set(Array.isArray(ids) ? ids : [ ids ]);
    const beforeLists = await getImportedLists();
    const afterLists = beforeLists.filter(a => setOfIds.has(a.id) === false);
    if ( afterLists.length === beforeLists.length ) { return false; }
    await saveImportedLists(afterLists);
    return true;
}

/******************************************************************************/

export async function updateImportedLists() {
    const lists = await getEnabledImportedLists();
    const now = Date.now();
    const toUpdate = [];
    for ( const list of lists ) {
        const updateTime = list.time.updated + list.expires * MS_PER_DAY;
        if ( updateTime > now ) { continue; }
        toUpdate.push(list.id);
    }
    if ( toUpdate.length === 0 ) { return 0; }
    await localRemove(toUpdate.map(a => `rulesets.imported.compiled.${a}`));
    ubolLog(`Will update imported filter lists: ${toUpdate.join()}`);
    return toUpdate.length;
}

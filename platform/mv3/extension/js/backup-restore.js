/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2022-present Raymond Hill

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
    addImportedLists,
    getImportedLists,
    removeImportedLists,
} from './imported-lists.js';

import {
    localRead, localRemove, localWrite,
    runtime,
    sendMessage,
} from './ext.js';

/******************************************************************************/

export async function backupToObject(currentConfig) {
    const out = {};
    const manifest = runtime.getManifest();
    out.version = manifest.versionName ?? manifest.version;
    const defaultConfig = await sendMessage({ what: 'getDefaultConfig' });
    if ( currentConfig.autoReload !== defaultConfig.autoReload ) {
        out.autoReload = currentConfig.autoReload;
    }
    if ( currentConfig.developerMode !== defaultConfig.developerMode ) {
        out.developerMode = currentConfig.developerMode;
    }
    if ( currentConfig.showBlockedCount !== defaultConfig.showBlockedCount ) {
        out.showBlockedCount = currentConfig.showBlockedCount;
    }
    if ( currentConfig.strictBlockMode !== defaultConfig.strictBlockMode ) {
        out.strictBlockMode = currentConfig.strictBlockMode;
    }
    const { enabledRulesets } = currentConfig;
    const customRulesets = [];
    for ( const id of enabledRulesets ) {
        if ( defaultConfig.rulesets.includes(id) ) { continue; }
        customRulesets.push(`+${id}`);
    }
    for ( const id of defaultConfig.rulesets ) {
        if ( enabledRulesets.includes(id) ) { continue; }
        customRulesets.push(`-${id}`);
    }
    if ( customRulesets.length !== 0 ) {
        out.rulesets = customRulesets;
    }
    out.filteringModes = await sendMessage({ what: 'getFilteringModeDetails' });
    const customFilters = await sendMessage({ what: 'getAllCustomFilters' });
    if ( customFilters.length !== 0 ) {
        out.customFilters = customFilters;
    }
    const dnrRules = await localRead('userDnrRules');
    if ( typeof dnrRules === 'string' && dnrRules.length !== 0 ) {
        out.dnrRules = dnrRules.split(/\n+/);
    }
    return out;
}

/******************************************************************************/

export async function restoreFromObject(targetConfig) {
    const defaultConfig = await sendMessage({ what: 'getDefaultConfig' });

    await sendMessage({
        what: 'setAutoReload',
        state: targetConfig.autoReload ?? defaultConfig.autoReload
    });

    await sendMessage({
        what: 'setShowBlockedCount',
        state: targetConfig.showBlockedCount ?? defaultConfig.showBlockedCount
    });

    await sendMessage({
        what: 'setDeveloperMode',
        state: targetConfig.developerMode ?? defaultConfig.developerMode
    });

    await sendMessage({
        what: 'setStrictBlockMode',
        state: targetConfig.strictBlockMode ?? defaultConfig.strictBlockMode
    });

    const enabledRulesets = defaultConfig.rulesets;
    for ( const entry of targetConfig.rulesets || [] ) {
        const id = entry.slice(1);
        if ( entry.startsWith('+') ) {
            if ( enabledRulesets.includes(id) ) { continue; }
            enabledRulesets.push(id);
        } else if ( entry.startsWith('-') ) {
            const i = enabledRulesets.indexOf(id);
            if ( i === -1 ) { continue; }
            enabledRulesets.splice(i, 1);
        }
    }
    const importedLists = await getImportedLists();
    const importedListIds = importedLists.map(a => a.id);
    const reImport = /^[a-z-]+:\/\//;
    const importedListsToAdd = enabledRulesets.filter(a =>
        reImport.test(a) && importedListIds.includes(a) === false
    );
    const importedListsToRemove = importedListIds.filter(a =>
        enabledRulesets.includes(a) === false
    );
    if ( importedListsToRemove.length ) {
        await removeImportedLists(importedListsToRemove);
    }
    if ( importedListsToAdd.length ) {
        await addImportedLists(importedListsToAdd);
    }
    await sendMessage({
        what: 'applyRulesets',
        enabledRulesets: Array.from(enabledRulesets),
    });

    await sendMessage({
        what: 'setFilteringModeDetails',
        modes: targetConfig.filteringModes ?? defaultConfig.filteringModes,
    });

    await sendMessage({ what: 'removeAllCustomFilters', hostname: '*' });
    const cosmeticFilters = targetConfig.cosmeticFilters;
    if ( Array.isArray(cosmeticFilters) ) {
        const hostnameMap = new Map();
        for ( const line of cosmeticFilters ) {
            const i = line.indexOf('##');
            if ( i === -1 ) { continue; }
            const hostname = line.slice(0, i);
            if ( hostname === '' ) { continue; }
            const selector = line.slice(i+2);
            if ( selector === '' ) { continue; }
            const selectors = hostnameMap.get(hostname) || [];
            if ( selectors.length === 0 ) {
                hostnameMap.set(hostname, selectors)
            }
            selectors.push(selector);
        }
        if ( hostnameMap.size !== 0 ) {
            await sendMessage({ what: 'addManyCustomFilters',
                entries: Array.from(hostnameMap),
            });
        }
    }
    const customFilters = targetConfig.customFilters;
    if ( Array.isArray(customFilters) ) {
        await sendMessage({ what: 'addManyCustomFilters',
            entries: customFilters,
        });
    }

    const dnrRules = targetConfig.dnrRules ?? [];
    if ( dnrRules.length !== 0 ) {
        await localWrite('userDnrRules', dnrRules.join('\n'));
    } else {
        await localRemove('userDnrRules');
    }
    await sendMessage({ what: 'updateUserDnrRules' });

}

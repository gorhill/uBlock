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
    localRead, localWrite,
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
    const filters = [];
    for ( const [ hostname, selectors ] of customFilters ) {
        for ( const selector of selectors ) {
            filters.push(`${hostname}##${selector}`);
        }
    }
    if ( filters.length !== 0 ) {
        out.cosmeticFilters = filters;
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

    const enabledRulesets = new Set(defaultConfig.rulesets);
    for ( const entry of targetConfig.rulesets ) {
        const id = entry.slice(1);
        if ( entry.startsWith('+') ) {
            enabledRulesets.add(id);
        } else if ( entry.startsWith('-') ) {
            enabledRulesets.delete(id);
        }
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
    const hostnameMap = new Map();
    for ( const line of targetConfig.cosmeticFilters ?? [] ) {
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
    const promises = [];
    for ( const [ hostname, selectors ] of hostnameMap ) {
        promises.push(
            sendMessage({ what: 'addCustomFilters', hostname, selectors })
        );
    }
    await Promise.all(promises);

    const dnrRules = targetConfig.dnrRules ?? [];
    await localWrite('userDnrRules', dnrRules.join('\n'));
    await sendMessage({ what: 'updateUserDnrRules' });

}

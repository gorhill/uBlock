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
    adminRead,
    localRead, localRemove, localWrite,
    sessionRead, sessionWrite,
} from './ext.js';

import {
    enableRulesets,
    getRulesetDetails,
    setStrictBlockMode,
} from './ruleset-manager.js';

import {
    getDefaultFilteringMode,
    readFilteringModeDetails,
} from './mode-manager.js';

import {
    rulesetConfig,
    saveRulesetConfig,
} from './config.js';

import { broadcastMessage } from './utils.js';
import { dnr } from './ext-compat.js';
import { registerInjectables } from './scripting-manager.js';
import { ubolLog } from './debug.js';

/******************************************************************************/

export async function loadAdminConfig() {
    const [
        showBlockedCount,
        strictBlockMode,
    ] = await Promise.all([
        adminReadEx('showBlockedCount'),
        adminReadEx('strictBlockMode'),
    ]);
    applyAdminConfig({ showBlockedCount, strictBlockMode });
}

/******************************************************************************/

function applyAdminConfig(config, apply = false) {
    const toApply = [];
    for ( const [ key, val ] of Object.entries(config) ) {
        if ( typeof val !== typeof rulesetConfig[key] ) { continue; }
        if ( val === rulesetConfig[key] ) { continue; }
        rulesetConfig[key] = val;
        toApply.push(key);
    }
    if ( toApply.length === 0 ) { return; }
    saveRulesetConfig();
    if ( apply !== true ) { return; }
    while ( toApply.length !== 0 ) {
        const key = toApply.pop();
        switch ( key ) {
        case 'showBlockedCount': {
            if ( typeof dnr.setExtensionActionOptions !== 'function' ) { break; }
            const { showBlockedCount } = config;
            dnr.setExtensionActionOptions({
                displayActionCountAsBadgeText: showBlockedCount,
            });
            broadcastMessage({ showBlockedCount });
            break;
        }
        case 'strictBlockMode': {
            const { strictBlockMode } = config;
            setStrictBlockMode(strictBlockMode, true).then(( ) => {
                broadcastMessage({ strictBlockMode });
            });
            break;
        }
        default:
            break;
        }
    }
}

/******************************************************************************/

const adminSettings = {
    keys: new Map(),
    timer: undefined,
    change(key, value) {
        this.keys.set(key, value);
        if ( this.timer !== undefined ) { return; }
        this.timer = self.setTimeout(( ) => {
            this.timer = undefined;
            this.process();
        }, 127);
    },
    async process() {
        if ( this.keys.has('rulesets') ) {
            ubolLog('admin setting "rulesets" changed');
            await enableRulesets(rulesetConfig.enabledRulesets);
            await registerInjectables();
            const results = await Promise.all([
                getAdminRulesets(),
                dnr.getEnabledRulesets(),
            ]);
            const [ adminRulesets, enabledRulesets ] = results;
            broadcastMessage({ adminRulesets, enabledRulesets });
        }
        if ( this.keys.has('defaultFiltering') ) {
            ubolLog('admin setting "defaultFiltering" changed');
            await readFilteringModeDetails(true);
            await registerInjectables();
            const defaultFilteringMode = await getDefaultFilteringMode();
            broadcastMessage({ defaultFilteringMode });
        }
        if ( this.keys.has('noFiltering') ) {
            ubolLog('admin setting "noFiltering" changed');
            const filteringModeDetails = await readFilteringModeDetails(true);
            broadcastMessage({ filteringModeDetails });
        }
        if ( this.keys.has('showBlockedCount') ) {
            ubolLog('admin setting "showBlockedCount" changed');
            const showBlockedCount = this.keys.get('showBlockedCount');
            applyAdminConfig({ showBlockedCount }, true);
        }
        if ( this.keys.has('strictBlockMode') ) {
            ubolLog('admin setting "strictBlockMode" changed');
            const strictBlockMode = this.keys.get('strictBlockMode');
            applyAdminConfig({ strictBlockMode }, true);
        }
        this.keys.clear();
    }
};

/******************************************************************************/

export async function getAdminRulesets() {
    const [
        adminList,
        rulesetDetails,
    ] = await Promise.all([
        adminReadEx('rulesets'),
        getRulesetDetails(),
    ]);
    const adminRulesets = new Set(Array.isArray(adminList) && adminList || []);
    if ( adminRulesets.has('-default') ) {
        adminRulesets.delete('-default');
        for ( const ruleset of rulesetDetails.values() ) {
            if ( ruleset.enabled !== true ) { continue; }
            if ( adminRulesets.has(`+${ruleset.id}`) ) { continue; }
            adminRulesets.add(`-${ruleset.id}`);
        }
    }
    if ( adminRulesets.has('+default') ) {
        adminRulesets.delete('+default');
        for ( const ruleset of rulesetDetails.values() ) {
            if ( ruleset.enabled !== true ) { continue; }
            if ( adminRulesets.has(`-${ruleset.id}`) ) { continue; }
            adminRulesets.add(`+${ruleset.id}`);
        }
    }
    if ( adminRulesets.has('-*') ) {
        adminRulesets.delete('-*');
        for ( const ruleset of rulesetDetails.values() ) {
            if ( ruleset.enabled ) { continue; }
            if ( adminRulesets.has(`+${ruleset.id}`) ) { continue; }
            adminRulesets.add(`-${ruleset.id}`);
        }
    }
    return Array.from(adminRulesets);
}

/******************************************************************************/

export async function adminReadEx(key) {
    let cacheValue;
    const session = await sessionRead(`admin.${key}`);
    if ( session ) {
        cacheValue = session.data;
    } else {
        const local = await localRead(`admin.${key}`);
        if ( local ) {
            cacheValue = local.data;
        }
        localRemove(`admin_${key}`); // TODO: remove eventually
    }
    adminRead(key).then(async value => {
        const adminKey = `admin.${key}`;
        await Promise.all([
            sessionWrite(adminKey, { data: value }),
            localWrite(adminKey, { data: value }),
        ]);
        if ( JSON.stringify(value) === JSON.stringify(cacheValue) ) { return; }
        adminSettings.change(key, value);
    });
    return cacheValue;
}

/******************************************************************************/

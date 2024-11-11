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
    localRead, localWrite,
    sessionRead, sessionWrite,
} from './ext.js';

import {
    enableRulesets,
    getRulesetDetails,
} from './ruleset-manager.js';

import {
    getTrustedSites,
    readFilteringModeDetails,
} from './mode-manager.js';

import { broadcastMessage } from './utils.js';
import { dnr } from './ext.js';
import { registerInjectables } from './scripting-manager.js';
import { rulesetConfig } from './config.js';
import { ubolLog } from './debug.js';

/******************************************************************************/

const adminSettings = {
    keys: new Set(),
    timer: undefined,
    change(key) {
        this.keys.add(key);
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
        if ( this.keys.has('noFiltering') ) {
            ubolLog('admin setting "noFiltering" changed');
            await readFilteringModeDetails(true);
            const trustedSites = await getTrustedSites();
            broadcastMessage({ trustedSites: Array.from(trustedSites) });
        }
        this.keys.clear();
    }
};

/******************************************************************************/

export async function getAdminRulesets() {
    const adminList = await adminReadEx('rulesets');
    const adminRulesets = new Set(Array.isArray(adminList) && adminList || []);
    if ( adminRulesets.has('-*') ) {
        adminRulesets.delete('-*');
        const rulesetDetails = await getRulesetDetails();
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
    const session = await sessionRead(`admin_${key}`);
    if ( session ) {
        cacheValue = session.data;
    } else {
        const local = await localRead(`admin_${key}`);
        if ( local ) {
            cacheValue = local.data;
        }
    }
    adminRead(key).then(async value => {
        const adminKey = `admin_${key}`;
        await Promise.all([
            sessionWrite(adminKey, { data: value }),
            localWrite(adminKey, { data: value }),
        ]);
        if ( JSON.stringify(value) === JSON.stringify(cacheValue) ) { return; }
        adminSettings.change(key);
    });
    return cacheValue;
}

/******************************************************************************/

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
    broadcastMessage,
    hasBroadHostPermissions,
    hostnamesFromMatches,
    isDescendantHostnameOfIter,
    toBroaderHostname,
} from './utils.js';

import {
    browser,
    localRead, localWrite,
    sessionRead, sessionWrite,
} from './ext.js';

import {
    rulesetConfig,
    saveRulesetConfig,
} from './config.js';

import { adminReadEx } from './admin.js';
import { filteringModesToDNR } from './ruleset-manager.js';

/******************************************************************************/

// 0:       no filtering
// 1:    basic filtering
// 2:  optimal filtering
// 3: complete filtering

export const     MODE_NONE = 0;
export const    MODE_BASIC = 1;
export const  MODE_OPTIMAL = 2;
export const MODE_COMPLETE = 3;

export const defaultFilteringModes = {
    none: [],
    basic: [],
    optimal: [ 'all-urls' ],
    complete: [],
};

/******************************************************************************/

const pruneDescendantHostnamesFromSet = (hostname, hnSet) => {
    for ( const hn of hnSet ) {
        if ( hn.endsWith(hostname) === false ) { continue; }
        if ( hn === hostname ) { continue; }
        if ( hn.at(-hostname.length-1) !== '.' ) { continue; }
        hnSet.delete(hn);
    }
};

const pruneHostnameFromSet = (hostname, hnSet) => {
    let hn = hostname;
    for (;;) {
        hnSet.delete(hn);
        hn = toBroaderHostname(hn);
        if ( hn === '*' ) { break; }
    }
};

/******************************************************************************/

const serializeModeDetails = details => {
    return {
        none: Array.from(details.none),
        basic: Array.from(details.basic),
        optimal: Array.from(details.optimal),
        complete: Array.from(details.complete),
    };
};

const unserializeModeDetails = details => {
    return {
        none: new Set(details.none),
        basic: new Set(details.basic ?? details.network),
        optimal: new Set(details.optimal ?? details.extendedSpecific),
        complete: new Set(details.complete ?? details.extendedGeneric),
    };
};

/******************************************************************************/

function lookupFilteringMode(filteringModes, hostname) {
    const { none, basic, optimal, complete } = filteringModes;
    if ( hostname === 'all-urls' ) {
        if ( filteringModes.none.has('all-urls') ) { return MODE_NONE; }
        if ( filteringModes.basic.has('all-urls') ) { return MODE_BASIC; }
        if ( filteringModes.optimal.has('all-urls') ) { return MODE_OPTIMAL; }
        if ( filteringModes.complete.has('all-urls') ) { return MODE_COMPLETE; }
        return MODE_BASIC;
    }
    if ( none.has(hostname) ) { return MODE_NONE; }
    if ( none.has('all-urls') === false ) {
        if ( isDescendantHostnameOfIter(hostname, none) ) { return MODE_NONE; }
    }
    if ( basic.has(hostname) ) { return MODE_BASIC; }
    if ( basic.has('all-urls') === false ) {
        if ( isDescendantHostnameOfIter(hostname, basic) ) { return MODE_BASIC; }
    }
    if ( optimal.has(hostname) ) { return MODE_OPTIMAL; }
    if ( optimal.has('all-urls') === false ) {
        if ( isDescendantHostnameOfIter(hostname, optimal) ) { return MODE_OPTIMAL; }
    }
    if ( complete.has(hostname) ) { return MODE_COMPLETE; }
    if ( complete.has('all-urls') === false ) {
        if ( isDescendantHostnameOfIter(hostname, complete) ) { return MODE_COMPLETE; }
    }
    return lookupFilteringMode(filteringModes, 'all-urls');
}

/******************************************************************************/

function applyFilteringMode(filteringModes, hostname, afterLevel) {
    const defaultLevel = lookupFilteringMode(filteringModes, 'all-urls');
    if ( hostname === 'all-urls' ) {
        if ( afterLevel === defaultLevel ) { return afterLevel; }
        switch ( afterLevel ) {
        case MODE_NONE:
            filteringModes.none.clear();
            filteringModes.none.add('all-urls');
            break;
        case MODE_BASIC:
            filteringModes.basic.clear();
            filteringModes.basic.add('all-urls');
            break;
        case MODE_OPTIMAL:
            filteringModes.optimal.clear();
            filteringModes.optimal.add('all-urls');
            break;
        case MODE_COMPLETE:
            filteringModes.complete.clear();
            filteringModes.complete.add('all-urls');
            break;
        }
        switch ( defaultLevel ) {
        case MODE_NONE:
            filteringModes.none.delete('all-urls');
            break;
        case MODE_BASIC:
            filteringModes.basic.delete('all-urls');
            break;
        case MODE_OPTIMAL:
            filteringModes.optimal.delete('all-urls');
            break;
        case MODE_COMPLETE:
            filteringModes.complete.delete('all-urls');
            break;
        }
        return lookupFilteringMode(filteringModes, 'all-urls');
    }
    const beforeLevel = lookupFilteringMode(filteringModes, hostname);
    if ( afterLevel === beforeLevel ) { return afterLevel; }
    const { none, basic, optimal, complete } = filteringModes;
    switch ( beforeLevel ) {
    case MODE_NONE:
        pruneHostnameFromSet(hostname, none);
        break;
    case MODE_BASIC:
        pruneHostnameFromSet(hostname, basic);
        break;
    case MODE_OPTIMAL:
        pruneHostnameFromSet(hostname, optimal);
        break;
    case MODE_COMPLETE:
        pruneHostnameFromSet(hostname, complete);
        break;
    }
    if ( afterLevel !== defaultLevel ) {
        switch ( afterLevel ) {
        case MODE_NONE:
            if ( isDescendantHostnameOfIter(hostname, none) === false ) {
                filteringModes.none.add(hostname);
                pruneDescendantHostnamesFromSet(hostname, none);
            }
            break;
        case MODE_BASIC:
            if ( isDescendantHostnameOfIter(hostname, basic) === false ) {
                filteringModes.basic.add(hostname);
                pruneDescendantHostnamesFromSet(hostname, basic);
            }
            break;
        case MODE_OPTIMAL:
            if ( isDescendantHostnameOfIter(hostname, optimal) === false ) {
                filteringModes.optimal.add(hostname);
                pruneDescendantHostnamesFromSet(hostname, optimal);
            }
            break;
        case MODE_COMPLETE:
            if ( isDescendantHostnameOfIter(hostname, complete) === false ) {
                filteringModes.complete.add(hostname);
                pruneDescendantHostnamesFromSet(hostname, complete);
            }
            break;
        }
    }
    return lookupFilteringMode(filteringModes, hostname);
}

/******************************************************************************/

export async function readFilteringModeDetails(bypassCache = false) {
    if ( bypassCache === false ) {
        if ( readFilteringModeDetails.cache ) {
            return readFilteringModeDetails.cache;
        }
        const sessionModes = await sessionRead('filteringModeDetails');
        if ( sessionModes instanceof Object ) {
            readFilteringModeDetails.cache = unserializeModeDetails(sessionModes);
            return readFilteringModeDetails.cache;
        }
    }
    let [
        userModes = structuredClone(defaultFilteringModes),
        adminDefaultFiltering,
        adminNoFiltering,
    ] = await Promise.all([
        localRead('filteringModeDetails'),
        adminReadEx('defaultFiltering'),
        adminReadEx('noFiltering'),
    ]);
    userModes = unserializeModeDetails(userModes);
    if ( adminDefaultFiltering !== undefined ) {
        const modefromName = {
            none: MODE_NONE,
            basic: MODE_BASIC,
            optimal: MODE_OPTIMAL,
            complete: MODE_COMPLETE,
        };
        const adminDefaultFilteringMode = modefromName[adminDefaultFiltering];
        if ( adminDefaultFilteringMode !== undefined ) {
            applyFilteringMode(userModes, 'all-urls', adminDefaultFilteringMode);
        }
    }
    if ( Array.isArray(adminNoFiltering) && adminNoFiltering.length !== 0 ) {
        if ( adminNoFiltering.includes('-*') ) {
            userModes.none.clear();
        }
        for ( const hn of adminNoFiltering ) {
            if ( hn.charAt(0) === '-' ) {
                userModes.none.delete(hn.slice(1));
            } else {
                applyFilteringMode(userModes, hn, 0);
            }
        }
    }
    filteringModesToDNR(userModes);
    sessionWrite('filteringModeDetails', serializeModeDetails(userModes));
    readFilteringModeDetails.cache = userModes;
    return userModes;
}

/******************************************************************************/

async function writeFilteringModeDetails(afterDetails) {
    await filteringModesToDNR(afterDetails);
    const data = serializeModeDetails(afterDetails);
    localWrite('filteringModeDetails', data);
    sessionWrite('filteringModeDetails', data);
    readFilteringModeDetails.cache = unserializeModeDetails(data);
    return Promise.all([
        getDefaultFilteringMode(),
        hasBroadHostPermissions(),
        localWrite('filteringModeDetails', data),
        sessionWrite('filteringModeDetails', data),
    ]).then(results => {
        broadcastMessage({
            defaultFilteringMode: results[0],
            hasOmnipotence: results[1],
            filteringModeDetails: readFilteringModeDetails.cache,
        });
    });
}

/******************************************************************************/

export async function getFilteringModeDetails(serializable = false) {
    const actualDetails = await readFilteringModeDetails();
    const out = {
        none: new Set(actualDetails.none),
        basic: new Set(actualDetails.basic),
        optimal: new Set(actualDetails.optimal),
        complete: new Set(actualDetails.complete),
    };
    return serializable ? serializeModeDetails(out) : out;
}

export async function setFilteringModeDetails(details) {
    await localWrite('filteringModeDetails', serializeModeDetails(details));
    await readFilteringModeDetails(true);
}

/******************************************************************************/

export async function getFilteringMode(hostname) {
    const filteringModes = await getFilteringModeDetails();
    return lookupFilteringMode(filteringModes, hostname);
}

export async function setFilteringMode(hostname, afterLevel) {
    const filteringModes = await getFilteringModeDetails();
    const level = applyFilteringMode(filteringModes, hostname, afterLevel);
    await writeFilteringModeDetails(filteringModes);
    return level;
}

/******************************************************************************/

export function getDefaultFilteringMode() {
    return getFilteringMode('all-urls');
}

export function setDefaultFilteringMode(afterLevel) {
    return setFilteringMode('all-urls', afterLevel);
}

/******************************************************************************/

export async function syncWithBrowserPermissions() {
    const [
        permissions,
        beforeMode,
    ] = await Promise.all([
        browser.permissions.getAll(),
        getDefaultFilteringMode(),
    ]);
    const allowedHostnames = new Set(hostnamesFromMatches(permissions.origins || []));
    const hasBroadHostPermissions = allowedHostnames.has('all-urls');
    const broadHostPermissionsToggled =
        hasBroadHostPermissions !== rulesetConfig.hasBroadHostPermissions;
    let modified = false;
    if ( beforeMode > MODE_BASIC && hasBroadHostPermissions === false ) {
        await setDefaultFilteringMode(MODE_BASIC);
        modified = true;
    } else if ( beforeMode === MODE_BASIC && hasBroadHostPermissions && broadHostPermissionsToggled ) {
        await setDefaultFilteringMode(MODE_OPTIMAL);
        modified = true;
    }
    if ( broadHostPermissionsToggled ) {
        rulesetConfig.hasBroadHostPermissions = hasBroadHostPermissions;
        saveRulesetConfig();
    }
    const afterMode = await getDefaultFilteringMode();
    if ( afterMode > MODE_BASIC ) { return afterMode !== beforeMode; }
    const filteringModes = await getFilteringModeDetails();
    if ( allowedHostnames.has('all-urls') === false ) {
        const { none, basic, optimal, complete } = filteringModes;
        for ( const hn of new Set([ ...optimal, ...complete ]) ) {
            applyFilteringMode(filteringModes, hn, afterMode);
            modified = true;
        }
        for ( const hn of allowedHostnames ) {
            if ( optimal.has(hn) || complete.has(hn) ) { continue; }
            if ( basic.has(hn) || none.has(hn) ) { continue; }
            applyFilteringMode(filteringModes, hn, MODE_OPTIMAL);
            modified = true;
        }
        if ( modified ) {
            await writeFilteringModeDetails(filteringModes);
        }
    }
    return modified;
}

/******************************************************************************/

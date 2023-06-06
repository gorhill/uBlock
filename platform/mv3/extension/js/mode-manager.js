/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
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

/* jshint esversion:11 */

'use strict';

/******************************************************************************/

import {
    browser,
    dnr,
    localRead, localWrite,
    sessionRead, sessionWrite,
} from './ext.js';

import {
    hostnamesFromMatches,
    isDescendantHostnameOfIter,
    toBroaderHostname,
} from './utils.js';

import {
    TRUSTED_DIRECTIVE_BASE_RULE_ID,
    BLOCKING_MODES_RULE_ID,
    getDynamicRules
} from './ruleset-manager.js';

/******************************************************************************/

const pruneDescendantHostnamesFromSet = (hostname, hnSet) => {
    for ( const hn of hnSet ) {
        if ( hn.endsWith(hostname) === false ) { continue; }
        if ( hn === hostname ) { continue; }
        if ( hn.at(-hostname.length-1) !== '.' ) { continue; }
        hnSet.delete(hn);
    }
};

/******************************************************************************/

const pruneHostnameFromSet = (hostname, hnSet) => {
    let hn = hostname;
    for (;;) {
        hnSet.delete(hn);
        hn = toBroaderHostname(hn);
        if ( hn === '*' ) { break; }
    }
};

/******************************************************************************/

const eqSets = (setBefore, setAfter) => {
    for ( const hn of setAfter ) {
        if ( setBefore.has(hn) === false ) { return false; }
    }
    for ( const hn of setBefore ) {
        if ( setAfter.has(hn) === false ) { return false; }
    }
    return true;
};

/******************************************************************************/

// 0:      no blocking
// 1:          network
// 2: specific content
// 3:  generic content

async function getActualFilteringModeDetails() {
    if ( getActualFilteringModeDetails.cache ) {
        return getActualFilteringModeDetails.cache;
    }
    let details = await sessionRead('filteringModeDetails');
    if ( details === undefined ) {
        details = await localRead('filteringModeDetails');
        if ( details === undefined ) {
            details = await getActualFilteringModeDetails.convertLegacyStorage();
            if ( details === undefined ) {
                details = {
                    network: [ 'all-urls' ],
                };
            }
        }
        if ( details ) {
            sessionWrite('filteringModeDetails', details);
        }
    }
    const out = {
        none: new Set(details.none),
        network: new Set(details.network),
        extendedSpecific: new Set(details.extendedSpecific),
        extendedGeneric: new Set(details.extendedGeneric),
    };
    getActualFilteringModeDetails.cache = out;
    return out;
}

// TODO: To remove after next stable release is widespread (2023-06-04)
getActualFilteringModeDetails.convertLegacyStorage = async function() {
    const dynamicRuleMap = await getDynamicRules();
    const trustedSiteDirectives = (( ) => {
        const rule = dynamicRuleMap.get(TRUSTED_DIRECTIVE_BASE_RULE_ID);
        return rule ? rule.condition.requestDomains : [];
    })();
    const rule = dynamicRuleMap.get(BLOCKING_MODES_RULE_ID);
    if ( rule === undefined ) { return; }
    dnr.updateDynamicRules({
        removeRuleIds: [
            BLOCKING_MODES_RULE_ID,
        ],
    });
    const details = {
        none: trustedSiteDirectives || [],
        network: rule.condition.excludedInitiatorDomains || [],
        extendedSpecific: rule.condition.excludedRequestDomains || [],
        extendedGeneric: rule.condition.initiatorDomains || [],
    };
    sessionWrite('filteringModeDetails', details);
    localWrite('filteringModeDetails', details);
    return details;
};

/******************************************************************************/

async function getFilteringModeDetails() {
    const actualDetails = await getActualFilteringModeDetails();
    return {
        none: new Set(actualDetails.none),
        network: new Set(actualDetails.network),
        extendedSpecific: new Set(actualDetails.extendedSpecific),
        extendedGeneric: new Set(actualDetails.extendedGeneric),
    };
}

/******************************************************************************/

async function setFilteringModeDetails(afterDetails) {
    const actualDetails = await getActualFilteringModeDetails();
    if ( eqSets(actualDetails.none, afterDetails.none) === false ) {
        const dynamicRuleMap = await getDynamicRules();
        const removeRuleIds = [];
        if ( dynamicRuleMap.has(TRUSTED_DIRECTIVE_BASE_RULE_ID) ) {
            removeRuleIds.push(TRUSTED_DIRECTIVE_BASE_RULE_ID);
            dynamicRuleMap.delete(TRUSTED_DIRECTIVE_BASE_RULE_ID);
        }
        const addRules = [];
        if ( afterDetails.none.size !== 0 ) {
            const rule = {
                id: TRUSTED_DIRECTIVE_BASE_RULE_ID,
                action: { type: 'allowAllRequests' },
                condition: {
                    resourceTypes: [ 'main_frame' ],
                },
                priority: 100,
            };
            if (
                afterDetails.none.size !== 1 ||
                afterDetails.none.has('all-urls') === false
            ) {
                rule.condition.requestDomains = Array.from(afterDetails.none);
            }
            addRules.push(rule);
            dynamicRuleMap.set(TRUSTED_DIRECTIVE_BASE_RULE_ID, rule);
        }
        if ( addRules.length !== 0 || removeRuleIds.length !== 0 ) {
            const updateOptions = {};
            if ( addRules.length ) {
                updateOptions.addRules = addRules;
            }
            if ( removeRuleIds.length ) {
                updateOptions.removeRuleIds = removeRuleIds;
            }
            await dnr.updateDynamicRules(updateOptions);
        }
    }
    const data = {
        none: Array.from(afterDetails.none),
        network: Array.from(afterDetails.network),
        extendedSpecific: Array.from(afterDetails.extendedSpecific),
        extendedGeneric: Array.from(afterDetails.extendedGeneric),
    };
    sessionWrite('filteringModeDetails', data);
    localWrite('filteringModeDetails', data);
    getActualFilteringModeDetails.cache = undefined;
}

/******************************************************************************/

async function getFilteringMode(hostname) {
    const filteringModes = await getFilteringModeDetails();
    const {
        none,
        network,
        extendedSpecific,
        extendedGeneric,
    } = filteringModes;
    if ( none.has(hostname) ) { return 0; }
    if ( none.has('all-urls')  === false ) {
        if ( isDescendantHostnameOfIter(hostname, none) ) { return 0; }
    }
    if ( network.has(hostname) ) { return 1; }
    if ( network.has('all-urls')  === false ) {
        if ( isDescendantHostnameOfIter(hostname, network) ) { return 1; }
    }
    if ( extendedSpecific.has(hostname) ) { return 2; }
    if ( extendedSpecific.has('all-urls')  === false ) {
        if ( isDescendantHostnameOfIter(hostname, extendedSpecific) ) { return 2; }
    }
    if ( extendedGeneric.has(hostname) ) { return 3; }
    if ( extendedGeneric.has('all-urls')  === false ) {
        if ( isDescendantHostnameOfIter(hostname, extendedGeneric) ) { return 3; }
    }
    return getDefaultFilteringMode();
}

/******************************************************************************/

async function setFilteringMode(hostname, afterLevel) {
    if ( hostname === 'all-urls' ) {
        return setDefaultFilteringMode(afterLevel);
    }
    const [
        beforeLevel,
        defaultLevel,
        filteringModes
    ] = await Promise.all([
        getFilteringMode(hostname),
        getDefaultFilteringMode(),
        getFilteringModeDetails(),
    ]);
    if ( afterLevel === beforeLevel ) { return afterLevel; }
    const {
        none,
        network,
        extendedSpecific,
        extendedGeneric,
    } = filteringModes;
    switch ( beforeLevel ) {
    case 0:
        pruneHostnameFromSet(hostname, none);
        break;
    case 1:
        pruneHostnameFromSet(hostname, network);
        break;
    case 2:
        pruneHostnameFromSet(hostname, extendedSpecific);
        break;
    case 3:
        pruneHostnameFromSet(hostname, extendedGeneric);
        break;
    }
    if ( afterLevel !== defaultLevel ) {
        switch ( afterLevel ) {
        case 0:
            if ( isDescendantHostnameOfIter(hostname, none) === false ) {
                filteringModes.none.add(hostname);
                pruneDescendantHostnamesFromSet(hostname, none);
            }
            break;
        case 1:
            if ( isDescendantHostnameOfIter(hostname, network) === false ) {
                filteringModes.network.add(hostname);
                pruneDescendantHostnamesFromSet(hostname, network);
            }
            break;
        case 2:
            if ( isDescendantHostnameOfIter(hostname, extendedSpecific) === false ) {
                filteringModes.extendedSpecific.add(hostname);
                pruneDescendantHostnamesFromSet(hostname, extendedSpecific);
            }
            break;
        case 3:
            if ( isDescendantHostnameOfIter(hostname, extendedGeneric) === false ) {
                filteringModes.extendedGeneric.add(hostname);
                pruneDescendantHostnamesFromSet(hostname, extendedGeneric);
            }
            break;
        }
    }
    await setFilteringModeDetails(filteringModes);
    return getFilteringMode(hostname);
}

/******************************************************************************/

async function getDefaultFilteringMode() {
    const filteringModes = await getFilteringModeDetails();
    if ( filteringModes.none.has('all-urls') ) { return 0; }
    if ( filteringModes.network.has('all-urls') ) { return 1; }
    if ( filteringModes.extendedSpecific.has('all-urls') ) { return 2; }
    if ( filteringModes.extendedGeneric.has('all-urls') ) { return 3; }
    return 1;
}

/******************************************************************************/

async function setDefaultFilteringMode(afterLevel) {
    const [ beforeLevel, filteringModes ] = await Promise.all([
        getDefaultFilteringMode(),
        getFilteringModeDetails(),
    ]);
    if ( afterLevel === beforeLevel ) { return afterLevel; }
    switch ( afterLevel ) {
    case 0:
        filteringModes.none.clear();
        filteringModes.none.add('all-urls');
        break;
    case 1:
        filteringModes.network.clear();
        filteringModes.network.add('all-urls');
        break;
    case 2:
        filteringModes.extendedSpecific.clear();
        filteringModes.extendedSpecific.add('all-urls');
        break;
    case 3:
        filteringModes.extendedGeneric.clear();
        filteringModes.extendedGeneric.add('all-urls');
        break;
    }
    switch ( beforeLevel ) {
    case 0:
        filteringModes.none.delete('all-urls');
        break;
    case 1:
        filteringModes.network.delete('all-urls');
        break;
    case 2:
        filteringModes.extendedSpecific.delete('all-urls');
        break;
    case 3:
        filteringModes.extendedGeneric.delete('all-urls');
        break;
    }
    await setFilteringModeDetails(filteringModes);
    return getDefaultFilteringMode();
}

/******************************************************************************/

async function syncWithBrowserPermissions() {
    const permissions = await browser.permissions.getAll();
    const allowedHostnames = new Set(hostnamesFromMatches(permissions.origins || []));
    const beforeMode = await getDefaultFilteringMode();
    let modified = false;
    if ( beforeMode > 1 && allowedHostnames.has('all-urls') === false ) {
        await setDefaultFilteringMode(1);
        modified = true;
    }
    const afterMode = await getDefaultFilteringMode();
    if ( afterMode > 1 ) { return false; }
    const filteringModes = await getFilteringModeDetails();
    const { extendedSpecific, extendedGeneric } = filteringModes;
    for ( const hn of extendedSpecific ) {
        if ( allowedHostnames.has(hn) ) { continue; }
        extendedSpecific.delete(hn);
        modified = true;
    }
    for ( const hn of extendedGeneric ) {
        if ( allowedHostnames.has(hn) ) { continue; }
        extendedGeneric.delete(hn);
        modified = true;
    }
    await setFilteringModeDetails(filteringModes);
    return modified;
}

/******************************************************************************/

export {
    getFilteringMode,
    setFilteringMode,
    getDefaultFilteringMode,
    setDefaultFilteringMode,
    getFilteringModeDetails,
    syncWithBrowserPermissions,
};

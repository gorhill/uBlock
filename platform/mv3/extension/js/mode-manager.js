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
} from './ext.js';

import {
    hostnamesFromMatches,
    isDescendantHostnameOfIter,
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

// 0:      no blocking => TRUSTED_DIRECTIVE_BASE_RULE_ID / requestDomains
// 1:          network => BLOCKING_MODES_RULE_ID / excludedInitiatorDomains
// 2: specific content => BLOCKING_MODES_RULE_ID / excludedRequestDomains
// 3:  generic content => BLOCKING_MODES_RULE_ID / initiatorDomains

let filteringModeDetailsPromise;

function getActualFilteringModeDetails() {
    if ( filteringModeDetailsPromise !== undefined ) {
        return filteringModeDetailsPromise;
    }
    filteringModeDetailsPromise = Promise.all([
        getDynamicRules(),
        getAllTrustedSiteDirectives(),
    ]).then(results => {
        const [ dynamicRuleMap, trustedSiteDirectives ] = results;
        const details = {
            none: new Set(trustedSiteDirectives),
        };
        const rule = dynamicRuleMap.get(BLOCKING_MODES_RULE_ID);
        if ( rule ) {
            details.network = new Set(rule.condition.excludedInitiatorDomains);
            details.extendedSpecific = new Set(rule.condition.excludedRequestDomains);
            details.extendedGeneric = new Set(rule.condition.initiatorDomains);
        } else {
            details.network = new Set([ 'all-urls' ]);
            details.extendedSpecific = new Set();
            details.extendedGeneric = new Set();
        }
        return details;
    });
    return filteringModeDetailsPromise;
}

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
    const [ dynamicRuleMap, actualDetails ] = await Promise.all([
        getDynamicRules(),
        getActualFilteringModeDetails(),
    ]);
    const addRules = [];
    const removeRuleIds = [];
    if ( eqSets(actualDetails.none, afterDetails.none) === false ) {
        actualDetails.none = afterDetails.none;
        if ( dynamicRuleMap.has(TRUSTED_DIRECTIVE_BASE_RULE_ID) ) {
            removeRuleIds.push(TRUSTED_DIRECTIVE_BASE_RULE_ID);
            dynamicRuleMap.delete(TRUSTED_DIRECTIVE_BASE_RULE_ID);
        }
        const rule = {
            id: TRUSTED_DIRECTIVE_BASE_RULE_ID,
            action: { type: 'allowAllRequests' },
            condition: {
                requestDomains: [],
                resourceTypes: [ 'main_frame' ],
            },
            priority: 100,
        };
        if ( actualDetails.none.size ) {
            rule.condition.requestDomains = Array.from(actualDetails.none);
            addRules.push(rule);
            dynamicRuleMap.set(TRUSTED_DIRECTIVE_BASE_RULE_ID, rule);
        }
    }
    if (
        eqSets(actualDetails.network, afterDetails.network) === false ||
        eqSets(actualDetails.extendedSpecific, afterDetails.extendedSpecific) === false ||
        eqSets(actualDetails.extendedGeneric, afterDetails.extendedGeneric) === false
    ) {
        actualDetails.network = afterDetails.network;
        actualDetails.extendedSpecific = afterDetails.extendedSpecific;
        actualDetails.extendedGeneric = afterDetails.extendedGeneric;
        if ( dynamicRuleMap.has(BLOCKING_MODES_RULE_ID) ) {
            removeRuleIds.push(BLOCKING_MODES_RULE_ID);
            dynamicRuleMap.delete(BLOCKING_MODES_RULE_ID);
        }
        const rule = {
            id: BLOCKING_MODES_RULE_ID,
            action: { type: 'allow' },
            condition: {
                resourceTypes: [ 'main_frame' ],
                urlFilter: '||ubol-blocking-modes.invalid^',
            },
        };
        if ( actualDetails.network.size ) {
            rule.condition.excludedInitiatorDomains =
                Array.from(actualDetails.network);
        }
        if ( actualDetails.extendedSpecific.size ) {
            rule.condition.excludedRequestDomains =
                Array.from(actualDetails.extendedSpecific);
        }
        if ( actualDetails.extendedGeneric.size ) {
            rule.condition.initiatorDomains =
                Array.from(actualDetails.extendedGeneric);
        }
        if (
            actualDetails.network.size ||
            actualDetails.extendedSpecific.size ||
            actualDetails.extendedGeneric.size
        )  {
            addRules.push(rule);
            dynamicRuleMap.set(BLOCKING_MODES_RULE_ID, rule);
        }
    }
    if ( addRules.length === 0 && removeRuleIds.length === 0 ) { return; }
    const updateOptions = {};
    if ( addRules.length ) {
        updateOptions.addRules = addRules;
    }
    if ( removeRuleIds.length ) {
        updateOptions.removeRuleIds = removeRuleIds;
    }
    return dnr.updateDynamicRules(updateOptions);
}

/******************************************************************************/

async function getFilteringMode(hostname) {
    const filteringModes = await getFilteringModeDetails();
    if ( filteringModes.none.has(hostname) ) { return 0; }
    if ( filteringModes.network.has(hostname) ) { return 1; }
    if ( filteringModes.extendedSpecific.has(hostname) ) { return 2; }
    if ( filteringModes.extendedGeneric.has(hostname) ) { return 3; }
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
        none.delete(hostname);
        break;
    case 1:
        network.delete(hostname);
        break;
    case 2:
        extendedSpecific.delete(hostname);
        break;
    case 3:
        extendedGeneric.delete(hostname);
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

async function getAllTrustedSiteDirectives() {
    const dynamicRuleMap = await getDynamicRules();
    const rule = dynamicRuleMap.get(TRUSTED_DIRECTIVE_BASE_RULE_ID);
    if ( rule === undefined ) { return []; }
    return rule.condition.requestDomains;
}

/******************************************************************************/

export {
    getFilteringMode,
    setFilteringMode,
    getDefaultFilteringMode,
    setDefaultFilteringMode,
    getFilteringModeDetails,
    getAllTrustedSiteDirectives,
    syncWithBrowserPermissions,
};

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

import { dnr } from './ext.js';

import {
    parsedURLromOrigin,
    toBroaderHostname,
} from './utils.js';

import {
    TRUSTED_DIRECTIVE_BASE_RULE_ID,
    getDynamicRules
} from './ruleset-manager.js';

/******************************************************************************/

async function getAllTrustedSiteDirectives() {
    const dynamicRuleMap = await getDynamicRules();
    const rule = dynamicRuleMap.get(TRUSTED_DIRECTIVE_BASE_RULE_ID);
    if ( rule === undefined ) { return []; }
    return rule.condition.requestDomains;
}

/******************************************************************************/

async function matchesTrustedSiteDirective(details) {
    const hostname =
        details.hostname ||
        parsedURLromOrigin(details.origin)?.hostname ||
        undefined;
    if ( hostname === undefined ) { return false; }
    
    const dynamicRuleMap = await getDynamicRules();
    const rule = dynamicRuleMap.get(TRUSTED_DIRECTIVE_BASE_RULE_ID);
    if ( rule === undefined ) { return false; }

    const domainSet = new Set(rule.condition.requestDomains);
    let hn = hostname;
    while ( hn ) {
        if ( domainSet.has(hn) ) { return true; }
        hn = toBroaderHostname(hn);
    }
    
    return false;
}

/******************************************************************************/

async function addTrustedSiteDirective(details) {
    const url = parsedURLromOrigin(details.origin);
    if ( url === undefined ) { return false; }

    const dynamicRuleMap = await getDynamicRules();
    let rule = dynamicRuleMap.get(TRUSTED_DIRECTIVE_BASE_RULE_ID);
    if ( rule !== undefined ) {
        rule.condition.initiatorDomains = undefined;
        if ( Array.isArray(rule.condition.requestDomains) === false ) {
            rule.condition.requestDomains = [];
        }
    }

    if ( rule === undefined ) {
        rule = {
            id: TRUSTED_DIRECTIVE_BASE_RULE_ID,
            action: {
                type: 'allowAllRequests',
            },
            condition: {
                requestDomains: [ url.hostname ],
                resourceTypes: [ 'main_frame' ],
            },
            priority: TRUSTED_DIRECTIVE_BASE_RULE_ID,
        };
        dynamicRuleMap.set(TRUSTED_DIRECTIVE_BASE_RULE_ID, rule);
    } else if ( rule.condition.requestDomains.includes(url.hostname) === false ) {
        rule.condition.requestDomains.push(url.hostname);
    }

    await dnr.updateDynamicRules({
        addRules: [ rule ],
        removeRuleIds: [ TRUSTED_DIRECTIVE_BASE_RULE_ID ],
    });

    return true;
}

/******************************************************************************/

async function removeTrustedSiteDirective(details) {
    const url = parsedURLromOrigin(details.origin);
    if ( url === undefined ) { return false; }

    const dynamicRuleMap = await getDynamicRules();
    let rule = dynamicRuleMap.get(TRUSTED_DIRECTIVE_BASE_RULE_ID);
    if ( rule === undefined ) { return false; }
    rule.condition.initiatorDomains = undefined;
    if ( Array.isArray(rule.condition.requestDomains) === false ) {
        rule.condition.requestDomains = [];
    }

    const domainSet = new Set(rule.condition.requestDomains);
    const beforeCount = domainSet.size;
    let hostname = url.hostname;
    for (;;) {
        domainSet.delete(hostname);
        const pos = hostname.indexOf('.');
        if ( pos === -1 ) { break; }
        hostname = hostname.slice(pos+1);
    }

    if ( domainSet.size === beforeCount ) { return false; }

    if ( domainSet.size === 0 ) {
        dynamicRuleMap.delete(TRUSTED_DIRECTIVE_BASE_RULE_ID);
        await dnr.updateDynamicRules({
            removeRuleIds: [ TRUSTED_DIRECTIVE_BASE_RULE_ID ]
        });
        return false;
    }

    rule.condition.requestDomains = Array.from(domainSet);

    await dnr.updateDynamicRules({
        addRules: [ rule ],
        removeRuleIds: [ TRUSTED_DIRECTIVE_BASE_RULE_ID ],
    });

    return false;
}

/******************************************************************************/

async function toggleTrustedSiteDirective(details) {
    return details.state
        ? removeTrustedSiteDirective(details)
        : addTrustedSiteDirective(details);
}

/******************************************************************************/

export {
    getAllTrustedSiteDirectives,
    matchesTrustedSiteDirective,
    toggleTrustedSiteDirective,
};

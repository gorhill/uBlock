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

export const webext = self.browser || self.chrome;
export const dnr = webext.declarativeNetRequest || {};

/******************************************************************************/

const ruleCompare = (a, b) => a.id - b.id;

const isSameRules = (a, b) => {
    a.sort(ruleCompare);
    b.sort(ruleCompare);
    return JSON.stringify(a) === JSON.stringify(b);
};

/******************************************************************************/

export function normalizeDNRRules(rules, ruleIds) {
    if ( Array.isArray(rules) === false ) { return rules; }
    return Array.isArray(ruleIds)
        ? rules.filter(rule => ruleIds.includes(rule.id))
        : rules;
}

/******************************************************************************/

dnr.setAllowAllRules = async function(id, allowed, notAllowed, reverse, priority) {
    const [
        beforeDynamicRules,
        beforeSessionRules,
    ] = await Promise.all([
        dnr.getDynamicRules({ ruleIds: [ id+0 ] }),
        dnr.getSessionRules({ ruleIds: [ id+1 ] }),
    ]);
    const addDynamicRules = [];
    const addSessionRules = [];
    if ( reverse || allowed.length || notAllowed.length ) {
        const rule0 = {
            id: id+0,
            action: { type: 'allowAllRequests' },
            condition: {
                resourceTypes: [ 'main_frame' ],
            },
            priority,
        };
        if ( allowed.length ) {
            rule0.condition.requestDomains = allowed.slice();
        } else if ( notAllowed.length ) {
            rule0.condition.excludedRequestDomains = notAllowed.slice();
        }
        addDynamicRules.push(rule0);
        // https://github.com/uBlockOrigin/uBOL-home/issues/114
        // https://github.com/uBlockOrigin/uBOL-home/issues/247
        const rule1 = {
            id: id+1,
            action: { type: 'allow' },
            condition: {
                tabIds: [ webext.tabs.TAB_ID_NONE ],
            },
            priority,
        };
        if ( allowed.length ) {
            rule1.condition.initiatorDomains = allowed.slice();
        } else if ( notAllowed.length ) {
            rule1.condition.excludedInitiatorDomains = notAllowed.slice();
        }
        addSessionRules.push(rule1);
    }
    if ( isSameRules(addDynamicRules, beforeDynamicRules) ) { return false; }
    return Promise.all([
        dnr.updateDynamicRules({
            addRules: addDynamicRules,
            removeRuleIds: beforeDynamicRules.map(r => r.id),
        }),
        dnr.updateSessionRules({
            addRules: addSessionRules,
            removeRuleIds: beforeSessionRules.map(r => r.id),
        }),
    ]).then(( ) =>
        true
    ).catch(( ) =>
        false
    );
};

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


export const webext = self.browser;

/******************************************************************************/

// https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest/

const nativeDNR = webext.declarativeNetRequest;

const isSupportedRule = r => {
    if ( r.action.responseHeaders ) { return false; }
    const { condition } = r;
    if ( condition.tabIds !== undefined ) { return false; }
    if ( condition.resourceTypes?.includes('object') ) {
        if ( condition.resourceTypes.length === 1 ) { return false; }
        const i = condition.resourceTypes.indexOf('object');
        condition.resourceTypes.splice(i, 1);
    }
    if ( condition.excludedResourceTypes?.includes('object') ) {
        const i = condition.excludedResourceTypes.indexOf('object');
        condition.excludedResourceTypes.splice(i, 1);
        if ( condition.excludedResourceTypes.length === 0 ) {
            delete condition.excludedResourceTypes;
        }
    }
    return true;
};

const prepareUpdateRules = optionsBefore => {
    const { addRules, removeRuleIds } = optionsBefore;
    const addRulesAfter = addRules?.filter(isSupportedRule);
    if ( Boolean(addRulesAfter?.length || removeRuleIds?.length) === false ) { return; }
    addRulesAfter?.forEach(r => {
        if ( r.action?.redirect?.regexSubstitution ) {
            if ( r.condition?.requestDomains ) {
                r.condition.domains = r.condition.requestDomains;
                delete r.condition.requestDomains;
                return;
            }
        }
        if ( r.condition?.initiatorDomains ) {
            r.condition.domains = r.condition.initiatorDomains;
            delete r.condition.initiatorDomains;
        }
        if ( r.condition?.excludedInitiatorDomains ) {
            r.condition.excludedDomains = r.condition.excludedInitiatorDomains;
            delete r.condition.excludedInitiatorDomains;
        }
    });
    const optionsAfter = {};
    if ( addRulesAfter?.length ) { optionsAfter.addRules = addRulesAfter; }
    if ( removeRuleIds?.length ) { optionsAfter.removeRuleIds = removeRuleIds; }
    return optionsAfter;
};

const ruleCompare = (a, b) => a.id - b.id;

const isSameRules = (a, b) => {
    a.sort(ruleCompare);
    b.sort(ruleCompare);
    return JSON.stringify(a) === JSON.stringify(b);
};

/******************************************************************************/

export function normalizeDNRRules(rules, ruleIds) {
    if ( Array.isArray(rules) === false ) { return rules; }
    const selectedRules = Array.isArray(ruleIds)
        ? rules.filter(rule => ruleIds.includes(rule.id))
        : rules;
    selectedRules.forEach(rule => {
        const { condition } = rule;
        if ( Array.isArray(condition.domains) ) {
            condition.initiatorDomains = condition.domains;
            delete condition.domains;
        }
        if ( Array.isArray(condition.excludedDomains) ) {
            condition.excludedInitiatorDomains = condition.excludedDomains;
            delete condition.excludedDomains;
        }
    });
    return selectedRules;
}

/******************************************************************************/

export const dnr = {
    DYNAMIC_RULESET_ID: '_dynamic',
    MAX_NUMBER_OF_ENABLED_STATIC_RULESETS: nativeDNR.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS,
    MAX_NUMBER_OF_REGEX_RULES: nativeDNR.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES,
    async getAvailableStaticRuleCount() {
        return 150000;
    },
    getDynamicRules({ ruleIds } = {}) {
        return new Promise(resolve => {
            nativeDNR.getDynamicRules(rules => {
                if ( Array.isArray(rules) === false ) { return resolve([]); }
                return resolve(normalizeDNRRules(rules, ruleIds));
            });
        });
    },
    getEnabledRulesets(...args) {
        return nativeDNR.getEnabledRulesets(...args);
    },
    getMatchedRules(...args) {
        return nativeDNR.getMatchedRules(...args);
    },
    getSessionRules({ ruleIds } = {}) {
        return new Promise(resolve => {
            nativeDNR.getSessionRules(rules => {
                if ( Array.isArray(rules) === false ) { return resolve([]); }
                return resolve(normalizeDNRRules(rules, ruleIds));
            });
        });
    },
    isRegexSupported(...args) {
        return nativeDNR.isRegexSupported(...args);
    },
    async updateDynamicRules(optionsBefore) {
        const optionsAfter = prepareUpdateRules(optionsBefore);
        if ( optionsAfter === undefined ) { return; }
        return nativeDNR.updateDynamicRules(optionsAfter);
    },
    updateEnabledRulesets(...args) {
        return nativeDNR.updateEnabledRulesets(...args);
    },
    async updateSessionRules(optionsBefore) {
        const optionsAfter = prepareUpdateRules(optionsBefore);
        if ( optionsAfter === undefined ) { return; }
        return nativeDNR.updateSessionRules(optionsAfter);
    },
    async setAllowAllRules(id, allowed, notAllowed, reverse, priority) {
        const beforeRules = await this.getDynamicRules({ ruleIds: [ id+0 ] });
        const addRules = [];
        if ( reverse || allowed.length || notAllowed.length ) {
            const rule0 = {
                id: id+0,
                action: { type: 'allow' },
                condition: { urlFilter: '*' },
                priority,
            };
            if ( allowed.length ) {
                rule0.condition.domains = allowed;
            } else if ( notAllowed.length ) {
                rule0.condition.excludedDomains = notAllowed;
            }
            addRules.push(rule0);
        }
        if ( isSameRules(addRules, beforeRules) ) { return false; }
        return this.updateDynamicRules({
            addRules,
            removeRuleIds: beforeRules.map(r => r.id),
        }).then(( ) =>
            true
        ).catch(( ) =>
            false
        );
    },
    setExtensionActionOptions(...args) {
        return nativeDNR.setExtensionActionOptions(...args);
    },
};

/******************************************************************************/

// Workaround for:
// https://github.com/uBlockOrigin/uBOL-home/issues/515
// https://bugs.webkit.org/show_bug.cgi?id=300236
//
// For each realm, we will force-reload registered rulesets once.

const { windows } = webext;
const  NORMAL_REALM = 0b01;
const PRIVATE_REALM = 0b10;
const ALL_REALMS = NORMAL_REALM | PRIVATE_REALM;
let seenRealms = 0b00;

async function forceEnableRulesets(windowId) {
    if ( seenRealms === ALL_REALMS ) { return; }
    if ( windowId === windows.WINDOW_ID_NONE ) { return; }
    const details = await windows.get(windowId, { windowTypes: [ 'normal' ] });
    const incognito = details?.incognito;
    if ( typeof incognito !== 'boolean' ) { return; }
    const currentRealm = incognito ? PRIVATE_REALM : NORMAL_REALM;
    if ( (seenRealms & currentRealm) !== 0 ) { return; }
    seenRealms |= currentRealm;
    webext.storage.session.set({ __seenRealms: seenRealms });
    const ids = await nativeDNR.getEnabledRulesets();
    if ( ids.length === 0 ) { return; }
    nativeDNR.updateEnabledRulesets({
        disableRulesetIds: ids.slice(),
        enableRulesetIds: ids.slice(),
    });
}

windows.onFocusChanged.addListener(forceEnableRulesets);

webext.storage.session.get('__seenRealms').then(bin => {
    seenRealms |= bin?.__seenRealms ?? 0;
}).catch(( ) => {
});


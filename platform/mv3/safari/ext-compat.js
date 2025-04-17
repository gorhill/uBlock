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
export const INITIATOR_DOMAINS = 'domains';
export const EXCLUDED_INITIATOR_DOMAINS = 'excludedDomains';

// https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest/

const nativeDNR = webext.declarativeNetRequest;

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
                if ( Array.isArray(ruleIds) === false ) { return resolve(rules); }
                return resolve(rules.filter(rule => ruleIds.includes(rule.id)));
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
                if ( Array.isArray(ruleIds) === false ) { return resolve(rules); }
                return resolve(rules.filter(rule => ruleIds.includes(rule.id)));
            });
        });
    },
    isRegexSupported(...args) {
        return nativeDNR.isRegexSupported(...args);
    },
    updateDynamicRules(options) {
        const { addedRules, removedRuleIds } = options;
        let validRules = addedRules;
        if ( validRules ) {
            validRules = validRules.filter(r => {
                if ( r.action?.responseHeaders ) { return false; }
                if ( r.condition?.tabIds !== undefined ) { return false; }
                return true;
            });
        }
        return nativeDNR.updateDynamicRules({ addedRules: validRules, removedRuleIds });
    },
    updateEnabledRulesets(...args) {
        return nativeDNR.updateEnabledRulesets(...args);
    },
    updateSessionRules(options) {
        const { addedRules, removedRuleIds } = options;
        let validRules = addedRules;
        if ( validRules ) {
            validRules = validRules.filter(r => {
                if ( r.action?.responseHeaders ) { return false; }
                if ( r.condition?.tabIds !== undefined ) { return false; }
                return true;
            });
        }
        return nativeDNR.updateSessionRules({ addedRules: validRules, removedRuleIds });
    },
};

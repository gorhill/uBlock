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

export const initiatorDomains = 'domains';
export const excludedInitiatorDomains = 'excludedDomains';

const { declarativeNetRequest: dnr } = webext;
const { getDynamicRules, getSessionRules } = dnr;

// https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest/getDynamicRules
dnr.getDynamicRules = function({ ruleIds } = {}) {
    return new Promise(resolve => {
        getDynamicRules.call(dnr, rules => {
            if ( Array.isArray(rules) === false ) { return resolve([]); }
            if ( Array.isArray(ruleIds) === false ) { return resolve(rules); }
            return resolve(rules.filter(rule => ruleIds.includes(rule.id)));
        });
    });
};

// https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest/getSessionRules
dnr.getSessionRules = function({ ruleIds } = {}) {
    return new Promise(resolve => {
        getSessionRules.call(dnr, rules => {
            if ( Array.isArray(rules) === false ) { return resolve([]); }
            if ( Array.isArray(ruleIds) === false ) { return resolve(rules); }
            return resolve(rules.filter(rule => ruleIds.includes(rule.id)));
        });
    });
};

// https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest/getSessionRules
webext.declarativeNetRequest.getAvailableStaticRuleCount = async function() {
    return 150000;
};

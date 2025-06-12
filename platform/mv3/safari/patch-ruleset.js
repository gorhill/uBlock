/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2025-present Raymond Hill

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

function patchRuleWithRequestDomains(rule, out) {
    const requestDomains = rule.condition.requestDomains;
    delete rule.condition.requestDomains;
    for ( const domain of requestDomains ) {
        const newRule = structuredClone(rule);
        newRule.condition.urlFilter = `||${domain}^`;
        out.push(newRule);
    }
}

export function patchRuleset(ruleset) {
    const out = [];
    for ( const rule of ruleset ) {
        const condition = rule.condition;
        if ( rule.action.type === 'modifyHeaders' ) { continue; }
        if ( Array.isArray(rule.condition.responseHeaders) ) { continue; }
        if ( Array.isArray(condition.requestMethods) ) { continue; }
        if ( Array.isArray(condition.excludedRequestMethods) ) { continue; }
        if ( Array.isArray(condition.initiatorDomains) ) {
            condition.domains = condition.initiatorDomains;
            delete condition.initiatorDomains;
        }
        if ( Array.isArray(condition.excludedInitiatorDomains) ) {
            condition.excludedDomains = condition.excludedInitiatorDomains;
            delete condition.excludedInitiatorDomains;
        }
        out.push(rule);
    }
    return out;
}

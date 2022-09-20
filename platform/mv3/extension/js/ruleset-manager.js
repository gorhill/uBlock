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

import { dnr, i18n } from './ext.js';
import { fetchJSON } from './fetch.js';

/******************************************************************************/

const RULE_REALM_SIZE = 1000000;
const REGEXES_REALM_START = 1000000;
const REGEXES_REALM_END = REGEXES_REALM_START + RULE_REALM_SIZE;
const TRUSTED_DIRECTIVE_BASE_RULE_ID = 8000000;
const CURRENT_CONFIG_BASE_RULE_ID = 9000000;

/******************************************************************************/

let rulesetDetailsPromise;

function getRulesetDetails() {
    if ( rulesetDetailsPromise !== undefined ) {
        return rulesetDetailsPromise;
    }
    rulesetDetailsPromise = fetchJSON('/rulesets/ruleset-details').then(entries => {
        const map = new Map(
            entries.map(entry => [ entry.id, entry ])
        );
        return map;
    });
    return rulesetDetailsPromise;
}

/******************************************************************************/

let dynamicRuleMapPromise;

function getDynamicRules() {
    if ( dynamicRuleMapPromise !== undefined ) {
        return dynamicRuleMapPromise;
    }
    dynamicRuleMapPromise = dnr.getDynamicRules().then(rules => {
        const map = new Map(
            rules.map(rule => [ rule.id, rule ])
        );
        console.log(`Dynamic rule count: ${map.size}`);
        console.log(`Available dynamic rule count: ${dnr.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES - map.size}`);
        return map;
    });
    return dynamicRuleMapPromise;
}

/******************************************************************************/

async function updateRegexRules() {
    const [
        rulesetDetails,
        dynamicRules
    ] = await Promise.all([
        getRulesetDetails(),
        dnr.getDynamicRules(),
    ]);

    // Avoid testing already tested regexes
    const validRegexSet = new Set(
        dynamicRules.filter(rule =>
            rule.condition?.regexFilter && true || false
        ).map(rule =>
            rule.condition.regexFilter
        )
    );
    const allRules = [];
    const toCheck = [];

    // Fetch regexes for all enabled rulesets
    const toFetch = [];
    for ( const details of rulesetDetails.values() ) {
        if ( details.enabled !== true ) { continue; }
        if ( details.rules.regexes === 0 ) { continue; }
        toFetch.push(fetchJSON(`/rulesets/${details.id}.regexes`));
    }
    const regexRulesets = await Promise.all(toFetch);

    // Validate fetched regexes
    let regexRuleId = REGEXES_REALM_START;
    for ( const rules of regexRulesets ) {
        if ( Array.isArray(rules) === false ) { continue; }
        for ( const rule of rules ) {
            rule.id = regexRuleId++;
            const {
                regexFilter: regex,
                isUrlFilterCaseSensitive: isCaseSensitive
            } = rule.condition;
            allRules.push(rule);
            toCheck.push(
                validRegexSet.has(regex)
                    ? { isSupported: true }
                    : dnr.isRegexSupported({ regex, isCaseSensitive })
            );
        }
    }

    // Collate results
    const results = await Promise.all(toCheck);
    const newRules = [];
    for ( let i = 0; i < allRules.length; i++ ) {
        const rule = allRules[i];
        const result = results[i];
        if ( result instanceof Object && result.isSupported ) {
            newRules.push(rule);
        } else {
            console.info(`${result.reason}: ${rule.condition.regexFilter}`);
        }
    }
    console.info(
        `Rejected regex filters: ${allRules.length-newRules.length} out of ${allRules.length}`
    );

    // Add validated regex rules to dynamic ruleset without affecting rules
    // outside regex rule realm.
    const dynamicRuleMap = await getDynamicRules();
    const newRuleMap = new Map(newRules.map(rule => [ rule.id, rule ]));
    const addRules = [];
    const removeRuleIds = [];
    for ( const oldRule of dynamicRuleMap.values() ) {
        if ( oldRule.id < REGEXES_REALM_START ) { continue; }
        if ( oldRule.id >= REGEXES_REALM_END ) { continue; }
        const newRule = newRuleMap.get(oldRule.id);
        if ( newRule === undefined ) {
            removeRuleIds.push(oldRule.id);
            dynamicRuleMap.delete(oldRule.id);
        } else if ( JSON.stringify(oldRule) !== JSON.stringify(newRule) ) {
            removeRuleIds.push(oldRule.id);
            addRules.push(newRule);
            dynamicRuleMap.set(oldRule.id, newRule);
        }
    }
    for ( const newRule of newRuleMap.values() ) {
        if ( dynamicRuleMap.has(newRule.id) ) { continue; }
        addRules.push(newRule);
        dynamicRuleMap.set(newRule.id, newRule);
    }
    if ( addRules.length !== 0 || removeRuleIds.length !== 0 ) {
        return dnr.updateDynamicRules({ addRules, removeRuleIds });
    }
}

/******************************************************************************/

async function defaultRulesetsFromLanguage() {
    const out = [ 'default' ];

    const dropCountry = lang => {
        const pos = lang.indexOf('-');
        if ( pos === -1 ) { return lang; }
        return lang.slice(0, pos);
    };

    const langSet = new Set();

    await i18n.getAcceptLanguages().then(langs => {
        for ( const lang of langs.map(dropCountry) ) {
            langSet.add(lang);
        }
    });
    langSet.add(dropCountry(i18n.getUILanguage()));

    const reTargetLang = new RegExp(
        `\\b(${Array.from(langSet).join('|')})\\b`
    );

    const rulesetDetails = await getRulesetDetails();
    for ( const [ id, details ] of rulesetDetails ) {
        if ( typeof details.lang !== 'string' ) { continue; }
        if ( reTargetLang.test(details.lang) === false ) { continue; }
        out.push(id);
    }
    return out;
}

/******************************************************************************/

async function enableRulesets(ids) {
    const afterIds = new Set(ids);
    const beforeIds = new Set(await dnr.getEnabledRulesets());
    const enableRulesetIds = [];
    const disableRulesetIds = [];
    for ( const id of afterIds ) {
        if ( beforeIds.has(id) ) { continue; }
        enableRulesetIds.push(id);
    }
    for ( const id of beforeIds ) {
        if ( afterIds.has(id) ) { continue; }
        disableRulesetIds.push(id);
    }
    
    if ( enableRulesetIds.length !== 0 ) {
        console.info(`Enable rulesets: ${enableRulesetIds}`);
    }
    if ( disableRulesetIds.length !== 0 ) {
        console.info(`Disable ruleset: ${disableRulesetIds}`);
    }
    if ( enableRulesetIds.length !== 0 || disableRulesetIds.length !== 0 ) {
        return dnr.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds  });
    }
}

/******************************************************************************/

async function getEnabledRulesetsStats() {
    const [
        rulesetDetails,
        ids,
    ] = await Promise.all([
        getRulesetDetails(),
        dnr.getEnabledRulesets(),
    ]);
    const out = [];
    for ( const id of ids ) {
        const ruleset = rulesetDetails.get(id);
        if ( ruleset === undefined ) { continue; }
        out.push(ruleset);
    }
    return out;
}

/******************************************************************************/

export {
    REGEXES_REALM_START,
    REGEXES_REALM_END,
    TRUSTED_DIRECTIVE_BASE_RULE_ID,
    CURRENT_CONFIG_BASE_RULE_ID,
    getRulesetDetails,
    getDynamicRules,
    enableRulesets,
    defaultRulesetsFromLanguage,
    getEnabledRulesetsStats,
    updateRegexRules,
};

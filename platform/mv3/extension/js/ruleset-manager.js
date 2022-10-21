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

import { browser, dnr, i18n } from './ext.js';
import { fetchJSON } from './fetch.js';

/******************************************************************************/

const RULE_REALM_SIZE = 1000000;
const REGEXES_REALM_START = 1000000;
const REGEXES_REALM_END = REGEXES_REALM_START + RULE_REALM_SIZE;
const REMOVEPARAMS_REALM_START = REGEXES_REALM_END;
const REMOVEPARAMS_REALM_END = REMOVEPARAMS_REALM_START + RULE_REALM_SIZE;
const REDIRECT_REALM_START = REMOVEPARAMS_REALM_END;
const REDIRECT_REALM_END = REDIRECT_REALM_START + RULE_REALM_SIZE;
const TRUSTED_DIRECTIVE_BASE_RULE_ID = 8000000;
const BLOCKING_MODES_RULE_ID = TRUSTED_DIRECTIVE_BASE_RULE_ID + 1;
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
        console.info(`Dynamic rule count: ${map.size}`);
        console.info(`Available dynamic rule count: ${dnr.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES - map.size}`);
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
        getEnabledRulesetsDetails(),
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
    for ( const details of rulesetDetails ) {
        if ( details.rules.regex === 0 ) { continue; }
        toFetch.push(fetchJSON(`/rulesets/regex/${details.id}`));
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
            //console.info(`${result.reason}: ${rule.condition.regexFilter}`);
        }
    }
    console.info(
        `Rejected regex filters: ${allRules.length-newRules.length} out of ${allRules.length}`
    );

    // Add validated regex rules to dynamic ruleset without affecting rules
    // outside regex rules realm.
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

    if ( addRules.length === 0 && removeRuleIds.length === 0 ) { return; }

    if ( removeRuleIds.length !== 0 ) {
        console.info(`Remove ${removeRuleIds.length} DNR regex rules`);
    }
    if ( addRules.length !== 0 ) {
        console.info(`Add ${addRules.length} DNR regex rules`);
    }

    return dnr.updateDynamicRules({ addRules, removeRuleIds });
}

/******************************************************************************/

async function updateRemoveparamRules() {
    const [
        hasOmnipotence,
        rulesetDetails,
        dynamicRuleMap,
    ] = await Promise.all([
        browser.permissions.contains({ origins: [ '<all_urls>' ] }),
        getEnabledRulesetsDetails(),
        getDynamicRules(),
    ]);

    // Fetch removeparam rules for all enabled rulesets
    const toFetch = [];
    for ( const details of rulesetDetails ) {
        if ( details.rules.removeparam === 0 ) { continue; }
        toFetch.push(fetchJSON(`/rulesets/removeparam/${details.id}`));
    }
    const removeparamRulesets = await Promise.all(toFetch);

    // Removeparam rules can only be enforced with omnipotence
    const newRules = [];
    if ( hasOmnipotence ) {
        let removeparamRuleId = REMOVEPARAMS_REALM_START;
        for ( const rules of removeparamRulesets ) {
            if ( Array.isArray(rules) === false ) { continue; }
            for ( const rule of rules ) {
                rule.id = removeparamRuleId++;
                newRules.push(rule);
            }
        }
    }

    // Add removeparam rules to dynamic ruleset without affecting rules
    // outside removeparam rules realm.
    const newRuleMap = new Map(newRules.map(rule => [ rule.id, rule ]));
    const addRules = [];
    const removeRuleIds = [];

    for ( const oldRule of dynamicRuleMap.values() ) {
        if ( oldRule.id < REMOVEPARAMS_REALM_START ) { continue; }
        if ( oldRule.id >= REMOVEPARAMS_REALM_END ) { continue; }
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

    if ( addRules.length === 0 && removeRuleIds.length === 0 ) { return; }

    if ( removeRuleIds.length !== 0 ) {
        console.info(`Remove ${removeRuleIds.length} DNR removeparam rules`);
    }
    if ( addRules.length !== 0 ) {
        console.info(`Add ${addRules.length} DNR removeparam rules`);
    }

    return dnr.updateDynamicRules({ addRules, removeRuleIds });
}

/******************************************************************************/

async function updateRedirectRules() {
    const [
        hasOmnipotence,
        rulesetDetails,
        dynamicRuleMap,
    ] = await Promise.all([
        browser.permissions.contains({ origins: [ '<all_urls>' ] }),
        getEnabledRulesetsDetails(),
        getDynamicRules(),
    ]);

    // Fetch redirect rules for all enabled rulesets
    const toFetch = [];
    for ( const details of rulesetDetails ) {
        if ( details.rules.redirect === 0 ) { continue; }
        toFetch.push(fetchJSON(`/rulesets/redirect/${details.id}`));
    }
    const redirectRulesets = await Promise.all(toFetch);

    // Redirect rules can only be enforced with omnipotence
    const newRules = [];
    if ( hasOmnipotence ) {
        let redirectRuleId = REDIRECT_REALM_START;
        for ( const rules of redirectRulesets ) {
            if ( Array.isArray(rules) === false ) { continue; }
            for ( const rule of rules ) {
                rule.id = redirectRuleId++;
                newRules.push(rule);
            }
        }
    }

    // Add redirect rules to dynamic ruleset without affecting rules
    // outside redirect rules realm.
    const newRuleMap = new Map(newRules.map(rule => [ rule.id, rule ]));
    const addRules = [];
    const removeRuleIds = [];

    for ( const oldRule of dynamicRuleMap.values() ) {
        if ( oldRule.id < REDIRECT_REALM_START ) { continue; }
        if ( oldRule.id >= REDIRECT_REALM_END ) { continue; }
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

    if ( addRules.length === 0 && removeRuleIds.length === 0 ) { return; }

    if ( removeRuleIds.length !== 0 ) {
        console.info(`Remove ${removeRuleIds.length} DNR redirect rules`);
    }
    if ( addRules.length !== 0 ) {
        console.info(`Add ${addRules.length} DNR redirect rules`);
    }

    return dnr.updateDynamicRules({ addRules, removeRuleIds });
}

/******************************************************************************/

async function updateDynamicRules() {
    return Promise.all([
        updateRegexRules(),
        updateRemoveparamRules(),
        updateRedirectRules(),
    ]);
}

/******************************************************************************/

async function defaultRulesetsFromLanguage() {
    const out = [ 'default', 'cname-trackers' ];

    const dropCountry = lang => {
        const pos = lang.indexOf('-');
        if ( pos === -1 ) { return lang; }
        return lang.slice(0, pos);
    };

    const langSet = new Set();

    for ( const lang of navigator.languages.map(dropCountry) ) {
        langSet.add(lang);
    }
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
    const enableRulesetSet = new Set();
    const disableRulesetSet = new Set();
    for ( const id of afterIds ) {
        if ( beforeIds.has(id) ) { continue; }
        enableRulesetSet.add(id);
    }
    for ( const id of beforeIds ) {
        if ( afterIds.has(id) ) { continue; }
        disableRulesetSet.add(id);
    }

    if ( enableRulesetSet.size === 0 && disableRulesetSet.size === 0 ) {
        return;
    }

    // Be sure the rulesets to enable/disable do exist in the current version,
    // otherwise the API throws.
    const rulesetDetails = await getRulesetDetails();
    for ( const id of enableRulesetSet ) {
        if ( rulesetDetails.has(id) ) { continue; }
        enableRulesetSet.delete(id);
    }
    for ( const id of disableRulesetSet ) {
        if ( rulesetDetails.has(id) ) { continue; }
        disableRulesetSet.delete(id);
    }
    const enableRulesetIds = Array.from(enableRulesetSet);
    const disableRulesetIds = Array.from(disableRulesetSet);

    if ( enableRulesetIds.length !== 0 ) {
        console.info(`Enable rulesets: ${enableRulesetIds}`);
    }
    if ( disableRulesetIds.length !== 0 ) {
        console.info(`Disable ruleset: ${disableRulesetIds}`);
    }
    await dnr.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
    
    return updateDynamicRules();
}

/******************************************************************************/

async function getEnabledRulesetsDetails() {
    const [
        ids,
        rulesetDetails,
    ] = await Promise.all([
        dnr.getEnabledRulesets(),
        getRulesetDetails(),
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
    BLOCKING_MODES_RULE_ID,
    CURRENT_CONFIG_BASE_RULE_ID,
    TRUSTED_DIRECTIVE_BASE_RULE_ID,
    getRulesetDetails,
    getDynamicRules,
    enableRulesets,
    defaultRulesetsFromLanguage,
    getEnabledRulesetsDetails,
    updateDynamicRules,
};

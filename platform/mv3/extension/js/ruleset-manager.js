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

import {
    addImportedLists,
    getEnabledImportedLists,
    getImportedLists,
    updateEnabledImportedLists,
} from './imported-lists.js';

import {
    i18n,
    localRead, localRemove, localWrite,
    runtime,
    sessionRead, sessionRemove, sessionWrite,
    webextFlavor,
} from './ext.js';

import {
    rulesetConfig,
    saveRulesetConfig,
} from './config.js';
import { ubolErr, ubolLog } from './debug.js';

import { dnr } from './ext-compat.js';
import { fetchJSON } from './fetch.js';
import { getAdminRulesets } from './admin.js';
import { hasBroadHostPermissions } from './ext-utils.js';
import { rulesFromText } from './dnr-parser.js';

/******************************************************************************/

const SPECIAL_RULES_REALM = 5000000;
const USER_RULES_BASE_RULE_ID = 9000000;
const USER_RULES_PRIORITY = 1000000;
const TRUSTED_DIRECTIVE_BASE_RULE_ID = 8000000;
const TRUSTED_DIRECTIVE_PRIORITY = USER_RULES_PRIORITY + 1000000;
const STRICTBLOCK_PRIORITY = 29;

/******************************************************************************/

const isStrictBlockRule = rule => {
    if ( rule.priority !== STRICTBLOCK_PRIORITY ) { return false; }
    if ( rule.condition?.resourceTypes === undefined ) { return false; }
    if ( rule.condition.resourceTypes.length !== 1 ) { return false; }
    if ( rule.condition.resourceTypes[0] !== 'main_frame' ) { return false; }
    if ( rule.action.type === 'redirect' ) {
        const substitution = rule.action.redirect.regexSubstitution;
        return substitution !== undefined &&
            substitution.includes('/strictblock.');
    }
    if ( rule.action.type === 'allow' ) {
        return Array.isArray(rule.condition?.requestDomains);
    }
    return false;
};

/******************************************************************************/

export function getRulesetDetails() {
    if ( getRulesetDetails.rulesetDetailsPromise === undefined ) {
        getRulesetDetails.rulesetDetailsPromise = fetchJSON('/rulesets/ruleset-details');
    }
    return Promise.all([
        getRulesetDetails.rulesetDetailsPromise,
        getImportedLists(),
    ]).then(results => {
        const [ stock, imported ] = results;
        return new Map(stock.concat(imported).map(entry => [ entry.id, entry ]));
    });
}

/******************************************************************************/

async function pruneInvalidRegexRules(realm, rulesIn, rejected = []) {
    const validateRegex = regex => {
        return dnr.isRegexSupported({ regex, isCaseSensitive: false }).then(result => {
            pruneInvalidRegexRules.validated.set(regex, result?.reason || true);
            if ( result.isSupported ) { return true; }
            rejected.push({ regex, reason: result?.reason });
            return false;
        });
    };

    // Validate regex-based rules
    const toCheck = [];
    for ( const rule of rulesIn ) {
        if ( rule.condition?.regexFilter === undefined ) {
            toCheck.push(true);
            continue;
        }
        const { regexFilter } = rule.condition;
        const reason = pruneInvalidRegexRules.validated.get(regexFilter);
        if ( reason !== undefined ) {
            toCheck.push(reason === true);
            if ( reason === true  ) { continue; }
            rejected.push({ regex: regexFilter, reason });
            continue;
        }
        toCheck.push(validateRegex(regexFilter));
    }

    // Collate results
    const isValid = await Promise.all(toCheck);

    if ( rejected.length !== 0 ) {
        ubolLog(`${realm} realm: rejected regexes:\n`,
            rejected.map(e => `${e.regex} → ${e.reason}`).join('\n')
        );
    }

    return rulesIn.filter((v, i) => isValid[i]);
}
pruneInvalidRegexRules.validated = new Map();

/******************************************************************************/

async function getDynamicRegexRuleCount() {
    const rules = await dnr.getDynamicRules();
    const regexRules = rules.filter(a => Boolean(a.condition?.regexFilter));
    return regexRules.length;
}

/******************************************************************************/

async function updateRegexRules(currentRules, addRules, removeRuleIds) {
    // Remove existing regex-related block rules
    for ( const rule of currentRules ) {
        if ( rule.id === 0 ) { continue; }
        if ( rule.id >= SPECIAL_RULES_REALM ) { continue; }
        if ( rule.condition.regexFilter === undefined ) { continue; }
        removeRuleIds.push(rule.id);
    }

    const rulesetDetails = await getEnabledRulesetsDetails(true);

    // Fetch regexes for all enabled rulesets
    const toFetch = [];
    for ( const details of rulesetDetails ) {
        if ( details.rules.regex === 0 ) { continue; }
        toFetch.push(fetchJSON(`/rulesets/regex/${details.id}`));
    }
    const regexRulesets = await Promise.all(toFetch);

    // Collate all regexes rules
    const allRules = [];
    for ( const rules of regexRulesets ) {
        if ( Array.isArray(rules) === false ) { continue; }
        for ( const rule of rules ) {
            allRules.push(rule);
        }
    }
    if ( allRules.length === 0 ) { return; }

    const validRules = await pruneInvalidRegexRules('regexes', allRules);
    if ( validRules.length === 0 ) { return; }

    ubolLog(`Add ${validRules.length} DNR regex rules`);
    addRules.push(...validRules);
}

/******************************************************************************/

// https://github.com/uBlockOrigin/uBOL-home/issues/715

function toSafeDynamicRules(addRules) {
    if ( Array.isArray(addRules) === false ) { return; }
    if ( dnr.RuleConditionKeys?.TOP_DOMAINS ) { return addRules; }
    const safeRules = [];
    for ( const rule of addRules ) {
        const { condition } = rule;
        if ( condition.topDomains ) { continue; }
        if ( condition.excludedTopDomains ) {
            delete condition.excludedTopDomains;
        }
        safeRules.push(rule);
    }
    return safeRules;
}

/******************************************************************************/

export async function updateDynamicAndSessionRules() {
    const currentRules = await dnr.getDynamicRules();

    // Remove potentially left-over rules from previous version
    const removeRuleIds = [];
    for ( const rule of currentRules ) {
        if ( rule.id >= SPECIAL_RULES_REALM ) { continue; }
        removeRuleIds.push(rule.id);
        rule.id = 0;
    }

    const addRules = [];
    await updateRegexRules(currentRules, addRules, removeRuleIds);
    if ( addRules.length === 0 && removeRuleIds.length === 0 ) { return; }

    const dynamicRegexCountBefore = await getDynamicRegexRuleCount();
    let dynamicRegexCountAfter = 0;
    let ruleId = 1;
    for ( const rule of addRules ) {
        if ( rule?.condition.regexFilter ) { dynamicRegexCountAfter += 1; }
        rule.id = ruleId++;
    }
    if ( dynamicRegexCountAfter !== 0 ) {
        ubolLog(`Using ${dynamicRegexCountAfter}/${dnr.MAX_NUMBER_OF_REGEX_RULES} dynamic regex-based DNR rules`);
    }
    // If we increase the number of dynamic regex rules, reset session rules to
    // reduce risk of hitting maximum regex count
    if ( dynamicRegexCountAfter > dynamicRegexCountBefore ) {
        await clearSessionRules();
    }

    const response = {};

    try {
        await dnr.updateDynamicRules({
            addRules: toSafeDynamicRules(addRules),
            removeRuleIds,
        });
        if ( removeRuleIds.length !== 0 ) {
            ubolLog(`Remove ${removeRuleIds.length} dynamic DNR rules`);
        }
        if ( addRules.length !== 0 ) {
            ubolLog(`Add ${addRules.length} dynamic DNR rules`);
        }
    } catch(reason) {
        ubolErr(`updateDynamicAndSessionRules/${reason}`);
        response.error = `${reason}`;
    }

    const result = await updateSessionRules();
    if ( result?.error ) {
        response.error ||= result.error;
    }

    return response;
}

/******************************************************************************/

async function updateStrictBlockRules(currentRules, addRules, removeRuleIds) {
    // Remove existing strictblock-related rules
    for ( const rule of currentRules ) {
        if ( isStrictBlockRule(rule) === false ) { continue; }
        removeRuleIds.push(rule.id);
    }

    if ( rulesetConfig.strictBlockMode === false ) { return; }

    // https://github.com/uBlockOrigin/uBOL-home/issues/428#issuecomment-3172663563
    // https://bugs.webkit.org/show_bug.cgi?id=298199
    // https://developer.apple.com/forums/thread/756214
    if ( webextFlavor === 'safari' ) { return; }

    const [
        hasOmnipotence,
        rulesetDetails,
        permanentlyExcluded = [],
        temporarilyExcluded = [],
    ] = await Promise.all([
        hasBroadHostPermissions(),
        getEnabledRulesetsDetails(true),
        localRead('excludedStrictBlockHostnames'),
        sessionRead('excludedStrictBlockHostnames'),
    ]);

    // Strict-block rules can only be enforced with omnipotence
    if ( hasOmnipotence === false ) {
        localRemove('excludedStrictBlockHostnames');
        sessionRemove('excludedStrictBlockHostnames');
        return;
    }

    // Fetch strick-block rules
    const toFetch = [];
    for ( const details of rulesetDetails ) {
        if ( Boolean(details.rules.strictblock) === false ) { continue; }
        toFetch.push(fetchJSON(`/rulesets/strictblock/${details.id}`));
    }
    const rulesets = await Promise.all(toFetch);

    const substitution = `${runtime.getURL('/strictblock.html')}#\\0`;
    const allRules = [];
    for ( const rules of rulesets ) {
        if ( Array.isArray(rules) === false ) { continue; }
        for ( const rule of rules ) {
            rule.action.redirect.regexSubstitution = substitution;
            allRules.push(rule);
        }
    }

    const validRules = await pruneInvalidRegexRules('strictblock', allRules);
    if ( validRules.length === 0 ) { return; }
    ubolLog(`Add ${validRules.length} DNR strictblock rules`);
    for ( const rule of validRules ) {
        rule.priority = STRICTBLOCK_PRIORITY;
        addRules.push(rule);
    }

    const allExcluded = permanentlyExcluded.concat(temporarilyExcluded);
    if ( allExcluded.length === 0 ) { return; }
    addRules.unshift({
        action: { type: 'allow' },
        condition: {
            requestDomains: allExcluded,
            resourceTypes: [ 'main_frame' ],
        },
        priority: STRICTBLOCK_PRIORITY,
    });
    ubolLog(`Add 1 DNR session rule with ${allExcluded.length} for excluded strict-block domains`);
}

async function excludeFromStrictBlock(hostname, permanent) {
    if ( typeof hostname !== 'string' || hostname === '' ) { return; }
    const readFn = permanent ? localRead : sessionRead;
    const hostnames = new Set(await readFn('excludedStrictBlockHostnames'));
    hostnames.add(hostname);
    const writeFn = permanent ? localWrite : sessionWrite;
    await writeFn('excludedStrictBlockHostnames', Array.from(hostnames));
    return updateSessionRules();
}

async function setStrictBlockMode(state, force = false) {
    const newState = Boolean(state);
    if ( force === false ) {
        if ( newState === rulesetConfig.strictBlockMode ) { return; }
    }
    rulesetConfig.strictBlockMode = newState;
    const promises = [ saveRulesetConfig() ];
    if ( newState === false ) {
        promises.push(
            localRemove('excludedStrictBlockHostnames'),
            sessionRemove('excludedStrictBlockHostnames')
        );
    }
    await Promise.all(promises);
    return updateSessionRules();
}

/******************************************************************************/

async function updateSessionRules() {
    const addRulesUnfiltered = [];
    const removeRuleIds = [];
    const currentRules = await dnr.getSessionRules();
    await updateStrictBlockRules(currentRules, addRulesUnfiltered, removeRuleIds);
    if ( addRulesUnfiltered.length === 0 && removeRuleIds.length === 0 ) { return; }
    const maxRegexCount = dnr.MAX_NUMBER_OF_REGEX_RULES * 0.95;
    const dynamicRegexCount = await getDynamicRegexRuleCount();
    let regexCount = dynamicRegexCount;
    let ruleId = 1;
    for ( const rule of addRulesUnfiltered ) {
        rule.id = ruleId++;
        if ( Boolean(rule.condition.regexFilter) === false ) { continue; }
        regexCount += 1;
        if ( regexCount < maxRegexCount ) { continue; }
        rule.id = 0;
    }
    const sessionRegexCount = regexCount - dynamicRegexCount;
    const addRules = addRulesUnfiltered.filter(a => a.id !== 0);
    const rejectedRuleCount = addRulesUnfiltered.length - addRules.length;
    if ( rejectedRuleCount !== 0 ) {
        ubolLog(`Too many regex-based filters, ${rejectedRuleCount} session rules dropped`);
    }
    if ( sessionRegexCount !== 0 ) {
        ubolLog(`Using ${sessionRegexCount}/${dnr.MAX_NUMBER_OF_REGEX_RULES} session regex-based DNR rules`);
    }
    const response = {};
    try {
        await dnr.updateSessionRules({ addRules, removeRuleIds });
        if ( removeRuleIds.length !== 0 ) {
            ubolLog(`Remove ${removeRuleIds.length} session DNR rules`);
        }
        if ( addRules.length !== 0 ) {
            ubolLog(`Add ${addRules.length} session DNR rules`);
        }
    } catch(reason) {
        ubolErr(`updateSessionRules/${reason}`);
        response.error = `${reason}`;
    }
    return response;
}

async function clearSessionRules() {
    const currentRules = await dnr.getSessionRules();
    if ( currentRules.length === 0 ) { return; }
    const removeRuleIds = currentRules.map(a => a.id);
    return dnr.updateSessionRules({ removeRuleIds });
}

/******************************************************************************/

async function filteringModesToDNR(modes) {
    const noneHostnames = new Set([ ...modes.none ]);
    const notNoneHostnames = new Set([ ...modes.basic, ...modes.optimal, ...modes.complete ]);
    const requestDomains = [];
    const excludedRequestDomains = [];
    const allowEverywhere = noneHostnames.has('all-urls');
    if ( allowEverywhere ) {
        excludedRequestDomains.push(...notNoneHostnames);
    } else {
        requestDomains.push(...noneHostnames);
    }
    const noneCount = allowEverywhere
        ? notNoneHostnames.size
        : noneHostnames.size;
    return dnr.setAllowAllRules(
        TRUSTED_DIRECTIVE_BASE_RULE_ID,
        requestDomains.sort(),
        excludedRequestDomains.sort(),
        allowEverywhere,
        TRUSTED_DIRECTIVE_PRIORITY
    ).then(modified => {
        if ( modified === false ) { return; }
        ubolLog(`${allowEverywhere ? 'Enabled' : 'Disabled'} DNR filtering for ${noneCount} sites`);
    });
}

/******************************************************************************/

export async function getDefaultRulesetsFromEnv() {
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

    const reMobile = /\bMobile\b/.test(navigator.userAgent)
        ? /\bmobile\b/
        : null

    const rulesetDetails = await getRulesetDetails();
    const out = [];
    for ( const ruleset of rulesetDetails.values() ) {
        if ( ruleset.group === 'imported' ) { continue; }
        const { id, enabled } = ruleset;
        if ( enabled ) {
            out.push(id);
            continue;
        }
        if ( typeof ruleset.lang === 'string' ) {
            if ( reTargetLang.test(ruleset.lang) ) {
                out.push(id);
                continue;
            }
        }
        if ( typeof ruleset.tags === 'string' ) {
            if ( reMobile?.test(ruleset.tags) ) {
                out.push(id);
                continue;
            }
        }
    }
   
    return out;
}

/******************************************************************************/

export async function patchDefaultRulesets() {
    const [
        oldDefaultIds = [],
        newDefaultIds,
        staticRulesetIds,
    ] = await Promise.all([
        localRead('defaultRulesetIds'),
        getDefaultRulesetsFromEnv(),
        getStaticRulesets().then(a => a.map(a => a.id)),
    ]);
    const toAdd = [];
    const toRemove = [];
    // New default rulesets to add
    for ( const id of newDefaultIds ) {
        if ( oldDefaultIds.includes(id) ) { continue; }
        toAdd.push(id);
    }
    // Old default rulesets to remove
    for ( const id of oldDefaultIds ) {
        if ( newDefaultIds.includes(id) ) { continue; }
        toRemove.push(id);
    }
    // Non-default rulesets removed from stock lists
    const removedStockLists = new Map([
        [ 'dpollock-0', {
            name: 'Dan Pollock’s hosts file',
            url: 'https://someonewhocares.org/hosts/hosts',
            homeURL: 'https://someonewhocares.org/hosts/',
        }],
    ]);
    const reImported = /^[a-z]+:\/\//;
    const importedToAdd = [];
    for ( const id of rulesetConfig.enabledRulesets ) {
        if ( reImported.test(id) ) { continue; }
        if ( staticRulesetIds.includes(id) ) { continue; }
        if ( toRemove.includes(id) ) { continue; }
        if ( toAdd.includes(id) ) { continue; }
        toRemove.push(id);
        if ( removedStockLists.has(id) ) {
            importedToAdd.push(removedStockLists.get(id));
        }
    }
    if ( importedToAdd.length ) {
        await addImportedLists(importedToAdd);
        toAdd.push(...importedToAdd.map(a => a.url));
    }
    localWrite('defaultRulesetIds', newDefaultIds);
    if ( toAdd.length === 0 && toRemove.length === 0 ) { return; }
    const enabledRulesets = new Set(rulesetConfig.enabledRulesets);
    toAdd.forEach(id => enabledRulesets.add(id));
    toRemove.forEach(id => enabledRulesets.delete(id));
    const patchedRulesets = Array.from(enabledRulesets);
    ubolLog(`Patched rulesets: ${rulesetConfig.enabledRulesets} => ${patchedRulesets}`);
    rulesetConfig.enabledRulesets = patchedRulesets;
}

/******************************************************************************/

export async function getEnabledRulesets() {
    const [
        stockRulesets,
        importedLists,
    ] = await Promise.all([
        dnr.getEnabledRulesets(),
        getEnabledImportedLists(),
    ]);
    return stockRulesets.concat(importedLists.map(a => a.id));
}

/******************************************************************************/

export async function getRulesetRules(id) {
    const rulesetDetails = await getRulesetDetails();
    const ruleset = rulesetDetails.get(id);
    if ( ruleset === undefined ) { return; }
    if ( /^[a-z-]+:\/\//.test(id) ) {
        const serialized = await localRead(`rulesets.imported.compiled.${id}`);
        return { serialized };
    }
    if ( Boolean(ruleset.rules) === false ) { return; }
    const { total, regex } = ruleset.rules;
    const promises = [];
    if ( total !== regex ) {
        promises.push(fetchJSON(`/rulesets/main/${id}`));
    }
    if ( regex ) {
        promises.push(fetchJSON(`/rulesets/regex/${id}`));
    }
    const result = await Promise.all(promises);
    return { rules: result.flat() };
}

/******************************************************************************/

async function updateEnabledRulesets(toEnable, toDisable, out) {
    const reImported = /^[a-z-]+:\/\//;
    const enableRulesetIds = toEnable.filter(a => reImported.test(a) === false);
    const disableRulesetIds = toDisable.filter(a => reImported.test(a) === false);
    if ( enableRulesetIds.length === 0 ) {
        if ( disableRulesetIds.length === 0 ) { return false; }
    }
    return await dnr.updateEnabledRulesets({
        enableRulesetIds,
        disableRulesetIds,
    }).then(( ) => {
        return true;
    }).catch(reason => {
        ubolErr(`updateEnabledRulesets/${reason}`);
        out.error = `${reason}`;
        return false;
    });
}

/******************************************************************************/

async function enableRulesets(ids) {
    const afterIds = new Set(ids);
    const [
        beforeIds,
        adminIds,
        rulesetDetails,
    ] = await Promise.all([
        getEnabledRulesets().then(ids => new Set(ids)),
        getAdminRulesets(),
        getRulesetDetails(),
    ]);

    for ( const token of adminIds ) {
        const c0 = token.charAt(0);
        const id = token.slice(1);
        if ( c0 === '+' ) {
            afterIds.add(id);
        } else if ( c0 === '-' ) {
            afterIds.delete(id);
        }
    }

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

    const response = {};

    // Be sure the rulesets to enable/disable do exist in the current version,
    // otherwise the API throws.
    for ( const id of enableRulesetSet ) {
        if ( rulesetDetails.has(id) ) { continue; }
        enableRulesetSet.delete(id);
        if ( /^[a-z-]+:\/\//.test(id) ) {
            response.importedUpdated = true;
        } else {
            response.stockUpdated = true;
        }
    }
    for ( const id of disableRulesetSet ) {
        if ( rulesetDetails.has(id) ) { continue; }
        disableRulesetSet.delete(id);
    }

    if ( enableRulesetSet.size === 0 && disableRulesetSet.size === 0 ) {
        return response;
    }

    const enableRulesetIds = Array.from(enableRulesetSet);
    const disableRulesetIds = Array.from(disableRulesetSet);

    if ( enableRulesetIds.length !== 0 ) {
        ubolLog(`Enable rulesets: ${enableRulesetIds}`);
    }
    if ( disableRulesetIds.length !== 0 ) {
        ubolLog(`Disable ruleset: ${disableRulesetIds}`);
    }

    response.stockUpdated ||= await updateEnabledRulesets(
        enableRulesetIds,
        disableRulesetIds,
        response,
    );
    if ( response.stockUpdated ) {
        const result = await updateDynamicAndSessionRules();
        if ( result?.error ) {
            response.error ||= result.error;
        }
        response.changed = true;
    }

    response.importedUpdated ||= await updateEnabledImportedLists(
        enableRulesetIds,
        disableRulesetIds
    );
    if ( response.importedUpdated ) {
        response.changed = true;
    }

    await getEnabledRulesets().then(enabledRulesets => {
        ubolLog(`Enabled rulesets: ${enabledRulesets}`);
        response.enabledRulesets = enabledRulesets;
        return dnr.getAvailableStaticRuleCount();
    }).then(count => {
        ubolLog(`Available static rule count: ${count}`);
        response.staticRuleCount = count;
    }).catch(reason => {
        ubolErr(`getEnabledRulesets/${reason}`);
    });

    return response;
}

/******************************************************************************/

async function getStaticRulesets() {
    const manifest = runtime.getManifest();
    return manifest.declarative_net_request.rule_resources;
}

/******************************************************************************/

async function getEnabledRulesetsDetails(stockOnly = false) {
    const [
        rulesetIds,
        rulesetDetails,
    ] = await Promise.all([
        getEnabledRulesets(),
        getRulesetDetails(),
    ]);
    const reImported = /^[a-z-]+:\/\//;
    const out = [];
    for ( const id of rulesetIds ) {
        if ( stockOnly && reImported.test(id) ) { continue; }
        const ruleset = rulesetDetails.get(id);
        if ( ruleset === undefined ) { continue; }
        out.push(ruleset);
    }
    return out;
}

/******************************************************************************/

async function getEffectiveUserRules() {
    const allRules = await dnr.getDynamicRules();
    const userRules = [];
    for ( const rule of allRules ) {
        if ( rule.id < USER_RULES_BASE_RULE_ID ) { continue; }
        userRules.push(rule);
    }
    return userRules;
}

async function updateUserRules() {
    const [
        userRules,
        userRulesText = '',
        sandboxRules,
        importedRules,
    ] = await Promise.all([
        getEffectiveUserRules(),
        localRead('userDnrRules'),
        localRead('sandboxFilters.dnrRules'),
        localRead('importedFilters.dnrRules'),
    ]);

    const effectiveRulesText = rulesetConfig.developerMode
        ? userRulesText
        : '';

    const parsed = rulesFromText(effectiveRulesText);
    const { rules } = parsed;
    if ( Array.isArray(sandboxRules) ) {
        sandboxRules.forEach(a => rules.push(a));
    }
    // User rules have high priority
    rules.forEach(a => {
        a.priority = (a.priority || 1) + USER_RULES_PRIORITY;
    });
    if ( Array.isArray(importedRules) ) {
        importedRules.forEach(a => rules.push(a));
    }
    const removeRuleIds = [ ...userRules.map(a => a.id) ];
    const rejectedRegexes = [];
    const addRules = await pruneInvalidRegexRules('user', rules, rejectedRegexes);
    const out = { added: 0, removed: 0, errors: [] };

    if ( rejectedRegexes.length !== 0 ) {
        rejectedRegexes.forEach(e =>
            out.errors.push(`regexFilter: ${e.regex} → ${e.reason}`)
        );
    }

    if ( removeRuleIds.length === 0 && addRules.length === 0 ) {
        await localRemove('userDnrRuleCount');
        return out;
    }

    let ruleId = 0;
    for ( const rule of addRules ) {
        rule.id = USER_RULES_BASE_RULE_ID + ruleId++;
    }

    // Rules are first removed separately to ensure registered rules match
    // user rules text. A bad rule in user rules text would prevent the
    // rules from being removed if the removal was done at the same time as
    // adding rules.
    try {
        await dnr.updateDynamicRules({ removeRuleIds });
        await dnr.updateDynamicRules({ addRules: toSafeDynamicRules(addRules) });
        if ( removeRuleIds.length !== 0 ) {
            ubolLog(`updateUserRules() / Removed ${removeRuleIds.length} dynamic DNR rules`);
        }
        if ( addRules.length !== 0 ) {
            ubolLog(`updateUserRules() / Added ${addRules.length} DNR rules`);
        }
        out.added = addRules.length;
        out.removed = removeRuleIds.length;
    } catch(reason) {
        ubolErr(`updateUserRules/${reason}`);
        out.errors.push(`${reason}`);
    } finally {
        const userRules = await getEffectiveUserRules();
        if ( userRules.length === 0 ) {
            await localRemove('userDnrRuleCount');
        } else {
            await localWrite('userDnrRuleCount', addRules.length);
        }
    }
    return out;
}

/******************************************************************************/

export {
    enableRulesets,
    excludeFromStrictBlock,
    filteringModesToDNR,
    getEffectiveUserRules,
    getEnabledRulesetsDetails,
    setStrictBlockMode,
    updateSessionRules,
    updateUserRules,
};

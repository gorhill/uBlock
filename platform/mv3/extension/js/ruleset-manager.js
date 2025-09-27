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
import { hasBroadHostPermissions } from './utils.js';
import { rulesFromText } from './dnr-parser.js';

/******************************************************************************/

const SPECIAL_RULES_REALM = 5000000;
const USER_RULES_BASE_RULE_ID = 9000000;
const USER_RULES_PRIORITY = 1000000;
const TRUSTED_DIRECTIVE_BASE_RULE_ID = 8000000;
const TRUSTED_DIRECTIVE_PRIORITY = USER_RULES_PRIORITY + 1000000;
const STRICTBLOCK_PRIORITY = 29;

let dynamicRegexCount = 0;
let sessionRegexCount = 0;

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

function getRulesetDetails() {
    if ( getRulesetDetails.rulesetDetailsPromise !== undefined ) {
        return getRulesetDetails.rulesetDetailsPromise;
    }
    getRulesetDetails.rulesetDetailsPromise =
        fetchJSON('/rulesets/ruleset-details').then(entries => {
            const rulesMap = new Map(entries.map(entry => [ entry.id, entry ]));
            return rulesMap;
        });
    return getRulesetDetails.rulesetDetailsPromise;
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

async function updateRegexRules(currentRules, addRules, removeRuleIds) {
    // Remove existing regex-related block rules
    for ( const rule of currentRules ) {
        if ( rule.id === 0 ) { continue; }
        if ( rule.id >= SPECIAL_RULES_REALM ) { continue; }
        if ( rule.condition.regexFilter === undefined ) { continue; }
        removeRuleIds.push(rule.id);
    }

    const rulesetDetails = await getEnabledRulesetsDetails();

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

async function updateDynamicRules() {
    const currentRules = await dnr.getDynamicRules();
    const addRules = [];
    const removeRuleIds = [];

    // Remove potentially left-over rules from previous version
    for ( const rule of currentRules ) {
        if ( rule.id >= SPECIAL_RULES_REALM ) { continue; }
        removeRuleIds.push(rule.id);
        rule.id = 0;
    }

    await updateRegexRules(currentRules, addRules, removeRuleIds);
    if ( addRules.length === 0 && removeRuleIds.length === 0 ) { return; }

    dynamicRegexCount = 0;
    let ruleId = 1;
    for ( const rule of addRules ) {
        if ( rule?.condition.regexFilter ) { dynamicRegexCount += 1; }
        rule.id = ruleId++;
    }
    if ( dynamicRegexCount !== 0 ) {
        ubolLog(`Using ${dynamicRegexCount}/${dnr.MAX_NUMBER_OF_REGEX_RULES} dynamic regex-based DNR rules`);
    }

    const response = {};

    try {
        await dnr.updateDynamicRules({ addRules, removeRuleIds });
        if ( removeRuleIds.length !== 0 ) {
            ubolLog(`Remove ${removeRuleIds.length} dynamic DNR rules`);
        }
        if ( addRules.length !== 0 ) {
            ubolLog(`Add ${addRules.length} dynamic DNR rules`);
        }
    } catch(reason) {
        ubolErr(`updateDynamicRules/${reason}`);
        response.error = `${reason}`;
    }

    const result = await updateSessionRules();
    if ( result?.error ) {
        response.error ||= result.error;
    }

    return response;
}

/******************************************************************************/

async function getEffectiveDynamicRules() {
    const allRules = await dnr.getDynamicRules();
    const dynamicRules = [];
    for ( const rule of allRules ) {
        if ( rule.id >= USER_RULES_BASE_RULE_ID ) { continue; }
        dynamicRules.push(rule);
    }
    return dynamicRules;
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
        getEnabledRulesetsDetails(),
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
        if ( details.rules.strictblock === 0 ) { continue; }
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
    const maxRegexCount = dnr.MAX_NUMBER_OF_REGEX_RULES * 0.80;
    let regexCount = dynamicRegexCount;
    let ruleId = 1;
    for ( const rule of addRulesUnfiltered ) {
        if ( rule?.condition.regexFilter ) { regexCount += 1; }
        rule.id = regexCount < maxRegexCount ? ruleId++ : 0;
    }
    sessionRegexCount = regexCount - dynamicRegexCount;
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

/******************************************************************************/

async function getEffectiveSessionRules() {
    const allRules = await dnr.getSessionRules();
    const sessionRules = [];
    for ( const rule of allRules ) {
        if ( rule.id >= USER_RULES_BASE_RULE_ID ) { continue; }
        sessionRules.push(rule);
    }
    return sessionRules;
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

async function patchDefaultRulesets() {
    const [
        oldDefaultIds = [],
        newDefaultIds,
        staticRulesetIds,
    ] = await Promise.all([
        localRead('defaultRulesetIds'),
        getDefaultRulesetsFromEnv(),
        getStaticRulesets().then(r => r.map(a => a.id)),
    ]);
    const toAdd = [];
    const toRemove = [];
    for ( const id of newDefaultIds ) {
        if ( oldDefaultIds.includes(id) ) { continue; }
        toAdd.push(id);
    }
    for ( const id of oldDefaultIds ) {
        if ( newDefaultIds.includes(id) ) { continue; }
        toRemove.push(id);
    }
    for ( const id of rulesetConfig.enabledRulesets ) {
        if ( staticRulesetIds.includes(id) ) { continue; }
        toRemove.push(id);
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

async function enableRulesets(ids) {
    const afterIds = new Set(ids);
    const [
        beforeIds,
        adminIds,
        rulesetDetails,
    ] = await Promise.all([
        dnr.getEnabledRulesets().then(ids => new Set(ids)),
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

    // Be sure the rulesets to enable/disable do exist in the current version,
    // otherwise the API throws.
    for ( const id of enableRulesetSet ) {
        if ( rulesetDetails.has(id) ) { continue; }
        enableRulesetSet.delete(id);
    }
    for ( const id of disableRulesetSet ) {
        if ( rulesetDetails.has(id) ) { continue; }
        disableRulesetSet.delete(id);
    }

    if ( enableRulesetSet.size === 0 && disableRulesetSet.size === 0 ) { return; }

    const enableRulesetIds = Array.from(enableRulesetSet);
    const disableRulesetIds = Array.from(disableRulesetSet);

    if ( enableRulesetIds.length !== 0 ) {
        ubolLog(`Enable rulesets: ${enableRulesetIds}`);
    }
    if ( disableRulesetIds.length !== 0 ) {
        ubolLog(`Disable ruleset: ${disableRulesetIds}`);
    }

    const response = {};

    await dnr.updateEnabledRulesets({
        enableRulesetIds,
        disableRulesetIds,
    }).catch(reason => {
        ubolErr(`updateEnabledRulesets/${reason}`);
        response.error = `${reason}`;
    });

    const result = await updateDynamicRules();
    if ( result?.error ) {
        response.error ||= result.error;
    }

    await dnr.getEnabledRulesets().then(enabledRulesets => {
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
    ] = await Promise.all([
        getEffectiveUserRules(),
        localRead('userDnrRules'),
    ]);

    const effectiveRulesText = rulesetConfig.developerMode
        ? userRulesText
        : '';

    const parsed = rulesFromText(effectiveRulesText);
    const { rules } = parsed;
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
        rule.priority = (rule.priority || 1) + USER_RULES_PRIORITY;
    }

    // Rules are first removed separately to ensure registered rules match
    // user rules text. A bad rule in user rules text would prevent the
    // rules from being removed if the removal was done at the same time as
    // adding rules.
    try {
        await dnr.updateDynamicRules({ removeRuleIds });
        await dnr.updateDynamicRules({ addRules });
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
    getEffectiveDynamicRules,
    getEffectiveSessionRules,
    getEffectiveUserRules,
    getEnabledRulesetsDetails,
    getRulesetDetails,
    patchDefaultRulesets,
    setStrictBlockMode,
    updateDynamicRules,
    updateSessionRules,
    updateUserRules,
};

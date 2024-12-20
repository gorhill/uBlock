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
    TAB_ID_NONE,
    browser,
    dnr,
    i18n,
    localRead, localRemove, localWrite,
    runtime,
    sessionRead, sessionRemove, sessionWrite,
} from './ext.js';

import {
    rulesetConfig,
    saveRulesetConfig,
} from './config.js';


import { fetchJSON } from './fetch.js';
import { getAdminRulesets } from './admin.js';
import { ubolLog } from './debug.js';

/******************************************************************************/

const STRICTBLOCK_BASE_RULE_ID = 7000000;
const TRUSTED_DIRECTIVE_BASE_RULE_ID = 8000000;

let dynamicRuleId = 1;

/******************************************************************************/

function getRulesetDetails() {
    if ( getRulesetDetails.rulesetDetailsPromise !== undefined ) {
        return getRulesetDetails.rulesetDetailsPromise;
    }
    getRulesetDetails.rulesetDetailsPromise = fetchJSON('/rulesets/ruleset-details').then(entries => {
        const rulesMap = new Map(
            entries.map(entry => [ entry.id, entry ])
        );
        return rulesMap;
    });
    return getRulesetDetails.rulesetDetailsPromise;
}

/******************************************************************************/

async function pruneInvalidRegexRules(realm, rulesIn) {
    const rejectedRegexRules = [];

    const validateRegex = regex => {
        return dnr.isRegexSupported({ regex, isCaseSensitive: false }).then(result => {
            const isSupported = result?.isSupported || false;
            pruneInvalidRegexRules.validated.set(regex, isSupported);
            if ( isSupported ) { return true; }
            rejectedRegexRules.push(`\t${regex}  ${result?.reason}`);
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
        if ( pruneInvalidRegexRules.validated.has(regexFilter) ) {
            toCheck.push(pruneInvalidRegexRules.validated.get(regexFilter));
            continue;
        }
        toCheck.push(validateRegex(regexFilter));
    }

    // Collate results
    const isValid = await Promise.all(toCheck);

    if ( rejectedRegexRules.length !== 0 ) {
        ubolLog(`${realm} realm: rejected regexes:\n`,
            rejectedRegexRules.join('\n')
        );
    }

    return rulesIn.filter((v, i) => isValid[i]);
}
pruneInvalidRegexRules.validated = new Map();

/******************************************************************************/

async function updateRegexRules(toAdd) {
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
            rule.id = dynamicRuleId++;
            allRules.push(rule);
        }
    }
    if ( allRules.length === 0 ) { return; }

    const validRules = await pruneInvalidRegexRules('regexes', allRules);
    if ( validRules.length === 0 ) { return; }

    ubolLog(`Add ${validRules.length} DNR regex rules`);
    toAdd.push(...validRules);
}

/******************************************************************************/

async function updateRemoveparamRules(toAdd) {
    const [
        hasOmnipotence,
        rulesetDetails,
    ] = await Promise.all([
        browser.permissions.contains({ origins: [ '<all_urls>' ] }),
        getEnabledRulesetsDetails(),
    ]);

    // Fetch removeparam rules for all enabled rulesets
    const toFetch = [];
    for ( const details of rulesetDetails ) {
        if ( details.rules.removeparam === 0 ) { continue; }
        toFetch.push(fetchJSON(`/rulesets/removeparam/${details.id}`));
    }
    const removeparamRulesets = await Promise.all(toFetch);

    // Removeparam rules can only be enforced with omnipotence
    const allRules = [];
    if ( hasOmnipotence ) {
        for ( const rules of removeparamRulesets ) {
            if ( Array.isArray(rules) === false ) { continue; }
            for ( const rule of rules ) {
                rule.id = dynamicRuleId++;
                allRules.push(rule);
            }
        }
    }
    if ( allRules.length === 0 ) { return; }

    const validRules = await pruneInvalidRegexRules('removeparam', allRules);
    if ( validRules.length === 0 ) { return; }

    ubolLog(`Add ${validRules.length} DNR removeparam rules`);
    toAdd.push(...validRules);
}

/******************************************************************************/

async function updateRedirectRules(toAdd) {
    const [
        hasOmnipotence,
        rulesetDetails,
    ] = await Promise.all([
        browser.permissions.contains({ origins: [ '<all_urls>' ] }),
        getEnabledRulesetsDetails(),
    ]);

    // Fetch redirect rules for all enabled rulesets
    const toFetch = [];
    for ( const details of rulesetDetails ) {
        if ( details.rules.redirect === 0 ) { continue; }
        toFetch.push(fetchJSON(`/rulesets/redirect/${details.id}`));
    }
    const redirectRulesets = await Promise.all(toFetch);

    // Redirect rules can only be enforced with omnipotence
    const allRules = [];
    if ( hasOmnipotence ) {
        for ( const rules of redirectRulesets ) {
            if ( Array.isArray(rules) === false ) { continue; }
            for ( const rule of rules ) {
                rule.id = dynamicRuleId++;
                allRules.push(rule);
            }
        }
    }
    if ( allRules.length === 0 ) { return; }

    const validRules = await pruneInvalidRegexRules('redirect', allRules);
    if ( validRules.length === 0 ) { return; }

    ubolLog(`Add ${validRules.length} DNR redirect rules`);
    toAdd.push(...validRules);
}

/******************************************************************************/

async function updateModifyHeadersRules(toAdd) {
    const [
        hasOmnipotence,
        rulesetDetails,
    ] = await Promise.all([
        browser.permissions.contains({ origins: [ '<all_urls>' ] }),
        getEnabledRulesetsDetails(),
    ]);

    // Fetch modifyHeaders rules for all enabled rulesets
    const toFetch = [];
    for ( const details of rulesetDetails ) {
        if ( details.rules.modifyHeaders === 0 ) { continue; }
        toFetch.push(fetchJSON(`/rulesets/modify-headers/${details.id}`));
    }
    const rulesets = await Promise.all(toFetch);

    // Redirect rules can only be enforced with omnipotence
    const allRules = [];
    if ( hasOmnipotence ) {
        for ( const rules of rulesets ) {
            if ( Array.isArray(rules) === false ) { continue; }
            for ( const rule of rules ) {
                rule.id = dynamicRuleId++;
                allRules.push(rule);
            }
        }
    }
    if ( allRules.length === 0 ) { return; }

    const validRules = await pruneInvalidRegexRules('modify-headers', allRules);
    if ( validRules.length === 0 ) { return; }

    ubolLog(`Add ${validRules.length} DNR modify-headers rules`);
    toAdd.push(...validRules);
}

/******************************************************************************/

async function updateStrictBlockRules(dynamicRules, sessionRules) {
    if ( rulesetConfig.strictBlockMode === false ) { return; }

    const [
        hasOmnipotence,
        rulesetDetails,
        permanentlyExcluded = [],
        temporarilyExcluded = [],
    ] = await Promise.all([
        browser.permissions.contains({ origins: [ '<all_urls>' ] }),
        getEnabledRulesetsDetails(),
        localRead('excludedStrictBlockHostnames'),
        sessionRead('excludedStrictBlockHostnames'),
    ]);

    // Fetch strick-block hostnames
    const toFetch = [];
    for ( const details of rulesetDetails ) {
        if ( details.rules.strictblock === 0 ) { continue; }
        toFetch.push(fetchJSON(`/rulesets/strictblock/${details.id}`));
    }
    const strictblockRulesets = await Promise.all(toFetch);

    // Strict-block rules can only be enforced with omnipotence
    let toStrictBlock = new Set();
    if ( hasOmnipotence ) {
        for ( const hostnames of strictblockRulesets ) {
            if ( Array.isArray(hostnames) === false ) { continue; }
            toStrictBlock = toStrictBlock.union(new Set(hostnames));
        }
    } else {
        if ( permanentlyExcluded.length !== 0 ) {
            localRemove('excludedStrictBlockHostnames');
            permanentlyExcluded.length = 0;
        }
        if ( temporarilyExcluded.length !== 0 ) {
            sessionRemove('excludedStrictBlockHostnames');
            temporarilyExcluded.length = 0;
        }
    }
    for ( const hn of permanentlyExcluded ) {
        toStrictBlock.delete(hn);
    }
    if ( toStrictBlock.size === 0 ) { return; }
    const manifest = runtime.getManifest();
    let strictblockPath = '';
    for ( const war of manifest.web_accessible_resources ) {
        if ( war.resources.length !== 1 ) { continue; }
        if ( war.resources[0].startsWith('/strictblock.') === false ) { continue; }
        strictblockPath = runtime.getURL(war.resources[0]);
        break;
    }
    if ( strictblockPath === '' ) { return; }
    const dynamicRule = {
        id: STRICTBLOCK_BASE_RULE_ID,
        action: {
            type: 'redirect',
            redirect: {
                regexSubstitution: `${strictblockPath}#\\0`,
            },
        },
        condition: {
            regexFilter: '^https?://.+',
            requestDomains: Array.from(toStrictBlock),
            resourceTypes: [ 'main_frame' ],
        },
        priority: 29,
    };
    if ( permanentlyExcluded.length !== 0 ) {
        dynamicRule.condition.excludedRequestDomains = permanentlyExcluded;
    }
    dynamicRules.push(dynamicRule);
    ubolLog(`Add 1 DNR dynamic rule with ${toStrictBlock.size} strictblock domains`);

    if ( temporarilyExcluded.length === 0 ) { return; }
    sessionRules.push({
        id: STRICTBLOCK_BASE_RULE_ID,
        action: {
            type: 'allow',
        },
        condition: {
            requestDomains: temporarilyExcluded,
            resourceTypes: [ 'main_frame' ],
        },
        priority: 29,
    });
    ubolLog(`Add 1 DNR session rule with ${temporarilyExcluded.length} excluded strictblock domains`);
}

async function commitStrictBlockRules() {
    const [
        beforePermanentRules,
        beforeTemporaryRules,
    ] = await Promise.all([
        dnr.getDynamicRules({ ruleIds: [ STRICTBLOCK_BASE_RULE_ID ] }),
        dnr.getSessionRules({ ruleIds: [ STRICTBLOCK_BASE_RULE_ID ] }),
    ]);
    if ( beforePermanentRules?.length ) {
        ubolLog(`Remove 1 DNR dynamic strictblock rule`);
    }
    if ( beforeTemporaryRules?.length ) {
        ubolLog(`Remove 1 DNR session strictblock rule`);
    }
    const afterPermanentRules = [];
    const afterTemporaryRules = [];
    await updateStrictBlockRules(afterPermanentRules, afterTemporaryRules)
    return Promise.all([
        dnr.updateDynamicRules({
            addRules: afterPermanentRules,
            removeRuleIds: beforePermanentRules.map(rule => rule.id),
        }),
        dnr.updateSessionRules({
            addRules: afterTemporaryRules,
            removeRuleIds: beforeTemporaryRules.map(rule => rule.id),
        }),
    ]);
}

async function excludeFromStrictBlock(hostname, permanent) {
    if ( typeof hostname !== 'string' || hostname === '' ) { return; }
    const readFn = permanent ? localRead : sessionRead;
    const hostnames = new Set(await readFn('excludedStrictBlockHostnames'));
    hostnames.add(hostname);
    const writeFn = permanent ? localWrite : sessionWrite;
    await writeFn('excludedStrictBlockHostnames', Array.from(hostnames));
    return commitStrictBlockRules();
}

async function setStrictBlockMode(state) {
    const newState = Boolean(state);
    if ( newState === rulesetConfig.strictBlockMode ) { return; }
    rulesetConfig.strictBlockMode = newState;
    const promises = [ saveRulesetConfig() ];
    if ( newState === false ) {
        promises.push(
            localRemove('excludedStrictBlockHostnames'),
            sessionRemove('excludedStrictBlockHostnames')
        );
    }
    await Promise.all(promises);
    return commitStrictBlockRules();
}

/******************************************************************************/

async function updateDynamicRules() {
    dynamicRuleId = 1;
    const dynamicRules = [];
    const sessionRules = [];
    const [
        dynamicRuleIds,
        sessionRuleIds,
    ] = await Promise.all([
        dnr.getDynamicRules().then(rules =>
            rules.map(rule => rule.id)
                .filter(id => id < TRUSTED_DIRECTIVE_BASE_RULE_ID)
        ),
        dnr.getSessionRules().then(rules => rules.map(rule => rule.id)),
        updateRegexRules(dynamicRules),
        updateRemoveparamRules(dynamicRules),
        updateRedirectRules(dynamicRules),
        updateModifyHeadersRules(dynamicRules),
        updateStrictBlockRules(dynamicRules, sessionRules),
    ]);
    if ( dynamicRules.length === 0 && dynamicRuleIds.length === 0 ) { return; }
    const promises = [];
    if ( dynamicRules.length !== 0 || dynamicRuleIds.length !== 0 ) {
        promises.push(
            dnr.updateDynamicRules({
                addRules: dynamicRules,
                removeRuleIds: dynamicRuleIds,
            }).then(( ) => {
                if ( dynamicRuleIds.length !== 0 ) {
                    ubolLog(`Remove ${dynamicRuleIds.length} dynamic DNR rules`);
                }
                if ( dynamicRules.length !== 0 ) {
                    ubolLog(`Add ${dynamicRules.length} dynamic DNR rules`);
                }
            }).catch(reason => {
                console.error(`updateDynamicRules() / ${reason}`);
            })
        );
    }
    if ( sessionRules.length !== 0 || sessionRuleIds.length !== 0 ) {
        promises.push(
            dnr.updateSessionRules({
                addRules: sessionRules,
                removeRuleIds: sessionRuleIds,
            }).then(( ) => {
                if ( sessionRuleIds.length !== 0 ) {
                    ubolLog(`Remove ${sessionRuleIds.length} session DNR rules`);
                }
                if ( sessionRules.length !== 0 ) {
                    ubolLog(`Add ${sessionRules.length} session DNR rules`);
                }
            }).catch(reason => {
                console.error(`updateSessionRules() / ${reason}`);
            })
        );
    }
    return Promise.all(promises);
}

/******************************************************************************/

async function filteringModesToDNR(modes) {
    const [
        dynamicRules,
        sessionRules,
    ] = await Promise.all([
        dnr.getDynamicRules({ ruleIds: [ TRUSTED_DIRECTIVE_BASE_RULE_ID+0 ] }),
        dnr.getSessionRules({ ruleIds: [ TRUSTED_DIRECTIVE_BASE_RULE_ID+1 ] }),
    ]);
    const dynamicRule = dynamicRules?.length && dynamicRules[0] || undefined;
    const beforeRequestDomainSet = new Set(dynamicRule?.condition.requestDomains);
    const beforeExcludedRrequestDomainSet = new Set(dynamicRule?.condition.excludedRequestDomains);
    if ( dynamicRule !== undefined && beforeRequestDomainSet.size === 0 ) {
        beforeRequestDomainSet.add('all-urls');
    } else {
        beforeExcludedRrequestDomainSet.add('all-urls');
    }

    const noneHostnames = new Set([ ...modes.none ]);
    const notNoneHostnames = new Set([ ...modes.basic, ...modes.optimal, ...modes.complete ]);
    let afterRequestDomainSet = new Set();
    let afterExcludedRequestDomainSet = new Set();
    if ( noneHostnames.has('all-urls') ) {
        afterRequestDomainSet = new Set([ 'all-urls' ]);
        afterExcludedRequestDomainSet = notNoneHostnames;
    } else {
        afterRequestDomainSet = noneHostnames;
        afterExcludedRequestDomainSet = new Set();
    }

    const removeDynamicRuleIds = [];
    const removeSessionRuleIds = [];
    if ( dynamicRule ) {
        removeDynamicRuleIds.push(TRUSTED_DIRECTIVE_BASE_RULE_ID+0);
        removeSessionRuleIds.push(TRUSTED_DIRECTIVE_BASE_RULE_ID+1);
    }

    const allowEverywhere = afterRequestDomainSet.delete('all-urls');
    const addDynamicRules = [];
    const addSessionRules = [];
    if (
        allowEverywhere ||
        afterRequestDomainSet.size !== 0 ||
        afterExcludedRequestDomainSet.size !== 0
    ) {
        const rule0 = {
            id: TRUSTED_DIRECTIVE_BASE_RULE_ID+0,
            action: { type: 'allowAllRequests' },
            condition: {
                resourceTypes: [ 'main_frame' ],
            },
            priority: 100,
        };
        if ( afterRequestDomainSet.size !== 0 ) {
            rule0.condition.requestDomains =
                Array.from(afterRequestDomainSet).sort();
        } else if ( afterExcludedRequestDomainSet.size !== 0 ) {
            rule0.condition.excludedRequestDomains =
                Array.from(afterExcludedRequestDomainSet).sort();
        }
        addDynamicRules.push(rule0);
        // https://github.com/uBlockOrigin/uBOL-home/issues/114
        // https://github.com/uBlockOrigin/uBOL-home/issues/247
        const rule1 = {
            id: TRUSTED_DIRECTIVE_BASE_RULE_ID+1,
            action: { type: 'allow' },
            condition: {
                tabIds: [ TAB_ID_NONE ],
            },
            priority: 100,
        };
        if ( rule0.condition.requestDomains ) {
            rule1.condition.initiatorDomains =
                rule0.condition.requestDomains.slice();
        } else if ( rule0.condition.excludedRequestDomains ) {
            rule1.condition.excludedInitiatorDomains =
                rule0.condition.excludedRequestDomains.slice();
        }
        addSessionRules.push(rule1);
    }

    const noneCount = noneHostnames.has('all-urls')
        ? -notNoneHostnames.size
        : noneHostnames.size;

    const promises = [];
    if ( isDifferentAllowRules(addDynamicRules, dynamicRules) ) {
        promises.push(dnr.updateDynamicRules({
            addRules: addDynamicRules,
            removeRuleIds: removeDynamicRuleIds,
        }));
        ubolLog(`Add "allowAllRequests" dynamic rule for ${noneCount} sites`);
    }
    if ( isDifferentAllowRules(addSessionRules, sessionRules) ) {
        promises.push(dnr.updateSessionRules({
            addRules: addSessionRules,
            removeRuleIds: removeSessionRuleIds,
        }));
        ubolLog(`Add "allow" session rule for ${noneCount} sites`);
    }
    if ( promises.length === 0 ) { return; }
    return Promise.all(promises);
}

const isDifferentAllowRules = (a, b) => {
    const pp = [
        'requestDomains',
        'excludedRequestDomains',
        'initiatorDomains',
        'excludedInitiatorDomains',
    ];
    for ( const p of pp ) {
        const ac = a?.length && a[0].condition[p] || [];
        const bc = b?.length && b[0].condition[p] || [];
        if ( ac.join() !== bc.join() ) { return true; }
    }
    return false;
};

/******************************************************************************/

async function defaultRulesetsFromLanguage() {
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

    const manifest = runtime.getManifest();
    const rulesets = manifest.declarative_net_request.rule_resources;
    const rulesetDetails = await getRulesetDetails();
    const out = [];
    for ( const ruleset of rulesets ) {
        const { id, enabled } = ruleset;
        if ( enabled ) {
            out.push(id);
            continue;
        }
        const details = rulesetDetails.get(id);
        if ( typeof details.lang !== 'string' ) { continue; }
        if ( reTargetLang.test(details.lang) === false ) { continue; }
        out.push(id);
    }
    return out;
}

/******************************************************************************/

async function patchDefaultRulesets() {
    const [
        oldDefaultIds = [],
        newDefaultIds,
    ] = await Promise.all([
        localRead('defaultRulesetIds'),
        defaultRulesetsFromLanguage(),
    ]);

    const manifest = runtime.getManifest();
    const validIds = new Set(
        manifest.declarative_net_request.rule_resources.map(r => r.id)
    );
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
        if ( validIds.has(id) ) { continue; }
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
    const [ beforeIds, adminIds, rulesetDetails ] = await Promise.all([
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

    if ( enableRulesetSet.size === 0 && disableRulesetSet.size === 0 ) {
        return false;
    }

    const enableRulesetIds = Array.from(enableRulesetSet);
    const disableRulesetIds = Array.from(disableRulesetSet);

    if ( enableRulesetIds.length !== 0 ) {
        ubolLog(`Enable rulesets: ${enableRulesetIds}`);
    }
    if ( disableRulesetIds.length !== 0 ) {
        ubolLog(`Disable ruleset: ${disableRulesetIds}`);
    }
    await dnr.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });

    await updateDynamicRules();

    return true;
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
    defaultRulesetsFromLanguage,
    enableRulesets,
    excludeFromStrictBlock,
    filteringModesToDNR,
    getRulesetDetails,
    getEnabledRulesetsDetails,
    patchDefaultRulesets,
    setStrictBlockMode,
    updateDynamicRules,
};

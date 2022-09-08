'use strict';

import rulesetDetails from '/rulesets/ruleset-details.js';

/******************************************************************************/

const dnr = chrome.declarativeNetRequest;
const TRUSTED_DIRECTIVE_BASE_RULE_ID = 1000000;
const dynamicRuleMap = new Map();

/******************************************************************************/

async function updateRegexRules() {
    const allRules = [];
    const toCheck = [];
    for ( const details of rulesetDetails ) {
        if ( details.enabled !== true ) { continue; }
        for ( const rule of details.rules.regexes ) {
            const regex = rule.condition.regexFilter;
            const isCaseSensitive = rule.condition.isUrlFilterCaseSensitive === true;
            allRules.push(rule);
            toCheck.push(dnr.isRegexSupported({ regex, isCaseSensitive }));
        }
    }
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
    const newRuleMap = new Map(newRules.map(rule => [ rule.id, rule ]));
    const addRules = [];
    const removeRuleIds = [];
    for ( const oldRule of dynamicRuleMap.values() ) {
        if ( oldRule.id >= TRUSTED_DIRECTIVE_BASE_RULE_ID ) { continue; }
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

async function matchesTrustedSiteDirective(details) {
    const url = new URL(details.origin);
    let rule = dynamicRuleMap.get(TRUSTED_DIRECTIVE_BASE_RULE_ID);
    if ( rule === undefined ) { return false; }
    const domainSet = new Set(rule.condition.requestDomains);
    let hostname = url.hostname;
    for (;;) {
        if ( domainSet.has(hostname) ) { return true; }
        const pos = hostname.indexOf('.');
        if ( pos === -1 ) { break; }
        hostname = hostname.slice(pos+1);
    }
    return false;
}

async function addTrustedSiteDirective(details) {
    const url = new URL(details.origin);
    let rule = dynamicRuleMap.get(TRUSTED_DIRECTIVE_BASE_RULE_ID);
    if ( rule !== undefined ) {
        rule.condition.initiatorDomains = undefined;
        if ( Array.isArray(rule.condition.requestDomains) === false ) {
            rule.condition.requestDomains = [];
        }
    }
    if ( rule === undefined ) {
        rule = {
            id: TRUSTED_DIRECTIVE_BASE_RULE_ID,
            action: {
                type: 'allowAllRequests',
            },
            condition: {
                requestDomains: [ url.hostname ],
                resourceTypes: [ 'main_frame' ],
            },
            priority: TRUSTED_DIRECTIVE_BASE_RULE_ID,
        };
        dynamicRuleMap.set(TRUSTED_DIRECTIVE_BASE_RULE_ID, rule);
    } else if ( rule.condition.requestDomains.includes(url.hostname) === false ) {
        rule.condition.requestDomains.push(url.hostname);
    }
    await dnr.updateDynamicRules({
        addRules: [ rule ],
        removeRuleIds: [ TRUSTED_DIRECTIVE_BASE_RULE_ID ],
    });
    return true;
}

async function removeTrustedSiteDirective(details) {
    const url = new URL(details.origin);
    let rule = dynamicRuleMap.get(TRUSTED_DIRECTIVE_BASE_RULE_ID);
    if ( rule === undefined ) { return false; }
    rule.condition.initiatorDomains = undefined;
    if ( Array.isArray(rule.condition.requestDomains) === false ) {
        rule.condition.requestDomains = [];
    }
    const domainSet = new Set(rule.condition.requestDomains);
    const beforeCount = domainSet.size;
    let hostname = url.hostname;
    for (;;) {
        domainSet.delete(hostname);
        const pos = hostname.indexOf('.');
        if ( pos === -1 ) { break; }
        hostname = hostname.slice(pos+1);
    }
    if ( domainSet.size === beforeCount ) { return false; }
    if ( domainSet.size === 0 ) {
        dynamicRuleMap.delete(TRUSTED_DIRECTIVE_BASE_RULE_ID);
        await dnr.updateDynamicRules({
            removeRuleIds: [ TRUSTED_DIRECTIVE_BASE_RULE_ID ]
        });
        return false;
    }
    rule.condition.requestDomains = Array.from(domainSet);
    await dnr.updateDynamicRules({
        addRules: [ rule ],
        removeRuleIds: [ TRUSTED_DIRECTIVE_BASE_RULE_ID ],
    });
    return false;
}

async function toggleTrustedSiteDirective(details) {
    return details.state
        ? removeTrustedSiteDirective(details)
        : addTrustedSiteDirective(details);
}

/******************************************************************************/

(async ( ) => {
    const dynamicRules = await dnr.getDynamicRules();
    for ( const rule of dynamicRules ) {
        dynamicRuleMap.set(rule.id, rule);
    }

    await updateRegexRules();

    console.log(`Dynamic rule count: ${dynamicRuleMap.size}`);

    const enabledRulesets = await dnr.getEnabledRulesets();
    console.log(`Enabled rulesets: ${enabledRulesets}`);

    console.log(`Available dynamic rule count: ${dnr.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES - dynamicRuleMap.size}`);

    dnr.getAvailableStaticRuleCount().then(count => {
        console.log(`Available static rule count: ${count}`);
    });

    dnr.setExtensionActionOptions({ displayActionCountAsBadgeText: true });

    chrome.runtime.onMessage.addListener((request, sender, callback) => {
        switch ( request.what ) {
        case 'popupPanelData':
            matchesTrustedSiteDirective(request).then(response => {
                callback({
                    isTrusted: response,
                    rulesetDetails: rulesetDetails.filter(details =>
                        details.enabled
                    ).map(details => ({
                        name: details.name,
                        filterCount: details.filters.accepted,
                        ruleCount: details.rules.accepted,
                    })),
                });
            });
            return true;
        case 'toggleTrustedSiteDirective':
            toggleTrustedSiteDirective(request).then(response => {
                callback(response);
            });
            return true;
        default:
            break;
        }
    });
})();

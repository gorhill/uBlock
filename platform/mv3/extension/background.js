'use strict';

import regexRulesets from '/rulesets/regexes.js';

const dnr = chrome.declarativeNetRequest;

dnr.setExtensionActionOptions({ displayActionCountAsBadgeText: true });

(async ( ) => {
    const allRules = [];
    const toCheck = [];
    for ( const regexRuleset of regexRulesets ) {
        if ( regexRuleset.enabled !== true ) { continue; }
        for ( const rule of regexRuleset.rules ) {
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
    const oldRules = await dnr.getDynamicRules();
    const oldRuleMap = new Map(oldRules.map(rule => [ rule.id, rule ]));
    const newRuleMap = new Map(newRules.map(rule => [ rule.id, rule ]));
    const addRules = [];
    const removeRuleIds = [];
    for ( const oldRule of oldRules ) {
        const newRule = newRuleMap.get(oldRule.id);
        if ( newRule === undefined ) {
            removeRuleIds.push(oldRule.id);
        } else if ( JSON.stringify(oldRule) !== JSON.stringify(newRule) ) {
            removeRuleIds.push(oldRule.id);
            addRules.push(newRule);
        }
    }
    for ( const newRule of newRuleMap.values() ) {
        if ( oldRuleMap.has(newRule.id) ) { continue; }
        addRules.push(newRule);
    }
    if ( addRules.length !== 0 || removeRuleIds.length !== 0 ) {
        await dnr.updateDynamicRules({ addRules, removeRuleIds });
    }

    const dynamicRules = await dnr.getDynamicRules();
    console.log(`Dynamic rule count: ${dynamicRules.length}`);

    const enabledRulesets = await dnr.getEnabledRulesets();
    console.log(`Enabled rulesets: ${enabledRulesets}`);

    console.log(`Available dynamic rule count: ${dnr.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES - dynamicRules.length}`);

    dnr.getAvailableStaticRuleCount().then(count => {
        console.log(`Available static rule count: ${count}`);
    });
})();

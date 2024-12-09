/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2024-present Raymond Hill

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

import { dnr } from './ext.js';

/******************************************************************************/

export const isSideloaded = dnr.onRuleMatchedDebug instanceof Object;

/******************************************************************************/

export const ubolLog = (...args) => {
    // Do not pollute dev console in stable releases.
    if ( isSideloaded !== true ) { return; }
    console.info('[uBOL]', ...args);
};

/******************************************************************************/

const rulesets = new Map();
const bufferSize = isSideloaded ? 256 : 1;
const matchedRules = new Array(bufferSize);
matchedRules.fill(null);
let writePtr = 0;

const pruneLongLists = list => {
    if ( list.length <= 21 ) { return list; }
    return [ ...list.slice(0, 10), '...', ...list.slice(-10) ];
    
};

const getRuleset = async rulesetId => {
    if ( rulesets.has(rulesetId) ) { 
        return rulesets.get(rulesetId);
    }
    let rules;
    if ( rulesetId === dnr.DYNAMIC_RULESET_ID ) {
        rules = await dnr.getDynamicRules().catch(( ) => undefined);
    } else {
        const response = await fetch(`/rulesets/main/${rulesetId}.json`).catch(( ) => undefined);
        if ( response === undefined ) { return; }
        rules = await response.json().catch(( ) => undefined);
    }
    if ( Array.isArray(rules) === false ) { return; }
    const ruleset = new Map();
    for ( const rule of rules ) {
        const condition = rule.condition;
        if ( condition ) {
            if ( condition.requestDomains ) {
                condition.requestDomains = pruneLongLists(condition.requestDomains);
            }
            if ( condition.initiatorDomains ) {
                condition.initiatorDomains = pruneLongLists(condition.initiatorDomains);
            }
        }
        const ruleId = rule.id;
        rule.id = `${rulesetId}/${ruleId}`;
        ruleset.set(ruleId, rule);
    }
    rulesets.set(rulesetId, ruleset);
    return ruleset;
};

const getRuleDetails = async ruleInfo => {
    const { rulesetId, ruleId } = ruleInfo.rule;
    const ruleset = await getRuleset(rulesetId);
    if ( ruleset === undefined ) { return; }
    return { request: ruleInfo.request, rule: ruleset.get(ruleId) };
};

/******************************************************************************/

export const getMatchedRules = (( ) => {
    const noopFn = ( ) => Promise.resolve([]);
    if ( isSideloaded !== true ) { return noopFn; }

    return async tabId => {
        const promises = [];
        for ( let i = 0; i < bufferSize; i++ ) {
            const j = (writePtr + i) % bufferSize;
            const ruleInfo = matchedRules[j];
            if ( ruleInfo === null ) { continue; }
            if ( ruleInfo.request.tabId !== -1 ) {
                if ( ruleInfo.request.tabId !== tabId ) { continue; }
            }
            const promise = getRuleDetails(ruleInfo);
            if ( promise === undefined ) { continue; }
            promises.unshift(promise);
        }
        return Promise.all(promises);
    };
})();

/******************************************************************************/

const matchedRuleListener = ruleInfo => {
    matchedRules[writePtr] = ruleInfo;
    writePtr = (writePtr + 1) % bufferSize;
};

export const toggleDeveloperMode = state => {
    if ( isSideloaded !== true ) { return; }
    if ( state ) {
        dnr.onRuleMatchedDebug.addListener(matchedRuleListener);
    } else {
        dnr.onRuleMatchedDebug.removeListener(matchedRuleListener);
    }
};

/******************************************************************************/

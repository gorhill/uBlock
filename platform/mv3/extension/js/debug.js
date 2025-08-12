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

import {
    dnr,
    normalizeDNRRules,
    webext,
} from './ext-compat.js';

import {
    sessionRead,
    sessionWrite,
} from './ext.js';

/******************************************************************************/

const isModern = dnr.onRuleMatchedDebug instanceof Object;

export const isSideloaded = (( ) => {
    const { permissions } = webext.runtime.getManifest();
    return permissions?.includes('declarativeNetRequestFeedback') ?? false;
})();

/******************************************************************************/

const CONSOLE_MAX_LINES = 32;
const consoleOutput = [];

sessionRead('console').then(before => {
    if ( Array.isArray(before) === false ) { return; }
    for ( const s of before.reverse() ) {
        consoleOutput.unshift(s);
    }
    consoleTruncate();
});

const consoleTruncate = ( ) => {
    if ( consoleOutput.length <= CONSOLE_MAX_LINES ) { return; }
    consoleOutput.copyWithin(0, -CONSOLE_MAX_LINES);
    consoleOutput.length = CONSOLE_MAX_LINES;
};

const consoleAdd = (...args) => {
    if ( args.length === 0 ) { return; }
    const now = new Date();
    const time = [
        `${now.getUTCMonth()+1}`.padStart(2, '0'),
        `${now.getUTCDate()}`.padStart(2, '0'),
        '.',
        `${now.getUTCHours()}`.padStart(2, '0'),
        `${now.getUTCMinutes()}`.padStart(2, '0'),
    ].join('');
    for ( let i = 0; i < args.length; i++ ) {
        const s = `[${time}]${args[i]}`;
        if ( Boolean(s) === false ) { continue; }
        if ( s === consoleOutput.at(-1) ) { continue; }
        consoleOutput.push(s);
    }
    consoleTruncate();
    sessionWrite('console', getConsoleOutput());
}

export const ubolLog = (...args) => {
    // Do not pollute dev console in stable releases.
    if ( isSideloaded !== true ) { return; }
    console.info('[uBOL]', ...args);
};

export const ubolErr = (...args) => {
    if ( Array.isArray(args) === false ) { return; }
    if ( globalThis.ServiceWorkerGlobalScope ) {
        consoleAdd(...args);
    }
    // Do not pollute dev console in stable releases.
    if ( isSideloaded !== true ) { return; }
    console.error('[uBOL]', ...args);
};

export const getConsoleOutput = ( ) => {
    return consoleOutput.slice();
};

/******************************************************************************/

const rulesets = new Map();
const bufferSize = isSideloaded ? 256 : 1;
const matchedRules = new Array(bufferSize);
matchedRules.fill(null);
let writePtr = 0;

const pruneLongLists = list => {
    if ( list.length <= 11 ) { return list; }
    return [ ...list.slice(0, 5), '...', ...list.slice(-5) ];
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
        rules = await response.json().catch(( ) =>
            undefined
        ).then(rules =>
            normalizeDNRRules(rules)
        );
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
    if ( isSideloaded !== true ) {
        return ( ) => Promise.resolve([]);
    }

    if ( isModern ) {
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
    }

    return async tabId => {
        if ( typeof dnr.getMatchedRules !== 'function' ) { return []; }
        const matchedRules = await dnr.getMatchedRules({ tabId });
        if ( matchedRules instanceof Object === false ) { return []; }
        const promises = [];
        for ( const { tabId, rule } of matchedRules.rulesMatchedInfo ) {
            promises.push(getRuleDetails({ request: { tabId }, rule }));
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
    if ( isModern === false ) { return; } 
    if ( state ) {
        dnr.onRuleMatchedDebug.addListener(matchedRuleListener);
    } else {
        dnr.onRuleMatchedDebug.removeListener(matchedRuleListener);
    }
};

/******************************************************************************/

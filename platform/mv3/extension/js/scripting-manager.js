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

import * as ut from './utils.js';

import {
    browser,
    localKeys, localRemove, localWrite,
    sessionKeys, sessionRead, sessionRemove, sessionWrite,
} from './ext.js';
import { ubolErr, ubolLog } from './debug.js';

import { fetchJSON } from './fetch.js';
import { getEnabledRulesetsDetails } from './ruleset-manager.js';
import { getFilteringModeDetails } from './mode-manager.js';
import { registerCustomFilters } from './filter-manager.js';
import { registerToolbarIconToggler } from './action.js';

/******************************************************************************/

const resourceDetailPromises = new Map();

function getScriptletDetails() {
    let promise = resourceDetailPromises.get('scriptlet');
    if ( promise !== undefined ) { return promise; }
    promise = fetchJSON('/rulesets/scriptlet-details').then(
        entries => new Map(entries)
    );
    resourceDetailPromises.set('scriptlet', promise);
    return promise;
}

function getGenericDetails() {
    let promise = resourceDetailPromises.get('generic');
    if ( promise !== undefined ) { return promise; }
    promise = fetchJSON('/rulesets/generic-details').then(
        entries => new Map(entries)
    );
    resourceDetailPromises.set('generic', promise);
    return promise;
}

/******************************************************************************/

const normalizeMatches = matches => {
    if ( matches.length <= 1 ) { return; }
    if ( matches.includes('<all_urls>') === false ) {
        if ( matches.includes('*://*/*') === false ) { return; }
    }
    matches.length = 0;
    matches.push('<all_urls>');
};

/******************************************************************************/

async function resetCSSCache() {
    const keys = await sessionKeys();
    return sessionRemove(keys.filter(a => a.startsWith('cache.css.')));
}

/******************************************************************************/

function registerHighGeneric(context, genericDetails) {
    const { filteringModeDetails, rulesetsDetails } = context;

    const excludeHostnames = [];
    const includeHostnames = [];
    const css = [];
    for ( const details of rulesetsDetails ) {
        const hostnames = genericDetails.get(details.id);
        if ( hostnames ) {
            if ( hostnames.unhide ) {
                excludeHostnames.push(...hostnames.unhide);
            }
            if ( hostnames.hide ) {
                includeHostnames.push(...hostnames.hide);
            }
        }
        const count = details.css?.generichigh || 0;
        if ( count === 0 ) { continue; }
        css.push(`/rulesets/scripting/generichigh/${details.id}.css`);
    }

    if ( css.length === 0 ) { return; }

    const { none, basic, optimal, complete } = filteringModeDetails;
    const matches = [];
    const excludeMatches = [];
    if ( complete.has('all-urls') ) {
        excludeMatches.push(...ut.matchesFromHostnames(none));
        excludeMatches.push(...ut.matchesFromHostnames(basic));
        excludeMatches.push(...ut.matchesFromHostnames(optimal));
        excludeMatches.push(...ut.matchesFromHostnames(excludeHostnames));
        matches.push('<all_urls>');
    } else {
        matches.push(
            ...ut.matchesFromHostnames(
                ut.subtractHostnameIters(
                    Array.from(complete),
                    excludeHostnames
                )
            )
        );
    }
    if ( matches.length === 0 ) { return; }

    // https://github.com/w3c/webextensions/issues/414#issuecomment-1623992885
    // Once supported, add:
    // cssOrigin: 'USER',
    const directive = {
        id: 'css-generichigh',
        css,
        matches,
        allFrames: true,
        runAt: 'document_end',
    };
    if ( excludeMatches.length !== 0 ) {
        directive.excludeMatches = excludeMatches;
    }

    // register
    context.toAdd.push(directive);
}

/******************************************************************************/

function registerGeneric(context, genericDetails) {
    const { filteringModeDetails, rulesetsDetails } = context;

    const excludedByFilter = [];
    const includedByFilter = [];
    const js = [];
    for ( const details of rulesetsDetails ) {
        const hostnames = genericDetails.get(details.id);
        if ( hostnames ) {
            if ( hostnames.unhide ) {
                excludedByFilter.push(...hostnames.unhide);
            }
            if ( hostnames.hide ) {
                includedByFilter.push(...hostnames.hide);
            }
        }
        const count = details.css?.generic || 0;
        if ( count === 0 ) { continue; }
        js.push(`/rulesets/scripting/generic/${details.id}.js`);
    }

    if ( js.length === 0 ) { return; }

    js.unshift('/js/scripting/css-api.js', '/js/scripting/isolated-api.js');
    js.push('/js/scripting/css-generic.js');

    const { none, basic, optimal, complete } = filteringModeDetails;
    const includedByMode = [ ...complete ];
    const excludedByMode = [ ...none, ...basic, ...optimal ];

    if ( complete.has('all-urls') === false ) {
        const matches = [
            ...ut.matchesFromHostnames(
                ut.subtractHostnameIters(includedByMode, excludedByFilter)
            ),
            ...ut.matchesFromHostnames(
                ut.intersectHostnameIters(includedByMode, includedByFilter)
            ),
        ];
        if ( matches.length === 0 ) { return; }
        const directive = {
            id: 'css-generic-some',
            js,
            allFrames: true,
            matches,
            runAt: 'document_idle',
        };
        context.toAdd.push(directive);
        return;
    }

    const excludeMatches = [
        ...ut.matchesFromHostnames(excludedByMode),
        ...ut.matchesFromHostnames(excludedByFilter),
    ];
    const directiveAll = {
        id: 'css-generic-all',
        js,
        allFrames: true,
        matches: [ '<all_urls>' ],
        runAt: 'document_idle',
    };
    if ( excludeMatches.length !== 0 ) {
        directiveAll.excludeMatches = excludeMatches;
    }
    context.toAdd.push(directiveAll);

    const matches = [
        ...ut.matchesFromHostnames(
            ut.subtractHostnameIters(includedByFilter, excludedByMode)
        ),
    ];
    if ( matches.length === 0 ) { return; }
    const directiveSome = {
        id: 'css-generic-some',
        js,
        allFrames: true,
        matches,
        runAt: 'document_idle',
    };
    context.toAdd.push(directiveSome);
}

/******************************************************************************/

async function registerCosmetic(realm, context) {
    const { filteringModeDetails, rulesetsDetails } = context;

    {
        const keys = await localKeys();
        localRemove(keys.filter(a => a.startsWith(`css.${realm}.`)));
    }

    const rulesetIds = [];
    for ( const rulesetDetails of rulesetsDetails ) {
        const count = rulesetDetails.css?.[realm] || 0;
        if ( count === 0 ) { continue; }
        rulesetIds.push(rulesetDetails.id);
    }
    if ( rulesetIds.length === 0 ) { return; }

    const { none, basic, optimal, complete } = filteringModeDetails;
    const matches = [
        ...ut.matchesFromHostnames(optimal),
        ...ut.matchesFromHostnames(complete),
    ];
    if ( matches.length === 0 ) { return; }

    {
        const promises = [];
        for ( const id of rulesetIds ) {
            promises.push(
                fetchJSON(`/rulesets/scripting/${realm}/${id}`).then(data => {
                    return localWrite(`css.${realm}.${id}`, data);
                })
            );
        }
        await Promise.all(promises);
    }

    normalizeMatches(matches);

    const realmid = `css-${realm}`;
    const js = rulesetIds.map(id => `/rulesets/scripting/${realm}/${id}.js`);
    js.unshift('/js/scripting/css-api.js', '/js/scripting/isolated-api.js');
    js.push(`/js/scripting/${realmid}.js`);

    const excludeMatches = [];
    if ( none.has('all-urls') === false && basic.has('all-urls') === false ) {
        const toExclude = [
            ...ut.matchesFromHostnames(none),
            ...ut.matchesFromHostnames(basic),
        ];
        for ( const hn of toExclude ) {
            excludeMatches.push(hn);
        }
    }

    const directive = {
        id: realmid,
        js,
        matches,
        allFrames: true,
        runAt: 'document_start',
    };
    if ( excludeMatches.length !== 0 ) {
        directive.excludeMatches = excludeMatches;
    }

    // register
    context.toAdd.push(directive);
}

/******************************************************************************/

function registerScriptlet(context, scriptletDetails) {
    const { filteringModeDetails, rulesetsDetails } = context;

    const hasBroadHostPermission =
        filteringModeDetails.optimal.has('all-urls') ||
        filteringModeDetails.complete.has('all-urls');

    const permissionRevokedMatches = [
        ...ut.matchesFromHostnames(filteringModeDetails.none),
        ...ut.matchesFromHostnames(filteringModeDetails.basic),
    ];
    const permissionGrantedHostnames = [
        ...filteringModeDetails.optimal,
        ...filteringModeDetails.complete,
    ];

    for ( const rulesetId of rulesetsDetails.map(v => v.id) ) {
        const worlds = scriptletDetails.get(rulesetId);
        if ( worlds === undefined ) { continue; }
        for ( const world of Object.keys(worlds) ) {
            const id = `${rulesetId}.${world.toLowerCase()}`;

            const matches = [];
            const excludeMatches = [];
            const hostnames = worlds[world];
            let targetHostnames = [];
            if ( hasBroadHostPermission ) {
                excludeMatches.push(...permissionRevokedMatches);
                targetHostnames = hostnames;
            } else if ( permissionGrantedHostnames.length !== 0 ) {
                if ( hostnames.includes('*') ) {
                    targetHostnames = permissionGrantedHostnames;
                } else {
                    targetHostnames = ut.intersectHostnameIters(
                        hostnames,
                        permissionGrantedHostnames
                    );
                }
            }
            if ( targetHostnames.length === 0 ) { continue; }
            matches.push(...ut.matchesFromHostnames(targetHostnames));
            normalizeMatches(matches);

            const directive = {
                id,
                js: [ `/rulesets/scripting/scriptlet/${world.toLowerCase()}/${rulesetId}.js` ],
                matches,
                allFrames: true,
                matchOriginAsFallback: true,
                runAt: 'document_start',
                world,
            };
            if ( excludeMatches.length !== 0 ) {
                directive.excludeMatches = excludeMatches;
            }

            // register
            context.toAdd.push(directive);
        }
    }
}

/******************************************************************************/

// Issue: Safari appears to completely ignore excludeMatches
// https://github.com/radiolondra/ExcludeMatches-Test

export async function registerInjectables() {
    if ( browser.scripting === undefined ) { return false; }

    if ( registerInjectables.barrier ) { return true; }
    registerInjectables.barrier = true;

    const [
        filteringModeDetails,
        rulesetsDetails,
        scriptletDetails,
        genericDetails,
    ] = await Promise.all([
        getFilteringModeDetails(),
        getEnabledRulesetsDetails(),
        getScriptletDetails(),
        getGenericDetails(),
    ]);
    const toAdd = [];
    const context = {
        filteringModeDetails,
        rulesetsDetails,
        toAdd,
    };

    await Promise.all([
        registerScriptlet(context, scriptletDetails),
        registerCosmetic('specific', context),
        registerCosmetic('procedural', context),
        registerGeneric(context, genericDetails),
        registerHighGeneric(context, genericDetails),
        registerCustomFilters(context),
        registerToolbarIconToggler(context),
    ]);

    ubolLog(`Unregistered all content (css/js)`);
    try {
        await browser.scripting.unregisterContentScripts();
    } catch(reason) {
        ubolErr(`unregisterContentScripts/${reason}`);
    }

    if ( toAdd.length !== 0 ) {
        ubolLog(`Registered ${toAdd.map(v => v.id)} content (css/js)`);
        try {
            await browser.scripting.registerContentScripts(toAdd);
        } catch(reason) {
            ubolErr(`registerContentScripts/${reason}`);
        }
    }

    await resetCSSCache();

    registerInjectables.barrier = false;

    return true;
}

/******************************************************************************/

export async function onWakeupRun() {
    const cleanupTime = await sessionRead('scripting.manager.cleanup.time') || 0;
    const now = Date.now();
    const since = now - cleanupTime;
    if ( since < (15 * 60 * 1000) ) { return; } // 15 minutes
    const MAX_CACHE_ENTRY_LOW = 256;
    const MAX_CACHE_ENTRY_HIGH = MAX_CACHE_ENTRY_LOW +
        Math.max(Math.round(MAX_CACHE_ENTRY_LOW / 8), 8);
    const keys = await sessionKeys() || [];
    const cacheKeys = keys.filter(a => a.startsWith('cache.css.'));
    if ( cacheKeys.length < MAX_CACHE_ENTRY_HIGH ) { return; }
    const entries = await Promise.all(cacheKeys.map(async a => {
        const entry = await sessionRead(a) || {};
        entry.key = a;
        return entry;
    }));
    entries.sort((a, b) => b.t - a.t);
    sessionRemove(entries.slice(MAX_CACHE_ENTRY_LOW).map(a => a.key));
    sessionWrite('scripting.manager.cleanup.time', now)
}

/******************************************************************************/

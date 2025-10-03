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

import { browser, localRemove } from './ext.js';
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

// The extensions API does not always return exactly what we fed it, so we
// need to normalize some entries to be sure we properly detect changes when
// comparing registered entries vs. entries to register.

const normalizeRegisteredContentScripts = registered => {
    for ( const entry of registered ) {
        const { css = [], js = [] } = entry;
        for ( let i = 0; i < css.length; i++ ) {
            const path = css[i];
            if ( path.startsWith('/') ) { continue; }
            css[i] = `/${path}`;
        }
        for ( let i = 0; i < js.length; i++ ) {
            const path = js[i];
            if ( path.startsWith('/') ) { continue; }
            js[i] = `/${path}`;
        }
    }
    return registered;
};

/******************************************************************************/

function registerHighGeneric(context, genericDetails) {
    const { before, filteringModeDetails, rulesetsDetails } = context;

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

    const registered = before.get('css-generichigh');
    before.delete('css-generichigh'); // Important!

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
    if ( registered === undefined ) {
        context.toAdd.push(directive);
        return;
    }

    // update
    if (
        ut.strArrayEq(registered.css, css, false) === false ||
        ut.strArrayEq(registered.matches, matches) === false ||
        ut.strArrayEq(registered.excludeMatches, excludeMatches) === false
    ) {
        context.toRemove.push('css-generichigh');
        context.toAdd.push(directive);
    }
}

/******************************************************************************/

function registerGeneric(context, genericDetails) {
    const { before, filteringModeDetails, rulesetsDetails } = context;

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

    js.unshift('/js/scripting/isolated-api.js');
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
        const registered = before.get('css-generic-some');
        before.delete('css-generic-some'); // Important!
        const directive = {
            id: 'css-generic-some',
            js,
            allFrames: true,
            matches,
            runAt: 'document_idle',
        };
        if ( registered === undefined ) { // register
            context.toAdd.push(directive);
        } else if ( // update
            ut.strArrayEq(registered.js, js, false) === false ||
            ut.strArrayEq(registered.matches, directive.matches) === false
        ) {
            context.toRemove.push('css-generic-some');
            context.toAdd.push(directive);
        }
        return;
    }

    const excludeMatches = [
        ...ut.matchesFromHostnames(excludedByMode),
        ...ut.matchesFromHostnames(excludedByFilter),
    ];
    const registeredAll = before.get('css-generic-all');
    before.delete('css-generic-all'); // Important!
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

    if ( registeredAll === undefined ) { // register
        context.toAdd.push(directiveAll);
    } else if ( // update
        ut.strArrayEq(registeredAll.js, js, false) === false ||
        ut.strArrayEq(registeredAll.excludeMatches, directiveAll.excludeMatches) === false
    ) {
        context.toRemove.push('css-generic-all');
        context.toAdd.push(directiveAll);
    }
    const matches = [
        ...ut.matchesFromHostnames(
            ut.subtractHostnameIters(includedByFilter, excludedByMode)
        ),
    ];
    if ( matches.length === 0 ) { return; }
    const registeredSome = before.get('css-generic-some');
    before.delete('css-generic-some'); // Important!
    const directiveSome = {
        id: 'css-generic-some',
        js,
        allFrames: true,
        matches,
        runAt: 'document_idle',
    };
    if ( registeredSome === undefined ) { // register
        context.toAdd.push(directiveSome);
    } else if ( // update
        ut.strArrayEq(registeredSome.js, js, false) === false ||
        ut.strArrayEq(registeredSome.matches, directiveSome.matches) === false
    ) {
        context.toRemove.push('css-generic-some');
        context.toAdd.push(directiveSome);
    }
}

/******************************************************************************/

function registerProcedural(context) {
    const { before, filteringModeDetails, rulesetsDetails } = context;

    const js = [];
    for ( const rulesetDetails of rulesetsDetails ) {
        const count = rulesetDetails.css?.procedural || 0;
        if ( count === 0 ) { continue; }
        js.push(`/rulesets/scripting/procedural/${rulesetDetails.id}.js`);
    }
    if ( js.length === 0 ) { return; }

    const { none, basic, optimal, complete } = filteringModeDetails;
    const matches = [
        ...ut.matchesFromHostnames(optimal),
        ...ut.matchesFromHostnames(complete),
    ];
    if ( matches.length === 0 ) { return; }

    normalizeMatches(matches);

    js.unshift('/js/scripting/isolated-api.js');
    js.push('/js/scripting/css-procedural.js');

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

    const registered = before.get('css-procedural');
    before.delete('css-procedural'); // Important!

    const directive = {
        id: 'css-procedural',
        js,
        matches,
        allFrames: true,
        runAt: 'document_start',
    };
    if ( excludeMatches.length !== 0 ) {
        directive.excludeMatches = excludeMatches;
    }

    // register
    if ( registered === undefined ) {
        context.toAdd.push(directive);
        return;
    }

    // update
    if (
        ut.strArrayEq(registered.js, js, false) === false ||
        ut.strArrayEq(registered.matches, matches) === false ||
        ut.strArrayEq(registered.excludeMatches, excludeMatches) === false
    ) {
        context.toRemove.push('css-procedural');
        context.toAdd.push(directive);
    }
}

/******************************************************************************/

function registerSpecific(context) {
    const { before, filteringModeDetails, rulesetsDetails } = context;

    const js = [];
    for ( const rulesetDetails of rulesetsDetails ) {
        const count = rulesetDetails.css?.specific || 0;
        if ( count === 0 ) { continue; }
        js.push(`/rulesets/scripting/specific/${rulesetDetails.id}.js`);
    }
    if ( js.length === 0 ) { return; }

    const { none, basic, optimal, complete } = filteringModeDetails;
    const matches = [
        ...ut.matchesFromHostnames(optimal),
        ...ut.matchesFromHostnames(complete),
    ];
    if ( matches.length === 0 ) { return; }

    normalizeMatches(matches);

    js.unshift('/js/scripting/isolated-api.js');
    js.push('/js/scripting/css-specific.js');

    const excludeMatches = [];
    if ( none.has('all-urls') === false ) {
        excludeMatches.push(...ut.matchesFromHostnames(none));
    }
    if ( basic.has('all-urls') === false ) {
        excludeMatches.push(...ut.matchesFromHostnames(basic));
    }

    const registered = before.get('css-specific');
    before.delete('css-specific'); // Important!

    const directive = {
        id: 'css-specific',
        js,
        matches,
        allFrames: true,
        runAt: 'document_start',
    };
    if ( excludeMatches.length !== 0 ) {
        directive.excludeMatches = excludeMatches;
    }

    // register
    if ( registered === undefined ) {
        context.toAdd.push(directive);
        return;
    }

    // update
    if (
        ut.strArrayEq(registered.js, js, false) === false ||
        ut.strArrayEq(registered.matches, matches) === false ||
        ut.strArrayEq(registered.excludeMatches, excludeMatches) === false
    ) {
        context.toRemove.push('css-specific');
        context.toAdd.push(directive);
    }
}

/******************************************************************************/

function registerScriptlet(context, scriptletDetails) {
    const { before, filteringModeDetails, rulesetsDetails } = context;

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
        const scriptletList = scriptletDetails.get(rulesetId);
        if ( scriptletList === undefined ) { continue; }

        for ( const [ token, details ] of scriptletList ) {
            const id = `${rulesetId}.${token}`;
            const registered = before.get(id);

            const matches = [];
            const excludeMatches = [];
            let targetHostnames = [];
            if ( hasBroadHostPermission ) {
                excludeMatches.push(...permissionRevokedMatches);
                if ( details.hostnames.length > 100 ) {
                    targetHostnames = [ '*' ];
                } else {
                    targetHostnames = details.hostnames;
                }
            } else if ( permissionGrantedHostnames.length !== 0 ) {
                if ( details.hostnames.includes('*') ) {
                    targetHostnames = permissionGrantedHostnames;
                } else {
                    targetHostnames = ut.intersectHostnameIters(
                        details.hostnames,
                        permissionGrantedHostnames
                    );
                }
            }
            if ( targetHostnames.length === 0 ) { continue; }
            matches.push(...ut.matchesFromHostnames(targetHostnames));
            normalizeMatches(matches);

            before.delete(id); // Important!

            const directive = {
                id,
                js: [ `/rulesets/scripting/scriptlet/${id}.js` ],
                matches,
                allFrames: true,
                matchOriginAsFallback: true,
                runAt: 'document_start',
                world: details.world,
            };
            if ( excludeMatches.length !== 0 ) {
                directive.excludeMatches = excludeMatches;
            }

            // register
            if ( registered === undefined ) {
                context.toAdd.push(directive);
                continue;
            }

            // update
            if (
                ut.strArrayEq(registered.matches, matches) === false ||
                ut.strArrayEq(registered.excludeMatches, excludeMatches) === false
            ) {
                context.toRemove.push(id);
                context.toAdd.push(directive);
            }
        }
    }
}

/******************************************************************************/

// Issue: Safari appears to completely ignore excludeMatches
// https://github.com/radiolondra/ExcludeMatches-Test

async function registerInjectables() {
    if ( browser.scripting === undefined ) { return false; }

    if ( registerInjectables.barrier ) { return true; }
    registerInjectables.barrier = true;

    const [
        filteringModeDetails,
        rulesetsDetails,
        scriptletDetails,
        genericDetails,
        registered,
    ] = await Promise.all([
        getFilteringModeDetails(),
        getEnabledRulesetsDetails(),
        getScriptletDetails(),
        getGenericDetails(),
        browser.scripting.getRegisteredContentScripts(),
    ]);
    const before = new Map(
        normalizeRegisteredContentScripts(registered).map(
            entry => [ entry.id, entry ]
        )
    );
    const toAdd = [], toRemove = [];
    const context = {
        filteringModeDetails,
        rulesetsDetails,
        before,
        toAdd,
        toRemove,
    };

    await Promise.all([
        registerProcedural(context),
        registerScriptlet(context, scriptletDetails),
        registerSpecific(context),
        registerGeneric(context, genericDetails),
        registerHighGeneric(context, genericDetails),
        registerCustomFilters(context),
        registerToolbarIconToggler(context),
    ]);

    toRemove.push(...Array.from(before.keys()));

    if ( toRemove.length !== 0 ) {
        ubolLog(`Unregistered ${toRemove} content (css/js)`);
        try {
            await browser.scripting.unregisterContentScripts({ ids: toRemove });
            localRemove('$scripting.unregisterContentScripts');
        } catch(reason) {
            ubolErr(`unregisterContentScripts/${reason}`);
        }
    }

    if ( toAdd.length !== 0 ) {
        ubolLog(`Registered ${toAdd.map(v => v.id)} content (css/js)`);
        try {
            await browser.scripting.registerContentScripts(toAdd);
            localRemove('$scripting.registerContentScripts');
        } catch(reason) {
            ubolErr(`registerContentScripts/${reason}`);
        }
    }

    registerInjectables.barrier = false;

    return true;
}

/******************************************************************************/

export {
    registerInjectables
};

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

import { browser } from './ext.js';
import { fetchJSON } from './fetch.js';
import { getFilteringModeDetails } from './mode-manager.js';
import { getEnabledRulesetsDetails } from './ruleset-manager.js';

import * as ut from './utils.js';

/******************************************************************************/

const isGecko = browser.runtime.getURL('').startsWith('moz-extension://');

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

// Important: We need to sort the arrays for fast comparison
const arrayEq = (a = [], b = [], sort = true) => {
    const alen = a.length;
    if ( alen !== b.length ) { return false; }
    if ( sort ) { a.sort(); b.sort(); }
    for ( let i = 0; i < alen; i++ ) {
        if ( a[i] !== b[i] ) { return false; }
    }
    return true;
};

/******************************************************************************/

// The extensions API does not always return exactly what we fed it, so we
// need to normalize some entries to be sure we properly detect changes when
// comparing registered entries vs. entries to register.

const normalizeRegisteredContentScripts = registered => {
    for ( const entry of registered ) {
        const { js } = entry;
        for ( let i = 0; i < js.length; i++ ) {
            const path = js[i];
            if ( path.startsWith('/') ) { continue; }
            js[i] = `/${path}`;
        }
    }
    return registered;
};

/******************************************************************************/

function registerGeneric(context, genericDetails) {
    const { before, filteringModeDetails, rulesetsDetails } = context;

    const excludeHostnames = [];
    const js = [];
    for ( const details of rulesetsDetails ) {
        const hostnames = genericDetails.get(details.id);
        if ( hostnames !== undefined ) {
            excludeHostnames.push(...hostnames);
        }
        const count = details.css?.generic || 0;
        if ( count === 0 ) { continue; }
        js.push(`/rulesets/scripting/generic/${details.id}.js`);
    }

    if ( js.length === 0 ) { return; }

    js.push('/js/scripting/css-generic.js');

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

    const registered = before.get('css-generic');
    before.delete('css-generic'); // Important!

    const directive = {
        id: 'css-generic',
        js,
        matches,
        excludeMatches,
        runAt: 'document_idle',
    };

    // register
    if ( registered === undefined ) {
        context.toAdd.push(directive);
        return;
    }

    // update
    if (
        arrayEq(registered.js, js, false) === false ||
        arrayEq(registered.matches, matches) === false ||
        arrayEq(registered.excludeMatches, excludeMatches) === false
    ) {
        context.toRemove.push('css-generic');
        context.toAdd.push(directive);
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

    js.push('/js/scripting/css-procedural.js');

    const excludeMatches = [];
    if ( none.has('all-urls') === false ) {
        excludeMatches.push(...ut.matchesFromHostnames(none));
    }
    if ( basic.has('all-urls') === false ) {
        excludeMatches.push(...ut.matchesFromHostnames(basic));
    }

    const registered = before.get('css-procedural');
    before.delete('css-procedural'); // Important!

    const directive = {
        id: 'css-procedural',
        js,
        allFrames: true,
        matches,
        excludeMatches,
        runAt: 'document_end',
    };

    // register
    if ( registered === undefined ) {
        context.toAdd.push(directive);
        return;
    }

    // update
    if (
        arrayEq(registered.js, js, false) === false ||
        arrayEq(registered.matches, matches) === false ||
        arrayEq(registered.excludeMatches, excludeMatches) === false
    ) {
        context.toRemove.push('css-procedural');
        context.toAdd.push(directive);
    }
}

/******************************************************************************/

function registerDeclarative(context) {
    const { before, filteringModeDetails, rulesetsDetails } = context;

    const js = [];
    for ( const rulesetDetails of rulesetsDetails ) {
        const count = rulesetDetails.css?.declarative || 0;
        if ( count === 0 ) { continue; }
        js.push(`/rulesets/scripting/declarative/${rulesetDetails.id}.js`);
    }
    if ( js.length === 0 ) { return; }

    const { none, basic, optimal, complete } = filteringModeDetails;
    const matches = [
        ...ut.matchesFromHostnames(optimal),
        ...ut.matchesFromHostnames(complete),
    ];
    if ( matches.length === 0 ) { return; }

    js.push('/js/scripting/css-declarative.js');

    const excludeMatches = [];
    if ( none.has('all-urls') === false ) {
        excludeMatches.push(...ut.matchesFromHostnames(none));
    }
    if ( basic.has('all-urls') === false ) {
        excludeMatches.push(...ut.matchesFromHostnames(basic));
    }

    const registered = before.get('css-declarative');
    before.delete('css-declarative'); // Important!

    const directive = {
        id: 'css-declarative',
        js,
        allFrames: true,
        matches,
        excludeMatches,
        runAt: 'document_start',
    };

    // register
    if ( registered === undefined ) {
        context.toAdd.push(directive);
        return;
    }

    // update
    if (
        arrayEq(registered.js, js, false) === false ||
        arrayEq(registered.matches, matches) === false ||
        arrayEq(registered.excludeMatches, excludeMatches) === false
    ) {
        context.toRemove.push('css-declarative');
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
        allFrames: true,
        matches,
        excludeMatches,
        runAt: 'document_start',
    };

    // register
    if ( registered === undefined ) {
        context.toAdd.push(directive);
        return;
    }

    // update
    if (
        arrayEq(registered.js, js, false) === false ||
        arrayEq(registered.matches, matches) === false ||
        arrayEq(registered.excludeMatches, excludeMatches) === false
    ) {
        context.toRemove.push('css-specific');
        context.toAdd.push(directive);
    }
}

/******************************************************************************/

function registerScriptlet(context, scriptletDetails) {
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1736575
    //   `MAIN` world not yet supported in Firefox
    if ( isGecko ) { return; }

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

        for ( const [ token, scriptletHostnames ] of scriptletList ) {
            const id = `${rulesetId}.${token}`;
            const registered = before.get(id);

            const matches = [];
            const excludeMatches = [];
            let targetHostnames = [];
            if ( hasBroadHostPermission ) {
                excludeMatches.push(...permissionRevokedMatches);
                if ( scriptletHostnames.length > 100 ) {
                    targetHostnames = [ '*' ];
                } else {
                    targetHostnames = scriptletHostnames;
                }
            } else if ( permissionGrantedHostnames.length !== 0 ) {
                if ( scriptletHostnames.includes('*') ) {
                    targetHostnames = permissionGrantedHostnames;
                } else {
                    targetHostnames = ut.intersectHostnameIters(
                        permissionGrantedHostnames,
                        scriptletHostnames
                    );
                }
            }
            if ( targetHostnames.length === 0 ) { continue; }
            matches.push(...ut.matchesFromHostnames(targetHostnames));

            before.delete(id); // Important!

            const directive = {
                id,
                js: [ `/rulesets/scripting/scriptlet/${id}.js` ],
                allFrames: true,
                matches,
                excludeMatches,
                runAt: 'document_start',
                world: 'MAIN',
            };

            // register
            if ( registered === undefined ) {
                context.toAdd.push(directive);
                continue;
            }

            // update
            if (
                arrayEq(registered.matches, matches) === false ||
                arrayEq(registered.excludeMatches, excludeMatches) === false
            ) {
                context.toRemove.push(id);
                context.toAdd.push(directive);
            }
        }
    }
}

/******************************************************************************/

async function registerInjectables(origins) {
    void origins;

    if ( browser.scripting === undefined ) { return false; }

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

    registerDeclarative(context);
    registerProcedural(context);
    registerScriptlet(context, scriptletDetails);
    registerSpecific(context);
    registerGeneric(context, genericDetails);

    toRemove.push(...Array.from(before.keys()));

    if ( toRemove.length !== 0 ) {
        ut.ubolLog(`Unregistered ${toRemove} content (css/js)`);
        await browser.scripting.unregisterContentScripts({ ids: toRemove })
            .catch(reason => { console.info(reason); });
    }

    if ( toAdd.length !== 0 ) {
        ut.ubolLog(`Registered ${toAdd.map(v => v.id)} content (css/js)`);
        await browser.scripting.registerContentScripts(toAdd)
            .catch(reason => { console.info(reason); });
    }

    return true;
}

/******************************************************************************/

export {
    registerInjectables
};

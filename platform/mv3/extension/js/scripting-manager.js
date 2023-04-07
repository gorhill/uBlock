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

function getSpecificDetails() {
    let promise = resourceDetailPromises.get('specific');
    if ( promise !== undefined ) { return promise; }
    promise = fetchJSON('/rulesets/specific-details').then(entries => {
        const out = new Map();
        for ( const entry of entries ) {
            out.set(entry[0], new Map(entry[1]));
        }
        return out;
    });
    resourceDetailPromises.set('specific', promise);
    return promise;
}

function getDeclarativeDetails() {
    let promise = resourceDetailPromises.get('declarative');
    if ( promise !== undefined ) { return promise; }
    promise = fetchJSON('/rulesets/declarative-details').then(
        entries => new Map(entries)
    );
    resourceDetailPromises.set('declarative', promise);
    return promise;
}

function getProceduralDetails() {
    let promise = resourceDetailPromises.get('procedural');
    if ( promise !== undefined ) { return promise; }
    promise = fetchJSON('/rulesets/procedural-details').then(
        entries => new Map(entries)
    );
    resourceDetailPromises.set('procedural', promise);
    return promise;
}

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
        if ( details.css.generic instanceof Object === false ) { continue; }
        if ( details.css.generic.count === 0 ) { continue; }
        js.push(`/rulesets/scripting/generic/${details.id}.js`);
    }

    if ( js.length === 0 ) { return; }

    js.push('/js/scripting/css-generic.js');

    const matches = [];
    const excludeMatches = [];
    if ( filteringModeDetails.extendedGeneric.has('all-urls') ) {
        excludeMatches.push(...ut.matchesFromHostnames(filteringModeDetails.none));
        excludeMatches.push(...ut.matchesFromHostnames(filteringModeDetails.network));
        excludeMatches.push(...ut.matchesFromHostnames(filteringModeDetails.extendedSpecific));
        excludeMatches.push(...ut.matchesFromHostnames(excludeHostnames));
        matches.push('<all_urls>');
    } else {
        matches.push(
            ...ut.matchesFromHostnames(
                ut.subtractHostnameIters(
                    Array.from(filteringModeDetails.extendedGeneric),
                    excludeHostnames
                )
            )
        );
    }

    if ( matches.length === 0 ) { return; }

    const registered = before.get('css-generic');
    before.delete('css-generic'); // Important!

    // register
    if ( registered === undefined ) {
        context.toAdd.push({
            id: 'css-generic',
            js,
            matches,
            excludeMatches,
            runAt: 'document_idle',
        });
        return;
    }

    // update
    const directive = { id: 'css-generic' };
    if ( arrayEq(registered.js, js, false) === false ) {
        directive.js = js;
    }
    if ( arrayEq(registered.matches, matches) === false ) {
        directive.matches = matches;
    }
    if ( arrayEq(registered.excludeMatches, excludeMatches) === false ) {
        directive.excludeMatches = excludeMatches;
    }
    if ( directive.js || directive.matches || directive.excludeMatches ) {
        context.toUpdate.push(directive);
    }
}

/******************************************************************************/

function registerProcedural(context, proceduralDetails) {
    const { before, filteringModeDetails, rulesetsDetails } = context;

    const js = [];
    const hostnameMatches = new Set();
    for ( const details of rulesetsDetails ) {
        if ( details.css.procedural === 0 ) { continue; }
        js.push(`/rulesets/scripting/procedural/${details.id}.js`);
        if ( proceduralDetails.has(details.id) ) {
            for ( const hn of proceduralDetails.get(details.id) ) {
                hostnameMatches.add(hn);
            }
        }
    }

    if ( js.length === 0 ) { return; }

    js.push('/js/scripting/css-procedural.js');

    const {
        none,
        network,
        extendedSpecific,
        extendedGeneric,
    } = filteringModeDetails;

    const matches = [];
    const excludeMatches = [];
    if ( extendedSpecific.has('all-urls') || extendedGeneric.has('all-urls') ) {
        excludeMatches.push(...ut.matchesFromHostnames(none));
        excludeMatches.push(...ut.matchesFromHostnames(network));
        matches.push(...ut.matchesFromHostnames(hostnameMatches));
    } else if ( extendedSpecific.size !== 0 || extendedGeneric.size !== 0 ) {
        matches.push(
            ...ut.matchesFromHostnames(
                ut.intersectHostnameIters(
                    [ ...extendedSpecific, ...extendedGeneric ],
                    hostnameMatches
                )
            )
        );
    }

    if ( matches.length === 0 ) { return; }

    const registered = before.get('css-procedural');
    before.delete('css-procedural'); // Important!

    // register
    if ( registered === undefined ) {
        context.toAdd.push({
            id: 'css-procedural',
            js,
            allFrames: true,
            matches,
            excludeMatches,
            runAt: 'document_end',
        });
        return;
    }

    // update
    const directive = { id: 'css-procedural' };
    if ( arrayEq(registered.js, js, false) === false ) {
        directive.js = js;
    }
    if ( arrayEq(registered.matches, matches) === false ) {
        directive.matches = matches;
    }
    if ( arrayEq(registered.excludeMatches, excludeMatches) === false ) {
        directive.excludeMatches = excludeMatches;
    }
    if ( directive.js || directive.matches || directive.excludeMatches ) {
        context.toUpdate.push(directive);
    }
}

/******************************************************************************/

function registerDeclarative(context, declarativeDetails) {
    const { before, filteringModeDetails, rulesetsDetails } = context;

    const js = [];
    const hostnameMatches = [];
    for ( const details of rulesetsDetails ) {
        if ( details.css.declarative === 0 ) { continue; }
        js.push(`/rulesets/scripting/declarative/${details.id}.js`);
        if ( declarativeDetails.has(details.id) ) {
            hostnameMatches.push(...declarativeDetails.get(details.id));
        }
    }

    if ( js.length === 0 ) { return; }

    js.push('/js/scripting/css-declarative.js');

    const {
        none,
        network,
        extendedSpecific,
        extendedGeneric,
    } = filteringModeDetails;

    const matches = [];
    const excludeMatches = [];
    if ( extendedSpecific.has('all-urls') || extendedGeneric.has('all-urls') ) {
        excludeMatches.push(...ut.matchesFromHostnames(none));
        excludeMatches.push(...ut.matchesFromHostnames(network));
        matches.push(...ut.matchesFromHostnames(hostnameMatches));
    } else if ( extendedSpecific.size !== 0 || extendedGeneric.size !== 0 ) {
        matches.push(
            ...ut.matchesFromHostnames(
                ut.intersectHostnameIters(
                    [ ...extendedSpecific, ...extendedGeneric ],
                    hostnameMatches
                )
            )
        );
    }

    if ( matches.length === 0 ) { return; }

    const registered = before.get('css-declarative');
    before.delete('css-declarative'); // Important!

    // register
    if ( registered === undefined ) {
        context.toAdd.push({
            id: 'css-declarative',
            js,
            allFrames: true,
            matches,
            excludeMatches,
            runAt: 'document_start',
        });
        return;
    }

    // update
    const directive = { id: 'css-declarative' };
    if ( arrayEq(registered.js, js, false) === false ) {
        directive.js = js;
    }
    if ( arrayEq(registered.matches, matches) === false ) {
        directive.matches = matches;
    }
    if ( arrayEq(registered.excludeMatches, excludeMatches) === false ) {
        directive.excludeMatches = excludeMatches;
    }
    if ( directive.js || directive.matches || directive.excludeMatches ) {
        context.toUpdate.push(directive);
    }
}

/******************************************************************************/

function registerScriptlet(context, scriptletDetails) {
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1736575
    //   `MAIN` world not yet supported in Firefox
    if ( isGecko ) { return; }

    const { before, filteringModeDetails, rulesetsDetails } = context;

    const hasBroadHostPermission =
        filteringModeDetails.extendedSpecific.has('all-urls') ||
        filteringModeDetails.extendedGeneric.has('all-urls');

    const permissionRevokedMatches = [
        ...ut.matchesFromHostnames(filteringModeDetails.none),
        ...ut.matchesFromHostnames(filteringModeDetails.network),
    ];
    const permissionGrantedHostnames = [
        ...filteringModeDetails.extendedSpecific,
        ...filteringModeDetails.extendedGeneric,
    ];

    for ( const rulesetId of rulesetsDetails.map(v => v.id) ) {
        const scriptletList = scriptletDetails.get(rulesetId);
        if ( scriptletList === undefined ) { continue; }

        for ( const [ token, scriptletHostnames ] of scriptletList ) {
            const id = `${rulesetId}.${token}`;
            const registered = before.get(id);

            const matches = [];
            const excludeMatches = [];
            if ( hasBroadHostPermission ) {
                excludeMatches.push(...permissionRevokedMatches);
                matches.push(...ut.matchesFromHostnames(scriptletHostnames));
            } else if ( permissionGrantedHostnames.length !== 0 ) {
                matches.push(
                    ...ut.matchesFromHostnames(
                        ut.intersectHostnameIters(
                            permissionGrantedHostnames,
                            scriptletHostnames
                        )
                    )
                );
            }
            if ( matches.length === 0 ) { continue; }

            before.delete(id); // Important!

            // register
            if ( registered === undefined ) {
                context.toAdd.push({
                    id,
                    js: [ `/rulesets/scripting/scriptlet/${id}.js` ],
                    allFrames: true,
                    matches,
                    excludeMatches,
                    runAt: 'document_start',
                    world: 'MAIN',
                });
                continue;
            }

            // update
            const directive = { id };
            if ( arrayEq(registered.matches, matches) === false ) {
                directive.matches = matches;
            }
            if ( arrayEq(registered.excludeMatches, excludeMatches) === false ) {
                directive.excludeMatches = excludeMatches;
            }
            if ( directive.matches || directive.excludeMatches ) {
                context.toUpdate.push(directive);
            }
        }
    }
}

/******************************************************************************/

function registerScriptletEntity(context) {
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1736575
    //   `MAIN` world not yet supported in Firefox
    if ( isGecko ) { return; }

    const { before, filteringModeDetails, rulesetsDetails } = context;

    const js = [];
    for ( const details of rulesetsDetails ) {
        const { scriptlets }  = details;
        if ( scriptlets instanceof Object === false ) { continue; }
        if ( Array.isArray(scriptlets.entityBasedTokens) === false ) { continue; }
        if ( scriptlets.entityBasedTokens.length === 0 ) { continue; }
        for ( const token of scriptlets.entityBasedTokens ) {
            js.push(`/rulesets/scripting/scriptlet-entity/${details.id}.${token}.js`);
        }
    }

    if ( js.length === 0 ) { return; }

    const matches = [];
    const excludeMatches = [];
    if ( filteringModeDetails.extendedGeneric.has('all-urls') ) {
        excludeMatches.push(...ut.matchesFromHostnames(filteringModeDetails.none));
        excludeMatches.push(...ut.matchesFromHostnames(filteringModeDetails.network));
        excludeMatches.push(...ut.matchesFromHostnames(filteringModeDetails.extendedSpecific));
        matches.push('<all_urls>');
    } else {
        matches.push(
            ...ut.matchesFromHostnames(filteringModeDetails.extendedGeneric)
        );
    }

    if ( matches.length === 0 ) { return; }

    const registered = before.get('scriptlet.entity');
    before.delete('scriptlet.entity'); // Important!

    // register
    if ( registered === undefined ) {
        context.toAdd.push({
            id: 'scriptlet.entity',
            js,
            allFrames: true,
            matches,
            excludeMatches,
            runAt: 'document_start',
            world: 'MAIN',
        });
        return;
    }

    // update
    const directive = { id: 'scriptlet.entity' };
    if ( arrayEq(registered.js, js, false) === false ) {
        directive.js = js;
    }
    if ( arrayEq(registered.matches, matches) === false ) {
        directive.matches = matches;
    }
    if ( arrayEq(registered.excludeMatches, excludeMatches) === false ) {
        directive.excludeMatches = excludeMatches;
    }
    if ( directive.js || directive.matches || directive.excludeMatches ) {
        context.toUpdate.push(directive);
    }
}

/******************************************************************************/

function registerSpecific(context, specificDetails) {
    const { filteringModeDetails } = context;

    let toRegisterMap;
    if (
        filteringModeDetails.extendedSpecific.has('all-urls') ||
        filteringModeDetails.extendedGeneric.has('all-urls')
    ) {
        toRegisterMap = registerSpecificAll(context, specificDetails);
    } else {
        toRegisterMap = registerSpecificSome(context, specificDetails);
    }

    for ( const [ fname, hostnames ] of toRegisterMap ) {
        toRegisterableScript(context, fname, hostnames);
    }
}

function registerSpecificSome(context, specificDetails) {
    const { filteringModeDetails, rulesetsDetails } = context;
    const toRegisterMap = new Map();

    const targetHostnames = [
        ...filteringModeDetails.extendedSpecific,
        ...filteringModeDetails.extendedGeneric,
    ];

    const checkMatches = (hostnamesToFidsMap, hn) => {
        let fids = hostnamesToFidsMap.get(hn);
        if ( fids === undefined ) { return; }
        if ( typeof fids === 'number' ) { fids = [ fids ]; }
        for ( const fid of fids ) {
            const fname = ut.fnameFromFileId(fid);
            let existing = toRegisterMap.get(fname);
            if ( existing ) {
                if ( existing[0] === '*' ) { continue; }
                existing.push(hn);
            } else {
                toRegisterMap.set(fname, existing = [ hn ]);
            }
            if ( hn !== '*' ) { continue; }
            existing.length = 0;
            existing.push('*');
            break;
        }
    };

    for ( const rulesetDetails of rulesetsDetails ) {
        const hostnamesToFidsMap = specificDetails.get(rulesetDetails.id);
        if ( hostnamesToFidsMap === undefined ) { continue; }
        for ( let hn of targetHostnames ) {
            while ( hn ) {
                checkMatches(hostnamesToFidsMap, hn);
                hn = ut.toBroaderHostname(hn);
            }
        }
    }

    return toRegisterMap;
}

function registerSpecificAll(context, specificDetails) {
    const { filteringModeDetails, rulesetsDetails } = context;
    const toRegisterMap = new Map();

    const excludeSet = new Set([
        ...filteringModeDetails.network,
        ...filteringModeDetails.none,
    ]);

    for ( const rulesetDetails of rulesetsDetails ) {
        const hostnamesToFidsMap = specificDetails.get(rulesetDetails.id);
        if ( hostnamesToFidsMap === undefined ) { continue; }
        for ( let [ hn, fids ] of hostnamesToFidsMap ) {
            if ( excludeSet.has(hn) ) { continue; }
            if ( ut.isDescendantHostnameOfIter(hn, excludeSet) ) { continue; }
            if ( typeof fids === 'number' ) { fids = [ fids ]; }
            for ( const fid of fids ) {
                const fname = ut.fnameFromFileId(fid);
                let existing = toRegisterMap.get(fname);
                if ( existing ) {
                    if ( existing[0] === '*' ) { continue; }
                    existing.push(hn);
                } else {
                    toRegisterMap.set(fname, existing = [ hn ]);
                }
                if ( hn !== '*' ) { continue; }
                existing.length = 0;
                existing.push('*');
                break;
            }
        }
    }

    return toRegisterMap;
}

const toRegisterableScript = (context, fname, hostnames) => {
    if ( context.before.has(fname) ) {
        return toUpdatableScript(context, fname, hostnames);
    }
    const matches = hostnames
        ? ut.matchesFromHostnames(hostnames)
        : [ '<all_urls>' ];
    const excludeMatches = matches.length === 1 && matches[0] === '<all_urls>'
        ? ut.matchesFromHostnames(context.filteringModeDetails.none)
        : [];
    const directive = {
        id: fname,
        allFrames: true,
        matches,
        excludeMatches,
        js: [ `/rulesets/scripting/specific/${fname.slice(-1)}/${fname.slice(0,-1)}.js` ],
        runAt: 'document_start',
    };
    context.toAdd.push(directive);
};

const toUpdatableScript = (context, fname, hostnames) => {
    const registered = context.before.get(fname);
    context.before.delete(fname); // Important!
    const directive = { id: fname };
    const matches = hostnames
        ? ut.matchesFromHostnames(hostnames)
        : [ '<all_urls>' ];
    if ( arrayEq(registered.matches, matches) === false ) {
        directive.matches = matches;
    }
    const excludeMatches = matches.length === 1 && matches[0] === '<all_urls>'
        ? ut.matchesFromHostnames(context.filteringModeDetails.none)
        : [];
    if ( arrayEq(registered.excludeMatches, excludeMatches) === false ) {
        directive.excludeMatches = excludeMatches;
    }
    if ( directive.matches || directive.excludeMatches ) {
        context.toUpdate.push(directive);
    }
};

/******************************************************************************/

function registerSpecificEntity(context) {
    const { before, filteringModeDetails, rulesetsDetails } = context;

    const js = [];
    for ( const details of rulesetsDetails ) {
        if ( details.css.specific instanceof Object === false ) { continue; }
        if ( details.css.specific.entityBased === 0 ) { continue; }
        js.push(`/rulesets/scripting/specific-entity/${details.id}.js`);
    }

    if ( js.length === 0 ) { return; }

    const matches = [];
    const excludeMatches = [];
    if ( filteringModeDetails.extendedGeneric.has('all-urls') ) {
        excludeMatches.push(...ut.matchesFromHostnames(filteringModeDetails.none));
        excludeMatches.push(...ut.matchesFromHostnames(filteringModeDetails.network));
        excludeMatches.push(...ut.matchesFromHostnames(filteringModeDetails.extendedSpecific));
        matches.push('<all_urls>');
    } else {
        matches.push(
            ...ut.matchesFromHostnames(filteringModeDetails.extendedGeneric)
        );
    }

    if ( matches.length === 0 ) { return; }

    js.push('/js/scripting/css-specific.entity.js');

    const registered = before.get('css-specific.entity');
    before.delete('css-specific.entity'); // Important!

    // register
    if ( registered === undefined ) {
        context.toAdd.push({
            id: 'css-specific.entity',
            js,
            allFrames: true,
            matches,
            excludeMatches,
            runAt: 'document_start',
        });
        return;
    }

    // update
    const directive = { id: 'css-specific.entity' };
    if ( arrayEq(registered.js, js, false) === false ) {
        directive.js = js;
    }
    if ( arrayEq(registered.matches, matches) === false ) {
        directive.matches = matches;
    }
    if ( arrayEq(registered.excludeMatches, excludeMatches) === false ) {
        directive.excludeMatches = excludeMatches;
    }
    if ( directive.js || directive.matches || directive.excludeMatches ) {
        context.toUpdate.push(directive);
    }
}

/******************************************************************************/

async function registerInjectables(origins) {
    void origins;

    if ( browser.scripting === undefined ) { return false; }

    const [
        filteringModeDetails,
        rulesetsDetails,
        declarativeDetails,
        proceduralDetails,
        scriptletDetails,
        specificDetails,
        genericDetails,
        registered,
    ] = await Promise.all([
        getFilteringModeDetails(),
        getEnabledRulesetsDetails(),
        getDeclarativeDetails(),
        getProceduralDetails(),
        getScriptletDetails(),
        getSpecificDetails(),
        getGenericDetails(),
        browser.scripting.getRegisteredContentScripts(),
    ]);
    const before = new Map(
        normalizeRegisteredContentScripts(registered).map(
            entry => [ entry.id, entry ]
        )
    );
    const toAdd = [], toUpdate = [], toRemove = [];
    const promises = [];
    const context = {
        filteringModeDetails,
        rulesetsDetails,
        before,
        toAdd,
        toUpdate,
        toRemove,
    };

    registerDeclarative(context, declarativeDetails);
    registerProcedural(context, proceduralDetails);
    registerScriptlet(context, scriptletDetails);
    registerScriptletEntity(context);
    registerSpecific(context, specificDetails);
    registerSpecificEntity(context);
    registerGeneric(context, genericDetails);

    toRemove.push(...Array.from(before.keys()));

    if ( toRemove.length !== 0 ) {
        console.info(`Unregistered ${toRemove} content (css/js)`);
        promises.push(
            browser.scripting.unregisterContentScripts({ ids: toRemove })
                .catch(reason => { console.info(reason); })
        );
    }
    if ( toAdd.length !== 0 ) {
        console.info(`Registered ${toAdd.map(v => v.id)} content (css/js)`);
        promises.push(
            browser.scripting.registerContentScripts(toAdd)
                .catch(reason => { console.info(reason); })
        );
    }
    if ( toUpdate.length !== 0 ) {
        console.info(`Updated ${toUpdate.map(v => v.id)} content (css/js)`);
        promises.push(
            browser.scripting.updateContentScripts(toUpdate)
                .catch(reason => { console.info(reason); })
        );
    }
    if ( promises.length === 0 ) { return; }

    return Promise.all(promises);
}

/******************************************************************************/

export {
    registerInjectables
};

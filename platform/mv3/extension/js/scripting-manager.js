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

import { browser, dnr } from './ext.js';
import { fetchJSON } from './fetch.js';
import { matchesTrustedSiteDirective } from './trusted-sites.js';

import {
    parsedURLromOrigin,
    toBroaderHostname,
    fidFromFileName,
    fnameFromFileId,
} from './utils.js';

/******************************************************************************/

let scriptingDetailsPromise;

function getScriptingDetails() {
    if ( scriptingDetailsPromise !== undefined ) {
        return scriptingDetailsPromise;
    }
    scriptingDetailsPromise = fetchJSON('/rulesets/scripting-details').then(entries => {
        const out = new Map(entries);
        for ( const details of out.values() ) {
            details.matches = new Map(details.matches);
            details.excludeMatches = new Map(details.excludeMatches);
        }
        return out;
    });
    return scriptingDetailsPromise;
}

/******************************************************************************/

const matchesFromHostnames = hostnames => {
    const out = [];
    for ( const hn of hostnames ) {
        if ( hn === '*' ) {
            out.push('*://*/*');
        } else {
            out.push(`*://*.${hn}/*`);
        }
    }
    return out;
};

const hostnamesFromMatches = origins => {
    const out = [];
    for ( const origin of origins ) {
        const match = /^\*:\/\/([^\/]+)\/\*/.exec(origin);
        if ( match === null ) { continue; }
        out.push(match[1]);
    }
    return out;
};

const arrayEq = (a, b) => {
    if ( a === undefined ) { return b === undefined; }
    if ( b === undefined ) { return false; }
    if ( a.length !== b.length ) { return false; }
    for ( const i of a ) {
        if ( b.includes(i) === false ) { return false; }
    }
    return true;
};

/******************************************************************************/

const toRegisterable = (fname, entry) => {
    const directive = {
        id: fname,
        allFrames: true,
    };
    if ( entry.matches ) {
        directive.matches = matchesFromHostnames(entry.matches);
    } else {
        directive.matches = [ '*://*/*' ];
    }
    if ( entry.excludeMatches ) {
        directive.excludeMatches = matchesFromHostnames(entry.excludeMatches);
    }
    directive.js = [ `/rulesets/js/${fname.slice(0,2)}/${fname.slice(2)}.js` ];
    directive.runAt = 'document_start';
    if ( (fidFromFileName(fname) & MAIN_WORLD_BIT) !== 0 ) {
        directive.world = 'MAIN';
    }
    return directive;
};

const MAIN_WORLD_BIT = 0b1;

/******************************************************************************/

const shouldUpdate = (registered, candidate) => {
    const matches = candidate.matches &&
        matchesFromHostnames(candidate.matches);
    if ( arrayEq(registered.matches, matches) === false ) {
        return true;
    }
    const excludeMatches = candidate.excludeMatches &&
        matchesFromHostnames(candidate.excludeMatches);
    if ( arrayEq(registered.excludeMatches, excludeMatches) === false ) {
        return true;
    }
    return false;
};

/******************************************************************************/

async function getInjectableCount(origin) {
    const url = parsedURLromOrigin(origin);
    if ( url === undefined ) { return 0; }

    const [
        rulesetIds,
        scriptingDetails,
    ] = await Promise.all([
        dnr.getEnabledRulesets(),
        getScriptingDetails(),
    ]);

    let total = 0;

    for ( const rulesetId of rulesetIds ) {
        if ( scriptingDetails.has(rulesetId) === false ) { continue; }
        const details = scriptingDetails.get(rulesetId);
        let hn = url.hostname;
        while ( hn !== '' ) {
            const fids = details.matches?.get(hn);
            if ( typeof fids === 'number' ) {
                total += 1;
            } else if ( Array.isArray(fids) ) {
                total += fids.length;
            }
            hn = toBroaderHostname(hn);
        }
    }

    return total;
}

/******************************************************************************/

async function registerInjectable() {

    const [
        hostnames,
        rulesetIds,
        registered,
        scriptingDetails,
    ] = await Promise.all([
        browser.permissions.getAll(),
        dnr.getEnabledRulesets(),
        browser.scripting.getRegisteredContentScripts(),
        getScriptingDetails(),
    ]).then(results => {
        results[0] = new Map(
            hostnamesFromMatches(results[0].origins).map(hn => [ hn, false ])
        );
        return results;
    });

    if ( hostnames.has('*') && hostnames.size > 1 ) {
        hostnames.clear();
        hostnames.set('*', false);
    }

    await Promise.all(
        Array.from(hostnames.keys()).map(
            hn => matchesTrustedSiteDirective({ hostname: hn })
                .then(trusted => hostnames.set(hn, trusted))
        )
    );

    const toRegister = new Map();

    const checkMatches = (details, hn) => {
        let fids = details.matches?.get(hn);
        if ( fids === undefined ) { return; }
        if ( typeof fids === 'number' ) { fids = [ fids ]; }
        for ( const fid of fids ) {
            const fname = fnameFromFileId(fid);
            const existing = toRegister.get(fname);
            if ( existing ) {
                existing.matches.push(hn);
            } else {
                toRegister.set(fname, { matches: [ hn ] });
            }
        }
    };

    for ( const rulesetId of rulesetIds ) {
        const details = scriptingDetails.get(rulesetId);
        if ( details === undefined ) { continue; }
        for ( let [ hn, trusted ] of hostnames ) {
            if ( trusted ) { continue; }
            while ( hn !== '' ) {
                checkMatches(details, hn);
                hn = toBroaderHostname(hn);
            }
        }
    }

    const checkExcludeMatches = (details, hn) => {
        let fids = details.excludeMatches?.get(hn);
        if ( fids === undefined ) { return; }
        if ( typeof fids === 'number' ) { fids = [ fids ]; }
        for ( const fid of fids ) {
            const fname = fnameFromFileId(fid);
            const existing = toRegister.get(fname);
            if ( existing === undefined ) { continue; }
            if ( existing.excludeMatches ) {
                existing.excludeMatches.push(hn);
            } else {
                toRegister.set(fname, { excludeMatches: [ hn ] });
            }
        }
    };

    for ( const rulesetId of rulesetIds ) {
        const details = scriptingDetails.get(rulesetId);
        if ( details === undefined ) { continue; }
        for ( let hn of hostnames.keys() ) {
            while ( hn !== '' ) {
                checkExcludeMatches(details, hn);
                hn = toBroaderHostname(hn);
            }
        }
    }

    const before = new Map(registered.map(entry => [ entry.id, entry ]));

    const toAdd = [];
    const toUpdate = [];
    for ( const [ fname, entry ] of toRegister ) {
        if ( before.has(fname) === false ) {
            toAdd.push(toRegisterable(fname, entry));
            continue;
        }
        if ( shouldUpdate(before.get(fname), entry) ) {
            toUpdate.push(toRegisterable(fname, entry));
        }
    }

    const toRemove = [];
    for ( const fname of before.keys() ) {
        if ( toRegister.has(fname) ) { continue; }
        toRemove.push(fname);
    }

    const todo = [];
    if ( toRemove.length !== 0 ) {
        todo.push(browser.scripting.unregisterContentScripts({ ids: toRemove }));
        console.info(`Unregistered ${toRemove} content (css/js)`);
    }
    if ( toAdd.length !== 0 ) {
        todo.push(browser.scripting.registerContentScripts(toAdd));
        console.info(`Registered ${toAdd.map(v => v.id)} content (css/js)`);
    }
    if ( toUpdate.length !== 0 ) {
        todo.push(browser.scripting.updateContentScripts(toUpdate));
        console.info(`Updated ${toUpdate.map(v => v.id)} content (css/js)`);
    }
    if ( todo.length === 0 ) { return; }

    return Promise.all(todo);
}

/******************************************************************************/

export {
    getInjectableCount,
    registerInjectable
};

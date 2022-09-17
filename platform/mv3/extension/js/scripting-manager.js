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
import { parsedURLromOrigin } from './utils.js';

/******************************************************************************/

const CSS_TYPE = 0;
const JS_TYPE = 1;

/******************************************************************************/

let cssDetailsPromise;
let scriptletDetailsPromise;

function getCSSDetails() {
    if ( cssDetailsPromise !== undefined ) {
        return cssDetailsPromise;
    }
    cssDetailsPromise = fetchJSON('/content-css/css-specific').then(rules => {
        return new Map(rules);
    });
    return cssDetailsPromise;
}

function getScriptletDetails() {
    if ( scriptletDetailsPromise !== undefined ) {
        return scriptletDetailsPromise;
    }
    scriptletDetailsPromise = fetchJSON('/content-js/scriptlet-details').then(rules => {
        return new Map(rules);
    });
    return scriptletDetailsPromise;
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
    if ( entry.y ) {
        directive.matches = matchesFromHostnames(entry.y);
    } else {
        directive.matches = [ '*://*/*' ];
    }
    if ( entry.n ) {
        directive.excludeMatches = matchesFromHostnames(entry.n);
    }
    if ( entry.type === CSS_TYPE ) {
        directive.css = [
            `/content-css/${fname.slice(0,1)}/${fname.slice(1,2)}/${fname.slice(2,8)}.css`
        ];
    } else if ( entry.type === JS_TYPE ) {
        directive.js = [
            `/content-js/${fname.slice(0,1)}/${fname.slice(1,8)}.js`
        ];
        directive.runAt = 'document_start';
        directive.world = 'MAIN';
    }

    return directive;
};

const toMaybeUpdatable = (registered, candidate) => {
    const matches = candidate.y && matchesFromHostnames(candidate.y);
    if ( arrayEq(registered.matches, matches) === false ) {
        return toRegisterable(candidate);
    }
    const excludeMatches = candidate.n && matchesFromHostnames(candidate.n);
    if ( arrayEq(registered.excludeMatches, excludeMatches) === false ) {
        return toRegisterable(candidate);
    }
};

/******************************************************************************/

const shouldRegister = (origins, matches) => {
    if ( Array.isArray(matches) === false ) { return true; }
    for ( const origin of origins ) {
        if ( origin === '*' ) { return true; }
        let hn = origin;
        for (;;) {
            if ( matches.includes(hn) ) { return true; }
            if ( hn === '*' ) { break; }
            const pos = hn.indexOf('.');
            hn = pos !== -1
                ? hn.slice(pos+1)
                : '*';
        }
    }
    return false;
};

/******************************************************************************/

async function getInjectableCount(origin) {
    const url = parsedURLromOrigin(origin);
    if ( url === undefined ) { return 0; }

    const [
        rulesetIds,
        cssDetails,
        scriptletDetails,
    ] = await Promise.all([
        dnr.getEnabledRulesets(),
        getCSSDetails(),
        getScriptletDetails(),
    ]);

    let total = 0;

    for ( const rulesetId of rulesetIds ) {
        if ( cssDetails.has(rulesetId) ) {
            const entries = cssDetails.get(rulesetId);
            for ( const entry of entries ) {
                if ( shouldRegister([ url.hostname ], entry[1].y) ) {
                    total += 1;
                }
            }
        }
        if ( scriptletDetails.has(rulesetId) ) {
            const entries = cssDetails.get(rulesetId);
            for ( const entry of entries ) {
                if ( shouldRegister([ url.hostname ], entry[1].y) ) {
                    total += 1;
                }
            }
        }
    }

    return total;
}

/******************************************************************************/

async function registerInjectable() {

    const [
        origins,
        rulesetIds,
        registered,
        cssDetails,
        scriptletDetails,
    ] = await Promise.all([
        browser.permissions.getAll(),
        dnr.getEnabledRulesets(),
        browser.scripting.getRegisteredContentScripts(),
        getCSSDetails(),
        getScriptletDetails(),
    ]).then(results => {
        results[0] = new Set(hostnamesFromMatches(results[0].origins));
        return results;
    });

    if ( origins.has('*') && origins.size > 1 ) {
        origins.clear();
        origins.add('*');
    }

    const mergeEntries = (a, b) => {
        if ( b.y !== undefined ) {
            if ( a.y === undefined ) {
                a.y = new Set(b.y);
            } else {
                b.y.forEach(v => a.y.add(v));
            }
        }
        if ( b.n !== undefined ) {
            if ( a.n === undefined ) {
                a.n = new Set(b.n);
            } else {
                b.n.forEach(v => a.n.add(v));
            }
        }
        return a;
    };

    const toRegister = new Map();

    for ( const rulesetId of rulesetIds ) {
        if ( cssDetails.has(rulesetId) ) {
            for ( const [ fname, entry ] of cssDetails.get(rulesetId) ) {
                if ( shouldRegister(origins, entry.y) === false ) { continue; }
                let existing = toRegister.get(fname);
                if ( existing === undefined ) {
                    existing = { type: CSS_TYPE };
                    toRegister.set(fname, existing);
                }
                mergeEntries(existing, entry);
            }
        }
        if ( scriptletDetails.has(rulesetId) ) {
            for ( const [ fname, entry ] of scriptletDetails.get(rulesetId) ) {
                if ( shouldRegister(origins, entry.y) === false ) { continue; }
                let existing = toRegister.get(fname);
                if ( existing === undefined ) {
                    existing = { type: JS_TYPE };
                    toRegister.set(fname, existing);
                }
                mergeEntries(existing, entry);
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
        const updated = toMaybeUpdatable(before.get(fname), entry);
        if ( updated !== undefined ) {
            toUpdate.push(updated);
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

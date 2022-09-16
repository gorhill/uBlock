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

/******************************************************************************/

const toRegisterable = (fname, entry) => {
    const directive = {
        id: fname,
        allFrames: true,
    };
    if ( entry.matches ) {
        directive.matches = matchesFromHostnames(entry.y);
    } else {
        directive.matches = [ '*://*/*' ];
    }
    if ( entry.excludeMatches ) {
        directive.excludeMatches = matchesFromHostnames(entry.n);
    }
    if ( entry.type === CSS_TYPE ) {
        directive.css = [
            `/content-css/${entry.id}/${fname.slice(0,1)}/${fname.slice(1,8)}.css`
        ];
    } else if ( entry.type === JS_TYPE ) {
        directive.js = [
            `/content-js/${entry.id}/${fname.slice(0,1)}/${fname.slice(1,8)}.js`
        ];
        directive.runAt = 'document_start';
        directive.world = 'MAIN';
    }

    return directive;
};

/******************************************************************************/

const shouldRegister = (origins, matches) => {
    for ( const origin of origins ) {
        if ( origin === '*' || Array.isArray(matches) === false ) {
            return true;
        }
        let hn = origin;
        for (;;) {
            if ( matches.includes(hn) ) {
                return true;
            }
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

async function getInjectableCount(hostname) {

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
            for ( const entry of cssDetails ) {
                if ( shouldRegister([ hostname ], entry[1].y) === true ) {
                    total += 1;
                }
            }
        }
        
        if ( scriptletDetails.has(rulesetId) ) {
            for ( const entry of cssDetails ) {
                if ( shouldRegister([ hostname ], entry[1].y) === true ) {
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

    const toRegister = new Map();

    for ( const rulesetId of rulesetIds ) {
        if ( cssDetails.has(rulesetId) ) {
            for ( const [ fname, entry ] of cssDetails.get(rulesetId) ) {
                entry.id = rulesetId;
                entry.type = CSS_TYPE;
                if ( shouldRegister(origins, entry.y) !== true ) { continue; }
                toRegister.set(fname, entry);
            }
        }
        if ( scriptletDetails.has(rulesetId) ) {
            for ( const [ fname, entry ] of scriptletDetails.get(rulesetId) ) {
                entry.id = rulesetId;
                entry.type = JS_TYPE;
                if ( shouldRegister(origins, entry.y) !== true ) { continue; }
                toRegister.set(fname, entry);
            }
        }
    }

    const before = new Set(registered.map(entry => entry.id));
    const toAdd = [];
    for ( const [ fname, entry ] of toRegister ) {
        if ( before.has(fname) ) { continue; }
        toAdd.push(toRegisterable(fname, entry));
    }
    const toRemove = [];
    for ( const fname of before ) {
        if ( toRegister.has(fname) ) { continue; }
        toRemove.push(fname);
    }

    const todo = [];
    if ( toRemove.length !== 0 ) {
        todo.push(browser.scripting.unregisterContentScripts(toRemove));
        console.info(`Unregistered ${toRemove.length} content (css/js)`);
    }
    if ( toAdd.length !== 0 ) {
        todo.push(browser.scripting.registerContentScripts(toAdd));
        console.info(`Registered ${toAdd.length} content (css/js)`);
    }
    if ( todo.length === 0 ) { return; }

    return Promise.all(todo);
}

/******************************************************************************/

export {
    getInjectableCount,
    registerInjectable
};

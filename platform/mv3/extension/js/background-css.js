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

const toRegisterable = entry => {
    const directive = {
        id: entry.css,
        allFrames: true,
        css: [
            `/content-css/${entry.rulesetId}/${entry.css.slice(0,1)}/${entry.css.slice(1,8)}.css`
        ],
    };
    if ( entry.matches ) {
        directive.matches = matchesFromHostnames(entry.matches);
    } else {
        directive.matches = [ '*://*/*' ];
    }
    if ( entry.excludeMatches ) {
        directive.excludeMatches = matchesFromHostnames(entry.excludeMatches);
    }
    return directive;
};

/******************************************************************************/

async function registerCSS() {

    const [
        origins,
        rulesetIds,
        registered,
        cssDetails,
    ] = await Promise.all([
        browser.permissions.getAll(),
        dnr.getEnabledRulesets(),
        browser.scripting.getRegisteredContentScripts(),
        fetchJSON('/content-css/css-specific'),
    ]).then(results => {
        results[0] = new Set(hostnamesFromMatches(results[0].origins));
        results[3] = new Map(results[3]);
        return results;
    });

    if ( origins.has('*') && origins.size > 1 ) {
        origins.clear();
        origins.add('*');
    }

    const toRegister = new Map();
    for ( const rulesetId of rulesetIds ) {
        const cssEntries = cssDetails.get(rulesetId);
        if ( cssEntries === undefined ) { continue; }
        for ( const entry of cssEntries ) {
            entry.rulesetId = rulesetId;
            for ( const origin of origins ) {
                if ( origin === '*' || Array.isArray(entry.matches) === false ) {
                    toRegister.set(entry.css, entry);
                    continue;
                }
                let hn = origin;
                for (;;) {
                    if ( entry.matches.includes(hn) ) {
                        toRegister.set(entry.css, entry);
                        break;
                    }
                    if ( hn === '*' ) { break; }
                    const pos = hn.indexOf('.');
                    hn = pos !== -1
                        ? hn.slice(pos+1)
                        : '*';
                }
            }
        }
    }

    const before = new Set(registered.map(entry => entry.id));
    const toAdd = [];
    for ( const [ id, entry ] of toRegister ) {
        if ( before.has(id) ) { continue; }
        toAdd.push(toRegisterable(entry));
    }
    const toRemove = [];
    for ( const id of before ) {
        if ( toRegister.has(id) ) { continue; }
        toRemove.push(id);
    }

    const todo = [];
    if ( toRemove.length !== 0 ) {
        todo.push(browser.scripting.unregisterContentScripts(toRemove));
        console.info(`Unregistered ${toRemove.length} CSS content scripts`);
    }
    if ( toAdd.length !== 0 ) {
        todo.push(browser.scripting.registerContentScripts(toAdd));
        console.info(`Registered ${toAdd.length} CSS content scripts`);
    }
    if ( todo.length === 0 ) { return; }

    return Promise.all(todo);
}

/******************************************************************************/

export { registerCSS };

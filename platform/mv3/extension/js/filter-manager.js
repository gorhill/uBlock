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

import {
    intersectHostnameIters,
    matchesFromHostnames,
    strArrayEq,
    subtractHostnameIters,
} from './utils.js';

import {
    localKeys,
    localRead,
    localRemove,
    localWrite,
} from './ext.js';

/******************************************************************************/

export async function selectorsFromCSSFilters(hostname) {
    const promises = [];
    let hn = hostname;
    while ( hn !== '' ) {
        promises.push(chrome.storage.local.get(`site.${hn}`));
        const pos = hn.indexOf('.');
        if ( pos === -1 ) { break; }
        hn = hn.slice(pos + 1);
    }
    const results = await Promise.all(promises);
    const selectors = [];
    for ( let i = 0; i < promises.length; i++ ) {
        const filters = results[i];
        if ( filters === undefined ) { continue; }
        filters.forEach(filter => { selectors.push(filter.slice(1)); });
    }
    return selectors;
}

/******************************************************************************/

export async function registerCSSFilters(context) {
    const storageKeys = await localKeys() || [];
    const siteKeys = storageKeys.filter(a => a.startsWith('site.'));
    if ( siteKeys.length === 0 ) { return; }

    const { none } = context.filteringModeDetails;
    let hostnames = siteKeys.map(a => a.slice(5));
    if ( none.has('all-urls') ) {
        const { basic, optimal, complete } = context.filteringModeDetails;
        hostnames = intersectHostnameIters(hostnames, [
            ...basic, ...optimal, ...complete
        ]);
    } else if ( none.size !== 0 ) {
        hostnames = [ ...subtractHostnameIters(hostnames, none) ];
    }
    if ( hostnames.length === 0 ) { return; }

    const registered = context.before.get('css-user');
    context.before.delete('css-user'); // Important!

    const directive = {
        id: 'css-user',
        js: [
            '/js/scripting/isolated-api.js',
            '/js/scripting/css-user.js',
        ],
        matches: matchesFromHostnames(hostnames),
        runAt: 'document_start',
    };

    if ( registered === undefined ) {
        context.toAdd.push(directive);
    } else if ( strArrayEq(registered.matches, directive.matches) === false ) {
        context.toRemove.push('css-user');
        context.toAdd.push(directive);
    }
}

/******************************************************************************/

export async function addCSSFilter(hostname, selector) {
    const key = `site.${hostname}`;
    const selectors = await localRead(key) || [];
    selectors.push(`0${selector}`);
    await localWrite(key, selectors);
    return true;
}

/******************************************************************************/

export async function removeCSSFilter(hostname, selector) {
    const key = `site.${hostname}`;
    const selectors = await localRead(key);
    if ( selectors === undefined ) { return false; }
    const i = selectors.indexOf(`0${selector}`);
    if ( i === -1 ) { return false; }
    selectors.splice(i, 1);
    await selectors.length !== 0
        ? localWrite(key, selectors)
        : localRemove(key);
    return true;
}

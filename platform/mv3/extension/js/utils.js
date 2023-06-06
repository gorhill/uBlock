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

/******************************************************************************/

function parsedURLromOrigin(origin) {
    try {
        return new URL(origin);
    } catch(ex) {
    }
}

/******************************************************************************/

const toBroaderHostname = hn => {
    if ( hn === '*' ) { return ''; }
    const pos = hn.indexOf('.');
    return pos !== -1 ? hn.slice(pos+1) : '*';
};

/******************************************************************************/

// Is hna descendant hostname of hnb?

const isDescendantHostname = (hna, hnb) => {
    if ( hnb === 'all-urls' ) { return true; }
    if ( hna.endsWith(hnb) === false ) { return false; }
    if ( hna === hnb ) { return false; }
    return hna.charCodeAt(hna.length - hnb.length - 1) === 0x2E /* '.' */;
};

const isDescendantHostnameOfIter = (hna, iterb) => {
    const setb = iterb instanceof Set ? iterb : new Set(iterb);
    if ( setb.has('all-urls') || setb.has('*') ) { return true; }
    let hn = hna;
    while ( hn ) {
        const pos = hn.indexOf('.');
        if ( pos === -1 ) { break; }
        hn = hn.slice(pos + 1);
        if ( setb.has(hn) ) { return true; }
    }
    return false;
};

const intersectHostnameIters = (itera, iterb) => {
    const setb = iterb instanceof Set ? iterb : new Set(iterb);
    if ( setb.has('all-urls') || setb.has('*') ) { return Array.from(itera); }
    const out = [];
    for ( const hna of itera ) {
        if ( setb.has(hna) || isDescendantHostnameOfIter(hna, setb) ) {
            out.push(hna);
        }
    }
    return out;
};

const subtractHostnameIters = (itera, iterb) => {
    const setb = iterb instanceof Set ? iterb : new Set(iterb);
    if ( setb.has('all-urls') || setb.has('*') ) { return []; }
    const out = [];
    for ( const hna of itera ) {
        if ( setb.has(hna) ) { continue; }
        if ( isDescendantHostnameOfIter(hna, setb) ) { continue; }
        out.push(hna);
    }
    return out;
};

/******************************************************************************/

const matchesFromHostnames = hostnames => {
    const out = [];
    for ( const hn of hostnames ) {
        if ( hn === '*' || hn === 'all-urls' ) {
            out.length = 0;
            out.push('<all_urls>');
            break;
        }
        out.push(`*://*.${hn}/*`);
    }
    return out;
};

const hostnamesFromMatches = origins => {
    const out = [];
    for ( const origin of origins ) {
        if ( origin === '<all_urls>' ) {
            out.push('all-urls');
            continue;
        }
        const match = /^\*:\/\/(?:\*\.)?([^\/]+)\/\*/.exec(origin);
        if ( match === null ) { continue; }
        out.push(match[1]);
    }
    return out;
};

/******************************************************************************/

const ubolLog = (...args) => {
    // Do not pollute dev console in stable release.
    if ( browser.runtime.id === 'ddkjiahejlhfcafbddmgiahcphecmpfh' ) { return; }
    console.info('[uBOL]', ...args);
};

/******************************************************************************/

export {
    parsedURLromOrigin,
    toBroaderHostname,
    isDescendantHostname,
    isDescendantHostnameOfIter,
    intersectHostnameIters,
    subtractHostnameIters,
    matchesFromHostnames,
    hostnamesFromMatches,
    ubolLog,
};

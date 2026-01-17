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

/******************************************************************************/

function parsedURLromOrigin(origin) {
    try {
        return new URL(origin);
    } catch {
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

/**
 * Returns whether a hostname is part of a collection, or is descendant of an
 * item in the collection.
 * @param hna - the hostname representing the needle.
 * @param iterb - an iterable representing the haystack of hostnames.
 */

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

/**
 * Returns all hostnames in the first collection which are equal or descendant
 * of hostnames in the second collection.
 * @param itera - an iterable which hostnames must be filtered out.
 * @param iterb - an iterable which hostnames must be matched.
 */

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

export const matchFromHostname = hn =>
    hn === '*' || hn === 'all-urls' ? '<all_urls>' : `*://*.${hn}/*`;

export const matchesFromHostnames = hostnames => {
    const out = [];
    for ( const hn of hostnames ) {
        out.push(matchFromHostname(hn));
    }
    return out;
};

export const hostnameFromMatch = origin => {
    if ( origin === '<all_urls>' || origin === '*://*/*' ) { return 'all-urls'; }
    const match = /^[^:]+:\/\/(?:\*\.)?([^/]+)\/\*/.exec(origin);
    if ( match === null ) { return ''; }
    return match[1];
};

export const hostnamesFromMatches = origins => {
    const out = [];
    for ( const origin of origins ) {
        const hn = hostnameFromMatch(origin);
        if ( hn === '' ) { continue; }
        out.push(hn);
    }
    return out;
};

/******************************************************************************/

export const deepEquals = (a, b) => {
    switch ( typeof a ) {
    case 'undefined':
    case 'boolean':
    case 'number':
    case 'string':
        return a === b;
    }
    // case 'object':
    if ( typeof b !== 'object' ) { return false; }
    if ( a === null || b === null ) { return a === b; }
    if ( Array.isArray(a) || Array.isArray(b) ) {
        if ( Array.isArray(a) === false || Array.isArray(b) === false ) { return false; }
        if ( a.length !== b.length ) { return false; }
        for ( let i = 0; i < a.length; i++ ) {
            if ( deepEquals(a[i], b[i]) === false ) { return false; }
        }
        return true;
    }
    const akeys = Object.keys(a);
    const bkeys = Object.keys(b);
    if ( akeys.length !== bkeys.length ) { return false; }
    for ( const k of akeys ) {
        if ( deepEquals(a[k], b[k]) === false ) { return false; }
    }
    return true;
};

/******************************************************************************/

const broadcastMessage = message => {
    const bc = new self.BroadcastChannel('uBOL');
    bc.postMessage(message);
};

/******************************************************************************/

// Important: We need to sort the arrays for fast comparison
const strArrayEq = (a = [], b = [], sort = true) => {
    const alen = a.length;
    if ( alen !== b.length ) { return false; }
    if ( sort ) { a.sort(); b.sort(); }
    for ( let i = 0; i < alen; i++ ) {
        if ( a[i] !== b[i] ) { return false; }
    }
    return true;
};

/******************************************************************************/

// The goal is just to be able to find out whether a specific version is older
// than another one.

export function intFromVersion(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if ( match === null ) { return 0; }
    const year = parseInt(match[1], 10);
    const monthday = parseInt(match[2], 10);
    const min = parseInt(match[3], 10);
    return (year - 2022) * (1232 * 2400) + monthday * 2400 + min;
}

/******************************************************************************/

export {
    broadcastMessage,
    parsedURLromOrigin,
    toBroaderHostname,
    isDescendantHostname,
    isDescendantHostnameOfIter,
    intersectHostnameIters,
    subtractHostnameIters,
    strArrayEq,
};

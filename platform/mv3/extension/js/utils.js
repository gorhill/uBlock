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

// Is a descendant hostname of b?

const isDescendantHostname = (a, b) => {
    if ( b === 'all-urls' ) { return true; }
    if ( a.endsWith(b) === false ) { return false; }
    if ( a === b ) { return false; }
    return a.charCodeAt(a.length - b.length - 1) === 0x2E /* '.' */;
};

const isDescendantHostnameOfIter = (a, iter) => {
    for ( const b of iter ) {
        if ( isDescendantHostname(a, b) ) { return true; }
    }
    return false;
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

const fnameFromFileId = fid =>
    fid.toString(32).padStart(7, '0');

const fidFromFileName = fname =>
    parseInt(fname, 32);

/******************************************************************************/

export {
    parsedURLromOrigin,
    toBroaderHostname,
    isDescendantHostname,
    isDescendantHostnameOfIter,
    matchesFromHostnames,
    hostnamesFromMatches,
    fnameFromFileId,
    fidFromFileName,
};

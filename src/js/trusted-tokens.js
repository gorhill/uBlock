/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2026-present Raymond Hill

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

import { builtinScriptlets } from './resources/scriptlets.js';
import redirectResources from './redirect-resources.js';

/******************************************************************************/

const addTrustedToken = (out, ...tokens) => {
    for ( const token of tokens ) {
        out.add(token);
        if ( token.endsWith('.js') === false ) { continue; }
        out.add(token.slice(0, -3));
    }
};

let trustedTokens;

/******************************************************************************/

export function getTrustedTokens() {
    if ( trustedTokens ) { return trustedTokens; }
    const out = new Set();
    for ( const { name, requiresTrust, aliases } of builtinScriptlets ) {
        if ( requiresTrust !== true ) { continue; }
        addTrustedToken(out, name);
        if ( Array.isArray(aliases) === false ) { continue; }
        addTrustedToken(out, ...aliases);
    }
    for ( const [ name, { requiresTrust, alias } ] of redirectResources ) {
        if ( requiresTrust !== true ) { continue; }
        addTrustedToken(out, name);
        if ( alias === undefined ) { continue; }
        if ( typeof alias === 'string' ) {
            addTrustedToken(out, alias);
        } else if ( Array.isArray(alias) ) {
            addTrustedToken(out, ...alias);
        }
    }
    trustedTokens = out;
    return out;
}

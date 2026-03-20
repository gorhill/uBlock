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

    Home: https://github.com/gorhill/uBlock/

*/

/******************************************************************************/

(( ) => {
    if ( self !== self.top ) { return; }

    const { preventPopupDetails } = self;
    if ( Array.isArray(preventPopupDetails) === false ) { return; }
    self.preventPopupDetails = undefined;

    const docloc = self.preventPopupTarget;
    const href = docloc.href;
    const targets = docloc.hostname.split('.').map((e, i, a) =>
        a.slice(i).join('.')
    );

    const hostnameSearch = (hostnames, targets) => {
        let l = 0, i = 0, d = 0;
        let r = hostnames.length;
        let candidate;
        for ( const target of targets ) {
            while ( l < r ) {
                i = l + r >>> 1;
                candidate = hostnames[i];
                d = target.length - candidate.length;
                if ( d === 0 ) {
                    if ( target === candidate ) { return i; }
                    d = target < candidate ? -1 : 1;
                }
                if ( d < 0 ) {
                    r = i;
                } else {
                    l = i + 1;
                }
            }
            l = 0;
        }
        return -1;
    };

    const regexSearch = (regexes, target) => {
        for ( let i = 0; i < regexes.length; i += 2 ) {
            const key = regexes[i+0];
            if ( target.includes(key.slice(1)) === false ) { continue; }
            const re = new RegExp(regexes[i+1], key.charAt(0).trimEnd());
            if ( re.test(target) ) { return i; }
        }
        return -1;
    }

    let shouldClose = false;
    for ( const { block } of preventPopupDetails ) {
        if ( hostnameSearch(block.hostnames, targets) === -1 ) {
            if ( regexSearch(block.regexes, href) === -1 ) { continue; }
        }
        shouldClose = true;
        break;
    }
    if ( shouldClose === false ) { return; }
    for ( const { allow } of preventPopupDetails ) {
        if ( hostnameSearch(allow.hostnames, targets) === -1 ) {
            if ( regexSearch(allow.regexes, href) === -1 ) { continue; }
        }
        shouldClose = false;
        break;
    }
    if ( shouldClose === false ) { return; }
    
    self.close();
})();

/******************************************************************************/

void 0;
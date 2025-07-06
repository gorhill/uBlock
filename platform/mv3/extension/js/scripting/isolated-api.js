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

    Home: https://github.com/gorhill/uBlock/

*/

/******************************************************************************/

(api => {
    if ( typeof api === 'object' ) { return; }

    const isolatedAPI = self.isolatedAPI = {};

    const hostnameStack = (( ) => {
        const docloc = document.location;
        const origins = [ docloc.origin ];
        if ( docloc.ancestorOrigins ) {
            origins.push(...docloc.ancestorOrigins);
        }
        return origins.map((origin, i) => {
            const beg = origin.lastIndexOf('://');
            if ( beg === -1 ) { return; }
            const hn1 = origin.slice(beg+3)
            const end = hn1.indexOf(':');
            const hn2 = end === -1 ? hn1 : hn1.slice(0, end);
            return { hnparts: hn2.split('.'), i };
        }).filter(a => a !== undefined);
    })();

    const forEachHostname = (entry, callback, details) => {
        const hnparts = entry.hnparts;
        const hnpartslen = hnparts.length;
        if ( hnpartslen === 0 ) { return; }
        for ( let i = 0; i < hnpartslen; i++ ) {
            const r = callback(`${hnparts.slice(i).join('.')}`, details);
            if ( r !== undefined ) { return r; }
        }
        if ( details?.hasEntities !== true ) { return; }
        const n = hnpartslen - 1;
        for ( let i = 0; i < n; i++ ) {
            for ( let j = n; j > i; j-- ) {
                const r = callback(`${hnparts.slice(i,j).join('.')}.*`, details);
                if ( r !== undefined ) { return r; }
            }
        }
    };

    isolatedAPI.forEachHostname = (callback, details) => {
        if ( hostnameStack.length === 0 ) { return; }
        return forEachHostname(hostnameStack[0], callback, details);
    };

    isolatedAPI.forEachHostnameAncestors = (callback, details) => {
        for ( const entry of hostnameStack ) {
            if ( entry.i === 0 ) { continue; }
            const r = forEachHostname(entry, callback, details);
            if ( r !== undefined ) { return r; }
        }
    };
})(self.isolatedAPI);

/******************************************************************************/

void 0;
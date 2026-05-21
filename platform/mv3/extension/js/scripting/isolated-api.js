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

    isolatedAPI.contexts = {
        entries: [],
        compute() {
            const docloc = document.location;
            const origins = [ docloc.origin ];
            if ( docloc.ancestorOrigins ) {
                origins.push(...docloc.ancestorOrigins);
            }
            this.entries = origins.map((origin, i) => {
                const beg = origin.indexOf('://');
                if ( beg === -1 ) { return; }
                const hn1 = origin.slice(beg+3)
                const end = hn1.indexOf(':');
                const hn2 = end === -1 ? hn1 : hn1.slice(0, end);
                const hnParts = hn2.split('.');
                if ( hn2.length === 0 ) { return; }
                const hns = [];
                for ( let i = 0; i < hnParts.length; i++ ) {
                    hns.push(`${hnParts.slice(i).join('.')}`);
                }
                return { hns, i };
            }).filter(a => a !== undefined);
        },
        get topHostname() {
            if ( this.entries.length === 0 ) { this.compute(); }
            return this.entries.at(-1).hns[0];
        },
        get hostnames() {
            if ( this.entries.length === 0 ) { this.compute(); }
            return this.entries[0].hns;
        },
        get entities() {
            if ( this.entries.length === 0 ) { this.compute(); }
            if ( this.entries[0].ens === undefined ) {
                const ens = [];
                const hnparts =  this.entries[0].hns[0].split('.');
                const n = hnparts.length - 1;
                for ( let i = 0; i < n; i++ ) {
                    for ( let j = n; j > i; j-- ) {
                        ens.push(`${hnparts.slice(i,j).join('.')}.*`);
                    }
                }
                ens.sort((a, b) => {
                    const d = b.length - a.length;
                    if ( d !== 0 ) { return d; }
                    return a > b ? -1 : 1;
                });
                this.entries[0].ens = ens;
            }
            return this.entries[0].ens;
        },
    };

    isolatedAPI.binarySearch = (haystack, needle, r) => {
        let l = 0, i = 0, d = 0, candidate;
        r = r >= 0 ? r : haystack.length;
        while ( l < r ) {
            i = l + r >>> 1;
            candidate = haystack[i];
            d = needle.length - candidate.length;
            if ( d === 0 ) {
                if ( needle === candidate ) { return i; }
                d = needle < candidate ? -1 : 1;
            }
            if ( d < 0 ) {
                r = i;
            } else {
                l = i + 1;
            }
        }
        return ~i;
    };

})(self.isolatedAPI);

/******************************************************************************/

void 0;

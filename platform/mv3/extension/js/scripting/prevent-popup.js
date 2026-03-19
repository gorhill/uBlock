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

// https://fairscrew.com/b/3CV.0nPO3qpfvUbKmxVDJCZwD/0S2AOlDNIJ2WNPDOMFz-LaT/Yc4jMljHYR0wMIzIcB

(( ) => {
    if ( self !== self.top ) { return; }

    const abort = ( ) => {
        self.close();
    };

    const docloc = document.location;
    const targets = docloc.hostname.split('.').map((e, i, a) =>
        a.slice(i).join('.')
    );

    const binarySearch = (sorted, targets) => {
        let l = 0, i = 0, d = 0;
        let r = sorted.length;
        let candidate;
        for ( const target of targets ) {
            while ( l < r ) {
                i = l + r >>> 1;
                candidate = sorted[i];
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

    while ( self.preventPopupDetails.length !== 0 ) {
        const { hostnames, regexes } = self.preventPopupDetails.pop()
        const i = binarySearch(hostnames, targets);
        if ( i !== -1 ) {
            return abort();
        }
        const url = docloc.href;
        for ( let i = 0; i < regexes.length; i += 3 ) {
            if ( url.includes(regexes[i+0]) === false ) { continue; }
            const re = new RegExp(regexes[i+1], regexes[i+2]);
            if ( re.test(url) ) { return abort(); }
        }
    };

})();

/******************************************************************************/

void 0;
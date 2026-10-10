/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2014-present Raymond Hill

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

// Important!
// Isolate from global scope

// Start of local scope
(function uBOL_scriptletFrameworkBegin($SECRET_ID$) {

/******************************************************************************/

const scriptletGlobals = self[$SECRET_ID$] = {};

if ( typeof $SCRIPTLET_GLOBALS$ !== 'undefined' && self.$SCRIPTLET_GLOBALS$ === undefined ) {
    Object.assign(scriptletGlobals, $SCRIPTLET_GLOBALS$); // eslint-disable-line
}

/******************************************************************************/

self.$scriptletFunctions$

/******************************************************************************/

scriptletGlobals.origins = (( ) => {
    const docloc = document.location;
    const origins = [ docloc.origin ];
    if ( docloc.ancestorOrigins ) {
        origins.push(...docloc.ancestorOrigins);
    }
    const out = [];
    for ( let i = 0; i < origins.length; i++ ) {
        const origin = origins[i];
        const beg = origin.indexOf('://') + 3;
        if ( beg === 2 ) { continue; }
        const end = origin.indexOf(':', beg);
        const hn = origin.slice(beg, end > 0 ? end : undefined);
        if ( hn.length === 0 ) { continue; }
        const hns = [ hn ];
        for ( let pos = 0; ; ) {
            pos = hn.indexOf('.', pos) + 1;
            if ( pos === 0 ) { break; }
            hns.push(hn.slice(pos));
        }
        hns.push('*');
        const ens = [];
        for ( let hn of hns ) {
            for (;;) {
                const pos = hn.lastIndexOf('.');
                if ( pos === -1 ) { break; }
                hn = hn.slice(0, pos);
                ens.push(`${hn}.*`);
            }
        }
        ens.sort((a, b) => {
            const d = b.length - a.length;
            if ( d !== 0 ) { return d; }
            return a > b ? -1 : 1;
        });
        out.push({ hns, ens, i });
    }
    return out;
})();

scriptletGlobals.functionRefs = self.$scriptletFunctionRefs$;

/******************************************************************************/

// End of local scope
})(self.$scriptletSecret$);

void 0;

/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2019-present Raymond Hill

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

    The scriptlets below are meant to be injected only into a
    web page context.
*/

/* jshint esversion:11 */

'use strict';

/******************************************************************************/

/// name no-addeventlistener-if
/// alias noaelif
/// alias aeld

/******************************************************************************/

// Important!
// Isolate from global scope
(function uBOL_noAddEventListenerIf() {

/******************************************************************************/

// $rulesetId$

const argsList = self.$argsList$;

const hostnamesMap = new Map(self.$hostnamesMap$);

/******************************************************************************/

const regexpFromArg = arg => {
    if ( arg === '' ) { return /^/; }
    if ( /^\/.+\/$/.test(arg) ) { return new RegExp(arg.slice(1,-1)); }
    return new RegExp(arg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
};

/******************************************************************************/

const scriptlet = (
    needle1 = '',
    needle2 = ''
) => {
    const reNeedle1 = regexpFromArg(needle1);
    const reNeedle2 = regexpFromArg(needle2);
    self.EventTarget.prototype.addEventListener = new Proxy(
        self.EventTarget.prototype.addEventListener,
        {
            apply: function(target, thisArg, args) {
                let type, handler;
                try {
                    type = String(args[0]);
                    handler = String(args[1]);
                } catch(ex) {
                }
                if (
                    reNeedle1.test(type) === false ||
                    reNeedle2.test(handler) === false
                ) {
                    return target.apply(thisArg, args);
                }
            }
        }
    );
};

/******************************************************************************/

let hn;
try { hn = document.location.hostname; } catch(ex) { }
while ( hn ) {
    if ( hostnamesMap.has(hn) ) {
        let argsIndices = hostnamesMap.get(hn);
        if ( typeof argsIndices === 'number' ) { argsIndices = [ argsIndices ]; }
        for ( const argsIndex of argsIndices ) {
            const details = argsList[argsIndex];
            if ( details.n && details.n.includes(hn) ) { continue; }
            try { scriptlet(...details.a); } catch(ex) {}
        }
    }
    if ( hn === '*' ) { break; }
    const pos = hn.indexOf('.');
    if ( pos !== -1 ) {
        hn = hn.slice(pos + 1);
    } else {
        hn = '*';
    }
}

argsList.length = 0;
hostnamesMap.clear();

/******************************************************************************/

})();

/******************************************************************************/


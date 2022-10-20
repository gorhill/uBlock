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

/// name no-addeventlistener-if.entity
/// alias noaelif.entity
/// alias aeld.entity

/******************************************************************************/

// Important!
// Isolate from global scope
(function uBOL_noAddEventListenerIfEntity() {

/******************************************************************************/

// $rulesetId$

const argsList = self.$argsList$;

const entitiesMap = new Map(self.$entitiesMap$);

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

const hnparts = [];
try { hnparts.push(...document.location.hostname.split('.')); } catch(ex) { }
const hnpartslen = hnparts.length - 1;
for ( let i = 0; i < hnpartslen; i++ ) {
    for ( let j = hnpartslen; j > i; j-- ) {
        const hn = hnparts.slice(i).join('.');
        const en = hnparts.slice(i,j).join('.');
        let argsIndices = entitiesMap.get(en);
        if ( argsIndices === undefined ) { continue; }
        if ( typeof argsIndices === 'number' ) { argsIndices = [ argsIndices ]; }
        for ( const argsIndex of argsIndices ) {
            const details = argsList[argsIndex];
            if ( details.n && details.n.includes(hn) ) { continue; }
            try { scriptlet(...details.a); } catch(ex) {}
        }
    }
}

argsList.length = 0;
entitiesMap.clear();

/******************************************************************************/

})();

/******************************************************************************/

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

/// name abort-on-property-write.entity
/// alias aopw.entity

/******************************************************************************/

// Important!
// Isolate from global scope
(function uBOL_abortOnPropertyWriteEntity() {

/******************************************************************************/

// $rulesetId$

const argsList = self.$argsList$;

const entitiesMap = new Map(self.$entitiesMap$);

/******************************************************************************/

const magic =
    String.fromCharCode(Date.now() % 26 + 97) +
    Math.floor(Math.random() * 982451653 + 982451653).toString(36);

const abort = function() {
    throw new ReferenceError(magic);
};

const scriptlet = (
    prop = ''
) => {
    let owner = window;
    for (;;) {
        const pos = prop.indexOf('.');
        if ( pos === -1 ) { break; }
        owner = owner[prop.slice(0, pos)];
        if ( owner instanceof Object === false ) { return; }
        prop = prop.slice(pos + 1);
    }
    delete owner[prop];
    Object.defineProperty(owner, prop, {
        set: function() {
            abort();
        }
    });
    const oe = window.onerror;
    window.onerror = function(msg, src, line, col, error) {
        if ( typeof msg === 'string' && msg.includes(magic) ) {
            return true;
        }
        if ( oe instanceof Function ) {
            return oe(msg, src, line, col, error);
        }
    }.bind();
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

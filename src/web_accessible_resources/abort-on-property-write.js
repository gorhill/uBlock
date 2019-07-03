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
*/

(function() {
    'use strict';
    const magic = String.fromCharCode(Date.now() % 26 + 97) +
                  Math.floor(Math.random() * 982451653 + 982451653).toString(36);
    let prop = '{{1}}';
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
            throw new ReferenceError(magic);
        }
    });
    const oe = window.onerror;
    window.onerror = function(msg, src, line, col, error) {
        if ( typeof msg === 'string' && msg.indexOf(magic) !== -1 ) {
            return true;
        }
        if ( oe instanceof Function ) {
            return oe(msg, src, line, col, error);
        }
    }.bind();
})();

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
    const target = '{{1}}';
    if ( target === '' || target === '{{1}}' ) { return; }
    const needle = '{{2}}';
    let reText = '.?';
    if ( needle !== '' && needle !== '{{2}}' ) {
        reText = /^\/.+\/$/.test(needle)
            ? needle.slice(1,-1)
            : needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    const thisScript = document.currentScript;
    const re = new RegExp(reText);
    const chain = target.split('.');
    let owner = window;
    let prop;
    for (;;) {
        prop = chain.shift();
        if ( chain.length === 0 ) { break; }
        owner = owner[prop];
        if ( owner instanceof Object === false ) { return; }
    }
    const desc = Object.getOwnPropertyDescriptor(owner, prop);
    if ( desc && desc.get !== undefined ) { return; }
    const magic = String.fromCharCode(Date.now() % 26 + 97) +
                  Math.floor(Math.random() * 982451653 + 982451653).toString(36);
    let value = owner[prop];
    const validate = function() {
        const e = document.currentScript;
        if (
            e instanceof HTMLScriptElement &&
            e.src === '' &&
            e !== thisScript &&
            re.test(e.textContent)
        ) {
            throw new ReferenceError(magic);
        }
    };
    Object.defineProperty(owner, prop, {
        get: function() {
            validate();
            return value;
        },
        set: function(a) {
            validate();
            value = a;
        }
    });
    const oe = window.onerror;
    window.onerror = function(msg) {
        if ( typeof msg === 'string' && msg.indexOf(magic) !== -1 ) {
            return true;
        }
        if ( oe instanceof Function ) {
            return oe.apply(this, arguments);
        }
    }.bind();
})();

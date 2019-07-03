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
    const thisScript = document.currentScript;
    let cValue = '{{2}}';
    if ( cValue === 'undefined' ) {
        cValue = undefined;
    } else if ( cValue === 'false' ) {
        cValue = false;
    } else if ( cValue === 'true' ) {
        cValue = true;
    } else if ( cValue === 'null' ) {
        cValue = null;
    } else if ( cValue === 'noopFunc' ) {
        cValue = function(){};
    } else if ( cValue === 'trueFunc' ) {
        cValue = function(){ return true; };
    } else if ( cValue === 'falseFunc' ) {
        cValue = function(){ return false; };
    } else if ( /^\d+$/.test(cValue) ) {
        cValue = parseFloat(cValue);
        if ( isNaN(cValue) ) { return; }
        if ( Math.abs(cValue) > 0x7FFF ) { return; }
    } else if ( cValue === "''" ) {
        cValue = '';
    } else {
        return;
    }
    let aborted = false;
    const mustAbort = function(v) {
        if ( aborted ) { return true; }
        aborted = v !== undefined && cValue !== undefined && typeof v !== typeof cValue;
        return aborted;
    };
    const makeProxy = function(owner, chain) {
        const pos = chain.indexOf('.');
        if ( pos === -1 ) {
            const original = owner[chain];
            if ( mustAbort(original) ) { return; }
            const desc = Object.getOwnPropertyDescriptor(owner, chain);
            if ( desc === undefined || desc.get === undefined ) {
                Object.defineProperty(owner, chain, {
                    get: function() {
                        return document.currentScript === thisScript
                            ? original
                            : cValue;
                    },
                    set: function(a) {
                        if ( mustAbort(a) ) {
                            cValue = a;
                        }
                    }
                });
            }
            return;
        }
        const prop = chain.slice(0, pos);
        let v = owner[prop];
        chain = chain.slice(pos + 1); 
        if ( v !== undefined ) {
            makeProxy(v, chain);
            return;
        }
        const desc = Object.getOwnPropertyDescriptor(owner, prop);
        if ( desc && desc.set !== undefined ) { return; }
        Object.defineProperty(owner, prop, {
            get: function() {
                return v;
            },
            set: function(a) {
                v = a;
                if ( a instanceof Object ) {
                    makeProxy(a, chain);
                }
            }
        });
    };
    makeProxy(window, '{{1}}');
})();

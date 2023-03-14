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

/// name set-constant
/// alias set

/******************************************************************************/

// Important!
// Isolate from global scope
(function uBOL_setConstant() {

/******************************************************************************/

// $rulesetId$

const argsList = self.$argsList$;

const hostnamesMap = new Map(self.$hostnamesMap$);

/******************************************************************************/

const scriptlet = (
    chain = '',
    cValue = ''
) => {
    if ( chain === '' ) { return; }
    const trappedProp = (( ) => {
        const pos = chain.lastIndexOf('.');
        if ( pos === -1 ) { return chain; }
        return chain.slice(pos+1);
    })();
    if ( trappedProp === '' ) { return; }
    const objectDefineProperty = Object.defineProperty.bind(Object);
    const cloakFunc = fn => {
        objectDefineProperty(fn, 'name', { value: trappedProp });
        const proxy = new Proxy(fn, {
            defineProperty(target, prop) {
                if ( prop !== 'toString' ) {
                    return Reflect.deleteProperty(...arguments);
                }
                return true;
            },
            deleteProperty(target, prop) {
                if ( prop !== 'toString' ) {
                    return Reflect.deleteProperty(...arguments);
                }
                return true;
            },
            get(target, prop) {
                if ( prop === 'toString' ) {
                    return function() {
                        return `function ${trappedProp}() { [native code] }`;
                    }.bind(null);
                }
                return Reflect.get(...arguments);
            },
        });
        return proxy;
    };
    if ( cValue === 'undefined' ) {
        cValue = undefined;
    } else if ( cValue === 'false' ) {
        cValue = false;
    } else if ( cValue === 'true' ) {
        cValue = true;
    } else if ( cValue === 'null' ) {
        cValue = null;
    } else if ( cValue === "''" ) {
        cValue = '';
    } else if ( cValue === '[]' ) {
        cValue = [];
    } else if ( cValue === '{}' ) {
        cValue = {};
    } else if ( cValue === 'noopFunc' ) {
        cValue = cloakFunc(function(){});
    } else if ( cValue === 'trueFunc' ) {
        cValue = cloakFunc(function(){ return true; });
    } else if ( cValue === 'falseFunc' ) {
        cValue = cloakFunc(function(){ return false; });
    } else if ( /^\d+$/.test(cValue) ) {
        cValue = parseFloat(cValue);
        if ( isNaN(cValue) ) { return; }
        if ( Math.abs(cValue) > 0x7FFF ) { return; }
    } else {
        return;
    }
    let aborted = false;
    const mustAbort = function(v) {
        if ( aborted ) { return true; }
        aborted =
            (v !== undefined && v !== null) &&
            (cValue !== undefined && cValue !== null) &&
            (typeof v !== typeof cValue);
        return aborted;
    };
    // https://github.com/uBlockOrigin/uBlock-issues/issues/156
    //   Support multiple trappers for the same property.
    const trapProp = function(owner, prop, configurable, handler) {
        if ( handler.init(owner[prop]) === false ) { return; }
        const odesc = Object.getOwnPropertyDescriptor(owner, prop);
        let prevGetter, prevSetter;
        if ( odesc instanceof Object ) {
            owner[prop] = cValue;
            if ( odesc.get instanceof Function ) {
                prevGetter = odesc.get;
            }
            if ( odesc.set instanceof Function ) {
                prevSetter = odesc.set;
            }
        }
        try {
            objectDefineProperty(owner, prop, {
                configurable,
                get() {
                    if ( prevGetter !== undefined ) {
                        prevGetter();
                    }
                    return handler.getter(); // cValue
                },
                set(a) {
                    if ( prevSetter !== undefined ) {
                        prevSetter(a);
                    }
                    handler.setter(a);
                }
            });
        } catch(ex) {
        }
    };
    const trapChain = function(owner, chain) {
        const pos = chain.indexOf('.');
        if ( pos === -1 ) {
            trapProp(owner, chain, false, {
                v: undefined,
                init: function(v) {
                    if ( mustAbort(v) ) { return false; }
                    this.v = v;
                    return true;
                },
                getter: function() {
                    return cValue;
                },
                setter: function(a) {
                    if ( mustAbort(a) === false ) { return; }
                    cValue = a;
                }
            });
            return;
        }
        const prop = chain.slice(0, pos);
        const v = owner[prop];
        chain = chain.slice(pos + 1);
        if ( v instanceof Object || typeof v === 'object' && v !== null ) {
            trapChain(v, chain);
            return;
        }
        trapProp(owner, prop, true, {
            v: undefined,
            init: function(v) {
                this.v = v;
                return true;
            },
            getter: function() {
                return this.v;
            },
            setter: function(a) {
                this.v = a;
                if ( a instanceof Object ) {
                    trapChain(a, chain);
                }
            }
        });
    };
    trapChain(window, chain);
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

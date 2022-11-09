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

/// name no-windowopen-if
/// alias no-windowOpen-if
/// alias nowoif
/// alias window.open-defuser

/******************************************************************************/

// Important!
// Isolate from global scope
(function uBOL_noWindowOpenIf() {

/******************************************************************************/

// $rulesetId$

const argsList = self.$argsList$;

const hostnamesMap = new Map(self.$hostnamesMap$);

/******************************************************************************/

const scriptlet = (
    needle = '',
    delay = '',
    options = ''
) => {
    const newSyntax = /^[01]?$/.test(needle) === false;
    let pattern = '';
    let targetResult = true;
    let autoRemoveAfter = -1;
    if ( newSyntax ) {
        pattern = needle;
        if ( pattern.startsWith('!') ) {
            targetResult = false;
            pattern = pattern.slice(1);
        }
        autoRemoveAfter = parseInt(delay);
        if ( isNaN(autoRemoveAfter) ) {
            autoRemoveAfter = -1;
        } 
    } else {
        pattern = delay;
        if ( needle === '0' ) {
            targetResult = false;
        }
    }
    if ( pattern === '' ) {
        pattern = '.?';
    } else if ( /^\/.+\/$/.test(pattern) ) {
        pattern = pattern.slice(1,-1);
    } else {
        pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    const rePattern = new RegExp(pattern);
    const createDecoy = function(tag, urlProp, url) {
        const decoy = document.createElement(tag);
        decoy[urlProp] = url;
        decoy.style.setProperty('height','1px', 'important');
        decoy.style.setProperty('position','fixed', 'important');
        decoy.style.setProperty('top','-1px', 'important');
        decoy.style.setProperty('width','1px', 'important');
        document.body.appendChild(decoy);
        setTimeout(( ) => decoy.remove(), autoRemoveAfter * 1000);
        return decoy;
    };
    window.open = new Proxy(window.open, {
        apply: function(target, thisArg, args) {
            const url = args[0];
            if ( rePattern.test(url) !== targetResult ) {
                return target.apply(thisArg, args);
            }
            if ( autoRemoveAfter < 0 ) { return null; }
            const decoy = /\bobj\b/.test(options)
                ? createDecoy('object', 'data', url)
                : createDecoy('iframe', 'src', url);
            let popup = decoy.contentWindow;
            if ( typeof popup === 'object' && popup !== null ) {
                Object.defineProperty(popup, 'closed', { value: false });
            } else {
                const noopFunc = (function(){}).bind(self);
                popup = new Proxy(self, {
                    get: function(target, prop) {
                        if ( prop === 'closed' ) { return false; }
                        const r = Reflect.get(...arguments);
                        if ( typeof r === 'function' ) { return noopFunc; }
                        return target[prop];
                    },
                    set: function() {
                        return Reflect.set(...arguments);
                    },
                });
            }
            return popup;
        }
    });
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


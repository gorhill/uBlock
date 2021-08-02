/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
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

/* globals self */

'use strict';

/******************************************************************************/

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/globalThis

const globals = (( ) => {
    // jshint ignore:start
    if ( typeof globalThis !== 'undefined' ) { return globalThis; }
    if ( typeof self !== 'undefined' ) { return self; }
    if ( typeof global !== 'undefined' ) { return global; }
    // jshint ignore:end
})();

// https://en.wikipedia.org/wiki/.invalid
if ( globals.location === undefined ) {
    globals.location = new URL('https://ublock0.invalid/');
}

// https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback
if ( globals.requestIdleCallback === undefined ) {
    globals.requestIdleCallback = function(callback) {
        return globals.setTimeout(callback, 1);
    };
    globals.cancelIdleCallback = function(handle) {
        return globals.clearTimeout(handle);
    };
}

/******************************************************************************/

export default globals;

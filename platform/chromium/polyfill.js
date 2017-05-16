/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2017 The uBlock Origin authors

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

// For background page or non-background pages

/* exported objectAssign */

'use strict';

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1067
// https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/String/startsWith
// Firefox 17/Chromium 41 supports `startsWith`.

if ( String.prototype.startsWith instanceof Function === false ) {
    String.prototype.startsWith = function(needle, pos) {
        if ( typeof pos !== 'number' ) {
            pos = 0;
        }
        return this.lastIndexOf(needle, pos) === pos;
    };
}

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1067
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/endsWith
// Firefox 17/Chromium 41 supports `endsWith`.

if ( String.prototype.endsWith instanceof Function === false ) {
    String.prototype.endsWith = function(needle, pos) {
        if ( typeof pos !== 'number' ) {
            pos = this.length;
        }
        pos -= needle.length;
        return this.indexOf(needle, pos) === pos;
    };
}

/******************************************************************************/

// As per MDN, Object.assign appeared first in Chromium 45.
// https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/Object/assign#Browser_compatibility

var objectAssign = Object.assign || function(target, source) {
    var keys = Object.keys(source);
    for ( var i = 0, n = keys.length, key; i < n; i++ ) {
        key = keys[i];
        target[key] = source[key];
    }
    return target;
};

/******************************************************************************/

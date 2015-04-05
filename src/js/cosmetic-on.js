/*******************************************************************************

    uBlock - a browser extension to block requests.
    Copyright (C) 2015 Raymond Hill

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

/* global vAPI, HTMLDocument */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/464
if ( document instanceof HTMLDocument === false ) {
    //console.debug('cosmetic-on.js > not a HTLMDocument');
    return;
}

// Because in case
if ( !vAPI ) {
    //console.debug('cosmetic-on.js > vAPI not found');
    return;
}

/******************************************************************************/

var styles = vAPI.styles;

if ( Array.isArray(styles) === false ) {
    return;
}

/******************************************************************************/

// Insert all cosmetic filtering-related style tags in the DOM

var selectors = [];
var reProperties = /\s*\{[^}]+\}\s*/;
var style, i;
var parent = document.head || document.body || document.documentElement;

i = styles.length;
while ( i-- ) {
    style = styles[i];
    if ( style.parentElement !== null ) {
        continue;
    }
    if ( parent === null ) {
        continue;
    }
    selectors.push(style.textContent.replace(reProperties, ''));
    parent.appendChild(style);
}

// Add `display: none !important` attribute

if ( selectors.length === 0 ) {
    return;
}

var elems = [];
try {
    elems = document.querySelectorAll(selectors.join(','));
} catch (e) {
}

i = elems.length;
while ( i-- ) {
    style = elems[i].style;
    if ( typeof style === 'object' || typeof style.removeProperty === 'function' ) {
        style.setProperty('display', 'none', 'important');
    }
}

/******************************************************************************/

})();

/******************************************************************************/

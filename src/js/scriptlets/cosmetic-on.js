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

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

if ( typeof vAPI !== 'object' ) {
    return;
}

/******************************************************************************/

var styles = vAPI.styles;

if ( Array.isArray(styles) === false ) {
    return;
}

var sessionId = vAPI.sessionId;

/******************************************************************************/

// Insert all cosmetic filtering-related style tags in the DOM

var selectors = [];
var reProperties = /\s*\{[^}]+\}\s*/;
var style, i;

i = styles.length;
while ( i-- ) {
    style = styles[i];
    selectors.push(style.textContent.replace(reProperties, ''));
    if ( style.sheet !== null ) {
        style.sheet.disabled = false;
        style[vAPI.sessionId] = undefined;
    }
}

if ( selectors.length === 0 ) {
    return;
}

var elems = [];
try {
    elems = document.querySelectorAll(selectors.join(','));
} catch (e) {
}

var elem, shadow;
i = elems.length;
while ( i-- ) {
    elem = elems[i];
    shadow = elem.shadowRoot;
    if ( shadow === undefined ) {
        style = elems[i].style;
        if ( typeof style === 'object' || typeof style.removeProperty === 'function' ) {
            style.setProperty('display', 'none', 'important');
        }
        continue;
    }
    if ( shadow !== null && shadow.className === sessionId && shadow.firstElementChild !== null ) {
        shadow.removeChild(shadow.firstElementChild);
    }
}

/******************************************************************************/

})();

/******************************************************************************/

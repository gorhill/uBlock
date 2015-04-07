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

// This can happen
if ( !vAPI || !vAPI.messaging ) {
    //console.debug('cosmetic-count.js > no vAPI');
    return;
}

/******************************************************************************/

// Insert all cosmetic filtering-related style tags in the DOM

var selectors = [];
var reProperties = /\s*\{[^}]+\}\s*/;
var i;

var styles = vAPI.styles || [];
i = styles.length;
while ( i-- ) {
    selectors.push(styles[i].textContent.replace(reProperties, ''));
}

var elems = [];

if ( selectors.length !== 0 ) {
    try {
        elems = document.querySelectorAll(selectors.join(','));
    } catch (e) {
    }
}

/******************************************************************************/

var localMessager = vAPI.messaging.channel('cosmetic-*.js');

localMessager.send({
    what: 'hiddenElementCount',
    count: elems.length
}, function() {
    localMessager.close();
});

/******************************************************************************/

})();

/******************************************************************************/

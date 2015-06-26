/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
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
    return;
}

// This can happen
if ( typeof vAPI !== 'object' ) {
    return;
}

/******************************************************************************/

// Some kind of fingerprint for the DOM, without incurring too much overhead.

var url = window.location.href;
var pos = url.indexOf('#');
if ( pos !== -1 ) {
    url = url.slice(0, pos);
}
var fingerprint = url + '{' + document.getElementsByTagName('*').length.toString() + '}';

var localMessager = vAPI.messaging.channel('scriptlets');
localMessager.send({
    what: 'scriptletResponse',
    scriptlet: 'dom-fingerprint',
    response: fingerprint
}, function() {
    localMessager.close();
});

/******************************************************************************/

})();

/******************************************************************************/

/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-2016 Raymond Hill

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

var loggedSelectors = vAPI.loggedSelectors || {};

var injectedSelectors = [];
var reProperties = /\s*\{[^}]+\}\s*/;
var i;
var styles = vAPI.styles || [];

i = styles.length;
while ( i-- ) {
    injectedSelectors = injectedSelectors.concat(styles[i].textContent.replace(reProperties, '').split(/\s*,\n\s*/));
}

if ( injectedSelectors.length === 0 ) {
    return;
}

var matchedSelectors = [];
var selector;

i = injectedSelectors.length;
while ( i-- ) {
    selector = injectedSelectors[i];
    if ( loggedSelectors.hasOwnProperty(selector) ) {
        continue;
    }
    if ( document.querySelector(selector) === null ) {
        continue;
    }
    loggedSelectors[selector] = true;
    // https://github.com/gorhill/uBlock/issues/1015
    // Discard `:root ` prefix.
    matchedSelectors.push(selector.slice(6));
}

vAPI.loggedSelectors = loggedSelectors;

/******************************************************************************/

vAPI.messaging.send(
    'scriptlets',
    {
        what: 'logCosmeticFilteringData',
        frameURL: window.location.href,
        frameHostname: window.location.hostname,
        matchedSelectors: matchedSelectors
    }
);

/******************************************************************************/

})();

/******************************************************************************/

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
    along with this program.  If not, see {https://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/* global vAPI, HTMLDocument, XMLDocument */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/464
if ( document instanceof HTMLDocument === false ) {
    // https://github.com/chrisaljoudi/uBlock/issues/1528
    // A XMLDocument can be a valid HTML document.
    if (
        document instanceof XMLDocument === false ||
        document.createElement('div') instanceof HTMLDivElement === false
    ) {
        return;
    }
}

// This can happen
if ( typeof vAPI !== 'object' ) {
    //console.debug('cosmetic-survey.js > vAPI not found');
    return;
}

/******************************************************************************/

// Insert all cosmetic filtering-related style tags in the DOM

var injectedSelectors = [];
var filteredElementCount = 0;

var reProperties = /\s*\{[^}]+\}\s*/;
var i;

var styles = vAPI.styles || [];
i = styles.length;
while ( i-- ) {
    injectedSelectors = injectedSelectors.concat(styles[i].textContent.replace(reProperties, '').split(/\s*,\n\s*/));
}

if ( injectedSelectors.length !== 0 ) {
    filteredElementCount = document.querySelectorAll(injectedSelectors.join(',')).length;
}

/******************************************************************************/

var localMessager = vAPI.messaging.channel('scriptlets');

localMessager.send({
    what: 'liveCosmeticFilteringData',
    pageURL: window.location.href,
    filteredElementCount: filteredElementCount
}, function() {
    localMessager.close();
});

/******************************************************************************/

})();

/******************************************************************************/

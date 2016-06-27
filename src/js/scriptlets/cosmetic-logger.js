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

'use strict';

/******************************************************************************/

(function() {

/******************************************************************************/

if ( typeof vAPI !== 'object' || typeof vAPI.domFilterer !== 'object' ) {
    return;
}

var loggedSelectors = vAPI.loggedSelectors || {},
    matchedSelectors = [],
    selectors, i, selector, entry, nodes, j;

// CSS-based selectors.
selectors = vAPI.domFilterer.simpleSelectors.concat(vAPI.domFilterer.complexSelectors);
i = selectors.length;
while ( i-- ) {
    selector = selectors[i];
    if ( loggedSelectors.hasOwnProperty(selector) ) {
        continue;
    }
    if ( document.querySelector(selector) === null ) {
        continue;
    }
    loggedSelectors[selector] = true;
    matchedSelectors.push(selector);
}

// `:has`-based selectors.
selectors = vAPI.domFilterer.simpleHasSelectors.concat(vAPI.domFilterer.complexHasSelectors);
i = selectors.length;
while ( i-- ) {
    entry = selectors[i];
    selector = entry.a + ':has(' + entry.b + ')';
    if ( loggedSelectors.hasOwnProperty(selector) ) {
        continue;
    }
    nodes = document.querySelectorAll(entry.a);
    j = nodes.length;
    while ( j-- ) {
        if ( nodes[j].querySelector(entry.b) !== null ) {
            loggedSelectors[selector] = true;
            matchedSelectors.push(selector);
            break;
        }
    }
}

// `:xpath`-based selectors.
var xpr = null,
    xpathexpr;
selectors = vAPI.domFilterer.xpathSelectors;
i = selectors.length;
while ( i-- ) {
    xpathexpr = selectors[i];
    selector = ':xpath(' + xpathexpr + ')';
    if ( loggedSelectors.hasOwnProperty(selector) ) {
        continue;
    }
    xpr = document.evaluate(
        'boolean(' + xpathexpr + ')',
        document,
        null,
        XPathResult.BOOLEAN_TYPE,
        xpr
    );
    if ( xpr.booleanValue ) {
        loggedSelectors[selector] = true;
        matchedSelectors.push(selector);
    }
}

vAPI.loggedSelectors = loggedSelectors;

if ( matchedSelectors.length ) {
    vAPI.messaging.send(
        'scriptlets',
        {
            what: 'logCosmeticFilteringData',
            frameURL: window.location.href,
            frameHostname: window.location.hostname,
            matchedSelectors: matchedSelectors
        }
    );
}

/******************************************************************************/

})();

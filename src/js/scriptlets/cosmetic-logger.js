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

if ( typeof vAPI !== 'object' || !vAPI.domFilterer ) {
    return;
}

var loggedSelectors = vAPI.loggedSelectors || {},
    matchedSelectors = [];


var evaluateSelector = function(selector) {
    if (
        loggedSelectors.hasOwnProperty(selector) === false &&
        document.querySelector(selector) !== null
    ) {
        loggedSelectors[selector] = true;
        matchedSelectors.push(selector);
    }
};

// Simple CSS selector-based cosmetic filters.
vAPI.domFilterer.simpleHideSelectors.entries.forEach(evaluateSelector);

// Complex CSS selector-based cosmetic filters.
vAPI.domFilterer.complexHideSelectors.entries.forEach(evaluateSelector);

// Style cosmetic filters.
vAPI.domFilterer.styleSelectors.entries.forEach(function(filter) {
    if (
        loggedSelectors.hasOwnProperty(filter.raw) === false &&
        document.querySelector(filter.style[0]) !== null
    ) {
        loggedSelectors[filter.raw] = true;
        matchedSelectors.push(filter.raw);
    }
});

// Procedural cosmetic filters.
vAPI.domFilterer.proceduralSelectors.entries.forEach(function(pfilter) {
    if (
        loggedSelectors.hasOwnProperty(pfilter.raw) === false &&
        pfilter.exec().length !== 0
    ) {
        loggedSelectors[pfilter.raw] = true;
        matchedSelectors.push(pfilter.raw);
    }
});

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

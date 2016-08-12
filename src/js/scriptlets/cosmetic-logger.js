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

var df = vAPI.domFilterer,
    loggedSelectors = vAPI.loggedSelectors || {},
    matchedSelectors = [],
    selectors, i, selector;


// CSS selectors.
selectors = df.jobQueue[2]._0.concat(df.jobQueue[3]._0);
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

// Non-CSS selectors.
var logHit = function(node, job) {
    if ( !job.raw || loggedSelectors.hasOwnProperty(job.raw) ) {
        return;
    }
    loggedSelectors[job.raw] = true;
    matchedSelectors.push(job.raw);
};
for ( i = 4; i < df.jobQueue.length; i++ ) {
    df.runJob(df.jobQueue[i], logHit);
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

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

/* global vAPI, µBlock */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

if ( typeof vAPI.rpcReceiver !== 'object' ) {
    return;
}

/******************************************************************************/

vAPI.rpcReceiver.getScriptTagFilters = function(details) {
    var µb = µBlock;
    var cfe = µb.cosmeticFilteringEngine;
    if ( !cfe ) {
        return;
    }
    // Fetching the script tag filters first: assuming it is faster than
    // checking whether the site is whitelisted.
    var hostname = details.frameHostname;
    var r = cfe.retrieveScriptTagRegex(
        µb.URI.domainFromHostname(hostname) || hostname,
        hostname
    );
    // https://github.com/gorhill/uBlock/issues/838
    // Disable script tag filtering if document URL is whitelisted.
    if ( r !== undefined && µb.getNetFilteringSwitch(details.rootURL) ) {
        return r;
    }
};

/******************************************************************************/

})();

/******************************************************************************/

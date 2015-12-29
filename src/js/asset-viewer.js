/*******************************************************************************

    µBlock - a browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

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

/* global vAPI, uDom */
'use strict';

/******************************************************************************/

(function() {

/******************************************************************************/

var messager = vAPI.messaging.channel('asset-viewer.js');

/******************************************************************************/

var onAssetContentReceived = function(details) {
    uDom('#content').text(details && (details.content || ''));
};

/******************************************************************************/

var q = window.location.search;
var matches = q.match(/^\?url=([^&]+)/);
if ( !matches || matches.length !== 2 ) {
    return;
}

messager.send(
    {
        what : 'getAssetContent',
        url: decodeURIComponent(matches[1])
    },
    onAssetContentReceived
);

/******************************************************************************/

})();

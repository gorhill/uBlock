/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2016 Raymond Hill

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
    var matches = /url=([^&]+)/.exec(window.location.search);
    if ( matches === null ) { return; }

    var onMessage = function(msg) {
        if ( msg.what !== 'ublockOrigin-readyState-complete' ) {
            return;
        }
        vAPI.messaging.removeChannelListener('document-suspended.js', onMessage);
        window.location.replace(document.querySelector('body > a').href);
    };

    var link = document.querySelector('body > a'),
        url = decodeURIComponent(matches[1]);
    link.setAttribute('href', url);
    link.appendChild(document.createTextNode(url));

    vAPI.messaging.addChannelListener('document-suspended.js', onMessage);
})();

/******************************************************************************/

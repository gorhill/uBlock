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

/* global uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var messager = vAPI.messaging.channel('document-blocked.js');

var matches = /details=([^&]+)/.exec(window.location.search);
if ( matches === null ) {
    return;
}
var details = JSON.parse(atob(matches[1]));

/******************************************************************************/

var yolo = function(ev) {
    var onReady = function() {
        window.location.replace(details.url);
    };

    messager.send({
        what: 'temporarilyWhitelistDocument',
        url: details.url
    }, onReady);

    ev.preventDefault();
};

/******************************************************************************/

uDom('.what').text(details.url);
uDom('#why').text(details.why.slice(3));

if ( window.history.length > 1 ) {
    uDom('#back').on('click', function() { window.history.back(); });
} else {
    uDom('#back').css('display', 'none');
}

uDom('#bye').on('click', function() { window.close(); });

uDom('#yolo').attr('href', details.url)
             .on('click', yolo);

})();

/******************************************************************************/

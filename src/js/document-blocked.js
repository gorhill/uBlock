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

    Home: https://github.com/chrisaljoudi/uBlock
*/

/* global uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var messager = vAPI.messaging.channel('document-blocked.js');
var details = {};

(function() {
    var matches = /details=([^&]+)/.exec(window.location.search);
    if ( matches === null ) {
        return;
    }
    details = JSON.parse(atob(matches[1]));
})();

/******************************************************************************/

var proceedToURL = function() {
    window.location.replace(details.url);
};

/******************************************************************************/

var proceedTemporary = function() {
    messager.send({
        what: 'temporarilyWhitelistDocument',
        url: details.url
    }, proceedToURL);
};

/******************************************************************************/

var proceedPermanent = function() {
    messager.send({
        what: 'toggleHostnameSwitch',
        name: 'dontBlockDoc',
        hostname: details.hn,
        state: true
    }, proceedToURL);
};

/******************************************************************************/

(function() {
    var matches = /^(.*)\{\{hostname\}\}(.*)$/.exec(vAPI.i18n('docblockedProceed'));
    if ( matches === null ) {
        return;
    }
    var proceed = uDom('#proceedTemplate').clone();
    proceed.descendants('span:nth-of-type(1)').text(matches[1]);
    proceed.descendants('span:nth-of-type(2)').text(details.hn);
    proceed.descendants('span:nth-of-type(3)').text(matches[2]);
    uDom('#proceed').append(proceed);
})();

/******************************************************************************/

uDom('.what').text(details.url);
uDom('#why').text(details.why.slice(3));

if ( window.history.length > 1 ) {
    uDom('#back').on('click', function() { window.history.back(); });
    uDom('#bye').css('display', 'none');
} else {
    uDom('#bye').on('click', function() { window.close(); });
    uDom('#back').css('display', 'none');
}

uDom('#proceedTemporary').attr('href', details.url).on('click', proceedTemporary);
uDom('#proceedPermanent').attr('href', details.url).on('click', proceedPermanent);

/******************************************************************************/

})();

/******************************************************************************/

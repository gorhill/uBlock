/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
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
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

// Helper to deal with the i18n'ing of HTML files.
// jQuery must be present at this point.

window.addEventListener('load', function() {
    var i;
    var fillin = function(elem) {
            var key = elem.getAttribute("data-i18n");
            elem.innerHTML = chrome.i18n.getMessage(key);
        }

    var elems = document.querySelectorAll('[data-i18n]');
    i = elems.length;
    while ( i-- ) {
        fillin(elems[i]);
    }
});

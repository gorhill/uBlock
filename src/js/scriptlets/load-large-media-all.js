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

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

// For all media resources which have failed to load, trigger a reload.

var elems, i, elem, src;

// <audio> and <video> elements.
// https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement

elems = document.querySelectorAll('audio,video');
i = elems.length;
while ( i-- ) {
    elem = elems[i];
    if ( elem.error !== null ) {
        elem.load();
    }
}

// <img> elements.
// https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement

elems = document.querySelectorAll('img');
i = elems.length;
while ( i-- ) {
    elem = elems[i];
    if ( elem.naturalWidth !== 0 && elem.naturalHeight !== 0 ) {
        continue;
    }
    if ( window.getComputedStyle(elem).getPropertyValue('display') === 'none' ) {
        continue;
    }
    src = elem.getAttribute('src');
    if ( src ) {
        elem.removeAttribute('src');
        elem.setAttribute('src', src);
    }
}

/******************************************************************************/

})();

/******************************************************************************/

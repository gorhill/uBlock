/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-2018 Raymond Hill

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

(( ) => {

/******************************************************************************/

// For all media resources which have failed to load, trigger a reload.

// <audio> and <video> elements.
// https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement

for ( const elem of document.querySelectorAll('audio,video') ) {
    if ( elem.error === null ) { continue; }
    elem.load();
}

// <img> elements.
// https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement

for ( const elem of document.querySelectorAll('img') ) {
    if ( elem.naturalWidth !== 0 && elem.naturalHeight !== 0 ) { continue; }
    if ( window.getComputedStyle(elem).getPropertyValue('display') === 'none' ) {
        continue;
    }
    const src = elem.getAttribute('src') || '';
    if ( src === '' ) { continue; }
    elem.removeAttribute('src');
    elem.setAttribute('src', src);
}

/******************************************************************************/

})();








/*******************************************************************************

    DO NOT:
    - Remove the following code
    - Add code beyond the following code
    Reason:
    - https://github.com/gorhill/uBlock/pull/3721
    - uBO never uses the return value from injected content scripts

**/

void 0;

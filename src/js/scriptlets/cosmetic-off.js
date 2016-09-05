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
    if ( typeof vAPI !== 'object' || !vAPI.domFilterer ) {
        return;
    }

    var styles = vAPI.domFilterer.styleTags;

    // Disable all cosmetic filtering-related styles from the DOM
    var i = styles.length, style;
    while ( i-- ) {
        style = styles[i];
        if ( style.sheet !== null ) {
            style.sheet.disabled = true;
            style[vAPI.sessionId] = true;
        }
    }

    var elems = [];
    try {
        elems = document.querySelectorAll('[' + vAPI.domFilterer.hiddenId + ']');
    } catch (e) {
    }
    i = elems.length;
    while ( i-- ) {
        vAPI.domFilterer.showNode(elems[i]);
    }

    vAPI.domFilterer.toggleOff();
})();

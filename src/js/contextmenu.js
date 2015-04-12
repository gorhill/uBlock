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
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/chrisaljoudi/uBlock
*/

/* global vAPI, µBlock */
'use strict';

/******************************************************************************/

// New namespace

µBlock.contextMenu = (function() {

/******************************************************************************/

var µb = µBlock;
var enabled = false;

/******************************************************************************/

var onContextMenuClicked = function(details, tab) {
    if ( details.menuItemId !== 'blockElement' ) {
        return;
    }
    if ( tab === undefined ) {
        return;
    }
    if ( /^https?:\/\//.test(tab.url) === false ) {
        return;
    }

    µb.elementPickerExec(tab.id);
};

/******************************************************************************/

var toggleMenu = function(on) {
    // This needs to be local scope: we can't reuse it for more than one
    // menu creation call.
    var menuCreateDetails = {
        id: 'blockElement',
        title: vAPI.i18n('pickerContextMenuEntry'),
        contexts: ['page', 'editable', 'frame', 'link', 'image', 'video'],
        documentUrlPatterns: ['https://*/*', 'http://*/*']
    };

    if ( on === true && enabled === false ) {
        vAPI.contextMenu.create(menuCreateDetails, onContextMenuClicked);
        enabled = true;
    } else if ( on !== true && enabled === true ) {
        vAPI.contextMenu.remove();
        enabled = false;
    }
};

/******************************************************************************/

return {
    toggle: toggleMenu
};

/******************************************************************************/

})();

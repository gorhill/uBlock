/*******************************************************************************

    µBlock - a browser extension to block requests.
    Copyright (C) 2014 The µBlock authors

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

/******************************************************************************/

var locationChangeListener; // Keep alive while frameScript is alive

(function() {

'use strict';

/******************************************************************************/

let {contentObserver, LocationChangeListener} = Components.utils.import(
    Components.stack.filename.replace('Script', 'Module'),
    null
);

let injectContentScripts = function(win) {
    if ( !win || !win.document ) {
        return;
    }

    contentObserver.observe(win.document);

    if ( win.frames && win.frames.length ) {
        let i = win.frames.length;
        while ( i-- ) {
            injectContentScripts(win.frames[i]);
        }
    }
};

let onLoadCompleted = function() {
    removeMessageListener('ublock-load-completed', onLoadCompleted);
    injectContentScripts(content);
};

addMessageListener('ublock-load-completed', onLoadCompleted);

locationChangeListener = new LocationChangeListener(docShell);

/******************************************************************************/

})();

/******************************************************************************/

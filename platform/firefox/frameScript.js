/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 The uBlock Origin authors

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

// https://developer.mozilla.org/en-US/Firefox/Multiprocess_Firefox/Frame_script_environment

(function() {

    'use strict';

    if ( !this.docShell ) {
        return;
    }

    let {LocationChangeListener} = Components.utils.import(
        Components.stack.filename.replace('Script', 'Module'),
        null
    );

    // https://github.com/gorhill/uBlock/issues/1444
    // Apparently the same context is used for all extensions, hence we must
    // use scoped variables to ensure no collision.
    let locationChangeListener;

    // https://developer.mozilla.org/en-US/Add-ons/Code_snippets/Progress_Listeners
    // "Note that the browser uses a weak reference to your listener object,
    // "so make sure to keep an external reference to your object to ensure
    // "that it stays in memory."
    // This listener below allows us to keep `locationChangeListener` alive
    // until we no longer need it.
    let shutdown = function(ev) {
        if ( ev.target === this ) {
            this.removeEventListener('unload', shutdown);
        }
    };
    this.addEventListener('unload', shutdown);

    let webProgress = this.docShell
                          .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                          .getInterface(Components.interfaces.nsIWebProgress);
    if ( webProgress && webProgress.isTopLevel ) {
        locationChangeListener = new LocationChangeListener(this.docShell, webProgress);
    }

}).call(this);

/******************************************************************************/

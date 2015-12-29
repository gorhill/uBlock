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
    along with this program.  If not, see {https://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/******************************************************************************/

// https://developer.mozilla.org/en-US/Firefox/Multiprocess_Firefox/Frame_script_environment

(function(context) {

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
    context.removeMessageListener('ublock0-load-completed', onLoadCompleted);
    injectContentScripts(context.content);
};
context.addMessageListener('ublock0-load-completed', onLoadCompleted);

let shutdown = function(ev) {
    if ( ev.target !== context ) {
        return;
    }
    context.removeMessageListener('ublock0-load-completed', onLoadCompleted);
    context.removeEventListener('unload', shutdown);
    context.locationChangeListener = null;
    LocationChangeListener = null;
    contentObserver = null;
};
context.addEventListener('unload', shutdown);

if ( context.docShell ) {
    let Ci = Components.interfaces;
    let wp = context.docShell.QueryInterface(Ci.nsIInterfaceRequestor)
                             .getInterface(Ci.nsIWebProgress);
    let dw = wp.DOMWindow;

    if ( dw === dw.top ) {
        context.locationChangeListener = new LocationChangeListener(context.docShell);
    }
}

/******************************************************************************/

})(this);

/******************************************************************************/

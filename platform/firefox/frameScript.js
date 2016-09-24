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

(function(context) {
    'use strict';

    if ( !context.docShell ) {
        return;
    }

    let webProgress = context.docShell
                      .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                      .getInterface(Components.interfaces.nsIWebProgress);
    if ( !webProgress ) {
        return;
    }

    // https://github.com/gorhill/uBlock/issues/1514
    // Fix?
    let domWindow = webProgress.DOMWindow;
    if ( domWindow !== domWindow.top ) {
        return;
    }

    let {LocationChangeListener} = Components.utils.import(
        Components.stack.filename.replace('Script', 'Module'),
        null
    );

    // https://github.com/gorhill/uBlock/issues/1444
    // Apparently, on older versions of Firefox (31 and less), the same context
    // is used for all frame scripts, hence we must use a unique variable name
    // to ensure no collision.
    context.ublock0LocationChangeListener = new LocationChangeListener(
        context.docShell,
        webProgress
    );
})(this);

/******************************************************************************/

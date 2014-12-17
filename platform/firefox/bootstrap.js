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

    Home: https://github.com/gorhill/uBlock
*/

/* global Services, APP_STARTUP, APP_SHUTDOWN */
/* exported startup, shutdown, install, uninstall */

'use strict';

/******************************************************************************/

var bgProcess;

Components.utils['import']('resource://gre/modules/Services.jsm');

/******************************************************************************/

function startup(data, reason) {
    bgProcess = function(ev) {
        if (ev) {
            this.removeEventListener(ev.type, bgProcess);
        }

        bgProcess = Services.appShell.hiddenDOMWindow.document;
        bgProcess = bgProcess.documentElement.appendChild(
            bgProcess.createElementNS('http://www.w3.org/1999/xhtml', 'iframe')
        );
        bgProcess.setAttribute('src', 'chrome://ublock/content/background.html');
    };

    if (reason === APP_STARTUP) {
        Services.ww.registerNotification({
            observe: function(win) {
                Services.ww.unregisterNotification(this);
                win.addEventListener('DOMContentLoaded', bgProcess);
            }
        });
    }
    else {
        bgProcess();
    }
}

/******************************************************************************/

function shutdown(data, reason) {
    if (reason !== APP_SHUTDOWN) {
        bgProcess.parentNode.removeChild(bgProcess);
    }
}

/******************************************************************************/

function install() {
    // https://bugzil.la/719376
    Services.strings.flushBundles();
}

/******************************************************************************/

function uninstall() {}

/******************************************************************************/

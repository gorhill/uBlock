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

/* global APP_SHUTDOWN, APP_STARTUP */
/* exported startup, shutdown, install, uninstall */

'use strict';

/******************************************************************************/

// Accessing the context of the background page from Console (e.g., about:addons):
// var win = Services.appShell.hiddenDOMWindow.document.querySelector('iframe[src*=ublock]').contentWindow;

let bgProcess;
const hostName = 'ublock';
const restartListener = {
    get messageManager() {
        return Components.classes['@mozilla.org/parentprocessmessagemanager;1']
            .getService(Components.interfaces.nsIMessageListenerManager);
    },

    receiveMessage: function() {
        shutdown();
        startup();
    }
};

/******************************************************************************/

function startup(data, reason) {
    let onReady = function(e) {
        if ( e ) {
            this.removeEventListener(e.type, onReady);
        }

        let hDoc = Components.classes['@mozilla.org/appshell/appShellService;1']
            .getService(Components.interfaces.nsIAppShellService)
            .hiddenDOMWindow.document;

        bgProcess = hDoc.documentElement.appendChild(
            hDoc.createElementNS('http://www.w3.org/1999/xhtml', 'iframe')
        );
        bgProcess.setAttribute(
            'src',
            'chrome://' + hostName + '/content/background.html'
        );

        restartListener.messageManager.addMessageListener(
            hostName + '-restart',
            restartListener
        );
    };

    if ( reason !== APP_STARTUP ) {
        onReady();
        return;
    }

    let ww = Components.classes['@mozilla.org/embedcomp/window-watcher;1']
                .getService(Components.interfaces.nsIWindowWatcher);

    ww.registerNotification({
        observe: function(win) {
            ww.unregisterNotification(this);
            win.addEventListener('DOMContentLoaded', onReady);
        }
    });
}

/******************************************************************************/

function shutdown(data, reason) {
    if ( reason === APP_SHUTDOWN ) {
        return;
    }

    bgProcess.parentNode.removeChild(bgProcess);

    // Remove the restartObserver only when the extension is being disabled
    if ( data !== undefined ) {
        restartListener.messageManager.removeMessageListener(
            hostName + '-restart',
            restartListener
        );
    }
}

/******************************************************************************/

function install() {
    // https://bugzil.la/719376
    Components.classes['@mozilla.org/intl/stringbundle;1']
        .getService(Components.interfaces.nsIStringBundleService).flushBundles();
}

/******************************************************************************/

function uninstall() {}

/******************************************************************************/

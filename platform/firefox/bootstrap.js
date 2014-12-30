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

let bgProcess;
const hostName = 'ublock';
const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
const restartObserver = {
    get observer() {
        return Cc["@mozilla.org/observer-service;1"]
            .getService(Ci.nsIObserverService);
    },

    QueryInterface: (function() {
        let {XPCOMUtils} = Cu['import']('resource://gre/modules/XPCOMUtils.jsm', {});

        return XPCOMUtils.generateQI([
            Ci.nsIObserver,
            Ci.nsISupportsWeakReference
        ]);
    })(),

    register: function() {
        this.observer.addObserver(this, hostName + '-restart', true);
    },

    unregister: function() {
        this.observer.removeObserver(this, hostName + '-restart');
    },

    observe: function() {
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

        let hDoc = Cc['@mozilla.org/appshell/appShellService;1']
            .getService(Ci.nsIAppShellService)
            .hiddenDOMWindow.document;

        bgProcess = hDoc.documentElement.appendChild(
            hDoc.createElementNS('http://www.w3.org/1999/xhtml', 'iframe')
        );
        bgProcess.setAttribute(
            'src',
            'chrome://' + hostName + '/content/background.html'
        );
        restartObserver.register();
    };

    if ( reason !== APP_STARTUP ) {
        onReady();
        return;
    }

    let ww = Cc['@mozilla.org/embedcomp/window-watcher;1']
                .getService(Ci.nsIWindowWatcher);

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
        restartObserver.unregister();
    }
}

/******************************************************************************/

function install() {
    // https://bugzil.la/719376
    Cc['@mozilla.org/intl/stringbundle;1']
        .getService(Ci.nsIStringBundleService).flushBundles();
}

/******************************************************************************/

function uninstall() {}

/******************************************************************************/

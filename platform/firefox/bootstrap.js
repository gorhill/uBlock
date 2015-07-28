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

/* global ADDON_UNINSTALL, APP_SHUTDOWN, APP_STARTUP */
/* exported startup, shutdown, install, uninstall */

'use strict';

/******************************************************************************/

const {classes: Cc, interfaces: Ci} = Components;

// Accessing the context of the background page:
// var win = Services.appShell.hiddenDOMWindow.document.querySelector('iframe[src*=ublock0]').contentWindow;

let bgProcess;
let version;
const hostName = 'ublock0';
const restartListener = {
    get messageManager() {
        return Cc['@mozilla.org/parentprocessmessagemanager;1']
            .getService(Ci.nsIMessageListenerManager);
    },

    receiveMessage: function() {
        shutdown();
        startup();
    }
};

/******************************************************************************/

function startup(data, reason) {
    if ( data !== undefined ) {
        version = data.version;
    }

    let appShell = Cc['@mozilla.org/appshell/appShellService;1']
        .getService(Ci.nsIAppShellService);

    let onReady = function(e) {
        if ( e ) {
            this.removeEventListener(e.type, onReady);
        }

        let hiddenDoc = appShell.hiddenDOMWindow.document;

        // https://github.com/gorhill/uBlock/issues/10
        // Fixed by github.com/AlexVallat:
        //   https://github.com/chrisaljoudi/uBlock/issues/1149
        //   https://github.com/AlexVallat/uBlock/commit/e762a29d308caa46578cdc34a9be92c4ad5ecdd0
        if ( hiddenDoc.readyState === 'loading' ) {
            hiddenDoc.addEventListener('DOMContentLoaded', onReady);
            return;
        }

        // https://github.com/gorhill/uBlock/issues/262
        // To remove whatever suffix AMO adds to the version number.
        var matches = version.match(/(?:\d+\.)+\d+/);
        if ( matches !== null ) {
            version = matches[0];
        }

        bgProcess = hiddenDoc.documentElement.appendChild(
            hiddenDoc.createElementNS('http://www.w3.org/1999/xhtml', 'iframe')
        );
        bgProcess.setAttribute(
            'src',
            'chrome://' + hostName + '/content/background.html#' + version
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

    let ww = Cc['@mozilla.org/embedcomp/window-watcher;1']
        .getService(Ci.nsIWindowWatcher);

    ww.registerNotification({
        observe: function(win, topic) {
            if ( topic !== 'domwindowopened' ) {
                return;
            }

            try {
                void appShell.hiddenDOMWindow;
            } catch (ex) {
                return;
            }

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

    if ( data === undefined ) {
        return;
    }

    // Remove the restartObserver only when the extension is being disabled
    restartListener.messageManager.removeMessageListener(
        hostName + '-restart',
        restartListener
    );
}

/******************************************************************************/

function install(/*aData, aReason*/) {
    // https://bugzil.la/719376
    Cc['@mozilla.org/intl/stringbundle;1']
        .getService(Ci.nsIStringBundleService)
        .flushBundles();
}

/******************************************************************************/

// https://developer.mozilla.org/en-US/Add-ons/Bootstrapped_extensions#uninstall
//   "if you have code in uninstall it will not run, you MUST run some code
//   "in the install function, at the least you must set arguments on the
//   "install function so like: function install(aData, aReason) {} then
//   "uninstall WILL WORK."

function uninstall(aData, aReason) {
    if ( aReason !== ADDON_UNINSTALL ) {
        return;
    }
    // https://github.com/gorhill/uBlock/issues/84
    // "Add cleanup task to remove local storage settings when uninstalling"
    // To cleanup vAPI.localStorage in vapi-common.js
    // As I get more familiar with FF API, will find out whetehr there was
    // a better way to do this.
    Components.utils.import('resource://gre/modules/Services.jsm', null)
        .Services.prefs.getBranch('extensions.' + hostName + '.').deleteBranch('');
}

/******************************************************************************/

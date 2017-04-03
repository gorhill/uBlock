/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2017 The uBlock Origin authors

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

/* global ADDON_UNINSTALL, APP_SHUTDOWN */
/* exported startup, shutdown, install, uninstall */

'use strict';

/******************************************************************************/

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

// Accessing the context of the background page:
// var win = Services.appShell.hiddenDOMWindow.document.querySelector('iframe[src*=ublock0]').contentWindow;

let windowlessBrowser = null;
let windowlessBrowserPL = null;
let bgProcess = null;
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

function startup(data/*, reason*/) {
    if ( data !== undefined ) {
        version = data.version;
    }

    // Already started?
    if ( bgProcess !== null ) {
        return;
    }

    waitForHiddenWindow();
}

function createBgProcess(parentDocument) {
    bgProcess = parentDocument.documentElement.appendChild(
        parentDocument.createElementNS('http://www.w3.org/1999/xhtml', 'iframe')
    );
    bgProcess.setAttribute(
        'src',
        'chrome://' + hostName + '/content/background.html#' + version
    );

    // https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIMessageListenerManager#addMessageListener%28%29
    // "If the same listener registers twice for the same message, the
    // "second registration is ignored."
    restartListener.messageManager.addMessageListener(
        hostName + '-restart',
        restartListener
    );
}

function getWindowlessBrowserFrame(appShell) {
    windowlessBrowser = appShell.createWindowlessBrowser(true);
    windowlessBrowser.QueryInterface(Ci.nsIInterfaceRequestor);
    let webProgress = windowlessBrowser.getInterface(Ci.nsIWebProgress);
    let XPCOMUtils = Cu.import('resource://gre/modules/XPCOMUtils.jsm', null).XPCOMUtils;
    windowlessBrowserPL = {
        QueryInterface: XPCOMUtils.generateQI([
            Ci.nsIWebProgressListener,
            Ci.nsIWebProgressListener2,
            Ci.nsISupportsWeakReference
        ]),
        onStateChange: function(wbp, request, stateFlags/*, status*/) {
            if ( !request ) { return; }
            if ( stateFlags & Ci.nsIWebProgressListener.STATE_STOP ) {
                webProgress.removeProgressListener(windowlessBrowserPL);
                windowlessBrowserPL = null;
                createBgProcess(windowlessBrowser.document);
            }
        }
    };
    webProgress.addProgressListener(windowlessBrowserPL, Ci.nsIWebProgress.NOTIFY_STATE_DOCUMENT);
    windowlessBrowser.document.location = "data:application/vnd.mozilla.xul+xml;charset=utf-8,<window%20id='" + hostName + "-win'/>";
}

function waitForHiddenWindow() {
    let appShell = Cc['@mozilla.org/appshell/appShellService;1']
        .getService(Ci.nsIAppShellService);

    let isReady = function() {
        var hiddenDoc;

        try {
            hiddenDoc = appShell.hiddenDOMWindow &&
                        appShell.hiddenDOMWindow.document;
        } catch (ex) {
        }

        // Do not test against `loading`: it does appear `readyState` could be
        // undefined if looked up too early.
        if ( !hiddenDoc || hiddenDoc.readyState !== 'complete' ) {
            return false;
        }

        // In theory, it should be possible to create a windowless browser
        // immediately, without waiting for the hidden window to have loaded
        // completely. However, in practice, on Windows this seems to lead
        // to a broken Firefox appearance. To avoid this, we only create the
        // windowless browser here. We'll use that rather than the hidden
        // window for the actual background page (windowless browsers are
        // also what the webextension implementation in Firefox uses for
        // background pages).
        let { Services } = Cu.import('resource://gre/modules/Services.jsm', null);
        if ( Services.vc.compare(Services.appinfo.platformVersion, '27') >= 0 ) {
            getWindowlessBrowserFrame(appShell);
        } else {
            createBgProcess(hiddenDoc);
        }
        return true;
    };

    if ( isReady() ) {
        return;
    }

    // https://github.com/gorhill/uBlock/issues/749
    // Poll until the proper environment is set up -- or give up eventually.
    // We poll frequently early on but relax poll delay as time pass.

    let tryDelay = 5;
    let trySum = 0;
    // https://trac.torproject.org/projects/tor/ticket/19438
    // Try for a longer period.
    let tryMax = 600011;
    let timer = Cc['@mozilla.org/timer;1']
        .createInstance(Ci.nsITimer);

    let checkLater = function() {
        trySum += tryDelay;
        if ( trySum >= tryMax ) {
            timer = null;
            return;
        }
        timer.init(timerObserver, tryDelay, timer.TYPE_ONE_SHOT);
        tryDelay *= 2;
        if ( tryDelay > 503 ) {
            tryDelay = 503;
        }
    };

    var timerObserver = {
        observe: function() {
            timer.cancel();
            if ( isReady() ) {
                timer = null;
            } else {
                checkLater();
            }
        }
    };

    checkLater();
}

/******************************************************************************/

function shutdown(data, reason) {
    if ( reason === APP_SHUTDOWN ) {
        return;
    }

    if ( bgProcess !== null ) {
        bgProcess.parentNode.removeChild(bgProcess);
        bgProcess = null;
    }

    if ( windowlessBrowser !== null ) {
        // close() does not exist for older versions of Firefox.
        if ( typeof windowlessBrowser.close === 'function' ) {
            windowlessBrowser.close();
        }
        windowlessBrowser = null;
        windowlessBrowserPL = null;
    }

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
    Cu.import('resource://gre/modules/Services.jsm', null)
      .Services.prefs.getBranch('extensions.' + hostName + '.')
      .deleteBranch('');
}

/******************************************************************************/

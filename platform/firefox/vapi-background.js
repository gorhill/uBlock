/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
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

/* global Services */

// For background page

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu['import']('resource://gre/modules/Services.jsm');

/******************************************************************************/

self.vAPI = self.vAPI || {};

vAPI.firefox = true;

/******************************************************************************/

vAPI.messaging = {
    gmm: Cc['@mozilla.org/globalmessagemanager;1'].getService(Ci.nsIMessageListenerManager),
    frameScript: 'chrome://ublock/content/frameScript.js',
    listeners: {},
    defaultHandler: null,
    NOOPFUNC: function(){},
    UNHANDLED: 'vAPI.messaging.notHandled'
};

/******************************************************************************/

vAPI.messaging.gmm.loadFrameScript(vAPI.messaging.frameScript, true);

/******************************************************************************/

vAPI.messaging.listen = function(listenerName, callback) {
    this.listeners[listenerName] = callback;
};

/******************************************************************************/

vAPI.messaging.onMessage = function(request) {
    var messageManager = request.target.messageManager;
    var listenerId = request.data.portName.split('|');
    var portName = listenerId[1];
    listenerId = listenerId[0];

    var callback = vAPI.messaging.NOOPFUNC;
    if ( request.data.requestId !== undefined ) {
        callback = function(response) {
            messageManager.sendAsyncMessage(
                listenerId,
                JSON.stringify({
                    requestId: request.data.requestId,
                    portName: portName,
                    msg: response !== undefined ? response : null
                })
            );
        };
    }

    // TODO:
    var sender = {
        tab: {
            id: 0
        }
    };

    // Specific handler
    var r = vAPI.messaging.UNHANDLED;
    var listener = vAPI.messaging.listeners[portName];
    if ( typeof listener === 'function' ) {
        r = listener(request.data.msg, sender, callback);
    }
    if ( r !== vAPI.messaging.UNHANDLED ) {
        return;
    }

    // Default handler
    r = vAPI.messaging.defaultHandler(request.data.msg, sender, callback);
    if ( r !== vAPI.messaging.UNHANDLED ) {
        return;
    }

    console.error('µBlock> messaging > unknown request: %o', request.data);

    // Unhandled:
    // Need to callback anyways in case caller expected an answer, or
    // else there is a memory leak on caller's side
    callback();
};

/******************************************************************************/

vAPI.messaging.setup = function(defaultHandler) {
    // Already setup?
    if ( this.defaultHandler !== null ) {
        return;
    }

    if ( typeof defaultHandler !== 'function' ) {
        defaultHandler = function(){ return vAPI.messaging.UNHANDLED; };
    }
    this.defaultHandler = defaultHandler;

    this.gmm.addMessageListener(vAPI.app.name + ':background', this.onMessage);
};

/******************************************************************************/

vAPI.messaging.broadcast = function(msg) {
    this.gmm.broadcastAsyncMessage(vAPI.app.name + ':broadcast', msg);
};

/******************************************************************************/

vAPI.lastError = function() {
    return null;
};

/******************************************************************************/

// clean up when the extension is disabled

window.addEventListener('unload', function() {
    vAPI.messaging.gmm.removeMessageListener(
        app.name + ':background',
        vAPI.messaging.postMessage
    );
    vAPI.messaging.gmm.removeDelayedFrameScript(vAPI.messaging.frameScript);

    // close extension tabs
    var enumerator = Services.wm.getEnumerator('navigator:browser');
    var host = 'ublock';
    var gBrowser, tabs, i, extURI;

    while (enumerator.hasMoreElements()) {
        gBrowser = enumerator.getNext().gBrowser;
        tabs = gBrowser.tabs;
        i = tabs.length;

        while (i--) {
            extURI = tabs[i].linkedBrowser.currentURI;

            if (extURI.scheme === 'chrome' && extURI.host === host) {
                gBrowser.removeTab(tabs[i]);
            }
        }
    }
});

/******************************************************************************/

})();

/******************************************************************************/

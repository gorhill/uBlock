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

/* global Services, Components, XPCOMUtils */

'use strict';

/******************************************************************************/

this.EXPORTED_SYMBOLS = ['contentPolicy', 'docObserver'];

const {interfaces: Ci, utils: Cu} = Components;
const appName = __URI__.match(/:\/\/([^\/]+)/)[1];

Cu['import']('resource://gre/modules/Services.jsm');
Cu['import']('resource://gre/modules/XPCOMUtils.jsm');
// Cu['import']('resource://gre/modules/devtools/Console.jsm');

/******************************************************************************/

const getMessager = win =>
    win.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDocShell)
        .sameTypeRootTreeItem.QueryInterface(Ci.nsIDocShell)
        .QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsIContentFrameMessageManager);

/******************************************************************************/

let contentPolicy = {
    classDescription: 'content-policy implementation for ' + appName,
    classID: Components.ID('{e6d173c8-8dbf-4189-a6fd-189e8acffd27}'),
    contractID: '@' + appName + '/content-policy;1',
    ACCEPT: Ci.nsIContentPolicy.ACCEPT,
    REJECT: Ci.nsIContentPolicy.REJECT_REQUEST,
    requestMessageName: appName + ':onBeforeRequest',
    get componentRegistrar() {
        return Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    },
    get categoryManager() {
        return Components.classes['@mozilla.org/categorymanager;1']
                .getService(Ci.nsICategoryManager);
    },
    QueryInterface: XPCOMUtils.generateQI([
        Ci.nsIFactory,
        Ci.nsIContentPolicy,
        Ci.nsISupportsWeakReference
    ]),
    createInstance: function(outer, iid) {
        if (outer) {
            throw Components.results.NS_ERROR_NO_AGGREGATION;
        }

        return this.QueryInterface(iid);
    },
    register: function() {
        this.componentRegistrar.registerFactory(
            this.classID,
            this.classDescription,
            this.contractID,
            this
        );
        this.categoryManager.addCategoryEntry(
            'content-policy',
            this.contractID,
            this.contractID,
            false,
            true
        );
    },
    unregister: function() {
        this.componentRegistrar.unregisterFactory(this.classID, this);
        this.categoryManager.deleteCategoryEntry(
            'content-policy',
            this.contractID,
            false
        );
    },
    shouldLoad: function(type, location, origin, context) {
        if (!context || !/^https?$/.test(location.scheme)) {
            return this.ACCEPT;
        }

        let win = type === 6
            ? context.contentWindow || context
            : (context.ownerDocument || context).defaultView;

        if (!win) {
            return this.ACCEPT;
        }

        let result = getMessager(win).sendSyncMessage(this.requestMessageName, {
            url: location.spec,
            type: type,
            tabId: -1, // determined in background script
            frameId: type === 6 ? -1 : (win === win.top ? 0 : 1),
            parentFrameId: win === win.top ? -1 : 0
        })[0];

        return result === true ? this.REJECT : this.ACCEPT;
    }/*,
    shouldProcess: function() {
        return this.ACCEPT;
    }*/
};

/******************************************************************************/

let docObserver = {
    contentBaseURI: 'chrome://' + appName + '/content/',
    initContext: function(win, sandbox) {
        let messager = getMessager(win);

        if (sandbox) {
            win = Cu.Sandbox([win], {
                sandboxPrototype: win,
                wantComponents: false,
                wantXHRConstructor: false
            });

            win.self = win;

            // anonymous function needs to be used here
            win.injectScript = Cu.exportFunction(
                function(script, evalCode) {
                    if (evalCode) {
                        Cu.evalInSandbox(script, win);
                        return;
                    }

                    Services.scriptloader.loadSubScript(
                        docObserver.contentBaseURI + script,
                        win
                    );
                },
                win
            );
        }

        win.sendAsyncMessage = messager.sendAsyncMessage;
        win.addMessageListener = messager.ublock_addMessageListener;
        win.removeMessageListener = messager.ublock_removeMessageListener;

        return win;
    },
    register: function() {
        Services.obs.addObserver(this, 'document-element-inserted', false);
    },
    unregister: function() {
        Services.obs.removeObserver(this, 'document-element-inserted');
    },
    observe: function(doc) {
        let win = doc.defaultView;

        if (!win) {
            return;
        }

        if (!/^https?:$/.test(win.location.protocol)) {
            if (win.location.protocol === 'chrome:'
                && win.location.host === appName) {
                this.initContext(win);
            }

            return;
        }

        let lss = Services.scriptloader.loadSubScript;
        win = this.initContext(win, true);

        lss(this.contentBaseURI + 'js/vapi-client.js', win);
        lss(this.contentBaseURI + 'js/contentscript-start.js', win);

        let docReady = function(e) {
            this.removeEventListener(e.type, docReady, true);
            lss(docObserver.contentBaseURI + 'js/contentscript-end.js', win);
        };

        doc.addEventListener('DOMContentLoaded', docReady, true);
    }
};

/******************************************************************************/

contentPolicy.register();
docObserver.register();

/******************************************************************************/

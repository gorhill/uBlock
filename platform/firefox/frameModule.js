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

'use strict';

/******************************************************************************/

this.EXPORTED_SYMBOLS = ['contentObserver'];

const {interfaces: Ci, utils: Cu} = Components;
const {Services} = Cu.import('resource://gre/modules/Services.jsm', null);
const hostName = Services.io.newURI(Components.stack.filename, null, null).host;
let uniqueSandboxId = 1;

// Cu.import('resource://gre/modules/devtools/Console.jsm');

/******************************************************************************/

const getMessageManager = function(win) {
    return win
        .QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsIDocShell)
        .sameTypeRootTreeItem
        .QueryInterface(Ci.nsIDocShell)
        .QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsIContentFrameMessageManager);
};

/******************************************************************************/

const contentObserver = {
    classDescription: 'content-policy for ' + hostName,
    classID: Components.ID('{e6d173c8-8dbf-4189-a6fd-189e8acffd27}'),
    contractID: '@' + hostName + '/content-policy;1',
    ACCEPT: Ci.nsIContentPolicy.ACCEPT,
    MAIN_FRAME: Ci.nsIContentPolicy.TYPE_DOCUMENT,
    contentBaseURI: 'chrome://' + hostName + '/content/js/',
    cpMessageName: hostName + ':shouldLoad',

    get componentRegistrar() {
        return Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    },

    get categoryManager() {
        return Components.classes['@mozilla.org/categorymanager;1']
                .getService(Ci.nsICategoryManager);
    },

    QueryInterface: (function() {
        let {XPCOMUtils} = Cu.import('resource://gre/modules/XPCOMUtils.jsm', null);

        return XPCOMUtils.generateQI([
            Ci.nsIFactory,
            Ci.nsIObserver,
            Ci.nsIContentPolicy,
            Ci.nsISupportsWeakReference
        ]);
    })(),

    createInstance: function(outer, iid) {
        if ( outer ) {
            throw Components.results.NS_ERROR_NO_AGGREGATION;
        }

        return this.QueryInterface(iid);
    },

    register: function() {
        Services.obs.addObserver(this, 'document-element-inserted', true);

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
        Services.obs.removeObserver(this, 'document-element-inserted');

        this.componentRegistrar.unregisterFactory(this.classID, this);
        this.categoryManager.deleteCategoryEntry(
            'content-policy',
            this.contractID,
            false
        );
    },

    getFrameId: function(win) {
        return win
            .QueryInterface(Ci.nsIInterfaceRequestor)
            .getInterface(Ci.nsIDOMWindowUtils)
            .outerWindowID;
    },

    // https://bugzil.la/612921
    shouldLoad: function(type, location, origin, context) {
        if ( !context ) {
            return this.ACCEPT;
        }

        if ( !location.schemeIs('http') && !location.schemeIs('https') ) {
            return this.ACCEPT;
        }

        let openerURL = null;

        if ( type === this.MAIN_FRAME ) {
            // When an iframe is loaded, it will be reported first as type = 6,
            // then immediately after that type = 7, so ignore the first report.
            // Origin should be "chrome://browser/content/browser.xul" here.
            // The lack of side-effects are not guaranteed though.
            if ( origin === null || origin.schemeIs('chrome') === false ) {
                return this.ACCEPT;
            }

            context = context.contentWindow || context;

            try {
                if ( context !== context.opener ) {
                    openerURL = context.opener.location.href;
                }
            } catch (ex) {}
        } else {
            context = (context.ownerDocument || context).defaultView;
        }

        // The context for the toolbar popup is an iframe element here,
        // so check context.top instead of context
        if ( !context.top || !context.location ) {
            return this.ACCEPT;
        }

        let isTopLevel = context === context.top;
        let parentFrameId;

        if ( isTopLevel ) {
            parentFrameId = -1;
        } else if ( context.parent === context.top ) {
            parentFrameId = 0;
        } else {
            parentFrameId = this.getFrameId(context.parent);
        }

        let messageManager = getMessageManager(context);
        let details = {
            frameId: isTopLevel ? 0 : this.getFrameId(context),
            openerURL: openerURL,
            parentFrameId: parentFrameId,
            type: type,
            url: location.spec
        };

        if ( typeof messageManager.sendRpcMessage === 'function' ) {
            // https://bugzil.la/1092216
            messageManager.sendRpcMessage(this.cpMessageName, details);
        } else {
            // Compatibility for older versions
            messageManager.sendSyncMessage(this.cpMessageName, details);
        }

        return this.ACCEPT;
    },

    initContentScripts: function(win, sandbox) {
        let messager = getMessageManager(win);
        let sandboxId = hostName + ':sb:' + uniqueSandboxId++;

        if ( sandbox ) {
            let sandboxName = [
                win.location.href.slice(0, 100),
                win.document.title.slice(0, 100)
            ].join(' | ');

            sandbox = Cu.Sandbox([win], {
                sandboxName: sandboxId + '[' + sandboxName + ']',
                sandboxPrototype: win,
                wantComponents: false,
                wantXHRConstructor: false
            });

            sandbox.injectScript = function(script) {
                Services.scriptloader.loadSubScript(script, sandbox);
            };
        }
        else {
            sandbox = win;
        }

        sandbox._sandboxId_ = sandboxId;
        sandbox.sendAsyncMessage = messager.sendAsyncMessage;

        sandbox.addMessageListener = function(callback) {
            if ( sandbox._messageListener_ ) {
                sandbox.removeMessageListener(
                    sandbox._sandboxId_,
                    sandbox._messageListener_
                );
            }

            sandbox._messageListener_ = function(message) {
                callback(message.data);
            };

            messager.addMessageListener(
                sandbox._sandboxId_,
                sandbox._messageListener_
            );
            messager.addMessageListener(
                hostName + ':broadcast',
                sandbox._messageListener_
            );
        };

        sandbox.removeMessageListener = function() {
            try {
                messager.removeMessageListener(
                    sandbox._sandboxId_,
                    sandbox._messageListener_
                );
                messager.removeMessageListener(
                    hostName + ':broadcast',
                    sandbox._messageListener_
                );
            } catch (ex) {
                // It throws sometimes, mostly when the popup closes
            }

            sandbox._messageListener_ = null;
        };

        return sandbox;
    },

    observe: function(subject) {
        let win = subject.defaultView;

        if ( !win ) {
            return;
        }

        let loc = win.location;

        if ( loc.protocol !== 'http:' && loc.protocol !== 'https:' ) {
            if ( loc.protocol === 'chrome:' && loc.host === hostName ) {
                this.initContentScripts(win);
            }

            // What about data: and about:blank?
            return;
        }

        let lss = Services.scriptloader.loadSubScript;
        let sandbox = this.initContentScripts(win, true);

        lss(this.contentBaseURI + 'vapi-client.js', sandbox);
        lss(this.contentBaseURI + 'contentscript-start.js', sandbox);

        let docReady = function(e) {
            this.removeEventListener(e.type, docReady, true);
            lss(contentObserver.contentBaseURI + 'contentscript-end.js', sandbox);
        };

        subject.addEventListener('DOMContentLoaded', docReady, true);
    }
};

/******************************************************************************/

contentObserver.register();

/******************************************************************************/

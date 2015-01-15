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

    // https://bugzil.la/612921
    shouldLoad: function(type, location, origin, context) {
        // If we don't know what initiated the request, probably it's not a tab
        if ( !context ) {
            return this.ACCEPT;
        }

        let openerURL;

        if ( !location.schemeIs('http') && !location.schemeIs('https') ) {
            if ( type !== this.MAIN_FRAME ) {
                return this.ACCEPT;
            }

            context = context.contentWindow || context;

            try {
                openerURL = context.opener.location.href;
            } catch (ex) {}

            let isPopup = location.spec === 'about:blank' && openerURL;

            if ( !location.schemeIs('data') && !isPopup ) {
                return this.ACCEPT;
            }
        } else if ( type === this.MAIN_FRAME ) {
            context = context.contentWindow || context;

            try {
                openerURL = context.opener.location.href;
            } catch (ex) {}
        } else {
            context = (context.ownerDocument || context).defaultView;
        }

        // The context for the toolbar popup is an iframe element here,
        // so check context.top instead of context
        if ( context.top && context.location ) {
            // https://bugzil.la/1092216
            getMessageManager(context).sendRpcMessage(this.cpMessageName, {
                openerURL: openerURL || null,
                url: location.spec,
                type: type,
                frameId: type === this.MAIN_FRAME ? -1 : (context === context.top ? 0 : 1),
                parentFrameId: context === context.top ? -1 : 0
            });
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

            sandbox.injectScript = function(script, evalCode) {
                if ( evalCode ) {
                    Cu.evalInSandbox(script, this);
                    return;
                }

                Services.scriptloader.loadSubScript(script, this);
            }.bind(sandbox);
        }
        else {
            sandbox = win;
        }

        sandbox._sandboxId_ = sandboxId;
        sandbox.sendAsyncMessage = messager.sendAsyncMessage;
        sandbox.addMessageListener = function(callback) {
            if ( this._messageListener_ ) {
                this.removeMessageListener(
                    this._sandboxId_,
                    this._messageListener_
                );
            }

            this._messageListener_ = function(message) {
                callback(message.data);
            };

            messager.addMessageListener(
                this._sandboxId_,
                this._messageListener_
            );
            messager.addMessageListener(
                hostName + ':broadcast',
                this._messageListener_
            );
        }.bind(sandbox);
        sandbox.removeMessageListener = function() {
            try {
                messager.removeMessageListener(
                    this._sandboxId_,
                    this._messageListener_
                );
                messager.removeMessageListener(
                    hostName + ':broadcast',
                    this._messageListener_
                );
            } catch (ex) {
                // It throws sometimes, mostly when the popup closes
            }

            this._messageListener_ = null;
        }.bind(sandbox);

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

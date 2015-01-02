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

/* global Services, Components, XPCOMUtils, __URI__ */

'use strict';

/******************************************************************************/

this.EXPORTED_SYMBOLS = ['contentObserver'];

const {interfaces: Ci, utils: Cu} = Components;
const appName = __URI__.match(/:\/\/([^\/]+)/)[1];

Cu['import']('resource://gre/modules/Services.jsm');
Cu['import']('resource://gre/modules/XPCOMUtils.jsm');
// Cu['import']('resource://gre/modules/devtools/Console.jsm');

/******************************************************************************/

const getMessageManager = function(context) {
    return context
        .QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsIDocShell)
        .sameTypeRootTreeItem
        .QueryInterface(Ci.nsIDocShell)
        .QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsIContentFrameMessageManager);
};

/******************************************************************************/

const contentObserver = {
    classDescription: 'content-policy for ' + appName,
    classID: Components.ID('{e6d173c8-8dbf-4189-a6fd-189e8acffd27}'),
    contractID: '@' + appName + '/content-policy;1',
    ACCEPT: Ci.nsIContentPolicy.ACCEPT,
    MAIN_FRAME: Ci.nsIContentPolicy.TYPE_DOCUMENT,
    contentBaseURI: 'chrome://' + appName + '/content/js/',
    messageName: appName + ':shouldLoad',

    get componentRegistrar() {
        return Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    },

    get categoryManager() {
        return Components.classes['@mozilla.org/categorymanager;1']
                .getService(Ci.nsICategoryManager);
    },

    QueryInterface: XPCOMUtils.generateQI([
        Ci.nsIFactory,
        Ci.nsIObserver,
        Ci.nsIContentPolicy,
        Ci.nsISupportsWeakReference
    ]),

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

        let opener;

        if ( location.scheme !== 'http' && location.scheme !== 'https' ) {
            if ( type !== this.MAIN_FRAME ) {
                return this.ACCEPT;
            }

            context = context.contentWindow || context;

            try {
                opener = context.opener.location.href;
            } catch (ex) {}

            let isPopup = location.spec === 'about:blank' && opener;

            if ( location.scheme !== 'data' && !isPopup ) {
                return this.ACCEPT;
            }
        } else if ( type === this.MAIN_FRAME ) {
            context = context.contentWindow || context;

            try {
                opener = context.opener.location.href;
            } catch (ex) {}
        } else {
            context = (context.ownerDocument || context).defaultView;
        }

        // The context for the popups is an iframe element here,
        // so check context.top instead

        if ( context.top && context.location ) {
            getMessageManager(context).sendSyncMessage(this.messageName, {
                opener: opener || null,
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

        if ( sandbox ) {
            win = Cu.Sandbox([win], {
                sandboxPrototype: win,
                wantComponents: false,
                wantXHRConstructor: false
            });

            win.self = win;

            // anonymous function needs to be used here
            win.injectScript = Cu.exportFunction(
                function(script, evalCode) {
                    if ( evalCode ) {
                        Cu.evalInSandbox(script, win);
                        return;
                    }

                    Services.scriptloader.loadSubScript(script, win);
                },
                win
            );
        }

        win.sendAsyncMessage = messager.sendAsyncMessage;
        win.addMessageListener = messager.ublock_addMessageListener;
        win.removeMessageListener = messager.ublock_removeMessageListener;

        return win;
    },

    observe: function(doc) {
        let win = doc.defaultView;

        if ( !win ) {
            return;
        }

        let loc = win.location;

        if ( loc.protocol !== 'http:' && loc.protocol !== 'https:' ) {
            if ( loc.protocol === 'chrome:' && loc.host === appName ) {
                this.initContentScripts(win);
            }

            return;
        }

        let lss = Services.scriptloader.loadSubScript;
        win = this.initContentScripts(win, true);

        lss(this.contentBaseURI + 'vapi-client.js', win);
        lss(this.contentBaseURI + 'contentscript-start.js', win);

        let docReady = function(e) {
            this.removeEventListener(e.type, docReady, true);
            lss(contentObserver.contentBaseURI + 'contentscript-end.js', win);
        };

        win.document.addEventListener('DOMContentLoaded', docReady, true);
    }
};

/******************************************************************************/

contentObserver.register();

/******************************************************************************/

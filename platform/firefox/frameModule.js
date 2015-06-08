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

this.EXPORTED_SYMBOLS = ['contentObserver', 'LocationChangeListener'];

const {interfaces: Ci, utils: Cu} = Components;
const {Services} = Cu.import('resource://gre/modules/Services.jsm', null);
const {XPCOMUtils} = Cu.import('resource://gre/modules/XPCOMUtils.jsm', null);

const hostName = Services.io.newURI(Components.stack.filename, null, null).host;

//Cu.import('resource://gre/modules/devtools/Console.jsm');

/******************************************************************************/

const getMessageManager = function(win) {
    let iface = win
        .QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsIDocShell)
        .sameTypeRootTreeItem
        .QueryInterface(Ci.nsIDocShell)
        .QueryInterface(Ci.nsIInterfaceRequestor);

    try {
        return iface.getInterface(Ci.nsIContentFrameMessageManager);
    } catch (ex) {
        // This can throw. It appears `shouldLoad` can be called *after*  a
        // tab has been closed. For example, a case where this happens all
        // the time (FF38):
        // - Open twitter.com (assuming you have an account and are logged in)
        // - Close twitter.com
        // There will be an exception raised when `shouldLoad` is called
        // to process a XMLHttpRequest with URL `https://twitter.com/i/jot`
        // fired from `https://twitter.com/`, *after*  the tab is closed.
        // In such case, `win` is `about:blank`.
    }
    return null;
};

/******************************************************************************/

const contentObserver = {
    classDescription: 'content-policy for ' + hostName,
    classID: Components.ID('{7afbd130-cbaf-46c2-b944-f5d24305f484}'),
    contractID: '@' + hostName + '/content-policy;1',
    ACCEPT: Ci.nsIContentPolicy.ACCEPT,
    MAIN_FRAME: Ci.nsIContentPolicy.TYPE_DOCUMENT,
    SUB_FRAME: Ci.nsIContentPolicy.TYPE_SUBDOCUMENT,
    contentBaseURI: 'chrome://' + hostName + '/content/js/',
    cpMessageName: hostName + ':shouldLoad',
    ignoredPopups: new WeakMap(),
    uniqueSandboxId: 1,

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
            context = context.contentWindow || context;
            if (
                context.opener &&
                context.opener !== context &&
                this.ignoredPopups.has(context) === false
            ) {
                openerURL = context.opener.location.href;
            }
        } else if ( type === this.SUB_FRAME ) {
            context = context.contentWindow;
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
        if ( messageManager === null ) {
            return this.ACCEPT;
        }

        let details = {
            frameId: isTopLevel ? 0 : this.getFrameId(context),
            openerURL: openerURL,
            parentFrameId: parentFrameId,
            rawtype: type,
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
        let sandboxId = hostName + ':sb:' + this.uniqueSandboxId++;

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
                if ( Services !== undefined ) {
                    Services.scriptloader.loadSubScript(script, sandbox);
                } else {
                    // Sandbox appears void.
                    // I've seen this happens, need to investigate why.
                }
            };
        }
        else {
            sandbox = win;
        }

        sandbox._sandboxId_ = sandboxId;
        sandbox.sendAsyncMessage = messager.sendAsyncMessage;

        sandbox.addMessageListener = function(callback) {
            if ( sandbox._messageListener_ ) {
                sandbox.removeMessageListener();
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

    ignorePopup: function(e) {
        if ( e.isTrusted === false ) {
            return;
        }

        let contObs = contentObserver;
        contObs.ignoredPopups.set(this, true);
        this.removeEventListener('keydown', contObs.ignorePopup, true);
        this.removeEventListener('mousedown', contObs.ignorePopup, true);
    },

    observe: function(doc) {
        let win = doc.defaultView;

        if ( !win ) {
            return;
        }

        if ( win.opener && this.ignoredPopups.has(win) === false ) {
            win.addEventListener('keydown', this.ignorePopup, true);
            win.addEventListener('mousedown', this.ignorePopup, true);
        }

        // https://github.com/gorhill/uBlock/issues/260
        // https://developer.mozilla.org/en-US/docs/Web/API/Document/contentType
        //   "Non-standard, only supported by Gecko. To be used in 
        //   "chrome code (i.e. Extensions and XUL applications)."
        // TODO: We may have to exclude more types, for now let's be
        //   conservative and focus only on the one issue reported, i.e. let's
        //   not test against 'text/html'.
        if ( doc.contentType.startsWith('image/') ) {
            return;
        }

        let loc = win.location;

        if ( loc.protocol !== 'http:' && loc.protocol !== 'https:' && loc.protocol !== 'file:' ) {
            if ( loc.protocol === 'chrome:' && loc.host === hostName ) {
                this.initContentScripts(win);
            }

            // What about data: and about:blank?
            return;
        }

        let lss = Services.scriptloader.loadSubScript;
        let sandbox = this.initContentScripts(win, true);

        try {
            lss(this.contentBaseURI + 'vapi-client.js', sandbox);
            lss(this.contentBaseURI + 'contentscript-start.js', sandbox);
        } catch (ex) {
            //console.exception(ex.msg, ex.stack);
            return;
        }

        let docReady = (e) => {
            let doc = e.target;
            doc.removeEventListener(e.type, docReady, true);
            lss(this.contentBaseURI + 'contentscript-end.js', sandbox);

            if ( doc.querySelector('a[href^="abp:"]') ) {
                lss(this.contentBaseURI + 'subscriber.js', sandbox);
            }
        };

        if ( doc.readyState === 'loading') {
            doc.addEventListener('DOMContentLoaded', docReady, true);
        } else {
            docReady({ target: doc, type: 'DOMContentLoaded' });
        }
    }
};

/******************************************************************************/

const locationChangedMessageName = hostName + ':locationChanged';

const LocationChangeListener = function(docShell) {
    if ( !docShell ) {
        return;
    }

    var requestor = docShell.QueryInterface(Ci.nsIInterfaceRequestor);
    var ds = requestor.getInterface(Ci.nsIWebProgress);
    var mm = requestor.getInterface(Ci.nsIContentFrameMessageManager);

    if ( ds && mm && typeof mm.sendAsyncMessage === 'function' ) {
        this.docShell = ds;
        this.messageManager = mm;
        ds.addProgressListener(this, Ci.nsIWebProgress.NOTIFY_LOCATION);
    }
};

LocationChangeListener.prototype.QueryInterface = XPCOMUtils.generateQI([
    'nsIWebProgressListener',
    'nsISupportsWeakReference'
]);

LocationChangeListener.prototype.onLocationChange = function(webProgress, request, location, flags) {
    if ( !webProgress.isTopLevel ) {
        return;
    }
    this.messageManager.sendAsyncMessage(locationChangedMessageName, {
        url: location.asciiSpec,
        flags: flags,
    });
};

/******************************************************************************/

contentObserver.register();

/******************************************************************************/

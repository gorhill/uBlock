/* global Services, Components, XPCOMUtils */
/* exported EXPORTED_SYMBOLS, isTabbed */

'use strict';

var EXPORTED_SYMBOLS = ['contentPolicy', 'docObserver'];

Components.utils['import']('resource://gre/modules/Services.jsm');
Components.utils['import']('resource://gre/modules/XPCOMUtils.jsm');

const Ci = Components.interfaces, appName = 'ublock';

let getMessager = function(win) {
    try {
        // e10s
        return win
            .QueryInterface(Ci.nsIInterfaceRequestor)
            .getInterface(Ci.nsIWebNavigation)
            .QueryInterface(Ci.nsIDocShellTreeItem)
            .rootTreeItem
            .QueryInterface(Ci.nsIInterfaceRequestor)
            .getInterface(Ci.nsIContentFrameMessageManager);
    } catch (ex) {
        return win
            .QueryInterface(Ci.nsIInterfaceRequestor)
            .getInterface(Ci.nsIWebNavigation)
            .QueryInterface(Ci.nsIDocShell)
            .QueryInterface(Ci.nsIInterfaceRequestor)
            .getInterface(Ci.nsIContentFrameMessageManager);
    }
};

let contentPolicy = {
    classDescription: 'ContentPolicy implementation',
    classID: Components.ID('{e6d173c8-8dbf-4189-a6fd-189e8acffd27}'),
    contractID: '@ublock/content-policy;1',
    ACCEPT: Ci.nsIContentPolicy.ACCEPT,
    REJECT: Ci.nsIContentPolicy.REJECT_REQUEST,
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
        if (type === 6 || !context || !/^https?$/.test(location.scheme)) {
            return this.ACCEPT;
        }

        let win = (context.ownerDocument || context).defaultView;

        if (!win) {
            return this.ACCEPT;
        }

        let result = getMessager(win).sendSyncMessage('ublock:onBeforeRequest', {
            url: location.spec,
            type: type,
            tabId: -1,
            frameId: win === win.top ? 0 : 1,
            parentFrameId: win === win.top ? -1 : 0
        })[0];

        return result === true ? this.REJECT : this.ACCEPT;
    }/*,
    shouldProcess: function() {
        return this.ACCEPT;
    }*/
};

let docObserver = {
    contentBaseURI: 'chrome://ublock/content/js/',
    initContext: function(win, sandbox) {
        let messager = getMessager(win);

        if (sandbox) {
            win = Components.utils.Sandbox([win], {
                sandboxPrototype: win,
                wantComponents: false,
                wantXHRConstructor: false
            });
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

        lss(this.contentBaseURI + 'vapi-client.js', win);
        lss(this.contentBaseURI + 'contentscript-start.js', win);

        if (doc.readyState === 'interactive' || doc.readyState === 'complete') {
            lss(this.contentBaseURI + 'contentscript-end.js', win);
        }
        else {
            let docReady = function(e) {
                this.removeEventListener(e.type, docReady, true);
                lss(docObserver.contentBaseURI + 'contentscript-end.js', win);
            };

            doc.addEventListener('DOMContentLoaded', docReady, true);
        }
    }
};

contentPolicy.register();
docObserver.register();

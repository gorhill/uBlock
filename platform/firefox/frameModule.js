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

/* exported processObserver */

'use strict';

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/800
this.EXPORTED_SYMBOLS = [
    'contentObserver',
    'processObserver',
    'LocationChangeListener'
];

const {interfaces: Ci, utils: Cu} = Components;
const {Services} = Cu.import('resource://gre/modules/Services.jsm', null);
const {XPCOMUtils} = Cu.import('resource://gre/modules/XPCOMUtils.jsm', null);

const hostName = Services.io.newURI(Components.stack.filename, null, null).host;
const rpcEmitterName = hostName + ':child-process-message';

//Cu.import('resource://gre/modules/Console.jsm'); // Firefox >= 44
//Cu.import('resource://gre/modules/devtools/Console.jsm'); // Firefox < 44

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

// https://github.com/gorhill/uBlock/issues/2014
// Have a dictionary of hostnames for which there are script tag filters. This
// allow for coarse-testing before firing a synchronous message to the
// parent process. Script tag filters are not very common, so this allows
// to skip the blocking of the child process most of the time.

var scriptTagFilterer = (function() {
    var scriptTagHostnames;

    var getCpmm = function() {
        var svc = Services;
        if ( !svc ) { return; }
        var cpmm = svc.cpmm;
        if ( cpmm ) { return cpmm; }
        cpmm = Components.classes['@mozilla.org/childprocessmessagemanager;1'];
        if ( cpmm ) { return cpmm.getService(Ci.nsISyncMessageSender); }
    };

    var getScriptTagHostnames = function() {
        if ( scriptTagHostnames ) {
            return scriptTagHostnames;
        }
        var cpmm = getCpmm();
        if ( !cpmm ) { return; }
        var r = cpmm.sendSyncMessage(rpcEmitterName, { fnName: 'getScriptTagHostnames' });
        if ( Array.isArray(r) && Array.isArray(r[0]) ) {
            scriptTagHostnames = new Set(r[0]);
        }
        return scriptTagHostnames;
    };

    var getScriptTagFilters = function(details) {
        let cpmm = getCpmm();
        if ( !cpmm ) { return; }
        let r = cpmm.sendSyncMessage(rpcEmitterName, {
            fnName: 'getScriptTagFilters',
            rootURL: details.rootURL,
            frameURL: details.frameURL,
            frameHostname: details.frameHostname
        });
        if ( Array.isArray(r) ) {
            return r[0];
        }
    };

    var regexFromHostname = function(details) {
        // If target hostname has no script tag filter, no point querying
        // chrome process.
        var hostnames = getScriptTagHostnames();
        if ( !hostnames ) { return; }
        var hn = details.frameHostname, pos, entity;
        for (;;) {
            if ( hostnames.has(hn) ) {
                return getScriptTagFilters(details);
            }
            pos = hn.indexOf('.');
            if ( pos === -1 ) { break; }
            entity = hn.slice(0, pos) + '.*';
            if ( hostnames.has(entity) ) {
                return getScriptTagFilters(details);
            }
            hn = hn.slice(pos + 1);
            if ( hn === '' ) { break; }
        }
    };

    var reset = function() {
        scriptTagHostnames = undefined;
    };

    return {
        get: regexFromHostname,
        reset: reset
    };
})();

/******************************************************************************/

var contentObserver = {
    classDescription: 'content-policy for ' + hostName,
    classID: Components.ID('{7afbd130-cbaf-46c2-b944-f5d24305f484}'),
    contractID: '@' + hostName + '/content-policy;1',
    ACCEPT: Ci.nsIContentPolicy.ACCEPT,
    REJECT: Ci.nsIContentPolicy.REJECT_REQUEST,
    MAIN_FRAME: Ci.nsIContentPolicy.TYPE_DOCUMENT,
    SUB_FRAME: Ci.nsIContentPolicy.TYPE_SUBDOCUMENT,
    contentBaseURI: 'chrome://' + hostName + '/content/js/',
    cpMessageName: hostName + ':shouldLoad',
    popupMessageName: hostName + ':shouldLoadPopup',
    ignoredPopups: new WeakMap(),
    uniquePopupEventId: 1,
    uniqueSandboxId: 1,
    modernFirefox: Services.vc.compare(Services.appinfo.platformVersion, '44') > 0,

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
        Services.obs.addObserver(this, 'content-document-global-created', true);

        // https://bugzilla.mozilla.org/show_bug.cgi?id=1232354
        // For modern versions of Firefox, the frameId/parentFrameId
        // information can be found in channel.loadInfo of the HTTP observer.
        if ( this.modernFirefox !== true ) {
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
        }
    },

    unregister: function() {
        Services.obs.removeObserver(this, 'document-element-inserted');
        Services.obs.removeObserver(this, 'content-document-global-created');

        if ( this.modernFirefox !== true ) {
            this.componentRegistrar.unregisterFactory(this.classID, this);
            this.categoryManager.deleteCategoryEntry(
                'content-policy',
                this.contractID,
                false
            );
        }
    },

    getFrameId: function(win) {
        return win
            .QueryInterface(Ci.nsIInterfaceRequestor)
            .getInterface(Ci.nsIDOMWindowUtils)
            .outerWindowID;
    },

    // https://bugzil.la/612921
    shouldLoad: function(type, location, origin, context) {
        // For whatever reason, sometimes the global scope is completely
        // uninitialized at this point. Repro steps:
        // - Launch FF with uBlock enabled
        // - Disable uBlock
        // - Enable uBlock
        // - Services and all other global variables are undefined
        // Hopefully will eventually understand why this happens.
        if ( Services === undefined || !context ) {
            return this.ACCEPT;
        }

        if ( !location.schemeIs('http') && !location.schemeIs('https') ) {
            return this.ACCEPT;
        }

        if ( type === this.MAIN_FRAME ) {
            context = context.contentWindow || context;
        } else if ( type === this.SUB_FRAME ) {
            context = context.contentWindow;
        } else {
            context = (context.ownerDocument || context).defaultView;
        }

        // https://github.com/gorhill/uBlock/issues/1893
        // I don't know why this happens. I observed that when it occurred, the
        // resource was not seen by the HTTP observer, as if it was a spurious
        // call to shouldLoad().
        if ( !context ) {
            return this.ACCEPT;
        }

        // The context for the toolbar popup is an iframe element here,
        // so check context.top instead of context
        if ( !context.top || !context.location ) {
            return this.ACCEPT;
        }

        let messageManager = getMessageManager(context);
        if ( messageManager === null ) {
            return this.ACCEPT;
        }

        let isTopContext = context === context.top;
        var parentFrameId;
        if ( isTopContext ) {
            parentFrameId = -1;
        } else if ( context.parent === context.top ) {
            parentFrameId = 0;
        } else {
            parentFrameId = this.getFrameId(context.parent);
        }

        let rpcData = this.rpcData;
        rpcData.frameId = isTopContext ? 0 : this.getFrameId(context);
        rpcData.pFrameId = parentFrameId;
        rpcData.type = type;
        rpcData.url = location.spec;

        //console.log('shouldLoad: type=' + type + ' url=' + location.spec);
        if ( typeof messageManager.sendRpcMessage === 'function' ) {
            // https://bugzil.la/1092216
            messageManager.sendRpcMessage(this.cpMessageName, rpcData);
        } else {
            // Compatibility for older versions
            messageManager.sendSyncMessage(this.cpMessageName, rpcData);
        }

        return this.ACCEPT;
    },

    // Reuse object to avoid repeated memory allocation.
    rpcData: { frameId: 0, pFrameId: -1, type: 0, url: '' },

    initContentScripts: function(win, create) {
        let messager = getMessageManager(win);
        let sandboxId = hostName + ':sb:' + this.uniqueSandboxId++;
        let sandbox;

        if ( create ) {
            let sandboxName = [
                win.location.href.slice(0, 100),
                win.document.title.slice(0, 100)
            ].join(' | ');

            // https://github.com/gorhill/uMatrix/issues/325
            // "Pass sameZoneAs to sandbox constructor to make GCs cheaper"
            sandbox = Cu.Sandbox([win], {
                sameZoneAs: win.top,
                sandboxName: sandboxId + '[' + sandboxName + ']',
                sandboxPrototype: win,
                wantComponents: false,
                wantXHRConstructor: false
            });

            sandbox.getScriptTagFilters = function(details) {
                return scriptTagFilterer.get(details);
            };

            sandbox.injectScript = function(script) {
                let svc = Services;
                // Sandbox appears void.
                // I've seen this happens, need to investigate why.
                if ( svc === undefined ) { return; }
                svc.scriptloader.loadSubScript(script, sandbox);
            };

            let canUserStyles = (function() {
                try {
                    return win.QueryInterface(Ci.nsIInterfaceRequestor)
                              .getInterface(Ci.nsIDOMWindowUtils)
                              .loadSheetUsingURIString instanceof Function;
                } catch(ex) {
                }
                return false;
            })();

            if ( canUserStyles ) {
                sandbox.injectCSS = function(sheetURI) {
                    try {
                        let wu = win.QueryInterface(Ci.nsIInterfaceRequestor)
                                    .getInterface(Ci.nsIDOMWindowUtils);
                        wu.loadSheetUsingURIString(sheetURI, wu.USER_SHEET);
                    } catch(ex) {
                    }
                };
                sandbox.removeCSS = function(sheetURI) {
                    try {
                        let wu = win.QueryInterface(Ci.nsIInterfaceRequestor)
                                    .getInterface(Ci.nsIDOMWindowUtils);
                        wu.removeSheetUsingURIString(sheetURI, wu.USER_SHEET);
                    } catch (ex) {
                    }
                };
            }

            sandbox.topContentScript = win === win.top;

            // https://developer.mozilla.org/en-US/Firefox/Multiprocess_Firefox/Message_Manager/Frame_script_loading_and_lifetime#Unloading_frame_scripts
            // The goal is to have content scripts removed from web pages. This
            // helps remove traces of uBlock from memory when disabling/removing
            // the addon.
            // For example, this takes care of:
            //   https://github.com/gorhill/uBlock/commit/ea4faff383789053f423498c1f1165c403fde7c7#commitcomment-11964137
            //   > "gets the whole selected tab flashing"
            sandbox.outerShutdown = function() {
                sandbox.removeMessageListener();
                sandbox.addMessageListener =
                sandbox.getScriptTagFilters =
                sandbox.injectCSS =
                sandbox.injectScript =
                sandbox.outerShutdown =
                sandbox.removeCSS =
                sandbox.removeMessageListener =
                sandbox.sendAsyncMessage = function(){};
                sandbox.vAPI = {};
                messager = null;
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

            sandbox._broadcastListener_ = function(message) {
                // https://github.com/gorhill/uBlock/issues/2014
                if ( sandbox.topContentScript ) {
                    let details;
                    try { details = JSON.parse(message.data); } catch (ex) {}
                    let msg = details && details.msg || {};
                    if ( msg.what === 'staticFilteringDataChanged' ) {
                        if ( scriptTagFilterer ) {
                            scriptTagFilterer.reset();
                        }
                    }
                }
                callback(message.data);
            };

            messager.addMessageListener(
                sandbox._sandboxId_,
                sandbox._messageListener_
            );
            messager.addMessageListener(
                hostName + ':broadcast',
                sandbox._broadcastListener_
            );
        };

        sandbox.removeMessageListener = function() {
            if ( !sandbox._messageListener_ ) {
                return;
            }
            // It throws sometimes, mostly when the popup closes
            try {
                messager.removeMessageListener(
                    sandbox._sandboxId_,
                    sandbox._messageListener_
                );
            } catch (ex) {
            }
            try {
                messager.removeMessageListener(
                    hostName + ':broadcast',
                    sandbox._broadcastListener_
                );
            } catch (ex) {
            }

            sandbox._messageListener_ = sandbox._broadcastListener_ = null;
        };

        return sandbox;
    },

    injectOtherContentScripts: function(doc, sandbox) {
        let docReady = (e) => {
            let doc = e.target;
            doc.removeEventListener(e.type, docReady, true);
            if ( doc.querySelector('a[href^="abp:"],a[href^="https://subscribe.adblockplus.org/?"]') ) {
                Services.scriptloader.loadSubScript(this.contentBaseURI + 'scriptlets/subscriber.js', sandbox);
            }
        };
        if ( doc.readyState === 'loading') {
            doc.addEventListener('DOMContentLoaded', docReady, true);
        } else {
            docReady({ target: doc, type: 'DOMContentLoaded' });
        }
    },

    ignorePopup: function(e) {
        if ( e.isTrusted === false ) { return; }
        let contObs = contentObserver;
        contObs.ignoredPopups.set(this, true);
        this.removeEventListener('keydown', contObs.ignorePopup, true);
        this.removeEventListener('mousedown', contObs.ignorePopup, true);
    },

    lookupPopupOpener: function(popup) {
        for (;;) {
            let opener = popup.opener;
            if ( !opener ) { return; }
            if ( opener.top ) { opener = opener.top; }
            if ( opener === popup ) { return; }
            if ( !opener.location ) { return; }
            if ( this.reValidPopups.test(opener.location.protocol) ) {
                return opener;
            }
            // https://github.com/uBlockOrigin/uAssets/issues/255
            // - Mind chained about:blank popups.
            if ( opener.location.href !== 'about:blank' ) { return; }
            popup = opener;
        }
    },

    reValidPopups: /^(?:blob|data|https?|javascript):/,
    reMustInjectScript: /^(?:file|https?):/,

    observe: function(subject, topic) {
        // For whatever reason, sometimes the global scope is completely
        // uninitialized at this point. Repro steps:
        // - Launch FF with uBlock enabled
        // - Disable uBlock
        // - Enable uBlock
        // - Services and all other global variables are undefined
        // Hopefully will eventually understand why this happens.
        if ( Services === undefined ) { return; }

        // https://github.com/gorhill/uBlock/issues/2290
        if ( topic === 'content-document-global-created' ) {
            if ( subject !== subject.top || !subject.opener ) { return; }
            if ( this.ignoredPopups.has(subject) ) { return; }
            let opener = this.lookupPopupOpener(subject);
            if ( !opener ) { return; }
            subject.addEventListener('keydown', this.ignorePopup, true);
            subject.addEventListener('mousedown', this.ignorePopup, true);
            let popupMessager = getMessageManager(subject);
            if ( !popupMessager ) { return; }
            let openerMessager = getMessageManager(opener);
            if ( !openerMessager ) { return; }
            popupMessager.sendAsyncMessage(this.popupMessageName, {
                id: this.uniquePopupEventId,
                popup: true
            });
            openerMessager.sendAsyncMessage(this.popupMessageName, {
                id: this.uniquePopupEventId,
                opener: true
            });
            this.uniquePopupEventId += 1;
            return;
        }

        // topic === 'document-element-inserted'

        let doc = subject;
        let win = doc.defaultView || null;
        if ( win === null ) { return; }

        // https://github.com/gorhill/uBlock/issues/260
        // https://developer.mozilla.org/en-US/docs/Web/API/Document/contentType
        //   "Non-standard, only supported by Gecko. To be used in 
        //   "chrome code (i.e. Extensions and XUL applications)."
        // TODO: We may have to exclude more types, for now let's be
        //   conservative and focus only on the one issue reported, i.e. let's
        //   not test against 'text/html'.
        if ( doc.contentType.startsWith('image/') ) { return; }

        let loc = win.location;
        if ( this.reMustInjectScript.test(loc.protocol) === false ) {
            if ( loc.protocol === 'chrome:' && loc.host === hostName ) {
                this.initContentScripts(win);
            }
            // What about data: and about:blank?
            return;
        }

        // Content scripts injection.
        let lss = Services.scriptloader.loadSubScript;
        let sandbox = this.initContentScripts(win, true);
        try {
            lss(this.contentBaseURI + 'vapi-client.js', sandbox);
            lss(this.contentBaseURI + 'contentscript.js', sandbox);
        } catch (ex) {
            //console.exception(ex.msg, ex.stack);
            return;
        }
        // The remaining scripts are worth injecting only on a top-level window
        // and at document_idle time.
        if ( win === win.top ) {
            this.injectOtherContentScripts(doc, sandbox);
        }
    }
};

/******************************************************************************/

var processObserver = {
    start: function() {
        scriptTagFilterer.reset();
    }
};

/******************************************************************************/

var LocationChangeListener = function(docShell, webProgress) {
    var mm = docShell.QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIContentFrameMessageManager);
    if ( !mm || typeof mm.sendAsyncMessage !== 'function' ) {
        return;
    }
    this.messageManager = mm;
    webProgress.addProgressListener(this, Ci.nsIWebProgress.NOTIFY_LOCATION);
};

LocationChangeListener.prototype.messageName = hostName + ':locationChanged';

LocationChangeListener.prototype.QueryInterface = XPCOMUtils.generateQI([
    'nsIWebProgressListener',
    'nsISupportsWeakReference'
]);

LocationChangeListener.prototype.onLocationChange = function(webProgress, request, location, flags) {
    if ( !webProgress.isTopLevel ) {
        return;
    }
    this.messageManager.sendAsyncMessage(this.messageName, {
        url: location.asciiSpec,
        flags: flags
    });
};

/******************************************************************************/

contentObserver.register();

/******************************************************************************/

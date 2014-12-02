/* globals Services, sendAsyncMessage, addMessageListener, removeMessageListener, content */

(function() {

'use strict';

let appName = 'ublock';
let contentBaseURI = 'chrome://' + appName + '/content/js/';
let listeners = {};

let _addMessageListener = function(id, fn) {
    _removeMessageListener(id);
    listeners[id] = function(msg) {
        fn(msg.data);
    };
    addMessageListener(id, listeners[id]);
};

let _removeMessageListener = function(id) {
    if (listeners[id]) {
        removeMessageListener(id, listeners[id]);
    }

    delete listeners[id];
};

addMessageListener('µBlock:broadcast', function(msg) {
    for (let id in listeners) {
        listeners[id](msg);
    }
});

let initContext = function(win, sandbox) {
    if (sandbox) {
        win = Components.utils.Sandbox([win], {
            sandboxPrototype: win,
            wantComponents: false,
            wantXHRConstructor: false
        });
    }

    win.sendAsyncMessage = sendAsyncMessage;
    win.addMessageListener = _addMessageListener;
    win.removeMessageListener = _removeMessageListener;

    return win;
};

let observer = {
    observe: function(win) {
        if (!win || win.top !== content) {
            return;
        }

        if (!(win.document instanceof win.HTMLDocument
            && (/^https?:$/.test(win.location.protocol)))) {
            return;
        }

        let lss = Services.scriptloader.loadSubScript;
        win = initContext(win, true);

        lss(contentBaseURI + 'vapi-client.js', win);
        lss(contentBaseURI + 'contentscript-start.js', win);

        if (win.document.readyState === 'loading') {
            let docReady = function(e) {
                this.removeEventListener(e.type, docReady, true);
                lss(contentBaseURI + 'contentscript-end.js', win);
            };

            win.document.addEventListener('DOMContentLoaded', docReady, true);
        }
        else {
            lss(contentBaseURI + 'contentscript-end.js', win);
        }
    }
};

Services.obs.addObserver(observer, 'content-document-global-created', false);

let DOMReady = function(e) {
    let win = e.target.defaultView;

    // inject the message handlers for the options page
    if (win.location.protocol === 'chrome:' && win.location.host === appName) {
        initContext(win);
    }
};

addEventListener('DOMContentLoaded', DOMReady, true);

addEventListener('unload', function() {
    Services.obs.removeObserver(observer, 'content-document-global-created');
    observer = listeners = null;
}, false);

})();
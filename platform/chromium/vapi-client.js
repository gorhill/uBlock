/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 The µBlock authors

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

/* global HTMLDocument, XMLDocument */

// For non background pages

/******************************************************************************/

(function(self) {

'use strict';

/******************************************************************************/
/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/464
if ( document instanceof HTMLDocument === false ) {
    // https://github.com/chrisaljoudi/uBlock/issues/1528
    // A XMLDocument can be a valid HTML document.
    if (
        document instanceof XMLDocument === false ||
        document.createElement('div') instanceof HTMLDivElement === false
    ) {
        return;
    }
}

// https://github.com/gorhill/uBlock/issues/1124
// Looks like `contentType` is on track to be standardized:
//   https://dom.spec.whatwg.org/#concept-document-content-type
if ( (document.contentType || '').lastIndexOf('image/', 0) === 0 ) {
    return; 
}

/******************************************************************************/

var vAPI = self.vAPI = self.vAPI || {};
var chrome = self.chrome;

// https://github.com/chrisaljoudi/uBlock/issues/456
// Already injected?
if ( vAPI.sessionId ) {
    return;
}

vAPI.sessionId = String.fromCharCode(Date.now() % 26 + 97) +
                 Math.random().toString(36).slice(2);
vAPI.chrome = true;

/******************************************************************************/

vAPI.setTimeout = vAPI.setTimeout || self.setTimeout.bind(self);

/******************************************************************************/

vAPI.shutdown = (function() {
    var jobs = [];

    var add = function(job) {
        jobs.push(job);
    };

    var exec = function() {
        var job;
        while ( (job = jobs.pop()) ) {
            job();
        }
    };

    return {
        add: add,
        exec: exec
    };
})();

/******************************************************************************/
/******************************************************************************/

vAPI.messaging = {
    port: null,
    portTimer: null,
    portTimerDelay: 10000,
    channels: Object.create(null),
    channelCount: 0,
    pending: Object.create(null),
    pendingCount: 0,
    auxProcessId: 1,
    shuttingDown: false,

    shutdown: function() {
        this.shuttingDown = true;
        this.destroyPort();
    },

    disconnectListener: function() {
        this.port = null;
        vAPI.shutdown.exec();
    },
    disconnectListenerCallback: null,

    messageListener: function(details) {
        if ( !details ) {
            return;
        }

        // Sent to all channels
        if ( details.broadcast === true && !details.channelName ) {
            for ( var channelName in this.channels ) {
                this.sendToChannelListeners(channelName, details.msg);
            }
            return;
        }

        // Response to specific message previously sent
        if ( details.auxProcessId ) {
            var listener = this.pending[details.auxProcessId];
            delete this.pending[details.auxProcessId];
            delete details.auxProcessId; // TODO: why?
            if ( listener ) {
                this.pendingCount -= 1;
                listener(details.msg);
                return;
            }
        }

        // Sent to a specific channel
        var response = this.sendToChannelListeners(details.channelName, details.msg);

        // Respond back if required
        if ( details.mainProcessId === undefined ) {
            return;
        }
        var port = this.connect();
        if ( port !== null ) {
            port.postMessage({
                mainProcessId: details.mainProcessId,
                msg: response
            });
        }
    },
    messageListenerCallback: null,

    portPoller: function() {
        this.portTimer = null;
        if ( this.port !== null ) {
            if ( this.channelCount !== 0 || this.pendingCount !== 0 ) {
                this.portTimer = vAPI.setTimeout(this.portPollerCallback, this.portTimerDelay);
                this.portTimerDelay = Math.min(this.portTimerDelay * 2, 60 * 60 * 1000);
                return;
            }
        }
        this.destroyPort();
    },
    portPollerCallback: null,

    destroyPort: function() {
        if ( this.portTimer !== null ) {
            clearTimeout(this.portTimer);
            this.portTimer = null;
        }
        var port = this.port;
        if ( port !== null ) {
            port.disconnect();
            port.onMessage.removeListener(this.messageListenerCallback);
            port.onDisconnect.removeListener(this.disconnectListenerCallback);
            this.port = null;
        }
        if ( this.channelCount !== 0 ) {
            this.channels = Object.create(null);
            this.channelCount = 0;
        }
        // service pending callbacks
        if ( this.pendingCount !== 0 ) {
            var pending = this.pending, callback;
            this.pending = Object.create(null);
            this.pendingCount = 0;
            for ( var auxId in pending ) {
                callback = pending[auxId];
                if ( typeof callback === 'function' ) {
                    callback(null);
                }
            }
        }
    },

    createPort: function() {
        if ( this.shuttingDown ) {
            return null;
        }
        if ( this.messageListenerCallback === null ) {
            this.messageListenerCallback = this.messageListener.bind(this);
            this.disconnectListenerCallback = this.disconnectListener.bind(this);
            this.portPollerCallback = this.portPoller.bind(this);
        }
        try {
            this.port = chrome.runtime.connect({name: vAPI.sessionId}) || null;
        } catch (ex) {
            this.port = null;
        }
        if ( this.port !== null ) {
            this.port.onMessage.addListener(this.messageListenerCallback);
            this.port.onDisconnect.addListener(this.disconnectListenerCallback);
        }
        this.portTimerDelay = 10000;
        if ( this.portTimer === null ) {
            this.portTimer = vAPI.setTimeout(this.portPollerCallback, this.portTimerDelay);
        }
        return this.port;
    },

    connect: function() {
        return this.port !== null ? this.port : this.createPort();
    },

    send: function(channelName, message, callback) {
        this.sendTo(channelName, message, undefined, undefined, callback);
    },

    sendTo: function(channelName, message, toTabId, toChannel, callback) {
        // Too large a gap between the last request and the last response means
        // the main process is no longer reachable: memory leaks and bad
        // performance become a risk -- especially for long-lived, dynamic
        // pages. Guard against this.
        if ( this.pendingCount > 25 ) {
            vAPI.shutdown.exec();
        }
        var port = this.connect();
        if ( port === null ) {
            if ( typeof callback === 'function' ) {
                callback();
            }
            return;
        }
        var auxProcessId;
        if ( callback ) {
            auxProcessId = this.auxProcessId++;
            this.pending[auxProcessId] = callback;
            this.pendingCount += 1;
        }
        port.postMessage({
            channelName: channelName,
            auxProcessId: auxProcessId,
            toTabId: toTabId,
            toChannel: toChannel,
            msg: message
        });
    },

    addChannelListener: function(channelName, callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }
        var listeners = this.channels[channelName];
        if ( listeners !== undefined && listeners.indexOf(callback) !== -1 ) {
            console.error('Duplicate listener on channel "%s"', channelName);
            return;
        }
        if ( listeners === undefined ) {
            this.channels[channelName] = [callback];
            this.channelCount += 1;
        } else {
            listeners.push(callback);
        }
        this.connect();
    },

    removeChannelListener: function(channelName, callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }
        var listeners = this.channels[channelName];
        if ( listeners === undefined ) {
            return;
        }
        var pos = this.listeners.indexOf(callback);
        if ( pos === -1 ) {
            console.error('Listener not found on channel "%s"', channelName);
            return;
        }
        listeners.splice(pos, 1);
        if ( listeners.length === 0 ) {
            delete this.channels[channelName];
            this.channelCount -= 1;
        }
    },

    removeAllChannelListeners: function(channelName) {
        var listeners = this.channels[channelName];
        if ( listeners === undefined ) {
            return;
        }
        delete this.channels[channelName];
        this.channelCount -= 1;
    },

    sendToChannelListeners: function(channelName, msg) {
        var listeners = this.channels[channelName];
        if ( listeners === undefined ) {
            return;
        }
        var response;
        for ( var i = 0, n = listeners.length; i < n; i++ ) {
            response = listeners[i](msg);
            if ( response !== undefined ) {
                break;
            }
        }
        return response;
    }
};

/******************************************************************************/

vAPI.shutdown.add(function() {
    vAPI.messaging.shutdown();
    delete window.vAPI;
});

// https://www.youtube.com/watch?v=rT5zCHn0tsg
// https://www.youtube.com/watch?v=E-jS4e3zacI

/******************************************************************************/

// https://bugs.chromium.org/p/chromium/issues/detail?id=129353
// https://github.com/gorhill/uBlock/issues/956
// https://github.com/gorhill/uBlock/issues/1497
// Trap calls to WebSocket constructor, and expose websocket-based network
// requests to uBO's filtering engine, logger, etc.
// Counterpart of following block of code is found in "vapi-background.js" --
// search for "https://github.com/gorhill/uBlock/issues/1497".

(function() {
    // Don't bother if WebSocket is not supported.
    if ( window.WebSocket instanceof Function === false ) {
        return;
    }

    // Only for http/https documents.
    if ( /^https?:/.test(window.location.protocol) !== true ) {
        return;
    }

    var doc = document;
    var parent = doc.head || doc.documentElement;
    if ( parent === null ) {
        return;
    }

    // WebSocket reference: https://html.spec.whatwg.org/multipage/comms.html
    // The script tag will remove itself from the DOM once it completes
    // execution.
    // Ideally, the `js/websocket.js` script would be declared as a
    // `web_accessible_resources` in the manifest, but this unfortunately would
    // open the door for web pages to identify *directly* that one is using
    // uBlock Origin. Consequently, I have to inject the code as a literal
    // string below :(
    // For code review, the stringified code below is found in
    // `js/websocket.js` (comments were stripped).
    var script = doc.createElement('script');
    script.id = 'ubofix-f41665f3028c7fd10eecf573336216d3';
    script.textContent = [
        "(function() {",
        "    'use strict';",
        "",
        "    var WS = window.WebSocket;",
        "    var toWrapped = new WeakMap();",
        "",
        "    var onClose = function(ev) {",
        "        var wrapped = toWrapped.get(this);",
        "        if ( !wrapped ) {",
        "            return;",
        "        }",
        "        this.readyState = wrapped.readyState;",
        "        if ( this.onclose !== null ) {",
        "            this.onclose(ev);",
        "        }",
        "    };",
        "",
        "    var onError = function(ev) {",
        "        var wrapped = toWrapped.get(this);",
        "        if ( !wrapped ) {",
        "            return;",
        "        }",
        "        this.readyState = wrapped.readyState;",
        "        if ( this.onerror !== null ) {",
        "            this.onerror(ev);",
        "        }",
        "    };",
        "",
        "    var onMessage = function(ev) {",
        "        if ( this.onmessage !== null ) {",
        "            this.onmessage(ev);",
        "        }",
        "    };",
        "",
        "    var onOpen = function(ev) {",
        "        var wrapped = toWrapped.get(this);",
        "        if ( !wrapped ) {",
        "            return;",
        "        }",
        "        this.readyState = wrapped.readyState;",
        "        if ( this.onopen !== null ) {",
        "            this.onopen(ev);",
        "        }",
        "    };",
        "",
        "    var onAllowed = function(ws, url, protocols) {",
        "        this.removeEventListener('load', onAllowed);",
        "        this.removeEventListener('error', onBlocked);",
        "        connect(ws, url, protocols);",
        "    };",
        "",
        "    var onBlocked = function(ws) {",
        "        this.removeEventListener('load', onAllowed);",
        "        this.removeEventListener('error', onBlocked);",
        "        if ( ws.onerror !== null ) {",
        "            ws.onerror(new window.ErrorEvent('error'));",
        "        }",
        "    };",
        "",
        "    var connect = function(wrapper, url, protocols) {",
        "        var wrapped = new WS(url, protocols);",
        "        toWrapped.set(wrapper, wrapped);",
        "        wrapped.onclose = onClose.bind(wrapper);",
        "        wrapped.onerror = onError.bind(wrapper);",
        "        wrapped.onmessage = onMessage.bind(wrapper);",
        "        wrapped.onopen = onOpen.bind(wrapper);",
        "    };",
        "",
        "    var WebSocket = function(url, protocols) {",
        "        this.binaryType = '';",
        "        this.bufferedAmount = 0;",
        "        this.extensions = '';",
        "        this.onclose = null;",
        "        this.onerror = null;",
        "        this.onmessage = null;",
        "        this.onopen = null;",
        "        this.protocol = '';",
        "        this.readyState = this.CONNECTING;",
        "        this.url = url;",
        "",
        "        if ( /^wss?:\\/\\//.test(url) === false ) {",
        "            connect(this, url, protocols);",
        "            return;",
        "        }",
        "",
        "        var img = new Image();",
        "        img.src = ",
        "              window.location.origin",
        "            + '?url=' + encodeURIComponent(url)",
        "            + '&ubofix=f41665f3028c7fd10eecf573336216d3';",
        "        img.addEventListener('load', onAllowed.bind(img, this, url, protocols));",
        "        img.addEventListener('error', onBlocked.bind(img, this, url, protocols));",
        "    };",
        "",
        "    WebSocket.prototype.close = function(code, reason) {",
        "        var wrapped = toWrapped.get(this);",
        "        if ( !wrapped ) {",
        "            return;",
        "        }",
        "        wrapped.close(code, reason);",
        "    };",
        "",
        "    WebSocket.prototype.send = function(data) {",
        "        var wrapped = toWrapped.get(this);",
        "        if ( !wrapped ) {",
        "            return;",
        "        }",
        "        wrapped.send(data);",
        "    };",
        "",
        "    WebSocket.prototype.CONNECTING = 0;",
        "    WebSocket.prototype.OPEN = 1;",
        "    WebSocket.prototype.CLOSING = 2;",
        "    WebSocket.prototype.CLOSED = 3;",
        "",
        "    window.WebSocket = WebSocket;",
        "",
        "    var me = document.getElementById('ubofix-f41665f3028c7fd10eecf573336216d3');",
        "    if ( me !== null && me.parentNode !== null ) {",
        "        me.parentNode.removeChild(me);",
        "    }",
        "})();",
    ].join('\n');

    try {
        parent.appendChild(script);
    } catch (ex) {
    }
})();

/******************************************************************************/
/******************************************************************************/

})(this);

/******************************************************************************/

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
    // Fix won't be applied on older versions of Chromium.
    if (
        window.WebSocket instanceof Function === false ||
        window.WeakMap instanceof Function === false
    ) {
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
        "    var Wrapped = window.WebSocket;",
        "    var toWrapped = new WeakMap();",
        "",
        "    var onResponseReceived = function(wrapper, ok) {",
        "        this.onload = this.onerror = null;",
        "        var bag = toWrapped.get(wrapper);",
        "        if ( !ok ) {",
        "            if ( bag.properties.onerror ) {",
        "                bag.properties.onerror(new window.ErrorEvent('error'));",
        "            }",
        "            return;",
        "        }",
        "        var wrapped = new Wrapped(bag.args.url, bag.args.protocols);",
        "        for ( var prop in bag.properties ) {",
        "            wrapped[prop] = bag.properties[prop];",
        "        }",
        "        toWrapped.set(wrapper, wrapped);",
        "    };",
        "",
        "    var noopfn = function() {",
        "    };",
        "",
        "    var fallthruGet = function(wrapper, prop, value) {",
        "        var wrapped = toWrapped.get(wrapper);",
        "        if ( !wrapped ) {",
        "            return value;",
        "        }",
        "        if ( wrapped instanceof Wrapped ) {",
        "            return wrapped[prop];",
        "        }",
        "        return wrapped.properties.hasOwnProperty(prop) ?",
        "            wrapped.properties[prop] :",
        "            value;",
        "    };",
        "",
        "    var fallthruSet = function(wrapper, prop, value) {",
        "        if ( value instanceof Function ) {",
        "            value = value.bind(wrapper);",
        "        }",
        "        var wrapped = toWrapped.get(wrapper);",
        "        if ( !wrapped ) {",
        "            return;",
        "        }",
        "        if ( wrapped instanceof Wrapped ) {",
        "            wrapped[prop] = value;",
        "        } else {",
        "            wrapped.properties[prop] = value;",
        "        }",
        "    };",
        "",
        "    var WebSocket = function(url, protocols) {",
        "        if ( window.location.protocol === 'https:' && /^ws:/.test(url) ) {",
        "            var ws = new Wrapped(url, protocols);",
        "            if ( ws ) {",
        "                ws.close();",
        "            }",
        "        }",
        "",
        "        Object.defineProperties(this, {",
        "            'binaryType': {",
        "                get: function() {",
        "                    return fallthruGet(this, 'binaryType', '');",
        "                },",
        "                set: function(value) {",
        "                    fallthruSet(this, 'binaryType', value);",
        "                }",
        "            },",
        "            'bufferedAmount': {",
        "                get: function() {",
        "                    return fallthruGet(this, 'bufferedAmount', 0);",
        "                },",
        "                set: noopfn",
        "            },",
        "            'extensions': {",
        "                get: function() {",
        "                    return fallthruGet(this, 'extensions', '');",
        "                },",
        "                set: noopfn",
        "            },",
        "            'onclose': {",
        "                get: function() {",
        "                    return fallthruGet(this, 'onclose', null);",
        "                },",
        "                set: function(value) {",
        "                    fallthruSet(this, 'onclose', value);",
        "                }",
        "            },",
        "            'onerror': {",
        "                get: function() {",
        "                    return fallthruGet(this, 'onerror', null);",
        "                },",
        "                set: function(value) {",
        "                    fallthruSet(this, 'onerror', value);",
        "                }",
        "            },",
        "            'onmessage': {",
        "                get: function() {",
        "                    return fallthruGet(this, 'onmessage', null);",
        "                },",
        "                set: function(value) {",
        "                    fallthruSet(this, 'onmessage', value);",
        "                }",
        "            },",
        "            'onopen': {",
        "                get: function() {",
        "                    return fallthruGet(this, 'onopen', null);",
        "                },",
        "                set: function(value) {",
        "                    fallthruSet(this, 'onopen', value);",
        "                }",
        "            },",
        "            'protocol': {",
        "                get: function() {",
        "                    return fallthruGet(this, 'protocol', '');",
        "                },",
        "                set: noopfn",
        "            },",
        "            'readyState': {",
        "                get: function() {",
        "                    return fallthruGet(this, 'readyState', 0);",
        "                },",
        "                set: noopfn",
        "            },",
        "            'url': {",
        "                get: function() {",
        "                    return fallthruGet(this, 'url', '');",
        "                },",
        "                set: noopfn",
        "            }",
        "        });",
        "",
        "        toWrapped.set(this, {",
        "            args: { url: url, protocols: protocols },",
        "            properties: {}",
        "        });",
        "",
        "        var img = new Image();",
        "        img.src = ",
        "              window.location.origin",
        "            + '?url=' + encodeURIComponent(url)",
        "            + '&ubofix=f41665f3028c7fd10eecf573336216d3';",
        "        img.onload = onResponseReceived.bind(img, this, true);",
        "        img.onerror = onResponseReceived.bind(img, this, false);",
        "    };",
        "",
        "    WebSocket.prototype.CONNECTING = 0;",
        "    WebSocket.prototype.OPEN = 1;",
        "    WebSocket.prototype.CLOSING = 2;",
        "    WebSocket.prototype.CLOSED = 3;",
        "",
        "    WebSocket.prototype.close = function(code, reason) {",
        "        var wrapped = toWrapped.get(this);",
        "        if ( wrapped instanceof Wrapped ) {",
        "            wrapped.close(code, reason);",
        "        }",
        "    };",
        "",
        "    WebSocket.prototype.send = function(data) {",
        "        var wrapped = toWrapped.get(this);",
        "        if ( wrapped instanceof Wrapped ) {",
        "            wrapped.send(data);",
        "        }",
        "    };",
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

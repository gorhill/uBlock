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

/* global HTMLDocument, XMLDocument */

// For non background pages

/******************************************************************************/

(function(self) {

'use strict';

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

vAPI.messaging = {
    port: null,
    channels: {},
    pending: {},
    pendingCount: 0,
    auxProcessId: 1,

    onDisconnect: function() {
        this.port = null;
        this.close();
        vAPI.shutdown.exec();
    },

    setup: function() {
        try {
            this.port = chrome.runtime.connect({name: vAPI.sessionId}) || null;
        } catch (ex) {
        }
        if ( this.port === null ) {
            vAPI.shutdown.exec();
            return false;
        }
        this.port.onMessage.addListener(messagingConnector);
        this.port.onDisconnect.addListener(this.onDisconnect.bind(this));
        return true;
    },

    close: function() {
        var port = this.port;
        if ( port !== null ) {
            port.disconnect();
            port.onMessage.removeListener(messagingConnector);
            port.onDisconnect.removeListener(this.onDisconnect);
            this.port = null;
        }
        this.channels = {};
        // service pending callbacks
        var pending = this.pending, listener;
        this.pending = {};
        this.pendingCount = 0;
        for ( var auxId in pending ) {
            if ( this.pending.hasOwnProperty(auxId) ) {
                listener = pending[auxId];
                if ( typeof listener === 'function' ) {
                    listener(null);
                }
            }
        }
    },

    channel: function(channelName, callback) {
        if ( !channelName ) {
            return;
        }
        var channel = this.channels[channelName];
        if ( channel instanceof MessagingChannel ) {
            channel.addListener(callback);
            channel.refCount += 1;
        } else {
            channel = this.channels[channelName] = new MessagingChannel(channelName, callback);
        }
        return channel;
    }
};

/******************************************************************************/

var messagingConnector = function(details) {
    if ( !details ) {
        return;
    }

    var messaging = vAPI.messaging;
    var channels = messaging.channels;
    var channel;

    // Sent to all channels
    if ( details.broadcast === true && !details.channelName ) {
        for ( channel in channels ) {
            if ( channels[channel] instanceof MessagingChannel === false ) {
                continue;
            }
            channels[channel].sendToListeners(details.msg);
        }
        return;
    }

    // Response to specific message previously sent
    if ( details.auxProcessId ) {
        var listener = messaging.pending[details.auxProcessId];
        delete messaging.pending[details.auxProcessId];
        delete details.auxProcessId; // TODO: why?
        if ( listener ) {
            messaging.pendingCount -= 1;
            listener(details.msg);
            return;
        }
    }

    // Sent to a specific channel
    var response;
    channel = channels[details.channelName];
    if ( channel instanceof MessagingChannel ) {
        response = channel.sendToListeners(details.msg);
    }

    // Respond back if required
    if ( details.mainProcessId !== undefined ) {
        messaging.port.postMessage({
            mainProcessId: details.mainProcessId,
            msg: response
        });
    }
};

/******************************************************************************/

var MessagingChannel = function(name, listener) {
    this.channelName = name;
    this.listeners = typeof listener === 'function' ? [listener] : [];
    this.refCount = 1;
    if ( typeof listener === 'function' ) {
        var messaging = vAPI.messaging;
        if ( messaging.port === null ) {
            messaging.setup();
        }
    }
};

MessagingChannel.prototype.send = function(message, callback) {
    this.sendTo(message, undefined, undefined, callback);
};

MessagingChannel.prototype.sendTo = function(message, toTabId, toChannel, callback) {
    var messaging = vAPI.messaging;
    // Too large a gap between the last request and the last response means
    // the main process is no longer reachable: memory leaks and bad
    // performance become a risk -- especially for long-lived, dynamic
    // pages. Guard against this.
    if ( messaging.pendingCount > 25 ) {
        //console.error('uBlock> Sigh. Main process is sulking. Will try to patch things up.');
        messaging.close();
    }
    if ( messaging.port === null ) {
        if ( messaging.setup() === false ) {
            if ( typeof callback === 'function' ) {
                callback();
            }
            return;
        }
    }
    var auxProcessId;
    if ( callback ) {
        auxProcessId = messaging.auxProcessId++;
        messaging.pending[auxProcessId] = callback;
        messaging.pendingCount += 1;
    }
    messaging.port.postMessage({
        channelName: this.channelName,
        auxProcessId: auxProcessId,
        toTabId: toTabId,
        toChannel: toChannel,
        msg: message
    });
};

MessagingChannel.prototype.close = function() {
    this.refCount -= 1;
    if ( this.refCount !== 0 ) {
        return;
    }
    var messaging = vAPI.messaging;
    delete messaging.channels[this.channelName];
    if ( Object.keys(messaging.channels).length === 0 ) {
        messaging.close();
    }
};

MessagingChannel.prototype.addListener = function(callback) {
    if ( typeof callback !== 'function' ) {
        return;
    }
    if ( this.listeners.indexOf(callback) !== -1 ) {
        throw new Error('Duplicate listener.');
    }
    this.listeners.push(callback);
    var messaging = vAPI.messaging;
    if ( messaging.port === null ) {
        messaging.setup();
    }
};

MessagingChannel.prototype.removeListener = function(callback) {
    if ( typeof callback !== 'function' ) {
        return;
    }
    var pos = this.listeners.indexOf(callback);
    if ( pos === -1 ) {
        throw new Error('Listener not found.');
    }
    this.listeners.splice(pos, 1);
};

MessagingChannel.prototype.removeAllListeners = function() {
    this.listeners = [];
};

MessagingChannel.prototype.sendToListeners = function(msg) {
    var response;
    var listeners = this.listeners;
    for ( var i = 0, n = listeners.length; i < n; i++ ) {
        response = listeners[i](msg);
        if ( response !== undefined ) {
            break;
        }
    }
    return response;
};

// https://www.youtube.com/watch?v=rT5zCHn0tsg
// https://www.youtube.com/watch?v=E-jS4e3zacI

/******************************************************************************/

// No need to have vAPI client linger around after shutdown if
// we are not a top window (because element picker can still
// be injected in top window).
if ( window !== window.top ) {
    vAPI.shutdown.add(function() {
        vAPI = null;
    });
}

/******************************************************************************/

})(this);

/******************************************************************************/

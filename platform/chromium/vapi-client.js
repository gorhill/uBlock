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

// For non background pages

/******************************************************************************/

(function(self) {

'use strict';

/******************************************************************************/

var vAPI = self.vAPI = self.vAPI || {};
var chrome = self.chrome;

// https://github.com/chrisaljoudi/uBlock/issues/456
// Already injected?
if ( vAPI.vapiClientInjected ) {
    //console.debug('vapi-client.js already injected: skipping.');
    return;
}

vAPI.vapiClientInjected = true;
vAPI.sessionId = String.fromCharCode(Date.now() % 25 + 97) +
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
        //console.debug('Shutting down...');
        var job;
        while ( job = jobs.pop() ) {
            job();
        }
    };

    return {
        add: add,
        exec: exec
    };
})();

/******************************************************************************/

var MessagingListeners = function(callback) {
    this.listeners = [];
    if ( typeof callback === 'function' ) {
        this.listeners.push(callback);
    }
};

MessagingListeners.prototype.add = function(callback) {
    if ( typeof callback !== 'function' ) {
        return;
    }
    if ( this.listeners.indexOf(callback) !== -1 ) {
        throw new Error('Duplicate listener.');
    }
    this.listeners.push(callback);
};

MessagingListeners.prototype.remove = function(callback) {
    if ( typeof callback !== 'function' ) {
        return;
    }
    if ( this.listeners.indexOf(callback) === -1 ) {
        throw new Error('Listener not found.');
    }
    this.listeners.splice(this.listeners.indexOf(callback), 1);
};

MessagingListeners.prototype.process = function(msg) {
    var listeners = this.listeners;
    var n = listeners.length;
    for ( var i = 0; i < n; i++ ) {
        listeners[i](msg);
    }
};

/******************************************************************************/

var messagingConnector = function(response) {
    if ( !response ) {
        return;
    }

    var messaging = vAPI.messaging;
    var channels = messaging.channels;
    var channel;

    // Sent to all channels
    if ( response.broadcast === true && !response.channelName ) {
        for ( channel in channels ) {
            if ( channels[channel] instanceof MessagingChannel === false ) {
                continue;
            }
            channels[channel].listeners.process(response.msg);
        }
        return;
    }

    // Response to specific message previously sent
    if ( response.requestId ) {
        var listener = messaging.pending[response.requestId];
        delete messaging.pending[response.requestId];
        delete response.requestId; // TODO: why?
        if ( listener ) {
            listener(response.msg);
            return;
        }
    }

    // Sent to a specific channel
    channel = channels[response.channelName];
    if ( channel instanceof MessagingChannel ) {
        channel.listeners.process(response.msg);
    }
};

/******************************************************************************/

var MessagingChannel = function(name, callback) {
    this.channelName = name;
    this.listeners = new MessagingListeners(callback);
    this.refCount = 1;
    if ( typeof callback === 'function' ) {
        var messaging = vAPI.messaging;
        if ( messaging.port === null ) {
            messaging.setup();
        }
    }
};

MessagingChannel.prototype.send = function(message, callback) {
    var messaging = vAPI.messaging;
    if ( messaging.port === null ) {
        messaging.setup();
    }
    var requestId;
    if ( callback ) {
        requestId = messaging.requestId++;
        messaging.pending[requestId] = callback;
    }
    messaging.port.postMessage({
        channelName: this.channelName,
        requestId: requestId,
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
    this.listeners.add(callback);
    var messaging = vAPI.messaging;
    if ( messaging.port === null ) {
        messaging.setup();
    }
};

MessagingChannel.prototype.removeListener = function(callback) {
    if ( typeof callback !== 'function' ) {
        return;
    }
    this.listeners.remove(callback);
};

/******************************************************************************/

vAPI.messaging = {
    port: null,
    channels: {},
    pending: {},
    requestId: 1,

    setup: function() {
        this.port = chrome.runtime.connect({name: vAPI.sessionId});
        this.port.onMessage.addListener(messagingConnector);
    },

    close: function() {
        if ( this.port === null ) {
            return;
        }
        this.port.disconnect();
        this.port.onMessage.removeListener(messagingConnector);
        this.port = null;
        this.channels = {};
        this.pending = {};
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

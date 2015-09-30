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

/* global addMessageListener, removeMessageListener, sendAsyncMessage, outerShutdown */

// For non background pages

/******************************************************************************/

(function(self) {

'use strict';

/******************************************************************************/

// Not all sandboxes are given an rpc function, so assign a dummy one if it is
// missing -- this avoids the need for testing before use.

self.rpc = self.rpc || function(){};

/******************************************************************************/

var vAPI = self.vAPI = self.vAPI || {};
vAPI.firefox = true;
vAPI.sessionId = String.fromCharCode(Date.now() % 26 + 97) +
    Math.random().toString(36).slice(2);

/******************************************************************************/

vAPI.setTimeout = vAPI.setTimeout || function(callback, delay, extra) {
    return setTimeout(function(a) { callback(a); }, delay, extra);
};

/******************************************************************************/

vAPI.shutdown = (function() {
    var jobs = [];

    var add = function(job) {
        jobs.push(job);
    };

    var exec = function() {
        //console.debug('Shutting down...');
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

(function() {
    var hostname = location.hostname;
    if ( !hostname ) {
        return;
    }
    var filters = self.rpc({
        fnName: 'getScriptTagFilters',
        url: location.href,
        hostname: hostname
    });
    if ( typeof filters !== 'string' || filters === '' ) {
        return;
    }
    var reFilters = new RegExp(filters);
    document.addEventListener('beforescriptexecute', function(ev) {
        if ( reFilters.test(ev.target.textContent) ) {
            ev.preventDefault();
            ev.stopPropagation();
        }
    });
})();

/******************************************************************************/

vAPI.messaging = {
    channels: {},
    pending: {},
    pendingCount: 0,
    auxProcessId: 1,
    connected: false,
    connector: function(msg) {
        messagingConnector(JSON.parse(msg));
    },

    builtinChannelHandler: function(msg) {
        if ( msg.cmd === 'injectScript' ) {
            // injectScript is not always present.
            // - See contentObserver.initContentScripts in frameModule.js
            if ( typeof self.injectScript !== 'function' )  {
                return;
            }
            var details = msg.details;
            if ( !details.allFrames && window !== window.top ) {
                return;
            }
            self.injectScript(details.file);
            return;
        }
        if ( msg.cmd === 'shutdownSandbox' ) {
            vAPI.shutdown.exec();
            vAPI.messaging.shutdown();
            if ( typeof self.outerShutdown === 'function' ) {
                outerShutdown();
            }
            return;
        }
    },

    setup: function() {
        this.channels['vAPI'] = new MessagingChannel('vAPI', this.builtinChannelHandler);
        window.addEventListener('pagehide', this.toggleListener, true);
        window.addEventListener('pageshow', this.toggleListener, true);
    },

    shutdown: function() {
        this.close();
        window.removeEventListener('pagehide', this.toggleListener, true);
        window.removeEventListener('pageshow', this.toggleListener, true);
        vAPI.messaging = null;
    },

    close: function() {
        this.disconnect();
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
    },

    connect: function() {
        if ( !this.connected ) {
            addMessageListener(this.connector);
            this.connected = true;
        }
    },

    disconnect: function() {
        if ( this.connected ) {
            removeMessageListener();
            this.connected = false;
        }
    },

    toggleListener: function({type, persisted}) {
        var me = vAPI.messaging;
        if ( !me ) {
            return;
        }

        if ( type === 'pagehide' ) {
            if ( !persisted ) {
                vAPI.shutdown.exec();
                vAPI.messaging.shutdown();
                if ( typeof self.outerShutdown === 'function' ) {
                    outerShutdown();
                }
            }
            me.disconnect();
            return;
        }

        me.connect();
    }
};

/******************************************************************************/

var messagingConnector = function(details) {
    if ( !details ) {
        return;
    }

    var messaging = vAPI.messaging;

    // Sandbox might have been shutdown
    if ( !messaging ) {
        return;
    }

    var channels = messaging.channels;
    var channel;

    // Sent to all channels
    if ( details.broadcast && !details.channelName ) {
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
        sendAsyncMessage('ublock0:background', {
            mainProcessId: details.mainProcessId,
            msg: response
        });
    }
};

/******************************************************************************/

var MessagingChannel = function(name, callback) {
    this.channelName = name;
    this.listeners = typeof callback === 'function' ? [callback] : [];
    this.refCount = 1;
    if ( typeof callback === 'function' ) {
        vAPI.messaging.connect();
    }
};

MessagingChannel.prototype.send = function(message, callback) {
    this.sendTo(message, undefined, undefined, callback);
};

MessagingChannel.prototype.sendTo = function(message, toTabId, toChannel, callback) {
    var messaging = vAPI.messaging;
    if ( !messaging ) {
        if ( typeof callback === 'function' ) {
            callback();
        }
        return;
    }
    // Too large a gap between the last request and the last response means
    // the main process is no longer reachable: memory leaks and bad
    // performance become a risk -- especially for long-lived, dynamic
    // pages. Guard against this.
    if ( messaging.pendingCount > 25 ) {
        //console.error('uBlock> Sigh. Main process is sulking. Will try to patch things up.');
        messaging.close();
    }
    messaging.connect();
    var auxProcessId;
    if ( callback ) {
        auxProcessId = messaging.auxProcessId++;
        messaging.pending[auxProcessId] = callback;
        messaging.pendingCount += 1;
    }
    sendAsyncMessage('ublock0:background', {
        channelName: self._sandboxId_ + '|' + this.channelName,
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
    delete vAPI.messaging.channels[this.channelName];
};

MessagingChannel.prototype.addListener = function(callback) {
    if ( typeof callback !== 'function' ) {
        return;
    }
    if ( this.listeners.indexOf(callback) !== -1 ) {
        throw new Error('Duplicate listener.');
    }
    this.listeners.push(callback);
    vAPI.messaging.connect();
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

// https://www.youtube.com/watch?v=Cg0cmhjdiLs

/******************************************************************************/

vAPI.messaging.setup();

/******************************************************************************/

// No need to have vAPI client linger around after shutdown if
// we are not a top window (because element picker can still
// be injected in top window).
if ( window !== window.top ) {
    // Can anything be done?
}

/******************************************************************************/

})(this);

/******************************************************************************/

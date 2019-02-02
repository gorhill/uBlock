/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-present The uBlock Origin authors
    Copyright (C) 2015-present Raymond Hill

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

// For non-background page

'use strict';

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/456
//   Skip if already injected.

// >>>>>>>> start of HUGE-IF-BLOCK
if ( typeof vAPI === 'object' && !vAPI.clientScript ) {

/******************************************************************************/
/******************************************************************************/

vAPI.clientScript = true;

vAPI.randomToken = function() {
    return String.fromCharCode(Date.now() % 26 + 97) +
           Math.floor(Math.random() * 982451653 + 982451653).toString(36);
};

vAPI.sessionId = vAPI.randomToken();
vAPI.setTimeout = vAPI.setTimeout || self.setTimeout.bind(self);

/******************************************************************************/

vAPI.shutdown = {
    jobs: [],
    add: function(job) {
        this.jobs.push(job);
    },
    exec: function() {
        // Shutdown asynchronously, to ensure shutdown jobs are called from
        // the top context.
        self.requestIdleCallback(( ) => {
            const jobs = this.jobs.slice();
            this.jobs.length = 0;
            while ( jobs.length !== 0 ) {
                (jobs.pop())();
            }
        });
    },
    remove: function(job) {
        let pos;
        while ( (pos = this.jobs.indexOf(job)) !== -1 ) {
            this.jobs.splice(pos, 1);
        }
    }
};

/******************************************************************************/

vAPI.messaging = {
    port: null,
    portTimer: null,
    portTimerDelay: 10000,
    channels: new Map(),
    connections: new Map(),
    pending: new Map(),
    auxProcessId: 1,
    shuttingDown: false,

    Connection: function(handler, details) {
        this.messaging = vAPI.messaging;
        this.handler = handler;
        this.id = details.id;
        this.to = details.to;
        this.toToken = details.toToken;
        this.from = details.from;
        this.fromToken = details.fromToken;
        this.checkTimer = undefined;
        // On Firefox it appears ports are not automatically disconnected
        // when navigating to another page.
        const ctor = this.messaging.Connection;
        if ( ctor.pagehide !== undefined ) { return; }
        ctor.pagehide = ( ) => {
            for ( const connection of this.messaging.connections.values() ) {
                connection.disconnect();
                connection.handler(
                    connection.toDetails('connectionBroken')
                );
            }
        };
        window.addEventListener('pagehide', ctor.pagehide);
    },

    shutdown: function() {
        this.shuttingDown = true;
        this.destroyPort();
    },

    // https://github.com/uBlockOrigin/uBlock-issues/issues/403
    //   Spurious disconnection can happen, so do not consider such events
    //   as world-ending, i.e. stay around. Except for embedded frames.

    disconnectListener: function() {
        this.port = null;
        if ( window !== window.top ) {
            vAPI.shutdown.exec();
        }
    },
    disconnectListenerBound: null,

    messageListener: function(details) {
        if ( !details ) { return; }

        // Sent to all channels
        if ( details.broadcast ) {
            for ( const channelName of this.channels.keys() ) {
                this.sendToChannelListeners(channelName, details.msg);
            }
            return;
        }

        // Response to specific message previously sent
        if ( details.auxProcessId ) {
            const listener = this.pending.get(details.auxProcessId);
            if ( listener !== undefined ) {
                this.pending.delete(details.auxProcessId);
                listener(details.msg);
                return;
            }
        }

        if ( details.channelName !== 'vapi' ) { return; }

        // Internal handler
        let connection;

        switch ( details.msg.what ) {
        case 'connectionAccepted':
        case 'connectionBroken':
        case 'connectionCheck':
        case 'connectionMessage':
        case 'connectionRefused':
            connection = this.connections.get(details.msg.id);
            if ( connection === undefined ) { return; }
            connection.receive(details.msg);
            break;
        case 'connectionRequested':
            const listeners = this.channels.get(details.msg.to);
            if ( listeners === undefined ) { return; }
            const port = this.getPort();
            if ( port === null ) { return; }
            for ( const listener of listeners ) {
                if ( listener(details.msg) !== true ) { continue; }
                details.msg.what = 'connectionAccepted';
                details.msg.toToken = port.name;
                connection = new this.Connection(listener, details.msg);
                this.connections.set(connection.id, connection);
                break;
            }
            if ( details.msg.what !== 'connectionAccepted' ) {
                details.msg.what = 'connectionRefused';
            }
            port.postMessage(details);
            break;
        default:
            break;
        }
    },
    messageListenerCallback: null,

    portPoller: function() {
        this.portTimer = null;
        if (
            this.port !== null &&
            this.channels.size === 0 &&
            this.connections.size === 0 &&
            this.pending.size === 0
        ) {
            return this.destroyPort();
        }
        this.portTimer = vAPI.setTimeout(this.portPollerBound, this.portTimerDelay);
        this.portTimerDelay = Math.min(this.portTimerDelay * 2, 60 * 60 * 1000);
    },
    portPollerBound: null,

    destroyPort: function() {
        if ( this.portTimer !== null ) {
            clearTimeout(this.portTimer);
            this.portTimer = null;
        }
        const port = this.port;
        if ( port !== null ) {
            port.disconnect();
            port.onMessage.removeListener(this.messageListenerCallback);
            port.onDisconnect.removeListener(this.disconnectListenerBound);
            this.port = null;
        }
        this.channels.clear();
        if ( this.connections.size !== 0 ) {
            for ( const connection of this.connections.values() ) {
                connection.receive({ what: 'connectionBroken' });
            }
            this.connections.clear();
        }
        // service pending callbacks
        if ( this.pending.size !== 0 ) {
            const pending = this.pending;
            this.pending = new Map();
            for ( const callback of pending.values() ) {
                if ( typeof callback === 'function' ) {
                    callback(null);
                }
            }
        }
    },

    createPort: function() {
        if ( this.shuttingDown ) { return null; }
        if ( this.messageListenerCallback === null ) {
            this.messageListenerCallback = this.messageListener.bind(this);
            this.disconnectListenerBound = this.disconnectListener.bind(this);
            this.portPollerBound = this.portPoller.bind(this);
        }
        try {
            this.port = chrome.runtime.connect({name: vAPI.sessionId}) || null;
        } catch (ex) {
            this.port = null;
        }
        // Not having a valid port at this point means the main process is
        // not available: no point keeping the content scripts alive.
        if ( this.port === null ) {
            vAPI.shutdown.exec();
            return null;
        }
        this.port.onMessage.addListener(this.messageListenerCallback);
        this.port.onDisconnect.addListener(this.disconnectListenerBound);
        this.portTimerDelay = 10000;
        if ( this.portTimer === null ) {
            this.portTimer = vAPI.setTimeout(
                this.portPollerBound,
                this.portTimerDelay
            );
        }
        return this.port;
    },

    getPort: function() {
        return this.port !== null ? this.port : this.createPort();
    },

    send: function(channelName, message, callback) {
        // Too large a gap between the last request and the last response means
        // the main process is no longer reachable: memory leaks and bad
        // performance become a risk -- especially for long-lived, dynamic
        // pages. Guard against this.
        if ( this.pending.size > 50 ) {
            vAPI.shutdown.exec();
        }
        const port = this.getPort();
        if ( port === null ) {
            if ( typeof callback === 'function' ) { callback(); }
            return;
        }
        let auxProcessId;
        if ( callback ) {
            auxProcessId = this.auxProcessId++;
            this.pending.set(auxProcessId, callback);
        }
        port.postMessage({
            channelName: channelName,
            auxProcessId: auxProcessId,
            msg: message
        });
    },

    connectTo: function(from, to, handler) {
        const port = this.getPort();
        if ( port === null ) { return; }
        const connection = new this.Connection(handler, {
            id: `${from}-${to}-${vAPI.sessionId}`,
            to: to,
            from: from,
            fromToken: port.name
        });
        this.connections.set(connection.id, connection);
        port.postMessage({
            channelName: 'vapi',
            msg: {
                what: 'connectionRequested',
                id: connection.id,
                from: from,
                fromToken: port.name,
                to: to
            }
        });
        return connection.id;
    },

    disconnectFrom: function(connectionId) {
        const connection = this.connections.get(connectionId);
        if ( connection === undefined ) { return; }
        connection.disconnect();
    },

    sendTo: function(connectionId, payload) {
        const connection = this.connections.get(connectionId);
        if ( connection === undefined ) { return; }
        connection.send(payload);
    },

    addChannelListener: function(channelName, listener) {
        const listeners = this.channels.get(channelName);
        if ( listeners === undefined ) {
            this.channels.set(channelName, [ listener ]);
        } else if ( listeners.indexOf(listener) === -1 ) {
            listeners.push(listener);
        }
        this.getPort();
    },

    removeChannelListener: function(channelName, listener) {
        const listeners = this.channels.get(channelName);
        if ( listeners === undefined ) { return; }
        const pos = listeners.indexOf(listener);
        if ( pos === -1 ) { return; }
        listeners.splice(pos, 1);
        if ( listeners.length === 0 ) {
            this.channels.delete(channelName);
        }
    },

    removeAllChannelListeners: function(channelName) {
        this.channels.delete(channelName);
    },

    sendToChannelListeners: function(channelName, msg) {
        let listeners = this.channels.get(channelName);
        if ( listeners === undefined ) { return; }
        listeners = listeners.slice(0);
        let response;
        for ( const listener of listeners ) {
            response = listener(msg);
            if ( response !== undefined ) { break; }
        }
        return response;
    }
};

/******************************************************************************/

vAPI.messaging.Connection.prototype = {
    toDetails: function(what, payload) {
        return {
            what: what,
            id: this.id,
            from: this.from,
            fromToken: this.fromToken,
            to: this.to,
            toToken: this.toToken,
            payload: payload
        };
    },
    disconnect: function() {
        if ( this.checkTimer !== undefined ) {
            clearTimeout(this.checkTimer);
            this.checkTimer = undefined;
        }
        this.messaging.connections.delete(this.id);
        const port = this.messaging.getPort();
        if ( port === null ) { return; }
        port.postMessage({
            channelName: 'vapi',
            msg:  this.toDetails('connectionBroken')
        });
    },
    checkAsync: function() {
        if ( this.checkTimer !== undefined ) {
            clearTimeout(this.checkTimer);
        }
        this.checkTimer = vAPI.setTimeout(
            ( ) => { this.check(); },
            499
        );
    },
    check: function() {
        this.checkTimer = undefined;
        if ( this.messaging.connections.has(this.id) === false ) { return; }
        const port = this.messaging.getPort();
        if ( port === null ) { return; }
        port.postMessage({
            channelName: 'vapi',
            msg: this.toDetails('connectionCheck')
        });
        this.checkAsync();
    },
    receive: function(details) {
        switch ( details.what ) {
        case 'connectionAccepted':
            this.toToken = details.toToken;
            this.handler(details);
            this.checkAsync();
            break;
        case 'connectionBroken':
            this.messaging.connections.delete(this.id);
            this.handler(details);
            break;
        case 'connectionMessage':
            this.handler(details);
            this.checkAsync();
            break;
        case 'connectionCheck':
            const port = this.messaging.getPort();
            if ( port === null ) { return; }
            if ( this.messaging.connections.has(this.id) ) {
                this.checkAsync();
            } else {
                details.what = 'connectionBroken';
                port.postMessage({ channelName: 'vapi', msg: details });
            }
            break;
        case 'connectionRefused':
            this.messaging.connections.delete(this.id);
            this.handler(details);
            break;
        }
    },
    send: function(payload) {
        const port = this.messaging.getPort();
        if ( port === null ) { return; }
        port.postMessage({
            channelName: 'vapi',
            msg: this.toDetails('connectionMessage', payload)
        });
    }
};

/******************************************************************************/

vAPI.shutdown.add(function() {
    vAPI.messaging.shutdown();
    window.vAPI = undefined;
});

/******************************************************************************/
/******************************************************************************/

}
// <<<<<<<< end of HUGE-IF-BLOCK








/*******************************************************************************

    DO NOT:
    - Remove the following code
    - Add code beyond the following code
    Reason:
    - https://github.com/gorhill/uBlock/pull/3721
    - uBO never uses the return value from injected content scripts

**/

void 0;

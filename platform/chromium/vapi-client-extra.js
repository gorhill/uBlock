/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2019-present Raymond Hill

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

// Direct messaging connection ability

(( ) => {
// >>>>>>>> start of private namespace

if (
    typeof vAPI !== 'object' ||
    vAPI.messaging instanceof Object === false ||
    vAPI.MessagingConnection instanceof Function
) {
    return;
}

const listeners = new Set();
const connections = new Map();

vAPI.MessagingConnection = class {
    constructor(handler, details) {
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
        const ctor = vAPI.MessagingConnection;
        if ( ctor.pagehide !== undefined ) { return; }
        ctor.pagehide = ( ) => {
            for ( const connection of connections.values() ) {
                connection.disconnect();
                connection.handler(
                    connection.toDetails('connectionBroken')
                );
            }
        };
        window.addEventListener('pagehide', ctor.pagehide);
    }
    toDetails(what, payload) {
        return {
            what: what,
            id: this.id,
            from: this.from,
            fromToken: this.fromToken,
            to: this.to,
            toToken: this.toToken,
            payload: payload
        };
    }
    disconnect() {
        if ( this.checkTimer !== undefined ) {
            clearTimeout(this.checkTimer);
            this.checkTimer = undefined;
        }
        connections.delete(this.id);
        const port = this.messaging.getPort();
        if ( port === null ) { return; }
        port.postMessage({
            channel: 'vapi',
            msg:  this.toDetails('connectionBroken'),
        });
    }
    checkAsync() {
        if ( this.checkTimer !== undefined ) {
            clearTimeout(this.checkTimer);
        }
        this.checkTimer = vAPI.setTimeout(
            ( ) => { this.check(); },
            499
        );
    }
    check() {
        this.checkTimer = undefined;
        if ( connections.has(this.id) === false ) { return; }
        const port = this.messaging.getPort();
        if ( port === null ) { return; }
        port.postMessage({
            channel: 'vapi',
            msg: this.toDetails('connectionCheck'),
        });
        this.checkAsync();
    }
    receive(details) {
        switch ( details.what ) {
        case 'connectionAccepted':
            this.toToken = details.toToken;
            this.handler(details);
            this.checkAsync();
            break;
        case 'connectionBroken':
            connections.delete(this.id);
            this.handler(details);
            break;
        case 'connectionMessage':
            this.handler(details);
            this.checkAsync();
            break;
        case 'connectionCheck':
            const port = this.messaging.getPort();
            if ( port === null ) { return; }
            if ( connections.has(this.id) ) {
                this.checkAsync();
            } else {
                details.what = 'connectionBroken';
                port.postMessage({ channel: 'vapi', msg: details });
            }
            break;
        case 'connectionRefused':
            connections.delete(this.id);
            this.handler(details);
            break;
        }
    }
    send(payload) {
        const port = this.messaging.getPort();
        if ( port === null ) { return; }
        port.postMessage({
            channel: 'vapi',
            msg: this.toDetails('connectionMessage', payload),
        });
    }

    static addListener(listener) {
        listeners.add(listener);
        vAPI.messaging.getPort(); // Ensure a port instance exists
    }
    static removeListener(listener) {
        listeners.delete(listener);
    }
    static connectTo(from, to, handler) {
        const port = vAPI.messaging.getPort();
        if ( port === null ) { return; }
        const connection = new vAPI.MessagingConnection(handler, {
            id: `${from}-${to}-${vAPI.sessionId}`,
            to: to,
            from: from,
            fromToken: port.name
        });
        connections.set(connection.id, connection);
        port.postMessage({
            channel: 'vapi',
            msg: {
                what: 'connectionRequested',
                id: connection.id,
                from: from,
                fromToken: port.name,
                to: to,
            }
        });
        return connection.id;
    }
    static disconnectFrom(connectionId) {
        const connection = connections.get(connectionId);
        if ( connection === undefined ) { return; }
        connection.disconnect();
    }
    static sendTo(connectionId, payload) {
        const connection = connections.get(connectionId);
        if ( connection === undefined ) { return; }
        connection.send(payload);
    }
    static canDestroyPort() {
        return listeners.length === 0 && connections.size === 0;
    }
    static mustDestroyPort() {
        if ( connections.size === 0 ) { return; }
        for ( const connection of connections.values() ) {
            connection.receive({ what: 'connectionBroken' });
        }
        connections.clear();
    }
    static canProcessMessage(details) {
        if ( details.channel !== 'vapi' ) { return; }
        switch ( details.msg.what ) {
        case 'connectionAccepted':
        case 'connectionBroken':
        case 'connectionCheck':
        case 'connectionMessage':
        case 'connectionRefused': {
            const connection = connections.get(details.msg.id);
            if ( connection === undefined ) { break; }
            connection.receive(details.msg);
            return true;
        }
        case 'connectionRequested':
            if ( listeners.length === 0 ) { return; }
            const port = vAPI.messaging.getPort();
            if ( port === null ) { break; }
            let listener, result;
            for ( listener of listeners ) {
                result = listener(details.msg);
                if ( result !== undefined ) { break; }
            }
            if ( result === undefined ) { break; }
            if ( result === true ) {
                details.msg.what = 'connectionAccepted';
                details.msg.toToken = port.name;
                const connection = new vAPI.MessagingConnection(
                    listener,
                    details.msg
                );
                connections.set(connection.id, connection);
            } else {
                details.msg.what = 'connectionRefused';
            }
            port.postMessage(details);
            return true;
        default:
            break;
        }
    }
};

vAPI.messaging.extensions.push(vAPI.MessagingConnection);

// <<<<<<<< end of private namespace
})();

/******************************************************************************/

// Broadcast listening ability

(( ) => {
// >>>>>>>> start of private namespace

if (
    typeof vAPI !== 'object' ||
    vAPI.messaging instanceof Object === false ||
    vAPI.broadcastListener instanceof Object
) {
    return;
}

const listeners = new Set();

vAPI.broadcastListener =  {
    add: function(listener) {
        listeners.add(listener);
        vAPI.messaging.getPort();
    },
    remove: function(listener) {
        listeners.delete(listener);
    },
    canDestroyPort() {
        return listeners.size === 0;
    },
    mustDestroyPort() {
        listeners.clear();
    },
    canProcessMessage(details) {
        if ( details.broadcast === false ) { return; }
        for ( const listener of listeners ) {
             listener(details.msg);
        }
    },
};

vAPI.messaging.extensions.push(vAPI.broadcastListener);

// <<<<<<<< end of private namespace
})();

/******************************************************************************/








/*******************************************************************************

    DO NOT:
    - Remove the following code
    - Add code beyond the following code
    Reason:
    - https://github.com/gorhill/uBlock/pull/3721
    - uBO never uses the return value from injected content scripts

**/

void 0;

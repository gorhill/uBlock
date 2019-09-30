/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2015 The uBlock Origin authors
    Copyright (C) 2014-present Raymond Hill

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
if (
    typeof vAPI === 'object' &&
    vAPI.randomToken instanceof Function === false
) {

/******************************************************************************/
/******************************************************************************/

vAPI.randomToken = function() {
    const now = Date.now();
    return String.fromCharCode(now % 26 + 97) +
           Math.floor((1 + Math.random()) * now).toString(36);
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
    extended: undefined,
    extensions: [],
    msgIdGenerator: 1,
    pending: new Map(),
    shuttingDown: false,

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
        if ( details instanceof Object === false ) { return; }

        // Response to specific message previously sent
        if ( details.msgId !== undefined ) {
            const resolver = this.pending.get(details.msgId);
            if ( resolver !== undefined ) {
                this.pending.delete(details.msgId);
                resolver(details.msg);
                return;
            }
        }

        // Unhandled messages
        this.extensions.every(ext => ext.canProcessMessage(details) !== true);
    },
    messageListenerBound: null,

    canDestroyPort: function() {
        return this.pending.size === 0 &&
            (
                this.extensions.length === 0 ||
                this.extensions.every(e => e.canDestroyPort())
            );
    },

    mustDestroyPort: function() {
        if ( this.extensions.length === 0 ) { return; }
        this.extensions.forEach(e => e.mustDestroyPort());
        this.extensions.length = 0;
    },

    portPoller: function() {
        this.portTimer = null;
        if ( this.port !== null && this.canDestroyPort() ) {
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
            port.onMessage.removeListener(this.messageListenerBound);
            port.onDisconnect.removeListener(this.disconnectListenerBound);
            this.port = null;
        }
        this.mustDestroyPort();
        // service pending callbacks
        if ( this.pending.size !== 0 ) {
            const pending = this.pending;
            this.pending = new Map();
            for ( const resolver of pending.values() ) {
                resolver();
            }
        }
    },

    createPort: function() {
        if ( this.shuttingDown ) { return null; }
        if ( this.messageListenerBound === null ) {
            this.messageListenerBound = this.messageListener.bind(this);
            this.disconnectListenerBound = this.disconnectListener.bind(this);
            this.portPollerBound = this.portPoller.bind(this);
        }
        try {
            this.port = browser.runtime.connect({name: vAPI.sessionId}) || null;
        } catch (ex) {
            this.port = null;
        }
        // Not having a valid port at this point means the main process is
        // not available: no point keeping the content scripts alive.
        if ( this.port === null ) {
            vAPI.shutdown.exec();
            return null;
        }
        this.port.onMessage.addListener(this.messageListenerBound);
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

    send: function(channel, msg) {
        // Too large a gap between the last request and the last response means
        // the main process is no longer reachable: memory leaks and bad
        // performance become a risk -- especially for long-lived, dynamic
        // pages. Guard against this.
        if ( this.pending.size > 50 ) {
            vAPI.shutdown.exec();
        }
        const port = this.getPort();
        if ( port === null ) {
            return Promise.resolve();
        }
        const msgId = this.msgIdGenerator++;
        const promise = new Promise(resolve => {
            this.pending.set(msgId, resolve);
        });
        port.postMessage({ channel, msgId, msg });
        return promise;
    },

    // Dynamically extend capabilities.
    extend: function() {
        if ( this.extended === undefined ) {
            this.extended = vAPI.messaging.send('vapi', {
                what: 'extendClient'
            }).then(( ) => {
                return self.vAPI instanceof Object &&
                       this.extensions.length !== 0;
            }).catch(( ) => {
            });
        }
        return this.extended;
    },
};

vAPI.shutdown.add(( ) => {
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

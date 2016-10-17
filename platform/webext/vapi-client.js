/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 The uBlock Origin authors

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

'use strict';

// For non background pages

/******************************************************************************/

(function(self) {

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
// https://forums.lanik.us/viewtopic.php?f=64&t=31522
//   Skip text/plain documents.
var contentType = document.contentType || '';
if ( /^image\/|^text\/plain/.test(contentType) ) {
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

/******************************************************************************/

// Support minimally working Set() for legacy Chromium.

if ( self.Set instanceof Function ) {
    self.createSet = function() {
        return new Set();
    };
} else {
    self.createSet = (function() {
        //console.log('Polyfilling for ES6-like Set().');
        var PrimitiveSet = function() {
            this.clear();
        };
        PrimitiveSet.prototype = {
            add: function(k) {
                if ( this._set[k] === undefined ) {
                    this._set[k] = true;
                    this.size += 1;
                }
                return this;
            },
            clear: function() {
                this._set = Object.create(null);
                this.size = 0;
                this._values = undefined;
                this._i = undefined;
                this.value = undefined;
                this.done = true;
            },
            delete: function(k) {
                if ( this._set[k] === undefined ) { return false; }
                delete this._set[k];
                this.size -= 1;
                return true;
            },
            has: function(k) {
                return this._set[k] !== undefined;
            },
            next: function() {
                if ( this._i < this.size ) {
                    this.value = this._values[this._i++];
                } else {
                    this._values = undefined;
                    this.value = undefined;
                    this.done = true;
                }
                return this;
            },
            polyfill: true,
            values: function() {
                this._values = Object.keys(this._set);
                this._i = 0;
                this.value = undefined;
                this.done = false;
                return this;
            }
        };
        var ReferenceSet = function() {
            this.clear();
        };
        ReferenceSet.prototype = {
            add: function(k) {
                if ( this._set.indexOf(k) === -1 ) {
                    this._set.push(k);
                }
            },
            clear: function() {
                this._set = [];
                this._i = 0;
                this.value = undefined;
                this.done = true;
            },
            delete: function(k) {
                var pos = this._set.indexOf(k);
                if ( pos === -1 ) { return false; }
                this._set.splice(pos, 1);
                return true;
            },
            has: function(k) {
                return this._set.indexOf(k) !== -1;
            },
            next: function() {
                if ( this._i === this._set.length ) {
                    this.value = undefined;
                    this.done = true;
                } else {
                    this.value = this._set[this._i];
                    this._i += 1;
                }
                return this;
            },
            polyfill: true,
            values: function() {
                this._i = 0;
                this.done = false;
                return this;
            }
        };
        Object.defineProperty(ReferenceSet.prototype, 'size', {
            get: function() { return this._set.length; }
        });
        return function(type) {
            return type === 'object' ? new ReferenceSet() : new PrimitiveSet();
        };
    })();
}

/******************************************************************************/

var referenceCounter = 0;

vAPI.lock = function() {
    referenceCounter += 1;
};

vAPI.unlock = function() {
    referenceCounter -= 1;
    if ( referenceCounter === 0 ) {
        // Eventually there will be code here to flush the javascript code
        // from this file out of memory when it ends up unused.
        
    }
};

/******************************************************************************/

vAPI.executionCost = {
    start: function(){},
    stop: function(){}
};
/*
vAPI.executionCost = {
    tcost: 0,
    tstart: 0,
    nstart: 0,
    level: 1,
    start: function() {
        if ( this.nstart === 0 ) {
            this.tstart = window.performance.now();
        }
        this.nstart += 1;
    },
    stop: function(mark) {
        this.nstart -= 1;
        if ( this.nstart !== 0 ) {
            return;
        }
        var tcost = window.performance.now() - this.tstart;
        this.tcost += tcost;
        if ( mark === undefined ) {
            return;
        }
        var top = window === window.top;
        if ( !top && this.level < 2 ) {
            return;
        }
        var context = window === window.top ? '  top' : 'frame';
        var percent = this.tcost / window.performance.now() * 100;
        console.log(
            'uBO cost (%s): %sms/%s%% (%s: %sms)',
            context,
            this.tcost.toFixed(1),
            percent.toFixed(1),
            mark,
            tcost.toFixed(2)
        );
    }
};
*/
vAPI.executionCost.start();

/******************************************************************************/

vAPI.randomToken = function() {
    return String.fromCharCode(Date.now() % 26 + 97) +
           Math.floor(Math.random() * 982451653 + 982451653).toString(36);
};

vAPI.sessionId = vAPI.randomToken();
vAPI.chrome = true;
vAPI.setTimeout = vAPI.setTimeout || self.setTimeout.bind(self);

/******************************************************************************/

vAPI.shutdown = {
    jobs: [],
    add: function(job) {
        this.jobs.push(job);
    },
    exec: function() {
        var job;
        while ( (job = this.jobs.pop()) ) {
            job();
        }
    },
    remove: function(job) {
        var pos;
        while ( (pos = this.jobs.indexOf(job)) !== -1 ) {
            this.jobs.splice(pos, 1);
        }
    }
};

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

vAPI.executionCost.stop('vapi-client.js');

/******************************************************************************/
/******************************************************************************/

})(this);

/******************************************************************************/

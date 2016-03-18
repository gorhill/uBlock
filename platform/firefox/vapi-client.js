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

/* global HTMLDocument, XMLDocument,
   addMessageListener, removeMessageListener, sendAsyncMessage, outerShutdown
 */

// For non background pages

/******************************************************************************/

(function(self) {

'use strict';

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
        rootURL: self.location.href,
        frameURL: self.location.href,
        frameHostname: hostname
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
    channels: Object.create(null),
    channelCount: 0,
    pending: Object.create(null),
    pendingCount: 0,
    auxProcessId: 1,
    connected: false,

    messageListener: function(msg) {
        var details = JSON.parse(msg);
        if ( !details ) {
            return;
        }

        // Sent to all channels
        if ( details.broadcast && !details.channelName ) {
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
        sendAsyncMessage('ublock0:background', {
            mainProcessId: details.mainProcessId,
            msg: response
        });
    },

    builtinListener: function(msg) {
        if ( msg.cmd === 'injectScript' ) {
            // injectScript is not always present.
            // - See contentObserver.initContentScripts in frameModule.js
            if ( typeof self.injectScript !== 'function' )  {
                return;
            }
            var details = msg.details;
            // Whether to inject in all child frames. Default to only top frame.
            var allFrames = details.allFrames || false;
            if ( allFrames !== true && window !== window.top ) {
                return;
            }
            // https://github.com/gorhill/uBlock/issues/876
            // Enforce `details.runAt`. Default to `document_end`.
            var runAt = details.runAt || 'document_end';
            if ( runAt === 'document_start' || document.readyState !== 'loading' ) {
                self.injectScript(details.file);
                return;
            }
            var injectScriptDelayed = function() {
                document.removeEventListener('DOMContentLoaded', injectScriptDelayed);
                self.injectScript(details.file);
            };
            document.addEventListener('DOMContentLoaded', injectScriptDelayed);
            return;
        }
        if ( msg.cmd === 'shutdownSandbox' ) {
            vAPI.shutdown.exec();
            this.stop();
            if ( typeof self.outerShutdown === 'function' ) {
                outerShutdown();
            }
            return;
        }
    },

    toggleListener: function({type, persisted}) {
        if ( type === 'pagehide' && !persisted ) {
            vAPI.shutdown.exec();
            this.stop();
            if ( typeof self.outerShutdown === 'function' ) {
                outerShutdown();
            }
            return;
        }

        if ( type === 'pagehide' ) {
            this.disconnect();
        } else /* if ( type === 'pageshow' ) */ {
            this.connect();
        }
    },
    toggleListenerCallback: null,

    start: function() {
        this.addChannelListener('vAPI', this.builtinListener.bind(this));
        if ( this.toggleListenerCallback === null ) {
            this.toggleListenerCallback = this.toggleListener.bind(this);
        }
        window.addEventListener('pagehide', this.toggleListenerCallback, true);
        window.addEventListener('pageshow', this.toggleListenerCallback, true);
    },

    stop: function() {
        if ( this.toggleListenerCallback !== null ) {
            window.removeEventListener('pagehide', this.toggleListenerCallback, true);
            window.removeEventListener('pageshow', this.toggleListenerCallback, true);
        }
        this.disconnect();
        this.channels = Object.create(null);
        this.channelCount = 0;
        // service pending callbacks
        var pending = this.pending, callback;
        this.pending = Object.create(null);
        this.pendingCount = 0;
        for ( var auxId in pending ) {
            callback = pending[auxId];
            if ( typeof callback === 'function' ) {
                callback(null);
            }
        }
    },

    connect: function() {
        if ( !this.connected ) {
            addMessageListener(this.messageListener.bind(this));
            this.connected = true;
        }
    },

    disconnect: function() {
        if ( this.connected ) {
            removeMessageListener();
            this.connected = false;
        }
    },

    send: function(channelName, message, callback) {
        this.sendTo(channelName, message, undefined, undefined, callback);
    },

    sendTo: function(channelName, message, toTabId, toChannel, callback) {
        if ( !this.connected ) {
            if ( typeof callback === 'function' ) {
                callback();
            }
            return;
        }
        // Too large a gap between the last request and the last response means
        // the main process is no longer reachable: memory leaks and bad
        // performance become a risk -- especially for long-lived, dynamic
        // pages. Guard against this.
        if ( this.pendingCount > 25 ) {
            vAPI.shutdown.exec();
        }
        this.connect();
        var auxProcessId;
        if ( callback ) {
            auxProcessId = this.auxProcessId++;
            this.pending[auxProcessId] = callback;
            this.pendingCount += 1;
        }
        sendAsyncMessage('ublock0:background', {
            channelName: self._sandboxId_ + '|' + channelName,
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

vAPI.messaging.start();

// https://www.youtube.com/watch?v=Cg0cmhjdiLs

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

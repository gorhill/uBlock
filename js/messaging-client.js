/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

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

// This is the reference client-side implementation of µBlock's messaging
// infrastructure. The "server"-side implementation is in messaging.js.

// The client-side implementation creates a port in order to connect to
// µBlock's background page. With this port we can "ask", "tell" or "announce":
//
// "ask": send a request and expect an answer using a callback.
// "tell": send a request with no expectation of an answer.
// "announce": send a request to be relayed to all connections -- no answer
//   expected.
//
// The tricky part in this implementation is to ensure all the requests are
// uniquely identified, so that the background-page can keep track of these
// until it is ready to send back an answer, which will be tagged with the
// same id. The uniqueness must be true for all ports which connect to the
// background page at any given time.
//
// Currently using Math.random() to generate this id... I don't know about the
// implementation of Math.random(), but as long as I have a good expectation
// of uniqueness, it's ok, we are not dealing with critical stuff here.

/* global chrome */

var messaging = (function(name){
    var port = null;
    var requestId = 1;
    var requestIdToCallbackMap = {};
    var listenCallback = null;

    var onPortMessage = function(details) {
        if ( typeof details.id !== 'number' ) {
            return;
        }
        // Announcement?
        if ( details.id < 0 ) {
            if ( listenCallback ) {
                listenCallback(details.msg);
            }
            return;
        }
        var callback = requestIdToCallbackMap[details.id];
        if ( !callback ) {
            return;
        }
        // Must be removed before calling client to be sure to not execute
        // callback again if the client stops the messaging service.
        delete requestIdToCallbackMap[details.id];
        callback(details.msg);
    };

    var start = function(name) {
        port = chrome.runtime.connect({ name: name });
        port.onMessage.addListener(onPortMessage);

        // https://github.com/gorhill/uBlock/issues/193
        port.onDisconnect.addListener(stop);
    };

    var stop = function() {
        listenCallback = null;
        port.disconnect();
        port = null;
        flushCallbacks();
    };

    if ( typeof name === 'string' && name !== '' ) {
        start(name);
    }

    var ask = function(msg, callback) {
        if ( port === null ) {
            if ( typeof callback === 'function' ) {
                callback();
            }
            return;
        }
        if ( callback === undefined ) {
            tell(msg);
            return;
        }
        var id = requestId++;
        port.postMessage({ id: id, msg: msg });
        requestIdToCallbackMap[id] = callback;
    };

    var tell = function(msg) {
        if ( port !== null ) {
            port.postMessage({ id: 0, msg: msg });
        }
    };

    var listen = function(callback) {
        listenCallback = callback;
    };

    var flushCallbacks = function() {
        var callback;
        for ( var id in requestIdToCallbackMap ) {
            if ( requestIdToCallbackMap.hasOwnProperty(id) === false ) {
                continue;
            }
            callback = requestIdToCallbackMap[id];
            if ( !callback ) {
                continue;
            }
            // Must be removed before calling client to be sure to not execute
            // callback again if the client stops the messaging service.
            delete requestIdToCallbackMap[id];
            callback();
        }
    };

    return {
        start: start,
        stop: stop,
        ask: ask,
        tell: tell,
        listen: listen
    };
})();

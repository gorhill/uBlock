/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2106 The uBlock Origin authors

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

// Purpose of this script is to workaround Chromium issue 129353:
// https://bugs.chromium.org/p/chromium/issues/detail?id=129353
// https://github.com/gorhill/uBlock/issues/956
// https://github.com/gorhill/uBlock/issues/1497

// WebSocket reference: https://html.spec.whatwg.org/multipage/comms.html
// A WeakMap is used to hide the real WebSocket instance from caller's view, in
// order to ensure that the wrapper can't be bypassed.
// The script removes its own tag from the DOM.

(function() {
    'use strict';

    var Wrapped = window.WebSocket;
    var toWrapped = new WeakMap();

    var onResponseReceived = function(wrapper, ok) {
        this.onload = this.onerror = null;
        var bag = toWrapped.get(wrapper);
        if ( !ok ) {
            if ( bag.properties.onerror ) {
                bag.properties.onerror(new window.ErrorEvent('error'));
            }
            return;
        }
        var wrapped = new Wrapped(bag.args.url, bag.args.protocols);
        for ( var prop in bag.properties ) {
            wrapped[prop] = bag.properties[prop];
        }
        toWrapped.set(wrapper, wrapped);
    };

    var noopfn = function() {
    };

    var fallthruGet = function(wrapper, prop, value) {
        var wrapped = toWrapped.get(wrapper);
        if ( !wrapped ) {
            return value;
        }
        if ( wrapped instanceof Wrapped ) {
            return wrapped[prop];
        }
        return wrapped.properties.hasOwnProperty(prop) ?
            wrapped.properties[prop] :
            value;
    };

    var fallthruSet = function(wrapper, prop, value) {
        if ( value instanceof Function ) {
            value = value.bind(wrapper);
        }
        var wrapped = toWrapped.get(wrapper);
        if ( !wrapped ) {
            return;
        }
        if ( wrapped instanceof Wrapped ) {
            wrapped[prop] = value;
        } else {
            wrapped.properties[prop] = value;
        }
    };

    var WebSocket = function(url, protocols) {
        if ( window.location.protocol === 'https:' && /^ws:/.test(url) ) {
            var ws = new Wrapped(url, protocols);
            if ( ws ) {
                ws.close();
            }
        }

        Object.defineProperties(this, {
            'binaryType': {
                get: function() {
                    return fallthruGet(this, 'binaryType', '');
                },
                set: function(value) {
                    fallthruSet(this, 'binaryType', value);
                }
            },
            'bufferedAmount': {
                get: function() {
                    return fallthruGet(this, 'bufferedAmount', 0);
                },
                set: noopfn
            },
            'extensions': {
                get: function() {
                    return fallthruGet(this, 'extensions', '');
                },
                set: noopfn
            },
            'onclose': {
                get: function() {
                    return fallthruGet(this, 'onclose', null);
                },
                set: function(value) {
                    fallthruSet(this, 'onclose', value);
                }
            },
            'onerror': {
                get: function() {
                    return fallthruGet(this, 'onerror', null);
                },
                set: function(value) {
                    fallthruSet(this, 'onerror', value);
                }
            },
            'onmessage': {
                get: function() {
                    return fallthruGet(this, 'onmessage', null);
                },
                set: function(value) {
                    fallthruSet(this, 'onmessage', value);
                }
            },
            'onopen': {
                get: function() {
                    return fallthruGet(this, 'onopen', null);
                },
                set: function(value) {
                    fallthruSet(this, 'onopen', value);
                }
            },
            'protocol': {
                get: function() {
                    return fallthruGet(this, 'protocol', '');
                },
                set: noopfn
            },
            'readyState': {
                get: function() {
                    return fallthruGet(this, 'readyState', 0);
                },
                set: noopfn
            },
            'url': {
                get: function() {
                    return fallthruGet(this, 'url', '');
                },
                set: noopfn
            }
        });

        toWrapped.set(this, {
            args: { url: url, protocols: protocols },
            properties: {}
        });

        var img = new Image();
        img.src = 
              window.location.origin
            + '?url=' + encodeURIComponent(url)
            + '&ubofix=f41665f3028c7fd10eecf573336216d3';
        img.onload = onResponseReceived.bind(img, this, true);
        img.onerror = onResponseReceived.bind(img, this, false);
    };

    WebSocket.prototype.CONNECTING = 0;
    WebSocket.prototype.OPEN = 1;
    WebSocket.prototype.CLOSING = 2;
    WebSocket.prototype.CLOSED = 3;

    WebSocket.prototype.close = function(code, reason) {
        var wrapped = toWrapped.get(this);
        if ( wrapped instanceof Wrapped ) {
            wrapped.close(code, reason);
        }
    };

    WebSocket.prototype.send = function(data) {
        var wrapped = toWrapped.get(this);
        if ( wrapped instanceof Wrapped ) {
            wrapped.send(data);
        }
    };

    window.WebSocket = WebSocket;

    var me = document.getElementById('ubofix-f41665f3028c7fd10eecf573336216d3');
    if ( me !== null && me.parentNode !== null ) {
        me.parentNode.removeChild(me);
    }
})();

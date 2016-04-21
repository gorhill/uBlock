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

    var WS = window.WebSocket;
    var toWrapped = new WeakMap();

    var onClose = function(ev) {
        var wrapped = toWrapped.get(this);
        if ( !wrapped ) {
            return;
        }
        this.readyState = wrapped.readyState;
        if ( this.onclose !== null ) {
            this.onclose(ev);
        }
    };

    var onError = function(ev) {
        var wrapped = toWrapped.get(this);
        if ( !wrapped ) {
            return;
        }
        this.readyState = wrapped.readyState;
        if ( this.onerror !== null ) {
            this.onerror(ev);
        }
    };

    var onMessage = function(ev) {
        if ( this.onmessage !== null ) {
            this.onmessage(ev);
        }
    };

    var onOpen = function(ev) {
        var wrapped = toWrapped.get(this);
        if ( !wrapped ) {
            return;
        }
        this.readyState = wrapped.readyState;
        if ( this.onopen !== null ) {
            this.onopen(ev);
        }
    };

    var onAllowed = function(ws, url, protocols) {
        this.removeEventListener('load', onAllowed);
        this.removeEventListener('error', onBlocked);
        connect(ws, url, protocols);
    };

    var onBlocked = function(ws) {
        this.removeEventListener('load', onAllowed);
        this.removeEventListener('error', onBlocked);
        if ( ws.onerror !== null ) {
            ws.onerror(new window.ErrorEvent('error'));
        }
    };

    var connect = function(wrapper, url, protocols) {
        var wrapped = new WS(url, protocols);
        toWrapped.set(wrapper, wrapped);
        wrapped.onclose = onClose.bind(wrapper);
        wrapped.onerror = onError.bind(wrapper);
        wrapped.onmessage = onMessage.bind(wrapper);
        wrapped.onopen = onOpen.bind(wrapper);
    };

    var WebSocket = function(url, protocols) {
        this.binaryType = '';
        this.bufferedAmount = 0;
        this.extensions = '';
        this.onclose = null;
        this.onerror = null;
        this.onmessage = null;
        this.onopen = null;
        this.protocol = '';
        this.readyState = this.CONNECTING;
        this.url = url;

        if ( /^wss?:\/\//.test(url) === false ) {
            connect(this, url, protocols);
            return;
        }

        var img = new Image();
        img.src = 
              window.location.origin
            + '?url=' + encodeURIComponent(url)
            + '&ubofix=f41665f3028c7fd10eecf573336216d3';
        img.addEventListener('load', onAllowed.bind(img, this, url, protocols));
        img.addEventListener('error', onBlocked.bind(img, this, url, protocols));
    };

    WebSocket.prototype.close = function(code, reason) {
        var wrapped = toWrapped.get(this);
        if ( !wrapped ) {
            return;
        }
        wrapped.close(code, reason);
    };

    WebSocket.prototype.send = function(data) {
        var wrapped = toWrapped.get(this);
        if ( !wrapped ) {
            return;
        }
        wrapped.send(data);
    };

    WebSocket.prototype.CONNECTING = 0;
    WebSocket.prototype.OPEN = 1;
    WebSocket.prototype.CLOSING = 2;
    WebSocket.prototype.CLOSED = 3;

    window.WebSocket = WebSocket;

    var me = document.getElementById('ubofix-f41665f3028c7fd10eecf573336216d3');
    if ( me !== null && me.parentNode !== null ) {
        me.parentNode.removeChild(me);
    }
})();

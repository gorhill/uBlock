/*******************************************************************************

 uBlock - a browser extension to block requests.
 Copyright (C) 2014-2016 The uBlock authors

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

// __MSG_clientInjectedScript__
var ce = CustomEvent,
    wo = open,
    xo = XMLHttpRequest.prototype.open,
    img = Image,
    linkResolver = document.createElement('a');
var block = function(u, t) {
    if (typeof u !== 'string') return false;
    /* __MSG_eventScript__ */
    document.documentElement.setAttribute('data-ublock-blocked', '');
    document.dispatchEvent(e);
    return !!document.documentElement.getAttribute('data-ublock-blocked');
};
Image = function() {
    var x = new img(),
        src = '';
    try {
        Object.defineProperty(x, 'src', {
            get: function() {
                return src;
            },
            set: function(val) {
                if (block(val, 'image')) {
                    val = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=';
                    if (x.width === 1) x.width = 0;
                    if (x.height === 1) x.height = 0;
                }
                x.setAttribute('src', val);
                // Resolve relative URL
                linkResolver.href = val;
                src = linkResolver.href;
            }
        });
    } catch (e) {
    }
    return x;
};
open = function(u) {
    if (block(u, 'popup')) return null;
    else return wo.apply(this, arguments);
};
XMLHttpRequest.prototype.open = function(m, u) {
    if (block(u, 'xmlhttprequest')) {
        xo.apply(this, [m, '']);
    } else {
        xo.apply(this, arguments);
    }
};
if ( window.Worker instanceof Function ) {
    var RealWorker = window.Worker;
    var WrappedWorker = function(url) {
        if ( this instanceof WrappedWorker === false ) { return RealWorker(); };
        if ( block(url, 'worker') ) {
            return new RealWorker(window.URL.createObjectURL(new Blob([';'], {type:'text/javascript'})));
        };
        return new RealWorker(url);
    };
    WrappedWorker.prototype = RealWorker.prototype;
    window.Worker = WrappedWorker.bind(window);
};

// __MSG_historyScript__
var pS = history.pushState,
    rS = history.replaceState,
    onStateChange = function(e) {
        if (!e || e.state !== null) {
            block(location.href, 'popstate');
        }
    };
window.addEventListener('popstate', onStateChange, true);
history.pushState = function() {
    var r = pS.apply(this, arguments);
    onStateChange();
    return r;
};
history.replaceState = function() {
    var r = rS.apply(this, arguments);
    onStateChange();
    return r;
};

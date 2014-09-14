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

/* jshint multistr: true */
/* global chrome */

// Injected into content pages

/******************************************************************************/

// OK, I keep changing my mind whether a closure should be used or not. This
// will be the rule: if there are any variables directly accessed on a regular
// basis, use a closure so that they are cached. Otherwise I don't think the
// overhead of a closure is worth it. That's my understanding.

(function() {

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/httpswitchboard/issues/345

var uBlockMessaging = (function(name){
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
})('contentscript-start.js');

/******************************************************************************/
/******************************************************************************/

// Domain-based ABP cosmetic filters.
// These can be inserted before the DOM is loaded.

var cosmeticFilters = function(details) {
    var style = document.createElement('style');
    style.setAttribute('id', 'ublock-preload-1ae7a5f130fc79b4fdb8a4272d9426b5');
    var donthide = details.cosmeticDonthide;
    var hide = details.cosmeticHide;
    if ( donthide.length !== 0 ) {
        donthide = donthide.length !== 1 ? donthide.join(',\n') : donthide[0];
        donthide = donthide.split(',\n');
        style.setAttribute('data-ublock-exceptions', JSON.stringify(donthide));
        // https://github.com/gorhill/uBlock/issues/143
        if ( hide.length !== 0 ) {
            // I chose to use Array.indexOf() instead of converting the array to
            // a map, then deleting whitelisted selectors, and then converting
            // back the map into an array, because there are typically very few
            // exception filters, if any.
            hide = hide.length !== 1 ? hide.join(',\n') : hide[0];
            hide = hide.split(',\n');
            var i = donthide.length, j;
            while ( i-- ) {
                j = hide.indexOf(donthide[i]);
                if ( j !== -1 ) {
                    hide.splice(j, 1);
                }
            }
        }
    }
    if ( hide.length !== 0 ) {
        var text = hide.join(',\n');
        hideElements(text);
        // The linefeed before the style block is very important: do no remove!
        style.appendChild(document.createTextNode(text + '\n{display:none !important;}'));
        //console.debug('µBlock> "%s" cosmetic filters: injecting %d CSS rules:', details.domain, details.hide.length, hideStyleText);
    }
    var parent = document.head || document.documentElement;
    if ( parent ) {
        parent.appendChild(style);
    }
};

var netFilters = function(details) {
    var parent = document.head || document.documentElement;
    if ( !parent ) {
        return;
    }
    var style = document.createElement('style');
    style.setAttribute('class', 'ublock-preload-1ae7a5f130fc79b4fdb8a4272d9426b5');
    var text = details.netHide.join(',\n');
    var css = details.netCollapse ?
        '\n{display:none !important;}' :
        '\n{visibility:hidden !important;}';
    style.appendChild(document.createTextNode(text + css));
    parent.appendChild(style);
    //console.debug('document.querySelectorAll("%s") = %o', text, document.querySelectorAll(text));
};

var filteringHandler = function(details) {
    // The port will never be used again at this point, disconnecting allows
    // the browser to flush this script from memory.
    uBlockMessaging.stop();
    if ( !details ) {
        return;
    }
    if ( details.cosmeticHide.length !== 0 || details.cosmeticDonthide.length !== 0 ) {
        cosmeticFilters(details);
    }
    if ( details.netHide.length !== 0 ) {
        netFilters(details);
    }
};

var hideElements = function(selectors) {
    if ( document.body === null ) {
        return;
    }
    // https://github.com/gorhill/uBlock/issues/158
    // Using CSSStyleDeclaration.setProperty is more reliable
    var elems = document.querySelectorAll(selectors);
    var i = elems.length;
    while ( i-- ) {
        elems[i].style.setProperty('display', 'none', 'important');
    }
};

uBlockMessaging.ask(
    {
        what: 'retrieveDomainCosmeticSelectors',
        pageURL: window.location.href,
        locationURL: window.location.href
    },
    filteringHandler
);

/******************************************************************************/
/******************************************************************************/

})();

/******************************************************************************/

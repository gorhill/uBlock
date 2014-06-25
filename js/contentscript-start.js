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

var messaging = (function(name){
    var port = null;
    var dangling = false;
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
        callback(details.msg);
        delete requestIdToCallbackMap[details.id];
        checkDisconnect();
    };

    var start = function(name) {
        port = chrome.runtime.connect({
            name:   name +
                    '/' +
                    String.fromCharCode(
                        Math.random() * 0x7FFF | 0, 
                        Math.random() * 0x7FFF | 0,
                        Math.random() * 0x7FFF | 0,
                        Math.random() * 0x7FFF | 0
                    )
        });
        port.onMessage.addListener(onPortMessage);
    };

    if ( typeof name === 'string' && name.length > 0 ) {
        start(name);
    }

    var stop = function() {
        listenCallback = null;
        dangling = true;
        checkDisconnect();
    };

    var ask = function(msg, callback) {
        if ( !callback ) {
            tell(msg);
            return;
        }
        var id = requestId++;
        port.postMessage({ id: id, msg: msg });
        requestIdToCallbackMap[id] = callback;
    };

    var tell = function(msg) {
        port.postMessage({ id: 0, msg: msg });
    };

    var listen = function(callback) {
        listenCallback = callback;
    };

    var checkDisconnect = function() {
        if ( !dangling ) {
            return;
        }
        if ( Object.keys(requestIdToCallbackMap).length ) {
            return;
        }
        port.disconnect();
        port = null;
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

var domainCosmeticFilteringHandler = function(selectors) {
    if ( !selectors ) {
        return;
    }
    var styleText = [];
    if ( selectors.hide.length ) {
        var hideStyleText = '{{hideSelectors}} {display:none !important;}'
            .replace('{{hideSelectors}}', selectors.hide.join(','));
        styleText.push(hideStyleText);
        domainCosmeticFilteringApplyCSS(selectors.hide, 'display', 'none');
        //console.debug('µBlock> "%s" cosmetic filters: injecting %d CSS rules:', selectors.domain, selectors.hide.length, hideStyleText);
    }
    if ( selectors.donthide.length ) {
        var dontHideStyleText = '{{donthideSelectors}} {display:initial !important;}'
            .replace('{{donthideSelectors}}', selectors.donthide.join(','));
        styleText.push(dontHideStyleText);
        domainCosmeticFilteringApplyCSS(selectors.donthide, 'display', 'initial');
        //console.debug('µBlock> "%s" cosmetic filters: injecting %d CSS rules:', selectors.domain, selectors.donthide.length, dontHideStyleText);
    }
    if ( styleText.length > 0 ) {
        var style = document.createElement('style');
        style.appendChild(document.createTextNode(styleText.join('\n')));
        if ( selectors.donthide.length > 0 ) {
            style.setAttribute(
                'id',
                'uBlock1ae7a5f130fc79b4fdb8a4272d9426b5'
            );
            style.setAttribute(
                'uBlock1ae7a5f130fc79b4fdb8a4272d9426b5',
                encodeURIComponent(selectors.donthide.join('\n'))
            );
        }
        var parent = document.head || document.documentElement;
        if ( parent ) {
            parent.appendChild(style);
        }
    }
};

var domainCosmeticFilteringApplyCSS = function(selectors, prop, value) {
    if ( document.body === null ) {
        return;
    }
    var elems = document.querySelectorAll(selectors);
    var i = elems.length;
    while ( i-- ) {
        elems[i].style[prop] = value;
    }
};

messaging.ask(
    {
        what: 'retrieveDomainCosmeticSelectors',
        pageURL: window.location.href,
        locationURL: window.location.href
    },
    domainCosmeticFilteringHandler
);

/******************************************************************************/
/******************************************************************************/

// The port will never be used again at this point, disconnecting allows
// the browser to flush this script from memory.

messaging.stop();

/******************************************************************************/
/******************************************************************************/

})();

/******************************************************************************/

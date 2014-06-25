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
})('contentscript-end.js');

/******************************************************************************/
/******************************************************************************/

(function() {

/******************************************************************************/

// ABP cosmetic filters

var CosmeticFiltering = function() {
    this.queriedSelectors = {};
    this.injectedSelectors = {};
    this.classSelectors = null;
    this.idSelectors = null;
};

CosmeticFiltering.prototype.onDOMContentLoaded = function() {
    // https://github.com/gorhill/uBlock/issues/14
    // Treat any existing domain-specific exception selectors as if they had
    // been injected already.
    var style = document.getElementById('uBlock1ae7a5f130fc79b4fdb8a4272d9426b5');
    var exceptions = style && style.getAttribute('uBlock1ae7a5f130fc79b4fdb8a4272d9426b5');
    if ( exceptions ) {
        exceptions = decodeURIComponent(exceptions).split('\n');
        var i = exceptions.length;
        while ( i-- ) {
            this.injectedSelectors[exceptions[i]] = true;
        }
    }

    // TODO: evaluate merging into a single loop
    this.classesFromNodeList(document.querySelectorAll('*[class]'));
    this.idsFromNodeList(document.querySelectorAll('*[id]'));
    this.retrieveGenericSelectors();
};

CosmeticFiltering.prototype.retrieveGenericSelectors = function() {
    var selectors = this.classSelectors !== null ? Object.keys(this.classSelectors) : [];
    if ( this.idSelectors !== null ) {
        selectors = selectors.concat(this.idSelectors);
    }
    if ( selectors.length > 0 ) {
        //console.log('µBlock> ABP cosmetic filters: retrieving CSS rules using %d selectors', selectors.length);
        messaging.ask({
                what: 'retrieveGenericCosmeticSelectors',
                pageURL: window.location.href,
                selectors: selectors
            },
            this.retrieveHandler.bind(this)
        );
    }
    this.idSelectors = null;
    this.classSelectors = null;
};

CosmeticFiltering.prototype.retrieveHandler = function(selectors) {
    if ( !selectors ) {
        return;
    }
    var styleText = [];
    this.filterUnfiltered(selectors.hideUnfiltered, selectors.hide);
    this.reduce(selectors.hide, this.injectedSelectors);
    if ( selectors.hide.length ) {
        var hideStyleText = '{{hideSelectors}} {display:none !important;}'
            .replace('{{hideSelectors}}', selectors.hide.join(','));
        styleText.push(hideStyleText);
        this.applyCSS(selectors.hide, 'display', 'none');
        //console.debug('µBlock> generic cosmetic filters: injecting %d CSS rules:', selectors.hide.length, hideStyleText);
    }
    this.filterUnfiltered(selectors.donthideUnfiltered, selectors.donthide);
    this.reduce(selectors.donthide, this.injectedSelectors);
    if ( selectors.donthide.length ) {
        var dontHideStyleText = '{{donthideSelectors}} {display:initial !important;}'
            .replace('{{donthideSelectors}}', selectors.donthide.join(','));
        styleText.push(dontHideStyleText);
        this.applyCSS(selectors.donthide, 'display', 'initial');
        //console.debug('µBlock> generic cosmetic filters: injecting %d CSS rules:', selectors.donthide.length, dontHideStyleText);
    }
    if ( styleText.length > 0 ) {
        var style = document.createElement('style');
        style.appendChild(document.createTextNode(styleText.join('\n')));
        var parent = document.body || document.documentElement;
        if ( parent ) {
            parent.appendChild(style);
        }
    }
};

CosmeticFiltering.prototype.applyCSS = function(selectors, prop, value) {
    if ( document.body === null ) {
        return;
    }
    var elems = document.querySelectorAll(selectors);
    var i = elems.length;
    while ( i-- ) {
        elems[i].style[prop] = value;
    }
};

CosmeticFiltering.prototype.filterUnfiltered = function(inSelectors, outSelectors) {
    var i = inSelectors.length;
    var selector;
    while ( i-- ) {
        selector = inSelectors[i];
        if ( this.injectedSelectors[selector] ) {
            continue;
        }
        if ( document.querySelector(selector) !== null ) {
            outSelectors.push(selector);
        }
    }
};

CosmeticFiltering.prototype.reduce = function(selectors, dict) {
    var i = selectors.length, selector, end;
    while ( i-- ) {
        selector = selectors[i];
        if ( !dict[selector] ) {
            if ( end !== undefined ) {
                selectors.splice(i+1, end-i);
                end = undefined;
            }
            dict[selector] = true;
        } else if ( end === undefined ) {
            end = i;
        }
    }
    if ( end !== undefined ) {
        selectors.splice(0, end+1);
    }
};

CosmeticFiltering.prototype.classesFromNodeList = function(nodes) {
    if ( !nodes ) {
        return;
    }
    if ( this.classSelectors === null ) {
        this.classSelectors = {};
    }
    var classNames, className, j;
    var i = nodes.length;
    while ( i-- ) {
        className = nodes[i].className;
        if ( typeof className !== 'string' ) {
            continue;
        }
        className = className.trim();
        if ( className === '' ) {
            continue;
        }
        if ( className.indexOf(' ') < 0 ) {
            className = '.' + className;
            if ( this.queriedSelectors[className] ) {
                continue;
            }
            this.classSelectors[className] = true;
            this.queriedSelectors[className] = true;
            continue;
        }
        classNames = className.trim().split(/\s+/);
        j = classNames.length;
        while ( j-- ) {
            className = classNames[j];
            if ( className === '' ) {
                continue;
            }
            className = '.' + className;
            if ( this.queriedSelectors[className] ) {
                continue;
            }
            this.classSelectors[className] = true;
            this.queriedSelectors[className] = true;
        }
    }
};

CosmeticFiltering.prototype.idsFromNodeList = function(nodes) {
    if ( !nodes ) {
        return;
    }
    if ( this.idSelectors === null ) {
        this.idSelectors = [];
    }
    var id;
    var i = nodes.length;
    while ( i-- ) {
        id = nodes[i].id;
        if ( !id ) {
            continue;
        }
        id = '#' + id;
        if ( this.queriedSelectors[id] ) {
            continue;
        }
        this.idSelectors.push(id);
        this.queriedSelectors[id] = true;
    }
};

CosmeticFiltering.prototype.allFromNodeList = function(nodes) {
    this.classesFromNodeList(nodes);
    this.idsFromNodeList(nodes);
    var i = nodes.length;
    var node;
    while ( i-- ) {
        node = nodes[i];
        if ( node.querySelectorAll ) {
            this.classesFromNodeList(node.querySelectorAll('*[class]'));
            this.idsFromNodeList(node.querySelectorAll('*[id]'));
        }
    }
};

var cosmeticFiltering = new CosmeticFiltering();

/******************************************************************************/

var mutationObservedHandler = function(mutations) {
    var iMutation = mutations.length;
    var mutation;
    while ( iMutation-- ) {
        mutation = mutations[iMutation];
        if ( mutation.addedNodes ) {
            cosmeticFiltering.allFromNodeList(mutation.addedNodes);
        }
    }

    cosmeticFiltering.retrieveGenericSelectors();
};

/******************************************************************************/

// rhill 2013-11-09: Weird... This code is executed from µBlock
// context first time extension is launched. Avoid this.
// TODO: Investigate if this was a fluke or if it can really happen.
// I suspect this could only happen when I was using chrome.tabs.executeScript(),
// because now a delarative content script is used, along with "http{s}" URL
// pattern matching.

// console.debug('µBlock> window.location.href = "%s"', window.location.href);

if ( /^https?:\/\/./.test(window.location.href) === false ) {
    console.debug("Huh?");
    return;
}

cosmeticFiltering.onDOMContentLoaded();

// Observe changes in the DOM

// This fixes http://acid3.acidtests.org/
if ( document.body ) {
    // https://github.com/gorhill/httpswitchboard/issues/176
    var observer = new MutationObserver(mutationObservedHandler);
    observer.observe(document.body, {
        attributes: false,
        childList: true,
        characterData: false,
        subtree: true
    });
}

/******************************************************************************/

})();

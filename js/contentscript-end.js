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

(function() {

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

// ABP cosmetic filters

var cosmeticFiltering = (function() {

    var queriedSelectors = {};
    var injectedSelectors = {};
    var classSelectors = null;
    var idSelectors = null;

    var domLoaded = function() {
        // https://github.com/gorhill/uBlock/issues/14
        // Treat any existing domain-specific exception selectors as if they had
        // been injected already.
        var style = document.getElementById('uBlock1ae7a5f130fc79b4fdb8a4272d9426b5');
        var exceptions = style && style.getAttribute('uBlock1ae7a5f130fc79b4fdb8a4272d9426b5');
        if ( exceptions ) {
            exceptions = decodeURIComponent(exceptions).split('\n');
            var i = exceptions.length;
            while ( i-- ) {
                injectedSelectors[exceptions[i]] = true;
            }
        }

        // TODO: evaluate merging into a single loop
        selectorsFromNodeList(document.querySelectorAll('*[class],*[id]'));
        retrieveGenericSelectors();
    };

    var retrieveGenericSelectors = function() {
        var selectors = classSelectors !== null ? Object.keys(classSelectors) : [];
        if ( idSelectors !== null ) {
            selectors = selectors.concat(idSelectors);
        }
        if ( selectors.length > 0 ) {
            //console.log('µBlock> ABP cosmetic filters: retrieving CSS rules using %d selectors', selectors.length);
            messaging.ask({
                    what: 'retrieveGenericCosmeticSelectors',
                    pageURL: window.location.href,
                    selectors: selectors
                },
                retrieveHandler
            );
        }
        idSelectors = null;
        classSelectors = null;
    };

    var retrieveHandler = function(selectors) {
        if ( !selectors ) {
            return;
        }
        var styleText = [];
        filterLowGenerics(selectors, 'hide');
        filterHighGenerics(selectors, 'hide');
        reduce(selectors.hide, injectedSelectors);
        if ( selectors.hide.length ) {
            var hideStyleText = '{{hideSelectors}} {display:none !important;}'
                .replace('{{hideSelectors}}', selectors.hide.join(','));
            styleText.push(hideStyleText);
            applyCSS(selectors.hide, 'display', 'none');
            //console.debug('µBlock> generic cosmetic filters: injecting %d CSS rules:', selectors.hide.length, hideStyleText);
        }
        filterLowGenerics(selectors, 'donthide');
        filterHighGenerics(selectors, 'donthide');
        reduce(selectors.donthide, injectedSelectors);
        if ( selectors.donthide.length ) {
            var dontHideStyleText = '{{donthideSelectors}} {display:initial !important;}'
                .replace('{{donthideSelectors}}', selectors.donthide.join(','));
            styleText.push(dontHideStyleText);
            applyCSS(selectors.donthide, 'display', 'initial');
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

    var applyCSS = function(selectors, prop, value) {
        if ( document.body === null ) {
            return;
        }
        var elems = document.querySelectorAll(selectors);
        var i = elems.length;
        while ( i-- ) {
            elems[i].style[prop] = value;
        }
    };

    var filterTitleGeneric = function(generics, root, out) {
        if ( !root.title.length ) {
            return;
        }
        var selector = '[title="' + root.title + '"]';
        if ( generics[selector] && !injectedSelectors[selector] ) {
            out.push(selector);
        }
        selector = root.tagName + selector;
        if ( generics[selector] && !injectedSelectors[selector] ) {
            out.push(selector);
        }
    };

    var filterAltGeneric = function(generics, root, out) {
        var alt = root.getAttribute('alt');
        if ( !alt || !alt.length ) {
            return;
        }
        var selector = '[alt="' + root.title + '"]';
        if ( generics[selector] && !injectedSelectors[selector] ) {
            out.push(selector);
        }
        selector = root.tagName + selector;
        if ( generics[selector] && !injectedSelectors[selector] ) {
            out.push(selector);
        }
    };

    var filterLowGenerics = function(selectors, what) {
        if ( selectors[what + 'LowGenericCount'] === 0 ) {
            return;
        }
        var out = selectors[what];
        var generics = selectors[what + 'LowGenerics'];
        var nodeList, iNode;
        // Low generics: ["title"]
        nodeList = document.querySelectorAll('[title]');
        iNode = nodeList.length;
        while ( iNode-- ) {
            filterTitleGeneric(generics, nodeList[iNode], out);
        }
        // Low generics: ["alt"]
        nodeList = document.querySelectorAll('[alt]');
        iNode = nodeList.length;
        while ( iNode-- ) {
            filterAltGeneric(generics, nodeList[iNode], out);
        }
    };

    var filterHighGenerics = function(selectors, what) {
        var out = selectors[what];
        var generics = selectors[what + 'HighGenerics'];
        var iGeneric = generics.length;
        var selector;
        while ( iGeneric-- ) {
            selector = generics[iGeneric];
            if ( injectedSelectors[selector] ) {
                continue;
            }
            if ( document.querySelector(selector) !== null ) {
                out.push(selector);
            }
        }
    };

    var reduce = function(selectors, dict) {
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

    var selectorsFromNodeList = function(nodes) {
        if ( !nodes || !nodes.length ) {
            return;
        }
        if ( idSelectors === null ) {
            idSelectors = [];
        }
        if ( classSelectors === null ) {
            classSelectors = {};
        }
        var qq = queriedSelectors;
        var cc = classSelectors;
        var ii = idSelectors;
        var node, v, classNames, j;
        var i = nodes.length;
        while ( i-- ) {
            node = nodes[i];
            if ( node.nodeType !== 1 ) {
                continue;
            }
            // id
            v = nodes[i].id.trim();
            if ( v !== '' ) {
                v = '#' + v;
                if ( !qq[v] ) {
                    ii.push(v);
                    qq[v] = true;
                }
            }
            // class
            v = nodes[i].className;
            // it could be an SVGAnimatedString...
            if ( typeof v !== 'string' ) { continue; }
            v = v.trim();
            if ( v === '' ) { continue; }
            // one class
            if ( v.indexOf(' ') < 0 ) {
                v = '.' + v;
                if ( qq[v] ) { continue; }
                cc[v] = true;
                qq[v] = true;
                continue;
            }
            // many classes
            classNames = v.trim().split(/\s+/);
            j = classNames.length;
            while ( j-- ) {
                v = classNames[j];
                if ( v === '' ) { continue; }
                v = '.' + v;
                if ( qq[v] ) { continue; }
                cc[v] = true;
                qq[v] = true;
            }
        }
    };

    var processNodeLists = function(nodeLists) {
        var i = nodeLists.length;
        var nodeList, j, node;
        while ( i-- ) {
            nodeList = nodeLists[i];
            selectorsFromNodeList(nodeList);
            j = nodeList.length;
            while ( j-- ) {
                node = nodeList[j];
                if ( node.querySelectorAll ) {
                    selectorsFromNodeList(node.querySelectorAll('*[id],*[class]'));
                }
            }
        }
        retrieveGenericSelectors();
    };

    domLoaded();

    return {
        processNodeLists: processNodeLists
    };
})();

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/7

var blockedElementHider = (function() {
    var hideOne = function(elem, collapse) {
        // If `!important` is not there, going back using history will likely
        // cause the hidden element to re-appear.
        elem.style.visibility = 'hidden !important';
        if ( collapse && elem.parentNode ) {
            elem.parentNode.removeChild(elem);
        }
    };

    var observeOne = function(elem) {
        var onComplete = function() {
            var elem = this;
            var onAnswerReceived = function(details) {
                if ( details.blocked ) {
                    hideOne(elem, details.collapse);
                }
            };
            messaging.ask({ what: 'blockedRequest', url: this.src }, onAnswerReceived);
            this.removeEventListener('load', onComplete);
        };
        elem.addEventListener('load', onComplete);
    };

    var hideMany = function(elems, details) {
        var blockedRequests = details.blockedRequests;
        var collapse = details.collapse;
        var i = elems.length;
        var elem, src;
        while ( i-- ) {
            elem = elems[i];
            src = elem.src;
            if ( typeof src !== 'string' ) {
                continue;
            }
            if ( src === '' ) {
                observeOne(elem);
            } else if ( blockedRequests[src] ) {
                hideOne(elem, collapse);
            }
        }
    };

    var processElements = function(elems) {
        var blockedRequestsReceived = function(details) {
            hideMany(elems, details);
            var i = elems.length;
            while ( i-- ) {
                hideMany(elems[i].querySelectorAll('img,iframe'), details);
            }
        };
        messaging.ask({ what: 'blockedRequests' }, blockedRequestsReceived);
    };

    // rhill 2014-07-01: Avoid useless work: only nodes which are element are
    // of interest at this point -- because it is common that a lot of plain
    // text nodes get added.
    var addNodeLists = function(nodeLists) {
        var elems = [];
        var i = nodeLists.length;
        var nodeList, j, node;
        while ( i-- ) {
            nodeList = nodeLists[i];
            j = nodeList.length;
            while ( j-- ) {
                node = nodeList[j];
                if ( node.querySelectorAll ) {
                    elems.push(node);
                }
            }
        }
        if ( elems.length ) {
            processElements(elems);
        }
    };

    var onBlockedRequestsReceived = function(details) {
        hideMany(document.querySelectorAll('img,iframe'), details);
    };
    messaging.ask({ what: 'blockedRequests' }, onBlockedRequestsReceived);

    return {
        addNodeLists: addNodeLists
    };
})();

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

/******************************************************************************/

// Observe changes in the DOM

var mutationObservedHandler = function(mutations) {
    var iMutation = mutations.length;
    var nodeLists = [], nodeList;
    while ( iMutation-- ) {
        nodeList = mutations[iMutation].addedNodes;
        if ( nodeList && nodeList.length ) {
            nodeLists.push(nodeList);
        }
    }
    if ( nodeLists.length ) {
        cosmeticFiltering.processNodeLists(nodeLists);
        blockedElementHider.addNodeLists(nodeLists);
    }
};

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

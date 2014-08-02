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

(function() {
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
        idsFromNodeList(document.querySelectorAll('[id]'));
        classesFromNodeList(document.querySelectorAll('[class]'));
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

    var idsFromNodeList = function(nodes) {
        if ( !nodes || !nodes.length ) {
            return;
        }
        if ( idSelectors === null ) {
            idSelectors = [];
        }
        var qq = queriedSelectors;
        var ii = idSelectors;
        var node, v;
        var i = nodes.length;
        while ( i-- ) {
            node = nodes[i];
            if ( node.nodeType !== 1 ) { continue; }
            // id
            v = nodes[i].id;
            // quite unlikely, so no need to be fancy
            if ( typeof v !== 'string' ) { continue; }
            v = v.trim();
            if ( v === '' ) { continue; }
            v = '#' + v;
            if ( qq[v] ) { continue; }
            ii.push(v);
            qq[v] = true;
        }
    };

    var classesFromNodeList = function(nodes) {
        if ( !nodes || !nodes.length ) {
            return;
        }
        if ( classSelectors === null ) {
            classSelectors = {};
        }
        var qq = queriedSelectors;
        var cc = classSelectors;
        var node, v, vv, j;
        var i = nodes.length;
        while ( i-- ) {
            node = nodes[i];
            if ( node.nodeType !== 1 ) { continue; }
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
            vv = v.trim().split(' ');
            j = vv.length;
            while ( j-- ) {
                v = vv[j].trim();
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
            idsFromNodeList(nodeList);
            classesFromNodeList(nodeList);
            j = nodeList.length;
            while ( j-- ) {
                node = nodeList[j];
                if ( typeof node.querySelectorAll === 'function' ) {
                    idsFromNodeList(node.querySelectorAll('[id]'));
                    classesFromNodeList(node.querySelectorAll('[class]'));
                }
            }
        }
        retrieveGenericSelectors();
    };

    domLoaded();

    // Observe changes in the DOM only if...
    // - there is a document.body
    // - there is at least one `script` tag
    if ( !document.body || !document.querySelector('script') ) {
        return;
    }

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
            processNodeLists(nodeLists);
        }
    };
    // https://github.com/gorhill/httpswitchboard/issues/176
    var observer = new MutationObserver(mutationObservedHandler);
    observer.observe(document.body, {
        attributes: false,
        childList: true,
        characterData: false,
        subtree: true
    });
})();

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/7

(function() {
    var hideOne = function(elem, collapse) {
        // If `!important` is not there, going back using history will likely
        // cause the hidden element to re-appear.
        elem.style.visibility = 'hidden !important';
        if ( collapse && elem.parentNode ) {
            elem.parentNode.removeChild(elem);
        }
    };

    // First pass
    messaging.ask({ what: 'blockedRequests' }, function(details) {
        var elems = document.querySelectorAll('img,iframe');
        var blockedRequests = details.blockedRequests;
        var collapse = details.collapse;
        var i = elems.length;
        var elem, src;
        while ( i-- ) {
            elem = elems[i];
            src = elem.src;
            if ( typeof src !== 'string' || src === '' ) {
                continue;
            }
            if ( blockedRequests[src] ) {
                hideOne(elem, collapse);
            }
        }
    });

    // Listeners to mop up whatever is otherwise missed:
    // - Future requests not blocked yet
    // - Elements dynamically added to the page
    // - Elements which resource URL changes
    var onResourceLoaded = function(ev) {
        var target = ev.target;
        if ( !target || !target.src ) { return; }
        if ( target.tagName.toLowerCase() !== 'iframe' ) { return; }
        var onAnswerReceived = function(details) {
            if ( details.blocked ) {
                hideOne(target, details.collapse);
            }
        };
        messaging.ask({ what: 'blockedRequest', url: target.src }, onAnswerReceived);
    };
    var onResourceFailed = function(ev) {
        var target = ev.target;
        if ( !target || !target.src ) { return; }
        if ( target.tagName.toLowerCase() !== 'img' ) { return; }
        var onAnswerReceived = function(details) {
            if ( details.blocked ) {
                hideOne(target, details.collapse);
            }
        };
        messaging.ask({ what: 'blockedRequest', url: target.src }, onAnswerReceived);
    };
    document.addEventListener('load', onResourceLoaded, true);
    document.addEventListener('error', onResourceFailed, true);
})();

/******************************************************************************/

})();

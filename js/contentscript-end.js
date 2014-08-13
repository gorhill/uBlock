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

// https://github.com/gorhill/httpswitchboard/issues/345

var uBlockMessaging = (function(name){
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
    var messaging = uBlockMessaging;
    var queriedSelectors = {};
    var injectedSelectors = {};
    var classSelectors = null;
    var idSelectors = null;
    var highGenerics = null;
    var contextNodes = [document];

    var domLoaded = function() {
        // https://github.com/gorhill/uBlock/issues/14
        // Treat any existing domain-specific exception selectors as if they had
        // been injected already.
        var style = document.getElementById('uBlock1ae7a5f130fc79b4fdb8a4272d9426b5');
        var exceptions = style && style.getAttribute('uBlock1ae7a5f130fc79b4fdb8a4272d9426b5');
        if ( exceptions ) {
            exceptions = JSON.parse(exceptions);
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
        if ( selectors.length > 0 || highGenerics === null ) {
            //console.log('µBlock> ABP cosmetic filters: retrieving CSS rules using %d selectors', selectors.length);
            messaging.ask({
                    what: 'retrieveGenericCosmeticSelectors',
                    pageURL: window.location.href,
                    selectors: selectors,
                    highGenerics: highGenerics === null
                },
                retrieveHandler
            );
        } else {
            retrieveHandler(null);
        }
        idSelectors = null;
        classSelectors = null;
    };

    var retrieveHandler = function(selectors) {
        //console.debug('µBlock> contextNodes = %o', contextNodes);
        if ( selectors && selectors.highGenerics ) {
            highGenerics = selectors.highGenerics;
        }
        if ( selectors && selectors.donthide.length ) {
            processLowGenerics(selectors.donthide);
        }
        if ( highGenerics ) {
            if ( highGenerics.donthideLowCount ) {
                processHighLowGenerics(highGenerics.donthideLow);
            }
            if ( highGenerics.donthideMediumCount ) {
                processHighMediumGenerics(highGenerics.donthideMedium);
            }
        }
        // No such thing as high-high generic exceptions
        //if ( highGenerics.donthideHighCount ) {
        //    processHighHighGenerics(document, highGenerics.donthideHigh);
        //}
        var hideSelectors = [];
        if ( selectors && selectors.hide.length ) {
            processLowGenerics(selectors.hide, hideSelectors);
        }
        if ( highGenerics ) {
            if ( highGenerics.hideLowCount ) {
                processHighLowGenerics(highGenerics.hideLow, hideSelectors);
            }
            if ( highGenerics.hideMediumCount ) {
                processHighMediumGenerics(highGenerics.hideMedium, hideSelectors);
            }
            if ( highGenerics.hideHighCount ) {
                processHighHighGenerics(highGenerics.hideHigh, hideSelectors);
            }
        }
        if ( hideSelectors.length ) {
            applyCSS(hideSelectors, 'display', 'none');
            var style = document.createElement('style');
            var text = hideSelectors.join(',\n') + ' {display:none !important;}';
            style.appendChild(document.createTextNode(text));
            var parent = document.body || document.documentElement;
            if ( parent ) {
                parent.appendChild(style);
            }
            //console.debug('µBlock> generic cosmetic filters: injecting %d CSS rules:', hideSelectors.length, text);
        }
        contextNodes.length = 0;
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

    var selectNodes = function(selector) {
        var targetNodes = [];
        var i = contextNodes.length;
        var node, nodeList, j;
        var doc = document;
        while ( i-- ) {
            node = contextNodes[i];
            if ( node === doc ) {
                return doc.querySelectorAll(selector);
            }
            targetNodes.push(node);
            nodeList = node.querySelectorAll(selector);
            j = nodeList.length;
            while ( j-- ) {
                targetNodes.push(nodeList[j]);
            }
        }
        return targetNodes;
    };

    var processLowGenerics = function(generics, out) {
        var i = generics.length;
        var selector;
        while ( i-- ) {
            selector = generics[i];
            if ( injectedSelectors[selector] !== undefined ) {
                continue;
            }
            injectedSelectors[selector] = true;
            if ( out !== undefined ) {
                out.push(selector);
            }
        }
    };

    var processHighLowGenerics = function(generics, out) {
        var attrs = ['title', 'alt'];
        var attr, attrValue, nodeList, iNode, node, selector;
        while ( attr = attrs.pop() ) {
            nodeList = selectNodes('[' + attr + ']');
            iNode = nodeList.length;
            while ( iNode-- ) {
                node = nodeList[iNode];
                attrValue = node.getAttribute(attr);
                if ( !attrValue ) { continue; }
                selector = '[' + attr + '="' + attrValue + '"]';
                if ( injectedSelectors[selector] === undefined && generics[selector] ) {
                    injectedSelectors[selector] = true;
                    if ( out !== undefined ) {
                        out.push(selector);
                    }
                }
                selector = node.tagName.toLowerCase() + selector;
                if ( injectedSelectors[selector] === undefined && generics[selector] ) {
                    injectedSelectors[selector] = true;
                    if ( out !== undefined ) {
                        out.push(selector);
                    }
                }
            }
        }
    };

    var processHighMediumGenerics = function(generics, out) {
        var nodeList = selectNodes('a[href^="http"]');
        var iNode = nodeList.length;
        var node, href, pos, hash, selector;
        while ( iNode-- ) {
            node = nodeList[iNode];
            href = node.getAttribute('href');
            if ( !href ) { continue; }
            pos = href.indexOf('://');
            if ( pos === -1 ) { continue; }
            hash = href.slice(pos + 3, pos + 11);
            selector = generics[hash];
            if ( selector === undefined ) { continue; }
            if ( injectedSelectors[selector] !== undefined ) { continue; }
            injectedSelectors[selector] = true;
            if ( out !== undefined ) {
                out.push(selector);
            }
        }
    };

    var processHighHighGenerics = function(generics, out) {
        if ( injectedSelectors[generics] !== undefined ) { return; }
        if ( document.querySelector(generics) === null ) { return; }
        injectedSelectors[generics] = true;
        if ( out !== undefined ) {
            var selectors = generics.split(',\n');
            var i = selectors.length;
            while ( i-- ) {
                if ( injectedSelectors[selectors[i]] !== undefined ) {
                    selectors.splice(i, 1);
                }
            }
            out.push(selectors.join(',\n'));
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

    domLoaded();

    // Observe changes in the DOM only if...
    // - there is a document.body
    // - there is at least one `script` tag
    if ( !document.body || !document.querySelector('script') ) {
        return;
    }

    var ignoreTags = {
        'style': true,
        'STYLE': true,
        'script': true,
        'SCRIPT': true
    };

    var mutationObservedHandler = function(mutations) {
        var iMutation = mutations.length;
        var nodes = [];
        var nodeList, iNode, node;
        while ( iMutation-- ) {
            nodeList = mutations[iMutation].addedNodes;
            if ( !nodeList ) {
                continue;
            }
            iNode = nodeList.length;
            while ( iNode-- ) {
                node = nodeList[iNode];
                if ( typeof node.querySelectorAll !== 'function' ) {
                    continue;
                }
                if ( ignoreTags[node.tagName] ) {
                    continue;
                }
                contextNodes.push(node);
            }
        }
        if ( contextNodes.length !== 0 ) {
            idsFromNodeList(selectNodes('[id]'));
            classesFromNodeList(selectNodes('[class]'));
            retrieveGenericSelectors();
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
    var messaging = uBlockMessaging;

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
        var elems = document.querySelectorAll('img,iframe,embed');
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
        //console.debug('Loaded %s[src="%s"]', target.tagName, target.src);
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
        //console.debug('Failed to load %s[src="%s"]', target.tagName, target.src);
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

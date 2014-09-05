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
        for ( id in requestIdToCallbackMap ) {
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
    var nullArray = { push: function(){} };

    var domLoaded = function() {
        var style = document.getElementById('ublock-preload-1ae7a5f130fc79b4fdb8a4272d9426b5');
        if ( style ) {
            // https://github.com/gorhill/uBlock/issues/14
            // Treat any existing domain-specific exception selectors as if
            // they had been injected already.
            var selectors, i;
            var exceptions = style.getAttribute('data-ublock-exceptions');
            if ( exceptions ) {
                selectors = JSON.parse(exceptions);
                i = selectors.length;
                while ( i-- ) {
                    injectedSelectors[selectors[i]] = true;
                }
            }
            // Avoid re-injecting already injected CSS rules.
            selectors = selectorsFromStyles(style);
            i = selectors.length;
            while ( i-- ) {
                injectedSelectors[selectors[i]] = true;
            }
            // https://github.com/gorhill/uBlock/issues/158
            // Ensure injected styles are enforced
            hideElements(selectors.join(','));
        }
        idsFromNodeList(document.querySelectorAll('[id]'));
        classesFromNodeList(document.querySelectorAll('[class]'));
        retrieveGenericSelectors();
    };

    var selectorsFromStyles = function(styleRef) {
        var selectors = [];
        var styles = typeof styleRef === 'string' ?
            document.querySelectorAll(styleRef):
            [styleRef];
        var i = styles.length;
        var style, subset, lastSelector, pos;
        while ( i-- ) {
            style = styles[i];
            subset = style.textContent.split(',\n');
            lastSelector = subset.pop();
            if ( lastSelector ) {
                pos = lastSelector.indexOf('\n');
                if ( pos !== -1 ) {
                    subset.push(lastSelector.slice(0, pos));
                }
            }
            selectors = selectors.concat(subset);
        }
        return selectors;
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
            processLowGenerics(selectors.donthide, nullArray);
        }
        if ( highGenerics ) {
            if ( highGenerics.donthideLowCount ) {
                processHighLowGenerics(highGenerics.donthideLow, nullArray);
            }
            if ( highGenerics.donthideMediumCount ) {
                processHighMediumGenerics(highGenerics.donthideMedium, nullArray);
            }
        }
        // No such thing as high-high generic exceptions.
        //if ( highGenerics.donthideHighCount ) {
        //    processHighHighGenerics(document, highGenerics.donthideHigh, nullArray);
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
            hideElements(hideSelectors);
            var style = document.createElement('style');
            style.setAttribute('class', 'ublock-postload-1ae7a5f130fc79b4fdb8a4272d9426b5');
            // The linefeed before the style block is very important: do no remove!
            style.appendChild(document.createTextNode(hideSelectors.join(',\n') + '\n{display:none !important;}'));
            var parent = document.body || document.documentElement;
            if ( parent ) {
                parent.appendChild(style);
            }
            messaging.tell({
                what: 'injectedSelectors',
                type: 'cosmetic',
                hostname: window.location.hostname,
                selectors: hideSelectors
            });
            //console.debug('µBlock> generic cosmetic filters: injecting %d CSS rules:', hideSelectors.length, text);
        }
        contextNodes.length = 0;
    };

    var hideElements = function(selectors) {
        // https://github.com/gorhill/uBlock/issues/207
        // Do not call querySelectorAll() using invalid CSS selectors
        if ( selectors.length === 0 ) {
            return;
        }
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
            out.push(selector);
        }
    };

    var processHighLowGenerics = function(generics, out) {
        var attrs = ['title', 'alt'];
        var attr, attrValue, nodeList, iNode, node;
        var selector;
        while ( attr = attrs.pop() ) {
            nodeList = selectNodes('[' + attr + ']');
            iNode = nodeList.length;
            while ( iNode-- ) {
                node = nodeList[iNode];
                attrValue = node.getAttribute(attr);
                if ( !attrValue ) { continue; }
                selector = '[' + attr + '="' + attrValue + '"]';
                if ( generics[selector] ) {
                    if ( injectedSelectors[selector] === undefined ) {
                        injectedSelectors[selector] = true;
                        out.push(selector);
                    }
                }
                selector = node.tagName.toLowerCase() + selector;
                if ( generics[selector] ) {
                    if ( injectedSelectors[selector] === undefined ) {
                        injectedSelectors[selector] = true;
                        out.push(selector);
                    }
                }
            }
        }
    };

    var processHighMediumGenerics = function(generics, out) {
        var nodeList = selectNodes('a[href^="http"]');
        var iNode = nodeList.length;
        var node, href, pos, hash, selectors, selector, iSelector;
        while ( iNode-- ) {
            node = nodeList[iNode];
            href = node.getAttribute('href');
            if ( !href ) { continue; }
            pos = href.indexOf('://');
            if ( pos === -1 ) { continue; }
            hash = href.slice(pos + 3, pos + 11);
            selectors = generics[hash];
            if ( selectors === undefined ) { continue; }
            selectors = selectors.split(',\n');
            iSelector = selectors.length;
            while ( iSelector-- ) {
                selector = selectors[iSelector];
                if ( injectedSelectors[selector] === undefined ) {
                    injectedSelectors[selector] = true;
                    out.push(selector);
                }
            }
        }
    };

    var processHighHighGenerics = function(generics, out) {
        if ( injectedSelectors['{{highHighGenerics}}'] !== undefined ) { return; }
        if ( document.querySelector(generics) === null ) { return; }
        injectedSelectors['{{highHighGenerics}}'] = true;
        var selectors = generics.split(',\n');
        var iSelector = selectors.length;
        var selector;
        while ( iSelector-- ) {
            selector = selectors[iSelector];
            if ( injectedSelectors[selector] === undefined ) {
                injectedSelectors[selector] = true;
                out.push(selector);
            }
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
        'link': true,
        'LINK': true,
        'script': true,
        'SCRIPT': true,
        'style': true,
        'STYLE': true
    };

    var mutationObservedHandler = function(mutations) {
        var iMutation = mutations.length;
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
                if ( ignoreTags.hasOwnProperty(node.tagName) ) {
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

    var blockableElements = {
        'embed': 'src',
        'iframe': 'src',
        'img': 'src',
        'object': 'data'
    };

    // First pass
    messaging.ask({ what: 'blockedRequests' }, function(details) {
        var elems = document.querySelectorAll('embed,iframe,img,object');
        var blockedRequests = details.blockedRequests;
        var collapse = details.collapse;
        var i = elems.length;
        var elem, tagName, prop, src;
        var selectors = [];
        while ( i-- ) {
            elem = elems[i];
            tagName = elem.tagName.toLowerCase();
            prop = blockableElements[tagName];
            if ( prop === undefined ) {
                continue;
            }
            src = elem[prop];
            if ( typeof src !== 'string' || src === '' ) {
                continue;
            }
            if ( blockedRequests[src] === undefined ) {
                continue;
            }
            // If `!important` is not there, going back using history will
            // likely cause the hidden element to re-appear.
            if ( collapse ) {
                if ( elem.parentNode ) {
                    elem.parentNode.removeChild(elem);
                } else {
                    elem.style.setProperty('display', 'none', 'important');
                }
            } else {
                elem.style.setProperty('visibility', 'hidden', 'important');
            }
            selectors.push(tagName + '[' + prop + '="' + src + '"]');
        }
        if ( selectors.length !== 0 ) {
            messaging.tell({
                what: 'injectedSelectors',
                type: 'net',
                hostname: window.location.hostname,
                selectors: selectors
            });
        }
    });

    // Listeners to mop up whatever is otherwise missed:
    // - Future requests not blocked yet
    // - Elements dynamically added to the page
    // - Elements which resource URL changes

    var loadedElements = {
        'iframe': 'src'
    };

    var failedElements = {
        'img': 'src',
        'input': 'src',
        'object': 'data'
    };

    var onResource = function(target, dict) {
        if ( !target ) {
            return;
        }
        var tagName = target.tagName.toLowerCase();
        var prop = dict[tagName];
        if ( prop === undefined ) {
            return;
        }
        var src = target[prop];
        if ( typeof src !== 'string' || src === '' ) {
            return;
        }
        // https://github.com/gorhill/uBlock/issues/174
        // Do not remove fragment from src URL

        var onAnswerReceived = function(details) {
            if ( !details.blocked ) {
                return;
            }
            // If `!important` is not there, going back using history will
            // likely cause the hidden element to re-appear.
            if ( details.collapse ) {
                if ( target.parentNode ) {
                    target.parentNode.removeChild(target);
                } else {
                    target.style.setProperty('display', 'none', 'important');
                }
            } else {
                target.style.setProperty('visibility', 'hidden', 'important');
            }
            messaging.tell({
                what: 'injectedSelectors',
                type: 'net',
                hostname: window.location.hostname,
                selectors: tagName + '[' + prop + '="' + src + '"]'
            });
        };
        messaging.ask({ what: 'blockedRequest', url: src }, onAnswerReceived);
    };

    var onResourceLoaded = function(ev) {
        //console.debug('Loaded %s[src="%s"]', ev.target.tagName, ev.target.src);
        onResource(ev.target, loadedElements);
    };

    var onResourceFailed = function(ev) {
        //console.debug('Failed to load %s[src="%s"]', ev.target.tagName, ev.target.src);
        onResource(ev.target, failedElements);
    };

    document.addEventListener('load', onResourceLoaded, true);
    document.addEventListener('error', onResourceFailed, true);
})();

/******************************************************************************/

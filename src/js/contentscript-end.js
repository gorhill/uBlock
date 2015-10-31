/*******************************************************************************

    µBlock - a browser extension to block requests.
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

/* global vAPI, HTMLDocument, XMLDocument */

/******************************************************************************/

// Injected into content pages

(function() {

'use strict';

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/464
if ( document instanceof HTMLDocument === false ) {
    // https://github.com/chrisaljoudi/uBlock/issues/1528
    // A XMLDocument can be a valid HTML document.
    if (
        document instanceof XMLDocument === false ||
        document.createElement('div') instanceof HTMLDivElement === false
    ) {
        return;
    }
}

// I've seen this happens on Firefox
if ( window.location === null ) {
    return;
}

// This can happen
if ( typeof vAPI !== 'object' ) {
    //console.debug('contentscript-end.js > vAPI not found');
    return;
}

// https://github.com/chrisaljoudi/uBlock/issues/587
// Pointless to execute without the start script having done its job.
if ( !vAPI.contentscriptStartInjected ) {
    return;
}

// https://github.com/chrisaljoudi/uBlock/issues/456
// Already injected?
if ( vAPI.contentscriptEndInjected ) {
    //console.debug('contentscript-end.js > content script already injected');
    return;
}
vAPI.contentscriptEndInjected = true;
vAPI.styles = vAPI.styles || [];

/******************************************************************************/

var messager = vAPI.messaging.channel('contentscript-end.js');

// https://github.com/gorhill/uMatrix/issues/144
vAPI.shutdown.add(function() {
    messager.close();
});

/******************************************************************************/
/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/7

var uBlockCollapser = (function() {
    var timer = null;
    var requestId = 1;
    var newRequests = [];
    var pendingRequests = {};
    var pendingRequestCount = 0;
    var src1stProps = {
        'embed': 'src',
        'iframe': 'src',
        'img': 'src',
        'object': 'data'
    };
    var src2ndProps = {
        'img': 'srcset'
    };

    var PendingRequest = function(target, tagName, attr) {
        this.id = requestId++;
        this.target = target;
        this.tagName = tagName;
        this.attr = attr;
        pendingRequests[this.id] = this;
        pendingRequestCount += 1;
    };

    // Because a while ago I have observed constructors are faster than
    // literal object instanciations.
    var BouncingRequest = function(id, tagName, url) {
        this.id = id;
        this.tagName = tagName;
        this.url = url;
        this.collapse = false;
    };

    var onProcessed = function(response) {
        // https://github.com/gorhill/uMatrix/issues/144
        if ( response.shutdown ) {
            vAPI.shutdown.exec();
            return;
        }

        var requests = response.result;
        if ( requests === null || Array.isArray(requests) === false ) {
            return;
        }
        var selectors = [];
        var i = requests.length;
        var request, entry, target, value;
        while ( i-- ) {
            request = requests[i];
            if ( pendingRequests.hasOwnProperty(request.id) === false ) {
                continue;
            }
            entry = pendingRequests[request.id];
            delete pendingRequests[request.id];
            pendingRequestCount -= 1;

            // https://github.com/chrisaljoudi/uBlock/issues/869
            if ( !request.collapse ) {
                continue;
            }

            target = entry.target;

            // https://github.com/chrisaljoudi/uBlock/issues/399
            // Never remove elements from the DOM, just hide them
            target.style.setProperty('display', 'none', 'important');

            // https://github.com/chrisaljoudi/uBlock/issues/1048
            // Use attribute to construct CSS rule
            if ( (value = target.getAttribute(entry.attr)) ) {
                selectors.push(entry.tagName + '[' + entry.attr + '="' + value + '"]');
            }
        }
        if ( selectors.length !== 0 ) {
            messager.send({
                what: 'cosmeticFiltersInjected',
                type: 'net',
                hostname: window.location.hostname,
                selectors: selectors
            });
        }
        // Renew map: I believe that even if all properties are deleted, an
        // object will still use more memory than a brand new one.
        if ( pendingRequestCount === 0 ) {
            pendingRequests = {};
        }
    };

    var send = function() {
        timer = null;
        messager.send({
            what: 'filterRequests',
            pageURL: window.location.href,
            pageHostname: window.location.hostname,
            requests: newRequests
        }, onProcessed);
        newRequests = [];
    };

    var process = function(delay) {
        if ( newRequests.length === 0 ) {
            return;
        }
        if ( delay === 0 ) {
            clearTimeout(timer);
            send();
        } else if ( timer === null ) {
            timer = vAPI.setTimeout(send, delay || 20);
        }
    };

    // If needed eventually, we could listen to `src` attribute changes
    // for iframes.

    var add = function(target) {
        var tagName = target.localName;
        var prop = src1stProps[tagName];
        if ( prop === undefined ) {
            return;
        }
        // https://github.com/chrisaljoudi/uBlock/issues/174
        // Do not remove fragment from src URL
        var src = target[prop];
        if ( typeof src !== 'string' || src.length === 0 ) {
            prop = src2ndProps[tagName];
            if ( prop === undefined ) {
                return;
            }
            src = target[prop];
            if ( typeof src !== 'string' || src.length === 0 ) {
                return;
            }
        }
        if ( src.lastIndexOf('http', 0) !== 0 ) {
            return;
        }
        var req = new PendingRequest(target, tagName, prop);
        newRequests.push(new BouncingRequest(req.id, tagName, src));
    };

    var iframeSourceModified = function(mutations) {
        var i = mutations.length;
        while ( i-- ) {
            addIFrame(mutations[i].target, true);
        }
        process();
    };
    var iframeSourceObserver = new MutationObserver(iframeSourceModified);
    var iframeSourceObserverOptions = {
        attributes: true,
        attributeFilter: [ 'src' ]
    };

    var addIFrame = function(iframe, dontObserve) {
        // https://github.com/gorhill/uBlock/issues/162
        // Be prepared to deal with possible change of src attribute.
        if ( dontObserve !== true ) {
            iframeSourceObserver.observe(iframe, iframeSourceObserverOptions);
        }

        var src = iframe.src;
        if ( src === '' || typeof src !== 'string' ) {
            return;
        }
        if ( src.lastIndexOf('http', 0) !== 0 ) {
            return;
        }
        var req = new PendingRequest(iframe, 'iframe', 'src');
        newRequests.push(new BouncingRequest(req.id, 'iframe', src));
    };

    var iframesFromNode = function(node) {
        if ( node.localName === 'iframe' ) {
            addIFrame(node);
        }
        var iframes = node.querySelectorAll('iframe');
        var i = iframes.length;
        while ( i-- ) {
            addIFrame(iframes[i]);
        }
        process();
    };

    return {
        add: add,
        addIFrame: addIFrame,
        iframesFromNode: iframesFromNode,
        process: process
    };
})();

/******************************************************************************/
/******************************************************************************/

// Cosmetic filters

(function() {
    if ( vAPI.skipCosmeticFiltering ) {
        //console.debug('Abort cosmetic filtering');
        return;
    }

    //console.debug('Start cosmetic filtering');

    //var timer = window.performance || Date;
    //var tStart = timer.now();

    // https://github.com/chrisaljoudi/uBlock/issues/789
    // https://github.com/gorhill/uBlock/issues/873
    // Be sure that our style tags used for cosmetic filtering are still applied.
    var checkStyleTags = function() {
        var doc = document,
            html = doc.documentElement,
            head = doc.head,
            newParent = html || head;
        if ( newParent === null ) {
            return;
        }
        var styles = vAPI.styles || [],
            style, oldParent;
        for ( var i = 0; i < styles.length; i++ ) {
            style = styles[i];
            oldParent = style.parentNode;
            if ( oldParent !== head && oldParent !== html ) {
                newParent.appendChild(style);
            }
        }
    };
    checkStyleTags();

    var queriedSelectors = {};
    var injectedSelectors = {};
    var lowGenericSelectors = [];
    var highGenerics = null;
    var contextNodes = [document];
    var nullArray = { push: function(){} };

    var retrieveGenericSelectors = function() {
        if ( lowGenericSelectors.length !== 0 || highGenerics === null ) {
            //console.log('µBlock> ABP cosmetic filters: retrieving CSS rules using %d selectors', lowGenericSelectors.length);
            messager.send({
                    what: 'retrieveGenericCosmeticSelectors',
                    pageURL: window.location.href,
                    selectors: lowGenericSelectors,
                    firstSurvey: highGenerics === null
                },
                retrieveHandler
            );
            // https://github.com/chrisaljoudi/uBlock/issues/452
            retrieveHandler = nextRetrieveHandler;
        } else {
            nextRetrieveHandler(null);
        }
        lowGenericSelectors = [];
    };

    // https://github.com/chrisaljoudi/uBlock/issues/452
    // This needs to be executed *after* the response from our query is
    // received, not at `DOMContentLoaded` time, or else there is a good
    // likeliness to outrun contentscript-start.js, which may still be waiting
    // on a response from its own query.
    var firstRetrieveHandler = function(response) {
        // https://github.com/chrisaljoudi/uBlock/issues/158
        // Ensure injected styles are enforced
        // rhill 2014-11-16: not sure this is needed anymore. Test case in
        //  above issue was fine without the line below..
        var selectors = vAPI.hideCosmeticFilters;
        if ( typeof selectors === 'object' ) {
            injectedSelectors = selectors;
            hideElements(Object.keys(selectors));
        }
        // Add exception filters into injected filters collection, in order
        // to force them to be seen as "already injected".
        selectors = vAPI.donthideCosmeticFilters;
        if ( typeof selectors === 'object' ) {
            for ( var selector in selectors ) {
                if ( selectors.hasOwnProperty(selector) ) {
                    injectedSelectors[selector] = true;
                }
            }
        }
        // Flush dead code from memory
        firstRetrieveHandler = null;

        // These are sent only once
        var result = response && response.result;
        if ( result ) {
            if ( result.highGenerics ) {
                highGenerics = result.highGenerics;
            }
            if ( result.donthide ) {
                processLowGenerics(result.donthide, nullArray);
            }
        }

        nextRetrieveHandler(response);
    };

    var nextRetrieveHandler = function(response) {
        // https://github.com/gorhill/uMatrix/issues/144
        if ( response && response.shutdown ) {
            vAPI.shutdown.exec();
            return;
        }

        //var tStart = timer.now();
        //console.debug('µBlock> contextNodes = %o', contextNodes);
        var result = response && response.result;
        var hideSelectors = [];

        if ( result && result.hide.length ) {
            processLowGenerics(result.hide, hideSelectors);
        }
        if ( highGenerics ) {
            if ( highGenerics.hideLowCount ) {
                processHighLowGenerics(highGenerics.hideLow, hideSelectors);
            }
            if ( highGenerics.hideMediumCount ) {
                processHighMediumGenerics(highGenerics.hideMedium, hideSelectors);
            }
            if ( highGenerics.hideHighCount ) {
                processHighHighGenericsAsync();
            }
        }
        if ( hideSelectors.length !== 0 ) {
            addStyleTag(hideSelectors);
        }
        contextNodes.length = 0;
        //console.debug('%f: uBlock: CSS injection time', timer.now() - tStart);
    };

    var retrieveHandler = firstRetrieveHandler;

    // Ensure elements matching a set of selectors are visually removed
    // from the page, by:
    // - Modifying the style property on the elements themselves
    // - Injecting a style tag

    var addStyleTag = function(selectors) {
        var selectorStr = selectors.join(',\n');
        var style = document.createElement('style');
        // The linefeed before the style block is very important: do no remove!
        style.appendChild(document.createTextNode(selectorStr + '\n{display:none !important;}'));
        var parent = document.head || document.documentElement;
        if ( parent ) {
            parent.appendChild(style);
            vAPI.styles.push(style);
        }
        hideElements(selectorStr);
        messager.send({
            what: 'cosmeticFiltersInjected',
            type: 'cosmetic',
            hostname: window.location.hostname,
            selectors: selectors
        });
        //console.debug('µBlock> generic cosmetic filters: injecting %d CSS rules:', selectors.length, text);
    };

    var hideElements = (function() {
        if ( document.body === null ) {
            return function() {};
        }
        if ( document.body.shadowRoot === undefined ) {
            return function(selectors) {
                // https://github.com/chrisaljoudi/uBlock/issues/207
                // Do not call querySelectorAll() using invalid CSS selectors
                if ( selectors.length === 0 ) { return; }
                var elems = document.querySelectorAll(selectors);
                var i = elems.length;
                if ( i === 0 ) { return; }
                // https://github.com/chrisaljoudi/uBlock/issues/158
                // Using CSSStyleDeclaration.setProperty is more reliable
                while ( i-- ) {
                    elems[i].style.setProperty('display', 'none', 'important');
                }
            };
        }
        return function(selectors) {
            if ( selectors.length === 0 ) { return; }
            var elems = document.querySelectorAll(selectors);
            var i = elems.length;
            if ( i === 0 ) { return; }
            // https://github.com/gorhill/uBlock/issues/435
            // Using shadow content so that we do not have to modify style
            // attribute.
            var sessionId = vAPI.sessionId;
            var elem, shadow;
            while ( i-- ) {
                elem = elems[i];
                shadow = elem.shadowRoot;
                // https://www.chromestatus.com/features/4668884095336448
                // "Multiple shadow roots is being deprecated."
                if ( shadow !== null ) {
                    if ( shadow.className !== sessionId ) {	
                        elem.style.setProperty('display', 'none', 'important');
                    }
                    continue;
                }
                // https://github.com/gorhill/uBlock/pull/555
                // Not all nodes can be shadowed:
                //   https://github.com/w3c/webcomponents/issues/102
                // https://github.com/gorhill/uBlock/issues/762
                // Remove display style that might get in the way of the shadow
                // node doing its magic.
                try {
                    shadow = elem.createShadowRoot();
                    shadow.className = sessionId;
                    elem.style.removeProperty('display');
                } catch (ex) {
                    elem.style.setProperty('display', 'none', 'important');
                }
            }
        };
    })();

    // Extract and return the staged nodes which (may) match the selectors.

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

    // Low generics:
    // - [id]
    // - [class]

    var processLowGenerics = function(generics, out) {
        var i = generics.length;
        var selector;
        while ( i-- ) {
            selector = generics[i];
            if ( injectedSelectors.hasOwnProperty(selector) ) {
                continue;
            }
            injectedSelectors[selector] = true;
            out.push(selector);
        }
    };

    // High-low generics:
    // - [alt="..."]
    // - [title="..."]

    var processHighLowGenerics = function(generics, out) {
        var attrs = ['title', 'alt'];
        var attr, attrValue, nodeList, iNode, node;
        var selector;
        while ( (attr = attrs.pop()) ) {
            nodeList = selectNodes('[' + attr + ']');
            iNode = nodeList.length;
            while ( iNode-- ) {
                node = nodeList[iNode];
                attrValue = node.getAttribute(attr);
                if ( !attrValue ) { continue; }
                // Candidate 1 = generic form
                // If generic form is injected, no need to process the specific
                // form, as the generic will affect all related specific forms
                selector = '[' + attr + '="' + attrValue + '"]';
                if ( generics.hasOwnProperty(selector) ) {
                    if ( injectedSelectors.hasOwnProperty(selector) === false ) {
                        injectedSelectors[selector] = true;
                        out.push(selector);
                        continue;
                    }
                }
                // Candidate 2 = specific form
                selector = node.localName + selector;
                if ( generics.hasOwnProperty(selector) ) {
                    if ( injectedSelectors.hasOwnProperty(selector) === false ) {
                        injectedSelectors[selector] = true;
                        out.push(selector);
                    }
                }
            }
        }
    };

    // High-medium generics:
    // - [href^="http"]

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

            // A string.
            if ( typeof selectors === 'string' ) {
                if (
                    href.lastIndexOf(selectors.slice(8, -2), 0) === 0 &&
                    injectedSelectors.hasOwnProperty(selectors) === false
                ) {
                    injectedSelectors[selectors] = true;
                    out.push(selectors);
                }
                continue;
            }

            // An array of strings.
            iSelector = selectors.length;
            while ( iSelector-- ) {
                selector = selectors[iSelector];
                if (
                    href.lastIndexOf(selector.slice(8, -2), 0) === 0 &&
                    injectedSelectors.hasOwnProperty(selector) === false
                ) {
                    injectedSelectors[selector] = true;
                    out.push(selector);
                }
            }
        }
    };

    // High-high generics are *very costly* to process, so we will coalesce
    // requests to process high-high generics into as few requests as possible.
    // The gain is *significant* on bloated pages.

    var processHighHighGenericsMisses = 8;
    var processHighHighGenericsTimer = null;

    var processHighHighGenerics = function() {
        processHighHighGenericsTimer = null;
        if ( highGenerics.hideHigh === '' ) {
            return;
        }
        if ( injectedSelectors.hasOwnProperty('{{highHighGenerics}}') ) {
            return;
        }
        // When there are too many misses for these highly generic CSS rules,
        // we will just give up on looking whether they need to be injected.
        if ( document.querySelector(highGenerics.hideHigh) === null ) {
            processHighHighGenericsMisses -= 1;
            if ( processHighHighGenericsMisses === 0 ) {
                injectedSelectors['{{highHighGenerics}}'] = true;
            }
            return;
        }
        injectedSelectors['{{highHighGenerics}}'] = true;
        // We need to filter out possible exception cosmetic filters from
        // high-high generics selectors.
        var selectors = highGenerics.hideHigh.split(',\n');
        var i = selectors.length;
        var selector;
        while ( i-- ) {
            selector = selectors[i];
            if ( injectedSelectors.hasOwnProperty(selector) ) {
                selectors.splice(i, 1);
            } else {
                injectedSelectors[selector] = true;
            }
        }
        if ( selectors.length !== 0 ) {
            addStyleTag(selectors);
        }
    };

    var processHighHighGenericsAsync = function() {
        if ( processHighHighGenericsTimer !== null ) {
            clearTimeout(processHighHighGenericsTimer);
        }
        processHighHighGenericsTimer = vAPI.setTimeout(processHighHighGenerics, 300);
    };

    // Extract all ids: these will be passed to the cosmetic filtering
    // engine, and in return we will obtain only the relevant CSS selectors.

    var idsFromNodeList = function(nodes) {
        if ( !nodes || !nodes.length ) {
            return;
        }
        var qq = queriedSelectors;
        var ll = lowGenericSelectors;
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
            if ( qq.hasOwnProperty(v) ) { continue; }
            ll.push(v);
            qq[v] = true;
        }
    };

    // Extract all classes: these will be passed to the cosmetic filtering
    // engine, and in return we will obtain only the relevant CSS selectors.

    // https://github.com/gorhill/uBlock/issues/672
    // http://www.w3.org/TR/2014/REC-html5-20141028/infrastructure.html#space-separated-tokens
    // http://jsperf.com/enumerate-classes/6

    var classesFromNodeList = function(nodes) {
        if ( !nodes || !nodes.length ) {
            return;
        }

        var qq = queriedSelectors;
        var ll = lowGenericSelectors;
        var v, vv, len, c, beg, end;
        var i = nodes.length;

        while ( i-- ) {
            vv = nodes[i].className;
            if ( typeof vv !== 'string' ) { continue; }
            len = vv.length;
            beg = 0;
            for (;;) {
                // Skip whitespaces
                while ( beg !== len ) {
                    c = vv.charCodeAt(beg);
                    if ( c !== 0x20 && (c > 0x0D || c < 0x09) ) { break; }
                    beg++;
                }
                if ( beg === len ) { break; }
                end = beg + 1;
                // Skip non-whitespaces
                while ( end !== len ) {
                    c = vv.charCodeAt(end);
                    if ( c === 0x20 || (c <= 0x0D && c >= 0x09) ) { break; }
                    end++;
                }
                v = '.' + vv.slice(beg, end);
                if ( qq.hasOwnProperty(v) === false ) {
                    ll.push(v);
                    qq[v] = true;
                }
                if ( end === len ) { break; }
                beg = end + 1;
            }
        }
    };

    // Start cosmetic filtering.

    idsFromNodeList(document.querySelectorAll('[id]'));
    classesFromNodeList(document.querySelectorAll('[class]'));
    retrieveGenericSelectors();

    //console.debug('%f: uBlock: survey time', timer.now() - tStart);

    // Below this point is the code which takes care to observe changes in
    // the page and to add if needed relevant CSS rules as a result of the
    // changes.

    // Observe changes in the DOM only if...
    // - there is a document.body
    // - there is at least one `script` tag
    if ( !document.body || !document.querySelector('script') ) {
        return;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/618
    // Following is to observe dynamically added iframes:
    // - On Firefox, the iframes fails to fire a `load` event

    var ignoreTags = {
        'link': true,
        'script': true,
        'style': true
    };

    // Added node lists will be cumulated here before being processed
    var addedNodeLists = [];
    var addedNodeListsTimer = null;
    var removedNodeListsTimer = null;
    var collapser = uBlockCollapser;

    // The `cosmeticFiltersActivated` message is required: a new element could
    // be matching an already injected but otherwise inactive cosmetic filter.
    // This means the already injected cosmetic filter become active (has an
    // effect on the document), and thus must be logged if needed.
    var addedNodesHandler = function() {
        addedNodeListsTimer = null;
        var nodeList, iNode, node;
        while ( (nodeList = addedNodeLists.pop()) ) {
            iNode = nodeList.length;
            while ( iNode-- ) {
                node = nodeList[iNode];
                if ( node.nodeType !== 1 ) {
                    continue;
                }
                if ( ignoreTags.hasOwnProperty(node.localName) ) {
                    continue;
                }
                contextNodes.push(node);
                collapser.iframesFromNode(node);
            }
        }
        if ( contextNodes.length !== 0 ) {
            idsFromNodeList(selectNodes('[id]'));
            classesFromNodeList(selectNodes('[class]'));
            retrieveGenericSelectors();
            messager.send({ what: 'cosmeticFiltersActivated' });
        }
    };

    // https://github.com/gorhill/uBlock/issues/873
    // This will ensure our style elements will stay in the DOM.
    var removedNodesHandler = function() {
        removedNodeListsTimer = null;
        checkStyleTags();
    };

    // https://github.com/chrisaljoudi/uBlock/issues/205
    // Do not handle added node directly from within mutation observer.
    // I arbitrarily chose 100 ms for now: I have to compromise between the
    // overhead of processing too few nodes too often and the delay of many
    // nodes less often.
    var domLayoutChanged = function(mutations) {
        var removedNodeLists = false;
        var iMutation = mutations.length;
        var nodeList, mutation;
        while ( iMutation-- ) {
            mutation = mutations[iMutation];
            nodeList = mutation.addedNodes;
            if ( nodeList.length !== 0 ) {
                addedNodeLists.push(nodeList);
            }
            if ( mutation.removedNodes.length !== 0 ) {
                removedNodeLists = true;
            }
        }
        if ( addedNodeLists.length !== 0 && addedNodeListsTimer === null ) {
            addedNodeListsTimer = vAPI.setTimeout(addedNodesHandler, 100);
        }
        if ( removedNodeLists && removedNodeListsTimer === null ) {
            removedNodeListsTimer = vAPI.setTimeout(removedNodesHandler, 100);
        }
    };

    //console.debug('Starts cosmetic filtering\'s mutations observer');

    // https://github.com/gorhill/httpswitchboard/issues/176
    var domLayoutObserver = new MutationObserver(domLayoutChanged);
    domLayoutObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    // https://github.com/gorhill/uMatrix/issues/144
    vAPI.shutdown.add(function() {
        domLayoutObserver.disconnect();
        if ( addedNodeListsTimer !== null ) {
            clearTimeout(addedNodeListsTimer);
        }
    });
})();

/******************************************************************************/
/******************************************************************************/

// Permanent

// Listener to collapse blocked resources.
// - Future requests not blocked yet
// - Elements dynamically added to the page
// - Elements which resource URL changes

(function() {
    var onResourceFailed = function(ev) {
        //console.debug('onResourceFailed(%o)', ev);
        uBlockCollapser.add(ev.target);
        uBlockCollapser.process();
    };
    document.addEventListener('error', onResourceFailed, true);

    // https://github.com/gorhill/uMatrix/issues/144
    vAPI.shutdown.add(function() {
        document.removeEventListener('error', onResourceFailed, true);
    });
})();

/******************************************************************************/
/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/7

// Executed only once

(function() {
    var collapser = uBlockCollapser;
    var elems, i, elem;

    elems = document.querySelectorAll('embed, object');
    i = elems.length;
    while ( i-- ) {
        collapser.add(elems[i]);
    }

    elems = document.querySelectorAll('img');
    i = elems.length;
    while ( i-- ) {
        elem = elems[i];
        if ( elem.complete ) {
            collapser.add(elem);
        }
    }

    elems = document.querySelectorAll('iframe');
    i = elems.length;
    while ( i-- ) {
        collapser.addIFrame(elems[i]);
    }
    collapser.process(0);
})();

/******************************************************************************/
/******************************************************************************/

// To send mouse coordinates to context menu handler, as the chrome API fails
// to provide the mouse position to context menu listeners.
// This could be inserted in its own content script, but it's so simple that
// I feel it's not worth the overhead.

// Ref.: https://developer.mozilla.org/en-US/docs/Web/Events/contextmenu

(function() {
    if ( window !== window.top ) {
        return;
    }
    var onMouseClick = function(ev) {
        var elem = ev.target;
        while ( elem !== null && elem.localName !== 'a' ) {
            elem = elem.parentElement;
        }
        messager.send({
            what: 'mouseClick',
            x: ev.clientX,
            y: ev.clientY,
            url: elem !== null ? elem.href : ''
        });
    };

    window.addEventListener('mousedown', onMouseClick, true);

    // https://github.com/gorhill/uMatrix/issues/144
    vAPI.shutdown.add(function() {
        document.removeEventListener('mousedown', onMouseClick, true);
    });
})();

/******************************************************************************/
/******************************************************************************/

})();

/******************************************************************************/

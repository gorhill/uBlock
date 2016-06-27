/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 Raymond Hill

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

'use strict';

/******************************************************************************/

// Injected into content pages

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// Abort execution by throwing if an unexpected condition arise.
// - https://github.com/chrisaljoudi/uBlock/issues/456

if ( typeof vAPI !== 'object' || vAPI.contentscriptInjected ) {
    throw new Error('Unexpected condition: aborting.');
}

vAPI.contentscriptInjected = true;

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

vAPI.domFilterer = {
    allExceptions: Object.create(null),
    allSelectors: Object.create(null),
    cssNotHiddenId: '',
    disabledId: String.fromCharCode(Date.now() % 26 + 97) + Math.floor(Math.random() * 982451653 + 982451653).toString(36),
    enabled: true,
    hiddenId: String.fromCharCode(Date.now() % 26 + 97) + Math.floor(Math.random() * 982451653 + 982451653).toString(36),
    matchesProp: 'matches',
    newSelectors: [],
    shadowId: String.fromCharCode(Date.now() % 26 + 97) + Math.floor(Math.random() * 982451653 + 982451653).toString(36),
    styleTags: [],
    xpathNotHiddenId: '',

    complexGroupSelector: null,
    complexSelectors: [],
    simpleGroupSelector: null,
    simpleSelectors: [],

    complexHasSelectors: [],
    simpleHasSelectors: [],

    xpathSelectors: [],
    xpathExpression: null,
    xpathResult: null,

    addExceptions: function(aa) {
        for ( var i = 0, n = aa.length; i < n; i++ ) {
            this.allExceptions[aa[i]] = true;
        }
    },

    addHasSelector: function(s1, s2) {
        var entry = { a: s1, b: s2.slice(5, -1) };
        if ( s1.indexOf(' ') === -1 ) {
            this.simpleHasSelectors.push(entry);
        } else {
            this.complexHasSelectors.push(entry);
        }
    },

    addSelector: function(s) {
        if ( this.allSelectors[s] || this.allExceptions[s] ) {
            return;
        }
        this.allSelectors[s] = true;
        var pos = s.indexOf(':');
        if ( pos !== -1 ) {
            pos = s.indexOf(':has(');
            if ( pos !== -1 ) {
                this.addHasSelector(s.slice(0, pos), s.slice(pos));
                return;
            }
            if ( s.lastIndexOf(':xpath(', 0) === 0 ) {
                this.addXpathSelector('', s);
                return;
            }
        }
        if ( s.indexOf(' ') === -1 ) {
            this.simpleSelectors.push(s);
            this.simpleGroupSelector = null;
        } else {
            this.complexSelectors.push(s);
            this.complexGroupSelector = null;
        }
        this.newSelectors.push(s);
    },

    addSelectors: function(aa) {
        for ( var i = 0, n = aa.length; i < n; i++ ) {
            this.addSelector(aa[i]);
        }
    },

    addXpathSelector: function(s1, s2) {
        this.xpathSelectors.push(s2.slice(7, -1));
        this.xpathExpression = null;
    },

    checkStyleTags: function(commitIfNeeded) {
        var doc = document,
            html = doc.documentElement,
            head = doc.head,
            newParent = head || html;
        if ( newParent === null ) {
            return;
        }
        var styles = this.styleTags,
            style, oldParent,
            mustCommit = false;
        for ( var i = 0; i < styles.length; i++ ) {
            style = styles[i];
            oldParent = style.parentNode;
            // https://github.com/gorhill/uBlock/issues/1031
            // If our style tag was disabled, re-insert into the page.
            if (
                style.disabled &&
                oldParent !== null &&
                style.hasAttribute(this.disabledId) === false
            ) {
                oldParent.removeChild(style);
                oldParent = null;
            }
            if ( oldParent === head || oldParent === html ) {
                continue;
            }
            style.disabled = false;
            newParent.appendChild(style);
            mustCommit = true;
        }
        if ( mustCommit && commitIfNeeded ) {
            this.commit();
        }
    },

    commit: function(newNodes) {
        if ( newNodes === undefined ) {
            newNodes = [ document.documentElement ];
        }

        // Inject new selectors as CSS rules in a style tags.
        if ( this.newSelectors.length ) {
            var styleTag = document.createElement('style');
            styleTag.setAttribute('type', 'text/css');
            styleTag.textContent =
                ':root ' +
                this.newSelectors.join(',\n:root ') +
                '\n{ display: none !important; }';
            document.head.appendChild(styleTag);
            this.styleTags.push(styleTag);
        }

        var nodes, node, parents, parent, i, j, k, entry;

        // Simple `:has()` selectors.
        i = this.simpleHasSelectors.length;
        while ( i-- ) {
            entry = this.simpleHasSelectors[i];
            parents = newNodes;
            j = parents.length;
            while ( j-- ) {
                parent = parents[j];
                if ( parent[this.matchesProp](entry.a) && parent.querySelector(entry.b) !== null ) {
                    this.hideNode(parent);
                }
                nodes = parent.querySelectorAll(entry.a + this.cssNotHiddenId);
                k = nodes.length;
                while ( k-- ) {
                    node = nodes[k];
                    if ( node.querySelector(entry.b) !== null ) {
                        this.hideNode(node);
                    }
                }
            }
        }

        // Complex `:has()` selectors.
        i = this.complexHasSelectors.length;
        while ( i-- ) {
            entry = this.complexHasSelectors[i];
            nodes = document.querySelectorAll(entry.a + this.cssNotHiddenId);
            j = nodes.length;
            while ( j-- ) {
                node = nodes[j];
                if ( node.querySelector(entry.b) !== null ) {
                    this.hideNode(node);
                }
            }
        }

        // `:xpath()` selectors.
        if ( this.xpathSelectors.length ) {
            if ( this.xpathExpression === null ) {
                this.xpathExpression = document.createExpression(
                    this.xpathSelectors.join(this.xpathNotHiddenId + '|') + this.xpathNotHiddenId,
                    null
                );
            }
            this.xpathResult = this.xpathExpression.evaluate(
                document,
                XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
                this.xpathResult
            );
            i = this.xpathResult.snapshotLength;
            while ( i-- ) {
                node = this.xpathResult.snapshotItem(i);
                if ( node.nodeType === 1 ) {
                    this.hideNode(node);
                }
            }
        }

        // Simple selectors.
        if ( this.simpleSelectors.length ) {
            if ( this.simpleGroupSelector === null ) {
                this.simpleGroupSelector =
                    this.simpleSelectors.join(this.cssNotHiddenId + ',') +
                    this.cssNotHiddenId;
            }
            parents = newNodes;
            i = parents.length;
            while ( i-- ) {
                parent = parents[i];
                if ( parent[this.matchesProp](this.simpleGroupSelector) ) {
                    this.hideNode(parent);
                }
                nodes = parent.querySelectorAll(this.simpleGroupSelector);
                j = nodes.length;
                while ( j-- ) {
                    this.hideNode(nodes[j]);
                }
            }
        }

        // Complex selectors.
        if ( this.complexSelectors.length ) {
            if ( this.complexGroupSelector === null ) {
                this.complexGroupSelector =
                    this.complexSelectors.join(this.cssNotHiddenId + ',') +
                    this.cssNotHiddenId;
            }
            nodes = document.querySelectorAll(this.complexGroupSelector);
            i = nodes.length;
            while ( i-- ) {
                this.hideNode(nodes[i]);
            }
        }

        // Reset transient state.
        this.newSelectors.length = 0;
    },

    hideNode: (function() {
        if ( document.documentElement.shadowRoot === undefined ) {
            return function(node) {
                node.setAttribute(this.hiddenId, '');
                if ( this.enabled ) {
                    node.style.setProperty('display', 'none', 'important');
                }
            };
        }
        return function(node) {
            node.setAttribute(this.hiddenId, '');
            var shadow = node.shadowRoot;
            // https://www.chromestatus.com/features/4668884095336448
            // "Multiple shadow roots is being deprecated."
            if ( shadow !== null ) {
                if ( shadow.className !== this.shadowId ) {
                    node.style.setProperty('display', 'none', 'important');
                }
                return;
            }
            // https://github.com/gorhill/uBlock/pull/555
            // Not all nodes can be shadowed:
            //   https://github.com/w3c/webcomponents/issues/102
            // https://github.com/gorhill/uBlock/issues/762
            // Remove display style that might get in the way of the shadow
            // node doing its magic.
            try {
                shadow = node.createShadowRoot();
                shadow.className = this.shadowId;
                node.style.removeProperty('display');
            } catch (ex) {
                node.style.setProperty('display', 'none', 'important');
            }
        };
    })(),

    toggleOff: function() {
        this.enabled = false;
    },

    toggleOn: function() {
        this.enabled = true;
    }
};


// Not everything could be initialized at declaration time.
(function() {
    var df = vAPI.domFilterer;
    df.cssNotHiddenId = ':not([' + df.hiddenId + '])';
    df.xpathNotHiddenId = '[not(@' + df.hiddenId + ')]';
    var docElem = document.documentElement;
    if ( typeof docElem.matches !== 'function' ) {
        if ( typeof docElem.mozMatchesSelector === 'function' ) {
            df.matchesProp = 'mozMatchesSelector';
        } else if ( typeof docElem.webkitMatchesSelector === 'function' ) {
            df.matchesProp =  'webkitMatchesSelector';
        }
    }
})();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// This is executed once, and since no hooks are left behind once the response
// is received, I expect this code to be garbage collected by the browser.

(function domIsLoading() {

/******************************************************************************/

// Domain-based ABP cosmetic filters.
// These can be inserted before the DOM is loaded.

var cosmeticFilters = function(details) {
    var domFilterer = vAPI.domFilterer;
    domFilterer.addExceptions(details.cosmeticDonthide);
    // https://github.com/chrisaljoudi/uBlock/issues/143
    domFilterer.addSelectors(details.cosmeticHide);
    domFilterer.commit();
};

/******************************************************************************/

var netFilters = function(details) {
    var parent = document.head || document.documentElement;
    if ( !parent ) {
        return;
    }
    var styleTag = document.createElement('style');
    styleTag.setAttribute('type', 'text/css');
    var text = details.netHide.join(',\n');
    var css = details.netCollapse ?
        '\n{display:none !important;}' :
        '\n{visibility:hidden !important;}';
    styleTag.appendChild(document.createTextNode(text + css));
    parent.appendChild(styleTag);
};

/******************************************************************************/

// Create script tags and assign data URIs looked up from our library of
// redirection resources: Sometimes it is useful to use these resources as
// standalone scriptlets. These scriptlets are injected from within the
// content scripts because what must be injected, if anything, depends on the
// currently active filters, as selected by the user.
// Library of redirection resources is located at:
// https://github.com/gorhill/uBlock/blob/master/assets/ublock/resources.txt

var injectScripts = function(scripts) {
    var parent = document.head || document.documentElement;
    if ( !parent ) {
        return;
    }
    var scriptTag = document.createElement('script');
    // Have the injected script tag remove itself when execution completes: to
    // keep DOM as clean as possible.
    scripts +=
        "\n" +
        "(function() {\n" +
        "    var c = document.currentScript,\n" +
        "        p = c && c.parentNode;\n" +
        "    if ( p ) {\n" +
        "        p.removeChild(c);\n" +
        "    }\n" +
        "})();";
    scriptTag.appendChild(document.createTextNode(scripts));
    parent.appendChild(scriptTag);
    vAPI.injectedScripts = scripts;
};

/******************************************************************************/

var responseHandler = function(details) {
    var domFilterer = vAPI.domFilterer;
    var styleTagCount = domFilterer.styleTags.length;

    if ( details ) {
        if (
            (vAPI.skipCosmeticFiltering = details.skipCosmeticFiltering) !== true &&
            (details.cosmeticHide.length !== 0 || details.cosmeticDonthide.length !== 0)
        ) {
            cosmeticFilters(details);
        }
        if ( details.netHide.length !== 0 ) {
            netFilters(details);
        }
        if ( details.scripts ) {
            injectScripts(details.scripts);
        }
        // The port will never be used again at this point, disconnecting allows
        // the browser to flush this script from memory.
    }

    // This is just to inform the background process that cosmetic filters were
    // actually injected.
    if ( domFilterer.styleTags.length !== styleTagCount ) {
        vAPI.messaging.send('contentscript', { what: 'cosmeticFiltersActivated' });
    }

    // https://github.com/chrisaljoudi/uBlock/issues/587
    // If no filters were found, maybe the script was injected before uBlock's
    // process was fully initialized. When this happens, pages won't be
    // cleaned right after browser launch.
    vAPI.contentscriptInjected = details && details.ready;
};

/******************************************************************************/

var url = window.location.href;
vAPI.messaging.send(
    'contentscript',
    {
        what: 'retrieveDomainCosmeticSelectors',
        pageURL: url,
        locationURL: url
    },
    responseHandler
);

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/7

var domCollapser = (function() {
    var timer = null;
    var requestId = 1;
    var newRequests = [];
    var pendingRequests = Object.create(null);
    var pendingRequestCount = 0;
    var src1stProps = {
        'embed': 'src',
        'img': 'src',
        'object': 'data'
    };
    var src2ndProps = {
        'img': 'srcset'
    };
    var messaging = vAPI.messaging;

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
        // This can happens if uBO is restarted.
        if ( !response ) {
            return;
        }
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
            entry = pendingRequests[request.id];
            if ( entry === undefined ) {
                continue;
            }
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
            messaging.send(
                'contentscript',
                {
                    what: 'cosmeticFiltersInjected',
                    type: 'net',
                    hostname: window.location.hostname,
                    selectors: selectors
                }
            );
        }
        // Renew map: I believe that even if all properties are deleted, an
        // object will still use more memory than a brand new one.
        if ( pendingRequestCount === 0 ) {
            pendingRequests = Object.create(null);
        }
    };

    var send = function() {
        timer = null;
        messaging.send(
            'contentscript',
            {
                what: 'filterRequests',
                pageURL: window.location.href,
                pageHostname: window.location.hostname,
                requests: newRequests
            }, onProcessed
        );
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
        var req = new PendingRequest(target, tagName, prop);
        newRequests.push(new BouncingRequest(req.id, tagName, src));
    };

    var addMany = function(targets) {
        var i = targets.length;
        while ( i-- ) {
            add(targets[i]);
        }
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

    var primeLocalIFrame = function(iframe) {
        // Should probably also copy injected styles.
        // The injected scripts are those which were injected in the current
        // document, from within the `contentscript-start.js / injectScripts`,
        // and which scripts are selectively looked-up from:
        // https://github.com/gorhill/uBlock/blob/master/assets/ublock/resources.txt
        if ( vAPI.injectedScripts ) {
            var scriptTag = document.createElement('script');
            scriptTag.appendChild(document.createTextNode(vAPI.injectedScripts));
            var parent = iframe.contentDocument && iframe.contentDocument.head;
            if ( parent ) {
                parent.appendChild(scriptTag);
            }
        }
    };

    var addIFrame = function(iframe, dontObserve) {
        // https://github.com/gorhill/uBlock/issues/162
        // Be prepared to deal with possible change of src attribute.
        if ( dontObserve !== true ) {
            iframeSourceObserver.observe(iframe, iframeSourceObserverOptions);
        }

        var src = iframe.src;
        if ( src === '' || typeof src !== 'string' ) {
            primeLocalIFrame(iframe);
            return;
        }
        if ( src.lastIndexOf('http', 0) !== 0 ) {
            return;
        }
        var req = new PendingRequest(iframe, 'iframe', 'src');
        newRequests.push(new BouncingRequest(req.id, 'iframe', src));
    };

    var addIFrames = function(iframes) {
        var i = iframes.length;
        while ( i-- ) {
            addIFrame(iframes[i]);
        }
    };

    var iframesFromNode = function(node) {
        if ( node.localName === 'iframe' ) {
            addIFrame(node);
        }
        addIFrames(node.getElementsByTagName('iframe'));
        process();
    };

    return {
        add: add,
        addMany: addMany,
        addIFrame: addIFrame,
        addIFrames: addIFrames,
        iframesFromNode: iframesFromNode,
        process: process
    };
})();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

var domIsLoaded = function(ev) {

/******************************************************************************/

if ( ev ) {
    document.removeEventListener('DOMContentLoaded', domIsLoaded);
}

// I've seen this happens on Firefox
if ( window.location === null ) {
    return;
}

// https://github.com/chrisaljoudi/uBlock/issues/587
// Pointless to execute without the start script having done its job.
if ( !vAPI.contentscriptInjected ) {
    return;
}

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
    var domFilterer = vAPI.domFilterer;
    domFilterer.checkStyleTags(false);
    domFilterer.commit();

    var contextNodes = [ document.documentElement ];
    var messaging = vAPI.messaging;
    var highGenerics = null;
    var highHighGenericsInjected = false;
    var lowGenericSelectors = [];
    var queriedSelectors = Object.create(null);

    var responseHandler = function(response) {
        // https://github.com/gorhill/uMatrix/issues/144
        if ( response && response.shutdown ) {
            vAPI.shutdown.exec();
            return;
        }

        //var tStart = timer.now();
        var result = response && response.result;

        if ( result ) {
            if ( result.hide.length ) {
                processLowGenerics(result.hide);
            }
            if ( result.highGenerics ) {
                highGenerics = result.highGenerics;
            }
        }
        if ( highGenerics ) {
            if ( highGenerics.hideLowCount ) {
                processHighLowGenerics(highGenerics.hideLow);
            }
            if ( highGenerics.hideMediumCount ) {
                processHighMediumGenerics(highGenerics.hideMedium);
            }
            if ( highGenerics.hideHighCount ) {
                processHighHighGenericsAsync();
            }
        }
        domFilterer.commit(contextNodes);
        contextNodes = [];
        //console.debug('%f: uBlock: CSS injection time', timer.now() - tStart);
    };

    var retrieveGenericSelectors = function() {
        if ( lowGenericSelectors.length !== 0 || highGenerics === null ) {
            messaging.send(
                'contentscript',
                {
                    what: 'retrieveGenericCosmeticSelectors',
                    pageURL: window.location.href,
                    selectors: lowGenericSelectors,
                    firstSurvey: highGenerics === null
                },
                responseHandler
            );
        } else {
            responseHandler(null);
        }
        lowGenericSelectors = [];
    };

    // Ensure elements matching a set of selectors are visually removed
    // from the page, by:
    // - Modifying the style property on the elements themselves
    // - Injecting a style tag
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

    var processLowGenerics = function(generics) {
        domFilterer.addSelectors(generics);
    };

    // High-low generics:
    // - [alt="..."]
    // - [title="..."]

    var processHighLowGenerics = function(generics) {
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
                    domFilterer.addSelector(selector);
                    domFilterer.hideNode(node);
                    continue;
                }
                // Candidate 2 = specific form
                selector = node.localName + selector;
                if ( generics.hasOwnProperty(selector) ) {
                    domFilterer.addSelector(selector);
                    domFilterer.hideNode(node);
                }
            }
        }
    };

    // High-medium generics:
    // - [href^="http"]

    var processHighMediumGenerics = function(generics) {
        var doc = document;
        var i = contextNodes.length;
        var aa = [ null ];
        var node, nodes;
        while ( i-- ) {
            node = contextNodes[i];
            if ( node.localName === 'a' ) {
                aa[0] = node;
                processHighMediumGenericsForNodes(aa, generics);
            }
            nodes = node.getElementsByTagName('a');
            if ( nodes.length === 0 ) { continue; }
            processHighMediumGenericsForNodes(nodes, generics);
            if ( node === doc ) {
                break;
            }
        }
    };

    var processHighMediumGenericsForNodes = function(nodes, generics) {
        var i = nodes.length;
        var node, href, pos, hash, selectors, j, selector;
        var aa = [ '' ];
        while ( i-- ) {
            node = nodes[i];
            href = node.getAttribute('href');
            if ( !href ) { continue; }
            pos = href.indexOf('://');
            if ( pos === -1 ) { continue; }
            hash = href.slice(pos + 3, pos + 11);
            selectors = generics[hash];
            if ( selectors === undefined ) { continue; }
            // A string.
            if ( typeof selectors === 'string' ) {
                aa[0] = selectors;
                selectors = aa;
            }
            // An array of strings.
            j = selectors.length;
            while ( j-- ) {
                selector = selectors[j];
                if ( href.lastIndexOf(selector, 8) === 8 ) {
                    domFilterer.addSelector(selector);
                    domFilterer.hideNode(node);
                }
            }
        }
    };

    // High-high generics are very costly to process, so we will coalesce
    // requests to process high-high generics into as few requests as possible.
    // The gain is significant on bloated pages.

    var processHighHighGenericsMisses = 8;
    var processHighHighGenericsTimer = null;

    var processHighHighGenerics = function() {
        processHighHighGenericsTimer = null;
        if ( highGenerics.hideHigh === '' ) {
            return;
        }
        if ( highHighGenericsInjected ) {
            return;
        }
        // When there are too many misses for these highly generic CSS rules,
        // we will just give up on looking whether they need to be injected.
        if ( document.querySelector(highGenerics.hideHigh) === null ) {
            processHighHighGenericsMisses -= 1;
            if ( processHighHighGenericsMisses === 0 ) {
                highHighGenericsInjected = true;
            }
            return;
        }
        highHighGenericsInjected = true;
        // We need to filter out possible exception cosmetic filters from
        // high-high generics selectors.
        domFilterer.addSelectors(highGenerics.hideHigh.split(',\n'));
        domFilterer.commit();
    };

    var processHighHighGenericsAsync = function() {
        if ( processHighHighGenericsTimer !== null ) {
            clearTimeout(processHighHighGenericsTimer);
        }
        processHighHighGenericsTimer = vAPI.setTimeout(processHighHighGenerics, 300);
    };

    // Extract all classes/ids: these will be passed to the cosmetic filtering
    // engine, and in return we will obtain only the relevant CSS selectors.

    // https://github.com/gorhill/uBlock/issues/672
    // http://www.w3.org/TR/2014/REC-html5-20141028/infrastructure.html#space-separated-tokens
    // http://jsperf.com/enumerate-classes/6

    var classesAndIdsFromNodeList = function(nodes) {
        if ( !nodes || !nodes.length ) {
            return;
        }
        var qq = queriedSelectors;
        var ll = lowGenericSelectors;
        var node, v, vv, len, c, beg, end;
        var i = nodes.length;
        while ( i-- ) {
            node = nodes[i];
            if ( node.nodeType !== 1 ) { continue; }
            v = node.id;
            if ( v !== '' && typeof v === 'string' ) {
                v = '#' + v.trim();
                if ( v !== '#' && qq[v] === undefined ) {
                    ll.push(v);
                    qq[v] = true;
                }
            }
            vv = node.className;
            if ( vv === '' || typeof vv !== 'string' ) { continue; }
            len = vv.length;
            beg = 0;
            for (;;) {
                // Skip whitespaces
                while ( beg !== len ) {
                    c = vv.charCodeAt(beg);
                    if ( c > 0x20 ) { break; }
                    beg++;
                }
                if ( beg === len ) { break; }
                end = beg + 1;
                // Skip non-whitespaces
                while ( end !== len ) {
                    c = vv.charCodeAt(end);
                    if ( c <= 0x20 ) { break; }
                    end++;
                }
                v = '.' + vv.slice(beg, end);
                if ( qq[v] === undefined ) {
                    ll.push(v);
                    qq[v] = true;
                }
                if ( end === len ) { break; }
                beg = end + 1;
            }
        }
    };

    // Start cosmetic filtering.

    classesAndIdsFromNodeList(document.querySelectorAll('[class],[id]'));
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
    var addedNodeListsTimerDelay = 10;
    var removedNodeListsTimer = null;
    var collapser = domCollapser;

    // The `cosmeticFiltersActivated` message is required: a new element could
    // be matching an already injected but otherwise inactive cosmetic filter.
    // This means the already injected cosmetic filter become active (has an
    // effect on the document), and thus must be logged if needed.
    var addedNodesHandler = function() {
        addedNodeListsTimer = null;
        addedNodeListsTimerDelay = Math.min(addedNodeListsTimerDelay*2, 100);
        var iNodeList = addedNodeLists.length,
            nodeList, iNode, node;
        while ( iNodeList-- ) {
            nodeList = addedNodeLists[iNodeList];
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
        addedNodeLists.length = 0;
        if ( contextNodes.length !== 0 ) {
            classesAndIdsFromNodeList(selectNodes('[class],[id]'));
            retrieveGenericSelectors();
            messaging.send('contentscript', { what: 'cosmeticFiltersActivated' });
        }
    };

    // https://github.com/gorhill/uBlock/issues/873
    // This will ensure our style elements will stay in the DOM.
    var removedNodesHandler = function() {
        removedNodeListsTimer = null;
        domFilterer.checkStyleTags(true);
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
            addedNodeListsTimer = vAPI.setTimeout(addedNodesHandler, addedNodeListsTimerDelay);
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
        if ( removedNodeListsTimer !== null ) {
            clearTimeout(removedNodeListsTimer);
        }
        if ( processHighHighGenericsTimer !== null ) {
            clearTimeout(processHighHighGenericsTimer);
        }
    });
})();

/******************************************************************************/

// Permanent

// Listener to collapse blocked resources.
// - Future requests not blocked yet
// - Elements dynamically added to the page
// - Elements which resource URL changes

(function() {
    var onResourceFailed = function(ev) {
        //console.debug('onResourceFailed(%o)', ev);
        domCollapser.add(ev.target);
        domCollapser.process();
    };
    document.addEventListener('error', onResourceFailed, true);

    // https://github.com/gorhill/uMatrix/issues/144
    vAPI.shutdown.add(function() {
        document.removeEventListener('error', onResourceFailed, true);
    });
})();

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/7
// Executed only once.
// Preferring getElementsByTagName over querySelectorAll:
//   http://jsperf.com/queryselectorall-vs-getelementsbytagname/145

(function() {
    var collapser = domCollapser;
    var elems = document.getElementsByTagName('img'),
        i = elems.length, elem;
    while ( i-- ) {
        elem = elems[i];
        if ( elem.complete ) {
            collapser.add(elem);
        }
    }
    collapser.addMany(document.getElementsByTagName('embed'));
    collapser.addMany(document.getElementsByTagName('object'));
    collapser.addIFrames(document.getElementsByTagName('iframe'));
    collapser.process(0);
})();

/******************************************************************************/

// To send mouse coordinates to main process, as the chrome API fails
// to provide the mouse position to context menu listeners.

// https://github.com/chrisaljoudi/uBlock/issues/1143
// Also, find a link under the mouse, to try to avoid confusing new tabs
// as nuisance popups.

// Ref.: https://developer.mozilla.org/en-US/docs/Web/Events/contextmenu

(function() {
    if ( window !== window.top ) {
        return;
    }

    var messaging = vAPI.messaging;

    var onMouseClick = function(ev) {
        var elem = ev.target;
        while ( elem !== null && elem.localName !== 'a' ) {
            elem = elem.parentElement;
        }
        messaging.send(
            'contentscript',
            {
                what: 'mouseClick',
                x: ev.clientX,
                y: ev.clientY,
                url: elem !== null ? elem.href : ''
            });
    };

    document.addEventListener('mousedown', onMouseClick, true);

    // https://github.com/gorhill/uMatrix/issues/144
    vAPI.shutdown.add(function() {
        document.removeEventListener('mousedown', onMouseClick, true);
    });
})();

/******************************************************************************/

};

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

if ( document.readyState !== 'loading' ) {
    domIsLoaded();
} else {
    document.addEventListener('DOMContentLoaded', domIsLoaded);
}

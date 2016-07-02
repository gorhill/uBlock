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

vAPI.executionCost.start();

vAPI.contentscriptInjected = true;

vAPI.matchesProp = (function() {
    var docElem = document.documentElement;
    if ( typeof docElem.matches !== 'function' ) {
        if ( typeof docElem.mozMatchesSelector === 'function' ) {
            return 'mozMatchesSelector';
        } else if ( typeof docElem.webkitMatchesSelector === 'function' ) {
            return 'webkitMatchesSelector';
        }
    }
    return 'matches';
})();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// The DOM filterer is the heart of uBO's cosmetic filtering.

vAPI.domFilterer = {
    allExceptions: Object.create(null),
    allSelectors: Object.create(null),
    cosmeticFiltersActivatedTimer: null,
    cssNotHiddenId: '',
    disabledId: String.fromCharCode(Date.now() % 26 + 97) + Math.floor(Math.random() * 982451653 + 982451653).toString(36),
    enabled: true,
    hiddenId: String.fromCharCode(Date.now() % 26 + 97) + Math.floor(Math.random() * 982451653 + 982451653).toString(36),
    hiddenNodeCount: 0,
    matchesProp: vAPI.matchesProp,
    newCSSRules: [],
    newDeclarativeSelectors: [],
    shadowId: String.fromCharCode(Date.now() % 26 + 97) + Math.floor(Math.random() * 982451653 + 982451653).toString(36),
    styleTags: [],

    simpleGroupSelector: null,
    simpleSelectors: [],

    complexGroupSelector: null,
    complexSelectors: [],
    complexSelectorsCost: 0,
    complexSelectorsNodeSet: null,

    complexHasSelectors: [],
    complexHasSelectorsCost: 0,
    simpleHasSelectors: [],

    xpathExpression: null,
    xpathResult: null,
    xpathSelectors: [],
    xpathSelectorsCost: 0,

    addExceptions: function(aa) {
        for ( var i = 0, n = aa.length; i < n; i++ ) {
            this.allExceptions[aa[i]] = true;
        }
    },

    addSelector: function(s) {
        if ( this.allSelectors[s] || this.allExceptions[s] ) {
            return this;
        }
        this.allSelectors[s] = true;
        if ( s.charCodeAt(s.length-1) === 0x29 && this.addSelectorEx(s) ) {
            return this;
        }
        if ( s.indexOf(' ') === -1 ) {
            this.simpleSelectors.push(s);
            this.simpleGroupSelector = null;
        } else {
            this.complexSelectors.push(s);
            this.complexGroupSelector = null;
            this.complexSelectorsCost = 0;
        }
        this.newDeclarativeSelectors.push(s);
        return this;
    },

    addSelectorEx: function(s) {
        var pos = s.indexOf(':has(');
        if ( pos !== -1 ) {
            var entry = {
                a: s.slice(0, pos),
                b: s.slice(pos + 5, -1)
            };
            if ( entry.a.indexOf(' ') === -1 ) {
                this.simpleHasSelectors.push(entry);
            } else {
                this.complexHasSelectors.push(entry);
                this.complexHasSelectorsCost = 0;
            }
            return true;
        }
        pos = s.indexOf(':style(');
        if ( pos !== -1 ) {
            this.newCSSRules.push(s.slice(0, pos) + ' {' + s.slice(pos + 7, -1) + '}');
            return true;
        }
        if ( s.lastIndexOf(':xpath(', 0) === 0 ) {
            this.xpathExpression = null;
            this.xpathSelectorsCost = 0;
            this.xpathSelectors.push(s.slice(7, -1));
            return true;
        }
        return false;
    },

    addSelectors: function(aa) {
        for ( var i = 0, n = aa.length; i < n; i++ ) {
            this.addSelector(aa[i]);
        }
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

    commit: function(stagedNodes) {
        var beforeHiddenNodeCount = this.hiddenNodeCount;

        if ( stagedNodes === undefined ) {
            stagedNodes = [ document.documentElement ];
        }

        // Inject new declarative selectors.
        var styleTag;
        if ( this.newDeclarativeSelectors.length ) {
            styleTag = document.createElement('style');
            styleTag.setAttribute('type', 'text/css');
            styleTag.textContent =
                ':root ' +
                this.newDeclarativeSelectors.join(',\n:root ') +
                '\n{ display: none !important; }';
            document.head.appendChild(styleTag);
            this.styleTags.push(styleTag);
            this.newDeclarativeSelectors.length = 0;
        }
        // Inject new CSS rules.
        if ( this.newCSSRules.length ) {
            styleTag = document.createElement('style');
            styleTag.setAttribute('type', 'text/css');
            styleTag.textContent = ':root ' + this.newCSSRules.join('\n:root ');
            document.head.appendChild(styleTag);
            this.styleTags.push(styleTag);
            this.newCSSRules.length = 0;
        }

        // Simple `:has()` selectors.
        if ( this.simpleHasSelectors.length ) {
            this.commitSimpleHasSelectors(stagedNodes);
        }

        // Complex `:has()` selectors.
        if ( this.complexHasSelectorsCost < 10 && this.complexHasSelectors.length ) {
            this.commitComplexHasSelectors();
        }

        // `:xpath()` selectors.
        if ( this.xpathSelectorsCost < 10 && this.xpathSelectors.length ) {
            this.commitXpathSelectors();
        }

        // Committing declarative selectors is entirely optional, but it helps
        // harden uBO against sites which try to bypass uBO's injected styles.

        // Simple selectors.
        if ( this.simpleSelectors.length ) {
            this.commitSimpleSelectors(stagedNodes);
        }

        // Complex selectors.
        if ( this.complexSelectorsCost < 10 && this.complexSelectors.length ) {
            this.commitComplexSelectors();
        }

        // If DOM nodes have been affected, lazily notify core process.
        if (
            this.hiddenNodeCount !== beforeHiddenNodeCount &&
            this.cosmeticFiltersActivatedTimer === null
        ) {
            this.cosmeticFiltersActivatedTimer = vAPI.setTimeout(
                this.cosmeticFiltersActivated.bind(this),
                503
            );
        }
    },

    commitComplexHasSelectors: function() {
        var tstart = window.performance.now(),
            entry, nodes, j, node,
            i = this.complexHasSelectors.length;
        while ( i-- ) {
            entry = this.complexHasSelectors[i];
            nodes = document.querySelectorAll(entry.a);
            j = nodes.length;
            while ( j-- ) {
                node = nodes[j];
                if ( node.querySelector(entry.b) !== null ) {
                    this.hideNode(node);
                }
            }
        }
        this.complexHasSelectorsCost = window.performance.now() - tstart;
    },

    commitComplexSelectors: function() {
        if ( this.complexSelectorsNodeSet === null ) {
            return;
        }
        var tstart = window.performance.now(),
            newNodeSet = new Set();
        if ( this.complexGroupSelector === null ) {
            this.complexGroupSelector = this.complexSelectors.join(',');
        }
        var nodes = document.querySelectorAll(this.complexGroupSelector),
            i = nodes.length, node;
        while ( i-- ) {
            node = nodes[i];
            newNodeSet.add(node);
            if ( !this.complexSelectorsNodeSet.delete(node) ) {
                this.hideNode(node);
            }
        }
        var iter = this.complexSelectorsNodeSet.values();
        while ( (node = iter.next().value) ) {
            this.unhideNode(node);
        }
        this.complexSelectorsNodeSet = newNodeSet;
        this.complexSelectorsCost = window.performance.now() - tstart;
    },

    commitSimpleHasSelectors: function(stagedNodes) {
        var i = this.simpleHasSelectors.length,
            entry, j, parent, nodes, k, node;
        while ( i-- ) {
            entry = this.simpleHasSelectors[i];
            j = stagedNodes.length;
            while ( j-- ) {
                parent = stagedNodes[j];
                if ( parent[this.matchesProp](entry.a) && parent.querySelector(entry.b) !== null ) {
                    this.hideNode(parent);
                }
                nodes = parent.querySelectorAll(entry.a);
                k = nodes.length;
                while ( k-- ) {
                    node = nodes[k];
                    if ( node.querySelector(entry.b) !== null ) {
                        this.hideNode(node);
                    }
                }
            }
        }
    },

    commitSimpleSelectors: function(stagedNodes) {
        if ( this.simpleGroupSelector === null ) {
            this.simpleGroupSelector =
                this.simpleSelectors.join(this.cssNotHiddenId + ',') +
                this.cssNotHiddenId;
        }
        var i = stagedNodes.length, stagedNode, nodes, j;
        while ( i-- ) {
            stagedNode = stagedNodes[i];
            if ( stagedNode[this.matchesProp](this.simpleGroupSelector) ) {
                this.hideNode(stagedNode);
            }
            nodes = stagedNode.querySelectorAll(this.simpleGroupSelector);
            j = nodes.length;
            while ( j-- ) {
                this.hideNode(nodes[j]);
            }
        }
    },

    commitXpathSelectors: function() {
        var tstart = window.performance.now();
        if ( this.xpathExpression === null ) {
            this.xpathExpression = document.createExpression(
                this.xpathSelectors.join('|'),
                null
            );
        }
        this.xpathResult = this.xpathExpression.evaluate(
            document,
            XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
            this.xpathResult
        );
        var i = this.xpathResult.snapshotLength, node;
        while ( i-- ) {
            node = this.xpathResult.snapshotItem(i);
            if ( node.nodeType === 1 ) {
                this.hideNode(node);
            }
        }
        this.xpathSelectorsCost = window.performance.now() - tstart;
    },

    cosmeticFiltersActivated: function() {
        this.cosmeticFiltersActivatedTimer = null;
        vAPI.messaging.send(
            'contentscript',
            { what: 'cosmeticFiltersActivated' }
        );
    },

    hideNode: (function() {
        if ( document.documentElement.shadowRoot === undefined ) {
            return function(node) {
                this.hiddenNodeCount += 1;
                node.setAttribute(this.hiddenId, '');
                if ( this.enabled ) {
                    node.style.setProperty('display', 'none', 'important');
                }
            };
        }
        return function(node) {
            this.hiddenNodeCount += 1;
            node.setAttribute(this.hiddenId, '');
            if ( this.enabled === false ) {
                return;
            }
            // https://github.com/gorhill/uBlock/issues/762
            // https://github.com/gorhill/uBlock/issues/769#issuecomment-229873048
            // Always enforce `display: none`.
            node.style.setProperty('display', 'none', 'important');
            // https://www.chromestatus.com/features/4668884095336448
            // "Multiple shadow roots is being deprecated."
            var shadow = node.shadowRoot;
            if ( shadow ) {
                if ( shadow.className === this.shadowId && shadow.firstElementChild !== null ) {
                    shadow.removeChild(shadow.firstElementChild);
                }
                return;
            }
            // https://github.com/gorhill/uBlock/pull/555
            // Not all nodes can be shadowed:
            //   https://github.com/w3c/webcomponents/issues/102
            try {
                shadow = node.createShadowRoot();
                shadow.className = this.shadowId;
            } catch (ex) {
            }
        };
    })(),

    showNode: function(node) {
        node.style.removeProperty('display');
        var shadow = node.shadowRoot;
        if ( shadow && shadow.className === this.shadowId ) {
            if ( shadow.firstElementChild !== null ) {
                shadow.removeChild(shadow.firstElementChild);
            }
            shadow.appendChild(document.createElement('content'));
        }
    },

    toggleOff: function() {
        this.enabled = false;
    },

    toggleOn: function() {
        this.enabled = true;
    },

    unhideNode: function(node) {
        this.hiddenNodeCount--;
        node.removeAttribute(this.hiddenId);
        node.style.removeProperty('display');
        var shadow = node.shadowRoot;
        if ( shadow && shadow.className === this.shadowId ) {
            if ( shadow.firstElementChild !== null ) {
                shadow.removeChild(shadow.firstElementChild);
            }
            shadow.appendChild(document.createElement('content'));
        }
    },

    unshowNode: function(node) {
        node.style.setProperty('display', 'none', 'important');
        var shadow = node.shadowRoot;
        if (
            shadow &&
            shadow.className === this.shadowId &&
            shadow.firstElementChild !== null
        ) {
            shadow.removeChild(shadow.firstElementChild);
        }
    },
};


// Not everything could be initialized at declaration time.
(function() {
    var df = vAPI.domFilterer;
    df.cssNotHiddenId = ':not([' + df.hiddenId + '])';

    // Complex selectors, due to their nature may need to be "de-committed". A
    // Set() is used to implement this functionality. For browser with no
    // support of Set(), uBO will skip committing complex selectors.
    if ( typeof window.Set === 'function' ) {
        df.complexSelectorsNodeSet = new Set();
    }

    // Theoretically, `:has`- and `:xpath`-based selectors may also need to
    // be de-committed. But for performance purpose, this is not implemented,
    // and anyways, the point of these selectors is to be very accurate, so
    // I do not expect de-committing scenarios to occur with proper use of
    // these selectors.
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
    vAPI.executionCost.start();

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

    // https://github.com/chrisaljoudi/uBlock/issues/587
    // If no filters were found, maybe the script was injected before uBlock's
    // process was fully initialized. When this happens, pages won't be
    // cleaned right after browser launch.
    vAPI.contentscriptInjected = details && details.ready;

    vAPI.executionCost.stop('domIsLoading/responseHandler');
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
            process();
        }
        if ( node.children.length !== 0 ) {
            var iframes = node.getElementsByTagName('iframe');
            if ( iframes.length !== 0 ) {
                addIFrames(iframes);
                process();
            }
        }
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

vAPI.executionCost.start();

/******************************************************************************/

// Cosmetic filtering.

(function() {
    if ( vAPI.skipCosmeticFiltering ) {
        //console.debug('Abort cosmetic filtering');
        return;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/789
    // https://github.com/gorhill/uBlock/issues/873
    // Be sure that our style tags used for cosmetic filtering are still applied.
    var domFilterer = vAPI.domFilterer;
    domFilterer.checkStyleTags(false);
    domFilterer.commit();

    var contextNodes = [ document.documentElement ],
        messaging = vAPI.messaging,
        highGenerics = null,
        lowGenericSelectors = [],
        queriedSelectors = Object.create(null);

    var responseHandler = function(response) {
        // https://github.com/gorhill/uMatrix/issues/144
        if ( response && response.shutdown ) {
            vAPI.shutdown.exec();
            return;
        }

        vAPI.executionCost.start();

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
            if ( highGenerics.hideHighSimpleCount || highGenerics.hideHighComplexCount ) {
                processHighHighGenerics();
            }
        }

        domFilterer.commit(contextNodes);
        contextNodes = [];

        vAPI.executionCost.stop('domIsLoaded/responseHandler');
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
            lowGenericSelectors = [];
        } else {
            responseHandler(null);
        }
    };

    // Extract and return the staged nodes which (may) match the selectors.

    var selectNodes = function(selector) {
        var stagedNodes = contextNodes,
            i = stagedNodes.length;
        if ( i === 1 && stagedNodes[0] === document.documentElement ) {
            return document.querySelectorAll(selector);
        }
        var targetNodes = [],
            node, nodeList, j;
        while ( i-- ) {
            node = stagedNodes[i];
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
                    domFilterer.addSelector(selector).hideNode(node);
                    continue;
                }
                // Candidate 2 = specific form
                selector = node.localName + selector;
                if ( generics.hasOwnProperty(selector) ) {
                    domFilterer.addSelector(selector).hideNode(node);
                }
            }
        }
    };

    // High-medium generics:
    // - [href^="http"]

    var processHighMediumGenerics = function(generics) {
        var stagedNodes = contextNodes,
            i = stagedNodes.length;
        if ( i === 1 && stagedNodes[0] === document.documentElement ) {
            processHighMediumGenericsForNodes(document.links, generics);
            return;
        }
        var aa = [ null ],
            node, nodes;
        while ( i-- ) {
            node = stagedNodes[i];
            if ( node.localName === 'a' ) {
                aa[0] = node;
                processHighMediumGenericsForNodes(aa, generics);
            }
            nodes = node.getElementsByTagName('a');
            if ( nodes.length !== 0 ) {
                processHighMediumGenericsForNodes(nodes, generics);
            }
        }
    };

    var processHighMediumGenericsForNodes = function(nodes, generics) {
        var i = nodes.length,
            node, href, pos, entry, j, selector;
        while ( i-- ) {
            node = nodes[i];
            href = node.getAttribute('href');
            if ( !href ) { continue; }
            pos = href.indexOf('://');
            if ( pos === -1 ) { continue; }
            entry = generics[href.slice(pos + 3, pos + 11)];
            if ( entry === undefined ) { continue; }
            if ( typeof entry === 'string' ) {
                if ( href.lastIndexOf(entry.slice(8, -2), 0) === 0 ) {
                    domFilterer.addSelector(entry).hideNode(node);
                }
                continue;
            }
            j = entry.length;
            while ( j-- ) {
                selector = entry[j];
                if ( href.lastIndexOf(selector.slice(8, -2), 0) === 0 ) {
                    domFilterer.addSelector(selector).hideNode(node);
                }
            }
        }
    };

    var highHighSimpleGenericsCost = 0,
        highHighSimpleGenericsInjected = false,
        highHighComplexGenericsCost = 0,
        highHighComplexGenericsInjected = false;

    var processHighHighGenerics = function() {
        var tstart;
        // Simple selectors.
        if (
            highHighSimpleGenericsInjected === false &&
            highHighSimpleGenericsCost < 50 &&
            highGenerics.hideHighSimpleCount !== 0
        ) {
            tstart = window.performance.now();
            var matchesProp = vAPI.matchesProp,
                nodes = contextNodes,
                i = nodes.length, node;
            while ( i-- ) {
                node = nodes[i];
                if (
                    node[matchesProp](highGenerics.hideHighSimple) ||
                    node.querySelector(highGenerics.hideHighSimple) !== null
                ) {
                    highHighSimpleGenericsInjected = true;
                    domFilterer.addSelectors(highGenerics.hideHighSimple.split(',\n'));
                    break;
                }
            }
            highHighSimpleGenericsCost += window.performance.now() - tstart;
        }
        // Complex selectors.
        if (
            highHighComplexGenericsInjected === false &&
            highHighComplexGenericsCost < 50 &&
            highGenerics.hideHighComplexCount !== 0
        ) {
            tstart = window.performance.now();
            if ( document.querySelector(highGenerics.hideHighComplex) !== null ) {
                highHighComplexGenericsInjected = true;
                domFilterer.addSelectors(highGenerics.hideHighComplex.split(',\n'));
                domFilterer.commit();
            }
            highHighComplexGenericsCost += window.performance.now() - tstart;
        }
    };

    // Extract all classes/ids: these will be passed to the cosmetic filtering
    // engine, and in return we will obtain only the relevant CSS selectors.

    // https://github.com/gorhill/uBlock/issues/672
    // http://www.w3.org/TR/2014/REC-html5-20141028/infrastructure.html#space-separated-tokens
    // http://jsperf.com/enumerate-classes/6

    var classesAndIdsFromNodeList = function(nodes) {
        if ( !nodes ) { return; }
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
    var addedNodeListsTimerDelay = 0;
    var removedNodeListsTimer = null;
    var removedNodeListsTimerDelay = 5;
    var collapser = domCollapser;

    var addedNodesHandler = function() {
        vAPI.executionCost.start();

        addedNodeListsTimer = null;
        if ( addedNodeListsTimerDelay < 100 ) {
            addedNodeListsTimerDelay += 10;
        }
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
        }

        vAPI.executionCost.stop('domIsLoaded/responseHandler');
    };

    // https://github.com/gorhill/uBlock/issues/873
    // This will ensure our style elements will stay in the DOM.
    var removedNodesHandler = function() {
        removedNodeListsTimer = null;
        removedNodeListsTimerDelay *= 2;
        // Stop watching style tags after a while.
        if ( removedNodeListsTimerDelay > 1000 ) {
            removedNodeListsTimerDelay = 0;
        }
        domFilterer.checkStyleTags(true);
    };

    // https://github.com/chrisaljoudi/uBlock/issues/205
    // Do not handle added node directly from within mutation observer.
    // I arbitrarily chose 100 ms for now: I have to compromise between the
    // overhead of processing too few nodes too often and the delay of many
    // nodes less often.
    var domLayoutChanged = function(mutations) {
        vAPI.executionCost.start();

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
        if ( removedNodeListsTimerDelay !== 0 && removedNodeLists && removedNodeListsTimer === null ) {
            removedNodeListsTimer = vAPI.setTimeout(removedNodesHandler, removedNodeListsTimerDelay);
        }

        vAPI.executionCost.stop('domIsLoaded/domLayoutChanged');
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
        vAPI.executionCost.start();
        domCollapser.add(ev.target);
        domCollapser.process();
        vAPI.executionCost.stop('domIsLoaded/onResourceFailed');
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
    var elems = document.images || document.getElementsByTagName('img'),
        i = elems.length, elem;
    while ( i-- ) {
        elem = elems[i];
        if ( elem.complete ) {
            collapser.add(elem);
        }
    }
    collapser.addMany(document.embeds || document.getElementsByTagName('embed'));
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
        vAPI.executionCost.start();
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
        vAPI.executionCost.stop('domIsLoaded/onMouseClick');
    };

    document.addEventListener('mousedown', onMouseClick, true);

    // https://github.com/gorhill/uMatrix/issues/144
    vAPI.shutdown.add(function() {
        document.removeEventListener('mousedown', onMouseClick, true);
    });
})();

/******************************************************************************/

vAPI.executionCost.stop('domIsLoaded');

};

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

if ( document.readyState !== 'loading' ) {
    domIsLoaded();
} else {
    document.addEventListener('DOMContentLoaded', domIsLoaded);
}

vAPI.executionCost.stop('contentscript.js');

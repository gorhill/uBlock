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
    throw new Error('uBlock Origin: aborting content scripts for ' + window.location);
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

vAPI.domFilterer = (function() {

/******************************************************************************/

if ( typeof self.Set !== 'function' ) {
    self.Set = function() {
        this._set = [];
        this._i = 0;
        this.value = undefined;
    };
    self.Set.prototype = {
        polyfill: true,
        clear: function() {
            this._set = [];
        },
        add: function(k) {
            if ( this._set.indexOf(k) === -1 ) {
                this._set.push(k);
            }
        },
        delete: function(k) {
            var pos = this._set.indexOf(k);
            if ( pos !== -1 ) {
                this._set.splice(pos, 1);
                return true;
            }
            return false;
        },
        has: function(k) {
            return this._set.indexOf(k) !== -1;
        },
        values: function() {
            this._i = 0;
            return this;
        },
        next: function() {
            this.value = this._set[this._i];
            this._i += 1;
            return this;
        }
    };
    Object.defineProperty(self.Set.prototype, 'size', {
        get: function() { return this._set.length; }
    });
}

/******************************************************************************/

var shadowId = document.documentElement.shadowRoot !== undefined ?
    vAPI.randomToken():
    undefined;

var jobQueue = [
    { t: 'css-hide',  _0: [] }, // to inject in style tag
    { t: 'css-style', _0: [] }, // to inject in style tag
    { t: 'css-ssel',  _0: [] }, // to manually hide (incremental)
    { t: 'css-csel',  _0: [] }  // to manually hide (not incremental)
];

var reParserEx = /^(.*?(:has\(.+?\)|:xpath\(.+?\))?)(:style\(.+?\))?$/;

var allExceptions = Object.create(null);
var allSelectors = Object.create(null);
var stagedNodes = [];

// Complex selectors, due to their nature may need to be "de-committed". A
// Set() is used to implement this functionality.

var complexSelectorsOldResultSet;
var complexSelectorsCurrentResultSet = new Set();

/******************************************************************************/

var cosmeticFiltersActivatedTimer = null;

var cosmeticFiltersActivated = function() {
    cosmeticFiltersActivatedTimer = null;
    vAPI.messaging.send(
        'contentscript',
        { what: 'cosmeticFiltersActivated' }
    );
};

/******************************************************************************/

var domFilterer = {
    commitMissCount: 0,
    disabledId: vAPI.randomToken(),
    enabled: true,
    hiddenId: vAPI.randomToken(),
    hiddenNodeCount: 0,
    matchesProp: vAPI.matchesProp,
    styleTags: [],

    jobQueue: jobQueue,
    // Stock jobs.
    job0: jobQueue[0],
    job1: jobQueue[1],
    job2: jobQueue[2],
    job3: jobQueue[3],

    addExceptions: function(aa) {
        for ( var i = 0, n = aa.length; i < n; i++ ) {
            allExceptions[aa[i]] = true;
        }
    },

    // Job:
    // Stock jobs in job queue:
    //     0 = css rules/css declaration to remove visibility
    //     1 = css rules/any css declaration
    //     2 = simple css selectors/hide
    //     3 = complex css selectors/hide
    // Custom jobs:
    //     has/hide
    //     xpath/hide
    //     has/inline css declaration (not supported yet)
    //     xpath/inline css declaration (not supported yet)

    addSelector: function(s) {
        if ( allSelectors[s] || allExceptions[s] ) {
            return this;
        }
        allSelectors[s] = true;
        var parts = reParserEx.exec(s);
        if ( parts === null ) { return this; }
        var sel0 = parts[1], sel1 = parts[2], style = parts[3];

        // Hide
        if ( style === undefined ) {
            if ( sel1 === undefined ) {
                this.job0._0.push(sel0);
                if ( sel0.indexOf(' ') === -1 ) {
                    this.job2._0.push(sel0);
                    this.job2._1 = undefined;
                } else {
                    this.job3._0.push(sel0);
                    this.job3._1 = undefined;
                }
                return this;
            }
            if ( sel1.lastIndexOf(':has', 0) === 0 ) {
                this.jobQueue.push({ t: 'has-hide', raw: s, _0: sel0.slice(0, sel0.length - sel1.length), _1: sel1.slice(5, -1) });
                return this;
            }
            if ( sel1.lastIndexOf(':xpath',0) === 0 ) {
                this.jobQueue.push({ t: 'xpath-hide', raw: s, _0: sel1.slice(7, -1) });
                return this;
            }
            // ignore unknown selector
            return this;
        }

        // Modify style
        if ( sel1 === undefined ) {
            this.job1._0.push(sel0 + ' { ' + style.slice(7, -1) + ' }');
            this.job1._1 = undefined;
            return this;
        }
        if ( sel1.lastIndexOf(':has', 0) === 0 ) {
            return this;
        }
        if ( sel1.lastIndexOf(':xpath',0) === 0 ) {
            if ( sel0 !== sel1 ) { return this; }
            return this;
        }
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

    commit_: function() {
        var beforeHiddenNodeCount = this.hiddenNodeCount,
            styleText = '', i, n;

        // Stock job 0 = css rules/hide
        if ( this.job0._0.length ) {
            styleText = '\n:root ' + this.job0._0.join(',\n:root ') + '\n{ display: none !important; }';
            this.job0._0.length = 0;
        }

        // Stock job 1 = css rules/any css declaration
        if ( this.job1._0.length ) {
            styleText += '\n' + this.job1._0.join('\n');
            this.job1._0.length = 0;
        }

        if ( styleText !== '' ) {
            var styleTag = document.createElement('style');
            styleTag.setAttribute('type', 'text/css');
            styleTag.textContent = styleText;
            document.head.appendChild(styleTag);
            this.styleTags.push(styleTag);
        }

        // Simple selectors: incremental.

        // Stock job 2 = simple css selectors/hide
        if ( this.job2._0.length ) {
            i = stagedNodes.length;
            while ( i-- ) {
                this.runSimpleSelectorJob(this.job2, stagedNodes[i], hideNode);
            }
        }
        stagedNodes = [];

        // Complex selectors: non-incremental.
        complexSelectorsOldResultSet = complexSelectorsCurrentResultSet;
        complexSelectorsCurrentResultSet = new Set();

        // Stock job 3 = complex css selectors/hide
        // The handling of these can be considered optional, since they are
        // also applied declaratively using a style tag.
        if ( this.job3._0.length ) {
            this.runComplexSelectorJob(this.job3, complexHideNode);
        }

        // Custom jobs. No optional since they can't be applied in a
        // declarative way.
        for ( i = 4, n = this.jobQueue.length; i < n; i++ ) {
            this.runJob(this.jobQueue[i], complexHideNode);
        }

        var commitHit = this.hiddenNodeCount !== beforeHiddenNodeCount;
        if ( commitHit ) {
            this.commitMissCount = 0;
        } else {
            this.commitMissCount += 1;
        }

        // Un-hide nodes previously hidden.
        i = complexSelectorsOldResultSet.size;
        if ( i !== 0 ) {
            var iter = complexSelectorsOldResultSet.values();
            while ( i-- ) {
                this.unhideNode(iter.next().value);
            }
            complexSelectorsOldResultSet.clear();
        }

        // If DOM nodes have been affected, lazily notify core process.
        if ( commitHit && cosmeticFiltersActivatedTimer === null ) {
            cosmeticFiltersActivatedTimer = vAPI.setTimeout(
                cosmeticFiltersActivated,
                503
            );
        }
    },

    commit: function(nodes) {
        if ( stagedNodes.length === 0 ) {
            window.requestAnimationFrame(this.commit_.bind(this));
        }
        if ( nodes === undefined ) {
            stagedNodes = [ document.documentElement ];
        } else if ( stagedNodes[0] !== document.documentElement ) {
            stagedNodes = stagedNodes.concat(nodes);
        }
    },

    hideNode: function(node) {
        if ( node[this.hiddenId] !== undefined ) {
            return;
        }
        node.setAttribute(this.hiddenId, '');
        this.hiddenNodeCount += 1;
        node.hidden = true;
        node[this.hiddenId] = null;
        var style = window.getComputedStyle(node),
            display = style.getPropertyValue('display');
        if ( display !== '' && display !== 'none' ) {
            var styleAttr = node.getAttribute('style') || '';
            node[this.hiddenId] = node.hasAttribute('style') && styleAttr;
            if ( styleAttr !== '' ) {
                styleAttr += '; ';
            }
            node.setAttribute('style', styleAttr + 'display: none !important;');
        }
        if ( shadowId === undefined ) {
            return;
        }
        var shadow = node.shadowRoot;
        if ( shadow ) {
            if ( shadow[shadowId] && shadow.firstElementChild !== null ) {
                shadow.removeChild(shadow.firstElementChild);
            }
            return;
        }
        // https://github.com/gorhill/uBlock/pull/555
        // Not all nodes can be shadowed:
        //   https://github.com/w3c/webcomponents/issues/102
        try {
            shadow = node.createShadowRoot();
            shadow[shadowId] = true;
        } catch (ex) {
        }
    },

    runSimpleSelectorJob: function(job, root, fn) {
        if ( job._1 === undefined ) {
            job._1 = job._0.join(cssNotHiddenId + ',');
        }
        if ( root[this.matchesProp](job._1) ) {
            fn(root);
        }
        var nodes = root.querySelectorAll(job._1),
            i = nodes.length;
        while ( i-- ) {
            fn(nodes[i], job);
        }
    },

    runComplexSelectorJob: function(job, fn) {
        if ( job._1 === undefined ) {
            job._1 = job._0.join(',');
        }
        var nodes = document.querySelectorAll(job._1),
            i = nodes.length;
        while ( i-- ) {
            fn(nodes[i], job);
        }
    },

    runHasJob: function(job, fn) {
        var nodes = document.querySelectorAll(job._0),
            i = nodes.length, node;
        while ( i-- ) {
            node = nodes[i];
            if ( node.querySelector(job._1) !== null ) {
                fn(node, job);
            }
        }
    },

    runXpathJob: function(job, fn) {
        if ( job._1 === undefined ) {
            job._1 = document.createExpression(job._0, null);
        }
        var xpr = job._2 = job._1.evaluate(
            document,
            XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
            job._2 || null
        );
        var i = xpr.snapshotLength, node;
        while ( i-- ) {
            node = xpr.snapshotItem(i);
            if ( node.nodeType === 1 ) {
                fn(node, job);
            }
        }
    },

    runJob: function(job, fn) {
        switch ( job.t ) {
        case 'has-hide':
            this.runHasJob(job, fn);
            break;
        case 'xpath-hide':
            this.runXpathJob(job, fn);
            break;
        case 'has-style':
            // not supported yet
            break;
        case 'xpath-style':
            // not supported yet
            break;
        }
    },

    showNode: function(node) {
        node.hidden = false;
        var styleAttr = node[this.hiddenId];
        if ( styleAttr === false ) {
            node.removeAttribute('style');
        } else if ( typeof styleAttr === 'string' ) {
            node.setAttribute('style', node[this.hiddenId]);
        }
        var shadow = node.shadowRoot;
        if ( shadow && shadow[shadowId] ) {
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
        if ( node[this.hiddenId] !== undefined ) {
            this.hiddenNodeCount--;
        }
        node.removeAttribute(this.hiddenId);
        node[this.hiddenId] = undefined;
        node.hidden = false;
        var shadow = node.shadowRoot;
        if ( shadow && shadow[shadowId] ) {
            if ( shadow.firstElementChild !== null ) {
                shadow.removeChild(shadow.firstElementChild);
            }
            shadow.appendChild(document.createElement('content'));
        }
    },

    unshowNode: function(node) {
        node.hidden = true;
        var styleAttr = node[this.hiddenId];
        if ( styleAttr === false ) {
            node.setAttribute('style', 'display: none !important;');
        } else if ( typeof styleAttr === 'string' ) {
            node.setAttribute('style', node[this.hiddenId] + '; display: none !important;');
        }
        var shadow = node.shadowRoot;
        if ( shadow && shadow[shadowId] && shadow.firstElementChild !== null ) {
            shadow.removeChild(shadow.firstElementChild);
        }
    }
};

/******************************************************************************/

var hideNode = domFilterer.hideNode.bind(domFilterer);

var complexHideNode = function(node) {
    complexSelectorsCurrentResultSet.add(node);
    if ( !complexSelectorsOldResultSet.delete(node) ) {
        hideNode(node);
    }
};

/******************************************************************************/

var cssNotHiddenId = ':not([' + domFilterer.hiddenId + '])';

/******************************************************************************/

return domFilterer;

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// This is executed once, and since no hooks are left behind once the response
// is received, I expect this code to be garbage collected by the browser.

(function domIsLoading() {

    // Domain-based ABP cosmetic filters.
    // These can be inserted before the DOM is loaded.

    var cosmeticFilters = function(details) {
        var domFilterer = vAPI.domFilterer;
        domFilterer.addExceptions(details.cosmeticDonthide);
        // https://github.com/chrisaljoudi/uBlock/issues/143
        domFilterer.addSelectors(details.cosmeticHide);
        domFilterer.commit();
    };

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

    // Create script tags and assign data URIs looked up from our library of
    // redirection resources: Sometimes it is useful to use these resources as
    // standalone scriptlets. These scriptlets are injected from within the
    // content scripts because what must be injected, if anything, depends on
    // the currently active filters, as selected by the user.
    // Library of redirection resources is located at:
    // https://github.com/gorhill/uBlock/blob/master/assets/ublock/resources.txt

    var injectScripts = function(scripts) {
        var parent = document.head || document.documentElement;
        if ( !parent ) {
            return;
        }
        var scriptTag = document.createElement('script');
        // Have the injected script tag remove itself when execution completes:
        // to keep DOM as clean as possible.
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

    var responseHandler = function(details) {
        vAPI.executionCost.start();

        if ( details ) {
            vAPI.skipCosmeticFiltering = details.skipCosmeticFiltering;
            vAPI.skipCosmeticSurveying = details.skipCosmeticSurveying;
            if (
                (details.skipCosmeticFiltering !== true) &&
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
            // The port will never be used again at this point, disconnecting
            // allows the browser to flush this script from memory.
        }

        // https://github.com/chrisaljoudi/uBlock/issues/587
        // If no filters were found, maybe the script was injected before
        // uBlock's process was fully initialized. When this happens, pages
        // won't be cleaned right after browser launch.
        vAPI.contentscriptInjected = details && details.ready;

        vAPI.executionCost.stop('domIsLoading/responseHandler');
    };

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

})();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

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
            target.hidden = true;

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

/*******************************************************************************

skip-survey=false: survey-phase-1 => survey-phase-2 => survey-phase-3 => commit
 skip-survey=true: commit

*/

// Cosmetic filtering.

(function() {
    if ( vAPI.skipCosmeticFiltering ) {
        //console.debug('Abort cosmetic filtering');
        return;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/789
    // https://github.com/gorhill/uBlock/issues/873
    // Be sure that our style tags used for cosmetic filtering are still
    // applied.
    var domFilterer = vAPI.domFilterer;
    domFilterer.checkStyleTags(false);
    domFilterer.commit();

    var contextNodes = [ document.documentElement ],
        messaging = vAPI.messaging;

    var domSurveyor = (function() {
        if ( vAPI.skipCosmeticSurveying === true ) {
            return;
        }

        var cosmeticSurveyingMissCount = 0,
            highGenerics = null,
            lowGenericSelectors = [],
            queriedSelectors = Object.create(null);

        // Handle main process' response.

        var surveyPhase3 = function(response) {
            // https://github.com/gorhill/uMatrix/issues/144
            if ( response && response.shutdown ) {
                vAPI.shutdown.exec();
                return;
            }

            vAPI.executionCost.start();

            var result = response && response.result,
                firstSurvey = highGenerics === null;

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

            // Need to do this before committing DOM filterer, as needed info
            // will no longer be there after commit.
            if ( firstSurvey || domFilterer.job0._0.length ) {
                messaging.send(
                    'contentscript',
                    {
                        what: 'cosmeticFiltersInjected',
                        type: 'cosmetic',
                        hostname: window.location.hostname,
                        selectors: domFilterer.job0._0
                    }
                );
            }

            // Shutdown surveyor if too many consecutive empty resultsets.
            if ( domFilterer.job0._0.length === 0 ) {
                cosmeticSurveyingMissCount += 1;
                if ( cosmeticSurveyingMissCount > 255 ) {
                    domSurveyor = undefined;
                }
            } else {
                cosmeticSurveyingMissCount = 0;
            }

            domFilterer.commit(contextNodes);
            contextNodes = [];

            vAPI.executionCost.stop('domIsLoaded/surveyPhase2');
        };

        // Query main process.

        var surveyPhase2 = function() {
            if ( lowGenericSelectors.length !== 0 || highGenerics === null ) {
                messaging.send(
                    'contentscript',
                    {
                        what: 'retrieveGenericCosmeticSelectors',
                        pageURL: window.location.href,
                        selectors: lowGenericSelectors,
                        firstSurvey: highGenerics === null
                    },
                    surveyPhase3
                );
                lowGenericSelectors = [];
            } else {
                surveyPhase3(null);
            }
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
                    // If generic form is injected, no need to process the
                    // specific form, as the generic will affect all related
                    // specific forms.
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

        // Extract all classes/ids: these will be passed to the cosmetic
        // filtering engine, and in return we will obtain only the relevant
        // CSS selectors.

        // https://github.com/gorhill/uBlock/issues/672
        // http://www.w3.org/TR/2014/REC-html5-20141028/infrastructure.html#space-separated-tokens
        // http://jsperf.com/enumerate-classes/6

        var surveyPhase1 = function() {
            var nodes = selectNodes('[class],[id]');
            var qq = queriedSelectors;
            var ll = lowGenericSelectors;
            var node, v, vv, j;
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
                if ( /\s/.test(vv) === false ) {
                    v = '.' + vv;
                    if ( qq[v] === undefined ) {
                        ll.push(v);
                        qq[v] = true;
                    }
                } else {
                    vv = node.classList;
                    j = vv.length;
                    while ( j-- ) {
                        v = '.' + vv[j];
                        if ( qq[v] === undefined ) {
                            ll.push(v);
                            qq[v] = true;
                        }
                    }
                }
            }
            surveyPhase2();
        };

        return surveyPhase1;
    })();

    // Start cosmetic filtering.

    if ( domSurveyor ) {
        domSurveyor();
    }

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
            if ( domSurveyor ) {
                domSurveyor();
            } else {
                domFilterer.commit(contextNodes);
                contextNodes = [];
                if ( domFilterer.commitMissCount > 255 ) {
                    domLayoutObserver.disconnect();
                }
            }
        }

        vAPI.executionCost.stop('domIsLoaded/addedNodesHandler');
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

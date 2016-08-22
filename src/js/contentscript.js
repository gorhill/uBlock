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

/*******************************************************************************

              +--> [[domSurveyor] --> domFilterer]
  domWatcher--|
              +--> [domCollapser]

  domWatcher:
    Watches for changes in the DOM, and notify the other components about these
    changes.

  domCollapser:
    Enforces the collapsing of DOM elements for which a corresponding
    resource was blocked through network filtering.

  domFilterer:
    Enforces the filtering of DOM elements, by feeding it cosmetic filters.

  domSurveyor:
    Surveys the DOM to find new cosmetic filters to apply to the current page.

  If page is whitelisted:
    - domWatcher: off
    - domCollapser: off
    - domFilterer: off
    - domSurveyor: off
  I verified that the code in this file is completely flushed out of memory
  when a page is whitelisted.

  If cosmetic filtering is disabled:
    - domWatcher: on
    - domCollapser: on
    - domFilterer: off
    - domSurveyor: off

  If generic cosmetic filtering is disabled:
    - domWatcher: on
    - domCollapser: on
    - domFilterer: on
    - domSurveyor: off

  Additionally, the domSurveyor can turn itself off once it decides that
  it has become pointless (repeatedly not finding new cosmetic filters).

*/

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// Abort execution by throwing if an unexpected condition arise.
// - https://github.com/chrisaljoudi/uBlock/issues/456

if ( typeof vAPI !== 'object' ) {
    throw new Error('uBlock Origin: aborting content scripts for ' + window.location);
}
vAPI.lock();

vAPI.executionCost.start();

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

var reParserEx = /:(?:matches-css|has|style|xpath)\(.+?\)$/;

var allExceptions = Object.create(null),
    allSelectors = Object.create(null),
    commitTimer = null,
    stagedNodes = [],
    matchesProp = vAPI.matchesProp;

// Complex selectors, due to their nature may need to be "de-committed". A
// Set() is used to implement this functionality.

var complexSelectorsOldResultSet,
    complexSelectorsCurrentResultSet = new Set();

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

var runSimpleSelectorJob = function(job, root, fn) {
    if ( job._1 === undefined ) {
        job._1 = job._0.join(cssNotHiddenId + ',');
    }
    if ( root[matchesProp](job._1) ) {
        fn(root);
    }
    var nodes = root.querySelectorAll(job._1),
        i = nodes.length;
    while ( i-- ) {
        fn(nodes[i], job);
    }
};

var runComplexSelectorJob = function(job, fn) {
    if ( job._1 === undefined ) {
        job._1 = job._0.join(',');
    }
    var nodes = document.querySelectorAll(job._1),
        i = nodes.length;
    while ( i-- ) {
        fn(nodes[i], job);
    }
};

var runHasJob = function(job, fn) {
    var nodes = document.querySelectorAll(job._0),
        i = nodes.length, node;
    while ( i-- ) {
        node = nodes[i];
        if ( node.querySelector(job._1) !== null ) {
            fn(node, job);
        }
    }
};

var csspropDictFromString = function(s) {
    var aa = s.split(/;\s+|;$/),
        i = aa.length,
        dict = Object.create(null),
        prop, pos;
    while ( i-- ) {
        prop = aa[i].trim();
        if ( prop === '' ) { continue; }
        pos = prop.indexOf(':');
        if ( pos === -1 ) { continue; }
        dict[prop.slice(0, pos).trim()] = prop.slice(pos + 1).trim();
    }
    return dict;
};

var runMatchesCSSJob = function(job, fn) {
    if ( job._2 === undefined ) {
        if ( job._0.indexOf(':after', job._0.length - 6) !== -1 ) {
            job._0 = job._0.slice(0, -6);
            job._2 = ':after';
        } else {
            job._2 = null;
        }
    }
    var nodes = document.querySelectorAll(job._0),
        i = nodes.length;
    if ( i === 0 ) { return; }
    if ( typeof job._1 === 'string' ) {
        job._1 = csspropDictFromString(job._1);
    }
    var node, match, style;
    while ( i-- ) {
        node = nodes[i];
        style = window.getComputedStyle(node, job._2);
        match = undefined;
        for ( var prop in job._1 ) {
            match = style[prop] === job._1[prop];
            if ( match === false ) {
                break;
            }
        }
        if ( match === true ) {
            fn(node, job);
        }
    }
};

var runXpathJob = function(job, fn) {
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
};

/******************************************************************************/

var domFilterer = {
    addedNodesHandlerMissCount: 0,
    removedNodesHandlerMissCount: 0,
    disabledId: vAPI.randomToken(),
    enabled: true,
    hiddenId: vAPI.randomToken(),
    hiddenNodeCount: 0,
    loggerEnabled: undefined,
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
    //     matches-css/hide
    //     has/hide
    //     xpath/hide

    addSelector: function(s) {
        if ( allSelectors[s] || allExceptions[s] ) {
            return;
        }
        allSelectors[s] = true;
        var sel0 = s, sel1 = '';
        if ( s.charCodeAt(s.length - 1) === 0x29 ) {
            var parts = reParserEx.exec(s);
            if ( parts !== null ) {
                sel1 = parts[0];
            }
        }
        if ( sel1 === '' ) {
            this.job0._0.push(sel0);
            if ( sel0.indexOf(' ') === -1 ) {
                this.job2._0.push(sel0);
                this.job2._1 = undefined;
            } else {
                this.job3._0.push(sel0);
                this.job3._1 = undefined;
            }
            return;
        }
        sel0 = sel0.slice(0, sel0.length - sel1.length);
        if ( sel1.lastIndexOf(':has', 0) === 0 ) {
            this.jobQueue.push({ t: 'has-hide', raw: s, _0: sel0, _1: sel1.slice(5, -1) });
        } else if ( sel1.lastIndexOf(':matches-css', 0) === 0 ) {
            this.jobQueue.push({ t: 'matches-css-hide', raw: s, _0: sel0, _1: sel1.slice(13, -1) });
        } else if ( sel1.lastIndexOf(':style', 0) === 0 ) {
            this.job1._0.push(sel0 + ' { ' + sel1.slice(7, -1) + ' }');
            this.job1._1 = undefined;
        } else if ( sel1.lastIndexOf(':xpath', 0) === 0 ) {
            this.jobQueue.push({ t: 'xpath-hide', raw: s, _0: sel1.slice(7, -1) });
        }
        return;
    },

    addSelectors: function(aa) {
        for ( var i = 0, n = aa.length; i < n; i++ ) {
            this.addSelector(aa[i]);
        }
    },

    checkStyleTags_: function() {
        var doc = document,
            html = doc.documentElement,
            head = doc.head,
            newParent = head || html;
        if ( newParent === null ) { return; }
        this.removedNodesHandlerMissCount += 1;
        var styles = this.styleTags,
            style, oldParent;
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
            if ( oldParent === head || oldParent === html ) { continue; }
            style.disabled = false;
            newParent.appendChild(style);
            this.removedNodesHandlerMissCount = 0;
        }
    },

    checkStyleTags: function() {
        if ( this.removedNodesHandlerMissCount < 16 ) {
            this.checkStyleTags_();
        }
    },

    commit_: function() {
        vAPI.executionCost.start();

        commitTimer = null;

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
            if ( document.head ) {
                document.head.appendChild(styleTag);
            }
            this.styleTags.push(styleTag);
        }

        // Simple selectors: incremental.

        // Stock job 2 = simple css selectors/hide
        if ( this.job2._0.length ) {
            i = stagedNodes.length;
            while ( i-- ) {
                runSimpleSelectorJob(this.job2, stagedNodes[i], hideNode);
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
            runComplexSelectorJob(this.job3, complexHideNode);
        }

        // Custom jobs. No optional since they can't be applied in a
        // declarative way.
        for ( i = 4, n = this.jobQueue.length; i < n; i++ ) {
            this.runJob(this.jobQueue[i], complexHideNode);
        }

        var commitHit = this.hiddenNodeCount !== beforeHiddenNodeCount;
        if ( commitHit ) {
            this.addedNodesHandlerMissCount = 0;
        } else {
            this.addedNodesHandlerMissCount += 1;
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
        if (
            this.loggerEnabled !== false &&
            commitHit &&
            cosmeticFiltersActivatedTimer === null
        ) {
            cosmeticFiltersActivatedTimer = vAPI.setTimeout(
                cosmeticFiltersActivated,
                503
            );
        }

        vAPI.executionCost.stop('domFilterer.commit_');
    },

    commit: function(nodes, commitNow) {
        if ( nodes === 'all' ) {
            stagedNodes = [ document.documentElement ];
        } else if ( stagedNodes[0] !== document.documentElement ) {
            stagedNodes = stagedNodes.concat(nodes);
        }
        if ( commitNow ) {
            if ( commitTimer !== null ) {
                window.cancelAnimationFrame(commitTimer);
            }
            this.commit_();
            return;
        }
        if ( commitTimer === null ) {
            commitTimer = window.requestAnimationFrame(this.commit_.bind(this));
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
            if ( styleAttr !== '' ) { styleAttr += '; '; }
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

    runJob: function(job, fn) {
        switch ( job.t ) {
        case 'has-hide':
            runHasJob(job, fn);
            break;
        case 'matches-css-hide':
            runMatchesCSSJob(job, fn);
            break;
        case 'xpath-hide':
            runXpathJob(job, fn);
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

    toggleLogging: function(state) {
        this.loggerEnabled = state;
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
    },

    domChangedHandler: function(addedNodes, removedNodes) {
        this.commit(addedNodes);
        // https://github.com/gorhill/uBlock/issues/873
        // This will ensure our style elements will stay in the DOM.
        if ( removedNodes ) {
            domFilterer.checkStyleTags();
        }
    },

    start: function() {
        var domChangedHandler = this.domChangedHandler.bind(this);
        vAPI.domWatcher.addListener(domChangedHandler);
        vAPI.shutdown.add(function() {
            vAPI.domWatcher.removeListener(domChangedHandler);
        });
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

    var responseHandler = function(response) {
        // cosmetic filtering engine aka 'cfe'
        var cfeDetails = response && response.specificCosmeticFilters;
        if ( !cfeDetails || !cfeDetails.ready ) {
            vAPI.domWatcher = vAPI.domCollapser = vAPI.domFilterer =
            vAPI.domSurveyor = vAPI.domIsLoaded = null;
            vAPI.unlock();
            return;
        }

        vAPI.executionCost.start();

        if ( response.noCosmeticFiltering ) {
            vAPI.domFilterer = null;
            vAPI.domSurveyor = null;
        } else {
            var domFilterer = vAPI.domFilterer;
            domFilterer.toggleLogging(response.loggerEnabled);
            if ( response.noGenericCosmeticFiltering || cfeDetails.noDOMSurveying ) {
                vAPI.domSurveyor = null;
            }
            if ( cfeDetails.cosmeticHide.length !== 0 || cfeDetails.cosmeticDonthide.length !== 0 ) {
                domFilterer.addExceptions(cfeDetails.cosmeticDonthide);
                domFilterer.addSelectors(cfeDetails.cosmeticHide);
                domFilterer.commit('all', true);
            }
        }

        var parent = document.head || document.documentElement;
        if ( parent ) {
            var elem, text;
            if ( cfeDetails.netHide.length !== 0 ) {
                elem = document.createElement('style');
                elem.setAttribute('type', 'text/css');
                text = cfeDetails.netHide.join(',\n');
                text += response.collapseBlocked ?
                    '\n{display:none !important;}' :
                    '\n{visibility:hidden !important;}';
                elem.appendChild(document.createTextNode(text));
                parent.appendChild(elem);
            }
            // Library of resources is located at:
            // https://github.com/gorhill/uBlock/blob/master/assets/ublock/resources.txt
            if ( cfeDetails.scripts ) {
                elem = document.createElement('script');
                // Have the injected script tag remove itself when execution completes:
                // to keep DOM as clean as possible.
                text = cfeDetails.scripts +
                    "\n" +
                    "(function() {\n" +
                    "    var c = document.currentScript,\n" +
                    "        p = c && c.parentNode;\n" +
                    "    if ( p ) {\n" +
                    "        p.removeChild(c);\n" +
                    "    }\n" +
                    "})();";
                elem.appendChild(document.createTextNode(text));
                parent.appendChild(elem);
                vAPI.injectedScripts = text;
            }
        }

        // https://github.com/chrisaljoudi/uBlock/issues/587
        // If no filters were found, maybe the script was injected before
        // uBlock's process was fully initialized. When this happens, pages
        // won't be cleaned right after browser launch.
        if ( document.readyState !== 'loading' ) {
            window.requestAnimationFrame(vAPI.domIsLoaded);
        } else {
            document.addEventListener('DOMContentLoaded', vAPI.domIsLoaded);
        }

        vAPI.executionCost.stop('domIsLoading/responseHandler');
    };

    var url = window.location.href;
    vAPI.messaging.send(
        'contentscript',
        {
            what: 'retrieveContentScriptParameters',
            pageURL: url,
            locationURL: url
        },
        responseHandler
    );

})();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

vAPI.domWatcher = (function() {

    var domLayoutObserver = null,
        ignoreTags = { 'head': 1, 'link': 1, 'meta': 1, 'script': 1, 'style': 1 },
        addedNodeLists = [],
        addedNodes = [],
        removedNodes = false,
        safeObserverHandlerTimer = null,
        listeners = [];

    var safeObserverHandler = function() {
        vAPI.executionCost.start();

        safeObserverHandlerTimer = null;
        var i = addedNodeLists.length,
            nodeList, iNode, node;
        while ( i-- ) {
            nodeList = addedNodeLists[i];
            iNode = nodeList.length;
            while ( iNode-- ) {
                node = nodeList[iNode];
                if ( node.nodeType !== 1 ) {
                    continue;
                }
                if ( ignoreTags[node.localName] === 1 ) {
                    continue;
                }
                addedNodes.push(node);
            }
        }
        addedNodeLists.length = 0;
        if ( addedNodes.length !== 0 || removedNodes ) {
            listeners[0](addedNodes, removedNodes);
            if ( listeners[1] ) {
                listeners[1](addedNodes, removedNodes);
            }
            addedNodes.length = 0;
            removedNodes = false;
        }

        vAPI.executionCost.stop('domWatcher/safeObserverHandler');
    };

    // https://github.com/chrisaljoudi/uBlock/issues/205
    // Do not handle added node directly from within mutation observer.
    var observerHandler = function(mutations) {
        vAPI.executionCost.start();

        var nodeList, mutation,
            i = mutations.length;
        while ( i-- ) {
            mutation = mutations[i];
            nodeList = mutation.addedNodes;
            if ( nodeList.length !== 0 ) {
                addedNodeLists.push(nodeList);
            }
            if ( mutation.removedNodes.length !== 0 ) {
                removedNodes = true;
            }
        }
        if ( (addedNodeLists.length !== 0 || removedNodes) && safeObserverHandlerTimer === null ) {
            safeObserverHandlerTimer = window.requestAnimationFrame(safeObserverHandler);
        }

        vAPI.executionCost.stop('domWatcher/observerHandler');
    };

    var addListener = function(listener) {
        if ( listeners.indexOf(listener) !== -1 ) {
            return;
        }
        listeners.push(listener);
        if ( domLayoutObserver !== null ) {
            return;
        }
        domLayoutObserver = new MutationObserver(observerHandler);
        domLayoutObserver.observe(document.documentElement, {
            //attributeFilter: [ 'class', 'id' ],
            //attributes: true,
            childList: true,
            subtree: true
        });
    };

    var removeListener = function(listener) {
        var pos = listeners.indexOf(listener);
        if ( pos === -1 ) {
            return;
        }
        listeners.splice(pos, 1);
        if ( listeners.length !== 0 || domLayoutObserver === null ) {
            return;
        }
        domLayoutObserver.disconnect();
        domLayoutObserver = null;
    };

    var start = function() {
        vAPI.shutdown.add(function() {
            if ( domLayoutObserver !== null ) {
                domLayoutObserver.disconnect();
                domLayoutObserver = null;
            }
            if ( safeObserverHandlerTimer !== null ) {
                window.cancelAnimationFrame(safeObserverHandlerTimer);
            }
        });
    };

    return {
        addListener: addListener,
        removeListener: removeListener,
        start: start
    };
})();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

vAPI.domCollapser = (function() {
    var timer = null;
    var pendingRequests = Object.create(null);
    var roundtripRequests = [];
    var src1stProps = {
        'embed': 'src',
        'img': 'src',
        'object': 'data'
    };
    var src2ndProps = {
        'img': 'srcset'
    };
    var netSelectorCacheCount = 0;
    var messaging = vAPI.messaging;

    // Because a while ago I have observed constructors are faster than
    // literal object instanciations.
    var RoundtripRequest = function(tag, attr, url) {
        this.tag = tag;
        this.attr = attr;
        this.url = url;
        this.collapse = false;
    };

    var onProcessed = function(response) {
        // This can happens if uBO is restarted.
        if ( !response ) {
            return;
        }
        var requests = response.result;
        if ( requests === null || Array.isArray(requests) === false ) {
            return;
        }
        vAPI.executionCost.start();
        var selectors = [],
            netSelectorCacheCountMax = response.netSelectorCacheCountMax,
            aa = [ null ],
            request, key, entry, target, value;
        // Important: process in chronological order -- this ensures the
        // cached selectors are the most useful ones.
        for ( var i = 0, ni = requests.length; i < ni; i++ ) {
            request = requests[i];
            key = request.tag + ' ' + request.attr + ' ' + request.url;
            entry = pendingRequests[key];
            if ( entry === undefined ) {
                continue;
            }
            delete pendingRequests[key];
            // https://github.com/chrisaljoudi/uBlock/issues/869
            if ( !request.collapse ) {
                continue;
            }
            if ( Array.isArray(entry) === false ) {
                aa[0] = entry;
                entry = aa;
            }
            for ( var j = 0, nj = entry.length; j < nj; j++ ) {
                target = entry[j];
                // https://github.com/chrisaljoudi/uBlock/issues/399
                // Never remove elements from the DOM, just hide them
                target.style.setProperty('display', 'none', 'important');
                target.hidden = true;
                // https://github.com/chrisaljoudi/uBlock/issues/1048
                // Use attribute to construct CSS rule
                if (
                    netSelectorCacheCount <= netSelectorCacheCountMax &&
                    (value = target.getAttribute(request.attr))
                ) {
                    selectors.push(request.tag + '[' + request.attr + '="' + value + '"]');
                    netSelectorCacheCount += 1;
                }
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
        vAPI.executionCost.stop('domCollapser/onProcessed');
    };

    var send = function() {
        vAPI.executionCost.start();
        timer = null;
        // https://github.com/gorhill/uBlock/issues/1927
        // Normalize hostname to avoid trailing dot of FQHN.
        var pageHostname = window.location.hostname || '';
        if (
            pageHostname.length &&
            pageHostname.charCodeAt(pageHostname.length - 1) === 0x2e
        ) {
            pageHostname = pageHostname.slice(0, -1);
        }
        messaging.send(
            'contentscript',
            {
                what: 'filterRequests',
                pageURL: window.location.href,
                pageHostname: pageHostname,
                requests: roundtripRequests
            }, onProcessed
        );
        roundtripRequests = [];
        vAPI.executionCost.stop('domCollapser/send');
    };

    var process = function(delay) {
        if ( roundtripRequests.length === 0 ) {
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
        var tag = target.localName;
        var prop = src1stProps[tag];
        if ( prop === undefined ) {
            return;
        }
        // https://github.com/chrisaljoudi/uBlock/issues/174
        // Do not remove fragment from src URL
        var src = target[prop];
        if ( typeof src !== 'string' || src.length === 0 ) {
            prop = src2ndProps[tag];
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
        var key = tag + ' ' + prop + ' ' + src,
            entry = pendingRequests[key];
        if ( entry === undefined ) {
            pendingRequests[key] = target;
            roundtripRequests.push(new RoundtripRequest(tag, prop, src));
        } else if ( Array.isArray(entry) ) {
            entry.push(target);
        } else {
            pendingRequests[key] = [ entry, target ];
        }
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
        var key = 'iframe' + ' ' + 'src' + ' ' + src,
            entry = pendingRequests[key];
        if ( entry === undefined ) {
            pendingRequests[key] = iframe;
            roundtripRequests.push(new RoundtripRequest('iframe', 'src', src));
        } else if ( Array.isArray(entry) ) {
            entry.push(iframe);
        } else {
            pendingRequests[key] = [ entry, iframe ];
        }
    };

    var addIFrames = function(iframes) {
        var i = iframes.length;
        while ( i-- ) {
            addIFrame(iframes[i]);
        }
    };

    var onResourceFailed = function(ev) {
        vAPI.executionCost.start();
        vAPI.domCollapser.add(ev.target);
        vAPI.domCollapser.process();
        vAPI.executionCost.stop('domCollapser/onResourceFailed');
    };

    var domChangedHandler = function(nodes) {
        var node;
        for ( var i = 0, ni = nodes.length; i < ni; i++ ) {
            node = nodes[i];
            if ( node.localName === 'iframe' ) {
                addIFrame(node);
            }
            if ( node.children.length !== 0 ) {
                var iframes = node.getElementsByTagName('iframe');
                if ( iframes.length !== 0 ) {
                    addIFrames(iframes);
                }
            }
        }
        process();
    };

    var start = function() {
        // Listener to collapse blocked resources.
        // - Future requests not blocked yet
        // - Elements dynamically added to the page
        // - Elements which resource URL changes

        // https://github.com/chrisaljoudi/uBlock/issues/7
        // Preferring getElementsByTagName over querySelectorAll:
        //   http://jsperf.com/queryselectorall-vs-getelementsbytagname/145
        var elems = document.images || document.getElementsByTagName('img'),
            i = elems.length, elem;
        while ( i-- ) {
            elem = elems[i];
            if ( elem.complete ) {
                add(elem);
            }
        }
        addMany(document.embeds || document.getElementsByTagName('embed'));
        addMany(document.getElementsByTagName('object'));
        addIFrames(document.getElementsByTagName('iframe'));
        process(0);

        document.addEventListener('error', onResourceFailed, true);
        vAPI.domWatcher.addListener(domChangedHandler);

        vAPI.shutdown.add(function() {
            document.removeEventListener('error', onResourceFailed, true);
            vAPI.domWatcher.removeListener(domChangedHandler);
            if ( timer !== null ) {
                clearTimeout(timer);
            }
        });
    };

    return {
        add: add,
        addMany: addMany,
        addIFrame: addIFrame,
        addIFrames: addIFrames,
        process: process,
        start: start
    };
})();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

vAPI.domSurveyor = (function() {
    var domFilterer = null,
        messaging = vAPI.messaging,
        surveyPhase3Nodes = [],
        cosmeticSurveyingMissCount = 0,
        highGenerics = null,
        lowGenericSelectors = [],
        queriedSelectors = Object.create(null);

    // Handle main process' response.

    var surveyPhase3 = function(response) {
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
        } else {
            cosmeticSurveyingMissCount = 0;
        }

        domFilterer.commit(surveyPhase3Nodes);
        surveyPhase3Nodes = [];

        vAPI.executionCost.stop('domSurveyor/surveyPhase3');
    };

    // Query main process.

    var surveyPhase2 = function(addedNodes) {
        surveyPhase3Nodes = surveyPhase3Nodes.concat(addedNodes);
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
            nodeList = selectNodes('[' + attr + ']', surveyPhase3Nodes);
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
                    domFilterer.addSelector(selector);
                    continue;
                }
                // Candidate 2 = specific form
                selector = node.localName + selector;
                if ( generics.hasOwnProperty(selector) ) {
                    domFilterer.addSelector(selector);
                }
            }
        }
    };

    // High-medium generics:
    // - [href^="http"]

    var processHighMediumGenerics = function(generics) {
        var stagedNodes = surveyPhase3Nodes,
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
                    domFilterer.addSelector(entry);
                }
                continue;
            }
            j = entry.length;
            while ( j-- ) {
                selector = entry[j];
                if ( href.lastIndexOf(selector.slice(8, -2), 0) === 0 ) {
                    domFilterer.addSelector(selector);
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
                nodes = surveyPhase3Nodes,
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
            }
            highHighComplexGenericsCost += window.performance.now() - tstart;
        }
    };

    // Extract and return the staged nodes which (may) match the selectors.

    var selectNodes = function(selector, nodes) {
        var stagedNodes = nodes,
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

    var surveyPhase1 = function(addedNodes) {
        var nodes = selectNodes('[class],[id]', addedNodes);
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
        surveyPhase2(addedNodes);
    };

    var domChangedHandler = function(addedNodes, removedNodes) {
        if ( cosmeticSurveyingMissCount > 255 ) {
            vAPI.domWatcher.removeListener(domChangedHandler);
            vAPI.domSurveyor = null;
            domFilterer.domChangedHandler(addedNodes, removedNodes);
            domFilterer.start();
            return;
        }

        surveyPhase1(addedNodes);
        if ( removedNodes ) {
            domFilterer.checkStyleTags();
        }
    };

    var start = function() {
        domFilterer = vAPI.domFilterer;
        domChangedHandler([ document.documentElement ]);
        vAPI.domWatcher.addListener(domChangedHandler);
        vAPI.shutdown.add(function() {
            vAPI.domWatcher.removeListener(domChangedHandler);
        });
    };

    return {
        start: start
    };
})();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

vAPI.domIsLoaded = function(ev) {
    // This can happen on Firefox. For instance:
    // https://github.com/gorhill/uBlock/issues/1893
    if ( window.location === null ) {
        return;
    }

    var slowLoad = ev instanceof Event;
    if ( slowLoad ) {
        document.removeEventListener('DOMContentLoaded', vAPI.domIsLoaded);
    }
    vAPI.domIsLoaded = null;

    vAPI.executionCost.start();

    vAPI.domWatcher.start();
    vAPI.domCollapser.start();

    if ( vAPI.domFilterer ) {
        // https://github.com/chrisaljoudi/uBlock/issues/789
        // https://github.com/gorhill/uBlock/issues/873
        // Be sure our style tags used for cosmetic filtering are still
        // applied.
        vAPI.domFilterer.checkStyleTags();
        // To avoid neddless CPU overhead, we commit existing cosmetic filters
        // only if the page loaded "slowly", i.e. if the code here had to wait
        // for a DOMContentLoaded event -- in which case the DOM may have
        // changed a lot since last time the domFilterer acted on it.
        if ( slowLoad ) {
            vAPI.domFilterer.commit('all');
        }
        if ( vAPI.domSurveyor ) {
            vAPI.domSurveyor.start();
        } else {
            vAPI.domFilterer.start();
        }
    }

    // To send mouse coordinates to main process, as the chrome API fails
    // to provide the mouse position to context menu listeners.
    // https://github.com/chrisaljoudi/uBlock/issues/1143
    // Also, find a link under the mouse, to try to avoid confusing new tabs
    // as nuisance popups.
    // Ref.: https://developer.mozilla.org/en-US/docs/Web/Events/contextmenu

    var onMouseClick = function(ev) {
        var elem = ev.target;
        while ( elem !== null && elem.localName !== 'a' ) {
            elem = elem.parentElement;
        }
        vAPI.messaging.send(
            'contentscript',
            {
                what: 'mouseClick',
                x: ev.clientX,
                y: ev.clientY,
                url: elem !== null ? elem.href : ''
            }
        );
    };

    (function() {
        if ( window !== window.top || !vAPI.domFilterer ) {
            return;
        }
        document.addEventListener('mousedown', onMouseClick, true);

        // https://github.com/gorhill/uMatrix/issues/144
        vAPI.shutdown.add(function() {
            document.removeEventListener('mousedown', onMouseClick, true);
        });
    })();

    vAPI.executionCost.stop('domIsLoaded');
};

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

vAPI.executionCost.stop('contentscript.js');

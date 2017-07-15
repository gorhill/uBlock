/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2017 Raymond Hill

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

  The domFilterer makes use of platform-dependent user styles[1] code, or
  provide a default generic implementation if none is present.
  At time of writing, only modern Firefox provides a custom implementation,
  which makes for solid, reliable and low overhead cosmetic filtering on
  Firefox.
  The generic implementation[2] performs as best as can be, but won't ever be
  as reliable as real user styles.
  [1] "user styles" refer to local CSS rules which have priority over, and
      can't be overriden by a web page's own CSS rules.
  [2] below, see platformUserCSS / platformHideNode / platformUnhideNode

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

vAPI.matchesProp = (function() {
    var docElem = document.documentElement;
    if ( typeof docElem.matches !== 'function' ) {
        if ( typeof docElem.mozMatchesSelector === 'function' ) {
            return 'mozMatchesSelector';
        } else if ( typeof docElem.webkitMatchesSelector === 'function' ) {
            return 'webkitMatchesSelector';
        } else if ( typeof docElem.msMatchesSelector === 'function' ) {
            return 'msMatchesSelector';
        }
    }
    return 'matches';
})();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/2147

vAPI.SafeAnimationFrame = function(callback) {
    this.fid = this.tid = null;
    this.callback = callback;
};

vAPI.SafeAnimationFrame.prototype.start = function() {
    if ( this.fid !== null ) { return; }
    this.fid = requestAnimationFrame(this.callback);
    this.tid = vAPI.setTimeout(this.callback, 1200000);
};

vAPI.SafeAnimationFrame.prototype.clear = function() {
    if ( this.fid === null ) { return; }
    cancelAnimationFrame(this.fid);
    clearTimeout(this.tid);
    this.fid = this.tid = null;
};

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// The DOM filterer is the heart of uBO's cosmetic filtering.

vAPI.domFilterer = (function() {

/******************************************************************************/

var allExceptions = new Set(),
    allSelectors = new Set(),
    stagedNodes = [];

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

// If a platform does not support its own vAPI.userCSS (user styles), we
// provide a default (imperfect) implementation.

// Probably no longer need to watch for style tags removal/tampering with fix
// to https://github.com/gorhill/uBlock/issues/963

var platformUserCSS = (function() {
    if ( vAPI.userCSS instanceof Object ) {
        return vAPI.userCSS;
    }

    return {
        enabled: true,
        styles: [],
        add: function(css) {
            var style = document.createElement('style');
            style.setAttribute('type', 'text/css');
            style.textContent = css;
            if ( document.head ) {
                document.head.appendChild(style);
            }
            this.styles.push(style);
            if ( style.sheet ) {
                style.sheet.disabled = !this.enabled;
            }
        },
        remove: function(css) {
            var i = this.styles.length,
                style, parent;
            while ( i-- ) {
                style = this.styles[i];
                if ( style.textContent !== css ) { continue; }
                parent = style.parentNode;
                if ( parent !== null ) {
                    parent.removeChild(style);
                }
                this.styles.splice(i, 1);
            }
        },
        toggle: function(state) {
            if ( this.styles.length === '' ) { return; }
            if ( state === undefined ) {
                state = !this.enabled;
            }
            var i = this.styles.length, style;
            while ( i-- ) {
                style = this.styles[i];
                if ( style.sheet !== null ) {
                    style.sheet.disabled = !state;
                }
            }
            this.enabled = state;
        }
    };
})();

// If a platform does not provide its own (improved) vAPI.hideNode, we assign
// a default one to try to override author styles as best as can be.

var platformHideNode = vAPI.hideNode,
    platformUnhideNode = vAPI.unhideNode;

(function() {
    if ( platformHideNode instanceof Function ) {
        return;
    }

    var uid,
        timer,
        observer,
        changedNodes = new Set(),
        observerOptions = {
            attributes: true,
            attributeFilter: [ 'style' ]
        };

    // https://jsperf.com/clientheight-and-clientwidth-vs-getcomputedstyle
    //   Avoid getComputedStyle(), detecting whether a node is visible can be
    //   achieved with clientWidth/clientHeight.
    // https://gist.github.com/paulirish/5d52fb081b3570c81e3a
    //   Do not interleave read-from/write-to the DOM. Write-to DOM
    //   operations would cause the first read-from to be expensive, and
    //   interleaving means that potentially all single read-from operation
    //   would be expensive rather than just the 1st one.
    //   Benchmarking toggling off/on cosmetic filtering confirms quite an
    //   improvement when:
    //   - batching as much as possible handling of all nodes;
    //   - avoiding to interleave read-from/write-to operations.
    //   However, toggling off/on cosmetic filtering repeatedly is not
    //   a real use case, but this shows this will help performance
    //   on sites which try to use inline styles to bypass blockers.
    var batchProcess = function() {
        timer.clear();
        var uid_ = uid;
        for ( var node of changedNodes ) {
            if (
                node[uid_] === undefined ||
                node.clientHeight === 0 || node.clientWidth === 0
            ) {
                continue;
            }
            var attr = node.getAttribute('style');
            if ( attr === null ) {
                attr = '';
            } else if (
                attr.length !== 0 &&
                attr.charCodeAt(attr.length - 1) !== 0x3B /* ';' */
            ) {
                attr += '; ';
            }
            node.setAttribute('style', attr + 'display: none !important;');
        }
        changedNodes.clear();
    };

    var observerHandler = function(mutations) {
        var i = mutations.length,
            changedNodes_ = changedNodes;
        while ( i-- ) {
            changedNodes_.add(mutations[i].target);
        }
        timer.start();
    };

    platformHideNode = function(node) {
        if ( uid === undefined ) {
            uid = vAPI.randomToken();
            timer = new vAPI.SafeAnimationFrame(batchProcess);
        }
        if ( node[uid] === undefined ) {
            node[uid] = node.hasAttribute('style') && (node.getAttribute('style') || '');
        }
        // Performance: batch-process nodes to hide.
        changedNodes.add(node);
        timer.start();
        if ( observer === undefined ) {
            observer = new MutationObserver(observerHandler);
        }
        observer.observe(node, observerOptions);
    };

    platformUnhideNode = function(node) {
        if ( uid === undefined ) { return; }
        var attr = node[uid];
        if ( attr === false ) {
            node.removeAttribute('style');
        } else if ( typeof attr === 'string' ) {
            node.setAttribute('style', attr);
        }
        delete node[uid];
    };
})();

/******************************************************************************/

// 'P' stands for 'Procedural'

var PSelectorHasTask = function(task) {
    this.selector = task[1];
};
PSelectorHasTask.prototype.exec = function(input) {
    var output = [];
    for ( var i = 0, n = input.length; i < n; i++ ) {
        if ( input[i].querySelector(this.selector) !== null ) {
            output.push(input[i]);
        }
    }
    return output;
};

var PSelectorHasTextTask = function(task) {
    this.needle = new RegExp(task[1]);
};
PSelectorHasTextTask.prototype.exec = function(input) {
    var output = [];
    for ( var i = 0, n = input.length; i < n; i++ ) {
        if ( this.needle.test(input[i].textContent) ) {
            output.push(input[i]);
        }
    }
    return output;
};

var PSelectorIfTask = function(task) {
    this.pselector = new PSelector(task[1]);
};
PSelectorIfTask.prototype.target = true;
PSelectorIfTask.prototype.exec = function(input) {
    var output = [];
    for ( var i = 0, n = input.length; i < n; i++ ) {
        if ( this.pselector.test(input[i]) === this.target ) {
            output.push(input[i]);
        }
    }
    return output;
};

var PSelectorIfNotTask = function(task) {
    PSelectorIfTask.call(this, task);
    this.target = false;
};
PSelectorIfNotTask.prototype = Object.create(PSelectorIfTask.prototype);
PSelectorIfNotTask.prototype.constructor = PSelectorIfNotTask;

var PSelectorMatchesCSSTask = function(task) {
    this.name = task[1].name;
    this.value = new RegExp(task[1].value);
};
PSelectorMatchesCSSTask.prototype.pseudo = null;
PSelectorMatchesCSSTask.prototype.exec = function(input) {
    var output = [], style;
    for ( var i = 0, n = input.length; i < n; i++ ) {
        style = window.getComputedStyle(input[i], this.pseudo);
        if ( style === null ) { return null; } /* FF */
        if ( this.value.test(style[this.name]) ) {
            output.push(input[i]);
        }
    }
    return output;
};

var PSelectorMatchesCSSAfterTask = function(task) {
    PSelectorMatchesCSSTask.call(this, task);
    this.pseudo = ':after';
};
PSelectorMatchesCSSAfterTask.prototype = Object.create(PSelectorMatchesCSSTask.prototype);
PSelectorMatchesCSSAfterTask.prototype.constructor = PSelectorMatchesCSSAfterTask;

var PSelectorMatchesCSSBeforeTask = function(task) {
    PSelectorMatchesCSSTask.call(this, task);
    this.pseudo = ':before';
};
PSelectorMatchesCSSBeforeTask.prototype = Object.create(PSelectorMatchesCSSTask.prototype);
PSelectorMatchesCSSBeforeTask.prototype.constructor = PSelectorMatchesCSSBeforeTask;

var PSelectorXpathTask = function(task) {
    this.xpe = document.createExpression(task[1], null);
    this.xpr = null;
};
PSelectorXpathTask.prototype.exec = function(input) {
    var output = [], j, node;
    for ( var i = 0, n = input.length; i < n; i++ ) {
        this.xpr = this.xpe.evaluate(
            input[i],
            XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
            this.xpr
        );
        j = this.xpr.snapshotLength;
        while ( j-- ) {
            node = this.xpr.snapshotItem(j);
            if ( node.nodeType === 1 ) {
                output.push(node);
            }
        }
    }
    return output;
};

var PSelector = function(o) {
    if ( PSelector.prototype.operatorToTaskMap === undefined ) {
        PSelector.prototype.operatorToTaskMap = new Map([
            [ ':has', PSelectorHasTask ],
            [ ':has-text', PSelectorHasTextTask ],
            [ ':if', PSelectorIfTask ],
            [ ':if-not', PSelectorIfNotTask ],
            [ ':matches-css', PSelectorMatchesCSSTask ],
            [ ':matches-css-after', PSelectorMatchesCSSAfterTask ],
            [ ':matches-css-before', PSelectorMatchesCSSBeforeTask ],
            [ ':xpath', PSelectorXpathTask ]
        ]);
    }
    this.raw = o.raw;
    this.selector = o.selector;
    this.tasks = [];
    var tasks = o.tasks;
    if ( !tasks ) { return; }
    for ( var i = 0, task, ctor; i < tasks.length; i++ ) {
        task = tasks[i];
        ctor = this.operatorToTaskMap.get(task[0]);
        this.tasks.push(new ctor(task));
    }
};
PSelector.prototype.operatorToTaskMap = undefined;
PSelector.prototype.prime = function(input) {
    var root = input || document;
    if ( this.selector !== '' ) {
        return root.querySelectorAll(this.selector);
    }
    return [ root ];
};
PSelector.prototype.exec = function(input) {
    //var t0 = window.performance.now();
    var tasks = this.tasks, nodes = this.prime(input);
    for ( var i = 0, n = tasks.length; i < n && nodes.length !== 0; i++ ) {
        nodes = tasks[i].exec(nodes);
    }
    //console.log('%s: %s ms', this.raw, (window.performance.now() - t0).toFixed(2));
    return nodes;
};
PSelector.prototype.test = function(input) {
    //var t0 = window.performance.now();
    var tasks = this.tasks, nodes = this.prime(input), AA = [ null ], aa;
    for ( var i = 0, ni = nodes.length; i < ni; i++ ) {
        AA[0] = nodes[i]; aa = AA;
        for ( var j = 0, nj = tasks.length; j < nj && aa.length !== 0; j++ ) {
            aa = tasks[j].exec(aa);
        }
        if ( aa.length !== 0 ) { return true; }
    }
    //console.log('%s: %s ms', this.raw, (window.performance.now() - t0).toFixed(2));
    return false;
};

/******************************************************************************/

var domFilterer = {
    addedNodesHandlerMissCount: 0,
    commitTimer: null,
    disabledId: vAPI.randomToken(),
    enabled: true,
    excludeId: undefined,
    hiddenId: vAPI.randomToken(),
    hiddenNodeCount: 0,
    hiddenNodeEnforcer: false,
    loggerEnabled: undefined,

    newHideSelectorBuffer: [], // Hide style filter buffer
    newStyleRuleBuffer: [],    // Non-hide style filter buffer
    simpleHideSelectors: {     // Hiding filters: simple selectors
        entries: [],
        matchesProp: vAPI.matchesProp,
        selector: undefined,
        add: function(selector) {
            this.entries.push(selector);
            this.selector = undefined;
        },
        forEachNode: function(callback, root, extra) {
            if ( this.selector === undefined ) {
                this.selector = this.entries.join(extra + ',') + extra;
            }
            if ( root[this.matchesProp](this.selector) ) {
                callback(root);
            }
            var nodes = root.querySelectorAll(this.selector),
                i = nodes.length;
            while ( i-- ) {
                callback(nodes[i]);
            }
        }
    },
    complexHideSelectors: {    // Hiding filters: complex selectors
        entries: [],
        selector: undefined,
        add: function(selector) {
            this.entries.push(selector);
            this.selector = undefined;
        },
        forEachNode: function(callback) {
            if ( this.selector === undefined ) {
                this.selector = this.entries.join(',');
            }
            var nodes = document.querySelectorAll(this.selector),
                i = nodes.length;
            while ( i-- ) {
                callback(nodes[i]);
            }
        }
    },
    nqsSelectors: [],          // Non-querySelector-able filters
    proceduralSelectors: {     // Hiding filters: procedural
        entries: [],
        add: function(o) {
            this.entries.push(new PSelector(o));
        },
        forEachNode: function(callback) {
            var pfilters = this.entries, i = pfilters.length, pfilter, nodes, j;
            while ( i-- ) {
                pfilter = pfilters[i];
                nodes = pfilter.exec();
                j = nodes.length;
                while ( j-- ) {
                    callback(nodes[j], pfilter);
                }
            }
        }
    },

    addExceptions: function(aa) {
        for ( var i = 0, n = aa.length; i < n; i++ ) {
            allExceptions.add(aa[i]);
        }
    },

    addSelector: function(selector) {
        if ( allSelectors.has(selector) || allExceptions.has(selector) ) {
            return;
        }
        allSelectors.add(selector);
        if ( selector.charCodeAt(0) !== 0x7B /* '{' */ ) {
            this.newHideSelectorBuffer.push(selector);
            if ( selector.indexOf(' ') === -1 ) {
                this.simpleHideSelectors.add(selector);
            } else {
                this.complexHideSelectors.add(selector);
            }
            return;
        }
        var o = JSON.parse(selector);
        if ( o.style ) {
            this.newStyleRuleBuffer.push(o.style.join(' '));
            this.nqsSelectors.push(o.raw);
            return;
        }
        if ( o.pseudoclass ) {
            this.newHideSelectorBuffer.push(o.raw);
            this.nqsSelectors.push(o.raw);
            return;
        }
        if ( o.tasks ) {
            this.proceduralSelectors.add(o);
            return;
        }
    },

    addSelectors: function(aa) {
        for ( var i = 0, n = aa.length; i < n; i++ ) {
            this.addSelector(aa[i]);
        }
    },

    commit_: function() {
        this.commitTimer.clear();

        var beforeHiddenNodeCount = this.hiddenNodeCount,
            styleText = '';

        // CSS rules/hide
        if ( this.newHideSelectorBuffer.length ) {
            styleText = '\n:root ' + this.newHideSelectorBuffer.join(',\n:root ') + '\n{ display: none !important; }';
            this.newHideSelectorBuffer.length = 0;
        }

        // CSS rules/any css declaration
        if ( this.newStyleRuleBuffer.length ) {
            styleText += '\n' + this.newStyleRuleBuffer.join('\n');
            this.newStyleRuleBuffer.length = 0;
        }

        // Simple selectors: incremental.

        // Simple css selectors/hide
        if ( this.simpleHideSelectors.entries.length ) {
            var i = stagedNodes.length;
            while ( i-- ) {
                this.simpleHideSelectors.forEachNode(hideNode, stagedNodes[i], cssNotHiddenId);
            }
        }
        stagedNodes = [];

        // Complex selectors: non-incremental.
        complexSelectorsOldResultSet = complexSelectorsCurrentResultSet;
        complexSelectorsCurrentResultSet = new Set();

        // Complex css selectors/hide
        // The handling of these can be considered optional, since they are
        // also applied declaratively using a style tag.
        if ( this.complexHideSelectors.entries.length ) {
            this.complexHideSelectors.forEachNode(complexHideNode);
        }

        // Procedural cosmetic filters
        if ( this.proceduralSelectors.entries.length ) {
            this.proceduralSelectors.forEachNode(complexHideNode);
        }

        // https://github.com/gorhill/uBlock/issues/1912
        //   If one or more nodes have been manually hidden, insert a style tag
        //   targeting these manually hidden nodes. For browsers supporting
        //   user styles, this allows uBO to win.
        var commitHit = this.hiddenNodeCount !== beforeHiddenNodeCount;
        if ( commitHit ) {
            if ( this.hiddenNodeEnforcer === false ) {
                styleText += '\n:root *[' + this.hiddenId + '][hidden] { display: none !important; }';
                this.hiddenNodeEnforcer = true;
            }
            this.addedNodesHandlerMissCount = 0;
        } else {
            this.addedNodesHandlerMissCount += 1;
        }

        if ( styleText !== '' ) {
            platformUserCSS.add(styleText);
        }

        // Un-hide nodes previously hidden.
        for ( var node of complexSelectorsOldResultSet ) {
            this.unhideNode(node);
        }
        complexSelectorsOldResultSet.clear();

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
    },

    commit: function(nodes, commitNow) {
        if ( nodes === 'all' ) {
            stagedNodes = [ document.documentElement ];
        } else if ( stagedNodes[0] !== document.documentElement ) {
            stagedNodes = stagedNodes.concat(nodes);
        }
        if ( commitNow ) {
            this.commitTimer.clear();
            this.commit_();
            return;
        }
        this.commitTimer.start();
    },

    createProceduralFilter: function(o) {
        return new PSelector(o);
    },

    getExcludeId: function() {
        if ( this.excludeId === undefined ) {
            this.excludeId = vAPI.randomToken();
        }
        return this.excludeId;
    },

    hideNode: function(node) {
        if ( node[this.hiddenId] !== undefined ) { return; }
        if ( this.excludeId !== undefined && node[this.excludeId] ) { return; }
        node.setAttribute(this.hiddenId, '');
        this.hiddenNodeCount += 1;
        node.hidden = true;
        node[this.hiddenId] = null;
        platformHideNode(node);
    },

    init: function() {
        this.commitTimer = new vAPI.SafeAnimationFrame(this.commit_.bind(this));
    },

    showNode: function(node) {
        node.hidden = false;
        platformUnhideNode(node);
    },

    toggleLogging: function(state) {
        this.loggerEnabled = state;
    },

    toggleOff: function() {
        platformUserCSS.toggle(false);
        this.enabled = false;
    },

    toggleOn: function() {
        platformUserCSS.toggle(true);
        this.enabled = true;
    },

    userCSS: platformUserCSS,

    unhideNode: function(node) {
        if ( node[this.hiddenId] !== undefined ) {
            this.hiddenNodeCount--;
        }
        node.removeAttribute(this.hiddenId);
        node[this.hiddenId] = undefined;
        node.hidden = false;
        platformUnhideNode(node);
    },

    unshowNode: function(node) {
        node.hidden = true;
        platformHideNode(node);
    },

    domChangedHandler: function(addedNodes) {
        this.commit(addedNodes);
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

var cssNotHiddenId = ':not([' + domFilterer.hiddenId + '])';

domFilterer.init();

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
            (new vAPI.SafeAnimationFrame(vAPI.domIsLoaded)).start();
        } else {
            document.addEventListener('DOMContentLoaded', vAPI.domIsLoaded);
        }
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
        listeners = [];

    var safeObserverHandler = function() {
        safeObserverHandlerTimer.clear();
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
            listeners[0](addedNodes);
            if ( listeners[1] ) {
                listeners[1](addedNodes);
            }
            addedNodes.length = 0;
            removedNodes = false;
        }
    };

    var safeObserverHandlerTimer = new vAPI.SafeAnimationFrame(safeObserverHandler);

    // https://github.com/chrisaljoudi/uBlock/issues/205
    // Do not handle added node directly from within mutation observer.
    var observerHandler = function(mutations) {
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
        if ( addedNodeLists.length !== 0 || removedNodes ) {
            safeObserverHandlerTimer.start();
        }
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
            safeObserverHandlerTimer.clear();
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
        var selectors = [],
            netSelectorCacheCountMax = response.netSelectorCacheCountMax,
            aa = [ null ],
            request, key, entry, target, value;
        // https://github.com/gorhill/uBlock/issues/2256
        var iframeLoadEventPatch = vAPI.iframeLoadEventPatch;
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
                if ( iframeLoadEventPatch ) { iframeLoadEventPatch(target); }
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
    };

    var send = function() {
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
        vAPI.domCollapser.add(ev.target);
        vAPI.domCollapser.process();
    };

    var domChangedHandler = function(nodes) {
        var node;
        for ( var i = 0, ni = nodes.length; i < ni; i++ ) {
            node = nodes[i];
            if ( node.localName === 'iframe' ) {
                addIFrame(node);
            }
            if ( node.childElementCount !== 0 ) {
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
        queriedSelectors = new Set(),
        surveyCost = 0;

    // Handle main process' response.

    var surveyPhase3 = function(response) {
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
            var t0 = window.performance.now();
            if ( highGenerics.hideLowCount ) {
                processHighLowGenerics(highGenerics.hideLow);
            }
            if ( highGenerics.hideMediumCount ) {
                processHighMediumGenerics(highGenerics.hideMedium);
            }
            if ( highGenerics.hideHighSimpleCount || highGenerics.hideHighComplexCount ) {
                processHighHighGenerics();
            }
            surveyCost += window.performance.now() - t0;
        }

        // Need to do this before committing DOM filterer, as needed info
        // will no longer be there after commit.
        if ( firstSurvey || domFilterer.newHideSelectorBuffer.length ) {
            messaging.send(
                'contentscript',
                {
                    what: 'cosmeticFiltersInjected',
                    type: 'cosmetic',
                    hostname: window.location.hostname,
                    selectors: domFilterer.newHideSelectorBuffer,
                    first: firstSurvey,
                    cost: surveyCost
                }
            );
        }

        // Shutdown surveyor if too many consecutive empty resultsets.
        if ( domFilterer.newHideSelectorBuffer.length === 0 ) {
            cosmeticSurveyingMissCount += 1;
        } else {
            cosmeticSurveyingMissCount = 0;
        }

        domFilterer.commit(surveyPhase3Nodes);
        surveyPhase3Nodes = [];
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
        var t0 = window.performance.now(),
            rews = reWhitespace,
            qq = queriedSelectors,
            ll = lowGenericSelectors,
            lli = ll.length,
            nodes, i, node, v, vv, j;
        nodes = selectNodes('[id]', addedNodes);
        i = nodes.length;
        while ( i-- ) {
            node = nodes[i];
            v = node.id;
            if ( typeof v !== 'string' ) { continue; }
            v = '#' + v.trim();
            if ( !qq.has(v) && v.length !== 1 ) {
                ll[lli] = v; lli++; qq.add(v);
            }
        }
        nodes = selectNodes('[class]', addedNodes);
        i = nodes.length;
        while ( i-- ) {
            node = nodes[i];
            vv = node.className;
            if ( typeof vv !== 'string' ) { continue; }
            if ( !rews.test(vv) ) {
                v = '.' + vv;
                if ( !qq.has(v) && v.length !== 1 ) {
                    ll[lli] = v; lli++; qq.add(v);
                }
            } else {
                vv = node.classList;
                j = vv.length;
                while ( j-- ) {
                    v = '.' + vv[j];
                    if ( !qq.has(v) ) {
                        ll[lli] = v; lli++; qq.add(v);
                    }
                }
            }
        }
        surveyCost += window.performance.now() - t0;
        surveyPhase2(addedNodes);
    };
    var reWhitespace = /\s/;

    var domChangedHandler = function(addedNodes) {
        if ( cosmeticSurveyingMissCount > 255 ) {
            vAPI.domWatcher.removeListener(domChangedHandler);
            vAPI.domSurveyor = null;
            domFilterer.domChangedHandler(addedNodes);
            domFilterer.start();
            return;
        }

        surveyPhase1(addedNodes);
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

    vAPI.domWatcher.start();
    vAPI.domCollapser.start();

    if ( vAPI.domFilterer ) {
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
};

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

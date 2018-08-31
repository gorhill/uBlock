/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2018 Raymond Hill

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

              +--> domCollapser
              |
              |
  domWatcher--+
              |                  +-- domSurveyor
              |                  |
              +--> domFilterer --+-- domLogger
                                 |
                                 +-- domInspector

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

  domLogger:
    Surveys the page to find and report the injected cosmetic filters blocking
    actual elements on the current page. This component is dynamically loaded
    IF AND ONLY IF uBO's logger is opened.

  If page is whitelisted:
    - domWatcher: off
    - domCollapser: off
    - domFilterer: off
    - domSurveyor: off
    - domLogger: off

  I verified that the code in this file is completely flushed out of memory
  when a page is whitelisted.

  If cosmetic filtering is disabled:
    - domWatcher: on
    - domCollapser: on
    - domFilterer: off
    - domSurveyor: off
    - domLogger: off

  If generic cosmetic filtering is disabled:
    - domWatcher: on
    - domCollapser: on
    - domFilterer: on
    - domSurveyor: off
    - domLogger: on if uBO logger is opened

  If generic cosmetic filtering is enabled:
    - domWatcher: on
    - domCollapser: on
    - domFilterer: on
    - domSurveyor: on
    - domLogger: on if uBO logger is opened

  Additionally, the domSurveyor can turn itself off once it decides that
  it has become pointless (repeatedly not finding new cosmetic filters).

  The domFilterer makes use of platform-dependent user stylesheets[1].

  At time of writing, only modern Firefox provides a custom implementation,
  which makes for solid, reliable and low overhead cosmetic filtering on
  Firefox.

  The generic implementation[2] performs as best as can be, but won't ever be
  as reliable and accurate as real user stylesheets.

  [1] "user stylesheets" refer to local CSS rules which have priority over,
       and can't be overriden by a web page's own CSS rules.
  [2] below, see platformUserCSS / platformHideNode / platformUnhideNode

*/

// Abort execution if our global vAPI object does not exist.
//   https://github.com/chrisaljoudi/uBlock/issues/456
//   https://github.com/gorhill/uBlock/issues/2029

if ( typeof vAPI === 'object' && !vAPI.contentScript ) { // >>>>>>>> start of HUGE-IF-BLOCK

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

vAPI.contentScript = true;

/******************************************************************************/
/******************************************************************************/
/*******************************************************************************

  The purpose of SafeAnimationFrame is to take advantage of the behavior of
  window.requestAnimationFrame[1]. If we use an animation frame as a timer,
  then this timer is described as follow:

  - time events are throttled by the browser when the viewport is not visible --
    there is no point for uBO to play with the DOM if the document is not
    visible.
  - time events are micro tasks[2].
  - time events are synchronized to monitor refresh, meaning that they can fire
    at most 1/60 (typically).

  If a delay value is provided, a plain timer is first used. Plain timers are
  macro-tasks, so this is good when uBO wants to yield to more important tasks
  on a page. Once the plain timer elapse, an animation frame is used to trigger
  the next time at which to execute the job.

  [1] https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame
  [2] https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/

*/

// https://github.com/gorhill/uBlock/issues/2147

vAPI.SafeAnimationFrame = function(callback) {
    this.fid = this.tid = null;
    this.callback = callback;
    this.boundMacroToMicro = this.macroToMicro.bind(this);
};

vAPI.SafeAnimationFrame.prototype = {
    start: function(delay) {
        if ( delay === undefined ) {
            if ( this.fid === null ) {
                this.fid = requestAnimationFrame(this.callback);
            }
            if ( this.tid === null ) {
                this.tid = vAPI.setTimeout(this.callback, 20000);
            }
            return;
        }
        if ( this.fid === null && this.tid === null ) {
            this.tid = vAPI.setTimeout(this.boundMacroToMicro, delay);
        }
    },
    clear: function() {
        if ( this.fid !== null ) { cancelAnimationFrame(this.fid); }
        if ( this.tid !== null ) { clearTimeout(this.tid); }
        this.fid = this.tid = null;
    },
    macroToMicro: function() {
        this.tid = null;
        this.start();
    }
};

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

vAPI.domWatcher = (function() {

    var addedNodeLists = [],
        addedNodes = [],
        domIsReady = false,
        domLayoutObserver,
        ignoreTags = new Set([ 'br', 'head', 'link', 'meta', 'script', 'style' ]),
        listeners = [],
        listenerIterator = [], listenerIteratorDirty = false,
        removedNodeLists = [],
        removedNodes = false,
        safeObserverHandlerTimer;

    var safeObserverHandler = function() {
        //console.time('dom watcher/safe observer handler');
        safeObserverHandlerTimer.clear();
        var i = addedNodeLists.length,
            j = addedNodes.length,
            nodeList, iNode, node;
        while ( i-- ) {
            nodeList = addedNodeLists[i];
            iNode = nodeList.length;
            while ( iNode-- ) {
                node = nodeList[iNode];
                if ( node.nodeType !== 1 ) { continue; }
                if ( ignoreTags.has(node.localName) ) { continue; }
                if ( node.parentElement === null ) { continue; }
                addedNodes[j++] = node;
            }
        }
        addedNodeLists.length = 0;
        i = removedNodeLists.length;
        while ( i-- && removedNodes === false ) {
            nodeList = removedNodeLists[i];
            iNode = nodeList.length;
            while ( iNode-- ) {
                if ( nodeList[iNode].nodeType !== 1 ) { continue; }
                removedNodes = true;
                break;
            }
        }
        removedNodeLists.length = 0;
        //console.timeEnd('dom watcher/safe observer handler');
        if ( addedNodes.length === 0 && removedNodes === false ) { return; }
        for ( var listener of getListenerIterator() ) {
            listener.onDOMChanged(addedNodes, removedNodes);
        }
        addedNodes.length = 0;
        removedNodes = false;
    };

    // https://github.com/chrisaljoudi/uBlock/issues/205
    // Do not handle added node directly from within mutation observer.
    var observerHandler = function(mutations) {
        //console.time('dom watcher/observer handler');
        var nodeList, mutation,
            i = mutations.length;
        while ( i-- ) {
            mutation = mutations[i];
            nodeList = mutation.addedNodes;
            if ( nodeList.length !== 0 ) {
                addedNodeLists.push(nodeList);
            }
            if ( removedNodes ) { continue; }
            nodeList = mutation.removedNodes;
            if ( nodeList.length !== 0 ) {
                removedNodeLists.push(nodeList);
            }
        }
        if ( addedNodeLists.length !== 0 || removedNodes ) {
            safeObserverHandlerTimer.start(
                addedNodeLists.length < 100 ? 1 : undefined
            );
        }
        //console.timeEnd('dom watcher/observer handler');
    };

    var startMutationObserver = function() {
        if ( domLayoutObserver !== undefined || !domIsReady ) { return; }
        domLayoutObserver = new MutationObserver(observerHandler);
        domLayoutObserver.observe(document.documentElement, {
            //attributeFilter: [ 'class', 'id' ],
            //attributes: true,
            childList: true,
            subtree: true
        });
        safeObserverHandlerTimer = new vAPI.SafeAnimationFrame(safeObserverHandler);
        vAPI.shutdown.add(cleanup);
    };

    var stopMutationObserver = function() {
        if ( domLayoutObserver === undefined ) { return; }
        cleanup();
        vAPI.shutdown.remove(cleanup);
    };

    var getListenerIterator = function() {
        if ( listenerIteratorDirty ) {
            listenerIterator = listeners.slice();
            listenerIteratorDirty = false;
        }
        return listenerIterator;
    };

    var addListener = function(listener) {
        if ( listeners.indexOf(listener) !== -1 ) { return; }
        listeners.push(listener);
        listenerIteratorDirty = true;
        if ( domIsReady !== true ) { return; }
        listener.onDOMCreated();
        startMutationObserver();
    };

    var removeListener = function(listener) {
        var pos = listeners.indexOf(listener);
        if ( pos === -1 ) { return; }
        listeners.splice(pos, 1);
        listenerIteratorDirty = true;
        if ( listeners.length === 0 ) {
            stopMutationObserver();
        }
    };

    var cleanup = function() {
        if ( domLayoutObserver !== undefined ) {
            domLayoutObserver.disconnect();
            domLayoutObserver = null;
        }
        if ( safeObserverHandlerTimer !== undefined ) {
            safeObserverHandlerTimer.clear();
            safeObserverHandlerTimer = undefined;
        }
    };

    var start = function() {
        domIsReady = true;
        for ( var listener of getListenerIterator() ) {
            listener.onDOMCreated();
        }
        startMutationObserver();
    };

    return {
        start: start,
        addListener: addListener,
        removeListener: removeListener
    };
})();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

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

vAPI.injectScriptlet = function(doc, text) {
    if ( !doc ) { return; }
    let script;
    try {
        script = doc.createElement('script');
        script.appendChild(doc.createTextNode(text));
        (doc.head || doc.documentElement).appendChild(script);
    } catch (ex) {
    }
    if ( script ) {
        if ( script.parentNode ) {
            script.parentNode.removeChild(script);
        }
        script.textContent = '';
    }
};

/******************************************************************************/
/******************************************************************************/
/*******************************************************************************

  The DOM filterer is the heart of uBO's cosmetic filtering.

  DOMBaseFilterer: platform-specific
  |
  |
  +---- DOMFilterer: adds procedural cosmetic filtering

*/

vAPI.DOMFilterer = (function() {

    // 'P' stands for 'Procedural'

    var PSelectorHasTextTask = function(task) {
        var arg0 = task[1], arg1;
        if ( Array.isArray(task[1]) ) {
            arg1 = arg0[1]; arg0 = arg0[0];
        }
        this.needle = new RegExp(arg0, arg1);
    };
    PSelectorHasTextTask.prototype.exec = function(input) {
        var output = [];
        for ( var node of input ) {
            if ( this.needle.test(node.textContent) ) {
                output.push(node);
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
        for ( var node of input ) {
            if ( this.pselector.test(node) === this.target ) {
                output.push(node);
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
        var arg0 = task[1].value, arg1;
        if ( Array.isArray(arg0) ) {
            arg1 = arg0[1]; arg0 = arg0[0];
        }
        this.value = new RegExp(arg0, arg1);
    };
    PSelectorMatchesCSSTask.prototype.pseudo = null;
    PSelectorMatchesCSSTask.prototype.exec = function(input) {
        var output = [], style;
        for ( var node of input ) {
            style = window.getComputedStyle(node, this.pseudo);
            if ( style === null ) { return null; } /* FF */
            if ( this.value.test(style[this.name]) ) {
                output.push(node);
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
        var output = [], j;
        for ( var node of input ) {
            this.xpr = this.xpe.evaluate(
                node,
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
                [ ':has', PSelectorIfTask ],
                [ ':has-text', PSelectorHasTextTask ],
                [ ':if', PSelectorIfTask ],
                [ ':if-not', PSelectorIfNotTask ],
                [ ':matches-css', PSelectorMatchesCSSTask ],
                [ ':matches-css-after', PSelectorMatchesCSSAfterTask ],
                [ ':matches-css-before', PSelectorMatchesCSSBeforeTask ],
                [ ':xpath', PSelectorXpathTask ]
            ]);
        }
        this.budget = 200; // I arbitrary picked a 1/5 second
        this.raw = o.raw;
        this.cost = 0;
        this.lastAllowanceTime = 0;
        this.selector = o.selector;
        this.tasks = [];
        var tasks = o.tasks;
        if ( !tasks ) { return; }
        for ( var task of tasks ) {
            this.tasks.push(new (this.operatorToTaskMap.get(task[0]))(task));
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
        var nodes = this.prime(input);
        for ( var task of this.tasks ) {
            if ( nodes.length === 0 ) { break; }
            nodes = task.exec(nodes);
        }
        return nodes;
    };
    PSelector.prototype.test = function(input) {
        var nodes = this.prime(input), AA = [ null ], aa;
        for ( var node of nodes ) {
            AA[0] = node; aa = AA;
            for ( var task of this.tasks ) {
                aa = task.exec(aa);
                if ( aa.length === 0 ) { break; }
            }
            if ( aa.length !== 0 ) { return true; }
        }
        return false;
    };

    var DOMProceduralFilterer = function(domFilterer) {
        this.domFilterer = domFilterer;
        this.domIsReady = false;
        this.domIsWatched = false;
        this.addedSelectors = new Map();
        this.addedNodes = false;
        this.removedNodes = false;
        this.selectors = new Map();
    };

    DOMProceduralFilterer.prototype = {

        addProceduralSelectors: function(aa) {
            var raw, o, pselector,
                mustCommit = this.domIsWatched;
            for ( var i = 0, n = aa.length; i < n; i++ ) {
                raw = aa[i];
                o = JSON.parse(raw);
                if ( o.style ) {
                    this.domFilterer.addCSSRule(o.style[0], o.style[1]);
                    mustCommit = true;
                    continue;
                }
                if ( o.pseudoclass ) {
                    this.domFilterer.addCSSRule(
                        o.raw,
                        'display:none!important;'
                    );
                    mustCommit = true;
                    continue;
                }
                if ( o.tasks ) {
                    if ( this.selectors.has(raw) === false ) {
                        pselector = new PSelector(o);
                        this.selectors.set(raw, pselector);
                        this.addedSelectors.set(raw, pselector);
                        mustCommit = true;
                    }
                    continue;
                }
            }
            if ( mustCommit === false ) { return; }
            this.domFilterer.commit();
            if ( this.domFilterer.hasListeners() ) {
                this.domFilterer.triggerListeners({
                    procedural: Array.from(this.addedSelectors.values())
                });
            }
        },

        commitNow: function() {
            if ( this.selectors.size === 0 || this.domIsReady === false ) {
                return;
            }

            if ( this.addedNodes || this.removedNodes ) {
                this.addedSelectors.clear();
            }

            var entry, nodes, i;

            if ( this.addedSelectors.size !== 0 ) {
                //console.time('procedural selectors/filterset changed');
                for ( entry of this.addedSelectors ) {
                    nodes = entry[1].exec();
                    i = nodes.length;
                    while ( i-- ) {
                        this.domFilterer.hideNode(nodes[i]);
                    }
                }
                this.addedSelectors.clear();
                //console.timeEnd('procedural selectors/filterset changed');
                return;
            }

            //console.time('procedural selectors/dom layout changed');

            this.addedNodes = this.removedNodes = false;

            var t0 = Date.now(),
                t1, pselector, allowance;

            for ( entry of this.selectors ) {
                pselector = entry[1];
                allowance = Math.floor((t0 - pselector.lastAllowanceTime) / 2000);
                if ( allowance >= 1 ) {
                    pselector.budget += allowance * 50;
                    if ( pselector.budget > 200 ) { pselector.budget = 200; }
                    pselector.lastAllowanceTime = t0;
                }
                if ( pselector.budget <= 0 ) { continue; }
                nodes = pselector.exec();
                t1 = Date.now();
                pselector.budget += t0 - t1;
                if ( pselector.budget < -500 ) {
                    console.info('uBO: disabling %s', pselector.raw);
                    pselector.budget = -0x7FFFFFFF;
                }
                t0 = t1;
                i = nodes.length;
                while ( i-- ) {
                    this.domFilterer.hideNode(nodes[i]);
                }
            }

            //console.timeEnd('procedural selectors/dom layout changed');
        },

        createProceduralFilter: function(o) {
            return new PSelector(o);
        },

        onDOMCreated: function() {
            this.domIsReady = true;
            this.domFilterer.commitNow();
        },

        onDOMChanged: function(addedNodes, removedNodes) {
            if ( this.selectors.size === 0 ) { return; }
            this.addedNodes = this.addedNodes || addedNodes.length !== 0;
            this.removedNodes = this.removedNodes || removedNodes;
            this.domFilterer.commit();
        }
    };

    var DOMFiltererBase = vAPI.DOMFilterer;

    var domFilterer = function() {
        DOMFiltererBase.call(this);
        this.exceptions = [];
        this.proceduralFilterer = new DOMProceduralFilterer(this);
        this.hideNodeAttr = undefined;
        this.hideNodeStyleSheetInjected = false;

        // May or may not exist: cache locally since this may be called often.
        this.baseOnDOMChanged = DOMFiltererBase.prototype.onDOMChanged;

        if ( vAPI.domWatcher instanceof Object ) {
            vAPI.domWatcher.addListener(this);
        }
    };
    domFilterer.prototype = Object.create(DOMFiltererBase.prototype);
    domFilterer.prototype.constructor = domFilterer;

    domFilterer.prototype.commitNow = function() {
        DOMFiltererBase.prototype.commitNow.call(this);
        this.proceduralFilterer.commitNow();
    };

    domFilterer.prototype.addProceduralSelectors = function(aa) {
        this.proceduralFilterer.addProceduralSelectors(aa);
    };

    domFilterer.prototype.createProceduralFilter = function(o) {
        return this.proceduralFilterer.createProceduralFilter(o);
    };

    domFilterer.prototype.getAllSelectors = function() {
        var out = DOMFiltererBase.prototype.getAllSelectors.call(this);
        out.procedural = Array.from(this.proceduralFilterer.selectors.values());
        return out;
    };

    domFilterer.prototype.getAllExceptionSelectors = function() {
        return this.exceptions.join(',\n');
    };

    domFilterer.prototype.onDOMCreated = function() {
        if ( DOMFiltererBase.prototype.onDOMCreated !== undefined ) {
            DOMFiltererBase.prototype.onDOMCreated.call(this);
        }
        this.proceduralFilterer.onDOMCreated();
    };

    domFilterer.prototype.onDOMChanged = function() {
        if ( this.baseOnDOMChanged !== undefined ) {
            this.baseOnDOMChanged.apply(this, arguments);
        }
        this.proceduralFilterer.onDOMChanged.apply(
            this.proceduralFilterer,
            arguments
        );
    };

    return domFilterer;
})();

vAPI.domFilterer = new vAPI.DOMFilterer();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

vAPI.domCollapser = (function() {
    var resquestIdGenerator = 1,
        processTimer,
        toProcess = [],
        toFilter = [],
        toCollapse = new Map(),
        cachedBlockedSet,
        cachedBlockedSetHash,
        cachedBlockedSetTimer;
    var src1stProps = {
        'embed': 'src',
        'iframe': 'src',
        'img': 'src',
        'object': 'data'
    };
    var src2ndProps = {
        'img': 'srcset'
    };
    var tagToTypeMap = {
        embed: 'object',
        iframe: 'sub_frame',
        img: 'image',
        object: 'object'
    };
    var netSelectorCacheCount = 0,
        messaging = vAPI.messaging;

    var cachedBlockedSetClear = function() {
        cachedBlockedSet =
        cachedBlockedSetHash =
        cachedBlockedSetTimer = undefined;
    };

    // https://github.com/chrisaljoudi/uBlock/issues/174
    //   Do not remove fragment from src URL
    var onProcessed = function(response) {
        if ( !response ) { // This happens if uBO is disabled or restarted.
            toCollapse.clear();
            return;
        }

        var targets = toCollapse.get(response.id);
        if ( targets === undefined ) { return; }
        toCollapse.delete(response.id);
        if ( cachedBlockedSetHash !== response.hash ) {
            cachedBlockedSet = new Set(response.blockedResources);
            cachedBlockedSetHash = response.hash;
            if ( cachedBlockedSetTimer !== undefined ) {
                clearTimeout(cachedBlockedSetTimer);
            }
            cachedBlockedSetTimer = vAPI.setTimeout(cachedBlockedSetClear, 30000);
        }
        if ( cachedBlockedSet === undefined || cachedBlockedSet.size === 0 ) {
            return;
        }
        var selectors = [],
            iframeLoadEventPatch = vAPI.iframeLoadEventPatch,
            netSelectorCacheCountMax = response.netSelectorCacheCountMax,
            tag, prop, src, value;

        for ( var target of targets ) {
            tag = target.localName;
            prop = src1stProps[tag];
            if ( prop === undefined ) { continue; }
            src = target[prop];
            if ( typeof src !== 'string' || src.length === 0 ) {
                prop = src2ndProps[tag];
                if ( prop === undefined ) { continue; }
                src = target[prop];
                if ( typeof src !== 'string' || src.length === 0 ) { continue; }
            }
            if ( cachedBlockedSet.has(tagToTypeMap[tag] + ' ' + src) === false ) {
                continue;
            }
            // https://github.com/chrisaljoudi/uBlock/issues/399
            // Never remove elements from the DOM, just hide them
            target.style.setProperty('display', 'none', 'important');
            target.hidden = true;
            // https://github.com/chrisaljoudi/uBlock/issues/1048
            // Use attribute to construct CSS rule
            if (
                netSelectorCacheCount <= netSelectorCacheCountMax &&
                (value = target.getAttribute(prop))
            ) {
                selectors.push(tag + '[' + prop + '="' + value + '"]');
                netSelectorCacheCount += 1;
            }
            if ( iframeLoadEventPatch !== undefined ) {
                iframeLoadEventPatch(target);
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
        processTimer = undefined;
        toCollapse.set(resquestIdGenerator, toProcess);
        var msg = {
            what: 'getCollapsibleBlockedRequests',
            id: resquestIdGenerator,
            frameURL: window.location.href,
            resources: toFilter,
            hash: cachedBlockedSetHash
        };
        messaging.send('contentscript', msg, onProcessed);
        toProcess = [];
        toFilter = [];
        resquestIdGenerator += 1;
    };

    var process = function(delay) {
        if ( toProcess.length === 0 ) { return; }
        if ( delay === 0 ) {
            if ( processTimer !== undefined ) {
                clearTimeout(processTimer);
            }
            send();
        } else if ( processTimer === undefined ) {
            processTimer = vAPI.setTimeout(send, delay || 20);
        }
    };

    var add = function(target) {
        toProcess[toProcess.length] = target;
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

    // The injected scriptlets are those which were injected in the current
    // document, from within `bootstrapPhase1`, and which scriptlets are
    // selectively looked-up from:
    // https://github.com/uBlockOrigin/uAssets/blob/master/filters/resources.txt
    var primeLocalIFrame = function(iframe) {
        if ( vAPI.injectedScripts ) {
            vAPI.injectScriptlet(iframe.contentDocument, vAPI.injectedScripts);
        }
    };

    // https://github.com/gorhill/uBlock/issues/162
    // Be prepared to deal with possible change of src attribute.
    var addIFrame = function(iframe, dontObserve) {
        if ( dontObserve !== true ) {
            iframeSourceObserver.observe(iframe, iframeSourceObserverOptions);
        }
        var src = iframe.src;
        if ( src === '' || typeof src !== 'string' ) {
            primeLocalIFrame(iframe);
            return;
        }
        if ( src.startsWith('http') === false ) { return; }
        toFilter[toFilter.length] = {
            type: 'sub_frame',
            url: iframe.src
        };
        add(iframe);
    };

    var addIFrames = function(iframes) {
        var i = iframes.length;
        while ( i-- ) {
            addIFrame(iframes[i]);
        }
    };

    var onResourceFailed = function(ev) {
        if ( tagToTypeMap[ev.target.localName] !== undefined ) {
            add(ev.target);
            process();
        }
    };

    var domWatcherInterface = {
        onDOMCreated: function() {
            if ( vAPI instanceof Object === false ) { return; }
            if ( vAPI.domCollapser instanceof Object === false ) {
                if ( vAPI.domWatcher instanceof Object ) {
                    vAPI.domWatcher.removeListener(domWatcherInterface);
                }
                return;
            }
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

            vAPI.shutdown.add(function() {
                document.removeEventListener('error', onResourceFailed, true);
                if ( processTimer !== undefined ) {
                    clearTimeout(processTimer);
                }
            });
        },
        onDOMChanged: function(addedNodes) {
            var ni = addedNodes.length;
            if ( ni === 0 ) { return; }
            for ( var i = 0, node; i < ni; i++ ) {
                node = addedNodes[i];
                if ( node.localName === 'iframe' ) {
                    addIFrame(node);
                }
                if ( node.childElementCount === 0 ) { continue; }
                var iframes = node.getElementsByTagName('iframe');
                if ( iframes.length !== 0 ) {
                    addIFrames(iframes);
                }
            }
            process();
        }
    };

    if ( vAPI.domWatcher instanceof Object ) {
        vAPI.domWatcher.addListener(domWatcherInterface);
    }

    return {
        add: add,
        addMany: addMany,
        addIFrame: addIFrame,
        addIFrames: addIFrames,
        process: process
    };
})();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

vAPI.domSurveyor = (function() {
    var messaging = vAPI.messaging,
        domFilterer,
        hostname = '',
        queriedIds = new Set(),
        queriedClasses = new Set(),
        pendingIdNodes = { nodes: [], added: [] },
        pendingClassNodes = { nodes: [], added: [] },
        surveyCost = 0;

    // This is to shutdown the surveyor if result of surveying keeps being
    // fruitless. This is useful on long-lived web page. I arbitrarily
    // picked 5 minutes before the surveyor is allowed to shutdown. I also
    // arbitrarily picked 256 misses before the surveyor is allowed to
    // shutdown.
    var canShutdownAfter = Date.now() + 300000,
        surveyingMissCount = 0;

    // Handle main process' response.

    var surveyPhase3 = function(response) {
        var result = response && response.result,
            mustCommit = false;

        if ( result ) {
            var selectors = result.simple;
            if ( Array.isArray(selectors) && selectors.length !== 0 ) {
                domFilterer.addCSSRule(
                    selectors,
                    'display:none!important;',
                    { type: 'simple' }
                );
                mustCommit = true;
            }
            selectors = result.complex;
            if ( Array.isArray(selectors) && selectors.length !== 0 ) {
                domFilterer.addCSSRule(
                    selectors,
                    'display:none!important;',
                    { type: 'complex' }
                );
                mustCommit = true;
            }
            selectors = result.injected;
            if ( typeof selectors === 'string' && selectors.length !== 0 ) {
                domFilterer.addCSSRule(
                    selectors,
                    'display:none!important;',
                    { injected: true }
                );
                mustCommit = true;
            }
        }

        if ( hasChunk(pendingIdNodes) || hasChunk(pendingClassNodes) ) {
            surveyTimer.start(1);
        }

        if ( mustCommit ) {
            surveyingMissCount = 0;
            canShutdownAfter = Date.now() + 300000;
            return;
        }

        surveyingMissCount += 1;
        if ( surveyingMissCount < 256 || Date.now() < canShutdownAfter ) {
            return;
        }

        //console.info('dom surveyor shutting down: too many misses');

        surveyTimer.clear();
        vAPI.domWatcher.removeListener(domWatcherInterface);
        vAPI.domSurveyor = null;
    };

    var surveyTimer = new vAPI.SafeAnimationFrame(function() {
        surveyPhase1();
    });

    // The purpose of "chunkification" is to ensure the surveyor won't unduly
    // block the main event loop.

    var hasChunk = function(pending) {
        return pending.nodes.length !== 0 ||
               pending.added.length !== 0;
    };

    var addChunk = function(pending, added) {
        if ( added.length === 0 ) { return; }
        if (
            Array.isArray(added) === false ||
            pending.added.length === 0 ||
            Array.isArray(pending.added[0]) === false ||
            pending.added[0].length >= 1000
        ) {
            pending.added.push(added);
        } else {
            pending.added = pending.added.concat(added);
        }
    };

    var nextChunk = function(pending) {
        var added = pending.added.length !== 0 ? pending.added.shift() : [],
            nodes;
        if ( pending.nodes.length === 0 ) {
            if ( added.length <= 1000 ) { return added; }
            nodes = Array.isArray(added)
                ? added
                : Array.prototype.slice.call(added);
            pending.nodes = nodes.splice(1000);
            return nodes;
        }
        if ( Array.isArray(added) === false ) {
            added = Array.prototype.slice.call(added);
        }
        if ( pending.nodes.length < 1000 ) {
            nodes = pending.nodes.concat(added.splice(0, 1000 - pending.nodes.length));
            pending.nodes = added;
        } else {
            nodes = pending.nodes.splice(0, 1000);
            pending.nodes = pending.nodes.concat(added);
        }
        return nodes;
    };

    // Extract all classes/ids: these will be passed to the cosmetic
    // filtering engine, and in return we will obtain only the relevant
    // CSS selectors.

    // https://github.com/gorhill/uBlock/issues/672
    // http://www.w3.org/TR/2014/REC-html5-20141028/infrastructure.html#space-separated-tokens
    // http://jsperf.com/enumerate-classes/6

    var surveyPhase1 = function() {
        //console.time('dom surveyor/surveying');
        surveyTimer.clear();
        var t0 = window.performance.now();
        var rews = reWhitespace,
            qq, iout, nodes, i, node, v, vv, j;
        var ids = [];
        iout = 0;
        qq = queriedIds;
        nodes = nextChunk(pendingIdNodes);
        i = nodes.length;
        while ( i-- ) {
            node = nodes[i];
            v = node.id;
            if ( typeof v !== 'string' ) { continue; }
            v = v.trim();
            if ( qq.has(v) === false && v.length !== 0 ) {
                ids[iout++] = v; qq.add(v);
            }
        }
        var classes = [];
        iout = 0;
        qq = queriedClasses;
        nodes = nextChunk(pendingClassNodes);
        i = nodes.length;
        while ( i-- ) {
            node = nodes[i];
            vv = node.className;
            if ( typeof vv !== 'string' ) { continue; }
            if ( rews.test(vv) === false ) {
                if ( qq.has(vv) === false && vv.length !== 0 ) {
                    classes[iout++] = vv; qq.add(vv);
                }
            } else {
                vv = node.classList;
                j = vv.length;
                while ( j-- ) {
                    v = vv[j];
                    if ( qq.has(v) === false ) {
                        classes[iout++] = v; qq.add(v);
                    }
                }
            }
        }
        surveyCost += window.performance.now() - t0;
        // Phase 2: Ask main process to lookup relevant cosmetic filters.
        if ( ids.length !== 0 || classes.length !== 0 ) {
            messaging.send(
                'contentscript',
                {
                    what: 'retrieveGenericCosmeticSelectors',
                    hostname: hostname,
                    ids: ids.join('\n'),
                    classes: classes.join('\n'),
                    exceptions: domFilterer.exceptions,
                    cost: surveyCost
                },
                surveyPhase3
            );
        } else {
            surveyPhase3(null);
        }
        //console.timeEnd('dom surveyor/surveying');
    };
    var reWhitespace = /\s/;

    var domWatcherInterface = {
        onDOMCreated: function() {
            if (
                vAPI instanceof Object === false ||
                vAPI.domSurveyor instanceof Object === false ||
                vAPI.domFilterer instanceof Object === false
            ) {
                if ( vAPI instanceof Object ) {
                    if ( vAPI.domWatcher instanceof Object ) {
                        vAPI.domWatcher.removeListener(domWatcherInterface);
                    }
                    vAPI.domSurveyor = null;
                }
                return;
            }
            //console.time('dom surveyor/dom layout created');
            domFilterer = vAPI.domFilterer;
            addChunk(pendingIdNodes, document.querySelectorAll('[id]'));
            addChunk(pendingClassNodes, document.querySelectorAll('[class]'));
            surveyTimer.start();
            //console.timeEnd('dom surveyor/dom layout created');
        },
        onDOMChanged: function(addedNodes) {
            if ( addedNodes.length === 0 ) { return; }
            //console.time('dom surveyor/dom layout changed');
            var idNodes = [], iid = 0,
                classNodes = [], iclass = 0;
            var i = addedNodes.length,
                node, nodeList, j;
            while ( i-- ) {
                node = addedNodes[i];
                idNodes[iid++] = node;
                classNodes[iclass++] = node;
                if ( node.childElementCount === 0 ) { continue; }
                nodeList = node.querySelectorAll('[id]');
                j = nodeList.length;
                while ( j-- ) {
                    idNodes[iid++] = nodeList[j];
                }
                nodeList = node.querySelectorAll('[class]');
                j = nodeList.length;
                while ( j-- ) {
                    classNodes[iclass++] = nodeList[j];
                }
            }
            if ( idNodes.length !== 0 || classNodes.lengh !== 0 ) {
                addChunk(pendingIdNodes, idNodes);
                addChunk(pendingClassNodes, classNodes);
                surveyTimer.start(1);
            }
            //console.timeEnd('dom surveyor/dom layout changed');
        }
    };

    var start = function(details) {
        if ( vAPI.domWatcher instanceof Object === false ) { return; }
        hostname = details.hostname;
        vAPI.domWatcher.addListener(domWatcherInterface);
    };

    return {
        start: start
    };
})();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// Bootstrapping allows all components of the content script to be launched
// if/when needed.

(function bootstrap() {

    var bootstrapPhase2 = function(ev) {
        // This can happen on Firefox. For instance:
        // https://github.com/gorhill/uBlock/issues/1893
        if ( window.location === null ) { return; }

        if ( ev ) {
            document.removeEventListener('DOMContentLoaded', bootstrapPhase2);
        }

        if ( vAPI instanceof Object === false ) {
            return;
        }

        vAPI.messaging.send(
            'contentscript',
            { what: 'shouldRenderNoscriptTags' }
        );

        if ( vAPI.domWatcher instanceof Object ) {
            vAPI.domWatcher.start();
        }

        // Element picker works only in top window for now.
        if (
            window !== window.top ||
            vAPI.domFilterer instanceof Object === false
        ) {
            return;
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
                    url: elem !== null && ev.isTrusted !== false ? elem.href : ''
                }
            );
        };

        document.addEventListener('mousedown', onMouseClick, true);

        // https://github.com/gorhill/uMatrix/issues/144
        vAPI.shutdown.add(function() {
            document.removeEventListener('mousedown', onMouseClick, true);
        });
    };

    var bootstrapPhase1 = function(response) {
        // cosmetic filtering engine aka 'cfe'
        var cfeDetails = response && response.specificCosmeticFilters;
        if ( !cfeDetails || !cfeDetails.ready ) {
            vAPI.domWatcher = vAPI.domCollapser = vAPI.domFilterer =
            vAPI.domSurveyor = vAPI.domIsLoaded = null;
            return;
        }

        if ( response.noCosmeticFiltering ) {
            vAPI.domFilterer = null;
            vAPI.domSurveyor = null;
        } else {
            var domFilterer = vAPI.domFilterer;
            if ( response.noGenericCosmeticFiltering || cfeDetails.noDOMSurveying ) {
                vAPI.domSurveyor = null;
            }
            domFilterer.exceptions = cfeDetails.exceptionFilters;
            domFilterer.hideNodeAttr = cfeDetails.hideNodeAttr;
            domFilterer.hideNodeStyleSheetInjected =
                cfeDetails.hideNodeStyleSheetInjected === true;
            domFilterer.addCSSRule(
                cfeDetails.declarativeFilters,
                'display:none!important;'
            );
            domFilterer.addCSSRule(
                cfeDetails.highGenericHideSimple,
                'display:none!important;',
                { type: 'simple', lazy: true }
            );
            domFilterer.addCSSRule(
                cfeDetails.highGenericHideComplex,
                'display:none!important;',
                { type: 'complex', lazy: true }
            );
            domFilterer.addCSSRule(
                cfeDetails.injectedHideFilters,
                'display:none!important;',
                { injected: true }
            );
            domFilterer.addProceduralSelectors(cfeDetails.proceduralFilters);
        }

        if ( cfeDetails.networkFilters.length !== 0 ) {
            vAPI.userStylesheet.add(
                cfeDetails.networkFilters + '\n{display:none!important;}');
        }

        vAPI.userStylesheet.apply();

        // Library of resources is located at:
        // https://github.com/gorhill/uBlock/blob/master/assets/ublock/resources.txt
        if ( response.scriptlets ) {
            vAPI.injectScriptlet(document, response.scriptlets);
            vAPI.injectedScripts = response.scriptlets;
        }

        if ( vAPI.domSurveyor instanceof Object ) {
            vAPI.domSurveyor.start(cfeDetails);
        }

        // https://github.com/chrisaljoudi/uBlock/issues/587
        // If no filters were found, maybe the script was injected before
        // uBlock's process was fully initialized. When this happens, pages
        // won't be cleaned right after browser launch.
        if (
            typeof document.readyState === 'string' &&
            document.readyState !== 'loading'
        ) {
            bootstrapPhase2();
        } else {
            document.addEventListener('DOMContentLoaded', bootstrapPhase2);
        }
    };

    // This starts bootstrap process.
    vAPI.messaging.send(
        'contentscript',
        {
            what: 'retrieveContentScriptParameters',
            url: window.location.href,
            isRootFrame: window === window.top,
            charset: document.characterSet
        },
        bootstrapPhase1
    );
})();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

} // <<<<<<<< end of HUGE-IF-BLOCK

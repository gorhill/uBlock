/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-present Raymond Hill

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
              +--> domFilterer --+-- [domLogger]
                        |        |
                        |        +-- [domInspector]
                        |
             [domProceduralFilterer]

  domWatcher:
    Watches for changes in the DOM, and notify the other components about these
    changes.

  domCollapser:
    Enforces the collapsing of DOM elements for which a corresponding
    resource was blocked through network filtering.

  domFilterer:
    Enforces the filtering of DOM elements, by feeding it cosmetic filters.

  domProceduralFilterer:
    Enforce the filtering of DOM elements through procedural cosmetic filters.
    Loaded on demand, only when needed.

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

  [1] "user stylesheets" refer to local CSS rules which have priority over,
       and can't be overriden by a web page's own CSS rules.

*/

// Abort execution if our global vAPI object does not exist.
//   https://github.com/chrisaljoudi/uBlock/issues/456
//   https://github.com/gorhill/uBlock/issues/2029

 // >>>>>>>> start of HUGE-IF-BLOCK
if ( typeof vAPI === 'object' && !vAPI.contentScript ) {

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

vAPI.contentScript = true;

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// https://github.com/uBlockOrigin/uBlock-issues/issues/688#issuecomment-663657508
{
    let context = self;
    try {
        while (
            context !== self.top &&
            context.location.href.startsWith('about:blank') &&
            context.parent.location.href
        ) {
            context = context.parent;
        }
    } catch(ex) {
    }
    vAPI.effectiveSelf = context;
}

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

vAPI.userStylesheet = {
    added: new Set(),
    removed: new Set(),
    apply: function(callback) {
        if ( this.added.size === 0 && this.removed.size === 0 ) { return; }
        vAPI.messaging.send('vapi', {
            what: 'userCSS',
            add: Array.from(this.added),
            remove: Array.from(this.removed),
        }).then(( ) => {
            if ( callback instanceof Function === false ) { return; }
            callback();
        });
        this.added.clear();
        this.removed.clear();
    },
    add: function(cssText, now) {
        if ( cssText === '' ) { return; }
        this.added.add(cssText);
        if ( now ) { this.apply(); }
    },
    remove: function(cssText, now) {
        if ( cssText === '' ) { return; }
        this.removed.add(cssText);
        if ( now ) { this.apply(); }
    }
};

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

vAPI.SafeAnimationFrame = class {
    constructor(callback) {
        this.fid = this.tid = undefined;
        this.callback = callback;
    }
    start(delay) {
        if ( self.vAPI instanceof Object === false ) { return; }
        if ( delay === undefined ) {
            if ( this.fid === undefined ) {
                this.fid = requestAnimationFrame(( ) => { this.onRAF(); } );
            }
            if ( this.tid === undefined ) {
                this.tid = vAPI.setTimeout(( ) => { this.onSTO(); }, 20000);
            }
            return;
        }
        if ( this.fid === undefined && this.tid === undefined ) {
            this.tid = vAPI.setTimeout(( ) => { this.macroToMicro(); }, delay);
        }
    }
    clear() {
        if ( this.fid !== undefined ) {
            cancelAnimationFrame(this.fid);
            this.fid = undefined;
        }
        if ( this.tid !== undefined ) {
            clearTimeout(this.tid);
            this.tid = undefined;
        }
    }
    macroToMicro() {
        this.tid = undefined;
        this.start();
    }
    onRAF() {
        if ( this.tid !== undefined ) {
            clearTimeout(this.tid);
            this.tid = undefined;
        }
        this.fid = undefined;
        this.callback();
    }
    onSTO() {
        if ( this.fid !== undefined ) {
            cancelAnimationFrame(this.fid);
            this.fid = undefined;
        }
        this.tid = undefined;
        this.callback();
    }
};

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// https://github.com/uBlockOrigin/uBlock-issues/issues/552
//   Listen and report CSP violations so that blocked resources through CSP
//   are properly reported in the logger.

{
    const newEvents = new Set();
    const allEvents = new Set();
    let timer;

    const send = function() {
        vAPI.messaging.send('scriptlets', {
            what: 'securityPolicyViolation',
            type: 'net',
            docURL: document.location.href,
            violations: Array.from(newEvents),
        }).then(response => {
            if ( response === true ) { return; }
            stop();
        });
        for ( const event of newEvents ) {
            allEvents.add(event);
        }
        newEvents.clear();
    };

    const sendAsync = function() {
        if ( timer !== undefined ) { return; }
        timer = self.requestIdleCallback(
            ( ) => { timer = undefined; send(); },
            { timeout: 2063 }
        );
    };

    const listener = function(ev) {
        if ( ev.isTrusted !== true ) { return; }
        if ( ev.disposition !== 'enforce' ) { return; }
        const json = JSON.stringify({
            url: ev.blockedURL || ev.blockedURI,
            policy: ev.originalPolicy,
            directive: ev.effectiveDirective || ev.violatedDirective,
        });
        if ( allEvents.has(json) ) { return; }
        newEvents.add(json);
        sendAsync();
    };

    const stop = function() {
        newEvents.clear();
        allEvents.clear();
        if ( timer !== undefined ) {
            self.cancelIdleCallback(timer);
            timer = undefined;
        }
        document.removeEventListener('securitypolicyviolation', listener);
        vAPI.shutdown.remove(stop);
    };

    document.addEventListener('securitypolicyviolation', listener);
    vAPI.shutdown.add(stop);

    // We need to call at least once to find out whether we really need to
    // listen to CSP violations.
    sendAsync();
}

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// vAPI.domWatcher

{
    vAPI.domMutationTime = Date.now();

    const addedNodeLists = [];
    const removedNodeLists = [];
    const addedNodes = [];
    const ignoreTags = new Set([ 'br', 'head', 'link', 'meta', 'script', 'style' ]);
    const listeners = [];

    let domLayoutObserver;
    let listenerIterator = [];
    let listenerIteratorDirty = false;
    let removedNodes = false;
    let safeObserverHandlerTimer;

    const safeObserverHandler = function() {
        let i = addedNodeLists.length;
        while ( i-- ) {
            const nodeList = addedNodeLists[i];
            let iNode = nodeList.length;
            while ( iNode-- ) {
                const node = nodeList[iNode];
                if ( node.nodeType !== 1 ) { continue; }
                if ( ignoreTags.has(node.localName) ) { continue; }
                if ( node.parentElement === null ) { continue; }
                addedNodes.push(node);
            }
        }
        addedNodeLists.length = 0;
        i = removedNodeLists.length;
        while ( i-- && removedNodes === false ) {
            const nodeList = removedNodeLists[i];
            let iNode = nodeList.length;
            while ( iNode-- ) {
                if ( nodeList[iNode].nodeType !== 1 ) { continue; }
                removedNodes = true;
                break;
            }
        }
        removedNodeLists.length = 0;
        if ( addedNodes.length === 0 && removedNodes === false ) { return; }
        for ( const listener of getListenerIterator() ) {
            try { listener.onDOMChanged(addedNodes, removedNodes); }
            catch (ex) { }
        }
        addedNodes.length = 0;
        removedNodes = false;
        vAPI.domMutationTime = Date.now();
    };

    // https://github.com/chrisaljoudi/uBlock/issues/205
    //   Do not handle added node directly from within mutation observer.
    const observerHandler = function(mutations) {
        let i = mutations.length;
        while ( i-- ) {
            const mutation = mutations[i];
            let nodeList = mutation.addedNodes;
            if ( nodeList.length !== 0 ) {
                addedNodeLists.push(nodeList);
            }
            nodeList = mutation.removedNodes;
            if ( nodeList.length !== 0 ) {
                removedNodeLists.push(nodeList);
            }
        }
        if ( addedNodeLists.length !== 0 || removedNodeLists.length !== 0 ) {
            safeObserverHandlerTimer.start(
                addedNodeLists.length < 100 ? 1 : undefined
            );
        }
    };

    const startMutationObserver = function() {
        if ( domLayoutObserver !== undefined ) { return; }
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

    const stopMutationObserver = function() {
        if ( domLayoutObserver === undefined ) { return; }
        cleanup();
        vAPI.shutdown.remove(cleanup);
    };

    const getListenerIterator = function() {
        if ( listenerIteratorDirty ) {
            listenerIterator = listeners.slice();
            listenerIteratorDirty = false;
        }
        return listenerIterator;
    };

    const addListener = function(listener) {
        if ( listeners.indexOf(listener) !== -1 ) { return; }
        listeners.push(listener);
        listenerIteratorDirty = true;
        if ( domLayoutObserver === undefined ) { return; }
        try { listener.onDOMCreated(); }
        catch (ex) { }
        startMutationObserver();
    };

    const removeListener = function(listener) {
        const pos = listeners.indexOf(listener);
        if ( pos === -1 ) { return; }
        listeners.splice(pos, 1);
        listenerIteratorDirty = true;
        if ( listeners.length === 0 ) {
            stopMutationObserver();
        }
    };

    const cleanup = function() {
        if ( domLayoutObserver !== undefined ) {
            domLayoutObserver.disconnect();
            domLayoutObserver = undefined;
        }
        if ( safeObserverHandlerTimer !== undefined ) {
            safeObserverHandlerTimer.clear();
            safeObserverHandlerTimer = undefined;
        }
    };

    const start = function() {
        for ( const listener of getListenerIterator() ) {
            try { listener.onDOMCreated(); }
            catch (ex) { }
        }
        startMutationObserver();
    };

    vAPI.domWatcher = { start, addListener, removeListener };
}

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

  DOMFilterer: adds procedural cosmetic filtering

*/

vAPI.hideStyle = 'display:none!important;';

vAPI.DOMFilterer = class {
    constructor() {
        this.commitTimer = new vAPI.SafeAnimationFrame(
            ( ) => { this.commitNow(); }
        );
        this.domIsReady = document.readyState !== 'loading';
        this.disabled = false;
        this.listeners = [];
        this.stylesheets = [];
        this.exceptedCSSRules = [];
        this.exceptions = [];
        this.proceduralFilterer = null;
        // https://github.com/uBlockOrigin/uBlock-issues/issues/167
        //   By the time the DOMContentLoaded is fired, the content script might
        //   have been disconnected from the background page. Unclear why this
        //   would happen, so far seems to be a Chromium-specific behavior at
        //   launch time.
        if ( this.domIsReady !== true ) {
            document.addEventListener('DOMContentLoaded', ( ) => {
                if ( vAPI instanceof Object === false ) { return; }
                this.domIsReady = true;
                this.commit();
            });
        }
    }

    explodeCSS(css) {
        const out = [];
        const reBlock = /^\{(.*)\}$/m;
        const blocks = css.trim().split(/\n\n+/);
        for ( const block of blocks ) {
            const match = reBlock.exec(block);
            out.push([ block.slice(0, match.index).trim(), match[1] ]);
        }
        return out;
    }

    addCSS(css, details = {}) {
        if ( typeof css !== 'string' || css.length === 0 ) { return; }
        if ( this.stylesheets.includes(css) ) { return; }
        this.stylesheets.push(css);
        if ( details.mustInject && this.disabled === false ) {
            vAPI.userStylesheet.add(css);
        }
        if ( this.hasListeners() === false ) { return; }
        if ( details.silent ) { return; }
        this.triggerListeners({ declarative: this.explodeCSS(css) });
    }

    exceptCSSRules(exceptions) {
        if ( exceptions.length === 0 ) { return; }
        this.exceptedCSSRules.push(...exceptions);
        if ( this.hasListeners() ) {
            this.triggerListeners({ exceptions });
        }
    }

    addListener(listener) {
        if ( this.listeners.indexOf(listener) !== -1 ) { return; }
        this.listeners.push(listener);
    }

    removeListener(listener) {
        const pos = this.listeners.indexOf(listener);
        if ( pos === -1 ) { return; }
        this.listeners.splice(pos, 1);
    }

    hasListeners() {
        return this.listeners.length !== 0;
    }

    triggerListeners(changes) {
        for ( const listener of this.listeners ) {
            listener.onFiltersetChanged(changes);
        }
    }

    toggle(state, callback) {
        if ( state === undefined ) { state = this.disabled; }
        if ( state !== this.disabled ) { return; }
        this.disabled = !state;
        const uss = vAPI.userStylesheet;
        for ( const css of this.stylesheets ) {
            if ( this.disabled ) {
                uss.remove(css);
            } else {
                uss.add(css);
            }
        }
        uss.apply(callback);
    }

    // Here we will deal with:
    // - Injecting low priority user styles;
    // - Notifying listeners about changed filterset.
    // https://www.reddit.com/r/uBlockOrigin/comments/9jj0y1/no_longer_blocking_ads/
    //   Ensure vAPI is still valid -- it can go away by the time we are
    //   called, since the port could be force-disconnected from the main
    //   process. Another approach would be to have vAPI.SafeAnimationFrame
    //   register a shutdown job: to evaluate. For now I will keep the fix
    //   trivial.
    commitNow() {
        this.commitTimer.clear();
        if ( vAPI instanceof Object === false ) { return; }
        vAPI.userStylesheet.apply();
        if ( this.proceduralFilterer instanceof Object ) {
            this.proceduralFilterer.commitNow();
        }
    }

    commit(commitNow) {
        if ( commitNow ) {
            this.commitTimer.clear();
            this.commitNow();
        } else {
            this.commitTimer.start();
        }
    }

    proceduralFiltererInstance() {
        if ( this.proceduralFilterer instanceof Object === false ) {
            if ( vAPI.DOMProceduralFilterer instanceof Object === false ) {
                return null;
            }
            this.proceduralFilterer = new vAPI.DOMProceduralFilterer(this);
        }
        return this.proceduralFilterer;
    }

    addProceduralSelectors(selectors) {
        if ( Array.isArray(selectors) === false || selectors.length === 0 ) {
            return;
        }
        const procedurals = [];
        for ( const raw of selectors ) {
            procedurals.push(JSON.parse(raw));
        }
        if ( procedurals.length === 0 ) { return; }
        const pfilterer = this.proceduralFiltererInstance();
        if ( pfilterer !== null ) {
            pfilterer.addProceduralSelectors(procedurals);
        }
    }

    createProceduralFilter(o) {
        const pfilterer = this.proceduralFiltererInstance();
        if ( pfilterer === null ) { return; }
        return pfilterer.createProceduralFilter(o);
    }

    getAllSelectors(bits = 0) {
        const out = {
            declarative: [],
            exceptions: this.exceptedCSSRules,
        };
        const hasProcedural = this.proceduralFilterer instanceof Object;
        const includePrivateSelectors = (bits & 0b01) !== 0;
        const masterToken = hasProcedural
            ? `[${this.proceduralFilterer.masterToken}]`
            : undefined;
        for ( const css of this.stylesheets ) {
            const blocks = this.explodeCSS(css);
            for ( const block of blocks ) {
                if (
                    includePrivateSelectors === false &&
                    masterToken !== undefined &&
                    block[0].startsWith(masterToken)
                ) {
                    continue;
                }
                out.declarative.push([ block[0], block[1] ]);
            }
        }
        const excludeProcedurals = (bits & 0b10) !== 0;
        if ( excludeProcedurals !== true ) {
            out.procedural = hasProcedural
                ? Array.from(this.proceduralFilterer.selectors.values())
                : [];
        }
        return out;
    }

    getAllExceptionSelectors() {
        return this.exceptions.join(',\n');
    }
};

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// vAPI.domCollapser

{
    const messaging = vAPI.messaging;
    const toCollapse = new Map();
    const src1stProps = {
        audio: 'currentSrc',
        embed: 'src',
        iframe: 'src',
        img: 'currentSrc',
        object: 'data',
        video: 'currentSrc',
    };
    const src2ndProps = {
        audio: 'src',
        img: 'src',
        video: 'src',
    };
    const tagToTypeMap = {
        audio: 'media',
        embed: 'object',
        iframe: 'sub_frame',
        img: 'image',
        object: 'object',
        video: 'media',
    };
    let resquestIdGenerator = 1,
        processTimer,
        cachedBlockedSet,
        cachedBlockedSetHash,
        cachedBlockedSetTimer,
        toProcess = [],
        toFilter = [],
        netSelectorCacheCount = 0;

    const cachedBlockedSetClear = function() {
        cachedBlockedSet =
        cachedBlockedSetHash =
        cachedBlockedSetTimer = undefined;
    };

    // https://github.com/chrisaljoudi/uBlock/issues/399
    // https://github.com/gorhill/uBlock/issues/2848
    //   Use a user stylesheet to collapse placeholders.
    const getCollapseToken = ( ) => {
        if ( collapseToken === undefined ) {
            collapseToken = vAPI.randomToken();
            vAPI.userStylesheet.add(
                `[${collapseToken}]\n{display:none!important;}`,
                true
            );
        }
        return collapseToken;
    };
    let collapseToken;

    // https://github.com/chrisaljoudi/uBlock/issues/174
    //   Do not remove fragment from src URL
    const onProcessed = function(response) {
        // This happens if uBO is disabled or restarted.
        if ( response instanceof Object === false ) {
            toCollapse.clear();
            return;
        }

        const targets = toCollapse.get(response.id);
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

        const selectors = [];
        let netSelectorCacheCountMax = response.netSelectorCacheCountMax;

        for ( const target of targets ) {
            const tag = target.localName;
            let prop = src1stProps[tag];
            if ( prop === undefined ) { continue; }
            let src = target[prop];
            if ( typeof src !== 'string' || src.length === 0 ) {
                prop = src2ndProps[tag];
                if ( prop === undefined ) { continue; }
                src = target[prop];
                if ( typeof src !== 'string' || src.length === 0 ) { continue; }
            }
            if ( cachedBlockedSet.has(tagToTypeMap[tag] + ' ' + src) === false ) {
                continue;
            }
            target.setAttribute(getCollapseToken(), '');
            // https://github.com/chrisaljoudi/uBlock/issues/1048
            //   Use attribute to construct CSS rule
            if ( netSelectorCacheCount > netSelectorCacheCountMax ) { continue; }
            const value = target.getAttribute(prop);
            if ( value ) {
                selectors.push(`${tag}[${prop}="${CSS.escape(value)}"]`);
                netSelectorCacheCount += 1;
            }
        }

        if ( selectors.length === 0 ) { return; }
        messaging.send('contentscript', {
            what: 'cosmeticFiltersInjected',
            type: 'net',
            hostname: window.location.hostname,
            selectors,
        });
    };

    const send = function() {
        processTimer = undefined;
        toCollapse.set(resquestIdGenerator, toProcess);
        messaging.send('contentscript', {
            what: 'getCollapsibleBlockedRequests',
            id: resquestIdGenerator,
            frameURL: window.location.href,
            resources: toFilter,
            hash: cachedBlockedSetHash,
        }).then(response => {
            onProcessed(response);
        });
        toProcess = [];
        toFilter = [];
        resquestIdGenerator += 1;
    };

    const process = function(delay) {
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

    const add = function(target) {
        toProcess[toProcess.length] = target;
    };

    const addMany = function(targets) {
        for ( const target of targets ) {
            add(target);
        }
    };

    const iframeSourceModified = function(mutations) {
        for ( const mutation of mutations ) {
            addIFrame(mutation.target, true);
        }
        process();
    };
    const iframeSourceObserver = new MutationObserver(iframeSourceModified);
    const iframeSourceObserverOptions = {
        attributes: true,
        attributeFilter: [ 'src' ]
    };

    // https://github.com/gorhill/uBlock/issues/162
    //   Be prepared to deal with possible change of src attribute.
    const addIFrame = function(iframe, dontObserve) {
        if ( dontObserve !== true ) {
            iframeSourceObserver.observe(iframe, iframeSourceObserverOptions);
        }
        const src = iframe.src;
        if ( typeof src !== 'string' || src === '' ) { return; }
        if ( src.startsWith('http') === false ) { return; }
        toFilter.push({ type: 'sub_frame', url: iframe.src });
        add(iframe);
    };

    const addIFrames = function(iframes) {
        for ( const iframe of iframes ) {
            addIFrame(iframe);
        }
    };

    const onResourceFailed = function(ev) {
        if ( tagToTypeMap[ev.target.localName] !== undefined ) {
            add(ev.target);
            process();
        }
    };

    const stop = function() {
        document.removeEventListener('error', onResourceFailed, true);
        if ( processTimer !== undefined ) {
            clearTimeout(processTimer);
        }
        if ( vAPI.domWatcher instanceof Object ) {
            vAPI.domWatcher.removeListener(domWatcherInterface);
        }
        vAPI.shutdown.remove(stop);
        vAPI.domCollapser = null;
    };

    const start = function() {
        if ( vAPI.domWatcher instanceof Object ) {
            vAPI.domWatcher.addListener(domWatcherInterface);
        }
    };

    const domWatcherInterface = {
        onDOMCreated: function() {
            if ( self.vAPI instanceof Object === false ) { return; }
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
            const elems = document.images ||
                          document.getElementsByTagName('img');
            for ( const elem of elems ) {
                if ( elem.complete ) {
                    add(elem);
                }
            }
            addMany(document.embeds || document.getElementsByTagName('embed'));
            addMany(document.getElementsByTagName('object'));
            addIFrames(document.getElementsByTagName('iframe'));
            process(0);

            document.addEventListener('error', onResourceFailed, true);

            vAPI.shutdown.add(stop);
        },
        onDOMChanged: function(addedNodes) {
            if ( addedNodes.length === 0 ) { return; }
            for ( const node of addedNodes ) {
                if ( node.localName === 'iframe' ) {
                    addIFrame(node);
                }
                if ( node.childElementCount === 0 ) { continue; }
                const iframes = node.getElementsByTagName('iframe');
                if ( iframes.length !== 0 ) {
                    addIFrames(iframes);
                }
            }
            process();
        }
    };

    vAPI.domCollapser = { start };
}

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// vAPI.domSurveyor

{
    const messaging = vAPI.messaging;
    const queriedIds = new Set();
    const queriedClasses = new Set();
    const maxSurveyNodes = 65536;
    const maxSurveyTimeSlice = 4;
    const maxSurveyBuffer = 64;

    let domFilterer,
        hostname = '',
        surveyCost = 0;

    const pendingNodes = {
        nodeLists: [],
        buffer: [
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null,
        ],
        j: 0,
        accepted: 0,
        iterated: 0,
        stopped: false,
        add: function(nodes) {
            if ( nodes.length === 0 || this.accepted >= maxSurveyNodes ) {
                return;
            }
            this.nodeLists.push(nodes);
            this.accepted += nodes.length;
        },
        next: function() {
            if ( this.nodeLists.length === 0 || this.stopped ) { return 0; }
            const nodeLists = this.nodeLists;
            let ib = 0;
            do {
                const nodeList = nodeLists[0];
                let j = this.j;
                let n = j + maxSurveyBuffer - ib;
                if ( n > nodeList.length ) {
                    n = nodeList.length;
                }
                for ( let i = j; i < n; i++ ) {
                    this.buffer[ib++] = nodeList[j++];
                }
                if ( j !== nodeList.length ) {
                    this.j = j;
                    break;
                }
                this.j = 0;
                this.nodeLists.shift();
            } while ( ib < maxSurveyBuffer && nodeLists.length !== 0 );
            this.iterated += ib;
            if ( this.iterated >= maxSurveyNodes ) {
                this.nodeLists = [];
                this.stopped = true;
                //console.info(`domSurveyor> Surveyed a total of ${this.iterated} nodes. Enough.`);
            }
            return ib;
        },
        hasNodes: function() {
            return this.nodeLists.length !== 0;
        },
    };

    // Extract all classes/ids: these will be passed to the cosmetic
    // filtering engine, and in return we will obtain only the relevant
    // CSS selectors.
    const reWhitespace = /\s/;

    // https://github.com/gorhill/uBlock/issues/672
    // http://www.w3.org/TR/2014/REC-html5-20141028/infrastructure.html#space-separated-tokens
    // http://jsperf.com/enumerate-classes/6

    const surveyPhase1 = function() {
        //console.time('dom surveyor/surveying');
        const t0 = performance.now();
        const rews = reWhitespace;
        const ids = [];
        const classes = [];
        const nodes = pendingNodes.buffer;
        const deadline = t0 + maxSurveyTimeSlice;
        let qids = queriedIds;
        let qcls = queriedClasses;
        let processed = 0;
        for (;;) {
            const n = pendingNodes.next();
            if ( n === 0 ) { break; }
            for ( let i = 0; i < n; i++ ) {
                const node = nodes[i]; nodes[i] = null;
                let v = node.id;
                if ( typeof v === 'string' && v.length !== 0 ) {
                    v = v.trim();
                    if ( qids.has(v) === false && v.length !== 0 ) {
                        ids.push(v); qids.add(v);
                    }
                }
                let vv = node.className;
                if ( typeof vv === 'string' && vv.length !== 0 ) {
                    if ( rews.test(vv) === false ) {
                        if ( qcls.has(vv) === false ) {
                            classes.push(vv); qcls.add(vv);
                        }
                    } else {
                        vv = node.classList;
                        let j = vv.length;
                        while ( j-- ) {
                            const v = vv[j];
                            if ( qcls.has(v) === false ) {
                                classes.push(v); qcls.add(v);
                            }
                        }
                    }
                }
            }
            processed += n;
            if ( performance.now() >= deadline ) { break; }
        }
        const t1 = performance.now();
        surveyCost += t1 - t0;
        //console.info(`domSurveyor> Surveyed ${processed} nodes in ${(t1-t0).toFixed(2)} ms`);
        // Phase 2: Ask main process to lookup relevant cosmetic filters.
        if ( ids.length !== 0 || classes.length !== 0 ) {
            messaging.send('contentscript', {
                what: 'retrieveGenericCosmeticSelectors',
                hostname,
                ids,
                classes,
                exceptions: domFilterer.exceptions,
                cost: surveyCost,
            }).then(response => {
                surveyPhase3(response);
            });
        } else {
            surveyPhase3(null);
        }
        //console.timeEnd('dom surveyor/surveying');
    };

    const surveyTimer = new vAPI.SafeAnimationFrame(surveyPhase1);

    // This is to shutdown the surveyor if result of surveying keeps being
    // fruitless. This is useful on long-lived web page. I arbitrarily
    // picked 5 minutes before the surveyor is allowed to shutdown. I also
    // arbitrarily picked 256 misses before the surveyor is allowed to
    // shutdown.
    let canShutdownAfter = Date.now() + 300000,
        surveyingMissCount = 0;

    // Handle main process' response.

    const surveyPhase3 = function(response) {
        const result = response && response.result;
        let mustCommit = false;

        if ( result ) {
            const css = result.injectedCSS;
            if ( typeof css === 'string' && css.length !== 0 ) {
                domFilterer.addCSS(css);
                mustCommit = true;
            }
            const selectors = result.excepted;
            if ( Array.isArray(selectors) && selectors.length !== 0 ) {
                domFilterer.exceptCSSRules(selectors);
            }
        }

        if ( pendingNodes.stopped === false ) {
            if ( pendingNodes.hasNodes() ) {
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
        }

        //console.info('dom surveyor shutting down: too many misses');

        surveyTimer.clear();
        vAPI.domWatcher.removeListener(domWatcherInterface);
        vAPI.domSurveyor = null;
    };

    const domWatcherInterface = {
        onDOMCreated: function() {
            if (
                self.vAPI instanceof Object === false ||
                vAPI.domSurveyor instanceof Object === false ||
                vAPI.domFilterer instanceof Object === false
            ) {
                if ( self.vAPI instanceof Object ) {
                    if ( vAPI.domWatcher instanceof Object ) {
                        vAPI.domWatcher.removeListener(domWatcherInterface);
                    }
                    vAPI.domSurveyor = null;
                }
                return;
            }
            //console.time('dom surveyor/dom layout created');
            domFilterer = vAPI.domFilterer;
            pendingNodes.add(document.querySelectorAll('[id],[class]'));
            surveyTimer.start();
            //console.timeEnd('dom surveyor/dom layout created');
        },
        onDOMChanged: function(addedNodes) {
            if ( addedNodes.length === 0 ) { return; }
            //console.time('dom surveyor/dom layout changed');
            let i = addedNodes.length;
            while ( i-- ) {
                const node = addedNodes[i];
                pendingNodes.add([ node ]);
                if ( node.childElementCount === 0 ) { continue; }
                pendingNodes.add(node.querySelectorAll('[id],[class]'));
            }
            if ( pendingNodes.hasNodes() ) {
                surveyTimer.start(1);
            }
            //console.timeEnd('dom surveyor/dom layout changed');
        }
    };

    const start = function(details) {
        if ( vAPI.domWatcher instanceof Object === false ) { return; }
        hostname = details.hostname;
        vAPI.domWatcher.addListener(domWatcherInterface);
    };

    vAPI.domSurveyor = { start };
}

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// vAPI.bootstrap:
//   Bootstrapping allows all components of the content script
//   to be launched if/when needed.

{
    const bootstrapPhase2 = function() {
        // This can happen on Firefox. For instance:
        // https://github.com/gorhill/uBlock/issues/1893
        if ( window.location === null ) { return; }
        if ( self.vAPI instanceof Object === false ) { return; }

        vAPI.messaging.send('contentscript', {
            what: 'shouldRenderNoscriptTags',
        });

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

        // To be used by element picker/zapper.
        vAPI.mouseClick = { x: -1, y: -1 };

        const onMouseClick = function(ev) {
            if ( ev.isTrusted === false ) { return; }
            vAPI.mouseClick.x = ev.clientX;
            vAPI.mouseClick.y = ev.clientY;

            // https://github.com/chrisaljoudi/uBlock/issues/1143
            //   Find a link under the mouse, to try to avoid confusing new tabs
            //   as nuisance popups.
            // https://github.com/uBlockOrigin/uBlock-issues/issues/777
            //   Mind that href may not be a string.
            const elem = ev.target.closest('a[href]');
            if ( elem === null || typeof elem.href !== 'string' ) { return; }
            vAPI.messaging.send('contentscript', {
                what: 'maybeGoodPopup',
                url: elem.href || '',
            });
        };

        document.addEventListener('mousedown', onMouseClick, true);

        // https://github.com/gorhill/uMatrix/issues/144
        vAPI.shutdown.add(function() {
            document.removeEventListener('mousedown', onMouseClick, true);
        });
    };

    // https://github.com/uBlockOrigin/uBlock-issues/issues/403
    //   If there was a spurious port disconnection -- in which case the
    //   response is expressly set to `null`, rather than undefined or
    //   an object -- let's stay around, we may be given the opportunity
    //   to try bootstrapping again later.

    const bootstrapPhase1 = function(response) {
        if ( response instanceof Object === false ) { return; }

        vAPI.bootstrap = undefined;

        // cosmetic filtering engine aka 'cfe'
        const cfeDetails = response && response.specificCosmeticFilters;
        if ( !cfeDetails || !cfeDetails.ready ) {
            vAPI.domWatcher = vAPI.domCollapser = vAPI.domFilterer =
            vAPI.domSurveyor = vAPI.domIsLoaded = null;
            return;
        }

        vAPI.domCollapser.start();

        if ( response.noCosmeticFiltering ) {
            vAPI.domFilterer = null;
            vAPI.domSurveyor = null;
        } else {
            const domFilterer = vAPI.domFilterer = new vAPI.DOMFilterer();
            if ( response.noGenericCosmeticFiltering || cfeDetails.noDOMSurveying ) {
                vAPI.domSurveyor = null;
            }
            domFilterer.exceptions = cfeDetails.exceptionFilters;
            domFilterer.addCSS(cfeDetails.injectedCSS);
            domFilterer.addProceduralSelectors(cfeDetails.proceduralFilters);
            domFilterer.exceptCSSRules(cfeDetails.exceptedFilters);
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
            document.addEventListener(
                'DOMContentLoaded',
                bootstrapPhase2,
                { once: true }
            );
        }
    };

    vAPI.bootstrap = function() {
        vAPI.messaging.send('contentscript', {
            what: 'retrieveContentScriptParameters',
            url: vAPI.effectiveSelf.location.href,
        }).then(response => {
            bootstrapPhase1(response);
        });
    };
}

// This starts bootstrap process.
vAPI.bootstrap();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

}
// <<<<<<<< end of HUGE-IF-BLOCK

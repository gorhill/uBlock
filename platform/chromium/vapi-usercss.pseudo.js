/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2017-2018 Raymond Hill

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

// Packaging this file is optional: it is not necessary to package it if the
// platform is known to support user stylesheets.

// >>>>>>>> start of HUGE-IF-BLOCK
if ( typeof vAPI === 'object' && vAPI.userStylesheet === undefined ) {

/******************************************************************************/
/******************************************************************************/

vAPI.userStylesheet = {
    style: null,
    styleFixCount: 0,
    css: new Map(),
    disabled: false,
    apply: function() {
    },
    inject: function() {
        this.style = document.createElement('style');
        this.style.disabled = this.disabled;
        const parent = document.head || document.documentElement;
        if ( parent === null ) { return; }
        parent.appendChild(this.style);
        const observer = new MutationObserver(function() {
            if ( this.style === null ) { return; }
            if ( this.style.sheet !== null ) { return; }
            this.styleFixCount += 1;
            if ( this.styleFixCount < 32 ) {
                parent.appendChild(this.style);
            } else {
                observer.disconnect();
            }
        }.bind(this));
        observer.observe(parent, { childList: true });
    },
    add: function(cssText) {
        if ( cssText === '' || this.css.has(cssText) ) { return; }
        if ( this.style === null ) { this.inject(); }
        const sheet = this.style.sheet;
        if ( !sheet ) { return; }
        const i = sheet.cssRules.length;
        sheet.insertRule(cssText, i);
        this.css.set(cssText, sheet.cssRules[i]);
    },
    remove: function(cssText) {
        if ( cssText === '' ) { return; }
        const cssRule = this.css.get(cssText);
        if ( cssRule === undefined ) { return; }
        this.css.delete(cssText);
        if ( this.style === null ) { return; }
        const sheet = this.style.sheet;
        if ( !sheet ) { return; }
        const rules = sheet.cssRules;
        let i = rules.length;
        while ( i-- ) {
            if ( rules[i] !== cssRule ) { continue; }
            sheet.deleteRule(i);
            break;
        }
        if ( rules.length !== 0 ) { return; }
        const style = this.style;
        this.style = null;
        const parent = style.parentNode;
        if ( parent !== null ) {
            parent.removeChild(style);
        }
    },
    toggle: function(state) {
        if ( state === undefined ) { state = this.disabled; }
        if ( state !== this.disabled ) { return; }
        this.disabled = !state;
        if ( this.style !== null ) {
            this.style.disabled = this.disabled;
        }
    }
};

/******************************************************************************/

vAPI.DOMFilterer = class {
    constructor() {
        this.commitTimer = new vAPI.SafeAnimationFrame(this.commitNow.bind(this));
        this.domIsReady = document.readyState !== 'loading';
        this.listeners = [];
        this.excludedNodeSet = new WeakSet();
        this.addedNodes = new Set();
        this.removedNodes = false;

        this.specificSimpleHide = new Set();
        this.specificSimpleHideAggregated = undefined;
        this.addedSpecificSimpleHide = [];
        this.specificComplexHide = new Set();
        this.specificComplexHideAggregated = undefined;
        this.addedSpecificComplexHide = [];
        this.specificOthers = [];
        this.genericSimpleHide = new Set();
        this.genericComplexHide = new Set();
        this.exceptedCSSRules = [];

        this.hideNodeExpando = undefined;
        this.hideNodeBatchProcessTimer = undefined;
        this.hiddenNodeObserver = undefined;
        this.hiddenNodesetToProcess = new Set();
        this.hiddenNodeset = new WeakSet();

        if ( vAPI.domWatcher instanceof Object ) {
            vAPI.domWatcher.addListener(this);
        }

        // https://www.w3.org/community/webed/wiki/CSS/Selectors#Combinators
        this.reCSSCombinators = /[ >+~]/;
    }

    commitNow() {
        this.commitTimer.clear();

        if ( this.domIsReady !== true || vAPI.userStylesheet.disabled ) {
            return;
        }

        // Filterset changed.

        if ( this.addedSpecificSimpleHide.length !== 0 ) {
            //console.time('specific simple filterset changed');
            //console.log('added %d specific simple selectors', this.addedSpecificSimpleHide.length);
            const nodes = document.querySelectorAll(this.addedSpecificSimpleHide.join(','));
            for ( const node of nodes ) {
                this.hideNode(node);
            }
            this.addedSpecificSimpleHide = [];
            this.specificSimpleHideAggregated = undefined;
            //console.timeEnd('specific simple filterset changed');
        }

        if ( this.addedSpecificComplexHide.length !== 0 ) {
            //console.time('specific complex filterset changed');
            //console.log('added %d specific complex selectors', this.addedSpecificComplexHide.length);
            const nodes = document.querySelectorAll(this.addedSpecificComplexHide.join(','));
            for ( const node of nodes ) {
                this.hideNode(node);
            }
            this.addedSpecificComplexHide = [];
            this.specificComplexHideAggregated = undefined;
            //console.timeEnd('specific complex filterset changed');
        }

        // DOM layout changed.

        const domNodesAdded = this.addedNodes.size !== 0;
        const domLayoutChanged = domNodesAdded || this.removedNodes;

        if ( domNodesAdded === false || domLayoutChanged === false ) {
            return;
        }

        //console.log('%d nodes added', this.addedNodes.size);

        if ( this.specificSimpleHide.size !== 0 && domNodesAdded ) {
            //console.time('dom layout changed/specific simple selectors');
            if ( this.specificSimpleHideAggregated === undefined ) {
                this.specificSimpleHideAggregated =
                    Array.from(this.specificSimpleHide).join(',\n');
            }
            for ( const node of this.addedNodes ) {
                if ( node.matches(this.specificSimpleHideAggregated) ) {
                    this.hideNode(node);
                }
                const nodes = node.querySelectorAll(this.specificSimpleHideAggregated);
                for ( const node of nodes ) {
                    this.hideNode(node);
                }
            }
            //console.timeEnd('dom layout changed/specific simple selectors');
        }

        if ( this.specificComplexHide.size !== 0 && domLayoutChanged ) {
            //console.time('dom layout changed/specific complex selectors');
            if ( this.specificComplexHideAggregated === undefined ) {
                this.specificComplexHideAggregated =
                    Array.from(this.specificComplexHide).join(',\n');
            }
            const nodes = document.querySelectorAll(this.specificComplexHideAggregated);
            for ( const node of nodes ) {
                this.hideNode(node);
            }
            //console.timeEnd('dom layout changed/specific complex selectors');
        }

        this.addedNodes.clear();
        this.removedNodes = false;
    }

    commit(now) {
        if ( now ) {
            this.commitTimer.clear();
            this.commitNow();
        } else {
            this.commitTimer.start();
        }
    }

    addCSSRule(selectors, declarations, details = {}) {
        if ( selectors === undefined ) { return; }

        const selectorsStr = Array.isArray(selectors) ?
            selectors.join(',\n') :
            selectors;
        if ( selectorsStr.length === 0 ) { return; }

        vAPI.userStylesheet.add(selectorsStr + '\n{' + declarations + '}');
        this.commit();
        if ( details.silent !== true && this.hasListeners() ) {
            this.triggerListeners({
                declarative: [ [ selectorsStr, declarations ] ]
            });
        }

        if ( declarations !== 'display:none!important;' ) {
            this.specificOthers.push({
                selectors: selectorsStr,
                declarations: declarations
            });
            return;
        }

        const isGeneric= details.lazy === true;
        const isSimple = details.type === 'simple';
        const isComplex = details.type === 'complex';

        if ( isGeneric ) {
            if ( isSimple ) {
                this.genericSimpleHide.add(selectorsStr);
                return;
            }
            if ( isComplex ) {
                this.genericComplexHide.add(selectorsStr);
                return;
            }
        }

        const selectorsArr = Array.isArray(selectors) ?
            selectors :
            selectors.split(',\n');

        if ( isGeneric ) {
            for ( const selector of selectorsArr ) {
                if ( this.reCSSCombinators.test(selector) ) {
                    this.genericComplexHide.add(selector);
                } else {
                    this.genericSimpleHide.add(selector);
                }
            }
            return;
        }

        // Specific cosmetic filters.
        for ( const selector of selectorsArr ) {
            if (
                isComplex ||
                isSimple === false && this.reCSSCombinators.test(selector)
            ) {
                if ( this.specificComplexHide.has(selector) === false ) {
                    this.specificComplexHide.add(selector);
                    this.addedSpecificComplexHide.push(selector);
                }
            } else if ( this.specificSimpleHide.has(selector) === false ) {
                this.specificSimpleHide.add(selector);
                this.addedSpecificSimpleHide.push(selector);
            }
        }
    }

    exceptCSSRules(exceptions) {
        if ( exceptions.length === 0 ) { return; }
        this.exceptedCSSRules.push(...exceptions);
        if ( this.hasListeners() ) {
            this.triggerListeners({ exceptions });
        }
    }

    onDOMCreated() {
        this.domIsReady = true;
        this.addedNodes.clear();
        this.removedNodes = false;
        this.commit();
    }

    onDOMChanged(addedNodes, removedNodes) {
        for ( const node of addedNodes ) {
            this.addedNodes.add(node);
        }
        this.removedNodes = this.removedNodes || removedNodes;
        this.commit();
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
    hideNodeBatchProcess() {
        this.hideNodeBatchProcessTimer.clear();
        const expando = this.hideNodeExpando;
        for ( const node of this.hiddenNodesetToProcess ) {
            if (
                this.hiddenNodeset.has(node) === false ||
                node[expando] === undefined ||
                node.clientHeight === 0 || node.clientWidth === 0
            ) {
                continue;
            }
            let attr = node.getAttribute('style');
            if ( attr === null ) {
                attr = '';
            } else if (
                attr.length !== 0 &&
                attr.charCodeAt(attr.length - 1) !== 0x3B /* ';' */
            ) {
                attr += ';';
            }
            node.setAttribute('style', attr + 'display:none!important;');
        }
        this.hiddenNodesetToProcess.clear();
    }

    hideNodeObserverHandler(mutations) {
        if ( vAPI.userStylesheet.disabled ) { return; }
        const stagedNodes = this.hiddenNodesetToProcess;
        for ( const mutation of mutations ) {
            stagedNodes.add(mutation.target);
        }
        this.hideNodeBatchProcessTimer.start();
    }

    hideNodeInit() {
        this.hideNodeExpando = vAPI.randomToken();
        this.hideNodeBatchProcessTimer =
            new vAPI.SafeAnimationFrame(this.hideNodeBatchProcess.bind(this));
        this.hiddenNodeObserver =
            new MutationObserver(this.hideNodeObserverHandler.bind(this));
        if ( this.hideNodeStyleSheetInjected === false ) {
            this.hideNodeStyleSheetInjected = true;
            vAPI.userStylesheet.add(
                `[${this.hideNodeAttr}]\n{display:none!important;}`
            );
        }
    }

    excludeNode(node) {
        this.excludedNodeSet.add(node);
        this.unhideNode(node);
    }

    unexcludeNode(node) {
        this.excludedNodeSet.delete(node);
    }

    hideNode(node) {
        if ( this.excludedNodeSet.has(node) ) { return; }
        if ( this.hideNodeAttr === undefined ) { return; }
        if ( this.hiddenNodeset.has(node) ) { return; }
        node.hidden = true;
        this.hiddenNodeset.add(node);
        if ( this.hideNodeExpando === undefined ) { this.hideNodeInit(); }
        node.setAttribute(this.hideNodeAttr, '');
        if ( node[this.hideNodeExpando] === undefined ) {
            node[this.hideNodeExpando] =
                node.hasAttribute('style') &&
               (node.getAttribute('style') || '');
        }
        this.hiddenNodesetToProcess.add(node);
        this.hideNodeBatchProcessTimer.start();
        this.hiddenNodeObserver.observe(node, this.hiddenNodeObserverOptions);
    }

    unhideNode(node) {
        if ( this.hiddenNodeset.has(node) === false ) { return; }
        node.hidden = false;
        node.removeAttribute(this.hideNodeAttr);
        this.hiddenNodesetToProcess.delete(node);
        if ( this.hideNodeExpando === undefined ) { return; }
        const attr = node[this.hideNodeExpando];
        if ( attr === false ) {
            node.removeAttribute('style');
        } else if ( typeof attr === 'string' ) {
            node.setAttribute('style', attr);
        }
        node[this.hideNodeExpando] = undefined;
        this.hiddenNodeset.delete(node);
    }

    showNode(node) {
        node.hidden = false;
        const attr = node[this.hideNodeExpando];
        if ( attr === false ) {
            node.removeAttribute('style');
        } else if ( typeof attr === 'string' ) {
            node.setAttribute('style', attr);
        }
    }

    unshowNode(node) {
        node.hidden = true;
        this.hiddenNodesetToProcess.add(node);
    }

    toggle(state, callback) {
        vAPI.userStylesheet.toggle(state);
        const disabled = vAPI.userStylesheet.disabled;
        const nodes = document.querySelectorAll(`[${this.hideNodeAttr}]`);
        for ( const node of nodes ) {
            if ( disabled ) {
                this.showNode(node);
            } else {
                this.unshowNode(node);
            }
        }
        if ( disabled === false && this.hideNodeExpando !== undefined ) {
            this.hideNodeBatchProcessTimer.start();
        }
        if ( typeof callback === 'function' ) {
            callback();
        }
    }

    getAllSelectors_(all) {
        const out = {
            declarative: [],
            exceptions: this.exceptedCSSRules,
        };
        if ( this.specificSimpleHide.size !== 0 ) {
            out.declarative.push([
                Array.from(this.specificSimpleHide).join(',\n'),
                'display:none!important;'
            ]);
        }
        if ( this.specificComplexHide.size !== 0 ) {
            out.declarative.push([
                Array.from(this.specificComplexHide).join(',\n'),
                'display:none!important;'
            ]);
        }
        if ( this.genericSimpleHide.size !== 0 ) {
            out.declarative.push([
                Array.from(this.genericSimpleHide).join(',\n'),
                'display:none!important;'
            ]);
        }
        if ( this.genericComplexHide.size !== 0 ) {
            out.declarative.push([
                Array.from(this.genericComplexHide).join(',\n'),
                'display:none!important;'
            ]);
        }
        if ( all ) {
            out.declarative.push([
                '[' + this.hideNodeAttr + ']',
                'display:none!important;'
            ]);
        }
        for ( const entry of this.specificOthers ) {
            out.declarative.push([ entry.selectors, entry.declarations ]);
        }
        return out;
    }

    getFilteredElementCount() {
        const details = this.getAllSelectors_(true);
        if ( Array.isArray(details.declarative) === false ) { return 0; }
        const selectors = details.declarative.map(entry => entry[0]);
        if ( selectors.length === 0 ) { return 0; }
        return document.querySelectorAll(selectors.join(',\n')).length;
    }

    getAllSelectors() {
        return this.getAllSelectors_(false);
    }
};

vAPI.DOMFilterer.prototype.hiddenNodeObserverOptions = {
    attributes: true,
    attributeFilter: [ 'style' ]
};

/******************************************************************************/
/******************************************************************************/

}
// <<<<<<<< end of HUGE-IF-BLOCK








/*******************************************************************************

    DO NOT:
    - Remove the following code
    - Add code beyond the following code
    Reason:
    - https://github.com/gorhill/uBlock/pull/3721
    - uBO never uses the return value from injected content scripts

**/

void 0;

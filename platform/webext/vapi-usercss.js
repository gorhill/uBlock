/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2017 Raymond Hill

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

// For content pages

if ( typeof vAPI === 'object' ) { // >>>>>>>> start of HUGE-IF-BLOCK

/******************************************************************************/
/******************************************************************************/

vAPI.userStylesheet = {
    added: new Set(),
    removed: new Set(),
    apply: function() {
        if ( this.added.size === 0 && this.removed.size === 0 ) { return; }
        vAPI.messaging.send('vapi-background', {
            what: 'userCSS',
            add: Array.from(this.added),
            remove: Array.from(this.removed)
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

vAPI.DOMFilterer = function() {
    this.commitTimer = new vAPI.SafeAnimationFrame(this.commitNow.bind(this));
    this.domIsReady = document.readyState !== 'loading';
    this.disabled = false;
    this.listeners = [];
    this.filterset = new Set();
    this.hideNodeId = vAPI.randomToken();
    this.hideNodeStylesheet = false;
    this.excludedNodeSet = new WeakSet();
    this.addedCSSRules = new Set();

    if ( this.domIsReady !== true ) {
        document.addEventListener('DOMContentLoaded', () => {
            this.domIsReady = true;
            this.commit();
        });
    }
};

vAPI.DOMFilterer.prototype = {
    reOnlySelectors: /\n\{[^\n]+/g,

    // Here we will deal with:
    // - Injecting low priority user styles;
    // - Notifying listeners about changed filterset.
    commitNow: function() {
        this.commitTimer.clear();
        var userStylesheet = vAPI.userStylesheet,
            addedSelectors = [];
        for ( var entry of this.addedCSSRules ) {
            if (
                this.disabled === false &&
                entry.lazy &&
                entry.injected === false
            ) {
                userStylesheet.add(
                    entry.selectors + '\n{' + entry.declarations + '}'
                );
            }
            addedSelectors.push(entry.selectors);
        }
        this.addedCSSRules.clear();
        userStylesheet.apply();
        if ( addedSelectors.length !== 0 ) {
            this.triggerListeners('declarative', addedSelectors.join(',\n'));
        }
    },

    commit: function(commitNow) {
        if ( commitNow ) {
            this.commitTimer.clear();
            this.commitNow();
        } else {
            this.commitTimer.start();
        }
    },

    addCSSRule: function(selectors, declarations, details) {
        if ( selectors === undefined ) { return; }
        var selectorsStr = Array.isArray(selectors)
                ? selectors.join(',\n')
                : selectors;
        if ( selectorsStr.length === 0 ) { return; }
        if ( details === undefined ) { details = {}; }
        var entry = {
            selectors: selectorsStr,
            declarations,
            lazy: details.lazy === true,
            internal: details.internal === true,
            injected: details.injected === true
        };
        this.addedCSSRules.add(entry);
        this.filterset.add(entry);
        if (
            this.disabled === false &&
            entry.lazy !== true &&
            entry.injected !== true
        ) {
            vAPI.userStylesheet.add(selectorsStr + '\n{' + declarations + '}');
        }
        this.commit();
    },

    addListener: function(listener) {
        if ( this.listeners.indexOf(listener) !== -1 ) { return; }
        this.listeners.push(listener);
    },

    removeListener: function(listener) {
        var pos = this.listeners.indexOf(listener);
        if ( pos === -1 ) { return; }
        this.listeners.splice(pos, 1);
    },

    triggerListeners: function(type, selectors) {
        var i = this.listeners.length;
        while ( i-- ) {
            this.listeners[i].onFiltersetChanged(type, selectors);
        }
    },

    excludeNode: function(node) {
        this.excludedNodeSet.add(node);
        this.unhideNode(node);
    },

    unexcludeNode: function(node) {
        this.excludedNodeSet.delete(node);
    },

    hideNode: function(node) {
        if ( this.excludedNodeSet.has(node) ) { return; }
        node.setAttribute(this.hideNodeId, '');
        if ( this.hideNodeStylesheet === false ) {
            this.hideNodeStylesheet = true;
            this.addCSSRule(
                '[' + this.hideNodeId + ']',
                'display:none!important;',
                { internal: true }
            );
        }
    },

    unhideNode: function(node) {
        node.removeAttribute(this.hideNodeId);
    },

    toggle: function(state) {
        if ( state === undefined ) { state = this.disabled; }
        if ( state !== this.disabled ) { return; }
        this.disabled = !state;
        var userStylesheet = vAPI.userStylesheet;
        for ( var entry of this.filterset ) {
            var rule = entry.selectors + '\n{' + entry.declarations + '}';
            if ( this.disabled ) {
                userStylesheet.remove(rule);
            } else {
                userStylesheet.add(rule);
            }
        }
        userStylesheet.apply();
    },

    getAllDeclarativeSelectors_: function(all) {
        let selectors = [];
        for ( var entry of this.filterset ) {
            if ( all === false && entry.internal ) { continue; }
            selectors.push(entry.selectors);
        }
        return selectors.join(',\n');
    },

    getFilteredElementCount: function() {
        let selectors = this.getAllDeclarativeSelectors_(true);
        return selectors.length !== 0
            ? document.querySelectorAll(selectors).length
            : 0;
    },

    getAllDeclarativeSelectors: function() {
        return this.getAllDeclarativeSelectors_(false);
    }
};

/******************************************************************************/
/******************************************************************************/

} // <<<<<<<< end of HUGE-IF-BLOCK

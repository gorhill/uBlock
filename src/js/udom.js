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

/* global DOMTokenList */
/* exported uDom */

/******************************************************************************/

// It's just a silly, minimalist DOM framework: this allows me to not rely
// on jQuery. jQuery contains way too much stuff than I need, and as per
// Opera rules, I am not allowed to use a cut-down version of jQuery. So
// the code here does *only* what I need, and nothing more, and with a lot
// of assumption on passed parameters, etc. I grow it on a per-need-basis only.

var uDom = (function() {

'use strict';

/******************************************************************************/

var DOMList = function() {
    this.nodes = [];
};

/******************************************************************************/

Object.defineProperty(
    DOMList.prototype,
    'length',
    {
        get: function() {
            return this.nodes.length;
        }
    }
);

/******************************************************************************/

var DOMListFactory = function(selector, context) {
    var r = new DOMList();
    if ( typeof selector === 'string' ) {
        selector = selector.trim();
        if ( selector !== '' ) {
            return addSelectorToList(r, selector, context);
        }
    }
    if ( selector instanceof Node ) {
        return addNodeToList(r, selector);
    }
    if ( selector instanceof NodeList ) {
        return addNodeListToList(r, selector);
    }
    if ( selector instanceof DOMList ) {
        return addListToList(r, selector);
    }
    return r;
};

/******************************************************************************/

DOMListFactory.onLoad = function(callback) {
    window.addEventListener('load', callback);
};

/******************************************************************************/

DOMListFactory.nodeFromId = function(id) {
    return document.getElementById(id);
};

DOMListFactory.nodeFromSelector = function(selector) {
    return document.querySelector(selector);
};

/******************************************************************************/

var addNodeToList = function(list, node) {
    if ( node ) {
        list.nodes.push(node);
    }
    return list;
};

/******************************************************************************/

var addNodeListToList = function(list, nodelist) {
    if ( nodelist ) {
        var n = nodelist.length;
        for ( var i = 0; i < n; i++ ) {
            list.nodes.push(nodelist[i]);
        }
    }
    return list;
};

/******************************************************************************/

var addListToList = function(list, other) {
    list.nodes = list.nodes.concat(other.nodes);
    return list;
};

/******************************************************************************/

var addSelectorToList = function(list, selector, context) {
    var p = context || document;
    var r = p.querySelectorAll(selector);
    var n = r.length;
    for ( var i = 0; i < n; i++ ) {
        list.nodes.push(r[i]);
    }
    return list;
};

/******************************************************************************/

var nodeInNodeList = function(node, nodeList) {
    var i = nodeList.length;
    while ( i-- ) {
        if ( nodeList[i] === node ) {
            return true;
        }
    }
    return false;
};

/******************************************************************************/

var doesMatchSelector = function(node, selector) {
    if ( !node ) {
        return false;
    }
    if ( node.nodeType !== 1 ) {
        return false;
    }
    if ( selector === undefined ) {
        return true;
    }
    var parentNode = node.parentNode;
    if ( !parentNode || !parentNode.setAttribute ) {
        return false;
    }
    var doesMatch = false;
    parentNode.setAttribute('uDom-32kXc6xEZA7o73AMB8vLbLct1RZOkeoO', '');
    var grandpaNode = parentNode.parentNode || document;
    var nl = grandpaNode.querySelectorAll('[uDom-32kXc6xEZA7o73AMB8vLbLct1RZOkeoO] > ' + selector);
    var i = nl.length;
    while ( doesMatch === false && i-- ) {
        doesMatch = nl[i] === node;
    }
    parentNode.removeAttribute('uDom-32kXc6xEZA7o73AMB8vLbLct1RZOkeoO');
    return doesMatch;
};

/******************************************************************************/

DOMList.prototype.nodeAt = function(i) {
    return this.nodes[i] || null;
};

DOMList.prototype.at = function(i) {
    return addNodeToList(new DOMList(), this.nodes[i]);
};

/******************************************************************************/

DOMList.prototype.toArray = function() {
    return this.nodes.slice();
};

/******************************************************************************/

DOMList.prototype.pop = function() {
    return addNodeToList(new DOMList(), this.nodes.pop());
};

/******************************************************************************/

DOMList.prototype.forEach = function(fn) {
    var n = this.nodes.length;
    for ( var i = 0; i < n; i++ ) {
        fn(this.at(i), i);
    }
    return this;
};

/******************************************************************************/

DOMList.prototype.subset = function(i, l) {
    var r = new DOMList();
    var n = l !== undefined ? l : this.nodes.length;
    var j = Math.min(i + n, this.nodes.length);
    if ( i < j ) {
        r.nodes = this.nodes.slice(i, j);
    }
    return r;
};

/******************************************************************************/

DOMList.prototype.first = function() {
    return this.subset(0, 1);
};

/******************************************************************************/

DOMList.prototype.next = function(selector) {
    var r = new DOMList();
    var n = this.nodes.length;
    var node;
    for ( var i = 0; i < n; i++ ) {
        node = this.nodes[i];
        while ( node.nextSibling !== null ) {
            node = node.nextSibling;
            if ( node.nodeType !== 1 ) {
                continue;
            }
            if ( doesMatchSelector(node, selector) === false ) {
                continue;
            }
            addNodeToList(r, node);
            break;
        }
    }
    return r;
};

/******************************************************************************/

DOMList.prototype.parent = function() {
    var r = new DOMList();
    if ( this.nodes.length ) {
        addNodeToList(r, this.nodes[0].parentNode);
    }
    return r;
};

/******************************************************************************/

DOMList.prototype.filter = function(filter) {
    var r = new DOMList();
    var filterFunc;
    if ( typeof filter === 'string' ) {
        filterFunc = function() {
            return doesMatchSelector(this, filter);
        };
    } else if ( typeof filter === 'function' ) {
        filterFunc = filter;
    } else {
        filterFunc = function(){
            return true;
        };
    }
    var n = this.nodes.length;
    var node;
    for ( var i = 0; i < n; i++ ) {
        node = this.nodes[i];
        if ( filterFunc.apply(node) ) {
            addNodeToList(r, node);
        }
    }
    return r;
};

/******************************************************************************/

// TODO: Avoid possible duplicates

DOMList.prototype.ancestors = function(selector) {
    var r = new DOMList();
    var n = this.nodes.length;
    var node;
    for ( var i = 0; i < n; i++ ) {
        node = this.nodes[i].parentNode;
        while ( node ) {
            if ( doesMatchSelector(node, selector) ) {
                addNodeToList(r, node);
            }
            node = node.parentNode;
        }
    }
    return r;
};

/******************************************************************************/

DOMList.prototype.descendants = function(selector) {
    var r = new DOMList();
    var n = this.nodes.length;
    var nl;
    for ( var i = 0; i < n; i++ ) {
        nl = this.nodes[i].querySelectorAll(selector);
        addNodeListToList(r, nl);
    }
    return r;
};

/******************************************************************************/

DOMList.prototype.contents = function() {
    var r = new DOMList();
    var cnodes, cn, ci;
    var n = this.nodes.length;
    for ( var i = 0; i < n; i++ ) {
        cnodes = this.nodes[i].childNodes;
        cn = cnodes.length;
        for ( ci = 0; ci < cn; ci++ ) {
            addNodeToList(r, cnodes.item(ci));
        }
    }
    return r;
};

/******************************************************************************/

DOMList.prototype.remove = function() {
    var cn, p;
    var i = this.nodes.length;
    while ( i-- ) {
        cn = this.nodes[i];
        if ( (p = cn.parentNode) ) {
            p.removeChild(cn);
        }
     }
    return this;
};

DOMList.prototype.detach = DOMList.prototype.remove;

/******************************************************************************/

DOMList.prototype.empty = function() {
    var node;
    var i = this.nodes.length;
    while ( i-- ) {
        node = this.nodes[i];
        while ( node.firstChild ) {
            node.removeChild(node.firstChild);
        }
    }
    return this;
};

/******************************************************************************/

DOMList.prototype.append = function(selector, context) {
    var p = this.nodes[0];
    if ( p ) {
        var c = DOMListFactory(selector, context);
        var n = c.nodes.length;
        for ( var i = 0; i < n; i++ ) {
            p.appendChild(c.nodes[i]);
        }
    }
    return this;
};

/******************************************************************************/

DOMList.prototype.prepend = function(selector, context) {
    var p = this.nodes[0];
    if ( p ) {
        var c = DOMListFactory(selector, context);
        var i = c.nodes.length;
        while ( i-- ) {
            p.insertBefore(c.nodes[i], p.firstChild);
        }
    }
    return this;
};

/******************************************************************************/

DOMList.prototype.appendTo = function(selector, context) {
    var p = selector instanceof DOMListFactory ? selector : DOMListFactory(selector, context);
    var n = p.length;
    for ( var i = 0; i < n; i++ ) {
        p.nodes[0].appendChild(this.nodes[i]);
    }
    return this;
};

/******************************************************************************/

DOMList.prototype.insertAfter = function(selector, context) {
    if ( this.nodes.length === 0 ) {
        return this;
    }
    var p = this.nodes[0].parentNode;
    if ( !p ) {
        return this;
    }
    var c = DOMListFactory(selector, context);
    var n = c.nodes.length;
    for ( var i = 0; i < n; i++ ) {
        p.appendChild(c.nodes[i]);
    }
    return this;
};

/******************************************************************************/

DOMList.prototype.insertBefore = function(selector, context) {
    if ( this.nodes.length === 0 ) {
        return this;
    }
    var referenceNodes = DOMListFactory(selector, context);
    if ( referenceNodes.nodes.length === 0 ) {
        return this;
    }
    var referenceNode = referenceNodes.nodes[0];
    var parentNode = referenceNode.parentNode;
    if ( !parentNode ) {
        return this;
    }
    var n = this.nodes.length;
    for ( var i = 0; i < n; i++ ) {
        parentNode.insertBefore(this.nodes[i], referenceNode);
    }
    return this;
};

/******************************************************************************/

DOMList.prototype.clone = function(notDeep) {
    var r = new DOMList();
    var n = this.nodes.length;
    for ( var i = 0; i < n; i++ ) {
        addNodeToList(r, this.nodes[i].cloneNode(!notDeep));
    }
    return r;
};

/******************************************************************************/

DOMList.prototype.nthOfType = function() {
    if ( this.nodes.length === 0 ) {
        return 0;
    }
    var node = this.nodes[0];
    var tagName = node.tagName;
    var i = 1;
    while ( node.previousElementSibling !== null ) {
        node = node.previousElementSibling;
        if ( typeof node.tagName !== 'string' ) {
            continue;
        }
        if ( node.tagName !== tagName ) {
            continue;
        }
        i++;
    }
    return i;
};

/******************************************************************************/

DOMList.prototype.attr = function(attr, value) {
    var i = this.nodes.length;
    if ( value === undefined && typeof attr !== 'object' ) {
        return i ? this.nodes[0].getAttribute(attr) : undefined;
    }
    if ( typeof attr === 'object' ) {
        var attrNames = Object.keys(attr);
        var node, j, attrName;
        while ( i-- ) {
            node = this.nodes[i];
            j = attrNames.length;
            while ( j-- ) {
                attrName = attrNames[j];
                node.setAttribute(attrName, attr[attrName]);
            }
        }
    } else {
        while ( i-- ) {
            this.nodes[i].setAttribute(attr, value);
        }
    }
    return this;
};

/******************************************************************************/

DOMList.prototype.prop = function(prop, value) {
    var i = this.nodes.length;
    if ( value === undefined ) {
        return i !== 0 ? this.nodes[0][prop] : undefined;
    }
    while ( i-- ) {
        this.nodes[i][prop] = value;
    }
    return this;
};

/******************************************************************************/

DOMList.prototype.css = function(prop, value) {
    var i = this.nodes.length;
    if ( value === undefined ) {
        return i ? this.nodes[0].style[prop] : undefined;
    }
    if ( value !== '' ) {
        while ( i-- ) {
            this.nodes[i].style.setProperty(prop, value);
        }
        return this;
    }
    while ( i-- ) {
        this.nodes[i].style.removeProperty(prop);
    }
    return this;
};

/******************************************************************************/

DOMList.prototype.val = function(value) {
    return this.prop('value', value);
};

/******************************************************************************/

DOMList.prototype.html = function(html) {
    var i = this.nodes.length;
    if ( html === undefined ) {
        return i ? this.nodes[0].innerHTML : '';
    }
    while ( i-- ) {
        vAPI.insertHTML(this.nodes[i], html);
    }
    return this;
};

/******************************************************************************/

DOMList.prototype.text = function(text) {
    var i = this.nodes.length;
    if ( text === undefined ) {
        return i ? this.nodes[0].textContent : '';
    }
    while ( i-- ) {
        this.nodes[i].textContent = text;
    }
    return this;
};

/******************************************************************************/

var toggleClass = function(node, className, targetState) {
    var tokenList = node.classList;
    if ( tokenList instanceof DOMTokenList === false ) {
        return;
    }
    var currentState = tokenList.contains(className);
    var newState = targetState;
    if ( newState === undefined ) {
        newState = !currentState;
    }
    if ( newState === currentState ) {
        return;
    }
    tokenList.toggle(className, newState);
};

/******************************************************************************/

DOMList.prototype.hasClass = function(className) {
    if ( !this.nodes.length ) {
        return false;
    }
    var tokenList = this.nodes[0].classList;
    return tokenList instanceof DOMTokenList &&
           tokenList.contains(className);
};
DOMList.prototype.hasClassName = DOMList.prototype.hasClass;

DOMList.prototype.addClass = function(className) {
    return this.toggleClass(className, true);
};

DOMList.prototype.removeClass = function(className) {
    if ( className !== undefined ) {
        return this.toggleClass(className, false);
    }
    var i = this.nodes.length;
    while ( i-- ) {
        this.nodes[i].className = '';
    }
    return this;
};

/******************************************************************************/

DOMList.prototype.toggleClass = function(className, targetState) {
    if ( className.indexOf(' ') !== -1 ) {
        return this.toggleClasses(className, targetState);
    }
    var i = this.nodes.length;
    while ( i-- ) {
        toggleClass(this.nodes[i], className, targetState);
    }
    return this;
};

/******************************************************************************/

DOMList.prototype.toggleClasses = function(classNames, targetState) {
    var tokens = classNames.split(/\s+/);
    var i = this.nodes.length;
    var node, j;
    while ( i-- ) {
        node = this.nodes[i];
        j = tokens.length;
        while ( j-- ) {
            toggleClass(node, tokens[j], targetState);
        }
    }
    return this;
};

/******************************************************************************/

var listenerEntries = [];

var ListenerEntry = function(target, type, capture, callback) {
    this.target = target;
    this.type = type;
    this.capture = capture;
    this.callback = callback;
    target.addEventListener(type, callback, capture);
};

ListenerEntry.prototype.dispose = function() {
    this.target.removeEventListener(this.type, this.callback, this.capture);
    this.target = null;
    this.callback = null;
};

/******************************************************************************/

var makeEventHandler = function(selector, callback) {
    return function(event) {
        var dispatcher = event.currentTarget;
        if ( !dispatcher || typeof dispatcher.querySelectorAll !== 'function' ) {
            return;
        }
        var receiver = event.target;
        if ( nodeInNodeList(receiver, dispatcher.querySelectorAll(selector)) ) {
            callback.call(receiver, event);
        }
    };
};

DOMList.prototype.on = function(etype, selector, callback) {
    if ( typeof selector === 'function' ) {
        callback = selector;
        selector = undefined;
    } else {
        callback = makeEventHandler(selector, callback);
    }

    var i = this.nodes.length;
    while ( i-- ) {
        listenerEntries.push(new ListenerEntry(this.nodes[i], etype, selector !== undefined, callback));
    }
    return this;
};

/******************************************************************************/

// TODO: Won't work for delegated handlers. Need to figure
// what needs to be done.

DOMList.prototype.off = function(evtype, callback) {
    var i = this.nodes.length;
    while ( i-- ) {
        this.nodes[i].removeEventListener(evtype, callback);
    }
    return this;
};

/******************************************************************************/

DOMList.prototype.trigger = function(etype) {
    var ev = new CustomEvent(etype);
    var i = this.nodes.length;
    while ( i-- ) {
        this.nodes[i].dispatchEvent(ev);
    }
    return this;
};

/******************************************************************************/

// Cleanup

var onBeforeUnload = function() {
    var entry;
    while ( (entry = listenerEntries.pop()) ) {
        entry.dispose();
    }
    window.removeEventListener('beforeunload', onBeforeUnload);
};

window.addEventListener('beforeunload', onBeforeUnload);

/******************************************************************************/

return DOMListFactory;

})();

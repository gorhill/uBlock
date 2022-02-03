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

/* global DOMTokenList */
/* exported uDom */

'use strict';

/******************************************************************************/

// It's just a silly, minimalist DOM framework: this allows me to not rely
// on jQuery. jQuery contains way too much stuff than I need, and as per
// Opera rules, I am not allowed to use a cut-down version of jQuery. So
// the code here does *only* what I need, and nothing more, and with a lot
// of assumption on passed parameters, etc. I grow it on a per-need-basis only.

const uDom = (( ) => {

/******************************************************************************/

const DOMList = class {
    constructor() {
        this.nodes = [];
    }
    get length() {
        return this.nodes.length;
    }
};

/******************************************************************************/

const DOMListFactory = function(selector, context) {
    const r = new DOMList();
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

DOMListFactory.root = document.querySelector(':root');

/******************************************************************************/

DOMListFactory.setTheme = function(theme, propagate = false) {
    if ( theme === 'auto' ) {
        if ( typeof self.matchMedia === 'function' ) {
            const mql = self.matchMedia('(prefers-color-scheme: dark)');
            theme = mql instanceof Object && mql.matches === true
                ? 'dark'
                : 'light';
        } else {
            theme = 'light';
        }
    }
    let w = self;
    for (;;) {
        const rootcl = w.document.documentElement.classList;
        if ( theme === 'dark' ) {
            rootcl.add('dark');
            rootcl.remove('light');
        } else /* if ( theme === 'light' ) */ {
            rootcl.add('light');
            rootcl.remove('dark');
        }
        if ( propagate === false ) { break; }
        if ( w === w.parent ) { break; }
        w = w.parent;
        try { void w.document; } catch(ex) { return; }
    }
};

DOMListFactory.setAccentColor = function(
    accentEnabled,
    accentColor,
    propagate,
    stylesheet = ''
) {
    if ( accentEnabled && stylesheet === '' && self.hsluv !== undefined ) {
        const toRGB = hsl => self.hsluv.hsluvToRgb(hsl).map(a => Math.round(a * 255)).join(' ');
        // Normalize first
        const hsl = self.hsluv.hexToHsluv(accentColor);
        hsl[0] = Math.round(hsl[0] * 10) / 10;
        hsl[1] = Math.round(Math.min(100, Math.max(0, hsl[1])));
        // Use normalized result to derive all shades
        const shades = [ 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95 ];
        const text = [];
        text.push(':root.accented {');
        for ( const shade of shades ) {
            hsl[2] = shade;
            text.push(`   --primary-${shade}: ${toRGB(hsl)};`);
        }
        text.push('}');
        hsl[1] = Math.min(25, hsl[1]);
        hsl[2] = 80;
        text.push(
            ':root.light.accented {',
            `    --button-surface-rgb: ${toRGB(hsl)};`,
            '}',
        );
        hsl[2] = 30;
        text.push(
            ':root.dark.accented {',
            `    --button-surface-rgb: ${toRGB(hsl)};`,
            '}',
        );
        text.push('');
        stylesheet = text.join('\n');
        vAPI.messaging.send('uDom', { what: 'uiAccentStylesheet', stylesheet });
    }
    let w = self;
    for (;;) {
        const wdoc = w.document;
        let style = wdoc.querySelector('style#accentColors');
        if ( style !== null ) { style.remove(); }
        if ( accentEnabled ) {
            style = wdoc.createElement('style');
            style.id = 'accentColors';
            style.textContent = stylesheet;
            wdoc.head.append(style);
            wdoc.documentElement.classList.add('accented');
        } else {
            wdoc.documentElement.classList.remove('accented');
        }
        if ( propagate === false ) { break; }
        if ( w === w.parent ) { break; }
        w = w.parent;
        try { void w.document; } catch(ex) { break; }
    }
};

{
    // https://github.com/uBlockOrigin/uBlock-issues/issues/1044
    //   Offer the possibility to bypass uBO's default styling
    vAPI.messaging.send('uDom', { what: 'uiStyles' }).then(response => {
        if ( typeof response !== 'object' || response === null ) { return; }
        uDom.setTheme(response.uiTheme);
        if ( response.uiAccentCustom ) {
            uDom.setAccentColor(
                true,
                response.uiAccentCustom0,
                false,
                response.uiAccentStylesheet
            );
        }
        if ( response.uiStyles !== 'unset' ) {
            document.body.style.cssText = response.uiStyles;
        }
    });

    const rootcl = DOMListFactory.root.classList;
    if ( vAPI.webextFlavor.soup.has('mobile') ) {
        rootcl.add('mobile');
    } else {
        rootcl.add('desktop');
    }
    if ( window.matchMedia('(min-resolution: 150dpi)').matches ) {
        rootcl.add('hidpi');
    }
}

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

const addNodeToList = function(list, node) {
    if ( node ) {
        list.nodes.push(node);
    }
    return list;
};

/******************************************************************************/

const addNodeListToList = function(list, nodelist) {
    if ( nodelist ) {
        var n = nodelist.length;
        for ( var i = 0; i < n; i++ ) {
            list.nodes.push(nodelist[i]);
        }
    }
    return list;
};

/******************************************************************************/

const addListToList = function(list, other) {
    list.nodes = list.nodes.concat(other.nodes);
    return list;
};

/******************************************************************************/

const addSelectorToList = function(list, selector, context) {
    var p = context || document;
    var r = p.querySelectorAll(selector);
    var n = r.length;
    for ( var i = 0; i < n; i++ ) {
        list.nodes.push(r[i]);
    }
    return list;
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
            if ( node.nodeType !== 1 ) { continue; }
            if ( node.matches(selector) === false ) { continue; }
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
            return this.matches(filter);
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
    for ( var i = 0, n = this.nodes.length; i < n; i++ ) {
        var node = this.nodes[i].parentNode;
        while ( node ) {
            if (
                node instanceof Element &&
                node.matches(selector)
            ) {
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

DOMList.prototype.removeAttr = function(attr) {
    var i = this.nodes.length;
    while ( i-- ) {
        this.nodes[i].removeAttribute(attr);
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

const toggleClass = function(node, className, targetState) {
    const tokenList = node.classList;
    if ( tokenList instanceof DOMTokenList === false ) { return; }
    const currentState = tokenList.contains(className);
    const newState = targetState !== undefined ? targetState : !currentState;
    if ( newState === currentState ) { return; }
    tokenList.toggle(className, newState);
};

/******************************************************************************/

DOMList.prototype.hasClass = function(className) {
    if ( !this.nodes.length ) {
        return false;
    }
    const tokenList = this.nodes[0].classList;
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
    for ( const node of this.nodes ) {
        node.className = '';
    }
    return this;
};

/******************************************************************************/

DOMList.prototype.toggleClass = function(className, targetState) {
    if ( className.indexOf(' ') !== -1 ) {
        return this.toggleClasses(className, targetState);
    }
    for ( const node of this.nodes ) {
        toggleClass(node, className, targetState);
    }
    return this;
};

/******************************************************************************/

DOMList.prototype.toggleClasses = function(classNames, targetState) {
    const tokens = classNames.split(/\s+/);
    for ( const node of this.nodes ) {
        for ( const token of tokens ) {
            toggleClass(node, token, targetState);
        }
    }
    return this;
};

/******************************************************************************/

const listenerEntries = [];

const ListenerEntry = function(target, type, capture, callback) {
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

const makeEventHandler = function(selector, callback) {
    return function(event) {
        const dispatcher = event.currentTarget;
        if (
            dispatcher instanceof HTMLElement === false ||
            typeof dispatcher.querySelectorAll !== 'function'
        ) {
            return;
        }
        const receiver = event.target;
        const ancestor = receiver.closest(selector);
        if (
            ancestor === receiver &&
            ancestor !== dispatcher &&
            dispatcher.contains(ancestor)
        ) {
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

    for ( const node of this.nodes ) {
        listenerEntries.push(
            new ListenerEntry(node, etype, selector !== undefined, callback)
        );
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

return DOMListFactory;

})();

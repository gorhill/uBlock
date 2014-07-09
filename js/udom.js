/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
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

/******************************************************************************/
/******************************************************************************/

// It's just a silly, minimalist DOM framework: this allows me to not rely
// on jQuery. jQuery contains way too much stuff than I need, and as per
// Opera rules, I am not allowed to use a cut-down version of jQuery. So
// the code here does *only* what I need, and nothing more, and with a lot
// of assumption on passed parameters, etc. I grow it on a per-need-basis only.

var uDom = (function() {

/******************************************************************************/

var DOMList = function() {
    this.nodes = [];
};

/******************************************************************************/

var DOMListFactory = function(selector, context) {
    var r = new DOMList();
    if ( typeof selector === 'string' ) {
        selector = selector.trim();
        if ( selector.charAt(0) === '<' ) {
            return addHTMLToList(r, selector);
        }
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
    var i = r.length;
    while ( i-- ) {
        list.nodes.push(r[i]);
    }
    return list;
};

/******************************************************************************/

var pTagOfChildTag = {
    'tr': 'table',
    'option': 'select'
};

var addHTMLToList = function(list, html) {
    var matches = html.match(/^<([a-z]+)/);
    if ( !matches || matches.length !== 2 ) {
        return this;
    }
    var cTag = matches[1];
    var pTag = pTagOfChildTag[cTag] || 'div';
    var p = document.createElement(pTag);
    p.innerHTML = html;
    // Find real parent
    var c = p.querySelector(cTag);
    p = c.parentNode;
    while ( p.firstChild ) {
        list.nodes.push(p.removeChild(p.firstChild));
    }
    return list;
};

/******************************************************************************/

DOMList.prototype.length = function() {
    return this.nodes.length;
};

/******************************************************************************/

DOMList.prototype.subset = function(i, l) {
    var r = new DOMList();
    var n = l !== undefined ? l : 1;
    var j = Math.min(i + n, this.nodes.length);
    if ( i < j ) {
        r.nodes = this.nodes.slice(i, j);
    }
    return r;
};

/******************************************************************************/

DOMList.prototype.first = function() {
    return this.subset(0);
};

/******************************************************************************/

DOMList.prototype.node = function(i) {
    return this.nodes[i];
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

DOMList.prototype.find = function(selector) {
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

DOMList.prototype.forEach = function(callback) {
    var n = this.nodes.length;
    for ( var i = 0; i < n; i++ ) {
        callback.bind(this.nodes[i]).call();
    }
    return this;
};

/******************************************************************************/

DOMList.prototype.remove = function() {
    var n = this.nodes.length;
    var c, p;
    for ( var i = 0; i < n; i++ ) {
        c = this.nodes[i];
        if ( p = c.parentNode ) {
            p.removeChild(c);
        }
     }
    return this;
};

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
    var p = DOMListFactory(selector, context);
    if ( p.length ) {
        var n = this.nodes.length;
        for ( var i = 0; i < n; i++ ) {
            p.nodes[0].appendChild(this.nodes[i]);
        }
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

DOMList.prototype.clone = function(notDeep) {
    var r = new DOMList();
    var n = this.nodes.length;
    for ( var i = 0; i < n; i++ ) {
        addNodeToList(r, this.nodes[i].cloneNode(!notDeep));
    }
    return r;
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
        return i ? this.nodes[0][prop] : undefined;
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
    while ( i-- ) {
        this.nodes[i].style[prop] = value;
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
        this.nodes[i].innerHTML = html;
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

DOMList.prototype.hasClassName = function(className) {
    if ( !this.nodes.length ) {
        return false;
    }
    var re = new RegExp('(^| )' + className + '( |$)');
    return re.test(this.nodes[0].className);
};

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

DOMList.prototype.toggleClass = function(className, targetState) {
    var re = new RegExp('(^| )' + className + '( |$)');
    var n = this.nodes.length;
    var node, currentState, newState, newClassName;
    for ( var i = 0; i < n; i++ ) {
        node = this.nodes[i];
        currentState = re.test(node.className);
        newState = targetState;
        if ( newState === undefined ) {
            newState = !currentState;
        }
        if ( newState === currentState ) {
            continue;
        }
        newClassName = node.className;
        if ( newState ) {
            newClassName += ' ' + className;
        } else {
            newClassName = newClassName.replace(re, ' ');
        }
        node.className = newClassName.trim();
    }
    return this;
};

/******************************************************************************/

var makeEventHandler = function(context, selector, callback) {
    return function(event) {
        var candidates = context.querySelectorAll(selector);
        if ( !candidates.length ) {
            return;
        }
        var node = event.target;
        var i;
        while ( node && node !== context ) {
            i = candidates.length;
            while ( i-- ) {
                if ( candidates[i] === node ) {
                    return callback.call(node, event);
                }
            }
            node = node.parentNode;
        }
    };
};

DOMList.prototype.on = function(etype, selector, callback) {
    if ( typeof selector === 'function' ) {
        callback = selector;
        selector = undefined;
    }
    var i = this.nodes.length;
    while ( i-- ) {
        if ( selector !== undefined ) {
            this.nodes[i].addEventListener(etype, makeEventHandler(this.nodes[i], selector, callback), true);
        } else {
            this.nodes[i].addEventListener(etype, callback);
        }
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

/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015 Raymond Hill

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

/* global vAPI, HTMLDocument */

/******************************************************************************/
/******************************************************************************/

/*! http://mths.be/cssescape v0.2.1 by @mathias | MIT license */
;(function(root) {

    'use strict';

    if (!root.CSS) {
        root.CSS = {};
    }

    var CSS = root.CSS;

    var InvalidCharacterError = function(message) {
        this.message = message;
    };
    InvalidCharacterError.prototype = new Error();
    InvalidCharacterError.prototype.name = 'InvalidCharacterError';

    if (!CSS.escape) {
        // http://dev.w3.org/csswg/cssom/#serialize-an-identifier
        CSS.escape = function(value) {
            var string = String(value);
            var length = string.length;
            var index = -1;
            var codeUnit;
            var result = '';
            var firstCodeUnit = string.charCodeAt(0);
            while (++index < length) {
                codeUnit = string.charCodeAt(index);
                // Note: there’s no need to special-case astral symbols, surrogate
                // pairs, or lone surrogates.

                // If the character is NULL (U+0000), then throw an
                // `InvalidCharacterError` exception and terminate these steps.
                if (codeUnit === 0x0000) {
                    throw new InvalidCharacterError(
                        'Invalid character: the input contains U+0000.'
                    );
                }

                if (
                    // If the character is in the range [\1-\1F] (U+0001 to U+001F) or is
                    // U+007F, […]
                    (codeUnit >= 0x0001 && codeUnit <= 0x001F) || codeUnit == 0x007F ||
                    // If the character is the first character and is in the range [0-9]
                    // (U+0030 to U+0039), […]
                    (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
                    // If the character is the second character and is in the range [0-9]
                    // (U+0030 to U+0039) and the first character is a `-` (U+002D), […]
                    (
                        index == 1 &&
                        codeUnit >= 0x0030 && codeUnit <= 0x0039 &&
                        firstCodeUnit == 0x002D
                    )
                ) {
                    // http://dev.w3.org/csswg/cssom/#escape-a-character-as-code-point
                    result += '\\' + codeUnit.toString(16) + ' ';
                    continue;
                }

                // If the character is not handled by one of the above rules and is
                // greater than or equal to U+0080, is `-` (U+002D) or `_` (U+005F), or
                // is in one of the ranges [0-9] (U+0030 to U+0039), [A-Z] (U+0041 to
                // U+005A), or [a-z] (U+0061 to U+007A), […]
                if (
                    codeUnit >= 0x0080 ||
                    codeUnit == 0x002D ||
                    codeUnit == 0x005F ||
                    codeUnit >= 0x0030 && codeUnit <= 0x0039 ||
                    codeUnit >= 0x0041 && codeUnit <= 0x005A ||
                    codeUnit >= 0x0061 && codeUnit <= 0x007A
                ) {
                    // the character itself
                    result += string.charAt(index);
                    continue;
                }

                // Otherwise, the escaped character.
                // http://dev.w3.org/csswg/cssom/#escape-a-character
                result += '\\' + string.charAt(index);

            }
            return result;
        };
    }

}(self));

/******************************************************************************/
/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/464
if ( document instanceof HTMLDocument === false ) {
    return;
}

// This can happen
if ( typeof vAPI !== 'object' ) {
    return;
}

/******************************************************************************/

var skipTagNames = {
    'br': true,
    'link': true,
    'meta': true,
    'script': true,
    'style': true
};

var resourceAttrNames = {
    'a': 'href',
    'iframe': 'src',
    'img': 'src',
    'object': 'data'
};

/******************************************************************************/

// Collect all nodes which are directly affected by cosmetic filters: these
// will be reported in the layout data.

var nodeToCosmeticFilterMap = (function() {
    var out = new WeakMap();
    var styleTags = vAPI.styles || [];
    var i = styleTags.length;
    var selectors, styleText, j, selector, nodes, k;
    while ( i-- ) {
        styleText = styleTags[i].textContent;
        selectors = styleText.slice(0, styleText.lastIndexOf('\n')).split(/,\n/);
        j = selectors.length;
        while ( j-- ) {
            selector = selectors[j];
            nodes = document.querySelectorAll(selector);
            k = nodes.length;
            while ( k-- ) {
                out.set(nodes[k], selector);
            }
        }
    }
    return out;
})();

/******************************************************************************/

var DomRoot = function() {
    this.lvl = 0;
    this.sel = 'body';
    var url = window.location.href;
    var pos = url.indexOf('#');
    if ( pos !== -1 ) {
        url = url.slice(0, pos);
    }
    this.src = url;
    this.top = window === window.top;
    this.cnt = 0;
    this.fp = fingerprint();
};

var DomNode = function(level, selector, filter) {
    this.lvl = level;
    this.sel = selector;
    this.cnt = 0;
    this.filter = filter;
};

/******************************************************************************/

var hasManyMatches = function(node, selector) {
    var fnName = matchesSelector;
    if ( fnName === '' ) {
        return true;
    }
    var child = node.firstElementChild;
    var match = false;
    while ( child !== null ) {
        if ( child[fnName](selector) ) {
            if ( match ) {
                return true;
            }
            match = true;
        }
        child = child.nextElementSibling;
    }
    return false;
};

var matchesSelector = (function() {
    if ( typeof Element.prototype.matches === 'function' ) {
        return 'matches';
    }
    if ( typeof Element.prototype.mozMatchesSelector === 'function' ) {
        return 'mozMatchesSelector';
    }
    if ( typeof Element.prototype.webkitMatchesSelector === 'function' ) {
        return 'webkitMatchesSelector';
    }
    return '';
})();

/******************************************************************************/

var selectorFromNode = function(node) {
    var str, attr, pos, sw, i;
    var tag = node.localName;
    var selector = CSS.escape(tag);
    // Id
    if ( typeof node.id === 'string' ) {
        str = node.id.trim();
        if ( str !== '' ) {
            selector += '#' + CSS.escape(str);
        }
    }
    // Class
    var cl = node.classList;
    if ( cl ) {
        for ( i = 0; i < cl.length; i++ ) {
            selector += '.' + CSS.escape(cl[i]);
        }
    }
    // Tag-specific attributes
    if ( resourceAttrNames.hasOwnProperty(tag) ) {
        attr = resourceAttrNames[tag];
        str = node.getAttribute(attr) || '';
        str = str.trim();
        pos = str.indexOf('#');
        if ( pos !== -1 ) {
            str = str.slice(0, pos);
            sw = '^';
        } else {
            sw = '';
        }
        if ( str !== '' ) {
            selector += '[' + attr + sw + '="' + CSS.escape(str) + '"]';
        }
    }
    // The resulting selector must cause only one element to be selected. If
    // it's not the case, further narrow using `nth-of-type` pseudo-class.
    if ( hasManyMatches(node.parentElement, selector) ) {
        i = 1;
        while ( node.previousElementSibling ) {
            node = node.previousElementSibling;
            if ( node.localName === tag ) {
                i += 1;
            }
        }
        selector += ':nth-of-type(' + i + ')';
    }
    return selector;
};

/******************************************************************************/

var domNodeFactory = function(level, node) {
    var localName = node.localName;
    if ( skipTagNames.hasOwnProperty(localName) ) {
        return null;
    }
    // skip uBlock's own nodes
    if ( node.classList.contains(vAPI.sessionId) ) {
        return null;
    }
    if ( level === 0 && localName === 'body' ) {
        return new DomRoot();
    }
    var selector = selectorFromNode(node);
    var filter = nodeToCosmeticFilterMap.get(node);
    return new DomNode(level, selector, filter);
};

/******************************************************************************/

// Some kind of fingerprint for the DOM, without incurring too much
// overhead.

var fingerprint = function() {
    var url = window.location.href;
    var pos = url.indexOf('#');
    if ( pos !== -1 ) {
        url = url.slice(0, pos);
    }
    return url + '{' + document.getElementsByTagName('*').length.toString() + '}';
};

/******************************************************************************/

// Collect layout data.

var domLayout = [];

(function() {
    var dom = domLayout;
    var stack = [];
    var node = document.body;
    var domNode;
    var lvl = 0;

    for (;;) {
        domNode = domNodeFactory(lvl, node);
        if ( domNode !== null ) {
            dom.push(domNode);
        }
        // children
        if ( node.firstElementChild !== null ) {
            stack.push(node);
            lvl += 1;
            node = node.firstElementChild;
            continue;
        }
        // sibling
        if ( node.nextElementSibling === null ) {
            do {
                node = stack.pop();
                if ( !node ) { break; }
                lvl -= 1;
            } while ( node.nextElementSibling === null );
            if ( !node ) { break; }
        }
        node = node.nextElementSibling;
    }
})();

/******************************************************************************/

// Descendant count for each node.

(function() {
    var dom = domLayout;
    var stack = [], ptr;
    var lvl = 0;
    var domNode, cnt;
    var i = dom.length;

    while ( i-- ) {
        domNode = dom[i];
        if ( domNode.lvl === lvl ) {
            stack[ptr] += 1;
            continue;
        }
        if ( domNode.lvl > lvl ) {
            while ( lvl < domNode.lvl ) {
                stack.push(0);
                lvl += 1;
            }
            ptr = lvl - 1;
            stack[ptr] += 1;
            continue;
        }
        // domNode.lvl < lvl
        cnt = stack.pop();
        domNode.cnt = cnt;
        lvl -= 1;
        ptr = lvl - 1;
        stack[ptr] += cnt + 1;
    }
})();

/******************************************************************************/

var localMessager = vAPI.messaging.channel('scriptlets');
localMessager.send({
    what: 'scriptletResponse',
    scriptlet: 'dom-layout',
    response: domLayout
}, function() {
    localMessager.close();
    localMessager = null;
});

/******************************************************************************/

})();

/******************************************************************************/

/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-2016 Raymond Hill

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

(function() {

'use strict';

/******************************************************************************/

if ( typeof vAPI !== 'object' || !vAPI.domFilterer ) {
    return;
}

/******************************************************************************/

var sessionId = vAPI.sessionId;

if ( document.querySelector('iframe.dom-inspector.' + sessionId) !== null ) {
    return;
}

/******************************************************************************/
/******************************************************************************/

// Modified to avoid installing as a global shim -- so the scriptlet can be
// flushed from memory once no longer in use.

// Added serializeAsString parameter.

/*! http://mths.be/cssescape v0.2.1 by @mathias | MIT license */
var cssEscape = (function(/*root*/) {

    var InvalidCharacterError = function(message) {
        this.message = message;
    };
    InvalidCharacterError.prototype = new Error();
    InvalidCharacterError.prototype.name = 'InvalidCharacterError';

    // http://dev.w3.org/csswg/cssom/#serialize-an-identifier
    return function(value, serializeAsString) {
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
                (codeUnit >= 0x0001 && codeUnit <= 0x001F) || codeUnit === 0x007F ||
                // If the character is the first character and is in the range [0-9]
                // (U+0030 to U+0039), […]
                (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
                // If the character is the second character and is in the range [0-9]
                // (U+0030 to U+0039) and the first character is a `-` (U+002D), […]
                (
                    index === 1 &&
                    codeUnit >= 0x0030 && codeUnit <= 0x0039 &&
                    firstCodeUnit === 0x002D
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
                codeUnit === 0x002D ||
                codeUnit === 0x005F ||
                codeUnit >= 0x0030 && codeUnit <= 0x0039 ||
                codeUnit >= 0x0041 && codeUnit <= 0x005A ||
                codeUnit >= 0x0061 && codeUnit <= 0x007A
            ) {
                // the character itself
                result += string.charAt(index);
                continue;
            }

            // If "serialize a string":
            // If the character is '"' (U+0022) or "\" (U+005C), the escaped
            // character. Otherwise, the character itself.
            // http://dev.w3.org/csswg/cssom/#serialize-a-string
            if ( serializeAsString && codeUnit !== 0x0022 && codeUnit !== 0x005C ) {
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
}(self));

/******************************************************************************/
/******************************************************************************/

// Highlighter-related
var svgRoot = null;
var pickerRoot = null;
var highlightedElementLists = [ [], [], [] ];

var nodeToIdMap = new WeakMap(); // No need to iterate
var nodeToCosmeticFilterMap = new WeakMap();
var toggledNodes = new Map();

/******************************************************************************/

// Some kind of fingerprint for the DOM, without incurring too much overhead.

var domFingerprint = function() {
    return sessionId;
};

/******************************************************************************/

var domLayout = (function() {
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

    var idGenerator = 0;

    // This will be used to uniquely identify nodes across process.

    var newNodeId = function(node) {
        var nid = 'n' + (idGenerator++).toString(36);
        nodeToIdMap.set(node, nid);
        return nid;
    };

    var selectorFromNode = function(node) {
        var str, attr, pos, sw, i;
        var tag = node.localName;
        var selector = cssEscape(tag);
        // Id
        if ( typeof node.id === 'string' ) {
            str = node.id.trim();
            if ( str !== '' ) {
                selector += '#' + cssEscape(str);
            }
        }
        // Class
        var cl = node.classList;
        if ( cl ) {
            for ( i = 0; i < cl.length; i++ ) {
                selector += '.' + cssEscape(cl[i]);
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
                selector += '[' + attr + sw + '="' + cssEscape(str, true) + '"]';
            }
        }
        return selector;
    };

    var DomRoot = function() {
        this.nid = newNodeId(document.body);
        this.lvl = 0;
        this.sel = 'body';
        this.cnt = 0;
        this.filter = nodeToCosmeticFilterMap.get(document.body);
    };

    var DomNode = function(node, level) {
        this.nid = newNodeId(node);
        this.lvl = level;
        this.sel = selectorFromNode(node);
        this.cnt = 0;
        this.filter = nodeToCosmeticFilterMap.get(node);
    };

    var domNodeFactory = function(level, node) {
        var localName = node.localName;
        if ( skipTagNames.hasOwnProperty(localName) ) {
            return null;
        }
        // skip uBlock's own nodes
        if ( node.classList.contains(sessionId) ) {
            return null;
        }
        if ( level === 0 && localName === 'body' ) {
            return new DomRoot();
        }
        return new DomNode(node, level);
    };

    // Collect layout data.

    var getLayoutData = function() {
        var layout = [];
        var stack = [];
        var node = document.body;
        var domNode;
        var lvl = 0;

        for (;;) {
            domNode = domNodeFactory(lvl, node);
            if ( domNode !== null ) {
                layout.push(domNode);
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

        return layout;
    };

    // Descendant count for each node.

    var patchLayoutData = function(layout) {
        var stack = [], ptr;
        var lvl = 0;
        var domNode, cnt;
        var i = layout.length;

        while ( i-- ) {
            domNode = layout[i];
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
        return layout;
    };

    // Track and report mutations to the DOM

    var mutationObserver = null;
    var mutationTimer = null;
    var addedNodelists = [];
    var removedNodelist = [];
    var journalEntries = [];
    var journalNodes = Object.create(null);

    var previousElementSiblingId = function(node) {
        var sibling = node;
        for (;;) {
            sibling = sibling.previousElementSibling;
            if ( sibling === null ) {
                return null;
            }
            if ( skipTagNames.hasOwnProperty(sibling.localName) ) {
                continue;
            }
            return nodeToIdMap.get(sibling);
        }
    };

    var journalFromBranch = function(root, added) {
        var domNode;
        var node = root.firstElementChild;
        while ( node !== null ) {
            domNode = domNodeFactory(undefined, node);
            if ( domNode !== null ) {
                journalNodes[domNode.nid] = domNode;
                added.push(node);
            }
            // down
            if ( node.firstElementChild !== null ) {
                node = node.firstElementChild;
                continue;
            }
            // right
            if ( node.nextElementSibling !== null ) {
                node = node.nextElementSibling;
                continue;
            }
            // up then right
            for (;;) {
                if ( node.parentElement === root ) {
                    return;
                }
                node = node.parentElement;
                if ( node.nextElementSibling !== null ) {
                    node = node.nextElementSibling;
                    break;
                }
            }
        }
    };

    var journalFromMutations = function() {
        mutationTimer = null;
        if ( mutationObserver === null ) {
            addedNodelists = [];
            removedNodelist = [];
            return;
        }

        var i, m, nodelist, j, n, node, domNode, nid;

        // This is used to temporarily hold all added nodes, before resolving
        // their node id and relative position.
        var added = [];

        for ( i = 0, m = addedNodelists.length; i < m; i++ ) {
            nodelist = addedNodelists[i];
            for ( j = 0, n = nodelist.length; j < n; j++ ) {
                node = nodelist[j];
                if ( node.nodeType !== 1 ) {
                    continue;
                }
                // I don't think this can ever happen
                if ( node.parentElement === null ) {
                    continue;
                }
                cosmeticFilterMapper.incremental(node);
                domNode = domNodeFactory(undefined, node);
                if ( domNode !== null ) {
                    journalNodes[domNode.nid] = domNode;
                    added.push(node);
                }
                journalFromBranch(node, added);
            }
        }
        addedNodelists = [];
        for ( i = 0, m = removedNodelist.length; i < m; i++ ) {
            nodelist = removedNodelist[i];
            for ( j = 0, n = nodelist.length; j < n; j++ ) {
                node = nodelist[j];
                if ( node.nodeType !== 1 ) {
                    continue;
                }
                nid = nodeToIdMap.get(node);
                if ( nid === undefined ) {
                    continue;
                }
                journalEntries.push({
                    what: -1,
                    nid: nid
                });
            }
        }
        removedNodelist = [];
        for ( i = 0, n = added.length; i < n; i++ ) {
            node = added[i];
            journalEntries.push({
                what: 1,
                nid: nodeToIdMap.get(node),
                u: nodeToIdMap.get(node.parentElement),
                l: previousElementSiblingId(node)
            });
        }
    };

    var onMutationObserved = function(mutationRecords) {
        var record;
        for ( var i = 0, n = mutationRecords.length; i < n; i++ ) {
            record = mutationRecords[i];
            if ( record.addedNodes.length !== 0 ) {
                addedNodelists.push(record.addedNodes);
            }
            if ( record.removedNodes.length !== 0 ) {
                removedNodelist.push(record.removedNodes);
            }
        }
        if ( mutationTimer === null ) {
            mutationTimer = vAPI.setTimeout(journalFromMutations, 1000);
        }
    };

    // API

    var getLayout = function(fingerprint) {
        if ( fingerprint !== domFingerprint() ) {
            reset();
        }

        var response = {
            what: 'domLayout',
            fingerprint: domFingerprint(),
            url: window.location.href,
            hostname: window.location.hostname
        };

        if ( document.readyState !== 'complete' ) {
            response.status = 'busy';
            return response;
        }

        // No mutation observer means we need to send full layout
        if ( mutationObserver === null ) {
            cosmeticFilterMapper.reset();
            mutationObserver = new MutationObserver(onMutationObserved);
            mutationObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
            response.status = 'full';
            response.layout = patchLayoutData(getLayoutData());
            return response;
        }

        // Incremental layout
        if ( journalEntries.length !== 0 ) {
            response.status = 'incremental';
            response.journal = journalEntries;
            response.nodes = journalNodes;
            journalEntries = [];
            journalNodes = Object.create(null);
            return response;
        }

        response.status = 'nochange';
        return response;
    };

    var reset = function() {
        shutdown();
    };

    var shutdown = function() {
        if ( mutationTimer !== null ) {
            clearTimeout(mutationTimer);
            mutationTimer = null;
        }
        if ( mutationObserver !== null ) {
            mutationObserver.disconnect();
            mutationObserver = null;
        }
        addedNodelists = [];
        removedNodelist = [];
        journalEntries = [];
        journalNodes = Object.create(null);
        nodeToIdMap = new WeakMap();
    };

    return {
        get: getLayout,
        reset: reset,
        shutdown: shutdown
    };
})();

// https://www.youtube.com/watch?v=qo8zKhd4Cf0

/******************************************************************************/
/******************************************************************************/

// For browsers not supporting `:scope`, it's not the end of the world: the
// suggested CSS selectors may just end up being more verbose.

var cssScope = ':scope > ';
try {
    document.querySelector(':scope *');
} catch (e) {
    cssScope = '';
}

/******************************************************************************/

var cosmeticFilterFromEntries = function(entries) {
    var out = [];
    var entry, i = entries.length;
    while ( i-- ) {
        entry = entries[i];
        out.push(cosmeticFilterFromTarget(entry.nid, entry.selector));
    }
    return out;
};

/******************************************************************************/

// Extract the best possible cosmetic filter, i.e. as specific as possible.

var cosmeticFilterFromNode = function(elem) {
    var tagName = elem.localName;
    var prefix = '';
    var suffix = [];
    var v, i;

    // Id
    v = typeof elem.id === 'string' && cssEscape(elem.id);
    if ( v ) {
        suffix.push('#', v);
    }

    // Class(es)
    if ( suffix.length === 0 ) {
        v = elem.classList;
        if ( v ) {
            i = v.length || 0;
            while ( i-- ) {
                suffix.push('.' + cssEscape(v.item(i)));
            }
        }
    }

    // Tag name
    if ( suffix.length === 0 ) {
        prefix = tagName;
    }

    // Attributes (depends on tag name)
    var attributes = [], attr;
    switch ( tagName ) {
    case 'a':
        v = elem.getAttribute('href');
        if ( v ) {
            v = v.replace(/\?.*$/, '');
            if ( v.length ) {
                attributes.push({ k: 'href', v: v });
            }
        }
        break;
    case 'img':
        v = elem.getAttribute('alt');
        if ( v && v.length !== 0 ) {
            attributes.push({ k: 'alt', v: v });
        }
        break;
    default:
        break;
    }
    while ( (attr = attributes.pop()) ) {
        if ( attr.v.length === 0 ) {
            continue;
        }
        suffix.push('[', attr.k, '="', cssEscape(attr.v, true), '"]');
    }

    var selector = prefix + suffix.join('');

    // https://github.com/chrisaljoudi/uBlock/issues/637
    // If the selector is still ambiguous at this point, further narrow using
    // `nth-of-type`. It is preferable to use `nth-of-type` as opposed to
    // `nth-child`, as `nth-of-type` is less volatile.
    var parent = elem.parentElement;
    if ( elementsFromSelector(cssScope + selector, parent).length > 1 ) {
        i = 1;
        while ( elem.previousElementSibling !== null ) {
            elem = elem.previousElementSibling;
            if ( elem.localName !== tagName ) {
                continue;
            }
            i++;
        }
        selector += ':nth-of-type(' + i + ')';
    }

    return selector;
};

/******************************************************************************/

var cosmeticFilterFromTarget = function(nid, coarseSelector) {
    var elems = elementsFromSelector(coarseSelector);
    var target = null;
    var i = elems.length;
    while ( i-- ) {
        if ( nodeToIdMap.get(elems[i]) === nid ) {
            target = elems[i];
            break;
        }
    }
    if ( target === null ) {
        return coarseSelector;
    }
    // Find the most concise selector from the target node
    var segments = [], segment;
    var node = target;
    while ( node !== document.body ) {
        segment = cosmeticFilterFromNode(node);
        segments.unshift(segment);
        if ( segment.charAt(0) === '#' ) {
            break;
        }
        node = node.parentElement;
    }
    var fineSelector = segments.join(' > ');
    if ( fineSelector.charAt(0) === '#' ) {
        return fineSelector;
    }
    if ( fineSelector.charAt(0) === '.' && elementsFromSelector(fineSelector).length === 1 ) {
        return fineSelector;
    }
    return 'body > ' + fineSelector;
};

/******************************************************************************/

var cosmeticFilterMapper = (function() {
    // https://github.com/gorhill/uBlock/issues/546
    var matchesFnName;
    if ( typeof document.body.matches === 'function' ) {
        matchesFnName = 'matches';
    } else if ( typeof document.body.mozMatchesSelector === 'function' ) {
        matchesFnName = 'mozMatchesSelector';
    } else if ( typeof document.body.webkitMatchesSelector === 'function' ) {
        matchesFnName = 'webkitMatchesSelector';
    }

    // Why the call to hideNode()?
    //   Not all target nodes have necessarily been force-hidden,
    //   do it now so that the inspector does not unhide these
    //   nodes when disabling style tags.
    var nodesFromStyleTag = function(rootNode) {
        var filterMap = nodeToCosmeticFilterMap,
            selectors, selector,
            nodes, node,
            i, j;

        // CSS-based selectors: simple one.
        selectors = vAPI.domFilterer.job2._0;
        i = selectors.length;
        while ( i-- ) {
            selector = selectors[i];
            if ( filterMap.has(rootNode) === false && rootNode[matchesFnName](selector) ) {
                filterMap.set(rootNode, selector);
            }
            nodes = rootNode.querySelectorAll(selector);
            j = nodes.length;
            while ( j-- ) {
                node = nodes[j];
                if ( filterMap.has(node) === false ) {
                    filterMap.set(node, selector);
                }
            }
        }
    
        // CSS-based selectors: complex one (must query from doc root).
        selectors = vAPI.domFilterer.job3._0;
        i = selectors.length;
        while ( i-- ) {
            selector = selectors[i];
            nodes = document.querySelectorAll(selector);
            j = nodes.length;
            while ( j-- ) {
                node = nodes[j];
                if ( filterMap.has(node) === false ) {
                    filterMap.set(node, selector);
                }
            }
        }

        // Non-CSS selectors.
        var runJobCallback = function(node, job) {
            if ( filterMap.has(node) === false ) {
                filterMap.set(node, job.raw);
            }
        };
        for ( i = 4; i < vAPI.domFilterer.jobQueue.length; i++ ) {
            vAPI.domFilterer.runJob(vAPI.domFilterer.jobQueue[i], runJobCallback);
        }
    };

    var incremental = function(rootNode) {
        var styleTags = vAPI.domFilterer.styleTags || [];
        var styleTag;
        var i = styleTags.length;
        while ( i-- ) {
            styleTag = styleTags[i];
            if ( styleTag.sheet !== null ) {
                styleTag.sheet.disabled = true;
                styleTag[vAPI.sessionId] = true;
            }
        }
        nodesFromStyleTag(rootNode);
    };

    var reset = function() {
        nodeToCosmeticFilterMap = new WeakMap();
        incremental(document.documentElement);
    };

    var shutdown = function() {
        var styleTags = vAPI.domFilterer.styleTags || [];
        var styleTag;
        var i = styleTags.length;
        while ( i-- ) {
            styleTag = styleTags[i];
            if ( styleTag.sheet !== null ) {
                styleTag.sheet.disabled = false;
                styleTag[vAPI.sessionId] = undefined;
            }
        }
    };

    return {
        incremental: incremental,
        reset: reset,
        shutdown: shutdown
    };
})();

/******************************************************************************/

var elementsFromSelector = function(selector, context) {
    if ( !context ) {
        context = document;
    }
    var out;
    if ( selector.indexOf(':') !== -1 ) {
        out = elementsFromSpecialSelector(selector);
        if ( out !== undefined ) {
            return out;
        }
    }
    // plain CSS selector
    try {
        out = context.querySelectorAll(selector);
    } catch (ex) {
    }
    return out || [];
};

var elementsFromSpecialSelector = function(selector) {
    var out = [], i;
    var matches = /^(.+?):has\((.+?)\)$/.exec(selector);
    if ( matches !== null ) {
        var nodes = document.querySelectorAll(matches[1]);
        i = nodes.length;
        while ( i-- ) {
            var node = nodes[i];
            if ( node.querySelector(matches[2]) !== null ) {
                out.push(node);
            }
        }
        return out;
    }

    matches = /^:xpath\((.+?)\)$/.exec(selector);
    if ( matches !== null ) {
        var xpr = document.evaluate(
            matches[1],
            document,
            null,
            XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
            null
        );
        i = xpr.snapshotLength;
        while ( i-- ) {
            out.push(xpr.snapshotItem(i));
        }
        return out;
    }
};

/******************************************************************************/

var highlightElements = function(scrollTo) {
    var wv = pickerRoot.contentWindow.innerWidth;
    var hv = pickerRoot.contentWindow.innerHeight;
    var ocean = ['M0 0h' + wv + 'v' + hv + 'h-' + wv, 'z'], islands;
    var elems, elem, rect, poly;
    var xl, xr, yt, yb, w, h, ws;
    var xlu = Number.MAX_VALUE, xru = 0, ytu = Number.MAX_VALUE, ybu = 0;
    var lists = highlightedElementLists;

    for ( var i = 0; i < lists.length; i++ ) {
        elems = lists[i];
        islands = [];
        for ( var j = 0; j < elems.length; j++ ) {
            elem = elems[j];
            if ( elem === pickerRoot ) {
                continue;
            }
            if ( typeof elem.getBoundingClientRect !== 'function' ) {
                continue;
            }

            rect = elem.getBoundingClientRect();
            xl = rect.left;
            xr = rect.right;
            w = rect.width;
            yt = rect.top;
            yb = rect.bottom;
            h = rect.height;

            ws = w.toFixed(1);
            poly = 'M' + xl.toFixed(1) + ' ' + yt.toFixed(1) +
                   'h' + ws +
                   'v' + h.toFixed(1) +
                   'h-' + ws +
                   'z';
            ocean.push(poly);
            islands.push(poly);

            if ( !scrollTo ) {
                continue;
            }

            if ( xl < xlu ) { xlu = xl; }
            if ( xr > xru ) { xru = xr; }
            if ( yt < ytu ) { ytu = yt; }
            if ( yb > ybu ) { ybu = yb; }
        }
        svgRoot.children[i+1].setAttribute('d', islands.join('') || 'M0 0');
    }

    svgRoot.firstElementChild.setAttribute('d', ocean.join(''));

    if ( !scrollTo ) {
        return;
    }

    // Highlighted area completely within viewport
    if ( xlu >= 0 && xru <= wv && ytu >= 0 && ybu <= hv ) {
        return;
    }

    var dx = 0, dy = 0;

    if ( xru > wv ) {
        dx = xru - wv;
        xlu -= dx;
    }
    if ( xlu <  0 ) {
        dx += xlu;
    }
    if ( ybu > hv ) {
        dy = ybu - hv;
        ytu -= dy;
    }
    if ( ytu <  0 ) {
        dy += ytu;
    }

    if ( dx !== 0 || dy !== 0 ) {
        window.scrollBy(dx, dy);
    }
};

/******************************************************************************/

var onScrolled = function() {
    highlightElements();
};

/******************************************************************************/

var resetToggledNodes = function() {
    for ( var entry of toggledNodes ) {
        if ( entry[1].show ) {
            showNode(entry[0], entry[1].v1, entry[1].v2);
        } else {
            hideNode(entry[0]);
        }
    }
    toggledNodes.clear();
};

/******************************************************************************/

var forgetToggledNodes = function() {
    toggledNodes.clear();
};

/******************************************************************************/

var selectNodes = function(selector, nid) {
    var nodes = elementsFromSelector(selector);
    if ( nid === '' ) {
        return nodes;
    }
    var i = nodes.length;
    while ( i-- ) {
        if ( nodeToIdMap.get(nodes[i]) === nid ) {
            return [nodes[i]];
        }
    }
    return [];
};

/******************************************************************************/

var shutdown = function() {
    cosmeticFilterMapper.shutdown();
    resetToggledNodes();
    domLayout.shutdown();
    vAPI.messaging.removeAllChannelListeners('domInspector');
    window.removeEventListener('scroll', onScrolled, true);
    document.documentElement.removeChild(pickerRoot);
    pickerRoot = svgRoot = null;
    highlightedElementLists = [ [], [], [] ];
};

/******************************************************************************/

// original, target = what to do
//      any,    any = restore saved display property
//      any, hidden = set display to `none`, remember original state
//   hidden,    any = remove display property, don't remember original state
//   hidden, hidden = set display to `none`

var toggleNodes = function(nodes, originalState, targetState) {
    var i = nodes.length;
    if ( i === 0 ) {
        return;
    }
    var node, details;
    while ( i-- ) {
        node = nodes[i];
        // originally visible node
        if ( originalState ) {
            // unhide visible node
            if ( targetState ) {
                details = toggledNodes.get(node) || {};
                showNode(node, details.v1, details.v2);
                toggledNodes.delete(node);
            }
            // hide visible node
            else {
                toggledNodes.set(node, {
                    show: true,
                    v1: node.style.getPropertyValue('display') || '',
                    v2: node.style.getPropertyPriority('display') || ''
                });
                hideNode(node);
            }
        }
        // originally hidden node
        else {
            // show hidden node
            if ( targetState ) {
                toggledNodes.set(node, { show: false });
                showNode(node, 'initial', 'important');
            }
            // hide hidden node
            else {
                hideNode(node);
                toggledNodes.delete(node);
            }
        }
    }
};

// https://www.youtube.com/watch?v=L5jRewnxSBY

/******************************************************************************/

var showNode = function(node, v1, v2) {
    vAPI.domFilterer.showNode(node);
    if ( !v1 ) {
        node.style.removeProperty('display');
    } else {
        node.style.setProperty('display', v1, v2);
    }
};

/******************************************************************************/

var hideNode = function(node) {
    vAPI.domFilterer.unshowNode(node);
};

/******************************************************************************/
/******************************************************************************/

var onMessage = function(request) {
    var response;

    switch ( request.what ) {
    case 'commitFilters':
        resetToggledNodes();
        toggleNodes(selectNodes(request.hide, ''), true, false);
        toggleNodes(selectNodes(request.unhide, ''), false, true);
        forgetToggledNodes();
        highlightedElementLists = [ [], [], [] ];
        highlightElements();
        break;

    case 'cookFilters':
        response = cosmeticFilterFromEntries(request.entries);
        break;

    case 'domLayout':
        response = domLayout.get(request.fingerprint);
        break;

    case 'highlightMode':
        svgRoot.classList.toggle('invert', request.invert);
        break;

    case 'highlightOne':
        highlightedElementLists[0] = selectNodes(request.selector, request.nid);
        highlightElements(request.scrollTo);
        break;

    case 'resetToggledNodes':
        resetToggledNodes();
        break;

    case 'showCommitted':
        resetToggledNodes();
        highlightedElementLists[0] = [];
        highlightedElementLists[1] = selectNodes(request.hide, '');
        highlightedElementLists[2] = selectNodes(request.unhide, '');
        toggleNodes(highlightedElementLists[2], false, true);
        highlightElements(true);
        break;

    case 'showInteractive':
        resetToggledNodes();
        toggleNodes(selectNodes(request.hide, ''), true, false);
        toggleNodes(selectNodes(request.unhide, ''), false, true);
        highlightedElementLists = [ [], [], [] ];
        highlightElements();
        break;

    case 'toggleFilter':
        highlightedElementLists[0] = selectNodes(request.filter, request.nid);
        toggleNodes(highlightedElementLists[0], request.original, request.target);
        highlightElements(true);
        break;

    case 'toggleNodes':
        highlightedElementLists[0] = selectNodes(request.selector, request.nid);
        toggleNodes(highlightedElementLists[0], request.original, request.target);
        highlightElements(true);
        break;

    case 'shutdown':
        shutdown();
        break;

    default:
        break;
    }

    return response;
};

/******************************************************************************/

// Install DOM inspector widget

pickerRoot = document.createElement('iframe');
pickerRoot.classList.add(sessionId);
pickerRoot.classList.add('dom-inspector');
pickerRoot.style.cssText = [
    'background: transparent',
    'border: 0',
    'border-radius: 0',
    'box-shadow: none',
    'display: block',
    'height: 100%',
    'left: 0',
    'margin: 0',
    'opacity: 1',
    'position: fixed',
    'outline: 0',
    'padding: 0',
    'top: 0',
    'visibility: visible',
    'width: 100%',
    'z-index: 2147483647',
    ''
].join(' !important;\n');

pickerRoot.onload = function() {
    pickerRoot.onload = null;
    var pickerDoc = this.contentDocument;

    var style = pickerDoc.createElement('style');
    style.textContent = [
        'body {',
            'background-color: transparent;',
            'cursor: not-allowed;',
        '}',
        'svg {',
            'height: 100%;',
            'left: 0;',
            'position: fixed;',
            'top: 0;',
            'width: 100%;',
        '}',
        'svg > path:first-child {',
            'fill: rgba(0,0,0,0.75);',
            'fill-rule: evenodd;',
        '}',
        'svg > path:nth-of-type(2) {',
            'fill: rgba(0,0,255,0.1);',
            'stroke: #FFF;',
            'stroke-width: 0.5px;',
        '}',
        'svg > path:nth-of-type(3) {',
            'fill: rgba(255,0,0,0.2);',
            'stroke: #F00;',
        '}',
        'svg > path:nth-of-type(4) {',
            'fill: rgba(0,255,0,0.2);',
            'stroke: #0F0;',
        '}',
        ''
    ].join('\n');
    pickerDoc.body.appendChild(style);

    svgRoot = pickerDoc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgRoot.appendChild(pickerDoc.createElementNS('http://www.w3.org/2000/svg', 'path'));
    svgRoot.appendChild(pickerDoc.createElementNS('http://www.w3.org/2000/svg', 'path'));
    svgRoot.appendChild(pickerDoc.createElementNS('http://www.w3.org/2000/svg', 'path'));
    svgRoot.appendChild(pickerDoc.createElementNS('http://www.w3.org/2000/svg', 'path'));
    pickerDoc.body.appendChild(svgRoot);

    window.addEventListener('scroll', onScrolled, true);

    highlightElements();
    cosmeticFilterMapper.reset();

    vAPI.messaging.addChannelListener('domInspector', onMessage);
};

document.documentElement.appendChild(pickerRoot);

/******************************************************************************/

})();

/******************************************************************************/

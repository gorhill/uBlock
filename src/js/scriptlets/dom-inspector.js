/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-2018 Raymond Hill

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

/******************************************************************************/
/******************************************************************************/

(( ) => {

/******************************************************************************/

if ( typeof vAPI !== 'object' || !vAPI.domFilterer ) { return; }

/******************************************************************************/

var sessionId = vAPI.sessionId;

if ( document.querySelector('iframe.dom-inspector.' + sessionId) !== null ) {
    return;
}

/******************************************************************************/
/******************************************************************************/

let loggerConnectionId;

// Highlighter-related
let svgRoot = null;
let pickerRoot = null;

let nodeToIdMap = new WeakMap(); // No need to iterate

let blueNodes = [];
const roRedNodes = new Map();    // node => current cosmetic filter
const rwRedNodes = new Set();    // node => new cosmetic filter (toggle node)
//var roGreenNodes = new Map();  // node => current exception cosmetic filter (can't toggle)
const rwGreenNodes = new Set();  // node => new exception cosmetic filter (toggle filter)

const reHasCSSCombinators = /[ >+~]/;

/******************************************************************************/

const domLayout = (function() {
    const skipTagNames = new Set([
        'br', 'head', 'link', 'meta', 'script', 'style', 'title'
    ]);
    const resourceAttrNames = new Map([
        [ 'a', 'href' ],
        [ 'iframe', 'src' ],
        [ 'img', 'src' ],
        [ 'object', 'data' ]
    ]);

    var idGenerator = 0;

    // This will be used to uniquely identify nodes across process.

    const newNodeId = function(node) {
        var nid = 'n' + (idGenerator++).toString(36);
        nodeToIdMap.set(node, nid);
        return nid;
    };

    const selectorFromNode = function(node) {
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
        attr = resourceAttrNames.get(tag);
        if ( attr !== undefined ) {
            str = node.getAttribute(attr) || '';
            str = str.trim();
            if ( str.startsWith('data:') ) {
                pos = 5;
            } else {
                pos = str.search(/[#?]/);
            }
            if ( pos !== -1 ) {
                str = str.slice(0, pos);
                sw = '^';
            } else {
                sw = '';
            }
            if ( str !== '' ) {
                selector += '[' + attr + sw + '="' + CSS.escape(str, true) + '"]';
            }
        }
        return selector;
    };

    const DomRoot = function() {
        this.nid = newNodeId(document.body);
        this.lvl = 0;
        this.sel = 'body';
        this.cnt = 0;
        this.filter = roRedNodes.get(document.body);
    };

    const DomNode = function(node, level) {
        this.nid = newNodeId(node);
        this.lvl = level;
        this.sel = selectorFromNode(node);
        this.cnt = 0;
        this.filter = roRedNodes.get(node);
    };

    const domNodeFactory = function(level, node) {
        const localName = node.localName;
        if ( skipTagNames.has(localName) ) { return null; }
        // skip uBlock's own nodes
        if ( node.classList.contains(sessionId) ) { return null; }
        if ( level === 0 && localName === 'body' ) {
            return new DomRoot();
        }
        return new DomNode(node, level);
    };

    // Collect layout data.

    const getLayoutData = function() {
        const layout = [];
        const stack = [];
        let lvl = 0;
        let node = document.documentElement;
        if ( node === null ) { return layout; }

        for (;;) {
            const domNode = domNodeFactory(lvl, node);
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
            if ( node instanceof Element ) {
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
        }

        return layout;
    };

    // Descendant count for each node.

    const patchLayoutData = function(layout) {
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

    // Track and report mutations of the DOM

    var mutationObserver = null;
    var mutationTimer;
    var addedNodelists = [];
    var removedNodelist = [];

    const previousElementSiblingId = function(node) {
        var sibling = node;
        for (;;) {
            sibling = sibling.previousElementSibling;
            if ( sibling === null ) { return null; }
            if ( skipTagNames.has(sibling.localName) ) { continue; }
            return nodeToIdMap.get(sibling);
        }
    };

    const journalFromBranch = function(root, newNodes, newNodeToIdMap) {
        var domNode;
        var node = root.firstElementChild;
        while ( node !== null ) {
            domNode = domNodeFactory(undefined, node);
            if ( domNode !== null ) {
                newNodeToIdMap.set(domNode.nid, domNode);
                newNodes.push(node);
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
                if ( node.parentElement === root ) { return; }
                node = node.parentElement;
                if ( node.nextElementSibling !== null ) {
                    node = node.nextElementSibling;
                    break;
                }
            }
        }
    };

    const journalFromMutations = function() {
        var nodelist, node, domNode, nid;
        mutationTimer = undefined;

        // This is used to temporarily hold all added nodes, before resolving
        // their node id and relative position.
        var newNodes = [];
        var journalEntries = [];
        var newNodeToIdMap = new Map();

        for ( nodelist of addedNodelists ) {
            for ( node of nodelist ) {
                if ( node.nodeType !== 1 ) { continue; }
                if ( node.parentElement === null ) { continue; }
                cosmeticFilterMapper.incremental(node);
                domNode = domNodeFactory(undefined, node);
                if ( domNode !== null ) {
                    newNodeToIdMap.set(domNode.nid, domNode);
                    newNodes.push(node);
                }
                journalFromBranch(node, newNodes, newNodeToIdMap);
            }
        }
        addedNodelists = [];
        for ( nodelist of removedNodelist ) {
            for ( node of nodelist ) {
                if ( node.nodeType !== 1 ) { continue; }
                nid = nodeToIdMap.get(node);
                if ( nid === undefined ) { continue; }
                journalEntries.push({
                    what: -1,
                    nid: nid
                });
            }
        }
        removedNodelist = [];
        for ( node of newNodes ) {
            journalEntries.push({
                what: 1,
                nid: nodeToIdMap.get(node),
                u: nodeToIdMap.get(node.parentElement),
                l: previousElementSiblingId(node)
            });
        }

        if ( journalEntries.length === 0 ) { return; }

        vAPI.MessagingConnection.sendTo(loggerConnectionId, {
            what: 'domLayoutIncremental',
            url: window.location.href,
            hostname: window.location.hostname,
            journal: journalEntries,
            nodes: Array.from(newNodeToIdMap)
        });
    };

    const onMutationObserved = function(mutationRecords) {
        for ( var record of mutationRecords ) {
            if ( record.addedNodes.length !== 0 ) {
                addedNodelists.push(record.addedNodes);
            }
            if ( record.removedNodes.length !== 0 ) {
                removedNodelist.push(record.removedNodes);
            }
        }
        if ( mutationTimer === undefined ) {
            mutationTimer = vAPI.setTimeout(journalFromMutations, 1000);
        }
    };

    // API

    const getLayout = function() {
        cosmeticFilterMapper.reset();
        mutationObserver = new MutationObserver(onMutationObserved);
        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        return {
            what: 'domLayoutFull',
            url: window.location.href,
            hostname: window.location.hostname,
            layout: patchLayoutData(getLayoutData())
        };
    };

    const reset = function() {
        shutdown();
    };

    const shutdown = function() {
        if ( mutationTimer !== undefined ) {
            clearTimeout(mutationTimer);
            mutationTimer = undefined;
        }
        if ( mutationObserver !== null ) {
            mutationObserver.disconnect();
            mutationObserver = null;
        }
        addedNodelists = [];
        removedNodelist = [];
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

let cssScope = ':scope > ';
try {
    document.querySelector(':scope *');
} catch (e) {
    cssScope = '';
}

/******************************************************************************/

const cosmeticFilterMapper = (function() {
    const nodesFromStyleTag = function(rootNode) {
        const filterMap = roRedNodes;
        const details = vAPI.domFilterer.getAllSelectors();

        // Declarative selectors.
        for ( const block of (details.declarative || []) ) {
            for ( const selector of block.split(',\n') ) {
                let nodes;
                if ( reHasCSSCombinators.test(selector) ) {
                    nodes = document.querySelectorAll(selector);
                } else {
                    if (
                        filterMap.has(rootNode) === false &&
                        rootNode.matches(selector)
                    ) {
                        filterMap.set(rootNode, selector);
                    }
                    nodes = rootNode.querySelectorAll(selector);
                }
                for ( const node of nodes ) {
                    if ( filterMap.has(node) ) { continue; }
                    filterMap.set(node, selector);
                }
            }
        }

        // Procedural selectors.
        for ( const entry of (details.procedural || []) ) {
            const nodes = entry.exec();
            for ( const node of nodes ) {
                // Upgrade declarative selector to procedural one
                filterMap.set(node, entry.raw);
            }
        }
    };

    const incremental = function(rootNode) {
        nodesFromStyleTag(rootNode);
    };

    const reset = function() {
        roRedNodes.clear();
        if ( document.documentElement !== null ) {
            incremental(document.documentElement);
        }
    };

    const shutdown = function() {
        vAPI.domFilterer.toggle(true);
    };

    return {
        incremental: incremental,
        reset: reset,
        shutdown: shutdown
    };
})();

/******************************************************************************/

const elementsFromSelector = function(selector, context) {
    if ( !context ) {
        context = document;
    }
    if ( selector.indexOf(':') !== -1 ) {
        const out = elementsFromSpecialSelector(selector);
        if ( out !== undefined ) { return out; }
    }
    // plain CSS selector
    try {
        return context.querySelectorAll(selector);
    } catch (ex) {
    }
    return [];
};

const elementsFromSpecialSelector = function(selector) {
    var out = [], i;
    var matches = /^(.+?):has\((.+?)\)$/.exec(selector);
    if ( matches !== null ) {
        var nodes;
        try {
            nodes = document.querySelectorAll(matches[1]);
        } catch(ex) {
            nodes = [];
        }
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
    if ( matches === null ) { return; }
    const xpr = document.evaluate(
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
};

/******************************************************************************/

const getSvgRootChildren = function() {
    if ( svgRoot.children ) {
        return svgRoot.children;
    } else {
        const childNodes = Array.prototype.slice.apply(svgRoot.childNodes);
        return childNodes.filter(function(node) {
            return node.nodeType === Node.ELEMENT_NODE;
        });
    }
};

const highlightElements = function() {
    var islands;
    var elem, rect, poly;
    var xl, xr, yt, yb, w, h, ws;
    var svgRootChildren = getSvgRootChildren();

    islands = [];
    for ( elem of rwRedNodes.keys() ) {
        if ( elem === pickerRoot ) { continue; }
        if ( rwGreenNodes.has(elem) ) { continue; }
        if ( typeof elem.getBoundingClientRect !== 'function' ) { continue; }
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
        islands.push(poly);
    }
    svgRootChildren[0].setAttribute('d', islands.join('') || 'M0 0');

    islands = [];
    for ( elem of rwGreenNodes ) {
        if ( typeof elem.getBoundingClientRect !== 'function' ) { continue; }
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
        islands.push(poly);
    }
    svgRootChildren[1].setAttribute('d', islands.join('') || 'M0 0');

    islands = [];
    for ( elem of roRedNodes.keys() ) {
        if ( elem === pickerRoot ) { continue; }
        if ( rwGreenNodes.has(elem) ) { continue; }
        if ( typeof elem.getBoundingClientRect !== 'function' ) { continue; }
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
        islands.push(poly);
    }
    svgRootChildren[2].setAttribute('d', islands.join('') || 'M0 0');

    islands = [];
    for ( elem of blueNodes ) {
        if ( elem === pickerRoot ) { continue; }
        if ( typeof elem.getBoundingClientRect !== 'function' ) { continue; }
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
        islands.push(poly);
    }
    svgRootChildren[3].setAttribute('d', islands.join('') || 'M0 0');
};

/******************************************************************************/

const onScrolled = (function() {
    let buffered = false;
    const timerHandler = function() {
        buffered = false;
        highlightElements();
    };
    return function() {
        if ( buffered === false ) {
            window.requestAnimationFrame(timerHandler);
            buffered = true;
        }
    };
})();

/******************************************************************************/

const selectNodes = function(selector, nid) {
    const nodes = elementsFromSelector(selector);
    if ( nid === '' ) { return nodes; }
    for ( const node of nodes ) {
        if ( nodeToIdMap.get(node) === nid ) {
            return [ node ];
        }
    }
    return [];
};

/******************************************************************************/

const nodesFromFilter = function(selector) {
    const out = [];
    for ( const entry of roRedNodes ) {
        if ( entry[1] === selector ) {
            out.push(entry[0]);
        }
    }
    return out;
};

/******************************************************************************/

const toggleExceptions = function(nodes, targetState) {
    for ( const node of nodes ) {
        if ( targetState ) {
            rwGreenNodes.add(node);
        } else {
            rwGreenNodes.delete(node);
        }
    }
};

const toggleFilter = function(nodes, targetState) {
    for ( const node of nodes ) {
        if ( targetState ) {
            rwRedNodes.delete(node);
        } else {
            rwRedNodes.add(node);
        }
    }
};

const resetToggledNodes = function() {
    rwGreenNodes.clear();
    rwRedNodes.clear();
};

/******************************************************************************/

const start = function() {
    const onReady = function(ev) {
        if ( ev ) {
            document.removeEventListener(ev.type, onReady);
        }
        vAPI.MessagingConnection.sendTo(loggerConnectionId, domLayout.get());
        vAPI.domFilterer.toggle(false, highlightElements);
    };
    if ( document.readyState === 'loading' ) {
        document.addEventListener('DOMContentLoaded', onReady);
    } else {
        onReady();
    }
};

/******************************************************************************/

const shutdown = function() {
    cosmeticFilterMapper.shutdown();
    domLayout.shutdown();
    vAPI.MessagingConnection.disconnectFrom(loggerConnectionId);
    window.removeEventListener('scroll', onScrolled, true);
    pickerRoot.remove();
    pickerRoot = svgRoot = null;
};

/******************************************************************************/
/******************************************************************************/

const onMessage = function(request) {
    var response,
        nodes;

    switch ( request.what ) {
    case 'commitFilters':
        highlightElements();
        break;

    case 'domLayout':
        response = domLayout.get();
        highlightElements();
        break;

    case 'highlightMode':
        //svgRoot.classList.toggle('invert', request.invert);
        break;

    case 'highlightOne':
        blueNodes = selectNodes(request.selector, request.nid);
        highlightElements();
        break;

    case 'resetToggledNodes':
        resetToggledNodes();
        highlightElements();
        break;

    case 'showCommitted':
        blueNodes = [];
        // TODO: show only the new filters and exceptions.
        highlightElements();
        break;

    case 'showInteractive':
        blueNodes = [];
        highlightElements();
        break;

    case 'toggleFilter':
        nodes = selectNodes(request.selector, request.nid);
        if ( nodes.length !== 0 ) { nodes[0].scrollIntoView(); }
        toggleExceptions(nodesFromFilter(request.filter), request.target);
        highlightElements();
        break;

    case 'toggleNodes':
        nodes = selectNodes(request.selector, request.nid);
        if ( nodes.length !== 0 ) { nodes[0].scrollIntoView(); }
        toggleFilter(nodes, request.target);
        highlightElements();
        break;

    default:
        break;
    }

    return response;
};

/******************************************************************************/

// Install DOM inspector widget

const bootstrap = function(ev) {
    if ( ev ) {
        pickerRoot.removeEventListener(ev.type, bootstrap);
    }
    const pickerDoc = ev.target.contentDocument;

    pickerDoc.documentElement.style.setProperty(
        'color-scheme',
        'dark light',
        'important'
    );

    const style = pickerDoc.createElement('style');
    style.textContent = [
        'body {',
            'background-color: transparent;',
        '}',
        'svg {',
            'height: 100%;',
            'left: 0;',
            'position: fixed;',
            'top: 0;',
            'width: 100%;',
        '}',
        'svg > path:nth-of-type(1) {',
            'fill: rgba(255,0,0,0.2);',
            'stroke: #F00;',
        '}',
        'svg > path:nth-of-type(2) {',
            'fill: rgba(0,255,0,0.2);',
            'stroke: #0F0;',
        '}',
        'svg > path:nth-of-type(3) {',
            'fill: rgba(255,0,0,0.2);',
            'stroke: #F00;',
        '}',
        'svg > path:nth-of-type(4) {',
            'fill: rgba(0,0,255,0.1);',
            'stroke: #FFF;',
            'stroke-width: 0.5px;',
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

    // Dynamically add direct connection abilities so that we can establish
    // a direct, fast messaging connection to the logger.
    vAPI.messaging.extend().then(extended => {
        if ( extended !== true ) { return; }
        vAPI.MessagingConnection.connectTo('domInspector', 'loggerUI', msg => {
            switch ( msg.what ) {
            case 'connectionAccepted':
                loggerConnectionId = msg.id;
                start();
                break;
            case 'connectionBroken':
                shutdown();
                break;
            case 'connectionMessage':
                onMessage(msg.payload);
                break;
            }
        });
    });
};

pickerRoot = document.createElement('iframe');
pickerRoot.classList.add(sessionId);
pickerRoot.classList.add('dom-inspector');
pickerRoot.style.cssText = [
    'background: transparent',
    'border: 0',
    'border-radius: 0',
    'box-shadow: none',
    'color-scheme: light dark',
    'display: block',
    'height: 100%',
    'left: 0',
    'margin: 0',
    'opacity: 1',
    'outline: 0',
    'padding: 0',
    'pointer-events:none;',
    'position: fixed',
    'top: 0',
    'visibility: visible',
    'width: 100%',
    'z-index: 2147483647',
    ''
].join(' !important;\n');

pickerRoot.addEventListener('load', ev => { bootstrap(ev); });
(document.documentElement || document).appendChild(pickerRoot);

/******************************************************************************/

})();








/*******************************************************************************

    DO NOT:
    - Remove the following code
    - Add code beyond the following code
    Reason:
    - https://github.com/gorhill/uBlock/pull/3721
    - uBO never uses the return value from injected content scripts

**/

void 0;

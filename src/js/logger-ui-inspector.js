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

/* global uDom */

'use strict';

/******************************************************************************/

(function() {

/******************************************************************************/

var showdomButton = uDom.nodeFromId('showdom');

// Don't bother if the browser is not modern enough.
if (
    typeof Map === 'undefined' ||
    Map.polyfill ||
    typeof WeakMap === 'undefined'
) {
    showdomButton.classList.add('disabled');
    return;
}

/******************************************************************************/

var logger = self.logger;
var inspectorConnectionId;
var inspectedTabId = '';
var inspectedURL = '';
var inspectedHostname = '';
var inspector = uDom.nodeFromId('domInspector');
var domTree = uDom.nodeFromId('domTree');
var tabSelector = uDom.nodeFromId('pageSelector');
var uidGenerator = 1;
var filterToIdMap = new Map();

/******************************************************************************/

var messaging = vAPI.messaging;

messaging.addChannelListener('loggerUI', function(msg) {
    switch ( msg.what ) {
    case 'connectionBroken':
        if ( inspectorConnectionId === msg.id ) {
            filterToIdMap.clear();
            logger.removeAllChildren(domTree);
            inspectorConnectionId = undefined;
        }
        injectInspector();
        break;
    case 'connectionMessage':
        if ( msg.payload.what === 'domLayoutFull' ) {
            inspectedURL = msg.payload.url;
            inspectedHostname = msg.payload.hostname;
            renderDOMFull(msg.payload);
        } else if ( msg.payload.what === 'domLayoutIncremental' ) {
            renderDOMIncremental(msg.payload);
        }
        break;
    case 'connectionRequested':
        if ( msg.from !== 'domInspector' ) { return false; }
        if ( msg.tabId !== inspectedTabId ) { return false; }
        filterToIdMap.clear();
        logger.removeAllChildren(domTree);
        inspectorConnectionId = msg.id;
        return true;
    }
});

/******************************************************************************/

var nodeFromDomEntry = function(entry) {
    var node, value;
    var li = document.createElement('li');
    li.setAttribute('id', entry.nid);
    // expander/collapser
    li.appendChild(document.createElement('span'));
    // selector
    node = document.createElement('code');
    node.textContent = entry.sel;
    li.appendChild(node);
    // descendant count
    value = entry.cnt || 0;
    node = document.createElement('span');
    node.textContent = value !== 0 ? value.toLocaleString() : '';
    node.setAttribute('data-cnt', value);
    li.appendChild(node);
    // cosmetic filter
    if ( entry.filter === undefined ) {
        return li;
    }
    node = document.createElement('code');
    node.classList.add('filter');
    value = filterToIdMap.get(entry.filter);
    if ( value === undefined ) {
        value = uidGenerator.toString();
        filterToIdMap.set(entry.filter, value);
        uidGenerator += 1;
    }
    node.setAttribute('data-filter-id', value);
    node.textContent = entry.filter;
    li.appendChild(node);
    li.classList.add('isCosmeticHide');
    return li;
};

/******************************************************************************/

var appendListItem = function(ul, li) {
    ul.appendChild(li);
    // Ancestor nodes of a node which is affected by a cosmetic filter will
    // be marked as "containing cosmetic filters", for user convenience.
    if ( li.classList.contains('isCosmeticHide') === false ) {
        return;
    }
    for (;;) {
        li = li.parentElement.parentElement;
        if ( li === null ) {
            break;
        }
        li.classList.add('hasCosmeticHide');
    }
};

/******************************************************************************/

var renderDOMFull = function(response) {
    var domTreeParent = domTree.parentElement;
    var ul = domTreeParent.removeChild(domTree);
    logger.removeAllChildren(domTree);

    filterToIdMap.clear();

    var lvl = 0;
    var entries = response.layout;
    var n = entries.length;
    var li, entry;
    for ( var i = 0; i < n; i++ ) {
        entry = entries[i];
        if ( entry.lvl === lvl ) {
            li = nodeFromDomEntry(entry);
            appendListItem(ul, li);
            continue;
        }
        if ( entry.lvl > lvl ) {
            ul = document.createElement('ul');
            li.appendChild(ul);
            li.classList.add('branch');
            li = nodeFromDomEntry(entry);
            appendListItem(ul, li);
            lvl = entry.lvl;
            continue;
        }
        // entry.lvl < lvl
        while ( entry.lvl < lvl ) {
            ul = li.parentNode;
            li = ul.parentNode;
            ul = li.parentNode;
            lvl -= 1;
        }
        li = nodeFromDomEntry(entry);
        appendListItem(ul, li);
    }
    while ( ul.parentNode !== null ) {
        ul = ul.parentNode;
    }
    ul.firstElementChild.classList.add('show');

    domTreeParent.appendChild(domTree);
};

// https://www.youtube.com/watch?v=IDGNA83mxDo

/******************************************************************************/

var patchIncremental = function(from, delta) {
    var span, cnt;
    var li = from.parentElement.parentElement;
    var patchCosmeticHide = delta >= 0 &&
                            from.classList.contains('isCosmeticHide') &&
                            li.classList.contains('hasCosmeticHide') === false;
    // Include descendants count when removing a node
    if ( delta < 0 ) {
        delta -= countFromNode(from);
    }
    for ( ; li.localName === 'li'; li = li.parentElement.parentElement ) {
        span = li.children[2];
        if ( delta !== 0 ) {
            cnt = countFromNode(li) + delta;
            span.textContent = cnt !== 0 ? cnt.toLocaleString() : '';
            span.setAttribute('data-cnt', cnt);
        }
        if ( patchCosmeticHide ) {
            li.classList.add('hasCosmeticHide');
        }
    }
};

/******************************************************************************/

var renderDOMIncremental = function(response) {
    // Process each journal entry:
    //  1 = node added
    // -1 = node removed
    var journal = response.journal;
    var nodes = new Map(response.nodes);
    var entry, previous, li, ul;
    for ( var i = 0, n = journal.length; i < n; i++ ) {
        entry = journal[i];
        // Remove node
        if ( entry.what === -1 ) {
            li = document.getElementById(entry.nid);
            if ( li === null ) { continue; }
            patchIncremental(li, -1);
            li.parentNode.removeChild(li);
            continue;
        }
        // Modify node
        if ( entry.what === 0 ) {
            // TODO: update selector/filter
            continue;
        }
        // Add node as sibling
        if ( entry.what === 1 && entry.l ) {
            previous = document.getElementById(entry.l);
            // This should not happen
            if ( previous === null ) {
                // throw new Error('No left sibling!?');
                continue;
            }
            ul = previous.parentElement;
            li = nodeFromDomEntry(nodes.get(entry.nid));
            ul.insertBefore(li, previous.nextElementSibling);
            patchIncremental(li, 1);
            continue;
        }
        // Add node as child
        if ( entry.what === 1 && entry.u ) {
            li = document.getElementById(entry.u);
            // This should not happen
            if ( li === null ) {
                // throw new Error('No parent!?');
                continue;
            }
            ul = li.querySelector('ul');
            if ( ul === null ) {
                ul = document.createElement('ul');
                li.appendChild(ul);
                li.classList.add('branch');
            }
            li = nodeFromDomEntry(nodes.get(entry.nid));
            ul.appendChild(li);
            patchIncremental(li, 1);
            continue;
        }
    }
};

// https://www.youtube.com/watch?v=6u2KPtJB9h8

/******************************************************************************/

var countFromNode = function(li) {
    var span = li.children[2];
    var cnt = parseInt(span.getAttribute('data-cnt'), 10);
    return isNaN(cnt) ? 0 : cnt;
};

/******************************************************************************/

var selectorFromNode = function(node) {
    var selector = '';
    var code;
    while ( node !== null ) {
        if ( node.localName === 'li' ) {
            code = node.querySelector('code');
            if ( code !== null ) {
                selector = code.textContent + ' > ' + selector;
                if ( selector.indexOf('#') !== -1 ) {
                    break;
                }
            }
        }
        node = node.parentElement;
    }
    return selector.slice(0, -3);
};

/******************************************************************************/

var selectorFromFilter = function(node) {
    while ( node !== null ) {
        if ( node.localName === 'li' ) {
            var code = node.querySelector('code:nth-of-type(2)');
            if ( code !== null ) {
                return code.textContent;
            }
        }
        node = node.parentElement;
    }
    return '';
};

/******************************************************************************/

var nidFromNode = function(node) {
    var li = node;
    while ( li !== null ) {
        if ( li.localName === 'li' ) {
            return li.id || '';
        }
        li = li.parentElement;
    }
    return '';
};

/******************************************************************************/

var startDialog = (function() {
    var dialog = uDom.nodeFromId('cosmeticFilteringDialog');
    var textarea = dialog.querySelector('textarea');
    var hideSelectors = [];
    var unhideSelectors = [];
    var inputTimer = null;

    var onInputChanged = (function() {
        var parse = function() {
            inputTimer = null;
            hideSelectors = [];
            unhideSelectors = [];

            var line, matches;
            var re = /^([^#]*)(#@?#)(.+)$/;
            var lines = textarea.value.split(/\s*\n\s*/);
            for ( var i = 0; i < lines.length; i++ ) {
                line = lines[i].trim();
                if ( line === '' || line.charAt(0) === '!' ) {
                    continue;
                }
                matches = re.exec(line);
                if ( matches === null || matches.length !== 4 ) {
                    continue;
                }
                if ( inspectedHostname.lastIndexOf(matches[1]) === -1 ) {
                    continue;
                }
                if ( matches[2] === '##' ) {
                    hideSelectors.push(matches[3]);
                } else {
                    unhideSelectors.push(matches[3]);
                }
            }

            showCommitted();
        };

        return function parseAsync() {
            if ( inputTimer === null ) {
                inputTimer = vAPI.setTimeout(parse, 743);
            }
        };
    })();

    var onClicked = function(ev) {
        var target = ev.target;

        // click outside the dialog proper
        if ( target.classList.contains('modalDialog') ) {
            return stop();
        }
        ev.stopPropagation();

        if ( target.id === 'createCosmeticFilters' ) {
            messaging.send('loggerUI', { what: 'createUserFilter', filters: textarea.value });
            // Force a reload for the new cosmetic filter(s) to take effect
            messaging.send('loggerUI', { what: 'reloadTab', tabId: inspectedTabId });
            return stop();
        }
    };

    var showCommitted = function() {
        messaging.sendTo(inspectorConnectionId, {
            what: 'showCommitted',
            hide: hideSelectors.join(',\n'),
            unhide: unhideSelectors.join(',\n')
        });
    };

    var showInteractive = function() {
        messaging.sendTo(inspectorConnectionId, {
            what: 'showInteractive',
            hide: hideSelectors.join(',\n'),
            unhide: unhideSelectors.join(',\n')
        });
    };

    var start = function() {
        hideSelectors = [];
        textarea.addEventListener('input', onInputChanged);
        var node;
        for ( node of domTree.querySelectorAll('code.off') ) {
            if ( node.classList.contains('filter') === false ) {
                hideSelectors.push(selectorFromNode(node));
            }
        }
        var taValue = [];
        var d = new Date();
        taValue.push('! ' + d.toLocaleString() + ' ' + inspectedURL);
        for ( var selector of hideSelectors ) {
            taValue.push(inspectedHostname + '##' + selector);
        }
        var ids = new Set(), id;
        for ( node of domTree.querySelectorAll('code.filter.off') ) {
            id = node.getAttribute('data-filter-id');
            if ( ids.has(id) ) { continue; }
            ids.add(id);
            unhideSelectors.push(node.textContent);
            taValue.push(inspectedHostname + '#@#' + node.textContent);
        }
        textarea.value = taValue.join('\n');
        document.body.appendChild(dialog);
        dialog.addEventListener('click', onClicked, true);
        showCommitted();
    };

    var stop = function() {
        if ( inputTimer !== null ) {
            clearTimeout(inputTimer);
            inputTimer = null;
        }
        showInteractive();
        hideSelectors = [];
        unhideSelectors = [];
        textarea.removeEventListener('input', onInputChanged);
        dialog.removeEventListener('click', onClicked, true);
        document.body.removeChild(dialog);
    };

    return start;
})();

/******************************************************************************/

var onClicked = function(ev) {
    ev.stopPropagation();

    if ( inspectedTabId === '' ) { return; }

    var target = ev.target;
    var parent = target.parentElement;

    // Expand/collapse branch
    if (
        target.localName === 'span' &&
        parent instanceof HTMLLIElement &&
        parent.classList.contains('branch') &&
        target === parent.firstElementChild
    ) {
        var state = parent.classList.toggle('show');
        if ( !state ) {
            for ( var node of parent.querySelectorAll('.branch') ) {
                node.classList.remove('show');
            }
        }
        return;
    }

    // Not a node or filter 
    if ( target.localName !== 'code' ) { return; }

    // Toggle cosmetic filter
    if ( target.classList.contains('filter') ) {
        messaging.sendTo(inspectorConnectionId, {
            what: 'toggleFilter',
            original: false,
            target: target.classList.toggle('off'),
            selector: selectorFromNode(target),
            filter: selectorFromFilter(target),
            nid: nidFromNode(target)
        });
        uDom('[data-filter-id="' + target.getAttribute('data-filter-id') + '"]', inspector).toggleClass(
            'off',
            target.classList.contains('off')
        );
    }
    // Toggle node
    else {
        messaging.sendTo(inspectorConnectionId, {
            what: 'toggleNodes',
            original: true,
            target: target.classList.toggle('off') === false,
            selector: selectorFromNode(target),
            nid: nidFromNode(target)
        });
    }

    var cantCreate = domTree.querySelector('.off') === null;
    inspector.querySelector('.permatoolbar .revert').classList.toggle('disabled', cantCreate);
    inspector.querySelector('.permatoolbar .commit').classList.toggle('disabled', cantCreate);
};

/******************************************************************************/

var onMouseOver = (function() {
    var mouseoverTarget = null;
    var mouseoverTimer = null;

    var timerHandler = function() {
        mouseoverTimer = null;
        messaging.sendTo(inspectorConnectionId, {
            what: 'highlightOne',
            selector: selectorFromNode(mouseoverTarget),
            nid: nidFromNode(mouseoverTarget),
            scrollTo: true
        });
    };

    return function(ev) {
        if ( inspectedTabId === '' ) { return; }
        // Convenience: skip real-time highlighting if shift key is pressed.
        if ( ev.shiftKey ) { return; }
        // Find closest `li`
        var target = ev.target;
        while ( target !== null ) {
            if ( target.localName === 'li' ) { break; }
            target = target.parentElement;
        }
        if ( target === mouseoverTarget ) { return; }
        mouseoverTarget = target;
        if ( mouseoverTimer === null ) {
            mouseoverTimer = vAPI.setTimeout(timerHandler, 50);
        }
    };
})();

/******************************************************************************/

var currentTabId = function() {
    if ( showdomButton.classList.contains('active') === false ) { return ''; }
    var tabId = logger.tabIdFromClassName(tabSelector.value) || '';
    return tabId !== 'bts' ? tabId : '';
};

/******************************************************************************/

var injectInspector = function() {
    var tabId = currentTabId();
    if ( tabId === '' ) { return; }
    inspectedTabId = tabId;
    messaging.send('loggerUI', {
        what: 'scriptlet',
        tabId: tabId,
        scriptlet: 'dom-inspector'
    });
};

/******************************************************************************/

var shutdownInspector = function() {
    if ( inspectorConnectionId !== undefined ) {
        messaging.disconnectFrom(inspectorConnectionId);
        inspectorConnectionId = undefined;
    }
    logger.removeAllChildren(domTree);
    inspector.classList.add('vCompact');
    inspectedTabId = '';
};

/******************************************************************************/

var onTabIdChanged = function() {
    if ( inspectedTabId !== currentTabId() ) {
        shutdownInspector();
        injectInspector();
    }
};

/******************************************************************************/

var toggleVCompactView = function() {
    var state = !inspector.classList.toggle('vCompact');
    var branches = document.querySelectorAll('#domInspector li.branch');
    for ( var branch of branches ) {
        branch.classList.toggle('show', state);
    }
};

var toggleHCompactView = function() {
    inspector.classList.toggle('hCompact');
};

/******************************************************************************/

var toggleHighlightMode = function() {
    messaging.sendTo(inspectorConnectionId, {
        what: 'highlightMode',
        invert: uDom.nodeFromSelector('#domInspector .permatoolbar .highlightMode').classList.toggle('invert')
    });
};

/******************************************************************************/

var revert = function() {
    uDom('#domTree .off').removeClass('off');
    messaging.sendTo(inspectorConnectionId, { what: 'resetToggledNodes' });
    inspector.querySelector('.permatoolbar .revert').classList.add('disabled');
    inspector.querySelector('.permatoolbar .commit').classList.add('disabled');
};

/******************************************************************************/

var toggleOn = function() {
    window.addEventListener('beforeunload', toggleOff);
    tabSelector.addEventListener('change', onTabIdChanged);
    domTree.addEventListener('click', onClicked, true);
    domTree.addEventListener('mouseover', onMouseOver, true);
    uDom.nodeFromSelector('#domInspector .vCompactToggler').addEventListener('click', toggleVCompactView);
    uDom.nodeFromSelector('#domInspector .hCompactToggler').addEventListener('click', toggleHCompactView);
    uDom.nodeFromSelector('#domInspector .permatoolbar .highlightMode').addEventListener('click', toggleHighlightMode);
    uDom.nodeFromSelector('#domInspector .permatoolbar .revert').addEventListener('click', revert);
    uDom.nodeFromSelector('#domInspector .permatoolbar .commit').addEventListener('click', startDialog);
    injectInspector();
};

/******************************************************************************/

var toggleOff = function() {
    shutdownInspector();
    window.removeEventListener('beforeunload', toggleOff);
    tabSelector.removeEventListener('change', onTabIdChanged);
    domTree.removeEventListener('click', onClicked, true);
    domTree.removeEventListener('mouseover', onMouseOver, true);
    uDom.nodeFromSelector('#domInspector .vCompactToggler').removeEventListener('click', toggleVCompactView);
    uDom.nodeFromSelector('#domInspector .hCompactToggler').removeEventListener('click', toggleHCompactView);
    uDom.nodeFromSelector('#domInspector .permatoolbar .highlightMode').removeEventListener('click', toggleHighlightMode);
    uDom.nodeFromSelector('#domInspector .permatoolbar .revert').removeEventListener('click', revert);
    uDom.nodeFromSelector('#domInspector .permatoolbar .commit').removeEventListener('click', startDialog);
    inspectedTabId = '';
};

/******************************************************************************/

var toggle = function() {
    if ( showdomButton.classList.toggle('active') ) {
        toggleOn();
    } else {
        toggleOff();
    }
};

/******************************************************************************/

showdomButton.addEventListener('click', toggle);

/******************************************************************************/

})();



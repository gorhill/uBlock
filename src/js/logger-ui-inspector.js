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

/* global vAPI, uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var showdomButton = uDom.nodeFromId('showdom');

// Don't bother if the browser is not modern enough.
if ( typeof Map === undefined || typeof WeakMap === undefined ) {
    showdomButton.classList.add('disabled');
    return;
}

/******************************************************************************/

var logger = self.logger;
var messager = logger.messager;

var inspectedTabId = '';
var inspectedURL = '';
var inspectedHostname = '';
var pollTimer = null;
var fingerprint = null;
var inspector = uDom.nodeFromId('domInspector');
var domTree = uDom.nodeFromId('domTree');
var tabSelector = uDom.nodeFromId('pageSelector');

/******************************************************************************/

var nodeFromDomEntry = function(entry) {
    var node, value;
    var li = document.createElement('li');
    li.setAttribute('id', entry.nid);
    // expander/collapser
    node = document.createElement('span');
    li.appendChild(node);
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
    if ( entry.filter !== undefined ) {
        node = document.createElement('code');
        node.classList.add('filter');
        node.textContent = entry.filter;
        li.appendChild(node);
        li.classList.add('isCosmeticHide');
    }
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

    var lvl = 0;
    var entries = response.layout;
    var n = entries.length;
    var li, entry;
    for ( var i = 0; i < n; i++ ) {
        entry = entries[i];
        if ( entry.lvl === lvl ) {
            li = nodeFromDomEntry(entry);
            appendListItem(ul, li);
            //expandIfBlockElement(li);
            continue;
        }
        if ( entry.lvl > lvl ) {
            ul = document.createElement('ul');
            li.appendChild(ul);
            li.classList.add('branch');
            li = nodeFromDomEntry(entry);
            appendListItem(ul, li);
            //expandIfBlockElement(li);
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
        ul.appendChild(li);
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
                            from.classList.contains('isCosmeticFilter') &&
                            li.classList.contains('hasCosmeticFilter') === false;
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
            li.classList.add('hasCosmeticFilter');
        }
    }
};

/******************************************************************************/

var renderDOMIncremental = function(response) {
    // Process each journal entry:
    //  1 = node added
    // -1 = node removed
    var journal = response.journal;
    var nodes = response.nodes;
    var entry, previous, li, ul;
    for ( var i = 0, n = journal.length; i < n; i++ ) {
        entry = journal[i];
        // Remove node
        if ( entry.what === -1 ) {
            li = document.getElementById(entry.nid);
            if ( li === null ) {
                continue;
            }
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
            li = nodeFromDomEntry(nodes[entry.nid]);
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
            li = nodeFromDomEntry(nodes[entry.nid]);
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
    return isNaN(cnt) ? cnt : 0;
};

/******************************************************************************/

var selectorFromNode = function(node, nth) {
    var selector = '';
    var code;
    if ( nth === undefined ) {
        nth = 1;
    }
    while ( node !== null ) {
        if ( node.localName === 'li' ) {
            code = node.querySelector('code:nth-of-type(' + nth + ')');
            if ( code !== null ) {
                selector = code.textContent + ' > ' + selector;
                if ( selector.indexOf('#') !== -1 ) {
                    break;
                }
                nth = 1;
            }
        }
        node = node.parentElement;
    }
    return selector.slice(0, -3);
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

    var onClick = function(ev) {
        var target = ev.target;

        // click outside the dialog proper
        if ( target.classList.contains('modalDialog') ) {
            return stop();
        }
        ev.stopPropagation();

        if ( target.id === 'createCosmeticFilters' ) {
            messager.send({ what: 'createUserFilter', filters: textarea.value });
            // Force a reload for the new cosmetic filter(s) to take effect
            messager.send({ what: 'reloadTab', tabId: inspectedTabId });
            return stop();
        }
    };

    var onCooked = function(entries) {
        if ( Array.isArray(entries) === false ) {
            return;
        }
        hideSelectors = entries;
        var taValue = [], i, node;
        var d = new Date();
        taValue.push('! ' + d.toLocaleString() + ' ' + inspectedURL);
        for ( i = 0; i < entries.length; i++ ) {
            taValue.push(inspectedHostname + '##' + entries[i]);
        }
        var nodes = domTree.querySelectorAll('code.filter.off');
        for ( i = 0; i < nodes.length; i++ ) {
            node = nodes[i];
            unhideSelectors.push(node.textContent);
            taValue.push(inspectedHostname + '#@#' + node.textContent);
        }
        textarea.value = taValue.join('\n');
        document.body.appendChild(dialog);
        dialog.addEventListener('click', onClick, true);
        showCommitted();
    };

    var showCommitted = function() {
        messager.sendTo(
            {
                what: 'showCommitted',
                hide: hideSelectors.join(',\n'),
                unhide: unhideSelectors.join(',\n')
            },
            inspectedTabId,
            'dom-inspector.js'
        );
    };

    var showInteractive = function() {
        messager.sendTo(
            {
                what: 'showInteractive',
                hide: hideSelectors.join(',\n'),
                unhide: unhideSelectors.join(',\n')
            },
            inspectedTabId,
            'dom-inspector.js'
        );
    };

    var start = function() {
        textarea.addEventListener('input', onInputChanged);
        var node, entries = [];
        var nodes = domTree.querySelectorAll('code.off');
        for ( var i = 0; i < nodes.length; i++ ) {
            node = nodes[i];
            if ( node.classList.contains('filter') === false ) {
                entries.push({
                    nid: nidFromNode(node),
                    selector: selectorFromNode(node)
                });
            }
        }
        messager.sendTo(
            { what: 'cookFilters', entries: entries },
            inspectedTabId,
            'dom-inspector.js',
            onCooked
        );
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
        dialog.removeEventListener('click', onClick, true);
        document.body.removeChild(dialog);
    };

    return start;
})();

/******************************************************************************/

var onClick = function(ev) {
    ev.stopPropagation();

    if ( inspectedTabId === '' ) {
        return;
    }

    var target = ev.target;
    var parent = target.parentElement;

    // Expand/collapse branch
    if (
        target.localName === 'span' &&
        parent instanceof HTMLLIElement &&
        parent.classList.contains('branch') &&
        target === parent.firstElementChild
    ) {
        target.parentElement.classList.toggle('show');
        return;
    }

    // Toggle selector
    if ( target.localName === 'code' ) {
        var original = target.classList.contains('filter') === false;
        messager.sendTo(
            {
                what: 'toggleNodes',
                original: original,
                target: original !== target.classList.toggle('off'),
                selector: selectorFromNode(target, original ? 1 : 2),
                nid: original ? nidFromNode(target) : ''
            },
            inspectedTabId,
            'dom-inspector.js'
        );
        var cantCreate = domTree.querySelector('.off') === null;
        inspector.querySelector('.permatoolbar .revert').classList.toggle('disabled', cantCreate);
        inspector.querySelector('.permatoolbar .commit').classList.toggle('disabled', cantCreate);
        return;
    }
};

/******************************************************************************/

var onMouseOver = (function() {
    var mouseoverTarget = null;
    var mouseoverTimer = null;

    var timerHandler = function() {
        mouseoverTimer = null;
        messager.sendTo(
            {
                what: 'highlightOne',
                selector: selectorFromNode(mouseoverTarget),
                nid: nidFromNode(mouseoverTarget),
                scrollTo: true
            },
            inspectedTabId,
            'dom-inspector.js'
        );
    };

    return function(ev) {
        if ( inspectedTabId === '' ) {
            return;
        }
        // Convenience: skip real-time highlighting if shift key is pressed.
        if ( ev.shiftKey ) {
            return;
        }
        // Find closest `li`
        var target = ev.target;
        while ( target !== null ) {
            if ( target.localName === 'li' ) {
                break;
            }
            target = target.parentElement;
        }
        if ( target === mouseoverTarget ) {
            return;
        }
        mouseoverTarget = target;
        if ( mouseoverTimer === null ) {
            mouseoverTimer = vAPI.setTimeout(timerHandler, 50);
        }
    };
})();

/******************************************************************************/

var currentTabId = function() {
    if ( showdomButton.classList.contains('active') === false ) {
        return '';
    }
    var tabId = logger.tabIdFromClassName(tabSelector.value) || '';
    return tabId !== 'bts' ? tabId : '';
};

/******************************************************************************/

var fetchDOMAsync = (function() {
    var onFetched = function(response) {
        if ( !response || currentTabId() !== inspectedTabId ) {
            shutdownInspector();
            injectInspectorAsync(250);
            return;
        }

        switch ( response.status ) {
        case 'full':
            renderDOMFull(response);
            fingerprint = response.fingerprint;
            inspectedURL = response.url;
            inspectedHostname = response.hostname;
            break;

        case 'incremental':
            renderDOMIncremental(response);
            break;

        case 'nochange':
        case 'busy':
            break;

        default:
            break;
        }

        fetchDOMAsync();
    };

    var onTimeout = function() {
        pollTimer = null;
        messager.sendTo(
            {
                what: 'domLayout',
                fingerprint: fingerprint
            },
            inspectedTabId,
            'dom-inspector.js',
            onFetched
        );
    };

    // Poll for DOM layout data every ~2 seconds at most
    return function(delay) {
        if ( pollTimer === null ) {
            pollTimer = vAPI.setTimeout(onTimeout, delay || 2003);
        }
    };
})();

/******************************************************************************/

var injectInspector = function() {
    var tabId = currentTabId();
    // No valid tab, go back
    if ( tabId === '' ) {
        injectInspectorAsync();
        return;
    }
    inspectedTabId = tabId;
    fingerprint = null;
    messager.send({
        what: 'scriptlet',
        tabId: tabId,
        scriptlet: 'dom-inspector'
    });
    fetchDOMAsync(250);
};

/******************************************************************************/

var injectInspectorAsync = function(delay) {
    if ( pollTimer !== null ) {
        return;
    }
    if ( showdomButton.classList.contains('active') === false ) {
        return;
    }
    pollTimer = vAPI.setTimeout(function() {
        pollTimer = null;
        injectInspector();
    }, delay || 1001);
};

/******************************************************************************/

var shutdownInspector = function() {
    if ( inspectedTabId !== '' ) {
        messager.sendTo({ what: 'shutdown' }, inspectedTabId, 'dom-inspector.js');
    }
    logger.removeAllChildren(domTree);
    if ( pollTimer !== null ) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
    inspectedTabId = '';
};

/******************************************************************************/

var onTabIdChanged = function() {
    if ( inspectedTabId !== currentTabId() ) {
        shutdownInspector();
        injectInspectorAsync(250);
    }
};

/******************************************************************************/

var toggleHighlightMode = function() {
    messager.sendTo(
        {
            what: 'highlightMode',
            invert: uDom.nodeFromSelector('#domInspector .permatoolbar .highlightMode').classList.toggle('invert')
        },
        inspectedTabId,
        'dom-inspector.js'
    );
};

/******************************************************************************/

var revert = function() {
    uDom('#domTree .off').removeClass('off');
    messager.sendTo(
        { what: 'resetToggledNodes' },
        inspectedTabId,
        'dom-inspector.js'
    );
    inspector.querySelector('.permatoolbar .revert').classList.add('disabled');
    inspector.querySelector('.permatoolbar .commit').classList.add('disabled');
};

/******************************************************************************/

var toggleOn = function() {
    window.addEventListener('beforeunload', toggleOff);
    tabSelector.addEventListener('change', onTabIdChanged);
    domTree.addEventListener('click', onClick, true);
    domTree.addEventListener('mouseover', onMouseOver, true);
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
    domTree.removeEventListener('click', onClick, true);
    domTree.removeEventListener('mouseover', onMouseOver, true);
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



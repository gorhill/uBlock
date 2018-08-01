/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-present Raymond Hill

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

var logger = self.logger = {
    ownerId: Date.now()
};

var messaging = vAPI.messaging;
var activeTabId;

/******************************************************************************/

var removeAllChildren = logger.removeAllChildren = function(node) {
    while ( node.firstChild ) {
        node.removeChild(node.firstChild);
    }
};

/******************************************************************************/

var tabIdFromClassName = function(className) {
    var matches = className.match(/\btab_([^ ]+)\b/);
    if ( matches === null ) { return 0; }
    if ( matches[1] === 'bts' ) { return -1; }
    return parseInt(matches[1], 10);
};

var tabIdFromPageSelector = logger.tabIdFromPageSelector = function() {
    var tabClass = uDom.nodeFromId('pageSelector').value;
    if ( tabClass === 'tab_active' && activeTabId !== undefined ) {
        return activeTabId;
    }
    return /^tab_\d+$/.test(tabClass) ? parseInt(tabClass.slice(4), 10) : 0;
};

/******************************************************************************/
/******************************************************************************/

// Adjust top padding of content table, to match that of toolbar height.

(function() {
    var toolbar = uDom.nodeFromSelector('body > .permatoolbar');
    var size = toolbar.clientHeight + 'px';
    uDom('#inspectors').css('top', size);
    uDom('.vscrollable').css('padding-top', size);
})();

/******************************************************************************/

var tbody = document.querySelector('#netInspector tbody');
var trJunkyard = [];
var tdJunkyard = [];
var firstVarDataCol = 2;  // currently, column 2 (0-based index)
var lastVarDataIndex = 4; // currently, d0-d3
var maxEntries = 5000;
var allTabIds = new Map();
var allTabIdsToken;
var hiddenTemplate = document.querySelector('#hiddenTemplate > span');
var reRFC3986 = /^([^:\/?#]+:)?(\/\/[^\/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?/;
var netFilteringDialog = uDom.nodeFromId('netFilteringDialog');

var prettyRequestTypes = {
    'main_frame': 'doc',
    'stylesheet': 'css',
    'sub_frame': 'frame',
    'xmlhttprequest': 'xhr'
};

var uglyRequestTypes = {
    'doc': 'main_frame',
    'css': 'stylesheet',
    'frame': 'sub_frame',
    'xhr': 'xmlhttprequest'
};

var staticFilterTypes = {
    'beacon': 'other',
    'doc': 'document',
    'css': 'stylesheet',
    'frame': 'subdocument',
    'ping': 'other',
    'object_subrequest': 'object',
    'xhr': 'xmlhttprequest'
};

/******************************************************************************/

var classNameFromTabId = function(tabId) {
    if ( tabId < 0 ) {
        return 'tab_bts';
    }
    if ( tabId !== 0 ) {
        return 'tab_' + tabId;
    }
    return '';
};

/******************************************************************************/
/******************************************************************************/

var regexFromURLFilteringResult = function(result) {
    var beg = result.indexOf(' ');
    var end = result.indexOf(' ', beg + 1);
    var url = result.slice(beg + 1, end);
    if ( url === '*' ) {
        return new RegExp('^.*$', 'gi');
    }
    return new RegExp('^' + url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
};

/******************************************************************************/

// Emphasize hostname in URL, as this is what matters in uMatrix's rules.

var nodeFromURL = function(url, re) {
    if ( re instanceof RegExp === false ) {
        return document.createTextNode(url);
    }
    var matches = re.exec(url);
    if ( matches === null || matches[0].length === 0 ) {
        return document.createTextNode(url);
    }
    var node = renderedURLTemplate.cloneNode(true);
    node.childNodes[0].textContent = url.slice(0, matches.index);
    node.childNodes[1].textContent = url.slice(matches.index, re.lastIndex);
    node.childNodes[2].textContent = url.slice(re.lastIndex);
    return node;
};

var renderedURLTemplate = document.querySelector('#renderedURLTemplate > span');

/******************************************************************************/

var createCellAt = function(tr, index) {
    var td = tr.cells[index];
    var mustAppend = !td;
    if ( mustAppend ) {
        td = tdJunkyard.pop();
    }
    if ( td ) {
        td.removeAttribute('colspan');
        td.textContent = '';
    } else {
        td = document.createElement('td');
    }
    if ( mustAppend ) {
        tr.appendChild(td);
    }
    return td;
};

/******************************************************************************/

var createRow = function(layout) {
    var tr = trJunkyard.pop();
    if ( tr ) {
        tr.className = '';
        tr.removeAttribute('data-hn-page');
        tr.removeAttribute('data-hn-frame');
        tr.removeAttribute('data-filter');
    } else {
        tr = document.createElement('tr');
    }
    for ( var index = 0; index < firstVarDataCol; index++ ) {
        createCellAt(tr, index);
    }
    var i = 1, span = 1, td;
    for (;;) {
        td = createCellAt(tr, index);
        if ( i === lastVarDataIndex ) {
            break;
        }
        if ( layout.charAt(i) !== '1' ) {
            span += 1;
        } else {
            if ( span !== 1 ) {
                td.setAttribute('colspan', span);
            }
            index += 1;
            span = 1;
        }
        i += 1;
    }
    if ( span !== 1 ) {
        td.setAttribute('colspan', span);
    }
    index += 1;
    while ( (td = tr.cells[index]) ) {
        tdJunkyard.push(tr.removeChild(td));
    }
    return tr;
};

/******************************************************************************/

var createHiddenTextNode = function(text) {
    var node = hiddenTemplate.cloneNode(true);
    node.textContent = text;
    return node;
};

/******************************************************************************/

var padTo2 = function(v) {
    return v < 10 ? '0' + v : v;
};

/******************************************************************************/

var createGap = function(tabId, url) {
    var tr = createRow('1');
    tr.classList.add('tab');
    tr.classList.add('canMtx');
    tr.classList.add('tab_' + tabId);
    tr.classList.add('maindoc');
    tr.cells[firstVarDataCol].textContent = url;
    tbody.insertBefore(tr, tbody.firstChild);
};

/******************************************************************************/

var renderNetLogEntry = function(tr, entry) {
    var trcl = tr.classList;
    var filter = entry.d0 || undefined;
    var type = entry.d1;
    var url = entry.d2;
    var td;

    trcl.add('canMtx');

    // If the request is that of a root frame, insert a gap in the table
    // in order to visually separate entries for different documents. 
    if ( type === 'main_frame' ) {
        createGap(entry.tab, url);
    }

    // Contexts
    if ( entry.d3 ) {
        tr.setAttribute('data-hn-page', entry.d3);
    }
    if ( entry.d4 ) {
        tr.setAttribute('data-hn-frame', entry.d4);
    }

    var filteringType;
    if ( filter !== undefined && typeof filter.source === 'string' ) {
        filteringType = filter.source;
        trcl.add(filteringType);
    }

    td = tr.cells[2];
    if ( filter !== undefined ) {
        if ( filteringType === 'static' ) {
            td.textContent = filter.raw;
            trcl.add('canLookup');
            tr.setAttribute('data-filter', filter.compiled);
        } else if ( filteringType === 'cosmetic' ) {
            td.textContent = filter.raw;
            trcl.add('canLookup');
        } else {
            td.textContent = filter.raw;
        }
    }

    td = tr.cells[3];
    if ( filter !== undefined ) {
        if ( filter.result === 1 ) {
            trcl.add('blocked');
            td.textContent = '--';
        } else if ( filter.result === 2 ) {
            trcl.add('allowed');
            td.textContent = '++';
        } else if ( filter.result === 3 ) {
            trcl.add('nooped');
            td.textContent = '**';
        } else if ( filter.source === 'redirect' ) {
            trcl.add('redirect');
            td.textContent = '<<';
        }
    }

    tr.cells[4].textContent = (prettyRequestTypes[type] || type);

    var re = null;
    if ( filteringType === 'static' ) {
        re = new RegExp(filter.regex, 'gi');
    } else if ( filteringType === 'dynamicUrl' ) {
        re = regexFromURLFilteringResult(filter.rule.join(' '));
    }
    tr.cells[5].appendChild(nodeFromURL(url, re));
};

/******************************************************************************/

var renderLogEntry = function(entry) {
    var tr;
    var fvdc = firstVarDataCol;

    switch ( entry.cat ) {
    case 'error':
    case 'info':
        tr = createRow('1');
        tr.cells[fvdc].textContent = entry.d0;
        break;

    case 'cosmetic':
    case 'net':
    case 'redirect':
        tr = createRow('1111');
        renderNetLogEntry(tr, entry);
        break;

    default:
        tr = createRow('1');
        tr.cells[fvdc].textContent = entry.d0;
        break;
    }

    // Fields common to all rows.
    var time = logDate;
    time.setTime(entry.tstamp - logDateTimezoneOffset);
    tr.cells[0].textContent = padTo2(time.getUTCHours()) + ':' +
                              padTo2(time.getUTCMinutes()) + ':' +
                              padTo2(time.getSeconds());

    if ( entry.tab ) {
        tr.classList.add('tab');
        tr.classList.add(classNameFromTabId(entry.tab));
        if ( entry.tab < 0 ) {
            tr.cells[1].appendChild(createHiddenTextNode('bts'));
        }
    }
    if ( entry.cat !== '' ) {
        tr.classList.add('cat_' + entry.cat);
    }

    rowFilterer.filterOne(tr, true);
    tbody.insertBefore(tr, tbody.firstChild);
    return tr;
};

// Reuse date objects.
var logDate = new Date(),
    logDateTimezoneOffset = logDate.getTimezoneOffset() * 60000;

/******************************************************************************/

var renderLogEntries = function(response) {
    document.body.classList.toggle('colorBlind', response.colorBlind);

    let entries = response.entries;
    if ( entries.length === 0 ) { return; }

    // Preserve scroll position
    let height = tbody.offsetHeight;

    let tabIds = allTabIds;
    for ( let i = 0, n = entries.length; i < n; i++ ) {
        let entry = entries[i];
        let tr = renderLogEntry(entries[i]);
        // https://github.com/gorhill/uBlock/issues/1613#issuecomment-217637122
        // Unlikely, but it may happen: mark as void if associated tab no
        // longer exist.
        if ( entry.tab && tabIds.has(entry.tab) === false ) {
            tr.classList.remove('canMtx');
        }
    }

    // Prevent logger from growing infinitely and eating all memory. For
    // instance someone could forget that it is left opened for some
    // dynamically refreshed pages.
    truncateLog(maxEntries);

    // Follow waterfall if not observing top of waterfall.
    let yDelta = tbody.offsetHeight - height;
    if ( yDelta === 0 ) { return; }
    let container = uDom.nodeFromSelector('#netInspector .vscrollable');
    if ( container.scrollTop !== 0 ) {
        container.scrollTop += yDelta;
    }
};

/******************************************************************************/

let updateCurrentTabTitle = (function() {
    let i18nCurrentTab = vAPI.i18n('loggerCurrentTab');

    return function() {
        let select = uDom.nodeFromId('pageSelector');
        if ( select.value !== 'tab_active' ) { return; }
        let opt0 = select.querySelector('[value="tab_active"]');
        let opt1 = select.querySelector('[value="tab_' + activeTabId + '"]');
        let text = i18nCurrentTab;
        if ( opt1 !== null ) {
            text += ' / ' + opt1.textContent;
        }
        opt0.textContent = text;
    };
})();

/******************************************************************************/

var synchronizeTabIds = function(newTabIds) {
    var select = uDom.nodeFromId('pageSelector');
    var selectValue = select.value;

    var oldTabIds = allTabIds;
    var autoDeleteVoidRows = selectValue === 'tab_active';
    var rowVoided = false;
    for ( var tabId of oldTabIds.keys() ) {
        if ( newTabIds.has(tabId) ) { continue; }
        // Mark or remove voided rows
        var trs = uDom('.tab_' + tabId);
        if ( autoDeleteVoidRows ) {
            toJunkyard(trs);
        } else {
            trs.removeClass('canMtx');
            rowVoided = true;
        }
        // Remove popup if it is currently bound to a removed tab.
        if ( tabId === popupManager.tabId ) {
            popupManager.toggleOff();
        }
    }

    var tabIds = Array.from(newTabIds.keys()).sort(function(a, b) {
        return newTabIds.get(a).localeCompare(newTabIds.get(b));
    });
    var option;
    for ( var i = 0, j = 3; i < tabIds.length; i++ ) {
        tabId = tabIds[i];
        if ( tabId < 0 ) { continue; }
        option = select.options[j];
        if ( !option ) {
            option = document.createElement('option');
            select.appendChild(option);
        }
        // Truncate too long labels.
        option.textContent = newTabIds.get(tabId).slice(0, 80);
        option.value = classNameFromTabId(tabId);
        if ( option.value === selectValue ) {
            select.selectedIndex = j;
            option.setAttribute('selected', '');
        } else {
            option.removeAttribute('selected');
        }
        j += 1;
    }
    while ( j < select.options.length ) {
        select.removeChild(select.options[j]);
    }
    if ( select.value !== selectValue ) {
        select.selectedIndex = 0;
        select.value = '';
        select.options[0].setAttribute('selected', '');
        pageSelectorChanged();
    }

    allTabIds = newTabIds;

    updateCurrentTabTitle();

    return rowVoided;
};

/******************************************************************************/

var truncateLog = function(size) {
    if ( size === 0 ) {
        size = 5000;
    }
    var tbody = document.querySelector('#netInspector tbody');
    size = Math.min(size, 10000);
    var tr;
    while ( tbody.childElementCount > size ) {
        tr = tbody.lastElementChild;
        trJunkyard.push(tbody.removeChild(tr));
    }
};

/******************************************************************************/

var onLogBufferRead = function(response) {
    if ( !response || response.unavailable ) {
        readLogBufferAsync();
        return;
    }

    // Tab id of currently active tab
    let activeTabIdChanged = false;
    if ( response.activeTabId ) {
        activeTabIdChanged = response.activeTabId !== activeTabId;
        activeTabId = response.activeTabId;
    }

    // This may have changed meanwhile
    if ( response.maxEntries !== maxEntries ) {
        maxEntries = response.maxEntries;
        uDom('#maxEntries').val(maxEntries || '');
    }

    if ( Array.isArray(response.tabIds) ) {
        response.tabIds = new Map(response.tabIds);
    }

    // Neuter rows for which a tab does not exist anymore
    let rowVoided = false;
    if ( response.tabIds !== undefined ) {
        rowVoided = synchronizeTabIds(response.tabIds);
        allTabIdsToken = response.tabIdsToken;
    }

    if ( activeTabIdChanged ) {
        pageSelectorFromURLHash();
    }

    renderLogEntries(response);

    if ( rowVoided ) {
        uDom('#clean').toggleClass(
            'disabled',
            tbody.querySelector('#netInspector tr.tab:not(.canMtx)') === null
        );
    }

    // Synchronize toolbar with content of log
    uDom('#clear').toggleClass(
        'disabled',
        tbody.querySelector('tr') === null
    );

    readLogBufferAsync();
};

/******************************************************************************/

// This can be called only once, at init time. After that, this will be called
// automatically. If called after init time, this will be messy, and this would
// require a bit more code to ensure no multi time out events.

var readLogBuffer = function() {
    if ( logger.ownerId === undefined ) { return; }
    vAPI.messaging.send(
        'loggerUI',
        {
            what: 'readAll',
            ownerId: logger.ownerId,
            tabIdsToken: allTabIdsToken
        },
        onLogBufferRead
    );
};

var readLogBufferAsync = function() {
    if ( logger.ownerId === undefined ) { return; }
    vAPI.setTimeout(readLogBuffer, 1200);
};
 
/******************************************************************************/

let pageSelectorChanged = function() {
    let select = uDom.nodeFromId('pageSelector');
    window.location.replace('#' + select.value);
    pageSelectorFromURLHash();
};

let pageSelectorFromURLHash = (function() {
    let lastTabClass = '';
    let lastEffectiveTabClass = '';
    let reActiveTabId = /^(tab_[^+]+)\+(.+)$/;

    let selectRows = function(tabClass) {
        let effectiveTabClass = tabClass;
        if ( tabClass === 'tab_active' ) {
            if ( activeTabId === undefined ) { return; }
            effectiveTabClass = 'tab_' + activeTabId;
        }
        if ( effectiveTabClass === lastEffectiveTabClass ) { return; }
        lastEffectiveTabClass = effectiveTabClass;

        document.dispatchEvent(new Event('tabIdChanged'));

        let style = uDom.nodeFromId('tabFilterer');
        let sheet = style.sheet;
        while ( sheet.cssRules.length !== 0 )  {
            sheet.deleteRule(0);
        }
        if ( effectiveTabClass === '' ) { return; }
        sheet.insertRule(
            '#netInspector tr:not(.' + effectiveTabClass + '):not(.tab_bts) ' +
            '{display:none;}',
            0
        );

        updateCurrentTabTitle();
    };

    return function() {
        let tabClass = window.location.hash.slice(1);
        let match = reActiveTabId.exec(tabClass);
        if ( match !== null ) {
            tabClass = match[1];
            activeTabId = parseInt(match[2], 10) || undefined;
            window.location.hash = '#' + match[1];
        }
        selectRows(tabClass);
        if ( tabClass === lastTabClass ) { return; }
        lastTabClass = tabClass;

        let select = uDom.nodeFromId('pageSelector');
        let option = select.querySelector('option[value="' + tabClass + '"]');
        if ( option === null ) {
            window.location.hash = '';
            tabClass = '';
            option = select.options[0];
        }

        select.selectedIndex = option.index;
        select.value = option.value;

        uDom('.needtab').toggleClass(
            'disabled',
            tabClass === '' || tabClass === 'tab_bts'
        );
    };
})();

/******************************************************************************/

var reloadTab = function(ev) {
    var tabId = tabIdFromPageSelector();
    if ( tabId === 0 ) { return; }
    messaging.send('loggerUI', {
        what: 'reloadTab',
        tabId: tabId,
        bypassCache: ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey)
    });
};

/******************************************************************************/

var onMaxEntriesChanged = function() {
    var input = this;
    try {
        maxEntries = parseInt(input.value, 10);
        if ( maxEntries === 0 || isNaN(maxEntries) ) {
            maxEntries = 1000;
        }
    } catch (e) {
        maxEntries = 1000;
    }

    maxEntries = Math.min(maxEntries, 5000);
    maxEntries = Math.max(maxEntries, 10);

    input.value = maxEntries.toString(10);

    messaging.send(
        'loggerUI',
        {
            what: 'userSettings',
            name: 'requestLogMaxEntries',
            value: maxEntries
        }
    );

    truncateLog(maxEntries);
};

/******************************************************************************/
/******************************************************************************/

var netFilteringManager = (function() {
    var targetRow = null;
    var dialog = null;
    var createdStaticFilters = {};

    var targetType;
    var targetURLs = [];
    var targetFrameHostname;
    var targetPageHostname;
    var targetTabId;
    var targetDomain;
    var targetPageDomain;
    var targetFrameDomain;

    var uglyTypeFromSelector = function(pane) {
        var prettyType = selectValue('select.type.' + pane);
        if ( pane === 'static' ) {
            return staticFilterTypes[prettyType] || prettyType;
        }
        return uglyRequestTypes[prettyType] || prettyType;
    };

    var selectNode = function(selector) {
        return dialog.querySelector(selector);
    };

    var selectValue = function(selector) {
        return selectNode(selector).value || '';
    };

    var staticFilterNode = function() {
        return dialog.querySelector('div.containers > div.static textarea');
    };

    var onColorsReady = function(response) {
        document.body.classList.toggle('dirty', response.dirty);
        var colorEntries = response.colors;
        var colorEntry, node;
        for ( var url in colorEntries ) {
            if ( colorEntries.hasOwnProperty(url) === false ) {
                continue;
            }
            colorEntry = colorEntries[url];
            node = dialog.querySelector('.dynamic .entry .action[data-url="' + url + '"]');
            if ( node === null ) {
                continue;
            }
            node.classList.toggle('allow', colorEntry.r === 2);
            node.classList.toggle('noop', colorEntry.r === 3);
            node.classList.toggle('block', colorEntry.r === 1);
            node.classList.toggle('own', colorEntry.own);
        }
    };

    var colorize = function() {
        messaging.send(
            'loggerUI',
            {
                what: 'getURLFilteringData',
                context: selectValue('select.dynamic.origin'),
                urls: targetURLs,
                type: uglyTypeFromSelector('dynamic')
            },
            onColorsReady
        );
    };

    var parseStaticInputs = function() {
        var filter = '',
            options = [],
            block = selectValue('select.static.action') === '';
        if ( !block ) {
            filter = '@@';
        }
        var value = selectValue('select.static.url');
        if ( value !== '' ) {
            if ( value.slice(-1) === '/' ) {
                value += '*';
            } else if ( /[/?]/.test(value) === false ) {
                value += '^';
            }
            value = '||' + value;
        }
        filter += value;
        value = selectValue('select.static.type');
        if ( value !== '' ) {
            options.push(uglyTypeFromSelector('static'));
        }
        value = selectValue('select.static.origin');
        if ( value !== '' ) {
            if ( value === targetDomain ) {
                options.push('first-party');
            } else {
                options.push('domain=' + value);
            }
        }
        if ( block && selectValue('select.static.importance') !== '' ) {
            options.push('important');
        }
        if ( options.length ) {
            filter += '$' + options.join(',');
        }
        staticFilterNode().value = filter;
        updateWidgets();
    };

    var updateWidgets = function() {
        var value = staticFilterNode().value;
        dialog.querySelector('#createStaticFilter').classList.toggle(
            'disabled',
            createdStaticFilters.hasOwnProperty(value) || value === ''
        );
    };

    var onClick = function(ev) {
        var target = ev.target;

        // click outside the dialog proper
        if ( target.classList.contains('modalDialog') ) {
            toggleOff();
            return;
        }

        ev.stopPropagation();

        var tcl = target.classList;
        var value;

        // Select a mode
        if ( tcl.contains('header') ) {
            if ( tcl.contains('selected') ) {
                return;
            }
            uDom('.header').removeClass('selected');
            uDom('.container').removeClass('selected');
            value = target.getAttribute('data-container');
            uDom('.header.' + value).addClass('selected');
            uDom('.container.' + value).addClass('selected');
            return;
        }

        // Create static filter
        if ( target.id === 'createStaticFilter' ) {
            value = staticFilterNode().value;
            // Avoid duplicates
            if ( createdStaticFilters.hasOwnProperty(value) ) {
                return;
            }
            createdStaticFilters[value] = true;
            if ( value !== '' ) {
                var d = new Date();
                messaging.send(
                    'loggerUI',
                    {
                        what: 'createUserFilter',
                        pageDomain: targetPageDomain,
                        filters: '! ' + d.toLocaleString() + ' ' + targetPageDomain + '\n' + value
                    }
                );
            }
            updateWidgets();
            return;
        }

        // Save url filtering rule(s)
        if ( target.id === 'saveRules' ) {
                messaging.send(
                'loggerUI',
                {
                    what: 'saveURLFilteringRules',
                    context: selectValue('select.dynamic.origin'),
                    urls: targetURLs,
                    type: uglyTypeFromSelector('dynamic')
                },
                colorize
            );
            return;
        }

        var persist = !!ev.ctrlKey || !!ev.metaKey;

        // Remove url filtering rule
        if ( tcl.contains('action') ) {
            messaging.send(
                'loggerUI',
                {
                    what: 'setURLFilteringRule',
                    context: selectValue('select.dynamic.origin'),
                    url: target.getAttribute('data-url'),
                    type: uglyTypeFromSelector('dynamic'),
                    action: 0,
                    persist: persist
                },
                colorize
            );
            return;
        }

        // add "allow" url filtering rule
        if ( tcl.contains('allow') ) {
            messaging.send(
                'loggerUI',
                {
                    what: 'setURLFilteringRule',
                    context: selectValue('select.dynamic.origin'),
                    url: target.parentNode.getAttribute('data-url'),
                    type: uglyTypeFromSelector('dynamic'),
                    action: 2,
                    persist: persist
                },
                colorize
            );
            return;
        }

        // add "block" url filtering rule
        if ( tcl.contains('noop') ) {
            messaging.send(
                'loggerUI',
                {
                    what: 'setURLFilteringRule',
                    context: selectValue('select.dynamic.origin'),
                    url: target.parentNode.getAttribute('data-url'),
                    type: uglyTypeFromSelector('dynamic'),
                    action: 3,
                    persist: persist
                },
                colorize
            );
            return;
        }

        // add "block" url filtering rule
        if ( tcl.contains('block') ) {
            messaging.send(
                'loggerUI',
                {
                    what: 'setURLFilteringRule',
                    context: selectValue('select.dynamic.origin'),
                    url: target.parentNode.getAttribute('data-url'),
                    type: uglyTypeFromSelector('dynamic'),
                    action: 1,
                    persist: persist
                },
                colorize
            );
            return;
        }

        // Force a reload of the tab
        if ( tcl.contains('reload') ) {
            messaging.send(
                'loggerUI',
                {
                    what: 'reloadTab',
                    tabId: targetTabId
                }
            );
            return;
        }

        // Hightlight corresponding element in target web page
        if ( tcl.contains('picker') ) {
            messaging.send(
                'loggerUI',
                {
                    what: 'launchElementPicker',
                    tabId: targetTabId,
                    targetURL: 'img\t' + targetURLs[0],
                    select: true
                }
            );
            return;
        }
    };

    var onSelectChange = function(ev) {
        var target = ev.target;
        var tcl = target.classList;

        if ( tcl.contains('dynamic') ) {
            colorize();
            return;
        }

        if ( tcl.contains('static') ) {
            parseStaticInputs();
            return;
        }
    };

    var onInputChange = function() {
        updateWidgets();
    };

    var createPreview = function(type, url) {
        // First, whether picker can be used
        dialog.querySelector('.picker').classList.toggle(
            'hide',
            targetTabId < 0 ||
            targetType !== 'image' ||
            /(?:^| )[dlsu]b(?: |$)/.test(targetRow.className)
        );

        var preview = null;

        if ( type === 'image' ) {
            preview = document.createElement('img');
            preview.setAttribute('src', url);
        }

        var container = dialog.querySelector('div.preview');
        container.classList.toggle('hide', preview === null);
        if ( preview === null ) {
            return;
        }
        container.appendChild(preview);
    };

    // https://github.com/gorhill/uBlock/issues/1511
    var shortenLongString = function(url, max) {
        var urlLen = url.length;
        if ( urlLen <= max ) {
            return url;
        }
        var n = urlLen - max - 1;
        var i = (urlLen - n) / 2 | 0;
        return url.slice(0, i) + '…' + url.slice(i + n);
    };

    // Build list of candidate URLs
    var createTargetURLs = function(url) {
        var urls = [];
        var matches = reRFC3986.exec(url);
        if ( matches === null || !matches[1] || !matches[2] ) {
            return urls;
        }
        // Shortest URL for a valid URL filtering rule
        var rootURL = matches[1] + matches[2];
        urls.unshift(rootURL);
        var path = matches[3] || '';
        var pos = path.charAt(0) === '/' ? 1 : 0;
        while ( pos < path.length ) {
            pos = path.indexOf('/', pos + 1);
            if ( pos === -1 ) {
                pos = path.length;
            }
            urls.unshift(rootURL + path.slice(0, pos + 1));
        }
        var query = matches[4] || '';
        if ( query !== '') {
            urls.unshift(rootURL + path + query);
        }
        return urls;
    };

    // Fill dynamic URL filtering pane
    var fillDynamicPane = function() {
        var select;
        // Fill context selector
        select = selectNode('select.dynamic.origin');
        removeAllChildren(select);
        fillOriginSelect(select, targetPageHostname, targetPageDomain);
        var option = document.createElement('option');
        option.textContent = '*';
        option.setAttribute('value', '*');
        select.appendChild(option);

        // Fill type selector
        select = selectNode('select.dynamic.type');
        select.options[0].textContent = targetType;
        select.options[0].setAttribute('value', targetType);
        select.selectedIndex = 0;

        // Fill entries
        var menuEntryTemplate = dialog.querySelector('table.toolbar tr.entry');
        var tbody = dialog.querySelector('div.dynamic table.entries tbody');
        var url, menuEntry;
        for ( var i = 0; i < targetURLs.length; i++ ) {
            url = targetURLs[i];
            menuEntry = menuEntryTemplate.cloneNode(true);
            menuEntry.cells[0].children[0].setAttribute('data-url', url);
            menuEntry.cells[1].textContent = shortenLongString(url, 128);
            tbody.appendChild(menuEntry);
        }

        colorize();
    };

    var fillOriginSelect = function(select, hostname, domain) {
        var option, pos;
        var template = vAPI.i18n('loggerStaticFilteringSentencePartOrigin');
        var value = hostname;
        for (;;) {
            option = document.createElement('option');
            option.setAttribute('value', value);
            option.textContent = template.replace('{{origin}}', value);
            select.appendChild(option);
            if ( value === domain ) {
                break;
            }
            pos = value.indexOf('.');
            if ( pos === -1 ) {
                break;
            }
            value = value.slice(pos + 1);
        }
    };

    // Fill static filtering pane
    var fillStaticPane = function() {
        var template = vAPI.i18n('loggerStaticFilteringSentence');
        var rePlaceholder = /\{\{[^}]+?\}\}/g;
        var nodes = [];
        var match, pos = 0;
        var select, option, n, i, value;
        for (;;) {
            match = rePlaceholder.exec(template);
            if ( match === null ) {
                break;
            }
            if ( pos !== match.index ) {
                nodes.push(document.createTextNode(template.slice(pos, match.index)));
            }
            pos = rePlaceholder.lastIndex;
            switch ( match[0] ) {
            case '{{br}}':
                nodes.push(document.createElement('br'));
                break;

            case '{{action}}':
                select = document.createElement('select');
                select.className = 'static action';
                option = document.createElement('option');
                option.setAttribute('value', '');
                option.textContent = vAPI.i18n('loggerStaticFilteringSentencePartBlock');
                select.appendChild(option);
                option = document.createElement('option');
                option.setAttribute('value', '@@');
                option.textContent = vAPI.i18n('loggerStaticFilteringSentencePartAllow');
                select.appendChild(option);
                nodes.push(select);
                break;

            case '{{type}}':
                select = document.createElement('select');
                select.className = 'static type';
                option = document.createElement('option');
                option.setAttribute('value', targetType);
                option.textContent = vAPI.i18n('loggerStaticFilteringSentencePartType').replace('{{type}}', targetType);
                select.appendChild(option);
                option = document.createElement('option');
                option.setAttribute('value', '');
                option.textContent = vAPI.i18n('loggerStaticFilteringSentencePartAnyType');
                select.appendChild(option);
                nodes.push(select);
                break;

            case '{{url}}':
                select = document.createElement('select');
                select.className = 'static url';
                for ( i = 0, n = targetURLs.length; i < n; i++ ) {
                    value = targetURLs[i].replace(/^[a-z-]+:\/\//, '');
                    option = document.createElement('option');
                    option.setAttribute('value', value);
                    option.textContent = shortenLongString(value, 128);
                    select.appendChild(option);
                }
                nodes.push(select);
                break;

            case '{{origin}}':
                select = document.createElement('select');
                select.className = 'static origin';
                fillOriginSelect(select, targetFrameHostname, targetFrameDomain);
                option = document.createElement('option');
                option.setAttribute('value', '');
                option.textContent = vAPI.i18n('loggerStaticFilteringSentencePartAnyOrigin');
                select.appendChild(option);
                nodes.push(select);
                break;

            case '{{importance}}':
                select = document.createElement('select');
                select.className = 'static importance';
                option = document.createElement('option');
                option.setAttribute('value', '');
                option.textContent = vAPI.i18n('loggerStaticFilteringSentencePartNotImportant');
                select.appendChild(option);
                option = document.createElement('option');
                option.setAttribute('value', 'important');
                option.textContent = vAPI.i18n('loggerStaticFilteringSentencePartImportant');
                select.appendChild(option);
                nodes.push(select);
                break;

            default:
                break;
            }
        }
        if ( pos < template.length ) {
            nodes.push(document.createTextNode(template.slice(pos)));
        }
        var parent = dialog.querySelector('div.containers > div.static > p:first-of-type');
        removeAllChildren(parent);
        for ( i = 0; i < nodes.length; i++ ) {
            parent.appendChild(nodes[i]);
        }
        parseStaticInputs();
    };

    var fillDialog = function(domains) {
        targetDomain = domains[0];
        targetPageDomain = domains[1];
        targetFrameDomain = domains[2];

        createPreview(targetType, targetURLs[0]);
        fillDynamicPane();
        fillStaticPane();
        document.body.appendChild(netFilteringDialog);
        netFilteringDialog.addEventListener('click', onClick, true);
        netFilteringDialog.addEventListener('change', onSelectChange, true);
        netFilteringDialog.addEventListener('input', onInputChange, true);
    };

    var toggleOn = function(ev) {
        dialog = netFilteringDialog.querySelector('.dialog');
        targetRow = ev.target.parentElement;
        targetTabId = tabIdFromClassName(targetRow.className);
        targetType = targetRow.cells[4].textContent.trim() || '';
        targetURLs = createTargetURLs(targetRow.cells[5].textContent);
        targetPageHostname = targetRow.getAttribute('data-hn-page') || '';
        targetFrameHostname = targetRow.getAttribute('data-hn-frame') || '';

        // We need the root domain names for best user experience.
        messaging.send(
            'loggerUI',
            {
                what: 'getDomainNames',
                targets: [targetURLs[0], targetPageHostname, targetFrameHostname]
            },
            fillDialog
        );
    };

    var toggleOff = function() {
        removeAllChildren(dialog.querySelector('div.preview'));
        removeAllChildren(dialog.querySelector('div.dynamic table.entries tbody'));
        dialog = null;
        targetRow = null;
        targetURLs = [];
        netFilteringDialog.removeEventListener('click', onClick, true);
        netFilteringDialog.removeEventListener('change', onSelectChange, true);
        netFilteringDialog.removeEventListener('input', onInputChange, true);
        document.body.removeChild(netFilteringDialog);
    };

    return {
        toggleOn: toggleOn
    };
})();

// https://www.youtube.com/watch?v=XyNYrmmdUd4

/******************************************************************************/
/******************************************************************************/

var reverseLookupManager = (function() {
    let filterFinderDialog = uDom.nodeFromId('filterFinderDialog');
    let rawFilter = '';

    let removeAllChildren = function(node) {
        while ( node.firstChild ) {
            node.removeChild(node.firstChild);
        }
    };

    // Clicking outside the dialog will close the dialog
    let onClick = function(ev) {
        if ( ev.target.classList.contains('modalDialog') ) {
            toggleOff();
            return;
        }

        ev.stopPropagation();
    };

    let nodeFromFilter = function(filter, lists) {
        if ( Array.isArray(lists) === false || lists.length === 0 ) {
            return;
        }

        let p = document.createElement('p');

        vAPI.i18n.safeTemplateToDOM(
            'loggerStaticFilteringFinderSentence1',
            { filter: filter },
            p
        );

        let ul = document.createElement('ul');
        for ( let list of lists ) {
            let li = document.querySelector('#filterFinderListEntry > li')
                             .cloneNode(true);
            let a = li.querySelector('a:nth-of-type(1)');
            a.href += encodeURIComponent(list.assetKey);
            a.textContent = list.title;
            if ( list.supportURL ) {
                a = li.querySelector('a:nth-of-type(2)');
                a.setAttribute('href', list.supportURL);
            }
            ul.appendChild(li);
        }
        p.appendChild(ul);

        return p;
    };

    let reverseLookupDone = function(response) {
        if ( response instanceof Object === false ) {
            response = {};
        }

        let dialog = filterFinderDialog.querySelector('.dialog');
        removeAllChildren(dialog);

        for ( let filter in response ) {
            let p = nodeFromFilter(filter, response[filter]);
            if ( p === undefined ) { continue; }
            dialog.appendChild(p);
        }

        // https://github.com/gorhill/uBlock/issues/2179
        if ( dialog.childElementCount === 0 ) {
            vAPI.i18n.safeTemplateToDOM(
                'loggerStaticFilteringFinderSentence2',
                { filter: rawFilter },
                dialog
            );
        }

        document.body.appendChild(filterFinderDialog);
        filterFinderDialog.addEventListener('click', onClick, true);
    };

    let toggleOn = function(ev) {
        let row = ev.target.parentElement;
        rawFilter = row.cells[2].textContent;
        if ( rawFilter === '' ) { return; }

        if ( row.classList.contains('cat_net') ) {
            messaging.send(
                'loggerUI',
                {
                    what: 'listsFromNetFilter',
                    compiledFilter: row.getAttribute('data-filter') || '',
                    rawFilter: rawFilter
                },
                reverseLookupDone
            );
        } else if ( row.classList.contains('cat_cosmetic') ) {
            messaging.send(
                'loggerUI',
                {
                    what: 'listsFromCosmeticFilter',
                    url: row.cells[5].textContent,
                    rawFilter: rawFilter,
                },
                reverseLookupDone
            );
        }
    };

    let toggleOff = function() {
        filterFinderDialog.removeEventListener('click', onClick, true);
        document.body.removeChild(filterFinderDialog);
        rawFilter = '';
    };

    return {
        toggleOn: toggleOn
    };
})();

/******************************************************************************/
/******************************************************************************/

var rowFilterer = (function() {
    var filters = [];

    var parseInput = function() {
        filters = [];

        var rawPart, hardBeg, hardEnd;
        var raw = uDom('#filterInput').val().trim();
        var rawParts = raw.split(/\s+/);
        var reStr, reStrs = [], not = false;
        var n = rawParts.length;
        for ( var i = 0; i < n; i++ ) {
            rawPart = rawParts[i];
            if ( rawPart.charAt(0) === '!' ) {
                if ( reStrs.length === 0 ) {
                    not = true;
                }
                rawPart = rawPart.slice(1);
            }
            hardBeg = rawPart.charAt(0) === '|';
            if ( hardBeg ) {
                rawPart = rawPart.slice(1);
            }
            hardEnd = rawPart.slice(-1) === '|';
            if ( hardEnd ) {
                rawPart = rawPart.slice(0, -1);
            }
            if ( rawPart === '' ) {
                continue;
            }
            // https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions
            reStr = rawPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if ( hardBeg ) {
                reStr = '(?:^|\\s)' + reStr;
            }
            if ( hardEnd ) {
                reStr += '(?:\\s|$)';
            }
            reStrs.push(reStr);
            if ( i < (n - 1) && rawParts[i + 1] === '||' ) {
                i += 1;
                continue;
            }
            reStr = reStrs.length === 1 ? reStrs[0] : reStrs.join('|');
            filters.push({
                re: new RegExp(reStr, 'i'),
                r: !not
            });
            reStrs = [];
            not = false;
        }
    };

    var filterOne = function(tr, clean) {
        var ff = filters;
        var fcount = ff.length;
        if ( fcount === 0 && clean === true ) {
            return;
        }
        // do not filter out doc boundaries, they help separate important
        // section of log.
        var cl = tr.classList;
        if ( cl.contains('maindoc') ) {
            return;
        }
        if ( fcount === 0 ) {
            cl.remove('f');
            return;
        }
        var cc = tr.cells;
        var ccount = cc.length;
        var hit, j, f;
        // each filter expression must hit (implicit and-op)
        // if...
        //   positive filter expression = there must one hit on any field
        //   negative filter expression = there must be no hit on all fields
        for ( var i = 0; i < fcount; i++ ) {
            f = ff[i];
            hit = !f.r;
            for ( j = 0; j < ccount; j++ ) {
                if ( f.re.test(cc[j].textContent) ) {
                    hit = f.r;
                    break;
                }
            }
            if ( !hit ) {
                cl.add('f');
                return;
            }
        }
        cl.remove('f');
    };

    var filterAll = function() {
        // Special case: no filter
        if ( filters.length === 0 ) {
            uDom('#netInspector tr').removeClass('f');
            return;
        }
        var tbody = document.querySelector('#netInspector tbody');
        var rows = tbody.rows;
        var i = rows.length;
        while ( i-- ) {
            filterOne(rows[i]);
        }
    };

    var onFilterChangedAsync = (function() {
        var timer = null;
        var commit = function() {
            timer = null;
            parseInput();
            filterAll();
        };
        return function() {
            if ( timer !== null ) {
                clearTimeout(timer);
            }
            timer = vAPI.setTimeout(commit, 750);
        };
    })();

    var onFilterButton = function() {
        uDom.nodeFromId('netInspector').classList.toggle('f');
    };

    uDom('#filterButton').on('click', onFilterButton);
    uDom('#filterInput').on('input', onFilterChangedAsync);

    // https://github.com/gorhill/uBlock/issues/404
    // Ensure page state is in sync with the state of its various widgets.
    parseInput();
    filterAll();

    return {
        filterOne: filterOne,
        filterAll: filterAll
    };
})();

/******************************************************************************/

var toJunkyard = function(trs) {
    trs.remove();
    var i = trs.length;
    while ( i-- ) {
        trJunkyard.push(trs.nodeAt(i));
    }
};

/******************************************************************************/

var clearBuffer = function() {
    var tabClass = uDom.nodeFromId('pageSelector').value;
    var btsAlso = tabClass === '' || tabClass === 'tab_bts';
    var tbody = document.querySelector('#netInspector tbody');
    var tr = tbody.lastElementChild;
    var trPrevious;
    while ( tr !== null ) {
        trPrevious = tr.previousElementSibling;
        if (
            (tr.clientHeight > 0) &&
            (tr.classList.contains('tab_bts') === false || btsAlso)
        ) {
            trJunkyard.push(tbody.removeChild(tr));
        }
        tr = trPrevious;
    }
    uDom.nodeFromId('clear').classList.toggle(
        'disabled',
        tbody.childElementCount === 0
    );
    uDom.nodeFromId('clean').classList.toggle(
        'disabled',
        tbody.querySelector('#netInspector tr.tab:not(.canMtx)') === null
    );
};

/******************************************************************************/

var cleanBuffer = function() {
    var rows = uDom('#netInspector tr.tab:not(.canMtx)').remove();
    var i = rows.length;
    while ( i-- ) {
        trJunkyard.push(rows.nodeAt(i));
    }
    uDom('#clean').addClass('disabled');
};

/******************************************************************************/

var toggleVCompactView = function() {
    uDom.nodeFromId('netInspector').classList.toggle('vCompact');
    uDom('#netInspector .vExpanded').toggleClass('vExpanded');
};

var toggleVCompactRow = function(ev) {
    ev.target.parentElement.classList.toggle('vExpanded');
};

/******************************************************************************/

var toggleInspectors = function() {
    uDom.nodeFromId('inspectors').classList.toggle('dom');
};

/******************************************************************************/

var popupManager = (function() {
    var realTabId = null;
    var localTabId = null;
    var container = null;
    var popup = null;
    var popupObserver = null;
    var style = null;
    var styleTemplate = [
        '#netInspector tr:not(.tab_{{tabId}}) {',
            'cursor: not-allowed;',
            'opacity: 0.2;',
        '}'
    ].join('\n');

    var resizePopup = function() {
        if ( popup === null ) {
            return;
        }
        var popupBody = popup.contentWindow.document.body;
        if ( popupBody.clientWidth !== 0 && container.clientWidth !== popupBody.clientWidth ) {
            container.style.setProperty('width', popupBody.clientWidth + 'px');
        }
        if ( popupBody.clientHeight !== 0 && popup.clientHeight !== popupBody.clientHeight ) {
            popup.style.setProperty('height', popupBody.clientHeight + 'px');
        }
    };

    var toggleSize = function() {
        container.classList.toggle('hide');
    };

    var onLoad = function() {
        resizePopup();
        popupObserver.observe(popup.contentDocument.body, {
            subtree: true,
            attributes: true
        });
    };

    var toggleOn = function(td) {
        var tr = td.parentNode;
        realTabId = localTabId = tabIdFromClassName(tr.className);
        if ( realTabId === 0 ) { return; }

        container = uDom.nodeFromId('popupContainer');

        container.querySelector('div > span:nth-of-type(1)').addEventListener('click', toggleSize);
        container.querySelector('div > span:nth-of-type(2)').addEventListener('click', toggleOff);

        popup = document.createElement('iframe');
        popup.addEventListener('load', onLoad);
        popup.setAttribute('src', 'popup.html?tabId=' + realTabId);
        popupObserver = new MutationObserver(resizePopup);
        container.appendChild(popup);

        style = uDom.nodeFromId('popupFilterer');
        style.textContent = styleTemplate.replace('{{tabId}}', localTabId);

        var parent = uDom.nodeFromId('netInspector');
        var rect = parent.getBoundingClientRect();
        container.style.setProperty('top', rect.top + 'px');
        container.style.setProperty('right', (rect.right - parent.clientWidth) + 'px');
        parent.classList.add('popupOn');
    };

    var toggleOff = function() {
        uDom.nodeFromId('netInspector').classList.remove('popupOn');

        container.querySelector('div > span:nth-of-type(1)').removeEventListener('click', toggleSize);
        container.querySelector('div > span:nth-of-type(2)').removeEventListener('click', toggleOff);
        container.classList.remove('hide');

        popup.removeEventListener('load', onLoad);
        popupObserver.disconnect();
        popupObserver = null;
        popup.setAttribute('src', '');
        container.removeChild(popup);
        popup = null;

        style.textContent = '';
        style = null;

        container = null;
        realTabId = null;
    };

    var exports = {
        toggleOn: function(ev) {
            if ( realTabId === null ) {
                toggleOn(ev.target);
            }
        },
        toggleOff: function() {
            if ( realTabId !== null ) {
                toggleOff();
            }
        }
    };

    Object.defineProperty(exports, 'tabId', {
        get: function() { return realTabId || 0; }
    });

    return exports;
})();

/******************************************************************************/

var grabView = function() {
    if ( logger.ownerId === undefined ) {
        logger.ownerId = Date.now();
    }
    readLogBufferAsync();
};

var releaseView = function() {
    if ( logger.ownerId === undefined ) { return; }
    vAPI.messaging.send(
        'loggerUI',
        { what: 'releaseView', ownerId: logger.ownerId }
    );
    logger.ownerId = undefined;
};

window.addEventListener('pagehide', releaseView);
window.addEventListener('pageshow', grabView);
// https://bugzilla.mozilla.org/show_bug.cgi?id=1398625
window.addEventListener('beforeunload', releaseView);

/******************************************************************************/

readLogBuffer();

uDom('#pageSelector').on('change', pageSelectorChanged);
uDom('#refresh').on('click', reloadTab);
uDom('#showdom').on('click', toggleInspectors);

uDom('#netInspector .vCompactToggler').on('click', toggleVCompactView);
uDom('#clean').on('click', cleanBuffer);
uDom('#clear').on('click', clearBuffer);
uDom('#maxEntries').on('change', onMaxEntriesChanged);
uDom('#netInspector table').on('click', 'tr > td:nth-of-type(1)', toggleVCompactRow);
uDom('#netInspector table').on('click', 'tr.canMtx > td:nth-of-type(2)', popupManager.toggleOn);
uDom('#netInspector').on('click', 'tr.canLookup > td:nth-of-type(3)', reverseLookupManager.toggleOn);
uDom('#netInspector').on('click', 'tr.cat_net > td:nth-of-type(4)', netFilteringManager.toggleOn);

// https://github.com/gorhill/uBlock/issues/507
// Ensure tab selector is in sync with URL hash
pageSelectorFromURLHash();
window.addEventListener('hashchange', pageSelectorFromURLHash);

/******************************************************************************/

})();

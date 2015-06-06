/*******************************************************************************

    uMatrix - a browser extension to benchmark browser session.
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

    Home: https://github.com/gorhill/sessbench
*/

/* jshint boss: true */
/* global vAPI, uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

// Adjust top padding of content table, to match that of toolbar height.

document.getElementById('content').style.setProperty(
    'margin-top',
    document.getElementById('toolbar').offsetHeight + 'px'
);

/******************************************************************************/

var messager = vAPI.messaging.channel('logger-ui.js');
var tbody = document.querySelector('#content tbody');
var trJunkyard = [];
var tdJunkyard = [];
var firstVarDataCol = 2;  // currently, column 2 (0-based index)
var lastVarDataIndex = 4; // currently, d0-d3
var maxEntries = 5000;
var noTabId = '';
var allTabIds = {};
var allTabIdsToken;
var hiddenTemplate = document.querySelector('#hiddenTemplate > span');
var reRFC3986 = /^([^:\/?#]+:)?(\/\/[^\/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?/;
var urlFilteringMenu = document.querySelector('#urlFilteringMenu');

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

var timeOptions = {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
};

var dateOptions = {
    month: 'short',
    day: '2-digit'
};

/******************************************************************************/

var classNameFromTabId = function(tabId) {
    if ( tabId === noTabId ) {
        return 'tab_bts';
    }
    if ( tabId !== '' ) {
        return 'tab_' + tabId;
    }
    return '';
};

/******************************************************************************/

var tabIdFromClassName = function(className) {
    var matches = className.match(/(?:^| )tab_([^ ]+)(?: |$)/);
    if ( matches === null ) {
        return '';
    }
    return matches[1];
};

/******************************************************************************/

var retextFromStaticFilteringResult = function(result) {
    var retext = result.slice(3);
    var pos = retext.indexOf('$');
    if ( pos > 0 ) {
        retext = retext.slice(0, pos);
    }
    if ( retext === '*' ) {
        return '^.*$';
    }
    if ( retext.charAt(0) === '/' && retext.slice(-1) === '/' ) {
        return retext.slice(1, -1);
    }
    return retext
        .replace(/\./g, '\\.')
        .replace(/\?/g, '\\?')
        .replace('||', '')
        .replace(/\^/g, '.')
        .replace(/^\|/g, '^')
        .replace(/\|$/g, '$')
        .replace(/\*/g, '.*')
        ;
};

/******************************************************************************/

var retextFromURLFilteringResult = function(result) {
    var beg = result.indexOf(' ');
    var end = result.indexOf(' ', beg + 1);
    var url = result.slice(beg + 1, end);
    if ( url === '*' ) {
        return '^.*$';
    }
    return '^' + url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/******************************************************************************/

// Emphasize hostname in URL, as this is what matters in uMatrix's rules.

var nodeFromURL = function(url, filter) {
    var filterType = filter.charAt(0);
    if ( filterType !== 's' && filterType !== 'l' ) {
        return document.createTextNode(url);
    }
    // make a regex out of the filter
    var retext = '';
    if ( filterType === 's' ) {
        retext = retextFromStaticFilteringResult(filter);
    } else if ( filterType === 'l' ) {
        retext = retextFromURLFilteringResult(filter);
    }
    if ( retext === '' ) {
        return document.createTextNode(url);
    }
    var re = new RegExp(retext, 'gi');
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
    while ( td = tr.cells[index] ) {
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
    var filter = entry.d0;
    var type = entry.d1;
    var url = entry.d2;
    var td;

    tr.classList.add('canMtx');

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

    // Cosmetic filter?
    var filterCat = filter.slice(0, 3);
    if ( filterCat.charAt(2) === ':' ) {
        tr.classList.add(filterCat.slice(0, 2));
    }

    var filterText = filter.slice(3);
    if ( filter.lastIndexOf('sa', 0) === 0 ) {
        filterText = '@@' + filterText;
    }
    tr.cells[2].textContent = filterText;

    td = tr.cells[3];
    if ( filter.charAt(1) === 'b' ) {
        tr.classList.add('blocked');
        td.textContent = '--';
    } else if ( filter.charAt(1) === 'a' ) {
        tr.classList.add('allowed');
        td.textContent = '++';
    } else if ( filter.charAt(1) === 'n' ) {
        tr.classList.add('nooped');
        td.textContent = '**';
    } else {
        td.textContent = '';
    }

    tr.cells[4].textContent = (prettyRequestTypes[type] || type);
    tr.cells[5].appendChild(nodeFromURL(url, filter));
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
        tr = createRow('1111');
        renderNetLogEntry(tr, entry);
        break;

    default:
        tr = createRow('1');
        tr.cells[fvdc].textContent = entry.d0;
        break;
    }

    // Fields common to all rows.
    var time = new Date(entry.tstamp);
    tr.cells[0].textContent = time.toLocaleTimeString('fullwide', timeOptions);
    tr.cells[0].title = time.toLocaleDateString('fullwide', dateOptions);

    if ( entry.tab ) {
        tr.classList.add('tab', classNameFromTabId(entry.tab));
        if ( entry.tab === noTabId ) {
            tr.cells[1].appendChild(createHiddenTextNode('bts'));
        }
    }
    if ( entry.cat !== '' ) {
        tr.classList.add('cat_' + entry.cat);
    }

    rowFilterer.filterOne(tr, true);

    tbody.insertBefore(tr, tbody.firstChild);
};

/******************************************************************************/

var renderLogEntries = function(response) {
    document.body.classList.toggle('colorBlind', response.colorBlind);

    var entries = response.entries;
    if ( entries.length === 0 ) {
        return;
    }

    // Preserve scroll position
    var height = tbody.offsetHeight;

    var tabIds = response.tabIds;
    var n = entries.length;
    var entry;
    for ( var i = 0; i < n; i++ ) {
        entry = entries[i];
        // Unlikely, but it may happen
        if ( entry.tab && tabIds.hasOwnProperty(entry.tab) === false ) {
            continue;
        }
        renderLogEntry(entries[i]);
    }

    // Prevent logger from growing infinitely and eating all memory. For
    // instance someone could forget that it is left opened for some
    // dynamically refreshed pages.
    truncateLog(maxEntries);

    var yDelta = tbody.offsetHeight - height;
    if ( yDelta === 0 ) {
        return;
    }

    // Chromium:
    //   body.scrollTop = good value
    //   body.parentNode.scrollTop = 0
    if ( document.body.scrollTop !== 0 ) {
        document.body.scrollTop += yDelta;
        return;
    }

    // Firefox:
    //   body.scrollTop = 0
    //   body.parentNode.scrollTop = good value
    var parentNode = document.body.parentNode;
    if ( parentNode && parentNode.scrollTop !== 0 ) {
        parentNode.scrollTop += yDelta;
    }
};

/******************************************************************************/

var synchronizeTabIds = function(newTabIds) {
    var oldTabIds = allTabIds;
    var autoDeleteVoidRows = !!vAPI.localStorage.getItem('loggerAutoDeleteVoidRows');
    var rowVoided = false;
    var trs;
    for ( var tabId in oldTabIds ) {
        if ( oldTabIds.hasOwnProperty(tabId) === false ) {
            continue;
        }
        if ( newTabIds.hasOwnProperty(tabId) ) {
            continue;
        }
        // Mark or remove voided rows
        trs = uDom('.tab_' + tabId);
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

    var select = document.getElementById('pageSelector');
    var selectValue = select.value;
    var tabIds = Object.keys(newTabIds).sort(function(a, b) {
        return newTabIds[a].localeCompare(newTabIds[b]);
    });
    var option;
    for ( var i = 0, j = 2; i < tabIds.length; i++ ) {
        tabId = tabIds[i];
        if ( tabId === noTabId ) {
            continue;
        }
        option = select.options[j];
        j += 1;
        if ( !option ) {
            option = document.createElement('option');
            select.appendChild(option);
        }
        option.textContent = newTabIds[tabId];
        option.value = classNameFromTabId(tabId);
        if ( option.value === selectValue ) {
            option.setAttribute('selected', '');
        } else {
            option.removeAttribute('selected');
        }
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

    return rowVoided;
};

/******************************************************************************/

var truncateLog = function(size) {
    if ( size === 0 ) {
        size = 5000;
    }
    var tbody = document.querySelector('#content tbody');
    size = Math.min(size, 10000);
    var tr;
    while ( tbody.childElementCount > size ) {
        tr = tbody.lastElementChild;
        trJunkyard.push(tbody.removeChild(tr));
    }
};

/******************************************************************************/

var onLogBufferRead = function(response) {
    // This tells us the behind-the-scene tab id
    noTabId = response.noTabId;

    // This may have changed meanwhile
    if ( response.maxEntries !== maxEntries ) {
        maxEntries = response.maxEntries;
        uDom('#maxEntries').val(maxEntries || '');
    }

    // Neuter rows for which a tab does not exist anymore
    var rowVoided = false;
    if ( response.tabIdsToken !== allTabIdsToken ) {
        rowVoided = synchronizeTabIds(response.tabIds);
        allTabIdsToken = response.tabIdsToken;
    }

    renderLogEntries(response);

    if ( rowVoided ) {
        uDom('#clean').toggleClass(
            'disabled',
            tbody.querySelector('tr.tab:not(.canMtx)') === null
        );
    }

    // Synchronize toolbar with content of log
    uDom('#clear').toggleClass(
        'disabled',
        tbody.querySelector('tr') === null
    );

    vAPI.setTimeout(readLogBuffer, 1200);
};

/******************************************************************************/

// This can be called only once, at init time. After that, this will be called
// automatically. If called after init time, this will be messy, and this would
// require a bit more code to ensure no multi time out events.

var readLogBuffer = function() {
    messager.send({ what: 'readAll' }, onLogBufferRead);
};

/******************************************************************************/

var pageSelectorChanged = function() {
    var style = document.getElementById('tabFilterer');
    var tabClass = document.getElementById('pageSelector').value;
    var sheet = style.sheet;
    while ( sheet.cssRules.length !== 0 )  {
        sheet.deleteRule(0);
    }
    if ( tabClass !== '' ) {
        sheet.insertRule(
            '#content table tr:not(.' + tabClass + ') { display: none; }',
            0
        );
    }
    uDom('#refresh').toggleClass(
        'disabled',
        tabClass === '' || tabClass === 'tab_bts'
    );
};

/******************************************************************************/

var reloadTab = function() {
    var tabClass = document.getElementById('pageSelector').value;
    var tabId = tabIdFromClassName(tabClass);
    if ( tabId === 'bts' || tabId === '' ) {
        return;
    }
    messager.send({ what: 'reloadTab', tabId: tabId });
};

/******************************************************************************/

var onMaxEntriesChanged = function() {
    var raw = uDom(this).val();
    try {
        maxEntries = parseInt(raw, 10);
        if ( isNaN(maxEntries) ) {
            maxEntries = 0;
        }
    } catch (e) {
        maxEntries = 0;
    }

    messager.send({
        what: 'userSettings',
        name: 'requestLogMaxEntries',
        value: maxEntries
    });

    truncateLog(maxEntries);
};

/******************************************************************************/
/******************************************************************************/

var filteringDialog = (function() {
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

    var removeAllChildren = function(node) {
        while ( node.firstChild ) {
            node.removeChild(node.firstChild);
        }
    };

    var uglyTypeFromSelector = function(pane) {
        var prettyType = selectValue('select.type.' + pane);
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
        messager.send({
            what: 'getURLFilteringData',
            context: selectValue('select.dynamic.origin'),
            urls: targetURLs,
            type: uglyTypeFromSelector('dynamic')
        }, onColorsReady);
    };

    var parseStaticInputs = function() {
        var filter = '';
        var options = [];
        var block = selectValue('select.static.action') === '';
        if ( !block ) {
            filter = '@@';
        }
        var value = selectValue('select.static.url');
        if ( value !== '' ) {
            filter += '||' + value;
        }
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

        // click outside the url filtering menu
        if ( target.id === 'urlFilteringMenu' ) {
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
                messager.send({
                    what: 'createUserFilter',
                    filters: '! ' + d.toLocaleString() + ' ' + targetPageDomain + '\n' + value
                });
            }
            updateWidgets();
            return;
        }

        // Save url filtering rule(s)
        if ( target.id === 'saveRules' ) {
            messager.send({
                what: 'saveURLFilteringRules',
                context: selectValue('select.dynamic.origin'),
                urls: targetURLs,
                type: uglyTypeFromSelector('dynamic')
            }, colorize);
            return;
        }

        var persist = !!ev.ctrlKey || !!ev.metaKey;

        // Remove url filtering rule
        if ( tcl.contains('action') ) {
            messager.send({
                what: 'setURLFilteringRule',
                context: selectValue('select.dynamic.origin'),
                url: target.getAttribute('data-url'),
                type: uglyTypeFromSelector('dynamic'),
                action: 0,
                persist: persist
            }, colorize);
            return;
        }

        // add "allow" url filtering rule
        if ( tcl.contains('allow') ) {
            messager.send({
                what: 'setURLFilteringRule',
                context: selectValue('select.dynamic.origin'),
                url: target.parentNode.getAttribute('data-url'),
                type: uglyTypeFromSelector('dynamic'),
                action: 2,
                persist: persist
            }, colorize);
            return;
        }

        // add "block" url filtering rule
        if ( tcl.contains('noop') ) {
            messager.send({
                what: 'setURLFilteringRule',
                context: selectValue('select.dynamic.origin'),
                url: target.parentNode.getAttribute('data-url'),
                type: uglyTypeFromSelector('dynamic'),
                action: 3,
                persist: persist
            }, colorize);
            return;
        }

        // add "block" url filtering rule
        if ( tcl.contains('block') ) {
            messager.send({
                what: 'setURLFilteringRule',
                context: selectValue('select.dynamic.origin'),
                url: target.parentNode.getAttribute('data-url'),
                type: uglyTypeFromSelector('dynamic'),
                action: 1,
                persist: persist
            }, colorize);
            return;
        }

        // Force a reload of the tab
        if ( tcl.contains('reload') ) {
            messager.send({
                what: 'reloadTab',
                tabId: targetTabId
            });
            return;
        }

        // Hightlight corresponding element in target web page
        if ( tcl.contains('picker') ) {
            messager.send({
                what: 'launchElementPicker',
                tabId: targetTabId,
                targetURL: 'img\t' + targetURLs[0],
                select: true
            });
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
            targetTabId === noTabId ||
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
            urls.unshift(rootURL + path.slice(0, pos));
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
            menuEntry.cells[1].textContent = url;
            tbody.appendChild(menuEntry);
        }

        colorize();
    };

    var fillOriginSelect = function(select, hostname, domain) {
        var option, pos;
        var value = hostname;
        for (;;) {
            option = document.createElement('option');
            option.setAttribute('value', value);
            option.textContent = value;
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
        var select, option, i, value;
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
                for ( i = 0; i < targetURLs.length; i++ ) {
                    value = targetURLs[i].replace(/^[a-z]+:\/\//, '');
                    option = document.createElement('option');
                    option.setAttribute('value', value);
                    option.textContent = value;
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
        document.body.appendChild(urlFilteringMenu);
        urlFilteringMenu.addEventListener('click', onClick, true);
        urlFilteringMenu.addEventListener('change', onSelectChange, true);
        urlFilteringMenu.addEventListener('input', onInputChange, true);
    };

    var toggleOn = function(ev) {
        dialog = urlFilteringMenu.querySelector('.dialog');
        targetRow = ev.target.parentElement;
        targetTabId = tabIdFromClassName(targetRow.className);
        targetType = targetRow.cells[4].textContent.trim() || '';
        targetURLs = createTargetURLs(targetRow.cells[5].textContent);
        targetPageHostname = targetRow.getAttribute('data-hn-page') || '';
        targetFrameHostname = targetRow.getAttribute('data-hn-frame') || '';

        // We need the root domain names for best user experience.
        messager.send({
            what: 'getDomainNames',
            targets: [targetURLs[0], targetPageHostname, targetFrameHostname]
        }, fillDialog);
    };

    var toggleOff = function() {
        removeAllChildren(dialog.querySelector('div.preview'));
        removeAllChildren(dialog.querySelector('div.dynamic table.entries tbody'));
        dialog = null;
        targetRow = null;
        targetURLs = [];
        urlFilteringMenu.removeEventListener('click', onClick, true);
        urlFilteringMenu.removeEventListener('change', onSelectChange, true);
        urlFilteringMenu.removeEventListener('input', onInputChange, true);
        document.body.removeChild(urlFilteringMenu);
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
            uDom('#content tr').removeClass('f');
            return;
        }
        var tbody = document.querySelector('#content tbody');
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
        var cl = document.body.classList;
        cl.toggle('f', cl.contains('f') === false);
    };

    uDom('#filterButton').on('click', onFilterButton);
    uDom('#filterInput').on('input', onFilterChangedAsync);

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
    var tbody = document.querySelector('#content tbody');
    var tr;
    while ( tbody.firstChild !== null ) {
        tr = tbody.lastElementChild;
        trJunkyard.push(tbody.removeChild(tr));
    }
    uDom('#clear').addClass('disabled');
    uDom('#clean').addClass('disabled');
};

/******************************************************************************/

var cleanBuffer = function() {
    var rows = uDom('#content tr.tab:not(.canMtx)').remove();
    var i = rows.length;
    while ( i-- ) {
        trJunkyard.push(rows.nodeAt(i));
    }
    uDom('#clean').addClass('disabled');
};

/******************************************************************************/

var toggleCompactView = function() {
    document.body.classList.toggle(
        'compactView',
        document.body.classList.contains('compactView') === false
    );
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
        '#content tr:not(.tab_{{tabId}}) {',
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
        if ( realTabId === '' ) {
            return;
        }
        if ( localTabId === 'bts' ) {
            realTabId = noTabId;
        }

        container = document.getElementById('popupContainer');

        container.querySelector('div > span:nth-of-type(1)').addEventListener('click', toggleSize);
        container.querySelector('div > span:nth-of-type(2)').addEventListener('click', toggleOff);

        popup = document.createElement('iframe');
        popup.addEventListener('load', onLoad);
        popup.setAttribute('src', 'popup.html?tabId=' + realTabId);
        popupObserver = new MutationObserver(resizePopup);
        container.appendChild(popup);

        style = document.getElementById('popupFilterer');
        style.textContent = styleTemplate.replace('{{tabId}}', localTabId);

        document.body.classList.add('popupOn');
    };

    var toggleOff = function() {
        document.body.classList.remove('popupOn');

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

uDom.onLoad(function() {
    readLogBuffer();

    uDom('#pageSelector').on('change', pageSelectorChanged);
    uDom('#refresh').on('click', reloadTab);
    uDom('#compactViewToggler').on('click', toggleCompactView);
    uDom('#clean').on('click', cleanBuffer);
    uDom('#clear').on('click', clearBuffer);
    uDom('#maxEntries').on('change', onMaxEntriesChanged);
    uDom('#content table').on('click', 'tr.canMtx > td:nth-of-type(2)', popupManager.toggleOn);
    uDom('#content').on('click', 'tr.cat_net > td:nth-of-type(4)', filteringDialog.toggleOn);
});

/******************************************************************************/

})();

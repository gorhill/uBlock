/*******************************************************************************

    sessbench - a browser extension to benchmark browser session.
    Copyright (C) 2013  Raymond Hill

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

    TODO: cleanup/refactor
*/

/* global vAPI, uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var messager = vAPI.messaging.channel('devtool-log.js');

var inspectedTabId = '';
var doc = document;
var body = doc.body;
var tbody = doc.querySelector('#content tbody');
var rowJunkyard = [];
var reFilter = null;
var filterTargetTestResult = true;
var maxEntries = 0;

var prettyRequestTypes = {
    'main_frame': 'doc',
    'stylesheet': 'css',
    'sub_frame': 'frame',
    'xmlhttprequest': 'xhr'
};

/******************************************************************************/

var escapeHTML = function(s) {
    return s.replace(reEscapeLeftBracket, '&lt;')
            .replace(reEscapeRightBracket, '&gt;');
};

var reEscapeLeftBracket = /</g;
var reEscapeRightBracket = />/g;

/******************************************************************************/

var renderURL = function(url, filter) {
    if ( filter.charAt(0) !== 's' ) {
        return escapeHTML(url);
    }
    // make a regex out of the filter
    var reText = filter.slice(3);
    var pos = reText.indexOf('$');
    if ( pos > 0 ) {
        reText = reText.slice(0, pos);
    }
    if ( reText === '*' ) {
        reText = '\\*';
    } else if ( reText.charAt(0) === '/' && reText.slice(-1) === '/' ) {
        reText = reText.slice(1, -1);
    } else {
        reText = reText
            .replace(/\./g, '\\.')
            .replace(/\?/g, '\\?')
            .replace('||', '')
            .replace(/\^/g, '.')
            .replace(/^\|/g, '^')
            .replace(/\|$/g, '$')
            .replace(/\*/g, '.*')
            ;
    }
    var re = new RegExp(reText, 'gi');
    var matches = re.exec(url);
    var renderedURL = url;

    if ( matches && matches[0].length ) {
        renderedURL = escapeHTML(url.slice(0, matches.index)) +
                      '<b>' +
                      escapeHTML(url.slice(matches.index, re.lastIndex)) +
                      '</b>' +
                      escapeHTML(url.slice(re.lastIndex));
    } else {
        renderedURL = escapeHTML(renderedURL);
    }

    return renderedURL;
};

/******************************************************************************/

var createRow = function() {
    var tr = rowJunkyard.pop();
    if ( tr ) {
        tr.className = '';
        return tr;
    }
    tr = doc.createElement('tr');
    tr.appendChild(doc.createElement('td'));
    tr.appendChild(doc.createElement('td'));
    tr.appendChild(doc.createElement('td'));
    tr.appendChild(doc.createElement('td'));
    return tr;
};

/******************************************************************************/

var renderLogEntry = function(entry) {
    var tr = createRow();
    if ( entry.result.charAt(1) === 'b' ) {
        tr.classList.add('blocked');
        tr.cells[0].textContent = ' -\u00A0';
    } else if ( entry.result.charAt(1) === 'a' ) {
        tr.classList.add('allowed');
        if ( entry.result.charAt(0) === 'm' ) {
            tr.classList.add('mirrored');
        }
        tr.cells[0].textContent = ' +\u00A0';
    } else {
        tr.cells[0].textContent = '';
    }
    if ( entry.type === 'main_frame' ) {
        tr.classList.add('maindoc');
    }
    var filterText = entry.result.slice(3);
    if ( entry.result.lastIndexOf('sa', 0) === 0 ) {
        filterText = '@@' + filterText;
    }
    tr.cells[1].textContent = filterText + '\t';
    tr.cells[2].textContent = (prettyRequestTypes[entry.type] || entry.type) + '\t';
    vAPI.insertHTML(tr.cells[3], renderURL(entry.url, entry.result));
    applyFilterToRow(tr);
    tbody.insertBefore(tr, tbody.firstChild);
};

/******************************************************************************/

var renderLogBuffer = function(buffer) {
    if ( buffer.length === 0 ) {
        return;
    }

    // Preserve scroll position
    var height = tbody.offsetHeight;

    var n = buffer.length;
    for ( var i = 0; i < n; i++ ) {
        renderLogEntry(buffer[i]);
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
    if ( body.scrollTop !== 0 ) {
        body.scrollTop += yDelta;
        return;
    }

    // Firefox:
    //   body.scrollTop = 0
    //   body.parentNode.scrollTop = good value
    var parentNode = body.parentNode;
    if ( parentNode && parentNode.scrollTop !== 0 ) {
        parentNode.scrollTop += yDelta;
    }
};

/******************************************************************************/

var truncateLog = function(size) {
    if ( size === 0 ) {
        size = 25000;
    }
    size = Math.min(size, 25000);
    while ( tbody.childElementCount > size ) {
        rowJunkyard.push(tbody.removeChild(tbody.lastElementChild));
    }
};

/******************************************************************************/

var onBufferRead = function(buffer) {
    if ( Array.isArray(buffer) ) {
        renderLogBuffer(buffer);
    }
    setTimeout(readLogBuffer, 1000);
};

/******************************************************************************/

// This can be called only once, at init time. After that, this will be called
// automatically. If called after init time, this will be messy, and this would
// require a bit more code to ensure no multi time out events.

var readLogBuffer = function() {
    messager.send({ what: 'readLogBuffer', tabId: inspectedTabId }, onBufferRead);
};

/******************************************************************************/

var clearBuffer = function() {
    while ( tbody.firstChild !== null ) {
        rowJunkyard.push(tbody.removeChild(tbody.firstChild));
    }
};

/******************************************************************************/

var reloadTab = function() {
    messager.send({ what: 'reloadTab', tabId: inspectedTabId });
};

/******************************************************************************/

var applyFilterToRow = function(row) {
    var re = reFilter;
    if ( re === null || re.test(row.textContent) === filterTargetTestResult ) {
        row.classList.remove('hidden');
    } else {
        row.classList.add('hidden');
    }
};

/******************************************************************************/

var applyFilter = function() {
    if ( reFilter === null ) {
        unapplyFilter();
        return;
    }
    var row = document.querySelector('#content tr');
    if ( row === null ) {
        return;
    }
    var re = reFilter;
    var target = filterTargetTestResult;
    while ( row !== null ) {
        if ( re.test(row.textContent) === target ) {
            row.classList.remove('hidden');
        } else {
            row.classList.add('hidden');
        }
        row = row.nextSibling;
    }
};

/******************************************************************************/

var unapplyFilter = function() {
    var row = document.querySelector('#content tr');
    if ( row === null ) {
        return;
    }
    while ( row !== null ) {
        row.classList.remove('hidden');
        row = row.nextSibling;
    }
};

/******************************************************************************/

var onFilterButton = function() {
    uDom('body').toggleClass('filterOff');
};

/******************************************************************************/

var onFilterChanged = function() {
    var filterExpression = uDom('#filterExpression');
    var filterRaw = filterExpression.val().trim();

    // Assume good filter expression
    filterExpression.removeClass('bad');

    // Invert resultset?
    filterTargetTestResult = filterRaw.charAt(0) !== '!';
    if ( filterTargetTestResult === false ) {
        filterRaw = filterRaw.slice(1);
    }

    // No filter
    if ( filterRaw === '') {
        reFilter = null;
        return;
    }

    // Regex?
    if ( filterRaw.length > 1 && filterRaw.charAt(0) === '/' && filterRaw.slice(-1) === '/' ) {
        try {
            reFilter = new RegExp(filterRaw.slice(1, -1));
        } catch (e) {
            reFilter = null;
            filterExpression.addClass('bad');
        }
        return;
    }

    // Plain filtering
    var filterParts = filterRaw
                        .replace(/^\s*-(\s+|$)/, '-\xA0 ')
                        .replace(/^\s*\\+(\s+|$)/, '+\xA0 ')
                        .split(/[ \f\n\r\t\v​]+/);
    var n = filterParts.length;
    for ( var i = 0; i < n; i++ ) {
        filterParts[i] = filterParts[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    reFilter = new RegExp(filterParts.join('.*\\s+.*'));
};

/******************************************************************************/

var onFilterChangedAsync = (function() {
    var timer = null;

    var commit = function() {
        timer = null;
        onFilterChanged();
        applyFilter();
    };

    var changed = function() {
        if ( timer !== null ) {
            clearTimeout(timer);
        }
        timer = setTimeout(commit, 750);
    };

    return changed;
})();

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

uDom.onLoad(function() {
    // Extract the tab id of the page we need to pull the log
    var matches = window.location.search.match(/[\?&]tabId=([^&]+)/);
    if ( matches && matches.length === 2 ) {
        inspectedTabId = matches[1];
    }

    var onSettingsReady = function(settings) {
        maxEntries = settings.requestLogMaxEntries || 0;
        uDom('#maxEntries').val(maxEntries || '');
    };
    messager.send({ what: 'getUserSettings' }, onSettingsReady);

    readLogBuffer();

    uDom('#reload').on('click', reloadTab);
    uDom('#clear').on('click', clearBuffer);
    uDom('#filterButton').on('click', onFilterButton);
    uDom('#filterExpression').on('input', onFilterChangedAsync);
    uDom('#maxEntries').on('change', onMaxEntriesChanged);
});

/******************************************************************************/

})();

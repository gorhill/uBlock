/*******************************************************************************

    sessbench - a Chromium browser extension to benchmark browser session.
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

/******************************************************************************/

var messager = vAPI.messaging.channel('devtool-log.js');

var inspectedTabId = '';
var doc = document;
var body = doc.body;
var tbody = doc.querySelector('#content tbody');
var rowJunkyard = [];

/******************************************************************************/

var renderURL = function(url, filter) {
    if ( filter.charAt(0) !== 's' ) {
        return url;
    }
    // make a regex out of the filter
    var reText = filter.slice(3);
    var pos = reText.indexOf('$');
    if ( pos > 0 ) {
        reText = reText.slice(0, pos);
    }
    if ( reText === '*' ) {
        reText = '\\*';
    } else {
        reText = reText
            .replace(/\./g, '\\.')
            .replace(/\?/g, '\\?')
            .replace('||', '')
            .replace(/\^/g, '.')
            .replace(/\*/g, '.*')
            ;
    }
    var re = new RegExp(reText, 'gi');
    var matches = re.exec(url);
    var renderedURL = url;

    if ( matches && matches[0].length ) {
        renderedURL = url.slice(0, matches.index) +
                      '<b>' +
                      url.slice(matches.index, re.lastIndex) +
                      '</b>' +
                      url.slice(re.lastIndex);
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
    return tr;
};

/******************************************************************************/

var renderLogEntry = function(entry) {
    var tr = createRow();
    if ( entry.result.charAt(1) === 'b' ) {
        tr.classList.add('blocked');
    } else if ( entry.result.charAt(1) === 'a' ) {
        tr.classList.add('allowed');
    }
    if ( entry.type === 'main_frame' ) {
        tr.classList.add('maindoc');
    }
    tr.cells[0].textContent = entry.result.slice(3);
    tr.cells[1].textContent = entry.type;
    tr.cells[2].innerHTML = renderURL(entry.url, entry.result);
    tbody.insertBefore(tr, tbody.firstChild);
};

/******************************************************************************/

var renderLogBuffer = function(buffer) {
    // Preserve scroll position
    var height = tbody.offsetHeight;

    var n = buffer.length;
    for ( var i = 0; i < n; i++ ) {
        renderLogEntry(buffer[i]);
    }
    if ( body.scrollTop !== 0 ) {
        body.scrollTop += tbody.offsetHeight - height;
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

uDom.onLoad(function() {
    // Extract the tab id of the page we need to pull the log
    var matches = window.location.search.match(/[\?&]tabId=([^&]+)/);
    if ( matches && matches.length === 2 ) {
        inspectedTabId = matches[1];
    }

    readLogBuffer();

    uDom('#reload').on('click', reloadTab);
    uDom('#clear').on('click', clearBuffer);
});

/******************************************************************************/

})();

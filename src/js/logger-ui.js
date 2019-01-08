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

const messaging = vAPI.messaging;
const logger = self.logger = { ownerId: Date.now() };
let popupLoggerBox;
let popupLoggerTooltips;
let activeTabId;
let netInspectorPaused = false;

/******************************************************************************/

const removeAllChildren = logger.removeAllChildren = function(node) {
    while ( node.firstChild ) {
        node.removeChild(node.firstChild);
    }
};

/******************************************************************************/

const tabIdFromClassName = function(className) {
    const matches = className.match(/\btab_([^ ]+)\b/);
    if ( matches === null ) { return 0; }
    if ( matches[1] === 'bts' ) { return -1; }
    return parseInt(matches[1], 10);
};

const tabIdFromPageSelector = logger.tabIdFromPageSelector = function() {
    const tabClass = uDom.nodeFromId('pageSelector').value;
    if ( tabClass === 'tab_active' && activeTabId !== undefined ) {
        return activeTabId;
    }
    if ( tabClass === 'tab_bts' ) { return -1; }
    return /^tab_\d+$/.test(tabClass) ? parseInt(tabClass.slice(4), 10) : 0;
};

/******************************************************************************/
/******************************************************************************/

const tbody = document.querySelector('#netInspector tbody');
const trJunkyard = [];
const tdJunkyard = [];
const firstVarDataCol = 1;
const lastVarDataIndex = 6;
const reRFC3986 = /^([^:\/?#]+:)?(\/\/[^\/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?/;
const netFilteringDialog = uDom.nodeFromId('netFilteringDialog');

const prettyRequestTypes = {
    'main_frame': 'doc',
    'stylesheet': 'css',
    'sub_frame': 'frame',
    'xmlhttprequest': 'xhr'
};

const uglyRequestTypes = {
    'doc': 'main_frame',
    'css': 'stylesheet',
    'frame': 'sub_frame',
    'xhr': 'xmlhttprequest'
};

const staticFilterTypes = {
    'beacon': 'other',
    'doc': 'document',
    'css': 'stylesheet',
    'frame': 'subdocument',
    'ping': 'other',
    'object_subrequest': 'object',
    'xhr': 'xmlhttprequest'
};

let maxEntries = 5000;
let allTabIds = new Map();
let allTabIdsToken;

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

const createCellAt = function(tr, index) {
    let td = tr.cells[index];
    const mustAppend = !td;
    if ( mustAppend ) {
        td = tdJunkyard.pop();
    }
    if ( td ) {
        td.removeAttribute('colspan');
        td.removeAttribute('data-parties');
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
    let tr = trJunkyard.pop();
    if ( tr ) {
        tr.className = '';
        tr.removeAttribute('data-tabhn');
        tr.removeAttribute('data-dochn');
        tr.removeAttribute('data-filter');
        tr.removeAttribute('data-tabid');
    } else {
        tr = document.createElement('tr');
    }
    let index = 0;
    for ( ; index < firstVarDataCol; index++ ) {
        createCellAt(tr, index);
    }
    let i = 1, span = 1, td;
    for (;;) {
        td = createCellAt(tr, index);
        if ( i === lastVarDataIndex ) { break; }
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

var padTo2 = function(v) {
    return v < 10 ? '0' + v : v;
};

/******************************************************************************/

const createGap = function(tabId, url) {
    const tr = createRow('1');
    tr.setAttribute('data-tabid', tabId);
    tr.classList.add('tab_' + tabId);
    tr.classList.add('maindoc');
    tr.cells[firstVarDataCol].textContent = url;
    tbody.insertBefore(tr, tbody.firstChild);
};

/******************************************************************************/

var renderNetLogEntry = function(tr, details) {
    const trcl = tr.classList;
    const type = details.type;
    const url = details.url;
    let td;

    // If the request is that of a root frame, insert a gap in the table
    // in order to visually separate entries for different documents. 
    if ( type === 'main_frame' ) {
        createGap(details.tabId, url);
    }

    tr.classList.add('cat_' + details.realm);

    let filter = details.filter || undefined;
    let filteringType;
    if ( filter !== undefined ) {
        if ( typeof filter.source === 'string' ) {
            filteringType = filter.source;
            trcl.add(filteringType);
        }
    }

    if ( filter !== undefined ) {
        td = tr.cells[1];
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

    if ( filter !== undefined ) {
        td = tr.cells[2];
        if ( filter.result === 1 ) {
            trcl.add('blocked');
            td.textContent = '--';
        } else if ( filter.result === 2 ) {
            trcl.add('allowed');
            td.textContent = '++';
        } else if ( filter.result === 3 ) {
            trcl.add('nooped');
            td.textContent = '**';
        } else if ( filteringType === 'redirect' ) {
            trcl.add('redirect');
            td.textContent = '<<';
        }
    }

    if ( details.tabHostname ) {
        tr.setAttribute('data-tabhn', details.tabHostname);
    }
    if ( details.docHostname ) {
        tr.setAttribute('data-dochn', details.docHostname);
        tr.cells[3].textContent = details.docHostname;
    }

    // Partyness
    if ( details.realm === 'net' && details.domain !== undefined ) {
        td = tr.cells[4];
        let text = '';
        if ( details.tabDomain !== undefined ) {
            text += details.domain === details.tabDomain ? '1' : '3';
        } else {
            text += '?';
        }
        if ( details.docDomain !== details.tabDomain ) {
            text += ',';
            if ( details.docDomain !== undefined ) {
                text += details.domain === details.docDomain ? '1' : '3';
            } else {
                text += '?';
            }
        }
        td.textContent = text;
        let indent = '\t';
        text = details.tabDomain;
        if ( details.docDomain !== details.tabDomain ) {
            text += ` \u21d2\n\t${details.docDomain}`;
            indent = '\t\t';
        }
        text += ` \u21d2\n${indent}${details.domain}`;
        td.setAttribute('data-parties', text);
    }

    tr.cells[5].textContent = (prettyRequestTypes[type] || type);

    let re = null;
    if ( filteringType === 'static' ) {
        re = new RegExp(filter.regex, 'gi');
    } else if ( filteringType === 'dynamicUrl' ) {
        re = regexFromURLFilteringResult(filter.rule.join(' '));
    }
    tr.cells[6].appendChild(nodeFromURL(url, re));
};

/******************************************************************************/

var renderLogEntry = function(details) {
    const fvdc = firstVarDataCol;
    let tr;

    if ( details.error !== undefined ) {
        tr = createRow('1');
        tr.cells[fvdc].textContent = details.error;
    } else if ( details.url !== undefined ) {
        tr = createRow('111111');
        renderNetLogEntry(tr, details);
    } else {
        tr = createRow('1');
        tr.cells[fvdc].textContent = '???';
    }

    // Fields common to all rows.
    const time = logDate;
    time.setTime(details.tstamp - logDateTimezoneOffset);
    tr.cells[0].textContent = padTo2(time.getUTCHours()) + ':' +
                              padTo2(time.getUTCMinutes()) + ':' +
                              padTo2(time.getSeconds());

    if ( details.tabId ) {
        tr.setAttribute('data-tabid', details.tabId);
        tr.classList.add(classNameFromTabId(details.tabId));
    }

    rowFilterer.filterOne(tr, true);
    tbody.insertBefore(tr, tbody.firstChild);
    return tr;
};

// Reuse date objects.
const logDate = new Date();
const logDateTimezoneOffset = logDate.getTimezoneOffset() * 60000;

/******************************************************************************/

const renderLogEntries = function(response) {
    document.body.classList.toggle('colorBlind', response.colorBlind);

    const entries = response.entries;
    if ( entries.length === 0 ) { return; }

    // Preserve scroll position
    const height = tbody.offsetHeight;

    const tabIds = allTabIds;
    for ( const entry of entries ) {
        const details = JSON.parse(entry.details);
        const tr = renderLogEntry(details);
        // https://github.com/gorhill/uBlock/issues/1613#issuecomment-217637122
        // Unlikely, but it may happen: mark as void if associated tab no
        // longer exist.
        if ( details.tabId && tabIds.has(details.tabId) === false ) {
            tr.classList.add('void');
        }
    }

    // Prevent logger from growing infinitely and eating all memory. For
    // instance someone could forget that it is left opened for some
    // dynamically refreshed pages.
    truncateLog(maxEntries);

    // Follow waterfall if not observing top of waterfall.
    const yDelta = tbody.offsetHeight - height;
    if ( yDelta === 0 ) { return; }
    const container = uDom.nodeFromSelector('#netInspector .vscrollable');
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

const synchronizeTabIds = function(newTabIds) {
    const select = uDom.nodeFromId('pageSelector');
    const selectValue = select.value;
    const oldTabIds = allTabIds;
    const autoDeleteVoidRows = selectValue === 'tab_active';
    let rowVoided = false;
    for ( const tabId of oldTabIds.keys() ) {
        if ( newTabIds.has(tabId) ) { continue; }
        // Mark or remove voided rows
        const trs = uDom('.tab_' + tabId);
        if ( autoDeleteVoidRows ) {
            toJunkyard(trs);
        } else {
            trs.addClass('void');
            rowVoided = true;
        }
        // Remove popup if it is currently bound to a removed tab.
        if ( tabId === popupManager.tabId ) {
            popupManager.toggleOff();
        }
    }

    const tabIds = Array.from(newTabIds.keys()).sort(function(a, b) {
        return newTabIds.get(a).localeCompare(newTabIds.get(b));
    });
    let j = 3;
    for ( let i = 0; i < tabIds.length; i++ ) {
        const tabId = tabIds[i];
        if ( tabId < 0 ) { continue; }
        let option = select.options[j];
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

const onLogBufferRead = function(response) {
    if ( !response || response.unavailable ) { return; }

    // Disable tooltips?
    if (
        popupLoggerTooltips === undefined &&
        response.tooltips !== undefined
    ) {
        popupLoggerTooltips = response.tooltips;
        if ( popupLoggerTooltips === false ) {
            uDom('[data-i18n-title]').attr('title', '');
        }
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

    if ( netInspectorPaused === false ) {
        renderLogEntries(response);
    }

    if ( rowVoided ) {
        uDom('#clean').toggleClass(
            'disabled',
            tbody.querySelector('#netInspector tr[data-tabid].void') === null
        );
    }

    // Synchronize toolbar with content of log
    uDom('#clear').toggleClass(
        'disabled',
        tbody.querySelector('tr') === null
    );
};

/******************************************************************************/

const readLogBuffer = (function() {
    let timer;

    const readLogBufferNow = function() {
        if ( logger.ownerId === undefined ) { return; }

        const msg = {
            what: 'readAll',
            ownerId: logger.ownerId,
            tabIdsToken: allTabIdsToken,
        };

        // This is to detect changes in the position or size of the logger
        // popup window (if in use).
        if (
            popupLoggerBox instanceof Object &&
            (
                self.screenX !== popupLoggerBox.x ||
                self.screenY !== popupLoggerBox.y ||
                self.outerWidth !== popupLoggerBox.w ||
                self.outerHeight !== popupLoggerBox.h
            )
        ) {
            popupLoggerBox.x = self.screenX;
            popupLoggerBox.y = self.screenY;
            popupLoggerBox.w = self.outerWidth;
            popupLoggerBox.h = self.outerHeight;
            msg.popupLoggerBoxChanged = true;
        }

        vAPI.messaging.send('loggerUI', msg, response => {
            timer = undefined;
            onLogBufferRead(response);
            readLogBufferLater();
        });
    };

    const readLogBufferLater = function() {
        if ( timer !== undefined ) { return; }
        if ( logger.ownerId === undefined ) { return; }
        timer = vAPI.setTimeout(readLogBufferNow, 1200);
    };

    readLogBufferNow();

    return readLogBufferLater;
})();
 
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

        uDom('.needdom').toggleClass(
            'disabled',
            tabClass === '' || tabClass === 'tab_bts'
        );
        uDom('.needscope').toggleClass(
            'disabled',
            tabClass === ''
        );
    };
})();

/******************************************************************************/

var reloadTab = function(ev) {
    var tabId = tabIdFromPageSelector();
    if ( tabId <= 0 ) { return; }
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
                messaging.send(
                    'loggerUI',
                    {
                        what: 'createUserFilter',
                        autoComment: true,
                        filters: value,
                        origin: targetPageDomain,
                        pageDomain: targetPageDomain,
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
    const createTargetURLs = function(url) {
        const urls = [];
        const matches = reRFC3986.exec(url);
        if ( matches === null || !matches[1] || !matches[2] ) {
            return urls;
        }
        // Shortest URL for a valid URL filtering rule
        const rootURL = matches[1] + matches[2];
        urls.unshift(rootURL);
        const path = matches[3] || '';
        let pos = path.charAt(0) === '/' ? 1 : 0;
        while ( pos < path.length ) {
            pos = path.indexOf('/', pos);
            if ( pos === -1 ) {
                pos = path.length;
            } else {
                pos += 1;
            }
            urls.unshift(rootURL + path.slice(0, pos));
        }
        const query = matches[4] || '';
        if ( query !== '' ) {
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
        targetType = targetRow.cells[5].textContent.trim() || '';
        targetURLs = createTargetURLs(targetRow.cells[6].textContent);
        targetPageHostname = targetRow.getAttribute('data-tabhn') || '';
        targetFrameHostname = targetRow.getAttribute('data-dochn') || '';

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
        rawFilter = row.cells[1].textContent;
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
                    url: row.cells[6].textContent,
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

const rowFilterer = (function() {
    const userFilters = [];
    const builtinFilters = [];
    let filters = [];

    const parseInput = function() {
        userFilters.length = 0;

        const rawParts =
            uDom.nodeFromSelector('#filterInput > input')
                .value
                .trim()
                .split(/\s+/);
        const n = rawParts.length;
        const reStrs = [];
        let not = false;
        for ( let i = 0; i < n; i++ ) {
            let rawPart = rawParts[i];
            if ( rawPart.charAt(0) === '!' ) {
                if ( reStrs.length === 0 ) {
                    not = true;
                }
                rawPart = rawPart.slice(1);
            }
            let reStr = '';
            if ( rawPart.startsWith('/') && rawPart.endsWith('/') ) {
                reStr = rawPart.slice(1, -1);
                try {
                    new RegExp(reStr);
                } catch(ex) {
                    reStr = '';
                }
            }
            if ( reStr === '' ) {
                const hardBeg = rawPart.startsWith('|');
                if ( hardBeg ) {
                    rawPart = rawPart.slice(1);
                }
                const hardEnd = rawPart.endsWith('|');
                if ( hardEnd ) {
                    rawPart = rawPart.slice(0, -1);
                }
                // https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions
                reStr = rawPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // https://github.com/orgs/uBlockOrigin/teams/ublock-issues-volunteers/discussions/51
                //   Be more flexible when interpreting leading/trailing pipes,
                //   as leading/trailing pipes are often used in static filters.
                if ( hardBeg ) {
                    reStr = reStr !== '' ? '(?:^|\\s|\\|)' + reStr : '\\|';
                }
                if ( hardEnd ) {
                    reStr += '(?:\\||\\s|$)';
                }
            }
            if ( reStr === '' ) { continue; }
            reStrs.push(reStr);
            if ( i < (n - 1) && rawParts[i + 1] === '||' ) {
                i += 1;
                continue;
            }
            reStr = reStrs.length === 1 ? reStrs[0] : reStrs.join('|');
            userFilters.push({
                re: new RegExp(reStr, 'i'),
                r: !not
            });
            reStrs.length = 0;
            not = false;
        }
        filters = builtinFilters.concat(userFilters);
    };

    const filterOne = function(tr, clean) {
        if ( filters.length === 0 && clean === true ) { return; }
        // do not filter out doc boundaries, they help separate important
        // section of log.
        const cl = tr.classList;
        if ( cl.contains('maindoc') ) { return; }
        if ( filters.length === 0 ) {
            cl.remove('f');
            return;
        }
        const cc = tr.cells;
        const ccount = cc.length;
        // each filter expression must hit (implicit and-op)
        // if...
        //   positive filter expression = there must one hit on any field
        //   negative filter expression = there must be no hit on all fields
        for ( const f of filters ) {
            let hit = !f.r;
            for ( let j = 1; j < ccount; j++ ) {
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

    const filterAll = function() {
        const filterCount = filters.length;
        uDom.nodeFromId('filterButton').classList.toggle(
            'active',
            filterCount !== 0
        );
        // Special case: no filter
        if ( filterCount === 0 ) {
            uDom('#netInspector tr').removeClass('f');
            return;
        }
        for ( const row of document.querySelector('#netInspector tbody').rows ) {
            filterOne(row);
        }
    };

    const onFilterChangedAsync = (function() {
        let timer;
        const commit = ( ) => {
            timer = undefined;
            parseInput();
            filterAll();
        };
        return function() {
            if ( timer !== undefined ) {
                clearTimeout(timer);
            }
            timer = vAPI.setTimeout(commit, 750);
        };
    })();

    const onFilterButton = function() {
        uDom.nodeFromId('netInspector').classList.toggle('f');
    };

    const onToggleExtras = function(ev) {
        ev.target.classList.toggle('expanded');
    };

    const onToggleBuiltinExpression = function(ev) {
        builtinFilters.length = 0;

        ev.target.classList.toggle('on');
        const filtexElems = ev.currentTarget.querySelectorAll('[data-filtex]');
        const orExprs = [];
        let not = false;
        for ( const filtexElem of filtexElems ) {
            let filtex = filtexElem.getAttribute('data-filtex');
            let active = filtexElem.classList.contains('on');
            if ( filtex === '!' ) {
                if ( orExprs.length !== 0 ) {
                    builtinFilters.push({
                        re: new RegExp(orExprs.join('|')),
                        r: !not
                    });
                    orExprs.length = 0;
                }
                not = active;
            } else if ( active ) {
                orExprs.push(filtex);
            }
        }
        if ( orExprs.length !== 0 ) {
            builtinFilters.push({
                re: new RegExp(orExprs.join('|')),
                r: !not
            });
        }
        filters = builtinFilters.concat(userFilters);
        uDom.nodeFromId('filterExprButton').classList.toggle(
            'active',
            builtinFilters.length !== 0
        );
        filterAll();
    };

    uDom('#filterButton').on('click', onFilterButton);
    uDom('#filterInput > input').on('input', onFilterChangedAsync);
    uDom('#filterExprButton').on('click', onToggleExtras);
    uDom('#filterExprPicker').on('click', '[data-filtex]', onToggleBuiltinExpression);

    // https://github.com/gorhill/uBlock/issues/404
    //   Ensure page state is in sync with the state of its various widgets.
    parseInput();
    filterAll();

    return {
        filterOne,
        filterAll,
    };
})();

/******************************************************************************/

const toJunkyard = function(trs) {
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
        tbody.querySelector('#netInspector tr[data-tabid].void') === null
    );
};

/******************************************************************************/

var cleanBuffer = function() {
    var rows = uDom('#netInspector tr[data-tabid].void').remove();
    var i = rows.length;
    while ( i-- ) {
        trJunkyard.push(rows.nodeAt(i));
    }
    uDom('#clean').addClass('disabled');
};

/******************************************************************************/

const pauseNetInspector = function() {
    netInspectorPaused = uDom.nodeFromId('netInspector')
                             .classList
                             .toggle('paused');
};

/******************************************************************************/

const toggleVCompactView = function() {
    uDom.nodeFromId('netInspector').classList.toggle('vCompact');
    uDom('#netInspector .vExpanded').toggleClass('vExpanded');
};

const toggleVCompactRow = function(ev) {
    ev.target.parentElement.classList.toggle('vExpanded');
};

/******************************************************************************/

const popupManager = (function() {
    let realTabId = 0;
    let popup = null;
    let popupObserver = null;

    const resizePopup = function() {
        if ( popup === null ) { return; }
        const popupBody = popup.contentWindow.document.body;
        if ( popupBody.clientWidth !== 0 && popup.clientWidth !== popupBody.clientWidth ) {
            popup.style.setProperty('width', popupBody.clientWidth + 'px');
        }
        if ( popupBody.clientHeight !== 0 && popup.clientHeight !== popupBody.clientHeight ) {
            popup.style.setProperty('height', popupBody.clientHeight + 'px');
        }
    };

    const onLoad = function() {
        resizePopup();
        popupObserver.observe(popup.contentDocument.body, {
            subtree: true,
            attributes: true
        });
    };

    const setTabId = function(tabId) {
        if ( popup === null ) { return; }
        popup.setAttribute('src', 'popup.html?tabId=' + tabId);
    };

    const onTabIdChanged = function() {
        const tabId = tabIdFromPageSelector();
        if ( tabId === 0 ) { return toggleOff(); }
        realTabId = tabId;
        setTabId(realTabId);
    };

    const toggleOn = function() {
        const tabId = tabIdFromPageSelector();
        if ( tabId === 0 ) { return; }
        realTabId = tabId;

        popup = uDom.nodeFromId('popupContainer');

        popup.addEventListener('load', onLoad);
        popupObserver = new MutationObserver(resizePopup);

        const parent = uDom.nodeFromId('inspectors');
        const rect = parent.getBoundingClientRect();
        popup.style.setProperty('right', (rect.right - parent.clientWidth) + 'px');
        parent.classList.add('popupOn');

        document.addEventListener('tabIdChanged', onTabIdChanged);

        setTabId(realTabId);
        uDom.nodeFromId('showpopup').classList.add('active');
    };

    const toggleOff = function() {
        uDom.nodeFromId('showpopup').classList.remove('active');
        document.removeEventListener('tabIdChanged', onTabIdChanged);
        uDom.nodeFromId('inspectors').classList.remove('popupOn');
        popup.removeEventListener('load', onLoad);
        popupObserver.disconnect();
        popupObserver = null;
        popup.setAttribute('src', '');
    
        realTabId = 0;
    };

    const exports = {
        toggleOff: function() {
            if ( realTabId !== 0 ) {
                toggleOff();
            }
        }
    };

    Object.defineProperty(exports, 'tabId', {
        get: function() { return realTabId || 0; }
    });

    uDom('#showpopup').on('click', ( ) => {
        void (realTabId === 0 ? toggleOn() : toggleOff());
    });

    return exports;
})();

/******************************************************************************/

logger.resize = (function() {
    let timer;

    const resize = function() {
        const vrect = document.body.getBoundingClientRect();
        const elems = document.querySelectorAll('.vscrollable');
        for ( const elem of elems ) {
            const crect = elem.getBoundingClientRect();
            const dh = crect.bottom - vrect.bottom;
            if ( dh === 0 ) { continue; }
            elem.style.height = (crect.height - dh) + 'px';
        }
    };

    const resizeAsync = function() {
        if ( timer !== undefined ) { return; }
        timer = self.requestAnimationFrame(( ) => {
            timer = undefined;
            resize();
        });
    };

    resizeAsync();

    window.addEventListener('resize', resizeAsync, { passive: true });

    return resizeAsync;
})();

/******************************************************************************/

const grabView = function() {
    if ( logger.ownerId === undefined ) {
        logger.ownerId = Date.now();
    }
    readLogBuffer();
};

const releaseView = function() {
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

uDom('#pageSelector').on('change', pageSelectorChanged);
uDom('#refresh').on('click', reloadTab);

uDom('#netInspector .vCompactToggler').on('click', toggleVCompactView);
uDom('#clean').on('click', cleanBuffer);
uDom('#clear').on('click', clearBuffer);
uDom('#pause').on('click', pauseNetInspector);
uDom('#maxEntries').on('change', onMaxEntriesChanged);
uDom('#netInspector table').on('click', 'tr > td:nth-of-type(1)', toggleVCompactRow);
uDom('#netInspector').on('click', 'tr.canLookup > td:nth-of-type(2)', reverseLookupManager.toggleOn);
uDom('#netInspector').on('click', 'tr.cat_net > td:nth-of-type(3)', netFilteringManager.toggleOn);

// https://github.com/gorhill/uBlock/issues/507
// Ensure tab selector is in sync with URL hash
pageSelectorFromURLHash();
window.addEventListener('hashchange', pageSelectorFromURLHash);

// Start to watch the current window geometry 2 seconds after the document
// is loaded, to be sure no spurious geometry changes will be triggered due
// to the window geometry pontentially not settling fast enough.
if ( self.location.search.includes('popup=1') ) {
    window.addEventListener('load', ( ) => {
        setTimeout(( ) => {
            popupLoggerBox = {
                x: self.screenX,
                y: self.screenY,
                w: self.outerWidth,
                h: self.outerHeight,
            };
        }, 2000);
    }, { once: true });
}

/******************************************************************************/

})();

/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2025-present Raymond Hill

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

import { dom, qs$ } from './dom.js';
import { faIconsInit } from './fa-icons.js';
import { toolOverlay } from './tool-overlay-ui.js';

/******************************************************************************/

let previewCSS = '';

/******************************************************************************/

function onMinimizeClicked() {
    dom.cl.toggle(dom.root, 'minimized');
}

/******************************************************************************/

function onFilterClicked(ev) {
    const target = ev.target;
    const containerElem = target.closest('.customFilter');
    if ( containerElem === null ) { return; }
    const filterElem = qs$(containerElem, ':scope > span:first-of-type');
    const trashElem = qs$(containerElem, ':scope > span:last-of-type');
    const selector = filterElem.textContent;
    if ( target === filterElem ) {
        dom.cl.remove('.customFilter.on', 'on');
        dom.cl.add(containerElem, 'on');
        toolOverlay.postMessage({ what: 'highlightFromSelector', selector });
        return;
    }
    if ( target === trashElem ) {
        dom.cl.add(containerElem, 'removed');
        dom.cl.remove(containerElem, 'on');
        toolOverlay.sendMessage({ what: 'removeCustomFilter',
            hostname: toolOverlay.url.hostname,
            selector,
        }).then(( ) =>
            toolOverlay.postMessage({ what: 'unhighlight' })
        ).then(( ) => {
            autoSelectFilter();
        });
        return;
    }
}

/******************************************************************************/

function updateElementCount(details) {
    const { count, error } = details;
    const span = qs$('#resultsetCount');
    if ( error ) {
        span.textContent = 'Error';
        span.setAttribute('title', error);
    } else {
        span.textContent = count;
        span.removeAttribute('title');
    }
    const disabled = Boolean(count) === false ? '' : null;
    dom.attr('#create', 'disabled', disabled);
}

/******************************************************************************/

function autoSelectFilter() {
    let containerElem = qs$('.customFilter.on');
    if ( containerElem !== null ) { return; }
    containerElem = qs$('.customFilter:not(.removed)');
    if ( containerElem === null ) {
        quitUnpicker();
        return;
    }
    dom.cl.add(containerElem, 'on');
    const filterElem = qs$(containerElem, ':scope > span:first-of-type');
    toolOverlay.postMessage({ what: 'highlightFromSelector',
        selector: filterElem.textContent,
    });
}

/******************************************************************************/

function populateFilters(selectors) {
    const container = qs$('#customFilters');
    dom.clear(container);
    const rowTemplate = qs$('template#customFilterRow');
    for ( const selector of selectors ) {
        const row = rowTemplate.content.cloneNode(true);
        qs$(row, '.customFilter > span:first-of-type').textContent = selector;
        container.append(row);
    }
    faIconsInit(container);
}

/******************************************************************************/

function startUnpicker() {
    toolOverlay.sendMessage({
        what: 'selectorsFromCustomFilters',
        hostname: toolOverlay.url.hostname,
    }).then(selectors => {
        if ( selectors.length === 0 ) { quitUnpicker(); }
        populateFilters(selectors);
        autoSelectFilter();
    });
    toolOverlay.postMessage({ what: 'startTool' });
    toolOverlay.postMessage({ what: 'uninjectCustomFilters' });
    dom.on('#minimize', 'click', onMinimizeClicked);
    dom.on('#customFilters', 'click', onFilterClicked);
    dom.on('#quit', 'click', quitUnpicker);
}

/******************************************************************************/

function quitUnpicker() {
    toolOverlay.postMessage({ what: 'injectCustomFilters' });
    toolOverlay.stop();
}

/******************************************************************************/

function onMessage(msg) {
    switch ( msg.what ) {
    case 'startTool':
        startUnpicker();
        break;
    default:
        break;
    }
}

/******************************************************************************/

// Wait for the content script to establish communication
toolOverlay.start(onMessage);

/******************************************************************************/

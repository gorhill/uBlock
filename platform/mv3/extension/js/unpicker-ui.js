/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
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

import { dom, qs$, qsa$ } from './dom.js';
import { faIconsInit } from './fa-icons.js';
import { toolOverlay } from './tool-overlay-ui.js';

/******************************************************************************/

function onMinimizeClicked() {
    dom.cl.toggle(dom.root, 'minimized');
}

/******************************************************************************/

function highlight() {
    const selectors = [];
    for ( const selectorElem of qsa$('#customFilters .customFilter.on') ) {
        selectors.push(selectorElem.dataset.selector);
    }
    if ( selectors.length !== 0 ) {
        toolOverlay.postMessage({
            what: 'highlightFromSelector',
            selector: selectors.join(','),
            scrollTo: true,
        });
    } else {
        toolOverlay.postMessage({ what: 'unhighlight' });
    }
}

/******************************************************************************/

function onFilterClicked(ev) {
    const target = ev.target;
    const filterElem = target.closest('.customFilter');
    if ( filterElem === null ) { return; }
    const selectorElem = qs$(filterElem, ':scope > span.selector');
    if ( target === selectorElem ) {
        if ( dom.cl.has(filterElem, 'on') ) {
            dom.cl.remove(filterElem, 'on');
        } else {
            dom.cl.remove('.customFilter.on', 'on');
            dom.cl.add(filterElem, 'on');
        }
        highlight();
        return;
    }
    const selector = filterElem.dataset.selector;
    const trashElem = qs$(filterElem, ':scope > span.remove');
    if ( target === trashElem ) {
        dom.cl.add(filterElem, 'removed');
        dom.cl.remove(filterElem, 'on');
        toolOverlay.sendMessage({ what: 'removeCustomFilters',
            hostname: toolOverlay.url.hostname,
            selectors: [ selector ],
        }).then(( ) => {
            autoSelectFilter();
        });
        return;
    }
    const undoElem = qs$(filterElem, ':scope > span.undo');
    if ( target === undoElem ) {
        dom.cl.remove(filterElem, 'removed');
        toolOverlay.sendMessage({ what: 'addCustomFilters',
            hostname: toolOverlay.url.hostname,
            selectors: [ selector ],
        }).then(( ) => {
            dom.cl.remove('.customFilter.on', 'on');
            dom.cl.add(filterElem, 'on');
            highlight();
        });
        return;
    }
}

/******************************************************************************/

function autoSelectFilter() {
    let filterElem = qs$('.customFilter.on');
    if ( filterElem !== null ) { return; }
    filterElem = qs$('.customFilter:not(.removed)');
    if ( filterElem !== null ) {
        dom.cl.add(filterElem, 'on');
    }
    highlight();
}

/******************************************************************************/

function populateFilters(selectors) {
    const container = qs$('#customFilters');
    dom.clear(container);
    const rowTemplate = qs$('template#customFilterRow');
    for ( const selector of selectors ) {
        const fragment = rowTemplate.content.cloneNode(true);
        const row = qs$(fragment, '.customFilter');
        row.dataset.selector = selector;
        let text = selector;
        if ( selector.startsWith('{') ) {
            const o = JSON.parse(selector);
            text = o.raw;
        }
        qs$(row, '.selector').textContent = text;
        container.append(fragment);
    }
    faIconsInit(container);
    autoSelectFilter();
}

/******************************************************************************/

async function startUnpicker() {
    const selectors = await toolOverlay.sendMessage({
        what: 'customFiltersFromHostname',
        hostname: toolOverlay.url.hostname,
    })
    if ( selectors.length === 0 ) {
        return quitUnpicker();
    }
    await toolOverlay.postMessage({ what: 'terminateCustomFilters' });
    await toolOverlay.postMessage({ what: 'startTool' });
    populateFilters(selectors);
    dom.on('#minimize', 'click', onMinimizeClicked);
    dom.on('#customFilters', 'click', onFilterClicked);
    dom.on('#quit', 'click', quitUnpicker);
}

/******************************************************************************/

async function quitUnpicker() {
    await toolOverlay.postMessage({ what: 'startCustomFilters' });
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

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
import { localRead, localWrite } from './ext.js';
import { ExtSelectorCompiler } from './static-filtering-parser.js';
import { toolOverlay } from './tool-overlay-ui.js';

/******************************************************************************/

const selectorCompiler = new ExtSelectorCompiler({ nativeCssHas: true });

let selectorPartsDB = new Map();
let sliderParts = [];
let sliderPartsPos = -1;

/******************************************************************************/

function validateSelector(selector) {
    validateSelector.error = undefined;
    if ( selector === '' ) { return; }
    const result = {};
    if ( selectorCompiler.compile(selector, result) ) {
        return result.compiled;
    }
    validateSelector.error = 'Error';
}

/******************************************************************************/

function onSvgTouch(ev) {
    if ( ev.type === 'touchstart' ) {
        onSvgTouch.x0 = ev.touches[0].screenX;
        onSvgTouch.y0 = ev.touches[0].screenY;
        onSvgTouch.t0 = ev.timeStamp;
        return;
    }
    if ( onSvgTouch.x0 === undefined ) { return; }
    const stopX = ev.changedTouches[0].screenX;
    const stopY = ev.changedTouches[0].screenY;
    const distance = Math.sqrt(
        Math.pow(stopX - onSvgTouch.x0, 2) +
        Math.pow(stopY - onSvgTouch.y0, 2)
    );
    // Interpret touch events as a tap if:
    // - Swipe is not valid; and
    // - The time between start and stop was less than 200ms.
    const duration = ev.timeStamp - onSvgTouch.t0;
    if ( distance >= 32 || duration >= 200 ) { return; }
    onSvgClicked({
        type: 'touch',
        target: ev.target,
        clientX: ev.changedTouches[0].pageX,
        clientY: ev.changedTouches[0].pageY,
    });
    ev.preventDefault();
}
onSvgTouch.x0 = onSvgTouch.y0 = 0;
onSvgTouch.t0 = 0;

/******************************************************************************/

function onSvgClicked(ev) {
    // Unpause picker if:
    // - click outside dialog AND
    // - not in preview mode
    if ( dom.cl.has(dom.root, 'paused') ) {
        if ( dom.cl.has(dom.root, 'preview') ) {
            updatePreview(false);
        }
        unpausePicker();
        return;
    }
    // Force dialog to always be visible when using a touch-driven device.
    if ( ev.type === 'touch' ) {
        dom.cl.add(dom.root, 'show');
    }
    toolOverlay.postMessage({
        what: 'candidatesAtPoint',
        mx: ev.clientX,
        my: ev.clientY,
        broad: ev.ctrlKey,
    }).then(details => {
        showDialog(details);
    });
}

/******************************************************************************/

function onKeyPressed(ev) {
    if ( ev.key === 'Escape' || ev.which === 27 ) {
        quitPicker();
        return;
    }
}

/******************************************************************************/

function onMinimizeClicked() {
    if ( dom.cl.has(dom.root, 'paused') === false ) {
        pausePicker();
        highlightCandidate();
        return;
    }
    dom.cl.toggle(dom.root, 'minimized');
}

/******************************************************************************/

function onFilterTextChanged() {
    highlightCandidate();
}

/******************************************************************************/

function toggleView(view, persist = false) {
    dom.root.dataset.view = `${view}`;
    if ( persist !== true ) { return; }
    localWrite('picker.view', dom.root.dataset.view);
}

function onViewToggled(dir) {
    let view = parseInt(dom.root.dataset.view, 10);
    view += dir;
    if ( view < 0 ) { view = 0; }
    if ( view > 2 ) { view = 2; }
    toggleView(view, true);
}

/******************************************************************************/

function selectorFromCandidates() {
    const selectorParts = [];
    let liPrevious = null;
    for ( const li of qsa$('#candidateFilters li') ) {
        const selector = [];
        for ( const span of qsa$(li, '.on[data-part]') ) {
            selector.push(span.textContent);
        }
        if ( selector.length !== 0 ) {
            if ( liPrevious !== null ) {
                if ( li.previousElementSibling === liPrevious ) {
                    selectorParts.unshift(' > ');
                } else if ( liPrevious !== li ) {
                    selectorParts.unshift(' ');
                }
            }
            liPrevious = li;
            selectorParts.unshift(selector.join(''));
        }
    }
    return selectorParts.join('');
}

/******************************************************************************/

function onSliderChanged(ev) {
    updateSlider(Math.round(ev.target.valueAsNumber));
}

function updateSlider(i) {
    if ( i === sliderPartsPos ) { return; }
    sliderPartsPos = i;
    dom.cl.remove('#candidateFilters [data-part]', 'on');
    const parts = sliderParts[i];
    for ( const address of parts ) {
        dom.cl.add(`#candidateFilters [data-part="${address}"]`, 'on');
    }
    const selector = selectorFromCandidates();
    qs$('textarea').value = selector;
    highlightCandidate();
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
    updatePreview();
}

/******************************************************************************/

function onPreviewClicked() {
    dom.cl.toggle(dom.root, 'preview');
    updatePreview();
}

function updatePreview(state) {
    if ( state === undefined ) {
        state = dom.cl.has(dom.root, 'preview');
    } else {
        dom.cl.toggle(dom.root, 'preview', state)
    }
    const selector = state && validateSelector(qs$('textarea').value) || '';
    return toolOverlay.postMessage({ what: 'previewSelector', selector });
}

/******************************************************************************/

async function onCreateClicked() {
    const selector = validateSelector(qs$('textarea').value);
    if ( selector === undefined ) { return; }
    await toolOverlay.postMessage({ what: 'terminateCustomFilters' });
    await toolOverlay.sendMessage({
        what: 'addCustomFilters',
        hostname: toolOverlay.url.hostname,
        selectors: [ selector ],
    });
    await toolOverlay.postMessage({ what: 'startCustomFilters' });
    qs$('textarea').value = '';
    dom.cl.remove(dom.root, 'preview');
    quitPicker();
}

/******************************************************************************/

function attributeNameFromSelector(part) {
    const pos = part.search(/\^?=/);
    return part.slice(1, pos);
}

/******************************************************************************/

function onCandidateClicked(ev) {
    const target = ev.target;
    if ( target.matches('[data-part]') ) {
        const address = target.dataset.part;
        const part = selectorPartsDB.get(parseInt(address, 10));
        if ( part.startsWith('[') ) {
            if ( target.textContent === part ) {
                target.textContent = `[${attributeNameFromSelector(part)}]`;
                dom.cl.remove(target, 'on');
            } else if ( dom.cl.has(target, 'on') ) {
                target.textContent = part;
            } else {
                dom.cl.add(target, 'on');
            }
        } else {
            dom.cl.toggle(target, 'on');
        }
    } else if ( target.matches('li') ) {
        if ( qs$(target, ':scope > span:not(.on)') !== null ) {
            dom.cl.add(qsa$(target, ':scope > [data-part]:not(.on)'), 'on');
        } else {
            dom.cl.remove(qsa$(target, ':scope > [data-part]'), 'on');
        }
    }
    const selector = selectorFromCandidates();
    qs$('textarea').value = selector;
    highlightCandidate();
}

/******************************************************************************/

function showDialog(msg) {
    pausePicker();

    /* global */selectorPartsDB = new Map(msg.partsDB);
    const { listParts } = msg;
    const root = qs$('#candidateFilters');
    const ul = qs$(root, 'ul');
    while ( ul.firstChild !== null ) {
        ul.firstChild.remove();
    }
    for ( const parts of listParts ) {
        const li = document.createElement('li');
        for ( const address of parts ) {
            const span = document.createElement('span');
            const part = selectorPartsDB.get(address);
            span.dataset.part = address;
            if ( part.startsWith('[') ) {
                span.textContent = `[${attributeNameFromSelector(part)}]`;
            } else {
                span.textContent = part;
            }
            li.append(span);
        }
        ul.appendChild(li);
    }

    /* global */sliderParts = msg.sliderParts;
    /* global */sliderPartsPos = -1;
    const slider = qs$('#slider');
    const last = sliderParts.length - 1;
    dom.attr(slider, 'max', last);
    dom.attr(slider, 'value', last);
    dom.attr(slider, 'disabled', last !== 0 ? null : '');
    slider.value = last;
    updateSlider(last);
}

/******************************************************************************/

function highlightCandidate() {
    const selector = validateSelector(qs$('textarea').value);
    if ( selector === undefined ) {
        toolOverlay.postMessage({ what: 'unhighlight' });
        updateElementCount({ count: 0, error: validateSelector.error });
        return;
    }
    toolOverlay.postMessage({
        what: 'highlightFromSelector',
        selector,
    }).then(result => {
        updateElementCount(result);
    });
}

/*******************************************************************************
 * 
 * paused:
 * - select element mode disabled
 * - preview mode enabled or disabled
 * - dialog unminimized
 * 
 * unpaused:
 * - select element mode enabled
 * - preview mode disabled
 * - dialog minimized
 * 
 * */

function pausePicker() {
    dom.cl.add(dom.root, 'paused');
    dom.cl.remove(dom.root, 'minimized');
    toolOverlay.highlightElementUnderMouse(false);
}

function unpausePicker() {
    dom.cl.remove(dom.root, 'paused', 'preview');
    dom.cl.add(dom.root, 'minimized');
    updatePreview(false);
    toolOverlay.highlightElementUnderMouse(true);
}

/******************************************************************************/

function startPicker() {
    toolOverlay.postMessage({ what: 'startTool' });

    localRead('picker.view').then(value => {
        if ( Boolean(value) === false ) { return; }
        toggleView(value);
    });

    self.addEventListener('keydown', onKeyPressed, true);
    dom.on('svg#overlay', 'click', onSvgClicked);
    dom.on('svg#overlay', 'touchstart', onSvgTouch, { passive: true });
    dom.on('svg#overlay', 'touchend', onSvgTouch);
    dom.on('#minimize', 'click', onMinimizeClicked);
    dom.on('textarea', 'input', onFilterTextChanged);
    dom.on('#quit', 'click', quitPicker);
    dom.on('#slider', 'input', onSliderChanged);
    dom.on('#pick', 'click', resetPicker);
    dom.on('#preview', 'click', onPreviewClicked);
    dom.on('#moreOrLess > span:first-of-type', 'click', ( ) => { onViewToggled(1); });
    dom.on('#moreOrLess > span:last-of-type', 'click', ( ) => { onViewToggled(-1); });
    dom.on('#create', 'click', ( ) => { onCreateClicked(); });
    dom.on('#candidateFilters ul', 'click', onCandidateClicked);
    toolOverlay.highlightElementUnderMouse(true);
}

/******************************************************************************/

function quitPicker() {
    updatePreview(false);
    toolOverlay.stop();
}

/******************************************************************************/

function resetPicker() {
    toolOverlay.postMessage({ what: 'unhighlight' });
    unpausePicker();
}

/******************************************************************************/

function onMessage(msg) {
    switch ( msg.what ) {
    case 'startTool':
        startPicker();
        break;
    default:
        break;
    }
}

/******************************************************************************/

// Wait for the content script to establish communication
toolOverlay.start(onMessage);

/******************************************************************************/

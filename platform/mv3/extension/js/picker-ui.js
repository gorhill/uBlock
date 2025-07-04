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

import { dom, qs$, qsa$ } from './dom.js';
import { localRead, localWrite, sendMessage } from './ext.js';
import { toolOverlay } from './tool-overlay-ui.js';

/******************************************************************************/

const svgRoot = qs$('svg#overlay');
const svgOcean = svgRoot.children[0];
const svgIslands = svgRoot.children[1];
const NoPaths = 'M0 0';
const filterURL = new URL('about:blank');

const pickerRoot = document.documentElement;
const dialog = qs$('aside');

let selectorPartsDB = new Map();
let sliderParts = [];
let previewCSS = '';

/******************************************************************************/

function isValidSelector(selector) {
    isValidSelector.error = undefined;
    if ( selector === '' ) { return false; }
    try {
        void document.querySelector(selector);
    } catch (reason) {
        isValidSelector.error = reason;
        return false;
    }
    return true;
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

function moveDialog(ev) {
    const target = ev.target;
    if ( target.matches('#move') === false ) { return; }
    if ( dom.cl.has(dialog, 'moving') ) { return; }
    target.setPointerCapture(ev.pointerId);
    moveDialog.isTouch = ev.type.startsWith('touch');
    if ( moveDialog.isTouch ) {
        const touch = ev.touches[0];
        moveDialog.mx0 = touch.pageX;
        moveDialog.my0 = touch.pageY;
    } else {
        moveDialog.mx0 = ev.pageX;
        moveDialog.my0 = ev.pageY;
    }
    const rect = dialog.getBoundingClientRect();
    moveDialog.dw = rect.width;
    moveDialog.dh = rect.height;
    moveDialog.cx0 = rect.x + moveDialog.dw / 2;
    moveDialog.cy0 = rect.y + moveDialog.dh / 2;
    moveDialog.pw = pickerRoot.clientWidth;
    moveDialog.ph = pickerRoot.clientHeight;
    dom.cl.add(dialog, 'moving');
    self.addEventListener('pointermove', moveDialog.moveAsync, { capture: true });
    self.addEventListener('pointerup', moveDialog.stop, { capture: true, once: true });
    ev.stopPropagation();
    ev.preventDefault();
}
moveDialog.isTouch = false;
moveDialog.mx0 = moveDialog.my0 = 0;
moveDialog.mx1 = moveDialog.my1 = 0;
moveDialog.pw = moveDialog.ph = 0;
moveDialog.dw = moveDialog.dh = 0;
moveDialog.cx0 = moveDialog.cy0 = 0;
moveDialog.move = ( ) => {
    moveDialog.timer = undefined;
    const cx1 = moveDialog.cx0 + moveDialog.mx1 - moveDialog.mx0;
    const cy1 = moveDialog.cy0 + moveDialog.my1 - moveDialog.my0;
    if ( cx1 < moveDialog.pw / 2 ) {
        dialog.style.setProperty('left', `${Math.max(cx1-moveDialog.dw/2,2)}px`);
        dialog.style.removeProperty('right');
    } else {
        dialog.style.removeProperty('left');
        dialog.style.setProperty('right', `${Math.max(moveDialog.pw-cx1-moveDialog.dw/2,2)}px`);
    }
    if ( cy1 < moveDialog.ph / 2 ) {
        dialog.style.setProperty('top', `${Math.max(cy1-moveDialog.dh/2,2)}px`);
        dialog.style.removeProperty('bottom');
    } else {
        dialog.style.removeProperty('top');
        dialog.style.setProperty('bottom', `${Math.max(moveDialog.ph-cy1-moveDialog.dh/2,2)}px`);
    }
};
moveDialog.moveAsync = ev => {
    if ( moveDialog.timer !== undefined ) { return; }
    if ( moveDialog.isTouch ) {
        const touch = ev.touches[0];
        moveDialog.mx1 = touch.pageX;
        moveDialog.my1 = touch.pageY;
    } else {
        moveDialog.mx1 = ev.pageX;
        moveDialog.my1 = ev.pageY;
    }
    moveDialog.timer = self.requestAnimationFrame(moveDialog.move);
};
moveDialog.stop = ev => {
    if ( dom.cl.has(dialog, 'moving') === false ) { return; }
    dom.cl.remove(dialog, 'moving');
    self.removeEventListener('pointermove', moveDialog.moveAsync, { capture: true });
    ev.target.releasePointerCapture(ev.pointerId);
    ev.stopPropagation();
    ev.preventDefault();
};

/******************************************************************************/

function onSvgClicked(ev) {
    // Unpause picker if:
    // - click outside dialog AND
    // - not in preview mode
    if ( dom.cl.has(pickerRoot, 'paused') ) {
        if ( dom.cl.has(pickerRoot, 'preview') === false ) {
            unpausePicker();
        }
        return;
    }
    // Force dialog to always be visible when using a touch-driven device.
    if ( ev.type === 'touch' ) {
        dom.cl.add(pickerRoot, 'show');
    }
    toolOverlay.postMessage({
        what: 'candidatesAtPoint',
        mx: ev.clientX,
        my: ev.clientY,
        broad: ev.ctrlKey,
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
    updateSlider(ev.target.valueAsNumber);
}

function updateSlider(i) {
    qs$('#slider').value = i;
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
    if ( previewCSS !== '' ) {
        toolOverlay.postMessage({ what: 'removeCSS', css: previewCSS });
        previewCSS = '';
    }
    if ( state === false ) { return; }
    previewCSS = `${qs$('textarea').value}{display:none!important;}`;
    toolOverlay.postMessage({ what: 'insertCSS', css: previewCSS });
}

/******************************************************************************/

function onCreateClicked() {
    const selector = qs$('textarea').value;
    if ( isValidSelector(selector) === false ) { return; }
    const css = `${selector}{display:none!important;}`;
    toolOverlay.postMessage({ what: 'insertCSS', css });
    sendMessage({
        what: 'addCSSFilter',
        hostname: filterURL.hostname,
        selector: selector,
    });
    qs$('textarea').value = '';
    dom.cl.remove(dom.root, 'preview');
    updatePreview();
    resetPicker();
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

    filterURL.href = msg.url;

    /* global */selectorPartsDB = new Map(msg.details.partsDB);

    const { listParts } = msg.details;
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

    /* global */sliderParts = msg.details.sliderParts;
    const slider = qs$('#slider');
    const last = sliderParts.length - 1;
    dom.attr(slider, 'max', last);
    dom.attr(slider, 'value', last);
    updateSlider(last);
}

/******************************************************************************/

function highlightCandidate() {
    const selector = qs$('textarea').value;
    if ( isValidSelector(selector) === false ) {
        toolOverlay.postMessage({ what: 'unhighlight' });
        updateElementCount({ count: 0, error: isValidSelector.error });
        return;
    }
    toolOverlay.postMessage({
        what: 'highlightFromSelector',
        selector,
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
    dom.cl.add(pickerRoot, 'paused');
    dom.cl.remove(pickerRoot, 'minimized');
    toolOverlay.highlightElementUnderMouse(false);
}

function unpausePicker() {
    dom.cl.remove(pickerRoot, 'paused', 'preview');
    updatePreview();
    toolOverlay.postMessage({
        what: 'togglePreview',
        state: false,
    });
    toolOverlay.highlightElementUnderMouse(true);
}

/******************************************************************************/

function startPicker() {
    toolOverlay.postMessage({ what: 'startPicker' });

    localRead('picker.view').then(value => {
        if ( Boolean(value) === false ) { return; }
        toggleView(value);
    });

    self.addEventListener('keydown', onKeyPressed, true);
    dom.on('svg#overlay', 'click', onSvgClicked);
    dom.on('svg#overlay', 'touchstart', onSvgTouch, { passive: true });
    dom.on('svg#overlay', 'touchend', onSvgTouch);
    dom.on('#minimize', 'click', onMinimizeClicked);
    dom.on('#move', 'pointerdown', moveDialog);
    dom.on('textarea', 'input', onFilterTextChanged);
    dom.on('#quit', 'click', quitPicker);
    dom.on('#slider', 'input', onSliderChanged);
    dom.on('#pick', 'click', resetPicker);
    dom.on('#preview', 'click', onPreviewClicked);
    dom.on('#moreOrLess > span:first-of-type', 'click', ( ) => { onViewToggled(1); });
    dom.on('#moreOrLess > span:last-of-type', 'click', ( ) => { onViewToggled(-1); });
    dom.on('#create', 'click', onCreateClicked);
    dom.on('#candidateFilters ul', 'click', onCandidateClicked);
    toolOverlay.highlightElementUnderMouse(true);
}

/******************************************************************************/

function quitPicker() {
    updatePreview(false);
    toolOverlay.highlightElementUnderMouse(false);
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
    case 'countFromSelector':
        updateElementCount(msg);
        break;
    case 'showDialog':
        showDialog(msg);
        break;
    case 'svgPaths': {
        let { ocean, islands } = msg;
        ocean += islands;
        svgOcean.setAttribute('d', ocean);
        svgIslands.setAttribute('d', islands || NoPaths);
        break;
    }
    default:
        break;
    }
}

/******************************************************************************/

// Wait for the content script to establish communication
toolOverlay.start(onMessage);

/******************************************************************************/

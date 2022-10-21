/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-present Raymond Hill

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

/* global CodeMirror */

'use strict';

/******************************************************************************/

import './codemirror/ubo-static-filtering.js';

import { hostnameFromURI } from './uri-utils.js';
import { StaticFilteringParser } from './static-filtering-parser.js';

/******************************************************************************/
/******************************************************************************/

(( ) => {

/******************************************************************************/

if ( typeof vAPI !== 'object' ) { return; }

const $id = id => document.getElementById(id);
const $stor = selector => document.querySelector(selector);
const $storAll = selector => document.querySelectorAll(selector);

const pickerRoot = document.documentElement;
const dialog = $stor('aside');
let staticFilteringParser;

const svgRoot = $stor('svg');
const svgOcean = svgRoot.children[0];
const svgIslands = svgRoot.children[1];
const NoPaths = 'M0 0';

const reCosmeticAnchor = /^#[$?]?#/;

const epickerId = (( ) => {
    const url = new URL(self.location.href);
    if ( url.searchParams.has('zap') ) {
        pickerRoot.classList.add('zap');
    }
    return url.searchParams.get('epid');
})();
if ( epickerId === null ) { return; }

const docURL = new URL(vAPI.getURL(''));

let epickerConnectionId;
let resultsetOpt;

let netFilterCandidates = [];
let cosmeticFilterCandidates = [];
let computedCandidateSlot = 0;
let computedCandidate = '';
const computedSpecificityCandidates = new Map();
let needBody = false;

/******************************************************************************/

const cmEditor = new CodeMirror(document.querySelector('.codeMirrorContainer'), {
    autoCloseBrackets: true,
    autofocus: true,
    extraKeys: {
        'Ctrl-Space': 'autocomplete',
    },
    lineWrapping: true,
    matchBrackets: true,
    maxScanLines: 1,
});

vAPI.messaging.send('dashboard', {
    what: 'getAutoCompleteDetails'
}).then(response => {
    // For unknown reasons, `instanceof Object` does not work here in Firefox.
    if ( typeof response !== 'object' ) { return; }
    const mode = cmEditor.getMode();
    if ( mode.setHints instanceof Function ) {
        mode.setHints(response);
    }
});

/******************************************************************************/

const rawFilterFromTextarea = function() {
    const text = cmEditor.getValue();
    const pos = text.indexOf('\n');
    return pos === -1 ? text : text.slice(0, pos);
};

/******************************************************************************/

const filterFromTextarea = function() {
    const filter = rawFilterFromTextarea();
    if ( filter === '' ) { return ''; }
    const sfp = staticFilteringParser;
    sfp.analyze(filter);
    sfp.analyzeExtra();
    if (
        sfp.category !== sfp.CATStaticExtFilter &&
        sfp.category !== sfp.CATStaticNetFilter ||
        sfp.shouldDiscard()
    ) {
        return '!';
    }
    return filter;
};

/******************************************************************************/

const renderRange = function(id, value, invert = false) {
    const input = $stor(`#${id} input`);
    const max = parseInt(input.max, 10);
    if ( typeof value !== 'number'  ) {
        value = parseInt(input.value, 10);
    }
    if ( invert ) {
        value = max - value;
    }
    input.value = value;
    const slider = $stor(`#${id} > span`);
    const lside = slider.children[0];
    const thumb = slider.children[1];
    const sliderWidth = slider.offsetWidth;
    const maxPercent = (sliderWidth - thumb.offsetWidth) / sliderWidth * 100;
    const widthPercent = value / max * maxPercent;
    lside.style.width = `${widthPercent}%`;
};

/******************************************************************************/

const userFilterFromCandidate = function(filter) {
    if ( filter === '' || filter === '!' ) { return; }

    const hn = hostnameFromURI(docURL.href);

    // Cosmetic filter?
    if ( reCosmeticAnchor.test(filter) ) {
        return hn + filter;
    }

    // Assume net filter
    const opts = [];

    // If no domain included in filter, we need domain option
    if ( filter.startsWith('||') === false ) {
        opts.push(`domain=${hn}`);
    }

    if ( resultsetOpt !== undefined ) {
        opts.push(resultsetOpt);
    }

    if ( opts.length ) {
        filter += '$' + opts.join(',');
    }

    return filter;
};

/******************************************************************************/

const candidateFromFilterChoice = function(filterChoice) {
    let { slot, filters } = filterChoice;
    let filter = filters[slot];

    // https://github.com/uBlockOrigin/uBlock-issues/issues/47
    for ( const elem of $storAll('#candidateFilters li') ) {
        elem.classList.remove('active');
    }

    computedCandidateSlot = slot;
    computedCandidate = '';

    if ( filter === undefined ) { return ''; }

    // For net filters there no such thing as a path
    if ( filter.startsWith('##') === false ) {
        $stor(`#netFilters li:nth-of-type(${slot+1})`)
            .classList.add('active');
        return filter;
    }

    // At this point, we have a cosmetic filter

    $stor(`#cosmeticFilters li:nth-of-type(${slot+1})`)
        .classList.add('active');

    return cosmeticCandidatesFromFilterChoice(filterChoice);
};

/******************************************************************************/

const cosmeticCandidatesFromFilterChoice = function(filterChoice) {
    let { slot, filters } = filterChoice;

    renderRange('resultsetDepth', slot, true);
    renderRange('resultsetSpecificity');

    if ( computedSpecificityCandidates.has(slot) ) {
        onCandidatesOptimized({ slot });
        return;
    }

    const specificities = [
        0b0000,  // remove hierarchy; remove id, nth-of-type, attribute values
        0b0010,  // remove hierarchy; remove id, nth-of-type
        0b0011,  // remove hierarchy
        0b1000,  // trim hierarchy; remove id, nth-of-type, attribute values
        0b1010,  // trim hierarchy; remove id, nth-of-type
        0b1100,  // remove id, nth-of-type, attribute values
        0b1110,  // remove id, nth-of-type
        0b1111,  // keep all = most specific
    ];

    const candidates = [];

    let filter = filters[slot];

    for ( const specificity of specificities ) {
        // Return path: the target element, then all siblings prepended
        const paths = [];
        for ( let i = slot; i < filters.length; i++ ) {
            filter = filters[i].slice(2);
            // Remove id, nth-of-type
            // https://github.com/uBlockOrigin/uBlock-issues/issues/162
            //   Mind escaped periods: they do not denote a class identifier.
            if ( (specificity & 0b0001) === 0 ) {
                filter = filter.replace(/:nth-of-type\(\d+\)/, '');
                if (
                    filter.charAt(0) === '#' && (
                        (specificity & 0b1000) === 0 || i === slot
                    )
                ) {
                    const pos = filter.search(/[^\\]\./);
                    if ( pos !== -1 ) {
                        filter = filter.slice(pos + 1);
                    }
                }
            }
            // Remove attribute values.
            if ( (specificity & 0b0010) === 0 ) {
                const match = /^\[([^^*$=]+)[\^*$]?=.+\]$/.exec(filter);
                if ( match !== null ) {
                    filter = `[${match[1]}]`;
                }
            }
            // Remove all classes when an id exists.
            // https://github.com/uBlockOrigin/uBlock-issues/issues/162
            //   Mind escaped periods: they do not denote a class identifier.
            if ( filter.charAt(0) === '#' ) {
                filter = filter.replace(/([^\\])\..+$/, '$1');
            }
            if ( paths.length !== 0 ) {
                filter += ' > ';
            }
            paths.unshift(filter);
            // Stop at any element with an id: these are unique in a web page
            if ( (specificity & 0b1000) === 0 || filter.startsWith('#') ) {
                break;
            }
        }

        // Trim hierarchy: remove generic elements from path
        if ( (specificity & 0b1100) === 0b1000 ) {
            let i = 0;
            while ( i < paths.length - 1 ) {
                if ( /^[a-z0-9]+ > $/.test(paths[i+1]) ) {
                    if ( paths[i].endsWith(' > ') ) {
                        paths[i] = paths[i].slice(0, -2);
                    }
                    paths.splice(i + 1, 1);
                } else {
                    i += 1;
                }
            }
        }

        if (
            needBody &&
            paths.length !== 0 &&
            paths[0].startsWith('#') === false &&
            paths[0].startsWith('body ') === false &&
            (specificity & 0b1100) !== 0
        ) {
            paths.unshift('body > ');
        }

        candidates.push(paths);
    }

    vAPI.MessagingConnection.sendTo(epickerConnectionId, {
        what: 'optimizeCandidates',
        candidates,
        slot,
    });
};

/******************************************************************************/

const onCandidatesOptimized = function(details) {
    $id('resultsetModifiers').classList.remove('hide');
    const i = parseInt($stor('#resultsetSpecificity input').value, 10);
    if ( Array.isArray(details.candidates) ) {
        computedSpecificityCandidates.set(details.slot, details.candidates);
    }
    const candidates = computedSpecificityCandidates.get(details.slot);
    computedCandidate = candidates[i];
    cmEditor.setValue(computedCandidate);
    cmEditor.clearHistory();
    onCandidateChanged();
};

/******************************************************************************/

const onSvgClicked = function(ev) {
    // If zap mode, highlight element under mouse, this makes the zapper usable
    // on touch screens.
    if ( pickerRoot.classList.contains('zap') ) {
        vAPI.MessagingConnection.sendTo(epickerConnectionId, {
            what: 'zapElementAtPoint',
            mx: ev.clientX,
            my: ev.clientY,
            options: {
                stay: ev.shiftKey || ev.type === 'touch',
                highlight: ev.target !== svgIslands,
            },
        });
        return;
    }
    // https://github.com/chrisaljoudi/uBlock/issues/810#issuecomment-74600694
    // Unpause picker if:
    // - click outside dialog AND
    // - not in preview mode
    if ( pickerRoot.classList.contains('paused') ) {
        if ( pickerRoot.classList.contains('preview') === false ) {
            unpausePicker();
        }
        return;
    }
    // Force dialog to always be visible when using a touch-driven device.
    if ( ev.type === 'touch' ) {
        pickerRoot.classList.add('show');
    }
    vAPI.MessagingConnection.sendTo(epickerConnectionId, {
        what: 'filterElementAtPoint',
        mx: ev.clientX,
        my: ev.clientY,
        broad: ev.ctrlKey,
    });
};

/*******************************************************************************

    Swipe right:
        If picker not paused: quit picker
        If picker paused and dialog visible: hide dialog
        If picker paused and dialog not visible: quit picker

    Swipe left:
        If picker paused and dialog not visible: show dialog

*/

const onSvgTouch = (( ) => {
    let startX = 0, startY = 0;
    let t0 = 0;
    return ev => {
        if ( ev.type === 'touchstart' ) {
            startX = ev.touches[0].screenX;
            startY = ev.touches[0].screenY;
            t0 = ev.timeStamp;
            return;
        }
        if ( startX === undefined ) { return; }
        const stopX = ev.changedTouches[0].screenX;
        const stopY = ev.changedTouches[0].screenY;
        const angle = Math.abs(Math.atan2(stopY - startY, stopX - startX));
        const distance = Math.sqrt(
            Math.pow(stopX - startX, 2),
            Math.pow(stopY - startY, 2)
        );
        // Interpret touch events as a tap if:
        // - Swipe is not valid; and
        // - The time between start and stop was less than 200ms.
        const duration = ev.timeStamp - t0;
        if ( distance < 32 && duration < 200 ) {
            onSvgClicked({
                type: 'touch',
                target: ev.target,
                clientX: ev.changedTouches[0].pageX,
                clientY: ev.changedTouches[0].pageY,
            });
            ev.preventDefault();
            return;
        }
        if ( distance < 64 ) { return; }
        const angleUpperBound = Math.PI * 0.25 * 0.5;
        const swipeRight = angle < angleUpperBound;
        if ( swipeRight === false && angle < Math.PI - angleUpperBound ) {
            return;
        }
        if ( ev.cancelable ) {
            ev.preventDefault();
        }
        // Swipe left.
        if ( swipeRight === false ) {
            if ( pickerRoot.classList.contains('paused') ) {
                pickerRoot.classList.remove('hide');
                pickerRoot.classList.add('show');
            }
            return;
        }
        // Swipe right.
        if (
            pickerRoot.classList.contains('zap') &&
            svgIslands.getAttribute('d') !== NoPaths
        ) {
            vAPI.MessagingConnection.sendTo(epickerConnectionId, {
                what: 'unhighlight'
            });
            return;
        }
        else if (
            pickerRoot.classList.contains('paused') &&
            pickerRoot.classList.contains('show')
        ) {
            pickerRoot.classList.remove('show');
            pickerRoot.classList.add('hide');
            return;
        }
        quitPicker();
    };
})();

/******************************************************************************/

const onCandidateChanged = function() {
    const filter = filterFromTextarea();
    const bad = filter === '!';
    $stor('section').classList.toggle('invalidFilter', bad);
    if ( bad ) {
        $id('resultsetCount').textContent = 'E';
        $id('create').setAttribute('disabled', '');
    }
    const text = rawFilterFromTextarea();
    $id('resultsetModifiers').classList.toggle(
        'hide', text === '' || text !== computedCandidate
    );
    vAPI.MessagingConnection.sendTo(epickerConnectionId, {
        what: 'dialogSetFilter',
        filter,
        compiled: reCosmeticAnchor.test(filter)
            ? staticFilteringParser.result.compiled
            : undefined,
    });
};

/******************************************************************************/

const onPreviewClicked = function() {
    const state = pickerRoot.classList.toggle('preview');
    vAPI.MessagingConnection.sendTo(epickerConnectionId, {
        what: 'togglePreview',
        state,
    });
};

/******************************************************************************/

const onCreateClicked = function() {
    const candidate = filterFromTextarea();
    const filter = userFilterFromCandidate(candidate);
    if ( filter !== undefined ) {
        vAPI.messaging.send('elementPicker', {
            what: 'createUserFilter',
            autoComment: true,
            filters: filter,
            docURL: docURL.href,
            killCache: reCosmeticAnchor.test(candidate) === false,
        });
    }
    vAPI.MessagingConnection.sendTo(epickerConnectionId, {
        what: 'dialogCreate',
        filter: candidate,
        compiled: reCosmeticAnchor.test(candidate)
            ? staticFilteringParser.result.compiled
            : undefined,
    });
};

/******************************************************************************/

const onPickClicked = function() {
    unpausePicker();
};

/******************************************************************************/

const onQuitClicked = function() {
    quitPicker();
};

/******************************************************************************/

const onDepthChanged = function() {
    const input = $stor('#resultsetDepth input');
    const max = parseInt(input.max, 10);
    const value = parseInt(input.value, 10);
    const text = candidateFromFilterChoice({
        filters: cosmeticFilterCandidates,
        slot: max - value,
    });
    if ( text === undefined ) { return; }
    cmEditor.setValue(text);
    cmEditor.clearHistory();
    onCandidateChanged();
};

/******************************************************************************/

const onSpecificityChanged = function() {
    renderRange('resultsetSpecificity');
    if ( rawFilterFromTextarea() !== computedCandidate ) { return; }
    const depthInput = $stor('#resultsetDepth input');
    const slot = parseInt(depthInput.max, 10) - parseInt(depthInput.value, 10);
    const i = parseInt($stor('#resultsetSpecificity input').value, 10);
    const candidates = computedSpecificityCandidates.get(slot);
    computedCandidate = candidates[i];
    cmEditor.setValue(computedCandidate);
    cmEditor.clearHistory();
    onCandidateChanged();
};

/******************************************************************************/

const onCandidateClicked = function(ev) {
    let li = ev.target.closest('li');
    if ( li === null ) { return; }
    const ul = li.closest('.changeFilter');
    if ( ul === null ) { return; }
    const choice = {
        filters: Array.from(ul.querySelectorAll('li')).map(a => a.textContent),
        slot: 0,
    };
    while ( li.previousElementSibling !== null ) {
        li = li.previousElementSibling;
        choice.slot += 1;
    }
    const text = candidateFromFilterChoice(choice);
    if ( text === undefined ) { return; }
    cmEditor.setValue(text);
    cmEditor.clearHistory();
    onCandidateChanged();
};

/******************************************************************************/

const onKeyPressed = function(ev) {
    // Delete
    if (
        (ev.key === 'Delete' || ev.key === 'Backspace') &&
        pickerRoot.classList.contains('zap')
    ) {
        vAPI.MessagingConnection.sendTo(epickerConnectionId, {
            what: 'zapElementAtPoint',
            options: { stay: true },
        });
        return;
    }
    // Esc
    if ( ev.key === 'Escape' || ev.which === 27 ) {
        onQuitClicked();
        return;
    }
};

/******************************************************************************/

const onStartMoving = (( ) => {
    let isTouch = false;
    let mx0 = 0, my0 = 0;
    let mx1 = 0, my1 = 0;
    let r0 = 0, b0 = 0;
    let rMax = 0, bMax = 0;
    let timer;

    const move = ( ) => {
        timer = undefined;
        const r1 = Math.min(Math.max(r0 - mx1 + mx0, 2), rMax);
        const b1 = Math.min(Math.max(b0 - my1 + my0, 2), bMax);
        dialog.style.setProperty('right', `${r1}px`);
        dialog.style.setProperty('bottom', `${b1}px`);
    };

    const moveAsync = ev => {
        if ( timer !== undefined ) { return; }
        if ( isTouch ) {
            const touch = ev.touches[0];
            mx1 = touch.pageX;
            my1 = touch.pageY;
        } else {
            mx1 = ev.pageX;
            my1 = ev.pageY;
        }
        timer = self.requestAnimationFrame(move);
    };

    const stop = ev => {
        if ( dialog.classList.contains('moving') === false ) { return; }
        dialog.classList.remove('moving');
        if ( isTouch ) {
            self.removeEventListener('touchmove', moveAsync, { capture: true });
        } else {
            self.removeEventListener('mousemove', moveAsync, { capture: true });
        }
        eatEvent(ev);
    };

    return function(ev) {
        const target = dialog.querySelector('#move');
        if ( ev.target !== target ) { return; }
        if ( dialog.classList.contains('moving') ) { return; }
        isTouch = ev.type.startsWith('touch');
        if ( isTouch ) {
            const touch = ev.touches[0];
            mx0 = touch.pageX;
            my0 = touch.pageY;
        } else {
            mx0 = ev.pageX;
            my0 = ev.pageY;
        }
        const style = self.getComputedStyle(dialog);
        r0 = parseInt(style.right, 10);
        b0 = parseInt(style.bottom, 10);
        const rect = dialog.getBoundingClientRect();
        rMax = pickerRoot.clientWidth - 2 - rect.width ;
        bMax = pickerRoot.clientHeight - 2 - rect.height;
        dialog.classList.add('moving');
        if ( isTouch ) {
            self.addEventListener('touchmove', moveAsync, { capture: true });
            self.addEventListener('touchend', stop, { capture: true, once: true });
        } else {
            self.addEventListener('mousemove', moveAsync, { capture: true });
            self.addEventListener('mouseup', stop, { capture: true, once: true });
        }
        eatEvent(ev);
    };
})();

/******************************************************************************/

const svgListening = (( ) => {
    let on = false;
    let timer;
    let mx = 0, my = 0;

    const onTimer = ( ) => {
        timer = undefined;
        vAPI.MessagingConnection.sendTo(epickerConnectionId, {
            what: 'highlightElementAtPoint',
            mx,
            my,
        });
    };

    const onHover = ev => {
        mx = ev.clientX;
        my = ev.clientY;
        if ( timer === undefined ) {
            timer = self.requestAnimationFrame(onTimer);
        }
    };

    return state => {
        if ( state === on ) { return; }
        on = state;
        if ( on ) {
            document.addEventListener('mousemove', onHover, { passive: true });
            return;
        }
        document.removeEventListener('mousemove', onHover, { passive: true });
        if ( timer !== undefined ) {
            self.cancelAnimationFrame(timer);
            timer = undefined;
        }
    };
})();

/******************************************************************************/

const eatEvent = function(ev) {
    ev.stopPropagation();
    ev.preventDefault();
};

/******************************************************************************/

// Create lists of candidate filters. This takes into account whether the
// current mode is narrow or broad.

const populateCandidates = function(candidates, selector) {
    
    const root = dialog.querySelector(selector);
    const ul = root.querySelector('ul');
    while ( ul.firstChild !== null ) {
        ul.firstChild.remove();
    }
    for ( let i = 0; i < candidates.length; i++ ) {
        const li = document.createElement('li');
        li.textContent = candidates[i];
        ul.appendChild(li);
    }
    if ( candidates.length !== 0 ) {
        root.style.removeProperty('display');
    } else {
        root.style.setProperty('display', 'none');
    }
};

/******************************************************************************/

const showDialog = function(details) {
    pausePicker();

    const { netFilters, cosmeticFilters, filter } = details;

    netFilterCandidates = netFilters;

    needBody  =
        cosmeticFilters.length !== 0 &&
        cosmeticFilters[cosmeticFilters.length - 1] === '##body';
    if ( needBody ) {
        cosmeticFilters.pop();
    }
    cosmeticFilterCandidates = cosmeticFilters;

    docURL.href = details.url;

    populateCandidates(netFilters, '#netFilters');
    populateCandidates(cosmeticFilters, '#cosmeticFilters');
    computedSpecificityCandidates.clear();

    const depthInput = $stor('#resultsetDepth input');
    depthInput.max = cosmeticFilters.length - 1;
    depthInput.value = depthInput.max;

    dialog.querySelector('ul').style.display =
        netFilters.length || cosmeticFilters.length ? '' : 'none';
    $id('create').setAttribute('disabled', '');

    // Auto-select a candidate filter

    // 2020-09-01:
    //   In Firefox, `details instanceof Object` resolves to `false` despite
    //   `details` being a valid object. Consequently, falling back to use
    //   `typeof details`.
    //   This is an issue which surfaced when the element picker code was
    //   revisited to isolate the picker dialog DOM from the page DOM.
    if ( typeof filter !== 'object' || filter === null ) {
        cmEditor.setValue('');
        return;
    }

    const filterChoice = {
        filters: filter.filters,
        slot: filter.slot,
    };

    const text = candidateFromFilterChoice(filterChoice);
    if ( text === undefined ) { return; }
    cmEditor.setValue(text);
    onCandidateChanged();
};

/******************************************************************************/

const pausePicker = function() {
    pickerRoot.classList.add('paused');
    svgListening(false);
};

/******************************************************************************/

const unpausePicker = function() {
    pickerRoot.classList.remove('paused', 'preview');
    vAPI.MessagingConnection.sendTo(epickerConnectionId, {
        what: 'togglePreview',
        state: false,
    });
    svgListening(true);
};

/******************************************************************************/

const startPicker = function() {
    self.addEventListener('keydown', onKeyPressed, true);
    const svg = $stor('svg');
    svg.addEventListener('click', onSvgClicked);
    svg.addEventListener('touchstart', onSvgTouch);
    svg.addEventListener('touchend', onSvgTouch);

    unpausePicker();

    if ( pickerRoot.classList.contains('zap') ) { return; }

    cmEditor.on('changes', onCandidateChanged);

    $id('preview').addEventListener('click', onPreviewClicked);
    $id('create').addEventListener('click', onCreateClicked);
    $id('pick').addEventListener('click', onPickClicked);
    $id('quit').addEventListener('click', onQuitClicked);
    $id('move').addEventListener('mousedown', onStartMoving);
    $id('move').addEventListener('touchstart', onStartMoving);
    $id('candidateFilters').addEventListener('click', onCandidateClicked);
    $stor('#resultsetDepth input').addEventListener('input', onDepthChanged);
    $stor('#resultsetSpecificity input').addEventListener('input', onSpecificityChanged);
    staticFilteringParser = new StaticFilteringParser({
        interactive: true,
        nativeCssHas: vAPI.webextFlavor.env.includes('native_css_has'),
    });
};

/******************************************************************************/

const quitPicker = function() {
    vAPI.MessagingConnection.sendTo(epickerConnectionId, { what: 'quitPicker' });
    vAPI.MessagingConnection.disconnectFrom(epickerConnectionId);
};

/******************************************************************************/

const onPickerMessage = function(msg) {
    switch ( msg.what ) {
        case 'candidatesOptimized':
            onCandidatesOptimized(msg);
            break;
        case 'showDialog':
            showDialog(msg);
            break;
        case 'resultsetDetails': {
            resultsetOpt = msg.opt;
            $id('resultsetCount').textContent = msg.count;
            if ( msg.count !== 0 ) {
                $id('create').removeAttribute('disabled');
            } else {
                $id('create').setAttribute('disabled', '');
            }
            break;
        }
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
};

/******************************************************************************/

const onConnectionMessage = function(msg) {
    switch ( msg.what ) {
        case 'connectionBroken':
            break;
        case 'connectionMessage':
            onPickerMessage(msg.payload);
            break;
        case 'connectionAccepted':
            epickerConnectionId = msg.id;
            startPicker();
            vAPI.MessagingConnection.sendTo(epickerConnectionId, {
                what: 'start',
            });
            break;
    }
};

vAPI.MessagingConnection.connectTo(
    `epickerDialog-${epickerId}`,
    `epicker-${epickerId}`,
    onConnectionMessage
);

/******************************************************************************/

})();








/*******************************************************************************

    DO NOT:
    - Remove the following code
    - Add code beyond the following code
    Reason:
    - https://github.com/gorhill/uBlock/pull/3721
    - uBO never uses the return value from injected content scripts

**/

void 0;

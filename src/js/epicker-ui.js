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

'use strict';

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
const taCandidate = $stor('textarea');
let staticFilteringParser;

const svgRoot = $stor('svg');
const svgOcean = svgRoot.children[0];
const svgIslands = svgRoot.children[1];
const NoPaths = 'M0 0';

const epickerId = (( ) => {
    const url = new URL(self.location.href);
    if ( url.searchParams.has('zap') ) {
        pickerRoot.classList.add('zap');
    }
    return url.searchParams.get('epid');
})();
if ( epickerId === null ) { return; }

let epickerConnectionId;
let filterHostname = '';
let filterOrigin = '';
let resultsetOpt;

/******************************************************************************/

const filterFromTextarea = function() {
    const s = taCandidate.value.trim();
    if ( s === '' ) { return ''; }
    const pos = s.indexOf('\n');
    const filter = pos === -1 ? s.trim() : s.slice(0, pos).trim();
    staticFilteringParser.analyze(filter);
    staticFilteringParser.analyzeExtra();
    return staticFilteringParser.shouldDiscard() ? '!' : filter;
};

/******************************************************************************/

const userFilterFromCandidate = function(filter) {
    if ( filter === '' || filter === '!' ) { return; }

    // Cosmetic filter?
    if ( filter.startsWith('##') ) {
        return filterHostname + filter;
    }

    // Assume net filter
    const opts = [];

    // If no domain included in filter, we need domain option
    if ( filter.startsWith('||') === false ) {
        opts.push(`domain=${filterHostname}`);
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

    // Modifier means "target broadly". Hence:
    // - Do not compute exact path.
    // - Discard narrowing directives.
    // - Remove the id if one or more classes exist
    //   TODO: should remove tag name too? ¯\_(ツ)_/¯
    if ( filterChoice.broad ) {
        filter = filter.replace(/:nth-of-type\(\d+\)/, '');
        // https://github.com/uBlockOrigin/uBlock-issues/issues/162
        //   Mind escaped periods: they do not denote a class identifier.
        if ( filter.charAt(2) === '#' ) {
            const pos = filter.search(/[^\\]\./);
            if ( pos !== -1 ) {
                filter = '##' + filter.slice(pos + 1);
            }
        }
        return filter;
    }

    // Return path: the target element, then all siblings prepended
    let selector = '', joiner = '';
    for ( ; slot < filters.length; slot++ ) {
        filter = filters[slot];
        // Remove all classes when an id exists.
        // https://github.com/uBlockOrigin/uBlock-issues/issues/162
        //   Mind escaped periods: they do not denote a class identifier.
        if ( filter.charAt(2) === '#' ) {
            filter = filter.replace(/([^\\])\..+$/, '$1');
        }
        selector = filter.slice(2) + joiner + selector;
        // Stop at any element with an id: these are unique in a web page
        if ( filter.startsWith('###') ) { break; }
        // Stop if current selector matches only one element on the page
        if ( document.querySelectorAll(selector).length === 1 ) { break; }
        joiner = ' > ';
    }

    // https://github.com/gorhill/uBlock/issues/2519
    // https://github.com/uBlockOrigin/uBlock-issues/issues/17
    if (
        slot === filters.length &&
        selector.startsWith('body > ') === false &&
        document.querySelectorAll(selector).length > 1
    ) {
        selector = 'body > ' + selector;
    }

    return '##' + selector;
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
        if ( ev.cancelable === false ) { return; }
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
        ev.preventDefault();
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
    $id('create').disabled = bad;
    if ( bad ) {
        $id('resultsetCount').textContent = 'E';
        $id('create').setAttribute('disabled', '');
    }
    vAPI.MessagingConnection.sendTo(epickerConnectionId, {
        what: 'dialogSetFilter',
        filter,
        compiled: filter.startsWith('##')
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
            origin: filterOrigin,
            pageDomain: filterHostname,
            killCache: /^#[$?]?#/.test(candidate) === false,
        });
    }
    vAPI.MessagingConnection.sendTo(epickerConnectionId, {
        what: 'dialogCreate',
        filter: candidate,
        compiled: candidate.startsWith('##')
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

const onCandidateClicked = function(ev) {
    let li = ev.target.closest('li');
    if ( li === null ) { return; }
    const ul = li.closest('.changeFilter');
    if ( ul === null ) { return; }
    const choice = {
        filters: Array.from(ul.querySelectorAll('li')).map(a => a.textContent),
        slot: 0,
        broad: ev.ctrlKey || ev.metaKey
    };
    while ( li.previousElementSibling !== null ) {
        li = li.previousElementSibling;
        choice.slot += 1;
    }
    taCandidate.value = candidateFromFilterChoice(choice);
    onCandidateChanged();
};

/******************************************************************************/

const onKeyPressed = function(ev) {
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
        let r1 = Math.min(Math.max(r0 - mx1 + mx0, 4), rMax);
        let b1 = Math.min(Math.max(b0 - my1 + my0, 4), bMax);
        dialog.style.setProperty('right', `${r1}px`, 'important');
        dialog.style.setProperty('bottom', `${b1}px`, 'important');
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
        const target = dialog.querySelector('#toolbar');
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
        rMax = pickerRoot.clientWidth - 4 - rect.width ;
        bMax = pickerRoot.clientHeight - 4 - rect.height;
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

const showDialog = function(details) {
    pausePicker();

    const { netFilters, cosmeticFilters, filter, options = {} } = details;

    // https://github.com/gorhill/uBlock/issues/738
    //   Trim dots.
    filterHostname = details.hostname;
    if ( filterHostname.slice(-1) === '.' ) {
        filterHostname = filterHostname.slice(0, -1);
    }
    filterOrigin = details.origin;

    // Create lists of candidate filters
    const populate = function(src, des) {
        const root = dialog.querySelector(des);
        const ul = root.querySelector('ul');
        while ( ul.firstChild !== null ) {
            ul.firstChild.remove();
        }
        for ( let i = 0; i < src.length; i++ ) {
            const li = document.createElement('li');
            li.textContent = src[i];
            ul.appendChild(li);
        }
        if ( src.length !== 0 ) {
            root.style.removeProperty('display');
        } else {
            root.style.setProperty('display', 'none', 'important');
        }
    };

    populate(netFilters, '#netFilters');
    populate(cosmeticFilters, '#cosmeticFilters');

    dialog.querySelector('ul').style.display =
        netFilters.length || cosmeticFilters.length ? '' : 'none';
    dialog.querySelector('#create').disabled = true;

    // Auto-select a candidate filter

    // 2020-09-01:
    //   In Firefox, `details instanceof Object` resolves to `false` despite
    //   `details` being a valid object. Consequently, falling back to use
    //   `typeof details`.
    //   This is an issue which surfaced when the element picker code was
    //   revisited to isolate the picker dialog DOM from the page DOM.
    if ( typeof filter !== 'object' || filter === null ) {
        taCandidate.value = '';
        return;
    }

    const filterChoice = {
        filters: filter.filters,
        slot: filter.slot,
        broad: options.broad || false
    };

    taCandidate.value = candidateFromFilterChoice(filterChoice);
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

    taCandidate.addEventListener('input', onCandidateChanged);
    $id('preview').addEventListener('click', onPreviewClicked);
    $id('create').addEventListener('click', onCreateClicked);
    $id('pick').addEventListener('click', onPickClicked);
    $id('quit').addEventListener('click', onQuitClicked);
    $id('candidateFilters').addEventListener('click', onCandidateClicked);
    $id('toolbar').addEventListener('mousedown', onStartMoving);
    $id('toolbar').addEventListener('touchstart', onStartMoving);
    staticFilteringParser = new vAPI.StaticFilteringParser({ interactive: true });
};

/******************************************************************************/

const quitPicker = function() {
    vAPI.MessagingConnection.sendTo(epickerConnectionId, { what: 'quitPicker' });
    vAPI.MessagingConnection.disconnectFrom(epickerConnectionId);
};

/******************************************************************************/

const onPickerMessage = function(msg) {
    switch ( msg.what ) {
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

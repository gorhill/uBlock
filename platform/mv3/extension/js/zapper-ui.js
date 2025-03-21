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

/******************************************************************************/

const $id = id => document.getElementById(id);
const $stor = selector => document.querySelector(selector);

const svgRoot = $stor('svg#sea');
const svgOcean = svgRoot.children[0];
const svgIslands = svgRoot.children[1];
const NoPaths = 'M0 0';

let zapperScriptPort;

/******************************************************************************/

const onSvgClicked = function(ev) {
    // If zap mode, highlight element under mouse, this makes the zapper usable
    // on touch screens.
    zapperScriptPort.postMessage({
        what: 'zapElementAtPoint',
        mx: ev.clientX,
        my: ev.clientY,
        options: {
            stay: true,
            highlight: ev.target !== svgIslands,
        },
    });
};

/*******************************************************************************

    Swipe right:
        Remove current highlight

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
            Math.pow(stopX - startX, 2) +
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
        if ( swipeRight === false ) { return; }
        if ( ev.cancelable ) {
            ev.preventDefault();
        }
        // Swipe right.
        if ( svgIslands.getAttribute('d') === NoPaths ) { return; }
        zapperScriptPort.postMessage({
            what: 'unhighlight'
        });
    };
})();

/******************************************************************************/

const svgListening = (( ) => {
    let on = false;
    let timer;
    let mx = 0, my = 0;

    const onTimer = ( ) => {
        timer = undefined;
        zapperScriptPort.postMessage({
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

const onKeyPressed = function(ev) {
    // Delete
    if ( ev.key === 'Delete' || ev.key === 'Backspace' ) {
        zapperScriptPort.postMessage({
            what: 'zapElementAtPoint',
            options: { stay: true },
        });
        return;
    }
    // Esc
    if ( ev.key === 'Escape' || ev.which === 27 ) {
        quitZapper();
        return;
    }
};

/******************************************************************************/

const onScriptMessage = function(msg) {
    switch ( msg.what ) {
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

const startZapper = function(port) {
    zapperScriptPort = port;
    zapperScriptPort.onmessage = ev => {
        onScriptMessage(ev.data || {});
    };
    zapperScriptPort.onmessageerror = ( ) => {
        quitZapper();
    };
    zapperScriptPort.postMessage({ what: 'start' });
    self.addEventListener('keydown', onKeyPressed, true);
    $stor('svg#sea').addEventListener('click', onSvgClicked);
    $stor('svg#sea').addEventListener('touchstart', onSvgTouch, { passive: true });
    $stor('svg#sea').addEventListener('touchend', onSvgTouch);
    $id('quit').addEventListener('click', quitZapper );
    svgListening(true);
};

/******************************************************************************/

const quitZapper = function() {
    self.removeEventListener('keydown', onKeyPressed, true);
    $stor('svg#sea').removeEventListener('click', onSvgClicked);
    $stor('svg#sea').removeEventListener('touchstart', onSvgTouch, { passive: true });
    $stor('svg#sea').removeEventListener('touchend', onSvgTouch);
    $id('quit').removeEventListener('click', quitZapper );
    svgListening(false);
    if ( zapperScriptPort ) {
        zapperScriptPort.postMessage({ what: 'quitZapper' });
        zapperScriptPort.close();
        zapperScriptPort.onmessage = null;
        zapperScriptPort.onmessageerror = null;
        zapperScriptPort = null;
    }
};

/******************************************************************************/

// Wait for the content script to establish communication

globalThis.addEventListener('message', ev => {
    const msg = ev.data || {};
    if ( msg.what !== 'zapperStart' ) { return; }
    if ( Array.isArray(ev.ports) === false ) { return; }
    if ( ev.ports.length === 0 ) { return; }
    startZapper(ev.ports[0]);
}, { once: true });

/******************************************************************************/

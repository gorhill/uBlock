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

/******************************************************************************/

export const toolOverlay = {
    svgRoot: qs$('svg#overlay'),
    svgOcean: qs$('svg#overlay > path'),
    svgIslands: qs$('svg#overlay > path + path'),
    emptyPath: 'M0 0',
    port: null,
    mstrackerOn: false,
    mstrackerTimer: undefined,
    mstrackerX: 0, mstrackerY: 0,

    start(listener) {
        this.listener = listener;
        globalThis.addEventListener('message', ev => {
            const msg = ev.data || {};
            if ( msg.what !== 'startOverlay' ) { return; }
            if ( Array.isArray(ev.ports) === false ) { return; }
            if ( ev.ports.length === 0 ) { return; }
            toolOverlay.port = ev.ports[0];
            toolOverlay.port.onmessage = ev => {
                this.onMessage(ev.data || {});
            };
            toolOverlay.port.onmessageerror = ( ) => {
                this.listener({ what: 'about'});
            };
            listener({ what: 'startTool' });
        }, { once: true });
    },

    stop() {
        if ( this.port ) {
            this.port.postMessage({ what: 'quitTool' });
            this.port.onmessage = null;
            this.port.onmessageerror = null;
            this.port = null;
        }
    },

    onMessage(msg) {
        switch ( msg.what ) {
        case 'svgPaths': {
            let { ocean, islands } = msg;
            ocean += islands;
            this.svgOcean.setAttribute('d', ocean);
            this.svgIslands.setAttribute('d', islands || this.emptyPath);
            break;
        }
        default:
            break;
        }
        this.listener(msg);
    },

    postMessage(msg) {
        if ( Boolean(this.port) === false ) { return; }
        this.port.postMessage(msg);
    },

    highlightElementUnderMouse(state) {
        if ( dom.cl.has(dom.root, 'mobile') ) { return; }
        if ( state === this.mstrackerOn ) { return; }
        this.mstrackerOn = state;
        if ( this.mstrackerOn ) {
            dom.on(document, 'mousemove', this.onHover, { passive: true });
            return;
        }
        dom.off(document, 'mousemove', this.onHover, { passive: true });
        if ( this.mstrackerTimer === undefined ) { return; }
        self.cancelAnimationFrame(this.mstrackerTimer);
        this.mstrackerTimer = undefined;
    },

    onTimer() {
        toolOverlay.mstrackerTimer = undefined;
        toolOverlay.port.postMessage({
            what: 'highlightElementAtPoint',
            mx: toolOverlay.mstrackerX,
            my: toolOverlay.mstrackerY,
        });
    },

    onHover(ev) {
        toolOverlay.mstrackerX = ev.clientX;
        toolOverlay.mstrackerY = ev.clientY;
        if ( toolOverlay.mstrackerTimer !== undefined ) { return; }
        toolOverlay.mstrackerTimer =
            self.requestAnimationFrame(toolOverlay.onTimer);
    },
};

/******************************************************************************/

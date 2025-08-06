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

import { dom, qs$ } from './dom.js';
import { sendMessage } from './ext.js';

/******************************************************************************/

export const toolOverlay = {
    url: new URL('about:blank'),
    svgRoot: qs$('svg#overlay'),
    svgOcean: qs$('svg#overlay > path'),
    svgIslands: qs$('svg#overlay > path + path'),
    emptyPath: 'M0 0',
    port: null,

    start(onmessage) {
        this.onmessage = onmessage;
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
                this.onmessage({ what: 'stopTool' });
            };
            this.moveable = qs$('aside:has(#move)');
            if ( this.moveable !== null ) {
                dom.on('aside #move', 'pointerdown', ev => { this.mover(ev); });
                dom.on('aside #move', 'touchstart', this.eatTouchEvent);
            }
            this.onMessage({ what: 'startTool',
                url: msg.url,
                width: msg.width,
                height: msg.height,
            });
            dom.cl.remove(dom.body, 'loading');
        }, { once: true });
    },

    stop() {
        this.highlightElementUnderMouse(false);
        if ( this.port ) {
            this.port.postMessage({ what: 'quitTool' });
            this.port.onmessage = null;
            this.port.onmessageerror = null;
            this.port = null;
        }
    },

    onMessage(wrapped) {
        // Response to frame-initiated message?
        if ( typeof wrapped?.fromFrameId === 'number' ) {
            const resolve = this.pendingMessages.get(wrapped.fromFrameId);
            if ( resolve ) {
                this.pendingMessages.delete(wrapped.fromFrameId);
                resolve(wrapped.msg);
            }
            return;
        }
        const msg = wrapped.msg || wrapped;
        switch ( msg.what ) {
        case 'startTool': {
            this.url.href = msg.url;
            const ow = msg.width;
            const oh = msg.height;
            this.svgOcean.setAttribute('d', `M0 0h${ow}v${oh}h-${ow}z`);
            break;
        }
        case 'svgPaths':
            this.svgOcean.setAttribute('d', msg.ocean + msg.islands);
            this.svgIslands.setAttribute('d', msg.islands || this.emptyPath);
            break;
        default:
            break;
        }
        const response = this.onmessage && this.onmessage(msg) || undefined;
        // Send response if this is script-initiated message
        if ( wrapped?.fromScriptId && this.port ) {
            const { fromScriptId } = wrapped;
            if ( response instanceof Promise ) {
                response.then(response => {
                    if ( this.port === null ) { return; }
                    this.port.postMessage({ fromScriptId, msg: response });
                });
            } else {
                this.port.postMessage({ fromScriptId, msg: response });
            }
        }
    },
    postMessage(msg) {
        if ( this.port === null ) { return; }
        const wrapped = {
            fromFrameId: this.messageId++,
            msg,
        };
        return new Promise(resolve => {
            this.pendingMessages.set(wrapped.fromFrameId, resolve);
            this.port.postMessage(wrapped);
        });
    },
    messageId: 1,
    pendingMessages: new Map(),

    sendMessage(msg) {
        return sendMessage(msg);
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
        if ( toolOverlay.port === null ) { return; }
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
    mstrackerOn: false,
    mstrackerX: 0, mstrackerY: 0,
    mstrackerTimer: undefined,

    mover(ev) {
        const target = ev.target;
        if ( target.matches('#move') === false ) { return; }
        if ( dom.cl.has(this.moveable, 'moving') ) { return; }
        target.setPointerCapture(ev.pointerId);
        this.moverX0 = ev.pageX;
        this.moverY0 = ev.pageY;
        const rect = this.moveable.getBoundingClientRect();
        this.moverCX0 = rect.x + rect.width / 2;
        this.moverCY0 = rect.y + rect.height / 2;
        dom.cl.add(this.moveable, 'moving');
        self.addEventListener('pointermove', this.moverMoveAsync, {
            passive: true,
            capture: true,
        });
        self.addEventListener('pointerup', this.moverStop, { capture: true, once: true });
        ev.stopPropagation();
        ev.preventDefault();
    },
    moverMove() {
        this.moverTimer = undefined;
        const cx1 = this.moverCX0 + this.moverX1 - this.moverX0;
        const cy1 = this.moverCY0 + this.moverY1 - this.moverY0;
        const rootW = dom.root.clientWidth;
        const rootH = dom.root.clientHeight;
        const moveableW = this.moveable.clientWidth;
        const moveableH = this.moveable.clientHeight;
        if ( cx1 < rootW / 2 ) {
            this.moveable.style.setProperty('left', `${Math.max(cx1-moveableW/2,2)}px`);
            this.moveable.style.removeProperty('right');
        } else {
            this.moveable.style.removeProperty('left');
            this.moveable.style.setProperty('right', `${Math.max(rootW-cx1-moveableW/2,2)}px`);
        }
        if ( cy1 < rootH / 2 ) {
            this.moveable.style.setProperty('top', `${Math.max(cy1-moveableH/2,2)}px`);
            this.moveable.style.removeProperty('bottom');
        } else {
            this.moveable.style.removeProperty('top');
            this.moveable.style.setProperty('bottom', `${Math.max(rootH-cy1-moveableH/2,2)}px`);
        }
    },
    moverMoveAsync(ev) {
        toolOverlay.moverX1 = ev.pageX;
        toolOverlay.moverY1 = ev.pageY;
        if ( toolOverlay.moverTimer !== undefined ) { return; }
        toolOverlay.moverTimer = self.requestAnimationFrame(( ) => {
            toolOverlay.moverMove();
        });
    },
    moverStop(ev) {
        if ( dom.cl.has(toolOverlay.moveable, 'moving') === false ) { return; }
        dom.cl.remove(toolOverlay.moveable, 'moving');
        self.removeEventListener('pointermove', toolOverlay.moverMoveAsync, {
            passive: true,
            capture: true,
        });
        ev.target.releasePointerCapture(ev.pointerId);
        ev.stopPropagation();
        ev.preventDefault();
    },
    eatTouchEvent(ev) {
        if ( ev.target !== qs$('aside #move') ) { return; }
        ev.stopPropagation();
        ev.preventDefault();
    },
    moveable: null,
    moverX0: 0, moverY0: 0,
    moverX1: 0, moverY1: 0,
    moverCX0: 0, moverCY0: 0,
    moverTimer: undefined,
};

/******************************************************************************/

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

(function uBOLOverlay() {

/******************************************************************************/

if ( self.ubolOverlay ) {
    self.ubolOverlay.stop();
    self.ubolOverlay = undefined;
}

self.ubolOverlay = {
    file: '',
    webext: typeof browser === 'object' ? browser : chrome,
    url: new URL(document.baseURI),
    port: null,
    highlightedElements: [],
    secretAttr: (( ) => {
        let secret = String.fromCharCode((Math.random() * 26) + 97);
        do {
            secret += (Math.floor(Math.random() * 2147483647) + 2147483647)
                .toString(36)
                .slice(2);
        } while ( secret.length < 8 );
        return secret;
    })(),

    start() {
        const cssStyle = [
            'background: transparent',
            'border: 0',
            'border-radius: 0',
            'box-shadow: none',
            'color-scheme: light dark',
            'display: block',
            'filter: none',
            'height: 100vh',
            '  height: 100svh',
            'left: 0',
            'margin: 0',
            'max-height: none',
            'max-width: none',
            'min-height: unset',
            'min-width: unset',
            'opacity: 1',
            'outline: 0',
            'padding: 0',
            'pointer-events: auto',
            'position: fixed',
            'top: 0',
            'transform: none',
            'visibility: hidden',
            'width: 100%',
            'z-index: 2147483647',
            ''
        ].join(' !important;\n');
        this.pickerCSS = [
            `:root > [${this.secretAttr}] { ${cssStyle} }`,
            `:root > [${this.secretAttr}-loaded] { visibility: visible !important; }`,
            `:root > [${this.secretAttr}-click] { pointer-events: none !important; }`,
        ].join('\n');
        this.sendMessage({ what: 'insertCSS', css: this.pickerCSS });
        self.addEventListener('scroll', this.onViewportChanged, { passive: true });
        self.addEventListener('resize', this.onViewportChanged, { passive: true });
        self.addEventListener('keydown', this.onKeyPressed, true);
    },

    stop() {
        if ( this.pickerCSS ) {
            this.sendMessage({ what: 'removeCSS', css: this.pickerCSS });
            this.pickerCSS = undefined;
        }
        self.removeEventListener('scroll', this.onViewportChanged, { passive: true });
        self.removeEventListener('resize', this.onViewportChanged, { passive: true });
        self.removeEventListener('keydown', this.onKeyPressed, true);
        if ( this.frame ) {
            this.frame.remove();
            this.frame = null;
        }
        if ( this.port ) {
            this.port.close();
            this.port.onmessage = null;
            this.port.onmessageerror = null;
            this.port = null;
        }
        this.onmessage = null;
        self.ubolOverlay = undefined;
    },

    onViewportChanged() {
        self.ubolOverlay.highlightUpdate();
    },

    onKeyPressed(ev) {
        if ( ev.key !== 'Escape' && ev.which !== 27 ) { return; }
        ev.stopPropagation();
        ev.preventDefault();
        if ( self.ubolOverlay.onmessage ) {
            self.ubolOverlay.onmessage({ what: 'quitTool' });
        }
    },

    sendMessage(msg) {
        try {
            return this.webext.runtime.sendMessage(msg).catch(( ) => { });
        } catch {
        }
    },

    onMessage(wrapped) {
        // Response to script-initiated message?
        if ( typeof wrapped?.fromScriptId === 'number' ) {
            const resolve = this.pendingMessages.get(wrapped.fromScriptId);
            if ( resolve ) {
                this.pendingMessages.delete(wrapped.fromScriptId);
                resolve(wrapped.msg);
            }
            return;
        }
        const onmessage = this.onmessage;
        const msg = wrapped.msg || wrapped;
        let response;
        switch ( msg.what ) {
        case 'startTool':
            this.start();
            break;
        case 'quitTool':
            this.stop();
            break;
        case 'highlightElementAtPoint':
            this.highlightElementAtPoint(msg.mx, msg.my);
            break;
        case 'highlightFromSelector': {
            const { elems, error } = this.elementsFromSelector(msg.selector);
            this.highlightElements(elems);
            if ( msg.scrollTo && elems.length !== 0 ) {
                elems[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
            response = { count: elems.length, error };
            break;
        }
        case 'unhighlight':
            this.unhighlight();
            break;
        }
        response = onmessage && onmessage(msg) || response;
        // Send response if this is frame-initiated message
        if ( wrapped?.fromFrameId && this.port ) {
            const { fromFrameId } = wrapped;
            if ( response instanceof Promise ) {
                response.then(response => {
                    if ( this.port === null ) { return; }
                    this.port.postMessage({ fromFrameId, msg: response });
                });
            } else {
                this.port.postMessage({ fromFrameId, msg: response });
            }
        }
    },
    postMessage(msg) {
        if ( this.port === null ) { return; }
        const wrapped = {
            fromScriptId: this.messageId++,
            msg,
        };
        return new Promise(resolve => {
            this.pendingMessages.set(wrapped.fromScriptId, resolve);
            this.port.postMessage(wrapped);
        });
    },
    messageId: 1,
    pendingMessages: new Map(),

    getElementBoundingClientRect(elem) {
        let rect = typeof elem.getBoundingClientRect === 'function'
            ? elem.getBoundingClientRect()
            : { height: 0, left: 0, top: 0, width: 0 };

        // https://github.com/gorhill/uBlock/issues/1024
        // Try not returning an empty bounding rect.
        if ( rect.width !== 0 && rect.height !== 0 ) {
            return rect;
        }
        if ( elem.shadowRoot instanceof DocumentFragment ) {
            return this.getElementBoundingClientRect(elem.shadowRoot);
        }
        let left = rect.left,
            right = left + rect.width,
            top = rect.top,
            bottom = top + rect.height;
        for ( const child of elem.children ) {
            rect = this.getElementBoundingClientRect(child);
            if ( rect.width === 0 || rect.height === 0 ) { continue; }
            if ( rect.left < left ) { left = rect.left; }
            if ( rect.right > right ) { right = rect.right; }
            if ( rect.top < top ) { top = rect.top; }
            if ( rect.bottom > bottom ) { bottom = rect.bottom; }
        }
        return {
            left, right,
            top, bottom,
            width: right - left,
            height: bottom - top,
        };
    },

    highlightUpdate() {
        const ow = self.innerWidth;
        const oh = self.innerHeight;
        const islands = [];
        for ( const elem of this.highlightedElements ) {
            const rect = this.getElementBoundingClientRect(elem);
            // Ignore offscreen areas
            if ( rect.left > ow ) { continue; }
            if ( rect.top > oh ) { continue; }
            if ( rect.left + rect.width < 0 ) { continue; }
            if ( rect.top + rect.height < 0 ) { continue; }
            islands.push(
                `M${rect.left} ${rect.top}h${rect.width}v${rect.height}h-${rect.width}z`
            );
        }
        this.port.postMessage({
            what: 'svgPaths',
            ocean: `M0 0h${ow}v${oh}h-${ow}z`,
            islands: islands.join(''),
        });
    },

    highlightElements(iter = []) {
        this.highlightedElements =
            Array.from(iter).filter(a =>
                a instanceof Element && a !== this.frame
            );
        this.highlightUpdate();
    },

    qsa(node, selector) {
        if ( node === null ) { return []; }
        if ( selector.startsWith('{') ) {
            if ( this.proceduralFiltererAPI === undefined ) {
                if ( self.ProceduralFiltererAPI === undefined ) { return []; }
                this.proceduralFiltererAPI = new self.ProceduralFiltererAPI();
            }
            return this.proceduralFiltererAPI.qsa(selector);
        }
        selector = selector.replace(/::[^:]+$/, '');
        try {
            const elems = node.querySelectorAll(selector);
            this.qsa.error = undefined;
            return elems;
        } catch (reason) {
            this.qsa.error = `${reason}`;
        }
        return [];
    },

    elementFromPoint(x, y) {
        if ( x !== undefined ) {
            this.lastX = x; this.lastY = y;
        } else if ( this.lastX !== undefined ) {
            x = this.lastX; y = this.lastY;
        } else {
            return null;
        }
        const magicAttr = `${this.secretAttr}-click`;
        this.frame.setAttribute(magicAttr, '');
        let elem = document.elementFromPoint(x, y);
        if ( elem === document.body || elem === document.documentElement ) {
            elem = null;
        }
        // https://github.com/uBlockOrigin/uBlock-issues/issues/380
        this.frame.removeAttribute(magicAttr);
        return elem;
    },

    elementsFromSelector(selector) {
        const elems = this.qsa(document, selector);
        return { elems, error: this.qsa.error };
    },

    highlightElementAtPoint(x, y) {
        const elem = self.ubolOverlay.elementFromPoint(x, y);
        this.highlightElements([ elem ]);
    },

    unhighlight() {
        this.highlightElements([]);
    },

    async install(file, onmessage) {
        this.file = file;
        const dynamicURL = new URL(this.webext.runtime.getURL(file));
        return new Promise(resolve => {
            const frame = document.createElement('iframe');
            const secretAttr = this.secretAttr;
            frame.setAttribute(secretAttr, '');
            const onLoad = ( ) => {
                frame.onload = null;
                frame.setAttribute(`${secretAttr}-loaded`, '');
                const channel = new MessageChannel();
                const port = channel.port1;
                port.onmessage = ev => {
                    self.ubolOverlay &&
                        self.ubolOverlay.onMessage(ev.data || {})
                };
                port.onmessageerror = ( ) => {
                    self.ubolOverlay &&
                        self.ubolOverlay.onMessage({ what: 'quitTool' })
                };
                const realURL = new URL(dynamicURL);
                realURL.hostname =
                    self.ubolOverlay.webext.i18n.getMessage('@@extension_id');
                frame.contentWindow.postMessage(
                    {
                        what: 'startOverlay',
                        url: document.baseURI,
                        width: self.innerWidth,
                        height: self.innerHeight,
                    },
                    realURL.origin,
                    [ channel.port2 ]
                );
                frame.contentWindow.focus();
                self.ubolOverlay.onmessage = onmessage;
                self.ubolOverlay.port = port;
                self.ubolOverlay.frame = frame;
                resolve(true);
            };
            if ( dynamicURL.protocol !== 'safari-web-extension:' ) {
                frame.onload = ( ) => {
                    frame.onload = onLoad;
                    frame.contentWindow.location = dynamicURL.href;
                };
            } else {
                frame.onload = onLoad;
                frame.setAttribute('src', dynamicURL.href);
            }
            document.documentElement.append(frame);
        });
    },
};

/******************************************************************************/

})();


void 0;

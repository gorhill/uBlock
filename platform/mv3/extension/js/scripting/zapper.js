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

(async ( ) => {

/******************************************************************************/

const zapper = self.uBOLZapper = self.uBOLZapper || {};

if ( zapper.injected ) { return; }
zapper.injected = true;

const webext = typeof browser === 'object' ? browser : chrome;

/******************************************************************************/

const sendMessage = msg => {
    try {
        webext.runtime.sendMessage(msg).catch(( ) => { });
    } catch {
    }
};

/******************************************************************************/

const zapperSecret = (( ) => {
    let secret = String.fromCharCode((Math.random() * 26) + 97);
    do {
        secret += (Math.floor(Math.random() * 2147483647) + 2147483647)
            .toString(36)
            .slice(2);
    } while ( secret.length < 8 );
    return secret;
})();

const zapperCSSStyle = [
    'background: transparent',
    'border: 0',
    'border-radius: 0',
    'box-shadow: none',
    'color-scheme: light dark',
    'display: block',
    'filter: none',
    'height: 100vh',
    '    height: 100svh',
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

const zapperCSS = `
:root > [${zapperSecret}] {
    ${zapperCSSStyle}
}
:root > [${zapperSecret}-loaded] {
    visibility: visible !important;
}
:root [${zapperSecret}-click] {
    pointer-events: none !important;
}
`;

sendMessage({ what: 'insertCSS', css: zapperCSS });

/******************************************************************************/

const getElementBoundingClientRect = function(elem) {
    let rect = typeof elem.getBoundingClientRect === 'function'
        ? elem.getBoundingClientRect()
        : { height: 0, left: 0, top: 0, width: 0 };

    // https://github.com/gorhill/uBlock/issues/1024
    // Try not returning an empty bounding rect.
    if ( rect.width !== 0 && rect.height !== 0 ) {
        return rect;
    }
    if ( elem.shadowRoot instanceof DocumentFragment ) {
        return getElementBoundingClientRect(elem.shadowRoot);
    }

    let left = rect.left,
        right = left + rect.width,
        top = rect.top,
        bottom = top + rect.height;

    for ( const child of elem.children ) {
        rect = getElementBoundingClientRect(child);
        if ( rect.width === 0 || rect.height === 0 ) { continue; }
        if ( rect.left < left ) { left = rect.left; }
        if ( rect.right > right ) { right = rect.right; }
        if ( rect.top < top ) { top = rect.top; }
        if ( rect.bottom > bottom ) { bottom = rect.bottom; }
    }

    return {
        bottom,
        height: bottom - top,
        left,
        right,
        top,
        width: right - left
    };
};

/******************************************************************************/

const highlightElement = function(elem) {
    if ( elem !== true ) {
        if ( elem !== undefined ) {
            if ( elem === highlightElement.current ) { return; }
            if ( elem !== zapperFrame ) {
                highlightElement.current = elem;
            }
        }
    }
    elem = highlightElement.current;

    const ow = self.innerWidth;
    const oh = self.innerHeight;
    const islands = [];

    if ( elem !== null ) {
        const rect = getElementBoundingClientRect(elem);
        // Ignore offscreen areas
        if (
            rect.left <= ow && rect.top <= oh &&
            rect.left + rect.width >= 0 && rect.top + rect.height >= 0
        ) {
            islands.push(
                `M${rect.left} ${rect.top}h${rect.width}v${rect.height}h-${rect.width}z`
            );
        }
    }

    zapperFramePort.postMessage({
        what: 'svgPaths',
        ocean: `M0 0h${ow}v${oh}h-${ow}z`,
        islands: islands.join(''),
    });
};
highlightElement.current = null;

/******************************************************************************/

const elementFromPoint = (( ) => {
    let lastX, lastY;

    return (x, y) => {
        if ( x !== undefined ) {
            lastX = x; lastY = y;
        } else if ( lastX !== undefined ) {
            x = lastX; y = lastY;
        } else {
            return null;
        }
        if ( !zapperFrame ) { return null; }
        const magicAttr = `${zapperSecret}-click`;
        zapperFrame.setAttribute(magicAttr, '');
        let elem = document.elementFromPoint(x, y);
        if ( elem === document.body || elem === document.documentElement ) {
            elem = null;
        }
        // https://github.com/uBlockOrigin/uBlock-issues/issues/380
        zapperFrame.removeAttribute(magicAttr);
        return elem;
    };
})();

/******************************************************************************/

const highlightElementAtPoint = function(mx, my) {
    const elem = elementFromPoint(mx, my);
    highlightElement(elem);
};

/******************************************************************************/

// https://www.reddit.com/r/uBlockOrigin/comments/bktxtb/scrolling_doesnt_work/emn901o
//   Override 'fixed' position property on body element if present.

// With touch-driven devices, first highlight the element and remove only
// when tapping again the highlighted area.

const zapElementAtPoint = function(mx, my, options) {
    if ( options.highlight ) {
        const elem = elementFromPoint(mx, my);
        if ( elem ) {
            highlightElement(elem);
        }
        return;
    }

    let elemToRemove = highlightElement.current;
    if ( elemToRemove === null && mx !== undefined ) {
        elemToRemove = elementFromPoint(mx, my);
    }

    if ( elemToRemove instanceof Element === false ) { return; }

    const getStyleValue = (elem, prop) => {
        const style = window.getComputedStyle(elem);
        return style ? style[prop] : '';
    };

    // Heuristic to detect scroll-locking: remove such lock when detected.
    let maybeScrollLocked = elemToRemove.shadowRoot instanceof DocumentFragment;
    if ( maybeScrollLocked === false ) {
        let elem = elemToRemove;
        do {
            maybeScrollLocked =
                parseInt(getStyleValue(elem, 'zIndex'), 10) >= 1000 ||
                getStyleValue(elem, 'position') === 'fixed';
            elem = elem.parentElement;
        } while ( elem !== null && maybeScrollLocked === false );
    }
    if ( maybeScrollLocked ) {
        const doc = document;
        if ( getStyleValue(doc.body, 'overflowY') === 'hidden' ) {
            doc.body.style.setProperty('overflow', 'auto', 'important');
        }
        if ( getStyleValue(doc.body, 'position') === 'fixed' ) {
            doc.body.style.setProperty('position', 'initial', 'important');
        }
        if ( getStyleValue(doc.documentElement, 'position') === 'fixed' ) {
            doc.documentElement.style.setProperty('position', 'initial', 'important');
        }
        if ( getStyleValue(doc.documentElement, 'overflowY') === 'hidden' ) {
            doc.documentElement.style.setProperty('overflow', 'auto', 'important');
        }
    }
    elemToRemove.remove();
    highlightElementAtPoint(mx, my);
};

/******************************************************************************/

const onKeyPressed = function(ev) {
    // Delete
    if (
        (ev.key === 'Delete' || ev.key === 'Backspace') ) {
        ev.stopPropagation();
        ev.preventDefault();
        zapElementAtPoint();
        return;
    }
    // Esc
    if ( ev.key === 'Escape' || ev.which === 27 ) {
        ev.stopPropagation();
        ev.preventDefault();
        quitZapper();
        return;
    }
};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/190
//   May need to dynamically adjust the height of the overlay + new position
//   of highlighted elements.

const onViewportChanged = function() {
    highlightElement(true);
};

/******************************************************************************/

const startZapper = function() {
    zapperFrame.focus();
    self.addEventListener('scroll', onViewportChanged, { passive: true });
    self.addEventListener('resize', onViewportChanged, { passive: true });
    self.addEventListener('keydown', onKeyPressed, true);
};

/******************************************************************************/

const quitZapper = function() {
    self.removeEventListener('scroll', onViewportChanged, { passive: true });
    self.removeEventListener('resize', onViewportChanged, { passive: true });
    self.removeEventListener('keydown', onKeyPressed, true);
    if ( zapperFramePort ) {
        zapperFramePort.close();
        zapperFramePort.onmessage = null;
        zapperFramePort.onmessageerror = null;
        zapperFramePort = null;
    }
    if ( zapperFrame ) {
        zapperFrame.remove();
        zapperFrame = null;
    }
    sendMessage({ what: 'removeCSS', css: zapperCSS });
    zapper.injected = false;
};

/******************************************************************************/

const onFrameMessage = function(msg) {
    switch ( msg.what ) {
    case 'start':
        startZapper();
        if ( Boolean(zapperFramePort) === false ) { break; }
        highlightElement(true);
        break;
    case 'quitZapper':
        quitZapper();
        break;
    case 'highlightElementAtPoint':
        highlightElementAtPoint(msg.mx, msg.my);
        break;
    case 'unhighlight':
        highlightElement(null);
        break;
    case 'zapElementAtPoint':
        zapElementAtPoint(msg.mx, msg.my, msg.options);
        if ( msg.options.highlight !== true && msg.options.stay !== true ) {
            quitZapper();
        }
        break;
    default:
        break;
    }
};

/******************************************************************************/

// zapper-ui.html will be injected in the page through an iframe, and
// is a sandboxed so as to prevent the page from interfering with its
// content and behavior.
//
// The purpose of zapper.js is to install the zapper UI, and wait for the
// component to establish a direct communication channel.
//
// When the zapper is installed on a page, the only change the page sees is an
// iframe with a random attribute. The page can't see the content of the
// iframe, and cannot interfere with its style properties. However the page
// can remove the iframe.

const bootstrap = async ( ) => {
    const dynamicURL = new URL(webext.runtime.getURL('/zapper-ui.html'));
    return new Promise(resolve => {
        const frame = document.createElement('iframe');
        frame.setAttribute(zapperSecret, '');
        const onZapperLoad = ( ) => {
            frame.onload = null;
            frame.setAttribute(`${zapperSecret}-loaded`, '');
            const channel = new MessageChannel();
            const port = channel.port1;
            port.onmessage = ev => {
                onFrameMessage(ev.data || {});
            };
            port.onmessageerror = ( ) => {
                quitZapper();
            };
            const realURL = new URL(dynamicURL);
            realURL.hostname = webext.i18n.getMessage('@@extension_id');
            frame.contentWindow.postMessage(
                { what: 'zapperStart' },
                realURL.origin,
                [ channel.port2 ]
            );
            frame.contentWindow.focus();
            resolve({
                zapperFrame: frame,
                zapperFramePort: port,
            });
        };
        if ( dynamicURL.protocol !== 'safari-web-extension:' ) {
            frame.onload = ( ) => {
                frame.onload = onZapperLoad;
                frame.contentWindow.location = dynamicURL.href;
            };
        } else {
            frame.onload = onZapperLoad;
            frame.setAttribute('src', dynamicURL.href);
        }
        document.documentElement.append(frame);
    });
};

let { zapperFrame, zapperFramePort } = await bootstrap();
if ( zapperFrame && zapperFramePort ) { return; }

quitZapper();

/******************************************************************************/

})();


void 0;

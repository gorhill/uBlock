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

const picker = self.uBOLPicker = self.uBOLPicker || {};

if ( picker.injected ) { return; }
picker.injected = true;

const webext = typeof browser === 'object' ? browser : chrome;

/******************************************************************************/

const sendMessage = msg => {
    try {
        webext.runtime.sendMessage(msg).catch(( ) => { });
    } catch {
    }
};

/******************************************************************************/

const safeQuerySelectorAll = function(node, selector) {
    if ( node !== null ) {
        try {
            const elems = node.querySelectorAll(selector);
            safeQuerySelectorAll.error = undefined;
            return elems;
        } catch (reason) {
            safeQuerySelectorAll.error = `${reason}`;
        }
    }
    return [];
};

/******************************************************************************/

const pickerSecret = (( ) => {
    let secret = String.fromCharCode((Math.random() * 26) + 97);
    do {
        secret += (Math.floor(Math.random() * 2147483647) + 2147483647)
            .toString(36)
            .slice(2);
    } while ( secret.length < 8 );
    return secret;
})();

const pickerCSSStyle = [
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

const pickerCSS = `
:root > [${pickerSecret}] {
    ${pickerCSSStyle}
}
:root > [${pickerSecret}-loaded] {
    visibility: visible !important;
}
:root [${pickerSecret}-click] {
    pointer-events: none !important;
}
`;

sendMessage({ what: 'insertCSS', css: pickerCSS });

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
        if ( !pickerFrame ) { return null; }
        const magicAttr = `${pickerSecret}-click`;
        pickerFrame.setAttribute(magicAttr, '');
        let elem = document.elementFromPoint(x, y);
        if ( elem === document.body || elem === document.documentElement ) {
            elem = null;
        }
        // https://github.com/uBlockOrigin/uBlock-issues/issues/380
        pickerFrame.removeAttribute(magicAttr);
        return elem;
    };
})();

/******************************************************************************/

function getElementBoundingClientRect(elem) {
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
}

/******************************************************************************/

function highlightElements(iter = []) {
    if ( iter !== true ) {
        highlightElements.current =
            Array.from(iter).filter(a => a !== pickerFrame);
    }
    const ow = self.innerWidth;
    const oh = self.innerHeight;
    const islands = [];
    for ( const elem of highlightElements.current ) {
        const rect = getElementBoundingClientRect(elem);
        // Ignore offscreen areas
        if ( rect.left > ow ) { continue; }
        if ( rect.top > oh ) { continue; }
        if ( rect.left + rect.width < 0 ) { continue; }
        if ( rect.top + rect.height < 0 ) { continue; }
        islands.push(
            `M${rect.left} ${rect.top}h${rect.width}v${rect.height}h-${rect.width}z`
        );
    }
    pickerFramePort.postMessage({
        what: 'svgPaths',
        ocean: `M0 0h${ow}v${oh}h-${ow}z`,
        islands: islands.join(''),
    });
}
highlightElements.current = [];

/******************************************************************************/

function highlightElementAtPoint(mx, my) {
    const elem = elementFromPoint(mx, my);
    highlightElements(elem !== null ? [ elem ] : []);
}

/******************************************************************************/

function elementsFromSelector(selector) {
    const elems = safeQuerySelectorAll(document, selector);
    return { elems, error: safeQuerySelectorAll.error };
}

/******************************************************************************/

function attributeNameFromPart(part) {
    const pos = part.search(/\^?=/);
    return part.slice(1, pos);
}

function selectorFromAddresses(partsDB, addresses) {
    const selector = [];
    let majorLast = -1;
    for ( const address of addresses ) {
        const major = address >>> 12;
        if ( majorLast !== -1 ) {
            const delta = majorLast - major;
            if ( delta > 1 ) {
                selector.push(' ');
            } else if ( delta === 1 ) {
                selector.push(' > ');
            }
        }
        majorLast = major;
        const part = partsDB.get(address);
        selector.push(
            (address & 0xF) === 3
                ? `[${attributeNameFromPart(part)}]`
                : part
        );
    }
    return selector.join('');
}

/*******************************************************************************
 * 
 * Selector part address:
 * 0b00000000_00000000_0000
 *          |        |    |
 *          |        |    +-- 4-bit: Descriptor
 *          |        +------- 8-bit: Part index
 *          +---------------- 8-bit: List index
 * Descriptor:
 * - 0: tag name
 * - 1: id
 * - 2: class
 * - 3: attribute
 * - 4: :nth-of-type
 * List index: 0 is deepest
 * 
 * Selector part addresses are used to reference parts in associated database.
 * 
 * */

function candidatesAtPoint(x, y) {
    // We need at least one element.
    let elem = null;
    if ( typeof x === 'number' ) {
        elem = elementFromPoint(x, y);
    } else if ( x instanceof HTMLElement ) {
        elem = x;
        x = undefined;
    }

    const partsDB = new Map();
    const listParts = [];
    while ( elem && elem !== document.body ) {
        const tagName = elem.localName;
        const addressMajor = listParts.length << 12;
        partsDB.set(addressMajor, CSS.escape(tagName));
        const parts = [ addressMajor ];
        // Id
        if ( typeof elem.id === 'string' && elem.id !== '' ) {
            const address = addressMajor | parts.length << 4 | 1;
            partsDB.set(address, `#${CSS.escape(elem.id)}`);
            parts.push(address);
        }
        // Classes
        for ( const name of elem.classList.values() ) {
            const address = addressMajor | parts.length << 4 | 2;
            partsDB.set(address, `.${CSS.escape(name)}`);
            parts.push(address);
        }
        // Attributes
        for ( const name of elem.getAttributeNames() ) {
            if ( name === 'id' || name === 'class' ) { continue; }
            if ( excludedAttributeExpansion.includes(name) ) {
                const address = addressMajor | parts.length << 4 | 3;
                partsDB.set(address, `[${CSS.escape(name)}]`);
                parts.push(address);
                continue;
            }
            let value = elem.getAttribute(name);
            const pos = value.search(/[\n\r]/);
            if ( pos !== -1 ) {
                value = value.slice(0, pos);
            }
            const address = addressMajor | parts.length << 4 | 3;
            partsDB.set(address, `[${CSS.escape(name)}="${value}"]`);
            parts.push(address);
        }
        // https://github.com/chrisaljoudi/uBlock/issues/637
        //   If the selector is still ambiguous at this point, further narrow using
        //   `nth-of-type`.
        const parentNode = elem.parentNode;
        if ( safeQuerySelectorAll(parentNode, `:scope > ${selectorFromAddresses(partsDB, parts)}`).length > 1 ) {
            let i = 1;
            while ( elem.previousSibling !== null ) {
                elem = elem.previousSibling;
                if ( typeof elem.localName !== 'string' ) { continue; }
                if ( elem.localName === tagName ) { continue; }
                i++;
            }
            const address = addressMajor | parts.length << 4 | 4;
            partsDB.set(address, `:nth-of-type(${i})`);
            parts.push(address);
        }
        listParts.push(parts);
        elem = elem.parentElement;
    }
    if ( listParts.length === 0 ) { return; }

    const sliderCandidates = [];
    for ( let i = 0, n = listParts.length; i < n; i++ ) {
        sliderCandidates.push(listParts[i]);
        for ( let j = i + 1; j < n; j++ ) {
            sliderCandidates.push([
                ...listParts[j],
                ...sliderCandidates.at(-1),
            ]);
        }
    }
    const sliderMap = new Map();
    for ( const candidates of sliderCandidates ) {
        if ( candidates.some(a => (a & 0xF) === 1) ) {
            const selectorPath = candidates.filter(a => (a & 0xF) === 1);
            sliderMap.set(JSON.stringify(selectorPath), 0);
        } else if ( candidates.some(a => (a & 0xF) === 4) ) {
            const selectorPath = candidates.filter(a => {
                return a &= 0xF, a === 0 || a === 4;
            });
            sliderMap.set(JSON.stringify(selectorPath), 0);
        }
        if ( candidates.some(a => (a & 0xF) === 2) ) {
            const selectorPath = candidates.filter(a => {
                return a &= 0xF, a === 0 || a === 2;
            });
            sliderMap.set(JSON.stringify(selectorPath), 0);
        }
        const selectorPath = candidates.filter(a => {
            return a &= 0xF, a === 0 || a === 3;
        });
        sliderMap.set(JSON.stringify(selectorPath), 0);
    }
    sliderMap.delete('[]');
    const elemToIdMap = new Map();
    const resultSetMap = new Map();
    let elemId = 1;
    for ( const json of sliderMap.keys() ) {
        const addresses = JSON.parse(json);
        const selector = selectorFromAddresses(partsDB, addresses);
        if ( excludedSelectors.includes(selector) ) { continue; }
        const elems = safeQuerySelectorAll(document, selector);
        if ( elems.length === 0 ) { continue; }
        const resultSet = [];
        for ( const elem of elems ) {
            if ( elemToIdMap.has(elem) === false ) {
                elemToIdMap.set(elem, elemId++);
            }
            resultSet.push(elemToIdMap.get(elem));
        }
        const resultSetKey = JSON.stringify(resultSet.sort());
        const current = resultSetMap.get(resultSetKey);
        if ( current ) {
            if ( current.length < addresses.length ) { continue; }
            if ( current.length === addresses.length ) {
                if ( addresses.some(a => (a & 0xF) === 2) === false ) {
                    if ( current.some(a => (a & 0xF) === 2) ) { continue; }
                }
            }
        }
        resultSetMap.set(resultSetKey, addresses);
    }
    const sliderParts = Array.from(resultSetMap).toSorted((a, b) => {
        let amajor = a[1].at(-1) >>> 12;
        let bmajor = b[1].at(-1) >>> 12;
        if ( amajor !== bmajor ) { return bmajor - amajor; }
        amajor = a[1].at(0) >>> 12;
        bmajor = b[1].at(0) >>> 12;
        if ( amajor !== bmajor ) { return bmajor - amajor; }
        if ( a[0].length !== b[0].length ) {
            return b[0].length - a[0].length;
        }
        return b[1].length - a[1].length;
    }).map(a => a[1]);

    showDialog({
        partsDB: Array.from(partsDB),
        listParts,
        sliderParts,
    });
}

const excludedAttributeExpansion = [
    'sizes',
    'srcset',
];
const excludedSelectors = [
    'div',
    'span',
];

/******************************************************************************/

function onKeyPressed(ev) {
    // Esc
    if ( ev.key === 'Escape' || ev.which === 27 ) {
        ev.stopPropagation();
        ev.preventDefault();
        quitPicker();
        return;
    }
}

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/190
//   May need to dynamically adjust the height of the overlay + new position
//   of highlighted elements.

function onViewportChanged() {
    highlightElements(true);
}

/******************************************************************************/

function showDialog(details) {
    pickerFramePort.postMessage({
        what: 'showDialog',
        url: document.baseURI,
        details,
    });
};

/******************************************************************************/

function startPicker() {
    pickerFrame.focus();
    self.addEventListener('scroll', onViewportChanged, { passive: true });
    self.addEventListener('resize', onViewportChanged, { passive: true });
    self.addEventListener('keydown', onKeyPressed, true);
}

/******************************************************************************/

function quitPicker() {
    self.removeEventListener('scroll', onViewportChanged, { passive: true });
    self.removeEventListener('resize', onViewportChanged, { passive: true });
    self.removeEventListener('keydown', onKeyPressed, true);
    if ( pickerFramePort ) {
        pickerFramePort.close();
        pickerFramePort.onmessage = null;
        pickerFramePort.onmessageerror = null;
        pickerFramePort = null;
    }
    if ( pickerFrame ) {
        pickerFrame.remove();
        pickerFrame = null;
    }
    sendMessage({ what: 'removeCSS', css: pickerCSS });
    picker.injected = false;
}

/******************************************************************************/

function onFrameMessage(msg) {
    switch ( msg.what ) {
    case 'startPicker':
        startPicker();
        if ( Boolean(pickerFramePort) === false ) { break; }
        highlightElements(true);
        break;
    case 'quitPicker':
        quitPicker();
        break;
    case 'highlightElementAtPoint':
        highlightElementAtPoint(msg.mx, msg.my);
        break;
    case 'highlightFromSelector': {
        const { elems, error } = elementsFromSelector(msg.selector);
        highlightElements(elems);
        pickerFramePort.postMessage({
            what: 'countFromSelector',
            count: elems.length,
            error,
        });
        break;
    }
    case 'unhighlight':
        highlightElements();
        break;
    case 'candidatesAtPoint':
        candidatesAtPoint(msg.mx, msg.my, msg.broad);
        break;
    case 'insertCSS':
        sendMessage(msg);
        break;
    case 'removeCSS':
        sendMessage(msg);
        break;
    default:
        break;
    }
}

/******************************************************************************/

// picker-ui.html will be injected in the page through an iframe, and
// is sandboxed so as to prevent the page from interfering with its content
// and behavior.
//
// The purpose of picker.js is to install the picker UI, and wait for the
// component to establish a direct communication channel.
//
// When the picker is installed on a page, the only change the page sees is an
// iframe with a random attribute. The page can't see the content of the
// iframe, and cannot interfere with its style properties. However the page
// can remove the iframe.

const bootstrap = async ( ) => {
    const dynamicURL = new URL(webext.runtime.getURL('/picker-ui.html'));
    return new Promise(resolve => {
        const frame = document.createElement('iframe');
        frame.setAttribute(pickerSecret, '');
        const onPickerLoad = ( ) => {
            frame.onload = null;
            frame.setAttribute(`${pickerSecret}-loaded`, '');
            const channel = new MessageChannel();
            const port = channel.port1;
            port.onmessage = ev => {
                onFrameMessage(ev.data || {});
            };
            port.onmessageerror = ( ) => {
                quitPicker();
            };
            const realURL = new URL(dynamicURL);
            realURL.hostname = webext.i18n.getMessage('@@extension_id');
            frame.contentWindow.postMessage(
                { what: 'pickerStart' },
                realURL.origin,
                [ channel.port2 ]
            );
            frame.contentWindow.focus();
            resolve({
                pickerFrame: frame,
                pickerFramePort: port,
            });
        };
        if ( dynamicURL.protocol !== 'safari-web-extension:' ) {
            frame.onload = ( ) => {
                frame.onload = onPickerLoad;
                frame.contentWindow.location = dynamicURL.href;
            };
        } else {
            frame.onload = onPickerLoad;
            frame.setAttribute('src', dynamicURL.href);
        }
        document.documentElement.append(frame);
    });
};

let { pickerFrame, pickerFramePort } = await bootstrap();
if ( pickerFrame && pickerFramePort ) { return; }

quitPicker();

/******************************************************************************/

})();


void 0;

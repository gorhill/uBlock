/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-present Raymond Hill

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

(( ) => {

/******************************************************************************/

// This can happen
if ( typeof vAPI !== 'object' || vAPI.loadLargeMediaInteractive === true ) {
    return;
}

/******************************************************************************/

const largeMediaElementAttribute = 'data-' + vAPI.sessionId;
const largeMediaElementSelector =
    ':root   audio[' + largeMediaElementAttribute + '],\n' +
    ':root     img[' + largeMediaElementAttribute + '],\n' +
    ':root picture[' + largeMediaElementAttribute + '],\n' +
    ':root   video[' + largeMediaElementAttribute + ']';

/******************************************************************************/

const mediaNotLoaded = function(elem) {
    const src = elem.getAttribute('src') || '';
    if ( src === '' ) { return false; }

    switch ( elem.localName ) {
    case 'audio':
    case 'video':
        return elem.error !== null;
    case 'img':
        if ( elem.naturalWidth !== 0 || elem.naturalHeight !== 0 ) { break; }
        const style = window.getComputedStyle(elem);
        // For some reason, style can be null with Pale Moon.
        return style !== null ?
            style.getPropertyValue('display') !== 'none' :
            elem.offsetHeight !== 0 && elem.offsetWidth !== 0;
    default:
        break;
    }
    return false;
};

/******************************************************************************/

// For all media resources which have failed to load, trigger a reload.

// <audio> and <video> elements.
// https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement
// https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement

const surveyMissingMediaElements = function() {
    let largeMediaElementCount = 0;
    for ( const elem of document.querySelectorAll('audio,img,video') ) {
        if ( mediaNotLoaded(elem) === false ) { continue; }
        elem.setAttribute(largeMediaElementAttribute, '');
        largeMediaElementCount += 1;
        switch ( elem.localName ) {
        case 'img': {
            const picture = elem.closest('picture');
            if ( picture !== null ) {
                picture.setAttribute(largeMediaElementAttribute, '');
            }
        } break;
        default:
            break;
        }
    }
    return largeMediaElementCount;
};

if ( surveyMissingMediaElements() === 0 ) { return; }

vAPI.loadLargeMediaInteractive = true;

// Insert CSS to highlight blocked media elements.
if ( vAPI.largeMediaElementStyleSheet === undefined ) {
    vAPI.largeMediaElementStyleSheet = [
        largeMediaElementSelector + ' {',
            'border: 2px dotted red !important;',
            'box-sizing: border-box !important;',
            'cursor: zoom-in !important;',
            'display: inline-block;',
            'font-size: 1rem !important;',
            'min-height: 1em !important;',
            'min-width: 1em !important;',
            'opacity: 1 !important;',
            'outline: none !important;',
            'visibility: visible !important;',
            'z-index: 2147483647',
        '}',
    ].join('\n');
    vAPI.userStylesheet.add(vAPI.largeMediaElementStyleSheet);
    vAPI.userStylesheet.apply();
}

/******************************************************************************/

const stayOrLeave = (( ) => {
    let timer;

    const timeoutHandler = function(leaveNow) {
        timer = undefined;
        if ( leaveNow !== true ) {
            if ( 
                document.querySelector(largeMediaElementSelector) !== null ||
                surveyMissingMediaElements() !== 0
            ) {
                return;
            }
        }
        // Leave
        for ( const elem of document.querySelectorAll(largeMediaElementSelector) ) {
            elem.removeAttribute(largeMediaElementAttribute);
        }
        vAPI.loadLargeMediaInteractive = false;
        document.removeEventListener('error', onLoadError, true);
        document.removeEventListener('click', onMouseClick, true);
    };

    return function(leaveNow) {
        if ( timer !== undefined ) {
            clearTimeout(timer);
        }
        if ( leaveNow ) {
            timeoutHandler(true);
        } else {
            timer = vAPI.setTimeout(timeoutHandler, 5000);
        }
    };
})();

/******************************************************************************/

const loadImage = async function(elem) {
    const src = elem.getAttribute('src');
    elem.removeAttribute('src');

    await vAPI.messaging.send('scriptlets', {
        what: 'temporarilyAllowLargeMediaElement',
    });

    elem.setAttribute('src', src);
    elem.removeAttribute(largeMediaElementAttribute);

    switch ( elem.localName ) {
    case 'img': {
        const picture = elem.closest('picture');
        if ( picture !== null ) {
            picture.removeAttribute(largeMediaElementAttribute);
        }
    } break;
    default:
        break;
    }

    stayOrLeave();
};

/******************************************************************************/

const onMouseClick = function(ev) {
    if ( ev.button !== 0 || ev.isTrusted === false ) { return; }

    const toLoad = [];
    const elems = document.elementsFromPoint instanceof Function
        ? document.elementsFromPoint(ev.clientX, ev.clientY)
        : [ ev.target ];
    for ( const elem of elems ) {
        if ( elem.matches(largeMediaElementSelector) && mediaNotLoaded(elem) ) {
            toLoad.push(elem);
        }
    }

    if ( toLoad.length === 0 ) {
        stayOrLeave();
        return;
    }

    for ( const elem of toLoad ) {
        loadImage(elem);
    }

    ev.preventDefault();
    ev.stopPropagation();
};

document.addEventListener('click', onMouseClick, true);

/******************************************************************************/

const onLoad = function(ev) {
    const elem = ev.target;
    if ( elem.hasAttribute(largeMediaElementAttribute) ) {
        elem.removeAttribute(largeMediaElementAttribute);
        stayOrLeave();
    }
};

document.addEventListener('load', onLoad, true);

/******************************************************************************/

const onLoadError = function(ev) {
    const elem = ev.target;
    if ( mediaNotLoaded(elem) ) {
        elem.setAttribute(largeMediaElementAttribute, '');
    }
};

document.addEventListener('error', onLoadError, true);

/******************************************************************************/

vAPI.shutdown.add(( ) => {
    stayOrLeave(true);
});

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

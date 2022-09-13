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

/* jshint esversion:11 */

'use strict';

/******************************************************************************/

function normalizeTarget(target) {
    if ( target === null ) { return []; }
    if ( Array.isArray(target) ) { return target; } 
    return target instanceof Element
        ? [ target ]
        : Array.from(target);
}

function makeEventHandler(selector, callback) {
    return function(event) {
        const dispatcher = event.currentTarget;
        if (
            dispatcher instanceof HTMLElement === false ||
            typeof dispatcher.querySelectorAll !== 'function'
        ) {
            return;
        }
        const receiver = event.target;
        const ancestor = receiver.closest(selector);
        if (
            ancestor === receiver &&
            ancestor !== dispatcher &&
            dispatcher.contains(ancestor)
        ) {
            callback.call(receiver, event);
        }
    };
}

/******************************************************************************/

class dom {

    static addClass(target, cl) {
        for ( const elem of normalizeTarget(target) ) {
            elem.classList.add(cl);
        }
    }

    static toggleClass(target, cl, state = undefined) {
        for ( const elem of normalizeTarget(target) ) {
            elem.classList.toggle(cl, state);
        }
    }

    static removeClass(target, cl) {
        for ( const elem of normalizeTarget(target) ) {
            elem.classList.remove(cl);
        }
    }

    static attr(target, attr, value = undefined) {
        for ( const elem of normalizeTarget(target) ) {
            if ( value === undefined ) {
                return elem.getAttribute(attr);
            }
            elem.setAttribute(attr, value);
        }
    }

    static remove(target) {
        for ( const elem of normalizeTarget(target) ) {
            elem.remove();
        }
    }

    static on(target, type, selector, callback) {
        if ( typeof selector === 'function' ) {
            callback = selector;
            selector = undefined;
        } else {
            callback = makeEventHandler(selector, callback);
        }
        for ( const elem of normalizeTarget(target) ) {
            elem.addEventListener(type, callback, selector !== undefined);
        }
    }
}

dom.body = document.body;

/******************************************************************************/

function qs$(s, elem = undefined) {
    return (elem || document).querySelector(s);
}

function qsa$(s, elem = undefined) {
    return (elem || document).querySelectorAll(s);
}

/******************************************************************************/

export { dom, qs$, qsa$ };

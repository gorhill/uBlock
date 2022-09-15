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

const normalizeTarget = target => {
    if ( target === null ) { return []; }
    if ( Array.isArray(target) ) { return target; } 
    return target instanceof Element
        ? [ target ]
        : Array.from(target);
};

const makeEventHandler = (selector, callback) => {
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
};

/******************************************************************************/

class dom {
    static attr(target, attr, value = undefined) {
        for ( const elem of normalizeTarget(target) ) {
            if ( value === undefined ) {
                return elem.getAttribute(attr);
            }
            elem.setAttribute(attr, value);
        }
    }

    static text(target, text) {
        for ( const elem of normalizeTarget(target) ) {
            elem.textContent = text;
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

dom.cl = class {
    static add(target, name) {
        for ( const elem of normalizeTarget(target) ) {
            elem.classList.add(name);
        }
    }

    static remove(target, name) {
        for ( const elem of normalizeTarget(target) ) {
            elem.classList.remove(name);
        }
    }

    static toggle(target, name, state) {
        for ( const elem of normalizeTarget(target) ) {
            elem.classList.toggle(name, state);
        }
    }

    static has(target, name) {
        for ( const elem of normalizeTarget(target) ) {
            if ( elem.classList.contains(name) ) {
                return true;
            }
        }
        return false;
    }
};

dom.html = document.documentElement;
dom.head = document.head;
dom.body = document.body;

/******************************************************************************/

function qs$(s, elem = undefined) {
    return (elem || document).querySelector(s);
}

function qsa$(s, elem = undefined) {
    return (elem || document).querySelectorAll(s);
}

/******************************************************************************/

{
    const mql = self.matchMedia('(prefers-color-scheme: dark)');
    const theme = mql instanceof Object && mql.matches === true
        ? 'dark'
        : 'light';
    dom.cl.toggle(dom.html, 'dark', theme === 'dark');
    dom.cl.toggle(dom.html, 'light', theme !== 'dark');
}

/******************************************************************************/

export { dom, qs$, qsa$ };

/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2019-present Raymond Hill

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

    The scriptlets below are meant to be injected only into a
    web page context.
*/

import { runAt } from './run-at.js';
import { safeSelf } from './safe-self.js';

/******************************************************************************/

export function setAttrFn(
    logPrefix,
    selector = '',
    attr = '',
    value = ''
) {
    if ( selector === '' ) { return; }
    if ( attr === '' ) { return; }

    const safe = safeSelf();
    const copyFrom = /^\[.+\]$/.test(value)
        ? value.slice(1, -1)
        : '';

    const extractValue = elem => copyFrom !== ''
        ? elem.getAttribute(copyFrom) || ''
        : value;

    const applySetAttr = ( ) => {
        let elems;
        try {
            elems = document.querySelectorAll(selector);
        } catch(_) {
            return false;
        }
        for ( const elem of elems ) {
            const before = elem.getAttribute(attr);
            const after = extractValue(elem);
            if ( after === before ) { continue; }
            if ( after !== '' && /^on/i.test(attr) ) {
                if ( attr.toLowerCase() in elem ) { continue; }
            }
            elem.setAttribute(attr, after);
            safe.uboLog(logPrefix, `${attr}="${after}"`);
        }
        return true;
    };

    let observer, timer;
    const onDomChanged = mutations => {
        if ( timer !== undefined ) { return; }
        let shouldWork = false;
        for ( const mutation of mutations ) {
            if ( mutation.addedNodes.length === 0 ) { continue; }
            for ( const node of mutation.addedNodes ) {
                if ( node.nodeType !== 1 ) { continue; }
                shouldWork = true;
                break;
            }
            if ( shouldWork ) { break; }
        }
        if ( shouldWork === false ) { return; }
        timer = self.requestAnimationFrame(( ) => {
            timer = undefined;
            applySetAttr();
        });
    };

    const start = ( ) => {
        if ( applySetAttr() === false ) { return; }
        observer = new MutationObserver(onDomChanged);
        observer.observe(document.body, {
            subtree: true,
            childList: true,
        });
    };
    runAt(( ) => { start(); }, 'idle');
}
setAttrFn.details = {
    name: 'set-attr.fn',
    dependencies: [
        runAt,
        safeSelf,
    ],
};

/**
 * @scriptlet set-attr
 * 
 * @description
 * Sets the specified attribute on the specified elements. This scriptlet runs
 * once when the page loads then afterward on DOM mutations.
 * 
 * Reference: https://github.com/AdguardTeam/Scriptlets/blob/master/src/scriptlets/set-attr.js
 * 
 * @param selector
 * A CSS selector for the elements to target.
 * 
 * @param attr
 * The name of the attribute to modify.
 * 
 * @param value
 * The new value of the attribute. Supported values:
 * - `''`: empty string (default)
 * - `true`
 * - `false`
 * - positive decimal integer 0 <= value < 32768
 * - `[other]`: copy the value from attribute `other` on the same element
 * 
 * */

export function setAttr(
    selector = '',
    attr = '',
    value = ''
) {
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('set-attr', selector, attr, value);
    const validValues = [ '', 'false', 'true' ];

    if ( validValues.includes(value.toLowerCase()) === false ) {
        if ( /^\d+$/.test(value) ) {
            const n = parseInt(value, 10);
            if ( n >= 32768 ) { return; }
            value = `${n}`;
        } else if ( /^\[.+\]$/.test(value) === false ) {
            return;
        }
    }

    setAttrFn(logPrefix, selector, attr, value);
}
setAttr.details = {
    name: 'set-attr.js',
    dependencies: [
        safeSelf,
        setAttrFn,
    ],
    world: 'ISOLATED',
};

/**
 * @trustedScriptlet trusted-set-attr
 * 
 * @description
 * Sets the specified attribute on the specified elements. This scriptlet runs
 * once when the page loads then afterward on DOM mutations.
 * 
 * Reference: https://github.com/AdguardTeam/Scriptlets/blob/master/wiki/about-trusted-scriptlets.md#-%EF%B8%8F-trusted-set-attr
 * 
 * @param selector
 * A CSS selector for the elements to target.
 * 
 * @param attr
 * The name of the attribute to modify.
 * 
 * @param value
 * The new value of the attribute. Since the scriptlet requires a trusted
 * source, the value can be anything.
 * 
 * */

export function trustedSetAttr(
    selector = '',
    attr = '',
    value = ''
) {
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('trusted-set-attr', selector, attr, value);
    setAttrFn(logPrefix, selector, attr, value);
}
trustedSetAttr.details = {
    name: 'trusted-set-attr.js',
    requiresTrust: true,
    dependencies: [
        safeSelf,
        setAttrFn,
    ],
    world: 'ISOLATED',
};

/******************************************************************************/

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

import { registerScriptlet } from './base.js';
import { safeSelf } from './safe-self.js';

/******************************************************************************/

/**
 * @scriptlet trusted-create-element
 * 
 * @description
 * Element(s) from a parsed HTML string are added as child element(s) to a
 * specific parent element in the DOM.
 * 
 * @param parent
 * A CSS selector identifying the element to which created element(s) will be
 * added.
 * 
 * @param html
 * An HTML string to be parsed using DOMParser, and which resulting elements
 * are to be added as child element(s).
 * 
 * @param duration
 * Optional. If specified, the time in ms after which the added elements will
 * be removed. No removal will occur if not specified.
 * 
 * */

function trustedCreateElement(
    parentSelector,
    htmlStr = '',
    durationStr = ''
) {
    if ( parentSelector === '' ) { return; }
    if ( htmlStr === '' ) { return; }
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('trusted-create-element', parentSelector, htmlStr, durationStr);
    // We do not want to recursively create elements
    self.trustedCreateElement = true;
    let ancestor = self.frameElement;
    while ( ancestor !== null ) {
        const doc = ancestor.ownerDocument;
        if ( doc === null ) { break; }
        const win = doc.defaultView;
        if ( win === null ) { break; }
        if ( win.trustedCreateElement ) { return; }
        ancestor = ancestor.frameElement;
    }
    const duration = parseInt(durationStr, 10);
    const domParser = new DOMParser();
    const externalDoc = domParser.parseFromString(htmlStr, 'text/html');
    const docFragment = new DocumentFragment();
    const toRemove = [];
    for ( const external of externalDoc.querySelectorAll('body > *') ) {
        const imported = document.adoptNode(external);
        docFragment.append(imported);
        if ( isNaN(duration) ) { continue; }
        toRemove.push(imported);
    }
    if ( docFragment.childElementCount === 0 ) { return; }
    const remove = ( ) => {
        for ( const elem of toRemove ) {
            elem.remove();
        }
        safe.uboLog(logPrefix, 'Element(s) removed');
    };
    const append = ( ) => {
        const parent = document.querySelector(parentSelector);
        if ( parent === null ) { return false; }
        parent.append(docFragment);
        safe.uboLog(logPrefix, 'Element(s) appended');
        if ( toRemove.length === 0 ) { return true; }
        setTimeout(remove, duration);
        return true;
    };
    if ( append() ) { return; }
    const observer = new MutationObserver(( ) => {
        if ( append() === false ) { return; }
        observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
}
registerScriptlet(trustedCreateElement, {
    name: 'trusted-create-element.js',
    requiresTrust: true,
    dependencies: [
        safeSelf,
    ],
    world: 'ISOLATED',
});

/******************************************************************************/

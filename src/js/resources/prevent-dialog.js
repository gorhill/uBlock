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

/**
 * @scriptlet prevent-dialog
 * 
 * @description
 * Programmatically close `dialog` elements.
 * 
 * @param [selector]
 * Optional. The dialog element must matches `dialog{selector}` for the
 * prevention to take place.
 * 
 * @usage:
 * example.com##+js(prevent-dialog)
 * 
 * */

export function preventDialog(
    selector = '',
) {
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('prevent-dialog', selector);
    const prevent = ( ) => {
        debouncer = undefined;
        const elems = document.querySelectorAll(`dialog${selector}`);
        for ( const elem of elems ) {
            if ( typeof elem.close !== 'function' ) { continue; }
            if ( elem.open === false ) { continue; }
            elem.close();
            safe.uboLog(logPrefix, 'Closed');
        }
    };
    let debouncer;
    const observer = new MutationObserver(( ) => {
        if ( debouncer !== undefined ) { return; }
        debouncer = requestAnimationFrame(prevent);
    });
    observer.observe(document, {
        attributes: true,
        childList: true,
        subtree: true,
    });
}
registerScriptlet(preventDialog, {
    name: 'prevent-dialog.js',
    dependencies: [
        safeSelf,
    ],
});

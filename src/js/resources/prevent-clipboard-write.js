/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
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
*/

import { proxyApplyFn } from './proxy-apply.js';
import { registerScriptlet } from './base.js';
import { safeSelf } from './safe-self.js';

/******************************************************************************/

/**
 * @scriptlet prevent-clipboard-write
 * 
 * @description
 * Prevent the clipboard from being overwritten.
 * 
 * @param needle
 * A pattern or regex to match against the text for the prevention to occur.
 * 
 * @param domAlert
 * Optional. A vararg to be used to alert the user in case a clipboard write
 * operation was prevented. The parameter is composed of two parts separated by
 * `|`: the first part is a CSS selector used to target a DOM element which
 * content will be replaced with the text found in the second part.
 * 
 * @example 
 * ##+js(prevent-clipboard-write, /^bash <<</, domAlert, body|Clickfix attempt defused)
 * 
 * */

function preventClipboardWrite(needle = '') {
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('prevent-clipboard-write');
    const pattern = safe.initPattern(needle);
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 1);
    proxyApplyFn('navigator.clipboard.writeText', function(context) {
        const text = `${context.callArgs[0]}`.trim();
        if ( safe.testPattern(pattern, text) !== true ) {
            return context.reflect();
        }
        if ( extraArgs.domAlert ) {
            const match = /^([^|]+)\s*\|\s*(.+)/.exec(extraArgs.domAlert);
            if ( match ) {
                const elem = document.querySelector(match[1]);
                if ( elem ) {
                    elem.textContent = match[2];
                }
            }
        }
        safe.uboLog(logPrefix, 'Prevented:\n\t', text);
    });
}
registerScriptlet(preventClipboardWrite, {
    name: 'prevent-clipboard-write.js',
    requiresTrust: true,
    dependencies: [
        proxyApplyFn,
        safeSelf,
    ],
});

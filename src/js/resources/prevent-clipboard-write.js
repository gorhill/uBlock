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
 * `|`: the first part is a CSS selector used to lookup the DOM element to be
 * used as container of the text found in the second part.
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
    const domAlert = clipboardText => {
        const doc = document;
        const div = doc.createElement('div');
        const span = doc.createElement('span');
        span.style = 'flex-grow:1;padding:0.5em 0 0.5em 0.5em;';
        const { domAlert } = extraArgs;
        const placeholder = /\$\{text\}/.exec(domAlert);
        if ( placeholder ) {
            const code = doc.createElement('code');
            code.style = 'background-color:#ddc;font-family:monospace;padding:0.25em;user-select:none;word-break:break-all';
            code.textContent = clipboardText;
            span.append(
                domAlert.slice(0, placeholder.index),
                code,
                domAlert.slice(placeholder.index + placeholder[0].length)
            );
        } else {
            span.append(domAlert);
        }
        const button = doc.createElement('button');
        button.style = 'padding:1em';
        button.textContent = '×';
        button.addEventListener('click', ( ) => {
            if ( currentAlert === null ) { return; }
            currentAlert.remove();
            currentAlert = null;
        });
        div.append(span, button);
        div.style = 'background-color:beige;color:black;border:1px solid black;display:flex;font-size:medium;position:fixed;text-align:center;top:0;width:100%;z-index:2147483647';
        doc.documentElement.append(div);
        if ( currentAlert ) {
            currentAlert.remove();
        }
        currentAlert = div;
    };
    let currentAlert = null;
    const prevent = text => {
        if ( typeof text !== 'string' ) { return; }
        text = text.trim();
        if ( safe.testPattern(pattern, text) !== true ) { return; }
        if ( extraArgs.domAlert ) {
            domAlert(text);
        }
        safe.uboLog(logPrefix, 'Prevented:\n\t', text);
        return true;
    };
    proxyApplyFn('navigator.clipboard.writeText', function(context) {
        const text = `${context.callArgs[0]}`;
        if ( prevent(text) ) { return; }
        return context.reflect();
    });
    proxyApplyFn('document.execCommand', function(context) {
        const { callArgs } = context;
        if ( callArgs[0] === 'copy' || callArgs[0] === 'cut' ) {
            const text = document.getSelection()?.toString();
            if ( text && prevent(text) ) { return; }
        }
        return context.reflect();
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

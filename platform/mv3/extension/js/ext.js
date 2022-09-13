/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2022-present Raymond Hill

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

const browser =
    self.browser instanceof Object &&
    self.browser instanceof Element === false
        ? self.browser
        : self.chrome;

const dnr = browser.declarativeNetRequest;
const i18n = browser.i18n;
const runtime = browser.runtime;

/******************************************************************************/

// The extension's service worker can be evicted at any time, so when we
// send a message, we try a few more times when the message fails to be sent.

function sendMessage(msg) {
    return new Promise((resolve, reject) => {
        let i = 5;
        const send = ( ) => {
            runtime.sendMessage(msg).then(response => {
                resolve(response);
            }).catch(reason => {
                i -= 1;
                if ( i <= 0 ) {
                    reject(reason);
                } else {
                    setTimeout(send, 200);
                }
            });
        };
        send();
    });
}

/******************************************************************************/

export { browser, dnr, i18n, runtime, sendMessage };

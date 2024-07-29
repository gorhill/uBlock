/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
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

export const browser =
    self.browser instanceof Object &&
    self.browser instanceof Element === false
        ? self.browser
        : self.chrome;

export const dnr = browser.declarativeNetRequest;
export const i18n = browser.i18n;
export const runtime = browser.runtime;
export const windows = browser.windows;

/******************************************************************************/

// The extension's service worker can be evicted at any time, so when we
// send a message, we try a few more times when the message fails to be sent.

export function sendMessage(msg) {
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

export async function localRead(key) {
    if ( browser.storage instanceof Object === false ) { return; }
    if ( browser.storage.local instanceof Object === false ) { return; }
    try {
        const bin = await browser.storage.local.get(key);
        if ( bin instanceof Object === false ) { return; }
        return bin[key] ?? undefined;
    } catch(ex) {
    }
}

export async function localWrite(key, value) {
    if ( browser.storage instanceof Object === false ) { return; }
    if ( browser.storage.local instanceof Object === false ) { return; }
    return browser.storage.local.set({ [key]: value });
}

export async function localRemove(key) {
    if ( browser.storage instanceof Object === false ) { return; }
    if ( browser.storage.local instanceof Object === false ) { return; }
    return browser.storage.local.remove(key);
}

/******************************************************************************/

export async function sessionRead(key) {
    if ( browser.storage instanceof Object === false ) { return; }
    if ( browser.storage.session instanceof Object === false ) { return; }
    try {
        const bin = await browser.storage.session.get(key);
        if ( bin instanceof Object === false ) { return; }
        return bin[key] ?? undefined;
    } catch(ex) {
    }
}

export async function sessionWrite(key, value) {
    if ( browser.storage instanceof Object === false ) { return; }
    if ( browser.storage.session instanceof Object === false ) { return; }
    return browser.storage.session.set({ [key]: value });
}

/******************************************************************************/

export async function adminRead(key) {
    if ( browser.storage instanceof Object === false ) { return; }
    if ( browser.storage.managed instanceof Object === false ) { return; }
    try {
        const bin = await browser.storage.managed.get(key);
        if ( bin instanceof Object === false ) { return; }
        return bin[key] ?? undefined;
    } catch(ex) {
    }
}

/******************************************************************************/

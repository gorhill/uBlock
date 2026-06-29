/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2026-present Raymond Hill

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

// Firefox does not support natively the offscreen API

let offscreenContext = null;

export const supportsOffscreenDocument = true;

export async function createOffscreenDocument(path) {
    const { promise, resolve, reject } = Promise.withResolvers();
    if ( offscreenContext !== null ) {
        reject('Only one offscreen context allowed');
        return promise;
    }
    offscreenContext = document.createElement('iframe');
    offscreenContext.src = browser.runtime.getURL(path);
    offscreenContext.onload = ( ) => { resolve(); };
    document.body.append(offscreenContext);
    return promise;
}

export async function closeOffscreenDocument() {
    if ( offscreenContext === null ) { return; }
    offscreenContext.remove();
    offscreenContext = null;
}

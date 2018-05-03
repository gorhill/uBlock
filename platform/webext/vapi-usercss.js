/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2018 Raymond Hill

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

'use strict';

// This file can be replaced by platform-specific code. If a platform is
// known to NOT support user stylsheets, vAPI.supportsUserStylesheets can be
// set to `false`.

// Chromium 66 and above supports user stylesheets:
// https://github.com/gorhill/uBlock/issues/3588

if ( typeof vAPI === 'object' ) {
    vAPI.supportsUserStylesheets =
        /\bChrom(?:e|ium)\/(?:6[6789]|[789]|1\d\d)|\bFirefox\/\d/.test(navigator.userAgent);
}








/*******************************************************************************

    DO NOT:
    - Remove the following code
    - Add code beyond the following code
    Reason:
    - https://github.com/gorhill/uBlock/pull/3721
    - uBO never uses the return value from injected content scripts

**/

void 0;

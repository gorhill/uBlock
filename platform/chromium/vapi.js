/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2017 The uBlock Origin authors

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

/* global HTMLDocument, XMLDocument */

// For background page, auxiliary pages, and content scripts.

/******************************************************************************/

// https://bugzilla.mozilla.org/show_bug.cgi?id=1408996#c9
var vAPI = window.vAPI; // jshint ignore:line

// https://github.com/chrisaljoudi/uBlock/issues/464
// https://github.com/chrisaljoudi/uBlock/issues/1528
//   A XMLDocument can be a valid HTML document.

// https://github.com/gorhill/uBlock/issues/1124
//   Looks like `contentType` is on track to be standardized:
//   https://dom.spec.whatwg.org/#concept-document-content-type

// https://forums.lanik.us/viewtopic.php?f=64&t=31522
//   Skip text/plain documents.

if (
    (document instanceof HTMLDocument ||
      document instanceof XMLDocument &&
      document.createElement('div') instanceof HTMLDivElement
    ) &&
    (/^image\/|^text\/plain/.test(document.contentType || '') === false)
) {
    vAPI = window.vAPI = vAPI instanceof Object && vAPI.uBO === true
        ? vAPI
        : { uBO: true };
}

/******************************************************************************/

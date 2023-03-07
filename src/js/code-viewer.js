/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2023-present Raymond Hill

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

/* globals CodeMirror, uBlockDashboard, beautifier */

'use strict';

/******************************************************************************/

import { dom, qs$ } from './dom.js';

/******************************************************************************/

(async ( ) => {
    const params = new URLSearchParams(document.location.search);
    const url = params.get('url');
    const a = qs$('.cm-search-widget .sourceURL');
    dom.attr(a, 'href', url);
    dom.attr(a, 'title', url);
    const response = await fetch(url);
    const text = await response.text();
    let mime = response.headers.get('Content-Type') || '';
    mime = mime.replace(/\s*;.*$/, '').trim();
    let value = '';
    switch ( mime ) {
        case 'text/css':
            value = beautifier.css(text, { indent_size: 2 });
            break;
        case 'text/html':
        case 'application/xhtml+xml':
        case 'application/xml':
        case 'image/svg+xml':
            value = beautifier.html(text, { indent_size: 2 });
            break;
        case 'text/javascript':
        case 'application/javascript':
        case 'application/x-javascript':
            value = beautifier.js(text, { indent_size: 4 });
            break;
        case 'application/json':
            value = beautifier.js(text, { indent_size: 2 });
            break;
        default:
            value = text;
            break;
    }
    const cmEditor = new CodeMirror(qs$('#content'), {
        autofocus: true,
        gutters: [ 'CodeMirror-linenumbers' ],
        lineNumbers: true,
        lineWrapping: true,
        matchBrackets: true,
        mode: mime,
        styleActiveLine: {
            nonEmpty: true,
        },
        value,
    });
    uBlockDashboard.patchCodeMirrorEditor(cmEditor);
    if ( dom.cl.has(dom.html, 'dark') ) {
        dom.cl.add('#content .cm-s-default', 'cm-s-night');
        dom.cl.remove('#content .cm-s-default', 'cm-s-default');
    }
})();

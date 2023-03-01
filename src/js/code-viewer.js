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
    const formatOptions = { indent_size: 2 };
    let value = '', mode = '';
    switch ( params.get('type') ) {
        case 'css':
            mode = 'text/css';
            value = beautifier.css(text, formatOptions);
            break;
        case 'html':
            mode = 'text/html';
            value = beautifier.html(text, formatOptions);
            break;
        case 'js':
            mode = 'text/javascript';
            value = beautifier.js(text, formatOptions);
            break;
        default:
            break;
    }
    const cmEditor = new CodeMirror(qs$('#content'), {
        autofocus: true,
        gutters: [ 'CodeMirror-linenumbers' ],
        lineNumbers: true,
        lineWrapping: true,
        mode,
        readOnly: true,
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

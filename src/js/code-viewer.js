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

const urlToTextMap = new Map();
const params = new URLSearchParams(document.location.search);
let fromURL = '';

const cmEditor = new CodeMirror(qs$('#content'), {
    autofocus: true,
    gutters: [ 'CodeMirror-linenumbers' ],
    lineNumbers: true,
    lineWrapping: true,
    matchBrackets: true,
    styleActiveLine: {
        nonEmpty: true,
    },
});

uBlockDashboard.patchCodeMirrorEditor(cmEditor);
if ( dom.cl.has(dom.html, 'dark') ) {
    dom.cl.add('#content .cm-s-default', 'cm-s-night');
    dom.cl.remove('#content .cm-s-default', 'cm-s-default');
}

// Convert resource URLs into clickable links to code viewer
cmEditor.addOverlay({
    re: /\b(?:href|src)=["']([^"']+)["']/g,
    match: null,
    token: function(stream) {
        if ( stream.sol() ) {
            this.re.lastIndex = 0;
            this.match = this.re.exec(stream.string);
        }
        if ( this.match === null ) {
            stream.skipToEnd();
            return null;
        }
        const end = this.re.lastIndex - 1;
        const beg = end - this.match[1].length;
        if ( stream.pos < beg ) {
            stream.pos = beg;
            return null;
        }
        if ( stream.pos < end ) {
            stream.pos = end;
            return 'href';
        }
        if ( stream.pos < this.re.lastIndex ) {
            stream.pos = this.re.lastIndex;
            this.match = this.re.exec(stream.string);
            return null;
        }
        stream.skipToEnd();
        return null;
    },
});

/******************************************************************************/

async function fetchResource(url) {
    if ( urlToTextMap.has(url) ) {
        return urlToTextMap.get(url);
    }
    let response, text;
    try {
        response = await fetch(url);
        text = await response.text();
    } catch(reason) {
        return;
    }
    let mime = response.headers.get('Content-Type') || '';
    mime = mime.replace(/\s*;.*$/, '').trim();
    switch ( mime ) {
        case 'text/css':
            text = beautifier.css(text, { indent_size: 2 });
            break;
        case 'text/html':
        case 'application/xhtml+xml':
        case 'application/xml':
        case 'image/svg+xml':
            text = beautifier.html(text, { indent_size: 2 });
            break;
        case 'text/javascript':
        case 'application/javascript':
        case 'application/x-javascript':
            text = beautifier.js(text, { indent_size: 4 });
            break;
        case 'application/json':
            text = beautifier.js(text, { indent_size: 2 });
            break;
        default:
            break;
    }
    urlToTextMap.set(url, { mime, text });
    return { mime, text };
}

/******************************************************************************/

function updatePastURLs(url) {
    const list = qs$('#pastURLs');
    let current;
    for ( let i = 0; i < list.children.length; i++ ) {
        const span = list.children[i];
        dom.cl.remove(span, 'selected');
        if ( span.textContent !== url ) { continue; }
        current = span;
    }
    if ( current === undefined ) {
        current = document.createElement('span');
        current.textContent = url;
        list.prepend(current);
    }
    dom.cl.add(current, 'selected');
}

/******************************************************************************/

async function setURL(resourceURL) {
    const input = qs$('#header input[type="url"]');
    let to;
    try {
        to = new URL(resourceURL, fromURL || undefined);
    } catch(ex) {
    }
    if ( to === undefined ) { return; }
    if ( /^https?:\/\/./.test(to.href) === false ) { return; }
    if ( to.href === fromURL ) { return; }
    let r;
    try {
        r = await fetchResource(to.href);
    } catch(reason) {
    }
    if ( r === undefined ) { return; }
    fromURL = to.href;
    dom.attr(input, 'value', to.href);
    input.value = to;
    const a = qs$('.cm-search-widget .sourceURL');
    dom.attr(a, 'href', to);
    dom.attr(a, 'title', to);
    cmEditor.setOption('mode', r.mime || '');
    cmEditor.setValue(r.text);
    updatePastURLs(to.href);
    cmEditor.focus();
}

/******************************************************************************/

setURL(params.get('url'));

dom.on('#header input[type="url"]', 'change', ev => {
    setURL(ev.target.value);
});

dom.on('#pastURLs', 'mousedown', 'span', ev => {
    setURL(ev.target.textContent);
});

dom.on('#content', 'click', '.cm-href', ev => {
    setURL(ev.target.textContent);
});

/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-present Raymond Hill

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

// Code below has been imported from uMatrix and modified to fit uBO:
// https://github.com/gorhill/uMatrix/blob/3f8794dd899a05e066c24066c6c0a2515d5c60d2/src/js/contentscript.js#L464-L531

'use strict';

/******************************************************************************/

// https://github.com/gorhill/uMatrix/issues/232
//   Force `display` property, Firefox is still affected by the issue.

(function() {
    let noscripts = document.querySelectorAll('noscript');
    if ( noscripts.length === 0 ) { return; }

    let redirectTimer,
        reMetaContent = /^\s*(\d+)\s*;\s*url=(['"]?)([^'"]+)\2/i,
        reSafeURL = /^https?:\/\//;

    let autoRefresh = function(root) {
        let meta = root.querySelector('meta[http-equiv="refresh"][content]');
        if ( meta === null ) { return; }
        let match = reMetaContent.exec(meta.getAttribute('content'));
        if ( match === null || match[3].trim() === '' ) { return; }

        let url;
        try {
            url = new URL(match[3], document.baseURI);
        } catch(ex) {
            return;
        }

        if ( reSafeURL.test(url.href) === false ) { return; }
        redirectTimer = setTimeout(( ) => {
                location.assign(url.href);
            },
            parseInt(match[1], 10) * 1000 + 1
        );
        meta.parentNode.removeChild(meta);
    };

    let morphNoscript = function(from) {
        if ( /^application\/(?:xhtml\+)?xml/.test(document.contentType) ) {
            let to = document.createElement('span');
            while ( from.firstChild !== null ) {
                to.appendChild(from.firstChild);
            }
            return to;
        }
        let parser = new DOMParser();
        let doc = parser.parseFromString(
            '<span>' + from.textContent + '</span>',
            'text/html'
        );
        return document.adoptNode(doc.querySelector('span'));
    };

    for ( let noscript of noscripts ) {
        let parent = noscript.parentNode;
        if ( parent === null ) { continue; }
        let span = morphNoscript(noscript);
        span.style.setProperty('display', 'inline', 'important');
        if ( redirectTimer === undefined ) {
            autoRefresh(span);
        }
        parent.replaceChild(span, noscript);
    }
})();

/******************************************************************************/

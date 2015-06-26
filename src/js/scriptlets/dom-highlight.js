/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015 Raymond Hill

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

/* global vAPI, HTMLDocument */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/464
if ( document instanceof HTMLDocument === false ) {
    return;
}

// This can happen
if ( typeof vAPI !== 'object' ) {
    return;
}

/******************************************************************************/

if ( document.querySelector('iframe.dom-highlight.' + vAPI.sessionId) !== null ) {
    return;
}

/******************************************************************************/

var localMessager = null;
var svgOcean = null;
var svgIslands = null;
var svgRoot = null;
var pickerRoot = null;
var currentSelector = '';

var toggledNodes = new Map();

/******************************************************************************/

var highlightElements = function(elems, scrollTo) {
    var wv = pickerRoot.contentWindow.innerWidth;
    var hv = pickerRoot.contentWindow.innerHeight;
    var ocean = ['M0 0h' + wv + 'v' + hv + 'h-' + wv, 'z'];
    var islands = [];
    var elem, rect, poly;
    var xl, xr, yt, yb, w, h, ws;
    var xlu = Number.MAX_VALUE, xru = 0, ytu = Number.MAX_VALUE, ybu = 0;

    for ( var i = 0; i < elems.length; i++ ) {
        elem = elems[i];
        if ( elem === pickerRoot ) {
            continue;
        }
        if ( typeof elem.getBoundingClientRect !== 'function' ) {
            continue;
        }

        rect = elem.getBoundingClientRect();
        xl = rect.left;
        xr = rect.right;
        w = rect.width;
        yt = rect.top;
        yb = rect.bottom;
        h = rect.height;

        ws = w.toFixed(1);
        poly = 'M' + xl.toFixed(1) + ' ' + yt.toFixed(1) +
               'h' + ws +
               'v' + h.toFixed(1) +
               'h-' + ws +
               'z';
        ocean.push(poly);
        islands.push(poly);

        if ( !scrollTo ) {
            continue;
        }

        if ( xl < xlu ) { xlu = xl; }
        if ( xr > xru ) { xru = xr; }
        if ( yt < ytu ) { ytu = yt; }
        if ( yb > ybu ) { ybu = yb; }
    }
    svgOcean.setAttribute('d', ocean.join(''));
    svgIslands.setAttribute('d', islands.join('') || 'M0 0');

    if ( !scrollTo ) {
        return;
    }

    // Highlighted area completely within viewport
    if ( xlu >= 0 && xru <= wv && ytu >= 0 && ybu <= hv ) {
        return;
    }

    var dx = 0, dy = 0;

    if ( xru > wv ) {
        dx = xru - wv;
        xlu -= dx;
    }
    if ( xlu <  0 ) {
        dx += xlu;
    }
    if ( ybu > hv ) {
        dy = ybu - hv;
        ytu -= dy;
    }
    if ( ytu <  0 ) {
        dy += ytu;
    }

    if ( dx !== 0 || dy !== 0 ) {
        window.scrollBy(dx, dy);
    }
};

/******************************************************************************/

var elementsFromSelector = function(filter) {
    var out = [];
    try {
        out = document.querySelectorAll(filter);
    } catch (ex) {
    }
    return out;
};

/******************************************************************************/

var highlight = function(scrollTo) {
    var elements = elementsFromSelector(currentSelector);
    highlightElements(elements, scrollTo);
};

/******************************************************************************/

var onScrolled = function() {
    highlight();
};

/******************************************************************************/

// original, target = what to do
//      any,    any = restore saved display property
//      any, hidden = set display to `none`, remember original state
//   hidden,    any = remove display property, don't remember original state
//   hidden, hidden = set display to `none`

var toggleNodes = function(selector, originalState, targetState) {
    var nodes = document.querySelectorAll(selector);
    var i = nodes.length;
    if ( i === 0 ) {
        return;
    }
    var node, value;
    while ( i-- ) {
        node = nodes[i];
        if ( originalState ) {                              // any, ?
            if ( targetState ) {                            // any, any
                value = toggledNodes.get(node);
                if ( value === undefined ) {
                    continue;
                }
                if ( value !== null ) {
                    node.style.removeProperty('display');
                } else {
                    node.style.setProperty('display', value);
                }
                toggledNodes.delete(node);
            } else {                                        // any, hidden
                toggledNodes.set(node, node.style.getPropertyValue('display') || null);
                node.style.setProperty('display', 'none');
            }
        } else {                                            // hidden, ?
            if ( targetState ) {                            // hidden, any
                node.style.setProperty('display', 'initial', 'important');
            } else {                                        // hidden, hidden
                node.style.setProperty('display', 'none', 'important');
            }
        }
    }
};

/******************************************************************************/

var resetToggledNodes = function() {
    // Chromium does not support destructuring as of v43.
    for ( var node of toggledNodes.keys() ) {
        value = toggledNodes.get(node);
        if ( value !== null ) {
            node.style.removeProperty('display');
        } else {
            node.style.setProperty('display', value);
        }
    }
    toggledNodes.clear();
};

/******************************************************************************/

var shutdown = function() {
    resetToggledNodes();
    localMessager.removeListener(onMessage);
    localMessager.close();
    localMessager = null;
    window.removeEventListener('scroll', onScrolled, true);
    document.documentElement.removeChild(pickerRoot);
    pickerRoot = svgRoot = svgOcean = svgIslands = null;
    currentSelector = '';
};

/******************************************************************************/

var onMessage = function(msg) {
    if ( msg.what !== 'dom-highlight' ) {
        return;
    }
    switch ( msg.action ) {
    case 'highlight':
        currentSelector = msg.selector;
        highlight(msg.scrollTo);
        break;

    case 'toggleNodes':
        toggleNodes(msg.selector, msg.original, msg.target);
        currentSelector = msg.selector;
        highlight(true);
        break;

    case 'shutdown':
        shutdown();
        break;

    default:
        break;
    }
};

/******************************************************************************/

(function() {
    pickerRoot = document.createElement('iframe');
    pickerRoot.classList.add(vAPI.sessionId);
    pickerRoot.classList.add('dom-highlight');
    pickerRoot.style.cssText = [
        'background: transparent',
        'border: 0',
        'border-radius: 0',
        'box-shadow: none',
        'display: block',
        'height: 100%',
        'left: 0',
        'margin: 0',
        'opacity: 1',
        'position: fixed',
        'outline: 0',
        'padding: 0',
        'top: 0',
        'visibility: visible',
        'width: 100%',
        'z-index: 2147483647',
        ''
    ].join(' !important;\n');

    pickerRoot.onload = function() {
        pickerRoot.onload = null;
        var pickerDoc = this.contentDocument;

        var style = pickerDoc.createElement('style');
        style.textContent = [
            'body {',
                'background-color: transparent;',
                'cursor: crosshair;',
            '}',
            'svg {',
                'height: 100%;',
                'left: 0;',
                'position: fixed;',
                'top: 0;',
                'width: 100%;',
            '}',
            'svg > path:first-child {',
                'fill: rgba(0,0,0,0.75);',
                'fill-rule: evenodd;',
            '}',
            'svg > path + path {',
                'fill: rgba(0,0,255,0.1);',
                'stroke: #FFF;',
                'stroke-width: 0.5px;',
            '}',
            ''
        ].join('\n');
        pickerDoc.body.appendChild(style);

        svgRoot = pickerDoc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgOcean = pickerDoc.createElementNS('http://www.w3.org/2000/svg', 'path');
        svgRoot.appendChild(svgOcean);
        svgIslands = pickerDoc.createElementNS('http://www.w3.org/2000/svg', 'path');
        svgRoot.appendChild(svgIslands);
        pickerDoc.body.appendChild(svgRoot);

        window.addEventListener('scroll', onScrolled, true);

        localMessager = vAPI.messaging.channel('scriptlets');
        localMessager.addListener(onMessage);

        highlight();
    };

    document.documentElement.appendChild(pickerRoot);
})();

/******************************************************************************/

})();

/******************************************************************************/

/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

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

/* global CSS */
'use strict';

/******************************************************************************/
/******************************************************************************/

/*! http://mths.be/cssescape v0.2.1 by @mathias | MIT license */
;(function(root) {

    if (!root.CSS) {
        root.CSS = {};
    }

    var CSS = root.CSS;

    var InvalidCharacterError = function(message) {
        this.message = message;
    };
    InvalidCharacterError.prototype = new Error();
    InvalidCharacterError.prototype.name = 'InvalidCharacterError';

    if (!CSS.escape) {
        // http://dev.w3.org/csswg/cssom/#serialize-an-identifier
        CSS.escape = function(value) {
            var string = String(value);
            var length = string.length;
            var index = -1;
            var codeUnit;
            var result = '';
            var firstCodeUnit = string.charCodeAt(0);
            while (++index < length) {
                codeUnit = string.charCodeAt(index);
                // Note: there’s no need to special-case astral symbols, surrogate
                // pairs, or lone surrogates.

                // If the character is NULL (U+0000), then throw an
                // `InvalidCharacterError` exception and terminate these steps.
                if (codeUnit === 0x0000) {
                    throw new InvalidCharacterError(
                        'Invalid character: the input contains U+0000.'
                    );
                }

                if (
                    // If the character is in the range [\1-\1F] (U+0001 to U+001F) or is
                    // U+007F, […]
                    (codeUnit >= 0x0001 && codeUnit <= 0x001F) || codeUnit == 0x007F ||
                    // If the character is the first character and is in the range [0-9]
                    // (U+0030 to U+0039), […]
                    (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
                    // If the character is the second character and is in the range [0-9]
                    // (U+0030 to U+0039) and the first character is a `-` (U+002D), […]
                    (
                        index == 1 &&
                        codeUnit >= 0x0030 && codeUnit <= 0x0039 &&
                        firstCodeUnit == 0x002D
                    )
                ) {
                    // http://dev.w3.org/csswg/cssom/#escape-a-character-as-code-point
                    result += '\\' + codeUnit.toString(16) + ' ';
                    continue;
                }

                // If the character is not handled by one of the above rules and is
                // greater than or equal to U+0080, is `-` (U+002D) or `_` (U+005F), or
                // is in one of the ranges [0-9] (U+0030 to U+0039), [A-Z] (U+0041 to
                // U+005A), or [a-z] (U+0061 to U+007A), […]
                if (
                    codeUnit >= 0x0080 ||
                    codeUnit == 0x002D ||
                    codeUnit == 0x005F ||
                    codeUnit >= 0x0030 && codeUnit <= 0x0039 ||
                    codeUnit >= 0x0041 && codeUnit <= 0x005A ||
                    codeUnit >= 0x0061 && codeUnit <= 0x007A
                ) {
                    // the character itself
                    result += string.charAt(index);
                    continue;
                }

                // Otherwise, the escaped character.
                // http://dev.w3.org/csswg/cssom/#escape-a-character
                result += '\\' + string.charAt(index);

            }
            return result;
        };
    }

}(self));

/******************************************************************************/
/******************************************************************************/

/******************************************************************************/
/******************************************************************************/

(function() {

/******************************************************************************/

// don't run in frames
if (window.top !== window) {
    return;
}

// https://github.com/gorhill/uBlock/issues/314#issuecomment-58878112
// Using an id makes uBlock's CSS rules more specific, thus prevents
// surrounding external rules from winning over own rules.
var µBlockId = CSS.escape('µBlock');

var pickerRoot = document.getElementById(µBlockId);

if ( pickerRoot ) {
    return;
}

var localMessager = vAPI.messaging.channel('element-picker.js');

var svgns = 'http://www.w3.org/2000/svg';

var svgRoot = null;
var svgOcean = null;
var svgIslands = null;
var divDialog = null;
var taCandidate = null;
var urlNormalizer = null;

var netFilterCandidates = [];
var cosmeticFilterCandidates = [];

var targetElements = [];
var svgWidth = 0;
var svgHeight = 0;
var elementFromPointCSSProperty = 'pointerEvents';
var onSvgHoveredTimer = null;

/******************************************************************************/

var pickerPaused = function() {
    return pickerRoot.classList.contains('paused');
};

/******************************************************************************/

var pausePicker = function() {
    pickerRoot.classList.add('paused');
};

/******************************************************************************/

var unpausePicker = function() {
    pickerRoot.classList.remove('paused');
};

/******************************************************************************/

var pickerRootDistance = function(elem) {
    var distance = 0;
    while ( elem ) {
        if ( elem === pickerRoot ) {
            return distance;
        }
        elem = elem.parentNode;
        distance += 1;
    }
    return -1;
};

/******************************************************************************/

var highlightElements = function(elems, force) {
    // To make mouse move handler more efficient
    if ( !force && elems.length === targetElements.length ) {
        if ( elems.length === 0 || elems[0] === targetElements[0] ) {
            return;
        }
    }
    targetElements = elems;

    var ow = parseInt(svgRoot.style.width, 10);
    var ocean = [
        'M0 0',
        'h', ow,
        'v', parseInt(svgRoot.style.height, 10),
        'h-', ow,
        'z'
    ];
    var offx = window.pageXOffset;
    var offy = window.pageYOffset;
    var islands = [];

    var elem, rect, poly;
    for ( var i = 0; i < elems.length; i++ ) {
        elem = elems[i];
        if ( typeof elem.getBoundingClientRect !== 'function' ) {
            continue;
        }
        rect = elem.getBoundingClientRect();
        poly = 'M' + (rect.left + offx) + ' ' + (rect.top + offy) +
               'h' + rect.width +
               'v' + rect.height +
               'h-' + rect.width +
               'z';
        ocean.push(poly);
        islands.push(poly);
    }
    svgOcean.setAttribute('d', ocean.join(''));
    svgIslands.setAttribute('d', islands.join('') || 'M0 0');
};

/******************************************************************************/

var removeElements = function(elems) {
    var i = elems.length, elem;
    while ( i-- ) {
        elem = elems[i];
        if ( elem.parentNode ) {
            elem.parentNode.removeChild(elem);
        }
    }
};

/******************************************************************************/

// Extract the best possible net filter, i.e. as specific as possible.

var netFilterFromElement = function(elem, out) {
    if ( elem === null ) {
        return;
    }
    if ( elem.nodeType !== 1 ) {
        return;
    }
    var tagName = elem.tagName.toLowerCase();
    if ( tagName !== 'img' && tagName !== 'iframe' ) {
        return;
    }
    var src = elem.getAttribute('src');
    if ( typeof src !== 'string' || src.length === 0 ) {
        return;
    }
    // Remove fragment
    var pos = src.indexOf('#');
    if ( pos !== -1 ) {
        src = src.slice(0, pos);
    }
    // Feed the attribute to a link element, then retrieve back: this
    // should normalize it.
    urlNormalizer.href = src;
    src = urlNormalizer.href;
    // Anchor absolute filter to hostname
    src = src.replace(/^https?:\/\//, '||');
    out.push(src);
    // Suggest a less narrow filter if possible
    pos = src.indexOf('?');
    if ( pos !== -1 ) {
        src = src.slice(0, pos);
        out.push(src);
    }
};

/******************************************************************************/

// Extract the best possible cosmetic filter, i.e. as specific as possible.

var cosmeticFilterFromElement = function(elem, out) {
    if ( elem === null ) {
        return;
    }
    if ( elem.nodeType !== 1 ) {
        return;
    }
    var tagName = elem.tagName.toLowerCase();
    var prefix = '';
    var suffix = [];
    var v;

    // Id
    v = typeof elem.id === 'string' && CSS.escape(elem.id);
    if ( v ) {
        suffix.push('#', v);
    }

    // Class(es)
    v = typeof elem.className === 'string' && elem.className.trim();
    if ( v.length ) {
        v = v.split(/\s+/);
        var i = v.length;
        while ( i-- ) {
            v[i] = CSS.escape(v[i]);
        }
        suffix.push('.', v.join('.'));
    }

    if ( suffix.length === 0 ) {
        prefix = tagName;
    }

    // Attributes (depends on tag name)
    var attributes = [], attr;
    switch ( tagName ) {
    case 'a':
        v = elem.getAttribute('href');
        if ( v ) {
            v = v.replace(/\?.*$/, '');
            if ( v.length ) {
                attributes.push({ k: 'href', v: v });
            }
        }
        break;
    case 'img':
        v = elem.getAttribute('alt');
        if ( v && v.length !== 0 ) {
            attributes.push({ k: 'alt', v: v });
        }
        break;
    default:
        break;
    }
    while ( attr = attributes.pop() ) {
        if ( attr.v.length === 0 ) {
            continue;
        }
        v = elem.getAttribute(attr.k);
        if ( attr.v === v ) {
            suffix.push('[', attr.k, '="', attr.v, '"]');
        } else if ( v.indexOf(attr.v) === 0 ) {
            suffix.push('[', attr.k, '^="', attr.v, '"]');
        } else {
            suffix.push('[', attr.k, '*="', attr.v, '"]');
        }
    }

    out.push('##' + prefix + suffix.join(''));
};

/******************************************************************************/

var filtersFromElement = function(elem) {
    netFilterCandidates.length = 0;
    cosmeticFilterCandidates.length = 0;
    while ( elem && elem !== document.body ) {
        netFilterFromElement(elem, netFilterCandidates);
        cosmeticFilterFromElement(elem, cosmeticFilterCandidates);
        elem = elem.parentNode;
    }
};

/******************************************************************************/

var elementsFromFilter = function(filter) {
    var out = [];

    // Cosmetic filters: these are straight CSS selectors
    // TODO: This is still not working well for a[href], because there are
    // many ways to compose a valid href to the same effective URL.
    // One idea is to normalize all a[href] on the page, but for now I will
    // wait and see, as I prefer to refrain from tampering with the page
    // content if I can avoid it.
    if ( filter.slice(0, 2) === '##' ) {
        try {
            out = document.querySelectorAll(filter.replace('##', ''));
        }
        catch (e) {
        }
        return out;
    }

    // Net filters: we need to lookup manually -- translating into a
    // foolproof CSS selector is just not possible
    if ( filter.slice(0, 2) === '||' ) {
        filter = filter.replace('||', '');
    }
    var elems = document.querySelectorAll('[src]');
    var i = elems.length;
    var elem;
    while ( i-- ) {
        elem = elems[i];
        if ( typeof elem.src !== 'string' ) {
            continue;
        }
        if ( elem.src.indexOf(filter) !== -1 ) {
            out.push(elem);
        }
    }
    return out;
};

// https://www.youtube.com/watch?v=YI2XuIOW3gM

/******************************************************************************/

var userFilterFromCandidate = function() {
    var v = taCandidate.value;

    var elems = elementsFromFilter(v);
    if ( elems.length === 0 ) {
        return false;
    }

    // Cosmetic filter?
    if ( v.slice(0, 2) === '##' ) {
        return window.location.hostname + v;
    }

    // If domain included in filter, no need for domain option
    if ( v.slice(0, 2) === '||' ) {
        return v;
    }
    // Assume net filter
    return v + '$domain=' + window.location.hostname;
};

/******************************************************************************/

var onCandidateChanged = function() {
    var elems = elementsFromFilter(taCandidate.value);
    divDialog.querySelector('#create').disabled = elems.length === 0;
    highlightElements(elems);
};

/******************************************************************************/

var candidateFromFilterChoice = function(filterChoice) {
    var slot = filterChoice.slot;
    var filters = filterChoice.filters;
    var filter = filters[slot];

    if ( filter === undefined ) {
        return '';
    }

    // For net filters there no such thing as a path
    if ( filterChoice.type === 'net' || filterChoice.modifier ) {
        return filter;
    }

    // Return path: the target element, then all siblings prepended
    var selector = [];
    for ( ; slot < filters.length; slot++ ) {
        filter = filters[slot];
        selector.unshift(filter.replace(/^##/, ''));
        // Stop at any element with an id: these are unique in a web page
        if ( filter.slice(0, 3) === '###' ) {
            break;
        }
    }
    return '##' + selector.join(' > ');
};

/******************************************************************************/

var filterChoiceFromEvent = function(ev) {
    var li = ev.target;
    var isNetFilter = li.textContent.slice(0, 2) !== '##';
    var r = {
        type: isNetFilter ? 'net' : 'cosmetic',
        filters: isNetFilter ? netFilterCandidates : cosmeticFilterCandidates,
        slot: 0,
        modifier: ev.ctrlKey || ev.metaKey
    };
    while ( li.previousSibling !== null ) {
        li = li.previousSibling;
        r.slot += 1;
    }
    return r;
};

/******************************************************************************/

var onDialogClicked = function(ev) {
    if ( ev.target === null ) {
        /* do nothing */
    }

    else if ( ev.target.id === 'create' ) {
        var filter = userFilterFromCandidate();
        if ( filter ) {
            localMessager.send({ what: 'createUserFilter', filters: filter });
            removeElements(elementsFromFilter(taCandidate.value));
            stopPicker();
        }
    }

    else if ( ev.target.id === 'pick' ) {
        unpausePicker();
    }

    else if ( ev.target.id === 'quit' ) {
        stopPicker();
    }

    else if ( ev.target.tagName.toLowerCase() === 'li' && pickerRootDistance(ev.target) === 5 ) {
        taCandidate.value = candidateFromFilterChoice(filterChoiceFromEvent(ev));
        onCandidateChanged();
    }

    ev.stopPropagation();
    ev.preventDefault();
};

/******************************************************************************/

var removeAllChildren = function(parent) {
    while ( parent.firstChild ) {
        parent.removeChild(parent.firstChild);
    }
};

/******************************************************************************/

// TODO: for convenience I could provide a small set of net filters instead
// of just a single one. Truncating the right-most part of the path etc.

var showDialog = function(options) {
    pausePicker();

    options = options || {};

    // Create lists of candidate filters
    var populate = function(src, des) {
        var root = divDialog.querySelector(des);
        var ul = root.querySelector('ul');
        removeAllChildren(ul);
        var li;
        for ( var i = 0; i < src.length; i++ ) {
            li = document.createElement('li');
            li.textContent = src[i];
            ul.appendChild(li);
        }
        root.style.display = src.length !== 0 ? '' : 'none';
    };

    populate(netFilterCandidates, '#netFilters');
    populate(cosmeticFilterCandidates, '#cosmeticFilters');

    divDialog.querySelector('ul').style.display = netFilterCandidates.length || cosmeticFilterCandidates.length ? '' : 'none';
    divDialog.querySelector('#create').disabled = true;

    // Auto-select a candidate filter
    var filterChoice = {
        type: '',
        filters: [],
        slot: 0,
        modifier: options.modifier || false
    };
    if ( netFilterCandidates.length ) {
        filterChoice.type = 'net';
        filterChoice.filters = netFilterCandidates;
    } else if ( cosmeticFilterCandidates.length ) {
        filterChoice.type = 'cosmetic';
        filterChoice.filters = cosmeticFilterCandidates;
    }

    taCandidate.value = '';
    if ( filterChoice.type !== '' ) {
        taCandidate.value = candidateFromFilterChoice(filterChoice);
        onCandidateChanged();
    }
};

/******************************************************************************/

var elementFromPoint = function(x, y) {
    svgRoot.style[elementFromPointCSSProperty] = 'none';
    var elem = document.elementFromPoint(x, y);
    if ( elem === document.body || elem === document.documentElement ) {
        elem = null;
    }
    svgRoot.style[elementFromPointCSSProperty] = '';
    return elem;
};

/******************************************************************************/

var onSvgHovered = function(ev) {
    if ( pickerPaused() || onSvgHoveredTimer) {
        return;
    }

    onSvgHoveredTimer = setTimeout(function() {
        var elem = elementFromPoint(ev.clientX, ev.clientY);
        highlightElements(elem ? [elem] : []);
        onSvgHoveredTimer = null;
    }, 50);
};

/******************************************************************************/

var onSvgClicked = function(ev) {
    if ( pickerPaused() ) {
        return;
    }
    var elem = elementFromPoint(ev.clientX, ev.clientY);
    if ( elem === null ) {
        return;
    }
    filtersFromElement(elem);
    showDialog();
};

/******************************************************************************/

var onKeyPressed = function(ev) {
    if ( ev.key === 27 || ev.keyCode === 27 ) {
        ev.stopPropagation();
        ev.preventDefault();
        stopPicker();
    }
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/190
// May need to dynamically adjust the height of the overlay + new position
// of highlighted elements.

var onScrolled = function() {
    var newHeight = this.scrollY + this.innerHeight;
    if ( newHeight > svgHeight ) {
        svgHeight = newHeight;
        svgRoot.style.height = svgHeight + 'px';
        svgRoot.setAttribute('viewBox', '0 0 ' + svgWidth + ' ' + svgHeight);
    }
    highlightElements(targetElements, true);
};

/******************************************************************************/

// Let's have the element picker code flushed from memory when no longer
// in use: to ensure this, release all local references.

var stopPicker = function() {
    if ( pickerRoot !== null ) {
        window.removeEventListener('keydown', onKeyPressed, true);
        window.removeEventListener('scroll', onScrolled, true);
        taCandidate.removeEventListener('input', onCandidateChanged);
        divDialog.removeEventListener('click', onDialogClicked);
        svgRoot.removeEventListener('mousemove', onSvgHovered);
        svgRoot.removeEventListener('click', onSvgClicked);
        pickerRoot.parentNode.removeChild(pickerRoot);
        pickerRoot =
        divDialog =
        svgRoot = svgOcean = svgIslands =
        taCandidate =
        urlNormalizer = null;
        localMessager.close();
    }
    targetElements = [];
};

/******************************************************************************/

var startPicker = function(details) {
    pickerRoot = document.createElement('div');
    pickerRoot.id = µBlockId;
    pickerRoot.setAttribute('lang', navigator.language);

    var pickerStyle = document.createElement('style');
    pickerStyle.setAttribute('scoped', '');
    pickerStyle.textContent = [
        '#µBlock, #µBlock * {',
            'background: transparent;',
            'background-image: none;',
            'border: 0;',
            'border-radius: 0;',
            'box-shadow: none;',
            'color: #000;',
            'display: inline;',
            'float: none;',
            'font: 12px sans-serif;',
            'height: auto;',
            'letter-spacing: normal;',
            'margin: 0;',
            'max-width: none;',
            'min-height: 0;',
            'min-width: 0;',
            'outline: 0;',
            'overflow: visible;',
            'padding: 0;',
            'text-transform: none;',
            'vertical-align: baseline;',
            'width: auto;',
            'z-index: auto;',
        '}',
        '#µBlock {',
            'position: absolute;',
            'top: 0;',
            'left: 0;',
        '}',
        '#µBlock style, #µBlock script {',
            'display: none;',
        '}',
        '#µBlock ul, #µBlock li, #µBlock div {',
            'display: block;',
        '}',
        '#µBlock *::selection {',
            'background-color: Highlight;',
            'color: HighlightText;',
        '}',
        '#µBlock button {',
            'border: 1px solid #aaa !important;',
            'padding: 6px 8px 4px 8px;',
            'box-sizing: border-box;',
            'box-shadow: none;',
            'border-radius: 3px;',
            'display: inline;',
            'line-height: 1;',
            'color: #444;',
            'background-color: #ccc;',
            'cursor: pointer;',
        '}',
        '#µBlock button:hover {',
            'background: none;',
            'background-color: #eee;',
            'background-image: none;',
        '}',
        '#µBlock button:disabled {',
            'color: #999;',
            'background-color: #ccc;',
        '}',
        '#µBlock button#create:not(:disabled) {',
            'background-color: #ffdca8;',
        '}',
        '#µBlock > svg {',
            'position: absolute;',
            'top: 0;',
            'left: 0;',
            'pointer-events: auto;',
            'cursor: crosshair;',
            'z-index: 4999999999;',
        '}',
        '#µBlock.paused > svg {',
            'cursor: wait;',
        '}',
        '#µBlock > svg > path:first-child {',
            'fill: rgba(0,0,0,0.75);',
            'fill-rule: evenodd;',
        '}',
        '#µBlock > svg > path + path {',
            'stroke: #F00;',
            'stroke-width: 0.5px;',
            'fill: rgba(255,0,0,0.25);',
        '}',
        '#µBlock > div {',
            'background-color: rgba(255,255,255,0.9);',
            'bottom: 4px;',
            'display: none;',
            'font: 12px sans-serif;',
            'padding: 4px;',
            'position: fixed;',
            'right: 4px;',
            'width: 30em;',
            'z-index: 5999999999;',
        '}',
        '#µBlock.paused > div {',
            'opacity: 0.2;',
            'display: block;',
        '}',
        '#µBlock.paused > div:hover {',
            'opacity: 1;',
        '}',
        '#µBlock > div > div {',
            'box-sizing: border-box;',
            'display: inline-block;',
            'height: 8em;',
            'padding: 0;',
            'position: relative;',
            'width: 100%;',
        '}',
        '#µBlock > div > div > textarea {',
            'border: 1px solid #ccc;',
            'padding: 2px;',
            'box-sizing: border-box;',
            'width: 100% !important;',
            'height: 100% !important;',
            'overflow: hidden !important;',
            'resize: none;',
            'background-color: white;',
            'font: 11px monospace;',
        '}',
        '#µBlock > div > div > div {',
            'bottom: 2px;',
            'direction: ltr;',
            'opacity: 0.2;',
            'position: absolute;',
            'right: 2px;',
        '}',
        '#µBlock > div > div > div:hover {',
            'opacity: 1;',
        '}',
        '#µBlock > div > div > div > button {',
            'margin-left: 3px !important;',
        '}',
        '#µBlock > div > ul {',
            'margin: 0;',
            'list-style-type: none;',
            'text-align: left;',
            'overflow: hidden;',
        '}',
        '#µBlock > div > ul > li {',
            'padding-top: 3px;',
        '}',
        '#µBlock > div > ul > li > span:nth-of-type(1) {',
            'font-weight: bold;',
        '}',
        '#µBlock > div > ul > li > span:nth-of-type(2) {',
            'font-size: smaller;',
            'color: gray;',
        '}',
        '#µBlock > div > ul > li > ul {',
            'background-color: #eee;',
            'list-style-type: none;',
            'margin: 0 0 0 1em;',
            'overflow: hidden;',
            'text-align: left;',
        '}',
        '#µBlock > div > ul > li > ul > li {',
            'font: 11px monospace;',
            'white-space: nowrap;',
            'cursor: pointer;',
            'direction: ltr;',
        '}',
        '#µBlock > div > ul > li > ul > li:hover {',
            'background-color: rgba(255,255,255,1.0);',
        '}',
        ''
    ].join('\n');
    pickerRoot.appendChild(pickerStyle);

    svgRoot = document.createElementNS(svgns, 'svg');
    svgRoot.appendChild(document.createElementNS(svgns, 'path'));
    svgRoot.appendChild(document.createElementNS(svgns, 'path'));
    svgWidth = document.documentElement.scrollWidth;
    svgHeight = Math.max(
        document.documentElement.scrollHeight,
        window.scrollY + window.innerHeight
    );
    svgRoot.setAttribute('x', 0);
    svgRoot.setAttribute('y', 0);
    svgRoot.style.width = svgWidth + 'px';
    svgRoot.style.height = svgHeight + 'px';
    svgRoot.setAttribute('viewBox', '0 0 ' + svgWidth + ' ' + svgHeight);
    svgOcean = svgRoot.firstChild;
    svgIslands = svgRoot.lastChild;
    pickerRoot.appendChild(svgRoot);

    // TODO: do not rely on element ids, they could collide with whatever
    // is used in the page. Just use built-in hierarchy of elements as
    // selectors.

    divDialog = document.createElement('div');
    divDialog.innerHTML = [
        '<div>',
        '<textarea lang="en" dir="ltr" spellcheck="false"></textarea>',
        '<div>',
        '<button id="create" type="button" disabled="disabled">.</button>',
        '<button id="pick" type="button">.</button>',
        '<button id="quit" type="button">.</button>',
        '</div>',
        '</div>',
        '<ul>',
        '<li id="netFilters"><span>.</span><ul lang="en"></ul></li>',
        '<li id="cosmeticFilters"><span>.</span> <span>.</span><ul lang="en"></ul></li>',
        '</ul>'
    ].join('');
    pickerRoot.appendChild(divDialog);

    // https://github.com/gorhill/uBlock/issues/344#issuecomment-60775958
    // Insert in `html` tag, not `body` tag.
    document.documentElement.appendChild(pickerRoot);
    svgRoot.addEventListener('click', onSvgClicked);
    svgRoot.addEventListener('mousemove', onSvgHovered);
    divDialog.addEventListener('click', onDialogClicked);
    taCandidate = divDialog.querySelector('textarea');
    taCandidate.addEventListener('input', onCandidateChanged);
    urlNormalizer = document.createElement('a');
    window.addEventListener('scroll', onScrolled, true);
    window.addEventListener('keydown', onKeyPressed, true);

    highlightElements([], true);

    var i18nMap = {
        '#µBlock > div': '@@bidi_dir',
        '#create': 'create',
        '#pick': 'pick',
        '#quit': 'quit',
        'ul > li#netFilters > span:nth-of-type(1)': 'netFilters',
        'ul > li#cosmeticFilters > span:nth-of-type(1)': 'cosmeticFilters',
        'ul > li#cosmeticFilters > span:nth-of-type(2)': 'cosmeticFiltersHint'
    };

    if (details.i18n['@@bidi_dir']) {
        divDialog.style.direction = details.i18n['@@bidi_dir'];
        delete i18nMap['#µBlock > div'];
    }

    for ( var k in i18nMap ) {
        if ( i18nMap.hasOwnProperty(k) === false ) {
            continue;
        }
        divDialog.querySelector(k).firstChild.nodeValue = details.i18n[i18nMap[k]];
    }

    // First we test if pointer-events are hadnled in Node.elementFromPoint().
    // If the browser ignores pointer-events in Node.elementFromPoint(),
    // then use the display property instead (e.g., for older Safari).
    var elem = elementFromPoint(0, 0);

    if ( elem === svgRoot ) {
        elementFromPointCSSProperty = 'display';
    }

    // Auto-select a specific target, if any, and if possible

    // Try using mouse position
    if ( details.clientX !== -1 ) {
        elem = elementFromPoint(details.clientX, details.clientY);
        if ( elem !== null ) {
            filtersFromElement(elem);
            showDialog();
            return;
        }
    }

    // No mouse position available, use suggested target
    var target = details.target || '';
    var pos = target.indexOf('\t');
    if ( pos === -1 ) {
        return;
    }
    var srcAttrMap = {
        'a': 'href',
        'img': 'src',
        'iframe': 'src',
        'video': 'src',
        'audio': 'src'
    };
    var tagName = target.slice(0, pos);
    var url = target.slice(pos + 1);
    var attr = srcAttrMap[tagName];
    if ( attr === undefined ) {
        return;
    }
    var elems = document.querySelectorAll(tagName + '[' + attr + ']');
    var i = elems.length;
    var src;
    while ( i-- ) {
        elem = elems[i];
        src = elem[attr];
        if ( typeof src !== 'string' || src === '' ) {
            continue;
        }
        if ( src !== url ) {
            continue;
        }
        filtersFromElement(elem);
        showDialog({ modifier: true });
        return;
    }
};

/******************************************************************************/

localMessager.send({ what: 'elementPickerArguments' }, startPicker);

/******************************************************************************/

// https://www.youtube.com/watch?v=sociXdKnyr8

/******************************************************************************/

})();

/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 Raymond Hill

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

/******************************************************************************/
/******************************************************************************/

/*! http://mths.be/cssescape v0.2.1 by @mathias | MIT license */
;(function(root) {

    'use strict';

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
                    (codeUnit >= 0x0001 && codeUnit <= 0x001F) || codeUnit === 0x007F ||
                    // If the character is the first character and is in the range [0-9]
                    // (U+0030 to U+0039), […]
                    (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
                    // If the character is the second character and is in the range [0-9]
                    // (U+0030 to U+0039) and the first character is a `-` (U+002D), […]
                    (
                        index === 1 &&
                        codeUnit >= 0x0030 && codeUnit <= 0x0039 &&
                        firstCodeUnit === 0x002D
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
                    codeUnit === 0x002D ||
                    codeUnit === 0x005F ||
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

(function() {

'use strict';

/******************************************************************************/

if ( typeof vAPI !== 'object' ) {
    return;
}

// don't run in frames
if ( window.top !== window ) {
    return;
}

var pickerRoot = document.getElementById(vAPI.sessionId);
if ( pickerRoot ) {
    return;
}
var pickerBody = null;
var pickerStyle = null;
var svgOcean = null;
var svgIslands = null;
var svgRoot = null;
var dialog = null;
var taCandidate = null;

var netFilterCandidates = [];
var cosmeticFilterCandidates = [];

var targetElements = [];
var candidateElements = [];
var bestCandidateFilter = null;
var previewedElements = [];

var lastNetFilterSession = window.location.host + window.location.pathname;
var lastNetFilterHostname = '';
var lastNetFilterUnion = '';

/******************************************************************************/

// For browsers not supporting `:scope`, it's not the end of the world: the
// suggested CSS selectors may just end up being more verbose.

var cssScope = ':scope > ';

try {
    document.querySelector(':scope *');
} catch (e) {
    cssScope = '';
}

/******************************************************************************/

var safeQuerySelectorAll = function(node, selector) {
    if ( node !== null ) {
        try {
            return node.querySelectorAll(selector);
        } catch (e) {
        }
    }
    return [];
};

/******************************************************************************/

var getElementBoundingClientRect = function(elem) {
    var rect = typeof elem.getBoundingClientRect === 'function' ?
        elem.getBoundingClientRect() :
        { height: 0, left: 0, top: 0, width: 0 };

    // https://github.com/gorhill/uBlock/issues/1024
    // Try not returning an empty bounding rect.
    if ( rect.width !== 0 && rect.height !== 0 ) {
        return rect;
    }

    var left = rect.left,
        right = rect.right,
        top = rect.top,
        bottom = rect.bottom;

    var children = elem.children,
        i = children.length;

    while ( i-- ) {
        rect = getElementBoundingClientRect(children[i]);
        if ( rect.width === 0 || rect.height === 0 ) {
            continue;
        }
        if ( rect.left < left ) { left = rect.left; }
        if ( rect.right > right ) { right = rect.right; }
        if ( rect.top < top ) { top = rect.top; }
        if ( rect.bottom > bottom ) { bottom = rect.bottom; }
    }

    return {
        height: bottom - top,
        left: left,
        top: top,
        width: right - left
    };
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

    var ow = pickerRoot.contentWindow.innerWidth;
    var oh = pickerRoot.contentWindow.innerHeight;
    var ocean = [
        'M0 0',
        'h', ow,
        'v', oh,
        'h-', ow,
        'z'
    ];
    var islands = [];

    var elem, rect, poly;
    for ( var i = 0; i < elems.length; i++ ) {
        elem = elems[i];
        if ( elem === pickerRoot ) {
            continue;
        }
        rect = getElementBoundingClientRect(elem);

        // Ignore if it's not on the screen
        if ( rect.left > ow || rect.top > oh ||
             rect.left + rect.width < 0 || rect.top + rect.height < 0 ) {
            continue;
        }

        poly = 'M' + rect.left + ' ' + rect.top +
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

var filterElements = function(filter) {
    var htmlElem = document.documentElement;
    var items = elementsFromFilter(filter);
    var i = items.length, item, elem, style;
    while ( i-- ) {
        item = items[i];
        elem = item.elem;
        // https://github.com/gorhill/uBlock/issues/1629
        if ( elem === pickerRoot ) {
            continue;
        }
        style = elem.style;
        if (
            (elem !== htmlElem) &&
            (item.type === 'cosmetic' ||
             item.type === 'network' && item.src !== undefined)
        ) {
            previewedElements.push({
                elem: elem,
                prop: 'display',
                value: style.getPropertyValue('display'),
                priority: style.getPropertyPriority('display')
            });
            style.setProperty('display', 'none', 'important');
        }
        if ( item.type === 'network' && item.style === 'background-image' ) {
            previewedElements.push({
                elem: elem,
                prop: 'background-image',
                value: style.getPropertyValue('background-image'),
                priority: style.getPropertyPriority('background-image')
            });
            style.setProperty('background-image', 'none', 'important');
        }
    }
};

/******************************************************************************/

var preview = function(filter) {
    filterElements(filter);
    pickerBody.classList.add('preview');
};

/******************************************************************************/

var unpreview = function() {
    var items = previewedElements;
    var i = items.length, item;
    while ( i-- ) {
        item = items[i];
        item.elem.style.setProperty(item.prop, item.value, item.priority);
    }
    previewedElements.length = 0;
    pickerBody.classList.remove('preview');
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1897
// Ignore `data:` URI, they can't be handled by an HTTP observer.

var backgroundImageURLFromElement = function(elem) {
    var style = window.getComputedStyle(elem),
        bgImg = style.backgroundImage || '',
        matches = /^url\((["']?)([^"']+)\1\)$/.exec(bgImg),
        url = matches !== null && matches.length === 3 ? matches[2] : '';
    return url.lastIndexOf('data:', 0) === -1 ? url.slice(0, 1024) : '';
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1725#issuecomment-226479197
// Limit returned string to 1024 characters.
// Also, return only URLs which will be seen by an HTTP observer.

var resourceURLFromElement = function(elem) {
    var tagName = elem.localName, s;
    if (
        (s = netFilter1stSources[tagName]) ||
        (s = netFilter2ndSources[tagName])
    ) {
        s = elem[s];
        if ( typeof s === 'string' && /^https?:\/\//.test(s) ) {
            return s.slice(0, 1024);
        }
    }
    return backgroundImageURLFromElement(elem);
};

/******************************************************************************/

var netFilterFromUnion = (function() {
    var reTokenizer = /[^0-9a-z%*]+|[0-9a-z%]+|\*/gi;
    var a = document.createElement('a');

    return function(to, out) {
        a.href= to;
        to = a.pathname + a.search;
        var from = lastNetFilterUnion;

        // Reset reference filter when dealing with unrelated URLs
        if ( from === '' || a.host === '' || a.host !== lastNetFilterHostname ) {
            lastNetFilterHostname = a.host;
            lastNetFilterUnion = to;
            vAPI.messaging.send(
                'elementPicker',
                {
                    what: 'elementPickerEprom',
                    lastNetFilterSession: lastNetFilterSession,
                    lastNetFilterHostname: lastNetFilterHostname,
                    lastNetFilterUnion: lastNetFilterUnion
                }
            );
            return;
        }

        // Related URLs
        lastNetFilterHostname = a.host;

        var fromTokens = from.match(reTokenizer);
        var toTokens = to.match(reTokenizer);
        var toCount = toTokens.length, toIndex = 0;
        var fromToken, pos;

        for ( var fromIndex = 0; fromIndex < fromTokens.length; fromIndex += 1 ) {
            fromToken = fromTokens[fromIndex];
            if ( fromToken === '*' ) {
                continue;
            }
            pos = toTokens.indexOf(fromToken, toIndex);
            if ( pos === -1 ) {
                fromTokens[fromIndex] = '*';
                continue;
            }
            if ( pos !== toIndex ) {
                fromTokens.splice(fromIndex, 0, '*');
                fromIndex += 1;
            }
            toIndex = pos + 1;
            if ( toIndex === toCount ) {
                fromTokens = fromTokens.slice(0, fromIndex + 1);
                break;
            }
        }
        from = fromTokens.join('').replace(/\*\*+/g, '*');
        if ( from !== '/*' && from !== to ) {
            var filter = '||' + lastNetFilterHostname + from;
            if ( out.indexOf(filter) === -1 ) {
                out.push(filter);
            }
        } else {
            from = to;
        }
        lastNetFilterUnion = from;

        // Remember across element picker sessions
        vAPI.messaging.send(
            'elementPicker',
            {
                what: 'elementPickerEprom',
                lastNetFilterSession: lastNetFilterSession,
                lastNetFilterHostname: lastNetFilterHostname,
                lastNetFilterUnion: lastNetFilterUnion
            }
        );
    };
})();

/******************************************************************************/

// Extract the best possible net filter, i.e. as specific as possible.

var netFilterFromElement = function(elem) {
    if ( elem === null ) {
        return 0;
    }
    if ( elem.nodeType !== 1 ) {
        return 0;
    }
    var src = resourceURLFromElement(elem);
    if ( src === '' ) {
        return 0;
    }

    if ( candidateElements.indexOf(elem) === -1 ) {
        candidateElements.push(elem);
    }

    var candidates = netFilterCandidates;
    var len = candidates.length;

    // Remove fragment
    var pos = src.indexOf('#');
    if ( pos !== -1 ) {
        src = src.slice(0, pos);
    }

    var filter = src.replace(/^https?:\/\//, '||');

    if ( bestCandidateFilter === null ) {
        bestCandidateFilter = {
            type: 'net',
            filters: candidates,
            slot: candidates.length
        };
    }

    candidates.push(filter);

    // Suggest a less narrow filter if possible
    pos = filter.indexOf('?');
    if ( pos !== -1 ) {
        candidates.push(filter.slice(0, pos));
    }

    // Suggest a filter which is a result of combining more than one URL.
    netFilterFromUnion(src, candidates);

    return candidates.length - len;
};

var netFilter1stSources = {
     'audio': 'src',
     'embed': 'src',
    'iframe': 'src',
       'img': 'src',
    'object': 'data',
     'video': 'src'
};

var netFilter2ndSources = {
       'img': 'srcset'
};

var filterTypes = {
     'audio': 'media',
     'embed': 'object',
    'iframe': 'subdocument',
       'img': 'image',
    'object': 'object',
     'video': 'media',
};

/******************************************************************************/

// Extract the best possible cosmetic filter, i.e. as specific as possible.

// https://github.com/gorhill/uBlock/issues/1725
// Also take into account the `src` attribute for `img` elements -- and limit
// the value to the 1024 first characters.

var cosmeticFilterFromElement = function(elem) {
    if ( elem === null ) {
        return 0;
    }
    if ( elem.nodeType !== 1 ) {
        return 0;
    }

    if ( candidateElements.indexOf(elem) === -1 ) {
        candidateElements.push(elem);
    }

    var tagName = elem.localName;
    var selector = '';
    var v, i;

    // Id
    v = typeof elem.id === 'string' && CSS.escape(elem.id);
    if ( v ) {
        selector = '#' + v;
    }

    // Class(es)
    if ( selector === '' ) {
        v = elem.classList;
        if ( v ) {
            i = v.length || 0;
            while ( i-- ) {
                selector += '.' + CSS.escape(v.item(i));
            }
        }
    }

    // Tag name
    // https://github.com/gorhill/uBlock/issues/1901
    // Trim attribute value, this may help in case of malformed HTML.
    if ( selector === '' ) {
        selector = tagName;
        var attributes = [], attr;
        switch ( tagName ) {
        case 'a':
            v = elem.getAttribute('href');
            if ( v ) {
                v = v.trim().replace(/\?.*$/, '');
                if ( v.length ) {
                    attributes.push({ k: 'href', v: v });
                }
            }
            break;
        case 'iframe':
        case 'img':
            v = elem.getAttribute('src');
            if ( v && v.length !== 0 ) {
                attributes.push({ k: 'src', v: v.trim().slice(0, 1024) });
                break;
            }
            v = elem.getAttribute('alt');
            if ( v && v.length !== 0 ) {
                attributes.push({ k: 'alt', v: v });
                break;
            }
            break;
        default:
            break;
        }
        while ( (attr = attributes.pop()) ) {
            if ( attr.v.length === 0 ) {
                continue;
            }
            v = elem.getAttribute(attr.k);
            if ( attr.v === v ) {
                selector += '[' + attr.k + '="' + attr.v + '"]';
            } else if ( v.lastIndexOf(attr.v, 0) === 0 ) {
                selector += '[' + attr.k + '^="' + attr.v + '"]';
            } else {
                selector += '[' + attr.k + '*="' + attr.v + '"]';
            }
        }
    }

    // https://github.com/chrisaljoudi/uBlock/issues/637
    // If the selector is still ambiguous at this point, further narrow using
    // `nth-of-type`. It is preferable to use `nth-of-type` as opposed to
    // `nth-child`, as `nth-of-type` is less volatile.
    var parentNode = elem.parentNode;
    if ( safeQuerySelectorAll(parentNode, cssScope + selector).length > 1 ) {
        i = 1;
        while ( elem.previousSibling !== null ) {
            elem = elem.previousSibling;
            if ( typeof elem.localName !== 'string' || elem.localName !== tagName ) {
                continue;
            }
            i++;
        }
        selector += ':nth-of-type(' + i + ')';
    }

    if ( bestCandidateFilter === null ) {
        bestCandidateFilter = {
            type: 'cosmetic',
            filters: cosmeticFilterCandidates,
            slot: cosmeticFilterCandidates.length
        };
    }

    cosmeticFilterCandidates.push('##' + selector);

    return 1;
};

/******************************************************************************/

var filtersFrom = function(x, y) {
    bestCandidateFilter = null;
    netFilterCandidates.length = 0;
    cosmeticFilterCandidates.length = 0;
    candidateElements.length = 0;

    // We need at least one element.
    var first = null;
    if ( typeof x === 'number' ) {
        first = elementFromPoint(x, y);
    } else if ( x instanceof HTMLElement ) {
        first = x;
        x = undefined;
    }

    // Network filter from element which was clicked.
    if ( first !== null ) {
        netFilterFromElement(first);
    }

    // Cosmetic filter candidates from ancestors.
    var elem = first;
    while ( elem && elem !== document.body ) {
        cosmeticFilterFromElement(elem);
        elem = elem.parentNode;
    }
    // The body tag is needed as anchor only when the immediate child
    // uses`nth-of-type`.
    var i = cosmeticFilterCandidates.length;
    if ( i !== 0 && cosmeticFilterCandidates[i-1].indexOf(':nth-of-type(') !== -1 ) {
        cosmeticFilterCandidates.push('##body');
    }

    // https://github.com/gorhill/uBlock/issues/1545
    // Network filter candidates from all other elements found at point (x, y).
    if ( typeof x === 'number' ) {
        var attrName = vAPI.sessionId + '-clickblind';
        var previous;
        elem = first;
        while ( elem !== null ) {
            previous = elem;
            elem.setAttribute(attrName, '');
            elem = elementFromPoint(x, y);
            if ( elem === null || elem === previous ) {
                break;
            }
            netFilterFromElement(elem);
        }
        var elems = document.querySelectorAll('[' + attrName + ']');
        i = elems.length;
        while ( i-- ) {
            elems[i].removeAttribute(attrName);
        }

        netFilterFromElement(document.body);
    }

    return netFilterCandidates.length + cosmeticFilterCandidates.length;
};

/******************************************************************************/

var elementsFromFilter = function(filter) {
    var out = [];

    filter = filter.trim();
    if ( filter === '' ) {
        return out;
    }

    // Cosmetic filters: these are straight CSS selectors
    // TODO: This is still not working well for a[href], because there are
    // many ways to compose a valid href to the same effective URL.
    // One idea is to normalize all a[href] on the page, but for now I will
    // wait and see, as I prefer to refrain from tampering with the page
    // content if I can avoid it.
    var elems, iElem, elem;
    if ( filter.lastIndexOf('##', 0) === 0 ) {
        try {
            elems = document.querySelectorAll(filter.slice(2));
        }
        catch (e) {
            elems = [];
        }
        iElem = elems.length;
        while ( iElem-- ) {
            out.push({
                type: 'cosmetic',
                elem: elems[iElem],
            });
        }
        return out;
    }

    // Net filters: we need to lookup manually -- translating into a
    // foolproof CSS selector is just not possible

    // https://github.com/chrisaljoudi/uBlock/issues/945
    // Transform into a regular expression, this allows the user to edit and
    // insert wildcard(s) into the proposed filter
    var reStr = '';
    if ( filter.length > 1 && filter.charAt(0) === '/' && filter.slice(-1) === '/' ) {
        reStr = filter.slice(1, -1);
    }
    else {
        var rePrefix = '', reSuffix = '';
        if ( filter.slice(0, 2) === '||' ) {
            filter = filter.replace('||', '');
        } else {
            if ( filter.charAt(0) === '|' ) {
                rePrefix = '^';
                filter = filter.slice(1);
            }
        }
        if ( filter.slice(-1) === '|' ) {
            reSuffix = '$';
            filter = filter.slice(0, -1);
        }
        reStr = rePrefix +
                filter.replace(/[.+?${}()|[\]\\]/g, '\\$&').replace(/[\*^]+/g, '.*') +
                reSuffix;
    }
    var reFilter = null;
    try {
        reFilter = new RegExp(reStr);
    }
    catch (e) {
        return out;
    }

    // Lookup by tag names.
    var src1stProps = netFilter1stSources;
    var src2ndProps = netFilter2ndSources;
    var srcProp, src;
    elems = document.querySelectorAll(Object.keys(src1stProps).join());
    iElem = elems.length;
    while ( iElem-- ) {
        elem = elems[iElem];
        srcProp = src1stProps[elem.localName];
        src = elem[srcProp];
        if ( typeof src !== 'string' || src.length === 0 ) {
            srcProp = src2ndProps[elem.localName];
            src = elem[srcProp];
        }
        if ( src && reFilter.test(src) ) {
            out.push({
                type: 'network',
                elem: elem,
                src: srcProp,
                opts: filterTypes[elem.localName],
            });
        }
    }

    // Find matching background image in current set of candidate elements.
    elems = candidateElements;
    iElem = elems.length;
    while ( iElem-- ) {
        elem = elems[iElem];
        if ( reFilter.test(backgroundImageURLFromElement(elem)) ) {
            out.push({
                type: 'network',
                elem: elem,
                style: 'background-image',
                opts: 'image',
            });
        }
    }

    return out;
};

// https://www.youtube.com/watch?v=nuUXJ6RfIik

/******************************************************************************/

var userFilterFromCandidate = function() {
    var v = taCandidate.value;
    var items = elementsFromFilter(v);
    if ( items.length === 0 ) {
        return false;
    }

    // https://github.com/gorhill/uBlock/issues/738
    // Trim dots.
    var hostname = window.location.hostname;
    if ( hostname.slice(-1) === '.' ) {
        hostname = hostname.slice(0, -1);
    }

    // Cosmetic filter?
    if ( v.lastIndexOf('##', 0) === 0 ) {
        return hostname + v;
    }

    // Assume net filter
    var opts = [];

    // If no domain included in filter, we need domain option
    if ( v.lastIndexOf('||', 0) === -1 ) {
        opts.push('domain=' + hostname);
    }

    var item = items[0];
    if ( item.opts ) {
        opts.push(item.opts);
    }

    if ( opts.length ) {
        v += '$' + opts.join(',');
    }

    return v;
};

/******************************************************************************/

var onCandidateChanged = function() {
    unpreview();

    var elems = [];
    var items = elementsFromFilter(taCandidate.value);
    for ( var i = 0; i < items.length; i++ ) {
        elems.push(items[i].elem);
    }
    dialog.querySelector('#create').disabled = elems.length === 0;
    highlightElements(elems, true);
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
    if ( filter.lastIndexOf('##', 0) !== 0 ) {
        return filter;
    }

    // At this point, we have a cosmetic filter

    // Modifier means "target broadly". Hence:
    // - Do not compute exact path.
    // - Discard narrowing directives.
    if ( filterChoice.modifier ) {
        return filter.replace(/:nth-of-type\(\d+\)/, '');
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
        // We have to exit from preview mode: this guarantees matching elements
        // will be found for the candidate filter.
        unpreview();

        var filter = userFilterFromCandidate();
        if ( filter ) {
            var d = new Date();
            vAPI.messaging.send(
                'elementPicker',
                {
                    what: 'createUserFilter',
                    filters: '! ' + d.toLocaleString() + ' ' + window.location.href + '\n' + filter,
                    pageDomain: window.location.hostname
                }
            );
            filterElements(taCandidate.value);
            stopPicker();
        }
    }

    else if ( ev.target.id === 'pick' ) {
        unpausePicker();
    }

    else if ( ev.target.id === 'quit' ) {
        unpreview();
        stopPicker();
    }

    else if ( ev.target.id === 'preview' ) {
        if ( pickerBody.classList.contains('preview') ) {
            unpreview();
        } else {
            preview(taCandidate.value);
        }
        highlightElements(targetElements, true);
    }

    else if ( ev.target.parentNode.classList.contains('changeFilter') ) {
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
        var root = dialog.querySelector(des);
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

    dialog.querySelector('ul').style.display = netFilterCandidates.length || cosmeticFilterCandidates.length ? '' : 'none';
    dialog.querySelector('#create').disabled = true;

    // Auto-select a candidate filter

    if ( bestCandidateFilter === null ) {
        taCandidate.value = '';
        return;
    }

    var filterChoice = {
        filters: bestCandidateFilter.filters,
        slot: bestCandidateFilter.slot,
        modifier: options.modifier || false
    };

    taCandidate.value = candidateFromFilterChoice(filterChoice);
    onCandidateChanged();
};

/******************************************************************************/

var elementFromPoint = function(x, y) {
    if ( !pickerRoot ) {
        return null;
    }
    pickerRoot.style.pointerEvents = 'none';
    var elem = document.elementFromPoint(x, y);
    if ( elem === document.body || elem === document.documentElement ) {
        elem = null;
    }
    pickerRoot.style.pointerEvents = '';
    return elem;
};

/******************************************************************************/

var onSvgHovered = (function() {
    var timer = null;
    var mx = 0, my = 0;

    var onTimer = function() {
        timer = null;
        var elem = elementFromPoint(mx, my);
        highlightElements(elem ? [elem] : []);
    };

    var onMove = function(ev) {
        mx = ev.clientX;
        my = ev.clientY;
        if ( timer === null ) {
            timer = vAPI.setTimeout(onTimer, 40);
        }
    };

    return onMove;
})();

/******************************************************************************/

var onSvgClicked = function(ev) {
    // https://github.com/chrisaljoudi/uBlock/issues/810#issuecomment-74600694
    // Unpause picker if user click outside dialog
    if ( pickerBody.classList.contains('paused') ) {
        unpausePicker();
        return;
    }
    if ( filtersFrom(ev.clientX, ev.clientY) === 0 ) {
        return;
    }
    showDialog();
};

/******************************************************************************/

var svgListening = function(on) {
    var action = (on ? 'add' : 'remove') + 'EventListener';
    svgRoot[action]('mousemove', onSvgHovered);
};

/******************************************************************************/

var onKeyPressed = function(ev) {
    if ( ev.which === 27 ) {
        ev.stopPropagation();
        ev.preventDefault();
        stopPicker();
    }
};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/190
// May need to dynamically adjust the height of the overlay + new position
// of highlighted elements.

var onScrolled = function() {
    highlightElements(targetElements, true);
};

/******************************************************************************/

var pausePicker = function() {
    pickerBody.classList.add('paused');
    svgListening(false);
};

/******************************************************************************/

var unpausePicker = function() {
    unpreview();
    pickerBody.classList.remove('paused');
    svgListening(true);
};

/******************************************************************************/

// Let's have the element picker code flushed from memory when no longer
// in use: to ensure this, release all local references.

var stopPicker = function() {
    targetElements = [];
    candidateElements = [];
    bestCandidateFilter = null;
    previewedElements = [];

    if ( pickerRoot === null ) {
        return;
    }

    window.removeEventListener('scroll', onScrolled, true);
    pickerRoot.contentWindow.removeEventListener('keydown', onKeyPressed, true);
    taCandidate.removeEventListener('input', onCandidateChanged);
    dialog.removeEventListener('click', onDialogClicked);
    svgListening(false);
    svgRoot.removeEventListener('click', onSvgClicked);
    pickerStyle.parentNode.removeChild(pickerStyle);
    pickerRoot.parentNode.removeChild(pickerRoot);
    pickerRoot.onload = null;
    pickerRoot =
    pickerBody =
    dialog =
    svgRoot = svgOcean = svgIslands =
    taCandidate = null;

    window.focus();
};

/******************************************************************************/

var startPicker = function(details) {
    pickerRoot.onload = stopPicker;

    var frameDoc = pickerRoot.contentDocument;
    var parsedDom = (new DOMParser()).parseFromString(
        details.frameContent,
        'text/html'
    );

    // Provide an id users can use as anchor to personalize uBO's element
    // picker style properties.
    parsedDom.documentElement.id = 'ublock0-epicker';

    frameDoc.replaceChild(
        frameDoc.adoptNode(parsedDom.documentElement),
        frameDoc.documentElement
    );

    pickerBody = frameDoc.body;
    pickerBody.setAttribute('lang', navigator.language);

    dialog = pickerBody.querySelector('aside');
    dialog.addEventListener('click', onDialogClicked);

    taCandidate = dialog.querySelector('textarea');
    taCandidate.addEventListener('input', onCandidateChanged);

    svgRoot = pickerBody.querySelector('svg');
    svgOcean = svgRoot.firstChild;
    svgIslands = svgRoot.lastChild;
    svgRoot.addEventListener('click', onSvgClicked);
    svgListening(true);

    window.addEventListener('scroll', onScrolled, true);
    pickerRoot.contentWindow.addEventListener('keydown', onKeyPressed, true);
    pickerRoot.contentWindow.focus();

    // Restore net filter union data if it originate from the same URL.
    var eprom = details.eprom || null;
    if ( eprom !== null && eprom.lastNetFilterSession === lastNetFilterSession ) {
        lastNetFilterHostname = eprom.lastNetFilterHostname || '';
        lastNetFilterUnion = eprom.lastNetFilterUnion || '';
    }

    // Auto-select a specific target, if any, and if possible

    highlightElements([], true);

    // Try using mouse position
    if ( details.clientX !== -1 ) {
        if ( filtersFrom(details.clientX, details.clientY) !== 0 ) {
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
        'audio': 'src',
        'embed': 'src',
        'iframe': 'src',
        'img': 'src',
        'video': 'src',
    };
    var tagName = target.slice(0, pos);
    var url = target.slice(pos + 1);
    var attr = srcAttrMap[tagName];
    if ( attr === undefined ) {
        return;
    }
    var elems = document.querySelectorAll(tagName + '[' + attr + ']');
    var i = elems.length;
    var elem, src;
    while ( i-- ) {
        elem = elems[i];
        src = elem[attr];
        if ( typeof src !== 'string' || src === '' ) {
            continue;
        }
        if ( src !== url ) {
            continue;
        }
        elem.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
        filtersFrom(elem);
        showDialog({ modifier: true });
        return;
    }

    // A target was specified, but it wasn't found: abort.
    stopPicker();
};

/******************************************************************************/

pickerRoot = document.createElement('iframe');
pickerRoot.id = vAPI.sessionId;
pickerRoot.style.cssText = [
    'display: block',
    'visibility: visible',
    'opacity: 1',
    'position: fixed',
    'top: 0',
    'left: 0',
    'width: 100%',
    'height: 100%',
    'background: transparent',
    'margin: 0',
    'padding: 0',
    'border: 0',
    'border-radius: 0',
    'box-shadow: none',
    'outline: 0',
    'z-index: 2147483647',
    ''
].join('!important;');

// https://github.com/gorhill/uBlock/issues/1529
// In addition to inline styles, harden the element picker styles by using
// a dedicated style tag.
pickerStyle = document.createElement('style');
pickerStyle.textContent = [
    '#' + vAPI.sessionId + ' {',
        pickerRoot.style.cssText,
    '}',
    '[' + vAPI.sessionId + '-clickblind] {',
        'pointer-events: none !important;',
    '}',
    ''
].join('\n');
document.documentElement.appendChild(pickerStyle);

pickerRoot.onload = function() {
    vAPI.shutdown.add(stopPicker);
    vAPI.messaging.send(
        'elementPicker',
        { what: 'elementPickerArguments' },
        startPicker
    );
};

document.documentElement.appendChild(pickerRoot);

/******************************************************************************/

// https://www.youtube.com/watch?v=sociXdKnyr8

/******************************************************************************/

})();

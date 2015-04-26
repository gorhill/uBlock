/*******************************************************************************

    µBlock - a browser extension to block requests.
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

    Home: https://github.com/chrisaljoudi/uBlock
*/

/* global self, vAPI, CSS */

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

(function() {

'use strict';

/******************************************************************************/

// don't run in frames
if ( window.top !== window ) {
    return;
}

var pickerRoot = document.getElementById(vAPI.sessionId);

if ( pickerRoot ) {
    // If it's already running, stop it and then allow it to restart
    pickerRoot.onload(); // Calls stopPicker
}

var localMessager = vAPI.messaging.channel('element-picker.js');

var svgOcean = null;
var svgIslands = null;
var svgRoot = null;
var dialog = null;
var taCandidate = null;

var netFilterCandidates = [];
var cosmeticFilterCandidates = [];

var targetElements = [];

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
        if ( typeof elem.getBoundingClientRect !== 'function' ) {
            continue;
        }
        rect = elem.getBoundingClientRect();

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
            localMessager.send({
                what: 'elementPickerEprom',
                lastNetFilterSession: lastNetFilterSession,
                lastNetFilterHostname: lastNetFilterHostname,
                lastNetFilterUnion: lastNetFilterUnion
            });
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
            out.push('||' + lastNetFilterHostname + from);
        } else {
            from = to;
        }
        lastNetFilterUnion = from;

        // Remember across element picker sessions
        localMessager.send({
            what: 'elementPickerEprom',
            lastNetFilterSession: lastNetFilterSession,
            lastNetFilterHostname: lastNetFilterHostname,
            lastNetFilterUnion: lastNetFilterUnion
        });
    };
})();

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
    if ( netFilterSources.hasOwnProperty(tagName) === false ) {
        return;
    }
    var src = elem[netFilterSources[tagName]];
    if ( src.length === 0 ) {
        return;
    }

    netFilterFromUrl(src, out);
}

var netFilterFromUrl = function(url, out) {
    // Remove fragment
    var pos = url.indexOf('#');
    if ( pos !== -1 ) {
        url = url.slice(0, pos);
    }

    var filter = url.replace(/^https?:\/\//, '||');

    // Anchor absolute filter to hostname
    out.push(filter);

    // Suggest a less narrow filter if possible
    pos = filter.indexOf('?');
    if ( pos !== -1 ) {
        out.push(filter.slice(0, pos));
    }

    // Suggest a filter which is a result of combining more than one URL.
    netFilterFromUnion(url, out);
};

var netFilterSources = {
     'embed': 'src',
    'iframe': 'src',
       'img': 'src',
    'object': 'data'
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
    var v, i;

    // Id
    v = typeof elem.id === 'string' && CSS.escape(elem.id);
    if ( v ) {
        suffix.push('#', v);
    }

    // Class(es)
    if ( suffix.length === 0 ) {
        v = elem.classList;
        if ( v ) {
            i = v.length || 0;
            while ( i-- ) {
                suffix.push('.' + CSS.escape(v.item(i)));
            }
        }
    }

    // Tag name
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

    var selector = prefix + suffix.join('');

    // https://github.com/chrisaljoudi/uBlock/issues/637
    // If the selector is still ambiguous at this point, further narrow using
    // `nth-of-type`. It is preferable to use `nth-of-type` as opposed to
    // `nth-child`, as `nth-of-type` is less volatile.
    var parentNode = elem.parentNode;
    if ( safeQuerySelectorAll(parentNode, cssScope + selector).length > 1 ) {
        i = 1;
        while ( elem.previousSibling !== null ) {
            elem = elem.previousSibling;
            if ( typeof elem.tagName !== 'string' ) {
                continue;
            }
            if ( elem.tagName.toLowerCase() !== tagName ) {
                continue;
            }
            i++;
        }
        selector += ':nth-of-type(' + i + ')';
    }

    out.push('##' + selector);
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
    // The body tag is needed as anchor only when the immediate child
    // uses`nth-of-type`.
    var i = cosmeticFilterCandidates.length;
    if ( i !== 0 && cosmeticFilterCandidates[i-1].indexOf(':nth-of-type(') !== -1 ) {
        cosmeticFilterCandidates.push('##body');
    }
};

/******************************************************************************/

var filtersFromUrl = function(url) {
    netFilterCandidates.length = 0;
    cosmeticFilterCandidates.length = 0;
    netFilterFromUrl(url, netFilterCandidates);
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
    if ( filter.lastIndexOf('##', 0) === 0 ) {
        try {
            out = document.querySelectorAll(filter.slice(2));
        }
        catch (e) {
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
    } catch (e) {
        return out;
    }

    var props = netFilterSources;
    var elems = document.querySelectorAll(Object.keys(props).join());
    var i = elems.length;
    var elem, src;
    while ( i-- ) {
        elem = elems[i];
        src = elem[props[elem.tagName.toLowerCase()]];
        if ( src && reFilter.test(src) ) {
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
    if ( v.lastIndexOf('##', 0) === 0 ) {
        return window.location.hostname + v;
    }

    // If domain included in filter, no need for domain option
    if ( v.lastIndexOf('||', 0) === 0 ) {
        return v;
    }

    // Assume net filter
    return v + '$domain=' + window.location.hostname;
};

/******************************************************************************/

var onCandidateChanged = function() {
    var elems = elementsFromFilter(taCandidate.value);
    dialog.querySelector('#create').disabled = elems.length === 0;
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
            var d = new Date();
            localMessager.send({
                what: 'createUserFilter',
                filters: '! ' + d.toLocaleString() + ' ' + window.location.href + '\n' + filter,
            });
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
    pickerRoot.style.pointerEvents = 'none';
    var elem = document.elementFromPoint(x, y);
    if ( elem === document.body || elem === document.documentElement ) {
        elem = null;
    }
    pickerRoot.style.pointerEvents = '';
    return elem;
};

/******************************************************************************/

var onSvgHovered = function(ev) {
    var elem = elementFromPoint(ev.clientX, ev.clientY);
    highlightElements(elem ? [elem] : []);
};

/******************************************************************************/

var onSvgClicked = function(ev) {
    // https://github.com/chrisaljoudi/uBlock/issues/810#issuecomment-74600694
    // Unpause picker if user click outside dialog
    if ( dialog.parentNode.classList.contains('paused') ) {
        unpausePicker();
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
    dialog.parentNode.classList.add('paused');
    svgListening(false);
};

/******************************************************************************/

var unpausePicker = function() {
    dialog.parentNode.classList.remove('paused');
    svgListening(true);
};

/******************************************************************************/

// Let's have the element picker code flushed from memory when no longer
// in use: to ensure this, release all local references.

var stopPicker = function() {
    targetElements = [];

    if ( pickerRoot === null ) {
        return;
    }

    window.removeEventListener('scroll', onScrolled, true);
    pickerRoot.contentWindow.removeEventListener('keydown', onKeyPressed, true);
    taCandidate.removeEventListener('input', onCandidateChanged);
    dialog.removeEventListener('click', onDialogClicked);
    svgListening(false);
    svgRoot.removeEventListener('click', onSvgClicked);
    pickerRoot.parentNode.removeChild(pickerRoot);
    pickerRoot.onload = null;
    pickerRoot =
    dialog =
    svgRoot = svgOcean = svgIslands =
    taCandidate = null;
    localMessager.close();

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

    frameDoc.replaceChild(
        frameDoc.adoptNode(parsedDom.documentElement),
        frameDoc.documentElement
    );

    frameDoc.body.setAttribute('lang', navigator.language);

    dialog = frameDoc.body.querySelector('aside');
    dialog.addEventListener('click', onDialogClicked);

    taCandidate = dialog.querySelector('textarea');
    taCandidate.addEventListener('input', onCandidateChanged);

    svgRoot = frameDoc.body.querySelector('svg');
    svgOcean = svgRoot.firstChild;
    svgIslands = svgRoot.lastChild;
    svgRoot.addEventListener('click', onSvgClicked);
    svgListening(true);

    window.addEventListener('scroll', onScrolled, true);
    pickerRoot.contentWindow.addEventListener('keydown', onKeyPressed, true);
    pickerRoot.contentWindow.focus();

    // Restore net filter union data if it originate from the same URL.
    var eprom = details.eprom || {};
    if ( eprom.lastNetFilterSession === lastNetFilterSession ) {
        lastNetFilterHostname = eprom.lastNetFilterHostname || '';
        lastNetFilterUnion = eprom.lastNetFilterUnion || '';
    }

    // Auto-select a specific target, if any, and if possible

    highlightElements([], true);

    // If a target was provided, use it
    if (details.target) {
        if (details.target.type === 'element') {
            filtersFromElement(document.querySelector(details.target.value));
        } else if (details.target.type === 'url') {
            filtersFromUrl(details.target.value);
        } else {
            console.error('uBlock> unknown element picker target details type: %s', details.target.type);
        }
    } else {
        // Try using mouse position
        if (details.clientX !== -1) {
            filtersFromElement(elementFromPoint(details.clientX, details.clientY));
        }
    }

    if (netFilterCandidates.length > 0 || cosmeticFilterCandidates.length > 0) {
        showDialog();
    }
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
].join('!important; ');

pickerRoot.onload = function() {
    localMessager.send({ what: 'elementPickerArguments' }, startPicker);
};

document.documentElement.appendChild(pickerRoot);

/******************************************************************************/

// https://www.youtube.com/watch?v=sociXdKnyr8

/******************************************************************************/

})();

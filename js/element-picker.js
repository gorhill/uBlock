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

/* global CSS, chrome */

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
	InvalidCharacterError.prototype = new Error;
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

}(typeof global != 'undefined' ? global : this));

/******************************************************************************/
/******************************************************************************/

// Cut & pasted here from reference implementation in messaging-client.js
// because this is an injected script.

var messaging = (function(name){
    var port = null;
    var dangling = false;
    var requestId = 1;
    var requestIdToCallbackMap = {};
    var listenCallback = null;

    var onPortMessage = function(details) {
        if ( typeof details.id !== 'number' ) {
            return;
        }
        // Announcement?
        if ( details.id < 0 ) {
            if ( listenCallback ) {
                listenCallback(details.msg);
            }
            return;
        }
        var callback = requestIdToCallbackMap[details.id];
        if ( !callback ) {
            return;
        }
        callback(details.msg);
        delete requestIdToCallbackMap[details.id];
        checkDisconnect();
    };

    var start = function(name) {
        port = chrome.runtime.connect({
            name:   name +
                    '/' +
                    String.fromCharCode(
                        Math.random() * 0x7FFF | 0, 
                        Math.random() * 0x7FFF | 0,
                        Math.random() * 0x7FFF | 0,
                        Math.random() * 0x7FFF | 0
                    )
        });
        port.onMessage.addListener(onPortMessage);
    };

    if ( typeof name === 'string' && name.length > 0 ) {
        start(name);
    }

    var stop = function() {
        listenCallback = null;
        dangling = true;
        checkDisconnect();
    };

    var ask = function(msg, callback) {
        if ( !callback ) {
            tell(msg);
            return;
        }
        var id = requestId++;
        port.postMessage({ id: id, msg: msg });
        requestIdToCallbackMap[id] = callback;
    };

    var tell = function(msg) {
        port.postMessage({ id: 0, msg: msg });
    };

    var listen = function(callback) {
        listenCallback = callback;
    };

    var checkDisconnect = function() {
        if ( !dangling ) {
            return;
        }
        if ( Object.keys(requestIdToCallbackMap).length ) {
            return;
        }
        port.disconnect();
        port = null;
    };

    return {
        start: start,
        stop: stop,
        ask: ask,
        tell: tell,
        listen: listen
    };
})('element-picker.js');

/******************************************************************************/
/******************************************************************************/

(function() {

/******************************************************************************/

var µBlockClassName = CSS.escape('µBlock');
var svgns = 'http://www.w3.org/2000/svg';

var pickerRoot = null;
var svgRoot = null;
var svgOcean = null;
var svgIslands = null;
var divDialog = null;
var taCandidate = null;

var targetElements = [];

/******************************************************************************/

var pickerPaused = function() {
    return /(^| )paused( |$)/.test(pickerRoot.className);
};

/******************************************************************************/

var pausePicker = function() {
    pickerRoot.className += ' paused';
};

/******************************************************************************/

var unpausePicker = function() {
    pickerRoot.className = pickerRoot.className.replace(/(^| )paused( |$)/g, '').trim();
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
    // To make mouse mouce handler more efficient
    if ( !force && elems.length === targetElements.length ) {
        if ( elems.length === 0 || elems[0] === targetElements[0] ) {
            return;
        }
    }
    targetElements = elems;
    var offx = window.pageXOffset;
    var offy = window.pageYOffset;
    var ow = svgRoot.getAttribute('width');
    var ocean = [
        'M0 0',
        'h', ow,
        'v', svgRoot.getAttribute('height'),
        'h-', ow,
        'z'
    ];
    var islands = [];
    var elem, r;
    for ( var i = 0; i < elems.length; i++ ) {
        elem = elems[i];
        if ( typeof elem.getBoundingClientRect !== 'function' ) {
            continue;
        }
        r = elem.getBoundingClientRect();
        ocean.push(
            'M', r.left + offx, ' ', r.top + offy,
            'h', r.width,
            'v', r.height,
            'h-', r.width,
            'z'
        );
        islands.push(
            'M', r.left + offx, ' ', r.top + offy,
            'h', r.width,
            'v', r.height,
            'h-', r.width,
            'z'
        );
    }
    svgOcean.setAttribute('d', ocean.join(''));
    svgIslands.setAttribute('d', islands.join(''));
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

var netFilterFromElement = function(elem) {
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
    if ( typeof elem.src !== 'string' || elem.src.length === 0 ) {
        return;
    }
    return elem.src.replace(/^https?:\/\//, '||').replace(/\?.*$/, '');
};

/******************************************************************************/

// Extract the best possible cosmetic filter, i.e. as specific as possible.

var cosmeticFilterFromElement = function(elem) {
    if ( elem === null ) {
        return;
    }
    if ( elem.nodeType !== 1 ) {
        return;
    }
    var tagName = elem.tagName.toLowerCase();
    var prefix = '##' + tagName;
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

    // Attributes (depends on tag name)
    var attributes = [], attr;
    switch ( tagName ) {
    case 'a':
        v = elem.getAttribute('href');
        if ( v ) {
            v = v.replace(/\?.*$/, '');
        }
        attributes.push({ k: 'href', v: v });
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

    return prefix + suffix.join('');
};

/******************************************************************************/

var selectorFromCandidate = function() {
    var selector = '';
    var v = taCandidate.value;
    if ( v.indexOf('##') === 0 ) {
        selector = v.replace('##', '');
    } else {
        var matches = v.match(/^\|\|([^$]+)$/);
        if ( matches && matches.length === 2 ) {
            selector = '[src*="' + matches[1] + '"]';
        } else {
            return '';
        }
    }
    try {
        if ( document.querySelector(selector) === null ) {
            return '';
        }
    }
    catch (e) {
        return '';
    }
    return selector;
};

/******************************************************************************/

var userFilterFromCandidate = function() {
    if ( selectorFromCandidate() === '' ) {
        return false;
    }

    var v = taCandidate.value;

    // Cosmetic filter?
    var matches = v.match(/^##.+$/);
    if ( matches ) {
        return window.location.hostname + matches[0];
    }

    // Net filter?
    matches = v.match(/^\|\|[^$]+$/);
    if ( matches ) {
        return matches[0] + '$domain=' + window.location.hostname;
    }

    return false;
};

/******************************************************************************/

var onCandidateChanged = function(ev) {
    var selector = selectorFromCandidate();
    divDialog.querySelector('#create').disabled = selector === '';
    if ( selector === '' ) {
        highlightElements([]);
        return;
    }
    highlightElements(document.querySelectorAll(selector));
};

/******************************************************************************/

var candidateFromClickEvent = function(ev) {
    var target = ev.target;
    if ( !target ) {
        return '';
    }

    // Bare
    if ( ev.ctrlKey || ev.metaKey ) {
        return target.textContent;
    }

    // For net filters there no such thing as a path
    if ( target.textContent.slice(0, 2) === '||' ) {
        return target.textContent;
    }

    // Return path: the target element, then all siblings prepended
    var selector = [];
    while ( target ) {
        if ( target.nodeType !== 1 || target.tagName.toLowerCase() !== 'li' ) {
            continue;
        }
        selector.unshift(target.textContent.replace(/^##/, ''));
        target = target.nextSibling;
    }
    return '##' + selector.join(' > ');
};

/******************************************************************************/

var onDialogClicked = function(ev) {
    if ( ev.target === null ) {
        /* do nothing */
    }

    else if ( ev.target.id === 'create' ) {
        var filter = userFilterFromCandidate();
        if ( filter ) {
            messaging.tell({ what: 'createUserFilter', filters: filter });
            removeElements(document.querySelectorAll(selectorFromCandidate()));
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
        taCandidate.value = candidateFromClickEvent(ev);
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

var showDialog = function(filters) {
    var divNet = divDialog.querySelector('ul > li:nth-of-type(1) > ul');
    var divCosmetic = divDialog.querySelector('ul > li:nth-of-type(2) > ul');
    removeAllChildren(divCosmetic);
    removeAllChildren(divNet);
    var filter, li;
    for ( var i = 0; i < filters.length; i++ ) {
        filter = filters[i];
        li = document.createElement('li');
        li.textContent = filter;
        if ( filter.indexOf('##') === 0 ) {
            divCosmetic.appendChild(li);
        } else {
            divNet.appendChild(li);
        }
    }
    divDialog.querySelector('ul > li:nth-of-type(1)').style.display = divNet.firstChild ? '' : 'none';
    divDialog.querySelector('ul > li:nth-of-type(2)').style.display = divCosmetic.firstChild ? '' : 'none';
    divDialog.querySelector('ul').style.display = divNet.firstChild || divCosmetic.firstChild ? '' : 'none';
    taCandidate.value = '';
    divDialog.querySelector('#create').disabled = true;
    pausePicker();
};

/******************************************************************************/

var onSvgHovered = function(ev) {
    if ( pickerPaused() ) {
        return;
    }

    svgRoot.style.display = 'none';
    var elem = document.elementFromPoint(ev.clientX, ev.clientY);
    if ( elem == document.body || elem === document.documentElement ) {
        elem = null;
    }
    highlightElements(elem ? [elem] : []);
    svgRoot.style.display = '';
};

/******************************************************************************/

var onSvgClicked = function() {
    if ( pickerPaused() ) {
        return;
    }

    var filter;
    var filters = [];
    for ( var elem = targetElements[0]; elem && elem !== document.body; elem = elem.parentNode ) {
        if ( filter = cosmeticFilterFromElement(elem) ) {
            filters.push(filter);
        }
        if ( filter = netFilterFromElement(elem) ) {
            filters.push(filter);
        }
    }
    showDialog(filters);
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

var stopPicker = function() {
    if ( pickerRoot !== null ) {
        document.removeEventListener('keydown', onKeyPressed);
        taCandidate.removeEventListener('input', onCandidateChanged);
        divDialog.removeEventListener('click', onDialogClicked);
        svgRoot.removeEventListener('mousemove', onSvgHovered);
        svgRoot.removeEventListener('click', onSvgClicked);
        document.body.removeChild(pickerRoot);
        pickerRoot = divDialog = svgRoot = svgOcean = svgIslands = taCandidate = null;
        messaging.stop();
    }
    targetElements = [];
};

/******************************************************************************/

var startPicker = function() {
    pickerRoot = document.querySelector('.' + µBlockClassName);
    if ( pickerRoot !== null ) {
        return;
    }
    pickerRoot = document.createElement('div');
    pickerRoot.className = µBlockClassName;

    var pickerStyle = document.createElement('style');
    pickerStyle.setAttribute('scoped', '');
    pickerStyle.textContent = [
        '.µBlock {',
            'position: absolute;',
            'top: 0;',
            'left: 0;',
        '}',
        '.µBlock, .µBlock * {',
            'margin: 0;',
            'padding: 0;',
            'border: 0;',
            'outline: 0;',
            'font: 12px sans-serif;',
            'text-transform: none;',
            'vertical-align: baseline;',
            'background: transparent;',
        '}',
        '.µBlock button {',
            'border: 1px solid #aaa;',
            'padding: 6px 8px 4px 8px;',
            'box-sizing: border-box;',
            'box-shadow: none;',
            'border-radius: 3px;',
            'line-height: 1;',
            'color: #444;',
            'background-color: #ccc;',
            'cursor: pointer;',
        '}',
        '.µBlock button:hover {',
            'background-color: #eee;',
        '}',
        '.µBlock button:disabled {',
            'color: #999;',
            'background-color: #ccc;',
        '}',
        '.µBlock > svg {',
            'position: absolute;',
            'top: 0;',
            'left: 0;',
            'cursor: crosshair;',
            'z-index: 4999999999;',
        '}',
        '.µBlock.paused > svg {',
            'cursor: wait;',
        '}',
        '.µBlock > svg > path:first-child {',
            'fill: rgba(0,0,0,0.75);',
            'fill-rule: evenodd;',
        '}',
        '.µBlock > svg > path + path {',
            'stroke: #F00;',
            'stroke-width: 0.5px;',
            'fill: rgba(255,0,0,0.25);',
        '}',
        '.µBlock > div {',
            'padding: 4px;',
            'display: none;',
            'position: fixed;',
            'right: 4px;',
            'bottom: 4px;',
            'width: 30em;',
            'font: 12px sans-serif;',
            'background-color: rgba(255,255,255,0.9);',
            'z-index: 5999999999;',
        '}',
        '.µBlock.paused > div {',
            'display: initial;',
        '}',
        '.µBlock > div > div {',
            'padding: 0;',
            'box-sizing: border-box;',
            'width: 100%;',
            'height: 8em;',
            'position: relative;',
        '}',
        '.µBlock > div > div > textarea {',
            'border: 1px solid #ccc;',
            'padding: 2px;',
            'box-sizing: border-box;',
            'width: 100%;',
            'height: 100%;',
            'overflow: hidden;',
            'resize: none;',
            'background-color: white;',
            'font: 11px monospace;',
        '}',
        '.µBlock > div > div > div {',
            'position: absolute;',
            'right: 2px;',
            'bottom: 2px;',
            'opacity: 0.2;',
        '}',
        '.µBlock > div > div > div:hover {',
            'opacity: 1;',
        '}',
        '.µBlock > div > div > div > * {',
            'margin-left: 3px;',
        '}',
        '.µBlock > div > ul {',
            'margin: 0;',
            'border: 1px solid #ccc;',
            'padding: 3px;',
            'list-style-type: none;',
            'text-align: left;',
            'overflow: hidden;',
        '}',
        '.µBlock > div > ul > li > ul {',
            'margin: 0 0 0 1em;',
            'list-style-type: none;',
            'text-align: left;',
            'background-color: #eee;',
            'overflow: hidden;',
        '}',
        '.µBlock > div > ul > li > ul > li {',
            'font: 11px monospace;',
            'white-space: nowrap;',
            'cursor: pointer;',
        '}',
        '.µBlock > div > ul > li > ul > li:hover {',
            'background-color: rgba(255,255,255,1.0);',
        '}',
        ''
    ].join('\n');
    pickerRoot.appendChild(pickerStyle);

    svgRoot = document.createElementNS(svgns, 'svg');
    svgRoot.innerHTML = '<path /><path />';
    var nullRect = { left: 0, top: 0, width: 0, height: 0 };
    var htmlRect = document.documentElement ? document.documentElement.getBoundingClientRect() : nullRect;
    var bodyRect = document.body ? document.body.getBoundingClientRect() : nullRect;
    var svgWidth = Math.max(htmlRect.width, bodyRect.width);
    var svgHeight = Math.max(htmlRect.height, bodyRect.height);
    svgRoot.setAttribute('x', 0);
    svgRoot.setAttribute('y', 0);
    svgRoot.setAttribute('width', svgWidth);
    svgRoot.setAttribute('height', svgHeight);
    svgRoot.setAttribute("viewBox", '0 0 ' + svgWidth + ' ' + svgHeight);
    svgOcean = svgRoot.querySelector('path:first-child');
    svgIslands = svgRoot.querySelector('path + path');
    pickerRoot.appendChild(svgRoot);

    // TODO: do not rely on element ids, they could collide with whatever
    // is used in the page. Just use built-in hierarchy of elements as
    // selectors.

    divDialog = document.createElement('div');
    divDialog.innerHTML = [
        '<div>',
        '<textarea spellcheck="false"></textarea>',
        '<div>',
        '<button id="create" type="button" disabled>.</button>',
        '<button id="pick" type="button">.</button>',
        '<button id="quit" type="button">.</button>',
        '</div>',
        '</div>',
        '<ul>',
        '<li>.<ul></ul>',
        '<li>.<ul></ul>',
        '</ul>',
        ''
    ].join('');
    pickerRoot.appendChild(divDialog);

    document.body.appendChild(pickerRoot);
    svgRoot.addEventListener('click', onSvgClicked);
    svgRoot.addEventListener('mousemove', onSvgHovered);
    divDialog.addEventListener('click', onDialogClicked);
    taCandidate = divDialog.querySelector('textarea');
    taCandidate.addEventListener('input', onCandidateChanged);
    document.addEventListener('keydown', onKeyPressed);
};

/******************************************************************************/

startPicker();

/******************************************************************************/

messaging.ask({ what: 'i18n' }, function(details) {
    divDialog.querySelector('#create').firstChild.nodeValue = details.create;
    divDialog.querySelector('#pick').firstChild.nodeValue = details.pick;
    divDialog.querySelector('#quit').firstChild.nodeValue = details.quit;
    divDialog.querySelector('ul > li:nth-of-type(1)').firstChild.nodeValue = details.netFilters;
    divDialog.querySelector('ul > li:nth-of-type(2)').firstChild.nodeValue = details.cosmeticFilters;
});

/******************************************************************************/

})();

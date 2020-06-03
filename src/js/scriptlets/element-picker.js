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

/* global CSS */

'use strict';

/******************************************************************************/
/******************************************************************************/

(( ) => {

/******************************************************************************/

if (
    window.top !== window ||
    typeof vAPI !== 'object' ||
    vAPI.domFilterer instanceof Object === false
) {
    return;
}

let pickerRoot = document.getElementById(vAPI.sessionId);
if ( pickerRoot ) { return; }

let pickerBody = null;
let svgOcean = null;
let svgIslands = null;
let svgRoot = null;
let dialog = null;
let taCandidate = null;

const netFilterCandidates = [];
const cosmeticFilterCandidates = [];

let targetElements = [];
let candidateElements = [];
let bestCandidateFilter = null;

const lastNetFilterSession = window.location.host + window.location.pathname;
let lastNetFilterHostname = '';
let lastNetFilterUnion = '';

/******************************************************************************/

// For browsers not supporting `:scope`, it's not the end of the world: the
// suggested CSS selectors may just end up being more verbose.

let cssScope = ':scope > ';
try {
    document.querySelector(':scope *');
} catch (e) {
    cssScope = '';
}

/******************************************************************************/

const safeQuerySelectorAll = function(node, selector) {
    if ( node !== null ) {
        try {
            return node.querySelectorAll(selector);
        } catch (e) {
        }
    }
    return [];
};

/******************************************************************************/

const rawFilterFromTextarea = function() {
    const s = taCandidate.value;
    const pos = s.indexOf('\n');
    return pos === -1 ? s.trim() : s.slice(0, pos).trim();
};

/******************************************************************************/

const getElementBoundingClientRect = function(elem) {
    let rect = typeof elem.getBoundingClientRect === 'function'
        ? elem.getBoundingClientRect()
        : { height: 0, left: 0, top: 0, width: 0 };

    // https://github.com/gorhill/uBlock/issues/1024
    // Try not returning an empty bounding rect.
    if ( rect.width !== 0 && rect.height !== 0 ) {
        return rect;
    }

    let left = rect.left,
        right = rect.right,
        top = rect.top,
        bottom = rect.bottom;

    for ( const child of elem.children ) {
        rect = getElementBoundingClientRect(child);
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

const highlightElements = function(elems, force) {
    // To make mouse move handler more efficient
    if ( !force && elems.length === targetElements.length ) {
        if ( elems.length === 0 || elems[0] === targetElements[0] ) {
            return;
        }
    }
    targetElements = elems;

    const ow = pickerRoot.contentWindow.innerWidth;
    const oh = pickerRoot.contentWindow.innerHeight;
    const ocean = [
        'M0 0',
        'h', ow,
        'v', oh,
        'h-', ow,
        'z'
    ];
    const islands = [];

    for ( let i = 0; i < elems.length; i++ ) {
        const elem = elems[i];
        if ( elem === pickerRoot ) {
            continue;
        }
        const rect = getElementBoundingClientRect(elem);

        // Ignore if it's not on the screen
        if ( rect.left > ow || rect.top > oh ||
             rect.left + rect.width < 0 || rect.top + rect.height < 0 ) {
            continue;
        }

        const poly = 'M' + rect.left + ' ' + rect.top +
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

const mergeStrings = function(urls) {
    if ( urls.length === 0 ) { return ''; }
    if (
        urls.length === 1 ||
        self.diff_match_patch instanceof Function === false
    ) {
        return urls[0];
    }
    const differ = new self.diff_match_patch();
    let merged = urls[0];
    for ( let i = 1; i < urls.length; i++ ) {
        // The differ works at line granularity: we insert a linefeed after
        // each character to trick the differ to work at character granularity.
        const diffs = differ.diff_main(
            //urls[i].replace(/.(?=.)/g, '$&\n'),
            //merged.replace(/.(?=.)/g, '$&\n')
            urls[i].split('').join('\n'),
            merged.split('').join('\n')
        );
        const result = [];
        for ( const diff of diffs ) {
            if ( diff[0] !== 0 ) {
                result.push('*');
            } else {
                result.push(diff[1].replace(/\n+/g, ''));
            }
            merged = result.join('');
        }
    }
    // Keep usage of wildcards to a sane level, too many of them can cause
    // high overhead filters
    merged = merged.replace(/^\*+$/, '')
                   .replace(/\*{2,}/g, '*')
                   .replace(/([^*]{1,3}\*)(?:[^*]{1,3}\*)+/g, '$1');
    return merged;
};

/******************************************************************************/

// Remove fragment part from a URL.

const trimFragmentFromURL = function(url) {
    const pos = url.indexOf('#');
    return pos !== -1 ? url.slice(0, pos) : url;
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1897
// Ignore `data:` URI, they can't be handled by an HTTP observer.

const backgroundImageURLFromElement = function(elem) {
    const style = window.getComputedStyle(elem);
    const bgImg = style.backgroundImage || '';
    const matches = /^url\((["']?)([^"']+)\1\)$/.exec(bgImg);
    const url = matches !== null && matches.length === 3 ? matches[2] : '';
    return url.lastIndexOf('data:', 0) === -1
        ? trimFragmentFromURL(url.slice(0, 1024))
        : '';
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1725#issuecomment-226479197
//   Limit returned string to 1024 characters.
//   Also, return only URLs which will be seen by an HTTP observer.

const resourceURLsFromElement = function(elem) {
    const urls = [];
    const tagName = elem.localName;
    const prop = netFilter1stSources[tagName];
    if ( prop === undefined ) {
        const url = backgroundImageURLFromElement(elem);
        if ( url !== '' ) { urls.push(url); }
        return urls;
    }
    {
        const s = elem[prop];
        if ( typeof s === 'string' && /^https?:\/\//.test(s) ) {
            urls.push(trimFragmentFromURL(s.slice(0, 1024)));
        }
    }
    if ( typeof elem.srcset === 'string' && elem.srcset !== '' ) {
        for ( let s of elem.srcset.split(',') ) {
            s = s.trim();
            const pos = s.indexOf(' ');
            if ( pos !== -1 ) { s = s.slice(0, pos); }
            const parsedURL = new URL(s, document.baseURI);
            if ( parsedURL.pathname.length > 1 ) {
                urls.push(trimFragmentFromURL(parsedURL.href));
            }
        }
    }
    return urls;
};

/******************************************************************************/

const netFilterFromUnion = function(patternIn, out) {
    // Reset reference filter when dealing with unrelated URLs
    const currentHostname = self.location.hostname;
    if (
        lastNetFilterUnion === '' ||
        currentHostname === '' ||
        currentHostname !== lastNetFilterHostname
    ) {
        lastNetFilterHostname = currentHostname;
        lastNetFilterUnion = patternIn;
        vAPI.messaging.send('elementPicker', {
            what: 'elementPickerEprom',
            lastNetFilterSession,
            lastNetFilterHostname,
            lastNetFilterUnion,
        });
        return;
    }

    // Related URLs
    lastNetFilterHostname = currentHostname;
    let patternOut = mergeStrings([ patternIn, lastNetFilterUnion ]);
    if ( patternOut !== '/*' && patternOut !== patternIn ) {
        const filter = `||${patternOut}`;
        if ( out.indexOf(filter) === -1 ) {
            out.push(filter);
        }
        lastNetFilterUnion = patternOut;
    }

    // Remember across element picker sessions
    vAPI.messaging.send('elementPicker', {
        what: 'elementPickerEprom',
        lastNetFilterSession,
        lastNetFilterHostname,
        lastNetFilterUnion,
    });
};

/******************************************************************************/

// Extract the best possible net filter, i.e. as specific as possible.

const netFilterFromElement = function(elem) {
    if ( elem === null ) { return 0; }
    if ( elem.nodeType !== 1 ) { return 0; }
    const urls = resourceURLsFromElement(elem);
    if ( urls.length === 0 ) { return 0; }

    if ( candidateElements.indexOf(elem) === -1 ) {
        candidateElements.push(elem);
    }

    const candidates = netFilterCandidates;
    const len = candidates.length;

    for ( let i = 0; i < urls.length; i++ ) {
        urls[i] = urls[i].replace(/^https?:\/\//, '');
    }
    const pattern = mergeStrings(urls);


    if ( bestCandidateFilter === null ) {
        bestCandidateFilter = {
            type: 'net',
            filters: candidates,
            slot: candidates.length
        };
    }

    candidates.push(`||${pattern}`);

    // Suggest a less narrow filter if possible
    const pos = pattern.indexOf('?');
    if ( pos !== -1 ) {
        candidates.push(`||${pattern.slice(0, pos)}`);
    }

    // Suggest a filter which is a result of combining more than one URL.
    netFilterFromUnion(pattern, candidates);

    return candidates.length - len;
};

const netFilter1stSources = {
     'audio': 'src',
     'embed': 'src',
    'iframe': 'src',
       'img': 'src',
    'object': 'data',
     'video': 'src'
};

const filterTypes = {
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
//   Also take into account the `src` attribute for `img` elements -- and limit
//   the value to the 1024 first characters.

const cosmeticFilterFromElement = function(elem) {
    if ( elem === null ) { return 0; }
    if ( elem.nodeType !== 1 ) { return 0; }

    if ( candidateElements.indexOf(elem) === -1 ) {
        candidateElements.push(elem);
    }

    let selector = '';

    // Id
    let v = typeof elem.id === 'string' && CSS.escape(elem.id);
    if ( v ) {
        selector = '#' + v;
    }

    // Class(es)
    v = elem.classList;
    if ( v ) {
        let i = v.length || 0;
        while ( i-- ) {
            selector += '.' + CSS.escape(v.item(i));
        }
    }

    // Tag name
    const tagName = elem.localName;

    // Use attributes if still no selector found.
    // https://github.com/gorhill/uBlock/issues/1901
    //   Trim attribute value, this may help in case of malformed HTML.
    if ( selector === '' ) {
        let attributes = [], attr;
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
                v = v.trim();
                if ( v.startsWith('data:') ) {
                    let pos = v.indexOf(',');
                    if ( pos !== -1 ) {
                        v = v.slice(0, pos + 1);
                    }
                } else if ( v.startsWith('blob:') ) {
                    v = new URL(v.slice(5));
                    v.pathname = '';
                    v = 'blob:' + v.href;
                }
                attributes.push({ k: 'src', v: v.slice(0, 256) });
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
            if ( attr.v.length === 0 ) { continue; }
            v = elem.getAttribute(attr.k);
            if ( attr.v === v ) {
                selector += '[' + attr.k + '="' + attr.v + '"]';
            } else if ( v.startsWith(attr.v) ) {
                selector += '[' + attr.k + '^="' + attr.v + '"]';
            } else {
                selector += '[' + attr.k + '*="' + attr.v + '"]';
            }
        }
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/17
    //   If selector is ambiguous at this point, add the element name to
    //   further narrow it down.
    const parentNode = elem.parentNode;
    if (
        selector === '' ||
        safeQuerySelectorAll(parentNode, cssScope + selector).length > 1
    ) {
        selector = tagName + selector;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/637
    //   If the selector is still ambiguous at this point, further narrow using
    //   `nth-of-type`. It is preferable to use `nth-of-type` as opposed to
    //   `nth-child`, as `nth-of-type` is less volatile.
    if ( safeQuerySelectorAll(parentNode, cssScope + selector).length > 1 ) {
        let i = 1;
        while ( elem.previousSibling !== null ) {
            elem = elem.previousSibling;
            if (
                typeof elem.localName === 'string' &&
                elem.localName === tagName
            ) {
                i++;
            }
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

const filtersFrom = function(x, y) {
    bestCandidateFilter = null;
    netFilterCandidates.length = 0;
    cosmeticFilterCandidates.length = 0;
    candidateElements.length = 0;

    // We need at least one element.
    let first = null;
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
    let elem = first;
    while ( elem && elem !== document.body ) {
        cosmeticFilterFromElement(elem);
        elem = elem.parentNode;
    }
    // The body tag is needed as anchor only when the immediate child
    // uses `nth-of-type`.
    let i = cosmeticFilterCandidates.length;
    if ( i !== 0 ) {
        let selector = cosmeticFilterCandidates[i-1];
        if (
            selector.indexOf(':nth-of-type(') !== -1 &&
            safeQuerySelectorAll(document.body, selector).length > 1
        ) {
            cosmeticFilterCandidates.push('##body');
        }
    }

    // https://github.com/gorhill/uBlock/issues/1545
    // Network filter candidates from all other elements found at point (x, y).
    if ( typeof x === 'number' ) {
        let attrName = pickerRoot.id + '-clickblind';
        let previous;
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
        let elems = document.querySelectorAll('[' + attrName + ']');
        i = elems.length;
        while ( i-- ) {
            elems[i].removeAttribute(attrName);
        }

        netFilterFromElement(document.body);
    }

    return netFilterCandidates.length + cosmeticFilterCandidates.length;
};

/*******************************************************************************

    filterToDOMInterface.set
    @desc   Look-up all the HTML elements matching the filter passed in
            argument.
    @param  string, a cosmetic or network filter.
    @param  function, called once all items matching the filter have been
            collected.
    @return array, or undefined if the filter is invalid.

    filterToDOMInterface.preview
    @desc   Apply/unapply filter to the DOM.
    @param  string, a cosmetic of network filter, or literal false to remove
            the effects of the filter on the DOM.
    @return undefined.

    TODO: need to be revised once I implement chained cosmetic operators.

*/

const filterToDOMInterface = (( ) => {
    const reHnAnchorPrefix = '^[\\w-]+://(?:[^/?#]+\\.)?';
    const reCaret = '(?:[^%.0-9a-z_-]|$)';
    const rePseudoElements = /:(?::?after|:?before|:[a-z-]+)$/;

    // Net filters: we need to lookup manually -- translating into a foolproof
    // CSS selector is just not possible.
    //
    // https://github.com/chrisaljoudi/uBlock/issues/945
    //   Transform into a regular expression, this allows the user to
    //   edit and insert wildcard(s) into the proposed filter.
    // https://www.reddit.com/r/uBlockOrigin/comments/c5do7w/
    //   Better handling of pure hostname filters. Also, discard single
    //   alphanumeric character filters.
    const fromNetworkFilter = function(filter) {
        const out = [];
        if ( /^[0-9a-z]$/i.test(filter) ) { return out; }
        let reStr = '';
        if (
            filter.length > 2 &&
            filter.startsWith('/') &&
            filter.endsWith('/')
        ) {
            reStr = filter.slice(1, -1);
        } else if ( /^\w[\w.-]*[a-z]$/i.test(filter) ) {
            reStr = reHnAnchorPrefix +
                    filter.toLowerCase().replace(/\./g, '\\.') +
                    reCaret;
        } else {
            let rePrefix = '', reSuffix = '';
            if ( filter.startsWith('||') ) {
                rePrefix = reHnAnchorPrefix;
                filter = filter.slice(2);
            } else if ( filter.startsWith('|') ) {
                rePrefix = '^';
                filter = filter.slice(1);   
            }
            if ( filter.endsWith('|') ) {
                reSuffix = '$';
                filter = filter.slice(0, -1);
            }
            reStr = rePrefix +
                    filter.replace(/[.+?${}()|[\]\\]/g, '\\$&')
                          .replace(/\*+/g, '.*')
                          .replace(/\^/g, reCaret) +
                    reSuffix;
        }
        let reFilter = null;
        try {
            reFilter = new RegExp(reStr, 'i');
        }
        catch (e) {
            return out;
        }

        // Lookup by tag names.
        const elems = document.querySelectorAll(
            Object.keys(netFilter1stSources).join()
        );
        for ( const elem of elems ) {
            let srcProp = netFilter1stSources[elem.localName];
            let src = elem[srcProp];
            if ( typeof src !== 'string' || src.length === 0 ) {
                if (
                    typeof elem.srcset === 'string' &&
                    elem.srcset !== '' &&
                    typeof elem.currentSrc === 'string'
                ) {
                    src = elem.currentSrc;
                }
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
        for ( const elem of candidateElements ) {
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

    // Cosmetic filters: these are straight CSS selectors.
    //
    // https://github.com/uBlockOrigin/uBlock-issues/issues/389
    //   Test filter using comma-separated list to better detect invalid CSS
    //   selectors.
    //
    // https://github.com/gorhill/uBlock/issues/2515
    //   Remove trailing pseudo-element when querying.
    const fromPlainCosmeticFilter = function(raw) {
        let elems;
        try {
            document.documentElement.matches(`${raw},\na`);
            elems = document.querySelectorAll(
                raw.replace(rePseudoElements, '')
            );
        }
        catch (e) {
            return;
        }
        const out = [];
        for ( const elem of elems ) {
            if ( elem === pickerRoot ) { continue; }
            out.push({ type: 'cosmetic', elem, raw });
        }
        return out;
    };

    // https://github.com/gorhill/uBlock/issues/1772
    //   Handle procedural cosmetic filters.
    //
    // https://github.com/gorhill/uBlock/issues/2515
    //   Remove trailing pseudo-element when querying.
    const fromCompiledCosmeticFilter = function(raw) {
        if ( typeof raw !== 'string' ) { return; }
        let elems;
        try {
            const o = JSON.parse(raw);
            if ( o.action === 'style' ) {
                elems = document.querySelectorAll(
                    o.selector.replace(rePseudoElements, '')
                );
                lastAction = o.selector + ' {' + o.tasks[0][1] + '}';
            } else if ( o.tasks ) {
                elems = vAPI.domFilterer.createProceduralFilter(o).exec();
            }
        } catch(ex) {
            return;
        }
        if ( !elems ) { return; }
        const out = [];
        for ( const elem of elems ) {
            out.push({ type: 'cosmetic', elem, raw });
        }
        return out;
    };

    let lastFilter,
        lastResultset,
        lastAction,
        appliedStyleTag,
        applied = false,
        previewing = false;

    const queryAll = async function(filter, callback) {
        filter = filter.trim();
        if ( filter === lastFilter ) {
            callback(lastResultset);
            return;
        }
        unapply();
        if ( filter === '' ) {
            lastFilter = '';
            lastResultset = [];
            callback(lastResultset);
            return;
        }
        lastFilter = filter;
        lastAction = undefined;
        if ( filter.startsWith('##') === false ) {
            lastResultset = fromNetworkFilter(filter);
            if ( previewing ) { apply(); }
            callback(lastResultset);
            return;
        }
        const selector = filter.slice(2);
        lastResultset = fromPlainCosmeticFilter(selector);
        if ( lastResultset ) {
            if ( previewing ) { apply(); }
            callback(lastResultset);
            return;
        }
        // Procedural cosmetic filter
        const response = await vAPI.messaging.send('elementPicker', {
            what: 'compileCosmeticFilterSelector',
            selector,
        });
        lastResultset = fromCompiledCosmeticFilter(response);
        if ( previewing ) { apply(); }
        callback(lastResultset);
    };

    // https://github.com/gorhill/uBlock/issues/1629
    //   Avoid hiding the element picker's related elements.
    const applyHide = function() {
        const htmlElem = document.documentElement;
        for ( const item of lastResultset ) {
            const elem = item.elem;
            if ( elem === pickerRoot ) { continue; }
            if (
                (elem !== htmlElem) &&
                (item.type === 'cosmetic' || item.type === 'network' && item.src !== undefined)
            ) {
                vAPI.domFilterer.hideNode(elem);
                item.hidden = true;
            }
            if ( item.type === 'network' && item.style === 'background-image' ) {
                const style = elem.style;
                item.backgroundImage = style.getPropertyValue('background-image');
                item.backgroundImagePriority = style.getPropertyPriority('background-image');
                style.setProperty('background-image', 'none', 'important');
            }
        }
    };

    const unapplyHide = function() {
        if ( lastResultset === undefined ) { return; }
        for ( const item of lastResultset ) {
            if ( item.hidden === true ) {
                vAPI.domFilterer.unhideNode(item.elem);
                item.hidden = false;
            }
            if ( item.hasOwnProperty('backgroundImage') ) {
                item.elem.style.setProperty(
                    'background-image',
                    item.backgroundImage,
                    item.backgroundImagePriority
                );
                delete item.backgroundImage;
            }
        }
    };

    const unapplyStyle = function() {
        if ( !appliedStyleTag || appliedStyleTag.parentNode === null ) {
            return;
        }
        appliedStyleTag.parentNode.removeChild(appliedStyleTag);
    };

    const applyStyle = function() {
        if ( !appliedStyleTag ) {
            appliedStyleTag = document.createElement('style');
            appliedStyleTag.setAttribute('type', 'text/css');
        }
        appliedStyleTag.textContent = lastAction;
        if ( appliedStyleTag.parentNode === null ) {
            document.head.appendChild(appliedStyleTag);
        }
    };

    const apply = function() {
        if ( applied ) {
            unapply();
        }
        if ( lastResultset === undefined ) { return; }
        if ( typeof lastAction === 'string' ) {
            applyStyle();
        } else {
            applyHide();
        }
        applied = true;
    };

    const unapply = function() {
        if ( !applied ) { return; }
        if ( typeof lastAction === 'string' ) {
            unapplyStyle();
        } else {
            unapplyHide();
        }
        applied = false;
    };

    // https://www.reddit.com/r/uBlockOrigin/comments/c62irc/
    //   Support injecting the cosmetic filters into the DOM filterer
    //   immediately rather than wait for the next page load.
    const preview = function(rawFilter, permanent = false) {
        previewing = rawFilter !== false;
        pickerBody.classList.toggle('preview', previewing);
        if ( previewing === false ) {
            return unapply();
        }
        queryAll(rawFilter, items => {
            if ( items === undefined ) { return; }
            apply();
            if ( permanent === false ) { return; }
            if ( vAPI.domFilterer instanceof Object === false ) { return; }
            const cssSelectors = new Set();
            const proceduralSelectors = new Set();
            for ( const item of items ) {
                if ( item.type !== 'cosmetic' ) { continue; }
                if ( item.raw.startsWith('{') ) {
                    proceduralSelectors.add(item.raw);
                } else {
                    cssSelectors.add(item.raw);
                }
            }
            if ( cssSelectors.size !== 0 ) {
                vAPI.domFilterer.addCSSRule(
                    Array.from(cssSelectors),
                    'display:none!important;'
                );
            }
            if ( proceduralSelectors.size !== 0 ) {
                vAPI.domFilterer.addProceduralSelectors(
                    Array.from(proceduralSelectors)
                );
            }
        });
    };

    return {
        previewing: function() { return previewing; },
        preview: preview,
        set: queryAll
    };
})();

/******************************************************************************/

const userFilterFromCandidate = function(callback) {
    let v = rawFilterFromTextarea();
    filterToDOMInterface.set(v, items => {
        if ( !items || items.length === 0 ) {
            callback();
            return;
        }

        // https://github.com/gorhill/uBlock/issues/738
        // Trim dots.
        let hostname = window.location.hostname;
        if ( hostname.slice(-1) === '.' ) {
            hostname = hostname.slice(0, -1);
        }

        // Cosmetic filter?
        if ( v.startsWith('##') ) {
            callback(hostname + v, true);
            return;
        }

        // Assume net filter
        const opts = [];

        // If no domain included in filter, we need domain option
        if ( v.startsWith('||') === false ) {
            opts.push(`domain=${hostname}`);
        }

        const item = items[0];
        if ( item.opts ) {
            opts.push(item.opts);
        }

        if ( opts.length ) {
            v += '$' + opts.join(',');
        }

        callback(v);
    });
};

/******************************************************************************/

const onCandidateChanged = (function() {
    const process = function(items) {
        const elems = [];
        const valid = items !== undefined;
        if ( valid ) {
            for ( const item of items ) {
                elems.push(item.elem);
            }
        }
        pickerBody.querySelector('#resultsetCount').textContent = valid ?
            items.length.toLocaleString() :
            'E';
        dialog.querySelector('section').classList.toggle('invalidFilter', !valid);
        dialog.querySelector('#create').disabled = elems.length === 0;
        highlightElements(elems, true);
    };

    return function() {
        filterToDOMInterface.set(rawFilterFromTextarea(), process);
    };
})();

/******************************************************************************/

const candidateFromFilterChoice = function(filterChoice) {
    let slot = filterChoice.slot;
    let filters = filterChoice.filters;
    let filter = filters[slot];

    if ( filter === undefined ) { return ''; }

    // For net filters there no such thing as a path
    if ( filter.startsWith('##') === false ) { return filter; }

    // At this point, we have a cosmetic filter

    // Modifier means "target broadly". Hence:
    // - Do not compute exact path.
    // - Discard narrowing directives.
    // - Remove the id if one or more classes exist
    //   TODO: should remove tag name too? ¯\_(ツ)_/¯
    if ( filterChoice.modifier ) {
        filter = filter.replace(/:nth-of-type\(\d+\)/, '');
        // https://github.com/uBlockOrigin/uBlock-issues/issues/162
        //   Mind escaped periods: they do not denote a class identifier.
        if ( filter.charAt(2) === '#' ) {
            let pos = filter.search(/[^\\]\./);
            if ( pos !== -1 ) {
                filter = '##' + filter.slice(pos + 1);
            }
        }
        return filter;
    }

    // Return path: the target element, then all siblings prepended
    let selector = '', joiner = '';
    for ( ; slot < filters.length; slot++ ) {
        filter = filters[slot];
        // Remove all classes when an id exists.
        // https://github.com/uBlockOrigin/uBlock-issues/issues/162
        //   Mind escaped periods: they do not denote a class identifier.
        if ( filter.charAt(2) === '#' ) {
            filter = filter.replace(/([^\\])\..+$/, '$1');
        }
        selector = filter.slice(2) + joiner + selector;
        // Stop at any element with an id: these are unique in a web page
        if ( filter.startsWith('###') ) { break; }
        // Stop if current selector matches only one element on the page
        if ( document.querySelectorAll(selector).length === 1 ) { break; }
        joiner = ' > ';
    }

    // https://github.com/gorhill/uBlock/issues/2519
    // https://github.com/uBlockOrigin/uBlock-issues/issues/17
    if (
        slot === filters.length &&
        selector.startsWith('body > ') === false &&
        document.querySelectorAll(selector).length > 1
    ) {
        selector = 'body > ' + selector;
    }

    return '##' + selector;
};

/******************************************************************************/

const filterChoiceFromEvent = function(ev) {
    let li = ev.target;
    const isNetFilter = li.textContent.startsWith('##') === false;
    const r = {
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

const onDialogClicked = function(ev) {
    if ( ev.isTrusted === false ) { return; }

    // If the dialog is hidden, clicking on it force it to become visible.
    if ( dialog.classList.contains('hide') ) {
        dialog.classList.add('show');
        dialog.classList.remove('hide');
    }

    else if ( ev.target === null ) {
        /* do nothing */
    }

    else if ( ev.target.id === 'create' ) {
        // We have to exit from preview mode: this guarantees matching elements
        // will be found for the candidate filter.
        filterToDOMInterface.preview(false);
        userFilterFromCandidate((filter = undefined, isCosmetic = false) => {
            if ( filter === undefined ) { return; }
            vAPI.messaging.send('elementPicker', {
                what: 'createUserFilter',
                autoComment: true,
                filters: filter,
                origin: window.location.origin,
                pageDomain: window.location.hostname,
                killCache: isCosmetic === false,
            });
            filterToDOMInterface.preview(rawFilterFromTextarea(), true);
            stopPicker();
        });
    }

    else if ( ev.target.id === 'pick' ) {
        unpausePicker();
    }

    else if ( ev.target.id === 'quit' ) {
        filterToDOMInterface.preview(false);
        stopPicker();
    }

    else if ( ev.target.id === 'preview' ) {
        if ( filterToDOMInterface.previewing() ) {
            filterToDOMInterface.preview(false);
        } else {
            filterToDOMInterface.preview(rawFilterFromTextarea());
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

const removeAllChildren = function(parent) {
    while ( parent.firstChild ) {
        parent.removeChild(parent.firstChild);
    }
};

/******************************************************************************/

const showDialog = function(options) {
    pausePicker();

    options = options || {};

    // Typically the dialog will be forced to be visible when using a
    // touch-aware device.
    dialog.classList.toggle('show', options.show === true);
    dialog.classList.remove('hide');

    // Create lists of candidate filters
    const populate = function(src, des) {
        const root = dialog.querySelector(des);
        const ul = root.querySelector('ul');
        removeAllChildren(ul);
        for ( let i = 0; i < src.length; i++ ) {
            const li = document.createElement('li');
            li.textContent = src[i];
            ul.appendChild(li);
        }
        if ( src.length !== 0 ) {
            root.style.removeProperty('display');
        } else {
            root.style.setProperty('display', 'none', 'important');
        }
    };

    populate(netFilterCandidates, '#netFilters');
    populate(cosmeticFilterCandidates, '#cosmeticFilters');

    dialog.querySelector('ul').style.display =
        netFilterCandidates.length || cosmeticFilterCandidates.length
            ? ''
            : 'none';
    dialog.querySelector('#create').disabled = true;

    // Auto-select a candidate filter

    if ( bestCandidateFilter === null ) {
        taCandidate.value = '';
        return;
    }

    const filterChoice = {
        filters: bestCandidateFilter.filters,
        slot: bestCandidateFilter.slot,
        modifier: options.modifier || false
    };

    taCandidate.value = candidateFromFilterChoice(filterChoice);
    onCandidateChanged();
};

/******************************************************************************/

// https://www.reddit.com/r/uBlockOrigin/comments/bktxtb/scrolling_doesnt_work/emn901o
//   Override 'fixed' position property on body element if present.

const zap = function() {
    if ( targetElements.length === 0 ) { return; }

    const getStyleValue = function(elem, prop) {
        const style = window.getComputedStyle(elem);
        return style ? style[prop] : '';
    };

    let elem = targetElements[0];
    // Heuristic to detect scroll-locking: remove such lock when detected.
    if (
        parseInt(getStyleValue(elem, 'zIndex'), 10) >= 1000 ||
        getStyleValue(elem, 'position') === 'fixed'
    ) {
        const doc = document;
        if ( getStyleValue(doc.body, 'overflowY') === 'hidden' ) {
            doc.body.style.setProperty('overflow', 'auto', 'important');
        }
        if ( getStyleValue(doc.body, 'position') === 'fixed' ) {
            doc.body.style.setProperty('position', 'static', 'important');
        }
        if ( getStyleValue(doc.documentElement, 'overflowY') === 'hidden' ) {
            doc.documentElement.style.setProperty('overflow', 'auto', 'important');
        }
    }

    elem.parentNode.removeChild(elem);
    elem = elementFromPoint();
    highlightElements(elem ? [ elem ] : []);
};

/******************************************************************************/

const elementFromPoint = (( ) => {
    let lastX, lastY;

    return (x, y) => {
        if ( x !== undefined ) {
            lastX = x; lastY = y;
        } else if ( lastX !== undefined ) {
            x = lastX; y = lastY;
        } else {
            return null;
        }
        if ( !pickerRoot ) { return null; }
        pickerRoot.style.setProperty('pointer-events', 'none', 'important');
        let elem = document.elementFromPoint(x, y);
        if ( elem === document.body || elem === document.documentElement ) {
            elem = null;
        }
        // https://github.com/uBlockOrigin/uBlock-issues/issues/380
        pickerRoot.style.setProperty('pointer-events', 'auto', 'important');
        return elem;
    };
})();

/******************************************************************************/

const onSvgHovered = (function() {
    let timer;
    let mx = 0, my = 0;

    const onTimer = function() {
        timer = undefined;
        const elem = elementFromPoint(mx, my);
        highlightElements(elem ? [elem] : []);
    };

    return function onMove(ev) {
        mx = ev.clientX;
        my = ev.clientY;
        if ( timer === undefined ) {
            timer = vAPI.setTimeout(onTimer, 40);
        }
    };
})();

/*******************************************************************************

    Swipe right:
        If picker not paused: quit picker
        If picker paused and dialog visible: hide dialog
        If picker paused and dialog not visible: quit picker

    Swipe left:
        If picker paused and dialog not visible: show dialog

*/

const onSvgTouchStartStop = (function() {
    var startX,
        startY;
    return function onTouch(ev) {
        if ( ev.type === 'touchstart' ) {
            startX = ev.touches[0].screenX;
            startY = ev.touches[0].screenY;
            return;
        }
        if ( startX === undefined ) { return; }
        if ( ev.cancelable === false ) { return; }
        var stopX = ev.changedTouches[0].screenX,
            stopY = ev.changedTouches[0].screenY,
            angle = Math.abs(Math.atan2(stopY - startY, stopX - startX)),
            distance = Math.sqrt(
                Math.pow(stopX - startX, 2),
                Math.pow(stopY - startY, 2)
            );
        // Interpret touch events as a click events if swipe is not valid.
        if ( distance < 32 ) {
            onSvgClicked({
                type: 'touch',
                target: ev.target,
                clientX: ev.changedTouches[0].pageX,
                clientY: ev.changedTouches[0].pageY,
                isTrusted: ev.isTrusted
            });
            ev.preventDefault();
            return;
        }
        if ( distance < 64 ) { return; }
        var angleUpperBound = Math.PI * 0.25 * 0.5,
            swipeRight = angle < angleUpperBound;
        if ( swipeRight === false && angle < Math.PI - angleUpperBound ) {
            return;
        }
        ev.preventDefault();
        // Swipe left.
        if ( swipeRight === false ) {
            if ( pickerBody.classList.contains('paused') ) {
                dialog.classList.remove('hide');
                dialog.classList.add('show');
            }
            return;
        }
        // Swipe right.
        if (
            pickerBody.classList.contains('paused') &&
            dialog.classList.contains('show')
        ) {
            dialog.classList.remove('show');
            dialog.classList.add('hide');
            return;
        }
        stopPicker();
    };
})();

/******************************************************************************/

const onSvgClicked = function(ev) {
    if ( ev.isTrusted === false ) { return; }

    // If zap mode, highlight element under mouse, this makes the zapper usable
    // on touch screens.
    if ( pickerBody.classList.contains('zap') ) {
        var elem = targetElements.lenght !== 0 && targetElements[0];
        if ( !elem || ev.target !== svgIslands ) {
            elem = elementFromPoint(ev.clientX, ev.clientY);
            if ( elem !== null ) {
                highlightElements([elem]);
                return;
            }
        }
        zap();
        if ( !ev.shiftKey ) {
            stopPicker();
        }
        return;
    }
    // https://github.com/chrisaljoudi/uBlock/issues/810#issuecomment-74600694
    // Unpause picker if:
    // - click outside dialog AND
    // - not in preview mode
    if ( pickerBody.classList.contains('paused') ) {
        if ( filterToDOMInterface.previewing() === false ) {
            unpausePicker();
        }
        return;
    }
    if ( filtersFrom(ev.clientX, ev.clientY) === 0 ) {
        return;
    }
    showDialog({
        show: ev.type === 'touch',
        modifier: ev.ctrlKey
    });
};

/******************************************************************************/

const svgListening = function(on) {
    var action = (on ? 'add' : 'remove') + 'EventListener';
    svgRoot[action]('mousemove', onSvgHovered, { passive: true });
};

/******************************************************************************/

const onKeyPressed = function(ev) {
    // Delete
    if (
        (ev.key === 'Delete' || ev.key === 'Backspace') &&
        pickerBody.classList.contains('zap')
    ) {
        ev.stopPropagation();
        ev.preventDefault();
        zap();
        return;
    }
    // Esc
    if ( ev.key === 'Escape' || ev.which === 27 ) {
        ev.stopPropagation();
        ev.preventDefault();
        filterToDOMInterface.preview(false);
        stopPicker();
        return;
    }
};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/190
// May need to dynamically adjust the height of the overlay + new position
// of highlighted elements.

const onScrolled = function() {
    highlightElements(targetElements, true);
};

/******************************************************************************/

const onStartMoving = (( ) => {
    let mx0 = 0, my0 = 0;
    let mx1 = 0, my1 = 0;
    let r0 = 0, b0 = 0;
    let rMax = 0, bMax = 0;
    let timer;

    const move = ( ) => {
        timer = undefined;
        let r1 = Math.min(Math.max(r0 - mx1 + mx0, 4), rMax);
        let b1 = Math.min(Math.max(b0 - my1 + my0, 4), bMax);
        dialog.style.setProperty('right', `${r1}px`, 'important');
        dialog.style.setProperty('bottom', `${b1}px`, 'important');
    };

    const moveAsync = ev => {
        if ( ev.isTrusted === false ) { return; }
        ev.preventDefault();
        ev.stopPropagation();
        if ( timer !== undefined ) { return; }
        mx1 = ev.pageX;
        my1 = ev.pageY;
        timer = self.requestAnimationFrame(move);
    };

    const stop = ev => {
        if ( ev.isTrusted === false ) { return; }
        if ( dialog.classList.contains('moving') === false ) { return; }
        dialog.classList.remove('moving');
        const pickerWin = pickerRoot.contentWindow;
        pickerWin.removeEventListener('mousemove', moveAsync, { capture: true });
        pickerWin.removeEventListener('mouseup', stop, { capture: true, once: true });
        ev.preventDefault();
        ev.stopPropagation();
    };

    return function(ev) {
        if ( ev.isTrusted === false ) { return; }
        const target = dialog.querySelector('#toolbar');
        if ( ev.target !== target ) { return; }
        if ( dialog.classList.contains('moving') ) { return; }
        mx0 = ev.pageX; my0 = ev.pageY;
        const pickerWin = pickerRoot.contentWindow;
        const style = pickerWin.getComputedStyle(dialog);
        r0 = parseInt(style.right, 10);
        b0 = parseInt(style.bottom, 10);
        const rect = dialog.getBoundingClientRect();
        rMax = pickerBody.clientWidth - 4 - rect.width ;
        bMax = pickerBody.clientHeight - 4 - rect.height;
        dialog.classList.add('moving');
        pickerWin.addEventListener('mousemove', moveAsync, { capture: true });
        pickerWin.addEventListener('mouseup', stop, { capture: true, once: true });
        ev.preventDefault();
        ev.stopPropagation();
    };
})();

/******************************************************************************/

const pausePicker = function() {
    pickerBody.classList.add('paused');
    svgListening(false);
};

/******************************************************************************/

const unpausePicker = function() {
    filterToDOMInterface.preview(false);
    pickerBody.classList.remove('paused');
    svgListening(true);
};

/******************************************************************************/

// Let's have the element picker code flushed from memory when no longer
// in use: to ensure this, release all local references.

const stopPicker = function() {
    vAPI.shutdown.remove(stopPicker);

    targetElements = [];
    candidateElements = [];
    bestCandidateFilter = null;

    if ( pickerRoot === null ) { return; }

    // https://github.com/gorhill/uBlock/issues/2060
    if ( vAPI.domFilterer instanceof Object ) {
        vAPI.userStylesheet.remove(pickerCSS1);
        vAPI.userStylesheet.remove(pickerCSS2);
        vAPI.userStylesheet.apply();
    }
    vAPI.domFilterer.unexcludeNode(pickerRoot);

    window.removeEventListener('scroll', onScrolled, true);
    svgListening(false);
    pickerRoot.parentNode.removeChild(pickerRoot);
    pickerRoot = pickerBody =
        svgRoot = svgOcean = svgIslands =
        dialog = taCandidate = null;

    window.focus();
};

/******************************************************************************/

const startPicker = function(details) {
    pickerRoot.addEventListener('load', stopPicker);

    const frameDoc = pickerRoot.contentDocument;
    const parsedDom = (new DOMParser()).parseFromString(
        details.frameContent,
        'text/html'
    );

    // Provide an id users can use as anchor to personalize uBO's element
    // picker style properties.
    parsedDom.documentElement.id = 'ublock0-epicker';

    // https://github.com/gorhill/uBlock/issues/2240
    // https://github.com/uBlockOrigin/uBlock-issues/issues/170
    //   Remove the already declared inline style tag: we will create a new
    //   one based on the removed one, and replace the old one.
    let style = parsedDom.querySelector('style');
    const styleText = style.textContent;
    style.parentNode.removeChild(style);
    style = frameDoc.createElement('style');
    style.textContent = styleText;
    parsedDom.head.appendChild(style);

    frameDoc.replaceChild(
        frameDoc.adoptNode(parsedDom.documentElement),
        frameDoc.documentElement
    );

    pickerBody = frameDoc.body;
    pickerBody.setAttribute('lang', navigator.language);
    pickerBody.classList.toggle('zap', details.zap === true);

    dialog = pickerBody.querySelector('aside');
    dialog.addEventListener('click', onDialogClicked);

    taCandidate = dialog.querySelector('textarea');
    taCandidate.addEventListener('input', onCandidateChanged);

    dialog.querySelector('#toolbar').addEventListener('mousedown', onStartMoving);

    svgRoot = pickerBody.querySelector('svg');
    svgOcean = svgRoot.firstChild;
    svgIslands = svgRoot.lastChild;
    svgRoot.addEventListener('click', onSvgClicked);
    svgRoot.addEventListener('touchstart', onSvgTouchStartStop);
    svgRoot.addEventListener('touchend', onSvgTouchStartStop);
    svgListening(true);

    window.addEventListener('scroll', onScrolled, true);
    pickerRoot.contentWindow.addEventListener('keydown', onKeyPressed, true);
    pickerRoot.contentWindow.focus();

    // Restore net filter union data if it originate from the same URL.
    const eprom = details.eprom || null;
    if ( eprom !== null && eprom.lastNetFilterSession === lastNetFilterSession ) {
        lastNetFilterHostname = eprom.lastNetFilterHostname || '';
        lastNetFilterUnion = eprom.lastNetFilterUnion || '';
    }

    // Auto-select a specific target, if any, and if possible

    highlightElements([], true);

    // Try using mouse position
    if (
        details.mouse &&
        typeof vAPI.mouseClick.x === 'number' &&
        vAPI.mouseClick.x > 0
    ) {
        if ( filtersFrom(vAPI.mouseClick.x, vAPI.mouseClick.y) !== 0 ) {
            showDialog();
            return;
        }
    }

    // No mouse position available, use suggested target
    const target = details.target || '';
    const pos = target.indexOf('\t');
    if ( pos === -1 ) { return; }

    const srcAttrMap = {
        'a': 'href',
        'audio': 'src',
        'embed': 'src',
        'iframe': 'src',
        'img': 'src',
        'video': 'src',
    };
    const tagName = target.slice(0, pos);
    const url = target.slice(pos + 1);
    const attr = srcAttrMap[tagName];
    if ( attr === undefined ) { return; }
    const elems = document.getElementsByTagName(tagName);
    for ( const elem of elems  ) {
        if ( elem === pickerRoot ) { continue; }
        const src = elem[attr];
        if ( typeof src !== 'string' ) { continue; }
        if (
            (src !== url) &&
            (src !== '' || url !== 'about:blank')
        ) {
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

const bootstrapPicker = async function() {
    vAPI.shutdown.add(stopPicker);
    const details = await vAPI.messaging.send('elementPicker', {
        what: 'elementPickerArguments',
    });
    startPicker(details);
};

/******************************************************************************/

pickerRoot = document.createElement('iframe');
pickerRoot.id = vAPI.sessionId;

const pickerCSSStyle = [
    'background: transparent',
    'border: 0',
    'border-radius: 0',
    'box-shadow: none',
    'display: block',
    'height: 100%',
    'left: 0',
    'margin: 0',
    'max-height: none',
    'max-width: none',
    'opacity: 1',
    'outline: 0',
    'padding: 0',
    'position: fixed',
    'top: 0',
    'visibility: visible',
    'width: 100%',
    'z-index: 2147483647',
    ''
].join(' !important;');
pickerRoot.style.cssText = pickerCSSStyle;

// https://github.com/uBlockOrigin/uBlock-issues/issues/393
//   This needs to be injected as an inline style, *never* as a user styles,
//   hence why it's not added above as part of the pickerCSSStyle
//   properties.
pickerRoot.style.setProperty('pointer-events', 'auto', 'important');

const pickerCSS1 = [
    `#${pickerRoot.id} {`,
        pickerCSSStyle,
    '}'
].join('\n');
const pickerCSS2 = [
    `[${pickerRoot.id}-clickblind] {`,
        'pointer-events: none !important;',
    '}'
].join('\n');

// https://github.com/gorhill/uBlock/issues/1529
//   In addition to inline styles, harden the element picker styles by using
//   dedicated CSS rules.
vAPI.userStylesheet.add(pickerCSS1);
vAPI.userStylesheet.add(pickerCSS2);
vAPI.userStylesheet.apply();

// https://github.com/gorhill/uBlock/issues/2060
vAPI.domFilterer.excludeNode(pickerRoot);

pickerRoot.addEventListener(
    'load',
    ( ) => { bootstrapPicker(); },
    { once: true }
);
document.documentElement.appendChild(pickerRoot);

/******************************************************************************/

})();








/*******************************************************************************

    DO NOT:
    - Remove the following code
    - Add code beyond the following code
    Reason:
    - https://github.com/gorhill/uBlock/pull/3721
    - uBO never uses the return value from injected content scripts

**/

void 0;

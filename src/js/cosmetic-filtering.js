/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2017 Raymond Hill

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

/* jshint bitwise: false */
/* global punycode */

'use strict';

/******************************************************************************/

µBlock.cosmeticFilteringEngine = (function(){

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var isValidCSSSelector = (function() {
    var div = document.createElement('div'),
        matchesFn;
    // Keep in mind:
    //   https://github.com/gorhill/uBlock/issues/693
    //   https://github.com/gorhill/uBlock/issues/1955
    if ( div.matches instanceof Function ) {
        matchesFn = div.matches.bind(div);
    } else if ( div.mozMatchesSelector instanceof Function ) {
        matchesFn = div.mozMatchesSelector.bind(div);
    } else if ( div.webkitMatchesSelector instanceof Function ) {
        matchesFn = div.webkitMatchesSelector.bind(div);
    } else if ( div.msMatchesSelector instanceof Function ) {
        matchesFn = div.msMatchesSelector.bind(div);
    } else {
        matchesFn = div.querySelector.bind(div);
    }
    // https://github.com/gorhill/uBlock/issues/3111
    //   Workaround until https://bugzilla.mozilla.org/show_bug.cgi?id=1406817
    //   is fixed.
    try {
        matchesFn(':scope');
    } catch (ex) {
        matchesFn = div.querySelector.bind(div);
    }
    return function(s) {
        try {
            matchesFn(s + ', ' + s + ':not(#foo)');
        } catch (ex) {
            return false;
        }
        return true;
    };
})();

var reIsRegexLiteral = /^\/.+\/$/;

var isBadRegex = function(s) {
    try {
        void new RegExp(s);
    } catch (ex) {
        isBadRegex.message = ex.toString();
        return true;
    }
    return false;
};

var cosmeticSurveyingMissCountMax = parseInt(vAPI.localStorage.getItem('cosmeticSurveyingMissCountMax'), 10) || 15;

/******************************************************************************/
/*
var histogram = function(label, buckets) {
    var h = [],
        bucket;
    for ( var k in buckets ) {
        if ( buckets.hasOwnProperty(k) === false ) {
            continue;
        }
        bucket = buckets[k];
        h.push({
            k: k,
            n: bucket instanceof FilterBucket ? bucket.filters.length : 1
        });
    }

    console.log('Histogram %s', label);

    var total = h.length;
    h.sort(function(a, b) { return b.n - a.n; });

    // Find indices of entries of interest
    var target = 3;
    for ( var i = 0; i < total; i++ ) {
        if ( h[i].n === target ) {
            console.log('\tEntries with only %d filter(s) start at index %s (key = "%s")', target, i, h[i].k);
            target -= 1;
        }
    }

    h = h.slice(0, 50);

    h.forEach(function(v) {
        console.log('\tkey="%s" count=%d', v.k, v.n);
    });
    console.log('\tTotal buckets count: %d', total);
};
*/
/*******************************************************************************

    Each filter class will register itself in the map.

    IMPORTANT: any change which modifies the mapping will have to be
    reflected with µBlock.systemSettings.compiledMagic.

**/

var filterClasses = [];

var registerFilterClass = function(ctor) {
    filterClasses[ctor.prototype.fid] = ctor;
};

var filterFromCompiledData = function(args) {
    return filterClasses[args[0]].load(args);
};

/******************************************************************************/

// Any selector specific to a hostname
// Examples:
//   search.snapdo.com###ABottomD
//   facebook.com##.-cx-PRIVATE-fbAdUnit__root
//   sltrib.com###BLContainer + div[style="height:90px;"]
//   myps3.com.au##.Boxer[style="height: 250px;"]
//   lindaikeji.blogspot.com##a > img[height="600"]
//   japantimes.co.jp##table[align="right"][width="250"]
//   mobilephonetalk.com##[align="center"] > b > a[href^="http://tinyurl.com/"]

var FilterHostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterHostname.prototype.fid = 8;

FilterHostname.prototype.retrieve = function(hostname, out) {
    if ( hostname.endsWith(this.hostname) ) {
        out.add(this.s);
    }
};

FilterHostname.prototype.compile = function() {
    return [ this.fid, this.s, this.hostname ];
};

FilterHostname.load = function(data) {
    return new FilterHostname(data[1], data[2]);
};

registerFilterClass(FilterHostname);

/******************************************************************************/

var FilterBucket = function(a, b) {
    this.f = null;
    this.filters = [];
    if ( a !== undefined ) {
        this.filters[0] = a;
        this.filters[1] = b;
    }
};

FilterBucket.prototype.fid = 10;

FilterBucket.prototype.add = function(a) {
    this.filters.push(a);
};

FilterBucket.prototype.retrieve = function(s, out) {
    var i = this.filters.length;
    while ( i-- ) {
        this.filters[i].retrieve(s, out);
    }
};

FilterBucket.prototype.compile = function() {
    var out = [],
        filters = this.filters;
    for ( var i = 0, n = filters.length; i < n; i++ ) {
        out[i] = filters[i].compile();
    }
    return [ this.fid, out ];
};

FilterBucket.load = function(data) {
    var bucket = new FilterBucket(),
        entries = data[1];
    for ( var i = 0, n = entries.length; i < n; i++ ) {
        bucket.filters[i] = filterFromCompiledData(entries[i]);
    }
    return bucket;
};

registerFilterClass(FilterBucket);

/******************************************************************************/
/******************************************************************************/

var FilterParser = function() {
    this.prefix =  this.suffix = '';
    this.unhide = 0;
    this.hostnames = [];
    this.invalid = false;
    this.cosmetic = true;
    this.reNeedHostname = /^(?:script:contains|script:inject|.+?:-abp-contains|.+?:-abp-has|.+?:contains|.+?:has|.+?:has-text|.+?:if|.+?:if-not|.+?:matches-css(?:-before|-after)?|.*?:xpath)\(.+\)$/;
};

/******************************************************************************/

FilterParser.prototype.reset = function() {
    this.raw = '';
    this.prefix = this.suffix = '';
    this.unhide = 0;
    this.hostnames.length = 0;
    this.invalid = false;
    this.cosmetic = true;
    return this;
};

/******************************************************************************/

FilterParser.prototype.parse = function(raw) {
    // important!
    this.reset();

    this.raw = raw;

    // Find the bounds of the anchor.
    var lpos = raw.indexOf('#');
    if ( lpos === -1 ) {
        this.cosmetic = false;
        return this;
    }
    var rpos = raw.indexOf('#', lpos + 1);
    if ( rpos === -1 ) {
        this.cosmetic = false;
        return this;
    }

    // Coarse-check that the anchor is valid.
    // `##`: l = 1
    // `#@#`, `#$#`, `#%#`, `#?#`: l = 2
    // `#@$#`, `#@%#`, `#@?#`: l = 3
    if ( (rpos - lpos) > 3 ) {
        this.cosmetic = false;
        return this;
    }

    // Find out type of cosmetic filter.
    // Exception filter?
    if ( raw.charCodeAt(lpos + 1) === 0x40 /* '@' */ ) {
        this.unhide = 1;
    }

    // https://github.com/gorhill/uBlock/issues/952
    // Find out whether we are dealing with an Adguard-specific cosmetic
    // filter, and if so, translate it if supported, or discard it if not
    // supported.
    var cCode = raw.charCodeAt(rpos - 1);
    if ( cCode !== 0x23 /* '#' */ && cCode !== 0x40 /* '@' */ ) {
        // We have an Adguard/ABP cosmetic filter if and only if the character
        //  is `$`, `%` or `?`, otherwise it's not a cosmetic filter.
        if (
            cCode !== 0x24 /* '$' */ &&
            cCode !== 0x25 /* '%' */ &&
            cCode !== 0x3F /* '?' */
        ) {
            this.cosmetic = false;
            return this;
        }
        // Adguard's scriptlet injection: not supported.
        if ( cCode === 0x25 /* '%' */ ) {
            this.invalid = true;
            return this;
        }
        // Adguard's style injection: supported, but translate to uBO's format.
        if ( cCode === 0x24 /* '$' */ ) {
            raw = this.translateAdguardCSSInjectionFilter(raw);
            if ( raw === '' ) {
                this.invalid = true;
                return this;
            }
        }
        rpos = raw.indexOf('#', lpos + 1);
    }

    // Extract the hostname(s).
    if ( lpos !== 0 ) {
        this.prefix = raw.slice(0, lpos);
    }

    // Extract the selector.
    this.suffix = raw.slice(rpos + 1).trim();
    if ( this.suffix.length === 0 ) {
        this.cosmetic = false;
        return this;
    }

    // 2014-05-23:
    // https://github.com/gorhill/httpswitchboard/issues/260
    // Any sequence of `#` longer than one means the line is not a valid
    // cosmetic filter.
    if ( this.suffix.indexOf('##') !== -1 ) {
        this.cosmetic = false;
        return this;
    }

    // Normalize high-medium selectors: `href` is assumed to imply `a` tag. We
    // need to do this here in order to correctly avoid duplicates. The test
    // is designed to minimize overhead -- this is a low occurrence filter.
    if ( this.suffix.startsWith('[href^="', 1) ) {
        this.suffix = this.suffix.slice(1);
    }

    if ( this.prefix !== '' ) {
        this.hostnames = this.prefix.split(/\s*,\s*/);
    }

    // For some selectors, it is mandatory to have a hostname or entity:
    //   ##script:contains(...)
    //   ##script:inject(...)
    //   ##.foo:-abp-contains(...)
    //   ##.foo:-abp-has(...)
    //   ##.foo:contains(...)
    //   ##.foo:has(...)
    //   ##.foo:has-text(...)
    //   ##.foo:if(...)
    //   ##.foo:if-not(...)
    //   ##.foo:matches-css(...)
    //   ##.foo:matches-css-after(...)
    //   ##.foo:matches-css-before(...)
    //   ##:xpath(...)
    if (
        this.hostnames.length === 0 &&
        this.unhide === 0 &&
        this.reNeedHostname.test(this.suffix)
    ) {
        this.invalid = true;
        return this;
    }

    return this;
};

/******************************************************************************/

// Reference: https://adguard.com/en/filterrules.html#cssInjection

FilterParser.prototype.translateAdguardCSSInjectionFilter = function(raw) {
    var matches = /^([^#]*)#(@?)\$#([^{]+)\{([^}]+)\}$/.exec(raw);
    if ( matches === null ) {
        return '';
    }
    // For now we do not allow generic CSS injections (prolly never).
    if ( matches[1] === '' && matches[2] !== '@' ) {
        return '';
    }
    return matches[1] +
           '#' + matches[2] + '#' +
           matches[3].trim() +
           ':style(' +  matches[4].trim() + ')';
};

/******************************************************************************/
/******************************************************************************/

var SelectorCacheEntry = function() {
    this.reset();
};

/******************************************************************************/

SelectorCacheEntry.junkyard = [];

SelectorCacheEntry.factory = function() {
    var entry = SelectorCacheEntry.junkyard.pop();
    if ( entry ) {
        return entry.reset();
    }
    return new SelectorCacheEntry();
};

/******************************************************************************/

var netSelectorCacheLowWaterMark = 20;
var netSelectorCacheHighWaterMark = 30;

/******************************************************************************/

SelectorCacheEntry.prototype.reset = function() {
    this.cosmetic = new Set();
    this.cosmeticSurveyingMissCount = 0;
    this.net = new Map();
    this.lastAccessTime = Date.now();
    return this;
};

/******************************************************************************/

SelectorCacheEntry.prototype.dispose = function() {
    this.cosmetic = this.net = null;
    if ( SelectorCacheEntry.junkyard.length < 25 ) {
        SelectorCacheEntry.junkyard.push(this);
    }
};

/******************************************************************************/

SelectorCacheEntry.prototype.addCosmetic = function(details) {
    var selectors = details.selectors,
        i = selectors.length || 0;
    // https://github.com/gorhill/uBlock/issues/2011
    //   Avoiding seemingly pointless surveys only if they appear costly.
    if ( details.first && i === 0 ) {
        if ( (details.cost || 0) >= 80 ) {
            this.cosmeticSurveyingMissCount += 1;
        }
        return;
    }
    this.cosmeticSurveyingMissCount = 0;
    while ( i-- ) {
        this.cosmetic.add(selectors[i]);
    }
};

/******************************************************************************/

SelectorCacheEntry.prototype.addNet = function(selectors) {
    if ( typeof selectors === 'string' ) {
        this.addNetOne(selectors, Date.now());
    } else {
        this.addNetMany(selectors, Date.now());
    }
    // Net request-derived selectors: I limit the number of cached selectors,
    // as I expect cases where the blocked net-requests are never the
    // exact same URL.
    if ( this.net.size < netSelectorCacheHighWaterMark ) { return; }
    var dict = this.net;
    var keys = µb.arrayFrom(dict.keys()).sort(function(a, b) {
        return dict.get(b) - dict.get(a);
    }).slice(netSelectorCacheLowWaterMark);
    var i = keys.length;
    while ( i-- ) {
        dict.delete(keys[i]);
    }
};

/******************************************************************************/

SelectorCacheEntry.prototype.addNetOne = function(selector, now) {
    this.net.set(selector, now);
};

/******************************************************************************/

SelectorCacheEntry.prototype.addNetMany = function(selectors, now) {
    var i = selectors.length || 0;
    while ( i-- ) {
        this.net.set(selectors[i], now);
    }
};

/******************************************************************************/

SelectorCacheEntry.prototype.add = function(details) {
    this.lastAccessTime = Date.now();
    if ( details.type === 'cosmetic' ) {
        this.addCosmetic(details);
    } else {
        this.addNet(details.selectors);
    }
};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/420
SelectorCacheEntry.prototype.remove = function(type) {
    this.lastAccessTime = Date.now();
    if ( type === undefined || type === 'cosmetic' ) {
        this.cosmetic.clear();
        this.cosmeticSurveyingMissCount = 0;
    }
    if ( type === undefined || type === 'net' ) {
        this.net.clear();
    }
};

/******************************************************************************/

SelectorCacheEntry.prototype.retrieveToArray = function(iterator, out) {
    for ( var selector of iterator ) {
        out.push(selector);
    }
};

SelectorCacheEntry.prototype.retrieveToSet = function(iterator, out) {
    for ( var selector of iterator ) {
        out.add(selector);
    }
};

SelectorCacheEntry.prototype.retrieve = function(type, out) {
    this.lastAccessTime = Date.now();
    var iterator = type === 'cosmetic' ? this.cosmetic : this.net.keys();
    if ( Array.isArray(out) ) {
        this.retrieveToArray(iterator, out);
    } else {
        this.retrieveToSet(iterator, out);
    }
};

/******************************************************************************/
/******************************************************************************/

// Two Unicode characters:
// T0HHHHHHH HHHHHHHHH
// |       |         |
// |       |         |
// |       |         |
// |       |         +-- bit 8-0 of FNV
// |       |
// |       +-- bit 15-9 of FNV
// |
// +-- filter type (0=hide 1=unhide)
//

var makeHash = function(token) {
    // Ref: Given a URL, returns a unique 4-character long hash string
    // Based on: FNV32a
    // http://www.isthe.com/chongo/tech/comp/fnv/index.html#FNV-reference-source
    // The rest is custom, suited for uBlock.
    var i1 = token.length;
    var i2 = i1 >> 1;
    var i4 = i1 >> 2;
    var i8 = i1 >> 3;
    var hval = (0x811c9dc5 ^ token.charCodeAt(0)) >>> 0;
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i8);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i4);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i4+i8);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i2);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i2+i8);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i2+i4);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval ^= token.charCodeAt(i1-1);
        hval += (hval<<1) + (hval<<4) + (hval<<7) + (hval<<8) + (hval<<24);
        hval >>>= 0;
        hval &= 0x0FFF; // 12 bits
    return hval.toString(36);
};

/******************************************************************************/
/******************************************************************************/

// Cosmetic filter family tree:
//
// Generic
//    Low generic simple: class or id only
//    Low generic complex: class or id + extra stuff after
//    High generic:
//       High-low generic: [alt="..."],[title="..."]
//       High-medium generic: [href^="..."]
//       High-high generic: everything else
// Specific
//    Specfic hostname
//    Specific entity
// Generic filters can only be enforced once the main document is loaded.
// Specific filers can be enforced before the main document is loaded.

var FilterContainer = function() {
    this.noDomainHash = '-';
    this.parser = new FilterParser();
    this.reHasUnicode = /[^\x00-\x7F]/;
    this.rePlainSelector = /^[#.][\w\\-]+/;
    this.rePlainSelectorEscaped = /^[#.](?:\\[0-9A-Fa-f]+ |\\.|\w|-)+/;
    this.rePlainSelectorEx = /^[^#.\[(]+([#.][\w-]+)|([#.][\w-]+)$/;
    this.reEscapeSequence = /\\([0-9A-Fa-f]+ |.)/g;
    this.reSimpleHighGeneric1 = /^[a-z]*\[[^[]+]$/;
    this.reHighMedium = /^\[href\^="https?:\/\/([^"]{8})[^"]*"\]$/;
    this.reScriptSelector = /^script:(contains|inject)\((.+)\)$/;
    this.punycode = punycode;

    this.selectorCache = new Map();
    this.selectorCachePruneDelay = 10 * 60 * 1000; // 10 minutes
    this.selectorCacheAgeMax = 120 * 60 * 1000; // 120 minutes
    this.selectorCacheCountMin = 25;
    this.netSelectorCacheCountMax = netSelectorCacheHighWaterMark;
    this.selectorCacheTimer = null;

    this.supportsUserStylesheets = vAPI.supportsUserStylesheets;

    // generic exception filters
    this.genericDonthideSet = new Set();

    // hostname, entity-based filters
    this.specificFilters = new Map();
    this.proceduralFilters = new Map();

    // low generic cosmetic filters, organized by id/class then simple/complex.
    this.lowlyGeneric = Object.create(null);
    this.lowlyGeneric.id = {
        canonical: 'ids',
        prefix: '#',
        simple: new Set(),
        complex: new Map()
    };
    this.lowlyGeneric.cl = {
        canonical: 'classes',
        prefix: '.',
        simple: new Set(),
        complex: new Map()
    };

    // highly generic selectors sets
    this.highlyGeneric = Object.create(null);
    this.highlyGeneric.simple = {
        canonical: 'highGenericHideSimple',
        dict: new Set(),
        str: '',
        mru: new µb.MRUCache(16)
    };
    this.highlyGeneric.complex = {
        canonical: 'highGenericHideComplex',
        dict: new Set(),
        str: '',
        mru: new µb.MRUCache(16)
    };

    this.userScripts = new Map();

    // Short-lived: content is valid only during one function call. These
    // is to prevent repeated allocation/deallocation overheads -- the
    // constructors/destructors of javascript Set/Map is assumed to be costlier
    // than just calling clear() on these.
    this.setRegister0 = new Set();
    this.setRegister1 = new Set();
    this.setRegister2 = new Set();

    this.reset();
};

/******************************************************************************/

// Reset all, thus reducing to a minimum memory footprint of the context.

FilterContainer.prototype.reset = function() {
    this.parser.reset();
    this.µburi = µb.URI;
    this.frozen = false;
    this.acceptedCount = 0;
    this.discardedCount = 0;
    this.duplicateBuster = new Set();

    this.selectorCache.clear();
    if ( this.selectorCacheTimer !== null ) {
        clearTimeout(this.selectorCacheTimer);
        this.selectorCacheTimer = null;
    }

    // generic filters
    this.hasGenericHide = false;

    // generic exception filters
    this.genericDonthideSet.clear();

    // hostname, entity-based filters
    this.specificFilters.clear();
    this.proceduralFilters.clear();

    // low generic cosmetic filters, organized by id/class then simple/complex.
    this.lowlyGeneric.id.simple.clear();
    this.lowlyGeneric.id.complex.clear();
    this.lowlyGeneric.cl.simple.clear();
    this.lowlyGeneric.cl.complex.clear();

    // highly generic selectors sets
    this.highlyGeneric.simple.dict.clear();
    this.highlyGeneric.simple.str = '';
    this.highlyGeneric.simple.mru.reset();
    this.highlyGeneric.complex.dict.clear();
    this.highlyGeneric.complex.str = '';
    this.highlyGeneric.complex.mru.reset();

    this.scriptTagFilters = {};
    this.scriptTagFilterCount = 0;
    this.userScripts.clear();
    this.userScriptCount = 0;
};

/******************************************************************************/

FilterContainer.prototype.freeze = function() {
    this.duplicateBuster = new Set();

    this.hasGenericHide =
        this.lowlyGeneric.id.simple.size !== 0 ||
        this.lowlyGeneric.id.complex.size !== 0 ||
        this.lowlyGeneric.cl.simple.size !== 0 ||
        this.lowlyGeneric.cl.complex.size !== 0 ||
        this.highlyGeneric.simple.dict.size !== 0 ||
        this.highlyGeneric.complex.dict.size !== 0;

    if ( this.genericDonthideSet.size !== 0 ) {
        for ( var selector of this.genericDonthideSet ) {
            var type = selector.charCodeAt(0);
            if ( type === 0x23 /* '#' */ ) {
                this.lowlyGeneric.id.simple.delete(selector.slice(1));
            } else if ( type === 0x2E /* '.' */ ) {
                this.lowlyGeneric.cl.simple.delete(selector.slice(1));
            }
            // TODO:
            //  this.lowlyGeneric.id.complex.delete(selector);
            //  this.lowlyGeneric.cl.complex.delete(selector);
            this.highlyGeneric.simple.dict.delete(selector);
            this.highlyGeneric.complex.dict.delete(selector);
        }
    }
    this.highlyGeneric.simple.str = µb.arrayFrom(this.highlyGeneric.simple.dict).join(',\n');
    this.highlyGeneric.complex.str = µb.arrayFrom(this.highlyGeneric.complex.dict).join(',\n');

    this.parser.reset();
    this.compileSelector.reset();
    this.compileProceduralSelector.reset();
    this.frozen = true;
};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/1004
// Detect and report invalid CSS selectors.

// Discard new ABP's `-abp-properties` directive until it is
// implemented (if ever). Unlikely, see:
// https://github.com/gorhill/uBlock/issues/1752

// https://github.com/gorhill/uBlock/issues/2624
// Convert Adguard's `-ext-has='...'` into uBO's `:has(...)`.

FilterContainer.prototype.compileSelector = (function() {
    var reAfterBeforeSelector = /^(.+?)(::?after|::?before)$/,
        reStyleSelector = /^(.+?):style\((.+?)\)$/,
        reStyleBad = /url\([^)]+\)/,
        reScriptSelector = /^script:(contains|inject)\((.+)\)$/,
        reExtendedSyntax = /\[-(?:abp|ext)-[a-z-]+=(['"])(?:.+?)(?:\1)\]/,
        reExtendedSyntaxParser = /\[-(?:abp|ext)-([a-z-]+)=(['"])(.+?)\2\]/,
        div = document.createElement('div');

    var normalizedExtendedSyntaxOperators = new Map([
        [ 'contains', ':has-text' ],
        [ 'has', ':if' ],
        [ 'matches-css', ':matches-css' ],
        [ 'matches-css-after', ':matches-css-after' ],
        [ 'matches-css-before', ':matches-css-before' ],
    ]);

    var isValidStyleProperty = function(cssText) {
        if ( reStyleBad.test(cssText) ) { return false; }
        div.style.cssText = cssText;
        if ( div.style.cssText === '' ) { return false; }
        div.style.cssText = '';
        return true;
    };

    var entryPoint = function(raw) {
        var extendedSyntax = reExtendedSyntax.test(raw);
        if ( isValidCSSSelector(raw) && extendedSyntax === false ) {
            return raw;
        }

        // We  rarely reach this point -- majority of selectors are plain
        // CSS selectors.

        var matches, operator;

        // Supported Adguard/ABP advanced selector syntax: will translate into
        // uBO's syntax before further processing.
        // Mind unsupported advanced selector syntax, such as ABP's
        // `-abp-properties`.
        // Note: extended selector syntax has been deprecated in ABP, in favor
        // of the procedural one (i.e. `:operator(...)`). See
        // https://issues.adblockplus.org/ticket/5287
        if ( extendedSyntax ) {
            while ( (matches = reExtendedSyntaxParser.exec(raw)) !== null ) {
                operator = normalizedExtendedSyntaxOperators.get(matches[1]);
                if ( operator === undefined ) { return; }
                raw = raw.slice(0, matches.index) +
                      operator + '(' + matches[3] + ')' +
                      raw.slice(matches.index + matches[0].length);
            }
            return this.compileSelector(raw);
        }

        var selector = raw,
            pseudoclass, style;

        // `:style` selector?
        if ( (matches = reStyleSelector.exec(selector)) !== null ) {
            selector = matches[1];
            style = matches[2];
        }

        // https://github.com/gorhill/uBlock/issues/2448
        // :after- or :before-based selector?
        if ( (matches = reAfterBeforeSelector.exec(selector)) ) {
            selector = matches[1];
            pseudoclass = matches[2];
        }

        if ( style !== undefined || pseudoclass !== undefined ) {
            if ( isValidCSSSelector(selector) === false ) {
                return;
            }
            if ( pseudoclass !== undefined ) {
                selector += pseudoclass;
            }
            if ( style !== undefined ) {
                if ( isValidStyleProperty(style) === false ) { return; }
                return JSON.stringify({
                    raw: raw,
                    style: [ selector, style ]
                });
            }
            return JSON.stringify({
                raw: raw,
                pseudoclass: true
            });
        }

        // `script:` filter?
        if ( (matches = reScriptSelector.exec(raw)) !== null ) {
            // :inject
            if ( matches[1] === 'inject' ) {
                return raw;
            }
            // :contains
            if (
                reIsRegexLiteral.test(matches[2]) === false ||
                isBadRegex(matches[2].slice(1, -1)) === false
            ) {
                return raw;
            }
        }

        // Procedural selector?
        var compiled;
        if ( (compiled = this.compileProceduralSelector(raw)) ) {
            return compiled;
        }

        µb.logger.writeOne('', 'error', 'Cosmetic filtering – invalid filter: ' + raw);
    };

    entryPoint.reset = function() {
    };

    return entryPoint;
})();

/******************************************************************************/

FilterContainer.prototype.compileProceduralSelector = (function() {
    var reOperatorParser = /(:(?:-abp-contains|-abp-has|contains|has|has-text|if|if-not|matches-css|matches-css-after|matches-css-before|xpath))\(.+\)$/,
        reFirstParentheses = /^\(*/,
        reLastParentheses = /\)*$/,
        reEscapeRegex = /[.*+?^${}()|[\]\\]/g,
        reNeedScope = /^\s*[+>~]/;

    var lastProceduralSelector = '',
        lastProceduralSelectorCompiled,
        regexToRawValue = new Map();

    var compileCSSSelector = function(s) {
        // https://github.com/AdguardTeam/ExtendedCss/issues/31#issuecomment-302391277
        // Prepend `:scope ` if needed.
        if ( reNeedScope.test(s) ) {
            s = ':scope ' + s;
        }
        if ( isValidCSSSelector(s) ) {
            return s;
        }
    };

    var compileText = function(s) {
        var reText;
        if ( reIsRegexLiteral.test(s) ) {
            reText = s.slice(1, -1);
            if ( isBadRegex(reText) ) { return; }
        } else {
            reText = s.replace(reEscapeRegex, '\\$&');
            regexToRawValue.set(reText, s);
        }
        return reText;
    };

    var compileCSSDeclaration = function(s) {
        var name, value, reText,
            pos = s.indexOf(':');
        if ( pos === -1 ) { return; }
        name = s.slice(0, pos).trim();
        value = s.slice(pos + 1).trim();
        if ( reIsRegexLiteral.test(value) ) {
            reText = value.slice(1, -1);
            if ( isBadRegex(reText) ) { return; }
        } else {
            reText = '^' + value.replace(reEscapeRegex, '\\$&') + '$';
            regexToRawValue.set(reText, value);
        }
        return { name: name, value: reText };
    };

    var compileConditionalSelector = function(s) {
        // https://github.com/AdguardTeam/ExtendedCss/issues/31#issuecomment-302391277
        // Prepend `:scope ` if needed.
        if ( reNeedScope.test(s) ) {
            s = ':scope ' + s;
        }
        return compile(s);
    };

    var compileXpathExpression = function(s) {
        var dummy;
        try {
            dummy = document.createExpression(s, null) instanceof XPathExpression;
        } catch (e) {
            return;
        }
        return s;
    };

    // https://github.com/gorhill/uBlock/issues/2793
    var normalizedOperators = new Map([
        [ ':-abp-contains', ':has-text' ],
        [ ':-abp-has', ':if' ],
        [ ':contains', ':has-text' ]
    ]);

    var compileArgument = new Map([
        [ ':has', compileCSSSelector ],
        [ ':has-text', compileText ],
        [ ':if', compileConditionalSelector ],
        [ ':if-not', compileConditionalSelector ],
        [ ':matches-css', compileCSSDeclaration ],
        [ ':matches-css-after', compileCSSDeclaration ],
        [ ':matches-css-before', compileCSSDeclaration ],
        [ ':xpath', compileXpathExpression ]
    ]);

    // https://github.com/gorhill/uBlock/issues/2793#issuecomment-333269387
    // - Normalize (somewhat) the stringified version of procedural cosmetic
    //   filters -- this increase the likelihood of detecting duplicates given
    //   that uBO is able to understand syntax specific to other blockers.
    //   The normalized string version is what is reported in the logger, by
    //   design.
    var decompile = function(compiled) {
        var raw = [ compiled.selector ],
            tasks = compiled.tasks,
            value;
        if ( Array.isArray(tasks) ) {
            for ( var i = 0, n = tasks.length, task; i < n; i++ ) {
                task = tasks[i];
                switch ( task[0] ) {
                case ':has':
                case ':xpath':
                    raw.push(task[0], '(', task[1], ')');
                    break;
                case ':has-text':
                    value = regexToRawValue.get(task[1]);
                    if ( value === undefined ) {
                        value = '/' + task[1] + '/';
                    }
                    raw.push(task[0], '(', value, ')');
                    break;
                case ':matches-css':
                case ':matches-css-after':
                case ':matches-css-before':
                    value = regexToRawValue.get(task[1].value);
                    if ( value === undefined ) {
                        value = '/' + task[1].value + '/';
                    }
                    raw.push(task[0], '(', task[1].name, ': ', value, ')');
                    break;
                case ':if':
                case ':if-not':
                    raw.push(task[0], '(', decompile(task[1]), ')');
                    break;
                }
            }
        }
        return raw.join('');
    };

    var compile = function(raw) {
        var matches = reOperatorParser.exec(raw);
        if ( matches === null ) {
            if ( isValidCSSSelector(raw) ) { return { selector: raw }; }
            return;
        }
        var tasks = [],
            firstOperand = raw.slice(0, matches.index),
            currentOperator = matches[1],
            selector = raw.slice(matches.index + currentOperator.length),
            currentArgument = '', nextOperand, nextOperator,
            depth = 0, opening, closing;
        if ( firstOperand !== '' && isValidCSSSelector(firstOperand) === false ) { return; }
        for (;;) {
            matches = reOperatorParser.exec(selector);
            if ( matches !== null ) {
                nextOperand = selector.slice(0, matches.index);
                nextOperator = matches[1];
            } else {
                nextOperand = selector;
                nextOperator = '';
            }
            opening = reFirstParentheses.exec(nextOperand)[0].length;
            closing = reLastParentheses.exec(nextOperand)[0].length;
            if ( opening > closing ) {
                if ( depth === 0 ) { currentArgument = ''; }
                depth += 1;
            } else if ( closing > opening && depth > 0 ) {
                depth -= 1;
                if ( depth === 0 ) { nextOperand = currentArgument + nextOperand; }
            }
            if ( depth !== 0 ) {
                currentArgument += nextOperand + nextOperator;
            } else {
                currentOperator = normalizedOperators.get(currentOperator) || currentOperator;
                currentArgument = compileArgument.get(currentOperator)(nextOperand.slice(1, -1));
                if ( currentArgument === undefined ) { return; }
                tasks.push([ currentOperator, currentArgument ]);
                currentOperator = nextOperator;
            }
            if ( nextOperator === '' ) { break; }
            selector = selector.slice(matches.index + nextOperator.length);
        }
        if ( tasks.length === 0 || depth !== 0 ) { return; }
        return { selector: firstOperand, tasks: tasks };
    };

    var entryPoint = function(raw) {
        if ( raw === lastProceduralSelector ) {
            return lastProceduralSelectorCompiled;
        }
        lastProceduralSelector = raw;
        var compiled = compile(raw);
        if ( compiled !== undefined ) {
            compiled.raw = decompile(compiled);
            compiled = JSON.stringify(compiled);
        }
        lastProceduralSelectorCompiled = compiled;
        return compiled;
    };

    entryPoint.reset = function() {
        regexToRawValue = new Map();
        lastProceduralSelector = '';
        lastProceduralSelectorCompiled = undefined;
    };

    return entryPoint;
})();

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1668
//   The key must be literal: unescape escaped CSS before extracting key.
//   It's an uncommon case, so it's best to unescape only when needed.

FilterContainer.prototype.keyFromSelector = function(selector) {
    var matches = this.rePlainSelector.exec(selector);
    if ( matches === null ) { return; }
    var key = matches[0];
    if ( key.indexOf('\\') === -1 ) {
        return key;
    }
    key = '';
    matches = this.rePlainSelectorEscaped.exec(selector);
    if ( matches === null ) { return; }
    var escaped = matches[0],
        beg = 0;
    this.reEscapeSequence.lastIndex = 0;
    for (;;) {
        matches = this.reEscapeSequence.exec(escaped);
        if ( matches === null ) {
            return key + escaped.slice(beg);
        }
        key += escaped.slice(beg, matches.index);
        beg = this.reEscapeSequence.lastIndex;
        if ( matches[1].length === 1 ) {
            key += matches[1];
        } else {
            key += String.fromCharCode(parseInt(matches[1], 16));
        }
    }
};

/******************************************************************************/

FilterContainer.prototype.compile = function(s, writer) {
    var parsed = this.parser.parse(s);
    if ( parsed.cosmetic === false ) {
        return false;
    }
    if ( parsed.invalid ) {
        return true;
    }

    var hostnames = parsed.hostnames;
    var i = hostnames.length;
    if ( i === 0 ) {
        this.compileGenericSelector(parsed, writer);
        return true;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/151
    // Negated hostname means the filter applies to all non-negated hostnames
    // of same filter OR globally if there is no non-negated hostnames.
    var applyGlobally = true;
    var hostname;
    while ( i-- ) {
        hostname = hostnames[i];
        if ( hostname.startsWith('~') === false ) {
            applyGlobally = false;
        }
        this.compileHostnameSelector(hostname, parsed, writer);
    }
    if ( applyGlobally ) {
        this.compileGenericSelector(parsed, writer);
    }

    return true;
};

/******************************************************************************/

FilterContainer.prototype.compileGenericSelector = function(parsed, writer) {
    if ( parsed.unhide === 0 ) {
        this.compileGenericHideSelector(parsed, writer);
    } else {
        this.compileGenericUnhideSelector(parsed, writer);
    }
};

/******************************************************************************/

FilterContainer.prototype.compileGenericHideSelector = function(parsed, writer) {
    var selector = parsed.suffix,
        type = selector.charCodeAt(0),
        key;

    if ( type === 0x23 /* '#' */ ) {
        key = this.keyFromSelector(selector);
        if ( key === undefined ) { return; }
        // Simple selector-based CSS rule: no need to test for whether the
        // selector is valid, the regex took care of this. Most generic
        // selector falls into that category.
        if ( key === selector ) {
            writer.push([ 0 /* lg */, key.slice(1) ]);
            return;
        }
        // Complex selector-based CSS rule.
        if ( this.compileSelector(selector) !== undefined ) {
            writer.push([ 1 /* lg+ */, key.slice(1), selector ]);
        }
        return;
    }

    if ( type === 0x2E /* '.' */ ) {
        key = this.keyFromSelector(selector);
        if ( key === undefined ) { return; }
        // Simple selector-based CSS rule: no need to test for whether the
        // selector is valid, the regex took care of this. Most generic
        // selector falls into that category.
        if ( key === selector ) {
            writer.push([ 2 /* lg */, key.slice(1) ]);
            return;
        }
        // Complex selector-based CSS rule.
        if ( this.compileSelector(selector) !== undefined ) {
            writer.push([ 3 /* lg+ */, key.slice(1), selector ]);
        }
        return;
    }

    var compiled = this.compileSelector(selector);
    if ( compiled === undefined ) { return; }
    // TODO: Detect and error on procedural cosmetic filters.

    // https://github.com/gorhill/uBlock/issues/909
    //   Anything which contains a plain id/class selector can be classified
    //   as a low generic cosmetic filter.
    var matches = this.rePlainSelectorEx.exec(selector);
    if ( matches !== null ) {
        key = matches[1] || matches[2];
        type = key.charCodeAt(0);
        writer.push([
            type === 0x23 ? 1 : 3 /* lg+ */,
            key.slice(1),
            selector
        ]);
        return;
    }

    // Pass this point, we are dealing with highly-generic cosmetic filters.
    //
    // For efficiency purpose, we will distinguish between simple and complex
    // selectors.

    if ( this.reSimpleHighGeneric1.test(selector) ) {
        writer.push([ 4 /* simple */, selector ]);
        return;
    }

    if ( selector.indexOf(' ') === -1 ) {
        writer.push([ 4 /* simple */, selector ]);
    } else {
        writer.push([ 5 /* complex */, selector ]);
    }
};

/******************************************************************************/

FilterContainer.prototype.compileGenericUnhideSelector = function(parsed, writer) {
    var selector = parsed.suffix;

    // script:contains(...)
    // script:inject(...)
    if ( this.reScriptSelector.test(selector) ) {
        writer.push([ 6 /* js */, '!', '', selector ]);
        return;
    }

    // Procedural cosmetic filters are acceptable as generic exception filters.
    var compiled = this.compileSelector(selector);
    if ( compiled === undefined ) { return; }

    // https://github.com/chrisaljoudi/uBlock/issues/497
    //   All generic exception filters are put in the same bucket: they are
    //   expected to be very rare.
    writer.push([ 7 /* g1 */, compiled ]);
};

/******************************************************************************/

FilterContainer.prototype.compileHostnameSelector = function(hostname, parsed, writer) {
    // https://github.com/chrisaljoudi/uBlock/issues/145
    var unhide = parsed.unhide;
    if ( hostname.startsWith('~') ) {
        hostname = hostname.slice(1);
        unhide ^= 1;
    }

    // punycode if needed
    if ( this.reHasUnicode.test(hostname) ) {
        hostname = this.punycode.toASCII(hostname);
    }

    var selector = parsed.suffix,
        domain = this.µburi.domainFromHostname(hostname),
        hash;

    // script:contains(...)
    // script:inject(...)
    if ( this.reScriptSelector.test(selector) ) {
        hash = domain !== '' ? domain : this.noDomainHash;
        if ( unhide ) {
            hash = '!' + hash;
        }
        writer.push([ 6 /* js */, hash, hostname, selector ]);
        return;
    }

    var compiled = this.compileSelector(selector);
    if ( compiled === undefined ) { return; }

    // https://github.com/chrisaljoudi/uBlock/issues/188
    // If not a real domain as per PSL, assign a synthetic one
    if ( hostname.endsWith('.*') === false ) {
        hash = domain !== '' ? makeHash(domain) : this.noDomainHash;
    } else {
        hash = makeHash(hostname);
    }
    if ( unhide ) {
        hash = '!' + hash;
    }

    // h,  hash,  example.com, .promoted-tweet
    // h,  hash,  example.*, .promoted-tweet
    // 8 = declarative, 9 = procedural
    writer.push([
        compiled.charCodeAt(0) !== 0x7B /* '{' */ ? 8 : 9,
        hash,
        hostname,
        compiled
    ]);
};

/******************************************************************************/

FilterContainer.prototype.fromCompiledContent = function(
    reader,
    skipGenericCosmetic,
    skipCosmetic
) {
    if ( skipCosmetic ) {
        this.skipCompiledContent(reader);
        return;
    }
    if ( skipGenericCosmetic ) {
        this.skipGenericCompiledContent(reader);
        return;
    }

    var fingerprint, args, db, filter, bucket;

    while ( reader.next() === true ) {
        this.acceptedCount += 1;
        fingerprint = reader.fingerprint();
        if ( this.duplicateBuster.has(fingerprint) ) {
            this.discardedCount += 1;
            continue;
        }
        this.duplicateBuster.add(fingerprint);

        args = reader.args();

        switch ( args[0] ) {

        // low generic, simple
        case 0: // #AdBanner
        case 2: // .largeAd
            db = args[0] === 0 ? this.lowlyGeneric.id : this.lowlyGeneric.cl;
            bucket = db.complex.get(args[1]);
            if ( bucket === undefined ) {
                db.simple.add(args[1]);
            } else if ( Array.isArray(bucket) ) {
                bucket.push(args[1]);
            } else {
                db.complex.set(args[1], [ bucket, args[1] ]);
            }
            break;

        // low generic, complex
        case 1: // #tads + div + .c
        case 3: // .Mpopup + #Mad > #MadZone
            db = args[0] === 1 ? this.lowlyGeneric.id : this.lowlyGeneric.cl;
            bucket = db.complex.get(args[1]);
            if ( bucket === undefined ) {
                if ( db.simple.has(args[1]) ) {
                    db.complex.set(args[1], [ args[1], args[2] ]);
                } else {
                    db.complex.set(args[1], args[2]);
                    db.simple.add(args[1]);
                }
            } else if ( Array.isArray(bucket) ) {
                bucket.push(args[2]);
            } else {
                db.complex.set(args[1], [ bucket, args[2] ]);
            }
            break;

        // High-high generic hide/simple selectors
        // div[id^="allo"]
        case 4:
            this.highlyGeneric.simple.dict.add(args[1]);
            break;

        // High-high generic hide/complex selectors
        // div[id^="allo"] > span
        case 5:
            this.highlyGeneric.complex.dict.add(args[1]);
            break;

        // js, hash, example.com, script:contains(...)
        // js, hash, example.com, script:inject(...)
        case 6:
            this.createScriptFilter(args[1], args[2], args[3]);
            break;

        // https://github.com/chrisaljoudi/uBlock/issues/497
        // Generic exception filters: expected to be a rare occurrence.
        // #@#.tweet
        case 7:
            this.genericDonthideSet.add(args[1]);
            break;

        // h,  hash,  example.com, .promoted-tweet
        // h,  hash,  example.*, .promoted-tweet
        case 8:
        case 9:
            db = args[0] === 8 ? this.specificFilters : this.proceduralFilters;
            filter = new FilterHostname(args[3], args[2]);
            bucket = db.get(args[1]);
            if ( bucket === undefined ) {
                db.set(args[1], filter);
            } else if ( bucket instanceof FilterBucket ) {
                bucket.add(filter);
            } else {
                db.set(args[1], new FilterBucket(bucket, filter));
            }
            break;

        default:
            this.discardedCount += 1;
            break;
        }
    }
};

/******************************************************************************/

FilterContainer.prototype.skipGenericCompiledContent = function(reader) {
    var fingerprint, args, db, filter, bucket;

    while ( reader.next() === true ) {
        this.acceptedCount += 1;
        fingerprint = reader.fingerprint();
        if ( this.duplicateBuster.has(fingerprint) ) {
            this.discardedCount += 1;
            continue;
        }

        args = reader.args();

        switch ( args[0] ) {

        // js, hash, example.com, script:contains(...)
        // js, hash, example.com, script:inject(...)
        case 6:
            this.duplicateBuster.add(fingerprint);
            this.createScriptFilter(args[1], args[2], args[3]);
            break;

        // https://github.com/chrisaljoudi/uBlock/issues/497
        // Generic exception filters: expected to be a rare occurrence.
        case 7:
            this.duplicateBuster.add(fingerprint);
            this.genericDonthideSet.add(args[1]);
            break;

        // h,  hash,  example.com, .promoted-tweet
        // h,  hash,  example.*, .promoted-tweet
        case 8:
        case 9:
            db = args[0] === 8 ? this.specificFilters : this.proceduralFilters;
            this.duplicateBuster.add(fingerprint);
            filter = new FilterHostname(args[3], args[2]);
            bucket = db.get(args[1]);
            if ( bucket === undefined ) {
                db.set(args[1], filter);
            } else if ( bucket instanceof FilterBucket ) {
                bucket.add(filter);
            } else {
                db.set(args[1], new FilterBucket(bucket, filter));
            }
            break;

        default:
            this.discardedCount += 1;
            break;
        }
   }
};

/******************************************************************************/

FilterContainer.prototype.skipCompiledContent = function(reader) {
    var fingerprint, args;

    while ( reader.next() === true ) {
        this.acceptedCount += 1;

        args = reader.args();

        // js, hash, example.com, script:contains(...)
        // js, hash, example.com, script:inject(...)
        if ( args[0] === 6 ) {
            fingerprint = reader.fingerprint();
            if ( this.duplicateBuster.has(fingerprint) === false ) {
                this.duplicateBuster.add(fingerprint);
                this.createScriptFilter(args[1], args[2], args[3]);
            }
            continue;
        }

        this.discardedCount += 1;
    }
};

/******************************************************************************/

FilterContainer.prototype.createScriptFilter = function(hash, hostname, selector) {
    if ( selector.startsWith('script:contains') ) {
        return this.createScriptTagFilter(hash, hostname, selector);
    }
    if ( selector.startsWith('script:inject') ) {
        return this.createUserScriptRule(hash, hostname, selector);
    }
};

/******************************************************************************/

// 0123456789012345678901
// script:contains(token)
//                 ^   ^
//                16   -1

FilterContainer.prototype.createScriptTagFilter = function(hash, hostname, selector) {
    var token = selector.slice(16, -1);
    token = token.startsWith('/') && token.endsWith('/')
        ? token.slice(1, -1)
        : token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    if ( this.scriptTagFilters.hasOwnProperty(hostname) ) {
        this.scriptTagFilters[hostname] += '|' + token;
    } else {
        this.scriptTagFilters[hostname] = token;
    }

    this.scriptTagFilterCount += 1;
};

/******************************************************************************/

FilterContainer.prototype.retrieveScriptTagHostnames = function() {
    return Object.keys(this.scriptTagFilters);
};

/******************************************************************************/

FilterContainer.prototype.retrieveScriptTagRegex = function(domain, hostname) {
    if ( this.scriptTagFilterCount === 0 ) {
        return;
    }
    var out = [], hn = hostname, pos;

    // Hostname-based
    for (;;) {
        if ( this.scriptTagFilters.hasOwnProperty(hn) ) {
            out.push(this.scriptTagFilters[hn]);
        }
        if ( hn === domain ) {
            break;
        }
        pos = hn.indexOf('.');
        if ( pos === -1 ) {
            break;
        }
        hn = hn.slice(pos + 1);
    }

    // Entity-based
    pos = domain.indexOf('.');
    if ( pos !== -1 ) {
        hn = domain.slice(0, pos) + '.*';
        if ( this.scriptTagFilters.hasOwnProperty(hn) ) {
            out.push(this.scriptTagFilters[hn]);
        }
    }
    if ( out.length !== 0 ) {
        return out.join('|');
    }
};

/******************************************************************************/

// userScripts{hash} => FilterHostname | FilterBucket

FilterContainer.prototype.createUserScriptRule = function(hash, hostname, selector) {
    var filter = new FilterHostname(selector, hostname);
    var bucket = this.userScripts.get(hash);
    if ( bucket === undefined ) {
        this.userScripts.set(hash, filter);
    } else if ( bucket instanceof FilterBucket ) {
        bucket.add(filter);
    } else {
        this.userScripts.set(hash, new FilterBucket(bucket, filter));
    }
    this.userScriptCount += 1;
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1954

// 01234567890123456789
// script:inject(token[, arg[, ...]])
//               ^                 ^
//              14                 -1

FilterContainer.prototype.retrieveUserScripts = function(domain, hostname) {
    if ( this.userScriptCount === 0 ) { return; }
    if ( µb.hiddenSettings.ignoreScriptInjectFilters === true ) { return; }

    var reng = µb.redirectEngine;
    if ( !reng ) { return; }

    var out = [],
        scripts = new Map(),
        pos = domain.indexOf('.'),
        entity = pos !== -1 ? domain.slice(0, pos) + '.*' : '';

    // Implicit
    var hn = hostname;
    for (;;) {
        this._lookupUserScript(scripts, hn + '.js', reng, out);
        if ( hn === domain ) { break; }
        pos = hn.indexOf('.');
        if ( pos === -1 ) { break; }
        hn = hn.slice(pos + 1);
    }
    if ( entity !== '' ) {
        this._lookupUserScript(scripts, entity + '.js', reng, out);
    }

    // Explicit (hash is domain).
    var selectors = new Set(),
        bucket;
    if ( (bucket = this.userScripts.get(domain)) ) {
        bucket.retrieve(hostname, selectors);
    }
    if ( entity !== '' && (bucket = this.userScripts.get(entity)) ) {
        bucket.retrieve(entity, selectors);
    }
    for ( var selector of selectors ) {
        this._lookupUserScript(scripts, selector.slice(14, -1).trim(), reng, out);
    }

    if ( out.length === 0 ) {
        return;
    }

    // https://github.com/gorhill/uBlock/issues/2835
    //   Do not inject scriptlets if the site is under an `allow` rule.
    if (
        µb.userSettings.advancedUserEnabled === true &&
        µb.sessionFirewall.evaluateCellZY(hostname, hostname, '*') === 2
    ) {
        return;
    }

    // Exceptions should be rare, so we check for exception only if there are
    // scriptlets returned.
    var exceptions = new Set(),
        j, token;
    if ( (bucket = this.userScripts.get('!' + domain)) ) {
        bucket.retrieve(hostname, exceptions);
    }
    if ( entity !== '' && (bucket = this.userScripts.get('!' + entity)) ) {
        bucket.retrieve(hostname, exceptions);
    }
    for ( var exception of exceptions ) {
        token = exception.slice(14, -1);
        if ( (j = scripts.get(token)) !== undefined ) {
            out[j] = '// User script "' + token + '" excepted.\n';
        }
    }

    return out.join('\n');
};

FilterContainer.prototype._lookupUserScript = function(dict, raw, reng, out) {
    if ( dict.has(raw) ) { return; }
    var token, args,
        pos = raw.indexOf(',');
    if ( pos === -1 ) {
        token = raw;
    } else {
        token = raw.slice(0, pos).trim();
        args = raw.slice(pos + 1).trim();
    }
    var content = reng.resourceContentFromName(token, 'application/javascript');
    if ( !content ) { return; }
    if ( args ) {
        content = this._fillupUserScript(content, args);
        if ( !content ) { return; }
    }
    dict.set(raw, out.length);
    out.push(content);
};

// Fill template placeholders. Return falsy if:
// - At least one argument contains anything else than /\w/ and `.`

FilterContainer.prototype._fillupUserScript = function(content, args) {
    var i = 1,
        pos, arg;
    while ( args !== '' ) {
        pos = args.indexOf(',');
        if ( pos === -1 ) { pos = args.length; }
        arg = args.slice(0, pos).trim().replace(this._reEscapeScriptArg, '\\$&');
        content = content.replace('{{' + i + '}}', arg);
        args = args.slice(pos + 1).trim();
        i++;
    }
    return content;
};

FilterContainer.prototype._reEscapeScriptArg = /[\\'"]/g;

/******************************************************************************/

FilterContainer.prototype.toSelfie = function() {
    var selfieFromMap = function(map) {
        var selfie = [];
        // Note: destructuring assignment not supported before Chromium 49. 
        for ( var entry of map ) {
            selfie.push([ entry[0], entry[1].compile() ]);
        }
        return JSON.stringify(selfie);
    };

    return {
        acceptedCount: this.acceptedCount,
        discardedCount: this.discardedCount,
        specificFilters: selfieFromMap(this.specificFilters),
        proceduralFilters: selfieFromMap(this.proceduralFilters),
        hasGenericHide: this.hasGenericHide,
        lowlyGenericSID: µb.arrayFrom(this.lowlyGeneric.id.simple),
        lowlyGenericCID: µb.arrayFrom(this.lowlyGeneric.id.complex),
        lowlyGenericSCL: µb.arrayFrom(this.lowlyGeneric.cl.simple),
        lowlyGenericCCL: µb.arrayFrom(this.lowlyGeneric.cl.complex),
        highSimpleGenericHideArray: µb.arrayFrom(this.highlyGeneric.simple.dict),
        highComplexGenericHideArray: µb.arrayFrom(this.highlyGeneric.complex.dict),
        genericDonthideArray: µb.arrayFrom(this.genericDonthideSet),
        scriptTagFilters: this.scriptTagFilters,
        scriptTagFilterCount: this.scriptTagFilterCount,
        userScripts: selfieFromMap(this.userScripts),
        userScriptCount: this.userScriptCount
    };
};

/******************************************************************************/

FilterContainer.prototype.fromSelfie = function(selfie) {
    var mapFromSelfie = function(selfie) {
        var entries = JSON.parse(selfie),
            out = new Map(),
            entry;
        for ( var i = 0, n = entries.length; i < n; i++ ) {
            entry = entries[i];
            out.set(entry[0], filterFromCompiledData(entry[1]));
        }
        return out;
    };

    this.acceptedCount = selfie.acceptedCount;
    this.discardedCount = selfie.discardedCount;
    this.specificFilters = mapFromSelfie(selfie.specificFilters);
    this.proceduralFilters = mapFromSelfie(selfie.proceduralFilters);
    this.hasGenericHide = selfie.hasGenericHide;
    this.lowlyGeneric.id.simple = new Set(selfie.lowlyGenericSID);
    this.lowlyGeneric.id.complex = new Map(selfie.lowlyGenericCID);
    this.lowlyGeneric.cl.simple = new Set(selfie.lowlyGenericSCL);
    this.lowlyGeneric.cl.complex = new Map(selfie.lowlyGenericCCL);
    this.highlyGeneric.simple.dict = new Set(selfie.highSimpleGenericHideArray);
    this.highlyGeneric.simple.str = selfie.highSimpleGenericHideArray.join(',\n');
    this.highlyGeneric.complex.dict = new Set(selfie.highComplexGenericHideArray);
    this.highlyGeneric.complex.str = selfie.highComplexGenericHideArray.join(',\n');
    this.genericDonthideSet = new Set(selfie.genericDonthideArray);
    this.scriptTagFilters = selfie.scriptTagFilters;
    this.scriptTagFilterCount = selfie.scriptTagFilterCount;
    this.userScripts = mapFromSelfie(selfie.userScripts);
    this.userScriptCount = selfie.userScriptCount;
    this.frozen = true;
};

/******************************************************************************/

FilterContainer.prototype.triggerSelectorCachePruner = function() {
    // Of interest: http://fitzgeraldnick.com/weblog/40/
    // http://googlecode.blogspot.ca/2009/07/gmail-for-mobile-html5-series-using.html
    if ( this.selectorCacheTimer === null ) {
        this.selectorCacheTimer = vAPI.setTimeout(
            this.pruneSelectorCacheAsync.bind(this),
            this.selectorCachePruneDelay
        );
    }
};

/******************************************************************************/

FilterContainer.prototype.addToSelectorCache = function(details) {
    var hostname = details.hostname;
    if ( typeof hostname !== 'string' || hostname === '' ) { return; }
    var selectors = details.selectors;
    if ( Array.isArray(selectors) === false ) { return; }
    var entry = this.selectorCache.get(hostname);
    if ( entry === undefined ) {
        entry = SelectorCacheEntry.factory();
        this.selectorCache.set(hostname, entry);
        if ( this.selectorCache.size > this.selectorCacheCountMin ) {
            this.triggerSelectorCachePruner();
        }
    }
    entry.add(details);
};

/******************************************************************************/

FilterContainer.prototype.removeFromSelectorCache = function(
    targetHostname,
    type
) {
    var targetHostnameLength = targetHostname.length,
        hostname, item;
    for ( var entry of this.selectorCache ) {
        hostname = entry[0];
        item = entry[1];
        if ( targetHostname !== '*' ) {
            if ( hostname.endsWith(targetHostname) === false ) { continue; }
            if (
                hostname.length !== targetHostnameLength &&
                hostname.charAt(hostname.length - targetHostnameLength - 1) !== '.'
            ) {
                continue;
            }
        }
        item.remove(type);
    }
};

/******************************************************************************/

FilterContainer.prototype.retrieveFromSelectorCache = function(
    hostname,
    type,
    out
) {
    var entry = this.selectorCache.get(hostname);
    if ( entry !== undefined ) {
        entry.retrieve(type, out);
    }
};

/******************************************************************************/

FilterContainer.prototype.pruneSelectorCacheAsync = function() {
    this.selectorCacheTimer = null;
    if ( this.selectorCache.size <= this.selectorCacheCountMin ) { return; }
    var cache = this.selectorCache;
    // Sorted from most-recently-used to least-recently-used, because
    //   we loop beginning at the end below.
    // We can't avoid sorting because we have to keep a minimum number of
    //   entries, and these entries should always be the most-recently-used.
    var hostnames = µb.arrayFrom(cache.keys())
            .sort(function(a, b) {
                return cache.get(b).lastAccessTime -
                       cache.get(a).lastAccessTime;
                })
            .slice(this.selectorCacheCountMin);
    var obsolete = Date.now() - this.selectorCacheAgeMax,
        hostname, entry,
        i = hostnames.length;
    while ( i-- ) {
        hostname = hostnames[i];
        entry = cache.get(hostname);
        if ( entry.lastAccessTime > obsolete ) { break; }
        // console.debug('pruneSelectorCacheAsync: flushing "%s"', hostname);
        entry.dispose();
        cache.delete(hostname);
    }
    if ( cache.size > this.selectorCacheCountMin ) {
        this.triggerSelectorCachePruner();
    }
};

/******************************************************************************/

FilterContainer.prototype.randomAlphaToken = function() {
    return String.fromCharCode(Date.now() % 26 + 97) +
           Math.floor(Math.random() * 982451653 + 982451653).toString(36);
};

/******************************************************************************/

FilterContainer.prototype.retrieveGenericSelectors = function(
    request,
    sender
) {
    if ( this.acceptedCount === 0 ) { return; }
    if ( !request.ids && !request.classes ) { return; }

    //console.time('cosmeticFilteringEngine.retrieveGenericSelectors');

    var simpleSelectors = this.setRegister0,
        complexSelectors = this.setRegister1;
    var entry, selectors,
        strEnd, sliceBeg, sliceEnd,
        selector, bucket;

    var cacheEntry = this.selectorCache.get(request.hostname),
        previousHits = cacheEntry && cacheEntry.cosmetic || this.setRegister2;

    for ( var type in this.lowlyGeneric ) {
        entry = this.lowlyGeneric[type];
        selectors = request[entry.canonical];
        if ( typeof selectors !== 'string' ) { continue; }
        strEnd = selectors.length;
        sliceBeg = 0;
        do {
            sliceEnd = selectors.indexOf('\n', sliceBeg);
            if ( sliceEnd === -1 ) { sliceEnd = strEnd; }
            selector = selectors.slice(sliceBeg, sliceEnd);
            sliceBeg = sliceEnd + 1;
            if ( entry.simple.has(selector) === false ) { continue; }
            if ( (bucket = entry.complex.get(selector)) !== undefined ) {
                if ( Array.isArray(bucket) ) {
                    for ( selector of bucket ) {
                        if ( previousHits.has(selector) === false ) {
                            complexSelectors.add(selector);
                        }
                    }
                } else if ( previousHits.has(bucket) === false ) {
                    complexSelectors.add(bucket);
                }
            } else {
                selector = entry.prefix + selector;
                if ( previousHits.has(selector) === false ) {
                    simpleSelectors.add(selector);
                }
            }
        } while ( sliceBeg < strEnd );
    }

    // Apply exceptions: it is the responsibility of the caller to provide
    // the exceptions to be applied.
    if ( Array.isArray(request.exceptions) ) {
        for ( var exception of request.exceptions ) {
            simpleSelectors.delete(exception);
            complexSelectors.delete(exception);
        }
    }

    if ( simpleSelectors.size === 0 && complexSelectors.size === 0 ) {
        return;
    }

    var out = {
        simple: µb.arrayFrom(simpleSelectors),
        complex: µb.arrayFrom(complexSelectors),
        injected: ''
    };

    // Cache and inject (if user stylesheets supported) looked-up low generic
    // cosmetic filters.
    if ( typeof request.hostname === 'string' && request.hostname !== '' ) {
        this.addToSelectorCache({
            cost: request.surveyCost || 0,
            hostname: request.hostname,
            injectedHideFilters: '',
            selectors: out.simple.concat(out.complex),
            type: 'cosmetic'
        });
    }

    // If user stylesheets are supported in the current process, inject the
    // cosmetic filters now.
    if (
        this.supportsUserStylesheets &&
        sender instanceof Object &&
        sender.tab instanceof Object &&
        typeof sender.frameId === 'number'
    ) {
        var injected = [];
        if ( out.simple.length !== 0 ) {
            injected.push(out.simple.join(',\n'));
            out.simple = [];
        }
        if ( out.complex.length !== 0 ) {
            injected.push(out.complex.join(',\n'));
            out.complex = [];
        }
        out.injected = injected.join(',\n');
        vAPI.insertCSS(sender.tab.id, {
            code: out.injected + '\n{display:none!important;}',
            cssOrigin: 'user',
            frameId: sender.frameId,
            runAt: 'document_start'
        });
    }

    // Important: always clear used registers before leaving.
    this.setRegister0.clear();
    this.setRegister1.clear();

    //console.timeEnd('cosmeticFilteringEngine.retrieveGenericSelectors');

    return out;
};

/******************************************************************************/

FilterContainer.prototype.retrieveDomainSelectors = function(
    request,
    sender,
    options
) {
    if ( !request.locationURL ) { return; }

    //console.time('cosmeticFilteringEngine.retrieveDomainSelectors');

    var hostname = this.µburi.hostnameFromURI(request.locationURL),
        domain = this.µburi.domainFromHostname(hostname) || hostname,
        pos = domain.indexOf('.'),
        entity = pos === -1 ? '' : domain.slice(0, pos - domain.length) + '.*',
        cacheEntry = this.selectorCache.get(hostname);

    // https://github.com/chrisaljoudi/uBlock/issues/587
    // out.ready will tell the content script the cosmetic filtering engine is
    // up and ready.

    // https://github.com/chrisaljoudi/uBlock/issues/497
    // Generic exception filters are to be applied on all pages.

    var out = {
        ready: this.frozen,
        hostname: hostname,
        domain: domain,
        entity: entity,
        declarativeFilters: [],
        exceptionFilters: [],
        hideNodeAttr: this.randomAlphaToken(),
        hideNodeStyleSheetInjected: false,
        highGenericHideSimple: '',
        highGenericHideComplex: '',
        injectedHideFilters: '',
        networkFilters: '',
        noDOMSurveying: this.hasGenericHide === false,
        proceduralFilters: [],
        scripts: undefined
    };

    if ( options.noCosmeticFiltering !== true ) {
        var domainHash = makeHash(domain),
            entityHash = entity !== '' ? makeHash(entity) : undefined,
            exception, bucket;

        // Exception cosmetic filters: prime with generic exception filters.
        var exceptionSet = this.setRegister0;
        // Genetic exceptions (should be extremely rare).
        for ( exception of this.genericDonthideSet ) {
            exceptionSet.add(exception);
        }
        // Specific exception cosmetic filters.
        if ( (bucket = this.specificFilters.get('!' + domainHash)) ) {
            bucket.retrieve(hostname, exceptionSet);
        }
        if ( (bucket = this.proceduralFilters.get('!' + domainHash)) ) {
            bucket.retrieve(hostname, exceptionSet);
        }
        // Specific entity-based exception cosmetic filters.
        if ( entityHash !== undefined ) {
            if ( (bucket = this.specificFilters.get('!' + entityHash)) ) {
                bucket.retrieve(entity, exceptionSet);
            }
            if ( (bucket = this.proceduralFilters.get('!' + entityHash)) ) {
                bucket.retrieve(entity, exceptionSet);
            }
        }
        // Special bucket for those filters without a valid
        // domain name as per PSL.
        if ( (bucket = this.specificFilters.get('!' + this.noDomainHash)) ) {
            bucket.retrieve(hostname, exceptionSet);
        }
        if ( (bucket = this.proceduralFilters.get('!' + this.noDomainHash)) ) {
            bucket.retrieve(hostname, exceptionSet);
        }
        if ( exceptionSet.size !== 0 ) {
            out.exceptionFilters = µb.arrayFrom(exceptionSet);
        }

        // Declarative cosmetic filters.
        // TODO: Should I go one step further and store specific simple and
        //       specific complex in different collections? This could simplify
        //       slightly content script code.
        var specificSet = this.setRegister1;
        // Specific cosmetic filters.
        if ( (bucket = this.specificFilters.get(domainHash)) ) {
            bucket.retrieve(hostname, specificSet);
        }
        // Specific entity-based cosmetic filters.
        if ( entityHash !== undefined ) {
            if ( (bucket = this.specificFilters.get(entityHash)) ) {
                bucket.retrieve(entity, specificSet);
            }
        }
        // https://github.com/chrisaljoudi/uBlock/issues/188
        // Special bucket for those filters without a valid domain name as per PSL
        if ( (bucket = this.specificFilters.get(this.noDomainHash)) ) {
            bucket.retrieve(hostname, specificSet);
        }
        // Cached cosmetic filters: these are always declarative.
        if ( cacheEntry !== undefined ) {
            cacheEntry.retrieve('cosmetic', specificSet);
            if ( out.noDOMSurveying === false ) {
                out.noDOMSurveying = cacheEntry.cosmeticSurveyingMissCount >
                                   cosmeticSurveyingMissCountMax;
            }
        }

        // Procedural cosmetic filters.
        var proceduralSet = this.setRegister2;
        // Specific cosmetic filters.
        if ( (bucket = this.proceduralFilters.get(domainHash)) ) {
            bucket.retrieve(hostname, proceduralSet);
        }
        // Specific entity-based cosmetic filters.
        if ( entityHash !== undefined ) {
            if ( (bucket = this.proceduralFilters.get(entityHash)) ) {
                bucket.retrieve(entity, proceduralSet);
            }
        }
        // https://github.com/chrisaljoudi/uBlock/issues/188
        // Special bucket for those filters without a valid domain name as per PSL
        if ( (bucket = this.proceduralFilters.get(this.noDomainHash)) ) {
            bucket.retrieve(hostname, proceduralSet);
        }

        // Apply exceptions.
        for ( exception of exceptionSet ) {
            specificSet.delete(exception);
            proceduralSet.delete(exception);
        }
        if ( specificSet.size !== 0 ) {
            out.declarativeFilters = µb.arrayFrom(specificSet);
        }
        if ( proceduralSet.size !== 0 ) {
            out.proceduralFilters = µb.arrayFrom(proceduralSet);
        }

        // Highly generic cosmetic filters: sent once along with specific ones.
        // A most-recent-used cache is used to skip computing the resulting set
        //   of high generics for a given set of exceptions.
        // The resulting set of high generics is stored as a string, ready to
        //   be used as-is by the content script. The string is stored
        //   indirectly in the mru cache: this is to prevent duplication of the
        //   string in memory, which I have observed occurs when the string is
        //   stored directly as a value in a Map.
        if ( options.noGenericCosmeticFiltering !== true ) {
            var exceptionHash = out.exceptionFilters.join();
            for ( var type in this.highlyGeneric ) {
                var entry = this.highlyGeneric[type];
                var str = entry.mru.lookup(exceptionHash);
                if ( str === undefined ) {
                    str = { s: entry.str };
                    var genericSet = entry.dict;
                    var hit = false;
                    for ( exception of exceptionSet ) {
                        if ( (hit = genericSet.has(exception)) ) { break; }
                    }
                    if ( hit ) {
                        genericSet = new Set(entry.dict);
                        for ( exception of exceptionSet ) {
                            genericSet.delete(exception);
                        }
                        str.s = µb.arrayFrom(genericSet).join(',\n');
                    }
                    entry.mru.add(exceptionHash, str);
                }
                out[entry.canonical] = str.s;
            }
        }

        // Important: always clear used registers before leaving.
        this.setRegister0.clear();
        this.setRegister1.clear();
        this.setRegister2.clear();
    }

    // Scriptlet injection.
    out.scripts = this.retrieveUserScripts(domain, hostname);

    if ( cacheEntry ) {
        var networkFilters = [];
        cacheEntry.retrieve('net', networkFilters);
        out.networkFilters = networkFilters.join(',\n');
    }

    // https://github.com/gorhill/uBlock/issues/3160
    //   If user stylesheets are supported in the current process, inject the
    //   cosmetic filters now.
    if (
        this.supportsUserStylesheets &&
        sender instanceof Object &&
        sender.tab instanceof Object &&
        typeof sender.frameId === 'number'
    ) {
        var injectedHideFilters = [];
        if ( out.declarativeFilters.length !== 0 ) {
            injectedHideFilters.push(out.declarativeFilters.join(',\n'));
            out.declarativeFilters = [];
        }
        if ( out.proceduralFilters.length !== 0 ) {
            injectedHideFilters.push('[' + out.hideNodeAttr + ']');
            out.hideNodeStyleSheetInjected = true;
        }
        if ( out.highGenericHideSimple.length !== 0 ) {
            injectedHideFilters.push(out.highGenericHideSimple);
            out.highGenericHideSimple = '';
        }
        if ( out.highGenericHideComplex.length !== 0 ) {
            injectedHideFilters.push(out.highGenericHideComplex);
            out.highGenericHideComplex = '';
        }
        out.injectedHideFilters = injectedHideFilters.join(',\n');
        var details = {
            code: '',
            cssOrigin: 'user',
            frameId: sender.frameId,
            runAt: 'document_start'
        };
        if ( out.injectedHideFilters.length !== 0 ) {
            details.code = out.injectedHideFilters + '\n{display:none!important;}';
            vAPI.insertCSS(sender.tab.id, details);
        }
        if ( out.networkFilters.length !== 0 ) {
            details.code = out.networkFilters + '\n{display:none!important;}';
            vAPI.insertCSS(sender.tab.id, details);
            out.networkFilters = '';
        }
    }

    //console.timeEnd('cosmeticFilteringEngine.retrieveDomainSelectors');

    return out;
};

/******************************************************************************/

FilterContainer.prototype.getFilterCount = function() {
    return this.acceptedCount - this.discardedCount;
};

/******************************************************************************/

return new FilterContainer();

/******************************************************************************/

})();

/******************************************************************************/

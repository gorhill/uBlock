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
        out.push(this.s);
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
    this.reNeedHostname = /^(?:script:contains|script:inject|.+?:has|.+?:has-text|.+?:if|.+?:if-not|.+?:matches-css(?:-before|-after)?|.*?:xpath)\(.+\)$/;
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
    // `#@#`, `#$#`, `#%#`: l = 2
    // `#@$#`, `#@%#`: l = 3
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
        // We have an Adguard cosmetic filter if and only if the character is
        // `$` or `%`, otherwise it's not a cosmetic filter.
        // Not a cosmetic filter.
        if ( cCode !== 0x24 /* '$' */ && cCode !== 0x25 /* '%' */ ) {
            this.cosmetic = false;
            return this;
        }
        // Not supported.
        if ( cCode !== 0x24 /* '$' */ ) {
            this.invalid = true;
            return this;
        }
        // CSS injection rule: supported, but translate into uBO's own format.
        raw = this.translateAdguardCSSInjectionFilter(raw);
        if ( raw === '' ) {
            this.invalid = true;
            return this;
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
    this.cosmetic = {};
    this.cosmeticSurveyingMissCount = 0;
    this.net = {};
    this.netCount = 0;
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
    var dict = this.cosmetic;
    while ( i-- ) {
        dict[selectors[i]] = true;
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
    if ( this.netCount < netSelectorCacheHighWaterMark ) {
        return;
    }
    var dict = this.net;
    var keys = Object.keys(dict).sort(function(a, b) {
        return dict[b] - dict[a];
    }).slice(netSelectorCacheLowWaterMark);
    var i = keys.length;
    while ( i-- ) {
        delete dict[keys[i]];
    }
};

/******************************************************************************/

SelectorCacheEntry.prototype.addNetOne = function(selector, now) {
    var dict = this.net;
    if ( dict[selector] === undefined ) {
        this.netCount += 1;
    }
    dict[selector] = now;
};

/******************************************************************************/

SelectorCacheEntry.prototype.addNetMany = function(selectors, now) {
    var dict = this.net;
    var i = selectors.length || 0;
    var selector;
    while ( i-- ) {
        selector = selectors[i];
        if ( dict[selector] === undefined ) {
            this.netCount += 1;
        }
        dict[selector] = now;
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
        this.cosmetic = {};
        this.cosmeticSurveyingMissCount = 0;
    }
    if ( type === undefined || type === 'net' ) {
        this.net = {};
        this.netCount = 0;
    }
};

/******************************************************************************/

SelectorCacheEntry.prototype.retrieve = function(type, out) {
    this.lastAccessTime = Date.now();
    var dict = type === 'cosmetic' ? this.cosmetic : this.net;
    for ( var selector in dict ) {
        if ( dict.hasOwnProperty(selector) ) {
            out.push(selector);
        }
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
    this.selectorCachePruneDelay = 10 * 60 * 1000; // 15 minutes
    this.selectorCacheAgeMax = 120 * 60 * 1000; // 120 minutes
    this.selectorCacheCountMin = 25;
    this.netSelectorCacheCountMax = netSelectorCacheHighWaterMark;
    this.selectorCacheTimer = null;
    this.reHasUnicode = /[^\x00-\x7F]/;
    this.rePlainSelector = /^[#.][\w\\-]+/;
    this.rePlainSelectorEscaped = /^[#.](?:\\[0-9A-Fa-f]+ |\\.|\w|-)+/;
    this.rePlainSelectorEx = /^[^#.\[(]+([#.][\w-]+)/;
    this.reEscapeSequence = /\\([0-9A-Fa-f]+ |.)/g;
    this.reHighLow = /^[a-z]*\[(?:alt|title)="[^"]+"\]$/;
    this.reHighMedium = /^\[href\^="https?:\/\/([^"]{8})[^"]*"\]$/;
    this.reScriptSelector = /^script:(contains|inject)\((.+)\)$/;
    this.punycode = punycode;
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

    this.selectorCache = {};
    this.selectorCacheCount = 0;
    if ( this.selectorCacheTimer !== null ) {
        clearTimeout(this.selectorCacheTimer);
        this.selectorCacheTimer = null;
    }

    // generic filters
    this.hasGenericHide = false;

    // [class], [id]
    this.lowGenericHide = new Set();
    this.lowGenericHideEx = new Map();
    this.lowGenericHideCount = 0;

    // [alt="..."], [title="..."]
    this.highLowGenericHide = {};
    this.highLowGenericHideCount = 0;

    // a[href^="http..."]
    this.highMediumGenericHide = {};
    this.highMediumGenericHideCount = 0;

    // high-high-simple selectors
    this.highHighSimpleGenericHideArray = [];
    this.highHighSimpleGenericHide = '';
    this.highHighSimpleGenericHideCount = 0;

    // high-high-complex selectors
    this.highHighComplexGenericHideArray = [];
    this.highHighComplexGenericHide = '';
    this.highHighComplexGenericHideCount = 0;

    // generic exception filters
    this.genericDonthide = [];

    // hostname, entity-based filters
    this.specificFilters = new Map();
    this.scriptTagFilters = {};
    this.scriptTagFilterCount = 0;
    this.userScripts = new Map();
    this.userScriptCount = 0;
};

/******************************************************************************/

FilterContainer.prototype.freeze = function() {
    this.duplicateBuster = new Set();

    if ( this.highHighSimpleGenericHide !== '' ) {
        this.highHighSimpleGenericHideArray.unshift(this.highHighSimpleGenericHide);
    }
    this.highHighSimpleGenericHide = this.highHighSimpleGenericHideArray.join(',\n');
    this.highHighSimpleGenericHideArray = [];

    if ( this.highHighComplexGenericHide !== '' ) {
        this.highHighComplexGenericHideArray.unshift(this.highHighComplexGenericHide);
    }
    this.highHighComplexGenericHide = this.highHighComplexGenericHideArray.join(',\n');
    this.highHighComplexGenericHideArray = [];

    this.hasGenericHide = this.lowGenericHideCount !== 0 ||
                          this.highLowGenericHideCount !== 0 ||
                          this.highMediumGenericHideCount !== 0 ||
                          this.highHighSimpleGenericHideCount !== 0 ||
                          this.highHighComplexGenericHideCount !== 0;

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
        reExtendedSyntaxHas = /\[-ext-has=(['"])(.+?)\1\]/,
        div = document.createElement('div');

    var isValidStyleProperty = function(cssText) {
        if ( reStyleBad.test(cssText) ) { return false; }
        div.style.cssText = cssText;
        if ( div.style.cssText === '' ) { return false; }
        div.style.cssText = '';
        return true;
    };

    var entryPoint = function(raw) {
        if ( isValidCSSSelector(raw) && reExtendedSyntax.test(raw) === false ) {
            return raw;
        }

        // We  rarely reach this point -- majority of selectors are plain
        // CSS selectors.

        // Unsupported ABP's advanced selector syntax.
        if ( raw.indexOf('[-abp-properties=') !== -1 ) {
            return;
        }

        var matches;

        // Supported Adguard's advanced selector syntax: will translate into
        // uBO's syntax before further processing.
        //
        // [-ext-has=...]
        // Converted to `:if(...)`, because Adguard accepts procedural
        // selectors within its `:has(...)` selector.
        if ( (matches = reExtendedSyntaxHas.exec(raw)) !== null ) {
            return this.compileSelector(
                raw.slice(0, matches.index) +
                ':if('+ matches[2].replace(/:contains\(/g, ':has-text(') + ')' +
                raw.slice(matches.index + matches[0].length)
            );
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
                if ( isValidStyleProperty(style) === false ) {
                    return;
                }
                return JSON.stringify({
                    raw: raw,
                    style: [ selector, '{' + style + '}' ]
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
            if ( reIsRegexLiteral.test(matches[2]) === false || isBadRegex(matches[2].slice(1, -1)) === false ) {
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
    var reOperatorParser = /(:(?:has|has-text|if|if-not|matches-css|matches-css-after|matches-css-before|xpath))\(.+\)$/,
        reFirstParentheses = /^\(*/,
        reLastParentheses = /\)*$/,
        reEscapeRegex = /[.*+?^${}()|[\]\\]/g,
        reNeedScope = /^\s*[+>~]/;

    var lastProceduralSelector = '',
        lastProceduralSelectorCompiled;

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
        if ( reIsRegexLiteral.test(s) ) {
            s = s.slice(1, -1);
            if ( isBadRegex(s) ) { return; }
        } else {
            s = s.replace(reEscapeRegex, '\\$&');
        }
        return s;
    };

    var compileCSSDeclaration = function(s) {
        var name, value,
            pos = s.indexOf(':');
        if ( pos === -1 ) { return; }
        name = s.slice(0, pos).trim();
        value = s.slice(pos + 1).trim();
        if ( reIsRegexLiteral.test(value) ) {
            value = value.slice(1, -1);
            if ( isBadRegex(value) ) { return; }
        } else {
            value = value.replace(reEscapeRegex, '\\$&');
        }
        return { name: name, value: value };
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
            compiled.raw = raw;
            compiled = JSON.stringify(compiled);
        }
        lastProceduralSelectorCompiled = compiled;
        return compiled;
    };

    entryPoint.reset = function() {
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
        //console.error("uBlock Origin> discarding invalid cosmetic filter '%s'", s);
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
        type = selector.charAt(0),
        key, matches;

    if ( type === '#' || type === '.' ) {
        key = this.keyFromSelector(selector);
        if ( key === undefined ) { return; }
        // Single-CSS rule: no need to test for whether the selector
        // is valid, the regex took care of this. Most generic selector falls
        // into that category.
        if ( key === selector ) {
            writer.push([ 0 /* lg */, key ]);
            return;
        }
        // Composite CSS rule.
        if ( this.compileSelector(selector) !== undefined ) {
            writer.push([ 1 /* lg+ */, key, selector ]);
        }
        return;
    }

    var compiled = this.compileSelector(selector);
    if ( compiled === undefined ) { return; }
    // TODO: Detect and error on procedural cosmetic filters.

    // ["title"] and ["alt"] will go in high-low generic bin.
    if ( this.reHighLow.test(selector) ) {
        writer.push([ 2 /* hlg0 */, selector ]);
        return;
    }

    // [href^="..."] will go in high-medium generic bin.
    matches = this.reHighMedium.exec(selector);
    if ( matches && matches.length === 2 ) {
        writer.push([ 3 /* hmg0 */, matches[1], selector ]);
        return;
    }

    // https://github.com/gorhill/uBlock/issues/909
    // Anything which contains a plain id/class selector can be classified
    // as a low generic cosmetic filter.
    matches = this.rePlainSelectorEx.exec(selector);
    if ( matches && matches.length === 2 ) {
        writer.push([ 1 /* lg+ */, matches[1], selector ]);
        return;
    }

    // All else: high-high generics.
    // Distinguish simple vs complex selectors.
    if ( selector.indexOf(' ') === -1 ) {
        writer.push([ 4 /* hhsg0 */, selector ]);
    } else {
        writer.push([ 5 /* hhcg0 */, selector ]);
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
    // All generic exception filters are put in the same bucket: they are
    // expected to be very rare.
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
    writer.push([ 8 /* h */, hash, hostname, compiled ]);
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

    var fingerprint, args, filter, bucket;

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

        // .largeAd
        case 0:
            bucket = this.lowGenericHideEx.get(args[1]);
            if ( bucket === undefined ) {
                this.lowGenericHide.add(args[1]);
            } else if ( Array.isArray(bucket) ) {
                bucket.push(args[1]);
            } else {
                this.lowGenericHideEx.set(args[1], [ bucket, args[1] ]);
            }
            this.lowGenericHideCount += 1;
            break;

        // .Mpopup, .Mpopup + #Mad > #MadZone
        case 1:
            bucket = this.lowGenericHideEx.get(args[1]);
            if ( bucket === undefined ) {
                if ( this.lowGenericHide.has(args[1]) ) {
                    this.lowGenericHideEx.set(args[1], [ args[1], args[2] ]);
                } else {
                    this.lowGenericHideEx.set(args[1], args[2]);
                    this.lowGenericHide.add(args[1]);
                }
            } else if ( Array.isArray(bucket) ) {
                bucket.push(args[2]);
            } else {
                this.lowGenericHideEx.set(args[1], [ bucket, args[2] ]);
            }
            this.lowGenericHideCount += 1;
            break;

        // ["title"]
        // ["alt"]
        case 2:
            this.highLowGenericHide[args[1]] = true;
            this.highLowGenericHideCount += 1;
            break;

        // [href^="..."]
        case 3:
            bucket = this.highMediumGenericHide[args[1]];
            if ( bucket === undefined ) {
                this.highMediumGenericHide[args[1]] = args[2];
            } else if ( Array.isArray(bucket) ) {
                bucket.push(args[2]);
            } else {
                this.highMediumGenericHide[args[1]] = [bucket, args[2]];
            }
            this.highMediumGenericHideCount += 1;
            break;

        // High-high generic hide/simple selectors
        // div[id^="allo"]
        case 4:
            this.highHighSimpleGenericHideArray.push(args[1]);
            this.highHighSimpleGenericHideCount += 1;
            break;

        // High-high generic hide/complex selectors
        // div[id^="allo"] > span
        case 5:
            this.highHighComplexGenericHideArray.push(args[1]);
            this.highHighComplexGenericHideCount += 1;
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
            this.genericDonthide.push(args[1]);
            break;

        // h,  hash,  example.com, .promoted-tweet
        // h,  hash,  example.*, .promoted-tweet
        case 8:
            filter = new FilterHostname(args[3], args[2]);
            bucket = this.specificFilters.get(args[1]);
            if ( bucket === undefined ) {
                this.specificFilters.set(args[1], filter);
            } else if ( bucket instanceof FilterBucket ) {
                bucket.add(filter);
            } else {
                this.specificFilters.set(args[1], new FilterBucket(bucket, filter));
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
    var fingerprint, args, filter, bucket;

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
            this.genericDonthide.push(args[1]);
            break;

        // h,  hash,  example.com, .promoted-tweet
        // h,  hash,  example.*, .promoted-tweet
        case 8:
            this.duplicateBuster.add(fingerprint);
            filter = new FilterHostname(args[3], args[2]);
            bucket = this.specificFilters.get(args[1]);
            if ( bucket === undefined ) {
                this.specificFilters.set(args[1], filter);
            } else if ( bucket instanceof FilterBucket ) {
                bucket.add(filter);
            } else {
                this.specificFilters.set(args[1], new FilterBucket(bucket, filter));
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
    var selectors = [], bucket;
    if ( (bucket = this.userScripts.get(domain)) ) {
        bucket.retrieve(hostname, selectors);
    }
    if ( entity !== '' && (bucket = this.userScripts.get(entity)) ) {
        bucket.retrieve(entity, selectors);
    }
    var i = selectors.length;
    while ( i-- ) {
        this._lookupUserScript(scripts, selectors[i].slice(14, -1).trim(), reng, out);
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
    var exceptions = [], j, token;
    if ( (bucket = this.userScripts.get('!' + domain)) ) {
        bucket.retrieve(hostname, exceptions);
    }
    if ( entity !== '' && (bucket = this.userScripts.get('!' + entity)) ) {
        bucket.retrieve(hostname, exceptions);
    }
    i = exceptions.length;
    while ( i-- ) {
        token = exceptions[i].slice(14, -1);
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
        hasGenericHide: this.hasGenericHide,
        lowGenericHide: µb.setToArray(this.lowGenericHide),
        lowGenericHideEx: µb.mapToArray(this.lowGenericHideEx),
        lowGenericHideCount: this.lowGenericHideCount,
        highLowGenericHide: this.highLowGenericHide,
        highLowGenericHideCount: this.highLowGenericHideCount,
        highMediumGenericHide: this.highMediumGenericHide,
        highMediumGenericHideCount: this.highMediumGenericHideCount,
        highHighSimpleGenericHide: this.highHighSimpleGenericHide,
        highHighSimpleGenericHideCount: this.highHighSimpleGenericHideCount,
        highHighComplexGenericHide: this.highHighComplexGenericHide,
        highHighComplexGenericHideCount: this.highHighComplexGenericHideCount,
        genericDonthide: this.genericDonthide,
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
    this.hasGenericHide = selfie.hasGenericHide;
    this.lowGenericHide = µb.setFromArray(selfie.lowGenericHide);
    this.lowGenericHideEx = µb.mapFromArray(selfie.lowGenericHideEx);
    this.lowGenericHideCount = selfie.lowGenericHideCount;
    this.highLowGenericHide = selfie.highLowGenericHide;
    this.highLowGenericHideCount = selfie.highLowGenericHideCount;
    this.highMediumGenericHide = selfie.highMediumGenericHide;
    this.highMediumGenericHideCount = selfie.highMediumGenericHideCount;
    this.highHighSimpleGenericHide = selfie.highHighSimpleGenericHide;
    this.highHighSimpleGenericHideCount = selfie.highHighSimpleGenericHideCount;
    this.highHighComplexGenericHide = selfie.highHighComplexGenericHide;
    this.highHighComplexGenericHideCount = selfie.highHighComplexGenericHideCount;
    this.genericDonthide = selfie.genericDonthide;
    this.scriptTagFilters = selfie.scriptTagFilters;
    this.scriptTagFilterCount = selfie.scriptTagFilterCount;
    this.userScripts = mapFromSelfie(selfie.userScripts);
    this.userScriptCount = selfie.userScriptCount;
    this.frozen = true;
};

/******************************************************************************/

FilterContainer.prototype.triggerSelectorCachePruner = function() {
    if ( this.selectorCacheTimer !== null ) {
        return;
    }
    if ( this.selectorCacheCount <= this.selectorCacheCountMin ) {
        return;
    }
    // Of interest: http://fitzgeraldnick.com/weblog/40/
    // http://googlecode.blogspot.ca/2009/07/gmail-for-mobile-html5-series-using.html
    this.selectorCacheTimer = vAPI.setTimeout(
        this.pruneSelectorCacheAsync.bind(this),
        this.selectorCachePruneDelay
    );
};

/******************************************************************************/

FilterContainer.prototype.addToSelectorCache = function(details) {
    var hostname = details.hostname;
    if ( typeof hostname !== 'string' || hostname === '' ) {
        return;
    }
    var selectors = details.selectors;
    if ( !selectors ) {
        return;
    }
    var entry = this.selectorCache[hostname];
    if ( entry === undefined ) {
        entry = this.selectorCache[hostname] = SelectorCacheEntry.factory();
        this.selectorCacheCount += 1;
        this.triggerSelectorCachePruner();
    }
    entry.add(details);
};

/******************************************************************************/

FilterContainer.prototype.removeFromSelectorCache = function(targetHostname, type) {
    var targetHostnameLength = targetHostname.length;
    for ( var hostname in this.selectorCache ) {
        if ( this.selectorCache.hasOwnProperty(hostname) === false ) {
            continue;
        }
        if ( targetHostname !== '*' ) {
            if ( hostname.endsWith(targetHostname) === false ) {
                continue;
            }
            if ( hostname.length !== targetHostnameLength &&
                 hostname.charAt(hostname.length - targetHostnameLength - 1) !== '.' ) {
                continue;
            }
        }
        this.selectorCache[hostname].remove(type);
    }
};

/******************************************************************************/

FilterContainer.prototype.retrieveFromSelectorCache = function(hostname, type, out) {
    var entry = this.selectorCache[hostname];
    if ( entry === undefined ) {
        return;
    }
    entry.retrieve(type, out);
};

/******************************************************************************/

FilterContainer.prototype.pruneSelectorCacheAsync = function() {
    this.selectorCacheTimer = null;
    if ( this.selectorCacheCount <= this.selectorCacheCountMin ) {
        return;
    }
    var cache = this.selectorCache;
    // Sorted from most-recently-used to least-recently-used, because
    //   we loop beginning at the end below.
    // We can't avoid sorting because we have to keep a minimum number of
    //   entries, and these entries should always be the most-recently-used.
    var hostnames = Object.keys(cache)
        .sort(function(a, b) { return cache[b].lastAccessTime - cache[a].lastAccessTime; })
        .slice(this.selectorCacheCountMin);
    var obsolete = Date.now() - this.selectorCacheAgeMax;
    var hostname, entry;
    var i = hostnames.length;
    while ( i-- ) {
        hostname = hostnames[i];
        entry = cache[hostname];
        if ( entry.lastAccessTime > obsolete ) {
            break;
        }
        // console.debug('pruneSelectorCacheAsync: flushing "%s"', hostname);
        entry.dispose();
        delete cache[hostname];
        this.selectorCacheCount -= 1;
    }
    this.triggerSelectorCachePruner();
};

/******************************************************************************/

FilterContainer.prototype.retrieveGenericSelectors = function(request) {
    if ( this.acceptedCount === 0 ) {
        return;
    }
    if ( !request.selectors ) {
        return;
    }

    //quickProfiler.start('FilterContainer.retrieve()');

    var r = {
        hide: []
    };

    if ( request.firstSurvey ) {
        r.highGenerics = {
            hideLow: this.highLowGenericHide,
            hideLowCount: this.highLowGenericHideCount,
            hideMedium: this.highMediumGenericHide,
            hideMediumCount: this.highMediumGenericHideCount,
            hideHighSimple: this.highHighSimpleGenericHide,
            hideHighSimpleCount: this.highHighSimpleGenericHideCount,
            hideHighComplex: this.highHighComplexGenericHide,
            hideHighComplexCount: this.highHighComplexGenericHideCount
        };
    }

    var hideSelectors = r.hide,
        selectors = request.selectors,
        i = selectors.length,
        selector, bucket;
    while ( i-- ) {
        selector = selectors[i];
        if ( this.lowGenericHide.has(selector) === false ) { continue; }
        if ( (bucket = this.lowGenericHideEx.get(selector)) !== undefined ) {
            if ( Array.isArray(bucket) ) {
                hideSelectors = hideSelectors.concat(bucket);
            } else {
                hideSelectors.push(bucket);
            }
        } else {
            hideSelectors.push(selector);
        }
    }
    r.hide = hideSelectors;

    //quickProfiler.stop();

    return r;
};

/******************************************************************************/

FilterContainer.prototype.retrieveDomainSelectors = function(request, noCosmeticFiltering) {
    if ( !request.locationURL ) {
        return;
    }

    //quickProfiler.start('FilterContainer.retrieve()');

    var hostname = this.µburi.hostnameFromURI(request.locationURL),
        domain = this.µburi.domainFromHostname(hostname) || hostname,
        pos = domain.indexOf('.'),
        entity = pos === -1 ? '' : domain.slice(0, pos - domain.length) + '.*',
        cacheEntry = this.selectorCache[hostname];

    // https://github.com/chrisaljoudi/uBlock/issues/587
    // r.ready will tell the content script the cosmetic filtering engine is
    // up and ready.

    // https://github.com/chrisaljoudi/uBlock/issues/497
    // Generic exception filters are to be applied on all pages.

    var r = {
        ready: this.frozen,
        domain: domain,
        entity: entity,
        noDOMSurveying: this.hasGenericHide === false,
        cosmeticHide: [],
        cosmeticDonthide: [],
        netHide: [],
        scripts: undefined
    };

    if ( !noCosmeticFiltering ) {
        var hash, bucket;

        // Generic exception cosmetic filters.
        r.cosmeticDonthide = this.genericDonthide.slice();

        // Specific cosmetic filters.
        hash = makeHash(domain);
        if ( (bucket = this.specificFilters.get(hash)) ) {
            bucket.retrieve(hostname, r.cosmeticHide);
        }
        // Specific exception cosmetic filters.
        if ( (bucket = this.specificFilters.get('!' + hash)) ) {
            bucket.retrieve(hostname, r.cosmeticDonthide);
        }

        // Specific entity-based cosmetic filters.
        if ( entity !== '' ) {
            // Specific entity-based cosmetic filters.
            hash = makeHash(entity);
            if ( (bucket = this.specificFilters.get(hash)) ) {
                bucket.retrieve(entity, r.cosmeticHide);
            }
            // Specific entity-based exception cosmetic filters.
            //if ( (bucket = this.specificFilters.get('!' + hash)) ) {
            //    bucket.retrieve(entity, r.cosmeticHide);
            //}
        }

        // https://github.com/chrisaljoudi/uBlock/issues/188
        // Special bucket for those filters without a valid domain name as per PSL
        if ( (bucket = this.specificFilters.get(this.noDomainHash)) ) {
            bucket.retrieve(hostname, r.cosmeticHide);
        }
        if ( (bucket = this.specificFilters.get('!' + this.noDomainHash)) ) {
            bucket.retrieve(hostname, r.cosmeticDonthide);
        }

        // cached cosmetic filters.
        if ( cacheEntry ) {
            cacheEntry.retrieve('cosmetic', r.cosmeticHide);
            if ( r.noDOMSurveying === false ) {
                r.noDOMSurveying = cacheEntry.cosmeticSurveyingMissCount > cosmeticSurveyingMissCountMax;
            }
        }
    }

    // Scriptlet injection.
    r.scripts = this.retrieveUserScripts(domain, hostname);

    // Collapsible blocked resources.
    if ( cacheEntry ) {
        cacheEntry.retrieve('net', r.netHide);
    }

    //quickProfiler.stop();

    return r;
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

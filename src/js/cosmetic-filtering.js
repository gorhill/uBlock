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

'use strict';

/******************************************************************************/

µBlock.cosmeticFilteringEngine = (function(){

/******************************************************************************/

var µb = µBlock;
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
    if ( hostname.endsWith(this.hostname) === false ) { return; }
    var i = hostname.length - this.hostname.length;
    if ( i === 0 || hostname.charCodeAt(i-1) === 0x2E /* '.' */ ) {
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

// 0000HHHHHHHHHHHH
//                |
//                |
//                |
//                +-- bit 11-0 of FNV

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
    this.reHasUnicode = /[^\x00-\x7F]/;
    this.rePlainSelector = /^[#.][\w\\-]+/;
    this.rePlainSelectorEscaped = /^[#.](?:\\[0-9A-Fa-f]+ |\\.|\w|-)+/;
    this.rePlainSelectorEx = /^[^#.\[(]+([#.][\w-]+)|([#.][\w-]+)$/;
    this.reEscapeSequence = /\\([0-9A-Fa-f]+ |.)/g;
    this.reSimpleHighGeneric1 = /^[a-z]*\[[^[]+]$/;
    this.reHighMedium = /^\[href\^="https?:\/\/([^"]{8})[^"]*"\]$/;
    this.reNeedHostname = new RegExp([
        '^',
        '(?:',
            [
            'script:contains',
            '.+?:has',
            '.+?:has-text',
            '.+?:if',
            '.+?:if-not',
            '.+?:matches-css(?:-before|-after)?',
            '.*?:xpath',
            '.+?:style',
            '.+?:-abp-contains', // ABP-specific for `:has-text`
            '.+?:-abp-has',      // ABP-specific for `:if`
            '.+?:contains'       // Adguard-specific for `:has-text`
            ].join('|'),
        ')',
        '\\(.+\\)',
        '$'
    ].join(''));

    this.selectorCache = new Map();
    this.selectorCachePruneDelay = 10 * 60 * 1000; // 10 minutes
    this.selectorCacheAgeMax = 120 * 60 * 1000; // 120 minutes
    this.selectorCacheCountMin = 25;
    this.netSelectorCacheCountMax = netSelectorCacheHighWaterMark;
    this.selectorCacheTimer = null;

    this.supportsUserStylesheets = vAPI.supportsUserStylesheets;

    // generic exception filters
    this.genericDonthideSet = new Set();

    // TODO: Think about reusing µb.staticExtFilteringEngine.HostnameBasedDB
    //       for both specific and procedural filters. This would require some
    //       refactoring.
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

    // Short-lived: content is valid only during one function call. These
    // is to prevent repeated allocation/deallocation overheads -- the
    // constructors/destructors of javascript Set/Map is assumed to be costlier
    // than just calling clear() on these.
    this.setRegister0 = new Set();
    this.setRegister1 = new Set();
    this.setRegister2 = new Set();
    this.mapRegister0 = new Map();

    this.reset();
};

/******************************************************************************/

// Reset all, thus reducing to a minimum memory footprint of the context.

FilterContainer.prototype.reset = function() {
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

    this.frozen = true;
};


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

FilterContainer.prototype.compile = function(parsed, writer) {
    // 1000 = cosmetic filtering
    writer.select(1000);

    var hostnames = parsed.hostnames,
        i = hostnames.length;
    if ( i === 0 ) {
        this.compileGenericSelector(parsed, writer);
        return true;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/151
    // Negated hostname means the filter applies to all non-negated hostnames
    // of same filter OR globally if there is no non-negated hostnames.
    var applyGlobally = true;
    while ( i-- ) {
        var hostname = hostnames[i];
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
    if ( parsed.exception === false ) {
        this.compileGenericHideSelector(parsed, writer);
    } else {
        this.compileGenericUnhideSelector(parsed, writer);
    }
};

/******************************************************************************/

FilterContainer.prototype.compileGenericHideSelector = function(parsed, writer) {
    var selector = parsed.suffix;

    // For some selectors, it is mandatory to have a hostname or entity:
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
    //   ##.foo:style(...)
    if ( this.reNeedHostname.test(selector) ) {
        µb.logger.writeOne(
            '',
            'error',
            'Cosmetic filtering – invalid generic filter: ##' + selector
        );
        return;
    }

    var type = selector.charCodeAt(0),
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
        if ( µb.staticExtFilteringEngine.compileSelector(selector) !== undefined ) {
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
        if ( µb.staticExtFilteringEngine.compileSelector(selector) !== undefined ) {
            writer.push([ 3 /* lg+ */, key.slice(1), selector ]);
        }
        return;
    }

    var compiled = µb.staticExtFilteringEngine.compileSelector(selector);
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

FilterContainer.prototype.compileGenericUnhideSelector = function(
    parsed,
    writer
) {
    // Procedural cosmetic filters are acceptable as generic exception filters.
    var compiled = µb.staticExtFilteringEngine.compileSelector(parsed.suffix);
    if ( compiled === undefined ) { return; }

    // https://github.com/chrisaljoudi/uBlock/issues/497
    //   All generic exception filters are put in the same bucket: they are
    //   expected to be very rare.
    writer.push([ 7 /* g1 */, compiled ]);
};

/******************************************************************************/

FilterContainer.prototype.compileHostnameSelector = function(
    hostname,
    parsed,
    writer
) {
    // https://github.com/chrisaljoudi/uBlock/issues/145
    var unhide = parsed.exception ? 1 : 0;
    if ( hostname.startsWith('~') ) {
        hostname = hostname.slice(1);
        unhide ^= 1;
    }

    var compiled = µb.staticExtFilteringEngine.compileSelector(parsed.suffix);
    if ( compiled === undefined ) { return; }

    var domain = this.µburi.domainFromHostname(hostname),
        hash;

    // https://github.com/chrisaljoudi/uBlock/issues/188
    // If not a real domain as per PSL, assign a synthetic one
    if ( hostname.endsWith('.*') === false ) {
        hash = domain !== '' ? makeHash(domain) : this.noDomainHash;
    } else {
        hash = makeHash(hostname);
    }
    if ( unhide === 1 ) {
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

FilterContainer.prototype.fromCompiledContent = function(reader, options) {
    if ( options.skipCosmetic ) {
        this.skipCompiledContent(reader);
        return;
    }
    if ( options.skipGenericCosmetic ) {
        this.skipGenericCompiledContent(reader);
        return;
    }

    var fingerprint, args, db, filter, bucket;

    // 1000 = cosmetic filtering
    reader.select(1000);

    while ( reader.next() ) {
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

    // 1000 = cosmetic filtering
    reader.select(1000);

    while ( reader.next() ) {
        this.acceptedCount += 1;
        fingerprint = reader.fingerprint();
        if ( this.duplicateBuster.has(fingerprint) ) {
            this.discardedCount += 1;
            continue;
        }

        args = reader.args();

        switch ( args[0] ) {

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
    // 1000 = cosmetic filtering
    reader.select(1000);

    while ( reader.next() ) {
        this.acceptedCount += 1;
        this.discardedCount += 1;
    }
};

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
        genericDonthideArray: µb.arrayFrom(this.genericDonthideSet)
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

FilterContainer.prototype.retrieveGenericSelectors = function(request) {
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
        request.tabId !== undefined &&
        request.frameId !== undefined
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
        vAPI.insertCSS(request.tabId, {
            code: out.injected + '\n{display:none!important;}',
            cssOrigin: 'user',
            frameId: request.frameId,
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
    options
) {
    //console.time('cosmeticFilteringEngine.retrieveDomainSelectors');

    var hostname = request.hostname,
        entity = request.entity,
        cacheEntry = this.selectorCache.get(hostname),
        entry;

    // https://github.com/chrisaljoudi/uBlock/issues/587
    // out.ready will tell the content script the cosmetic filtering engine is
    // up and ready.

    // https://github.com/chrisaljoudi/uBlock/issues/497
    // Generic exception filters are to be applied on all pages.

    var out = {
        ready: this.frozen,
        hostname: hostname,
        domain: request.domain,
        declarativeFilters: [],
        exceptionFilters: [],
        hideNodeAttr: this.randomAlphaToken(),
        hideNodeStyleSheetInjected: false,
        highGenericHideSimple: '',
        highGenericHideComplex: '',
        injectedHideFilters: '',
        networkFilters: '',
        noDOMSurveying: this.hasGenericHide === false,
        proceduralFilters: []
    };

    if ( options.noCosmeticFiltering !== true ) {
        var domainHash = makeHash(request.domain),
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
                entry = this.highlyGeneric[type];
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

    // CSS selectors for collapsible blocked elements
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
        request.tabId !== undefined &&
        request.frameId !== undefined
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
            frameId: request.frameId,
            runAt: 'document_start'
        };
        if ( out.injectedHideFilters.length !== 0 ) {
            details.code = out.injectedHideFilters + '\n{display:none!important;}';
            vAPI.insertCSS(request.tabId, details);
        }
        if ( out.networkFilters.length !== 0 ) {
            details.code = out.networkFilters + '\n{display:none!important;}';
            vAPI.insertCSS(request.tabId, details);
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

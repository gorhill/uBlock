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

'use strict';

/******************************************************************************/

µBlock.cosmeticFilteringEngine = (( ) => {

/******************************************************************************/

const µb = µBlock;
const cosmeticSurveyingMissCountMax =
    parseInt(vAPI.localStorage.getItem('cosmeticSurveyingMissCountMax'), 10) ||
    15;

let supportsUserStylesheets = vAPI.webextFlavor.soup.has('user_stylesheet');
// https://www.reddit.com/r/uBlockOrigin/comments/8dkvqn/116_broken_loading_custom_filters_from_my_filters/
window.addEventListener('webextFlavor', function() {
    supportsUserStylesheets = vAPI.webextFlavor.soup.has('user_stylesheet');
}, { once: true });

/******************************************************************************/
/******************************************************************************/

const SelectorCacheEntry = class {
    constructor() {
        this.reset();
    }

    reset() {
        this.cosmetic = new Set();
        this.cosmeticSurveyingMissCount = 0;
        this.net = new Map();
        this.lastAccessTime = Date.now();
        return this;
    }

    dispose() {
        this.cosmetic = this.net = null;
        if ( SelectorCacheEntry.junkyard.length < 25 ) {
            SelectorCacheEntry.junkyard.push(this);
        }
    }

    addCosmetic(details) {
        const selectors = details.selectors;
        let i = selectors.length || 0;
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
    }

    addNet(selectors) {
        if ( typeof selectors === 'string' ) {
            this.addNetOne(selectors, Date.now());
        } else {
            this.addNetMany(selectors, Date.now());
        }
        // Net request-derived selectors: I limit the number of cached
        // selectors, as I expect cases where the blocked net-requests
        // are never the exact same URL.
        if ( this.net.size < SelectorCacheEntry.netHighWaterMark ) {
            return;
        }
        const dict = this.net;
        const keys = Array.from(dict.keys()).sort(function(a, b) {
            return dict.get(b) - dict.get(a);
        }).slice(SelectorCacheEntry.netLowWaterMark);
        let i = keys.length;
        while ( i-- ) {
            dict.delete(keys[i]);
        }
    }

    addNetOne(selector, now) {
        this.net.set(selector, now);
    }

    addNetMany(selectors, now) {
        let i = selectors.length || 0;
        while ( i-- ) {
            this.net.set(selectors[i], now);
        }
    }

    add(details) {
        this.lastAccessTime = Date.now();
        if ( details.type === 'cosmetic' ) {
            this.addCosmetic(details);
        } else {
            this.addNet(details.selectors);
        }
    }

    // https://github.com/chrisaljoudi/uBlock/issues/420
    remove(type) {
        this.lastAccessTime = Date.now();
        if ( type === undefined || type === 'cosmetic' ) {
            this.cosmetic.clear();
            this.cosmeticSurveyingMissCount = 0;
        }
        if ( type === undefined || type === 'net' ) {
            this.net.clear();
        }
    }

    retrieveToArray(iterator, out) {
        for ( let selector of iterator ) {
            out.push(selector);
        }
    }

    retrieveToSet(iterator, out) {
        for ( let selector of iterator ) {
            out.add(selector);
        }
    }

    retrieve(type, out) {
        this.lastAccessTime = Date.now();
        const iterator = type === 'cosmetic' ? this.cosmetic : this.net.keys();
        if ( Array.isArray(out) ) {
            this.retrieveToArray(iterator, out);
        } else {
            this.retrieveToSet(iterator, out);
        }
    }

    static factory() {
        const entry = SelectorCacheEntry.junkyard.pop();
        if ( entry ) {
            return entry.reset();
        }
        return new SelectorCacheEntry();
    }
};

SelectorCacheEntry.netLowWaterMark = 20;
SelectorCacheEntry.netHighWaterMark = 30;
SelectorCacheEntry.junkyard = [];

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

const FilterContainer = function() {
    this.reHasUnicode = /[^\x00-\x7F]/;
    this.rePlainSelector = /^[#.][\w\\-]+/;
    this.rePlainSelectorEscaped = /^[#.](?:\\[0-9A-Fa-f]+ |\\.|\w|-)+/;
    this.rePlainSelectorEx = /^[^#.\[(]+([#.][\w-]+)|([#.][\w-]+)$/;
    this.reEscapeSequence = /\\([0-9A-Fa-f]+ |.)/g;
    this.reSimpleHighGeneric1 = /^[a-z]*\[[^[]+]$/;
    this.reHighMedium = /^\[href\^="https?:\/\/([^"]{8})[^"]*"\]$/;

    this.selectorCache = new Map();
    this.selectorCachePruneDelay = 10 * 60 * 1000; // 10 minutes
    this.selectorCacheAgeMax = 120 * 60 * 1000; // 120 minutes
    this.selectorCacheCountMin = 25;
    this.netSelectorCacheCountMax = SelectorCacheEntry.netHighWaterMark;
    this.selectorCacheTimer = null;

    // specific filters
    this.specificFilters = new µb.staticExtFilteringEngine.HostnameBasedDB(2);

    // temporary filters
    this.sessionFilterDB = new (
        class extends µb.staticExtFilteringEngine.SessionDB {
            compile(s) {
                return µb.staticExtFilteringEngine.compileSelector(s);
            }
        }
    )();

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
    this.$simpleSet = new Set();
    this.$complexSet = new Set();
    this.$specificSet = new Set();
    this.$exceptionSet = new Set();
    this.$proceduralSet = new Set();
    this.$dummySet = new Set();

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

    // hostname, entity-based filters
    this.specificFilters.clear();

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
    this.duplicateBuster.clear();
    this.specificFilters.collectGarbage();

    this.hasGenericHide =
        this.lowlyGeneric.id.simple.size !== 0 ||
        this.lowlyGeneric.id.complex.size !== 0 ||
        this.lowlyGeneric.cl.simple.size !== 0 ||
        this.lowlyGeneric.cl.complex.size !== 0 ||
        this.highlyGeneric.simple.dict.size !== 0 ||
        this.highlyGeneric.complex.dict.size !== 0;

    this.highlyGeneric.simple.str = Array.from(this.highlyGeneric.simple.dict).join(',\n');
    this.highlyGeneric.simple.mru.reset();
    this.highlyGeneric.complex.str = Array.from(this.highlyGeneric.complex.dict).join(',\n');
    this.highlyGeneric.complex.mru.reset();

    this.frozen = true;
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1668
//   The key must be literal: unescape escaped CSS before extracting key.
//   It's an uncommon case, so it's best to unescape only when needed.

FilterContainer.prototype.keyFromSelector = function(selector) {
    let matches = this.rePlainSelector.exec(selector);
    if ( matches === null ) { return; }
    let key = matches[0];
    if ( key.indexOf('\\') === -1 ) {
        return key;
    }
    matches = this.rePlainSelectorEscaped.exec(selector);
    if ( matches === null ) { return; }
    key = '';
    let escaped = matches[0],
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

    const hostnames = parsed.hostnames;
    let i = hostnames.length;
    if ( i === 0 ) {
        this.compileGenericSelector(parsed, writer);
        return true;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/151
    // Negated hostname means the filter applies to all non-negated hostnames
    // of same filter OR globally if there is no non-negated hostnames.
    let applyGlobally = true;
    while ( i-- ) {
        const hostname = hostnames[i];
        if ( hostname.startsWith('~') === false ) {
            applyGlobally = false;
        }
        this.compileSpecificSelector(hostname, parsed, writer);
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

FilterContainer.prototype.compileGenericHideSelector = function(
    parsed,
    writer
) {
    const selector = parsed.suffix;
    const type = selector.charCodeAt(0);
    let key;

    if ( type === 0x23 /* '#' */ ) {
        key = this.keyFromSelector(selector);
        // Simple selector-based CSS rule: no need to test for whether the
        // selector is valid, the regex took care of this. Most generic
        // selector falls into that category.
        // - ###ad-bigbox
        if ( key === selector ) {
            writer.push([ 0, key.slice(1) ]);
            return;
        }
    } else if ( type === 0x2E /* '.' */ ) {
        key = this.keyFromSelector(selector);
        // Simple selector-based CSS rule: no need to test for whether the
        // selector is valid, the regex took care of this. Most generic
        // selector falls into that category.
        // - ##.ads-bigbox
        if ( key === selector ) {
            writer.push([ 2, key.slice(1) ]);
            return;
        }
    }

    const compiled = µb.staticExtFilteringEngine.compileSelector(selector);

    // Invalid cosmetic filter, possible reasons:
    // - Bad syntax
    // - Procedural filters (can't be generic): the compiled version of
    //   a procedural selector is NEVER equal to its raw version.
    // https://github.com/uBlockOrigin/uBlock-issues/issues/464
    //   Pseudoclass-based selectors can be compiled, but are also valid
    //   plain selectors.
    // https://github.com/uBlockOrigin/uBlock-issues/issues/131
    //   Support generic procedural filters as per advanced settings.
    //   TODO: prevent double compilation.
    if (
        compiled === undefined ||
        compiled !== selector &&
        µb.staticExtFilteringEngine.compileSelector.pseudoclass !== true
    ) {
        if ( µb.hiddenSettings.allowGenericProceduralFilters === true ) {
            return this.compileSpecificSelector('', parsed, writer);
        }
        const who = writer.properties.get('assetKey') || '?';
        µb.logger.writeOne({
            realm: 'message',
            type: 'error',
            text: `Invalid generic cosmetic filter in ${who}: ##${selector}`
        });
        return;
    }

    // Complex selector-based CSS rule:
    // - ###tads + div + .c
    // - ##.rscontainer > .ellip
    if ( key !== undefined ) {
        writer.push([
            type === 0x23 /* '#' */ ? 1 : 3,
            key.slice(1),
            selector
        ]);
        return;
    }

    // https://github.com/gorhill/uBlock/issues/909
    //   Anything which contains a plain id/class selector can be classified
    //   as a low generic cosmetic filter.
    const matches = this.rePlainSelectorEx.exec(selector);
    if ( matches !== null ) {
        const key = matches[1] || matches[2];
        writer.push([
            key.charCodeAt(0) === 0x23 /* '#' */ ? 1 : 3,
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
    const compiled = µb.staticExtFilteringEngine.compileSelector(parsed.suffix);
    if ( compiled === undefined ) {
        const who = writer.properties.get('assetKey') || '?';
        µb.logger.writeOne({
            realm: 'message',
            type: 'error',
            text: `Invalid cosmetic filter in ${who}: #@#${parsed.suffix}`
        });
        return;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/497
    //   All generic exception filters are stored as hostname-based filter
    //   whereas the hostname is the empty string (which matches all
    //   hostnames). No distinction is made between declarative and
    //   procedural selectors, since they really exist only to cancel
    //   out other cosmetic filters.
    writer.push([ 8, '', 0b01, compiled ]);
};

/******************************************************************************/

FilterContainer.prototype.compileSpecificSelector = function(
    hostname,
    parsed,
    writer
) {
    // https://github.com/chrisaljoudi/uBlock/issues/145
    let unhide = parsed.exception ? 1 : 0;
    if ( hostname.startsWith('~') ) {
        hostname = hostname.slice(1);
        unhide ^= 1;
    }

    const compiled = µb.staticExtFilteringEngine.compileSelector(parsed.suffix);
    if ( compiled === undefined ) {
        const who = writer.properties.get('assetKey') || '?';
        µb.logger.writeOne({
            realm: 'message',
            type: 'error',
            text: `Invalid cosmetic filter in ${who}: ##${parsed.suffix}`
        });
        return;
    }


    let kind = 0;
    if ( unhide === 1 ) {
        kind |= 0b01;     // Exception
    }
    if ( compiled.charCodeAt(0) === 0x7B /* '{' */ ) {
        kind |= 0b10;     // Procedural
    }

    writer.push([ 8, hostname, kind, compiled ]);
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

    // 1000 = cosmetic filtering
    reader.select(1000);

    let db, bucket;

    while ( reader.next() ) {
        this.acceptedCount += 1;
        const fingerprint = reader.fingerprint();
        if ( this.duplicateBuster.has(fingerprint) ) {
            this.discardedCount += 1;
            continue;
        }
        this.duplicateBuster.add(fingerprint);

        const args = reader.args();

        switch ( args[0] ) {

        // low generic, simple
        case 0: // #AdBanner
        case 2: // .largeAd
            db = args[0] === 0 ? this.lowlyGeneric.id : this.lowlyGeneric.cl;
            bucket = db.complex.get(args[1]);
            if ( bucket === undefined ) {
                db.simple.add(args[1]);
            } else if ( Array.isArray(bucket) ) {
                bucket.push(db.prefix + args[1]);
            } else {
                db.complex.set(args[1], [ bucket, db.prefix + args[1] ]);
            }
            break;

        // low generic, complex
        case 1: // #tads + div + .c
        case 3: // .Mpopup + #Mad > #MadZone
            db = args[0] === 1 ? this.lowlyGeneric.id : this.lowlyGeneric.cl;
            bucket = db.complex.get(args[1]);
            if ( bucket === undefined ) {
                if ( db.simple.has(args[1]) ) {
                    db.complex.set(args[1], [ db.prefix + args[1], args[2] ]);
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

        // hash,  example.com, .promoted-tweet
        // hash,  example.*, .promoted-tweet
        case 8:
            this.specificFilters.store(args[1], args[2], args[3]);
            break;

        default:
            this.discardedCount += 1;
            break;
        }
    }
};

/******************************************************************************/

FilterContainer.prototype.skipGenericCompiledContent = function(reader) {
    // 1000 = cosmetic filtering
    reader.select(1000);

    while ( reader.next() ) {
        this.acceptedCount += 1;
        const fingerprint = reader.fingerprint();
        if ( this.duplicateBuster.has(fingerprint) ) {
            this.discardedCount += 1;
            continue;
        }

        const args = reader.args();

        switch ( args[0] ) {

        // hash,  example.com, .promoted-tweet
        // hash,  example.*, .promoted-tweet
        case 8:
            this.duplicateBuster.add(fingerprint);
            this.specificFilters.store(args[1], args[2], args[3]);
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
    return {
        acceptedCount: this.acceptedCount,
        discardedCount: this.discardedCount,
        specificFilters: this.specificFilters.toSelfie(),
        hasGenericHide: this.hasGenericHide,
        lowlyGenericSID: Array.from(this.lowlyGeneric.id.simple),
        lowlyGenericCID: Array.from(this.lowlyGeneric.id.complex),
        lowlyGenericSCL: Array.from(this.lowlyGeneric.cl.simple),
        lowlyGenericCCL: Array.from(this.lowlyGeneric.cl.complex),
        highSimpleGenericHideArray: Array.from(this.highlyGeneric.simple.dict),
        highComplexGenericHideArray: Array.from(this.highlyGeneric.complex.dict),
    };
};

/******************************************************************************/

FilterContainer.prototype.fromSelfie = function(selfie) {
    this.acceptedCount = selfie.acceptedCount;
    this.discardedCount = selfie.discardedCount;
    this.specificFilters.fromSelfie(selfie.specificFilters);
    this.hasGenericHide = selfie.hasGenericHide;
    this.lowlyGeneric.id.simple = new Set(selfie.lowlyGenericSID);
    this.lowlyGeneric.id.complex = new Map(selfie.lowlyGenericCID);
    this.lowlyGeneric.cl.simple = new Set(selfie.lowlyGenericSCL);
    this.lowlyGeneric.cl.complex = new Map(selfie.lowlyGenericCCL);
    this.highlyGeneric.simple.dict = new Set(selfie.highSimpleGenericHideArray);
    this.highlyGeneric.simple.str = selfie.highSimpleGenericHideArray.join(',\n');
    this.highlyGeneric.complex.dict = new Set(selfie.highComplexGenericHideArray);
    this.highlyGeneric.complex.str = selfie.highComplexGenericHideArray.join(',\n');
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
    let hostname = details.hostname;
    if ( typeof hostname !== 'string' || hostname === '' ) { return; }
    let selectors = details.selectors;
    if ( Array.isArray(selectors) === false ) { return; }
    let entry = this.selectorCache.get(hostname);
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
    targetHostname = '*',
    type = undefined
) {
    let targetHostnameLength = targetHostname.length;
    for ( let entry of this.selectorCache ) {
        let hostname = entry[0];
        let item = entry[1];
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
    let entry = this.selectorCache.get(hostname);
    if ( entry !== undefined ) {
        entry.retrieve(type, out);
    }
};

/******************************************************************************/

FilterContainer.prototype.pruneSelectorCacheAsync = function() {
    this.selectorCacheTimer = null;
    if ( this.selectorCache.size <= this.selectorCacheCountMin ) { return; }
    let cache = this.selectorCache;
    // Sorted from most-recently-used to least-recently-used, because
    //   we loop beginning at the end below.
    // We can't avoid sorting because we have to keep a minimum number of
    //   entries, and these entries should always be the most-recently-used.
    let hostnames = Array.from(cache.keys())
            .sort(function(a, b) {
                return cache.get(b).lastAccessTime -
                       cache.get(a).lastAccessTime;
                })
            .slice(this.selectorCacheCountMin);
    let obsolete = Date.now() - this.selectorCacheAgeMax,
        i = hostnames.length;
    while ( i-- ) {
        let hostname = hostnames[i];
        let entry = cache.get(hostname);
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
    const now = Date.now();
    return String.fromCharCode(now % 26 + 97) +
           Math.floor((1 + Math.random()) * now).toString(36);
};

/******************************************************************************/

FilterContainer.prototype.getSession = function() {
    return this.sessionFilterDB;
};

/******************************************************************************/

FilterContainer.prototype.retrieveGenericSelectors = function(request) {
    if ( this.acceptedCount === 0 ) { return; }
    if ( !request.ids && !request.classes ) { return; }

    //console.time('cosmeticFilteringEngine.retrieveGenericSelectors');

    const simpleSelectors = this.$simpleSet;
    const complexSelectors = this.$complexSet;

    const cacheEntry = this.selectorCache.get(request.hostname);
    const previousHits = cacheEntry && cacheEntry.cosmetic || this.$dummySet;

    for ( const type in this.lowlyGeneric ) {
        const entry = this.lowlyGeneric[type];
        const selectors = request[entry.canonical];
        if ( Array.isArray(selectors) === false ) { continue; }
        for ( let selector of selectors ) {
            if ( entry.simple.has(selector) === false ) { continue; }
            const bucket = entry.complex.get(selector);
            if ( bucket !== undefined ) {
                if ( Array.isArray(bucket) ) {
                    for ( const selector of bucket ) {
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
        }
    }

    // Apply exceptions: it is the responsibility of the caller to provide
    // the exceptions to be applied.
    const excepted = [];
    if ( Array.isArray(request.exceptions) ) {
        for ( const exception of request.exceptions ) {
            if (
                simpleSelectors.delete(exception) ||
                complexSelectors.delete(exception)
            ) {
                excepted.push(exception);
            }
        }
    }

    if (
        simpleSelectors.size === 0 &&
        complexSelectors.size === 0 &&
        excepted.length === 0
    ) {
        return;
    }

    const out = {
        simple: Array.from(simpleSelectors),
        complex: Array.from(complexSelectors),
        injected: '',
        excepted,
    };

    // Important: always clear used registers before leaving.
    simpleSelectors.clear();
    complexSelectors.clear();

    // Cache and inject (if user stylesheets supported) looked-up low generic
    // cosmetic filters.
    if (
        (typeof request.hostname === 'string' && request.hostname !== '') &&
        (out.simple.length !== 0 || out.complex.length !== 0)
    ) {
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
        supportsUserStylesheets &&
        request.tabId !== undefined &&
        request.frameId !== undefined
    ) {
        const injected = [];
        if ( out.simple.length !== 0 ) {
            injected.push(out.simple.join(',\n'));
            out.simple = [];
        }
        if ( out.complex.length !== 0 ) {
            injected.push(out.complex.join(',\n'));
            out.complex = [];
        }
        out.injected = injected.join(',\n');
        vAPI.tabs.insertCSS(request.tabId, {
            code: out.injected + '\n{display:none!important;}',
            cssOrigin: 'user',
            frameId: request.frameId,
            runAt: 'document_start'
        });
    }

    //console.timeEnd('cosmeticFilteringEngine.retrieveGenericSelectors');

    return out;
};

/******************************************************************************/

FilterContainer.prototype.retrieveSpecificSelectors = function(
    request,
    options
) {
    const hostname = request.hostname;
    const cacheEntry = this.selectorCache.get(hostname);

    // https://github.com/chrisaljoudi/uBlock/issues/587
    // out.ready will tell the content script the cosmetic filtering engine is
    // up and ready.

    // https://github.com/chrisaljoudi/uBlock/issues/497
    // Generic exception filters are to be applied on all pages.

    const out = {
        ready: this.frozen,
        hostname: hostname,
        domain: request.domain,
        declarativeFilters: [],
        exceptionFilters: [],
        exceptedFilters: [],
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
        const specificSet = this.$specificSet;
        const proceduralSet = this.$proceduralSet;
        const exceptionSet = this.$exceptionSet;
        const dummySet = this.$dummySet;

        // Cached cosmetic filters: these are always declarative.
        if ( cacheEntry !== undefined ) {
            cacheEntry.retrieve('cosmetic', specificSet);
            if ( out.noDOMSurveying === false ) {
                out.noDOMSurveying = cacheEntry.cosmeticSurveyingMissCount >
                                   cosmeticSurveyingMissCountMax;
            }
        }

        // Retrieve temporary filters
        if ( this.sessionFilterDB.isNotEmpty ) {
            this.sessionFilterDB.retrieve([ null, exceptionSet ]);
        }

        // Retrieve filters with a non-empty hostname
        this.specificFilters.retrieve(
            hostname,
            options.noSpecificCosmeticFiltering !== true
                ? [ specificSet, exceptionSet, proceduralSet, exceptionSet ]
                : [ dummySet, exceptionSet ],
            1
        );
        // Retrieve filters with an empty hostname
        this.specificFilters.retrieve(
            hostname,
            options.noGenericCosmeticFiltering !== true
                ? [ specificSet, exceptionSet, proceduralSet, exceptionSet ]
                : [ dummySet, exceptionSet ],
            2
        );
        // Retrieve filters with a non-empty entity
        if ( request.entity !== '' ) {
            this.specificFilters.retrieve(
                `${hostname.slice(0, -request.domain.length)}${request.entity}`,
                options.noSpecificCosmeticFiltering !== true
                    ? [ specificSet, exceptionSet, proceduralSet, exceptionSet ]
                    : [ dummySet, exceptionSet ],
                1
            );
        }

        if ( exceptionSet.size !== 0 ) {
            out.exceptionFilters = Array.from(exceptionSet);
            for ( const exception of exceptionSet ) {
                if (
                    specificSet.delete(exception) ||
                    proceduralSet.delete(exception)
                ) {
                    out.exceptedFilters.push(exception);
                }
                
            }
        }

        if ( specificSet.size !== 0 ) {
            out.declarativeFilters = Array.from(specificSet);
        }
        if ( proceduralSet.size !== 0 ) {
            out.proceduralFilters = Array.from(proceduralSet);
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
            const exceptionHash = out.exceptionFilters.join();
            for ( const type in this.highlyGeneric ) {
                const entry = this.highlyGeneric[type];
                let str = entry.mru.lookup(exceptionHash);
                if ( str === undefined ) {
                    str = { s: entry.str, excepted: [] };
                    let genericSet = entry.dict;
                    let hit = false;
                    for ( const exception of exceptionSet ) {
                        if ( (hit = genericSet.has(exception)) ) { break; }
                    }
                    if ( hit ) {
                        genericSet = new Set(entry.dict);
                        for ( const exception of exceptionSet ) {
                            if ( genericSet.delete(exception) ) {
                                str.excepted.push(exception);
                            }
                        }
                        str.s = Array.from(genericSet).join(',\n');
                    }
                    entry.mru.add(exceptionHash, str);
                }
                out[entry.canonical] = str.s;
                if ( str.excepted.length !== 0 ) {
                    out.exceptedFilters.push(...str.excepted);
                }

            }
        }

        // Important: always clear used registers before leaving.
        specificSet.clear();
        proceduralSet.clear();
        exceptionSet.clear();
        dummySet.clear();
    }

    // CSS selectors for collapsible blocked elements
    if ( cacheEntry ) {
        const networkFilters = [];
        cacheEntry.retrieve('net', networkFilters);
        out.networkFilters = networkFilters.join(',\n');
    }

    // https://github.com/gorhill/uBlock/issues/3160
    //   If user stylesheets are supported in the current process, inject the
    //   cosmetic filters now.
    if (
        supportsUserStylesheets &&
        request.tabId !== undefined &&
        request.frameId !== undefined
    ) {
        const injectedHideFilters = [];
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
        const details = {
            code: '',
            cssOrigin: 'user',
            frameId: request.frameId,
            runAt: 'document_start'
        };
        if ( out.injectedHideFilters.length !== 0 ) {
            details.code = out.injectedHideFilters + '\n{display:none!important;}';
            vAPI.tabs.insertCSS(request.tabId, details);
        }
        if ( out.networkFilters.length !== 0 ) {
            details.code = out.networkFilters + '\n{display:none!important;}';
            vAPI.tabs.insertCSS(request.tabId, details);
            out.networkFilters = '';
        }
    }

    return out;
};

/******************************************************************************/

FilterContainer.prototype.getFilterCount = function() {
    return this.acceptedCount - this.discardedCount;
};

/******************************************************************************/

FilterContainer.prototype.benchmark = async function() {
    const requests = await µb.loadBenchmarkDataset();
    if ( Array.isArray(requests) === false || requests.length === 0 ) {
        console.info('No requests found to benchmark');
        return;
    }
    console.info('Benchmarking cosmeticFilteringEngine.retrieveSpecificSelectors()...');
    const details = {
        tabId: undefined,
        frameId: undefined,
        hostname: '',
        domain: '',
        entity: '',
    };
    const options = {
        noCosmeticFiltering: false,
        noGenericCosmeticFiltering: false,
    };
    let count = 0;
    const t0 = self.performance.now();
    for ( let i = 0; i < requests.length; i++ ) {
        const request = requests[i];
        if ( request.cpt !== 'document' ) { continue; }
        count += 1;
        details.hostname = µb.URI.hostnameFromURI(request.url);
        details.domain = µb.URI.domainFromHostname(details.hostname);
        details.entity = µb.URI.entityFromDomain(details.domain);
        void this.retrieveSpecificSelectors(details, options);
    }
    const t1 = self.performance.now();
    const dur = t1 - t0;
    console.info(`Evaluated ${count} requests in ${dur.toFixed(0)} ms`);
    console.info(`\tAverage: ${(dur / count).toFixed(3)} ms per request`);
};

/******************************************************************************/

return new FilterContainer();

/******************************************************************************/

})();

/******************************************************************************/

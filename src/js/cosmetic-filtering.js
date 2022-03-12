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

import './utils.js';
import logger from './logger.js';
import µb from './background.js';

import {
    StaticExtFilteringHostnameDB,
    StaticExtFilteringSessionDB,
} from './static-ext-filtering-db.js';

/******************************************************************************/

const cosmeticSurveyingMissCountMax =
    parseInt(vAPI.localStorage.getItem('cosmeticSurveyingMissCountMax'), 10) ||
    15;

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
//    Specific hostname
//    Specific entity
// Generic filters can only be enforced once the main document is loaded.
// Specific filers can be enforced before the main document is loaded.

const FilterContainer = function() {
    this.reHasUnicode = /[^\x00-\x7F]/;
    this.rePlainSelector = /^[#.][\w\\-]+/;
    this.rePlainSelectorEscaped = /^[#.](?:\\[0-9A-Fa-f]+ |\\.|\w|-)+/;
    this.rePlainSelectorEx = /^[^#.\[(]+([#.][\w-]+)|([#.][\w-]+)$/;
    this.reEscapeSequence = /\\([0-9A-Fa-f]+ |.)/g;
    this.reSimpleHighGeneric = /^(?:[a-z]*\[[^\]]+\]|\S+)$/;
    this.reHighMedium = /^\[href\^="https?:\/\/([^"]{8})[^"]*"\]$/;

    this.selectorCache = new Map();
    this.selectorCachePruneDelay = 10 * 60 * 1000; // 10 minutes
    this.selectorCacheAgeMax = 120 * 60 * 1000; // 120 minutes
    this.selectorCacheCountMin = 25;
    this.netSelectorCacheCountMax = SelectorCacheEntry.netHighWaterMark;
    this.selectorCacheTimer = null;

    // specific filters
    this.specificFilters = new StaticExtFilteringHostnameDB(2);

    // temporary filters
    this.sessionFilterDB = new StaticExtFilteringSessionDB();

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
    this.frozen = false;
    this.acceptedCount = 0;
    this.discardedCount = 0;
    this.duplicateBuster = new Set();

    this.selectorCache.clear();
    if ( this.selectorCacheTimer !== null ) {
        clearTimeout(this.selectorCacheTimer);
        this.selectorCacheTimer = null;
    }

    // whether there is at least one surveyor-based filter
    this.needDOMSurveyor = false;

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

    this.needDOMSurveyor =
        this.lowlyGeneric.id.simple.size !== 0 ||
        this.lowlyGeneric.id.complex.size !== 0 ||
        this.lowlyGeneric.cl.simple.size !== 0 ||
        this.lowlyGeneric.cl.complex.size !== 0;

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
    const escaped = matches[0];
    let beg = 0;
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

FilterContainer.prototype.compile = function(parser, writer) {
    if ( parser.hasOptions() === false ) {
        this.compileGenericSelector(parser, writer);
        return true;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/151
    //   Negated hostname means the filter applies to all non-negated hostnames
    //   of same filter OR globally if there is no non-negated hostnames.
    let applyGlobally = true;
    for ( const { hn, not, bad } of parser.extOptions() ) {
        if ( bad ) { continue; }
        if ( not === false ) {
            applyGlobally = false;
        }
        this.compileSpecificSelector(parser, hn, not, writer);
    }
    if ( applyGlobally ) {
        this.compileGenericSelector(parser, writer);
    }

    return true;
};

/******************************************************************************/

FilterContainer.prototype.compileGenericSelector = function(parser, writer) {
    if ( parser.isException() ) {
        this.compileGenericUnhideSelector(parser, writer);
    } else {
        this.compileGenericHideSelector(parser, writer);
    }
};

/******************************************************************************/

FilterContainer.prototype.compileGenericHideSelector = function(
    parser,
    writer
) {
    const { raw, compiled } = parser.result;
    if ( compiled === undefined ) {
        const who = writer.properties.get('name') || '?';
        logger.writeOne({
            realm: 'message',
            type: 'error',
            text: `Invalid generic cosmetic filter in ${who}: ${raw}`
        });
        return;
    }

    writer.select('COSMETIC_FILTERS:GENERIC');

    const type = compiled.charCodeAt(0);
    let key;

    // Simple selector-based CSS rule: no need to test for whether the
    // selector is valid, the regex took care of this. Most generic selector
    // falls into that category:
    // - ###ad-bigbox
    // - ##.ads-bigbox
    if ( type === 0x23 /* '#' */ ) {
        key = this.keyFromSelector(compiled);
        if ( key === compiled ) {
            writer.push([ 0, key.slice(1) ]);
            return;
        }
    } else if ( type === 0x2E /* '.' */ ) {
        key = this.keyFromSelector(compiled);
        if ( key === compiled ) {
            writer.push([ 2, key.slice(1) ]);
            return;
        }
    }

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
    if ( compiled !== raw ) {
        if ( µb.hiddenSettings.allowGenericProceduralFilters === true ) {
            return this.compileSpecificSelector(parser, '', false, writer);
        }
        const who = writer.properties.get('name') || '?';
        logger.writeOne({
            realm: 'message',
            type: 'error',
            text: `Invalid generic cosmetic filter in ${who}: ##${raw}`
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
            compiled
        ]);
        return;
    }

    // https://github.com/gorhill/uBlock/issues/909
    //   Anything which contains a plain id/class selector can be classified
    //   as a low generic cosmetic filter.
    const matches = this.rePlainSelectorEx.exec(compiled);
    if ( matches !== null ) {
        const key = matches[1] || matches[2];
        writer.push([
            key.charCodeAt(0) === 0x23 /* '#' */ ? 1 : 3,
            key.slice(1),
            compiled
        ]);
        return;
    }

    // Pass this point, we are dealing with highly-generic cosmetic filters.
    //
    // For efficiency purpose, we will distinguish between simple and complex
    // selectors.

    if ( this.reSimpleHighGeneric.test(compiled) ) {
        writer.push([ 4 /* simple */, compiled ]);
    } else {
        writer.push([ 5 /* complex */, compiled ]);
    }
};

/******************************************************************************/

FilterContainer.prototype.compileGenericUnhideSelector = function(
    parser,
    writer
) {
    // Procedural cosmetic filters are acceptable as generic exception filters.
    const { raw, compiled } = parser.result;
    if ( compiled === undefined ) {
        const who = writer.properties.get('name') || '?';
        logger.writeOne({
            realm: 'message',
            type: 'error',
            text: `Invalid cosmetic filter in ${who}: #@#${raw}`
        });
        return;
    }

    writer.select('COSMETIC_FILTERS:SPECIFIC');

    // https://github.com/chrisaljoudi/uBlock/issues/497
    //   All generic exception filters are stored as hostname-based filter
    //   whereas the hostname is the empty string (which matches all
    //   hostnames). No distinction is made between declarative and
    //   procedural selectors, since they really exist only to cancel
    //   out other cosmetic filters.
    writer.push([ 8, '', 0b001, compiled ]);
};

/******************************************************************************/

FilterContainer.prototype.compileSpecificSelector = function(
    parser,
    hostname,
    not,
    writer
) {
    const { raw, compiled, exception } = parser.result;
    if ( compiled === undefined ) {
        const who = writer.properties.get('name') || '?';
        logger.writeOne({
            realm: 'message',
            type: 'error',
            text: `Invalid cosmetic filter in ${who}: ##${raw}`
        });
        return;
    }

    writer.select('COSMETIC_FILTERS:SPECIFIC');

    // https://github.com/chrisaljoudi/uBlock/issues/145
    let unhide = exception ? 1 : 0;
    if ( not ) { unhide ^= 1; }

    let kind = 0;
    if ( unhide === 1 ) {
        kind |= 0b001;     // Exception
    }
    if ( compiled.charCodeAt(0) === 0x7B /* '{' */ ) {
        kind |= 0b010;     // Procedural
    }
    if ( hostname === '*' ) {
        kind |= 0b100;     // Applies everywhere
    }

    writer.push([ 8, hostname, kind, compiled ]);
};

/******************************************************************************/

FilterContainer.prototype.compileTemporary = function(parser) {
    return {
        session: this.sessionFilterDB,
        selector: parser.result.compiled,
    };
};

/******************************************************************************/

FilterContainer.prototype.fromCompiledContent = function(reader, options) {
    if ( options.skipCosmetic ) {
        this.skipCompiledContent(reader, 'SPECIFIC');
        this.skipCompiledContent(reader, 'GENERIC');
        return;
    }

    // Specific cosmetic filter section
    reader.select('COSMETIC_FILTERS:SPECIFIC');
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
        // hash,  example.com, .promoted-tweet
        // hash,  example.*, .promoted-tweet
        //
        // https://github.com/uBlockOrigin/uBlock-issues/issues/803
        //   Handle specific filters meant to apply everywhere, i.e. selectors
        //   not to be injected conditionally through the DOM surveyor.
        //   hash,  *, .promoted-tweet
        case 8:
            if ( args[2] === 0b100 ) {
                if ( this.reSimpleHighGeneric.test(args[3]) )
                    this.highlyGeneric.simple.dict.add(args[3]);
                else {
                    this.highlyGeneric.complex.dict.add(args[3]);
                }
                break;
            }
            this.specificFilters.store(args[1], args[2] & 0b011, args[3]);
            break;
        default:
            this.discardedCount += 1;
            break;
        }
    }

    if ( options.skipGenericCosmetic ) {
        this.skipCompiledContent(reader, 'GENERIC');
        return;
    }

    // Generic cosmetic filter section
    reader.select('COSMETIC_FILTERS:GENERIC');
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
        case 0:   // #AdBanner
        case 2: { // .largeAd
            const db = args[0] === 0 ? this.lowlyGeneric.id : this.lowlyGeneric.cl;
            const bucket = db.complex.get(args[1]);
            if ( bucket === undefined ) {
                db.simple.add(args[1]);
            } else if ( Array.isArray(bucket) ) {
                bucket.push(db.prefix + args[1]);
            } else {
                db.complex.set(args[1], [ bucket, db.prefix + args[1] ]);
            }
            break;
        }
        // low generic, complex
        case 1:   // #tads + div + .c
        case 3: { // .Mpopup + #Mad > #MadZone
            const db = args[0] === 1 ? this.lowlyGeneric.id : this.lowlyGeneric.cl;
            const bucket = db.complex.get(args[1]);
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
        }
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
        default:
            this.discardedCount += 1;
            break;
        }
    }
};

/******************************************************************************/

FilterContainer.prototype.skipCompiledContent = function(reader, sectionId) {
    reader.select(`COSMETIC_FILTERS:${sectionId}`);
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
    this.lowlyGeneric.id.simple = new Set(selfie.lowlyGenericSID);
    this.lowlyGeneric.id.complex = new Map(selfie.lowlyGenericCID);
    this.lowlyGeneric.cl.simple = new Set(selfie.lowlyGenericSCL);
    this.lowlyGeneric.cl.complex = new Map(selfie.lowlyGenericCCL);
    this.highlyGeneric.simple.dict = new Set(selfie.highSimpleGenericHideArray);
    this.highlyGeneric.simple.str = selfie.highSimpleGenericHideArray.join(',\n');
    this.highlyGeneric.complex.dict = new Set(selfie.highComplexGenericHideArray);
    this.highlyGeneric.complex.str = selfie.highComplexGenericHideArray.join(',\n');
    this.needDOMSurveyor =
        selfie.lowlyGenericSID.length !== 0 ||
        selfie.lowlyGenericCID.length !== 0 ||
        selfie.lowlyGenericSCL.length !== 0 ||
        selfie.lowlyGenericCCL.length !== 0;
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
    const hostname = details.hostname;
    if ( typeof hostname !== 'string' || hostname === '' ) { return; }
    const selectors = details.selectors;
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

FilterContainer.prototype.getSession = function() {
    return this.sessionFilterDB;
};

/******************************************************************************/

FilterContainer.prototype.retrieveGenericSelectors = function(request) {
    if ( this.acceptedCount === 0 ) { return; }
    if ( !request.ids && !request.classes ) { return; }

    const { safeOnly = false } = request;
    //console.time('cosmeticFilteringEngine.retrieveGenericSelectors');

    const simpleSelectors = this.$simpleSet;
    const complexSelectors = this.$complexSet;

    const cacheEntry = this.selectorCache.get(request.hostname);
    const previousHits = cacheEntry && cacheEntry.cosmetic || this.$dummySet;

    for ( const type in this.lowlyGeneric ) {
        const entry = this.lowlyGeneric[type];
        const selectors = request[entry.canonical];
        if ( Array.isArray(selectors) === false ) { continue; }
        for ( const identifier of selectors ) {
            if ( entry.simple.has(identifier) === false ) { continue; }
            const bucket = entry.complex.get(identifier);
            if ( typeof bucket === 'string' ) {
                if ( previousHits.has(bucket) ) { continue; }
                complexSelectors.add(bucket);
                continue;
            }
            const simpleSelector = entry.prefix + identifier;
            if ( Array.isArray(bucket) ) {
                for ( const complexSelector of bucket ) {
                    if ( previousHits.has(complexSelector) ) { continue; }
                    if ( safeOnly && complexSelector === simpleSelector ) { continue; }
                    complexSelectors.add(complexSelector);
                }
                continue;
            }
            if ( previousHits.has(simpleSelector) ) { continue; }
            if ( safeOnly ) { continue; }
            simpleSelectors.add(simpleSelector);
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

    const out = { injectedCSS: '', excepted, };

    const injected = [];
    if ( simpleSelectors.size !== 0 ) {
        injected.push(...simpleSelectors);
        simpleSelectors.clear();
    }
    if ( complexSelectors.size !== 0 ) {
        injected.push(...complexSelectors);
        complexSelectors.clear();
    }

    // Cache and inject looked-up low generic cosmetic filters.
    if ( injected.length === 0 ) { return out; }

    if ( typeof request.hostname === 'string' && request.hostname !== '' ) {
        this.addToSelectorCache({
            cost: request.surveyCost || 0,
            hostname: request.hostname,
            selectors: injected,
            type: 'cosmetic',
        });
    }

    out.injectedCSS = `${injected.join(',\n')}\n{display:none!important;}`;
    vAPI.tabs.insertCSS(request.tabId, {
        code: out.injectedCSS,
        frameId: request.frameId,
        matchAboutBlank: true,
        runAt: 'document_start',
    });

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
        exceptionFilters: [],
        exceptedFilters: [],
        noDOMSurveying: this.needDOMSurveyor === false,
    };
    const injectedCSS = [];

    if (
        options.noSpecificCosmeticFiltering !== true ||
        options.noGenericCosmeticFiltering !== true
    ) {
        const injectedHideFilters = [];
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
            injectedHideFilters.push(Array.from(specificSet).join(',\n'));
        }

        // Some procedural filters are really declarative cosmetic filters, so
        // we extract and inject them immediately.
        if ( proceduralSet.size !== 0 ) {
            for ( const json of proceduralSet ) {
                const pfilter = JSON.parse(json);
                if ( pfilter.tasks === undefined ) {
                    const { action } = pfilter;
                    if ( action !== undefined && action[0] === ':style' ) {
                        injectedCSS.push(`${pfilter.selector}\n{${action[1]}}`);
                        proceduralSet.delete(json);
                        continue;
                    }
                }
            }
            if ( proceduralSet.size !== 0 ) {
                out.proceduralFilters = Array.from(proceduralSet);
            }
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
            const exceptionSetHash = out.exceptionFilters.join();
            for ( const key in this.highlyGeneric ) {
                const entry = this.highlyGeneric[key];
                let str = entry.mru.lookup(exceptionSetHash);
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
                    entry.mru.add(exceptionSetHash, str);
                }
                if ( str.excepted.length !== 0 ) {
                    out.exceptedFilters.push(...str.excepted);
                }
                if ( str.s.length !== 0 ) {
                    injectedHideFilters.push(str.s);
                }
            }
        }

        if ( injectedHideFilters.length !== 0 ) {
            injectedCSS.push(
                `${injectedHideFilters.join(',\n')}\n{display:none!important;}`
            );
        }

        // Important: always clear used registers before leaving.
        specificSet.clear();
        proceduralSet.clear();
        exceptionSet.clear();
        dummySet.clear();
    }

    const details = {
        code: '',
        frameId: request.frameId,
        matchAboutBlank: true,
        runAt: 'document_start',
    };

    // Inject all declarative-based filters as a single stylesheet.
    if ( injectedCSS.length !== 0 ) {
        out.injectedCSS = injectedCSS.join('\n\n');
        details.code = out.injectedCSS;
        if ( request.tabId !== undefined ) {
            vAPI.tabs.insertCSS(request.tabId, details);
        }
    }

    // CSS selectors for collapsible blocked elements
    if ( cacheEntry ) {
        const networkFilters = [];
        cacheEntry.retrieve('net', networkFilters);
        if ( networkFilters.length !== 0 ) {
            details.code = networkFilters.join('\n') + '\n{display:none!important;}';
            if ( request.tabId !== undefined ) {
                vAPI.tabs.insertCSS(request.tabId, details);
            }
        }
    }

    return out;
};

/******************************************************************************/

FilterContainer.prototype.getFilterCount = function() {
    return this.acceptedCount - this.discardedCount;
};

/******************************************************************************/

FilterContainer.prototype.dump = function() {
    let genericCount = 0;
    for ( const i of [ 'simple', 'complex' ] ) {
        for ( const j of [ 'id', 'cl' ] ) {
            genericCount += this.lowlyGeneric[j][i].size;
        }
    }
    return [
        'Cosmetic Filtering Engine internals:',
        `specific: ${this.specificFilters.size}`,
        `generic: ${genericCount}`,
        `+ lowly.id: ${this.lowlyGeneric.id.simple.size + this.lowlyGeneric.id.complex.size}`,
        `  + simple: ${this.lowlyGeneric.id.simple.size}`,
        ...Array.from(this.lowlyGeneric.id.simple).map(a => `    ###${a}`),
        `  + complex: ${this.lowlyGeneric.id.complex.size}`,
        ...Array.from(this.lowlyGeneric.id.complex.values()).map(a => `    ##${a}`),
        `+ lowly.class: ${this.lowlyGeneric.cl.simple.size + this.lowlyGeneric.cl.complex.size}`,
        `  + simple: ${this.lowlyGeneric.cl.simple.size}`,
        ...Array.from(this.lowlyGeneric.cl.simple).map(a => `    ##.${a}`),
        `  + complex: ${this.lowlyGeneric.cl.complex.size}`,
        ...Array.from(this.lowlyGeneric.cl.complex.values()).map(a => `    ##${a}`),
        `+ highly: ${this.highlyGeneric.simple.dict.size + this.highlyGeneric.complex.dict.size}`,
        `  + highly.simple: ${this.highlyGeneric.simple.dict.size}`,
        ...Array.from(this.highlyGeneric.simple.dict).map(a => `    ##${a}`),
        `  + highly.complex: ${this.highlyGeneric.complex.dict.size}`,
        ...Array.from(this.highlyGeneric.complex.dict).map(a => `    ##${a}`),
    ].join('\n');
};

/******************************************************************************/

const cosmeticFilteringEngine = new FilterContainer();

export default cosmeticFilteringEngine;

/******************************************************************************/

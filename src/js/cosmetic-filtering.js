/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2018 Raymond Hill

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

let µb = µBlock;
let cosmeticSurveyingMissCountMax =
    parseInt(vAPI.localStorage.getItem('cosmeticSurveyingMissCountMax'), 10) ||
    15;

let supportsUserStylesheets = vAPI.webextFlavor.soup.has('user_stylesheet');
// https://www.reddit.com/r/uBlockOrigin/comments/8dkvqn/116_broken_loading_custom_filters_from_my_filters/
window.addEventListener('webextFlavor', function() {
    supportsUserStylesheets = vAPI.webextFlavor.soup.has('user_stylesheet');
}, { once: true });

/*******************************************************************************

    Each filter class will register itself in the map.

    IMPORTANT: any change which modifies the mapping will have to be
    reflected with µBlock.systemSettings.compiledMagic.

**/

let filterClasses = [];

let registerFilterClass = function(ctor) {
    filterClasses[ctor.prototype.fid] = ctor;
};

let filterFromCompiledData = function(args) {
    return filterClasses[args[0]].load(args);
};

/******************************************************************************/

// One hostname => one selector

let FilterOneOne = function(hostname, selector) {
    this.hostname = hostname;
    this.selector = selector;
};

FilterOneOne.prototype = {
    fid: 8,

    // Since this class can hold only one single selector, adding a new
    // hostname-selector requires to morph the filter instance into a
    // better-suited class.
    add: function(hostname, selector) {
        if ( hostname === this.hostname ) {
            return new FilterOneMany(
                this.hostname,
                [ this.selector, selector ]
            );
        }
        return new FilterManyAny([
            [ this.hostname, this.selector ],
            [ hostname, selector ]
        ]);
    },

    retrieve: function(target, out) {
        if ( target.endsWith(this.hostname) === false ) { return; }
        let i = target.length - this.hostname.length;
        if ( i !== 0 && target.charCodeAt(i-1) !== 0x2E /* '.' */ ) { return; }
        out.add(this.selector);
    },

    compile: function() {
        return [ this.fid, this.hostname, this.selector ];
    }
};

FilterOneOne.load = function(data) {
    return new FilterOneOne(data[1], data[2]);
};

registerFilterClass(FilterOneOne);

/******************************************************************************/

// One hostname => many selectors

let FilterOneMany = function(hostname, selectors) {
    this.hostname = hostname;
    this.selectors = selectors;
};

FilterOneMany.prototype = {
    fid: 9,

    // Since this class can hold selectors for only one specific hostname,
    // adding a new hostname will require to morph the filter instance into a
    // better-suited class.
    add: function(hostname, selector) {
        if ( hostname === this.hostname ) {
            this.selectors.push(selector);
            return this;
        }
        return new FilterManyAny([
            [ this.hostname, this.selectors ],
            [ hostname, selector ]
        ]);
    },

    retrieve: function(target, out) {
        if ( target.endsWith(this.hostname) === false ) { return; }
        let i = target.length - this.hostname.length;
        if ( i !== 0 && target.charCodeAt(i-1) !== 0x2E /* '.' */ ) { return; }
        for ( let selector of this.selectors ) {
            out.add(selector);
        }
    },

    compile: function() {
        return [ this.fid, this.hostname, this.selectors ];
    }
};

FilterOneMany.load = function(data) {
    return new FilterOneMany(data[1], data[2]);
};

registerFilterClass(FilterOneMany);

/******************************************************************************/

// Many hostnames => one or many selectors

let FilterManyAny = function(entries) {
    this.entries = new Map(entries);
};

FilterManyAny.prototype = {
    fid: 10,

    add: function(hostname, selector) {
        let selectors = this.entries.get(hostname);
        if ( selectors === undefined ) {
            this.entries.set(hostname, selector);
        } else if ( typeof selectors === 'string' ) {
            this.entries.set(hostname, [ selectors, selector ]);
        } else {
            selectors.push(selector);
        }
    },

    retrieve: function(target, out) {
        for ( let entry of this.entries ) {
            let hostname = entry[0];
            if ( target.endsWith(hostname) === false ) { continue; }
            let i = target.length - hostname.length;
            if ( i !== 0 && target.charCodeAt(i-1) !== 0x2E /* '.' */ ) {
                continue;
            }
            let selectors = entry[1];
            if ( typeof selectors === 'string' ) {
                out.add(selectors);
                continue;
            }
            for ( let selector of selectors ) {
                out.add(selector);
            }
        }
    },

    compile: function() {
        return [ this.fid, Array.from(this.entries) ];
    }
};

FilterManyAny.load = function(data) {
    return new FilterManyAny(data[1]);
};

registerFilterClass(FilterManyAny);

/******************************************************************************/
/******************************************************************************/

let SelectorCacheEntry = function() {
    this.reset();
};

/******************************************************************************/

SelectorCacheEntry.junkyard = [];

SelectorCacheEntry.factory = function() {
    let entry = SelectorCacheEntry.junkyard.pop();
    if ( entry ) {
        return entry.reset();
    }
    return new SelectorCacheEntry();
};

/******************************************************************************/

let netSelectorCacheLowWaterMark = 20;
let netSelectorCacheHighWaterMark = 30;

/******************************************************************************/

SelectorCacheEntry.prototype = {
    reset: function() {
        this.cosmetic = new Set();
        this.cosmeticSurveyingMissCount = 0;
        this.net = new Map();
        this.lastAccessTime = Date.now();
        return this;
    },

    dispose: function() {
        this.cosmetic = this.net = null;
        if ( SelectorCacheEntry.junkyard.length < 25 ) {
            SelectorCacheEntry.junkyard.push(this);
        }
    },

    addCosmetic: function(details) {
        let selectors = details.selectors,
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
    },

    addNet: function(selectors) {
        if ( typeof selectors === 'string' ) {
            this.addNetOne(selectors, Date.now());
        } else {
            this.addNetMany(selectors, Date.now());
        }
        // Net request-derived selectors: I limit the number of cached selectors,
        // as I expect cases where the blocked net-requests are never the
        // exact same URL.
        if ( this.net.size < netSelectorCacheHighWaterMark ) { return; }
        let dict = this.net;
        let keys = Array.from(dict.keys()).sort(function(a, b) {
            return dict.get(b) - dict.get(a);
        }).slice(netSelectorCacheLowWaterMark);
        let i = keys.length;
        while ( i-- ) {
            dict.delete(keys[i]);
        }
    },

    addNetOne: function(selector, now) {
        this.net.set(selector, now);
    },

    addNetMany: function(selectors, now) {
        let i = selectors.length || 0;
        while ( i-- ) {
            this.net.set(selectors[i], now);
        }
    },

    add: function(details) {
        this.lastAccessTime = Date.now();
        if ( details.type === 'cosmetic' ) {
            this.addCosmetic(details);
        } else {
            this.addNet(details.selectors);
        }
    },

    // https://github.com/chrisaljoudi/uBlock/issues/420
    remove: function(type) {
        this.lastAccessTime = Date.now();
        if ( type === undefined || type === 'cosmetic' ) {
            this.cosmetic.clear();
            this.cosmeticSurveyingMissCount = 0;
        }
        if ( type === undefined || type === 'net' ) {
            this.net.clear();
        }
    },

    retrieveToArray: function(iterator, out) {
        for ( let selector of iterator ) {
            out.push(selector);
        }
    },

    retrieveToSet: function(iterator, out) {
        for ( let selector of iterator ) {
            out.add(selector);
        }
    },

    retrieve: function(type, out) {
        this.lastAccessTime = Date.now();
        let iterator = type === 'cosmetic' ? this.cosmetic : this.net.keys();
        if ( Array.isArray(out) ) {
            this.retrieveToArray(iterator, out);
        } else {
            this.retrieveToSet(iterator, out);
        }
    }
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

let FilterContainer = function() {
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

    // generic exception filters
    this.genericDonthideSet = new Set();

    // TODO: Think about reusing µb.staticExtFilteringEngine.HostnameBasedDB
    //       for both specific and procedural filters. This would require some
    //       refactoring.
    // hostname, entity-based filters
    this.specificFilters = new Map();

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

    let hostnames = parsed.hostnames,
        i = hostnames.length;
    if ( i === 0 ) {
        this.compileGenericSelector(parsed, writer);
        return true;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/151
    // Negated hostname means the filter applies to all non-negated hostnames
    // of same filter OR globally if there is no non-negated hostnames.
    let applyGlobally = true;
    while ( i-- ) {
        let hostname = hostnames[i];
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

FilterContainer.prototype.compileGenericHideSelector = function(parsed, writer) {
    let selector = parsed.suffix;

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

    let type = selector.charCodeAt(0);

    if ( type === 0x23 /* '#' */ ) {
        let key = this.keyFromSelector(selector);
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
        let key = this.keyFromSelector(selector);
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

    let compiled = µb.staticExtFilteringEngine.compileSelector(selector);
    if ( compiled === undefined ) { return; }
    // TODO: Detect and error on procedural cosmetic filters.

    // https://github.com/gorhill/uBlock/issues/909
    //   Anything which contains a plain id/class selector can be classified
    //   as a low generic cosmetic filter.
    let matches = this.rePlainSelectorEx.exec(selector);
    if ( matches !== null ) {
        let key = matches[1] || matches[2];
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
    let compiled = µb.staticExtFilteringEngine.compileSelector(parsed.suffix);
    if ( compiled === undefined ) { return; }

    // https://github.com/chrisaljoudi/uBlock/issues/497
    //   All generic exception filters are put in the same bucket: they are
    //   expected to be very rare.
    writer.push([ 7 /* g1 */, compiled ]);
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

    let compiled = µb.staticExtFilteringEngine.compileSelector(parsed.suffix);
    if ( compiled === undefined ) { return; }

    let hash = µb.staticExtFilteringEngine.compileHostnameToHash(hostname);

    // Exception?
    if ( unhide === 1 ) {
        hash |= 0b0001;
    }

    // Procedural?
    if ( compiled.charCodeAt(0) === 0x7B ) {
        hash |= 0b0010;
    }

    writer.push([ 8, hash, hostname, compiled ]);
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
        let fingerprint = reader.fingerprint();
        if ( this.duplicateBuster.has(fingerprint) ) {
            this.discardedCount += 1;
            continue;
        }
        this.duplicateBuster.add(fingerprint);

        let args = reader.args();

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

        // hash,  example.com, .promoted-tweet
        // hash,  example.*, .promoted-tweet
        case 8:
            bucket = this.specificFilters.get(args[1]);
            if ( bucket === undefined ) {
                this.specificFilters.set(
                    args[1],
                    new FilterOneOne(args[2], args[3])
                );
            } else if ( bucket instanceof FilterManyAny ) {
                bucket.add(args[2], args[3]);
            } else /* can morph, so we need to replace entry in map */ {
                this.specificFilters.set(
                    args[1],
                    bucket.add(args[2], args[3])
                );
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
    // 1000 = cosmetic filtering
    reader.select(1000);

    let bucket;

    while ( reader.next() ) {
        this.acceptedCount += 1;
        let fingerprint = reader.fingerprint();
        if ( this.duplicateBuster.has(fingerprint) ) {
            this.discardedCount += 1;
            continue;
        }

        let args = reader.args();

        switch ( args[0] ) {

        // https://github.com/chrisaljoudi/uBlock/issues/497
        // Generic exception filters: expected to be a rare occurrence.
        case 7:
            this.duplicateBuster.add(fingerprint);
            this.genericDonthideSet.add(args[1]);
            break;

        // hash,  example.com, .promoted-tweet
        // hash,  example.*, .promoted-tweet
        case 8:
            bucket = this.specificFilters.get(args[1]);
            if ( bucket === undefined ) {
                this.specificFilters.set(
                    args[1],
                    new FilterOneOne(args[2], args[3])
                );
            } else if ( bucket instanceof FilterManyAny ) {
                bucket.add(args[2], args[3]);
            } else /* can morph, so we need to replace entry in map */ {
                this.specificFilters.set(
                    args[1],
                    bucket.add(args[2], args[3])
                );
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
    let selfieFromMap = function(map) {
        let entries = [];
        for ( let entry of map ) {
            entries.push([ entry[0], entry[1].compile() ]);
        }
        return entries;
    };

    return {
        acceptedCount: this.acceptedCount,
        discardedCount: this.discardedCount,
        specificFilters: selfieFromMap(this.specificFilters),
        hasGenericHide: this.hasGenericHide,
        lowlyGenericSID: Array.from(this.lowlyGeneric.id.simple),
        lowlyGenericCID: Array.from(this.lowlyGeneric.id.complex),
        lowlyGenericSCL: Array.from(this.lowlyGeneric.cl.simple),
        lowlyGenericCCL: Array.from(this.lowlyGeneric.cl.complex),
        highSimpleGenericHideArray: Array.from(this.highlyGeneric.simple.dict),
        highComplexGenericHideArray: Array.from(this.highlyGeneric.complex.dict),
        genericDonthideArray: Array.from(this.genericDonthideSet)
    };
};

/******************************************************************************/

FilterContainer.prototype.fromSelfie = function(selfie) {
    let mapFromSelfie = function(entries) {
        let out = new Map();
        for ( let entry of entries ) {
            out.set(entry[0], filterFromCompiledData(entry[1]));
        }
        return out;
    };

    this.acceptedCount = selfie.acceptedCount;
    this.discardedCount = selfie.discardedCount;
    this.specificFilters = mapFromSelfie(selfie.specificFilters);
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
    targetHostname,
    type
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
    return String.fromCharCode(Date.now() % 26 + 97) +
           Math.floor(Math.random() * 982451653 + 982451653).toString(36);
};

/******************************************************************************/

FilterContainer.prototype.retrieveGenericSelectors = function(request) {
    if ( this.acceptedCount === 0 ) { return; }
    if ( !request.ids && !request.classes ) { return; }

    //console.time('cosmeticFilteringEngine.retrieveGenericSelectors');

    let simpleSelectors = this.setRegister0,
        complexSelectors = this.setRegister1;

    let cacheEntry = this.selectorCache.get(request.hostname),
        previousHits = cacheEntry && cacheEntry.cosmetic || this.setRegister2;

    for ( let type in this.lowlyGeneric ) {
        let entry = this.lowlyGeneric[type];
        let selectors = request[entry.canonical];
        if ( typeof selectors !== 'string' ) { continue; }
        let strEnd = selectors.length;
        let sliceBeg = 0;
        do {
            let sliceEnd = selectors.indexOf('\n', sliceBeg);
            if ( sliceEnd === -1 ) { sliceEnd = strEnd; }
            let selector = selectors.slice(sliceBeg, sliceEnd);
            sliceBeg = sliceEnd + 1;
            if ( entry.simple.has(selector) === false ) { continue; }
            let bucket = entry.complex.get(selector);
            if ( bucket !== undefined ) {
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
        for ( let exception of request.exceptions ) {
            simpleSelectors.delete(exception);
            complexSelectors.delete(exception);
        }
    }

    if ( simpleSelectors.size === 0 && complexSelectors.size === 0 ) {
        return;
    }

    let out = {
        simple: Array.from(simpleSelectors),
        complex: Array.from(complexSelectors),
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
        supportsUserStylesheets &&
        request.tabId !== undefined &&
        request.frameId !== undefined
    ) {
        let injected = [];
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

FilterContainer.prototype.retrieveSpecificSelectors = function(
    request,
    options
) {
    //console.time('cosmeticFilteringEngine.retrieveSpecificSelectors');

    let hostname = request.hostname,
        cacheEntry = this.selectorCache.get(hostname);

    // https://github.com/chrisaljoudi/uBlock/issues/587
    // out.ready will tell the content script the cosmetic filtering engine is
    // up and ready.

    // https://github.com/chrisaljoudi/uBlock/issues/497
    // Generic exception filters are to be applied on all pages.

    let out = {
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
        let entity = request.entity,
            domainHash = µb.staticExtFilteringEngine.makeHash(request.domain),
            entityHash = µb.staticExtFilteringEngine.makeHash(entity),
            bucket;

        // Exception cosmetic filters: prime with generic exception filters.
        let exceptionSet = this.setRegister0;
        // Genetic exceptions (should be extremely rare).
        for ( let exception of this.genericDonthideSet ) {
            exceptionSet.add(exception);
        }
        // Specific exception cosmetic filters.
        if ( domainHash !== 0 ) {
            bucket = this.specificFilters.get(domainHash | 0b0001);
            if ( bucket !== undefined ) {
                bucket.retrieve(hostname, exceptionSet);
            }
            bucket = this.specificFilters.get(domainHash | 0b0011);
            if ( bucket !== undefined ) {
                bucket.retrieve(hostname, exceptionSet);
            }
        }
        // Specific entity-based exception cosmetic filters.
        if ( entityHash !== 0 ) {
            bucket = this.specificFilters.get(entityHash | 0b0001);
            if ( bucket !== undefined ) {
                bucket.retrieve(entity, exceptionSet);
            }
            bucket = this.specificFilters.get(entityHash | 0b0011);
            if ( bucket !== undefined ) {
                bucket.retrieve(entity, exceptionSet);
            }
        }
        // Special bucket for those filters without a valid
        // domain name as per PSL.
        bucket = this.specificFilters.get(0 | 0b0001);
        if ( bucket !== undefined ) {
            bucket.retrieve(hostname, exceptionSet);
        }
        bucket = this.specificFilters.get(0 | 0b0011);
        if ( bucket !== undefined ) {
            bucket.retrieve(hostname, exceptionSet);
        }
        if ( exceptionSet.size !== 0 ) {
            out.exceptionFilters = Array.from(exceptionSet);
        }

        // Declarative cosmetic filters.
        // TODO: Should I go one step further and store specific simple and
        //       specific complex in different collections? This could simplify
        //       slightly content script code.
        let specificSet = this.setRegister1;
        // Specific cosmetic filters.
        if ( domainHash !== 0 ) {
            bucket = this.specificFilters.get(domainHash | 0b0000);
            if ( bucket !== undefined ) {
                bucket.retrieve(hostname, specificSet);
            }
        }
        // Specific entity-based cosmetic filters.
        if ( entityHash !== 0 ) {
            bucket = this.specificFilters.get(entityHash | 0b0000);
            if ( bucket !== undefined ) {
                bucket.retrieve(entity, specificSet);
            }
        }
        // https://github.com/chrisaljoudi/uBlock/issues/188
        //   Special bucket for those filters without a valid domain name
        //   as per PSL
        bucket = this.specificFilters.get(0 | 0b0000);
        if ( bucket !== undefined ) {
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
        let proceduralSet = this.setRegister2;
        // Specific cosmetic filters.
        if ( domainHash !== 0 ) {
            bucket = this.specificFilters.get(domainHash | 0b0010);
            if ( bucket !== undefined ) {
                bucket.retrieve(hostname, proceduralSet);
            }
        }
        // Specific entity-based cosmetic filters.
        if ( entityHash !== 0 ) {
            bucket = this.specificFilters.get(entityHash | 0b0010);
            if ( bucket !== undefined ) {
                bucket.retrieve(entity, proceduralSet);
            }
        }
        // https://github.com/chrisaljoudi/uBlock/issues/188
        //   Special bucket for those filters without a valid domain name
        //   as per PSL
        bucket = this.specificFilters.get(0 | 0b0010);
        if ( bucket !== undefined ) {
            bucket.retrieve(hostname, proceduralSet);
        }

        // Apply exceptions.
        for ( let exception of exceptionSet ) {
            specificSet.delete(exception);
            proceduralSet.delete(exception);
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
            let exceptionHash = out.exceptionFilters.join();
            for ( let type in this.highlyGeneric ) {
                let entry = this.highlyGeneric[type];
                let str = entry.mru.lookup(exceptionHash);
                if ( str === undefined ) {
                    str = { s: entry.str };
                    let genericSet = entry.dict;
                    let hit = false;
                    for ( let exception of exceptionSet ) {
                        if ( (hit = genericSet.has(exception)) ) { break; }
                    }
                    if ( hit ) {
                        genericSet = new Set(entry.dict);
                        for ( let exception of exceptionSet ) {
                            genericSet.delete(exception);
                        }
                        str.s = Array.from(genericSet).join(',\n');
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
        let networkFilters = [];
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
        let injectedHideFilters = [];
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
        let details = {
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

    //console.timeEnd('cosmeticFilteringEngine.retrieveSpecificSelectors');

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

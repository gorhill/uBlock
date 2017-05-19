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

µBlock.staticNetFilteringEngine = (function(){

/******************************************************************************/

var µb = µBlock;

// fedcba9876543210
//       |    | |||
//       |    | |||
//       |    | |||
//       |    | |||
//       |    | ||+---- bit 0: [BlockAction | AllowAction]
//       |    | |+---- bit 1: `important`
//       |    | +---- bit 2-3: party [0 - 3]
//       |    +---- bit 4-8: type [0 - 31]
//       +---- bit 9-15: unused

var BlockAction = 0 << 0;
var AllowAction = 1 << 0;
var Important   = 1 << 1;
var AnyParty    = 0 << 2;
var FirstParty  = 1 << 2;
var ThirdParty  = 2 << 2;

var AnyType = 0 << 4;
var typeNameToTypeValue = {
           'no_type':  0 << 4,
        'stylesheet':  1 << 4,
             'image':  2 << 4,
            'object':  3 << 4,
            'script':  4 << 4,
    'xmlhttprequest':  5 << 4,
         'sub_frame':  6 << 4,
              'font':  7 << 4,
             'media':  8 << 4,
         'websocket':  9 << 4,
             'other': 10 << 4,
             'popup': 11 << 4,  // start of behavorial filtering
          'popunder': 12 << 4,
        'main_frame': 13 << 4,  // start of 1st-party-only behavorial filtering
       'generichide': 14 << 4,
     'inline-script': 15 << 4,
              'data': 16 << 4   // special: a generic data holder
};
var otherTypeBitValue = typeNameToTypeValue.other;

var typeValueToTypeName = {
     1: 'stylesheet',
     2: 'image',
     3: 'object',
     4: 'script',
     5: 'xmlhttprequest',
     6: 'subdocument',
     7: 'font',
     8: 'media',
     9: 'websocket',
    10: 'other',
    11: 'popup',
    12: 'popunder',
    13: 'document',
    14: 'generichide',
    15: 'inline-script',
    16: 'data'
};

// All network request types to bitmap
//   bring origin to 0 (from 4 -- see typeNameToTypeValue)
//   left-shift 1 by the above-calculated value
//   subtract 1 to set all type bits
var allNetRequestTypesBitmap = (1 << (otherTypeBitValue >>> 4)) - 1;

var BlockAnyTypeAnyParty = BlockAction | AnyType | AnyParty;
var BlockAnyType = BlockAction | AnyType;
var BlockAnyParty = BlockAction | AnyParty;

var AllowAnyTypeAnyParty = AllowAction | AnyType | AnyParty;
var AllowAnyType = AllowAction | AnyType;
var AllowAnyParty = AllowAction | AnyParty;

var genericHideException = AllowAction | AnyParty | typeNameToTypeValue.generichide,
    genericHideImportant = BlockAction | AnyParty | typeNameToTypeValue.generichide | Important;

// ABP filters: https://adblockplus.org/en/filters
// regex tester: http://regex101.com/

/******************************************************************************/

// See the following as short-lived registers, used during evaluation. They are
// valid until the next evaluation.

var pageHostnameRegister = '',
    requestHostnameRegister = '';
//var filterRegister = null;
//var categoryRegister = '';

/******************************************************************************/

var histogram = function() {};
/*
histogram = function(label, categories) {
    var h = [],
        categoryBucket;
    for ( var k in categories ) {
        // No need for hasOwnProperty() here: there is no prototype chain.
        categoryBucket = categories[k];
        for ( var kk in categoryBucket ) {
            // No need for hasOwnProperty() here: there is no prototype chain.
            filterBucket = categoryBucket[kk];
            h.push({
                k: k.charCodeAt(0).toString(2) + ' ' + kk,
                n: filterBucket instanceof FilterBucket ? filterBucket.filters.length : 1
            });
        }
    }

    console.log('Histogram %s', label);

    var total = h.length;
    h.sort(function(a, b) { return b.n - a.n; });

    // Find indices of entries of interest
    var target = 2;
    for ( var i = 0; i < total; i++ ) {
        if ( h[i].n === target ) {
            console.log('\tEntries with only %d filter(s) start at index %s (key = "%s")', target, i, h[i].k);
            target -= 1;
        }
    }

    h = h.slice(0, 50);

    h.forEach(function(v) {
        console.log('\tkey=%s  count=%d', v.k, v.n);
    });
    console.log('\tTotal buckets count: %d', total);
};
*/
/******************************************************************************/

// Local helpers

// Be sure to not confuse 'example.com' with 'anotherexample.com'
var isFirstParty = function(domain, hostname) {
    return hostname.endsWith(domain) &&
          (hostname.length === domain.length ||
           hostname.charCodeAt(hostname.length - domain.length - 1) === 0x2E /* '.' */);
};

var normalizeRegexSource = function(s) {
    try {
        var re = new RegExp(s);
        return re.source;
    } catch (ex) {
        normalizeRegexSource.message = ex.toString();
    }
    return '';
};

var rawToRegexStr = function(s, anchor) {
    var me = rawToRegexStr;
    // https://www.loggly.com/blog/five-invaluable-techniques-to-improve-regex-performance/
    // https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions
    // Also: remove leading/trailing wildcards -- there is no point.
    var reStr = s.replace(me.escape1, '\\$&')
                 .replace(me.escape2, '(?:[^%.0-9a-z_-]|$)')
                 .replace(me.escape3, '')
                 .replace(me.escape4, '[^ ]*?');
    if ( anchor & 0x4 ) {
        reStr = '[0-9a-z.-]*?' + reStr;
    } else if ( anchor & 0x2 ) {
        reStr = '^' + reStr;
    }
    if ( anchor & 0x1 ) {
        reStr += '$';
    }
    return reStr;
};
rawToRegexStr.escape1 = /[.+?${}()|[\]\\]/g;
rawToRegexStr.escape2 = /\^/g;
rawToRegexStr.escape3 = /^\*|\*$/g;
rawToRegexStr.escape4 = /\*/g;

// If using native Map, we use numerical keys, otherwise for
// Object-based map we use string-based keys.
var exportInt = function(k) {
    return k.toString(32);
};

var importInt = function(k) {
    return parseInt(k,32);
};

var toLogDataInternal = function(categoryBits, tokenHash, filter) {
    if ( filter === null ) { return undefined; }
    var logData = filter.logData();
    logData.compiled = exportInt(categoryBits) + '\v' +
                       exportInt(tokenHash) + '\v' +
                       logData.compiled;
    if ( categoryBits & 0x001 ) {
        logData.raw = '@@' + logData.raw;
    }
    var opts = [];
    if ( categoryBits & 0x002 ) {
        opts.push('important');
    }
    if ( categoryBits & 0x008 ) {
        opts.push('third-party');
    } else if ( categoryBits & 0x004 ) {
        opts.push('first-party');
    }
    var type = (categoryBits >>> 4) & 0x1F;
    if ( type !== 0 && type !== 16 /* data */ ) {
        opts.push(typeValueToTypeName[type]);
    }
    if ( logData.opts !== undefined ) {
        opts.push(logData.opts);
    }
    if ( opts.length !== 0 ) {
        logData.raw += '$' + opts.join(',');
    }
    return logData;
};

// First character of match must be within the hostname part of the url.
var isHnAnchored = function(url, matchStart) {
    var hnStart = url.indexOf('://');
    if ( hnStart === -1 ) { return false; }
    hnStart += 3;
    if ( matchStart <= hnStart ) { return true; }
    if ( reURLPostHostnameAnchors.test(url.slice(hnStart, matchStart)) ) {
        return false;
    }
    // https://github.com/gorhill/uBlock/issues/1929
    // Match only hostname label boundaries.
    return url.charCodeAt(matchStart - 1) === 0x2E;
};

var reURLPostHostnameAnchors = /[\/?#]/;

/*******************************************************************************

    Each filter class will register itself in the map. A filter class
    id MUST always stringify to ONE single character.

    IMPORTANT: any change which modifies the mapping will have to be
    reflected with µBlock.systemSettings.compiledMagic.

**/

var filterClasses = new Map(),
    filterClassIdGenerator = 0;

var registerFilterClass = function(ctor) {
    var fid = filterClassIdGenerator++;
    ctor.fidPrefix = ctor.prototype.fidPrefix = fid.toString(32) + '\t';
    filterClasses.set(fid, ctor);
    //console.log(ctor.name, fid);
};

/******************************************************************************/

var FilterTrue = function() {
};

FilterTrue.prototype.match = function() {
    return true;
};

FilterTrue.prototype.logData = function() {
    return {
        raw: '*',
        regex: '^',
        compiled: this.compile(),
    };
};

FilterTrue.prototype.compile = function() {
    return this.fidPrefix;
};

FilterTrue.compile = function() {
    return FilterTrue.fidPrefix;
};

FilterTrue.load = function() {
    return new FilterTrue();
};

registerFilterClass(FilterTrue);

/******************************************************************************/

var FilterPlain = function(s, tokenBeg) {
    this.s = s;
    this.tokenBeg = tokenBeg;
};

FilterPlain.prototype.match = function(url, tokenBeg) {
    return url.startsWith(this.s, tokenBeg - this.tokenBeg);
};

FilterPlain.prototype.logData = function() {
    return {
        raw: this.s,
        regex: rawToRegexStr(this.s),
        compiled: this.compile()
    };
};

FilterPlain.prototype.compile = function() {
    return this.fidPrefix + this.s + '\t' + this.tokenBeg;
};

FilterPlain.compile = function(details) {
    return FilterPlain.fidPrefix + details.f + '\t' + details.tokenBeg;
};

FilterPlain.load = function(s) {
    var pos = s.indexOf('\t', 2);
    return new FilterPlain(
        s.slice(2, pos),
        parseInt(s.slice(pos + 1), 10)
    );
};

registerFilterClass(FilterPlain);

/******************************************************************************/

var FilterPlainPrefix0 = function(s) {
    this.s = s;
};

FilterPlainPrefix0.prototype.match = function(url, tokenBeg) {
    return url.startsWith(this.s, tokenBeg);
};

FilterPlainPrefix0.prototype.logData = function() {
    return {
        raw: this.s,
        regex: rawToRegexStr(this.s),
        compiled: this.compile()
    };
};

FilterPlainPrefix0.prototype.compile = function() {
    return this.fidPrefix + this.s;
};

FilterPlainPrefix0.compile = function(details) {
    return FilterPlainPrefix0.fidPrefix + details.f;
};

FilterPlainPrefix0.load = function(s) {
    return new FilterPlainPrefix0(s.slice(2));
};

registerFilterClass(FilterPlainPrefix0);

/******************************************************************************/

var FilterPlainPrefix1 = function(s) {
    this.s = s;
};

FilterPlainPrefix1.prototype.match = function(url, tokenBeg) {
    return url.startsWith(this.s, tokenBeg - 1);
};

FilterPlainPrefix1.prototype.logData = function() {
    return {
        raw: this.s,
        regex: rawToRegexStr(this.s),
        compiled: this.compile()
    };
};

FilterPlainPrefix1.prototype.compile = function() {
    return this.fidPrefix + this.s;
};

FilterPlainPrefix1.compile = function(details) {
    return FilterPlainPrefix1.fidPrefix + details.f;
};

FilterPlainPrefix1.load = function(s) {
    return new FilterPlainPrefix1(s.slice(2));
};

registerFilterClass(FilterPlainPrefix1);

/******************************************************************************/

var FilterPlainHostname = function(s) {
    this.s = s;
};

FilterPlainHostname.prototype.match = function() {
    var haystack = requestHostnameRegister, needle = this.s;
    if ( haystack.endsWith(needle) === false ) { return false; }
    var offset = haystack.length - needle.length;
    return offset === 0 || haystack.charCodeAt(offset - 1) === 0x2E /* '.' */;
};

FilterPlainHostname.prototype.logData = function() {
    return {
        raw: '||' + this.s + '^',
        regex: rawToRegexStr(this.s, 0x4),
        compiled: this.compile()
    };
};

FilterPlainHostname.prototype.compile = function() {
    return this.fidPrefix + this.s;
};

FilterPlainHostname.compile = function(details) {
    return FilterPlainHostname.fidPrefix + details.f;
};

FilterPlainHostname.load = function(s) {
    return new FilterPlainHostname(s.slice(2));
};

registerFilterClass(FilterPlainHostname);

/******************************************************************************/

var FilterPlainLeftAnchored = function(s) {
    this.s = s;
};

FilterPlainLeftAnchored.prototype.match = function(url) {
    return url.startsWith(this.s);
};

FilterPlainLeftAnchored.prototype.logData = function() {
    return {
        raw: '|' + this.s,
        regex: rawToRegexStr(this.s, 0x2),
        compiled: this.compile()
    };
};

FilterPlainLeftAnchored.prototype.compile = function() {
    return this.fidPrefix + this.s;
};

FilterPlainLeftAnchored.compile = function(details) {
    return FilterPlainLeftAnchored.fidPrefix + details.f;
};

FilterPlainLeftAnchored.load = function(s) {
    return new FilterPlainLeftAnchored(s.slice(2));
};

registerFilterClass(FilterPlainLeftAnchored);

/******************************************************************************/

var FilterPlainRightAnchored = function(s) {
    this.s = s;
};

FilterPlainRightAnchored.prototype.match = function(url) {
    return url.endsWith(this.s);
};

FilterPlainRightAnchored.prototype.logData = function() {
    return {
        raw: this.s + '|',
        regex: rawToRegexStr(this.s, 0x1),
        compiled: this.compile()
    };
};

FilterPlainRightAnchored.prototype.compile = function() {
    return this.fidPrefix + this.s;
};

FilterPlainRightAnchored.compile = function(details) {
    return FilterPlainRightAnchored.fidPrefix + details.f;
};

FilterPlainRightAnchored.load = function(s) {
    return new FilterPlainRightAnchored(s.slice(2));
};

registerFilterClass(FilterPlainRightAnchored);

/******************************************************************************/

var FilterPlainHnAnchored = function(s) {
    this.s = s;
};

FilterPlainHnAnchored.prototype.match = function(url, tokenBeg) {
    return url.startsWith(this.s, tokenBeg) &&
           isHnAnchored(url, tokenBeg);
};

FilterPlainHnAnchored.prototype.logData = function() {
    return {
        raw: '||' + this.s,
        regex: rawToRegexStr(this.s),
        compiled: this.compile()
    };
};

FilterPlainHnAnchored.prototype.compile = function() {
    return this.fidPrefix + this.s;
};

FilterPlainHnAnchored.compile = function(details) {
    return FilterPlainHnAnchored.fidPrefix + details.f;
};

FilterPlainHnAnchored.load = function(s) {
    return new FilterPlainHnAnchored(s.slice(2));
};

registerFilterClass(FilterPlainHnAnchored);

/******************************************************************************/

var FilterGeneric = function(s, anchor) {
    this.s = s;
    this.anchor = anchor;
};

FilterGeneric.prototype.re = null;

FilterGeneric.prototype.match = function(url) {
    if ( this.re === null ) {
        this.re = new RegExp(rawToRegexStr(this.s, this.anchor));
    }
    return this.re.test(url);
};

FilterGeneric.prototype.logData = function() {
    var out = {
        raw: this.s,
        regex: this.re.source,
        compiled: this.compile()
    };
    if ( this.anchor & 0x2 ) {
        out.raw = '|' + out.raw;
    }
    if ( this.anchor & 0x1 ) {
        out.raw += '|';
    }
    return out;
};

FilterGeneric.prototype.compile = function() {
    return this.fidPrefix + this.s + '\t' + this.anchor;
};

FilterGeneric.compile = function(details) {
    return FilterGeneric.fidPrefix + details.f + '\t' + details.anchor;
};

FilterGeneric.load = function(s) {
    var pos = s.indexOf('\t', 2);
    return new FilterGeneric(
        s.slice(2, pos),
        parseInt(s.slice(pos + 1), 10)
    );
};

registerFilterClass(FilterGeneric);

/******************************************************************************/

var FilterGenericHnAnchored = function(s) {
    this.s = s;
};

FilterGenericHnAnchored.prototype.re = null;
FilterGenericHnAnchored.prototype.anchor = 0x4;

FilterGenericHnAnchored.prototype.match = function(url) {
    if ( this.re === null ) {
        this.re = new RegExp(rawToRegexStr(this.s, this.anchor));
    }
    var matchStart = url.search(this.re);
    return matchStart !== -1 && isHnAnchored(url, matchStart);
};

FilterGenericHnAnchored.prototype.logData = function() {
    var out = {
        raw: '||' + this.s,
        regex: this.re.source,
        compiled: this.compile()
    };
    return out;
};

FilterGenericHnAnchored.prototype.compile = function() {
    return this.fidPrefix + this.s;
};

FilterGenericHnAnchored.compile = function(details) {
    return FilterGenericHnAnchored.fidPrefix + details.f;
};

FilterGenericHnAnchored.load = function(s) {
    return new FilterGenericHnAnchored(s.slice(2));
};

registerFilterClass(FilterGenericHnAnchored);

/******************************************************************************/

var FilterGenericHnAndRightAnchored = function(s) {
    FilterGenericHnAnchored.call(this, s);
};

FilterGenericHnAndRightAnchored.prototype = Object.create(FilterGenericHnAnchored.prototype, {
    constructor: {
        value: FilterGenericHnAndRightAnchored
    },
    anchor: {
        value: 0x5
    },
    logData: {
        value: function() {
            var out = FilterGenericHnAnchored.prototype.logData.call(this);
            out.raw += '|';
            return out;
        }
    },
    compile: {
        value: function() {
            return this.fidPrefix + this.s;
        }
    },
});

FilterGenericHnAndRightAnchored.compile = function(details) {
    return FilterGenericHnAndRightAnchored.fidPrefix + details.f;
};

FilterGenericHnAndRightAnchored.load = function(s) {
    return new FilterGenericHnAndRightAnchored(s.slice(2));
};

registerFilterClass(FilterGenericHnAndRightAnchored);

/******************************************************************************/

var FilterRegex = function(s) {
    this.re = new RegExp(s, 'i');
};

FilterRegex.prototype.match = function(url) {
    return this.re.test(url);
};

FilterRegex.prototype.logData = function() {
    return {
        raw: '/' + this.s + '/',
        regex: this.s,
        compiled: this.compile()
    };
};

FilterRegex.prototype.compile = function() {
    return this.fidPrefix + this.re.source;
};

FilterRegex.compile = function(details) {
    return FilterRegex.fidPrefix + details.f;
};

FilterRegex.load = function(s) {
    return new FilterRegex(s.slice(2));
};

registerFilterClass(FilterRegex);

/******************************************************************************/

// Filtering according to the origin.

var FilterOrigin = function() {
};

FilterOrigin.prototype.wrapped = {
    compile: function() {
        return '';
    },
    logData: function() {
        return {
            compiled: ''
        };
    },
    match: function() {
        return true;
    }
};

FilterOrigin.prototype.matchOrigin = function() {
    return true;
};

FilterOrigin.prototype.match = function(url, tokenBeg) {
    return this.matchOrigin() && this.wrapped.match(url, tokenBeg);
};

FilterOrigin.prototype.logData = function() {
    var out = this.wrapped.logData(),
        domainOpt = this.toDomainOpt();
    out.compiled = this.fidPrefix + domainOpt + '\v' + out.compiled;
    if ( out.opts === undefined ) {
        out.opts = 'domain=' + domainOpt;
    } else {
        out.opts += ',domain=' + domainOpt;
    }
    return out;
};

FilterOrigin.prototype.compile = function() {
    return this.fidPrefix + this.toDomainOpt() + '\v' + this.wrapped.compile();
};

// *** start of specialized origin matchers

var FilterOriginHit = function(domainOpt) {
    FilterOrigin.call(this);
    this.hostname = domainOpt;
};

FilterOriginHit.prototype = Object.create(FilterOrigin.prototype, {
    constructor: {
        value: FilterOriginHit
    },
    toDomainOpt: {
        value: function() {
            return this.hostname;
        }
    },
    matchOrigin: {
        value: function() {
            var needle = this.hostname, haystack = pageHostnameRegister;
            if ( haystack.endsWith(needle) === false ) { return false; }
            var offset = haystack.length - needle.length;
            return offset === 0 || haystack.charCodeAt(offset - 1) === 0x2E /* '.' */;
        }
    },
});

//

var FilterOriginMiss = function(domainOpt) {
    FilterOrigin.call(this);
    this.hostname = domainOpt.slice(1);
};

FilterOriginMiss.prototype = Object.create(FilterOrigin.prototype, {
    constructor: {
        value: FilterOriginMiss
    },
    toDomainOpt: {
        value: function() {
            return '~' + this.hostname;
        }
    },
    matchOrigin: {
        value: function() {
            var needle = this.hostname, haystack = pageHostnameRegister;
            if ( haystack.endsWith(needle) === false ) { return true; }
            var offset = haystack.length - needle.length;
            return offset !== 0 && haystack.charCodeAt(offset - 1) !== 0x2E /* '.' */;
        }
    },
});

//

var FilterOriginHitSet = function(domainOpt) {
    FilterOrigin.call(this);
    this.domainOpt = domainOpt;
};

FilterOriginHitSet.prototype = Object.create(FilterOrigin.prototype, {
    constructor: {
        value: FilterOriginHitSet
    },
    oneOf: {
        value: null,
        writable: true
    },
    toDomainOpt: {
        value: function() {
            return this.domainOpt;
        }
    },
    matchOrigin: {
        value: function() {
            if ( this.oneOf === null ) {
                this.oneOf = new RegExp('(?:^|\\.)(?:' + this.domainOpt.replace(/\./g, '\\.') + ')$');
            }
            return this.oneOf.test(pageHostnameRegister);
        }
    },
});

//

var FilterOriginMissSet = function(domainOpt) {
    FilterOrigin.call(this);
    this.domainOpt = domainOpt;
};

FilterOriginMissSet.prototype = Object.create(FilterOrigin.prototype, {
    constructor: {
        value: FilterOriginMissSet
    },
    noneOf: {
        value: null,
        writable: true
    },
    toDomainOpt: {
        value: function() {
            return this.domainOpt;
        }
    },
    matchOrigin: {
        value: function() {
            if ( this.noneOf === null ) {
                this.noneOf = new RegExp('(?:^|\\.)(?:' + this.domainOpt.replace(/~/g, '').replace(/\./g, '\\.') + ')$');
            }
            return this.noneOf.test(pageHostnameRegister) === false;
        }
    },
});

//

var FilterOriginMixedSet = function(domainOpt) {
    FilterOrigin.call(this);
    this.domainOpt = domainOpt;
};

FilterOriginMixedSet.prototype = Object.create(FilterOrigin.prototype, {
    constructor: {
        value: FilterOriginMixedSet
    },
    oneOf: {
        value: null,
        writable: true
    },
    noneOf: {
        value: null,
        writable: true
    },
    init: {
        value: function() {
            var oneOf = [], noneOf = [],
                hostnames = this.domainOpt.split('|'),
                i = hostnames.length,
                hostname;
            while ( i-- ) {
                hostname = hostnames[i].replace(/\./g, '\\.');
                if ( hostname.charCodeAt(0) === 0x7E /* '~' */ ) {
                    noneOf.push(hostname.slice(1));
                } else {
                    oneOf.push(hostname);
                }
            }
            this.oneOf = new RegExp('(?:^|\\.)(?:' + oneOf.join('|') + ')$');
            this.noneOf = new RegExp('(?:^|\\.)(?:' + noneOf.join('|') + ')$');
        }
    },
    toDomainOpt: {
        value: function() {
            return this.domainOpt;
        }
    },
    matchOrigin: {
        value: function() {
            if ( this.oneOf === null ) { this.init(); }
            var needle = pageHostnameRegister;
            return this.oneOf.test(needle) && this.noneOf.test(needle) === false;
        }
    },
});

// *** end of specialized origin matchers

// The optimal test function is picked according to the content of the
// `domain=` filter option.
// Re-factored in light of:
// - https://gorhill.github.io/obj-vs-set-vs-map/set-vs-regexp.html
// The re-factoring made possible to reuse instances of a matcher. As of
// writing, I observed that just with EasyList, there were ~1,200 reused
// instances out of ~2,800.

FilterOrigin.matcherFactory = function(domainOpt) {
    // One hostname
    if ( domainOpt.indexOf('|') === -1 ) {
        if ( domainOpt.charCodeAt(0) === 0x7E /* '~' */ ) {
            return new FilterOriginMiss(domainOpt);
        }
        return new FilterOriginHit(domainOpt);
    }
    // Many hostnames.
    // Must be in set (none negated).
    if ( domainOpt.indexOf('~') === -1 ) {
        return new FilterOriginHitSet(domainOpt);
    }
    // Must not be in set (all negated).
    if ( FilterOrigin.reAllNegated.test(domainOpt) ) {
        return new FilterOriginMissSet(domainOpt);
    }
    // Must be in one set, but not in the other.
    return new FilterOriginMixedSet(domainOpt);
};

FilterOrigin.reAllNegated = /^~(?:[^|~]+\|~)+[^|~]+$/;

FilterOrigin.compile = function(details) {
    return FilterOrigin.fidPrefix + details.domainOpt;
};

FilterOrigin.load = function(s) {
    var pos = s.indexOf('\v', 2),
        f = FilterOrigin.matcherFactory(s.slice(2, pos));
    f.wrapped = filterFromCompiledData(s.slice(pos + 1));
    return f;
};

registerFilterClass(FilterOrigin);

/******************************************************************************/

var FilterDataHolder = function(dataType, dataStr) {
    this.dataType = dataType;
    this.dataStr = dataStr;
    this.wrapped = undefined;
};

FilterDataHolder.prototype.match = function(url, tokenBeg) {
    return this.wrapped.match(url, tokenBeg);
};

FilterDataHolder.prototype.logData = function() {
    var out = this.wrapped.logData();
    out.compiled = this.fidPrefix + this.dataType + '\t' + this.dataStr + '\v' + out.compiled;
    var opt = this.dataType;
    if ( this.dataStr !== '' ) {
        opt += '=' + this.dataStr;
    }
    if ( out.opts === undefined ) {
        out.opts = opt;
    } else {
        out.opts = opt + ',' + out.opts;
    }
    return out;
};

FilterDataHolder.prototype.compile = function() {
    return this.fidPrefix + this.dataType + '\t' + this.dataStr + '\v' + this.wrapped.compile();
};

FilterDataHolder.compile = function(details) {
    return FilterDataHolder.fidPrefix + details.dataType + '\t' + details.dataStr;
};

FilterDataHolder.load = function(s) {
    var pos = s.indexOf('\t', 2),
        end = s.indexOf('\v', pos),
        f = new FilterDataHolder(s.slice(2, pos), s.slice(pos + 1, end));
    f.wrapped = filterFromCompiledData(s.slice(end + 1));
    return f;
};

registerFilterClass(FilterDataHolder);

// Helper class for storing instances of FilterDataHolder.

var FilterDataHolderEntry = function(categoryBits, tokenHash, fdata) {
    this.categoryBits = categoryBits;
    this.tokenHash = tokenHash;
    this.filter = filterFromCompiledData(fdata);
    this.next = undefined;
};

FilterDataHolderEntry.prototype.logData = function() {
    return toLogDataInternal(this.categoryBits, this.tokenHash, this.filter);
};

FilterDataHolderEntry.prototype.compile = function() {
    return exportInt(this.categoryBits) + '\t' +
           exportInt(this.tokenHash) + '\t' +
           this.filter.compile();
};

FilterDataHolderEntry.load = function(s) {
    var pos1 = s.indexOf('\t'),
        pos2 = s.indexOf('\t', pos1 + 1);
    return new FilterDataHolderEntry(
        importInt(s),
        importInt(s.slice(pos1 + 1, pos2)),
        s.slice(pos2 + 1)
    );
};

/******************************************************************************/

// Dictionary of hostnames
//
var FilterHostnameDict = function() {
    this.h = ''; // short-lived register
    this.dict = new Set();
};

Object.defineProperty(FilterHostnameDict.prototype, 'size', {
    get: function() {
        return this.dict.size;
    }
});

FilterHostnameDict.prototype.add = function(hn) {
    if ( this.dict.has(hn) ) {
        return false;
    }
    this.dict.add(hn);
    return true;
};

FilterHostnameDict.prototype.remove = function(hn) {
    return this.dict.delete(hn);
};

FilterHostnameDict.prototype.match = function() {
    // TODO: mind IP addresses
    var pos,
        hostname = requestHostnameRegister;
    while ( this.dict.has(hostname) === false ) {
        pos = hostname.indexOf('.');
        if ( pos === -1 ) {
            this.h = '';
            return false;
        }
        hostname = hostname.slice(pos + 1);
    }
    this.h = hostname;
    return this;
};

FilterHostnameDict.prototype.logData = function() {
    return {
        raw: '||' + this.h + '^',
        regex: rawToRegexStr(this.h) + '(?:[^%.0-9a-z_-]|$)',
        compiled: this.h
    };
};

FilterHostnameDict.prototype.compile = function() {
    return this.fidPrefix + JSON.stringify(µb.setToArray(this.dict));
};

FilterHostnameDict.load = function(s) {
    var f = new FilterHostnameDict();
    f.dict = µb.setFromArray(JSON.parse(s.slice(2)));
    return f;
};

registerFilterClass(FilterHostnameDict);

/******************************************************************************/

// Some buckets can grow quite large, and finding a hit in these buckets
// may end up being expensive. After considering various solutions, the one
// retained is to promote hit filters to a smaller index, so that next time
// they can be looked-up faster.

// key=  10000 ad           count=660
// key=  10000 ads          count=433
// key=  10001 google       count=277
// key=1000000 2mdn         count=267
// key=  10000 social       count=240
// key=  10001 pagead2      count=166
// key=  10000 twitter      count=122
// key=  10000 doubleclick  count=118
// key=  10000 facebook     count=114
// key=  10000 share        count=113
// key=  10000 google       count=106
// key=  10001 code         count=103
// key=  11000 doubleclick  count=100
// key=1010001 g            count=100
// key=  10001 js           count= 89
// key=  10000 adv          count= 88
// key=  10000 youtube      count= 61
// key=  10000 plugins      count= 60
// key=  10001 partner      count= 59
// key=  10000 ico          count= 57
// key= 110001 ssl          count= 57
// key=  10000 banner       count= 53
// key=  10000 footer       count= 51
// key=  10000 rss          count= 51

/******************************************************************************/

var FilterBucket = function(a, b) {
    this.promoted = 0;
    this.vip = 16;
    this.f = null;  // short-lived register
    this.filters = [];
    if ( a !== undefined ) {
        this.filters[0] = a;
        if ( b !== undefined ) {
            this.filters[1] = b;
        }
    }
};

FilterBucket.prototype.add = function(a) {
    this.filters.push(a);
};

FilterBucket.prototype.remove = function(fdata) {
    var i = this.filters.length,
        filter;
    while ( i-- ) {
        filter = this.filters[i];
        if ( filter.compile() === fdata ) {
            this.filters.splice(i, 1);
        }
    }
};

// Promote hit filters so they can be found faster next time.
FilterBucket.prototype.promote = function(i) {
    var filters = this.filters;
    var pivot = filters.length >>> 1;
    while ( i < pivot ) {
        pivot >>>= 1;
        if ( pivot < this.vip ) {
            break;
        }
    }
    if ( i <= pivot ) { return; }
    var j = this.promoted % pivot;
    //console.debug('FilterBucket.promote(): promoted %d to %d', i, j);
    var f = filters[j];
    filters[j] = filters[i];
    filters[i] = f;
    this.promoted += 1;
};

FilterBucket.prototype.match = function(url, tokenBeg) {
    var filters = this.filters,
        n = filters.length;
    for ( var i = 0; i < n; i++ ) {
        if ( filters[i].match(url, tokenBeg) ) {
            this.f = filters[i];
            if ( i >= this.vip ) {
                this.promote(i);
            }
            return true;
        }
    }
    return false;
};

FilterBucket.prototype.logData = function() {
    return this.f.logData();
};

FilterBucket.prototype.compile = function() {
    var compiled = [],
        filters = this.filters;
    for ( var i = 0, n = filters.length; i < n; i++ ) {
        compiled[i] = filters[i].compile();
    }
    return this.fidPrefix + JSON.stringify(compiled);
};

FilterBucket.load = function(s) {
    var f = new FilterBucket(),
        compiled = JSON.parse(s.slice(2)),
        filters = f.filters;
    for ( var i = 0, n = compiled.length; i < n; i++ ) {
        filters[i] = filterFromCompiledData(compiled[i]);
    }
    return f;
};

registerFilterClass(FilterBucket);

/******************************************************************************/
/******************************************************************************/

var filterFromCompiledData = function(compiled) {
    if ( compiled === lastLoadedFilterString ) {
        return lastLoadedFilter;
    }
    var fid = parseInt(compiled, 36),
        f = filterClasses.get(fid).load(compiled);
    //filterClassHistogram.set(fid, (filterClassHistogram.get(fid) || 0) + 1);
    lastLoadedFilterString = compiled;
    lastLoadedFilter = f;
    return f;
};

var lastLoadedFilterString,
    lastLoadedFilter;
//var filterClassHistogram = new Map();

/******************************************************************************/
/******************************************************************************/

var FilterParser = function() {
    this.cantWebsocket = vAPI.cantWebsocket;
    this.reBadDomainOptChars = /[*+?^${}()[\]\\]/;
    this.reHostnameRule1 = /^[0-9a-z][0-9a-z.-]*[0-9a-z]$/i;
    this.reHostnameRule2 = /^\**[0-9a-z][0-9a-z.-]*[0-9a-z]\^?$/i;
    this.reCleanupHostnameRule2 = /^\**|\^$/g;
    this.reHasWildcard = /[\^\*]/;
    this.reCanTrimCarets1 = /^[^*]*$/;
    this.reCanTrimCarets2 = /^\^?[^^]+[^^][^^]+\^?$/;
    this.reHasUppercase = /[A-Z]/;
    this.reIsolateHostname = /^(\*?\.)?([^\x00-\x24\x26-\x2C\x2F\x3A-\x5E\x60\x7B-\x7F]+)(.*)/;
    this.reHasUnicode = /[^\x00-\x7F]/;
    this.reWebsocketAny = /^ws[s*]?(?::\/?\/?)?\*?$/;
    this.reBadCSP = /(?:^|;)\s*report-(?:to|uri)\b/;
    this.domainOpt = '';
    this.noTokenHash = µb.urlTokenizer.tokenHashFromString('*');
    this.reset();
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1493
//   Transpose `ping` into `other` for now.

FilterParser.prototype.toNormalizedType = {
            'beacon': 'other',
              'data': 'data',
          'document': 'main_frame',
          'elemhide': 'generichide',
              'font': 'font',
       'generichide': 'generichide',
             'image': 'image',
     'inline-script': 'inline-script',
             'media': 'media',
            'object': 'object',
             'other': 'other',
 'object-subrequest': 'object',
              'ping': 'other',
          'popunder': 'popunder',
             'popup': 'popup',
            'script': 'script',
        'stylesheet': 'stylesheet',
       'subdocument': 'sub_frame',
    'xmlhttprequest': 'xmlhttprequest',
         'websocket': 'websocket'
};

/******************************************************************************/

FilterParser.prototype.reset = function() {
    this.action = BlockAction;
    this.anchor = 0;
    this.badFilter = false;
    this.dataType = undefined;
    this.dataStr = undefined;
    this.elemHiding = false;
    this.f = '';
    this.firstParty = false;
    this.thirdParty = false;
    this.party = AnyParty;
    this.fopts = '';
    this.hostnamePure = false;
    this.domainOpt = '';
    this.isRegex = false;
    this.raw = '';
    this.redirect = false;
    this.token = '*';
    this.tokenHash = this.noTokenHash;
    this.tokenBeg = 0;
    this.types = 0;
    this.important = 0;
    this.unsupported = false;
    return this;
};

/******************************************************************************/

FilterParser.prototype.bitFromType = function(type) {
    return 1 << ((typeNameToTypeValue[type] >>> 4) - 1);
};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/589
// Be ready to handle multiple negated types

FilterParser.prototype.parseTypeOption = function(raw, not) {
    var typeBit = this.bitFromType(this.toNormalizedType[raw]);

    if ( !not ) {
        this.types |= typeBit;
        return;
    }

    // Non-discrete network types can't be negated.
    if ( (typeBit & allNetRequestTypesBitmap) === 0 ) {
        return;
    }

    // Negated type: set all valid network request type bits to 1
    if (
        (typeBit & allNetRequestTypesBitmap) !== 0 &&
        (this.types & allNetRequestTypesBitmap) === 0
    ) {
        this.types |= allNetRequestTypesBitmap;
    }
    this.types &= ~typeBit;
};

/******************************************************************************/

FilterParser.prototype.parsePartyOption = function(firstParty, not) {
    if ( firstParty ) {
        not = !not;
    }
    if ( not ) {
        this.firstParty = true;
        this.party = this.thirdParty ? AnyParty : FirstParty;
    } else {
        this.thirdParty = true;
        this.party = this.firstParty ? AnyParty : ThirdParty;
    }
};

/******************************************************************************/

FilterParser.prototype.parseDomainOption = function(s) {
    if ( this.reHasUnicode.test(s) ) {
        var hostnames = s.split('|'),
            i = hostnames.length;
        while ( i-- ) {
            if ( this.reHasUnicode.test(hostnames[i]) ) {
                hostnames[i] = punycode.toASCII(hostnames[i]);
            }
        }
        s = hostnames.join('|');
    }
    if ( this.reBadDomainOptChars.test(s) ) {
        return '';
    }
    return s;
};

/******************************************************************************/

FilterParser.prototype.parseOptions = function(s) {
    this.fopts = s;
    var opts = s.split(',');
    var opt, not;
    for ( var i = 0; i < opts.length; i++ ) {
        opt = opts[i];
        not = opt.startsWith('~');
        if ( not ) {
            opt = opt.slice(1);
        }
        if ( opt === 'third-party' ) {
            this.parsePartyOption(false, not);
            continue;
        }
        // https://issues.adblockplus.org/ticket/616
        // `generichide` concept already supported, just a matter of
        // adding support for the new keyword.
        if ( opt === 'elemhide' || opt === 'generichide' ) {
            if ( not === false ) {
                this.parseTypeOption('generichide', false);
                continue;
            }
            this.unsupported = true;
            break;
        }
        if ( opt === 'document' ) {
            if ( this.action === BlockAction ) {
                this.parseTypeOption('document', not);
                continue;
            }
            this.unsupported = true;
            break;
        }
        if ( this.toNormalizedType.hasOwnProperty(opt) ) {
            this.parseTypeOption(opt, not);
            // Due to ABP categorizing `websocket` requests as `other`, we need
            // to add `websocket` for when `other` is used.
            if ( opt === 'other' ) {
                this.parseTypeOption('websocket', not);
            }
            continue;
        }
        // https://github.com/gorhill/uBlock/issues/2294
        // Detect and discard filter if domain option contains nonsensical
        // characters.
        if ( opt.startsWith('domain=') ) {
            this.domainOpt = this.parseDomainOption(opt.slice(7));
            if ( this.domainOpt === '' ) {
                this.unsupported = true;
                break;
            }
            continue;
        }
        if ( opt === 'important' ) {
            this.important = Important;
            continue;
        }
        if ( opt === 'first-party' ) {
            this.parsePartyOption(true, not);
            continue;
        }
        if ( opt.startsWith('redirect=') ) {
            if ( this.action === BlockAction ) {
                this.redirect = true;
                continue;
            }
            this.unsupported = true;
            break;
        }
        if ( opt.startsWith('csp=') ) {
            if ( opt.length > 4 && this.reBadCSP.test(opt) === false ) {
                this.parseTypeOption('data', not);
                this.dataType = 'csp';
                this.dataStr = opt.slice(4).trim();
            }
            continue;
        }
        if ( opt === 'csp' && this.action === AllowAction ) {
            this.parseTypeOption('data', not);
            this.dataType = 'csp';
            this.dataStr = '';
            continue;
        }
        // Used by Adguard, purpose is unclear -- just ignore for now.
        if ( opt === 'empty' ) {
            continue;
        }
        // https://github.com/uBlockOrigin/uAssets/issues/192
        if ( opt === 'badfilter' ) {
            this.badFilter = true;
            continue;
        }
        // Unrecognized filter option: ignore whole filter.
        this.unsupported = true;
        break;
    }
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1943#issuecomment-243188946
//   Convert websocket-related filter where possible to a format which
//   can be handled using CSP injection.

FilterParser.prototype.translate = function() {
    var dataTypeBit = this.bitFromType('data');

    if ( this.cantWebsocket && this.reWebsocketAny.test(this.f) ) {
        this.f = '*';
        this.types = dataTypeBit;
        this.dataType = 'csp';
        this.dataStr = "connect-src https: http:";
        // https://bugs.chromium.org/p/chromium/issues/detail?id=669086
        // TODO: remove when most users are beyond Chromium v56
        if ( vAPI.chromiumVersion < 57 ) {
            this.dataStr += '; frame-src *';
        }
        return;
    }

    // Broad |data:-based filters.
    if ( this.f === 'data:' ) {
        switch ( this.types ) {
        case 0:
            this.f = '*';
            this.types = dataTypeBit;
            this.dataType = 'csp';
            this.dataStr = "default-src 'self' * blob: 'unsafe-inline' 'unsafe-eval'";
            break;
        case this.bitFromType('script'):
            this.f = '*';
            this.types = dataTypeBit;
            this.dataType = 'csp';
            this.dataStr = "script-src 'self' * blob: 'unsafe-inline' 'unsafe-eval'";
            break;
        case this.bitFromType('sub_frame'):
            this.f = '*';
            this.types = dataTypeBit;
            this.dataType = 'csp';
            this.dataStr = "frame-src 'self' * blob:";
            break;
        case this.bitFromType('script') | this.bitFromType('sub_frame'):
            this.f = '*';
            this.types = dataTypeBit;
            this.dataType = 'csp';
            this.dataStr = "frame-src 'self' * blob:; script-src 'self' * blob: 'unsafe-inline' 'unsafe-eval';";
            break;
        default:
            break;
        }
    }

    // Broad |blob:-based filters.
    if ( this.f === 'blob:' ) {
        switch ( this.types ) {
        case 0:
            this.f = '*';
            this.types = dataTypeBit;
            this.dataType = 'csp';
            this.dataStr = "default-src 'self' * data: 'unsafe-inline' 'unsafe-eval'";
            break;
        case this.bitFromType('script'):
            this.f = '*';
            this.types = dataTypeBit;
            this.dataType = 'csp';
            this.dataStr = "script-src 'self' * data: 'unsafe-inline' 'unsafe-eval'";
            break;
        case this.bitFromType('sub_frame'):
            this.f = '*';
            this.types = dataTypeBit;
            this.dataType = 'csp';
            this.dataStr = "frame-src 'self' * data:";
            break;
        case this.bitFromType('script') | this.bitFromType('sub_frame'):
            this.f = '*';
            this.types = dataTypeBit;
            this.dataType = 'csp';
            this.dataStr = "frame-src 'self' * data:; script-src 'self' * data: 'unsafe-inline' 'unsafe-eval';";
            break;
        default:
            break;
        }
    }
};

/*******************************************************************************

    anchor: bit vector
        0000 (0x0): no anchoring
        0001 (0x1): anchored to the end of the URL.
        0010 (0x2): anchored to the start of the URL.
        0011 (0x3): anchored to the start and end of the URL.
        0100 (0x4): anchored to the hostname of the URL.
        0101 (0x5): anchored to the hostname and end of the URL.

**/

FilterParser.prototype.parse = function(raw) {
    // important!
    this.reset();

    var s = this.raw = raw;

    // plain hostname? (from HOSTS file)
    if ( this.reHostnameRule1.test(s) ) {
        this.f = s;
        this.hostnamePure = true;
        this.anchor |= 0x4;
        return this;
    }

    // element hiding filter?
    var pos = s.indexOf('#');
    if ( pos !== -1 ) {
        var c = s.charAt(pos + 1);
        if ( c === '#' || c === '@' ) {
            console.error('static-net-filtering.js > unexpected cosmetic filters');
            this.elemHiding = true;
            return this;
        }
    }

    // block or allow filter?
    // Important: this must be executed before parsing options
    if ( s.startsWith('@@') ) {
        this.action = AllowAction;
        s = s.slice(2);
    }

    // options
    // https://github.com/gorhill/uBlock/issues/842
    // - ensure sure we are not dealing with a regex-based filter.
    // - lookup the last occurrence of `$`.
    if ( s.startsWith('/') === false || s.endsWith('/') === false ) {
        pos = s.lastIndexOf('$');
        if ( pos !== -1 ) {
            // https://github.com/gorhill/uBlock/issues/952
            // Discard Adguard-specific `$$` filters.
            if ( s.indexOf('$$') !== -1 ) {
                this.unsupported = true;
                return this;
            }
            this.parseOptions(s.slice(pos + 1));
            s = s.slice(0, pos);
        }
    }

    // regex?
    if ( s.startsWith('/') && s.endsWith('/') && s.length > 2 ) {
        this.isRegex = true;
        this.f = s.slice(1, -1);
        // https://github.com/gorhill/uBlock/issues/1246
        // If the filter is valid, use the corrected version of the source
        // string -- this ensure reverse-lookup will work fine.
        this.f = normalizeRegexSource(this.f);
        if ( this.f === '' ) {
            console.error(
                "uBlock Origin> discarding bad regular expression-based network filter '%s': '%s'",
                raw,
                normalizeRegexSource.message
            );
            this.unsupported = true;
        }
        return this;
    }

    // hostname-anchored
    if ( s.startsWith('||') ) {
        this.anchor |= 0x4;
        s = s.slice(2);

        // convert hostname to punycode if needed
        // https://github.com/gorhill/uBlock/issues/2599
        if ( this.reHasUnicode.test(s) ) {
            var matches = this.reIsolateHostname.exec(s);
            if ( matches ) {
                s = (matches[1] !== undefined ? matches[1] : '') +
                    punycode.toASCII(matches[2]) +
                    matches[3];
                //console.debug('µBlock.staticNetFilteringEngine/FilterParser.parse():', raw, '=', s);
            }
        }

        // https://github.com/chrisaljoudi/uBlock/issues/1096
        if ( s.startsWith('^') ) {
            this.unsupported = true;
            return this;
        }

        // plain hostname? (from ABP filter list)
        // https://github.com/gorhill/uBlock/issues/1757
        // A filter can't be a pure-hostname one if there is a domain or csp
        // option present.
        if ( this.reHostnameRule2.test(s) ) {
            this.f = s.replace(this.reCleanupHostnameRule2, '');
            this.hostnamePure = true;
            return this;
        }
    }
    // left-anchored
    else if ( s.startsWith('|') ) {
        this.anchor |= 0x2;
        s = s.slice(1);
    }

    // right-anchored
    if ( s.endsWith('|') ) {
        this.anchor |= 0x1;
        s = s.slice(0, -1);
    }

    // normalize placeholders
    if ( this.reHasWildcard.test(s) ) {
        // remove pointless leading *
        // https://github.com/gorhill/uBlock/issues/1669#issuecomment-224822448
        // Keep the leading asterisk if we are dealing with a hostname-anchored
        // filter, this will ensure the generic filter implementation is
        // used.
        if ( s.startsWith('*') && (this.anchor & 0x4) ) {
            s = s.replace(/^\*+([^%0-9a-z])/, '$1');
        }
        // remove pointless trailing *
        if ( s.endsWith('*') ) {
            s = s.replace(/([^%0-9a-z])\*+$/, '$1');
        }
    }

    // nothing left?
    if ( s === '' ) {
        s = '*';
    }

    // https://github.com/gorhill/uBlock/issues/1047
    // Hostname-anchored makes no sense if matching all requests.
    if ( s === '*' ) {
        this.anchor = 0;
    }

    // This might look weird but we gain memory footprint by not going through
    // toLowerCase(), at least on Chromium. Because copy-on-write?

    this.f = this.reHasUppercase.test(s) ? s.toLowerCase() : s;

    // Convenience:
    //   Convert special broad filters for non-webRequest aware types into
    //   `csp` filters wherever possible.
    if ( this.anchor & 0x2 && this.party === 0 ) {
        this.translate();
    }

    return this;
};

/******************************************************************************/

// Given a string, find a good token. Tokens which are too generic, i.e. very
// common with a high probability of ending up as a miss, are not
// good. Avoid if possible. This has a *significant* positive impact on
// performance.
// These "bad tokens" are collated manually.

// Hostname-anchored with no wildcard always have a token index of 0.
var reHostnameToken = /^[0-9a-z]+/;
var reGoodToken = /[%0-9a-z]{2,}/g;

var badTokens = new Set([
    'com',
    'http',
    'https',
    'icon',
    'images',
    'img',
    'js',
    'net',
    'news',
    'www'
]);

var findFirstGoodToken = function(s) {
    reGoodToken.lastIndex = 0;
    var matches, lpos;
    var badTokenMatch = null;
    while ( (matches = reGoodToken.exec(s)) !== null ) {
        // https://github.com/gorhill/uBlock/issues/997
        // Ignore token if preceded by wildcard.
        lpos = matches.index;
        if ( lpos !== 0 && s.charCodeAt(lpos - 1) === 0x2A /* '*' */ ) {
            continue;
        }
        if ( s.charCodeAt(reGoodToken.lastIndex) === 0x2A /* '*' */ ) {
            continue;
        }
        if ( badTokens.has(matches[0]) ) {
            if ( badTokenMatch === null ) {
                badTokenMatch = matches;
            }
            continue;
        }
        return matches;
    }
    return badTokenMatch;
};

var findHostnameToken = function(s) {
    return reHostnameToken.exec(s);
};

/******************************************************************************/

FilterParser.prototype.makeToken = function() {
    // https://github.com/chrisaljoudi/uBlock/issues/1038
    // Single asterisk will match any URL.
    if ( this.isRegex || this.f === '*' ) {
        return;
    }
    var matches = this.anchor & 0x4 && this.f.indexOf('*') === -1 ?
        findHostnameToken(this.f) :
        findFirstGoodToken(this.f);

    if ( matches !== null ) {
        this.token = matches[0];
        this.tokenHash = µb.urlTokenizer.tokenHashFromString(this.token);
        this.tokenBeg = matches.index;
    }
};

/******************************************************************************/
/******************************************************************************/

var FilterContainer = function() {
    this.reIsGeneric = /[\^\*]/;
    this.filterParser = new FilterParser();
    this.urlTokenizer = µb.urlTokenizer;
    this.noTokenHash = this.urlTokenizer.tokenHashFromString('*');
    this.dotTokenHash = this.urlTokenizer.tokenHashFromString('.');
    this.exportedDotTokenHash = exportInt(this.dotTokenHash);
    this.reset();
};

/******************************************************************************/

// Reset all, thus reducing to a minimum memory footprint of the context.

FilterContainer.prototype.reset = function() {
    this.frozen = false;
    this.processedFilterCount = 0;
    this.acceptedCount = 0;
    this.rejectedCount = 0;
    this.allowFilterCount = 0;
    this.blockFilterCount = 0;
    this.discardedCount = 0;
    this.badFilters = new Set();
    this.duplicateBuster = new Set();
    this.categories = new Map();
    this.dataFilters = new Map();
    this.filterParser.reset();

    // Reuse filter instances whenever possible at load time.
    this.fclassLast = null;
    this.fdataLast = null;
    this.filterLast = null;

    // Runtime registers
    this.cbRegister = undefined;
    this.thRegister = undefined;
    this.fRegister = null;
};

/******************************************************************************/

FilterContainer.prototype.freeze = function() {
    histogram('allFilters', this.categories);
    this.removeBadFilters();
    this.duplicateBuster = new Set();
    this.filterParser.reset();
    this.fclassLast = null;
    this.fdataLast = null;
    this.filterLast = null;
    this.frozen = true;
    //console.log(JSON.stringify(Array.from(filterClassHistogram)));
    //this.tokenHistogram = new Map(Array.from(this.tokenHistogram).sort(function(a, b) {
    //    return a[0].localeCompare(b[0]) || (b[1] - a[1]);
    //}));
};

/******************************************************************************/

FilterContainer.prototype.toSelfie = function() {
    var categoryToSelfie = function(map) {
        var selfie = [];
        for ( var entry of map ) {
            selfie.push('k2\t' + exportInt(entry[0])); // token hash
            selfie.push(entry[1].compile());
        }
        return selfie.join('\n');
    };

    var categoriesToSelfie = function(map) {
        var selfie = [];
        for ( var entry of map ) {
            selfie.push('k1\t' + exportInt(entry[0])); // category bits
            selfie.push(categoryToSelfie(entry[1]));
        }
        return selfie.join('\n');
    };

    var dataFiltersToSelfie = function(dataFilters) {
        var selfie = [];
        for ( var entry of dataFilters.values() ) {
            do {
                selfie.push(entry.compile());
                entry = entry.next;
            } while ( entry !== undefined );
        }
        return selfie;
    };

    return {
        processedFilterCount: this.processedFilterCount,
        acceptedCount: this.acceptedCount,
        rejectedCount: this.rejectedCount,
        allowFilterCount: this.allowFilterCount,
        blockFilterCount: this.blockFilterCount,
        discardedCount: this.discardedCount,
        categories: categoriesToSelfie(this.categories),
        dataFilters: dataFiltersToSelfie(this.dataFilters)
    };
};

/******************************************************************************/

FilterContainer.prototype.fromSelfie = function(selfie) {
    this.frozen = true;
    this.processedFilterCount = selfie.processedFilterCount;
    this.acceptedCount = selfie.acceptedCount;
    this.rejectedCount = selfie.rejectedCount;
    this.allowFilterCount = selfie.allowFilterCount;
    this.blockFilterCount = selfie.blockFilterCount;
    this.discardedCount = selfie.discardedCount;

    var categoryBits, tokenHash,
        map = this.categories, submap,
        lineIter = new µb.LineIterator(selfie.categories),
        line;
    while ( lineIter.eot() === false ) {
        line = lineIter.next();
        if ( line.startsWith('k1\t') ) {   // category bits
            categoryBits = importInt(line.slice(3));
            submap = new Map();
            map.set(categoryBits, submap);
            continue;
        }
        if ( line.startsWith('k2\t') ) {   // token hash
            tokenHash = importInt(line.slice(3));
            continue;
        }
        submap.set(tokenHash, filterFromCompiledData(line));
    }

    var i = selfie.dataFilters.length,
        entry, bucket;
    while ( i-- ) {
        entry = FilterDataHolderEntry.load(selfie.dataFilters[i]);
        bucket = this.dataFilters.get(entry.tokenHash);
        if ( bucket !== undefined ) {
            entry.next = bucket;
        }
        this.dataFilters.set(entry.tokenHash, entry);
    }
};

/******************************************************************************/

FilterContainer.prototype.compile = function(raw, out) {
    // ORDER OF TESTS IS IMPORTANT!

    // Ignore empty lines
    var s = raw.trim();
    if ( s.length === 0 ) {
        return false;
    }

    var parsed = this.filterParser.parse(s);

    // Ignore element-hiding filters
    if ( parsed.elemHiding ) {
        return false;
    }

    // Ignore filters with unsupported options
    if ( parsed.unsupported ) {
        µb.logger.writeOne('', 'error', 'Network filtering – invalid filter: ' + raw);
        return false;
    }

    // Pure hostnames, use more efficient dictionary lookup
    // https://github.com/chrisaljoudi/uBlock/issues/665
    // Create a dict keyed on request type etc.
    if (
        parsed.hostnamePure &&
        parsed.domainOpt === '' &&
        parsed.dataType === undefined &&
        this.compileHostnameOnlyFilter(parsed, out)
    ) {
        return true;
    }

    parsed.makeToken();

    var fdata = '';
    if ( parsed.dataType !== undefined ) {
        if ( fdata !== '' ) { fdata += '\v'; }
        fdata += FilterDataHolder.compile(parsed);
    }
    if ( parsed.domainOpt !== '' ) {
        if ( fdata !== '' ) { fdata += '\v'; }
        fdata += FilterOrigin.compile(parsed);
    }
    if ( fdata !== '' ) { fdata += '\v'; }
    if ( parsed.isRegex ) {
        fdata += FilterRegex.compile(parsed);
    } else if ( parsed.hostnamePure ) {
        fdata += FilterPlainHostname.compile(parsed);
    } else if ( parsed.f === '*' ) {
        fdata += FilterTrue.compile();
    } else if ( parsed.anchor === 0x5 ) {
        // https://github.com/gorhill/uBlock/issues/1669
        fdata += FilterGenericHnAndRightAnchored.compile(parsed);
    } else if (
        this.reIsGeneric.test(parsed.f) ||
        parsed.tokenHash === parsed.noTokenHash
    ) {
        if ( parsed.anchor === 0x4 ) {
            fdata += FilterGenericHnAnchored.compile(parsed);
        } else {
            fdata += FilterGeneric.compile(parsed);
        }
    } else if ( parsed.anchor === 0x4 ) {
        fdata += FilterPlainHnAnchored.compile(parsed);
    } else if ( parsed.anchor === 0x2 ) {
        fdata += FilterPlainLeftAnchored.compile(parsed);
    } else if ( parsed.anchor === 0x1 ) {
        fdata += FilterPlainRightAnchored.compile(parsed);
    } else if ( parsed.tokenBeg === 0 ) {
        fdata += FilterPlainPrefix0.compile(parsed);
    } else if ( parsed.tokenBeg === 1 ) {
        fdata += FilterPlainPrefix1.compile(parsed);
    } else {
        fdata += FilterPlain.compile(parsed);
    }

    this.compileToAtomicFilter(fdata, parsed, out);

    return true;
};

/******************************************************************************/

// Using fast/compact dictionary when filter is a (or portion of) pure hostname.

FilterContainer.prototype.compileHostnameOnlyFilter = function(parsed, out) {
    // Can't fit the filter in a pure hostname dictionary.
    // https://github.com/gorhill/uBlock/issues/1757
    // This should no longer happen with fix to above issue.
    //if ( parsed.domainOpt.length !== 0 ) {
    //    return;
    //}

    var route = parsed.badFilter ? 0x01 : 0x00,
        categoryBits = parsed.action | parsed.important | parsed.party;

    var type = parsed.types;
    if ( type === 0 ) {
        out.push(
            route,
            exportInt(categoryBits) + '\v' +
            this.exportedDotTokenHash + '\v' +
            parsed.f
        );
        return true;
    }

    var bitOffset = 1;
    do {
        if ( type & 1 ) {
            out.push(
                route,
                exportInt(categoryBits | (bitOffset << 4)) + '\v' +
                this.exportedDotTokenHash + '\v' +
                parsed.f
            );
        }
        bitOffset += 1;
        type >>>= 1;
    } while ( type !== 0 );
    return true;
};

/******************************************************************************/

FilterContainer.prototype.compileToAtomicFilter = function(fdata, parsed, out) {
    var route = parsed.badFilter ? 0x01 : 0x00,
        categoryBits = parsed.action | parsed.important | parsed.party,
        type = parsed.types;
    if ( type === 0 ) {
        out.push(
            route,
            exportInt(categoryBits) + '\v' +
            exportInt(parsed.tokenHash) + '\v' +
            fdata
        );
        return;
    }
    var bitOffset = 1;
    do {
        if ( type & 1 ) {
            out.push(
                route,
                exportInt(categoryBits | (bitOffset << 4)) + '\v' +
                exportInt(parsed.tokenHash) + '\v' +
                fdata
            );
        }
        bitOffset += 1;
        type >>>= 1;
    } while ( type !== 0 );

    // Only static filter with an explicit type can be redirected. If we reach
    // this point, it's because there is one or more explicit type.
    if ( !parsed.redirect ) {
        return;
    }

    if ( parsed.badFilter ) {
        return;
    }

    var redirects = µb.redirectEngine.compileRuleFromStaticFilter(parsed.raw);
    if ( Array.isArray(redirects) === false ) {
        return;
    }
    var i = redirects.length;
    while ( i-- ) {
        out.push(0, '\v\v=>\t' + redirects[i]);
    }
};

/******************************************************************************/

FilterContainer.prototype.fromCompiledContent = function(lineIter) {
    var line, lineBits, categoryBits, tokenHash, fdata,
        bucket, entry, filter,
        fieldIter = new µb.FieldIterator('\v'),
        dataFilterFid = FilterDataHolder.fidPrefix,
        buckerFilterFid = FilterBucket.fidPrefix,
        aCharCode = 'a'.charCodeAt(0);

    while ( lineIter.eot() === false ) {
        lineBits = lineIter.charCodeAt(0) - aCharCode;
        if ( (lineBits & 0x04) !== 0 ) {
            return;
        }
        line = lineIter.next(1);
        if ( (lineBits & 0x02) !== 0 ) {
            line = decodeURIComponent(line);
        }
        if ( (lineBits & 0x01) !== 0 ) {
            this.badFilters.add(line);
            continue;
        }

        categoryBits = importInt(fieldIter.first(line));
        tokenHash = importInt(fieldIter.next());
        fdata = fieldIter.remainder();

        // Special cases: delegate to more specialized engines.
        // Redirect engine.
        if ( fdata.startsWith('=>\t') ) {
            µb.redirectEngine.fromCompiledRule(fdata.slice(3));
            continue;
        }

        // Plain static filters.
        this.acceptedCount += 1;

        // Special treatment: data-holding filters are stored separately
        // because they require special matching algorithm (unlike other
        // filters, ALL hits must be reported).
        if ( fdata.startsWith(dataFilterFid) ) {
            if ( this.duplicateBuster.has(line) ) {
                this.discardedCount += 1;
                continue;
            }
            this.duplicateBuster.add(line);
            entry = new FilterDataHolderEntry(categoryBits, tokenHash, fdata);
            bucket = this.dataFilters.get(tokenHash);
            if ( bucket !== undefined ) {
                entry.next = bucket;
            }
            this.dataFilters.set(tokenHash, entry);
            continue;
        }

        bucket = this.categories.get(categoryBits);
        if ( bucket === undefined ) {
            bucket = new Map();
            this.categories.set(categoryBits, bucket);
        }
        entry = bucket.get(tokenHash);

        if ( tokenHash === this.dotTokenHash ) {
            if ( entry === undefined ) {
                entry = new FilterHostnameDict();
                bucket.set(this.dotTokenHash, entry);
            }
            if ( entry.add(fdata) === false ) {
                this.discardedCount += 1;
            }
            continue;
        }

        if ( this.duplicateBuster.has(line) ) {
            this.discardedCount += 1;
            continue;
        }
        this.duplicateBuster.add(line);

        //this.tokenHistogram.set(tokenHash, (this.tokenHistogram.get(tokenHash) || 0) + 1);

        filter = filterFromCompiledData(fdata);
        if ( entry === undefined ) {
            bucket.set(tokenHash, filter);
            continue;
        }
        if ( entry.fidPrefix === buckerFilterFid ) {
            entry.add(filter);
            continue;
        }
        bucket.set(tokenHash, new FilterBucket(entry, filter));
    }
};

//FilterContainer.prototype.tokenHistogram = new Map();

/******************************************************************************/

FilterContainer.prototype.removeBadFilters = function() {
    var lines = µb.setToArray(this.badFilters),
        fieldIter = new µb.FieldIterator('\v'),
        categoryBits, tokenHash, fdata, bucket, entry,
        i = lines.length;
    while ( i-- ) {
        categoryBits = importInt(fieldIter.first(lines[i]));
        bucket = this.categories.get(categoryBits);
        if ( bucket === undefined ) {
            continue;
        }
        tokenHash = importInt(fieldIter.next());
        entry = bucket.get(tokenHash);
        if ( entry === undefined ) {
            continue;
        }
        fdata = fieldIter.remainder();
        if ( entry instanceof FilterBucket ) {
            entry.remove(fdata);
            if ( entry.filters.length === 1 ) {
                bucket.set(tokenHash, entry.filters[0]);
            }
            continue;
        }
        if ( entry instanceof FilterHostnameDict ) {
            entry.remove(fdata);
            if ( entry.size === 0 ) {
                bucket.delete(tokenHash);
                if ( bucket.size === 0 ) {
                    this.categories.delete(categoryBits);
                }
            }
            continue;
        }
        if ( entry.compile() === fdata ) {
            bucket.delete(tokenHash);
            if ( bucket.size === 0 ) {
                this.categories.delete(categoryBits);
            }
            continue;
        }
    }
};

/******************************************************************************/

FilterContainer.prototype.matchAndFetchData = function(dataType, requestURL, out, outlog) {
    if ( this.dataFilters.length === 0 ) { return; }

    var url = this.urlTokenizer.setURL(requestURL);

    requestHostnameRegister = µb.URI.hostnameFromURI(url);

    // We need to visit ALL the matching filters.
    var toAddImportant = new Map(),
        toAdd = new Map(),
        toRemove = new Map();

    var entry, f,
        tokenHashes = this.urlTokenizer.getTokens(),
        tokenHash, tokenOffset,
        i = 0;
    while ( i < 32 ) {
        tokenHash = tokenHashes[i++];
        if ( tokenHash === 0 ) { break; }
        tokenOffset = tokenHashes[i++];
        entry = this.dataFilters.get(tokenHash);
        while ( entry !== undefined ) {
            f = entry.filter;
            if ( f.match(url, tokenOffset) === true ) {
                if ( entry.categoryBits & 0x001 ) {
                    toRemove.set(f.dataStr, entry);
                } else if ( entry.categoryBits & 0x002 ) {
                    toAddImportant.set(f.dataStr, entry);
                } else {
                    toAdd.set(f.dataStr, entry);
                }
            }
            entry = entry.next;
        }
    }
    entry = this.dataFilters.get(this.noTokenHash);
    while ( entry !== undefined ) {
        f = entry.filter;
        if ( f.match(url) === true ) {
            if ( entry.categoryBits & 0x001 ) {
                toRemove.set(f.dataStr, entry);
            } else if ( entry.categoryBits & 0x002 ) {
                toAddImportant.set(f.dataStr, entry);
            } else {
                toAdd.set(f.dataStr, entry);
            }
        }
        entry = entry.next;
    }

    if ( toAddImportant.size === 0 && toAdd.size === 0 ) { return; }

    // Remove entries overriden by other filters.
    var key;
    for ( key of toAddImportant.keys() ) {
        toAdd.delete(key);
        toRemove.delete(key);
    }
    for ( key of toRemove.keys() ) {
        if ( key === '' ) {
            toAdd.clear();
            break;
        }
        toAdd.delete(key);
    }

    var logData;
    for ( entry of toAddImportant ) {
        out.push(entry[0]);
        if ( outlog === undefined ) { continue; }
        logData = entry[1].logData();
        logData.source = 'static';
        logData.result = 1;
        outlog.push(logData);
    }
    for ( entry of toAdd ) {
        out.push(entry[0]);
        if ( outlog === undefined ) { continue; }
        logData = entry[1].logData();
        logData.source = 'static';
        logData.result = 1;
        outlog.push(logData);
    }
    if ( outlog !== undefined ) {
        for ( entry of toRemove.values()) {
            logData = entry.logData();
            logData.source = 'static';
            logData.result = 2;
            outlog.push(logData);
        }
    }
};

/******************************************************************************/

// bucket: Map
// url: string

FilterContainer.prototype.matchTokens = function(bucket, url) {
    // Hostname-only filters
    var f = bucket.get(this.dotTokenHash);
    if ( f !== undefined && f.match() ) {
        this.thRegister = this.dotTokenHash;
        this.fRegister = f;
        return true;
    }

    var tokenHashes = this.urlTokenizer.getTokens(),
        tokenHash, tokenOffset,
        i = 0;
    for (;;) {
        tokenHash = tokenHashes[i++];
        if ( tokenHash === 0 ) { break; }
        tokenOffset = tokenHashes[i++];
        f = bucket.get(tokenHash);
        if ( f !== undefined && f.match(url, tokenOffset) === true ) {
            this.thRegister = tokenHash;
            this.fRegister = f;
            return true;
        }
    }

    // Untokenizable filters
    f = bucket.get(this.noTokenHash);
    if ( f !== undefined && f.match(url) === true ) {
        this.thRegister = this.noTokenHash;
        this.fRegister = f;
        return true;
    }

    return false;
};

/******************************************************************************/

// Specialized handlers

// https://github.com/gorhill/uBlock/issues/1477
//   Special case: blocking-generichide filter ALWAYS exists, it is implicit --
//   thus we always first check for exception filters, then for important block
//   filter if and only if there was a hit on an exception filter.
// https://github.com/gorhill/uBlock/issues/2103
//   User may want to override `generichide` exception filters.

FilterContainer.prototype.matchStringGenericHide = function(context, requestURL) {
    var url = this.urlTokenizer.setURL(requestURL);

    // https://github.com/gorhill/uBlock/issues/2225
    //   Important: this is used by FilterHostnameDict.match().
    requestHostnameRegister = µb.URI.hostnameFromURI(url);

    var bucket = this.categories.get(genericHideException);
    if ( !bucket || this.matchTokens(bucket, url) === false ) {
        this.fRegister = null;
        return 0;
    }

    bucket = this.categories.get(genericHideImportant);
    if ( bucket && this.matchTokens(bucket, url) ) {
        this.cbRegister = genericHideImportant;
        return 1;
    }

    this.cbRegister = genericHideException;
    return 2;
};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/116
//   Some type of requests are exceptional, they need custom handling,
//   not the generic handling.

FilterContainer.prototype.matchStringExactType = function(context, requestURL, requestType) {
    // Special cases.
    if ( requestType === 'generichide' ) {
        return this.matchStringGenericHide(context, requestURL);
    }
    var type = typeNameToTypeValue[requestType];
    if ( type === undefined ) {
        return 0;
    }

    // Prime tokenizer: we get a normalized URL in return.
    var url = this.urlTokenizer.setURL(requestURL);

    // These registers will be used by various filters
    pageHostnameRegister = context.pageHostname || '';
    requestHostnameRegister = µb.URI.hostnameFromURI(url);

    var party = isFirstParty(context.pageDomain, requestHostnameRegister) ? FirstParty : ThirdParty,
        categories = this.categories,
        catBits, bucket;

    this.fRegister = null;

    // https://github.com/chrisaljoudi/uBlock/issues/139
    //   Test against important block filters
    catBits = BlockAnyParty | Important | type;
    if ( (bucket = categories.get(catBits)) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.cbRegister = catBits;
            return 1;
        }
    }
    catBits = BlockAction | Important | type | party;
    if ( (bucket = categories.get(catBits)) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.cbRegister = catBits;
            return 1;
        }
    }

    // Test against block filters
    catBits = BlockAnyParty | type;
    if ( (bucket = categories.get(catBits)) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.cbRegister = catBits;
        }
    }
    if ( this.fRegister === null ) {
        catBits = BlockAction | type | party;
        if ( (bucket = categories.get(catBits)) ) {
            if ( this.matchTokens(bucket, url) ) {
                this.cbRegister = catBits;
            }
        }
    }

    // If there is no block filter, no need to test against allow filters
    if ( this.fRegister === null ) {
        return 0;
    }

    // Test against allow filters
    catBits = AllowAnyParty | type;
    if ( (bucket = categories.get(catBits)) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.cbRegister = catBits;
            return 2;
        }
    }
    catBits = AllowAction | type | party;
    if ( (bucket = categories.get(catBits)) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.cbRegister = catBits;
            return 2;
        }
    }

    return 1;
};

/******************************************************************************/

FilterContainer.prototype.matchString = function(context) {
    // https://github.com/chrisaljoudi/uBlock/issues/519
    // Use exact type match for anything beyond `other`
    // Also, be prepared to support unknown types
    var type = typeNameToTypeValue[context.requestType];
    if ( type === undefined ) {
         type = otherTypeBitValue;
    } else if ( type === 0 || type > otherTypeBitValue ) {
        return this.matchStringExactType(context, context.requestURL, context.requestType);
    }

    // The logic here is simple:
    //
    // block = !whitelisted &&  blacklisted
    //   or equivalent
    // allow =  whitelisted || !blacklisted

    // Statistically, hits on a URL in order of likelihood:
    // 1. No hit
    // 2. Hit on a block filter
    // 3. Hit on an allow filter
    //
    // High likelihood of "no hit" means to optimize we need to reduce as much
    // as possible the number of filters to test.
    //
    // Then, because of the order of probabilities, we should test only
    // block filters first, and test allow filters if and only if there is a
    // hit on a block filter. Since there is a high likelihood of no hit,
    // testing allow filter by default is likely wasted work, hence allow
    // filters are tested *only* if there is a (unlikely) hit on a block
    // filter.

    // Prime tokenizer: we get a normalized URL in return.
    var url = this.urlTokenizer.setURL(context.requestURL);

    // These registers will be used by various filters
    pageHostnameRegister = context.pageHostname || '';
    requestHostnameRegister = context.requestHostname;

    this.fRegister = null;

    var party = isFirstParty(context.pageDomain, context.requestHostname)
        ? FirstParty
        : ThirdParty;
    var categories = this.categories,
        catBits, bucket;

    // https://github.com/chrisaljoudi/uBlock/issues/139
    // Test against important block filters.
    // The purpose of the `important` option is to reverse the order of
    // evaluation. Normally, it is "evaluate block then evaluate allow", with
    // the `important` property it is "evaluate allow then evaluate block".
    catBits = BlockAnyTypeAnyParty | Important;
    if ( (bucket = categories.get(catBits)) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.cbRegister = catBits;
            return 1;
        }
    }
    catBits = BlockAnyType | Important | party;
    if ( (bucket = categories.get(catBits)) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.cbRegister = catBits;
            return 1;
        }
    }
    catBits = BlockAnyParty | Important | type;
    if ( (bucket = categories.get(catBits)) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.cbRegister = catBits;
            return 1;
        }
    }
    catBits = BlockAction | Important | type | party;
    if ( (bucket = categories.get(catBits)) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.cbRegister = catBits;
            return 1;
        }
    }

    // Test against block filters
    catBits = BlockAnyTypeAnyParty;
    if ( (bucket = categories.get(catBits)) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.cbRegister = catBits;
        }
    }
    if ( this.fRegister === null ) {
        catBits = BlockAnyType | party;
        if ( (bucket = categories.get(catBits)) ) {
            if ( this.matchTokens(bucket, url) ) {
                this.cbRegister = catBits;
            }
        }
        if ( this.fRegister === null ) {
            catBits = BlockAnyParty | type;
            if ( (bucket = categories.get(catBits)) ) {
                if ( this.matchTokens(bucket, url) ) {
                    this.cbRegister = catBits;
                }
            }
            if ( this.fRegister === null ) {
                catBits = BlockAction | type | party;
                if ( (bucket = categories.get(catBits)) ) {
                    if ( this.matchTokens(bucket, url) ) {
                        this.cbRegister = catBits;
                    }
                }
            }
        }
    }

    // If there is no block filter, no need to test against allow filters
    if ( this.fRegister === null ) {
        return 0;
    }

    // Test against allow filters
    catBits = AllowAnyTypeAnyParty;
    if ( (bucket = categories.get(catBits)) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.cbRegister = catBits;
            return 2;
        }
    }
    catBits = AllowAnyType | party;
    if ( (bucket = categories.get(catBits)) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.cbRegister = catBits;
            return 2;
        }
    }
    catBits = AllowAnyParty | type;
    if ( (bucket = categories.get(catBits)) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.cbRegister = catBits;
            return 2;
        }
    }
    catBits = AllowAction | type | party;
    if ( (bucket = categories.get(catBits)) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.cbRegister = catBits;
            return 2;
        }
    }

    return 1;
};

/******************************************************************************/

FilterContainer.prototype.toLogData = function() {
    if ( this.fRegister === null ) { return; }
    var logData = toLogDataInternal(this.cbRegister, this.thRegister, this.fRegister);
    logData.source = 'static';
    logData.tokenHash = this.thRegister;
    logData.result = this.fRegister === null ? 0 : (this.cbRegister & 1 ? 2 : 1);
    return logData;
};

/******************************************************************************/

FilterContainer.prototype.getFilterCount = function() {
    return this.acceptedCount - this.discardedCount;
};

/******************************************************************************/

return new FilterContainer();

/******************************************************************************/

})();

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

/* jshint bitwise: false */
/* global punycode, hnTrieManager */

'use strict';

/******************************************************************************/

µBlock.staticNetFilteringEngine = (function(){

/******************************************************************************/

const µb = µBlock;

// fedcba9876543210
//       |    | |||
//       |    | |||
//       |    | |||
//       |    | |||
//       |    | ||+---- bit    0: [BlockAction | AllowAction]
//       |    | |+----- bit    1: `important`
//       |    | +------ bit 2- 3: party [0 - 3]
//       |    +-------- bit 4- 8: type [0 - 31]
//       +------------- bit 9-15: unused

const BlockAction = 0 << 0;
const AllowAction = 1 << 0;
const Important   = 1 << 1;
const AnyParty    = 0 << 2;
const FirstParty  = 1 << 2;
const ThirdParty  = 2 << 2;

const AnyType = 0 << 4;
const typeNameToTypeValue = {
           'no_type':  0 << 4,
        'stylesheet':  1 << 4,
             'image':  2 << 4,
            'object':  3 << 4,
 'object_subrequest':  3 << 4,
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
       'inline-font': 15 << 4,
     'inline-script': 16 << 4,
              'data': 17 << 4,  // special: a generic data holder
          'redirect': 18 << 4,
            'webrtc': 19 << 4,
       'unsupported': 20 << 4
};
const otherTypeBitValue = typeNameToTypeValue.other;

const typeValueToTypeName = {
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
    15: 'inline-font',
    16: 'inline-script',
    17: 'data',
    18: 'redirect',
    19: 'webrtc',
    20: 'unsupported'
};

const BlockAnyTypeAnyParty = BlockAction | AnyType | AnyParty;
const BlockAnyType = BlockAction | AnyType;
const BlockAnyParty = BlockAction | AnyParty;

const AllowAnyTypeAnyParty = AllowAction | AnyType | AnyParty;
const AllowAnyType = AllowAction | AnyType;
const AllowAnyParty = AllowAction | AnyParty;

const genericHideException = AllowAction | AnyParty | typeNameToTypeValue.generichide,
      genericHideImportant = BlockAction | AnyParty | typeNameToTypeValue.generichide | Important;

// ABP filters: https://adblockplus.org/en/filters
// regex tester: http://regex101.com/

/******************************************************************************/

// See the following as short-lived registers, used during evaluation. They are
// valid until the next evaluation.

let pageHostnameRegister = '',
    requestHostnameRegister = '';
//var filterRegister = null;
//var categoryRegister = '';

// Local helpers

// Be sure to not confuse 'example.com' with 'anotherexample.com'
const isFirstParty = function(domain, hostname) {
    return hostname.endsWith(domain) &&
          (hostname.length === domain.length ||
           hostname.charCodeAt(hostname.length - domain.length - 1) === 0x2E /* '.' */);
};

const normalizeRegexSource = function(s) {
    try {
        const re = new RegExp(s);
        return re.source;
    } catch (ex) {
        normalizeRegexSource.message = ex.toString();
    }
    return '';
};

const rawToRegexStr = function(s, anchor) {
    // https://www.loggly.com/blog/five-invaluable-techniques-to-improve-regex-performance/
    // https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions
    // Also: remove leading/trailing wildcards -- there is no point.
    let reStr = s.replace(rawToRegexStr.escape1, '\\$&')
                 .replace(rawToRegexStr.escape2, '(?:[^%.0-9a-z_-]|$)')
                 .replace(rawToRegexStr.escape3, '')
                 .replace(rawToRegexStr.escape4, '[^ ]*?');
    if ( anchor & 0b100 ) {
        reStr = (
            reStr.startsWith('\\.') ?
                rawToRegexStr.reTextHostnameAnchor2 :
                rawToRegexStr.reTextHostnameAnchor1
        ) + reStr;
    } else if ( anchor & 0b010 ) {
        reStr = '^' + reStr;
    }
    if ( anchor & 0b001 ) {
        reStr += '$';
    }
    return reStr;
};
rawToRegexStr.escape1 = /[.+?${}()|[\]\\]/g;
rawToRegexStr.escape2 = /\^/g;
rawToRegexStr.escape3 = /^\*|\*$/g;
rawToRegexStr.escape4 = /\*/g;
rawToRegexStr.reTextHostnameAnchor1 = '^[a-z-]+://(?:[^/?#]+\\.)?';
rawToRegexStr.reTextHostnameAnchor2 = '^[a-z-]+://(?:[^/?#]+)?';

// https://github.com/uBlockOrigin/uAssets/issues/4083#issuecomment-436914727
const rawToPlainStr = function(s, anchor) {
    if (
        anchor === 0 &&
        s.charCodeAt(0) === 0x2F /* '/' */ &&
        s.length > 2 &&
        s.charCodeAt(s.length-1) === 0x2F /* '/' */
    ) {
        s = s + '*';
    }
    return s;
};

const filterDataSerialize = µb.CompiledLineIO.serialize;

const toLogDataInternal = function(categoryBits, tokenHash, filter) {
    if ( filter === null ) { return undefined; }
    let logData = filter.logData();
    logData.compiled = filterDataSerialize([
        categoryBits,
        tokenHash,
        logData.compiled
    ]);
    if ( categoryBits & 0x001 ) {
        logData.raw = '@@' + logData.raw;
    }
    let opts = [];
    if ( categoryBits & 0x002 ) {
        opts.push('important');
    }
    if ( categoryBits & 0x008 ) {
        opts.push('third-party');
    } else if ( categoryBits & 0x004 ) {
        opts.push('first-party');
    }
    let type = categoryBits & 0x1F0;
    if ( type !== 0 && type !== typeNameToTypeValue.data ) {
        opts.push(typeValueToTypeName[type >>> 4]);
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
const isHnAnchored = function(url, matchStart) {
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

const reURLPostHostnameAnchors = /[\/?#]/;

const arrayStrictEquals = function(a, b) {
    var n = a.length;
    if ( n !== b.length ) { return false; }
    var isArray, x, y;
    for ( var i = 0; i < n; i++ ) {
        x = a[i]; y = b[i];
        isArray = Array.isArray(x);
        if ( isArray !== Array.isArray(y) ) { return false; }
        if ( isArray === true ) {
            if ( arrayStrictEquals(x, y) === false ) { return false; }
        } else {
            if ( x !== y ) { return false; }
        }
    }
    return true;
};

/*******************************************************************************

    Each filter class will register itself in the map. A filter class
    id MUST always stringify to ONE single character.

    IMPORTANT: any change which modifies the mapping will have to be
    reflected with µBlock.systemSettings.compiledMagic.

**/

const filterClasses = [];
let   filterClassIdGenerator = 0;

const registerFilterClass = function(ctor) {
    let fid = filterClassIdGenerator++;
    ctor.fid = ctor.prototype.fid = fid;
    filterClasses[fid] = ctor;
};

const filterFromCompiledData = function(args) {
    return filterClasses[args[0]].load(args);
};

/******************************************************************************/

const FilterTrue = function() {
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
    return [ this.fid ];
};

FilterTrue.compile = function() {
    return [ FilterTrue.fid ];
};

FilterTrue.load = function() {
    return new FilterTrue();
};

registerFilterClass(FilterTrue);

/******************************************************************************/

const FilterPlain = function(s, tokenBeg) {
    this.s = s;
    this.tokenBeg = tokenBeg;
};

FilterPlain.prototype.match = function(url, tokenBeg) {
    return url.startsWith(this.s, tokenBeg - this.tokenBeg);
};

FilterPlain.prototype.logData = function() {
    return {
        raw: rawToPlainStr(this.s, 0),
        regex: rawToRegexStr(this.s, 0),
        compiled: this.compile()
    };
};

FilterPlain.prototype.compile = function() {
    return [ this.fid, this.s, this.tokenBeg ];
};

FilterPlain.compile = function(details) {
    return [ FilterPlain.fid, details.f, details.tokenBeg ];
};

FilterPlain.load = function(args) {
    return new FilterPlain(args[1], args[2]);
};

registerFilterClass(FilterPlain);

/******************************************************************************/

const FilterPlainPrefix0 = function(s) {
    this.s = s;
};

FilterPlainPrefix0.prototype.match = function(url, tokenBeg) {
    return url.startsWith(this.s, tokenBeg);
};

FilterPlainPrefix0.prototype.logData = function() {
    return {
        raw: this.s,
        regex: rawToRegexStr(this.s, 0),
        compiled: this.compile()
    };
};

FilterPlainPrefix0.prototype.compile = function() {
    return [ this.fid, this.s ];
};

FilterPlainPrefix0.compile = function(details) {
    return [ FilterPlainPrefix0.fid, details.f ];
};

FilterPlainPrefix0.load = function(args) {
    return new FilterPlainPrefix0(args[1]);
};

registerFilterClass(FilterPlainPrefix0);

/******************************************************************************/

const FilterPlainPrefix1 = function(s) {
    this.s = s;
};

FilterPlainPrefix1.prototype.match = function(url, tokenBeg) {
    return url.startsWith(this.s, tokenBeg - 1);
};

FilterPlainPrefix1.prototype.logData = function() {
    return {
        raw: rawToPlainStr(this.s, 0),
        regex: rawToRegexStr(this.s, 0),
        compiled: this.compile()
    };
};

FilterPlainPrefix1.prototype.compile = function() {
    return [ this.fid, this.s ];
};

FilterPlainPrefix1.compile = function(details) {
    return [ FilterPlainPrefix1.fid, details.f ];
};

FilterPlainPrefix1.load = function(args) {
    return new FilterPlainPrefix1(args[1]);
};

registerFilterClass(FilterPlainPrefix1);

/******************************************************************************/

const FilterPlainHostname = function(s) {
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
        regex: rawToRegexStr(this.s + '^', 0),
        compiled: this.compile()
    };
};

FilterPlainHostname.prototype.compile = function() {
    return [ this.fid, this.s ];
};

FilterPlainHostname.compile = function(details) {
    return [ FilterPlainHostname.fid, details.f ];
};

FilterPlainHostname.load = function(args) {
    return new FilterPlainHostname(args[1]);
};

registerFilterClass(FilterPlainHostname);

/******************************************************************************/

const FilterPlainLeftAnchored = function(s) {
    this.s = s;
};

FilterPlainLeftAnchored.prototype.match = function(url) {
    return url.startsWith(this.s);
};

FilterPlainLeftAnchored.prototype.logData = function() {
    return {
        raw: '|' + this.s,
        regex: rawToRegexStr(this.s, 0b010),
        compiled: this.compile()
    };
};

FilterPlainLeftAnchored.prototype.compile = function() {
    return [ this.fid, this.s ];
};

FilterPlainLeftAnchored.compile = function(details) {
    return [ FilterPlainLeftAnchored.fid, details.f ];
};

FilterPlainLeftAnchored.load = function(args) {
    return new FilterPlainLeftAnchored(args[1]);
};

registerFilterClass(FilterPlainLeftAnchored);

/******************************************************************************/

const FilterPlainRightAnchored = function(s) {
    this.s = s;
};

FilterPlainRightAnchored.prototype.match = function(url) {
    return url.endsWith(this.s);
};

FilterPlainRightAnchored.prototype.logData = function() {
    return {
        raw: this.s + '|',
        regex: rawToRegexStr(this.s, 0b001),
        compiled: this.compile()
    };
};

FilterPlainRightAnchored.prototype.compile = function() {
    return [ this.fid, this.s ];
};

FilterPlainRightAnchored.compile = function(details) {
    return [ FilterPlainRightAnchored.fid, details.f ];
};

FilterPlainRightAnchored.load = function(args) {
    return new FilterPlainRightAnchored(args[1]);
};

registerFilterClass(FilterPlainRightAnchored);

/******************************************************************************/

const FilterExactMatch = function(s) {
    this.s = s;
};

FilterExactMatch.prototype.match = function(url) {
    return url === this.s;
};

FilterExactMatch.prototype.logData = function() {
    return {
        raw: '|' + this.s + '|',
        regex: rawToRegexStr(this.s, 0b011),
        compiled: this.compile()
    };
};

FilterExactMatch.prototype.compile = function() {
    return [ this.fid, this.s ];
};

FilterExactMatch.compile = function(details) {
    return [ FilterExactMatch.fid, details.f ];
};

FilterExactMatch.load = function(args) {
    return new FilterExactMatch(args[1]);
};

registerFilterClass(FilterExactMatch);

/******************************************************************************/

const FilterPlainHnAnchored = function(s) {
    this.s = s;
};

FilterPlainHnAnchored.prototype.match = function(url, tokenBeg) {
    return url.startsWith(this.s, tokenBeg) &&
           isHnAnchored(url, tokenBeg);
};

FilterPlainHnAnchored.prototype.logData = function() {
    return {
        raw: '||' + this.s,
        regex: rawToRegexStr(this.s, 0),
        compiled: this.compile()
    };
};

FilterPlainHnAnchored.prototype.compile = function() {
    return [ this.fid, this.s ];
};

FilterPlainHnAnchored.compile = function(details) {
    return [ FilterPlainHnAnchored.fid, details.f ];
};

FilterPlainHnAnchored.load = function(args) {
    return new FilterPlainHnAnchored(args[1]);
};

registerFilterClass(FilterPlainHnAnchored);

/******************************************************************************/

const FilterGeneric = function(s, anchor) {
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
        raw: rawToPlainStr(this.s, this.anchor),
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
    return [ this.fid, this.s, this.anchor ];
};

FilterGeneric.compile = function(details) {
    return [ FilterGeneric.fid, details.f, details.anchor ];
};

FilterGeneric.load = function(args) {
    return new FilterGeneric(args[1], args[2]);
};

registerFilterClass(FilterGeneric);

/******************************************************************************/

const FilterGenericHnAnchored = function(s) {
    this.s = s;
};

FilterGenericHnAnchored.prototype.re = null;
FilterGenericHnAnchored.prototype.anchor = 0x4;

FilterGenericHnAnchored.prototype.match = function(url) {
    if ( this.re === null ) {
        this.re = new RegExp(rawToRegexStr(this.s, this.anchor));
    }
    return this.re.test(url);
};

FilterGenericHnAnchored.prototype.logData = function() {
    var out = {
        raw: '||' + this.s,
        regex: rawToRegexStr(this.s, this.anchor & 0b001),
        compiled: this.compile()
    };
    return out;
};

FilterGenericHnAnchored.prototype.compile = function() {
    return [ this.fid, this.s ];
};

FilterGenericHnAnchored.compile = function(details) {
    return [ FilterGenericHnAnchored.fid, details.f ];
};

FilterGenericHnAnchored.load = function(args) {
    return new FilterGenericHnAnchored(args[1]);
};

registerFilterClass(FilterGenericHnAnchored);

/******************************************************************************/

const FilterGenericHnAndRightAnchored = function(s) {
    FilterGenericHnAnchored.call(this, s);
};

FilterGenericHnAndRightAnchored.prototype = Object.create(
    FilterGenericHnAnchored.prototype,
    {
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
                return [ this.fid, this.s ];
            }
        }
    }
);

FilterGenericHnAndRightAnchored.compile = function(details) {
    return [ FilterGenericHnAndRightAnchored.fid, details.f ];
};

FilterGenericHnAndRightAnchored.load = function(args) {
    return new FilterGenericHnAndRightAnchored(args[1]);
};

registerFilterClass(FilterGenericHnAndRightAnchored);

/******************************************************************************/

const FilterRegex = function(s) {
    this.re = s;
};

FilterRegex.prototype.match = function(url) {
    if ( typeof this.re === 'string' ) {
        this.re = new RegExp(this.re, 'i');
    }
    return this.re.test(url);
};

FilterRegex.prototype.logData = function() {
    var s = typeof this.re === 'string' ? this.re : this.re.source;
    return {
        raw: '/' + s + '/',
        regex: s,
        compiled: this.compile()
    };
};

FilterRegex.prototype.compile = function() {
    return [
        this.fid,
        typeof this.re === 'string' ? this.re : this.re.source
    ];
};

FilterRegex.compile = function(details) {
    return [ FilterRegex.fid, details.f ];
};

FilterRegex.load = function(args) {
    return new FilterRegex(args[1]);
};

registerFilterClass(FilterRegex);

/******************************************************************************/

// Filtering according to the origin.

const FilterOrigin = function() {
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
    out.compiled = [ this.fid, domainOpt, out.compiled ];
    if ( out.opts === undefined ) {
        out.opts = 'domain=' + domainOpt;
    } else {
        out.opts += ',domain=' + domainOpt;
    }
    return out;
};

FilterOrigin.prototype.compile = function() {
    return [ this.fid, this.toDomainOpt(), this.wrapped.compile() ];
};

// *** start of specialized origin matchers

const FilterOriginHit = function(domainOpt) {
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

const FilterOriginMiss = function(domainOpt) {
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
            return offset !== 0 &&
                   haystack.charCodeAt(offset - 1) !== 0x2E /* '.' */;
        }
    },
});

//

const FilterOriginHitSet = function(domainOpt) {
    FilterOrigin.call(this);
    this.domainOpt = domainOpt.length < 128
        ? domainOpt
        : µb.stringDeduplicater.lookup(domainOpt);
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
            if ( hnTrieManager.isValidRef(this.oneOf) === false ) {
                this.oneOf = hnTrieManager.fromDomainOpt(this.domainOpt);
            }
            return this.oneOf.matches(pageHostnameRegister) === 1;
        }
    },
});

//

const FilterOriginMissSet = function(domainOpt) {
    FilterOrigin.call(this);
    this.domainOpt = domainOpt.length < 128
        ? domainOpt
        : µb.stringDeduplicater.lookup(domainOpt);
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
            if ( hnTrieManager.isValidRef(this.noneOf) === false ) {
                this.noneOf = hnTrieManager.fromDomainOpt(
                    this.domainOpt.replace(/~/g, '')
                );
            }
            return this.noneOf.matches(pageHostnameRegister) === 0;
        }
    },
});

//

const FilterOriginMixedSet = function(domainOpt) {
    FilterOrigin.call(this);
    this.domainOpt = domainOpt.length < 128
        ? domainOpt
        : µb.stringDeduplicater.lookup(domainOpt);
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
            let oneOf = [], noneOf = [];
            for ( let hostname of this.domainOpt.split('|') ) {
                if ( hostname.charCodeAt(0) === 0x7E /* '~' */ ) {
                    noneOf.push(hostname.slice(1));
                } else {
                    oneOf.push(hostname);
                }
            }
            this.oneOf = hnTrieManager.fromIterable(oneOf);
            this.noneOf = hnTrieManager.fromIterable(noneOf);
        }
    },
    toDomainOpt: {
        value: function() {
            return this.domainOpt;
        }
    },
    matchOrigin: {
        value: function() {
            if ( hnTrieManager.isValidRef(this.oneOf) === false ) {
                this.init();
            }
            let needle = pageHostnameRegister;
            return this.oneOf.matches(needle) === 1 &&
                   this.noneOf.matches(needle) === 0;
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
    return [ FilterOrigin.fid, details.domainOpt ];
};

FilterOrigin.load = function(args) {
    var f = FilterOrigin.matcherFactory(args[1]);
    f.wrapped = filterFromCompiledData(args[2]);
    return f;
};

registerFilterClass(FilterOrigin);

/******************************************************************************/

const FilterDataHolder = function(dataType, dataStr) {
    this.dataType = dataType;
    this.dataStr = dataStr;
    this.wrapped = undefined;
};

FilterDataHolder.prototype.match = function(url, tokenBeg) {
    return this.wrapped.match(url, tokenBeg);
};

FilterDataHolder.prototype.logData = function() {
    var out = this.wrapped.logData();
    out.compiled = [ this.fid, this.dataType, this.dataStr, out.compiled ];
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
    return [ this.fid, this.dataType, this.dataStr, this.wrapped.compile() ];
};

FilterDataHolder.compile = function(details) {
    return [ FilterDataHolder.fid, details.dataType, details.dataStr ];
};

FilterDataHolder.load = function(args) {
    var f = new FilterDataHolder(args[1], args[2]);
    f.wrapped = filterFromCompiledData(args[3]);
    return f;
};

registerFilterClass(FilterDataHolder);

// Helper class for storing instances of FilterDataHolder.

const FilterDataHolderEntry = function(categoryBits, tokenHash, fdata) {
    this.categoryBits = categoryBits;
    this.tokenHash = tokenHash;
    this.filter = filterFromCompiledData(fdata);
    this.next = undefined;
};

FilterDataHolderEntry.prototype.logData = function() {
    return toLogDataInternal(this.categoryBits, this.tokenHash, this.filter);
};

FilterDataHolderEntry.prototype.compile = function() {
    return [ this.categoryBits, this.tokenHash, this.filter.compile() ];
};

FilterDataHolderEntry.load = function(data) {
    return new FilterDataHolderEntry(data[0], data[1], data[2]);
};

/******************************************************************************/

// Dictionary of hostnames
//
const FilterHostnameDict = function() {
    this.h = ''; // short-lived register
    this.dict = new Set();
};

Object.defineProperty(FilterHostnameDict.prototype, 'size', {
    get: function() {
        return this.dict.size;
    }
});

FilterHostnameDict.prototype.add = function(hn) {
    if ( this.dict.has(hn) === true ) { return false; }
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
    return true;
};

FilterHostnameDict.prototype.logData = function() {
    return {
        raw: '||' + this.h + '^',
        regex: rawToRegexStr(this.h, 0) + '(?:[^%.0-9a-z_-]|$)',
        compiled: this.h
    };
};

FilterHostnameDict.prototype.compile = function() {
    return [ this.fid, Array.from(this.dict) ];
};

FilterHostnameDict.load = function(args) {
    var f = new FilterHostnameDict();
    f.dict = new Set(args[1]);
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

const FilterPair = function(a, b) {
    this.f1 = a;
    this.f2 = b;
    this.f = null;
};

Object.defineProperty(FilterPair.prototype, 'size', {
    get: function() {
        if ( this.f1 === undefined && this.f2 === undefined ) { return 0; }
        if ( this.f1 === undefined || this.f2 === undefined ) { return 1; }
        return 2;
    }
});

FilterPair.prototype.remove = function(fdata) {
    if ( arrayStrictEquals(this.f2.compile(), fdata) === true ) {
        this.f2 = undefined;
    }
    if ( arrayStrictEquals(this.f1.compile(), fdata) === true ) {
        this.f1 = this.f2;
    }
    // https://github.com/uBlockOrigin/uBlock-issues/issues/84
    if ( this.f1 === undefined ) {
        console.log(JSON.stringify(fdata));
    }
};

FilterPair.prototype.match = function(url, tokenBeg) {
    if ( this.f1.match(url, tokenBeg) === true ) {
        this.f = this.f1;
        return true;
    }
    if ( this.f2.match(url, tokenBeg) === true ) {
        this.f = this.f2;
        return true;
    }
    return false;
};

FilterPair.prototype.logData = function() {
    return this.f.logData();
};

FilterPair.prototype.compile = function() {
    return [ this.fid, this.f1.compile(), this.f2.compile() ];
};

FilterPair.prototype.upgrade = function(a) {
    var bucket = new FilterBucket(this.f1, this.f2, a);
    this.f1 = this.f2 = undefined;
    this.f = null;
    FilterPair.available = this;
    return bucket;
};

FilterPair.prototype.downgrade = function() {
    if ( this.f2 !== undefined ) { return this; }
    if ( this.f1 !== undefined ) { return this.f1; }
};

FilterPair.load = function(args) {
    var f1 = filterFromCompiledData(args[1]),
        f2 = filterFromCompiledData(args[2]),
        pair = FilterPair.available;
    if ( pair === null ) {
        return new FilterPair(f1, f2);
    }
    FilterPair.available = null;
    pair.f1 = f1;
    pair.f2 = f2;
    return pair;
};

FilterPair.available = null;

registerFilterClass(FilterPair);

/******************************************************************************/

const FilterBucket = function(a, b, c) {
    this.filters = [];
    this.f = null;
    if ( a !== undefined ) {
        this.filters[0] = a;
        this.filters[1] = b;
        this.filters[2] = c;
    }
};

Object.defineProperty(FilterBucket.prototype, 'size', {
    get: function() {
        return this.filters.length;
    }
});

FilterBucket.prototype.promoted = 0;

FilterBucket.prototype.add = function(fdata) {
    this.filters[this.filters.length] = filterFromCompiledData(fdata);
};

FilterBucket.prototype.remove = function(fdata) {
    var i = this.filters.length,
        filter;
    while ( i-- ) {
        filter = this.filters[i];
        if ( arrayStrictEquals(filter.compile(), fdata) === true ) {
            this.filters.splice(i, 1);
        }
    }
};

// Promote hit filters so they can be found faster next time.
FilterBucket.prototype.promote = function(i) {
    var filters = this.filters,
        pivot = filters.length >>> 1;
    while ( i < pivot ) {
        pivot >>>= 1;
        if ( pivot < 16 ) { break; }
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
    var filters = this.filters;
    for ( var i = 0, n = filters.length; i < n; i++ ) {
        if ( filters[i].match(url, tokenBeg) === true ) {
            this.f = filters[i];
            if ( i >= 16 ) { this.promote(i); }
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
    return [ this.fid, compiled ];
};

FilterBucket.prototype.downgrade = function() {
    if ( this.filters.length > 2 ) { return this; }
    if ( this.filters.length === 2 ) {
        return new FilterPair(this.filters[0], this.filters[1]);
    }
    if ( this.filters.length === 1 ) { return this.filters[0]; }
};

FilterBucket.load = function(args) {
    var bucket = new FilterBucket(),
        compiledFilters = args[1],
        filters = bucket.filters;
    for ( var i = 0, n = compiledFilters.length; i < n; i++ ) {
        filters[i] = filterFromCompiledData(compiledFilters[i]);
    }
    return bucket;
};

registerFilterClass(FilterBucket);

/******************************************************************************/
/******************************************************************************/

const FilterParser = function() {
    this.cantWebsocket = vAPI.cantWebsocket;
    this.reBadDomainOptChars = /[*+?^${}()[\]\\]/;
    this.reHostnameRule1 = /^[0-9a-z][0-9a-z.-]*[0-9a-z]$/i;
    this.reHostnameRule2 = /^[0-9a-z][0-9a-z.-]*[0-9a-z]\^?$/i;
    this.reCleanupHostnameRule2 = /\^$/g;
    this.reCanTrimCarets1 = /^[^*]*$/;
    this.reCanTrimCarets2 = /^\^?[^^]+[^^][^^]+\^?$/;
    this.reHasUppercase = /[A-Z]/;
    this.reIsolateHostname = /^(\*?\.)?([^\x00-\x24\x26-\x2C\x2F\x3A-\x5E\x60\x7B-\x7F]+)(.*)/;
    this.reHasUnicode = /[^\x00-\x7F]/;
    this.reWebsocketAny = /^ws[s*]?(?::\/?\/?)?\*?$/;
    this.reBadCSP = /(?:^|;)\s*report-(?:to|uri)\b/;
    this.domainOpt = '';
    this.noTokenHash = µb.urlTokenizer.tokenHashFromString('*');
    this.unsupportedTypeBit = this.bitFromType('unsupported');
    // All network request types to bitmap
    //   bring origin to 0 (from 4 -- see typeNameToTypeValue)
    //   left-shift 1 by the above-calculated value
    //   subtract 1 to set all type bits
    this.allNetRequestTypeBits = (1 << (otherTypeBitValue >>> 4)) - 1;
    this.reset();
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1493
//   Transpose `ping` into `other` for now.

FilterParser.prototype.toNormalizedType = {
            'beacon': 'other',
               'css': 'stylesheet',
              'data': 'data',
          'document': 'main_frame',
          'elemhide': 'generichide',
              'font': 'font',
             'frame': 'sub_frame',
      'genericblock': 'unsupported',
       'generichide': 'generichide',
             'image': 'image',
       'inline-font': 'inline-font',
     'inline-script': 'inline-script',
             'media': 'media',
            'object': 'object',
 'object-subrequest': 'object',
             'other': 'other',
              'ping': 'other',
          'popunder': 'popunder',
             'popup': 'popup',
            'script': 'script',
        'stylesheet': 'stylesheet',
       'subdocument': 'sub_frame',
               'xhr': 'xmlhttprequest',
    'xmlhttprequest': 'xmlhttprequest',
            'webrtc': 'unsupported',
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
    if ( (typeBit & this.allNetRequestTypeBits) === 0 ) {
        return;
    }

    // Negated type: set all valid network request type bits to 1
    if (
        (typeBit & this.allNetRequestTypeBits) !== 0 &&
        (this.types & this.allNetRequestTypeBits) === 0
    ) {
        this.types |= this.allNetRequestTypeBits;
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
        if ( opt === 'third-party' || opt === '3p' ) {
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
        // Test before handling all other types.
        if ( opt.startsWith('redirect=') ) {
            if ( this.action === BlockAction ) {
                this.redirect = true;
                continue;
            }
            this.unsupported = true;
            break;
        }
        if ( this.toNormalizedType.hasOwnProperty(opt) ) {
            this.parseTypeOption(opt, not);
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
        if ( opt === 'first-party' || opt === '1p' ) {
            this.parsePartyOption(true, not);
            continue;
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
        if (
            vAPI.webextFlavor.soup.has('chromium') &&
            vAPI.webextFlavor.major < 57
        ) {
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
            //   Discard Adguard-specific `$$` filters.
            if ( s.indexOf('$$') !== -1 ) {
                this.unsupported = true;
                return this;
            }
            this.parseOptions(s.slice(pos + 1));
            // https://github.com/gorhill/uBlock/issues/2283
            //   Abort if type is only for unsupported types, otherwise
            //   toggle off `unsupported` bit.
            if ( this.types & this.unsupportedTypeBit ) {
                this.types &= ~this.unsupportedTypeBit;
                if ( this.types === 0 ) {
                    this.unsupported = true;
                    return this;
                }
            }
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

    // https://github.com/gorhill/uBlock/issues/1669#issuecomment-224822448
    // remove pointless leading *.
    // https://github.com/gorhill/uBlock/issues/3034
    // - We can remove anchoring if we need to match all at the start.
    if ( s.startsWith('*') ) {
        s = s.replace(/^\*+([^%0-9a-z])/i, '$1');
        this.anchor &= ~0x6;
    }
    // remove pointless trailing *
    // https://github.com/gorhill/uBlock/issues/3034
    // - We can remove anchoring if we need to match all at the end.
    if ( s.endsWith('*') ) {
        s = s.replace(/([^%0-9a-z])\*+$/i, '$1');
        this.anchor &= ~0x1;
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
var reRegexToken = /[%0-9A-Za-z]{2,}/g;
var reRegexTokenAbort = /[([]/;
var reRegexBadPrefix = /(^|[^\\]\.|[*?{}\\])$/;
var reRegexBadSuffix = /^([^\\]\.|\\[dw]|[([{}?*]|$)/;

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

FilterParser.prototype.findFirstGoodToken = function() {
    reGoodToken.lastIndex = 0;
    var s = this.f,
        matches, lpos,
        badTokenMatch = null;
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

FilterParser.prototype.extractTokenFromRegex = function() {
    reRegexToken.lastIndex = 0;
    var s = this.f,
        matches, prefix;
    while ( (matches = reRegexToken.exec(s)) !== null ) {
        prefix = s.slice(0, matches.index);
        if ( reRegexTokenAbort.test(prefix) ) { return; }
        if (
            reRegexBadPrefix.test(prefix) ||
            reRegexBadSuffix.test(s.slice(reRegexToken.lastIndex))
        ) {
            continue;
        }
        this.token = matches[0].toLowerCase();
        this.tokenHash = µb.urlTokenizer.tokenHashFromString(this.token);
        this.tokenBeg = matches.index;
        if ( badTokens.has(this.token) === false ) { break; }
    }
};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/1038
// Single asterisk will match any URL.

// https://github.com/gorhill/uBlock/issues/2781
//   For efficiency purpose, try to extract a token from a regex-based filter.

FilterParser.prototype.makeToken = function() {
    if ( this.isRegex ) {
        this.extractTokenFromRegex();
        return;
    }

    if ( this.f === '*' ) { return; }

    var matches = null;
    if ( (this.anchor & 0x4) !== 0 && this.f.indexOf('*') === -1 ) {
        matches = reHostnameToken.exec(this.f);
    }
    if ( matches === null ) {
        matches = this.findFirstGoodToken();
    }
    if ( matches !== null ) {
        this.token = matches[0];
        this.tokenHash = µb.urlTokenizer.tokenHashFromString(this.token);
        this.tokenBeg = matches.index;
    }
};

/******************************************************************************/
/******************************************************************************/

const FilterContainer = function() {
    this.reIsGeneric = /[\^\*]/;
    this.filterParser = new FilterParser();
    this.urlTokenizer = µb.urlTokenizer;
    this.noTokenHash = this.urlTokenizer.tokenHashFromString('*');
    this.dotTokenHash = this.urlTokenizer.tokenHashFromString('.');
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
    this.goodFilters = new Set();
    this.badFilters = new Set();
    this.categories = new Map();
    this.dataFilters = new Map();
    this.filterParser.reset();

    // This will invalidate all hn tries throughout uBO:
    hnTrieManager.reset();

    // Runtime registers
    this.cbRegister = undefined;
    this.thRegister = undefined;
    this.fRegister = null;
};

/******************************************************************************/

FilterContainer.prototype.freeze = function() {
    let filterPairId = FilterPair.fid,
        filterBucketId = FilterBucket.fid,
        filterDataHolderId = FilterDataHolder.fid,
        redirectTypeValue = typeNameToTypeValue.redirect,
        unserialize = µb.CompiledLineIO.unserialize;

    for ( let line of this.goodFilters ) {
        if ( this.badFilters.has(line) ) {
            this.discardedCount += 1;
            continue;
        }

        let args = unserialize(line);
        let bits = args[0];

        // Special cases: delegate to more specialized engines.
        // Redirect engine.
        if ( (bits & 0x1F0) === redirectTypeValue ) {
            µb.redirectEngine.fromCompiledRule(args[1]);
            continue;
        }

        // Plain static filters.
        let tokenHash = args[1];
        let fdata = args[2];

        // Special treatment: data-holding filters are stored separately
        // because they require special matching algorithm (unlike other
        // filters, ALL hits must be reported).
        if ( fdata[0] === filterDataHolderId ) {
            let entry = new FilterDataHolderEntry(bits, tokenHash, fdata);
            let bucket = this.dataFilters.get(tokenHash);
            if ( bucket !== undefined ) {
                entry.next = bucket;
            }
            this.dataFilters.set(tokenHash, entry);
            continue;
        }

        let bucket = this.categories.get(bits);
        if ( bucket === undefined ) {
            bucket = new Map();
            this.categories.set(bits, bucket);
        }
        let entry = bucket.get(tokenHash);

        if ( tokenHash === this.dotTokenHash ) {
            if ( entry === undefined ) {
                entry = new FilterHostnameDict();
                bucket.set(this.dotTokenHash, entry);
            }
            entry.add(fdata);
            continue;
        }

        if ( entry === undefined ) {
            bucket.set(tokenHash, filterFromCompiledData(fdata));
            continue;
        }
        if ( entry.fid === filterBucketId ) {
            entry.add(fdata);
            continue;
        }
        if ( entry.fid === filterPairId ) {
            bucket.set(
                tokenHash,
                entry.upgrade(filterFromCompiledData(fdata))
            );
            continue;
        }
        bucket.set(
            tokenHash,
            new FilterPair(entry, filterFromCompiledData(fdata))
        );
    }

    this.filterParser.reset();
    this.goodFilters = new Set();
    this.frozen = true;
};

/******************************************************************************/

// This is necessary for when the filtering engine readiness will depend
// on asynchronous operations (ex.: when loading a wasm module).

FilterContainer.prototype.readyToUse = function() {
    return hnTrieManager.readyToUse();
};

/******************************************************************************/

FilterContainer.prototype.toSelfie = function() {
    let categoriesToSelfie = function(categoryMap) {
        let selfie = [];
        for ( let categoryEntry of categoryMap ) {
            let tokenEntries = [];
            for ( let tokenEntry of categoryEntry[1] ) {
                tokenEntries.push([ tokenEntry[0], tokenEntry[1].compile() ]);
            }
            selfie.push([ categoryEntry[0], tokenEntries ]);
        }
        return selfie;
    };

    let dataFiltersToSelfie = function(dataFilters) {
        let selfie = [];
        for ( let entry of dataFilters.values() ) {
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

    for ( let categoryEntry of selfie.categories ) {
        let tokenMap = new Map();
        for ( let tokenEntry of categoryEntry[1] ) {
            tokenMap.set(tokenEntry[0], filterFromCompiledData(tokenEntry[1]));
        }
        this.categories.set(categoryEntry[0], tokenMap);
    }

    for ( let dataEntry of selfie.dataFilters ) {
        let entry = FilterDataHolderEntry.load(dataEntry);
        let bucket = this.dataFilters.get(entry.tokenHash);
        if ( bucket !== undefined ) {
            entry.next = bucket;
        }
        this.dataFilters.set(entry.tokenHash, entry);
    }
};

/******************************************************************************/

FilterContainer.prototype.compile = function(raw, writer) {
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
        parsed.dataType === undefined
    ) {
        parsed.tokenHash = this.dotTokenHash;
        this.compileToAtomicFilter(parsed, parsed.f, writer);
        return true;
    }

    parsed.makeToken();

    var fdata;
    if ( parsed.isRegex ) {
        fdata = FilterRegex.compile(parsed);
    } else if ( parsed.hostnamePure ) {
        fdata = FilterPlainHostname.compile(parsed);
    } else if ( parsed.f === '*' ) {
        fdata = FilterTrue.compile();
    } else if ( parsed.anchor === 0x5 ) {
        // https://github.com/gorhill/uBlock/issues/1669
        fdata = FilterGenericHnAndRightAnchored.compile(parsed);
    } else if ( parsed.anchor === 0x4 ) {
        if (
            this.reIsGeneric.test(parsed.f) === false &&
            parsed.tokenHash !== parsed.noTokenHash &&
            parsed.tokenBeg === 0
        ) {
            fdata = FilterPlainHnAnchored.compile(parsed);
        } else {
            fdata = FilterGenericHnAnchored.compile(parsed);
        }
    } else if (
        this.reIsGeneric.test(parsed.f) ||
        parsed.tokenHash === parsed.noTokenHash
    ) {
        fdata = FilterGeneric.compile(parsed);
    } else if ( parsed.anchor === 0x2 ) {
        fdata = FilterPlainLeftAnchored.compile(parsed);
    } else if ( parsed.anchor === 0x1 ) {
        fdata = FilterPlainRightAnchored.compile(parsed);
    } else if ( parsed.anchor === 0x3 ) {
        fdata = FilterExactMatch.compile(parsed);
    } else if ( parsed.tokenBeg === 0 ) {
        fdata = FilterPlainPrefix0.compile(parsed);
    } else if ( parsed.tokenBeg === 1 ) {
        fdata = FilterPlainPrefix1.compile(parsed);
    } else {
        fdata = FilterPlain.compile(parsed);
    }

    var fwrapped;
    if ( parsed.domainOpt !== '' ) {
        fwrapped = fdata;
        fdata = FilterOrigin.compile(parsed);
        fdata.push(fwrapped);
    }

    if ( parsed.dataType !== undefined ) {
        fwrapped = fdata;
        fdata = FilterDataHolder.compile(parsed);
        fdata.push(fwrapped);
    }

    this.compileToAtomicFilter(parsed, fdata, writer);

    return true;
};

/******************************************************************************/

FilterContainer.prototype.compileToAtomicFilter = function(
    parsed,
    fdata,
    writer
) {

    // 0 = network filters
    // 1 = network filters: bad filters
    if ( parsed.badFilter ) {
        writer.select(1);
    } else {
        writer.select(0);
    }

    let descBits = parsed.action | parsed.important | parsed.party;
    let type = parsed.types;

    // Typeless
    if ( type === 0 ) {
        writer.push([ descBits, parsed.tokenHash, fdata ]);
        return;
    }

    // Specific type(s)
    let bitOffset = 1;
    do {
        if ( type & 1 ) {
            writer.push([ descBits | (bitOffset << 4), parsed.tokenHash, fdata ]);
        }
        bitOffset += 1;
        type >>>= 1;
    } while ( type !== 0 );

    // Only static filter with an explicit type can be redirected. If we reach
    // this point, it's because there is one or more explicit type.
    if ( parsed.redirect ) {
        let redirects = µb.redirectEngine.compileRuleFromStaticFilter(parsed.raw);
        if ( Array.isArray(redirects) ) {
            for ( let redirect of redirects ) {
                writer.push([ typeNameToTypeValue.redirect, redirect ]);
            }
        }
    }
};

/******************************************************************************/

FilterContainer.prototype.fromCompiledContent = function(reader) {
    // 0 = network filters
    reader.select(0);
    while ( reader.next() ) {
        this.acceptedCount += 1;
        if ( this.goodFilters.has(reader.line) ) {
            this.discardedCount += 1;
        } else {
            this.goodFilters.add(reader.line);
        }
    }

    // 1 = network filters: bad filter directives
    // Since we are going to keep bad filter fingerprints around, we ensure
    // they are "detached" from the parent string from which they are sliced.
    // We keep bad filter fingerprints around to use them when user
    // incrementally add filters (through "Block element" for example).
    reader.select(1);
    while ( reader.next() ) {
        if ( this.badFilters.has(reader.line) === false ) {
            this.badFilters.add(µb.orphanizeString(reader.line));
        }
    }
};

/******************************************************************************/

FilterContainer.prototype.matchAndFetchData = function(dataType, requestURL, out, outlog) {
    if ( this.dataFilters.length === 0 ) { return; }

    let url = this.urlTokenizer.setURL(requestURL);

    pageHostnameRegister = requestHostnameRegister = µb.URI.hostnameFromURI(url);

    // We need to visit ALL the matching filters.
    let toAddImportant = new Map(),
        toAdd = new Map(),
        toRemove = new Map();

    let tokenHashes = this.urlTokenizer.getTokens(),
        i = 0;
    while ( i < 32 ) {
        let tokenHash = tokenHashes[i++];
        if ( tokenHash === 0 ) { break; }
        let tokenOffset = tokenHashes[i++];
        let entry = this.dataFilters.get(tokenHash);
        while ( entry !== undefined ) {
            let f = entry.filter;
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
    let entry = this.dataFilters.get(this.noTokenHash);
    while ( entry !== undefined ) {
        let f = entry.filter;
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
    for ( let key of toAddImportant.keys() ) {
        toAdd.delete(key);
        toRemove.delete(key);
    }
    for ( let key of toRemove.keys() ) {
        if ( key === '' ) {
            toAdd.clear();
            break;
        }
        toAdd.delete(key);
    }

    for ( let entry of toAddImportant ) {
        out.push(entry[0]);
        if ( outlog === undefined ) { continue; }
        let logData = entry[1].logData();
        logData.source = 'static';
        logData.result = 1;
        outlog.push(logData);
    }
    for ( let entry of toAdd ) {
        out.push(entry[0]);
        if ( outlog === undefined ) { continue; }
        let logData = entry[1].logData();
        logData.source = 'static';
        logData.result = 1;
        outlog.push(logData);
    }
    if ( outlog !== undefined ) {
        for ( let entry of toRemove.values()) {
            let logData = entry.logData();
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
    let f = bucket.get(this.dotTokenHash);
    if ( f !== undefined && f.match() === true ) {
        this.thRegister = this.dotTokenHash;
        this.fRegister = f;
        return true;
    }

    let tokenHashes = this.urlTokenizer.getTokens(),
        i = 0;
    for (;;) {
        let tokenHash = tokenHashes[i++];
        if ( tokenHash === 0 ) { break; }
        let tokenOffset = tokenHashes[i++];
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

FilterContainer.prototype.matchStringGenericHide = function(requestURL) {
    let url = this.urlTokenizer.setURL(requestURL);

    // https://github.com/gorhill/uBlock/issues/2225
    //   Important:
    //   - `pageHostnameRegister` is used by FilterOrigin.matchOrigin().
    //   - `requestHostnameRegister` is used by FilterHostnameDict.match().
    pageHostnameRegister = requestHostnameRegister = µb.URI.hostnameFromURI(url);

    let bucket = this.categories.get(genericHideException);
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
        return this.matchStringGenericHide(requestURL);
    }
    let type = typeNameToTypeValue[requestType];
    if ( type === undefined ) { return 0; }

    // Prime tokenizer: we get a normalized URL in return.
    let url = this.urlTokenizer.setURL(requestURL);

    // These registers will be used by various filters
    pageHostnameRegister = context.pageHostname || '';
    requestHostnameRegister = µb.URI.hostnameFromURI(url);

    let party = isFirstParty(context.pageDomain, requestHostnameRegister)
        ? FirstParty
        : ThirdParty;
    let categories = this.categories,
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
    let type = typeNameToTypeValue[context.requestType];
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
    let url = this.urlTokenizer.setURL(context.requestURL);

    // These registers will be used by various filters
    pageHostnameRegister = context.pageHostname || '';
    requestHostnameRegister = context.requestHostname;

    this.fRegister = null;

    let party = isFirstParty(context.pageDomain, context.requestHostname)
        ? FirstParty
        : ThirdParty;
    let categories = this.categories,
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

FilterContainer.prototype.benchmark = function(contexts) {
    const t0 = performance.now();
    const results = [];
    for ( const context of contexts ) {
         results.push(this.matchString(context));
    }
    const t1 = performance.now();
    return { t0, t1, duration: t1 - t0, results };
};

/******************************************************************************/

return new FilterContainer();

/******************************************************************************/

})();

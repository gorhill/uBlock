/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 Raymond Hill

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
// |      |   | |||
// |      |   | |||
// |      |   | |||
// |      |   | |||
// |      |   | ||+---- bit 0: [BlockAction | AllowAction]
// |      |   | |+---- bit 1: `important`
// |      |   | +---- bit 2-3: party [0 - 3]
// |      |   +---- bit 4-7: type [0 - 15]
// |      +---- bit 8-15: unused
// +---- bit 15: never use! (to ensure valid unicode character)

var BlockAction = 0 << 0;
var AllowAction = 1 << 0;

var Important = 1 << 1;

var AnyParty = 0 << 2;
var FirstParty = 1 << 2;
var ThirdParty = 2 << 2;

var AnyType = 0 << 4;
var typeNameToTypeValue = {
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
          'popunder': 11 << 4,
        'main_frame': 12 << 4,
          'elemhide': 13 << 4,
     'inline-script': 14 << 4,
             'popup': 15 << 4
};
var typeOtherValue = typeNameToTypeValue.other;

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
    11: 'popunder',
    12: 'document',
    13: 'elemhide',
    14: 'inline-script',
    15: 'popup'
};

// All network request types to bitmap
//   bring origin to 0 (from 4 -- see typeNameToTypeValue)
//   left-shift 1 by the above-calculated value
//   subtract 1 to set all type bits
var allNetRequestTypesBitmap = (1 << (typeOtherValue >>> 4)) - 1;

var BlockAnyTypeAnyParty = BlockAction | AnyType | AnyParty;
var BlockAnyType = BlockAction | AnyType;
var BlockAnyParty = BlockAction | AnyParty;

var AllowAnyTypeAnyParty = AllowAction | AnyType | AnyParty;
var AllowAnyType = AllowAction | AnyType;
var AllowAnyParty = AllowAction | AnyParty;

// ABP filters: https://adblockplus.org/en/filters
// regex tester: http://regex101.com/

/******************************************************************************/

// See the following as short-lived registers, used during evaluation. They are
// valid until the next evaluation.

var pageHostnameRegister = '';
var requestHostnameRegister = '';
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

var cachedParseInt = parseInt;

var atoi = function(s) {
    return cachedParseInt(s, 10);
};

// Be sure to not confuse 'example.com' with 'anotherexample.com'
var isFirstParty = function(domain, hostname) {
    return hostname.endsWith(domain) &&
          (hostname.length === domain.length ||
           hostname.charAt(hostname.length - domain.length - 1) === '.');
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

var alwaysTruePseudoRegex = {
    match: { '0': '', index: 0 },
    exec: function(s) {
        this.match['0'] = s;
        return this.match;
    },
    test: function() {
        return true;
    }
};

var strToRegex = function(s, anchor, flags) {
    // https://github.com/chrisaljoudi/uBlock/issues/1038
    // Special case: always match.
    if ( s === '*' ) {
        return alwaysTruePseudoRegex;
    }
    var anchorToHnStart;
    if ( s.startsWith('||') ) {
        s = s.slice(2);
        anchorToHnStart = s.charCodeAt(0) === 0x2A;
    }
    // https://www.loggly.com/blog/five-invaluable-techniques-to-improve-regex-performance/
    // https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions
    // Also: remove leading/trailing wildcards -- there is no point.
    var reStr = s.replace(/[.+?${}()|[\]\\]/g, '\\$&')
                 .replace(/\^/g, '(?:[^%.0-9a-z_-]|$)')
                 .replace(/^\*|\*$/g, '')
                 .replace(/\*/g, '[^ ]*?');

    if ( anchor < 0 ) {
        reStr = '^' + reStr;
    } else if ( anchor > 0 ) {
        reStr += '$';
    }
    if ( anchorToHnStart ) {
        reStr = '[0-9a-z.-]*?' + reStr;
    }
    //console.debug('µBlock.staticNetFilteringEngine: created RegExp("%s")', reStr);
    return new RegExp(reStr, flags);
};

var toHex = function(n) {
    return n.toString(16);
};

// First character of match must be within the hostname part of the url.
var isHnAnchored = function(url, matchStart) {
    var hnStart = url.indexOf('://');
    if ( hnStart === -1 ) {
        return false;
    }
    hnStart += 3;
    if ( matchStart <= hnStart ) {
        return true;
    }
    if ( reURLPostHostnameAnchors.test(url.slice(hnStart, matchStart)) ) {
        return false;
    }
    // https://github.com/gorhill/uBlock/issues/1929
    // Match only hostname label boundaries.
    return url.charCodeAt(matchStart - 1) === 0x2E;
};

var reURLPostHostnameAnchors = /[\/?#]/;

/******************************************************************************/

// Hostname test helpers: the optimal test function is picked
// according to the content of the `domain` filter option, 

var hostnameTestPicker = function(owner) {
    var domainOpt = owner.domainOpt;

    // Only one hostname
    if ( domainOpt.indexOf('|') === -1 ) {
        if ( domainOpt.startsWith('~') ) {
            owner._notHostname = domainOpt.slice(1);
            return hostnameMissTest;
        }
        return hostnameHitTest;
    }

    // Multiple hostnames: use a dictionary.
    var hostnames = domainOpt.split('|');
    var i, hostname, dict;

    // First find out whether we have a homogeneous dictionary
    var hit = false, miss = false;
    i = hostnames.length;
    while ( i-- ) {
        if ( hostnames[i].startsWith('~') ) {
            miss = true;
            if ( hit ) {
                break;
            }
        } else {
            hit = true;
            if ( miss ) {
                break;
            }
        }
    }

    // Heterogenous dictionary: this can happen, though VERY rarely.
    // Spotted one occurrence in EasyList Lite (cjxlist.txt):
    //   domain=photobucket.com|~secure.photobucket.com
    if ( hit && miss ) {
        dict = owner._hostnameDict = new Map();
        i = hostnames.length;
        while ( i-- ) {
            hostname = hostnames[i];
            if ( hostname.startsWith('~') ) {
                dict.set(hostname.slice(1), false);
            } else {
                dict.set(hostname, true);
            }
        }
        return hostnameMixedSetTest;
    }

    // Homogeneous dictionary.
    dict = owner._hostnameDict = new Set();
    i = hostnames.length;
    while ( i-- ) {
        hostname = hostnames[i];
        dict.add(hostname.startsWith('~') ? hostname.slice(1) : hostname);
    }

    return hit ? hostnameHitSetTest : hostnameMissSetTest;
};

var hostnameHitTest = function(owner) {
    var current = pageHostnameRegister;
    var target = owner.domainOpt;
    return current.endsWith(target) &&
          (current.length === target.length ||
           current.charAt(current.length - target.length - 1) === '.');
};

var hostnameMissTest = function(owner) {
    var current = pageHostnameRegister;
    var target = owner._notHostname;
    return current.endsWith(target) === false ||
          (current.length !== target.length &&
           current.charAt(current.length - target.length - 1) !== '.');
};

var hostnameHitSetTest = function(owner) {
    var dict = owner._hostnameDict;
    var needle = pageHostnameRegister;
    var pos;
    for (;;) {
        if ( dict.has(needle) ) {
            return true;
        }
        pos = needle.indexOf('.');
        if ( pos === -1 ) {
            break;
        }
        needle = needle.slice(pos + 1);
    }
    return false;
};

var hostnameMissSetTest = function(owner) {
    var dict = owner._hostnameDict;
    var needle = pageHostnameRegister;
    var pos;
    for (;;) {
        if ( dict.has(needle) ) {
            return false;
        }
        pos = needle.indexOf('.');
        if ( pos === -1 ) {
            break;
        }
        needle = needle.slice(pos + 1);
    }

    return true;
};

var hostnameMixedSetTest = function(owner) {
    var dict = owner._hostnameDict;
    var needle = pageHostnameRegister;
    var hit = false;
    var v, pos;
    for (;;) {
        v = dict.get(needle);
        if ( v === false ) {
            return false;
        }
        if ( v === true ) {
            hit = true;
        }
        pos = needle.indexOf('.');
        if ( pos === -1 ) {
            break;
        }
        needle = needle.slice(pos + 1);
    }
    return hit;
};

/*******************************************************************************

Filters family tree:

- plain (no wildcard)
  - anywhere
    - no hostname
    - specific hostname
  - anchored at start
    - no hostname
    - specific hostname
  - anchored at end
    - no hostname
    - specific hostname
  - anchored within hostname
    - no hostname
    - specific hostname (not implemented)

- with wildcard(s)
  - anchored within hostname
    - no hostname
    - specific hostname
  - all else
    - no hostname
    - specific hostname

*/

/******************************************************************************/

var FilterPlain = function(s, tokenBeg) {
    this.s = s;
    this.tokenBeg = tokenBeg;
};

FilterPlain.prototype.match = function(url, tokenBeg) {
    return url.startsWith(this.s, tokenBeg - this.tokenBeg);
};

FilterPlain.fid =
FilterPlain.prototype.fid =
FilterPlain.prototype.rtfid = 'a';

FilterPlain.prototype.toSelfie =
FilterPlain.prototype.rtCompile = function() {
    return this.s + '\t' + this.tokenBeg;
};

FilterPlain.compile = function(details) {
    return details.f + '\t' + details.tokenBeg;
};

FilterPlain.fromSelfie = function(s) {
    var pos = s.indexOf('\t');
    return new FilterPlain(s.slice(0, pos), atoi(s.slice(pos + 1)));
};

/******************************************************************************/

var FilterPlainHostname = function(s, tokenBeg, domainOpt) {
    this.s = s;
    this.tokenBeg = tokenBeg;
    this.domainOpt = domainOpt;
    this.hostnameTest = hostnameTestPicker(this);
};

FilterPlainHostname.prototype.match = function(url, tokenBeg) {
    return url.startsWith(this.s, tokenBeg - this.tokenBeg) &&
           this.hostnameTest(this);
};

FilterPlainHostname.fid =
FilterPlainHostname.prototype.fid =
FilterPlainHostname.prototype.rtfid = 'ah';

FilterPlainHostname.prototype.toSelfie =
FilterPlainHostname.prototype.rtCompile = function() {
    return this.s + '\t' + this.tokenBeg + '\t' + this.domainOpt;
};

FilterPlainHostname.compile = function(details) {
    return details.f + '\t' + details.tokenBeg + '\t' + details.domainOpt;
};

FilterPlainHostname.fromSelfie = function(s) {
    var args = s.split('\t');
    return new FilterPlainHostname(args[0], atoi(args[1]), args[2]);
};

/******************************************************************************/

var FilterPlainPrefix0 = function(s) {
    this.s = s;
};

FilterPlainPrefix0.prototype.match = function(url, tokenBeg) {
    return url.startsWith(this.s, tokenBeg);
};

FilterPlainPrefix0.fid =
FilterPlainPrefix0.prototype.fid =
FilterPlainPrefix0.prototype.rtfid = '0a';

FilterPlainPrefix0.prototype.toSelfie =
FilterPlainPrefix0.prototype.rtCompile = function() {
    return this.s;
};

FilterPlainPrefix0.compile = function(details) {
    return details.f;
};

FilterPlainPrefix0.fromSelfie = function(s) {
    return new FilterPlainPrefix0(s);
};

/******************************************************************************/

var FilterPlainPrefix0Hostname = function(s, domainOpt) {
    this.s = s;
    this.domainOpt = domainOpt;
    this.hostnameTest = hostnameTestPicker(this);
};

FilterPlainPrefix0Hostname.prototype.match = function(url, tokenBeg) {
    return url.startsWith(this.s, tokenBeg) &&
           this.hostnameTest(this);
};

FilterPlainPrefix0Hostname.fid =
FilterPlainPrefix0Hostname.prototype.fid =
FilterPlainPrefix0Hostname.prototype.rtfid = '0ah';

FilterPlainPrefix0Hostname.prototype.toSelfie =
FilterPlainPrefix0Hostname.prototype.rtCompile = function() {
    return this.s + '\t' + this.domainOpt;
};

FilterPlainPrefix0Hostname.compile = function(details) {
    return details.f + '\t' + details.domainOpt;
};

FilterPlainPrefix0Hostname.fromSelfie = function(s) {
    var pos = s.indexOf('\t');
    return new FilterPlainPrefix0Hostname(s.slice(0, pos), s.slice(pos + 1));
};

/******************************************************************************/

var FilterPlainPrefix1 = function(s) {
    this.s = s;
};

FilterPlainPrefix1.prototype.match = function(url, tokenBeg) {
    return url.startsWith(this.s, tokenBeg - 1);
};

FilterPlainPrefix1.fid =
FilterPlainPrefix1.prototype.fid =
FilterPlainPrefix1.prototype.rtfid = '1a';

FilterPlainPrefix1.prototype.toSelfie =
FilterPlainPrefix1.prototype.rtCompile = function() {
    return this.s;
};

FilterPlainPrefix1.compile = function(details) {
    return details.f;
};

FilterPlainPrefix1.fromSelfie = function(s) {
    return new FilterPlainPrefix1(s);
};

/******************************************************************************/

var FilterPlainPrefix1Hostname = function(s, domainOpt) {
    this.s = s;
    this.domainOpt = domainOpt;
    this.hostnameTest = hostnameTestPicker(this);
};

FilterPlainPrefix1Hostname.prototype.match = function(url, tokenBeg) {
    return url.startsWith(this.s, tokenBeg - 1) &&
           this.hostnameTest(this);
};

FilterPlainPrefix1Hostname.fid =
FilterPlainPrefix1Hostname.prototype.fid =
FilterPlainPrefix1Hostname.prototype.rtfid = '1ah';

FilterPlainPrefix1Hostname.prototype.toSelfie =
FilterPlainPrefix1Hostname.prototype.rtCompile = function() {
    return this.s + '\t' + this.domainOpt;
};

FilterPlainPrefix1Hostname.compile = function(details) {
    return details.f + '\t' + details.domainOpt;
};

FilterPlainPrefix1Hostname.fromSelfie = function(s) {
    var pos = s.indexOf('\t');
    return new FilterPlainPrefix1Hostname(s.slice(0, pos), s.slice(pos + 1));
};

/******************************************************************************/

var FilterPlainLeftAnchored = function(s) {
    this.s = s;
};

FilterPlainLeftAnchored.prototype.match = function(url) {
    return url.startsWith(this.s);
};

FilterPlainLeftAnchored.fid =
FilterPlainLeftAnchored.prototype.fid =
FilterPlainLeftAnchored.prototype.rtfid = '|a';

FilterPlainLeftAnchored.prototype.toSelfie =
FilterPlainLeftAnchored.prototype.rtCompile = function() {
    return this.s;
};

FilterPlainLeftAnchored.compile = function(details) {
    return details.f;
};

FilterPlainLeftAnchored.fromSelfie = function(s) {
    return new FilterPlainLeftAnchored(s);
};

/******************************************************************************/

var FilterPlainLeftAnchoredHostname = function(s, domainOpt) {
    this.s = s;
    this.domainOpt = domainOpt;
    this.hostnameTest = hostnameTestPicker(this);
};

FilterPlainLeftAnchoredHostname.prototype.match = function(url) {
    return url.startsWith(this.s) &&
           this.hostnameTest(this);
};

FilterPlainLeftAnchoredHostname.fid =
FilterPlainLeftAnchoredHostname.prototype.fid =
FilterPlainLeftAnchoredHostname.prototype.rtfid = '|ah';

FilterPlainLeftAnchoredHostname.prototype.toSelfie =
FilterPlainLeftAnchoredHostname.prototype.rtCompile = function() {
    return this.s + '\t' + this.domainOpt;
};

FilterPlainLeftAnchoredHostname.compile = function(details) {
    return details.f + '\t' + details.domainOpt;
};

FilterPlainLeftAnchoredHostname.fromSelfie = function(s) {
    var pos = s.indexOf('\t');
    return new FilterPlainLeftAnchoredHostname(s.slice(0, pos), s.slice(pos + 1));
};

/******************************************************************************/

var FilterPlainRightAnchored = function(s) {
    this.s = s;
};

FilterPlainRightAnchored.prototype.match = function(url) {
    return url.endsWith(this.s);
};

FilterPlainRightAnchored.fid =
FilterPlainRightAnchored.prototype.fid =
FilterPlainRightAnchored.prototype.rtfid = 'a|';

FilterPlainRightAnchored.prototype.toSelfie =
FilterPlainRightAnchored.prototype.rtCompile = function() {
    return this.s;
};

FilterPlainRightAnchored.compile = function(details) {
    return details.f;
};

FilterPlainRightAnchored.fromSelfie = function(s) {
    return new FilterPlainRightAnchored(s);
};

/******************************************************************************/

var FilterPlainRightAnchoredHostname = function(s, domainOpt) {
    this.s = s;
    this.domainOpt = domainOpt;
    this.hostnameTest = hostnameTestPicker(this);
};

FilterPlainRightAnchoredHostname.prototype.match = function(url) {
    return url.endsWith(this.s) &&
           this.hostnameTest(this);
};

FilterPlainRightAnchoredHostname.fid =
FilterPlainRightAnchoredHostname.prototype.fid =
FilterPlainRightAnchoredHostname.prototype.rtfid = 'a|h';

FilterPlainRightAnchoredHostname.prototype.toSelfie =
FilterPlainRightAnchoredHostname.prototype.rtCompile = function() {
    return this.s + '\t' + this.domainOpt;
};

FilterPlainRightAnchoredHostname.compile = function(details) {
    return details.f + '\t' + details.domainOpt;
};

FilterPlainRightAnchoredHostname.fromSelfie = function(s) {
    var pos = s.indexOf('\t');
    return new FilterPlainRightAnchoredHostname(s.slice(0, pos), s.slice(pos + 1));
};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/235
// The filter is left-anchored somewhere within the hostname part of the URL.

var FilterPlainHnAnchored = function(s) {
    this.s = s;
};

FilterPlainHnAnchored.prototype.match = function(url, tokenBeg) {
    return url.startsWith(this.s, tokenBeg) &&
           isHnAnchored(url, tokenBeg);
};

FilterPlainHnAnchored.fid =
FilterPlainHnAnchored.prototype.fid =
FilterPlainHnAnchored.prototype.rtfid = '||a';

FilterPlainHnAnchored.prototype.toSelfie =
FilterPlainHnAnchored.prototype.rtCompile = function() {
    return this.s;
};

FilterPlainHnAnchored.compile = function(details) {
    return details.f;
};

FilterPlainHnAnchored.fromSelfie = function(s) {
    return new FilterPlainHnAnchored(s);
};

// https://www.youtube.com/watch?v=71YS6xDB-E4
// https://www.youtube.com/watch?v=qBPML7ton0E

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/142

var FilterPlainHnAnchoredHostname = function(s, domainOpt) {
    this.s = s;
    this.domainOpt = domainOpt;
    this.hostnameTest = hostnameTestPicker(this);
};

FilterPlainHnAnchoredHostname.prototype.match = function(url, tokenBeg) {
    return url.startsWith(this.s, tokenBeg) &&
           this.hostnameTest(this) &&
           isHnAnchored(url, tokenBeg);
};

FilterPlainHnAnchoredHostname.fid =
FilterPlainHnAnchoredHostname.prototype.fid =
FilterPlainHnAnchoredHostname.prototype.rtfid = '||ah';

FilterPlainHnAnchoredHostname.prototype.toSelfie =
FilterPlainHnAnchoredHostname.prototype.rtCompile = function() {
    return this.s + '\t' + this.domainOpt;
};

FilterPlainHnAnchoredHostname.compile = function(details) {
    return details.f + '\t' + details.domainOpt;
};

FilterPlainHnAnchoredHostname.fromSelfie = function(s) {
    var pos = s.indexOf('\t');
    return new FilterPlainHnAnchoredHostname(s.slice(0, pos), s.slice(pos + 1));
};

/******************************************************************************/

// Generic filter

var FilterGeneric = function(s, anchor) {
    this.s = s;
    this.anchor = anchor;
    this.re = null;
};

FilterGeneric.prototype.match = function(url) {
    if ( this.re === null ) {
        this.re = strToRegex(this.s, this.anchor);
    }
    return this.re.test(url);
};

FilterGeneric.fid =
FilterGeneric.prototype.fid =
FilterGeneric.prototype.rtfid = '_';

FilterGeneric.prototype.toSelfie =
FilterGeneric.prototype.rtCompile = function() {
    return this.s + '\t' + this.anchor;
};

FilterGeneric.compile = function(details) {
    return details.f + '\t' + details.anchor;
};

FilterGeneric.fromSelfie = function(s) {
    var pos = s.indexOf('\t');
    return new FilterGeneric(s.slice(0, pos), parseInt(s.slice(pos + 1), 10));
};

/******************************************************************************/

// Generic filter

var FilterGenericHostname = function(s, anchor, domainOpt) {
    FilterGeneric.call(this, s, anchor);
    this.domainOpt = domainOpt;
    this.hostnameTest = hostnameTestPicker(this);
};
FilterGenericHostname.prototype = Object.create(FilterGeneric.prototype);
FilterGenericHostname.prototype.constructor = FilterGenericHostname;

FilterGenericHostname.prototype.match = function(url) {
    return this.hostnameTest(this) &&
           FilterGeneric.prototype.match.call(this, url);
};

FilterGenericHostname.fid =
FilterGenericHostname.prototype.fid =
FilterGenericHostname.prototype.rtfid = '_h';

FilterGenericHostname.prototype.toSelfie =
FilterGenericHostname.prototype.rtCompile = function() {
    return FilterGeneric.prototype.toSelfie.call(this) + '\t' + this.domainOpt;
};

FilterGenericHostname.compile = function(details) {
    return FilterGeneric.compile(details) + '\t' + details.domainOpt;
};

FilterGenericHostname.fromSelfie = function(s) {
    var fields = s.split('\t');
    return new FilterGenericHostname(fields[0], parseInt(fields[1], 10), fields[2]);
};

/******************************************************************************/

// Generic filter: hostname-anchored: it has that extra test to find out
// whether the start of the match falls within the hostname part of the
// URL.

var FilterGenericHnAnchored = function(s) {
    this.s = s;
    this.re = null;
};

FilterGenericHnAnchored.prototype.match = function(url) {
    if ( this.re === null ) {
        this.re = strToRegex('||' + this.s, 0);
    }
    var matchStart = url.search(this.re);
    return matchStart !== -1 && isHnAnchored(url, matchStart);
};

FilterGenericHnAnchored.fid =
FilterGenericHnAnchored.prototype.fid =
FilterGenericHnAnchored.prototype.rtfid = '||_';

FilterGenericHnAnchored.prototype.toSelfie =
FilterGenericHnAnchored.prototype.rtCompile = function() {
    return this.s;
};

FilterGenericHnAnchored.compile = function(details) {
    return details.f;
};

FilterGenericHnAnchored.fromSelfie = function(s) {
    return new FilterGenericHnAnchored(s);
};

/******************************************************************************/

var FilterGenericHnAnchoredHostname = function(s, domainOpt) {
    FilterGenericHnAnchored.call(this, s);
    this.domainOpt = domainOpt;
    this.hostnameTest = hostnameTestPicker(this);
};
FilterGenericHnAnchoredHostname.prototype = Object.create(FilterGenericHnAnchored.prototype);
FilterGenericHnAnchoredHostname.prototype.constructor = FilterGenericHnAnchoredHostname;

FilterGenericHnAnchoredHostname.prototype.match = function(url) {
    return this.hostnameTest(this) &&
           FilterGenericHnAnchored.prototype.match.call(this, url);
};

FilterGenericHnAnchoredHostname.fid =
FilterGenericHnAnchoredHostname.prototype.fid =
FilterGenericHnAnchoredHostname.prototype.rtfid = '||_h';

FilterGenericHnAnchoredHostname.prototype.toSelfie =
FilterGenericHnAnchoredHostname.prototype.rtCompile = function() {
    return this.s + '\t' + this.domainOpt;
};

FilterGenericHnAnchoredHostname.compile = function(details) {
    return details.f + '\t' + details.domainOpt;
};

FilterGenericHnAnchoredHostname.fromSelfie = function(s) {
    var pos = s.indexOf('\t');
    return new FilterGenericHnAnchoredHostname(s.slice(0, pos), s.slice(pos + 1));
};

/******************************************************************************/

// Regex-based filters

var FilterRegex = function(s) {
    this.re = new RegExp(s, 'i');
};

FilterRegex.prototype.match = function(url) {
    return this.re.test(url);
};

FilterRegex.fid =
FilterRegex.prototype.fid =
FilterRegex.prototype.rtfid = '//';

FilterRegex.prototype.toSelfie =
FilterRegex.prototype.rtCompile = function() {
    return this.re.source;
};

FilterRegex.compile = function(details) {
    return details.f;
};

FilterRegex.fromSelfie = function(s) {
    return new FilterRegex(s);
};

/******************************************************************************/

var FilterRegexHostname = function(s, domainOpt) {
    this.re = new RegExp(s, 'i');
    this.domainOpt = domainOpt;
    this.hostnameTest = hostnameTestPicker(this);
};

FilterRegexHostname.prototype.match = function(url) {
    // test hostname first, it's cheaper than evaluating a regex
    return this.hostnameTest(this) &&
           this.re.test(url);
};

FilterRegexHostname.fid =
FilterRegexHostname.prototype.fid =
FilterRegexHostname.prototype.rtfid = '//h';

FilterRegexHostname.prototype.toSelfie =
FilterRegexHostname.prototype.rtCompile = function() {
    return this.re.source + '\t' + this.domainOpt;
};

FilterRegexHostname.compile = function(details) {
    return details.f + '\t' + details.domainOpt;
};

FilterRegexHostname.fromSelfie = function(s) {
    var pos = s.indexOf('\t');
    return new FilterRegexHostname(s.slice(0, pos), s.slice(pos + 1));
};

/******************************************************************************/
/******************************************************************************/

// Dictionary of hostnames
//
// FilterHostnameDict is the main reason why uBlock is not equipped to keep
// track of which filter comes from which list, and also why it's not equipped
// to be able to disable a specific filter -- other than through using a
// counter-filter.
//
// On the other hand it is also *one* of the reason uBlock's memory and CPU
// footprint is smaller. Compacting huge list of hostnames into single strings
// saves a lot of memory compared to having one dictionary entry per hostname.

var FilterHostnameDict = function() {
    this.h = ''; // short-lived register
    this.dict = {};
    this.count = 0;
};

// Somewhat arbitrary: I need to come up with hard data to know at which
// point binary search is better than indexOf.
//
// http://jsperf.com/string-indexof-vs-binary-search
// Tuning above performance benchmark, it appears 250 is roughly a good value
// for both Chromium/Firefox.
// Example of benchmark values: '------30', '-----100', etc. -- the
// needle string must always be 8-character long.

FilterHostnameDict.prototype.cutoff = 250;

// Probably not needed under normal circumstances.

FilterHostnameDict.prototype.meltBucket = function(len, bucket) {
    var map = {};
    if ( bucket.startsWith(' ') ) {
        bucket.trim().split(' ').map(function(k) {
            map[k] = true;
        });
    } else {
        var offset = 0;
        while ( offset < bucket.length ) {
            map[bucket.substr(offset, len)] = true;
            offset += len;
        }
    }
    return map;
};

FilterHostnameDict.prototype.freezeBucket = function(bucket) {
    var hostnames = Object.keys(bucket);
    if ( hostnames[0].length * hostnames.length < this.cutoff ) {
        return ' ' + hostnames.join(' ') + ' ';
    }
    return hostnames.sort().join('');
};

// How the key is derived dictates the number and size of buckets:
// - more bits = more buckets = higher memory footprint
// - less bits = less buckets = lower memory footprint
// - binary search mitigates very well the fact that some buckets may grow
//   large when fewer bits are used (or when a large number of items are
//   stored). Binary search also mitigate to the point of non-issue the
//   CPU footprint requirement with large buckets, as far as reference
//   benchmark shows.
//
// A hash key capable of better spread while being as fast would be
// just great.

FilterHostnameDict.prototype.makeKey = function(hn) {
    var len = hn.length;
    if ( len > 255 ) {
        len = 255;
    }
    var i8 = len >>> 3;
    var i4 = len >>> 2;
    var i2 = len >>> 1;

    // http://jsperf.com/makekey-concat-vs-join/3

    // Be sure the msb is not set, this will guarantee a valid unicode
    // character (because 0xD800-0xDFFF).
    return String.fromCharCode(
        (hn.charCodeAt(      i8) & 0x01) << 14 |
//        (hn.charCodeAt(   i4   ) & 0x01) << 13 |
        (hn.charCodeAt(   i4+i8) & 0x01) << 12 |
        (hn.charCodeAt(i2      ) & 0x01) << 11 |
        (hn.charCodeAt(i2   +i8) & 0x01) << 10 |
//        (hn.charCodeAt(i2+i4   ) & 0x01) <<  9 |
        (hn.charCodeAt(i2+i4+i8) & 0x01) <<  8 ,
        len
    );
};

FilterHostnameDict.prototype.add = function(hn) {
    var key = this.makeKey(hn);
    var bucket = this.dict[key];
    if ( bucket === undefined ) {
        bucket = this.dict[key] = {};
        bucket[hn] = true;
        this.count += 1;
        return true;
    }
    if ( typeof bucket === 'string' ) {
        bucket = this.dict[key] = this.meltBucket(hn.length, bucket);
    }
    if ( bucket.hasOwnProperty(hn) ) {
        return false;
    }
    bucket[hn] = true;
    this.count += 1;
    return true;
};

FilterHostnameDict.prototype.freeze = function() {
    var buckets = this.dict;
    var bucket;
    for ( var key in buckets ) {
        bucket = buckets[key];
        if ( typeof bucket === 'object' ) {
            buckets[key] = this.freezeBucket(bucket);
        }
    }
};

FilterHostnameDict.prototype.matchesExactly = function(hn) {
    // TODO: Handle IP address

    var key = this.makeKey(hn);
    var bucket = this.dict[key];
    if ( bucket === undefined ) {
        return false;
    }
    if ( typeof bucket === 'object' ) {
        bucket = this.dict[key] = this.freezeBucket(bucket);
    }
    if ( bucket.startsWith(' ') ) {
        return bucket.indexOf(' ' + hn + ' ') !== -1;
    }
    // binary search
    var len = hn.length;
    var left = 0;
    // http://jsperf.com/or-vs-floor/17
    var right = (bucket.length / len + 0.5) | 0;
    var i, needle;
    while ( left < right ) {
        i = left + right >> 1;
        needle = bucket.substr( len * i, len );
        if ( hn < needle ) {
            right = i;
        } else if ( hn > needle ) {
            left = i + 1;
        } else {
            return true;
        }
    }
    return false;
};

FilterHostnameDict.prototype.match = function() {
    // TODO: mind IP addresses

    var pos,
        hostname = requestHostnameRegister;
    while ( this.matchesExactly(hostname) === false ) {
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

FilterHostnameDict.fid =
FilterHostnameDict.prototype.fid = '{h}';
FilterHostnameDict.rtfid = '.';

FilterHostnameDict.prototype.rtCompile = function() {
    return this.h;
};

FilterHostnameDict.prototype.toSelfie = function() {
    return JSON.stringify({
        count: this.count,
        dict: this.dict
    });
};

FilterHostnameDict.fromSelfie = function(s) {
    var f = new FilterHostnameDict();
    var o = JSON.parse(s);
    f.count = o.count;
    f.dict = o.dict;
    return f;
};

/******************************************************************************/
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

    Object.defineProperty(this, 'rtfid', {
        get: function() {
            return this.f.rtfid;
        }
    });
};

FilterBucket.prototype.add = function(a) {
    this.filters.push(a);
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
    if ( i <= pivot ) {
        return;
    }
    var j = this.promoted % pivot;
    //console.debug('FilterBucket.promote(): promoted %d to %d', i, j);
    var f = filters[j];
    filters[j] = filters[i];
    filters[i] = f;
    this.promoted += 1;
};

FilterBucket.prototype.match = function(url, tokenBeg) {
    var filters = this.filters;
    var n = filters.length;
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

FilterBucket.prototype.fid = '[]';

FilterBucket.prototype.toSelfie = function() {
    return this.filters.length.toString();
};

// Not supposed to be called without a valid filter hit.
FilterBucket.prototype.rtCompile = function() {
    return this.f.rtCompile();
};

FilterBucket.fromSelfie = function() {
    return new FilterBucket();
};

/******************************************************************************/
/******************************************************************************/

var FilterParser = function() {
    this.reHostnameRule1 = /^[0-9a-z][0-9a-z.-]*[0-9a-z]$/i;
    this.reHostnameRule2 = /^\**[0-9a-z][0-9a-z.-]*[0-9a-z]\^?$/i;
    this.reCleanupHostnameRule2 = /^\**|\^$/g;
    this.reHasWildcard = /[\^\*]/;
    this.reCanTrimCarets1 = /^[^*]*$/;
    this.reCanTrimCarets2 = /^\^?[^^]+[^^][^^]+\^?$/;
    this.reHasUppercase = /[A-Z]/;
    this.reIsolateHostname = /^(\*?\.)?([^\x00-\x24\x26-\x2C\x2F\x3A-\x5E\x60\x7B-\x7F]+)(.*)/;
    this.reHasUnicode = /[^\x00-\x7F]/;
    this.domainOpt = '';
    this.reset();
};

/******************************************************************************/

FilterParser.prototype.toNormalizedType = {
        'stylesheet': 'stylesheet',
             'image': 'image',
            'object': 'object',
 'object-subrequest': 'object',
            'script': 'script',
    'xmlhttprequest': 'xmlhttprequest',
       'subdocument': 'sub_frame',
              'font': 'font',
             'media': 'media',
         'websocket': 'websocket',
             'other': 'other',
          'popunder': 'popunder',
          'document': 'main_frame',
          'elemhide': 'elemhide',
     'inline-script': 'inline-script',
             'popup': 'popup'
};

/******************************************************************************/

FilterParser.prototype.reset = function() {
    this.action = BlockAction;
    this.anchor = 0;
    this.elemHiding = false;
    this.f = '';
    this.firstParty = false;
    this.fopts = '';
    this.hostnameAnchored = false;
    this.hostnamePure = false;
    this.domainOpt = '';
    this.isRegex = false;
    this.raw = '';
    this.redirect = false;
    this.thirdParty = false;
    this.token = '*';
    this.tokenBeg = 0;
    this.types = 0;
    this.important = 0;
    this.unsupported = false;
    return this;
};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/589
// Be ready to handle multiple negated types

FilterParser.prototype.parseOptType = function(raw, not) {
    var typeBit = 1 << ((typeNameToTypeValue[this.toNormalizedType[raw]] >>> 4) - 1);

    if ( !not ) {
        this.types |= typeBit;
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

FilterParser.prototype.parseOptParty = function(firstParty, not) {
    if ( firstParty ) {
        not = !not;
    }
    if ( not ) {
        this.firstParty = true;
    } else {
        this.thirdParty = true;
    }
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
            this.parseOptParty(false, not);
            continue;
        }
        // https://issues.adblockplus.org/ticket/616
        // `generichide` concept already supported, just a matter of
        // adding support for the new keyword.
        if ( opt === 'elemhide' || opt === 'generichide' ) {
            if ( this.action === AllowAction ) {
                this.parseOptType('elemhide', false);
                continue;
            }
            this.unsupported = true;
            break;
        }
        if ( opt === 'document' ) {
            if ( this.action === BlockAction ) {
                this.parseOptType('document', not);
                continue;
            }
            this.unsupported = true;
            break;
        }
        if ( this.toNormalizedType.hasOwnProperty(opt) ) {
            this.parseOptType(opt, not);
            continue;
        }
        if ( opt.startsWith('domain=') ) {
            this.domainOpt = opt.slice(7);
            continue;
        }
        if ( opt === 'important' ) {
            this.important = Important;
            continue;
        }
        if ( opt === 'first-party' ) {
            this.parseOptParty(true, not);
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
        // Used by Adguard, purpose is unclear -- just ignore for now.
        if ( opt === 'empty' ) {
            continue;
        }
        // Unrecognized filter option: ignore whole filter.
        this.unsupported = true;
        break;
    }
};

/******************************************************************************/

FilterParser.prototype.parse = function(raw) {
    // important!
    this.reset();

    var s = this.raw = raw;

    // plain hostname? (from HOSTS file)
    if ( this.reHostnameRule1.test(s) ) {
        this.f = s;
        this.hostnamePure = this.hostnameAnchored = true;
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
        this.hostnameAnchored = true;
        s = s.slice(2);

        // convert hostname to punycode if needed
        if ( this.reHasUnicode.test(s) ) {
            var matches = this.reIsolateHostname.exec(s);
            if ( matches ) {
                s = matches[1] + punycode.toASCII(matches[2]) + matches[3];
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
        // A filter can't be a pure-hostname one if there is a domain option
        // present.
        if ( this.domainOpt === '' && this.reHostnameRule2.test(s) ) {
            this.f = s.replace(this.reCleanupHostnameRule2, '');
            this.hostnamePure = true;
            return this;
        }
    }

    // left-anchored
    if ( s.startsWith('|') ) {
        this.anchor = -1;
        s = s.slice(1);
    }

    // right-anchored
    if ( s.endsWith('|') ) {
        this.anchor = 1;
        s = s.slice(0, -1);
    }

    // normalize placeholders
    if ( this.reHasWildcard.test(s) ) {
        // remove pointless leading *
        // https://github.com/gorhill/uBlock/issues/1669#issuecomment-224822448
        // Keep the leading asterisk if we are dealing with a hostname-anchored
        // filter, this will ensure the generic filter implementation is
        // used.
        if ( s.startsWith('*') && this.hostnameAnchored === false ) {
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
        this.hostnameAnchored = false;
    }

    // This might look weird but we gain memory footprint by not going through
    // toLowerCase(), at least on Chromium. Because copy-on-write?

    this.f = this.reHasUppercase.test(s) ? s.toLowerCase() : s;

    return this;
};

/******************************************************************************/

// Given a string, find a good token. Tokens which are too generic, i.e. very
// common with a high probability of ending up as a miss, are not
// good. Avoid if possible. This has a *significant* positive impact on
// performance.
// These "bad tokens" are collated manually.

// Hostname-anchored with no wildcard always have a token index of 0.
var reHostnameToken = /^[0-9a-z]+/g;
var reGoodToken = /[%0-9a-z]{2,}/g;

var badTokens = {
    'com': true,
    'http': true,
    'https': true,
    'icon': true,
    'images': true,
    'img': true,
    'js': true,
    'net': true,
    'news': true,
    'www': true
};

var findFirstGoodToken = function(s) {
    reGoodToken.lastIndex = 0;
    var matches, lpos;
    var badTokenMatch = null;
    while ( (matches = reGoodToken.exec(s)) ) {
        // https://github.com/gorhill/uBlock/issues/997
        // Ignore token if preceded by wildcard.
        lpos = matches.index;
        if ( lpos !== 0 && s.charAt(lpos - 1) === '*' ) {
            continue;
        }
        if ( s.charAt(reGoodToken.lastIndex) === '*' ) {
            continue;
        }
        if ( badTokens.hasOwnProperty(matches[0]) ) {
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
    reHostnameToken.lastIndex = 0;
    return reHostnameToken.exec(s);
};

/******************************************************************************/

FilterParser.prototype.makeToken = function() {
    // https://github.com/chrisaljoudi/uBlock/issues/1038
    // Single asterisk will match any URL.
    if ( this.isRegex || this.f === '*' ) {
        return;
    }

    var matches = this.hostnameAnchored && this.f.indexOf('*') === -1 ?
        findHostnameToken(this.f) :
        findFirstGoodToken(this.f);

    if ( matches !== null && matches[0].length !== 0 ) {
        this.token = matches[0];
        this.tokenBeg = matches.index;
    }
};

/******************************************************************************/
/******************************************************************************/

var FilterContainer = function() {
    this.reIsGeneric = /[\^\*]/;
    this.filterParser = new FilterParser();
    this.urlTokenizer = µb.urlTokenizer;
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
    this.duplicateBuster = {};
    this.categories = Object.create(null);
    this.filterParser.reset();
    this.filterCounts = {};

    // Runtime registers
    this.keyRegister = undefined;
    this.tokenRegister = undefined;
    this.fRegister = null;
};

/******************************************************************************/

FilterContainer.prototype.freeze = function() {
    histogram('allFilters', this.categories);
    this.duplicateBuster = {};

    var categories = this.categories;
    var bucket;
    for ( var k in categories ) {
        bucket = categories[k]['.'];
        if ( bucket !== undefined ) {
            bucket.freeze();
        }
    }

    this.filterParser.reset();
    this.frozen = true;
};

/******************************************************************************/

FilterContainer.prototype.factories = {
      '[]': FilterBucket,
       'a': FilterPlain,
      'ah': FilterPlainHostname,
      '0a': FilterPlainPrefix0,
     '0ah': FilterPlainPrefix0Hostname,
      '1a': FilterPlainPrefix1,
     '1ah': FilterPlainPrefix1Hostname,
      '|a': FilterPlainLeftAnchored,
     '|ah': FilterPlainLeftAnchoredHostname,
      'a|': FilterPlainRightAnchored,
     'a|h': FilterPlainRightAnchoredHostname,
     '||a': FilterPlainHnAnchored,
    '||ah': FilterPlainHnAnchoredHostname,
      '//': FilterRegex,
     '//h': FilterRegexHostname,
     '{h}': FilterHostnameDict,
       '_': FilterGeneric,
      '_h': FilterGenericHostname,
     '||_': FilterGenericHnAnchored,
    '||_h': FilterGenericHnAnchoredHostname
};

/******************************************************************************/

FilterContainer.prototype.toSelfie = function() {
    var categoryToSelfie = function(dict) {
        var selfie = [];
        var bucket, ff, n, i, f;
        for ( var token in dict ) {
            // No need for hasOwnProperty() here: there is no prototype chain.
            selfie.push('k2\t' + token);
            bucket = dict[token];
            selfie.push(bucket.fid + '\t' + bucket.toSelfie());
            if ( bucket.fid !== '[]' ) {
                continue;
            }
            ff = bucket.filters;
            n = ff.length;
            for ( i = 0; i < n; i++ ) {
                f = ff[i];
                selfie.push(f.fid + '\t' + f.toSelfie());
            }
        }
        return selfie.join('\n');
    };

    var categoriesToSelfie = function(dict) {
        var selfie = [];
        for ( var key in dict ) {
            // No need for hasOwnProperty() here: there is no prototype chain.
            selfie.push('k1\t' + key);
            selfie.push(categoryToSelfie(dict[key]));
        }
        return selfie.join('\n');
    };

    return {
        processedFilterCount: this.processedFilterCount,
        acceptedCount: this.acceptedCount,
        rejectedCount: this.rejectedCount,
        allowFilterCount: this.allowFilterCount,
        blockFilterCount: this.blockFilterCount,
        discardedCount: this.discardedCount,
        categories: categoriesToSelfie(this.categories)
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

    var catKey, tokenKey;
    var dict = this.categories, subdict;
    var bucket = null;
    var rawText = selfie.categories;
    var rawEnd = rawText.length;
    var lineBeg = 0, lineEnd;
    var line, pos, what, factory;
    while ( lineBeg < rawEnd ) {
        lineEnd = rawText.indexOf('\n', lineBeg);
        if ( lineEnd < 0 ) {
            lineEnd = rawEnd;
        }
        line = rawText.slice(lineBeg, lineEnd);
        lineBeg = lineEnd + 1;
        pos = line.indexOf('\t');
        what = line.slice(0, pos);
        if ( what === 'k1' ) {
            catKey = line.slice(pos + 1);
            subdict = dict[catKey] = Object.create(null);
            bucket = null;
            continue;
        }
        if ( what === 'k2' ) {
            tokenKey = line.slice(pos + 1);
            bucket = null;
            continue;
        }
        factory = this.factories[what];
        if ( bucket === null ) {
            bucket = subdict[tokenKey] = factory.fromSelfie(line.slice(pos + 1));
            continue;
        }
        // When token key is reused, it can't be anything
        // else than FilterBucket
        bucket.add(factory.fromSelfie(line.slice(pos + 1)));
    }
};

/******************************************************************************/

FilterContainer.prototype.getFilterClass = function(details) {
    var s = details.f;

    if ( details.domainOpt.length !== 0 ) {
        if ( details.isRegex ) {
            return FilterRegexHostname;
        }
        if ( this.reIsGeneric.test(s) ) {
            if ( details.hostnameAnchored ) {
                return FilterGenericHnAnchoredHostname;
            }
            return FilterGenericHostname;
        }
        if ( details.anchor < 0 ) {
            return FilterPlainLeftAnchoredHostname;
        }
        if ( details.anchor > 0 ) {
            return FilterPlainRightAnchoredHostname;
        }
        if ( details.hostnameAnchored ) {
            return FilterPlainHnAnchoredHostname;
        }
        if ( details.tokenBeg === 0 ) {
            return FilterPlainPrefix0Hostname;
        }
        if ( details.tokenBeg === 1 ) {
            return FilterPlainPrefix1Hostname;
        }
        return FilterPlainHostname;
    }

    if ( details.isRegex ) {
        return FilterRegex;
    }
    if ( this.reIsGeneric.test(s) ) {
        if ( details.hostnameAnchored ) {
            return FilterGenericHnAnchored;
        }
        return FilterGeneric;
    }
    if ( details.anchor < 0 ) {
        return FilterPlainLeftAnchored;
    }
    if ( details.anchor > 0 ) {
        return FilterPlainRightAnchored;
    }
    if ( details.hostnameAnchored ) {
        return FilterPlainHnAnchored;
    }
    if ( details.tokenBeg === 0 ) {
        return FilterPlainPrefix0;
    }
    if ( details.tokenBeg === 1 ) {
        return FilterPlainPrefix1;
    }
    return FilterPlain;
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
        //console.log('static-net-filtering.js > FilterContainer.add(): unsupported filter "%s"', raw);
        return false;
    }

    // Pure hostnames, use more efficient liquid dict
    // https://github.com/chrisaljoudi/uBlock/issues/665
    // Create a dict keyed on request type etc.
    if ( parsed.hostnamePure && this.compileHostnameOnlyFilter(parsed, out) ) {
        return true;
    }

    var r = this.compileFilter(parsed, out);
    if ( r === false ) {
        return false;
    }

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

    var party = AnyParty;
    if ( parsed.firstParty !== parsed.thirdParty ) {
        party = parsed.firstParty ? FirstParty : ThirdParty;
    }
    var keyShard = parsed.action | parsed.important | party;

    var type = parsed.types;
    if ( type === 0 ) {
        out.push(
            'n\v' +
            toHex(keyShard) + '\v' +
            '.\v' +
            parsed.f
        );
        return true;
    }

    var bitOffset = 1;
    do {
        if ( type & 1 ) {
            out.push(
                'n\v' +
                toHex(keyShard | (bitOffset << 4)) + '\v' +
                '.\v' +
                parsed.f
            );
        }
        bitOffset += 1;
        type >>>= 1;
    } while ( type !== 0 );
    return true;
};

/******************************************************************************/

FilterContainer.prototype.compileFilter = function(parsed, out) {
    parsed.makeToken();

    var party = AnyParty;
    if ( parsed.firstParty !== parsed.thirdParty ) {
        party = parsed.firstParty ? FirstParty : ThirdParty;
    }

    var filterClass = this.getFilterClass(parsed);
    if ( filterClass === null ) {
        return false;
    }
    this.compileToAtomicFilter(filterClass, parsed, party, out);
    return true;
};

/******************************************************************************/

FilterContainer.prototype.compileToAtomicFilter = function(filterClass, parsed, party, out) {
    var bits = parsed.action | parsed.important | party;
    var type = parsed.types;
    if ( type === 0 ) {
        out.push(
            'n\v' +
            toHex(bits) + '\v' +
            parsed.token + '\v' +
            filterClass.fid + '\v' +
            filterClass.compile(parsed)
        );
        return;
    }
    var bitOffset = 1;
    do {
        if ( type & 1 ) {
            out.push(
                'n\v' +
                toHex(bits | (bitOffset << 4)) + '\v' +
                parsed.token + '\v' +
                filterClass.fid + '\v' +
                filterClass.compile(parsed)
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

    var redirects = µb.redirectEngine.compileRuleFromStaticFilter(parsed.raw);
    if ( Array.isArray(redirects) === false ) {
        return;
    }
    var i = redirects.length;
    while ( i-- ) {
        out.push('n\v\v\v=>\v' + redirects[i]);
    }
};

/******************************************************************************/

FilterContainer.prototype.fromCompiledContent = function(lineIter) {
    var line, fields, bucket, entry, factory, filter;

    while ( lineIter.eot() === false ) {
        if ( lineIter.text.charCodeAt(lineIter.offset) !== 0x6E /* 'n' */ ) {
            return;
        }
        line = lineIter.next().slice(2);
        fields = line.split('\v');

        // Special cases: delegate to more specialized engines.
        // Redirect engine.
        if ( fields[2] === '=>' ) {
            µb.redirectEngine.fromCompiledRule(fields[3]);
            continue;
        }

        // Plain static filters.
        this.acceptedCount += 1;

        bucket = this.categories[fields[0]];
        if ( bucket === undefined ) {
            bucket = this.categories[fields[0]] = Object.create(null);
        }
        entry = bucket[fields[1]];

        if ( fields[1] === '.' ) {
            if ( entry === undefined ) {
                entry = bucket['.'] = new FilterHostnameDict();
            }
            if ( entry.add(fields[2]) === false ) {
                this.discardedCount += 1;
            }
            continue;
        }

        if ( this.duplicateBuster.hasOwnProperty(line) ) {
            this.discardedCount += 1;
            continue;
        }
        this.duplicateBuster[line] = true;

        factory = this.factories[fields[2]];

        // For development purpose
        //if ( this.filterCounts.hasOwnProperty(fields[2]) === false ) {
        //    this.filterCounts[fields[2]] = 1;
        //} else {
        //    this.filterCounts[fields[2]]++;
        //}

        filter = factory.fromSelfie(fields[3]);
        if ( entry === undefined ) {
            bucket[fields[1]] = filter;
            continue;
        }
        if ( entry.fid === '[]' ) {
            entry.add(filter);
            continue;
        }
        bucket[fields[1]] = new FilterBucket(entry, filter);
    }
};

/******************************************************************************/

FilterContainer.prototype.filterStringFromCompiled = function(compiled) {
    var opts = [];
    var vfields = compiled.split('\v');
    var filter = '';
    var bits = parseInt(vfields[0], 16) | 0;

    if ( bits & 0x01 ) {
        filter += '@@';
    }

    var rfid = vfields[1] === '.' ? '.' : vfields[2];
    var tfields = rfid !== '.' ? vfields[3].split('\t') : [];

    switch ( rfid ) {
    case '.':
        filter += '||' + vfields[2] + '^';
        break;
    case 'a':
    case 'ah':
    case '0a':
    case '0ah':
    case '1a':
    case '1ah':
    case '_':
    case '_h':
        filter += tfields[0];
        break;
    case '|a':
    case '|ah':
        filter += '|' + tfields[0];
        break;
    case 'a|':
    case 'a|h':
        filter += tfields[0] + '|';
        break;
    case '||a':
    case '||ah':
    case '||_':
    case '||_h':
        filter += '||' + tfields[0];
        break;
    case '//':
    case '//h':
        filter += '/' + tfields[0] + '/';
        break;
    default:
        break;
    }

    // Domain option?
    switch ( rfid ) {
    case '0ah':
    case '1ah':
    case '|ah':
    case 'a|h':
    case '||ah':
    case '||_h':
    case '//h':
        opts.push('domain=' + tfields[1]);
        break;
    case 'ah':
    case '_h':
        opts.push('domain=' + tfields[2]);
        break;
    default:
        break;
    }

    // Filter options
    if ( bits & 0x02 ) {
        opts.push('important');
    }
    if ( bits & 0x08 ) {
        opts.push('third-party');
    } else if ( bits & 0x04 ) {
        opts.push('first-party');
    }
    if ( bits & 0xF0 ) {
        opts.push(typeValueToTypeName[bits >>> 4]);
    }
    if ( opts.length !== 0 ) {
        filter += '$' + opts.join(',');
    }

    return filter;
};

/******************************************************************************/

FilterContainer.prototype.filterRegexFromCompiled = function(compiled, flags) {
    var vfields = compiled.split('\v');
    var rfid = vfields[1] === '.' ? '.' : vfields[2];
    var tfields = rfid !== '.' ? vfields[3].split('\t') : [];
    var re = null;

    switch ( rfid ) {
    case '.':
        re = strToRegex(vfields[2], 0, flags);
        break;
    case 'a':
    case 'ah':
    case '0a':
    case '0ah':
    case '1a':
    case '1ah':
    case '_':
    case '_h':
        re = strToRegex(tfields[0], 0, flags);
        break;
    case '||a':
    case '||ah':
    case '||_':
    case '||_h':
        re = strToRegex('||' + tfields[0], 0, flags);
        break;
    case '|a':
    case '|ah':
        re = strToRegex(tfields[0], -1, flags);
        break;
    case 'a|':
    case 'a|h':
        re = strToRegex(tfields[0], 1, flags);
        break;
    case '//':
    case '//h':
        re = new RegExp(tfields[0]);
        break;
    default:
        break;
    }

    return re;
};

/******************************************************************************/

FilterContainer.prototype.matchTokens = function(bucket, url) {
    // Hostname-only filters
    var f = bucket['.'];
    if ( f !== undefined && f.match() ) {
        this.tokenRegister = '.';
        this.fRegister = f;
        return true;
    }

    var tokens = this.urlTokenizer.getTokens();
    var tokenEntry, token;
    var i = 0;
    for (;;) {
        tokenEntry = tokens[i++];
        token = tokenEntry.token;
        if ( token === '' ) {
            break;
        }
        f = bucket[token];
        if ( f !== undefined && f.match(url, tokenEntry.beg) ) {
            this.tokenRegister = token;
            this.fRegister = f;
            return true;
        }
    }

    // Regex-based filters
    f = bucket['*'];
    if ( f !== undefined && f.match(url) ) {
        this.tokenRegister = '*';
        this.fRegister = f;
        return true;
    }

    return false;
};

/******************************************************************************/

// Specialized handlers

// https://github.com/chrisaljoudi/uBlock/issues/116
// Some type of requests are exceptional, they need custom handling,
// not the generic handling.

FilterContainer.prototype.matchStringExactType = function(context, requestURL, requestType) {
    // Be prepared to support unknown types
    var type = typeNameToTypeValue[requestType] || 0;
    if ( type === 0 ) {
        return undefined;
    }

    // Prime tokenizer: we get a normalized URL in return.
    var url = this.urlTokenizer.setURL(requestURL);

    // These registers will be used by various filters
    pageHostnameRegister = context.pageHostname || '';
    requestHostnameRegister = µb.URI.hostnameFromURI(url);

    var party = isFirstParty(context.pageDomain, requestHostnameRegister) ? FirstParty : ThirdParty;

    this.fRegister = null;

    var categories = this.categories;
    var key, bucket;

    // https://github.com/gorhill/uBlock/issues/1477
    // Special case: blocking elemhide filter ALWAYS exists, it is implicit --
    // thus we always and only check for exception filters.
    if ( requestType === 'elemhide' ) {
        key = AllowAnyParty | type;
        if (
            (bucket = categories[toHex(key)]) &&
            this.matchTokens(bucket, url)
        ) {
            this.keyRegister = key;
            return false;
        }
        return undefined;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/139
    // Test against important block filters
    key = BlockAnyParty | Important | type;
    if ( (bucket = categories[toHex(key)]) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.keyRegister = key;
            return true;
        }
    }
    key = BlockAction | Important | type | party;
    if ( (bucket = categories[toHex(key)]) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.keyRegister = key;
            return true;
        }
    }

    // Test against block filters
    key = BlockAnyParty | type;
    if ( (bucket = categories[toHex(key)]) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.keyRegister = key;
        }
    }
    if ( this.fRegister === null ) {
        key = BlockAction | type | party;
        if ( (bucket = categories[toHex(key)]) ) {
            if ( this.matchTokens(bucket, url) ) {
                this.keyRegister = key;
            }
        }
    }

    // If there is no block filter, no need to test against allow filters
    if ( this.fRegister === null ) {
        return undefined;
    }

    // Test against allow filters
    key = AllowAnyParty | type;
    if ( (bucket = categories[toHex(key)]) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.keyRegister = key;
            return false;
        }
    }
    key = AllowAction | type | party;
    if ( (bucket = categories[toHex(key)]) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.keyRegister = key;
            return false;
        }
    }

    return true;
};

/******************************************************************************/

FilterContainer.prototype.matchString = function(context) {
    // https://github.com/chrisaljoudi/uBlock/issues/519
    // Use exact type match for anything beyond `other`
    // Also, be prepared to support unknown types
    var type = typeNameToTypeValue[context.requestType] || typeOtherValue;
    if ( type > typeOtherValue ) {
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

    var party = isFirstParty(context.pageDomain, context.requestHostname) ? FirstParty : ThirdParty;
    var categories = this.categories;
    var key, bucket;

    // https://github.com/chrisaljoudi/uBlock/issues/139
    // Test against important block filters.
    // The purpose of the `important` option is to reverse the order of
    // evaluation. Normally, it is "evaluate block then evaluate allow", with
    // the `important` property it is "evaluate allow then evaluate block".
    key = BlockAnyTypeAnyParty | Important;
    if ( (bucket = categories[toHex(key)]) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.keyRegister = key;
            return true;
        }
    }
    key = BlockAnyType | Important | party;
    if ( (bucket = categories[toHex(key)]) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.keyRegister = key;
            return true;
        }
    }
    key = BlockAnyParty | Important | type;
    if ( (bucket = categories[toHex(key)]) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.keyRegister = key;
            return true;
        }
    }
    key = BlockAction | Important | type | party;
    if ( (bucket = categories[toHex(key)]) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.keyRegister = key;
            return true;
        }
    }

    // Test against block filters
    key = BlockAnyTypeAnyParty;
    if ( (bucket = categories[toHex(key)]) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.keyRegister = key;
        }
    }
    if ( this.fRegister === null ) {
        key = BlockAnyType | party;
        if ( (bucket = categories[toHex(key)]) ) {
            if ( this.matchTokens(bucket, url) ) {
                this.keyRegister = key;
            }
        }
        if ( this.fRegister === null ) {
            key = BlockAnyParty | type;
            if ( (bucket = categories[toHex(key)]) ) {
                if ( this.matchTokens(bucket, url) ) {
                    this.keyRegister = key;
                }
            }
            if ( this.fRegister === null ) {
                key = BlockAction | type | party;
                if ( (bucket = categories[toHex(key)]) ) {
                    if ( this.matchTokens(bucket, url) ) {
                        this.keyRegister = key;
                    }
                }
            }
        }
    }

    // If there is no block filter, no need to test against allow filters
    if ( this.fRegister === null ) {
        return undefined;
    }

    // Test against allow filters
    key = AllowAnyTypeAnyParty;
    if ( (bucket = categories[toHex(key)]) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.keyRegister = key;
            return false;
        }
    }
    key = AllowAnyType | party;
    if ( (bucket = categories[toHex(key)]) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.keyRegister = key;
            return false;
        }
    }
    key = AllowAnyParty | type;
    if ( (bucket = categories[toHex(key)]) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.keyRegister = key;
            return false;
        }
    }
    key = AllowAction | type | party;
    if ( (bucket = categories[toHex(key)]) ) {
        if ( this.matchTokens(bucket, url) ) {
            this.keyRegister = key;
            return false;
        }
    }

    return true;
};

/******************************************************************************/

// The `verbose` argment tells whether to return a short or long version of
// the filter string. Typically, if the logger is not enabled, there is no
// point in returning the long version: this saves overhead.

FilterContainer.prototype.toResultString = function(verbose) {
    if ( this.fRegister === null ) {
        return '';
    }
    var s = this.keyRegister & 0x01 ? 'sa:' : 'sb:';
    if ( !verbose ) {
        return s;
    }
    s += toHex(this.keyRegister) + '\v' + this.tokenRegister + '\v';
    if ( this.tokenRegister === '.' ) {
        s += this.fRegister.rtCompile();
    } else {
        s += this.fRegister.rtfid + '\v' + this.fRegister.rtCompile();
    }
    return s;
};

/******************************************************************************/

FilterContainer.prototype.getFilterCount = function() {
    return this.acceptedCount - this.discardedCount;
};

/******************************************************************************/

return new FilterContainer();

/******************************************************************************/

})();

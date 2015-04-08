/*******************************************************************************

    µBlock - a browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

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

    Home: https://github.com/chrisaljoudi/uBlock
*/

/* jshint bitwise: false, esnext: true, boss: true */
/* global punycode, µBlock */

/******************************************************************************/

µBlock.staticNetFilteringEngine = (function(){

'use strict';

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
var ToggleAction = BlockAction ^ AllowAction;

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
             'other':  7 << 4,
'cosmetic-filtering': 13 << 4,
     'inline-script': 14 << 4,
             'popup': 15 << 4
};
var typeOtherValue = typeNameToTypeValue.other;

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

var reHostnameRule = /^[0-9a-z][0-9a-z.-]*[0-9a-z]$/;
var reURLPostHostnameAnchors = /[\/?#]/;

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

// Could be replaced with encodeURIComponent/decodeURIComponent,
// which seems faster on Firefox.
var encode = JSON.stringify;
var decode = JSON.parse;

var cachedParseInt = parseInt;

var atoi = function(s) {
    return cachedParseInt(s, 10);
};

var isFirstParty = function(firstPartyDomain, hostname) {
    if ( hostname.slice(0 - firstPartyDomain.length) !== firstPartyDomain ) {
        return false;
    }
    // Be sure to not confuse 'example.com' with 'anotherexample.com'
    var c = hostname.charAt(hostname.length - firstPartyDomain.length - 1);
    return c === '.' || c === '';
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

var strToRegex = function(s, anchor) {
    // https://github.com/chrisaljoudi/uBlock/issues/1038
    // Special case: always match.
    if ( s === '*' ) {
        return alwaysTruePseudoRegex;
    }

    // https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions
    var reStr = s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
                 .replace(/\*/g, '.*');

    if ( anchor < 0 ) {
        reStr = '^' + reStr;
    } else if ( anchor > 0 ) {
        reStr += reStr + '$';
    }

    //console.debug('µBlock.staticNetFilteringEngine: created RegExp("%s")', reStr);
    return new RegExp(reStr);
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
    return url.substr(tokenBeg - this.tokenBeg, this.s.length) === this.s;
};

FilterPlain.fid = FilterPlain.prototype.fid = 'a';

FilterPlain.prototype.toString = function() {
    return this.s;
};

FilterPlain.prototype.toSelfie = function() {
    return this.s + '\t' +
           this.tokenBeg;
};

FilterPlain.compile = function(details) {
    return details.f + '\t' + details.tokenBeg;
};

FilterPlain.fromSelfie = function(s) {
    var pos = s.indexOf('\t');
    return new FilterPlain(s.slice(0, pos), atoi(s.slice(pos + 1)));
};

/******************************************************************************/

var FilterPlainHostname = function(s, tokenBeg, hostname) {
    this.s = s;
    this.tokenBeg = tokenBeg;
    this.hostname = hostname;
};

FilterPlainHostname.prototype.match = function(url, tokenBeg) {
    return pageHostnameRegister.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg - this.tokenBeg, this.s.length) === this.s;
};

FilterPlainHostname.fid = FilterPlainHostname.prototype.fid = 'ah';

FilterPlainHostname.prototype.toString = function() {
    return this.s + '$domain=' + this.hostname;
};

FilterPlainHostname.prototype.toSelfie = function() {
    return this.s + '\t' +
           this.tokenBeg + '\t' +
           this.hostname;
};

FilterPlainHostname.compile = function(details, hostname) {
    return details.f + '\t' +
           details.tokenBeg + '\t' +
           hostname;
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
    return url.substr(tokenBeg, this.s.length) === this.s;
};

FilterPlainPrefix0.fid = FilterPlainPrefix0.prototype.fid = '0a';

FilterPlainPrefix0.prototype.toString = function() {
    return this.s;
};

FilterPlainPrefix0.prototype.toSelfie = function() {
    return this.s;
};

FilterPlainPrefix0.compile = function(details) {
    return details.f;
};

FilterPlainPrefix0.fromSelfie = function(s) {
    return new FilterPlainPrefix0(s);
};

/******************************************************************************/

var FilterPlainPrefix0Hostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterPlainPrefix0Hostname.prototype.match = function(url, tokenBeg) {
    return pageHostnameRegister.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg, this.s.length) === this.s;
};

FilterPlainPrefix0Hostname.fid = FilterPlainPrefix0Hostname.prototype.fid = '0ah';

FilterPlainPrefix0Hostname.prototype.toString = function() {
    return this.s + '$domain=' + this.hostname;
};

FilterPlainPrefix0Hostname.prototype.toSelfie = function() {
    return this.s + '\t' +
           this.hostname;
};

FilterPlainPrefix0Hostname.compile = function(details, hostname) {
    return details.f + '\t' + hostname;
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
    return url.substr(tokenBeg - 1, this.s.length) === this.s;
};

FilterPlainPrefix1.fid = FilterPlainPrefix1.prototype.fid = '1a';

FilterPlainPrefix1.prototype.toString = function() {
    return this.s;
};

FilterPlainPrefix1.prototype.toSelfie = function() {
    return this.s;
};

FilterPlainPrefix1.compile = function(details) {
    return details.f;
};

FilterPlainPrefix1.fromSelfie = function(s) {
    return new FilterPlainPrefix1(s);
};

/******************************************************************************/

var FilterPlainPrefix1Hostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterPlainPrefix1Hostname.prototype.match = function(url, tokenBeg) {
    return pageHostnameRegister.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg - 1, this.s.length) === this.s;
};

FilterPlainPrefix1Hostname.fid = FilterPlainPrefix1Hostname.prototype.fid = '1ah';

FilterPlainPrefix1Hostname.prototype.toString = function() {
    return this.s + '$domain=' + this.hostname;
};

FilterPlainPrefix1Hostname.prototype.toSelfie = function() {
    return this.s + '\t' +
           this.hostname;
};

FilterPlainPrefix1Hostname.compile = function(details, hostname) {
    return details.f + '\t' + hostname;
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
    return url.slice(0, this.s.length) === this.s;
};

FilterPlainLeftAnchored.fid = FilterPlainLeftAnchored.prototype.fid = '|a';

FilterPlainLeftAnchored.prototype.toString = function() {
    return '|' + this.s;
};

FilterPlainLeftAnchored.prototype.toSelfie = function() {
    return this.s;
};

FilterPlainLeftAnchored.compile = function(details) {
    return details.f;
};

FilterPlainLeftAnchored.fromSelfie = function(s) {
    return new FilterPlainLeftAnchored(s);
};

/******************************************************************************/

var FilterPlainLeftAnchoredHostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterPlainLeftAnchoredHostname.prototype.match = function(url) {
    return pageHostnameRegister.slice(-this.hostname.length) === this.hostname &&
           url.slice(0, this.s.length) === this.s;
};

FilterPlainLeftAnchoredHostname.fid = FilterPlainLeftAnchoredHostname.prototype.fid = '|ah';

FilterPlainLeftAnchoredHostname.prototype.toString = function() {
    return '|' + this.s + '$domain=' + this.hostname;
};

FilterPlainLeftAnchoredHostname.prototype.toSelfie = function() {
    return this.s + '\t' +
           this.hostname;
};

FilterPlainLeftAnchoredHostname.compile = function(details, hostname) {
    return details.f + '\t' + hostname;
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
    return url.slice(-this.s.length) === this.s;
};

FilterPlainRightAnchored.fid = FilterPlainRightAnchored.prototype.fid = 'a|';

FilterPlainRightAnchored.prototype.toString = function() {
    return this.s + '|';
};

FilterPlainRightAnchored.prototype.toSelfie = function() {
    return this.s;
};

FilterPlainRightAnchored.compile = function(details) {
    return details.f;
};

FilterPlainRightAnchored.fromSelfie = function(s) {
    return new FilterPlainRightAnchored(s);
};

/******************************************************************************/

var FilterPlainRightAnchoredHostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterPlainRightAnchoredHostname.prototype.match = function(url) {
    return pageHostnameRegister.slice(-this.hostname.length) === this.hostname &&
           url.slice(-this.s.length) === this.s;
};

FilterPlainRightAnchoredHostname.fid = FilterPlainRightAnchoredHostname.prototype.fid = 'a|h';

FilterPlainRightAnchoredHostname.prototype.toString = function() {
    return this.s + '|$domain=' + this.hostname;
};

FilterPlainRightAnchoredHostname.prototype.toSelfie = function() {
    return this.s + '\t' +
           this.hostname;
};

FilterPlainRightAnchoredHostname.compile = function(details, hostname) {
    return details.f + '\t' + hostname;
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
    if ( url.substr(tokenBeg, this.s.length) !== this.s ) {
        return false;
    }
    // Valid only if hostname-valid characters to the left of token
    var pos = url.indexOf('://');
    return pos !== -1 &&
           reURLPostHostnameAnchors.test(url.slice(pos + 3, tokenBeg)) === false;
};

FilterPlainHnAnchored.fid = FilterPlainHnAnchored.prototype.fid = '||a';

FilterPlainHnAnchored.prototype.toString = function() {
    return '||' + this.s;
};

FilterPlainHnAnchored.prototype.toSelfie = function() {
    return this.s;
};

FilterPlainHnAnchored.compile = function(details) {
    return details.f;
};

FilterPlainHnAnchored.fromSelfie = function(s) {
    return new FilterPlainHnAnchored(s);
};

// https://www.youtube.com/watch?v=71YS6xDB-E4

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

FilterGeneric.fid = FilterGeneric.prototype.fid = '_';

FilterGeneric.prototype.toString = function() {
    if ( this.anchor === 0 ) {
        return this.s;
    }
    if ( this.anchor < 0 ) {
        return '|' + this.s;
    }
    return this.s + '|';
};

FilterGeneric.prototype.toSelfie = function() {
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

var FilterGenericHostname = function(s, anchor, hostname) {
    FilterGeneric.call(this, s, anchor);
    this.hostname = hostname;
};
FilterGenericHostname.prototype = Object.create(FilterGeneric.prototype);
FilterGenericHostname.prototype.constructor = FilterGenericHostname;

FilterGenericHostname.prototype.match = function(url) {
    if ( pageHostnameRegister.slice(-this.hostname.length) !== this.hostname ) {
        return false;
    }
    return FilterGeneric.prototype.match.call(this, url);
};

FilterGenericHostname.fid = FilterGenericHostname.prototype.fid = '_h';

FilterGenericHostname.prototype.toString = function() {
    return FilterGeneric.prototype.toString.call(this) + '$domain=' + this.hostname;
};

FilterGenericHostname.prototype.toSelfie = function() {
    return FilterGeneric.prototype.toSelfie.call(this) + '\t' + this.hostname;
};

FilterGenericHostname.compile = function(details, hostname) {
    return FilterGeneric.compile(details) + '\t' + hostname;
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
        this.re = strToRegex(this.s, 0);
    }
    // Quick test first
    if ( this.re.test(url) === false ) {
        return false;
    }
    // Valid only if begininning of match is within the hostname
    // part of the url
    var match = this.re.exec(url);
    var pos = url.indexOf('://');
    return pos !== -1 &&
           reURLPostHostnameAnchors.test(url.slice(pos + 3, match.index)) === false;
};

FilterGenericHnAnchored.fid = FilterGenericHnAnchored.prototype.fid = '||_';

FilterGenericHnAnchored.prototype.toString = function() {
    return '||' + this.s;
};

FilterGenericHnAnchored.prototype.toSelfie = function() {
    return this.s;
};

FilterGenericHnAnchored.compile = function(details) {
    return details.f;
};

FilterGenericHnAnchored.fromSelfie = function(s) {
    return new FilterGenericHnAnchored(s);
};

/******************************************************************************/

var FilterGenericHnAnchoredHostname = function(s, hostname) {
    FilterGenericHnAnchored.call(this, s);
    this.hostname = hostname;
};
FilterGenericHnAnchoredHostname.prototype = Object.create(FilterGenericHnAnchored.prototype);
FilterGenericHnAnchoredHostname.prototype.constructor = FilterGenericHnAnchoredHostname;

FilterGenericHnAnchoredHostname.prototype.match = function(url) {
    if ( pageHostnameRegister.slice(-this.hostname.length) !== this.hostname ) {
        return false;
    }
    return FilterGenericHnAnchored.prototype.match.call(this, url);
};

FilterGenericHnAnchoredHostname.fid = FilterGenericHnAnchoredHostname.prototype.fid = '||_h';

FilterGenericHnAnchoredHostname.prototype.toString = function() {
    return '||' + this.s + '$domain=' + this.hostname;
};

FilterGenericHnAnchoredHostname.prototype.toSelfie = function() {
    return this.s + '\t' + this.hostname;
};

FilterGenericHnAnchoredHostname.compile = function(details, hostname) {
    return details.f + '\t' + hostname;
};

FilterGenericHnAnchoredHostname.fromSelfie = function(s) {
    var pos = s.indexOf('\t');
    return new FilterGenericHnAnchoredHostname(s.slice(0, pos), s.slice(pos + 1));
};

/******************************************************************************/

// Regex-based filters

var FilterRegex = function(s) {
    this.re = new RegExp(s);
};

FilterRegex.prototype.match = function(url) {
    return this.re.test(url);
};

FilterRegex.fid = FilterRegex.prototype.fid = '//';

FilterRegex.prototype.toString = function() {
    return '/' + this.re.source + '/';
};

FilterRegex.prototype.toSelfie = function() {
    return this.re.source;
};

FilterRegex.compile = function(details) {
    return details.f;
};

FilterRegex.fromSelfie = function(s) {
    return new FilterRegex(s);
};

/******************************************************************************/

var FilterRegexHostname = function(s, hostname) {
    this.re = new RegExp(s);
    this.hostname = hostname;
};

FilterRegexHostname.prototype.match = function(url) {
    // test hostname first, it's cheaper than evaluating a regex
    return pageHostnameRegister.slice(-this.hostname.length) === this.hostname &&
           this.re.test(url);
};

FilterRegexHostname.fid = FilterRegexHostname.prototype.fid = '//h';

FilterRegexHostname.prototype.toString = function() {
    return '/' + this.re.source + '/$domain=' + this.hostname;
};

FilterRegexHostname.prototype.toSelfie = function() {
    return this.re.source + '\t' + this.hostname;
};

FilterRegexHostname.compile = function(details, hostname) {
    return details.f + '\t' + hostname;
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
    if ( bucket.charAt(0) === ' ' ) {
        bucket.trim().split(' ').map(function(k) {
            map[k] = true;
        });
    } else {
        var offset = 0;
        while ( offset < bucket.length ) {
            map[bucket.substring(offset, len)] = true;
            offset += len;
        }
    }
    return map;
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
        bucket = this.dict[key] = this.meltBucket(hn.len, bucket);
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
    var bucket, hostnames, len;
    for ( var key in buckets ) {
        bucket = buckets[key];
        if ( typeof bucket !== 'object' ) {
            continue;
        }
        hostnames = Object.keys(bucket);
        len = hostnames[0].length * hostnames.length;
        if ( hostnames[0].length * hostnames.length < this.cutoff ) {
            buckets[key] = ' ' + hostnames.join(' ') + ' ';
        } else {
            buckets[key] = hostnames.sort().join('');
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
        return bucket.hasOwnProperty(hn);
    }
    if ( bucket.charAt(0) === ' ' ) {
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
    this.h = '||' + hostname + '^';
    return this;
};

FilterHostnameDict.fid = FilterHostnameDict.prototype.fid = '{h}';

FilterHostnameDict.prototype.toString = function() {
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
        if ( filters[i].match(url, tokenBeg) !== false ) {
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

FilterBucket.prototype.toString = function() {
    if ( this.f !== null ) {
        return this.f.toString();
    }
    return '';
};

FilterBucket.prototype.toSelfie = function() {
    return this.filters.length.toString();
};

FilterBucket.fromSelfie = function() {
    return new FilterBucket();
};

/******************************************************************************/

var getFilterClass = function(details) {
    if ( details.isRegex ) {
        return FilterRegex;
    }
    var s = details.f;
    if ( s.indexOf('*') !== -1 || details.token === '*' ) {
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

var getHostnameBasedFilterClass = function(details) {
    if ( details.isRegex ) {
        return FilterRegexHostname;
    }
    var s = details.f;
    if ( s.indexOf('*') !== -1 || details.token === '*' ) {
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
    if ( details.tokenBeg === 0 ) {
        return FilterPlainPrefix0Hostname;
    }
    if ( details.tokenBeg === 1 ) {
        return FilterPlainPrefix1Hostname;
    }
    return FilterPlainHostname;
};

/******************************************************************************/

// Trim leading/trailing char "c"

var trimChar = function(s, c) {
    // Remove leading and trailing wildcards
    var pos = 0;
    while ( s.charAt(pos) === c ) {
        pos += 1;
    }
    s = s.slice(pos);
    if ( pos = s.length ) {
        while ( s.charAt(pos-1) === c ) {
            pos -= 1;
        }
        s = s.slice(0, pos);
    }
    return s;
};

/******************************************************************************/
/******************************************************************************/

var FilterParser = function() {
    this.reHasWildcard = /[\^\*]/;
    this.reHasUppercase = /[A-Z]/;
    this.reCleanupHostname = /^\|\|[.*]*/;
    this.reIsolateHostname = /^([^\x00-\x24\x26-\x2C\x2F\x3A-\x5E\x60\x7B-\x7F]+)(.*)/;
    this.reHasUnicode = /[^\x00-\x7F]/;
    this.hostnames = [];
    this.notHostnames = [];
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
             'other': 'other',
          'document': 'main_frame',
          'elemhide': 'cosmetic-filtering',
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
    this.hostnames.length = 0;
    this.notHostnames.length = 0;
    this.isRegex = false;
    this.thirdParty = false;
    this.token = '';
    this.tokenBeg = 0;
    this.tokenEnd = 0;
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
    if ( this.types === 0 ) {
        this.types = allNetRequestTypesBitmap;
    }

    this.types &= ~typeBit;
};

/******************************************************************************/

FilterParser.prototype.parseOptParty = function(not) {
    if ( not ) {
        this.firstParty = true;
    } else {
        this.thirdParty = true;
    }
};

/******************************************************************************/

FilterParser.prototype.parseOptHostnames = function(raw) {
    var hostnames = raw.split('|');
    var hostname;
    for ( var i = 0; i < hostnames.length; i++ ) {
        hostname = hostnames[i];
        if ( hostname.charAt(0) === '~' ) {
            this.notHostnames.push(hostname.slice(1));
        } else {
            this.hostnames.push(hostname);
        }
    }
};

/******************************************************************************/

FilterParser.prototype.parseOptions = function(s) {
    this.fopts = s;
    var opts = s.split(',');
    var opt, not;
    for ( var i = 0; i < opts.length; i++ ) {
        opt = opts[i];
        not = opt.charAt(0) === '~';
        if ( not ) {
            opt = opt.slice(1);
        }
        if ( opt === 'third-party' ) {
            this.parseOptParty(not);
            continue;
        }
        if ( opt === 'elemhide' ) {
            if ( this.action !== AllowAction ) {
                this.parseOptType('elemhide', false);
                this.action = BlockAction;
                continue;
            }
            this.unsupported = true;
            break;
        }
        if ( opt === 'document' ) {
            if ( this.action === BlockAction ) {
                this.parseOptType('document', false);
                continue;
            }
            this.unsupported = true;
            break;
        }
        if ( this.toNormalizedType.hasOwnProperty(opt) ) {
            this.parseOptType(opt, not);
            continue;
        }
        if ( opt.slice(0,7) === 'domain=' ) {
            this.parseOptHostnames(opt.slice(7));
            continue;
        }
        if ( opt === 'popup' ) {
            this.parseOptType('popup', not);
            continue;
        }
        if ( opt === 'important' ) {
            this.important = Important;
            continue;
        }
        this.unsupported = true;
        break;
    }
};

/******************************************************************************/

FilterParser.prototype.parse = function(raw) {
    // important!
    this.reset();

    var s = raw;

    // plain hostname?
    if ( reHostnameRule.test(s) ) {
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
    if ( s.lastIndexOf('@@', 0) === 0 ) {
        this.action = AllowAction;
        s = s.slice(2);
    }

    // options
    pos = s.indexOf('$');
    if ( pos !== -1 ) {
        this.parseOptions(s.slice(pos + 1));
        s = s.slice(0, pos);
    }

    // regex?
    if ( s.charAt(0) === '/' && s.slice(-1) === '/' && s.length > 2 ) {
        this.isRegex = true;
        this.f = s.slice(1, -1);
        return this;
    }

    // hostname-anchored
    if ( s.lastIndexOf('||', 0) === 0 ) {
        this.hostnameAnchored = true;
        // cleanup: `||example.com`, `||*.example.com^`, `||.example.com/*`
        s = s.replace(this.reCleanupHostname, '');
        // convert hostname to punycode if needed
        if ( this.reHasUnicode.test(s) ) {
            var matches = this.reIsolateHostname.exec(s);
            if ( matches && matches.length === 3 ) {
                s = punycode.toASCII(matches[1]) + matches[2];
                //console.debug('µBlock.staticNetFilteringEngine/FilterParser.parse():', raw, '=', s);
            }
        }

        // https://github.com/chrisaljoudi/uBlock/issues/1096
        if ( s.charAt(0) === '^' ) {
            this.unsupported = true;
            return this;
        }
    }

    // left-anchored
    if ( s.charAt(0) === '|' ) {
        this.anchor = -1;
        s = s.slice(1);
    }

    // right-anchored
    if ( s.slice(-1) === '|' ) {
        this.anchor = 1;
        s = s.slice(0, -1);
    }

    // normalize placeholders
    // TODO: transforming `^` into `*` is not a strict interpretation of
    // ABP syntax.
    if ( this.reHasWildcard.test(s) ) {
        s = s.replace(/\^/g, '*').replace(/\*\*+/g, '*');
        s = trimChar(s, '*');
    }

    // nothing left?
    if ( s === '' ) {
        s = '*';
    }

    // plain hostname?
    this.hostnamePure = this.hostnameAnchored && reHostnameRule.test(s);

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
    var matches;
    while ( matches = reGoodToken.exec(s) ) {
        if ( s.charAt(reGoodToken.lastIndex) === '*' ) {
            continue;
        }
        if ( badTokens.hasOwnProperty(matches[0]) ) {
            continue;
        }
        return matches;
    }
    // No good token found, try again without minding "bad" tokens
    reGoodToken.lastIndex = 0;
    while ( matches = reGoodToken.exec(s) ) {
        if ( s.charAt(reGoodToken.lastIndex) === '*' ) {
            continue;
        }
        return matches;
    }
    return null;
};

var findHostnameToken = function(s) {
    reHostnameToken.lastIndex = 0;
    return reHostnameToken.exec(s);
};

/******************************************************************************/

FilterParser.prototype.makeToken = function() {
    if ( this.isRegex ) {
        this.token = '*';
        return;
    }

    var s = this.f;

    // https://github.com/chrisaljoudi/uBlock/issues/1038
    // Match any URL.
    if ( s === '*' ) {
        this.token = '*';
        return;
    }

    var matches;

    // Hostname-anchored with no wildcard always have a token index of 0.
    if ( this.hostnameAnchored && s.indexOf('*') === -1 ) {
        matches = findHostnameToken(s);
        if ( !matches || matches[0].length === 0 ) {
            return;
        }
        this.tokenBeg = matches.index;
        this.tokenEnd = reHostnameToken.lastIndex;
        this.token = s.slice(this.tokenBeg, this.tokenEnd);
        return;
    }

    matches = findFirstGoodToken(s);
    if ( matches === null || matches[0].length === 0 ) {
        this.token = '*';
        return;
    }
    this.tokenBeg = matches.index;
    this.tokenEnd = reGoodToken.lastIndex;
    this.token = s.slice(this.tokenBeg, this.tokenEnd);
};

/******************************************************************************/
/******************************************************************************/

var TokenEntry = function() {
    this.beg = 0;
    this.token = '';
};

/******************************************************************************/
/******************************************************************************/

var FilterContainer = function() {
    this.reAnyToken = /[%0-9a-z]+/g;
    this.tokens = [];
    this.filterParser = new FilterParser();
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
    this.duplicateCount = 0;
    this.duplicateBuster = {};
    this.categories = Object.create(null);
    this.filterParser.reset();
    this.filterCounts = {};
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
        for ( var k in dict ) {
            // No need for hasOwnProperty() here: there is no prototype chain.
            // We need to encode the key because there could be a `\n` or '\t'
            // character in it, which would trip the code at parse time.
            selfie.push('k2\t' + encode(k));
            bucket = dict[k];
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
        for ( var k in dict ) {
            // No need for hasOwnProperty() here: there is no prototype chain.
            // We need to encode the key because there could be a `\n` or '\t'
            // character in it, which would trip the code at parse time.
            selfie.push('k1\t' + encode(k));
            selfie.push(categoryToSelfie(dict[k]));
        }
        return selfie.join('\n');
    };

    return {
        processedFilterCount: this.processedFilterCount,
        acceptedCount: this.acceptedCount,
        rejectedCount: this.rejectedCount,
        allowFilterCount: this.allowFilterCount,
        blockFilterCount: this.blockFilterCount,
        duplicateCount: this.duplicateCount,
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
    this.duplicateCount = selfie.duplicateCount;

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
            catKey = decode(line.slice(pos + 1));
            subdict = dict[catKey] = Object.create(null);
            bucket = null;
            continue;
        }
        if ( what === 'k2' ) {
            tokenKey = decode(line.slice(pos + 1));
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

FilterContainer.prototype.makeCategoryKey = function(category) {
    return category.toString(16);
};

/******************************************************************************/

FilterContainer.prototype.compile = function(raw, out) {
    // ORDER OF TESTS IS IMPORTANT!

    // Ignore empty lines
    var s = raw.trim();
    if ( s.length === 0 ) {
        return false;
    }

    // Ignore comments
    var c = s.charAt(0);
    if ( c === '[' || c === '!' ) {
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
    if ( parsed.hostnames.length !== 0 || parsed.notHostnames.length !== 0 ) {
        return;
    }

    var party = AnyParty;
    if ( parsed.firstParty !== parsed.thirdParty ) {
        party = parsed.firstParty ? FirstParty : ThirdParty;
    }
    var keyShard = parsed.action | parsed.important | party;

    var type = parsed.types;
    if ( type === 0 ) {
        out.push(
            'n\v' +
            this.makeCategoryKey(keyShard) + '\v' +
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
                this.makeCategoryKey(keyShard | (bitOffset << 4)) + '\v' +
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
    if ( parsed.token === '' ) {
        console.error('static-net-filtering.js > FilterContainer.addFilter("%s"): can\'t tokenize', parsed.f);
        return false;
    }

    var party = AnyParty;
    if ( parsed.firstParty !== parsed.thirdParty ) {
        party = parsed.firstParty ? FirstParty : ThirdParty;
    }

    var filterClass;
    var i = parsed.hostnames.length;
    var j = parsed.notHostnames.length;

    // Applies to all domains without exceptions
    if ( i === 0 && j === 0 ) {
        filterClass = getFilterClass(parsed);
        if ( filterClass === null ) {
            return false;
        }
        this.compileToAtomicFilter(filterClass, parsed, party, out);
        return true;
    }

    // Applies to specific domains
    if ( i !== 0 ) {
        while ( i-- ) {
            filterClass = getHostnameBasedFilterClass(parsed);
            if ( filterClass === null ) {
                return false;
            }
            this.compileToAtomicFilter(filterClass, parsed, party, out, parsed.hostnames[i]);
        }
    }
    // No exceptions
    if ( j === 0 ) {
        return true;
    }

    // Case:
    // - applies everywhere except to specific domains
    // Example:
    // - ||adm.fwmrm.net/p/msnbc_live/$object-subrequest,third-party,domain=~msnbc.msn.com|~www.nbcnews.com
    if ( i === 0 ) {
        filterClass = getFilterClass(parsed);
        if ( filterClass === null ) {
            return false;
        }
        // https://github.com/chrisaljoudi/uBlock/issues/251
        // Apply third-party option if it is present
        this.compileToAtomicFilter(filterClass, parsed, party, out);
    }

    // Cases:
    // - applies everywhere except to specific domains
    // - applies to specific domains except other specific domains
    // Example:
    // - /^https?\:\/\/(?!(...)\/)/$script,third-party,xmlhttprequest,domain=photobucket.com|~secure.photobucket.com

    // Reverse purpose of filter
    parsed.action ^= ToggleAction;
    while ( j-- ) {
        filterClass = getHostnameBasedFilterClass(parsed);
        if ( filterClass === null ) {
            return false;
        }
        // https://github.com/chrisaljoudi/uBlock/issues/191#issuecomment-53654024
        // If it is a block filter, we need to reverse the order of
        // evaluation.
        if ( parsed.action === BlockAction ) {
            parsed.important = Important;
        }
        this.compileToAtomicFilter(filterClass, parsed, party, out, parsed.notHostnames[j]);
    }
    return true;
};

/******************************************************************************/

FilterContainer.prototype.compileToAtomicFilter = function(filterClass, parsed, party, out, hostname) {
    var bits = parsed.action | parsed.important | party;
    var type = parsed.types;
    if ( type === 0 ) {
        out.push(
            'n\v' +
            this.makeCategoryKey(bits) + '\v' +
            parsed.token + '\v' +
            filterClass.fid + '\v' +
            filterClass.compile(parsed, hostname)
        );
        return;
    }
    var bitOffset = 1;
    do {
        if ( type & 1 ) {
            out.push(
                'n\v' +
                this.makeCategoryKey(bits | (bitOffset << 4)) + '\v' +
                parsed.token + '\v' +
                filterClass.fid + '\v' +
                filterClass.compile(parsed, hostname)
            );
        }
        bitOffset += 1;
        type >>>= 1;
    } while ( type !== 0 );
};

/******************************************************************************/

FilterContainer.prototype.fromCompiledContent = function(text, lineBeg) {
    var lineEnd;
    var textEnd = text.length;
    var line, fields, bucket, entry, factory, filter;

    while ( lineBeg < textEnd ) {
        if ( text.charAt(lineBeg) !== 'n' ) {
            return lineBeg;
        }
        lineEnd = text.indexOf('\n', lineBeg);
        if ( lineEnd === -1 ) {
            lineEnd = textEnd;
        }
        line = text.slice(lineBeg + 2, lineEnd);
        fields = line.split('\v');
        lineBeg = lineEnd + 1;

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
                this.duplicateCount += 1;
            }
            continue;
        }

        if ( this.duplicateBuster.hasOwnProperty(line) ) {
            this.duplicateCount += 1;
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
    return textEnd;
};

/******************************************************************************/

// Since the addition of the `important` evaluation, this means it is now
// likely that the url will have to be scanned more than once. So this is
// to ensure we do it once only, and reuse results.

FilterContainer.prototype.tokenize = function(url) {
    var tokens = this.tokens;
    var re = this.reAnyToken;
    var matches, tokenEntry;
    re.lastIndex = 0;
    var i = 0;
    while ( matches = re.exec(url) ) {
        tokenEntry = tokens[i];
        if ( tokenEntry === undefined ) {
            tokenEntry = tokens[i] = new TokenEntry();
        }
        tokenEntry.beg = matches.index;
        tokenEntry.token = matches[0];
        i += 1;

        // https://github.com/chrisaljoudi/uBlock/issues/1118
        // Crazy case... but I guess we have to expect the worst...
        if ( i === 2048 ) {
            break;
        }
    }

    // Sentinel
    tokenEntry = tokens[i];
    if ( tokenEntry === undefined ) {
        tokenEntry = tokens[i] = new TokenEntry();
    }
    tokenEntry.token = '';
};

/******************************************************************************/

FilterContainer.prototype.matchTokens = function(bucket, url) {
    // Hostname-only filters
    var f = bucket['.'];
    if ( f !== undefined && f.match() !== false ) {
        return f;
    }

    var tokens = this.tokens;
    var tokenEntry, token;
    var i = 0;
    for (;;) {
        tokenEntry = tokens[i++];
        token = tokenEntry.token;
        if ( token === '' ) {
            break;
        }
        f = bucket[token];
        if ( f !== undefined && f.match(url, tokenEntry.beg) !== false ) {
            return f;
        }
    }

    // Regex-based filters
    f = bucket['*'];
    if ( f !== undefined && f.match(url) !== false ) {
        return f;
    }

    return false;
};

/******************************************************************************/

// Specialized handlers

// https://github.com/chrisaljoudi/uBlock/issues/116
// Some type of requests are exceptional, they need custom handling,
// not the generic handling.

FilterContainer.prototype.matchStringExactType = function(context, requestURL, requestType) {
    var url = requestURL.toLowerCase();

    // These registers will be used by various filters
    pageHostnameRegister = context.pageHostname || '';
    requestHostnameRegister = µb.URI.hostnameFromURI(requestURL);

    var party = isFirstParty(context.pageDomain, requestHostnameRegister) ? FirstParty : ThirdParty;

    // Be prepared to support unknown types
    var type = typeNameToTypeValue[requestType] || 0;
    if ( type === 0 ) {
        return '';
    }

    var categories = this.categories;
    var bf = false, bucket;

    // Tokenize only once
    this.tokenize(url);

    // https://github.com/chrisaljoudi/uBlock/issues/139
    // Test against important block filters
    if ( bucket = categories[this.makeCategoryKey(BlockAnyParty | Important | type)] ) {
        bf = this.matchTokens(bucket, url);
        if ( bf !== false ) {
            return 'sb:' + bf.toString();
        }
    }
    if ( bucket = categories[this.makeCategoryKey(BlockAction | Important | type | party)] ) {
        bf = this.matchTokens(bucket, url);
        if ( bf !== false ) {
            return 'sb:' + bf.toString();
        }
    }

    // Test against block filters
    if ( bucket = categories[this.makeCategoryKey(BlockAnyParty | type)] ) {
        bf = this.matchTokens(bucket, url);
    }
    if ( bf === false ) {
        if ( bucket = categories[this.makeCategoryKey(BlockAction | type | party)] ) {
            bf = this.matchTokens(bucket, url);
        }
    }
    // If there is no block filter, no need to test against allow filters
    if ( bf === false ) {
        return '';
    }

    // Test against allow filters
    var af;
    if ( bucket = categories[this.makeCategoryKey(AllowAnyParty | type)] ) {
        af = this.matchTokens(bucket, url);
        if ( af !== false ) {
            return 'sa:' + af.toString();
        }
    }
    if ( bucket = categories[this.makeCategoryKey(AllowAction | type | party)] ) {
        af = this.matchTokens(bucket, url);
        if ( af !== false ) {
            return 'sa:' + af.toString();
        }
    }

    return 'sb:' + bf.toString();
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

    // https://github.com/chrisaljoudi/httpswitchboard/issues/239
    // Convert url to lower case:
    //     `match-case` option not supported, but then, I saw only one
    //     occurrence of it in all the supported lists (bulgaria list).
    var url = context.requestURL.toLowerCase();

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


    // These registers will be used by various filters
    pageHostnameRegister = context.pageHostname || '';
    requestHostnameRegister = context.requestHostname;

    var party = isFirstParty(context.pageDomain, context.requestHostname) ? FirstParty : ThirdParty;
    var filterClasses = this.categories;
    var bucket;

    // Tokenize only once
    this.tokenize(url);

    var bf = false;

    // https://github.com/chrisaljoudi/uBlock/issues/139
    // Test against important block filters.
    // The purpose of the `important` option is to reverse the order of
    // evaluation. Normally, it is "evaluate block then evaluate allow", with
    // the `important` property it is "evaluate allow then evaluate block".
    if ( bucket = filterClasses[this.makeCategoryKey(BlockAnyTypeAnyParty | Important)] ) {
        bf = this.matchTokens(bucket, url);
        if ( bf !== false ) {
            return 'sb:' + bf.toString() + '$important';
        }
    }
    if ( bucket = filterClasses[this.makeCategoryKey(BlockAnyType | Important | party)] ) {
        bf = this.matchTokens(bucket, url);
        if ( bf !== false ) {
            return 'sb:' + bf.toString() + '$important';
        }
    }
    if ( bucket = filterClasses[this.makeCategoryKey(BlockAnyParty | Important | type)] ) {
        bf = this.matchTokens(bucket, url);
        if ( bf !== false ) {
            return 'sb:' + bf.toString() + '$important';
        }
    }
    if ( bucket = filterClasses[this.makeCategoryKey(BlockAction | Important | type | party)] ) {
        bf = this.matchTokens(bucket, url);
        if ( bf !== false ) {
            return 'sb:' + bf.toString() + '$important';
        }
    }

    // Test against block filters
    if ( bf === false ) {
        if ( bucket = filterClasses[this.makeCategoryKey(BlockAnyTypeAnyParty)] ) {
            bf = this.matchTokens(bucket, url);
        }
    }
    if ( bf === false ) {
        if ( bucket = filterClasses[this.makeCategoryKey(BlockAnyType | party)] ) {
            bf = this.matchTokens(bucket, url);
        }
    }
    if ( bf === false ) {
        if ( bucket = filterClasses[this.makeCategoryKey(BlockAnyParty | type)] ) {
            bf = this.matchTokens(bucket, url);
        }
    }
    if ( bf === false ) {
        if ( bucket = filterClasses[this.makeCategoryKey(BlockAction | type | party)] ) {
            bf = this.matchTokens(bucket, url);
        }
    }

    // If there is no block filter, no need to test against allow filters
    if ( bf === false ) {
        return '';
    }

    // Test against allow filters
    var af;

    if ( bucket = filterClasses[this.makeCategoryKey(AllowAnyTypeAnyParty)] ) {
        af = this.matchTokens(bucket, url);
        if ( af !== false ) {
            return 'sa:' + af.toString();
        }
    }
    if ( bucket = filterClasses[this.makeCategoryKey(AllowAnyType | party)] ) {
        af = this.matchTokens(bucket, url);
        if ( af !== false ) {
            return 'sa:' + af.toString();
        }
    }
    if ( bucket = filterClasses[this.makeCategoryKey(AllowAnyParty | type)] ) {
        af = this.matchTokens(bucket, url);
        if ( af !== false ) {
            return 'sa:' + af.toString();
        }
    }
    if ( bucket = filterClasses[this.makeCategoryKey(AllowAction | type | party)] ) {
        af = this.matchTokens(bucket, url);
        if ( af !== false ) {
            return 'sa:' + af.toString();
        }
    }

    return 'sb:' + bf.toString();
};

/******************************************************************************/

FilterContainer.prototype.getFilterCount = function() {
    return this.acceptedCount - this.duplicateCount;
};

/******************************************************************************/

return new FilterContainer();

/******************************************************************************/

})();

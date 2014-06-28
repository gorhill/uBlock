/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
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

    Home: https://github.com/gorhill/uBlock
*/

/* jshint esnext: true, bitwise: false */
/* global µBlock */

/******************************************************************************/

µBlock.abpFilters = (function(){

/******************************************************************************/

const BlockAction = 0 << 15;
const AllowAction = 1 << 15;

const AnyType = 1 << 11;

const AnyParty = 0 << 8;
const FirstParty = 1 << 8;
const ThirdParty = 2 << 8;
const SpecificParty = 3 << 8;
const SpecificNotParty = 4 << 8;

const BlockAnyTypeAnyParty = BlockAction | AnyType | AnyParty;
const BlockAnyType1stParty = BlockAction | AnyType | FirstParty;
const BlockAnyType3rdParty = BlockAction | AnyType | ThirdParty;
const BlockAnyTypeOneParty = BlockAction | AnyType | SpecificParty;
const BlockAnyTypeOtherParties = BlockAction | AnyType | SpecificNotParty;
const BlockAnyType = BlockAction | AnyType;
const BlockAnyParty = BlockAction | AnyParty;
const BlockOneParty = BlockAction | SpecificParty;
const BlockOtherParties = BlockAction | SpecificNotParty;

const AllowAnyTypeAnyParty = AllowAction | AnyType | AnyParty;
const AllowAnyType1stParty = AllowAction | AnyType | FirstParty;
const AllowAnyType3rdParty = AllowAction | AnyType | ThirdParty;
const AllowAnyTypeOneParty = AllowAction | AnyType | SpecificParty;
const AllowAnyTypeOtherParties = AllowAction | AnyType | SpecificNotParty;
const AllowAnyType = AllowAction | AnyType;
const AllowAnyParty = AllowAction | AnyParty;
const AllowOneParty = AllowAction | SpecificParty;
const AllowOtherParties = AllowAction | SpecificNotParty;

var pageHostname = '';

var reIgnoreEmpty = /^\s+$/;
var reIgnoreComment = /^\[|^!/;
var reHostnameRule = /^[0-9a-z][0-9a-z.-]+[0-9a-z]$/;
var reHostnameToken = /^[0-9a-z]+/g;
var reGoodToken = /[%0-9a-z]{2,}/g;

var typeNameToTypeValue = {
        'stylesheet': 2 << 11,
             'image': 3 << 11,
            'object': 4 << 11,
            'script': 5 << 11,
    'xmlhttprequest': 6 << 11,
         'sub_frame': 7 << 11,
             'other': 8 << 11
};

// ABP filters: https://adblockplus.org/en/filters
// regex tester: http://regex101.com/

/******************************************************************************/
/*
var histogram = function(label, categories) {
    var h = [],
        categoryBucket;
    for ( var k in categories ) {
        if ( categories.hasOwnProperty(k) === false ) {
            continue;
        }
        categoryBucket = categories[k];
        for ( var kk in categoryBucket ) {
            if ( categoryBucket.hasOwnProperty(kk) === false ) {
                continue;
            }
            filterBucket = categoryBucket[kk];
            h.push({
                k: k + ' ' + kk,
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
/*
var adbProfiler = {
    testCount: 0,
    urlCount: 0,
    dumpEach: 200,
    countUrl: function() {
        this.urlCount += 1;
        if ( (this.urlCount % this.dumpEach) === 0 ) {
            this.dump();
        }
    },
    countTest: function() {
        this.testCount += 1;
    },
    dump: function() {
        console.log('µBlock.adbProfiler> number or filters tested per URL: %d (sample: %d URLs)', this.testCount / this.urlCount, this.urlCount);
    },
    reset: function() {
        this.testCount = 0;
        this.urlCount = 0;
    },
    dummy: 0
};
*/

/*******************************************************************************

Filters family tree:

- plain (no wildcard)
  - anywhere
    - no hostname
    - specific hostname
    - specific not hostname
  - anchored at start
    - no hostname
    - specific hostname
    - specific not hostname
  - anchored at end
    - no hostname
    - specific hostname
    - specific not hostname

- one wildcard
  - anywhere
    - no hostname
    - specific hostname
    - specific not hostname
  - anchored at start
    - no hostname
    - specific hostname
    - specific not hostname
  - anchored at end
    - no hostname
    - specific hostname
    - specific not hostname

- more than one wildcard
  - anywhere
    - no hostname
    - specific hostname
    - specific not hostname
  - anchored at start
    - no hostname
    - specific hostname
    - specific not hostname
  - anchored at end
    - no hostname
    - specific hostname
    - specific not hostname

*/

/******************************************************************************/

var FilterPlain = function(s, tokenBeg) {
    this.s = s;
    this.tokenBeg = tokenBeg;
};

FilterPlain.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    return url.substr(tokenBeg - this.tokenBeg, this.s.length) === this.s;
};

var FilterPlainHostname = function(s, tokenBeg, hostname) {
    this.s = s;
    this.tokenBeg = tokenBeg;
    this.hostname = hostname;
};

FilterPlainHostname.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg - this.tokenBeg, this.s.length) === this.s;
};

var FilterPlainNotHostname = function(s, tokenBeg, hostname) {
    this.s = s;
    this.tokenBeg = tokenBeg;
    this.hostname = hostname;
};

FilterPlainNotHostname.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) !== this.hostname &&
           url.substr(tokenBeg - this.tokenBeg, this.s.length) === this.s;
};

/******************************************************************************/

var FilterPlainPrefix0 = function(s) {
    this.s = s;
};

FilterPlainPrefix0.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    return url.substr(tokenBeg, this.s.length) === this.s;
};

var FilterPlainPrefix0Hostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterPlainPrefix0Hostname.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg, this.s.length) === this.s;
};

var FilterPlainPrefix0NotHostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterPlainPrefix0NotHostname.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) !== this.hostname &&
           url.substr(tokenBeg, this.s.length) === this.s;
};

/******************************************************************************/

var FilterPlainPrefix1 = function(s) {
    this.s = s;
};

FilterPlainPrefix1.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    return url.substr(tokenBeg - 1, this.s.length) === this.s;
};

var FilterPlainPrefix1Hostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterPlainPrefix1Hostname.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg - 1, this.s.length) === this.s;
};

var FilterPlainPrefix1NotHostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterPlainPrefix1NotHostname.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) !== this.hostname &&
           url.substr(tokenBeg - 1, this.s.length) === this.s;
};

/******************************************************************************/

var FilterPlainLeftAnchored = function(s) {
    this.s = s;
};

FilterPlainLeftAnchored.prototype.match = function(url) {
    // adbProfiler.countTest();
    return url.slice(0, this.s.length) === this.s;
};

var FilterPlainLeftAnchoredHostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterPlainLeftAnchoredHostname.prototype.match = function(url) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.slice(0, this.s.length) === this.s;
};

var FilterPlainLeftAnchoredNotHostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterPlainLeftAnchoredNotHostname.prototype.match = function(url) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) !== this.hostname &&
           url.slice(0, this.s.length) === this.s;
};

/******************************************************************************/

var FilterPlainRightAnchored = function(s) {
    this.s = s;
};

FilterPlainRightAnchored.prototype.match = function(url) {
    // adbProfiler.countTest();
    return url.slice(-this.s.length) === this.s;
};

var FilterPlainRightAnchoredHostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterPlainRightAnchoredHostname.prototype.match = function(url) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.slice(-this.s.length) === this.s;
};

var FilterPlainRightAnchoredNotHostname = function(s, hostname) {
    this.s = s;
    this.hostname = hostname;
};

FilterPlainRightAnchoredNotHostname.prototype.match = function(url) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) !== this.hostname &&
           url.slice(-this.s.length) === this.s;
};

/******************************************************************************/

// With a single wildcard, regex is not optimal.
// See:
//   http://jsperf.com/regexp-vs-indexof-abp-miss/3
//   http://jsperf.com/regexp-vs-indexof-abp-hit/3

var FilterSingleWildcard = function(s, tokenBeg) {
    this.s = s;
    this.tokenBeg = tokenBeg;
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
};

FilterSingleWildcard.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    tokenBeg -= this.tokenBeg;
    return url.substr(tokenBeg, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, tokenBeg + this.lSegment.length) > 0;
};

var FilterSingleWildcardHostname = function(s, tokenBeg, hostname) {
    this.s = s;
    this.tokenBeg = tokenBeg;
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
    this.hostname = hostname;
};

FilterSingleWildcardHostname.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    tokenBeg -= this.tokenBeg;
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, tokenBeg + this.lSegment.length) > 0;
};

var FilterSingleWildcardNotHostname = function(s, tokenBeg, hostname) {
    this.s = s;
    this.tokenBeg = tokenBeg;
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
    this.hostname = hostname;
};

FilterSingleWildcardNotHostname.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    tokenBeg -= this.tokenBeg;
    return pageHostname.slice(-this.hostname.length) !== this.hostname &&
           url.substr(tokenBeg, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, tokenBeg + this.lSegment.length) > 0;
};

/******************************************************************************/

var FilterSingleWildcardPrefix0 = function(s) {
    this.s = s;
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
};

FilterSingleWildcardPrefix0.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    return url.substr(tokenBeg, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, tokenBeg + this.lSegment.length) > 0;
};

var FilterSingleWildcardPrefix0Hostname = function(s, hostname) {
    this.s = s;
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
    this.hostname = hostname;
};

FilterSingleWildcardPrefix0Hostname.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, tokenBeg + this.lSegment.length) > 0;
};

var FilterSingleWildcardPrefix0NotHostname = function(s, hostname) {
    this.s = s;
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
    this.hostname = hostname;
};

FilterSingleWildcardPrefix0NotHostname.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) !== this.hostname &&
           url.substr(tokenBeg, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, tokenBeg + this.lSegment.length) > 0;
};

/******************************************************************************/

// With a single wildcard, regex is not optimal.
// See:
//   http://jsperf.com/regexp-vs-indexof-abp-miss/3
//   http://jsperf.com/regexp-vs-indexof-abp-hit/3

var FilterSingleWildcardLeftAnchored = function(s) {
    this.s = s;
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
};

FilterSingleWildcardLeftAnchored.prototype.match = function(url) {
    // adbProfiler.countTest();
    return url.slice(0, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, this.lSegment.length) > 0;
};

var FilterSingleWildcardLeftAnchoredHostname = function(s, hostname) {
    this.s = s;
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
    this.hostname = hostname;
};

FilterSingleWildcardLeftAnchoredHostname.prototype.match = function(url) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.slice(0, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, this.lSegment.length) > 0;
};

var FilterSingleWildcardLeftAnchoredNotHostname = function(s, hostname) {
    this.s = s;
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
    this.hostname = hostname;
};

FilterSingleWildcardLeftAnchoredNotHostname.prototype.match = function(url) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) !== this.hostname &&
           url.slice(0, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, this.lSegment.length) > 0;
};

/******************************************************************************/

// With a single wildcard, regex is not optimal.
// See:
//   http://jsperf.com/regexp-vs-indexof-abp-miss/3
//   http://jsperf.com/regexp-vs-indexof-abp-hit/3

var FilterSingleWildcardRightAnchored = function(s) {
    this.s = s;
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
};

FilterSingleWildcardRightAnchored.prototype.match = function(url) {
    // adbProfiler.countTest();
    return url.slice(-this.rSegment.length) === this.rSegment &&
           url.lastIndexOf(this.lSegment, url.length - this.rSegment.length - this.lSegment.length) >= 0;
};

var FilterSingleWildcardRightAnchoredHostname = function(s, hostname) {
    this.s = s;
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
    this.hostname = hostname;
};

FilterSingleWildcardRightAnchoredHostname.prototype.match = function(url) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.slice(-this.rSegment.length) === this.rSegment &&
           url.lastIndexOf(this.lSegment, url.length - this.rSegment.length - this.lSegment.length) >= 0;
};

var FilterSingleWildcardRightAnchoredNotHostname = function(s, hostname) {
    this.s = s;
    var wcOffset = s.indexOf('*');
    this.lSegment = s.slice(0, wcOffset);
    this.rSegment = s.slice(wcOffset + 1);
    this.hostname = hostname;
};

FilterSingleWildcardRightAnchoredNotHostname.prototype.match = function(url) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) !== this.hostname &&
           url.slice(-this.rSegment.length) === this.rSegment &&
           url.lastIndexOf(this.lSegment, url.length - this.rSegment.length - this.lSegment.length) >= 0;
};

/******************************************************************************/

// With many wildcards, a regex is best.

// Ref: regex escaper taken from:
// https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions
// modified for the purpose here.

var FilterManyWildcards = function(s, tokenBeg) {
    this.s = s;
    this.tokenBeg = tokenBeg;
    this.re = new RegExp('^' + s.replace(/([.+?^=!:${}()|\[\]\/\\])/g, '\\$1').replace(/\*/g, '.*'));
};

FilterManyWildcards.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    return this.re.test(url.slice(tokenBeg - this.tokenBeg));
};

var FilterManyWildcardsHostname = function(s, tokenBeg, hostname) {
    this.s = s;
    this.tokenBeg = tokenBeg;
    this.re = new RegExp('^' + s.replace(/([.+?^=!:${}()|\[\]\/\\])/g, '\\$1').replace(/\*/g, '.*'));
    this.hostname = hostname;
};

FilterManyWildcardsHostname.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           this.re.test(url.slice(tokenBeg - this.tokenBeg));
};

var FilterManyWildcardsNotHostname = function(s, tokenBeg, hostname) {
    this.s = s;
    this.tokenBeg = tokenBeg;
    this.re = new RegExp('^' + s.replace(/([.+?^=!:${}()|\[\]\/\\])/g, '\\$1').replace(/\*/g, '.*'));
    this.hostname = hostname;
};

FilterManyWildcardsNotHostname.prototype.match = function(url, tokenBeg) {
    // adbProfiler.countTest();
    return pageHostname.slice(-this.hostname.length) !== this.hostname &&
           this.re.test(url.slice(tokenBeg - this.tokenBeg));
};

/******************************************************************************/

var makeFilter = function(details, tokenBeg) {
    var s = details.f;
    var wcOffset = s.indexOf('*');
    if ( wcOffset > 0 ) {
        if ( (/\*[^*]\*/).test(s) ) {
            return details.anchor === 0 ? new FilterManyWildcards(s, tokenBeg) : null;
        }
        if ( details.anchor < 0 ) {
            return new FilterSingleWildcardLeftAnchored(s);
        }
        if ( details.anchor > 0 ) {
            return new FilterSingleWildcardRightAnchored(s);
        }
        if ( tokenBeg === 0 ) {
            return new FilterSingleWildcardPrefix0(s);
        }
        return new FilterSingleWildcard(s, tokenBeg);
    }
    if ( details.anchor < 0 ) {
        return new FilterPlainLeftAnchored(s);
    }
    if ( details.anchor > 0 ) {
        return new FilterPlainRightAnchored(s);
    }
    if ( tokenBeg === 0 ) {
        return new FilterPlainPrefix0(s);
    }
    if ( tokenBeg === 1 ) {
        return new FilterPlainPrefix1(s);
    }
    return new FilterPlain(s, tokenBeg);
};

/******************************************************************************/

var makeHostnameFilter = function(details, tokenBeg, hostname) {
    var s = details.f;
    var wcOffset = s.indexOf('*');
    if ( wcOffset > 0 ) {
        if ( (/\*[^*]\*/).test(s) ) {
            return details.anchor === 0 ? new FilterManyWildcardsHostname(s, tokenBeg, hostname) : null;
        }
        if ( details.anchor < 0 ) {
            return new FilterSingleWildcardLeftAnchoredHostname(s, hostname);
        }
        if ( details.anchor > 0 ) {
            return new FilterSingleWildcardRightAnchoredHostname(s, hostname);
        }
        if ( tokenBeg === 0 ) {
            return new FilterSingleWildcardPrefix0Hostname(s, hostname);
        }
        return new FilterSingleWildcardHostname(s, tokenBeg, hostname);
    }
    if ( details.anchor < 0 ) {
        return new FilterPlainLeftAnchoredHostname(s, hostname);
    }
    if ( details.anchor > 0 ) {
        return new FilterPlainRightAnchoredHostname(s, hostname);
    }
    if ( tokenBeg === 0 ) {
        return new FilterPlainPrefix0Hostname(s, hostname);
    }
    if ( tokenBeg === 1 ) {
        return new FilterPlainPrefix1Hostname(s, hostname);
    }
    return new FilterPlainHostname(s, tokenBeg, hostname);
};

/******************************************************************************/

var makeNotHostnameFilter = function(details, tokenBeg, hostname) {
    var s = details.f;
    var wcOffset = s.indexOf('*');
    if ( wcOffset > 0 ) {
        if ( (/\*[^*]\*/).test(s) ) {
            return details.anchor === 0 ? new FilterManyWildcardsNotHostname(s, tokenBeg, hostname) : null;
        }
        if ( details.anchor < 0 ) {
            return new FilterSingleWildcardLeftAnchoredNotHostname(s, hostname);
        }
        if ( details.anchor > 0 ) {
            return new FilterSingleWildcardRightAnchoredNotHostname(s, hostname);
        }
        if ( tokenBeg === 0 ) {
            return new FilterSingleWildcardPrefix0NotHostname(s, hostname);
        }
        return new FilterSingleWildcardNotHostname(s, tokenBeg, hostname);
    }
    if ( details.anchor < 0 ) {
        return new FilterPlainLeftAnchoredNotHostname(s, hostname);
    }
    if ( details.anchor > 0 ) {
        return new FilterPlainRightAnchoredNotHostname(s, hostname);
    }
    if ( tokenBeg === 0 ) {
        return new FilterPlainPrefix0NotHostname(s, hostname);
    }
    if ( tokenBeg === 1 ) {
        return new FilterPlainPrefix1NotHostname(s, hostname);
    }
    return new FilterPlainNotHostname(s, tokenBeg, hostname);
};

/******************************************************************************/

// Given a string, find a good token. Tokens which are too generic, i.e. very
// common with a high probability of ending up as a miss, are not
// good. Avoid if possible. This has a *significant* positive impact on
// performance.
// These "bad tokens" are collated manually.

var badTokens = {
    'com': true,
    'http': true,
    'https': true,
    'images': true,
    'img': true,
    'js': true,
    'news': true,
    'www': true
};

var findFirstGoodToken = function(s) {
    reGoodToken.lastIndex = 0;
    var matches;
    while ( matches = reGoodToken.exec(s) ) {
        if ( badTokens[matches[0]] === undefined ) {
            return matches;
        }
    }
    // No good token found, just return the first token from left
    reGoodToken.lastIndex = 0;
    return reGoodToken.exec(s);
};

/******************************************************************************/

var findHostnameToken = function(s) {
    reHostnameToken.lastIndex = 0;
    return reHostnameToken.exec(s);
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

var FilterParser = function() {
    this.action = BlockAction;
    this.anchor = 0;
    this.domains = [];
    this.elemHiding = false;
    this.f = '';
    this.firstParty = false;
    this.fopts = '';
    this.hostname = false;
    this.hostnames = [];
    this.notDomains = [];
    this.notHostnames = [];
    this.thirdParty = false;
    this.types = [];
    this.unsupported = false;
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
             'other': 'other'
};

/******************************************************************************/

FilterParser.prototype.reset = function() {
    this.action = BlockAction;
    this.anchor = 0;
    this.domains = [];
    this.elemHiding = false;
    this.f = '';
    this.firstParty = false;
    this.fopts = '';
    this.hostname = false;
    this.hostnames = [];
    this.notDomains = [];
    this.notHostnames = [];
    this.thirdParty = false;
    this.types = [];
    this.unsupported = false;
    return this;
};

/******************************************************************************/

FilterParser.prototype.parseOptType = function(raw, not) {
    var type = this.toNormalizedType[raw];
    if ( not ) {
        for ( var k in typeNameToTypeValue ) {
            if ( k === type ) {
                continue;
            }
            this.types.push(typeNameToTypeValue[k]);
        }
    } else {
        this.types.push(typeNameToTypeValue[type]);
    }
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
    var µburi = µBlock.URI;
    var hostnames = raw.split('|');
    var hostname, not, domain;
    for ( var i = 0; i < hostnames.length; i++ ) {
        hostname = hostnames[i];
        not = hostname.charAt(0) === '~';
        if ( not ) {
            hostname = hostname.slice(1);
        }
        domain = µburi.domainFromHostname(hostname);
        if ( not ) {
            this.notHostnames.push(hostname);
            this.notDomains.push(domain);
        } else {
            this.hostnames.push(hostname);
            this.domains.push(domain);
        }
    }
};

/******************************************************************************/

FilterParser.prototype.parse = function(s) {
    // important!
    this.reset();

    // element hiding filter?
    if ( s.indexOf('##') >= 0 || s.indexOf('#@') >= 0 ) {
        this.elemHiding = true;
        return this;
    }

    // block or allow filter?
    if ( s.slice(0, 2) === '@@' ) {
        this.action = AllowAction;
        s = s.slice(2);
    }

    // hostname anchoring
    if ( s.slice(0, 2) === '||' ) {
        this.hostname = true;
        s = s.slice(2);
    }

    // left-anchored
    if ( s.charAt(0) === '|' ) {
        this.anchor = -1;
        s = s.slice(1);
    }

    // options
    var pos = s.indexOf('$');
    if ( pos > 0 ) {
        this.fopts = s.slice(pos + 1);
        s = s.slice(0, pos);
    }

    // right-anchored
    if ( s.slice(-1) === '|' ) {
        this.anchor = 1;
        s = s.slice(0, -1);
    }

    // normalize placeholders
    // TODO: transforming `^` into `*` is not a strict interpretation of
    // ABP syntax.
    s = s.replace(/\^/g, '*');
    s = s.replace(/\*\*+/g, '*');

    // remove leading and trailing wildcards
    this.f = trimChar(s, '*');

    if ( !this.fopts ) {
        return this;
    }

    // parse options
    var opts = this.fopts.split(',');
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
        if ( this.toNormalizedType.hasOwnProperty(opt) ) {
            this.parseOptType(opt, not);
            continue;
        }
        if ( opt.slice(0,7) === 'domain=' ) {
            this.parseOptHostnames(opt.slice(7));
            continue;
        }
        if ( opt === 'popup' ) {
            this.elemHiding = true;
            break;
        }
        this.unsupported = true;
    }
    return this;
};

/******************************************************************************/
/******************************************************************************/

var FilterBucket = function(a, b) {
    this.filters = [a, b];
    this.s = '';
};

/******************************************************************************/

FilterBucket.prototype.add = function(a) {
    this.filters.push(a);
};

/******************************************************************************/

FilterBucket.prototype.match = function(url, tokenBeg) {
    var filters = this.filters;
    var i = filters.length;
    while ( i-- ) {
        if ( filters[i].match(url, tokenBeg) !== false ) {
            this.s = filters[i].s;
            return true;
        }
    }
    return false;
};

/******************************************************************************/
/******************************************************************************/

var FilterContainer = function() {
    this.categories = {};
    this.duplicates = {};
    this.url = '';
    this.tokenBeg = 0;
    this.tokenEnd = 0;
    this.filterParser = new FilterParser();
    this.processedFilterCount = 0;
    this.supportedFilterCount = 0;
    this.allowFilterCount = 0;
    this.blockFilterCount = 0;

    // This is for hostname-based-any-request filters
    this.blockedAnyPartyHostnames = new µBlock.LiquidDict();
    this.blocked3rdPartyHostnames = new µBlock.LiquidDict();

    // Used during URL matching
    this.reAnyToken = /[%0-9a-z]+/g;
    this.matches = null;
    this.bucket0 = undefined;
    this.bucket1 = undefined;
    this.bucket2 = undefined;
    this.bucket3 = undefined;
    this.bucket4 = undefined;
    this.bucket5 = undefined;
    this.bucket6 = undefined;
    this.bucket7 = undefined;
};

/******************************************************************************/

FilterContainer.prototype.toDomainBits = function(domain) {
    if ( domain === undefined ) {
        return 0;
    }
    var i = domain.length >> 2;
    return (domain.charCodeAt(    0) & 0x01) << 3 |
           (domain.charCodeAt(    i) & 0x01) << 2 |
           (domain.charCodeAt(  i+i) & 0x01) << 1 |
           (domain.charCodeAt(i+i+i) & 0x01) << 0;
};

/******************************************************************************/

FilterContainer.prototype.makeCategoryKey = function(category) {
    return String.fromCharCode(category);
};

/******************************************************************************/

FilterContainer.prototype.addAnyPartyHostname = function(hostname) {
    if ( this.blockedAnyPartyHostnames.add(hostname) ) {
        this.blockFilterCount += 1;
        return true;
    }
    return false;
};

/******************************************************************************/

FilterContainer.prototype.add3rdPartyHostname = function(hostname) {
    if ( this.blocked3rdPartyHostnames.add(hostname) ) {
        this.blockFilterCount += 1;
        return true;
    }
    return false;
};

/******************************************************************************/

FilterContainer.prototype.add = function(s) {
    // ORDER OF TESTS IS IMPORTANT!

    // Ignore empty lines
    if ( reIgnoreEmpty.test(s) ) {
        return false;
    }

    // Ignore comments
    if ( reIgnoreComment.test(s) ) {
        return false;
    }

    var parsed = this.filterParser.parse(s);

    // Ignore element-hiding filters
    if ( parsed.elemHiding ) {
        return false;
    }

    if ( this.duplicates[s] ) {
        return false;
    }
    this.duplicates[s] = true;

    this.processedFilterCount += 1;

    // Ignore rules with other conditions for now
    if ( parsed.unsupported ) {
        // console.log('µBlock> abp-filter.js/FilterContainer.add(): unsupported filter "%s"', s);
        return false;
    }

    this.supportedFilterCount += 1;

    // Ignore optionless hostname rules, these will be taken care of by µBlock.
    if ( parsed.hostname && parsed.fopts === '' && parsed.action === BlockAction && reHostnameRule.test(parsed.f) ) {
        return false;
    }

    // Pure third-party hostnames, use more efficient liquid dict
    if ( reHostnameRule.test(parsed.f) && parsed.hostname && parsed.action === BlockAction ) {
        if ( parsed.fopts === 'third-party' ) {
            return this.blocked3rdPartyHostnames.add(parsed.f);
        }
        if ( parsed.fopts === '' ) {
            return this.blockedAnyPartyHostnames.add(parsed.f);
        }
    }

    var r = this.addFilter(parsed);
    if ( r === false ) {
        return false;
    }

    if ( parsed.action ) {
        this.allowFilterCount += 1;
    } else {
        this.blockFilterCount += 1;
    }
    return true;
};

/******************************************************************************/

FilterContainer.prototype.addFilter = function(parsed) {
    // TODO: avoid duplicates

    var matches = parsed.hostname ? findHostnameToken(parsed.f) : findFirstGoodToken(parsed.f);
    if ( !matches || !matches[0].length ) {
        return false;
    }
    var tokenBeg = matches.index;
    var tokenEnd = parsed.hostname ? reHostnameToken.lastIndex : reGoodToken.lastIndex;
    var i, n, filter;

    if ( parsed.hostnames.length || parsed.notHostnames.length ) {
        n = parsed.hostnames.length;
        for ( i = 0; i < n; i++ ) {
            filter = makeHostnameFilter(parsed, tokenBeg, parsed.hostnames[i]);
            if ( !filter ) {
                return false;
            }
            this.addFilterEntry(
                filter,
                parsed,
                SpecificParty | this.toDomainBits(parsed.domains[i]),
                tokenBeg,
                tokenEnd
            );
        }
        n = parsed.notHostnames.length;
        for ( i = 0; i < n; i++ ) {
            filter = makeNotHostnameFilter(parsed, tokenBeg, parsed.notHostnames[i]);
            if ( !filter ) {
                return false;
            }
            this.addFilterEntry(
                filter,
                parsed,
                SpecificNotParty | this.toDomainBits(parsed.notDomains[i]),
                tokenBeg,
                tokenEnd
            );
        }
    } else {
        filter = makeFilter(parsed, tokenBeg);
        if ( !filter ) {
            return false;
        }
        if ( parsed.firstParty ) {
            this.addFilterEntry(filter, parsed, FirstParty, tokenBeg, tokenEnd);
        } else if ( parsed.thirdParty ) {
            this.addFilterEntry(filter, parsed, ThirdParty, tokenBeg, tokenEnd);
        } else {
            this.addFilterEntry(filter, parsed, AnyParty, tokenBeg, tokenEnd);
        }
    }
    return true;
};

/******************************************************************************/

FilterContainer.prototype.addFilterEntry = function(filter, parsed, party, tokenBeg, tokenEnd) {
    var s = parsed.f;
    var prefixKey = trimChar(s.substring(tokenBeg - 1, tokenBeg), '*');
    var suffixKey = trimChar(s.substring(tokenEnd, tokenEnd + 1), '*');
    var tokenKey = prefixKey + s.slice(tokenBeg, tokenEnd) + suffixKey;
    if ( parsed.types.length === 0 ) {
        this.addToCategory(parsed.action | AnyType | party, tokenKey, filter);
        return;
    }
    var n = parsed.types.length;
    for ( var i = 0; i < n; i++ ) {
        this.addToCategory(parsed.action | parsed.types[i] | party, tokenKey, filter);
    }
};

/******************************************************************************/

FilterContainer.prototype.addToCategory = function(category, tokenKey, filter) {
    var categoryKey = this.makeCategoryKey(category);
    var categoryBucket = this.categories[categoryKey];
    if ( !categoryBucket ) {
        categoryBucket = this.categories[categoryKey] = {};
    }
    var filterEntry = categoryBucket[tokenKey];
    if ( filterEntry === undefined ) {
        categoryBucket[tokenKey] = filter;
        return;
    }
    if ( filterEntry instanceof FilterBucket ) {
        filterEntry.add(filter);
        return;
    }
    categoryBucket[tokenKey] = new FilterBucket(filterEntry, filter);
};

/******************************************************************************/

// Reset all, thus reducing to a minimum memory footprint of the context.

FilterContainer.prototype.reset = function() {
    this.processedFilterCount = 0;
    this.supportedFilterCount = 0;
    this.allowFilterCount = 0;
    this.blockFilterCount = 0;
    this.categories = {};
    this.blockedAnyPartyHostnames.reset();
    this.blocked3rdPartyHostnames.reset();
    this.duplicates = {};
    this.filterParser.reset();
};

/******************************************************************************/

FilterContainer.prototype.freeze = function() {
    // histogram('allFilters', this.categories);
    this.blockedAnyPartyHostnames.freeze();
    this.blocked3rdPartyHostnames.freeze();
    this.duplicates = {};
    this.filterParser.reset();
};

/******************************************************************************/

FilterContainer.prototype.matchToken = function(bucket) {
    var url = this.url;
    var beg = this.matches.index;
    var end = this.reAnyToken.lastIndex;
    var f;
    if ( end !== url.length ) {
        if ( beg !== 0 ) {
            f = bucket[url.slice(beg-1, end+1)];
            if ( f !== undefined && f.match(url, beg) !== false ) {
                return f.s;
            }
        }
        f = bucket[url.slice(beg, end+1)];
        if ( f !== undefined && f.match(url, beg) !== false ) {
            return f.s;
        }
    }
    if ( beg !== 0 ) {
        f = bucket[url.slice(beg-1, end)];
        if ( f !== undefined && f.match(url, beg) !== false ) {
            return f.s;
        }
    }
    f = bucket[url.slice(beg, end)];
    if ( f !== undefined && f.match(url, beg) !== false ) {
        return f.s;
    }
    return false;
};

/******************************************************************************/

FilterContainer.prototype.matchTokens = function() {
    var url = this.url;
    var re = this.reAnyToken;
    var r;

    re.lastIndex = 0;
    while ( this.matches = re.exec(url) ) {
        if ( this.bucket0 ) {
            r = this.matchToken(this.bucket0);
            if ( r !== false ) { return r; }
        }
        if ( this.bucket1 ) {
            r = this.matchToken(this.bucket1);
            if ( r !== false ) { return r; }
        }
        if ( this.bucket2 ) {
            r = this.matchToken(this.bucket2);
            if ( r !== false ) { return r; }
        }
        if ( this.bucket3 ) {
            r = this.matchToken(this.bucket3);
            if ( r !== false ) { return r; }
        }
        if ( this.bucket4 ) {
            r = this.matchToken(this.bucket4);
            if ( r !== false ) { return r; }
        }
        if ( this.bucket5 ) {
            r = this.matchToken(this.bucket5);
            if ( r !== false ) { return r; }
        }
        if ( this.bucket6 ) {
            r = this.matchToken(this.bucket6);
            if ( r !== false ) { return r; }
        }
        if ( this.bucket7 ) {
            r = this.matchToken(this.bucket7);
            if ( r !== false ) { return r; }
        }
    }
    return false;
};

/******************************************************************************/

// This is where we test filters which have the form:
//
//   `||www.example.com^`
//
// Because LiquidDict is well optimized to deal with plain hostname, we gain
// reusing it here for these sort of filters rather than using filters
// specialized to deal with other complex filters.

FilterContainer.prototype.matchAnyPartyHostname = function(requestHostname) {
    // Quick test first
    if ( this.blockedAnyPartyHostnames.test(requestHostname) ) {
        return '||' + requestHostname + '^';
    }
    // Check parent hostnames if quick test failed
    var hostnames = µBlock.URI.parentHostnamesFromHostname(requestHostname);
    for ( var i = 0, n = hostnames.length; i < n; i++ ) {
        if ( this.blockedAnyPartyHostnames.test(hostnames[i]) ) {
            return '||' + hostnames[i] + '^';
        }
    }
    return false;
};

/******************************************************************************/

// This is where we test filters which have the form:
//
//   `||www.example.com^$third-party`
//
// Because LiquidDict is well optimized to deal with plain hostname, we gain
// reusing it here for these sort of filters rather than using filters
// specialized to deal with other complex filters.

FilterContainer.prototype.match3rdPartyHostname = function(requestHostname) {
    // Quick test first
    if ( this.blocked3rdPartyHostnames.test(requestHostname) ) {
        return '||' + requestHostname + '^$third-party';
    }
    // Check parent hostnames if quick test failed
    var hostnames = µBlock.URI.parentHostnamesFromHostname(requestHostname);
    for ( var i = 0, n = hostnames.length; i < n; i++ ) {
        if ( this.blocked3rdPartyHostnames.test(hostnames[i]) ) {
            return '||' + hostnames[i] + '^$third-party';
        }
    }
    return false;
};

/******************************************************************************/

FilterContainer.prototype.matchString = function(pageDetails, url, requestType, requestHostname) {
    // adbProfiler.countUrl();

    // https://github.com/gorhill/httpswitchboard/issues/239
    // Convert url to lower case:
    //     `match-case` option not supported, but then, I saw only one
    //     occurrence of it in all the supported lists (bulgaria list).
    this.url = url.toLowerCase();

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
    // filters are tested *only* if there is a hit on a (unlikely) hit on a
    // block filter.

    var pageDomain = pageDetails.pageDomain || '';
    var party = requestHostname.slice(-pageDomain.length) === pageDomain ?
        FirstParty :
        ThirdParty;
    var domainParty = this.toDomainBits(pageDomain);
    var type = typeNameToTypeValue[requestType];
    var categories = this.categories;

    // Test hostname-based block filters
    var bf = false;
    bf = this.matchAnyPartyHostname(requestHostname);
    if ( bf === false && party === ThirdParty ) {
        bf = this.match3rdPartyHostname(requestHostname);
    }

    // This will be used by hostname-based filters
    pageHostname = pageDetails.pageHostname || '';

    // Test against block filters
    if ( bf === false ) {
        this.bucket0 = categories[this.makeCategoryKey(BlockAnyTypeAnyParty)];
        this.bucket1 = categories[this.makeCategoryKey(BlockAnyType | party)];
        this.bucket2 = categories[this.makeCategoryKey(BlockAnyTypeOneParty | domainParty)];
        this.bucket3 = categories[this.makeCategoryKey(BlockAnyTypeOtherParties | domainParty)];
        this.bucket4 = categories[this.makeCategoryKey(BlockAnyParty | type)];
        this.bucket5 = categories[this.makeCategoryKey(BlockAction | type | party)];
        this.bucket6 = categories[this.makeCategoryKey(BlockOneParty | type | domainParty)];
        this.bucket7 = categories[this.makeCategoryKey(BlockOtherParties | type | domainParty)];

        bf = this.matchTokens();
    }

    // If there is no block filter, no need to test against allow filters
    if ( bf === false ) {
        return false;
    }

    // Test against allow filters
    this.bucket0 = categories[this.makeCategoryKey(AllowAnyTypeAnyParty)];
    this.bucket1 = categories[this.makeCategoryKey(AllowAnyType | party)];
    this.bucket2 = categories[this.makeCategoryKey(AllowAnyTypeOneParty | domainParty)];
    this.bucket3 = categories[this.makeCategoryKey(AllowAnyTypeOtherParties | domainParty)];
    this.bucket4 = categories[this.makeCategoryKey(AllowAnyParty | type)];
    this.bucket5 = categories[this.makeCategoryKey(AllowAction | type | party)];
    this.bucket6 = categories[this.makeCategoryKey(AllowOneParty | type | domainParty)];
    this.bucket7 = categories[this.makeCategoryKey(AllowOtherParties | type | domainParty)];

    if ( this.matchTokens() !== false ) {
        return false;
    }

    return bf;
};

/******************************************************************************/

FilterContainer.prototype.getFilterCount = function() {
    return this.blockFilterCount + this.allowFilterCount;
};

/******************************************************************************/

return new FilterContainer();

/******************************************************************************/

})();

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

µBlock.netFilteringEngine = (function(){

/******************************************************************************/

var µb = µBlock;

// fedcba9876543210
// |||   | |      |
// |||   | |      |
// |||   | |      |
// |||   | |      |
// |||   | |      +---- bit 0-3: domain bits
// |||   | +---- bit 8-7: party [0 - 3]
// |||   +---- bit 12-9: type [0 - 15]
// ||+---- bit 13: `important`
// |+---- bit 14: [BlockAction | AllowAction]
// +---- bit 15: unused (to ensure valid unicode character)

const BlockAction = 0 << 14;
const AllowAction = 1 << 14;
const ToggleAction = BlockAction ^ AllowAction;

const Important = 1 << 13;
 
const AnyType = 1 << 9;

const AnyParty = 0 << 7;
const FirstParty = 1 << 7;
const ThirdParty = 2 << 7;
const SpecificParty = 3 << 7;

const BlockAnyTypeAnyParty = BlockAction | AnyType | AnyParty;
const BlockAnyType1stParty = BlockAction | AnyType | FirstParty;
const BlockAnyType3rdParty = BlockAction | AnyType | ThirdParty;
const BlockAnyTypeOneParty = BlockAction | AnyType | SpecificParty;
const BlockAnyType = BlockAction | AnyType;
const BlockAnyParty = BlockAction | AnyParty;
const BlockOneParty = BlockAction | SpecificParty;

const AllowAnyTypeAnyParty = AllowAction | AnyType | AnyParty;
const AllowAnyType1stParty = AllowAction | AnyType | FirstParty;
const AllowAnyType3rdParty = AllowAction | AnyType | ThirdParty;
const AllowAnyTypeOneParty = AllowAction | AnyType | SpecificParty;
const AllowAnyType = AllowAction | AnyType;
const AllowAnyParty = AllowAction | AnyParty;
const AllowOneParty = AllowAction | SpecificParty;

const noDomainName = 'not-a-real-domain';

var pageHostname = '';

var reIgnoreEmpty = /^\s+$/;
var reIgnoreComment = /^\[|^!/;
var reHostnameRule = /^[0-9a-z][0-9a-z.-]+[0-9a-z]$/;
var reHostnameToken = /^[0-9a-z]+/g;
var reGoodToken = /[%0-9a-z]{2,}/g;
var reURLPostHostnameAnchors = /[\/?#]/;

var typeNameToTypeValue = {
        'stylesheet': 2 << 9,
             'image': 3 << 9,
            'object': 4 << 9,
            'script': 5 << 9,
    'xmlhttprequest': 6 << 9,
         'sub_frame': 7 << 9,
             'other': 8 << 9,
             'popup': 9 << 9
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
/******************************************************************************/

// Could be replaced with encodeURIComponent/decodeURIComponent,
// which seems faster on Firefox.
var encode = JSON.stringify;
var decode = JSON.parse;

var cachedParseInt = parseInt;

var atoi = function(s) {
    return cachedParseInt(s, 10);
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

- one wildcard
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
    - no hostname (not implemented)
    - specific hostname (not implemented)

- more than one wildcard
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
    - no hostname (not implemented)
    - specific hostname (not implemented)

*/

/******************************************************************************/

var FilterPlain = function(s, tokenBeg) {
    this.s = s;
    this.tokenBeg = tokenBeg;
};

FilterPlain.prototype.match = function(url, tokenBeg) {
    return url.substr(tokenBeg - this.tokenBeg, this.s.length) === this.s;
};

FilterPlain.prototype.fid = 'a';

FilterPlain.prototype.toString = function() {
    return this.s;
};

FilterPlain.prototype.toSelfie = function() {
    return this.s + '\t' +
           this.tokenBeg;
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
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg - this.tokenBeg, this.s.length) === this.s;
};

FilterPlainHostname.prototype.fid = 'ah';

FilterPlainHostname.prototype.toString = function() {
    return this.s + '$domain=' + this.hostname;
};

FilterPlainHostname.prototype.toSelfie = function() {
    return this.s + '\t' +
           this.tokenBeg + '\t' +
           this.hostname;
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

FilterPlainPrefix0.prototype.fid = '0a';

FilterPlainPrefix0.prototype.toString = function() {
    return this.s;
};

FilterPlainPrefix0.prototype.toSelfie = function() {
    return this.s;
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
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg, this.s.length) === this.s;
};

FilterPlainPrefix0Hostname.prototype.fid = '0ah';

FilterPlainPrefix0Hostname.prototype.toString = function() {
    return this.s + '$domain=' + this.hostname;
};

FilterPlainPrefix0Hostname.prototype.toSelfie = function() {
    return this.s + '\t' +
           this.hostname;
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

FilterPlainPrefix1.prototype.fid = '1a';

FilterPlainPrefix1.prototype.toString = function() {
    return this.s;
};

FilterPlainPrefix1.prototype.toSelfie = function() {
    return this.s;
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
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg - 1, this.s.length) === this.s;
};

FilterPlainPrefix1Hostname.prototype.fid = '1ah';

FilterPlainPrefix1Hostname.prototype.toString = function() {
    return this.s + '$domain=' + this.hostname;
};

FilterPlainPrefix1Hostname.prototype.toSelfie = function() {
    return this.s + '\t' +
           this.hostname;
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

FilterPlainLeftAnchored.prototype.fid = '|a';

FilterPlainLeftAnchored.prototype.toString = function() {
    return '|' + this.s;
};

FilterPlainLeftAnchored.prototype.toSelfie = function() {
    return this.s;
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
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.slice(0, this.s.length) === this.s;
};

FilterPlainLeftAnchoredHostname.prototype.fid = '|ah';

FilterPlainLeftAnchoredHostname.prototype.toString = function() {
    return '|' + this.s + '$domain=' + this.hostname;
};

FilterPlainLeftAnchoredHostname.prototype.toSelfie = function() {
    return this.s + '\t' +
           this.hostname;
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

FilterPlainRightAnchored.prototype.fid = 'a|';

FilterPlainRightAnchored.prototype.toString = function() {
    return this.s + '|';
};

FilterPlainRightAnchored.prototype.toSelfie = function() {
    return this.s;
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
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.slice(-this.s.length) === this.s;
};

FilterPlainRightAnchoredHostname.prototype.fid = 'a|h';

FilterPlainRightAnchoredHostname.prototype.toString = function() {
    return this.s + '|$domain=' + this.hostname;
};

FilterPlainRightAnchoredHostname.prototype.toSelfie = function() {
    return this.s + '\t' +
           this.hostname;
};

FilterPlainRightAnchoredHostname.fromSelfie = function(s) {
    var pos = s.indexOf('\t');
    return new FilterPlainRightAnchoredHostname(s.slice(0, pos), s.slice(pos + 1));
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/235
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

FilterPlainHnAnchored.prototype.fid = 'h|a';

FilterPlainHnAnchored.prototype.toString = function() {
    return '||' + this.s;
};

FilterPlainHnAnchored.prototype.toSelfie = function() {
    return this.s;
};

FilterPlainHnAnchored.fromSelfie = function(s) {
    return new FilterPlainHnAnchored(s);
};

// https://www.youtube.com/watch?v=71YS6xDB-E4

/******************************************************************************/

// With a single wildcard, regex is not optimal.
// See:
//   http://jsperf.com/regexp-vs-indexof-abp-miss/3
//   http://jsperf.com/regexp-vs-indexof-abp-hit/3

var FilterSingleWildcard = function(lSegment, rSegment, tokenBeg) {
    this.tokenBeg = tokenBeg;
    this.lSegment = lSegment;
    this.rSegment = rSegment;
};

FilterSingleWildcard.prototype.match = function(url, tokenBeg) {
    tokenBeg -= this.tokenBeg;
    return url.substr(tokenBeg, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, tokenBeg + this.lSegment.length) > 0;
};

FilterSingleWildcard.prototype.fid = '*';

FilterSingleWildcard.prototype.toString = function() {
    return this.lSegment + '*' + this.rSegment;
};

FilterSingleWildcard.prototype.toSelfie = function() {
    return this.lSegment + '\t' +
           this.rSegment + '\t' +
           this.tokenBeg;
};

FilterSingleWildcard.fromSelfie = function(s) {
    var args = s.split('\t');
    return new FilterSingleWildcard(args[0], args[1], atoi(args[2]));
};

/******************************************************************************/

var FilterSingleWildcardHostname = function(lSegment, rSegment, tokenBeg, hostname) {
    this.tokenBeg = tokenBeg;
    this.lSegment = lSegment;
    this.rSegment = rSegment;
    this.hostname = hostname;
};

FilterSingleWildcardHostname.prototype.match = function(url, tokenBeg) {
    tokenBeg -= this.tokenBeg;
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, tokenBeg + this.lSegment.length) > 0;
};

FilterSingleWildcardHostname.prototype.fid = '*h';

FilterSingleWildcardHostname.prototype.toString = function() {
    return this.lSegment + '*' + this.rSegment + '$domain=' + this.hostname;
};

FilterSingleWildcardHostname.prototype.toSelfie = function() {
    return this.lSegment + '\t' +
           this.rSegment + '\t' +
           this.tokenBeg + '\t' +
           this.hostname;
};

FilterSingleWildcardHostname.fromSelfie = function(s) {
    var args = s.split('\t');
    return new FilterSingleWildcardHostname(args[0], args[1], atoi(args[2]), args[3]);
};

/******************************************************************************/

var FilterSingleWildcardPrefix0 = function(lSegment, rSegment) {
    this.lSegment = lSegment;
    this.rSegment = rSegment;
};

FilterSingleWildcardPrefix0.prototype.match = function(url, tokenBeg) {
    return url.substr(tokenBeg, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, tokenBeg + this.lSegment.length) > 0;
};

FilterSingleWildcardPrefix0.prototype.fid = '0*';

FilterSingleWildcardPrefix0.prototype.toString = function() {
    return this.lSegment + '*' + this.rSegment;
};

FilterSingleWildcardPrefix0.prototype.toSelfie = function() {
    return this.lSegment + '\t' +
           this.rSegment;
};

FilterSingleWildcardPrefix0.fromSelfie = function(s) {
    var pos = s.indexOf('\t');
    return new FilterSingleWildcardPrefix0(s.slice(0, pos), s.slice(pos + 1));
};

/******************************************************************************/

var FilterSingleWildcardPrefix0Hostname = function(lSegment, rSegment, hostname) {
    this.lSegment = lSegment;
    this.rSegment = rSegment;
    this.hostname = hostname;
};

FilterSingleWildcardPrefix0Hostname.prototype.match = function(url, tokenBeg) {
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.substr(tokenBeg, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, tokenBeg + this.lSegment.length) > 0;
};

FilterSingleWildcardPrefix0Hostname.prototype.fid = '0*h';

FilterSingleWildcardPrefix0Hostname.prototype.toString = function() {
    return this.lSegment + '*' + this.rSegment + '$domain=' + this.hostname;
};

FilterSingleWildcardPrefix0Hostname.prototype.toSelfie = function() {
    return this.lSegment + '\t' +
           this.rSegment + '\t' +
           this.hostname;
};

FilterSingleWildcardPrefix0Hostname.fromSelfie = function(s) {
    var args = s.split('\t');
    return new FilterSingleWildcardPrefix0Hostname(args[0], args[1], args[2]);
};

/******************************************************************************/

var FilterSingleWildcardLeftAnchored = function(lSegment, rSegment) {
    this.lSegment = lSegment;
    this.rSegment = rSegment;
};

FilterSingleWildcardLeftAnchored.prototype.match = function(url) {
    return url.slice(0, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, this.lSegment.length) > 0;
};

FilterSingleWildcardLeftAnchored.prototype.fid = '|*';

FilterSingleWildcardLeftAnchored.prototype.toString = function() {
    return '|' + this.lSegment + '*' + this.rSegment;
};

FilterSingleWildcardLeftAnchored.prototype.toSelfie = function() {
    return this.lSegment + '\t' +
           this.rSegment;
};

FilterSingleWildcardLeftAnchored.fromSelfie = function(s) {
    var pos = s.indexOf('\t');
    return new FilterSingleWildcardLeftAnchored(s.slice(0, pos), s.slice(pos + 1));
};

/******************************************************************************/

var FilterSingleWildcardLeftAnchoredHostname = function(lSegment, rSegment, hostname) {
    this.lSegment = lSegment;
    this.rSegment = rSegment;
    this.hostname = hostname;
};

FilterSingleWildcardLeftAnchoredHostname.prototype.match = function(url) {
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.slice(0, this.lSegment.length) === this.lSegment &&
           url.indexOf(this.rSegment, this.lSegment.length) > 0;
};

FilterSingleWildcardLeftAnchoredHostname.prototype.fid = '|*h';

FilterSingleWildcardLeftAnchoredHostname.prototype.toString = function() {
    return '|' + this.lSegment + '*' + this.rSegment + '$domain=' + this.hostname;
};

FilterSingleWildcardLeftAnchoredHostname.prototype.toSelfie = function() {
    return this.lSegment + '\t' +
           this.rSegment + '\t' +
           this.hostname;
};

FilterSingleWildcardLeftAnchoredHostname.fromSelfie = function(s) {
    var args = s.split('\t');
    return new FilterSingleWildcardLeftAnchoredHostname(args[0], args[1], args[2]);
};

/******************************************************************************/

var FilterSingleWildcardRightAnchored = function(lSegment, rSegment) {
    this.lSegment = lSegment;
    this.rSegment = rSegment;
};

FilterSingleWildcardRightAnchored.prototype.match = function(url) {
    return url.slice(-this.rSegment.length) === this.rSegment &&
           url.lastIndexOf(this.lSegment, url.length - this.rSegment.length - this.lSegment.length) >= 0;
};

FilterSingleWildcardRightAnchored.prototype.fid = '*|';

FilterSingleWildcardRightAnchored.prototype.toString = function() {
    return this.lSegment + '*' + this.rSegment + '|';
};

FilterSingleWildcardRightAnchored.prototype.toSelfie = function() {
    return this.lSegment + '\t' +
           this.rSegment;
};

FilterSingleWildcardRightAnchored.fromSelfie = function(s) {
    var pos = s.indexOf('\t');
    return new FilterSingleWildcardRightAnchored(s.slice(0, pos), s.slice(pos + 1));
};

/******************************************************************************/

var FilterSingleWildcardRightAnchoredHostname = function(lSegment, rSegment, hostname) {
    this.lSegment = lSegment;
    this.rSegment = rSegment;
    this.hostname = hostname;
};

FilterSingleWildcardRightAnchoredHostname.prototype.match = function(url) {
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           url.slice(-this.rSegment.length) === this.rSegment &&
           url.lastIndexOf(this.lSegment, url.length - this.rSegment.length - this.lSegment.length) >= 0;
};

FilterSingleWildcardRightAnchoredHostname.prototype.fid = '*|h';

FilterSingleWildcardRightAnchoredHostname.prototype.toString = function() {
    return this.lSegment + '*' + this.rSegment + '|$domain=' + this.hostname;
};

FilterSingleWildcardRightAnchoredHostname.prototype.toSelfie = function() {
    return this.lSegment + '\t' +
           this.rSegment + '\t' +
           this.hostname;
};

FilterSingleWildcardRightAnchoredHostname.fromSelfie = function(s) {
    var args = s.split('\t');
    return new FilterSingleWildcardRightAnchoredHostname(args[0], args[1], args[2]);
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
    return this.re.test(url.slice(tokenBeg - this.tokenBeg));
};

FilterManyWildcards.prototype.fid = '*+';

FilterManyWildcards.prototype.toString = function() {
    return this.s;
};

FilterManyWildcards.prototype.toSelfie = function() {
    return this.s + '\t' +
           this.tokenBeg;
};

FilterManyWildcards.fromSelfie = function(s) {
    var pos = s.indexOf('\t');
    return new FilterManyWildcards(s.slice(0, pos), atoi(s.slice(pos + 1)));
};

/******************************************************************************/

var FilterManyWildcardsHostname = function(s, tokenBeg, hostname) {
    this.s = s;
    this.tokenBeg = tokenBeg;
    this.re = new RegExp('^' + s.replace(/([.+?^=!:${}()|\[\]\/\\])/g, '\\$1').replace(/\*/g, '.*'));
    this.hostname = hostname;
};

FilterManyWildcardsHostname.prototype.match = function(url, tokenBeg) {
    return pageHostname.slice(-this.hostname.length) === this.hostname &&
           this.re.test(url.slice(tokenBeg - this.tokenBeg));
};

FilterManyWildcardsHostname.prototype.fid = '*+h';

FilterManyWildcardsHostname.prototype.toString = function() {
    return this.s + '$domain=' + this.hostname;
};

FilterManyWildcardsHostname.prototype.toSelfie = function() {
    return this.s + '\t' +
           this.tokenBeg + '\t' +
           this.hostname;
};

FilterManyWildcardsHostname.fromSelfie = function(s) {
    var args = s.split('\t');
    return new FilterManyWildcardsHostname(args[0], atoi(args[1]), args[2]);
};

/******************************************************************************/

// TODO: Some buckets may grow quite large (see histogram excerpt below).
// Evaluate the gain from having an internal dictionary for such large 
// buckets: the key would be created by concatenating the char preceding and 
// following the token. The dict would contain smaller buckets, and there 
// would be a special bucket for those filters for which a prefix, suffix, or 
// both is missing.
// I used to do this, but at a higher level, during tokenization, and in the
// end I found out the overhead was to much. I believe it will be a gain 
// here because the special treatment would be only for a few specific tokens,
// not systematically done for all tokens.

// key=Ȁ ad          count=655
// key=Ȁ ads         count=432
// key=̀  doubleclick count= 94
// key=Ȁ adv         count= 89
// key=Ȁ google      count= 67
// key=Ȁ banner      count= 55

var FilterBucket = function(a, b) {
    this.f = null;
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

FilterBucket.prototype.match = function(url, tokenBeg) {
    var filters = this.filters;
    var i = filters.length;
    while ( i-- ) {
        if ( filters[i].match(url, tokenBeg) !== false ) {
            this.f = filters[i];
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

var makeFilter = function(details, tokenBeg) {
    var s = details.f;
    var wcOffset = s.indexOf('*');
    if ( wcOffset !== -1 ) {
        if ( s.indexOf('*', wcOffset + 1) !== -1 ) {
            return details.anchor === 0 ? new FilterManyWildcards(s, tokenBeg) : null;
        }
        var lSegment = s.slice(0, wcOffset);
        var rSegment = s.slice(wcOffset + 1);
        if ( details.anchor < 0 ) {
            return new FilterSingleWildcardLeftAnchored(lSegment, rSegment);
        }
        if ( details.anchor > 0 ) {
            return new FilterSingleWildcardRightAnchored(lSegment, rSegment);
        }
        if ( tokenBeg === 0 ) {
            return new FilterSingleWildcardPrefix0(lSegment, rSegment);
        }
        return new FilterSingleWildcard(lSegment, rSegment, tokenBeg);
    }
    if ( details.anchor < 0 ) {
        return new FilterPlainLeftAnchored(s);
    }
    if ( details.anchor > 0 ) {
        return new FilterPlainRightAnchored(s);
    }
    if ( details.hostnameAnchored ) {
        return new FilterPlainHnAnchored(s);
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
    if ( wcOffset !== -1 ) {
        if ( s.indexOf('*', wcOffset + 1) !== -1 ) {
            return details.anchor === 0 ? new FilterManyWildcardsHostname(s, tokenBeg, hostname) : null;
        }
        var lSegment = s.slice(0, wcOffset);
        var rSegment = s.slice(wcOffset + 1);
        if ( details.anchor < 0 ) {
            return new FilterSingleWildcardLeftAnchoredHostname(lSegment, rSegment, hostname);
        }
        if ( details.anchor > 0 ) {
            return new FilterSingleWildcardRightAnchoredHostname(lSegment, rSegment, hostname);
        }
        if ( tokenBeg === 0 ) {
            return new FilterSingleWildcardPrefix0Hostname(lSegment, rSegment, hostname);
        }
        return new FilterSingleWildcardHostname(lSegment, rSegment, tokenBeg, hostname);
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

// Given a string, find a good token. Tokens which are too generic, i.e. very
// common with a high probability of ending up as a miss, are not
// good. Avoid if possible. This has a *significant* positive impact on
// performance.
// These "bad tokens" are collated manually.

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
/******************************************************************************/

var FilterParser = function() {
    this.domains = [];
    this.hostnames = [];
    this.types = [];
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
             'popup': 'popup'
};

/******************************************************************************/

FilterParser.prototype.reset = function() {
    this.action = BlockAction;
    this.anchor = 0;
    this.domains.length = 0;
    this.elemHiding = false;
    this.f = '';
    this.firstParty = false;
    this.fopts = '';
    this.hostnameAnchored = false;
    this.hostnamePure = false;
    this.hostnames.length = 0;
    this.notHostname = false;
    this.thirdParty = false;
    this.types.length = 0;
    this.important = 0;
    this.unsupported = false;
    return this;
};

/******************************************************************************/

FilterParser.prototype.parseOptType = function(raw, not) {
    var type = this.toNormalizedType[raw];
    if ( not ) {
        for ( var k in typeNameToTypeValue ) {
            if ( k === type ) { continue; }
            // https://github.com/gorhill/uBlock/issues/121
            // `popup` is a special type, it cannot be set for filters intended
            // for real net request types. The test is safe since there is no
            // such thing as a filter using `~popup`.
            if ( k === 'popup' ) { continue; }
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
    var µburi = µb.URI;
    var hostnames = raw.split('|');
    var hostname, not, domain;
    for ( var i = 0; i < hostnames.length; i++ ) {
        hostname = hostnames[i];
        not = hostname.charAt(0) === '~';
        if ( not ) {
            hostname = hostname.slice(1);
        }
        // https://github.com/gorhill/uBlock/issues/188
        // If not a real domain as per PSL, assign a synthetic one
        domain = µburi.domainFromHostname(hostname);
        if ( domain === '' ) {
            domain = noDomainName;
        }
        // https://github.com/gorhill/uBlock/issues/191
        // Well it doesn't seem to make a whole lot of sense to have both 
        // non-negated hostnames mixed with negated hostnames.
        if ( this.hostnames.length !== 0 && not !== this.notHostname ) {
            console.error('FilterContainer.parseOptHostnames(): ambiguous filter syntax: "%s"', this.f);
            this.unsupported = true;
            return;
        }
        this.notHostname = not;
        this.hostnames.push(hostname);
        this.domains.push(domain);
    }
};

/******************************************************************************/

FilterParser.prototype.parse = function(s) {
    // important!
    this.reset();

    if ( reHostnameRule.test(s) ) {
        this.f = s;
        this.hostnamePure = this.hostnameAnchored = true;
        return this;
    }

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

    // options
    var pos = s.indexOf('$');
    if ( pos > 0 ) {
        this.fopts = s.slice(pos + 1);
        s = s.slice(0, pos);
    }

    // regex? (not supported)
    if ( s.charAt(0) === '/' && s.slice(-1) === '/' ) {
        this.unsupported = true;
        return this;
    }

    // hostname anchoring
    if ( s.slice(0, 2) === '||' ) {
        this.hostnameAnchored = true;
        s = s.slice(2);
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
    s = s.replace(/\^/g, '*');
    s = s.replace(/\*\*+/g, '*');

    // remove leading and trailing wildcards
    s = trimChar(s, '*');

    // pure hostname-based?
    this.hostnamePure = this.hostnameAnchored && reHostnameRule.test(s);

    this.f = s;

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
    return this;
};

/******************************************************************************/
/******************************************************************************/

var FilterContainer = function() {
    this.reAnyToken = /[%0-9a-z]+/g;
    this.buckets = new Array(8);
    this.blockedAnyPartyHostnames = new µb.LiquidDict();
    this.blocked3rdPartyHostnames = new µb.LiquidDict();
    this.filterParser = new FilterParser();
    this.noDomainBits = this.toDomainBits(noDomainName);
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
    this.categories = {};
    this.duplicates = {};
    this.blockedAnyPartyHostnames.reset();
    this.blocked3rdPartyHostnames.reset();
    this.filterParser.reset();
};

/******************************************************************************/

FilterContainer.prototype.freeze = function() {
    //histogram('allFilters', this.categories);
    this.blockedAnyPartyHostnames.freeze();
    this.blocked3rdPartyHostnames.freeze();
    this.duplicates = {};
    this.filterParser.reset();
    this.frozen = true;
};

/******************************************************************************/

FilterContainer.prototype.toSelfie = function() {
    var categoryToSelfie = function(dict) {
        var selfie = [];
        var bucket, ff, n, i, f;
        for ( var k in dict ) {
            if ( dict.hasOwnProperty(k) === false ) {
                continue;
            }
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
            if ( dict.hasOwnProperty(k) === false ) {
                continue;
            }
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
        categories: categoriesToSelfie(this.categories),
        blockedAnyPartyHostnames: this.blockedAnyPartyHostnames.toSelfie(),
        blocked3rdPartyHostnames: this.blocked3rdPartyHostnames.toSelfie()
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
    this.blockedAnyPartyHostnames.fromSelfie(selfie.blockedAnyPartyHostnames);
    this.blocked3rdPartyHostnames.fromSelfie(selfie.blocked3rdPartyHostnames);

    var factories = {
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
        'h|a': FilterPlainHnAnchored,
          '*': FilterSingleWildcard,
         '*h': FilterSingleWildcardHostname,
         '0*': FilterSingleWildcardPrefix0,
        '0*h': FilterSingleWildcardPrefix0Hostname,
         '|*': FilterSingleWildcardLeftAnchored,
        '|*h': FilterSingleWildcardLeftAnchoredHostname,
         '*|': FilterSingleWildcardRightAnchored,
        '*|h': FilterSingleWildcardRightAnchoredHostname,
         '*+': FilterManyWildcards,
        '*+h': FilterManyWildcardsHostname
    };

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
            subdict = dict[catKey] = {};
            bucket = null;
            continue;
        }
        if ( what === 'k2' ) {
            tokenKey = decode(line.slice(pos + 1));
            bucket = null;
            continue;
        }
        factory = factories[what];
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

    // Ignore rules with other conditions for now
    if ( parsed.unsupported ) {
        this.rejectedCount += 1;
        // console.log('µBlock> abp-filter.js/FilterContainer.add(): unsupported filter "%s"', s);
        return false;
    }

    // Ignore element-hiding filters
    if ( parsed.elemHiding ) {
        return false;
    }

    this.processedFilterCount += 1;
    this.acceptedCount += 1;

    // Pure hostnames, use more efficient liquid dict
    if ( parsed.hostnamePure && parsed.action === BlockAction ) {
        if ( parsed.fopts === '' ) {
            if ( this.blockedAnyPartyHostnames.add(parsed.f) ) {
                this.blockFilterCount++;
            } else {
                this.duplicateCount++;
            }
            return true;
        }
        if ( parsed.fopts === 'third-party' ) {
            if ( this.blocked3rdPartyHostnames.add(parsed.f) ) {
                this.blockFilterCount++;
            } else {
                this.duplicateCount++;
            }
            return true;
        }
    }

    if ( this.duplicates[s] ) {
        this.duplicateCount++;
        return false;
    }
    this.duplicates[s] = true;

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

    var matches = parsed.hostnameAnchored ?
        findHostnameToken(parsed.f) :
        findFirstGoodToken(parsed.f);
    if ( !matches || !matches[0].length ) {
        return false;
    }
    var tokenBeg = matches.index;
    var tokenEnd = parsed.hostnameAnchored ?
        reHostnameToken.lastIndex :
        reGoodToken.lastIndex;
    var filter;

    var i = parsed.hostnames.length;

    // Applies to specific domains

    if ( i !== 0 && !parsed.notHostname ) {
        while ( i-- ) {
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
        return true;
    }

    // Applies to all domains, with exception(s)

    // https://github.com/gorhill/uBlock/issues/191
    // Invert the purpose of the filter for negated hostnames
    if ( i !== 0 && parsed.notHostname ) {
        filter = makeFilter(parsed, tokenBeg);
        if ( !filter ) {
            return false;
        }
        this.addFilterEntry(filter, parsed, AnyParty, tokenBeg, tokenEnd);
        // Reverse purpose of filter
        parsed.action ^= ToggleAction;
        while ( i-- ) {
            filter = makeHostnameFilter(parsed, tokenBeg, parsed.hostnames[i]);
            if ( !filter ) {
                return false;
            }
            // https://github.com/gorhill/uBlock/issues/191#issuecomment-53654024
            // If it is a block filter, we need to reverse the order of
            // evaluation.
            if ( parsed.action === BlockAction ) {
                parsed.important = Important;
            }
            this.addFilterEntry(
                filter,
                parsed,
                SpecificParty | this.toDomainBits(parsed.domains[i]),
                tokenBeg,
                tokenEnd
            );
        }
        return true;
    }

    // Applies to all domains without exceptions

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
    return true;
};

/******************************************************************************/

FilterContainer.prototype.addFilterEntry = function(filter, parsed, party, tokenBeg, tokenEnd) {
    var s = parsed.f;
    var tokenKey = s.slice(tokenBeg, tokenEnd);
    var bits = parsed.action | parsed.important | party;
    if ( parsed.types.length === 0 ) {
        this.addToCategory(bits | AnyType, tokenKey, filter);
        return;
    }
    var n = parsed.types.length;
    for ( var i = 0; i < n; i++ ) {
        this.addToCategory(bits | parsed.types[i], tokenKey, filter);
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
    if ( filterEntry.fid === '[]' ) {
        filterEntry.add(filter);
        return;
    }
    categoryBucket[tokenKey] = new FilterBucket(filterEntry, filter);
};

/******************************************************************************/

FilterContainer.prototype.matchTokens = function(url) {
    var re = this.reAnyToken;
    var matches, beg, token, f;
    var buckets = this.buckets;
    var bucket0 = buckets[0];
    var bucket1 = buckets[1];
    var bucket2 = buckets[2];
    var bucket3 = buckets[3];
    var bucket4 = buckets[4];
    var bucket5 = buckets[5];
    var bucket6 = buckets[6];
    var bucket7 = buckets[7];

    re.lastIndex = 0;
    while ( matches = re.exec(url) ) {
        beg = matches.index;
        token = url.slice(beg, re.lastIndex);
        if ( bucket0 !== undefined && bucket0.hasOwnProperty(token) ) {
            f = bucket0[token];
            if ( f.match(url, beg) !== false ) {
                return f;
            }
        }
        if ( bucket1 !== undefined && bucket1.hasOwnProperty(token) ) {
            f = bucket1[token];
            if ( f.match(url, beg) !== false ) {
                return f;
            }
        }
        if ( bucket2 !== undefined && bucket2.hasOwnProperty(token) ) {
            f = bucket2[token];
            if ( f.match(url, beg) !== false ) {
                return f;
            }
        }
        if ( bucket3 !== undefined && bucket3.hasOwnProperty(token) ) {
            f = bucket3[token];
            if ( f.match(url, beg) !== false ) {
                return f;
            }
        }
        if ( bucket4 !== undefined && bucket4.hasOwnProperty(token) ) {
            f = bucket4[token];
            if ( f.match(url, beg) !== false ) {
                return f;
            }
        }
        if ( bucket5 !== undefined && bucket5.hasOwnProperty(token) ) {
            f = bucket5[token];
            if ( f.match(url, beg) !== false ) {
                return f;
            }
        }
        if ( bucket6 !== undefined && bucket6.hasOwnProperty(token) ) {
            f = bucket6[token];
            if ( f.match(url, beg) !== false ) {
                return f;
            }
        }
        if ( bucket7 !== undefined && bucket7.hasOwnProperty(token) ) {
            f = bucket7[token];
            if ( f.match(url, beg) !== false ) {
                return f;
            }
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
    var pos;
    while ( this.blockedAnyPartyHostnames.test(requestHostname) !== true ) {
        pos = requestHostname.indexOf('.');
        if ( pos === -1 ) {
            return false;
        }
        requestHostname = requestHostname.slice(pos + 1);
    }
    return '||' + requestHostname + '^';
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
    var pos;
    while ( this.blocked3rdPartyHostnames.test(requestHostname) !== true ) {
        pos = requestHostname.indexOf('.');
        if ( pos === -1 ) {
            return false;
        }
        requestHostname = requestHostname.slice(pos + 1);
    }
    return '||' + requestHostname + '^$third-party';
};

/******************************************************************************/

// Specialized handlers

// https://github.com/gorhill/uBlock/issues/116
// Some type of requests are exceptional, they need custom handling,
// not the generic handling.

FilterContainer.prototype.matchStringExactType = function(pageDetails, requestURL, requestType) {
    var url = requestURL.toLowerCase();
    var pageDomain = pageDetails.pageDomain || '';
    var requestHostname = µb.URI.hostnameFromURI(requestURL);
    var party = requestHostname.slice(-pageDomain.length) === pageDomain ?
        FirstParty :
        ThirdParty;
    var domainParty = this.toDomainBits(pageDomain);
    var type = typeNameToTypeValue[requestType];
    var categories = this.categories;
    var buckets = this.buckets;

    // This will be used by hostname-based filters
    pageHostname = pageDetails.pageHostname || '';

    buckets[0] = buckets[1] = buckets[2] = buckets[6] = undefined;

    // https://github.com/gorhill/uBlock/issues/139
    // Test against important block filters
    buckets[3] = categories[this.makeCategoryKey(BlockAnyParty | Important | type)];
    buckets[4] = categories[this.makeCategoryKey(BlockAction | Important | type | party)];
    buckets[5] = categories[this.makeCategoryKey(BlockOneParty | Important | type | domainParty)];
    buckets[7] = categories[this.makeCategoryKey(BlockOneParty | Important | type | this.noDomainBits)];
    var bf = this.matchTokens(url);
    if ( bf !== false ) {
        return bf.toString();
    }

    // Test against block filters
    // If there is no block filter, no need to test against allow filters
    buckets[3] = categories[this.makeCategoryKey(BlockAnyParty | type)];
    buckets[4] = categories[this.makeCategoryKey(BlockAction | type | party)];
    buckets[5] = categories[this.makeCategoryKey(BlockOneParty | type | domainParty)];
    buckets[7] = categories[this.makeCategoryKey(BlockOneParty | type | this.noDomainBits)];
    bf = this.matchTokens(url);
    if ( bf === false ) {
        return '';
    }

    // Test against allow filters
    buckets[3] = categories[this.makeCategoryKey(AllowAnyParty | type)];
    buckets[4] = categories[this.makeCategoryKey(AllowAction | type | party)];
    buckets[5] = categories[this.makeCategoryKey(AllowOneParty | type | domainParty)];
    buckets[7] = categories[this.makeCategoryKey(AllowOneParty | type | this.noDomainBits)];
    var af = this.matchTokens(url);
    if ( af !== false ) {
        return '@@' + af.toString();
    }

    return bf.toString();
};

/******************************************************************************/

FilterContainer.prototype.matchString = function(pageDetails, requestURL, requestType) {
    // https://github.com/gorhill/httpswitchboard/issues/239
    // Convert url to lower case:
    //     `match-case` option not supported, but then, I saw only one
    //     occurrence of it in all the supported lists (bulgaria list).
    var url = requestURL.toLowerCase();

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

    var pageDomain = pageDetails.pageDomain || '';
    var requestHostname = µb.URI.hostnameFromURI(requestURL);

    // Find out the relation between the page and request
    var party = ThirdParty;
    if ( requestHostname.slice(0 - pageDomain.length) === pageDomain ) {
        // Be sure to not confuse 'example.com' with 'anotherexample.com'
        var c = requestHostname.charAt(0 - pageDomain.length - 1);
        if ( c === '' || c === '.' ) {
            party = FirstParty;
        }
    }

    // This will be used by hostname-based filters
    pageHostname = pageDetails.pageHostname || '';

    var domainParty = this.toDomainBits(pageDomain);
    var type = typeNameToTypeValue[requestType];
    var categories = this.categories;
    var buckets = this.buckets;

    // https://github.com/gorhill/uBlock/issues/139
    // Test against important block filters.
    // The purpose of the `important` option is to reverse the order of
    // evaluation. Normally, it is "evaluate block then evaluate allow", with
    // the `important` property it is "evaluate allow then evaluate block".
    buckets[0] = categories[this.makeCategoryKey(BlockAnyTypeAnyParty | Important)];
    buckets[1] = categories[this.makeCategoryKey(BlockAnyType | Important | party)];
    buckets[2] = categories[this.makeCategoryKey(BlockAnyTypeOneParty | Important | domainParty)];
    buckets[3] = categories[this.makeCategoryKey(BlockAnyParty | Important | type)];
    buckets[4] = categories[this.makeCategoryKey(BlockAction | Important | type | party)];
    buckets[5] = categories[this.makeCategoryKey(BlockOneParty | Important | type | domainParty)];
    buckets[6] = categories[this.makeCategoryKey(BlockAnyTypeOneParty | Important | this.noDomainBits)];
    buckets[7] = categories[this.makeCategoryKey(BlockOneParty | Important | type | this.noDomainBits)];
    var bf = this.matchTokens(url);
    if ( bf !== false ) {
        return bf.toString() + '$important';
    }

    // Test hostname-based block filters
    bf = this.matchAnyPartyHostname(requestHostname);
    if ( bf === false && party === ThirdParty ) {
        bf = this.match3rdPartyHostname(requestHostname);
    }

    // Test against block filters
    if ( bf === false ) {
        buckets[0] = categories[this.makeCategoryKey(BlockAnyTypeAnyParty)];
        buckets[1] = categories[this.makeCategoryKey(BlockAnyType | party)];
        buckets[2] = categories[this.makeCategoryKey(BlockAnyTypeOneParty | domainParty)];
        buckets[3] = categories[this.makeCategoryKey(BlockAnyParty | type)];
        buckets[4] = categories[this.makeCategoryKey(BlockAction | type | party)];
        buckets[5] = categories[this.makeCategoryKey(BlockOneParty | type | domainParty)];
        // https://github.com/gorhill/uBlock/issues/188
        // Test for synthetic domain as well
        buckets[6] = categories[this.makeCategoryKey(BlockAnyTypeOneParty | this.noDomainBits)];
        buckets[7] = categories[this.makeCategoryKey(BlockOneParty | type | this.noDomainBits)];
        bf = this.matchTokens(url);
    }

    // If there is no block filter, no need to test against allow filters
    if ( bf === false ) {
        return '';
    }

    // Test against allow filters
    buckets[0] = categories[this.makeCategoryKey(AllowAnyTypeAnyParty)];
    buckets[1] = categories[this.makeCategoryKey(AllowAnyType | party)];
    buckets[2] = categories[this.makeCategoryKey(AllowAnyTypeOneParty | domainParty)];
    buckets[3] = categories[this.makeCategoryKey(AllowAnyParty | type)];
    buckets[4] = categories[this.makeCategoryKey(AllowAction | type | party)];
    buckets[5] = categories[this.makeCategoryKey(AllowOneParty | type | domainParty)];
    // https://github.com/gorhill/uBlock/issues/188
    // Test for synthetic domain as well
    buckets[6] = categories[this.makeCategoryKey(AllowAnyTypeOneParty | this.noDomainBits)];
    buckets[7] = categories[this.makeCategoryKey(AllowOneParty | type | this.noDomainBits)];
    var af = this.matchTokens(url);
    if ( af !== false ) {
        return '@@' + af.toString();
    }

    return bf.toString();
};

/******************************************************************************/

FilterContainer.prototype.getFilterCount = function() {
    return this.blockFilterCount + this.allowFilterCount;
};

/******************************************************************************/

return new FilterContainer();

/******************************************************************************/

})();

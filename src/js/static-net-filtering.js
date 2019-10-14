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
/* global punycode */

'use strict';

/******************************************************************************/

µBlock.staticNetFilteringEngine = (( ) => {

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

const typeNameToTypeValue = {
           'no_type':  0 << 4,
        'stylesheet':  1 << 4,
             'image':  2 << 4,
            'object':  3 << 4,
 'object_subrequest':  3 << 4,
            'script':  4 << 4,
             'fetch':  5 << 4,
    'xmlhttprequest':  5 << 4,
         'sub_frame':  6 << 4,
              'font':  7 << 4,
             'media':  8 << 4,
         'websocket':  9 << 4,
            'beacon': 10 << 4,
              'ping': 10 << 4,
             'other': 11 << 4,
             'popup': 12 << 4,  // start of behavorial filtering
          'popunder': 13 << 4,
        'main_frame': 14 << 4,  // start of 1st-party-only behavorial filtering
       'generichide': 15 << 4,
      'specifichide': 16 << 4,
       'inline-font': 17 << 4,
     'inline-script': 18 << 4,
              'data': 19 << 4,  // special: a generic data holder
          'redirect': 20 << 4,
            'webrtc': 21 << 4,
       'unsupported': 22 << 4,
};

const otherTypeBitValue = typeNameToTypeValue.other;

// All network request types to bitmap
//   bring origin to 0 (from 4 -- see typeNameToTypeValue)
//   left-shift 1 by the above-calculated value
//   subtract 1 to set all type bits
const allNetworkTypesBits =
    (1 << (otherTypeBitValue >>> 4)) - 1;
    
const allTypesBits =
    allNetworkTypesBits |
    1 << (typeNameToTypeValue['popup'] >>> 4) - 1 |
    1 << (typeNameToTypeValue['main_frame'] >>> 4) - 1 |
    1 << (typeNameToTypeValue['inline-font'] >>> 4) - 1 |
    1 << (typeNameToTypeValue['inline-script'] >>> 4) - 1;

const unsupportedTypeBit =
    1 << (typeNameToTypeValue['unsupported'] >>> 4) - 1;

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
    10: 'ping',
    11: 'other',
    12: 'popup',
    13: 'popunder',
    14: 'document',
    15: 'generichide',
    16: 'specifichide',
    17: 'inline-font',
    18: 'inline-script',
    19: 'data',
    20: 'redirect',
    21: 'webrtc',
    22: 'unsupported',
};

// https://github.com/gorhill/uBlock/issues/1493
//   Transpose `ping` into `other` for now.
const toNormalizedType = {
               'all': 'all',
            'beacon': 'ping',
               'css': 'stylesheet',
              'data': 'data',
               'doc': 'main_frame',
          'document': 'main_frame',
              'font': 'font',
             'frame': 'sub_frame',
      'genericblock': 'unsupported',
       'generichide': 'generichide',
             'ghide': 'generichide',
             'image': 'image',
       'inline-font': 'inline-font',
     'inline-script': 'inline-script',
             'media': 'media',
            'object': 'object',
 'object-subrequest': 'object',
             'other': 'other',
              'ping': 'ping',
          'popunder': 'popunder',
             'popup': 'popup',
            'script': 'script',
      'specifichide': 'specifichide',
             'shide': 'specifichide',
        'stylesheet': 'stylesheet',
       'subdocument': 'sub_frame',
               'xhr': 'xmlhttprequest',
    'xmlhttprequest': 'xmlhttprequest',
            'webrtc': 'unsupported',
         'websocket': 'websocket',
};

const BlockImportant = BlockAction | Important;

const reIsWildcarded = /[\^\*]/;

// ABP filters: https://adblockplus.org/en/filters
// regex tester: http://regex101.com/

/******************************************************************************/

// See the following as short-lived registers, used during evaluation. They are
// valid until the next evaluation.

let $requestURL = '';
let $requestHostname = '';
let $docHostname = '';

/******************************************************************************/

// First character of match must be within the hostname part of the url.
//
// https://github.com/gorhill/uBlock/issues/1929
//   Match only hostname label boundaries.

const isHnAnchored = (( ) => {
    let lastLen = 0, lastBeg = -1, lastEnd = -1;

    return (url, matchStart) => {
        const len = $requestHostname.length;
        if ( len !== lastLen || url.endsWith('://', lastBeg) === false ) {
            lastBeg = len !== 0 ? url.indexOf('://') : -1;
            if ( lastBeg !== -1 ) {
                lastBeg += 3;
                lastEnd = lastBeg + len;
            } else {
                lastEnd = -1;
            }
            lastLen = len;
        }
        return matchStart < lastEnd && (
            matchStart === lastBeg ||
            matchStart > lastBeg &&
                url.charCodeAt(matchStart - 1) === 0x2E /* '.' */
        );
    };
})();

/******************************************************************************/

// Local helpers

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
    const logData = filter.logData();
    logData.compiled = filterDataSerialize([
        categoryBits,
        tokenHash,
        logData.compiled
    ]);
    if ( categoryBits & 0x001 ) {
        logData.raw = `@@${logData.raw}`;
    }
    const opts = [];
    if ( categoryBits & 0x002 ) {
        opts.push('important');
    }
    if ( categoryBits & 0x008 ) {
        opts.push('3p');
    } else if ( categoryBits & 0x004 ) {
        opts.push('1p');
    }
    const type = categoryBits & 0x1F0;
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

/*******************************************************************************

    Each filter class will register itself in the map. A filter class
    id MUST always stringify to ONE single character.

    IMPORTANT: any change which modifies the mapping will have to be
    reflected with µBlock.systemSettings.compiledMagic.

*/

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

const FilterTrue = class {
    match() {
        return true;
    }

    logData() {
        return {
            raw: '*',
            regex: '^',
            compiled: this.compile(),
        };
    }

    compile() {
        return [ this.fid ];
    }

    static compile() {
        return [ FilterTrue.fid ];
    }

    static load() {
        return FilterTrue.instance;
    }
};

FilterTrue.instance = new FilterTrue();

registerFilterClass(FilterTrue);

/******************************************************************************/

const FilterPlain = class {
    constructor(s) {
        this.s = s;
    }

    match(url, tokenBeg) {
        return url.startsWith(this.s, tokenBeg);
    }

    logData() {
        return {
            raw: rawToPlainStr(this.s, 0),
            regex: rawToRegexStr(this.s, 0),
            compiled: this.compile()
        };
    }

    compile() {
        return [ this.fid, this.s, this.tokenBeg ];
    }

    addToTrie(trie) {
        if ( this.s.length > 255 ) { return false; }
        trie.add(this.s, this.tokenBeg);
        return true;
    }

    static compile(details) {
        return [ FilterPlain.fid, details.f, details.tokenBeg ];
    }

    static load(args) {
        if ( args[2] === 0 ) {
            return new FilterPlain(args[1]);
        }
        if ( args[2] === 1 ) {
            return new FilterPlain1(args[1]);
        }
        return new FilterPlainX(args[1], args[2]);
    }

    static addToTrie(args, trie) {
        if ( args[1].length > 255 ) { return false; }
        trie.add(args[1], args[2]);
        return true;
    }
};

FilterPlain.trieableId = 0;
FilterPlain.prototype.trieableId = FilterPlain.trieableId;
FilterPlain.prototype.tokenBeg = 0;

registerFilterClass(FilterPlain);


const FilterPlain1 = class extends FilterPlain {
    match(url, tokenBeg) {
        return url.startsWith(this.s, tokenBeg - 1);
    }
};

FilterPlain1.prototype.tokenBeg = 1;


const FilterPlainX = class extends FilterPlain {
    constructor(s, tokenBeg) {
        super(s);
        this.tokenBeg = tokenBeg;
    }

    match(url, tokenBeg) {
        return url.startsWith(this.s, tokenBeg - this.tokenBeg);
    }
};

/******************************************************************************/

const FilterPlainHostname = class {
    constructor(s) {
        this.s = s;
    }

    match() {
        const haystack = $requestHostname;
        const needle = this.s;
        if ( haystack.endsWith(needle) === false ) { return false; }
        const offset = haystack.length - needle.length;
        return offset === 0 || haystack.charCodeAt(offset - 1) === 0x2E /* '.' */;
    }

    logData() {
        return {
            raw: `||${this.s}^`,
            regex: rawToRegexStr(`${this.s}^`, 0),
            compiled: this.compile()
        };
    }

    compile() {
        return [ this.fid, this.s ];
    }

    static compile(details) {
        return [ FilterPlainHostname.fid, details.f ];
    }

    static load(args) {
        return new FilterPlainHostname(args[1]);
    }
};

registerFilterClass(FilterPlainHostname);

/******************************************************************************/

const FilterPlainLeftAnchored = class {
    constructor(s) {
        this.s = s;
    }

    match(url) {
        return url.startsWith(this.s);
    }

    logData() {
        return {
            raw: `|${this.s}`,
            regex: rawToRegexStr(this.s, 0b010),
            compiled: this.compile()
        };
    }

    compile() {
        return [ this.fid, this.s ];
    }

    static compile(details) {
        return [ FilterPlainLeftAnchored.fid, details.f ];
    }

    static load(args) {
        return new FilterPlainLeftAnchored(args[1]);
    }
};

registerFilterClass(FilterPlainLeftAnchored);

/******************************************************************************/

const FilterPlainRightAnchored = class {
    constructor(s) {
        this.s = s;
    }

    match(url) {
        return url.endsWith(this.s);
    }

    logData() {
        return {
            raw: `${this.s}|`,
            regex: rawToRegexStr(this.s, 0b001),
            compiled: this.compile()
        };
    }

    compile() {
        return [ this.fid, this.s ];
    }

    static compile(details) {
        return [ FilterPlainRightAnchored.fid, details.f ];
    }

    static load(args) {
        return new FilterPlainRightAnchored(args[1]);
    }
};

registerFilterClass(FilterPlainRightAnchored);

/******************************************************************************/

const FilterExactMatch = class {
    constructor(s) {
        this.s = s;
    }

    match(url) {
        return url === this.s;
    }

    logData() {
        return {
            raw: `|${this.s}|`,
            regex: rawToRegexStr(this.s, 0b011),
            compiled: this.compile()
        };
    }

    compile() {
        return [ this.fid, this.s ];
    }

    static compile(details) {
        return [ FilterExactMatch.fid, details.f ];
    }

    static load(args) {
        return new FilterExactMatch(args[1]);
    }
};

registerFilterClass(FilterExactMatch);

/******************************************************************************/

const FilterPlainHnAnchored = class {
    constructor(s) {
        this.s = s;
    }

    match(url, tokenBeg) {
        return url.startsWith(this.s, tokenBeg) &&
               isHnAnchored(url, tokenBeg);
    }

    logData() {
        return {
            raw: `||${this.s}`,
            regex: rawToRegexStr(this.s, this.tokenBeg),
            compiled: this.compile()
        };
    }

    compile() {
        return [ this.fid, this.s, this.tokenBeg ];
    }

    addToTrie(trie) {
        if ( this.s.length > 255 ) { return false; }
        trie.add(this.s, this.tokenBeg);
        return true;
    }

    static compile(details) {
        return [ FilterPlainHnAnchored.fid, details.f, details.tokenBeg ];
    }

    static load(args) {
        if ( args[2] === 0 ) {
            return new FilterPlainHnAnchored(args[1]);
        }
        return new FilterPlainHnAnchoredX(args[1], args[2]);
    }

    static addToTrie(args, trie) {
        if ( args[1].length > 255 ) { return false; }
        trie.add(args[1], args[2]);
        return true;
    }
};

FilterPlainHnAnchored.trieableId = 1;
FilterPlainHnAnchored.prototype.trieableId = FilterPlainHnAnchored.trieableId;
FilterPlainHnAnchored.prototype.tokenBeg = 0;

registerFilterClass(FilterPlainHnAnchored);


const FilterPlainHnAnchoredX = class extends FilterPlainHnAnchored {
    constructor(s, tokenBeg) {
        super(s);
        this.tokenBeg = tokenBeg;
    }

    match(url, tokenBeg) {
        const beg = tokenBeg - this.tokenBeg;
        return url.startsWith(this.s, beg) && isHnAnchored(url, beg);
    }
};

/*******************************************************************************

    Filters with only one single occurrence of wildcard `*`

*/

const FilterWildcard1 = class {
    constructor(s0, s1, tokenBeg) {
        this.s0 = s0;
        this.s1 = s1;
        this.tokenBeg = tokenBeg;
    }

    match(url, tokenBeg) {
        if ( this.tokenBeg >= 0 ) {
            const s0Beg = tokenBeg - this.tokenBeg;
            return s0Beg >= 0 &&
                   url.startsWith(this.s0, s0Beg) &&
                   url.indexOf(this.s1, s0Beg + this.s0.length) !== -1;
        }
        const s1Beg = tokenBeg + this.tokenBeg;
        return s1Beg > 0 &&
               url.startsWith(this.s1, s1Beg) &&
               url.lastIndexOf(this.s0, s1Beg) !== -1;
    }

    logData() {
        return {
            raw: `${this.s0}*${this.s1}`,
            regex: rawToRegexStr(`${this.s0}*${this.s1}`, 0),
            compiled: this.compile()
        };
    }

    compile() {
        return [ this.fid, this.s0, this.s1, this.tokenBeg ];
    }

    static compile(details) {
        if ( details.token === '*' ) { return; }
        if ( details.anchor !== 0 ) { return; }
        const s = details.f;
        let pos = s.indexOf('*');
        if ( pos === -1 ) { return; }
        if ( reIsWildcarded.test(s.slice(pos + 1)) ) { return; }
        if ( reIsWildcarded.test(s.slice(0, pos)) ) { return; }
        return [
            FilterWildcard1.fid,
            s.slice(0, pos),
            s.slice(pos + 1),
            details.tokenBeg < pos
                ? details.tokenBeg
                : pos + 1 - details.tokenBeg,
        ];
    }

    static load(args) {
        return new FilterWildcard1(args[1], args[2], args[3]);
    }
};

registerFilterClass(FilterWildcard1);

/******************************************************************************/

const FilterGeneric = class {
    constructor(s, anchor) {
        this.s = s;
        this.anchor = anchor;
    }

    match(url) {
        if ( this.re === null ) {
            this.re = new RegExp(rawToRegexStr(this.s, this.anchor));
        }
        return this.re.test(url);
    }

    logData() {
        const out = {
            raw: rawToPlainStr(this.s, this.anchor),
            regex: this.re.source,
            compiled: this.compile()
        };
        if ( this.anchor & 0x2 ) {
            out.raw = `|${out.raw}`;
        }
        if ( this.anchor & 0x1 ) {
            out.raw += '|';
        }
        return out;
    }

    compile() {
        return [ this.fid, this.s, this.anchor ];
    }

    static compile(details) {
        const compiled = FilterWildcard1.compile(details);
        if ( compiled !== undefined ) { return compiled; }
        return [ FilterGeneric.fid, details.f, details.anchor ];
    }

    static load(args) {
        return new FilterGeneric(args[1], args[2]);
    }
};

FilterGeneric.prototype.re = null;

registerFilterClass(FilterGeneric);

/*******************************************************************************

    Hostname-anchored filters with only one occurrence of wildcard `*`

*/

const FilterWildcard1HnAnchored = class {
    constructor(s0, s1, tokenBeg) {
        this.s0 = s0;
        this.s1 = s1;
        this.tokenBeg = tokenBeg;
    }

    match(url, tokenBeg) {
        if ( this.tokenBeg >= 0 ) {
            const s0Beg = tokenBeg - this.tokenBeg;
            return s0Beg >= 0 &&
                   url.startsWith(this.s0, s0Beg) &&
                   isHnAnchored(url, s0Beg) &&
                   url.indexOf(this.s1, s0Beg + this.s0.length) !== -1;
        }
        const s1Beg = tokenBeg + this.tokenBeg;
        if ( s1Beg < 0 || url.startsWith(this.s1, s1Beg) === false ) {
            return false;
        }
        const s0Beg = url.lastIndexOf(this.s0, s1Beg);
        return s0Beg !== -1 && isHnAnchored(url, s0Beg);
    }

    logData() {
        return {
            raw: `||${this.s0}*${this.s1}`,
            regex: rawToRegexStr(`${this.s0}*${this.s1}`, 0),
            compiled: this.compile()
        };
    }

    compile() {
        return [ this.fid, this.s0, this.s1, this.tokenBeg ];
    }

    static compile(details) {
        if ( details.token === '*' ) { return; }
        if ( (details.anchor & 0x0b001) !== 0 ) { return; }
        const s = details.f;
        let pos = s.indexOf('*');
        if ( pos === -1 ) { return; }
        if ( reIsWildcarded.test(s.slice(pos + 1)) ) { return; }
        const needSeparator =
            pos !== 0 && s.charCodeAt(pos - 1) === 0x5E /* '^' */;
        if ( needSeparator ) { pos -= 1; }
        if ( reIsWildcarded.test(s.slice(0, pos)) ) { return; }
        if ( needSeparator ) {
            return FilterWildcard2HnAnchored.compile(details, pos);
        }
        return [
            FilterWildcard1HnAnchored.fid,
            s.slice(0, pos),
            s.slice(pos + 1),
            details.tokenBeg < pos
                ? details.tokenBeg
                : pos + 1 - details.tokenBeg,
        ];
    }

    static load(args) {
        return new FilterWildcard1HnAnchored(args[1], args[2], args[3]);
    }
};

registerFilterClass(FilterWildcard1HnAnchored);

/*******************************************************************************

    Hostname-anchored filters with one occurrence of the wildcard
    sequence `^*` and no other wildcard-equivalent character

*/

const FilterWildcard2HnAnchored = class {
    constructor(s0, s1, tokenBeg) {
        this.s0 = s0;
        this.s1 = s1;
        this.tokenBeg = tokenBeg;
    }

    match(url, tokenBeg) {
        let s0End, s1Beg;
        if ( this.tokenBeg >= 0 ) {
            const s0Beg = tokenBeg - this.tokenBeg;
            if ( s0Beg < 0 || url.startsWith(this.s0, s0Beg) === false ) {
                return false;
            }
            if ( isHnAnchored(url, s0Beg) === false ) { return false; }
            s0End = s0Beg + this.s0.length;
            s1Beg = url.indexOf(this.s1, s0End);
            if ( s1Beg === -1 ) { return false; }
        } else {
            s1Beg = tokenBeg + this.tokenBeg;
            if ( s1Beg < 0 || url.startsWith(this.s1, s1Beg) === false ) {
                return false;
            }
            const s0Beg = url.lastIndexOf(this.s0, s1Beg);
            if ( s0Beg === -1 || isHnAnchored(url, s0Beg) === false ) {
                return false;
            }
            s0End = s0Beg + this.s0.length;
        }
        return this.reSeparators.test(url.slice(s0End, s1Beg));
    }

    logData() {
        return {
            raw: `||${this.s0}^*${this.s1}`,
            regex: rawToRegexStr(`${this.s0}^*${this.s1}`, 0),
            compiled: this.compile()
        };
    }

    compile() {
        return [ this.fid, this.s0, this.s1, this.tokenBeg ];
    }

    static compile(details, pos) {
        return [
            FilterWildcard2HnAnchored.fid,
            details.f.slice(0, pos),
            details.f.slice(pos + 2),
            details.tokenBeg < pos
                ? details.tokenBeg
                : pos + 2 - details.tokenBeg,
        ];
    }

    static load(args) {
        return new FilterWildcard2HnAnchored(args[1], args[2], args[3]);
    }
};

FilterWildcard2HnAnchored.prototype.reSeparators = /[^\w%.-]/;

registerFilterClass(FilterWildcard2HnAnchored);

/******************************************************************************/

const FilterGenericHnAnchored = class {
    constructor(s) {
        this.s = s;
    }

    match(url) {
        if ( this.re === null ) {
            this.re = new RegExp(rawToRegexStr(this.s, this.anchor));
        }
        return this.re.test(url);
    }

    logData() {
        return {
            raw: `||${this.s}`,
            regex: rawToRegexStr(this.s, this.anchor & 0b001),
            compiled: this.compile()
        };
    }

    compile() {
        return [ this.fid, this.s ];
    }

    static compile(details) {
        const compiled = FilterWildcard1HnAnchored.compile(details);
        if ( compiled !== undefined ) { return compiled; }
        return [ FilterGenericHnAnchored.fid, details.f ];
    }

    static load(args) {
        return new FilterGenericHnAnchored(args[1]);
    }
};

FilterGenericHnAnchored.prototype.re = null;
FilterGenericHnAnchored.prototype.anchor = 0x4;

registerFilterClass(FilterGenericHnAnchored);

/******************************************************************************/

const FilterGenericHnAndRightAnchored = class extends FilterGenericHnAnchored {
    logData() {
        const out = super.logData();
        out.raw += '|';
        return out;
    }

    static compile(details) {
        return [ FilterGenericHnAndRightAnchored.fid, details.f ];
    }

    static load(args) {
        return new FilterGenericHnAndRightAnchored(args[1]);
    }
};

FilterGenericHnAndRightAnchored.prototype.anchor = 0x5;

registerFilterClass(FilterGenericHnAndRightAnchored);

/******************************************************************************/

const FilterRegex = class {
    constructor(s) {
        this.re = s;
    }

    match(url) {
        if ( typeof this.re === 'string' ) {
            this.re = new RegExp(this.re, 'i');
        }
        return this.re.test(url);
    }

    logData() {
        const s = typeof this.re === 'string' ? this.re : this.re.source;
        return {
            raw: `/${s}/`,
            regex: s,
            compiled: this.compile()
        };
    }

    compile() {
        return [
            this.fid,
            typeof this.re === 'string' ? this.re : this.re.source
        ];
    }

    static compile(details) {
        return [ FilterRegex.fid, details.f ];
    }

    static load(args) {
        return new FilterRegex(args[1]);
    }
};

registerFilterClass(FilterRegex);

/******************************************************************************/

// The optimal "class" is picked according to the content of the
// `domain=` filter option.

const filterOrigin = new (class {
    constructor() {
        let trieDetails;
        try {
            trieDetails = JSON.parse(
                vAPI.localStorage.getItem('FilterOrigin.trieDetails')
            );
        } catch(ex) {
        }
        this.trieContainer = new µBlock.HNTrieContainer(trieDetails);
        this.strSlots = [];
        this.strToSlotId = new Map();
        this.gcTimer = undefined;
    }

    compile(details, wrapped) {
        const domainOpt = details.domainOpt;
        // One hostname
        if ( domainOpt.indexOf('|') === -1 ) {
            if ( domainOpt.charCodeAt(0) === 0x7E /* '~' */ ) {
                return FilterOriginMiss.compile(domainOpt, wrapped);
            }
            return FilterOriginHit.compile(domainOpt, wrapped);
        }
        // Many hostnames.
        // Must be in set (none negated).
        if ( domainOpt.indexOf('~') === -1 ) {
            return FilterOriginHitSet.compile(domainOpt, wrapped);
        }
        // Must not be in set (all negated).
        const reAllNegated = /^~(?:[^|~]+\|~)+[^|~]+$/;
        if ( reAllNegated.test(domainOpt) ) {
            return FilterOriginMissSet.compile(domainOpt, wrapped);
        }
        // Must be in one set, but not in the other.
        return FilterOriginMixedSet.compile(domainOpt, wrapped);
    }

    slotIdFromStr(s) {
        let slotId = this.strToSlotId.get(s);
        if ( slotId !== undefined ) { return slotId; }
        slotId = this.strSlots.push(s) - 1;
        this.strToSlotId.set(s, slotId);
        if ( this.gcTimer !== undefined ) { return slotId; }
        this.gcTimer = self.requestIdleCallback(
            ( ) => {
                this.gcTimer = undefined;
                this.strToSlotId.clear();
            },
            { timeout: 5000 }
        );
        return slotId;
    }

    strFromSlotId(slotId) {
        return this.strSlots[slotId];
    }

    logData(out, domainOpt) {
        if ( out.opts !== undefined ) { out.opts += ','; }
        out.opts = `domain=${domainOpt}`;
        return out;
    }

    readyToUse() {
        return this.trieContainer.readyToUse();
    }

    reset() {
        this.trieContainer.reset();
        this.strSlots.length = 0;
        this.strToSlotId.clear();
    }

    optimize() {
        const trieDetails = this.trieContainer.optimize();
        vAPI.localStorage.setItem(
            'FilterOrigin.trieDetails',
            JSON.stringify(trieDetails)
        );
        this.strToSlotId.clear();
    }
})();

/******************************************************************************/

// Surprinsingly, first peeking and comparing only the first character using
// charCodeAt() does help a bit performance -- 3-6µs gain per request on
// average for Chromium 71 and Firefox 65 with default lists.
// A likely explanation is that most visits are a miss, and in such case
// calling charCodeAt() to bail out earlier is cheaper than calling endsWith().

const FilterOriginHit = class {
    constructor(hostname, wrapped) {
        this.hostname = hostname;
        this.wrapped = wrapped;
    }

    match(url, tokenBeg) {
        const haystack = $docHostname;
        const offset = haystack.length - this.hostname.length;
        if ( offset < 0 ) { return false; }
        if ( haystack.charCodeAt(offset) !== this.hostname.charCodeAt(0) ) {
            return false;
        }
        if ( haystack.endsWith(this.hostname) === false ) { return false; }
        if (
            offset !== 0 &&
            haystack.charCodeAt(offset-1) !== 0x2E /* '.' */
        ) {
            return false;
        }
        return this.wrapped.match(url, tokenBeg);
    }

    logData() {
        const out = this.wrapped.logData();
        out.compiled = [ this.fid, this.hostname, out.compiled ];
        return filterOrigin.logData(out, this.hostname);
    }

    compile(toSelfie = false) {
        return [ this.fid, this.hostname, this.wrapped.compile(toSelfie) ];
    }

    static compile(domainOpt, wrapped) {
        return [ FilterOriginHit.fid, domainOpt, wrapped ];
    }

    static load(args) {
        return new FilterOriginHit(
            args[1],
            filterFromCompiledData(args[2])
        );
    }
};

registerFilterClass(FilterOriginHit);

/******************************************************************************/

const FilterOriginMiss = class {
    constructor(hostname, wrapped) {
        this.hostname = hostname;
        this.wrapped = wrapped;
    }

    match(url, tokenBeg) {
        const haystack = $docHostname;
        if ( haystack.endsWith(this.hostname) ) {
            const offset = haystack.length - this.hostname.length;
            if (
                offset === 0 ||
                haystack.charCodeAt(offset-1) === 0x2E /* '.' */
            ) {
                return false;
            }
        }
        return this.wrapped.match(url, tokenBeg);
    }

    logData() {
        const out = this.wrapped.logData();
        out.compiled = [ this.fid, this.hostname, out.compiled ];
        return filterOrigin.logData(out, `~${this.hostname}`);
    }

    compile(toSelfie = false) {
        return [ this.fid, this.hostname, this.wrapped.compile(toSelfie) ];
    }

    static compile(domainOpt, wrapped) {
        return [ FilterOriginMiss.fid, domainOpt.slice(1), wrapped ];
    }

    static load(args) {
        return new FilterOriginMiss(
            args[1],
            filterFromCompiledData(args[2])
        );
    }
};

registerFilterClass(FilterOriginMiss);

/******************************************************************************/

const FilterOriginHitSet = class {
    constructor(domainOpt, wrapped, oneOf = null) {
        this.domainOpt = typeof domainOpt === 'number'
            ? domainOpt
            : filterOrigin.slotIdFromStr(domainOpt);
        this.wrapped = filterFromCompiledData(wrapped);
        this.oneOf = oneOf !== null
            ? filterOrigin.trieContainer.createOne(oneOf)
            : null;
    }

    match(url, tokenBeg) {
        if ( this.oneOf === null ) {
            this.oneOf = filterOrigin.trieContainer.fromIterable(
                filterOrigin.strFromSlotId(this.domainOpt).split('|')
            );
        }
        return this.oneOf.matches($docHostname) !== -1 &&
               this.wrapped.match(url, tokenBeg);
    }

    logData() {
        const out = this.wrapped.logData();
        const domainOpt = filterOrigin.strFromSlotId(this.domainOpt);
        out.compiled = [ this.fid, domainOpt, out.compiled ];
        return filterOrigin.logData(out, domainOpt);
    }

    compile(toSelfie = false) {
        const out = [
            this.fid,
            toSelfie
                ? this.domainOpt :
                filterOrigin.strFromSlotId(this.domainOpt),
            this.wrapped.compile(toSelfie),
        ];
        if ( this.oneOf !== null ) { 
            out.push(filterOrigin.trieContainer.compileOne(this.oneOf));
        }
        return out;
    }

    static compile(domainOpt, wrapped) {
        return [ FilterOriginHitSet.fid, domainOpt, wrapped ];
    }

    static load(args) {
        return new FilterOriginHitSet(...args.slice(1));
    }
};

registerFilterClass(FilterOriginHitSet);

/******************************************************************************/

const FilterOriginMissSet = class {
    constructor(domainOpt, wrapped, noneOf = null) {
        this.domainOpt = typeof domainOpt === 'number'
            ? domainOpt
            : filterOrigin.slotIdFromStr(domainOpt);
        this.wrapped = filterFromCompiledData(wrapped);
        this.noneOf = noneOf !== null
            ? filterOrigin.trieContainer.createOne(noneOf)
            : null;
    }

    match(url, tokenBeg) {
        if ( this.noneOf === null ) {
            this.noneOf = filterOrigin.trieContainer.fromIterable(
                filterOrigin
                    .strFromSlotId(this.domainOpt)
                    .replace(/~/g, '')
                    .split('|')
            );
        }
        return this.noneOf.matches($docHostname) === -1 &&
               this.wrapped.match(url, tokenBeg);
    }

    logData() {
        const out = this.wrapped.logData();
        const domainOpt = filterOrigin.strFromSlotId(this.domainOpt);
        out.compiled = [ this.fid, domainOpt, out.compiled ];
        return filterOrigin.logData(out, domainOpt);
    }

    compile(toSelfie = false) {
        const out = [
            this.fid,
            toSelfie
                ? this.domainOpt
                : filterOrigin.strFromSlotId(this.domainOpt),
            this.wrapped.compile(toSelfie),
        ];
        if ( this.noneOf !== null ) {
            out.push(filterOrigin.trieContainer.compileOne(this.noneOf));
        }
        return out;
    }

    static compile(domainOpt, wrapped) {
        return [ FilterOriginMissSet.fid, domainOpt, wrapped ];
    }

    static load(args) {
        return new FilterOriginMissSet(...args.slice(1));
    }
};

registerFilterClass(FilterOriginMissSet);

/******************************************************************************/

const FilterOriginMixedSet = class {
    constructor(domainOpt, wrapped, oneOf = null, noneOf = null) {
        this.domainOpt = typeof domainOpt === 'number'
            ? domainOpt
            : filterOrigin.slotIdFromStr(domainOpt);
        this.wrapped = filterFromCompiledData(wrapped);
        this.oneOf = oneOf !== null
            ? filterOrigin.trieContainer.createOne(oneOf)
            : null;
        this.noneOf = noneOf !== null
            ? filterOrigin.trieContainer.createOne(noneOf)
            : null;
    }

    init() {
        const oneOf = [], noneOf = [];
        const domainOpt = filterOrigin.strFromSlotId(this.domainOpt);
        for ( const hostname of domainOpt.split('|') ) {
            if ( hostname.charCodeAt(0) === 0x7E /* '~' */ ) {
                noneOf.push(hostname.slice(1));
            } else {
                oneOf.push(hostname);
            }
        }
        this.oneOf = filterOrigin.trieContainer.fromIterable(oneOf);
        this.noneOf = filterOrigin.trieContainer.fromIterable(noneOf);
    }

    match(url, tokenBeg) {
        if ( this.oneOf === null ) { this.init(); }
        let needle = $docHostname;
        return this.oneOf.matches(needle) !== -1 &&
               this.noneOf.matches(needle) === -1 &&
               this.wrapped.match(url, tokenBeg);
    }

    logData() {
        const out = this.wrapped.logData();
        const domainOpt = filterOrigin.strFromSlotId(this.domainOpt);
        out.compiled = [ this.fid, domainOpt, out.compiled ];
        return filterOrigin.logData(out, domainOpt);
    }

    compile(toSelfie = false) {
        const out = [
            this.fid,
            toSelfie
                ? this.domainOpt
                : filterOrigin.strFromSlotId(this.domainOpt),
            this.wrapped.compile(toSelfie),
        ];
        if ( this.oneOf !== null ) {
            out.push(
                filterOrigin.trieContainer.compileOne(this.oneOf),
                filterOrigin.trieContainer.compileOne(this.noneOf)
            );
        }
        return out;
    }

    static compile(domainOpt, wrapped) {
        return [ FilterOriginMixedSet.fid, domainOpt, wrapped ];
    }

    static load(args) {
        return new FilterOriginMixedSet(...args.slice(1));
    }
};

registerFilterClass(FilterOriginMixedSet);

/******************************************************************************/

const FilterDataHolder = class {
    constructor(dataType, data) {
        this.dataType = dataType;
        this.data = data;
        this.wrapped = undefined;
    }

    match(url, tokenBeg) {
        return this.wrapped.match(url, tokenBeg);
    }

    matchAndFetchData(type, url, tokenBeg, out) {
        if ( this.dataType === type && this.match(url, tokenBeg) ) {
            out.push(this);
        }
    }

    logData() {
        const out = this.wrapped.logData();
        out.compiled = [ this.fid, this.dataType, this.data, out.compiled ];
        let opt = this.dataType;
        if ( this.data !== '' ) {
            opt += `=${this.data}`;
        }
        if ( out.opts === undefined ) {
            out.opts = opt;
        } else {
            out.opts = opt + ',' + out.opts;
        }
        return out;
    }

    compile(toSelfie = false) {
        return [
            this.fid,
            this.dataType,
            this.data,
            this.wrapped.compile(toSelfie)
        ];
    }

    static compile(details) {
        return [ FilterDataHolder.fid, details.dataType, details.data ];
    }

    static load(args) {
        const f = new FilterDataHolder(args[1], args[2]);
        f.wrapped = filterFromCompiledData(args[3]);
        return f;
    }
};

registerFilterClass(FilterDataHolder);

// Helper class for storing instances of FilterDataHolder which were found to
// be a match.

const FilterDataHolderResult = class {
    constructor(bits, th, f) {
        this.bits = bits;
        this.th = th;
        this.f = f;
    }

    get data() {
        return this.f.data;
    }

    get result() {
        return (this.bits & AllowAction) === 0 ? 1 : 2;
    }

    logData() {
        const r = toLogDataInternal(this.bits, this.th, this.f);
        r.source = 'static';
        r.result = this.result;
        return r;
    }
};

/******************************************************************************/

// Dictionary of hostnames

const FilterHostnameDict = class {
    constructor(args) {
        this.h = ''; // short-lived register
        this.dict = FilterHostnameDict.trieContainer.createOne(args);
    }

    get size() {
        return this.dict.size;
    }

    add(hn) {
        return this.dict.add(hn);
    }

    match() {
        const pos = this.dict.matches($requestHostname);
        if ( pos === -1 ) { return false; }
        this.h = $requestHostname.slice(pos);
        return true;
    }

    logData() {
        return {
            raw: `||${this.h}^`,
            regex: `${rawToRegexStr(this.h, 0)}(?:[^%.0-9a-z_-]|$)`,
            compiled: this.h
        };
    }

    compile() {
        return [ this.fid, FilterHostnameDict.trieContainer.compileOne(this.dict) ];
    }

    static readyToUse() {
        return FilterHostnameDict.trieContainer.readyToUse();
    }

    static reset() {
        return FilterHostnameDict.trieContainer.reset();
    }

    static optimize() {
        const trieDetails = FilterHostnameDict.trieContainer.optimize();
        vAPI.localStorage.setItem(
            'FilterHostnameDict.trieDetails',
            JSON.stringify(trieDetails)
        );
    }

    static load(args) {
        return new FilterHostnameDict(args[1]);
    }
};

FilterHostnameDict.trieContainer = (( ) => {
    let trieDetails;
    try {
        trieDetails = JSON.parse(
            vAPI.localStorage.getItem('FilterHostnameDict.trieDetails')
        );
    } catch(ex) {
    }
    return new µBlock.HNTrieContainer(trieDetails);
})();

registerFilterClass(FilterHostnameDict);

/******************************************************************************/

// Dictionary of hostnames for filters which only purpose is to match
// the document origin.

const FilterJustOrigin = class {
    constructor(args) {
        this.h = ''; // short-lived register
        this.dict = filterOrigin.trieContainer.createOne(args);
    }

    get size() {
        return this.dict.size;
    }

    add(hn) {
        return this.dict.add(hn);
    }

    match() {
        const pos = this.dict.matches($docHostname);
        if ( pos === -1 ) { return false; }
        this.h = $docHostname.slice(pos);
        return true;
    }

    logData() {
        return {
            raw: '*',
            regex: '^',
            compiled: this.h,
            opts: `domain=${this.h}`,
        };
    }

    compile() {
        return [ this.fid, filterOrigin.trieContainer.compileOne(this.dict) ];
    }

    static load(args) {
        return new FilterJustOrigin(args[1]);
    }
};

registerFilterClass(FilterJustOrigin);

/******************************************************************************/

const FilterHTTPSJustOrigin = class extends FilterJustOrigin {
    match(url) {
        return url.startsWith('https://') && super.match();
    }

    logData() {
        const out = super.logData();
        out.raw = '|https://';
        out.regex = '^https://';
        return out;
    }

    static load(args) {
        return new FilterHTTPSJustOrigin(args[1]);
    }
};

registerFilterClass(FilterHTTPSJustOrigin);

/******************************************************************************/

const FilterHTTPJustOrigin = class extends FilterJustOrigin {
    match(url) {
        return url.startsWith('http://') && super.match();
    }

    logData() {
        const out = super.logData();
        out.raw = '|https://';
        out.regex = '^https://';
        return out;
    }

    static load(args) {
        return new FilterHTTPJustOrigin(args[1]);
    }
};

registerFilterClass(FilterHTTPJustOrigin);

/******************************************************************************/

const FilterPair = class {
    constructor(a, b) {
        this.f1 = a;
        this.f2 = b;
    }

    get size() {
        return 2;
    }

    match(url, tokenBeg) {
        if ( this.f1.match(url, tokenBeg) === true ) {
            this.f = this.f1;
            return true;
        }
        if ( this.f2.match(url, tokenBeg) === true ) {
            this.f = this.f2;
            return true;
        }
        return false;
    }

    matchAndFetchData(type, url, tokenBeg, out) {
        this.f1.matchAndFetchData(type, url, tokenBeg, out);
        this.f2.matchAndFetchData(type, url, tokenBeg, out);
    }

    logData() {
        return this.f.logData();
    }

    compile(toSelfie = false) {
        return [
            this.fid,
            this.f1.compile(toSelfie),
            this.f2.compile(toSelfie)
        ];
    }

    upgrade(a) {
        const bucket = new FilterBucket(this.f1, this.f2, a);
        this.f1 = this.f2 = undefined;
        this.f = null;
        FilterPair.available = this;
        return bucket;
    }

    static load(args) {
        const f1 = filterFromCompiledData(args[1]);
        const f2 = filterFromCompiledData(args[2]);
        const pair = FilterPair.available;
        if ( pair === null ) {
            return new FilterPair(f1, f2);
        }
        FilterPair.available = null;
        pair.f1 = f1;
        pair.f2 = f2;
        return pair;
    }
};

FilterPair.prototype.f = null;

FilterPair.available = null;

registerFilterClass(FilterPair);

/******************************************************************************/

const FilterBucket = class {
    constructor(a, b, c) {
        this.filters = [];
        if ( a !== undefined ) {
            this.filters.push(a, b, c);
            this._countTrieable();
        }
        this.trieResult = 0;
    }

    get size() {
        let size = this.filters.length;
        if ( this.plainTrie !== null ) {
            size += this.plainTrie.size;
        }
        if ( this.plainHnAnchoredTrie !== null ) {
            size += this.plainHnAnchoredTrie.size;
        }
        return size;
    }

    add(fdata) {
        const fclass = filterClasses[fdata[0]];
        if ( fclass.trieableId === 0 ) {
            if ( this.plainTrie !== null ) {
                if ( fclass.addToTrie(fdata, this.plainTrie) ) { return; }
            } else if ( this.plainCount < 3 ) {
                this.plainCount += 1;
            } else {
                this.plainTrie = FilterBucket.trieContainer.createOne();
                this._transferTrieable(0, this.plainTrie);
                if ( fclass.addToTrie(fdata, this.plainTrie) ) { return; }
            }
        } else if ( fclass.trieableId === 1 ) {
            if ( this.plainHnAnchoredTrie !== null ) {
                if ( fclass.addToTrie(fdata, this.plainHnAnchoredTrie) ) { return; }
            } else if ( this.plainHnAnchoredCount < 3 ) {
                this.plainHnAnchoredCount += 1;
            } else {
                this.plainHnAnchoredTrie = FilterBucket.trieContainer.createOne();
                this._transferTrieable(1, this.plainHnAnchoredTrie);
                if ( fclass.addToTrie(fdata, this.plainHnAnchoredTrie) ) { return; }
            }
        }
        this.filters.push(filterFromCompiledData(fdata));
    }

    match(url, tokenBeg) {
        if ( this.plainTrie !== null ) {
            const pos = this.plainTrie.matches(url, tokenBeg);
            if ( pos !== -1 ) {
                this.trieResult = pos;
                this.f = this.plainFilter;
                this.f.tokenBeg = tokenBeg - (pos >>> 16);
                return true;
            }
        }
        if ( this.plainHnAnchoredTrie !== null ) {
            const pos = this.plainHnAnchoredTrie.matches(url, tokenBeg);
            if ( pos !== -1 && isHnAnchored(url, pos >>> 16) ) {
                this.trieResult = pos;
                this.f = this.plainHnAnchoredFilter;
                this.f.tokenBeg = tokenBeg - (pos >>> 16);
                return true;
            }
        }
        const filters = this.filters;
        for ( let i = 0, n = filters.length; i < n; i++ ) {
            if ( filters[i].match(url, tokenBeg) === true ) {
                this.f = filters[i];
                if ( i >= 16 ) { this._promote(i); }
                return true;
            }
        }
        return false;
    }

    matchAndFetchData(type, url, tokenBeg, out) {
        for ( const f of this.filters ) {
            f.matchAndFetchData(type, url, tokenBeg, out);
        }
    }

    logData() {
        if (
            this.f === this.plainFilter ||
            this.f === this.plainHnAnchoredFilter
        ) {
            this.f.s = $requestURL.slice(
                this.trieResult >>> 16,
                this.trieResult & 0xFFFF
            );
        }
        return this.f.logData();
    }

    compile(toSelfie = false) {
        return [
            this.fid,
            this.filters.map(filter => filter.compile(toSelfie)),
            this.plainTrie !== null &&
                FilterBucket.trieContainer.compileOne(this.plainTrie),
            this.plainHnAnchoredTrie !== null &&
                FilterBucket.trieContainer.compileOne(this.plainHnAnchoredTrie),
        ];
    }

    _countTrieable() {
        for ( const f of this.filters ) {
            if ( f.trieableId === 0 ) {
                this.plainCount += 1;
            } else if ( f.trieableId === 1 ) {
                this.plainHnAnchoredCount += 1;
            }
        }
    }

    _transferTrieable(trieableId, trie) {
        const filters = this.filters;
        let i = filters.length;
        while ( i-- ) {
            const f = filters[i];
            if ( f.trieableId !== trieableId ) { continue; }
            if ( f.addToTrie(trie) === false ) { continue; }
            filters.splice(i, 1);
        }
    }

    // Promote hit filters so they can be found faster next time.
    _promote(i) {
        const filters = this.filters;
        let pivot = filters.length >>> 1;
        while ( i < pivot ) {
            pivot >>>= 1;
            if ( pivot < 16 ) { break; }
        }
        if ( i <= pivot ) { return; }
        const j = this.promoted % pivot;
        //console.debug('FilterBucket.promote(): promoted %d to %d', i, j);
        const f = filters[j];
        filters[j] = filters[i];
        filters[i] = f;
        this.promoted += 1;
    }

    static reset() {
        FilterBucket.trieContainer.reset();
    }

    static optimize() {
        const trieDetails = FilterBucket.trieContainer.optimize();
        vAPI.localStorage.setItem(
            'FilterBucket.trieDetails',
            JSON.stringify(trieDetails)
        );
    }

    static load(args) {
        const bucket = new FilterBucket();
        bucket.filters = args[1].map(data => filterFromCompiledData(data));
        if ( Array.isArray(args[2]) ) {
            bucket.plainTrie =
                FilterBucket.trieContainer.createOne(args[2]);
        }
        if ( Array.isArray(args[3]) ) {
            bucket.plainHnAnchoredTrie =
                FilterBucket.trieContainer.createOne(args[3]);
        }
        return bucket;
    }
};

FilterBucket.prototype.f = null;
FilterBucket.prototype.promoted = 0;

FilterBucket.prototype.plainCount = 0;
FilterBucket.prototype.plainTrie = null;
FilterBucket.prototype.plainFilter = new FilterPlainX('', 0);

FilterBucket.prototype.plainHnAnchoredCount = 0;
FilterBucket.prototype.plainHnAnchoredTrie = null;
FilterBucket.prototype.plainHnAnchoredFilter = new FilterPlainHnAnchoredX('', 0);

FilterBucket.trieContainer = (( ) => {
    let trieDetails;
    try {
        trieDetails = JSON.parse(
            vAPI.localStorage.getItem('FilterBucket.trieDetails')
        );
    } catch(ex) {
    }
    return new µBlock.BidiTrieContainer(trieDetails);
})();

registerFilterClass(FilterBucket);

/******************************************************************************/
/******************************************************************************/

const FilterParser = function() {
    this.cantWebsocket = vAPI.cantWebsocket;
    this.reBadDomainOptChars = /[*+?^${}()[\]\\]/;
    this.reHostnameRule1 = /^\w[\w.-]*[a-z]$/i;
    this.reHostnameRule2 = /^\w[\w.-]*[a-z]\^?$/i;
    this.reCanTrimCarets1 = /^[^*]*$/;
    this.reCanTrimCarets2 = /^\^?[^^]+[^^][^^]+\^?$/;
    this.reIsolateHostname = /^(\*?\.)?([^\x00-\x24\x26-\x2C\x2F\x3A-\x5E\x60\x7B-\x7F]+)(.*)/;
    this.reHasUnicode = /[^\x00-\x7F]/;
    this.reWebsocketAny = /^ws[s*]?(?::\/?\/?)?\*?$/;
    this.reBadCSP = /(?:^|;)\s*report-(?:to|uri)\b/;
    this.domainOpt = '';
    this.noTokenHash = µb.urlTokenizer.noTokenHash;
    this.reset();
};

/******************************************************************************/

FilterParser.prototype.reset = function() {
    this.action = BlockAction;
    this.anchor = 0;
    this.badFilter = false;
    this.dataType = undefined;
    this.data = undefined;
    this.elemHiding = false;
    this.f = '';
    this.firstParty = false;
    this.thirdParty = false;
    this.party = AnyParty;
    this.fopts = '';
    this.domainOpt = '';
    this.isPureHostname = false;
    this.isRegex = false;
    this.raw = '';
    this.redirect = 0;
    this.token = '*';
    this.tokenHash = this.noTokenHash;
    this.tokenBeg = 0;
    this.types = 0;
    this.notTypes = 0;
    this.important = 0;
    this.wildcarded = false;
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
    const typeBit = raw !== 'all'
        ? this.bitFromType(toNormalizedType[raw])
        : allTypesBits;

    if ( not ) {
        this.notTypes |= typeBit;
    } else {
        this.types |= typeBit;
    }
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
        const hostnames = s.split('|');
        let i = hostnames.length;
        while ( i-- ) {
            if ( this.reHasUnicode.test(hostnames[i]) ) {
                hostnames[i] = punycode.toASCII(hostnames[i]);
            }
        }
        s = hostnames.join('|');
    }
    if ( this.reBadDomainOptChars.test(s) ) { return ''; }
    return s;
};

/******************************************************************************/

FilterParser.prototype.parseOptions = function(s) {
    this.fopts = s;
    for ( let opt of s.split(/\s*,\s*/) ) {
        const not = opt.startsWith('~');
        if ( not ) {
            opt = opt.slice(1);
        }
        if ( opt === 'third-party' || opt === '3p' ) {
            this.parsePartyOption(false, not);
            continue;
        }
        if ( opt === 'first-party' || opt === '1p' ) {
            this.parsePartyOption(true, not);
            continue;
        }
        if ( toNormalizedType.hasOwnProperty(opt) ) {
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
        if ( /^redirect(?:-rule)?=/.test(opt) ) {
            if ( this.redirect !== 0 ) {
                this.unsupported = true;
                break;
            }
            this.redirect = opt.charCodeAt(8) === 0x3D /* '=' */ ? 1 : 2;
            continue;
        }
        if (
            opt.startsWith('csp=') &&
            opt.length > 4 &&
            this.reBadCSP.test(opt) === false
        ) {
            this.parseTypeOption('data', not);
            this.dataType = 'csp';
            this.data = opt.slice(4).trim();
            continue;
        }
        if ( opt === 'csp' && this.action === AllowAction ) {
            this.parseTypeOption('data', not);
            this.dataType = 'csp';
            this.data = '';
            continue;
        }
        // Used by Adguard:
        // https://kb.adguard.com/en/general/how-to-create-your-own-ad-filters?aid=16593#empty-modifier
        if ( opt === 'empty' || opt === 'mp4' ) {
            if ( this.redirect !== 0 ) {
                this.unsupported = true;
                break;
            }
            this.redirect = 1;
            continue;
        }
        // https://github.com/uBlockOrigin/uAssets/issues/192
        if ( opt === 'badfilter' ) {
            this.badFilter = true;
            continue;
        }
        // https://www.reddit.com/r/uBlockOrigin/comments/d6vxzj/
        //   Add support for `elemhide`. Rarely used but it happens.
        if ( opt === 'elemhide' || opt === 'ehide' ) {
            this.parseTypeOption('specifichide', not);
            this.parseTypeOption('generichide', not);
            continue;
        }
        // Unrecognized filter option: ignore whole filter.
        this.unsupported = true;
        break;
    }

    // Redirect rules can't be exception filters.
    if ( this.redirect !== 0 && this.action !== BlockAction ) {
        this.unsupported = true;
    }

    // Negated network types? Toggle on all network type bits.
    // Negated non-network types can only toggle themselves.
    if ( (this.notTypes & allNetworkTypesBits) !== 0 ) {
        this.types |= allNetworkTypesBits;
    }
    if ( this.notTypes !== 0 ) {
        this.types &= ~this.notTypes;
        if ( this.types === 0 ) {
            this.unsupported = true;
        }
    }

    // https://github.com/gorhill/uBlock/issues/2283
    //   Abort if type is only for unsupported types, otherwise
    //   toggle off `unsupported` bit.
    if ( this.types & unsupportedTypeBit ) {
        this.types &= ~unsupportedTypeBit;
        if ( this.types === 0 ) {
            this.unsupported = true;
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

    let s = this.raw = raw;

    // Filters which are a single alphanumeric character are discarded
    // as unsupported.
    if ( s.length === 1 && /[0-9a-z]/i.test(s) ) {
        this.unsupported = true;
        return this;
    }

    // plain hostname? (from HOSTS file)
    if ( this.reHostnameRule1.test(s) ) {
        this.f = s.toLowerCase();
        this.isPureHostname = true;
        this.anchor |= 0x4;
        return this;
    }

    // element hiding filter?
    let pos = s.indexOf('#');
    if ( pos !== -1 ) {
        const c = s.charAt(pos + 1);
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
            if ( this.unsupported ) { return this; }
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
            const matches = this.reIsolateHostname.exec(s);
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
            if ( s.charCodeAt(s.length - 1) === 0x5E /* '^' */ ) {
                s = s.slice(0, -1);
            }
            this.f = s.toLowerCase();
            this.isPureHostname = true;
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
    // TODO: remove once redirect rules with `*/*` pattern are no longer used.
    else if ( this.redirect !== 0 && s === '/' ) {
        s = '*';
    }

    // https://github.com/gorhill/uBlock/issues/1047
    // Hostname-anchored makes no sense if matching all requests.
    if ( s === '*' ) {
        this.anchor = 0;
    }

    this.wildcarded = reIsWildcarded.test(s);
    this.f = s.toLowerCase();

    return this;
};

/******************************************************************************/

// Given a string, find a good token. Tokens which are too generic, i.e. very
// common with a high probability of ending up as a miss, are not
// good. Avoid if possible. This has a *significant* positive impact on
// performance.
// These "bad tokens" are collated manually.

// Hostname-anchored with no wildcard always have a token index of 0.
const reGoodToken = /[%0-9a-z]{2,}/g;
const reRegexToken = /[%0-9A-Za-z]{2,}/g;
const reRegexTokenAbort = /[([]/;
const reRegexBadPrefix = /(^|[^\\]\.|[*?{}\\])$/;
const reRegexBadSuffix = /^([^\\]\.|\\[dw]|[([{}?*.]|$)/;

const badTokens = new Set([
    'com',
    'google',
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
    const s = this.f;
    let matches;
    let badTokenMatch = null;
    while ( (matches = reGoodToken.exec(s)) !== null ) {
        // https://github.com/gorhill/uBlock/issues/997
        // Ignore token if preceded by wildcard.
        const lpos = matches.index;
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
    const s = this.f;
    let matches;
    while ( (matches = reRegexToken.exec(s)) !== null ) {
        const prefix = s.slice(0, matches.index);
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

    let matches = this.findFirstGoodToken();
    if ( matches !== null ) {
        this.token = matches[0];
        this.tokenHash = µb.urlTokenizer.tokenHashFromString(this.token);
        this.tokenBeg = matches.index;
    }
};

/******************************************************************************/

FilterParser.prototype.isJustOrigin = function() {
    return this.dataType === undefined &&
           this.domainOpt !== '' &&
           /^(?:\*|http[s*]?:(?:\/\/)?)$/.test(this.f) &&
           this.domainOpt.indexOf('~') === -1;
};

/******************************************************************************/
/******************************************************************************/

const FilterContainer = function() {
    this.filterParser = new FilterParser();
    this.urlTokenizer = µb.urlTokenizer;
    this.noTokenHash = this.urlTokenizer.noTokenHash;
    this.dotTokenHash = this.urlTokenizer.dotTokenHash;
    this.anyTokenHash = this.urlTokenizer.anyTokenHash;
    this.anyHTTPSTokenHash = this.urlTokenizer.anyHTTPSTokenHash;
    this.anyHTTPTokenHash = this.urlTokenizer.anyHTTPTokenHash;
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
    this.urlTokenizer.resetKnownTokens();

    // This will invalidate all tries
    FilterHostnameDict.reset();
    filterOrigin.reset();
    FilterBucket.reset();

    // Runtime registers
    this.$catbits = 0;
    this.$tokenHash = 0;
    this.$filter = null;
};

/******************************************************************************/

FilterContainer.prototype.freeze = function() {
    const filterPairId = FilterPair.fid;
    const filterBucketId = FilterBucket.fid;
    const redirectTypeValue = typeNameToTypeValue.redirect;
    const unserialize = µb.CompiledLineIO.unserialize;

    for ( const line of this.goodFilters ) {
        if ( this.badFilters.has(line) ) {
            this.discardedCount += 1;
            continue;
        }

        const args = unserialize(line);
        const bits = args[0];

        // Special cases: delegate to more specialized engines.
        // Redirect engine.
        if ( (bits & 0x1F0) === redirectTypeValue ) {
            µb.redirectEngine.fromCompiledRule(args[1]);
            continue;
        }

        // Plain static filters.
        const tokenHash = args[1];
        const fdata = args[2];

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

        if ( tokenHash === this.anyTokenHash ) {
            if ( entry === undefined ) {
                entry = new FilterJustOrigin();
                bucket.set(this.anyTokenHash, entry);
            }
            entry.add(fdata);
            continue;
        }

        if ( tokenHash === this.anyHTTPSTokenHash ) {
            if ( entry === undefined ) {
                entry = new FilterHTTPSJustOrigin();
                bucket.set(this.anyHTTPSTokenHash, entry);
            }
            entry.add(fdata);
            continue;
        }

        if ( tokenHash === this.anyHTTPTokenHash ) {
            if ( entry === undefined ) {
                entry = new FilterHTTPJustOrigin();
                bucket.set(this.anyHTTPTokenHash, entry);
            }
            entry.add(fdata);
            continue;
        }

        this.urlTokenizer.addKnownToken(tokenHash);

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
    this.badFilters.clear();
    this.goodFilters.clear();
    FilterHostnameDict.optimize();
    FilterBucket.optimize();
    this.frozen = true;
};

/******************************************************************************/

// This is necessary for when the filtering engine readiness will depend
// on asynchronous operations (ex.: when loading a wasm module).

FilterContainer.prototype.readyToUse = function() {
    return Promise.resolve();
};

/******************************************************************************/

FilterContainer.prototype.toSelfie = function(path) {
    const categoriesToSelfie = function(categoryMap) {
        const selfie = [];
        for ( const [ catbits, bucket ] of categoryMap ) {
            const tokenEntries = [];
            for ( const [ token, filter ] of bucket ) {
                tokenEntries.push([ token, filter.compile(true) ]);
            }
            selfie.push([ catbits, tokenEntries ]);
        }
        return selfie;
    };

    filterOrigin.optimize();

    return Promise.all([
        µBlock.assets.put(
            `${path}/FilterHostnameDict.trieContainer`,
            FilterHostnameDict.trieContainer.serialize(µBlock.base64)
        ),
        µBlock.assets.put(
            `${path}/FilterOrigin.trieContainer`,
            filterOrigin.trieContainer.serialize(µBlock.base64)
        ),
        µBlock.assets.put(
            `${path}/FilterBucket.trieContainer`,
            FilterBucket.trieContainer.serialize(µBlock.base64)
        ),
        µBlock.assets.put(
            `${path}/main`,
            JSON.stringify({
                processedFilterCount: this.processedFilterCount,
                acceptedCount: this.acceptedCount,
                rejectedCount: this.rejectedCount,
                allowFilterCount: this.allowFilterCount,
                blockFilterCount: this.blockFilterCount,
                discardedCount: this.discardedCount,
                categories: categoriesToSelfie(this.categories),
                urlTokenizer: this.urlTokenizer.toSelfie(),
                filterOriginStrSlots: filterOrigin.strSlots,
            })
        )
    ]);
};

/******************************************************************************/

FilterContainer.prototype.fromSelfie = function(path) {
    return Promise.all([
        µBlock.assets.get(`${path}/FilterHostnameDict.trieContainer`).then(details =>
            FilterHostnameDict.trieContainer.unserialize(
                details.content,
                µBlock.base64
            )
        ),
        µBlock.assets.get(`${path}/FilterOrigin.trieContainer`).then(details =>
            filterOrigin.trieContainer.unserialize(
                details.content,
                µBlock.base64
            )
        ),
        µBlock.assets.get(`${path}/FilterBucket.trieContainer`).then(details =>
            FilterBucket.trieContainer.unserialize(
                details.content,
                µBlock.base64
            )
        ),
        µBlock.assets.get(`${path}/main`).then(details => {
            let selfie;
            try {
                selfie = JSON.parse(details.content);
            } catch (ex) {
            }
            if ( selfie instanceof Object === false ) { return false; }
            this.frozen = true;
            this.processedFilterCount = selfie.processedFilterCount;
            this.acceptedCount = selfie.acceptedCount;
            this.rejectedCount = selfie.rejectedCount;
            this.allowFilterCount = selfie.allowFilterCount;
            this.blockFilterCount = selfie.blockFilterCount;
            this.discardedCount = selfie.discardedCount;
            this.urlTokenizer.fromSelfie(selfie.urlTokenizer);
            filterOrigin.strSlots = selfie.filterOriginStrSlots;
            for ( const [ catbits, bucket ] of selfie.categories ) {
                const tokenMap = new Map();
                for ( const [ token, fdata ] of bucket ) {
                    tokenMap.set(token, filterFromCompiledData(fdata));
                }
                this.categories.set(catbits, tokenMap);
            }
            return true;
        }),
    ]).then(results =>
        results.reduce((acc, v) => acc && v, true)
    );
};

/******************************************************************************/

FilterContainer.prototype.compile = function(raw, writer) {
    // ORDER OF TESTS IS IMPORTANT!

    // Ignore empty lines
    const s = raw.trim();
    if ( s.length === 0 ) { return false; }

    const parsed = this.filterParser.parse(s);

    // Ignore element-hiding filters
    if ( parsed.elemHiding ) {
        return false;
    }

    // Ignore filters with unsupported options
    if ( parsed.unsupported ) {
        const who = writer.properties.get('assetKey') || '?';
        µb.logger.writeOne({
            realm: 'message',
            type: 'error',
            text: `Invalid network filter in ${who}: ${raw}`
        });
        return false;
    }

    // Redirect rule
    if ( parsed.redirect !== 0 ) {
        const result = this.compileRedirectRule(parsed, writer);
        if ( result === false ) {
            const who = writer.properties.get('assetKey') || '?';
            µb.logger.writeOne({
                realm: 'message',
                type: 'error',
                text: `Invalid redirect rule in ${who}: ${raw}`
            });
            return false;
        }
        if ( parsed.redirect === 2 ) {
            return true;
        }
    }

    // Pure hostnames, use more efficient dictionary lookup
    // https://github.com/chrisaljoudi/uBlock/issues/665
    // Create a dict keyed on request type etc.
    if (
        parsed.isPureHostname &&
        parsed.domainOpt === '' &&
        parsed.dataType === undefined
    ) {
        parsed.tokenHash = this.dotTokenHash;
        this.compileToAtomicFilter(parsed, parsed.f, writer);
        return true;
    }

    parsed.makeToken();

    let fdata;
    if ( parsed.isRegex ) {
        fdata = FilterRegex.compile(parsed);
    } else if ( parsed.isPureHostname ) {
        fdata = FilterPlainHostname.compile(parsed);
    } else if ( parsed.f === '*' ) {
        if ( parsed.isJustOrigin() ) {
            parsed.tokenHash = this.anyTokenHash;
            for ( const hn of parsed.domainOpt.split('|') ) {
                this.compileToAtomicFilter(parsed, hn, writer);
            }
            return true;
        }
        fdata = FilterTrue.compile();
    } else if ( parsed.anchor === 0x5 ) {
        fdata = FilterGenericHnAndRightAnchored.compile(parsed);
    } else if ( parsed.anchor === 0x4 ) {
        if (
            parsed.wildcarded === false &&
            parsed.tokenHash !== parsed.noTokenHash
        ) {
            fdata = FilterPlainHnAnchored.compile(parsed);
        } else {
            fdata = FilterGenericHnAnchored.compile(parsed);
        }
    } else if ( parsed.anchor === 0x2 && parsed.isJustOrigin() ) {
        const hostnames = parsed.domainOpt.split('|');
        const isHTTPS = parsed.f === 'https://' || parsed.f === 'http*://';
        const isHTTP = parsed.f === 'http://' || parsed.f === 'http*://';
        for ( const hn of hostnames ) {
            if ( isHTTPS ) {
                parsed.tokenHash = this.anyHTTPSTokenHash;
                this.compileToAtomicFilter(parsed, hn, writer);
            }
            if ( isHTTP ) {
                parsed.tokenHash = this.anyHTTPTokenHash;
                this.compileToAtomicFilter(parsed, hn, writer);
            }
        }
        return true;
    } else if ( parsed.wildcarded || parsed.tokenHash === parsed.noTokenHash ) {
        fdata = FilterGeneric.compile(parsed);
    } else if ( parsed.anchor === 0x2 ) {
        fdata = FilterPlainLeftAnchored.compile(parsed);
    } else if ( parsed.anchor === 0x1 ) {
        fdata = FilterPlainRightAnchored.compile(parsed);
    } else if ( parsed.anchor === 0x3 ) {
        fdata = FilterExactMatch.compile(parsed);
    } else {
        fdata = FilterPlain.compile(parsed);
    }

    if ( parsed.domainOpt !== '' ) {
        fdata = filterOrigin.compile(parsed, fdata);
    }

    if ( parsed.dataType !== undefined ) {
        let fwrapped = fdata;
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
    writer.select(parsed.badFilter ? 1 : 0);

    const descBits = parsed.action | parsed.important | parsed.party;
    let typeBits = parsed.types;

    // Typeless
    if ( typeBits === 0 ) {
        writer.push([ descBits, parsed.tokenHash, fdata ]);
        return;
    }

    // If all network types are set, create a typeless filter
    if ( (typeBits & allNetworkTypesBits) === allNetworkTypesBits ) {
        writer.push([ descBits, parsed.tokenHash, fdata ]);
        typeBits &= ~allNetworkTypesBits;
    }

    // One filter per specific types
    let bitOffset = 1;
    do {
        if ( typeBits & 1 ) {
            writer.push([ descBits | (bitOffset << 4), parsed.tokenHash, fdata ]);
        }
        bitOffset += 1;
        typeBits >>>= 1;
    } while ( typeBits !== 0 );
};

/******************************************************************************/

FilterContainer.prototype.compileRedirectRule = function(parsed, writer) {
    const redirects = µb.redirectEngine.compileRuleFromStaticFilter(parsed.raw);
    if ( Array.isArray(redirects) === false ) { return false; }
    writer.select(parsed.badFilter ? 1 : 0);
    const type = typeNameToTypeValue.redirect;
    for ( const redirect of redirects ) {
        writer.push([ type, redirect ]);
    }
    return true;
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
    reader.select(1);
    while ( reader.next() ) {
        this.badFilters.add(reader.line);
    }
};

/******************************************************************************/

FilterContainer.prototype.realmMatchAndFetchData = function(
    realmBits,
    partyBits,
    type,
    out
) {
    const bits01 = realmBits | typeNameToTypeValue.data;
    const bits11 = realmBits | typeNameToTypeValue.data | partyBits;

    const bucket01 = this.categories.get(bits01);
    const bucket11 = partyBits !== 0
        ? this.categories.get(bits11)
        : undefined;

    if ( bucket01 === undefined && bucket11 === undefined ) { return false; }

    const url = $requestURL;
    const tokenHashes = this.urlTokenizer.getTokens();
    const filters = [];
    let i = 0, tokenBeg = 0, f;
    for (;;) {
        const th = tokenHashes[i];
        if ( th === 0 ) { return; }
        tokenBeg = tokenHashes[i+1];
        if (
            (bucket01 !== undefined) &&
            (f = bucket01.get(th)) !== undefined
        ) {
            filters.length = 0;
            f.matchAndFetchData(type, url, tokenBeg, filters);
            for ( f of filters ) {
                out.set(f.data, new FilterDataHolderResult(bits01, th, f));
            }
        }
        if (
            (bucket11 !== undefined) &&
            (f = bucket11.get(th)) !== undefined
        ) {
            filters.length = 0;
            f.matchAndFetchData(type, url, tokenBeg, filters);
            for ( f of filters ) {
                out.set(f.data, new FilterDataHolderResult(bits11, th, f));
            }
        }
        i += 2;
    }
};

/******************************************************************************/

FilterContainer.prototype.matchAndFetchData = function(fctxt, type) {
    $requestURL = this.urlTokenizer.setURL(fctxt.url);
    $docHostname = fctxt.getDocHostname();
    $requestHostname = fctxt.getHostname();

    const partyBits = fctxt.is3rdPartyToDoc() ? ThirdParty : FirstParty;

    const toAddImportant = new Map();
    this.realmMatchAndFetchData(BlockImportant, partyBits, type, toAddImportant);

    const toAdd = new Map();
    this.realmMatchAndFetchData(BlockAction, partyBits, type, toAdd);

    if ( toAddImportant.size === 0 && toAdd.size === 0 ) { return []; }

    const toRemove = new Map();
    this.realmMatchAndFetchData(AllowAction, partyBits, type, toRemove);

    // Remove entries overriden by important block filters.
    for ( const key of toAddImportant.keys() ) {
        toAdd.delete(key);
        toRemove.delete(key);
    }

    // Special case, except-all:
    // - Except-all applies only if there is at least one normal block filters.
    // - Except-all does not apply to important block filters.
    if ( toRemove.has('') ) {
        if ( toAdd.size !== 0 ) {
            toAdd.clear();
            toRemove.forEach((v, k, m) => {
                if ( k !== '' ) { m.delete(k); }
            });
        } else {
            toRemove.clear();
        }
    }
    // Remove excepted block filters and unused exception filters.
    else {
        for ( const key of toRemove.keys() ) {
            if ( toAdd.has(key) ) {
                toAdd.delete(key);
            } else {
                toRemove.delete(key);
            }
        }
    }

    // Merge important and normal block filters
    for ( const [ key, entry ] of toAddImportant ) {
        toAdd.set(key, entry);
    }
    return Array.from(toAdd.values()).concat(Array.from(toRemove.values()));
};

/******************************************************************************/

FilterContainer.prototype.realmMatchString = function(
    realmBits,
    typeBits,
    partyBits
) {
    const exactType = typeBits & 0x80000000;
    typeBits &= 0x7FFFFFFF;

    const catBits00 = realmBits;
    const catBits01 = realmBits | typeBits;
    const catBits10 = realmBits | partyBits;
    const catBits11 = realmBits | typeBits | partyBits;

    const bucket00 = exactType === 0
        ? this.categories.get(catBits00)
        : undefined;
    const bucket01 = exactType !== 0 || typeBits !== 0
        ? this.categories.get(catBits01)
        : undefined;
    const bucket10 = exactType === 0 && partyBits !== 0
        ? this.categories.get(catBits10)
        : undefined;
    const bucket11 = (exactType !== 0 || typeBits !== 0) && partyBits !== 0
        ? this.categories.get(catBits11)
        : undefined;

    if (
        bucket00 === undefined && bucket01 === undefined &&
        bucket10 === undefined && bucket11 === undefined
    ) {
        return false;
    }

    let catBits = 0, f;

    // Pure hostname-based filters
    let tokenHash = this.dotTokenHash;
    if (
        (bucket00 !== undefined) &&
        (f = bucket00.get(tokenHash)) !== undefined &&
        (f.match() === true)
    ) {
        catBits = catBits00;
    } else if (
        (bucket01 !== undefined) &&
        (f = bucket01.get(tokenHash)) !== undefined &&
        (f.match() === true)
    ) {
        catBits = catBits01;
    } else if (
        (bucket10 !== undefined) &&
        (f = bucket10.get(tokenHash)) !== undefined &&
        (f.match() === true)
    ) {
        catBits = catBits10;
    } else if (
        (bucket11 !== undefined) &&
        (f = bucket11.get(tokenHash)) !== undefined &&
        (f.match() === true)
    ) {
        catBits = catBits11;
    }
    // Pattern-based filters
    else {
        const url = $requestURL;
        const tokenHashes = this.urlTokenizer.getTokens();
        let i = 0, tokenBeg = 0;
        for (;;) {
            tokenHash = tokenHashes[i];
            if ( tokenHash === 0 ) { return false; }
            tokenBeg = tokenHashes[i+1];
            if (
                (bucket00 !== undefined) &&
                (f = bucket00.get(tokenHash)) !== undefined &&
                (f.match(url, tokenBeg) === true)
            ) {
                catBits = catBits00;
                break;
            }
            if (
                (bucket01 !== undefined) &&
                (f = bucket01.get(tokenHash)) !== undefined &&
                (f.match(url, tokenBeg) === true)
            ) {
                catBits = catBits01;
                break;
            }
            if (
                (bucket10 !== undefined) &&
                (f = bucket10.get(tokenHash)) !== undefined &&
                (f.match(url, tokenBeg) === true)
            ) {
                catBits = catBits10;
                break;
            }
            if (
                (bucket11 !== undefined) &&
                (f = bucket11.get(tokenHash)) !== undefined &&
                (f.match(url, tokenBeg) === true)
            ) {
                catBits = catBits11;
                break;
            }
            i += 2;
        }
    }

    this.$catbits = catBits;
    this.$tokenHash = tokenHash;
    this.$filter = f;
    return true;
};

/******************************************************************************/

// Specialized handler

// https://github.com/gorhill/uBlock/issues/1477
//   Special case: blocking-generichide filter ALWAYS exists, it is implicit --
//   thus we always first check for exception filters, then for important block
//   filter if and only if there was a hit on an exception filter.
// https://github.com/gorhill/uBlock/issues/2103
//   User may want to override `generichide` exception filters.
// https://www.reddit.com/r/uBlockOrigin/comments/d6vxzj/
//   Add support for `specifichide`.

FilterContainer.prototype.matchStringElementHide = function(type, url) {
    const typeBits = typeNameToTypeValue[`${type}hide`] | 0x80000000;

    // Prime tokenizer: we get a normalized URL in return.
    $requestURL = this.urlTokenizer.setURL(url);
    this.$filter = null;

    // These registers will be used by various filters
    $docHostname = $requestHostname = µb.URI.hostnameFromURI(url);

    // Exception filters
    if ( this.realmMatchString(AllowAction, typeBits, FirstParty) ) {
        // Important block filters.
        if ( this.realmMatchString(BlockImportant, typeBits, FirstParty) ) {
            return 1;
        }
        return 2;
    }
    return 0;

};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/116
//   Some type of requests are exceptional, they need custom handling,
//   not the generic handling.
// https://github.com/chrisaljoudi/uBlock/issues/519
//   Use exact type match for anything beyond `other`. Also, be prepared to
//   support unknown types.

FilterContainer.prototype.matchString = function(fctxt, modifiers = 0) {
    let typeBits = typeNameToTypeValue[fctxt.type];
    if ( modifiers === 0 ) {
        if ( typeBits === undefined ) {
            typeBits = otherTypeBitValue;
        } else if ( typeBits === 0 || typeBits > otherTypeBitValue ) {
            modifiers |= 0b0001;
        }
    }
    if ( (modifiers & 0b0001) !== 0 ) {
        if ( typeBits === undefined ) { return 0; }
        typeBits |= 0x80000000;
    }

    const partyBits = fctxt.is3rdPartyToDoc() ? ThirdParty : FirstParty;

    // Prime tokenizer: we get a normalized URL in return.
    $requestURL = this.urlTokenizer.setURL(fctxt.url);
    this.$filter = null;

    // These registers will be used by various filters
    $docHostname = fctxt.getDocHostname();
    $requestHostname = fctxt.getHostname();

    // Important block filters.
    if ( this.realmMatchString(BlockImportant, typeBits, partyBits) ) {
        return 1;
    }
    // Block filters
    if ( this.realmMatchString(BlockAction, typeBits, partyBits) ) {
        // Exception filters
        if ( this.realmMatchString(AllowAction, typeBits, partyBits) ) {
            return 2;
        }
        return 1;
    }
    return 0;
};

/******************************************************************************/

FilterContainer.prototype.toLogData = function() {
    if ( this.$filter === null ) { return; }
    const logData = toLogDataInternal(
        this.$catbits,
        this.$tokenHash,
        this.$filter
    );
    logData.source = 'static';
    logData.tokenHash = this.$tokenHash;
    logData.result = this.$filter === null
        ? 0
        : (
            (this.$catbits & 1) !== 0
                ? 2
                : 1
        );
    return logData;
};

/******************************************************************************/

FilterContainer.prototype.getFilterCount = function() {
    return this.acceptedCount - this.discardedCount;
};

/******************************************************************************/

// action: 1=test, 2=record

FilterContainer.prototype.benchmark = async function(action) {
    const requests = await µb.loadBenchmarkDataset();

    if ( Array.isArray(requests) === false || requests.length === 0 ) {
        console.info('No requests found to benchmark');
        return;
    }

    console.info(`Benchmarking staticNetFilteringEngine.matchString()...`);
    const fctxt = µb.filteringContext.duplicate();
    let expected, recorded;
    if ( action === 1 ) {
        try {
            expected = JSON.parse(
                vAPI.localStorage.getItem('FilterContainer.benchmark.results')
            );
        } catch(ex) {
        }
    }
    if ( action === 2 ) {
        recorded = [];
    }

    const t0 = self.performance.now();
    for ( let i = 0; i < requests.length; i++ ) {
        const request = requests[i];
        fctxt.setURL(request.url);
        fctxt.setDocOriginFromURL(request.frameUrl);
        fctxt.setType(request.cpt);
        const r = this.matchString(fctxt);
        if ( recorded !== undefined ) { recorded.push(r); }
        if ( expected !== undefined && r !== expected[i] ) {
            console.log('Mismatch with reference results:');
            console.log(`\tExpected ${expected[i]}, got ${r}:`);
            console.log(`\ttype=${fctxt.type}`);
            console.log(`\turl=${fctxt.url}`);
            console.log(`\tdocOrigin=${fctxt.getDocOrigin()}`);
        }
    }
    const t1 = self.performance.now();
    const dur = t1 - t0;

    console.info(`Evaluated ${requests.length} requests in ${dur.toFixed(0)} ms`);
    console.info(`\tAverage: ${(dur / requests.length).toFixed(3)} ms per request`);
    if ( expected !== undefined ) {
        console.info(`\tBlocked: ${expected.reduce((n,r)=>{return r===1?n+1:n;},0)}`);
        console.info(`\tExcepted: ${expected.reduce((n,r)=>{return r===2?n+1:n;},0)}`);
    }
    if ( recorded !== undefined ) {
        vAPI.localStorage.setItem(
            'FilterContainer.benchmark.results',
            JSON.stringify(recorded)
        );
    }
};

/******************************************************************************/

FilterContainer.prototype.test = function(docURL, type, url) {
    const fctxt = µb.filteringContext.duplicate();
    fctxt.setDocOriginFromURL(docURL);
    fctxt.setType(type);
    fctxt.setURL(url);
    const r = this.matchString(fctxt);
    console.log(`${r}`);
    if ( r !== 0 ) {
        console.log(this.toLogData());
    }
};

/******************************************************************************-

    With default filter lists:

    As of 2019-04-18:

        {bits: "0", token: "ad", size: 926, f: FilterBucket}
        {bits: "0", token: "ads", size: 636, f: FilterBucket}
        {bits: "41", token: "phncdn", size: 253, f: FilterBucket}
        {bits: "0", token: "analytic", size: 174, f: FilterBucket}
        {bits: "0", token: "tracking", size: 155, f: FilterBucket}
        {bits: "48", token: "http", size: 146, f: FilterBucket}
        {bits: "48", token: "https", size: 139, f: FilterBucket}
        {bits: "58", token: "http", size: 122, f: FilterBucket}
        {bits: "0", token: "adv", size: 121, f: FilterBucket}
        {bits: "58", token: "https", size: 118, f: FilterBucket}
        {bits: "0", token: "advertis", size: 102, f: FilterBucket}
        {bits: "8", token: "doublecl", size: 96, f: FilterBucket}
        {bits: "41", token: "imasdk", size: 90, f: FilterBucket}
        {bits: "0", token: "cdn", size: 89, f: FilterBucket}
        {bits: "0", token: "track", size: 87, f: FilterBucket}
        {bits: "0", token: "stats", size: 82, f: FilterBucket}
        {bits: "0", token: "banner", size: 74, f: FilterBucket}
        {bits: "0", token: "log", size: 72, f: FilterBucket}
        {bits: "0", token: "ga", size: 71, f: FilterBucket}
        {bits: "0", token: "gif", size: 67, f: FilterBucket}
        {bits: "0", token: "cloudfro", size: 64, f: FilterBucket}
        {bits: "0", token: "amazonaw", size: 61, f: FilterBucket}
        {bits: "41", token: "ajax", size: 58, f: FilterBucket}
        {bits: "0", token: "tracker", size: 56, f: FilterBucket}
        {bits: "40", token: "pagead2", size: 53, f: FilterBucket}
        {bits: "0", token: "affiliat", size: 53, f: FilterBucket}

*/

FilterContainer.prototype.bucketHistogram = function() {
    const results = [];
    for ( const [ bits, category ] of this.categories ) {
        for ( const [ th, f ] of category ) {
            if ( f instanceof FilterPair ) {
                const token = µBlock.urlTokenizer.stringFromTokenHash(th);
                results.push({ bits: bits.toString(16), token, size: f.size, f });
                continue;
            }
            if ( f instanceof FilterBucket ) {
                const token = µBlock.urlTokenizer.stringFromTokenHash(th);
                results.push({ bits: bits.toString(16), token, size: f.size, f });
                continue;
            }
            if ( f instanceof FilterHostnameDict ) {
                const token = µBlock.urlTokenizer.stringFromTokenHash(th);
                results.push({ bits: bits.toString(16), token, size: f.size, f });
                continue;
            }
            if ( f instanceof FilterJustOrigin ) {
                const token = µBlock.urlTokenizer.stringFromTokenHash(th);
                results.push({ bits: bits.toString(16), token, size: f.size, f });
                continue;
            }
        }
    }
    results.sort((a, b) => {
        return b.size - a.size;
    });
    console.log(results);
};

/*******************************************************************************

    With default filter lists:

    As of 2019-04-13:

        {"FilterPlainHnAnchored" => 12619}
        {"FilterPlainPrefix1" => 8743}
        {"FilterGenericHnAnchored" => 5231}
        {"FilterOriginHit" => 4149}
        {"FilterPair" => 2381}
        {"FilterBucket" => 1940}
        {"FilterPlainHostname" => 1612}
        {"FilterOriginHitSet" => 1430}
        {"FilterPlainLeftAnchored" => 799}
        {"FilterGeneric" => 588}
        {"FilterPlain" => 510}
        {"FilterOriginMiss" => 299}
        {"FilterDataHolder" => 280}
        {"FilterOriginMissSet" => 150}
        {"FilterTrue" => 130}
        {"FilterRegex" => 124}
        {"FilterPlainRightAnchored" => 110}
        {"FilterGenericHnAndRightAnchored" => 95}
        {"FilterHostnameDict" => 59}
        {"FilterPlainPrefix0" => 29}
        {"FilterExactMatch" => 5}
        {"FilterOriginMixedSet" => 3}

        Observations:
        - No need for FilterPlainPrefix0.
        - FilterPlainHnAnchored and FilterPlainPrefix1 are good candidates
          for storing in a plain string trie.

    As of 2019-04-25:

        {"FilterPlainHnAnchored" => 11078}
        {"FilterPlainPrefix1" => 7195}
        {"FilterPrefix1Trie" => 5720}
        {"FilterOriginHit" => 3561}
        {"FilterWildcard2HnAnchored" => 2943}
        {"FilterPair" => 2391}
        {"FilterBucket" => 1922}
        {"FilterWildcard1HnAnchored" => 1910}
        {"FilterHnAnchoredTrie" => 1586}
        {"FilterPlainHostname" => 1391}
        {"FilterOriginHitSet" => 1155}
        {"FilterPlain" => 634}
        {"FilterWildcard1" => 423}
        {"FilterGenericHnAnchored" => 389}
        {"FilterOriginMiss" => 302}
        {"FilterGeneric" => 163}
        {"FilterOriginMissSet" => 150}
        {"FilterRegex" => 124}
        {"FilterPlainRightAnchored" => 110}
        {"FilterGenericHnAndRightAnchored" => 95}
        {"FilterHostnameDict" => 59}
        {"FilterPlainLeftAnchored" => 30}
        {"FilterJustOrigin" => 22}
        {"FilterHTTPJustOrigin" => 19}
        {"FilterHTTPSJustOrigin" => 18}
        {"FilterExactMatch" => 5}
        {"FilterOriginMixedSet" => 3}

*/

FilterContainer.prototype.filterClassHistogram = function() {
    const filterClassDetails = new Map();

    for ( let i = 0; i < filterClasses.length; i++ ) {
        filterClassDetails.set(i, { name: filterClasses[i].name, count: 0, });
    }
    // Artificial classes to report content of tries
    filterClassDetails.set(1000, { name: 'FilterPlainTrie', count: 0, });
    filterClassDetails.set(1001, { name: 'FilterPlainHnAnchoredTrie', count: 0, });

    const countFilter = function(f) {
        if ( f instanceof Object === false ) { return; }
        filterClassDetails.get(f.fid).count += 1;
        if ( f.wrapped ) {
            countFilter(f.wrapped);
        }
    };

    for ( const category of this.categories.values() ) {
        for ( const f of category.values() ) {
            countFilter(f);
            if ( f instanceof FilterBucket ) {
                for ( const g of f.filters ) { countFilter(g); }
                if ( f.plainTrie !== null ) {
                    filterClassDetails.get(1000).count += f.plainTrie.size;
                }
                if ( f.plainHnAnchoredTrie !== null ) {
                    filterClassDetails.get(1001).count += f.plainHnAnchoredTrie.size;
                }
                continue;
            }
            if ( f instanceof FilterPair ) {
                countFilter(f.f1);
                countFilter(f.f2);
                continue;
            }
        }
    }
    const results = Array.from(filterClassDetails.values()).sort((a, b) => {
        return b.count - a.count;
    });
    console.log(results);
};

/******************************************************************************/

return new FilterContainer();

/******************************************************************************/

})();

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
const urlTokenizer = µb.urlTokenizer;

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
const BlockImportant = BlockAction | Important;

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
             'cname': 19 << 4,
              'data': 20 << 4,  // special: a generic data holder
          'redirect': 21 << 4,
            'webrtc': 22 << 4,
       'unsupported': 23 << 4,
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
    19: 'cname',
    20: 'data',
    21: 'redirect',
    22: 'webrtc',
    23: 'unsupported',
};

// https://github.com/gorhill/uBlock/issues/1493
//   Transpose `ping` into `other` for now.
const toNormalizedType = {
               'all': 'all',
            'beacon': 'ping',
             'cname': 'cname',
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

const typeValueFromCatBits = catBits => (catBits >>> 4) & 0b11111;

/******************************************************************************/

// See the following as short-lived registers, used during evaluation. They are
// valid until the next evaluation.

let $requestURL = '';
let $requestHostname = '';
let $docHostname = '';
let $tokenBeg = 0;
let $patternMatchLeft = 0;
let $patternMatchRight = 0;

// EXPERIMENT: $requestTypeBit
let $requestTypeBit = 0;

/******************************************************************************/

// Local helpers

const restrSeparator = '(?:[^%.0-9a-z_-]|$)';

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
const reEscape = /[.*+?^${}()|[\]\\]/g;

// Convert a plain string (devoid of special characters) into a regex.
const restrFromPlainPattern = s => s.replace(reEscape, '\\$&');

const restrFromGenericPattern = function(s, anchor = 0) {
    let reStr = s.replace(restrFromGenericPattern.rePlainChars, '\\$&')
                 .replace(restrFromGenericPattern.reSeparators, restrSeparator)
                 .replace(restrFromGenericPattern.reDanglingAsterisks, '')
                 .replace(restrFromGenericPattern.reAsterisks, '\\S*?');
    if ( anchor & 0b100 ) {
        reStr = (
            reStr.startsWith('\\.') ?
                restrFromGenericPattern.restrHostnameAnchor2 :
                restrFromGenericPattern.restrHostnameAnchor1
        ) + reStr;
    } else if ( anchor & 0b010 ) {
        reStr = '^' + reStr;
    }
    if ( anchor & 0b001 ) {
        reStr += '$';
    }
    return reStr;
};
restrFromGenericPattern.rePlainChars = /[.+?${}()|[\]\\]/g;
restrFromGenericPattern.reSeparators = /\^/g;
restrFromGenericPattern.reDanglingAsterisks = /^\*+|\*+$/g;
restrFromGenericPattern.reAsterisks = /\*+/g;
restrFromGenericPattern.restrHostnameAnchor1 = '^[a-z-]+://(?:[^/?#]+\\.)?';
restrFromGenericPattern.restrHostnameAnchor2 = '^[a-z-]+://(?:[^/?#]+)?';

const toLogDataInternal = function(categoryBits, tokenHash, iunit) {
    if ( iunit === 0 ) { return; }
    const pattern = [];
    const regex = [];
    const options = [];
    const denyallow = [];
    const domains = [];
    const logData = {
        pattern,
        regex,
        denyallow,
        domains,
        options,
        isRegex: false,
    };
    filterUnits[iunit].logData(logData);
    if ( categoryBits & 0x002 ) {
        logData.options.unshift('important');
    }
    if ( categoryBits & 0x008 ) {
        logData.options.unshift('3p');
    } else if ( categoryBits & 0x004 ) {
        logData.options.unshift('1p');
    }
    const type = categoryBits & 0x1F0;
    if ( type !== 0 && type !== typeNameToTypeValue.data ) {
        logData.options.unshift(typeValueToTypeName[type >>> 4]);
    }
    let raw = logData.pattern.join('');
    if (
        logData.isRegex === false &&
        raw.charCodeAt(0) === 0x2F /* '/' */ &&
        raw.charCodeAt(raw.length - 1) === 0x2F /* '/' */
    ) {
        raw += '*';
    }
    if ( categoryBits & 0x001 ) {
        raw = '@@' + raw;
    }
    if ( denyallow.length !== 0 ) {
        options.push(`denyallow=${denyallow.join('|')}`);
    }
    if ( domains.length !== 0 ) {
        options.push(`domain=${domains.join('|')}`);
    }
    if ( options.length !== 0 ) {
        raw += '$' + options.join(',');
    }
    return { raw, regex: logData.regex.join('') };
};

/******************************************************************************/

const charClassMap = new Uint32Array(128);
const CHAR_CLASS_SEPARATOR = 0b00000001;

{
    const reSeparators = /[^\w%.-]/;
    for ( let i = 0; i < 128; i++ ) {
        if ( reSeparators.test(String.fromCharCode(i)) ) {
            charClassMap[i] |= CHAR_CLASS_SEPARATOR;
        }
    }
}

const isSeparatorChar = c => (charClassMap[c] & CHAR_CLASS_SEPARATOR) !== 0;

/******************************************************************************/

let filterUnits = [ null ];

let filterSequences = new Uint32Array(131072);
let filterSequenceWritePtr = 3;

const filterSequenceAdd = function(a, b) {
    const i = filterSequenceWritePtr;
    filterSequenceWritePtr += 2;
    if ( filterSequenceWritePtr > filterSequences.length ) {
        filterSequenceBufferResize(filterSequenceWritePtr);
    }
    filterSequences[i+0] = a;
    filterSequences[i+1] = b;
    return i;
};

const filterSequenceBufferResize = function(newSize) {
    if ( newSize <= filterSequences.length ) { return; }
    const size = (newSize + 0x3FFF) & ~0x3FFF;
    const buffer = new Uint32Array(size);
    buffer.set(filterSequences);
    filterSequences = buffer;
};

/******************************************************************************/

const bidiTrieMatchExtra = function(l, r, ix) {
    for (;;) {
        $patternMatchLeft = l;
        $patternMatchRight = r;
        const iu = filterSequences[ix+0];
        if ( filterUnits[iu].match() ) { return iu; }
        ix = filterSequences[ix+1];
        if ( ix === 0 ) { break; }
    }
    return 0;
};

const bidiTrie = new µb.BidiTrieContainer(bidiTrieMatchExtra);

const bidiTriePrime = function() {
    bidiTrie.reset(vAPI.localStorage.getItem('SNFE.bidiTrie'));
};

const bidiTrieOptimize = function(shrink = false) {
    vAPI.localStorage.setItem('SNFE.bidiTrie', bidiTrie.optimize(shrink));
};

/*******************************************************************************

    Each filter class will register itself in the map.

    IMPORTANT: any change which modifies the mapping will have to be
    reflected with µBlock.systemSettings.compiledMagic.

*/

const filterClasses = [];
const filterArgsToUnit = new Map();
let   filterClassIdGenerator = 0;

const registerFilterClass = function(ctor) {
    const fid = filterClassIdGenerator++;
    ctor.fid = ctor.prototype.fid = fid;
    filterClasses[fid] = ctor;
};

const filterFromCtor = function(ctor, ...args) {
    if ( ctor.filterUnit !== undefined ) {
        return ctor.filterUnit;
    }
    const f = new ctor(...args);
    const iunit = filterUnits.length;
    filterUnits.push(f);
    return iunit;
};

const filterUnitFromCompiled = function(args) {
    const ctor = filterClasses[args[0]];
    const keygen = ctor.keyFromArgs;
    if ( keygen === undefined ) {
        return filterUnits.push(ctor.fromCompiled(args)) - 1;
    }
    let key = `${ctor.fid}`;
    const keyargs = keygen(args);
    if ( keyargs !== undefined ) {
        key += `\t${keyargs}`;
    }
    let iunit = filterArgsToUnit.get(key);
    if ( iunit === undefined ) {
        iunit = filterUnits.push(ctor.fromCompiled(args)) - 1;
        filterArgsToUnit.set(key, iunit);
    }
    return iunit;
};

const filterFromSelfie = function(args) {
    return filterClasses[args[0]].fromSelfie(args);
};

/******************************************************************************/

const filterPattern = {
    compile: function(parsed, units) {
        if ( parsed.isRegex ) {
            units.push(FilterRegex.compile(parsed));
            return;
        }
        const pattern = parsed.f;
        if ( pattern === '*' ) {
            units.push(FilterTrue.compile());
            return;
        }
        if ( parsed.tokenHash === parsed.noTokenHash ) {
            units.push(FilterPatternGeneric.compile(parsed));
            return;
        }
        if ( parsed.firstWildcardPos === -1 && parsed.firstCaretPos === -1 ) {
            units.push(FilterPatternPlain.compile(parsed));
            return;
        }
        if (
            parsed.secondWildcardPos !== -1 ||
            parsed.secondCaretPos !== -1 ||
            parsed.firstCaretPos !== -1 && (
                parsed.firstWildcardPos === -1 ||
                parsed.firstWildcardPos !== (parsed.firstCaretPos + 1)
            )
        ) {
            return this.compileGeneric(parsed, units);
        }
        const hasCaretCombo = parsed.firstCaretPos !== -1;
        const sright = pattern.slice(parsed.firstWildcardPos + 1);
        const sleft = pattern.slice(
            0,
            hasCaretCombo ? parsed.firstCaretPos : parsed.firstWildcardPos
        );
        if ( parsed.tokenBeg < parsed.firstWildcardPos ) {
            parsed.f = sleft;
            units.push(FilterPatternPlain.compile(parsed));
            parsed.f = sright;
            units.push(FilterPatternRight.compile(parsed, hasCaretCombo));
            return;
        }
        // parsed.tokenBeg > parsed.firstWildcardPos
        parsed.f = sright;
        parsed.tokenBeg -= parsed.firstWildcardPos + 1;
        units.push(FilterPatternPlain.compile(parsed));
        parsed.f = sleft;
        units.push(FilterPatternLeft.compile(parsed, hasCaretCombo));
    },
    compileGeneric: function(parsed, units) {
        const pattern = parsed.f;
        // Optimize special case: plain pattern with trailing caret
        if (
            parsed.firstWildcardPos === -1 &&
            parsed.firstCaretPos === (pattern.length - 1)
        ) {
            parsed.f = pattern.slice(0, -1);
            units.push(FilterPatternPlain.compile(parsed));
            units.push(FilterTrailingSeparator.compile());
            return;
        }
        // Use a plain pattern as a first test for whether the generic pattern
        // needs to be matched.
        // TODO: inconclusive, investigate more.
        //let left = parsed.tokenBeg;
        //while ( left > 0 ) {
        //    const c = pattern.charCodeAt(left-1);
        //    if ( c === 0x2A /* '*' */ || c === 0x5E /* '^' */ ) { break; }
        //    left -= 1;
        //}
        //let right = parsed.tokenBeg + parsed.token.length;
        //while ( right < pattern.length ) {
        //    const c = pattern.charCodeAt(right);
        //    if ( c === 0x2A /* '*' */ || c === 0x5E /* '^' */ ) { break; }
        //    right += 1;
        //}
        //parsed.f = pattern.slice(left, right);
        //parsed.tokenBeg -= left;
        //units.push(FilterPatternPlain.compile(parsed));
        //parsed.f = pattern;
        units.push(FilterPatternGeneric.compile(parsed));
    },
};

/******************************************************************************/

const FilterTrue = class {
    match() {
        return true;
    }

    logData(details) {
        details.pattern.push('*');
        details.regex.push('^');
    }

    toSelfie() {
        return FilterTrue.compile();
    }

    static compile() {
        return [ FilterTrue.fid ];
    }

    static fromCompiled() {
        return new FilterTrue();
    }

    static fromSelfie() {
        return new FilterTrue();
    }

    static keyFromArgs() {
    }
};

registerFilterClass(FilterTrue);

/******************************************************************************/

const FilterPatternPlain = class {
    constructor(i, n) {
        this.i = i | 0;
        this.n = n | 0;
    }

    match() {
        const left = $tokenBeg;
        if (
            bidiTrie.startsWith(
                left,
                bidiTrie.haystackLen,
                this.i,
                this.n
            ) === 0
        ) {
            return false;
        }
        $patternMatchLeft = left;
        $patternMatchRight = left + this.n;
        return true;
    }

    get isBidiTrieable() {
        return this.n <= 255;
    }

    toBidiTrie() {
        return { i: this.i, n: this.n, itok: this.tokenBeg };
    }

    logData(details) {
        const s = bidiTrie.extractString(this.i, this.n);
        details.pattern.push(s);
        details.regex.push(restrFromPlainPattern(s));
    }

    toSelfie() {
        return [ this.fid, this.i, this.n, this.tokenBeg ];
    }

    static compile(details) {
        return [ FilterPatternPlain.fid, details.f, details.tokenBeg ];
    }

    static fromCompiled(args) {
        const i = bidiTrie.storeString(args[1]);
        const n = args[1].length;
        if ( args[2] === 0 ) {
            return new FilterPatternPlain(i, n);
        }
        if ( args[2] === 1 ) {
            return new FilterPatternPlain1(i, n);
        }
        return new FilterPatternPlainX(i, n, args[2]);
    }

    static fromSelfie(args) {
        if ( args[3] === 0 ) {
            return new FilterPatternPlain(args[1], args[2]);
        }
        if ( args[3] === 1 ) {
            return new FilterPatternPlain1(args[1], args[2]);
        }
        return new FilterPatternPlainX(args[1], args[2], args[3]);
    }
};

FilterPatternPlain.prototype.tokenBeg = 0;

registerFilterClass(FilterPatternPlain);


const FilterPatternPlain1 = class extends FilterPatternPlain {
    match() {
        const left = $tokenBeg - 1;
        if (
            bidiTrie.startsWith(
                left,
                bidiTrie.haystackLen,
                this.i,
                this.n
            ) === 0
        ) {
            return false;
        }
        $patternMatchLeft = left;
        $patternMatchRight = left + this.n;
        return true;
    }
};

FilterPatternPlain1.prototype.tokenBeg = 1;


const FilterPatternPlainX = class extends FilterPatternPlain {
    constructor(i, n, tokenBeg) {
        super(i, n);
        this.tokenBeg = tokenBeg;
    }

    match() {
        const left = $tokenBeg - this.tokenBeg;
        if (
            bidiTrie.startsWith(
                left,
                bidiTrie.haystackLen,
                this.i,
                this.n
            ) === 0
        ) {
            return false;
        }
        $patternMatchLeft = left;
        $patternMatchRight = left + this.n;
        return true;
    }
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/commit/7971b223855d#commitcomment-37077525
//   Mind that the left part may be empty.

const FilterPatternLeft = class {
    constructor(i, n) {
        this.i = i | 0;
        this.n = n | 0;
    }

    match() {
        const left = bidiTrie.indexOf(
            0, $patternMatchLeft,
            this.i, this.n
        );
        if ( left === -1 ) { return false; }
        $patternMatchLeft = left;
        return true;
    }

    logData(details) {
        details.pattern.unshift('*');
        if ( this.n === 0 ) { return; }
        const s = bidiTrie.extractString(this.i, this.n);
        details.pattern.unshift(s);
        details.regex.unshift(restrFromPlainPattern(s), '.*');
    }

    toSelfie() {
        return [ this.fid, this.i, this.n ];
    }

    static compile(details, ex) {
        return [
            ex ? FilterPatternLeftEx.fid : FilterPatternLeft.fid,
            details.f
        ];
    }

    static fromCompiled(args) {
        const i = bidiTrie.storeString(args[1]);
        return new FilterPatternLeft(i, args[1].length);
    }

    static fromSelfie(args) {
        return new FilterPatternLeft(args[1], args[2]);
    }
};

registerFilterClass(FilterPatternLeft);


const FilterPatternLeftEx = class extends FilterPatternLeft {
    match() {
        let left = 0;
        for (;;) {
            left = bidiTrie.indexOf(
                left, $patternMatchLeft - 1,
                this.i, this.n
            );
            if ( left === -1 ) { return false; }
            if ( isSeparatorChar(bidiTrie.haystack[left + this.n]) ) {
                break;
            }
            left += 1;
        }
        $patternMatchLeft = left;
        return true;
    }

    logData(details) {
        const s = bidiTrie.extractString(this.i, this.n);
        details.pattern.unshift(s, '^*');
        details.regex.unshift(restrFromPlainPattern(s), restrSeparator, '.*');
    }

    static fromCompiled(args) {
        const i = bidiTrie.storeString(args[1]);
        return new FilterPatternLeftEx(i, args[1].length);
    }

    static fromSelfie(args) {
        return new FilterPatternLeftEx(args[1], args[2]);
    }
};

registerFilterClass(FilterPatternLeftEx);

/******************************************************************************/

const FilterPatternRight = class {
    constructor(i, n) {
        this.i = i | 0;
        this.n = n | 0;
    }

    match() {
        const right = bidiTrie.lastIndexOf(
            $patternMatchRight, bidiTrie.haystackLen,
            this.i, this.n
        );
        if ( right === -1 ) { return false; }
        $patternMatchRight = right + this.n;
        return true;
    }

    logData(details) {
        const s = bidiTrie.extractString(this.i, this.n);
        details.pattern.push('*', s);
        details.regex.push('.*', restrFromPlainPattern(s));
    }

    toSelfie() {
        return [ this.fid, this.i, this.n ];
    }

    static compile(details, ex) {
        return [
            ex ? FilterPatternRightEx.fid : FilterPatternRight.fid,
            details.f
        ];
    }

    static fromCompiled(args) {
        const i = bidiTrie.storeString(args[1]);
        return new FilterPatternRight(i, args[1].length);
    }

    static fromSelfie(args) {
        return new FilterPatternRight(args[1], args[2]);
    }
};

registerFilterClass(FilterPatternRight);


const FilterPatternRightEx = class extends FilterPatternRight {
    match() {
        const left = $patternMatchRight;
        const right = bidiTrie.lastIndexOf(
            left + 1, bidiTrie.haystackLen,
            this.i, this.n
        );
        if ( right === -1 ) { return false; }
        if ( isSeparatorChar(bidiTrie.haystack[left]) === false ) {
            return false;
        }
        $patternMatchRight = right + this.n;
        return true;
    }

    logData(details) {
        const s = bidiTrie.extractString(this.i, this.n);
        details.pattern.push('^*', s);
        details.regex.push(restrSeparator, '.*', restrFromPlainPattern(s));
    }

    static fromCompiled(args) {
        const i = bidiTrie.storeString(args[1]);
        return new FilterPatternRightEx(i, args[1].length);
    }

    static fromSelfie(args) {
        return new FilterPatternRightEx(args[1], args[2]);
    }
};

registerFilterClass(FilterPatternRightEx);

/******************************************************************************/

const FilterPatternGeneric = class {
    constructor(s, anchor) {
        this.s = s;
        if ( anchor !== 0 ) {
            this.anchor = anchor;
        }
    }

    match() {
        if ( this.re === null ) {
            this.re = new RegExp(restrFromGenericPattern(this.s, this.anchor));
        }
        return this.re.test($requestURL);
    }

    logData(details) {
        details.pattern.length = 0;
        if ( (this.anchor & 0b100) !== 0 ) {
            details.pattern.push('||');
        } else if ( (this.anchor & 0b010) !== 0 ) {
            details.pattern.push('|');
        }
        details.pattern.push(this.s);
        if ( (this.anchor & 0b001) !== 0 ) {
            details.pattern.push('|');
        }
        details.regex.length = 0;
        details.regex.push(
            restrFromGenericPattern(this.s, this.anchor & ~0b100)
        );
    }

    toSelfie() {
        return [ this.fid, this.s, this.anchor ];
    }

    static compile(details) {
        const anchor = details.anchor;
        details.anchor = 0;
        return [ FilterPatternGeneric.fid, details.f, anchor ];
    }

    static fromCompiled(args) {
        return new FilterPatternGeneric(args[1], args[2]);
    }

    static fromSelfie(args) {
        return new FilterPatternGeneric(args[1], args[2]);
    }

    static keyFromArgs(args) {
        return `${args[1]}\t${args[2]}`;
    }
};

FilterPatternGeneric.prototype.re = null;
FilterPatternGeneric.prototype.anchor = 0;

FilterPatternGeneric.isSlow = true;

registerFilterClass(FilterPatternGeneric);

/******************************************************************************/

const FilterPlainHostname = class {
    constructor(s) {
        this.s = s;
    }

    match() {
        if ( $requestHostname.endsWith(this.s) === false ) { return false; }
        const offset = $requestHostname.length - this.s.length;
        return offset === 0 ||
               $requestHostname.charCodeAt(offset - 1) === 0x2E /* '.' */;
    }

    logData(details) {
        details.pattern.push('||', this.s, '^');
        details.regex.push(restrFromPlainPattern(this.s), restrSeparator);
    }

    toSelfie() {
        return [ this.fid, this.s ];
    }

    static compile(details) {
        return [ FilterPlainHostname.fid, details.f ];
    }

    static fromCompiled(args) {
        return new FilterPlainHostname(args[1]);
    }

    static fromSelfie(args) {
        return new FilterPlainHostname(args[1]);
    }
};

registerFilterClass(FilterPlainHostname);

/******************************************************************************/

const FilterAnchorHn = class {
    constructor() {
        this.lastLen = 0;
        this.lastBeg = -1;
        this.lastEnd = -1;
    }

    match() {
        const len = $requestHostname.length;
        const haystackCodes = bidiTrie.haystack;
        if (
            len !== this.lastLen ||
            this.lastBeg === -1 ||
            haystackCodes[this.lastBeg-3] !== 0x3A /* ':' */ ||
            haystackCodes[this.lastBeg-2] !== 0x2F /* '/' */ ||
            haystackCodes[this.lastBeg-1] !== 0x2F /* '/' */
        ) {
            this.lastBeg = len !== 0 ? haystackCodes.indexOf(0x3A) : -1;
            if ( this.lastBeg !== -1 ) {
                if (
                    this.lastBeg >= bidiTrie.haystackLen ||
                    haystackCodes[this.lastBeg+1] !== 0x2F ||
                    haystackCodes[this.lastBeg+2] !== 0x2F
                ) {
                    this.lastBeg = -1;
                }
            }
            if ( this.lastBeg !== -1 ) {
                this.lastBeg += 3;
                this.lastEnd = this.lastBeg + len;
            } else {
                this.lastEnd = -1;
            }
            this.lastLen = len;
        }
        const left = $patternMatchLeft;
        return left < this.lastEnd && (
            left === this.lastBeg ||
            left > this.lastBeg && haystackCodes[left-1] === 0x2E /* '.' */
        );
    }

    logData(details) {
        details.pattern.unshift('||');
    }

    toSelfie() {
        return [ this.fid ];
    }

    static compile() {
        return [ FilterAnchorHn.fid ];
    }

    static fromCompiled() {
        return new FilterAnchorHn();
    }

    static fromSelfie() {
        return new FilterAnchorHn();
    }

    static keyFromArgs() {
    }
};

registerFilterClass(FilterAnchorHn);

/******************************************************************************/

const FilterAnchorLeft = class {
    match() {
        return $patternMatchLeft === 0;
    }

    logData(details) {
        details.pattern.unshift('|');
        details.regex.unshift('^');
    }

    toSelfie() {
        return [ this.fid ];
    }

    static compile() {
        return [ FilterAnchorLeft.fid ];
    }

    static fromCompiled() {
        return new FilterAnchorLeft();
    }

    static fromSelfie() {
        return new FilterAnchorLeft();
    }

    static keyFromArgs() {
    }
};

registerFilterClass(FilterAnchorLeft);

/******************************************************************************/

const FilterAnchorRight = class {
    match() {
        return $patternMatchRight === $requestURL.length;
    }

    logData(details) {
        details.pattern.push('|');
        details.regex.push('$');
    }

    toSelfie() {
        return [ this.fid ];
    }

    static compile() {
        return [ FilterAnchorRight.fid ];
    }

    static fromCompiled() {
        return new FilterAnchorRight();
    }

    static fromSelfie() {
        return new FilterAnchorRight();
    }

    static keyFromArgs() {
    }
};

registerFilterClass(FilterAnchorRight);

/******************************************************************************/

const FilterTrailingSeparator = class {
    match() {
        return $patternMatchRight === $requestURL.length ||
               isSeparatorChar(bidiTrie.haystack[$patternMatchRight]);
    }

    logData(details) {
        details.pattern.push('^');
        details.regex.push(restrSeparator);
    }

    toSelfie() {
        return [ this.fid ];
    }

    static compile() {
        return [ FilterTrailingSeparator.fid ];
    }

    static fromCompiled() {
        return new FilterTrailingSeparator();
    }

    static fromSelfie() {
        return new FilterTrailingSeparator();
    }

    static keyFromArgs() {
    }
};

registerFilterClass(FilterTrailingSeparator);

/******************************************************************************/

const FilterType = class {
    constructor(bits) {
        this.typeBits = bits;
    }

    match() {
        return (this.typeBits & $requestTypeBit) !== 0;
    }

    logData() {
    }

    toSelfie() {
        return [ this.fid, this.typeBits ];
    }

    static compile(details) {
        return [ FilterType.fid, details.typeBits & allNetworkTypesBits ];
    }

    static fromCompiled(args) {
        return new FilterType(args[1]);
    }

    static fromSelfie(args) {
        return new FilterType(args[1]);
    }
};

registerFilterClass(FilterType);

/******************************************************************************/

const FilterRegex = class {
    constructor(s) {
        this.s = s;
    }

    match() {
        if ( this.re === null ) {
            this.re = FilterRegex.dict.get(this.s);
            if ( this.re === undefined ) {
                this.re = new RegExp(this.s, 'i');
                FilterRegex.dict.set(this.s, this.re);
            }
        }
        if ( this.re.test($requestURL) === false ) { return false; }
        $patternMatchLeft = $requestURL.search(this.re);
        return true;
    }

    logData(details) {
        details.pattern.push('/', this.s, '/');
        details.regex.push(this.s);
        details.isRegex = true;
    }

    toSelfie() {
        return [ this.fid, this.s ];
    }

    static compile(details) {
        return [ FilterRegex.fid, details.f ];
    }

    static fromCompiled(args) {
        return new FilterRegex(args[1]);
    }

    static fromSelfie(args) {
        return new FilterRegex(args[1]);
    }

    static keyFromArgs(args) {
        return args[1];
    }
};

FilterRegex.prototype.re = null;

FilterRegex.isSlow = true;
FilterRegex.dict = new Map();

registerFilterClass(FilterRegex);

/******************************************************************************/

// The optimal "class" is picked according to the content of the
// `domain=` filter option.

const filterOrigin = new (class {
    constructor() {
        this.trieContainer = new µb.HNTrieContainer();
    }

    compile(details, prepend, units) {
        const domainOpt = details.domainOpt;
        let compiledMiss, compiledHit;
        // One hostname
        if ( domainOpt.indexOf('|') === -1 ) {
            // Must be a miss
            if ( domainOpt.charCodeAt(0) === 0x7E /* '~' */ ) {
                compiledMiss = FilterOriginMiss.compile(domainOpt);
            }
            // Must be a hit
            else {
                compiledHit = FilterOriginHit.compile(domainOpt);
            }
        }
        // Many hostnames.
        // Must be in set (none negated).
        else if ( domainOpt.indexOf('~') === -1 ) {
            compiledHit = FilterOriginHitSet.compile(domainOpt);
        }
        // Must not be in set (all negated).
        else if ( /^~(?:[^|~]+\|~)+[^|~]+$/.test(domainOpt) ) {
            compiledMiss = FilterOriginMissSet.compile(domainOpt);
        }
        // Must be in one set, but not in the other.
        else {
            const hostnames = domainOpt.split('|');
            const missSet = hostnames.filter(hn => {
                if ( hn.charCodeAt(0) === 0x7E /* '~' */ ) {
                    return hn;
                }
            });
            const hitSet = hostnames.filter(hn => {
                if ( hn.charCodeAt(0) !== 0x7E /* '~' */ ) {
                    return hn;
                }
            });
            compiledMiss = missSet.length === 1
                ? FilterOriginMiss.compile(missSet[0])
                : FilterOriginMissSet.compile(missSet.join('|'));
            compiledHit = hitSet.length === 1
                ? FilterOriginHit.compile(hitSet[0])
                : FilterOriginHitSet.compile(hitSet.join('|'));
        }
        if ( prepend ) {
            if ( compiledHit ) { units.unshift(compiledHit); }
            if ( compiledMiss ) { units.unshift(compiledMiss); }
        } else {
            if ( compiledMiss ) { units.push(compiledMiss); }
            if ( compiledHit ) { units.push(compiledHit); }
        }
    }

    prime() {
        this.trieContainer.reset(
            vAPI.localStorage.getItem('SNFE.filterOrigin.trieDetails')
        );
    }

    reset() {
        this.trieContainer.reset();
    }

    optimize() {
        vAPI.localStorage.setItem(
            'SNFE.filterOrigin.trieDetails',
            this.trieContainer.optimize()
        );
    }

    toSelfie() {
    }

    fromSelfie() {
    }
})();

/******************************************************************************/

const FilterOriginHit = class {
    constructor(hostname) {
        this.hostname = hostname;
    }

    match() {
        const haystack = $docHostname;
        const needle = this.hostname;
        const offset = haystack.length - needle.length;
        if ( offset < 0 ) { return false; }
        if ( haystack.charCodeAt(offset) !== needle.charCodeAt(0) ) {
            return false;
        }
        if ( haystack.endsWith(needle) === false ) { return false; }
        return offset === 0 || haystack.charCodeAt(offset-1) === 0x2E /* '.' */;
    }

    toSelfie() {
        return [ this.fid, this.hostname ];
    }

    logData(details) {
        details.domains.push(this.hostname);
    }

    static compile(domainOpt) {
        return [ FilterOriginHit.fid, domainOpt ];
    }

    static fromCompiled(args) {
        return new FilterOriginHit(args[1]);
    }

    static fromSelfie(args) {
        return new FilterOriginHit(args[1]);
    }
};

registerFilterClass(FilterOriginHit);

/******************************************************************************/

const FilterOriginMiss = class {
    constructor(hostname) {
        this.hostname = hostname.slice(1);
    }

    match() {
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
        return true;
    }

    logData(details) {
        details.domains.push(`~${this.hostname}`);
    }

    toSelfie() {
        return [ this.fid, `~${this.hostname}` ];
    }

    static compile(domainOpt) {
        return [ FilterOriginMiss.fid, domainOpt ];
    }

    static fromCompiled(args) {
        return new FilterOriginMiss(args[1]);
    }

    static fromSelfie(args) {
        return new FilterOriginMiss(args[1]);
    }
};

registerFilterClass(FilterOriginMiss);

/******************************************************************************/

const FilterOriginHitSet = class {
    constructor(domainOpt, oneOf = null) {
        this.domainOpt = domainOpt;
        this.oneOf = oneOf !== null
            ? filterOrigin.trieContainer.createOne(oneOf)
            : null;
    }

    match() {
        if ( this.oneOf === null ) {
            this.oneOf = filterOrigin.trieContainer.fromIterable(
                this.domainOpt.split('|')
            );
        }
        return this.oneOf.matches($docHostname) !== -1;
    }

    logData(details) {
        details.domains.push(this.domainOpt);
    }

    toSelfie() {
        return [
            this.fid,
            this.domainOpt,
            this.oneOf !== null
                ? filterOrigin.trieContainer.compileOne(this.oneOf)
                : null
        ];
    }

    static compile(domainOpt) {
        return [ FilterOriginHitSet.fid, domainOpt ];
    }

    static fromCompiled(args) {
        return new FilterOriginHitSet(args[1]);
    }

    static fromSelfie(args) {
        return new FilterOriginHitSet(args[1], args[2]);
    }

    static keyFromArgs(args) {
        return args[1];
    }
};

registerFilterClass(FilterOriginHitSet);

/******************************************************************************/

const FilterOriginMissSet = class {
    constructor(domainOpt, noneOf = null) {
        this.domainOpt = domainOpt;
        this.noneOf = noneOf !== null
            ? filterOrigin.trieContainer.createOne(noneOf)
            : null;
    }

    match() {
        if ( this.noneOf === null ) {
            this.noneOf = filterOrigin.trieContainer.fromIterable(
                this.domainOpt.replace(/~/g, '').split('|')
            );
        }
        return this.noneOf.matches($docHostname) === -1;
    }

    logData(details) {
        details.domains.push(this.domainOpt);
    }

    toSelfie() {
        return [
            this.fid,
            this.domainOpt,
            this.noneOf !== null
                ? filterOrigin.trieContainer.compileOne(this.noneOf)
                : null
        ];
    }

    static compile(domainOpt) {
        return [ FilterOriginMissSet.fid, domainOpt ];
    }

    static fromCompiled(args) {
        return new FilterOriginMissSet(args[1]);
    }

    static fromSelfie(args) {
        return new FilterOriginMissSet(args[1], args[2]);
    }

    static keyFromArgs(args) {
        return args[1];
    }
};

registerFilterClass(FilterOriginMissSet);

/******************************************************************************/

const FilterDataHolder = class {
    constructor(dataType, data) {
        this.dataType = dataType;
        this.data = data;
    }

    match() {
        return true;
    }

    matchAndFetchData(type, callback) {
        if ( this.dataType !== type ) { return; }
        callback(this);
    }

    getData(type) {
        if ( type === this.dataType ) {
            return this.data;
        }
    }

    logData(details) {
        let opt = this.dataType;
        if ( this.data !== '' ) {
            opt += `=${this.data}`;
        }
        details.options.push(opt);
    }

    toSelfie() {
        return [ this.fid, this.dataType, this.data ];
    }

    static compile(details) {
        return [ FilterDataHolder.fid, details.dataType, details.data ];
    }

    static fromCompiled(args) {
        return new FilterDataHolder(args[1], args[2]);
    }

    static fromSelfie(args) {
        return new FilterDataHolder(args[1], args[2]);
    }

    static keyFromArgs(args) {
        return `${args[1]}\t${args[2]}`;
    }
};

registerFilterClass(FilterDataHolder);

// Helper class for storing instances of FilterDataHolder which were found to
// be a match.

const FilterDataHolderResult = class {
    constructor(bits, th, iunit) {
        this.bits = bits;
        this.th = th;
        this.iunit = iunit;
    }

    getData(type) {
        return filterUnits[this.iunit].getData(type);
    }

    get result() {
        return (this.bits & AllowAction) === 0 ? 1 : 2;
    }

    logData() {
        const r = toLogDataInternal(this.bits, this.th, this.iunit);
        r.source = 'static';
        r.result = this.result;
        return r;
    }
};

/******************************************************************************/

const FilterCollection = class {
    constructor(i = 0) {
        this.i = i | 0;
    }

    get size() {
        let n = 0;
        this.forEach(( ) => { n += 1; });
        return n;
    }

    unshift(iunit) {
        const j = this.i;
        this.i = filterSequenceAdd(iunit, j);
    }

    shift() {
        const sequences = filterSequences;
        filterUnits[sequences[this.i+0]] = null;
        this.i = sequences[this.i+1];
    }

    forEach(fn) {
        let i = this.i;
        if ( i === 0 ) { return; }
        const sequences = filterSequences;
        do {
            const iunit = sequences[i+0];
            const r = fn(iunit);
            if ( r !== undefined ) { return r; }
            i = sequences[i+1];
        } while ( i !== 0 );
    }

    toSelfie() {
        return [ this.fid, this.i ];
    }

    static compile(ctor, fdata) {
        return [ ctor.fid, fdata ];
    }

    static fromCompiled(ctor, args) {
        let iprev = 0, i0 = 0;
        const n = args[1].length;
        for ( let i = 0; i < n; i++ ) {
            const iunit = filterUnitFromCompiled(args[1][i]);
            const inext = filterSequenceAdd(iunit, 0);
            if ( iprev !== 0 ) {
                filterSequences[iprev+1] = inext;
            } else {
                i0 = inext;
            }
            iprev = inext;
        }
        return new ctor(i0, args[1].length);
    }

    static fromSelfie(ctor, args) {
        return new ctor(args[1]);
    }
};

/******************************************************************************/

const FilterComposite = class extends FilterCollection {
    match() {
        const sequences = filterSequences;
        const units = filterUnits;
        let i = this.i;
        while ( i !== 0 ) {
            if ( units[sequences[i+0]].match() !== true ) { return false; }
            i = sequences[i+1];
        }
        return true;
    }

    matchAndFetchData(type, callback) {
        if ( this.match() !== true ) { return false; }
        this.forEach(iunit => {
            const f = filterUnits[iunit];
            if ( f.matchAndFetchData instanceof Function === false ) { return; }
            f.matchAndFetchData(type, ( ) => { callback(this); });
        });
    }

    getData(type) {
        return this.forEach(iunit => {
            const f = filterUnits[iunit];
            if ( f.matchAndFetchData instanceof Function ) {
                return f.getData(type);
            }
        });
    }

    // FilterPatternPlain is assumed to be first filter in sequence. This can
    // be revisited if needed.
    get isBidiTrieable() {
        return filterUnits[filterSequences[this.i]].isBidiTrieable === true;
    }

    toBidiTrie() {
        const details = filterUnits[filterSequences[this.i]].toBidiTrie();
        this.shift();
        return details;
    }

    logData(details) {
        this.forEach(iunit => {
            filterUnits[iunit].logData(details);
        });
    }

    static compile(fdata) {
        return FilterCollection.compile(FilterComposite, fdata);
    }

    static fromCompiled(args) {
        return FilterCollection.fromCompiled(FilterComposite, args);
    }

    static fromSelfie(args) {
        return FilterCollection.fromSelfie(FilterComposite, args);
    }
};

registerFilterClass(FilterComposite);

/******************************************************************************/

// Dictionary of hostnames

const FilterHostnameDict = class {
    constructor(args) {
        this.$h = ''; // short-lived register
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
        this.$h = $requestHostname.slice(pos);
        return true;
    }

    logData(details) {
        details.pattern.push('||', this.$h, '^');
        details.regex.push(restrFromPlainPattern(this.$h), restrSeparator);
    }

    toSelfie() {
        return [
            this.fid,
            FilterHostnameDict.trieContainer.compileOne(this.dict)
        ];
    }

    static prime() {
        return FilterHostnameDict.trieContainer.reset(
            vAPI.localStorage.getItem('SNFE.FilterHostnameDict.trieDetails')
        );
    }

    static reset() {
        return FilterHostnameDict.trieContainer.reset();
    }

    static optimize() {
        vAPI.localStorage.setItem(
            'SNFE.FilterHostnameDict.trieDetails',
            FilterHostnameDict.trieContainer.optimize()
        );
    }

    static fromSelfie(args) {
        return new FilterHostnameDict(args[1]);
    }
};

FilterHostnameDict.trieContainer = new µb.HNTrieContainer();

registerFilterClass(FilterHostnameDict);

/******************************************************************************/

const FilterDenyAllow = class {
    constructor(s, trieArgs) {
        this.s = s;
        this.hndict = FilterHostnameDict.trieContainer.createOne(trieArgs);
    }

    match() {
        return this.hndict.matches($requestHostname) === -1;
    }

    logData(details) {
        details.denyallow.push(this.s);
    }

    toSelfie() {
        return [
            this.fid,
            this.s,
            FilterHostnameDict.trieContainer.compileOne(this.hndict),
        ];
    }

    static compile(details) {
        return [ FilterDenyAllow.fid, details.denyallow ];
    }

    static fromCompiled(args) {
        const f = new FilterDenyAllow(args[1]);
        for ( const hn of args[1].split('|') ) {
            if ( hn === '' ) { continue; }
            f.hndict.add(hn);
        }
        return f;
    }

    static fromSelfie(args) {
        return new FilterDenyAllow(...args.slice(1));
    }

    static keyFromArgs(args) {
        return args[1];
    }
};

registerFilterClass(FilterDenyAllow);

/******************************************************************************/

// Dictionary of hostnames for filters which only purpose is to match
// the document origin.

const FilterJustOrigin = class {
    constructor(args) {
        this.$h = ''; // short-lived register
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
        this.$h = $docHostname.slice(pos);
        return true;
    }

    logData(details) {
        details.pattern.push('*');
        details.regex.push('^');
        details.domains.push(this.$h);
    }

    toSelfie() {
        return [ this.fid, filterOrigin.trieContainer.compileOne(this.dict) ];
    }

    static fromCompiled(args) {
        return new FilterJustOrigin(args[1]);
    }

    static fromSelfie(args) {
        return new FilterJustOrigin(args[1]);
    }
};

registerFilterClass(FilterJustOrigin);

/******************************************************************************/

const FilterHTTPSJustOrigin = class extends FilterJustOrigin {
    match() {
        return $requestURL.startsWith('https://') && super.match();
    }

    logData(details) {
        details.pattern.push('|https://');
        details.regex.push('^https://');
        details.domains.push(this.$h);
    }

    static fromCompiled(args) {
        return new FilterHTTPSJustOrigin(args[1]);
    }

    static fromSelfie(args) {
        return new FilterHTTPSJustOrigin(args[1]);
    }
};

registerFilterClass(FilterHTTPSJustOrigin);

/******************************************************************************/

const FilterHTTPJustOrigin = class extends FilterJustOrigin {
    match() {
        return $requestURL.startsWith('http://') && super.match();
    }

    logData(details) {
        details.pattern.push('|http://');
        details.regex.push('^http://');
        details.domains.push(this.$h);
    }

    static fromCompiled(args) {
        return new FilterHTTPJustOrigin(args[1]);
    }

    static fromSelfie(args) {
        return new FilterHTTPJustOrigin(args[1]);
    }
};

registerFilterClass(FilterHTTPJustOrigin);

/******************************************************************************/

const FilterPlainTrie = class {
    constructor(trie) {
        this.plainTrie = trie;
    }

    match() {
        if ( this.plainTrie.matches($tokenBeg) !== 0 ) {
            this.$matchedUnit = this.plainTrie.$iu;
            return true;
        }
        return false;
    }

    matchAndFetchData(/* type, out */) {
        // TODO
    }

    logData(details) {
        const s = $requestURL.slice(this.plainTrie.$l, this.plainTrie.$r);
        details.pattern.push(s);
        details.regex.push(restrFromPlainPattern(s));
        if ( this.$matchedUnit !== -1 ) {
            filterUnits[this.$matchedUnit].logData(details);
        }
    }

    toSelfie() {
        return [ this.fid, bidiTrie.compileOne(this.plainTrie) ];
    }

    static fromSelfie(args) {
        return new FilterPlainTrie(bidiTrie.createOne(args[1]));
    }
};

FilterPlainTrie.prototype.$matchedUnit = 0;

registerFilterClass(FilterPlainTrie);

/******************************************************************************/

const FilterBucket = class extends FilterCollection {
    match() {
        if ( this.plainTrie !== null ) {
            if ( this.plainTrie.matches($tokenBeg, this) !== 0 ) {
                this.$matchedTrie = true;
                this.$matchedUnit = this.plainTrie.$iu;
                return true;
            }
        }
        const sequences = filterSequences;
        const units = filterUnits;
        let i = this.i;
        while ( i !== 0 ) {
            if ( units[sequences[i+0]].match() ) {
                this.$matchedTrie = false;
                this.$matchedUnit = sequences[i+0];
                return true;
            }
            i = sequences[i+1];
        }
        return false;
    }

    matchAndFetchData(type, callback) {
        const units = filterUnits;
        this.forEach(iunit => {
            units[iunit].matchAndFetchData(type, f => {
                callback(f, iunit);
            });
        });
    }

    logData(details) {
        if ( this.$matchedTrie ) {
            const s = $requestURL.slice(this.plainTrie.$l, this.plainTrie.$r);
            details.pattern.push(s);
            details.regex.push(restrFromPlainPattern(s));
        }
        if ( this.$matchedUnit !== -1 ) {
            filterUnits[this.$matchedUnit].logData(details);
        }
    }

    toSelfie() {
        const selfie = super.toSelfie();
        if ( this.plainTrie !== null ) {
            selfie.push(bidiTrie.compileOne(this.plainTrie));
        }
        return selfie;
    }

    optimize() {
        const units = filterUnits;
        let n = 0;
        let i = this.i;
        do {
            if ( units[filterSequences[i+0]].isBidiTrieable ) { n += 1; }
            i = filterSequences[i+1];
        } while ( i !== 0 && n < 3 );
        if ( n < 3 ) { return; }
        if ( this.plainTrie === null ) {
            this.plainTrie = bidiTrie.createOne();
        }
        i = this.i;
        let iprev = 0;
        for (;;) {
            const iunit = filterSequences[i+0];
            const inext = filterSequences[i+1];
            if ( units[iunit].isBidiTrieable ) {
                this._addToTrie(iunit);
                if ( iprev !== 0 ) {
                    filterSequences[iprev+1] = inext;
                } else {
                    this.i = inext;
                }
            } else {
                iprev = i;
            }
            if ( inext === 0 ) { break; }
            i = inext;
        }
        if ( this.i === 0 ) {
            return new FilterPlainTrie(this.plainTrie);
        }
    }

    _addToTrie(iunit) {
        const f = filterUnits[iunit];
        const trieDetails = f.toBidiTrie();
        const id = this.plainTrie.add(
            trieDetails.i,
            trieDetails.n,
            trieDetails.itok
        );
        // No point storing a pattern with conditions if the bidi-trie already
        // contain a pattern with no conditions.
        let ix = this.plainTrie.getExtra(id);
        if ( ix === 1 ) {
            filterUnits[iunit] = null;
            return;
        }
        // If the newly stored pattern has no condition, shortcut existing
        // ones since they will always be short-circuited by the
        // condition-less pattern.
        if ( f instanceof FilterPatternPlain ) {
            this.plainTrie.setExtra(id, 1);
            filterUnits[iunit] = null;
            return;
        }
        // FilterComposite is assumed here, i.e. with conditions.
        if ( f.n === 1 ) {
            filterUnits[iunit] = null;
            iunit = filterSequences[f.i];
        }
        this.plainTrie.setExtra(id, filterSequenceAdd(iunit, ix));
    }

    static fromSelfie(args) {
        const bucket = FilterCollection.fromSelfie(FilterBucket, args);
        if ( args.length > 2 && Array.isArray(args[2]) ) {
            bucket.plainTrie = bidiTrie.createOne(args[2]);
        }
        return bucket;
    }
};

FilterBucket.prototype.plainTrie = null;
FilterBucket.prototype.$matchedUnit = 0;
FilterBucket.prototype.$matchedTrie = false;

registerFilterClass(FilterBucket);

/******************************************************************************/

const FILTER_UNITS_MIN = filterUnits.length;
const FILTER_SEQUENCES_MIN = filterSequenceWritePtr;

/******************************************************************************/
/******************************************************************************/

const FilterParser = class {
    constructor() {
        this.cantWebsocket = vAPI.cantWebsocket;
        this.domainOpt = '';
        this.noTokenHash = urlTokenizer.noTokenHash;
        this.reBadDomainOptChars = /[*+?^${}()[\]\\]/;
        this.reHostnameRule1 = /^\w[\w.-]*[a-z]$/i;
        this.reHostnameRule2 = /^\w[\w.-]*[a-z]\^?$/i;
        this.reCanTrimCarets1 = /^[^*]*$/;
        this.reCanTrimCarets2 = /^\^?[^^]+[^^][^^]+\^?$/;
        this.reIsolateHostname = /^(\*?\.)?([^\x00-\x24\x26-\x2C\x2F\x3A-\x5E\x60\x7B-\x7F]+)(.*)/;
        this.reHasUnicode = /[^\x00-\x7F]/;
        this.reWebsocketAny = /^ws[s*]?(?::\/?\/?)?\*?$/;
        this.reBadCSP = /(?:=|;)\s*report-(?:to|uri)\b/;
        this.reGoodToken = /[%0-9a-z]{1,}/g;
        this.reSeparator = /[\/^]/;
        this.reRegexToken = /[%0-9A-Za-z]{2,}/g;
        this.reRegexTokenAbort = /[([]/;
        this.reRegexBadPrefix = /(^|[^\\]\.|[*?{}\\])$/;
        this.reRegexBadSuffix = /^([^\\]\.|\\[dw]|[([{}?*.]|$)/;
        // These top 100 "bad tokens" are collated using the "miss" histogram
        // from tokenHistograms(). The "score" is their occurrence among the
        // 200K+ URLs used in the benchmark and executed against default
        // filter lists.
        this.badTokens = new Map([
            [ 'https',123617 ],
            [ 'com',76987 ],
            [ 'js',43620 ],
            [ 'www',33129 ],
            [ 'jpg',32221 ],
            [ 'images',31812 ],
            [ 'css',19715 ],
            [ 'png',19140 ],
            [ 'static',15724 ],
            [ 'net',15239 ],
            [ 'de',13155 ],
            [ 'img',11109 ],
            [ 'assets',10746 ],
            [ 'min',7807 ],
            [ 'cdn',7568 ],
            [ 'content',6900 ],
            [ 'wp',6444 ],
            [ 'fonts',6095 ],
            [ 'svg',5976 ],
            [ 'http',5813 ],
            [ 'ssl',5735 ],
            [ 'amazon',5440 ],
            [ 'ru',5427 ],
            [ 'fr',5199 ],
            [ 'facebook',5178 ],
            [ 'en',5146 ],
            [ 'image',5028 ],
            [ 'html',4837 ],
            [ 'media',4833 ],
            [ 'co',4783 ],
            [ 'php',3972 ],
            [ '2019',3943 ],
            [ 'org',3924 ],
            [ 'jquery',3531 ],
            [ '02',3438 ],
            [ 'api',3382 ],
            [ 'gif',3350 ],
            [ 'eu',3322 ],
            [ 'prod',3289 ],
            [ 'woff2',3200 ],
            [ 'logo',3194 ],
            [ 'themes',3107 ],
            [ 'icon',3048 ],
            [ 'google',3026 ],
            [ 'v1',3019 ],
            [ 'uploads',2963 ],
            [ 'googleapis',2860 ],
            [ 'v3',2816 ],
            [ 'tv',2762 ],
            [ 'icons',2748 ],
            [ 'core',2601 ],
            [ 'gstatic',2581 ],
            [ 'ac',2509 ],
            [ 'utag',2466 ],
            [ 'id',2459 ],
            [ 'ver',2448 ],
            [ 'rsrc',2387 ],
            [ 'files',2361 ],
            [ 'uk',2357 ],
            [ 'us',2271 ],
            [ 'pl',2262 ],
            [ 'common',2205 ],
            [ 'public',2076 ],
            [ '01',2016 ],
            [ 'na',1957 ],
            [ 'v2',1954 ],
            [ '12',1914 ],
            [ 'thumb',1895 ],
            [ 'web',1853 ],
            [ 'ui',1841 ],
            [ 'default',1825 ],
            [ 'main',1737 ],
            [ 'false',1715 ],
            [ '2018',1697 ],
            [ 'embed',1639 ],
            [ 'player',1634 ],
            [ 'dist',1599 ],
            [ 'woff',1593 ],
            [ 'global',1593 ],
            [ 'json',1572 ],
            [ '11',1566 ],
            [ '600',1559 ],
            [ 'app',1556 ],
            [ 'styles',1533 ],
            [ 'plugins',1526 ],
            [ '274',1512 ],
            [ 'random',1505 ],
            [ 'sites',1505 ],
            [ 'imasdk',1501 ],
            [ 'bridge3',1501 ],
            [ 'news',1496 ],
            [ 'width',1494 ],
            [ 'thumbs',1485 ],
            [ 'ttf',1470 ],
            [ 'ajax',1463 ],
            [ 'user',1454 ],
            [ 'scripts',1446 ],
            [ 'twitter',1440 ],
            [ 'crop',1431 ],
            [ 'new',1412]
        ]);
        this.maxTokenLen = urlTokenizer.MAX_TOKEN_LENGTH;
        this.reset();
    }

    reset() {
        this.action = BlockAction;
        // anchor: bit vector
        //   0000 (0x0): no anchoring
        //   0001 (0x1): anchored to the end of the URL.
        //   0010 (0x2): anchored to the start of the URL.
        //   0011 (0x3): anchored to the start and end of the URL.
        //   0100 (0x4): anchored to the hostname of the URL.
        //   0101 (0x5): anchored to the hostname and end of the URL.
        this.anchor = 0;
        this.badFilter = false;
        this.dataType = undefined;
        this.data = undefined;
        this.invalid = false;
        this.f = '';
        this.firstParty = false;
        this.thirdParty = false;
        this.party = AnyParty;
        this.fopts = '';
        this.domainOpt = '';
        this.denyallow = '';
        this.isPureHostname = false;
        this.isRegex = false;
        this.raw = '';
        this.redirect = 0;
        this.token = '*';
        this.tokenHash = this.noTokenHash;
        this.tokenBeg = 0;
        this.typeBits = 0;
        this.notTypes = 0;
        this.important = 0;
        this.firstWildcardPos = -1;
        this.secondWildcardPos = -1;
        this.firstCaretPos = -1;
        this.secondCaretPos = -1;
        this.unsupported = false;
        return this;
    }

    normalizeRegexSource(s) {
        try {
            const re = new RegExp(s);
            return re.source;
        } catch (ex) {
        }
        return '';
    }

    bitFromType(type) {
        return 1 << ((typeNameToTypeValue[type] >>> 4) - 1);
    }

    // https://github.com/chrisaljoudi/uBlock/issues/589
    // Be ready to handle multiple negated types

    parseTypeOption(raw, not) {
        const typeBit = raw !== 'all'
            ? this.bitFromType(toNormalizedType[raw])
            : allTypesBits;
        if ( not ) {
            this.notTypes |= typeBit;
        } else {
            this.typeBits |= typeBit;
        }
    }

    parsePartyOption(firstParty, not) {
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
    }

    parseHostnameList(s) {
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
    }

    parseOptions(s) {
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
                this.domainOpt = this.parseHostnameList(opt.slice(7));
                if ( this.domainOpt === '' ) {
                    this.unsupported = true;
                    break;
                }
                continue;
            }
            if ( opt.startsWith('denyallow=') ) {
                this.denyallow = this.parseHostnameList(opt.slice(10));
                if ( this.denyallow === '' ) {
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
            // https://kb.adguard.com/en/general/how-to-create-your-own-ad-filters#empty-modifier
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
            this.typeBits |= allNetworkTypesBits;
        }
        if ( this.notTypes !== 0 ) {
            this.typeBits &= ~this.notTypes;
            if ( this.typeBits === 0 ) {
                this.unsupported = true;
            }
        }

        // https://github.com/gorhill/uBlock/issues/2283
        //   Abort if type is only for unsupported types, otherwise
        //   toggle off `unsupported` bit.
        if ( this.typeBits & unsupportedTypeBit ) {
            this.typeBits &= ~unsupportedTypeBit;
            if ( this.typeBits === 0 ) {
                this.unsupported = true;
            }
        }
    }

    // TODO: use charCodeAt where possible.

    parse(raw) {
        // important!
        this.reset();

        let s = this.raw = raw.trim();

        if ( s.length === 0 ) {
            this.invalid = true;
            return this;
        }

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
            this.anchor |= 0b100;
            return this;
        }

        // element hiding filter?
        let pos = s.indexOf('#');
        if ( pos !== -1 ) {
            const c = s.charAt(pos + 1);
            if ( c === '#' || c === '@' ) {
                console.error('static-net-filtering.js > unexpected cosmetic filters');
                this.invalid = true;
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
        if (
            s.charCodeAt(0) !== 0x2F /* '/' */ ||
            s.charCodeAt(s.length - 1) !== 0x2F /* '/' */
        ) {
            pos = s.lastIndexOf('$');
            if ( pos !== -1 ) {
                // https://github.com/gorhill/uBlock/issues/952
                //   Discard Adguard-specific `$$` filters.
                if ( s.indexOf('$$') !== -1 ) {
                    this.unsupported = true;
                    return this;
                }
                this.parseOptions(s.slice(pos + 1).trim());
                if ( this.unsupported ) { return this; }
                s = s.slice(0, pos);
            }
        }

        // regex?
        if (
            s.length > 2 &&
            s.charCodeAt(0) === 0x2F /* '/' */ &&
            s.charCodeAt(s.length - 1) === 0x2F /* '/' */
        ) {
            this.isRegex = true;
            this.f = s.slice(1, -1);
            // https://github.com/gorhill/uBlock/issues/1246
            //   If the filter is valid, use the corrected version of the
            //   source string -- this ensure reverse-lookup will work fine.
            this.f = this.normalizeRegexSource(this.f);
            if ( this.f === '' ) {
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
                }
            }

            // https://github.com/chrisaljoudi/uBlock/issues/1096
            if ( s.startsWith('^') ) {
                this.unsupported = true;
                return this;
            }

            // plain hostname? (from ABP filter list)
            // https://github.com/gorhill/uBlock/issues/1757
            // A filter can't be a pure-hostname one if there is a domain or
            // csp option present.
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
        //   Remove pointless leading *.
        // https://github.com/gorhill/uBlock/issues/3034
        //   We can remove anchoring if we need to match all at the start.
        if ( s.startsWith('*') ) {
            s = s.replace(/^\*+([^%0-9a-z])/i, '$1');
            this.anchor &= ~0x6;
        }
        // Remove pointless trailing *
        // https://github.com/gorhill/uBlock/issues/3034
        //   We can remove anchoring if we need to match all at the end.
        if ( s.endsWith('*') ) {
            s = s.replace(/([^%0-9a-z])\*+$/i, '$1');
            this.anchor &= ~0x1;
        }

        // nothing left?
        if ( s === '' ) {
            s = '*';
        }
        // TODO: remove once redirect rules with `*/*` pattern are no longer
        //       used.
        else if ( this.redirect !== 0 && s === '/' ) {
            s = '*';
        }

        // https://github.com/gorhill/uBlock/issues/1047
        //   Hostname-anchored makes no sense if matching all requests.
        if ( s === '*' ) {
            this.anchor = 0;
        }

        this.firstWildcardPos = s.indexOf('*');
        if ( this.firstWildcardPos !== -1 ) {
            this.secondWildcardPos = s.indexOf('*', this.firstWildcardPos + 1);
        }
        this.firstCaretPos = s.indexOf('^');
        if ( this.firstCaretPos !== -1 ) {
            this.secondCaretPos = s.indexOf('^', this.firstCaretPos + 1);
        }

        if ( s.length > 1024 ) {
            this.unsupported = true;
            return this;
        }

        this.f = s.toLowerCase();

        return this;
    }

    // Given a string, find a good token. Tokens which are too generic,
    // i.e. very common with a high probability of ending up as a miss,
    // are not good. Avoid if possible. This has a significant positive
    // impact on performance.

    makeToken() {
        if ( this.isRegex ) {
            this.extractTokenFromRegex();
            return;
        }
        if ( this.f === '*' ) { return; }
        const matches = this.findGoodToken();
        if ( matches === null ) { return; }
        this.token = matches[0];
        this.tokenHash = urlTokenizer.tokenHashFromString(this.token);
        this.tokenBeg = matches.index;
    }

    findGoodToken() {
        this.reGoodToken.lastIndex = 0;
        const s = this.f;
        let bestMatch = null;
        let bestBadness = 0;
        let match;
        while ( (match = this.reGoodToken.exec(s)) !== null ) {
            const token = match[0];
            // https://github.com/gorhill/uBlock/issues/997
            //   Ignore token if preceded by wildcard.
            const pos = match.index;
            if (
                pos !== 0 &&
                    s.charCodeAt(pos - 1) === 0x2A /* '*' */ ||
                token.length < this.maxTokenLen &&
                    s.charCodeAt(pos + token.length) === 0x2A /* '*' */
            ) {
                continue;
            }
            // A one-char token is better than a documented bad token.
            const badness = token.length > 1
                ? this.badTokens.get(token) || 0
                : 1;
            if ( badness === 0 ) { return match; }
            if ( bestBadness === 0 || badness < bestBadness ) {
                bestMatch = match;
                bestBadness = badness;
            }
        }
        return bestMatch;
    }

    // https://github.com/gorhill/uBlock/issues/2781
    //   For efficiency purpose, try to extract a token from
    //   a regex-based filter.
    extractTokenFromRegex() {
        this.reRegexToken.lastIndex = 0;
        const s = this.f;
        let matches;
        while ( (matches = this.reRegexToken.exec(s)) !== null ) {
            const prefix = s.slice(0, matches.index);
            if ( this.reRegexTokenAbort.test(prefix) ) { return; }
            if (
                this.reRegexBadPrefix.test(prefix) || (
                    matches[0].length < this.maxTokenLen &&
                    this.reRegexBadSuffix.test(
                        s.slice(this.reRegexToken.lastIndex)
                    )
                )
            ) {
                continue;
            }
            this.token = matches[0].toLowerCase();
            this.tokenHash = urlTokenizer.tokenHashFromString(this.token);
            this.tokenBeg = matches.index;
            if ( this.badTokens.has(this.token) === false ) { break; }
        }
    }

    isJustOrigin() {
        return this.isRegex === false &&
            this.dataType === undefined &&
            this.denyallow === '' &&
            this.domainOpt !== '' && (
                this.f === '*' || (
                    this.anchor === 0b010 &&
                    /^(?:http[s*]?:(?:\/\/)?)$/.test(this.f)
                )
            ) &&
            this.domainOpt.indexOf('~') === -1;
    }
};

/******************************************************************************/

FilterParser.parse = (( ) => {
    let parser;
    let last = 0;
    let ttlTimer;

    const ttlProcess = ( ) => {
        ttlTimer = undefined;
        if ( (Date.now() - last) > 10000 ) {
            parser = undefined;
            return;
        }
        ttlTimer = vAPI.setTimeout(ttlProcess, 10007);
    };

    return s => {
        if ( parser === undefined ) {
            parser = new FilterParser();
        }
        last = Date.now();
        if ( ttlTimer === undefined ) {
            ttlTimer = vAPI.setTimeout(ttlProcess, 10007);
        }
        return parser.parse(s);
    };
})();

/******************************************************************************/
/******************************************************************************/

const FilterContainer = function() {
    this.noTokenHash = urlTokenizer.noTokenHash;
    this.dotTokenHash = urlTokenizer.dotTokenHash;
    this.anyTokenHash = urlTokenizer.anyTokenHash;
    this.anyHTTPSTokenHash = urlTokenizer.anyHTTPSTokenHash;
    this.anyHTTPTokenHash = urlTokenizer.anyHTTPTokenHash;
    this.reset();
};

/******************************************************************************/

FilterContainer.prototype.prime = function() {
    FilterHostnameDict.prime();
    filterOrigin.prime();
    bidiTriePrime();
};

/******************************************************************************/

FilterContainer.prototype.reset = function() {
    this.processedFilterCount = 0;
    this.acceptedCount = 0;
    this.rejectedCount = 0;
    this.allowFilterCount = 0;
    this.blockFilterCount = 0;
    this.discardedCount = 0;
    this.goodFilters = new Set();
    this.badFilters = new Set();
    this.categories = new Map();

    urlTokenizer.resetKnownTokens();

    // This will invalidate all tries
    FilterHostnameDict.reset();
    filterOrigin.reset();
    bidiTrie.reset();
    filterArgsToUnit.clear();

    filterUnits = filterUnits.slice(0, FILTER_UNITS_MIN);
    filterSequenceWritePtr = FILTER_SEQUENCES_MIN;

    // Runtime registers
    this.$catbits = 0;
    this.$tokenHash = 0;
    this.$filterUnit = 0;
};

/******************************************************************************/

FilterContainer.prototype.freeze = function() {
    const filterBucketId = FilterBucket.fid;
    const redirectTypeValue = typeNameToTypeValue.redirect;
    const unserialize = µb.CompiledLineIO.unserialize;
    const units = filterUnits;

    const t0 = Date.now();

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
        let iunit = bucket.get(tokenHash);

        if ( tokenHash === this.dotTokenHash ) {
            if ( iunit === undefined ) {
                iunit = filterFromCtor(FilterHostnameDict);
                bucket.set(this.dotTokenHash, iunit);
            }
            units[iunit].add(fdata);
            continue;
        }

        if ( tokenHash === this.anyTokenHash ) {
            if ( iunit === undefined ) {
                iunit = filterFromCtor(FilterJustOrigin);
                bucket.set(this.anyTokenHash, iunit);
            }
            units[iunit].add(fdata);
            continue;
        }

        if ( tokenHash === this.anyHTTPSTokenHash ) {
            if ( iunit === undefined ) {
                iunit = filterFromCtor(FilterHTTPSJustOrigin);
                bucket.set(this.anyHTTPSTokenHash, iunit);
            }
            units[iunit].add(fdata);
            continue;
        }

        if ( tokenHash === this.anyHTTPTokenHash ) {
            if ( iunit === undefined ) {
                iunit = filterFromCtor(FilterHTTPJustOrigin);
                bucket.set(this.anyHTTPTokenHash, iunit);
            }
            units[iunit].add(fdata);
            continue;
        }

        urlTokenizer.addKnownToken(tokenHash);

        const inewunit = filterUnitFromCompiled(fdata);

        if ( iunit === undefined ) {
            bucket.set(tokenHash, inewunit);
            continue;
        }
        let f = units[iunit];
        if ( f.fid === filterBucketId ) {
            f.unshift(inewunit);
            continue;
        }
        const ibucketunit = filterFromCtor(FilterBucket);
        f = units[ibucketunit];
        f.unshift(iunit);
        f.unshift(inewunit);
        bucket.set(tokenHash, ibucketunit);
    }

    this.badFilters.clear();
    this.goodFilters.clear();

    // Skip 'data' type since bidi-trie does not (yet) support matchAll().
    const dataTypeValue = typeValueFromCatBits(typeNameToTypeValue['data']);
    for ( const [ catBits, bucket ] of this.categories ) {
        if ( typeValueFromCatBits(catBits) === dataTypeValue ) { continue; }
        for ( const iunit of bucket.values() ) {
            const f = units[iunit];
            if ( f instanceof FilterBucket === false ) { continue; }
            const g = f.optimize();
            if ( g !== undefined ) {
                units[iunit] = g;
            }
        }
    }

    FilterHostnameDict.optimize();
    bidiTrieOptimize();
    filterArgsToUnit.clear();

    log.info(`staticNetFilteringEngine.freeze() took ${Date.now()-t0} ms`);
};

/******************************************************************************/

FilterContainer.prototype.toSelfie = function(path) {
    const categoriesToSelfie = ( ) => {
        const selfie = [];
        for ( const [ catbits, bucket ] of this.categories ) {
            selfie.push([ catbits, Array.from(bucket) ]);
        }
        return selfie;
    };

    bidiTrieOptimize(true);
    filterOrigin.optimize();

    return Promise.all([
        µb.assets.put(
            `${path}/FilterHostnameDict.trieContainer`,
            FilterHostnameDict.trieContainer.serialize(µb.base64)
        ),
        µb.assets.put(
            `${path}/FilterOrigin.trieContainer`,
            filterOrigin.trieContainer.serialize(µb.base64)
        ),
        µb.assets.put(
            `${path}/bidiTrie`,
            bidiTrie.serialize(µb.base64)
        ),
        µb.assets.put(
            `${path}/filterSequences`,
            µb.base64.encode(
                filterSequences.buffer,
                filterSequenceWritePtr << 2
            )
        ),
        µb.assets.put(
            `${path}/main`,
            JSON.stringify({
                processedFilterCount: this.processedFilterCount,
                acceptedCount: this.acceptedCount,
                rejectedCount: this.rejectedCount,
                allowFilterCount: this.allowFilterCount,
                blockFilterCount: this.blockFilterCount,
                discardedCount: this.discardedCount,
                categories: categoriesToSelfie(),
                urlTokenizer: urlTokenizer.toSelfie(),
                filterUnits: filterUnits.map(f =>
                    f !== null ? f.toSelfie() : null
                ),
            })
        )
    ]);
};

/******************************************************************************/

FilterContainer.prototype.fromSelfie = function(path) {
    return Promise.all([
        µb.assets.get(`${path}/FilterHostnameDict.trieContainer`).then(details =>
            FilterHostnameDict.trieContainer.unserialize(
                details.content,
                µb.base64
            )
        ),
        µb.assets.get(`${path}/FilterOrigin.trieContainer`).then(details =>
            filterOrigin.trieContainer.unserialize(
                details.content,
                µb.base64
            )
        ),
        µb.assets.get(`${path}/bidiTrie`).then(details =>
            bidiTrie.unserialize(
                details.content,
                µb.base64
            )
        ),
        µb.assets.get(`${path}/filterSequences`).then(details => {
            const size = µb.base64.decodeSize(details.content) >> 2;
            if ( size === 0 ) { return false; }
            filterSequenceBufferResize(size);
            filterSequences = µb.base64.decode(
                details.content,
                filterSequences.buffer
            );
            filterSequenceWritePtr = size;
            return true;
        }),
        µb.assets.get(`${path}/main`).then(details => {
            let selfie;
            try {
                selfie = JSON.parse(details.content);
            } catch (ex) {
            }
            if ( selfie instanceof Object === false ) { return false; }
            this.processedFilterCount = selfie.processedFilterCount;
            this.acceptedCount = selfie.acceptedCount;
            this.rejectedCount = selfie.rejectedCount;
            this.allowFilterCount = selfie.allowFilterCount;
            this.blockFilterCount = selfie.blockFilterCount;
            this.discardedCount = selfie.discardedCount;
            urlTokenizer.fromSelfie(selfie.urlTokenizer);
            filterUnits = selfie.filterUnits.map(f =>
                f !== null ? filterFromSelfie(f) : null
            );
            for ( const [ catbits, bucket ] of selfie.categories ) {
                this.categories.set(catbits, new Map(bucket));
            }
            return true;
        }),
    ]).then(results =>
        results.every(v => v === true)
    );
};

/******************************************************************************/

FilterContainer.prototype.compile = function(raw, writer) {
    // ORDER OF TESTS IS IMPORTANT!

    const parsed = FilterParser.parse(raw);

    // Ignore non-static network filters
    if ( parsed.invalid ) { return false; }

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
        if ( parsed.redirect === 2 ) { return true; }
    }

    // Pure hostnames, use more efficient dictionary lookup
    // https://github.com/chrisaljoudi/uBlock/issues/665
    // Create a dict keyed on request type etc.
    if (
        parsed.isPureHostname &&
        parsed.domainOpt === '' &&
        parsed.denyallow === '' &&
        parsed.dataType === undefined
    ) {
        parsed.tokenHash = this.dotTokenHash;
        this.compileToAtomicFilter(parsed, parsed.f, writer);
        return true;
    }

    parsed.makeToken();

    const units = [];

    // Pattern
    if ( parsed.isPureHostname ) {
        parsed.anchor = 0;
        units.push(FilterPlainHostname.compile(parsed));
    } else if ( parsed.isJustOrigin() ) {
        const hostnames = parsed.domainOpt.split('|');
        if ( parsed.f === '*' ) {
            parsed.tokenHash = this.anyTokenHash;
            for ( const hn of hostnames ) {
                this.compileToAtomicFilter(parsed, hn, writer);
            }
            return true;
        }
        if ( parsed.f.startsWith('https') ) {
            parsed.tokenHash = this.anyHTTPSTokenHash;
            for ( const hn of hostnames ) {
                this.compileToAtomicFilter(parsed, hn, writer);
            }
            return true;
        }
        parsed.tokenHash = this.anyHTTPTokenHash;
        for ( const hn of hostnames ) {
            this.compileToAtomicFilter(parsed, hn, writer);
        }
        return true;
    } else {
        filterPattern.compile(parsed, units);
    }

    // Type
    // EXPERIMENT: $requestTypeBit
    //if ( (parsed.typeBits & allNetworkTypesBits) !== 0 ) {
    //    units.unshift(FilterType.compile(parsed));
    //    parsed.typeBits &= ~allNetworkTypesBits;
    //}

    // Anchor
    if ( (parsed.anchor & 0b100) !== 0 ) {
        units.push(FilterAnchorHn.compile());
    } else if ( (parsed.anchor & 0b010) !== 0 ) {
        units.push(FilterAnchorLeft.compile());
    }
    if ( (parsed.anchor & 0b001) !== 0 ) {
        units.push(FilterAnchorRight.compile());
    }

    // Origin
    if ( parsed.domainOpt !== '' ) {
        filterOrigin.compile(
            parsed,
            units.length !== 0 && filterClasses[units[0][0]].isSlow === true,
            units
        );
    }

    // Deny-allow
    if ( parsed.denyallow !== '' ) {
        units.push(FilterDenyAllow.compile(parsed));
    }

    // Data
    if ( parsed.dataType !== undefined ) {
        units.push(FilterDataHolder.compile(parsed));
    }

    const fdata = units.length === 1
        ? units[0]
        : FilterComposite.compile(units);

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
    let typeBits = parsed.typeBits;

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
            writer.push(
                [ descBits | (bitOffset << 4),
                parsed.tokenHash,
                fdata
            ]);
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

    const t = type, o = out;    // to avoid jshint warning
    const fdhr = (a, b, c) => new FilterDataHolderResult(a, b, c);
    const units = filterUnits;
    const tokenHashes = urlTokenizer.getTokens(bidiTrie);
    let i = 0;
    for (;;) {
        const th = tokenHashes[i];
        if ( th === 0 ) { return; }
        $tokenBeg = tokenHashes[i+1];
        if ( bucket01 !== undefined ) bucket01: {
            const iunit = bucket01.get(th);
            if ( iunit === undefined ) { break bucket01; }
            units[iunit].matchAndFetchData(type, (f, i) => {
                o.set(f.getData(t), fdhr(bits01, th, i || iunit));
            });
        }
        if ( bucket11 !== undefined ) bucket11: {
            const iunit = bucket11.get(th);
            if ( iunit === undefined ) { break bucket11; }
            units[iunit].matchAndFetchData(t, (f, i) => {
                o.set(f.getData(t), fdhr(bits11, th, i || iunit));
            });
        }
        i += 2;
    }
};

/******************************************************************************/

FilterContainer.prototype.matchAndFetchData = function(fctxt, type) {
    $requestURL = urlTokenizer.setURL(fctxt.url);
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

    const units = filterUnits;
    let catBits = 0, iunit = 0;

    // Pure hostname-based filters
    let tokenHash = this.dotTokenHash;
    if (
        (bucket00 !== undefined) &&
        (iunit = bucket00.get(tokenHash) || 0) !== 0 &&
        (units[iunit].match() === true)
    ) {
        catBits = catBits00;
    } else if (
        (bucket01 !== undefined) &&
        (iunit = bucket01.get(tokenHash) || 0) !== 0 &&
        (units[iunit].match() === true)
    ) {
        catBits = catBits01;
    } else if (
        (bucket10 !== undefined) &&
        (iunit = bucket10.get(tokenHash) || 0) !== 0 &&
        (units[iunit].match() === true)
    ) {
        catBits = catBits10;
    } else if (
        (bucket11 !== undefined) &&
        (iunit = bucket11.get(tokenHash) || 0) !== 0 &&
        (units[iunit].match() === true)
    ) {
        catBits = catBits11;
    }
    // Pattern-based filters
    else {
        const tokenHashes = urlTokenizer.getTokens(bidiTrie);
        let i = 0;
        for (;;) {
            tokenHash = tokenHashes[i];
            if ( tokenHash === 0 ) { return false; }
            $tokenBeg = tokenHashes[i+1];
            if (
                (bucket00 !== undefined) &&
                (iunit = bucket00.get(tokenHash) || 0) !== 0 &&
                (units[iunit].match() === true)
            ) {
                catBits = catBits00;
                break;
            }
            if (
                (bucket01 !== undefined) &&
                (iunit = bucket01.get(tokenHash) || 0) !== 0 &&
                (units[iunit].match() === true)
            ) {
                catBits = catBits01;
                break;
            }
            if (
                (bucket10 !== undefined) &&
                (iunit = bucket10.get(tokenHash) || 0) !== 0 &&
                (units[iunit].match() === true)
            ) {
                catBits = catBits10;
                break;
            }
            if (
                (bucket11 !== undefined) &&
                (iunit = bucket11.get(tokenHash) || 0) !== 0 &&
                (units[iunit].match() === true)
            ) {
                catBits = catBits11;
                break;
            }
            i += 2;
        }
    }

    this.$catbits = catBits;
    this.$tokenHash = tokenHash;
    this.$filterUnit = iunit;
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

FilterContainer.prototype.matchStringReverse = function(type, url) {
    const typeBits = typeNameToTypeValue[type] | 0x80000000;

    // Prime tokenizer: we get a normalized URL in return.
    $requestURL = urlTokenizer.setURL(url);
    this.$filterUnit = 0;

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
    let typeValue = typeNameToTypeValue[fctxt.type];
    if ( modifiers === 0 ) {
        if ( typeValue === undefined ) {
            typeValue = otherTypeBitValue;
        } else if ( typeValue === 0 || typeValue > otherTypeBitValue ) {
            modifiers |= 0b0001;
        }
    }
    // EXPERIMENT: $requestTypeBit
    //$requestTypeBit = 1 << ((typeValue >>> 4) - 1);
    if ( (modifiers & 0b0001) !== 0 ) {
        if ( typeValue === undefined ) { return 0; }
        typeValue |= 0x80000000;
    }

    const partyBits = fctxt.is3rdPartyToDoc() ? ThirdParty : FirstParty;

    // Prime tokenizer: we get a normalized URL in return.
    $requestURL = urlTokenizer.setURL(fctxt.url);
    this.$filterUnit = 0;

    // These registers will be used by various filters
    $docHostname = fctxt.getDocHostname();
    $requestHostname = fctxt.getHostname();

    // Important block filters.
    if ( this.realmMatchString(BlockImportant, typeValue, partyBits) ) {
        return 1;
    }
    // Block filters
    if ( this.realmMatchString(BlockAction, typeValue, partyBits) ) {
        // Exception filters
        if ( this.realmMatchString(AllowAction, typeValue, partyBits) ) {
            return 2;
        }
        return 1;
    }
    return 0;
};

/******************************************************************************/

FilterContainer.prototype.toLogData = function() {
    if ( this.$filterUnit === 0 ) { return; }
    const logData = toLogDataInternal(
        this.$catbits,
        this.$tokenHash,
        this.$filterUnit
    );
    logData.source = 'static';
    logData.tokenHash = this.$tokenHash;
    logData.result = this.$filterUnit === 0
        ? 0
        : ((this.$catbits & 1) !== 0 ? 2 : 1);
    return logData;
};

/******************************************************************************/

FilterContainer.prototype.isBlockImportant = function() {
    return (this.$catbits & BlockImportant) === BlockImportant;
};

/******************************************************************************/

FilterContainer.prototype.getFilterCount = function() {
    return this.acceptedCount - this.discardedCount;
};

/******************************************************************************/

FilterContainer.prototype.enableWASM = function() {
    return Promise.all([
        bidiTrie.enableWASM(),
        filterOrigin.trieContainer.enableWASM(),
        FilterHostnameDict.trieContainer.enableWASM(),
    ]);
};

/******************************************************************************/

// action: 1=test, 2=record

FilterContainer.prototype.benchmark = async function(action, target) {
    const requests = await µb.loadBenchmarkDataset();

    if ( Array.isArray(requests) === false || requests.length === 0 ) {
        console.info('No requests found to benchmark');
        return;
    }

    const print = log.print;

    print(`Benchmarking staticNetFilteringEngine.matchString()...`);
    const fctxt = µb.filteringContext.duplicate();

    if ( typeof target === 'number' ) {
        const request = requests[target];
        fctxt.setURL(request.url);
        fctxt.setDocOriginFromURL(request.frameUrl);
        fctxt.setType(request.cpt);
        const r = this.matchString(fctxt);
        print(`Result=${r}:`);
        print(`\ttype=${fctxt.type}`);
        print(`\turl=${fctxt.url}`);
        print(`\tdocOrigin=${fctxt.getDocOrigin()}`);
        if ( r !== 0 ) {
            console.log(this.toLogData());
        }
        return;
    }

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
            print(`Mismatch with reference results at ${i}:`);
            print(`\tExpected ${expected[i]}, got ${r}:`);
            print(`\ttype=${fctxt.type}`);
            print(`\turl=${fctxt.url}`);
            print(`\tdocOrigin=${fctxt.getDocOrigin()}`);
        }
    }
    const t1 = self.performance.now();
    const dur = t1 - t0;

    print(`Evaluated ${requests.length} requests in ${dur.toFixed(0)} ms`);
    print(`\tAverage: ${(dur / requests.length).toFixed(3)} ms per request`);
    if ( expected !== undefined ) {
        print(`\tBlocked: ${expected.reduce((n,r)=>{return r===1?n+1:n;},0)}`);
        print(`\tExcepted: ${expected.reduce((n,r)=>{return r===2?n+1:n;},0)}`);
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
    const units = filterUnits;
    const results = [];
    for ( const [ bits, category ] of this.categories ) {
        for ( const [ th, iunit ] of category ) {
            const token = urlTokenizer.stringFromTokenHash(th);
            const f = units[iunit];
            if ( f instanceof FilterBucket ) {
                results.push({ bits: bits.toString(16), token, size: f.size, f });
                continue;
            }
            if ( f instanceof FilterHostnameDict ) {
                results.push({ bits: bits.toString(16), token, size: f.size, f });
                continue;
            }
            if ( f instanceof FilterJustOrigin ) {
                results.push({ bits: bits.toString(16), token, size: f.size, f });
                continue;
            }
            results.push({ bits: bits.toString(16), token, size: 1, f });
        }
    }
    results.sort((a, b) => {
        return b.size - a.size;
    });
    console.log(results);
};

/*******************************************************************************

    With default filter lists:

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

    As of 2019-10-21:

        "FilterPatternPlain" => 27542}
        "FilterComposite" => 17249}
        "FilterPlainTrie" => 13235}
        "FilterAnchorHn" => 11938}
        "FilterPatternRightEx" => 4446}
        "FilterOriginHit" => 4435}
        "FilterBucket" => 3833}
        "FilterPatternRight" => 3426}
        "FilterPlainHostname" => 2786}
        "FilterOriginHitSet" => 1433}
        "FilterDataHolder" => 666}
        "FilterPatternGeneric" => 548}
        "FilterOriginMiss" => 441}
        "FilterOriginMissSet" => 208}
        "FilterTrailingSeparator" => 188}
        "FilterRegex" => 181}
        "FilterPatternLeft" => 172}
        "FilterAnchorRight" => 100}
        "FilterPatternLeftEx" => 82}
        "FilterHostnameDict" => 60}
        "FilterAnchorLeft" => 50}
        "FilterJustOrigin" => 24}
        "FilterHTTPJustOrigin" => 18}
        "FilterTrue" => 17}
        "FilterHTTPSJustOrigin" => 17}

*/

FilterContainer.prototype.filterClassHistogram = function() {
    const filterClassDetails = new Map();

    for ( const fclass of filterClasses ) {
        filterClassDetails.set(fclass.fid, { name: fclass.name, count: 0, });
    }
    // Artificial classes to report content counts
    filterClassDetails.set(1000, { name: 'FilterPlainTrie Content', count: 0, });
    filterClassDetails.set(1001, { name: 'FilterHostnameDict Content', count: 0, });

    const countFilter = function(f) {
        if ( f instanceof Object === false ) { return; }
        filterClassDetails.get(f.fid).count += 1;
    };

    for ( const f of filterUnits ) {
        if ( f === null ) { continue; }
        countFilter(f);
        if ( f instanceof FilterCollection ) {
            let i = f.i;
            while ( i !== 0 ) {
                countFilter(filterUnits[filterSequences[i+0]]);
                i = filterSequences[i+1];
            }
            if ( f.plainTrie ) {
                filterClassDetails.get(1000).count += f.plainTrie.size;
            }
            continue;
        }
        if ( f instanceof FilterHostnameDict ) {
            filterClassDetails.get(1001).count += f.size;
            continue;
        }
        if ( f instanceof FilterComposite ) {
            let i = f.i;
            while ( i !== 0 ) {
                countFilter(filterUnits[filterSequences[i+0]]);
                i = filterSequences[i+1];
            }
            continue;
        }
        if ( f instanceof FilterPlainTrie ) {
            filterClassDetails.get(1000).count += f.plainTrie.size;
            continue;
        }
    }
    const results = Array.from(filterClassDetails.values()).sort((a, b) => {
        return b.count - a.count;
    });
    console.log(results);
};

/******************************************************************************/

FilterContainer.prototype.tokenHistograms = async function() {
    const requests = await µb.loadBenchmarkDataset();

    if ( Array.isArray(requests) === false || requests.length === 0 ) {
        console.info('No requests found to benchmark');
        return;
    }

    console.info(`Computing token histograms...`);
    const fctxt = µb.filteringContext.duplicate();

    const missTokenMap = new Map();
    const hitTokenMap = new Map();
    const reTokens = /[0-9a-z%]{2,}/g;

    for ( let i = 0; i < requests.length; i++ ) {
        const request = requests[i];
        fctxt.setURL(request.url);
        fctxt.setDocOriginFromURL(request.frameUrl);
        fctxt.setType(request.cpt);
        const r = this.matchString(fctxt);
        for ( let [ keyword ] of request.url.toLowerCase().matchAll(reTokens) ) {
            const token = keyword;
            if ( r === 0 ) {
                missTokenMap.set(token, (missTokenMap.get(token) || 0) + 1);
            } else if ( r === 1 ) {
                hitTokenMap.set(token, (hitTokenMap.get(token) || 0) + 1);
            }
        }
    }
    const customSort = (a, b) => b[1] - a[1];
    const topmisses = Array.from(missTokenMap).sort(customSort).slice(0, 100);
    for ( const [ token ] of topmisses ) {
        hitTokenMap.delete(token);
    }
    const tophits = Array.from(hitTokenMap).sort(customSort).slice(0, 100);
    console.log('Misses:', JSON.stringify(topmisses));
    console.log('Hits:', JSON.stringify(tophits));
};

/******************************************************************************/

return new FilterContainer();

/******************************************************************************/

})();

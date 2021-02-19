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

µBlock.staticNetFilteringEngine = (( ) => {

/******************************************************************************/

const µb = µBlock;

// fedcba9876543210
//     ||    | || |
//     ||    | || |
//     ||    | || |
//     ||    | || |
//     ||    | || +---- bit  0- 1: block=0, allow=1, block important=2
//     ||    | |+------ bit     2: modifier
//     ||    | +------- bit  3- 4: party [0-3]
//     ||    +--------- bit  5- 9: type [0-31]
//     |+-------------- bit    10: headers-based filters
//     +--------------- bit 11-15: unused

const CategoryCount = 1 << 0xb; // shift left to first unused bit

const RealmBitsMask  = 0b00000000111;
const ActionBitsMask = 0b00000000011;
const TypeBitsMask   = 0b01111100000;
const TypeBitsOffset = 5;

const BlockAction    = 0b00000000000;
const AllowAction    = 0b00000000001;
const Important      = 0b00000000010;
const BlockImportant = BlockAction | Important;
const ModifyAction   = 0b00000000100;
const AnyParty       = 0b00000000000;
const FirstParty     = 0b00000001000;
const ThirdParty     = 0b00000010000;
const AllParties     = 0b00000011000;
const Headers        = 0b10000000000;

const typeNameToTypeValue = {
           'no_type':  0 << TypeBitsOffset,
        'stylesheet':  1 << TypeBitsOffset,
             'image':  2 << TypeBitsOffset,
            'object':  3 << TypeBitsOffset,
 'object_subrequest':  3 << TypeBitsOffset,
            'script':  4 << TypeBitsOffset,
             'fetch':  5 << TypeBitsOffset,
    'xmlhttprequest':  5 << TypeBitsOffset,
         'sub_frame':  6 << TypeBitsOffset,
              'font':  7 << TypeBitsOffset,
             'media':  8 << TypeBitsOffset,
         'websocket':  9 << TypeBitsOffset,
            'beacon': 10 << TypeBitsOffset,
              'ping': 10 << TypeBitsOffset,
             'other': 11 << TypeBitsOffset,
             'popup': 12 << TypeBitsOffset, // start of behavorial filtering
          'popunder': 13 << TypeBitsOffset,
        'main_frame': 14 << TypeBitsOffset, // start of 1p behavorial filtering
       'generichide': 15 << TypeBitsOffset,
      'specifichide': 16 << TypeBitsOffset,
       'inline-font': 17 << TypeBitsOffset,
     'inline-script': 18 << TypeBitsOffset,
             'cname': 19 << TypeBitsOffset,
//          'unused': 20 << TypeBitsOffset,
//          'unused': 21 << TypeBitsOffset,
            'webrtc': 22 << TypeBitsOffset,
       'unsupported': 23 << TypeBitsOffset,
};

const otherTypeBitValue = typeNameToTypeValue.other;

const bitFromType = type =>
    1 << ((typeNameToTypeValue[type] >>> TypeBitsOffset) - 1);

// All network request types to bitmap
//   bring origin to 0 (from TypeBitsOffset -- see typeNameToTypeValue)
//   left-shift 1 by the above-calculated value
//   subtract 1 to set all type bits
const allNetworkTypesBits =
    (1 << (otherTypeBitValue >>> TypeBitsOffset)) - 1;

const allTypesBits =
    allNetworkTypesBits |
    1 << (typeNameToTypeValue['popup'] >>> TypeBitsOffset) - 1 |
    1 << (typeNameToTypeValue['main_frame'] >>> TypeBitsOffset) - 1 |
    1 << (typeNameToTypeValue['inline-font'] >>> TypeBitsOffset) - 1 |
    1 << (typeNameToTypeValue['inline-script'] >>> TypeBitsOffset) - 1;

const unsupportedTypeBit =
    1 << (typeNameToTypeValue['unsupported'] >>> TypeBitsOffset) - 1;

const typeValueToTypeName = [
    '',
    'stylesheet',
    'image',
    'object',
    'script',
    'xmlhttprequest',
    'subdocument',
    'font',
    'media',
    'websocket',
    'ping',
    'other',
    'popup',
    'popunder',
    'document',
    'generichide',
    'specifichide',
    'inline-font',
    'inline-script',
    'cname',
    'webrtc',
    'unsupported',
];

//const typeValueFromCatBits = catBits => (catBits >>> TypeBitsOffset) & 0b11111;

/******************************************************************************/

// See the following as short-lived registers, used during evaluation. They are
// valid until the next evaluation.

let $requestURL = '';
let $requestURLRaw = '';
let $requestHostname = '';
let $docHostname = '';
let $docDomain = '';
let $tokenBeg = 0;
let $patternMatchLeft = 0;
let $patternMatchRight = 0;

const $docEntity = {
    entity: undefined,
    compute() {
        if ( this.entity === undefined ) {
            const pos = $docDomain.indexOf('.');
            this.entity = pos !== -1
                ? $docHostname.slice(0, pos - $docDomain.length)
                : '';
        }
        return this.entity;
    },
    reset() {
        this.entity = undefined;
    },
};

const $httpHeaders = {
    init(headers) {
        this.headers = headers;
        this.parsed.clear();
    },
    reset() {
        this.headers = [];
        this.parsed.clear();
    },
    lookup(name) {
        if ( this.parsed.size === 0 ) {
            for ( let i = 0, n = this.headers.length; i < n; i++ ) {
                const { name, value } = this.headers[i];
                this.parsed.set(name, value);
            }
        }
        return this.parsed.get(name);
    },
    headers: [],
    parsed: new Map(),
};

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
    if ( (categoryBits & Important) !== 0 ) {
        logData.options.unshift('important');
    }
    if ( (categoryBits & ThirdParty) !== 0 ) {
        logData.options.unshift('3p');
    } else if ( (categoryBits & FirstParty) !== 0 ) {
        logData.options.unshift('1p');
    }
    const type = categoryBits & TypeBitsMask;
    if ( type !== 0 ) {
        logData.options.unshift(typeValueToTypeName[type >>> TypeBitsOffset]);
    }
    let raw = logData.pattern.join('');
    if (
        logData.isRegex === false &&
        raw.charCodeAt(0) === 0x2F /* '/' */ &&
        raw.charCodeAt(raw.length - 1) === 0x2F /* '/' */
    ) {
        raw += '*';
    }
    if ( (categoryBits & AllowAction) !== 0 ) {
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

// Initial size should be enough for default set of filter lists.
const filterUnits = JSON.parse(`[${'null,'.repeat(65535)}null]`);
let filterUnitWritePtr = 1;
const FILTER_UNITS_MIN = filterUnitWritePtr;

const filterUnitAdd = function(f) {
    const i = filterUnitWritePtr;
    filterUnitWritePtr += 1;
    if ( filterUnitWritePtr > filterUnits.length ) {
        filterUnitBufferResize(filterUnitWritePtr);
    }
    filterUnits[i] = f;
    return i;
};

const filterUnitBufferResize = function(newSize) {
    if ( newSize <= filterUnits.length ) { return; }
    const size = (newSize + 0x0FFF) & ~0x0FFF;
    for ( let i = filterUnits.length; i < size; i++ ) {
        filterUnits[i] = null;
    }
};

// Initial size should be enough for default set of filter lists.
const filterSequences = JSON.parse(`[${'0,'.repeat(163839)}0]`);
let filterSequenceWritePtr = 3;
const FILTER_SEQUENCES_MIN = filterSequenceWritePtr;

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

// TODO:
//   Evaluate whether it's worth to add ability to keep track of freed
//   sequence slots for reuse purpose.

const filterSequenceBufferResize = function(newSize) {
    if ( newSize <= filterSequences.length ) { return; }
    const size = (newSize + 0x3FFF) & ~0x3FFF;
    for ( let i = filterSequences.length; i < size; i++ ) {
        filterSequences[i] = 0;
    }
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
    ctor.fidstr = `${fid}`;
    filterClasses[fid] = ctor;
};

const filterUnitFromCtor = (ctor, ...args) => filterUnitAdd(new ctor(...args));

const filterUnitFromFilter = f => filterUnitAdd(f);

const filterUnitFromCompiled = function(args) {
    const ctor = filterClasses[args[0]];
    const keygen = ctor.keyFromArgs;
    if ( keygen === undefined ) {
        return filterUnitAdd(ctor.fromCompiled(args));
    }
    let key = ctor.fidstr;
    const keyargs = keygen(args);
    if ( keyargs !== undefined ) {
        key += `\t${keyargs}`;
    }
    let iunit = filterArgsToUnit.get(key);
    if ( iunit !== undefined ) { return iunit; }
    iunit = filterUnitAdd(ctor.fromCompiled(args));
    filterArgsToUnit.set(key, iunit);
    return iunit;
};

const filterFromSelfie = args => filterClasses[args[0]].fromSelfie(args);

/******************************************************************************/

const filterPattern = {
    compile: function(parsed, units) {
        if ( parsed.isRegex ) {
            units.push(FilterRegex.compile(parsed));
            return;
        }
        const pattern = parsed.pattern;
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
            parsed.pattern = sleft;
            units.push(FilterPatternPlain.compile(parsed));
            parsed.pattern = sright;
            units.push(FilterPatternRight.compile(parsed, hasCaretCombo));
            return;
        }
        // parsed.tokenBeg > parsed.firstWildcardPos
        parsed.pattern = sright;
        parsed.tokenBeg -= parsed.firstWildcardPos + 1;
        units.push(FilterPatternPlain.compile(parsed));
        parsed.pattern = sleft;
        units.push(FilterPatternLeft.compile(parsed, hasCaretCombo));
    },
    compileGeneric: function(parsed, units) {
        const pattern = parsed.pattern;
        // Optimize special case: plain pattern with trailing caret
        if (
            parsed.firstWildcardPos === -1 &&
            parsed.firstCaretPos === (pattern.length - 1)
        ) {
            parsed.pattern = pattern.slice(0, -1);
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
        //parsed.pattern = pattern.slice(left, right);
        //parsed.tokenBeg -= left;
        //units.push(FilterPatternPlain.compile(parsed));
        //parsed.pattern = pattern;
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
        return [ FilterPatternPlain.fid, details.pattern, details.tokenBeg ];
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
            details.pattern
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
            details.pattern
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
        const out = [
            FilterPatternGeneric.fid,
            details.pattern,
            details.anchor,
        ];
        details.anchor = 0;
        return out;
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

const FilterAnchorHnLeft = class {
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
        return [ FilterAnchorHnLeft.fid ];
    }

    static fromCompiled() {
        return new FilterAnchorHnLeft();
    }

    static fromSelfie() {
        return new FilterAnchorHnLeft();
    }

    static keyFromArgs() {
    }
};

registerFilterClass(FilterAnchorHnLeft);

/******************************************************************************/

const FilterAnchorHn = class extends FilterAnchorHnLeft {
    match() {
        return super.match() && this.lastEnd === $patternMatchRight;
    }

    logData(details) {
        super.logData(details);
        details.pattern.push('^');
        details.regex.push('\\.?', restrSeparator);
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
        if ( $patternMatchRight === $requestURL.length ) { return true; }
        if ( isSeparatorChar(bidiTrie.haystack[$patternMatchRight]) ) {
            $patternMatchRight += 1;
            return true;
        }
        return false;
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

const FilterRegex = class {
    constructor(s, matchCase = false) {
        this.s = s;
        if ( matchCase ) {
            this.matchCase = true;
        }
    }

    match() {
        if ( this.re === null ) {
            this.re = new RegExp(
                this.s,
                this.matchCase ? '' : 'i'
            );
        }
        if ( this.re.test($requestURLRaw) === false ) { return false; }
        $patternMatchLeft = $requestURLRaw.search(this.re);
        return true;
    }

    logData(details) {
        details.pattern.push('/', this.s, '/');
        details.regex.push(this.s);
        details.isRegex = true;
        if ( this.matchCase ) {
            details.options.push('match-case');
        }
    }

    toSelfie() {
        return [ this.fid, this.s, this.matchCase ];
    }

    static compile(details) {
        return [ FilterRegex.fid, details.pattern, details.patternMatchCase ];
    }

    static fromCompiled(args) {
        return new FilterRegex(args[1], args[2]);
    }

    static fromSelfie(args) {
        return new FilterRegex(args[1], args[2]);
    }

    static keyFromArgs(args) {
        return `${args[1]}\t${args[2]}`;
    }
};

FilterRegex.prototype.re = null;
FilterRegex.prototype.matchCase = false;

FilterRegex.isSlow = true;

registerFilterClass(FilterRegex);

/******************************************************************************/

// A helper class to parse `domain=` option.

const DomainOptIterator = class {
    constructor(domainOpt) {
        this.reset(domainOpt);
    }
    reset(domainOpt) {
        this.domainOpt = domainOpt;
        this.i = 0;
        this.value = undefined;
        this.done = false;
        return this;
    }
    next() {
        if ( this.i === -1 ) {
            this.domainOpt = '';
            this.value = undefined;
            this.done = true;
            return this;
        }
        const pos = this.domainOpt.indexOf('|', this.i);
        if ( pos !== -1 ) {
            this.value = this.domainOpt.slice(this.i, pos);
            this.i = pos + 1;
        } else {
            this.value = this.domainOpt.slice(this.i);
            this.i = -1;
        }
        return this;
    }
    [Symbol.iterator]() {
        return this;
    }
};

// A helper instance to reuse throughout
const domainOptIterator = new DomainOptIterator('');

/******************************************************************************/

// The optimal "class" is picked according to the content of the
// `domain=` filter option.

const filterOrigin = (( ) => {
    const FilterOrigin = class {
        constructor() {
            this.trieContainer = new µb.HNTrieContainer();
        }

        compile(domainOptList, prepend, units) {
            const hostnameHits = [];
            const hostnameMisses = [];
            const entityHits = [];
            const entityMisses = [];
            for ( const s of domainOptList ) {
                const len = s.length;
                const beg = len > 1 && s.charCodeAt(0) === 0x7E ? 1 : 0;
                const end = len > 2 &&
                            s.charCodeAt(len - 1) === 0x2A /* '*' */ &&
                            s.charCodeAt(len - 2) === 0x2E /* '.' */
                    ? len - 2 : len;
                if ( end <= beg ) {  continue; }
                if ( end === len ) {
                    if ( beg === 0 ) {
                        hostnameHits.push(s);
                    } else {
                        hostnameMisses.push(s.slice(1));
                    }
                } else {
                    if ( beg === 0 ) {
                        entityHits.push(s.slice(0, -2));
                    } else {
                        entityMisses.push(s.slice(1, -2));
                    }
                }
            }
            const compiledHit = [];
            if ( entityHits.length !== 0 ) {
                for ( const entity of entityHits ) {
                    compiledHit.push(FilterOriginEntityHit.compile(entity));
                }
            }
            if ( hostnameHits.length === 1 ) {
                compiledHit.push(FilterOriginHit.compile(hostnameHits[0]));
            } else if ( hostnameHits.length > 1 ) {
                compiledHit.push(FilterOriginHitSet.compile(hostnameHits.join('|')));
            }
            if ( compiledHit.length > 1 ) {
                compiledHit[0] = FilterOriginHitAny.compile(compiledHit.slice());
                compiledHit.length = 1;
            }
            const compiledMiss = [];
            if ( entityMisses.length !== 0 ) {
                for ( const entity of entityMisses ) {
                    compiledMiss.push(FilterOriginEntityMiss.compile(entity));
                }
            }
            if ( hostnameMisses.length === 1 ) {
                compiledMiss.push(FilterOriginMiss.compile(hostnameMisses[0]));
            } else if ( hostnameMisses.length > 1 ) {
                compiledMiss.push(FilterOriginMissSet.compile(hostnameMisses.join('|')));
            }
            if ( prepend ) {
                if ( compiledHit.length !== 0 ) {
                    units.unshift(compiledHit[0]);
                }
                if ( compiledMiss.length !== 0 ) {
                    units.unshift(...compiledMiss);
                }
            } else {
                if ( compiledMiss.length !== 0 ) {
                    units.push(...compiledMiss);
                }
                if ( compiledHit.length !== 0 ) {
                    units.push(compiledHit[0]);
                }
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
    };
    return new FilterOrigin();
})();

/******************************************************************************/

const FilterOriginHit = class {
    constructor(i, n) {
        this.i = i;
        this.n = n;
    }

    get domainOpt() {
        return filterOrigin.trieContainer.extractHostname(this.i, this.n);
    }

    match() {
        return filterOrigin.trieContainer.matchesHostname(
            $docHostname,
            this.i,
            this.n
        );
    }

    toSelfie() {
        return [ this.fid, this.i, this.n ];
    }

    logData(details) {
        details.domains.push(this.domainOpt);
    }

    static compile(hostname) {
        return [ FilterOriginHit.fid, hostname ];
    }

    static fromCompiled(args) {
        return new FilterOriginHit(
            filterOrigin.trieContainer.storeHostname(args[1]),
            args[1].length
        );
    }

    static fromSelfie(args) {
        return new FilterOriginHit(args[1], args[2]);
    }
};

FilterOriginHit.prototype.hasOriginHit = true;

registerFilterClass(FilterOriginHit);

/******************************************************************************/

const FilterOriginMiss = class extends FilterOriginHit {
    match() {
        return super.match() === false;
    }

    logData(details) {
        details.domains.push(`~${this.domainOpt}`);
    }

    static compile(hostname) {
        return [ FilterOriginMiss.fid, hostname ];
    }

    static fromCompiled(args) {
        return new FilterOriginMiss(
            filterOrigin.trieContainer.storeHostname(args[1]),
            args[1].length
        );
    }

    static fromSelfie(args) {
        return new FilterOriginMiss(args[1], args[2]);
    }
};

FilterOriginMiss.prototype.hasOriginHit = false;

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
                domainOptIterator.reset(this.domainOpt)
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

FilterOriginHitSet.prototype.hasOriginHit = true;

registerFilterClass(FilterOriginHitSet);

/******************************************************************************/

const FilterOriginMissSet = class extends FilterOriginHitSet {
    match() {
        return super.match() === false;
    }

    logData(details) {
        details.domains.push(
            '~' + this.domainOpt.replace(/\|/g, '|~')
        );
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

FilterOriginMissSet.prototype.hasOriginHit = false;

registerFilterClass(FilterOriginMissSet);

/******************************************************************************/

const FilterOriginEntityHit = class {
    constructor(entity) {
        this.entity = entity;
    }

    get domainOpt() {
        return `${this.entity}.*`;
    }

    match() {
        const entity = $docEntity.compute();
        if ( entity === '' ) { return false; }
        const offset = entity.length - this.entity.length;
        if ( offset < 0 ) { return false; }
        if ( entity.charCodeAt(offset) !== this.entity.charCodeAt(0) ) {
            return false;
        }
        if ( entity.endsWith(this.entity) === false ) { return false; }
        return offset === 0 || entity.charCodeAt(offset-1) === 0x2E /* '.' */;
    }

    toSelfie() {
        return [ this.fid, this.entity ];
    }

    logData(details) {
        details.domains.push(this.domainOpt);
    }

    static compile(entity) {
        return [ FilterOriginEntityHit.fid, entity ];
    }

    static fromCompiled(args) {
        return new FilterOriginEntityHit(args[1]);
    }

    static fromSelfie(args) {
        return new FilterOriginEntityHit(args[1]);
    }
};

FilterOriginEntityHit.prototype.hasOriginHit = true;

registerFilterClass(FilterOriginEntityHit);

/******************************************************************************/

const FilterOriginEntityMiss = class extends FilterOriginEntityHit {
    match() {
        return super.match() === false;
    }

    logData(details) {
        details.domains.push(`~${this.entity}.*`);
    }

    static compile(entity) {
        return [ FilterOriginEntityMiss.fid, entity ];
    }

    static fromCompiled(args) {
        return new FilterOriginEntityMiss(args[1]);
    }

    static fromSelfie(args) {
        return new FilterOriginEntityMiss(args[1]);
    }
};

FilterOriginEntityMiss.prototype.hasOriginHit = false;

registerFilterClass(FilterOriginEntityMiss);

/******************************************************************************/

const FilterOriginHitSetTest = class extends FilterOriginHitSet {
    constructor(domainOpt, hasEntity = undefined, oneOf = null) {
        super(domainOpt, oneOf);
        this.hasEntity = hasEntity === undefined
            ? domainOpt.indexOf('.*') !== -1
            : hasEntity;
    }

    match() {
        if ( this.oneOf === null ) {
            this.oneOf = filterOrigin.trieContainer.fromIterable(
                domainOptIterator.reset(this.domainOpt)
            );
            this.domainOpt = '';
        }
        return this.oneOf.matches($docHostname) !== -1 ||
               this.hasEntity !== false &&
               this.oneOf.matches(`${$docEntity.compute()}.*`) !== -1;
    }

    toSelfie() {
        return [
            this.fid,
            this.domainOpt,
            this.hasEntity,
            this.oneOf !== null
                ? filterOrigin.trieContainer.compileOne(this.oneOf)
                : null
        ];
    }

    static fromSelfie(args) {
        return new FilterOriginHitSetTest(args[1], args[2], args[3]);
    }
};

registerFilterClass(FilterOriginHitSetTest);

/******************************************************************************/

const FilterModifier = class {
    constructor(actionBits, modifier, value) {
        this.actionBits = actionBits;
        this.type = modifier;
        this.value = value;
        this.cache = undefined;
    }

    match() {
        return true;
    }

    matchAndFetchModifiers(env) {
        if ( this.type !== env.modifier ) { return; }
        env.results.push(
            new FilterModifierResult(env.bits, env.th, env.iunit)
        );
    }

    get modifier() {
        return this;
    }

    logData(details) {
        let opt = vAPI.StaticFilteringParser.netOptionTokenNames.get(this.type);
        if ( this.value !== '' ) {
            opt += `=${this.value}`;
        }
        details.options.push(opt);
    }

    toSelfie() {
        return [ this.fid, this.actionBits, this.type, this.value ];
    }

    static compile(details) {
        return [
            FilterModifier.fid,
            details.action,
            details.modifyType,
            details.modifyValue || '',
        ];
    }

    static fromCompiled(args) {
        return new FilterModifier(args[1], args[2], args[3]);
    }

    static fromSelfie(args) {
        return new FilterModifier(args[1], args[2], args[3]);
    }

    static keyFromArgs(args) {
        return `${args[1]}\t${args[2]}\t${args[3]}`;
    }
};

registerFilterClass(FilterModifier);

// Helper class for storing instances of FilterModifier which were found to
// be a match.

const FilterModifierResult = class {
    constructor(bits, th, iunit) {
        this.iunit = iunit;
        this.th = th;
        this.bits = (bits & ~RealmBitsMask) | this.modifier.actionBits;
    }

    get filter() {
        return filterUnits[this.iunit];
    }

    get modifier() {
        return this.filter.modifier;
    }

    get result() {
        return (this.bits & AllowAction) === 0 ? 1 : 2;
    }

    get value() {
        return this.modifier.value;
    }

    logData() {
        const r = toLogDataInternal(this.bits, this.th, this.iunit);
        r.source = 'static';
        r.result = this.result;
        r.modifier = true;
        return r;
    }
};

/******************************************************************************/

const FilterCollection = class {
    constructor(i = 0) {
        this.i = i;
    }

    get size() {
        let n = 0;
        this.forEach(( ) => { n += 1; });
        return n;
    }

    unshift(iunit) {
        this.i = filterSequenceAdd(iunit, this.i);
    }

    shift(drop = false) {
        if ( drop ) {
            filterUnits[filterSequences[this.i+0]] = null;
        }
        this.i = filterSequences[this.i+1];
    }

    forEach(fn) {
        let i = this.i;
        if ( i === 0 ) { return; }
        do {
            const iunit = filterSequences[i+0];
            const r = fn(iunit);
            if ( r !== undefined ) { return r; }
            i = filterSequences[i+1];
        } while ( i !== 0 );
    }

    logData(details) {
        this.forEach(iunit => {
            filterUnits[iunit].logData(details);
        });
    }

    toSelfie() {
        return [ this.fid, this.i ];
    }

    static compile(ctor, fdata) {
        return [ ctor.fid, fdata ];
    }

    static fromCompiled(args, bucket) {
        const units = args[1];
        const n = units.length;
        let iunit, inext = 0;
        let i = n;
        while ( i-- ) {
            iunit = filterUnitFromCompiled(units[i]);
            inext = filterSequenceAdd(iunit, inext);
        }
        bucket.i = inext;
        return bucket;
    }

    static fromSelfie(args, bucket) {
        bucket.i = args[1];
        return bucket;
    }
};

/******************************************************************************/

const FilterOriginHitAny = class extends FilterCollection {
    get domainOpt() {
        const domainOpts = [];
        this.forEach(iunit => {
            const f = filterUnits[iunit];
            if ( f.hasOriginHit !== true ) { return; }
            domainOpts.push(f.domainOpt);
        });
        return domainOpts.join('|');
    }

    match() {
        let i = this.i;
        while ( i !== 0 ) {
            if ( filterUnits[filterSequences[i+0]].match() ) { return true; }
            i = filterSequences[i+1];
        }
        return false;
    }

    static compile(fdata) {
        return super.compile(FilterOriginHitAny, fdata);
    }

    static fromCompiled(args) {
        return super.fromCompiled(args, new FilterOriginHitAny());
    }

    static fromSelfie(args, bucket) {
        if ( bucket === undefined ) {
            bucket = new FilterOriginHitAny();
        }
        return super.fromSelfie(args, bucket);
    }
};

FilterOriginHitAny.prototype.hasOriginHit = true;

registerFilterClass(FilterOriginHitAny);

/******************************************************************************/

const FilterCompositeAll = class extends FilterCollection {
    match() {
        let i = this.i;
        while ( i !== 0 ) {
            if ( filterUnits[filterSequences[i+0]].match() !== true ) {
                return false;
            }
            i = filterSequences[i+1];
        }
        return true;
    }

    // IMPORTANT: the modifier filter unit is assumed to be ALWAYS the
    // first unit in the sequence. This requirement ensures that we do
    // not have to traverse the sequence to find the modifier filter
    // unit.
    matchAndFetchModifiers(env) {
        const f = filterUnits[filterSequences[this.i]];
        if (
            f.matchAndFetchModifiers instanceof Function &&
            f.type === env.modifier &&
            this.match()
        ) {
            f.matchAndFetchModifiers(env);
        }
    }

    get modifier() {
        const f = filterUnits[filterSequences[this.i]];
        if ( f.matchAndFetchModifiers instanceof Function ) {
            return f.modifier;
        }
    }

    // FilterPatternPlain is assumed to be first filter in sequence. This can
    // be revisited if needed.
    get isBidiTrieable() {
        return filterUnits[filterSequences[this.i]].isBidiTrieable === true;
    }

    get hasOriginHit() {
        return this.forEach(iunit => {
            if ( filterUnits[iunit].hasOriginHit === true ) {
                return true;
            }
        });
    }

    get domainOpt() {
        return this.forEach(iunit => {
            const f = filterUnits[iunit];
            if ( f.hasOriginHit === true ) {
                return f.domainOpt;
            }
        });
    }

    toBidiTrie() {
        const details = filterUnits[filterSequences[this.i]].toBidiTrie();
        this.shift(true);
        return details;
    }

    static compile(fdata) {
        return super.compile(FilterCompositeAll, fdata);
    }

    static fromCompiled(args) {
        return super.fromCompiled(args, new FilterCompositeAll());
    }

    static fromSelfie(args, bucket) {
        if ( bucket === undefined ) {
            bucket = new FilterCompositeAll();
        }
        return super.fromSelfie(args, bucket);
    }
};

registerFilterClass(FilterCompositeAll);

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
        details.regex.push(restrFromPlainPattern(this.$h), '\\.?', restrSeparator);
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
        return [ FilterDenyAllow.fid, details.denyallowOpt ];
    }

    static fromCompiled(args) {
        const f = new FilterDenyAllow(args[1]);
        for ( const hn of domainOptIterator.reset(args[1]) ) {
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
        this.plainTrie = trie !== undefined
            ? trie
            : bidiTrie.createOne();
        this.$matchedUnit = 0;
    }

    match() {
        if ( this.plainTrie.matches($tokenBeg) !== 0 ) {
            this.$matchedUnit = this.plainTrie.$iu;
            return true;
        }
        return false;
    }

    matchAndFetchModifiers(/* type, callback */) {
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

    addUnitToTrie(iunit) {
        const f = filterUnits[iunit];
        const trieDetails = f.toBidiTrie();
        const id = this.plainTrie.add(
            trieDetails.i,
            trieDetails.n,
            trieDetails.itok
        );
        // No point storing a pattern with conditions if the bidi-trie already
        // contain a pattern with no conditions.
        const ix = this.plainTrie.getExtra(id);
        if ( ix === 1 ) {
            filterUnits[iunit] = null;
            return;
        }
        // If the newly stored pattern has no condition, short-circuit existing
        // ones since they will always be short-circuited by the condition-less
        // pattern.
        if ( f instanceof FilterPatternPlain ) {
            this.plainTrie.setExtra(id, 1);
            filterUnits[iunit] = null;
            return;
        }
        // FilterCompositeAll is assumed here, i.e. with conditions.
        if ( f.n === 1 ) {
            filterUnits[iunit] = null;
            iunit = filterSequences[f.i];
        }
        this.plainTrie.setExtra(id, filterSequenceAdd(iunit, ix));
    }

    toSelfie() {
        return [ this.fid, bidiTrie.compileOne(this.plainTrie) ];
    }

    static fromSelfie(args) {
        return new FilterPlainTrie(bidiTrie.createOne(args[1]));
    }
};

registerFilterClass(FilterPlainTrie);

/******************************************************************************/

const FilterBucket = class extends FilterCollection {
    constructor(n = 0) {
        super();
        this.n = n;
        this.$matchedUnit = 0;
    }

    get size() {
        return this.n;
    }

    match() {
        let i = this.i;
        while ( i !== 0 ) {
            if ( filterUnits[filterSequences[i+0]].match() ) {
                this.$matchedUnit = filterSequences[i+0];
                return true;
            }
            i = filterSequences[i+1];
        }
        return false;
    }

    matchAndFetchModifiers(env) {
        let i = this.i;
        while ( i !== 0 ) {
            env.iunit = filterSequences[i+0];
            filterUnits[env.iunit].matchAndFetchModifiers(env);
            i = filterSequences[i+1];
        }
    }

    unshift(iunit) {
        super.unshift(iunit);
        this.n += 1;
    }

    shift() {
        super.shift();
        this.n -= 1;
    }

    logData(details) {
        filterUnits[this.$matchedUnit].logData(details);
    }

    toSelfie() {
        return [ this.fid, this.n, super.toSelfie() ];
    }

    static fromSelfie(args, bucket) {
        if ( bucket === undefined ) {
            bucket = new FilterBucket(args[1]);
        }
        return super.fromSelfie(args[2], bucket);
    }

    optimize(optimizeBits = 0b11) {
        if ( this.n >= 3 && (optimizeBits & 0b01) !== 0 ) {
            const f = this.optimizePatternTests();
            if ( f !== undefined ) {
                if ( this.i === 0 ) { return f; }
                this.unshift(filterUnitFromFilter(f));
            }
        }
        if ( this.n >= 10 && (optimizeBits & 0b10) !== 0 ) {
            const f = this.optimizeOriginHitTests();
            if ( f !== undefined ) {
                if ( this.i === 0 ) { return f; }
                this.unshift(filterUnitFromFilter(f));
            }
        }
    }

    optimizePatternTests() {
        let n = 0;
        let i = this.i;
        do {
            if ( filterUnits[filterSequences[i+0]].isBidiTrieable ) { n += 1; }
            i = filterSequences[i+1];
        } while ( i !== 0 && n < 3 );
        if ( n < 3 ) { return; }
        const ftrie = new FilterPlainTrie();
        i = this.i;
        let iprev = 0;
        for (;;) {
            const iunit = filterSequences[i+0];
            const inext = filterSequences[i+1];
            if ( filterUnits[iunit].isBidiTrieable ) {
                ftrie.addUnitToTrie(iunit);
                if ( iprev !== 0 ) {
                    filterSequences[iprev+1] = inext;
                } else {
                    this.i = inext;
                }
                this.n -= 1;
            } else {
                iprev = i;
            }
            if ( inext === 0 ) { break; }
            i = inext;
        }
        return ftrie;
    }

    optimizeOriginHitTests() {
        let candidateCount = 0;
        const shouldPreTest = this.forEach(iunit => {
            if ( filterUnits[iunit].hasOriginHit !== true ) { return; }
            candidateCount += 1;
            if ( candidateCount >= 10 ) { return true; }
        });
        if ( shouldPreTest !== true ) { return; }
        const bucket = new FilterBucketOfOriginHits();
        const domainOpts = [];
        let i = this.i;
        let iprev = 0;
        for (;;) {
            const iunit = filterSequences[i+0];
            const inext = filterSequences[i+1];
            const f = filterUnits[iunit];
            if ( f.hasOriginHit === true ) {
                domainOpts.push(f.domainOpt);
                // move the sequence slot to new bucket
                filterSequences[i+1] = bucket.i;
                bucket.i = i;
                bucket.n += 1;
                if ( iprev !== 0 ) {
                    filterSequences[iprev+1] = inext;
                } else {
                    this.i = inext;
                }
                this.n -= 1;
            } else {
                iprev = i;
            }
            if ( inext === 0 ) { break; }
            i = inext;
        }
        bucket.originTestUnit =
            filterUnitFromCtor(FilterOriginHitSetTest, domainOpts.join('|'));
        return bucket;
    }
};

registerFilterClass(FilterBucket);

/******************************************************************************/

const FilterBucketOfOriginHits = class extends FilterBucket {
    constructor(i = 0) {
        super();
        this.originTestUnit = i;
    }

    match() {
        return filterUnits[this.originTestUnit].match() && super.match();
    }

    matchAndFetchModifiers(env) {
        if ( filterUnits[this.originTestUnit].match() ) {
            super.matchAndFetchModifiers(env);
        }
    }

    toSelfie() {
        return [ this.fid, this.originTestUnit, super.toSelfie() ];
    }

    static fromSelfie(args) {
        const bucket = new FilterBucketOfOriginHits(args[1]);
        return super.fromSelfie(args[2], bucket);
    }
};

registerFilterClass(FilterBucketOfOriginHits);

/******************************************************************************/

const FilterStrictParty = class {
    constructor(not) {
        this.not = not;
    }

    // TODO: diregard `www.`?
    match() {
        return ($requestHostname === $docHostname) !== this.not;
    }

    logData(details) {
        details.options.push(this.not ? 'strict3p' : 'strict1p');
    }

    toSelfie() {
        return [ this.fid, this.not ];
    }

    static compile(details) {
        return [ FilterStrictParty.fid, details.strictParty < 0 ];
    }

    static fromCompiled(args) {
        return new FilterStrictParty(args[1]);
    }

    static fromSelfie(args) {
        return new FilterStrictParty(args[1]);
    }

    static keyFromArgs(args) {
        return `${args[1]}`;
    }
};

registerFilterClass(FilterStrictParty);

/******************************************************************************/

const FilterOnHeaders = class {
    constructor(headerOpt) {
        this.headerOpt = headerOpt;
        this.parsed = undefined;
    }

    match() {
        if ( this.parsed === undefined ) {
            this.parsed =
                vAPI.StaticFilteringParser.parseHeaderValue(this.headerOpt);
        }
        const { bad, name, not, re, value } = this.parsed;
        if ( bad ) { return false; }
        const headerValue = $httpHeaders.lookup(name);
        if ( headerValue === undefined ) { return false; }
        if ( value === '' ) { return true; }
        return re === undefined
            ? (headerValue === value) !== not
            : re.test(headerValue) !== not;
    }

    logData(details) {
        let opt = 'header';
        if ( this.headerOpt !== '' ) {
            opt += `=${this.headerOpt}`;
        }
        details.options.push(opt);
    }

    toSelfie() {
        return [ this.fid, this.headerOpt ];
    }

    static compile(details) {
        return [ FilterOnHeaders.fid, details.headerOpt ];
    }

    static fromCompiled(args) {
        return new FilterOnHeaders(args[1]);
    }

    static fromSelfie(args) {
        return new FilterOnHeaders(args[1]);
    }
};

registerFilterClass(FilterOnHeaders);

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/2630
// Slice input URL into a list of safe-integer token values, instead of a list
// of substrings. The assumption is that with dealing only with numeric
// values, less underlying memory allocations, and also as a consequence
// less work for the garbage collector down the road.
// Another assumption is that using a numeric-based key value for Map() is
// more efficient than string-based key value (but that is something I would
// have to benchmark).
// Benchmark for string-based tokens vs. safe-integer token values:
//   https://gorhill.github.io/obj-vs-set-vs-map/tokenize-to-str-vs-to-int.html

const urlTokenizer = new (class {
    constructor() {
        this._chars = '0123456789%abcdefghijklmnopqrstuvwxyz';
        this._validTokenChars = new Uint8Array(128);
        for ( let i = 0, n = this._chars.length; i < n; i++ ) {
            this._validTokenChars[this._chars.charCodeAt(i)] = i + 1;
        }
        // Four upper bits of token hash are reserved for built-in predefined
        // token hashes, which should never end up being used when tokenizing
        // any arbitrary string.
             this.dotTokenHash = 0x10000000;
             this.anyTokenHash = 0x20000000;
        this.anyHTTPSTokenHash = 0x30000000;
         this.anyHTTPTokenHash = 0x40000000;
              this.noTokenHash = 0x50000000;
           this.emptyTokenHash = 0xF0000000;

        this._urlIn = '';
        this._urlOut = '';
        this._tokenized = false;
        this._hasQuery = 0;
        // https://www.reddit.com/r/uBlockOrigin/comments/dzw57l/
        //   Remember: 1 token needs two slots
        this._tokens = new Uint32Array(2064);

        this.knownTokens = new Uint8Array(65536);
        this.resetKnownTokens();
        this.MAX_TOKEN_LENGTH = 7;
    }

    setURL(url) {
        if ( url !== this._urlIn ) {
            this._urlIn = url;
            this._urlOut = url.toLowerCase();
            this._hasQuery = 0;
            this._tokenized = false;
        }
        return this._urlOut;
    }

    resetKnownTokens() {
        this.knownTokens.fill(0);
        this.addKnownToken(this.dotTokenHash);
        this.addKnownToken(this.anyTokenHash);
        this.addKnownToken(this.anyHTTPSTokenHash);
        this.addKnownToken(this.anyHTTPTokenHash);
        this.addKnownToken(this.noTokenHash);
    }

    addKnownToken(th) {
        this.knownTokens[th & 0xFFFF ^ th >>> 16] = 1;
    }

    // Tokenize on demand.
    getTokens(encodeInto) {
        if ( this._tokenized ) { return this._tokens; }
        let i = this._tokenize(encodeInto);
        this._tokens[i+0] = this.anyTokenHash;
        this._tokens[i+1] = 0;
        i += 2;
        if ( this._urlOut.startsWith('https://') ) {
            this._tokens[i+0] = this.anyHTTPSTokenHash;
            this._tokens[i+1] = 0;
            i += 2;
        } else if ( this._urlOut.startsWith('http://') ) {
            this._tokens[i+0] = this.anyHTTPTokenHash;
            this._tokens[i+1] = 0;
            i += 2;
        }
        this._tokens[i+0] = this.noTokenHash;
        this._tokens[i+1] = 0;
        this._tokens[i+2] = 0;
        this._tokenized = true;
        return this._tokens;
    }

    hasQuery() {
        if ( this._hasQuery === 0 ) {
            const i = this._urlOut.indexOf('?');
            this._hasQuery = i !== -1 ? i + 1 : -1;
        }
        return this._hasQuery > 0;
    }

    tokenHashFromString(s) {
        const l = s.length;
        if ( l === 0 ) { return this.emptyTokenHash; }
        const vtc = this._validTokenChars;
        let th = vtc[s.charCodeAt(0)];
        for ( let i = 1; i !== 7 && i !== l; i++ ) {
            th = th << 4 ^ vtc[s.charCodeAt(i)];
        }
        return th;
    }

    stringFromTokenHash(th) {
        if ( th === 0 ) { return ''; }
        return th.toString(16);
    }

    toSelfie() {
        return µBlock.base64.encode(
            this.knownTokens.buffer,
            this.knownTokens.byteLength
        );
    }

    fromSelfie(selfie) {
        return µBlock.base64.decode(selfie, this.knownTokens.buffer);
    }

    // https://github.com/chrisaljoudi/uBlock/issues/1118
    // We limit to a maximum number of tokens.

    _tokenize(encodeInto) {
        const tokens = this._tokens;
        let url = this._urlOut;
        let l = url.length;
        if ( l === 0 ) { return 0; }
        if ( l > 2048 ) {
            url = url.slice(0, 2048);
            l = 2048;
        }
        encodeInto.haystackLen = l;
        let j = 0;
        let hasq = -1;
        mainLoop: {
            const knownTokens = this.knownTokens;
            const vtc = this._validTokenChars;
            const charCodes = encodeInto.haystack;
            let i = 0, n = 0, ti = 0, th = 0;
            for (;;) {
                for (;;) {
                    if ( i === l ) { break mainLoop; }
                    const cc = url.charCodeAt(i);
                    charCodes[i] = cc;
                    i += 1;
                    th = vtc[cc];
                    if ( th !== 0 ) { break; }
                    if ( cc === 0x3F /* '?' */ ) { hasq = i; }
                }
                ti = i - 1; n = 1;
                for (;;) {
                    if ( i === l ) { break; }
                    const cc = url.charCodeAt(i);
                    charCodes[i] = cc;
                    i += 1;
                    const v = vtc[cc];
                    if ( v === 0 ) {
                        if ( cc === 0x3F /* '?' */ ) { hasq = i; }
                        break;
                    }
                    if ( n === 7 ) { continue; }
                    th = th << 4 ^ v;
                    n += 1;
                }
                if ( knownTokens[th & 0xFFFF ^ th >>> 16] !== 0 ) {
                    tokens[j+0] = th;
                    tokens[j+1] = ti;
                    j += 2;
                }
            }
        }
        this._hasQuery = hasq;
        return j;
    }
})();

/******************************************************************************/
/******************************************************************************/

const FilterParser = class {
    constructor(parser, other = undefined) {
        if ( other !== undefined ) {
            return Object.assign(this, other);
        }
        this.noTokenHash = urlTokenizer.noTokenHash;
        this.reBadCSP = /(?:=|;)\s*report-(?:to|uri)\b/;
        this.reToken = /[%0-9A-Za-z]+/g;
        this.domainOptList = [];
        this.tokenIdToNormalizedType = new Map([
            [ parser.OPTTokenCname, bitFromType('cname') ],
            [ parser.OPTTokenCss, bitFromType('stylesheet') ],
            [ parser.OPTTokenDoc, bitFromType('main_frame') ],
            [ parser.OPTTokenFont, bitFromType('font') ],
            [ parser.OPTTokenFrame, bitFromType('sub_frame') ],
            [ parser.OPTTokenGenericblock, bitFromType('unsupported') ],
            [ parser.OPTTokenGhide, bitFromType('generichide') ],
            [ parser.OPTTokenImage, bitFromType('image') ],
            [ parser.OPTTokenInlineFont, bitFromType('inline-font') ],
            [ parser.OPTTokenInlineScript, bitFromType('inline-script') ],
            [ parser.OPTTokenMedia, bitFromType('media') ],
            [ parser.OPTTokenObject, bitFromType('object') ],
            [ parser.OPTTokenOther, bitFromType('other') ],
            [ parser.OPTTokenPing, bitFromType('ping') ],
            [ parser.OPTTokenPopunder, bitFromType('popunder') ],
            [ parser.OPTTokenPopup, bitFromType('popup') ],
            [ parser.OPTTokenScript, bitFromType('script') ],
            [ parser.OPTTokenShide, bitFromType('specifichide') ],
            [ parser.OPTTokenXhr, bitFromType('xmlhttprequest') ],
            [ parser.OPTTokenWebrtc, bitFromType('unsupported') ],
            [ parser.OPTTokenWebsocket, bitFromType('websocket') ],
        ]);
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
            [ 'new',1412],
        ]);
        this.maxTokenLen = urlTokenizer.MAX_TOKEN_LENGTH;
        this.reset(parser);
    }

    reset(parser) {
        this.parser = parser;
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
        this.modifyType = undefined;
        this.modifyValue = undefined;
        this.invalid = false;
        this.pattern = '';
        this.patternMatchCase = false;
        this.party = AnyParty;
        this.optionUnitBits = 0;
        this.domainOpt = '';
        this.denyallowOpt = '';
        this.headerOpt = undefined;
        this.isPureHostname = false;
        this.isRegex = false;
        this.strictParty = 0;
        this.token = '*';
        this.tokenHash = this.noTokenHash;
        this.tokenBeg = 0;
        this.typeBits = 0;
        this.notTypes = 0;
        this.firstWildcardPos = -1;
        this.secondWildcardPos = -1;
        this.firstCaretPos = -1;
        this.secondCaretPos = -1;
        this.unsupported = false;
        return this;
    }

    clone() {
        return new FilterParser(this.parser, this);
    }

    normalizeRegexSource(s) {
        try {
            const re = new RegExp(s);
            return re.source;
        } catch (ex) {
        }
        return '';
    }

    // https://github.com/chrisaljoudi/uBlock/issues/589
    // Be ready to handle multiple negated types

    parseTypeOption(id, not) {
        const typeBit = id !== -1
            ? this.tokenIdToNormalizedType.get(id)
            : allTypesBits;
        if ( not ) {
            this.notTypes |= typeBit;
        } else {
            this.typeBits |= typeBit;
        }
    }

    parsePartyOption(firstParty, not) {
        if ( not ) {
            firstParty = !firstParty;
        }
        this.party |= firstParty ? FirstParty : ThirdParty;
    }

    parseHostnameList(s, modeBits, out = []) {
        let beg = 0;
        let slen = s.length;
        let i = 0;
        while ( beg < slen ) {
            let end = s.indexOf('|', beg);
            if ( end === -1 ) { end = slen; }
            const hn = this.parser.normalizeHostnameValue(
                s.slice(beg, end),
                modeBits
            );
            if ( hn !== undefined ) {
                out[i] = hn; i += 1;
            }
            beg = end + 1;
        }
        out.length = i;
        return i === 1 ? out[0] : out.join('|');
    }

    parseModifierOption(modifier, value) {
        if ( this.modifyType !== undefined ) { return false; }
        this.modifyType = modifier;
        if ( value !== undefined ) {
            this.modifyValue = value;
        } else if ( this.action === AllowAction ) {
            this.modifyValue = '';
        }
        return true;
    }

    parseOptions() {
        for ( let { id, val, not } of this.parser.netOptions() ) {
            switch ( id ) {
            case this.parser.OPTToken1p:
                this.parsePartyOption(true, not);
                break;
            case this.parser.OPTToken1pStrict:
                this.strictParty = this.strictParty === -1 ? 0 : 1;
                this.optionUnitBits |= this.STRICT_PARTY_BIT;
                break;
            case this.parser.OPTToken3p:
                this.parsePartyOption(false, not);
                break;
            case this.parser.OPTToken3pStrict:
                this.strictParty = this.strictParty === 1 ? 0 : -1;
                this.optionUnitBits |= this.STRICT_PARTY_BIT;
                break;
            case this.parser.OPTTokenAll:
                this.parseTypeOption(-1);
                break;
            // https://github.com/uBlockOrigin/uAssets/issues/192
            case this.parser.OPTTokenBadfilter:
                this.badFilter = true;
                break;
            case this.parser.OPTTokenCsp:
                if ( this.parseModifierOption(id, val) === false ) {
                    return false;
                }
                if ( val !== undefined && this.reBadCSP.test(val) ) {
                    return false;
                }
                this.optionUnitBits |= this.CSP_BIT;
                break;
            // https://github.com/gorhill/uBlock/issues/2294
            //   Detect and discard filter if domain option contains
            //   nonsensical characters.
            case this.parser.OPTTokenDomain:
                this.domainOpt = this.parseHostnameList(
                    val,
                    0b1010,
                    this.domainOptList
                );
                if ( this.domainOpt === '' ) { return false; }
                this.optionUnitBits |= this.DOMAIN_BIT;
                break;
            case this.parser.OPTTokenDenyAllow:
                this.denyallowOpt = this.parseHostnameList(val, 0b0000);
                if ( this.denyallowOpt === '' ) { return false; }
                this.optionUnitBits |= this.DENYALLOW_BIT;
                break;
            // https://www.reddit.com/r/uBlockOrigin/comments/d6vxzj/
            //   Add support for `elemhide`. Rarely used but it happens.
            case this.parser.OPTTokenEhide:
                this.parseTypeOption(this.parser.OPTTokenShide, not);
                this.parseTypeOption(this.parser.OPTTokenGhide, not);
                break;
            case this.parser.OPTTokenHeader:
                this.headerOpt = val !== undefined ? val : '';
                this.optionUnitBits |= this.HEADER_BIT;
                break;
            case this.parser.OPTTokenImportant:
                if ( this.action === AllowAction ) { return false; }
                this.action = BlockImportant;
                break;
            // Used by Adguard:
            // https://kb.adguard.com/en/general/how-to-create-your-own-ad-filters#empty-modifier
            case this.parser.OPTTokenEmpty:
                id = this.action === AllowAction
                    ? this.parser.OPTTokenRedirectRule
                    : this.parser.OPTTokenRedirect;
                if ( this.parseModifierOption(id, 'empty') === false ) {
                    return false;
                }
                this.optionUnitBits |= this.REDIRECT_BIT;
                break;
            case this.parser.OPTTokenMatchCase:
                this.patternMatchCase = true;
                break;
            case this.parser.OPTTokenMp4:
                id = this.action === AllowAction
                    ? this.parser.OPTTokenRedirectRule
                    : this.parser.OPTTokenRedirect;
                if ( this.parseModifierOption(id, 'noopmp4-1s') === false ) {
                    return false;
                }
                this.optionUnitBits |= this.REDIRECT_BIT;
                break;
            case this.parser.OPTTokenNoop:
                break;
            case this.parser.OPTTokenQueryprune:
                if ( this.parseModifierOption(id, val) === false ) {
                    return false;
                }
                this.optionUnitBits |= this.QUERYPRUNE_BIT;
                break;
            case this.parser.OPTTokenRedirect:
                if ( this.action === AllowAction ) {
                    id = this.parser.OPTTokenRedirectRule;
                }
                if ( this.parseModifierOption(id, val) === false ) {
                    return false;
                }
                this.optionUnitBits |= this.REDIRECT_BIT;
                break;
            case this.parser.OPTTokenRedirectRule:
                if ( this.parseModifierOption(id, val) === false ) {
                    return false;
                }
                this.optionUnitBits |= this.REDIRECT_BIT;
                break;
            case this.parser.OPTTokenInvalid:
                return false;
            default:
                if ( this.tokenIdToNormalizedType.has(id) === false ) {
                    return false;
                }
                this.parseTypeOption(id, not);
                break;
            }
        }

        if ( this.party === AllParties ) {
            this.party = AnyParty;
        }
        // Negated network types? Toggle on all network type bits.
        // Negated non-network types can only toggle themselves.
        if ( (this.notTypes & allNetworkTypesBits) !== 0 ) {
            this.typeBits |= allNetworkTypesBits;
        }
        if ( this.notTypes !== 0 ) {
            this.typeBits &= ~this.notTypes;
            if ( this.typeBits === 0 ) { return false; }
        }
        // CSP directives implicitly apply only to document/subdocument.
        if ( this.modifyType === this.parser.OPTTokenCsp ) {
            if ( this.typeBits === 0 ) {
                this.parseTypeOption(this.parser.OPTTokenDoc, false);
                this.parseTypeOption(this.parser.OPTTokenFrame, false);
            }
        }
        // https://github.com/gorhill/uBlock/issues/2283
        //   Abort if type is only for unsupported types, otherwise
        //   toggle off `unsupported` bit.
        if ( this.typeBits & unsupportedTypeBit ) {
            this.typeBits &= ~unsupportedTypeBit;
            if ( this.typeBits === 0 ) { return false; }
        }
        return true;
    }

    parse(parser) {
        // important!
        this.reset(parser);

        if ( parser.hasError() ) {
            this.invalid = true;
            return this;
        }

        // Filters which pattern is a single character other than `*` and have
        // no narrowing options are discarded as invalid.
        if ( parser.patternIsDubious() ) {
            this.invalid = true;
            return this;
        }

        // block or allow filter?
        // Important: this must be executed before parsing options
        if ( parser.isException() ) {
            this.action = AllowAction;
        }

        this.isPureHostname = parser.patternIsPlainHostname();

        // Plain hostname? (from HOSTS file)
        if ( this.isPureHostname && parser.hasOptions() === false ) {
            this.pattern = parser.patternToLowercase();
            this.anchor |= 0b100;
            return this;
        }

        // options
        if ( parser.hasOptions() && this.parseOptions() === false ) {
            this.unsupported = true;
            return this;
        }

        // regex?
        if ( parser.patternIsRegex() ) {
            this.isRegex = true;
            // https://github.com/gorhill/uBlock/issues/1246
            //   If the filter is valid, use the corrected version of the
            //   source string -- this ensure reverse-lookup will work fine.
            this.pattern = this.normalizeRegexSource(parser.getNetPattern());
            if ( this.pattern === '' ) {
                this.unsupported = true;
            }
            return this;
        }

        let pattern;
        if ( parser.patternIsMatchAll() ) {
            pattern = '*';
        } else {
            pattern = parser.patternToLowercase();
        }

        if ( parser.patternIsLeftHostnameAnchored() ) {
            this.anchor |= 0b100;
        } else if ( parser.patternIsLeftAnchored() ) {
            this.anchor |= 0b010;
        }
        if ( parser.patternIsRightAnchored() ) {
            this.anchor |= 0b001;
        }

        if ( parser.patternHasWildcard() ) {
            this.firstWildcardPos = pattern.indexOf('*');
            if ( this.firstWildcardPos !== -1 ) {
                this.secondWildcardPos =
                    pattern.indexOf('*', this.firstWildcardPos + 1);
            }
        }

        if ( parser.patternHasCaret() ) {
            this.firstCaretPos = pattern.indexOf('^');
            if ( this.firstCaretPos !== -1 ) {
                this.secondCaretPos =
                    pattern.indexOf('^', this.firstCaretPos + 1);
            }
        }

        if ( pattern.length > 1024 ) {
            this.unsupported = true;
            return this;
        }

        this.pattern = pattern;

        return this;
    }

    // Given a string, find a good token. Tokens which are too generic,
    // i.e. very common with a high probability of ending up as a miss,
    // are not good. Avoid if possible. This has a significant positive
    // impact on performance.
    //
    // For pattern-less queryprune filters, try to derive a pattern from
    // the queryprune value.

    makeToken() {
        if ( this.pattern === '*' ) {
            if ( this.modifyType !== this.parser.OPTTokenQueryprune ) {
                return;
            }
            return this.extractTokenFromQuerypruneValue();
        }
        if ( this.isRegex ) {
            return this.extractTokenFromRegex(this.pattern);
        }
        this.extractTokenFromPattern(this.pattern);
    }

    // Note: a one-char token is better than a documented bad token.
    extractTokenFromPattern(pattern) {
        this.reToken.lastIndex = 0;
        let bestMatch = null;
        let bestBadness = 0x7FFFFFFF;
        for (;;) {
            const match = this.reToken.exec(pattern);
            if ( match === null ) { break; }
            const token = match[0];
            const badness = token.length > 1 ? this.badTokens.get(token) || 0 : 1;
            if ( badness >= bestBadness ) { continue; }
            if ( match.index > 0 ) {
                const c = pattern.charCodeAt(match.index - 1);
                if ( c === 0x2A /* '*' */ ) { continue; }
            }
            if ( token.length < this.maxTokenLen ) {
                const lastIndex = this.reToken.lastIndex;
                if ( lastIndex < pattern.length ) {
                    const c = pattern.charCodeAt(lastIndex);
                    if ( c === 0x2A /* '*' */ ) { continue; }
                }
            }
            bestMatch = match;
            if ( badness === 0 ) { break; }
            bestBadness = badness;
        }
        if ( bestMatch !== null ) {
            this.token = bestMatch[0];
            this.tokenHash = urlTokenizer.tokenHashFromString(this.token);
            this.tokenBeg = bestMatch.index;
        }
    }

    // https://github.com/gorhill/uBlock/issues/2781
    //   For efficiency purpose, try to extract a token from a regex-based
    //   filter.
    // https://github.com/uBlockOrigin/uBlock-issues/issues/1145#issuecomment-657036902
    //   Mind `\b` directives: `/\bads\b/` should result in token being `ads`,
    //   not `bads`.
    extractTokenFromRegex(pattern) {
        pattern = vAPI.StaticFilteringParser.regexUtils.toTokenizableStr(pattern);
        this.reToken.lastIndex = 0;
        let bestToken;
        let bestBadness = 0x7FFFFFFF;
        for (;;) {
            const matches = this.reToken.exec(pattern);
            if ( matches === null ) { break; }
            const { 0: token, index } = matches;
            if ( index === 0 || pattern.charAt(index - 1) === '\x01' ) {
                continue;
            }
            const { lastIndex } = this.reToken;
            if (
                token.length < this.maxTokenLen && (
                    lastIndex === pattern.length ||
                    pattern.charAt(lastIndex) === '\x01'
                )
            ) {
                continue;
            }
            const badness = token.length > 1
                ? this.badTokens.get(token) || 0
                : 1;
            if ( badness < bestBadness ) {
                bestToken = token;
                if ( badness === 0 ) { break; }
                bestBadness = badness;
            }
        }
        if ( bestToken !== undefined ) {
            this.token = bestToken.toLowerCase();
            this.tokenHash = urlTokenizer.tokenHashFromString(this.token);
        }
    }

    extractTokenFromQuerypruneValue() {
        const pattern = this.modifyValue;
        if ( pattern === '*' || pattern.charCodeAt(0) === 0x7E /* '~' */ ) {
            return;
        }
        const match = /^\/(.+)\/i?$/.exec(pattern);
        if ( match !== null ) {
            return this.extractTokenFromRegex(match[1]);
        }
        if ( pattern.startsWith('|') ) {
            return this.extractTokenFromRegex('\\b' + pattern.slice(1));
        }
        this.extractTokenFromPattern(encodeURIComponent(pattern).toLowerCase());
    }

    hasNoOptionUnits() {
        return this.optionUnitBits === 0;
    }

    isJustOrigin() {
        return this.optionUnitBits === this.DOMAIN_BIT &&
            this.isRegex === false && (
                this.pattern === '*' || (
                    this.anchor === 0b010 &&
                    /^(?:http[s*]?:(?:\/\/)?)$/.test(this.pattern)
                )
            ) &&
            this.domainOpt.indexOf('~') === -1;
    }

    domainIsEntity(s) {
        const l = s.length;
        return l > 2 &&
               s.charCodeAt(l-1) === 0x2A /* '*' */ &&
               s.charCodeAt(l-2) === 0x2E /* '.' */;
    }
};

FilterParser.prototype.DOMAIN_BIT       = 0b00000001;
FilterParser.prototype.DENYALLOW_BIT    = 0b00000010;
FilterParser.prototype.HEADER_BIT       = 0b00000100;
FilterParser.prototype.STRICT_PARTY_BIT = 0b00001000;

FilterParser.prototype.CSP_BIT          = 0b00010000;
FilterParser.prototype.QUERYPRUNE_BIT   = 0b00100000;
FilterParser.prototype.REDIRECT_BIT     = 0b01000000;

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

    return p => {
        if ( parser === undefined ) {
            parser = new FilterParser(p);
        }
        last = Date.now();
        if ( ttlTimer === undefined ) {
            ttlTimer = vAPI.setTimeout(ttlProcess, 10007);
        }
        return parser.parse(p);
    };
})();

/******************************************************************************/
/******************************************************************************/

const FilterContainer = function() {
    this.MAX_TOKEN_LENGTH = urlTokenizer.MAX_TOKEN_LENGTH;
    this.noTokenHash = urlTokenizer.noTokenHash;
    this.dotTokenHash = urlTokenizer.dotTokenHash;
    this.anyTokenHash = urlTokenizer.anyTokenHash;
    this.anyHTTPSTokenHash = urlTokenizer.anyHTTPSTokenHash;
    this.anyHTTPTokenHash = urlTokenizer.anyHTTPTokenHash;
    this.optimizeTimerId = undefined;

    // As long as CategoryCount is reasonably low, we will use an array to
    // store buckets using category bits as index. If ever CategoryCount
    // becomes too large, we can just go back to using a Map.
    this.categories = (( ) => {
        const out = [];
        for ( let i = 0; i < CategoryCount; i++ ) { out[i] = undefined; }
        return out;
    })();

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
    this.categories.fill(undefined);

    urlTokenizer.resetKnownTokens();

    // This will invalidate all tries
    FilterHostnameDict.reset();
    filterOrigin.reset();
    bidiTrie.reset();
    filterArgsToUnit.clear();

    filterUnitWritePtr = FILTER_UNITS_MIN;
    filterSequenceWritePtr = FILTER_SEQUENCES_MIN;

    // Cancel potentially pending optimization run.
    if ( this.optimizeTimerId !== undefined ) {
        self.cancelIdleCallback(this.optimizeTimerId);
        this.optimizeTimerId = undefined;
    }

    // Runtime registers
    this.$catBits = 0;
    this.$tokenHash = 0;
    this.$filterUnit = 0;
};

/******************************************************************************/

FilterContainer.prototype.freeze = function() {
    const filterBucketId = FilterBucket.fid;
    const unserialize = µb.CompiledLineIO.unserialize;

    const t0 = Date.now();

    for ( const line of this.goodFilters ) {
        if ( this.badFilters.has(line) ) {
            this.discardedCount += 1;
            continue;
        }

        const args = unserialize(line);
        const bits = args[0];

        // Plain static filters.
        const tokenHash = args[1];
        const fdata = args[2];

        let bucket = this.categories[bits];
        if ( bucket === undefined ) {
            bucket = new Map();
            this.categories[bits] = bucket;
        }
        let iunit = bucket.get(tokenHash);

        if ( tokenHash === this.dotTokenHash ) {
            if ( iunit === undefined ) {
                iunit = filterUnitFromCtor(FilterHostnameDict);
                bucket.set(this.dotTokenHash, iunit);
            }
            filterUnits[iunit].add(fdata);
            continue;
        }

        if ( tokenHash === this.anyTokenHash ) {
            if ( iunit === undefined ) {
                iunit = filterUnitFromCtor(FilterJustOrigin);
                bucket.set(this.anyTokenHash, iunit);
            }
            filterUnits[iunit].add(fdata);
            continue;
        }

        if ( tokenHash === this.anyHTTPSTokenHash ) {
            if ( iunit === undefined ) {
                iunit = filterUnitFromCtor(FilterHTTPSJustOrigin);
                bucket.set(this.anyHTTPSTokenHash, iunit);
            }
            filterUnits[iunit].add(fdata);
            continue;
        }

        if ( tokenHash === this.anyHTTPTokenHash ) {
            if ( iunit === undefined ) {
                iunit = filterUnitFromCtor(FilterHTTPJustOrigin);
                bucket.set(this.anyHTTPTokenHash, iunit);
            }
            filterUnits[iunit].add(fdata);
            continue;
        }

        urlTokenizer.addKnownToken(tokenHash);

        const inewunit = filterUnitFromCompiled(fdata);

        if ( iunit === undefined ) {
            bucket.set(tokenHash, inewunit);
            continue;
        }
        let f = filterUnits[iunit];
        if ( f.fid === filterBucketId ) {
            f.unshift(inewunit);
            continue;
        }
        const ibucketunit = filterUnitFromCtor(FilterBucket);
        f = filterUnits[ibucketunit];
        f.unshift(iunit);
        f.unshift(inewunit);
        bucket.set(tokenHash, ibucketunit);
    }

    this.badFilters.clear();
    this.goodFilters.clear();
    filterArgsToUnit.clear();

    // Optimizing is not critical for the static network filtering engine to
    // work properly, so defer this until later to allow for reduced delay to
    // readiness when no valid selfie is available.
    this.optimizeTimerId = self.requestIdleCallback(( ) => {
        this.optimizeTimerId = undefined;
        this.optimize();
    }, { timeout: 5000 });

    log.info(`staticNetFilteringEngine.freeze() took ${Date.now()-t0} ms`);
};

/******************************************************************************/

FilterContainer.prototype.optimize = function() {
    const t0 = Date.now();

    for ( let bits = 0, n = this.categories.length; bits < n; bits++ ) {
        const bucket = this.categories[bits];
        if ( bucket === undefined ) { continue; }
        for ( const [ th, iunit ] of bucket ) {
            const f = filterUnits[iunit];
            if ( f instanceof FilterBucket === false ) { continue; }
            const optimizeBits =
                (th === this.noTokenHash) || (bits & ModifyAction) !== 0
                    ? 0b10
                    : 0b01;
            const g = f.optimize(optimizeBits);
            if ( g !== undefined ) {
                filterUnits[iunit] = g;
            }
        }
    }
    FilterHostnameDict.optimize();
    bidiTrieOptimize();
    // Be sure unused filters can be garbage collected.
    for ( let i = filterUnitWritePtr, n = filterUnits.length; i < n; i++ ) {
        filterUnits[i] = null;
    }

    log.info(`staticNetFilteringEngine.optimize() took ${Date.now()-t0} ms`);
};

/******************************************************************************/

FilterContainer.prototype.toSelfie = function(path) {
    const categoriesToSelfie = ( ) => {
        const selfie = [];
        for ( let bits = 0, n = this.categories.length; bits < n; bits++ ) {
            const bucket = this.categories[bits];
            if ( bucket === undefined ) { continue; }
            selfie.push([ bits, Array.from(bucket) ]);
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
                Uint32Array.from(filterSequences).buffer,
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
                filterUnits: filterUnits.slice(0, filterUnitWritePtr).map(f =>
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
            filterSequenceWritePtr = size;
            const buf32 = µb.base64.decode(details.content);
            for ( let i = 0; i < size; i++ ) {
                filterSequences[i] = buf32[i];
            }
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
            {
                const fselfies = selfie.filterUnits;
                filterUnitWritePtr = fselfies.length;
                filterUnitBufferResize(filterUnitWritePtr);
                for ( let i = 0, n = fselfies.length; i < n; i++ ) {
                    const f = fselfies[i];
                    filterUnits[i] = f !== null ? filterFromSelfie(f) : null;
                }
            }
            for ( const [ catBits, bucket ] of selfie.categories ) {
                this.categories[catBits] = new Map(bucket);
            }
            return true;
        }),
    ]).then(results =>
        results.every(v => v === true)
    );
};

/******************************************************************************/

FilterContainer.prototype.compile = function(parser, writer) {
    // ORDER OF TESTS IS IMPORTANT!

    const parsed = FilterParser.parse(parser);

    // Ignore non-static network filters
    if ( parsed.invalid ) { return false; }

    // Ignore filters with unsupported options
    if ( parsed.unsupported ) {
        const who = writer.properties.get('assetKey') || '?';
        µb.logger.writeOne({
            realm: 'message',
            type: 'error',
            text: `Invalid network filter in ${who}: ${parser.raw}`
        });
        return false;
    }

    writer.select(
        parsed.badFilter
            ? µb.compiledNetworkSection + µb.compiledBadSubsection
            : µb.compiledNetworkSection
    );

    // Reminder:
    //   `redirect=` is a combination of a `redirect-rule` filter and a
    //   block filter.
    if ( parsed.modifyType === parser.OPTTokenRedirect ) {
        parsed.modifyType = parser.OPTTokenRedirectRule;
        const parsedBlock = parsed.clone();
        parsedBlock.modifyType = undefined;
        parsedBlock.optionUnitBits &= ~parsed.REDIRECT_BIT;
        this.compileParsed(parsedBlock, writer);
    }

    this.compileParsed(parsed, writer);

    return true;
};

/******************************************************************************/

FilterContainer.prototype.compileParsed = function(parsed, writer) {
    // Pure hostnames, use more efficient dictionary lookup
    if ( parsed.isPureHostname && parsed.hasNoOptionUnits() ) {
        parsed.tokenHash = this.dotTokenHash;
        this.compileToAtomicFilter(parsed, parsed.pattern, writer);
        return;
    }

    parsed.makeToken();

    // Special pattern/option cases:
    // - `*$domain=...`
    // - `|http://$domain=...`
    // - `|https://$domain=...`
    // The semantic of "just-origin" filters is that contrary to normal
    // filters, the original filter is split into as many filters as there
    // are entries in the `domain=` option.
    if ( parsed.isJustOrigin() ) {
        const tokenHash = parsed.tokenHash;
        if ( parsed.pattern === '*' || parsed.pattern.startsWith('http*') ) {
            parsed.tokenHash = this.anyTokenHash;
        } else if /* 'https:' */ ( parsed.pattern.startsWith('https') ) {
            parsed.tokenHash = this.anyHTTPSTokenHash;
        } else /* 'http:' */ {
            parsed.tokenHash = this.anyHTTPTokenHash;
        }
        const entities = [];
        for ( const hn of parsed.domainOptList ) {
            if ( parsed.domainIsEntity(hn) === false ) {
                this.compileToAtomicFilter(parsed, hn, writer);
            } else {
                entities.push(hn);
            }
        }
        if ( entities.length === 0 ) { return; }
        parsed.tokenHash = tokenHash;
        const leftAnchored = (parsed.anchor & 0b010) !== 0;
        for ( const entity of entities ) {
            const units = [];
            filterPattern.compile(parsed, units);
            if ( leftAnchored ) { units.push(FilterAnchorLeft.compile()); }
            filterOrigin.compile([ entity ], true, units);
            this.compileToAtomicFilter(
                parsed, FilterCompositeAll.compile(units), writer
            );
        }
        return;
    }

    const units = [];

    // Pattern
    filterPattern.compile(parsed, units);

    // Anchor
    if ( (parsed.anchor & 0b100) !== 0 ) {
        if ( parsed.isPureHostname ) {
            units.push(FilterAnchorHn.compile());
        } else {
            units.push(FilterAnchorHnLeft.compile());
        }
    } else if ( (parsed.anchor & 0b010) !== 0 ) {
        units.push(FilterAnchorLeft.compile());
    }
    if ( (parsed.anchor & 0b001) !== 0 ) {
        units.push(FilterAnchorRight.compile());
    }

    // Strict partiness
    if ( parsed.strictParty !== 0 ) {
        units.push(FilterStrictParty.compile(parsed));
    }

    // Origin
    if ( parsed.domainOpt !== '' ) {
        filterOrigin.compile(
            parsed.domainOptList,
            units.length !== 0 && filterClasses[units[0][0]].isSlow === true,
            units
        );
    }

    // Deny-allow
    if ( parsed.denyallowOpt !== '' ) {
        units.push(FilterDenyAllow.compile(parsed));
    }

    // Header
    if ( parsed.headerOpt !== undefined ) {
        units.push(FilterOnHeaders.compile(parsed));
        parsed.action |= Headers;
    }

    // Modifier
    //
    // IMPORTANT: the modifier unit MUST always appear first in a sequence
    if ( parsed.modifyType !== undefined ) {
        units.unshift(FilterModifier.compile(parsed));
        parsed.action = (parsed.action & ~ActionBitsMask) | ModifyAction;
    }

    const fdata = units.length === 1
        ? units[0]
        : FilterCompositeAll.compile(units);
    this.compileToAtomicFilter(parsed, fdata, writer);
};

/******************************************************************************/

FilterContainer.prototype.compileToAtomicFilter = function(
    parsed,
    fdata,
    writer
) {
    const catBits = parsed.action | parsed.party;
    let typeBits = parsed.typeBits;

    // Typeless
    if ( typeBits === 0 ) {
        writer.push([ catBits, parsed.tokenHash, fdata ]);
        return;
    }

    // If all network types are set, create a typeless filter
    if ( (typeBits & allNetworkTypesBits) === allNetworkTypesBits ) {
        writer.push([ catBits, parsed.tokenHash, fdata ]);
        typeBits &= ~allNetworkTypesBits;
    }

    // One filter per specific types
    let bitOffset = 1;
    do {
        if ( typeBits & 1 ) {
            writer.push([
                catBits | (bitOffset << TypeBitsOffset),
                parsed.tokenHash,
                fdata
            ]);
        }
        bitOffset += 1;
        typeBits >>>= 1;
    } while ( typeBits !== 0 );
};

/******************************************************************************/

FilterContainer.prototype.fromCompiledContent = function(reader) {
    reader.select(µb.compiledNetworkSection);
    while ( reader.next() ) {
        this.acceptedCount += 1;
        if ( this.goodFilters.has(reader.line) ) {
            this.discardedCount += 1;
        } else {
            this.goodFilters.add(reader.line);
        }
    }

    reader.select(µb.compiledNetworkSection + µb.compiledBadSubsection);
    while ( reader.next() ) {
        this.badFilters.add(reader.line);
    }
};

/******************************************************************************/

FilterContainer.prototype.matchAndFetchModifiers = function(
    fctxt,
    modifierType
) {
    $requestURL = urlTokenizer.setURL(fctxt.url);
    $requestURLRaw = fctxt.url;
    $docHostname = fctxt.getDocHostname();
    $docDomain = fctxt.getDocDomain();
    $docEntity.reset();
    $requestHostname = fctxt.getHostname();

    const typeBits = typeNameToTypeValue[fctxt.type] || otherTypeBitValue;
    const partyBits = fctxt.is3rdPartyToDoc() ? ThirdParty : FirstParty;

    const catBits00 = ModifyAction;
    const catBits01 = ModifyAction | typeBits;
    const catBits10 = ModifyAction | partyBits;
    const catBits11 = ModifyAction | typeBits | partyBits;

    const bucket00 = this.categories[catBits00];
    const bucket01 = typeBits !== 0
        ? this.categories[catBits01]
        : undefined;
    const bucket10 = partyBits !== 0
        ? this.categories[catBits10]
        : undefined;
    const bucket11 = typeBits !== 0 && partyBits !== 0
        ? this.categories[catBits11]
        : undefined;

    if (
        bucket00 === undefined && bucket01 === undefined &&
        bucket10 === undefined && bucket11 === undefined
    ) {
        return;
    }

    const results = [];
    const env = {
        modifier: vAPI.StaticFilteringParser.netOptionTokenIds.get(modifierType) || 0,
        bits: 0,
        th: 0,
        iunit: 0,
        results,
    };

    const tokenHashes = urlTokenizer.getTokens(bidiTrie);
    let i = 0;
    for (;;) {
        const th = tokenHashes[i];
        if ( th === 0 ) { break; }
        env.th = th;
        $tokenBeg = tokenHashes[i+1];
        if ( bucket00 !== undefined ) {
            const iunit = bucket00.get(th);
            if ( iunit !== undefined ) {
                env.bits = catBits00; env.iunit = iunit;
                filterUnits[iunit].matchAndFetchModifiers(env);
            }
        }
        if ( bucket01 !== undefined ) {
            const iunit = bucket01.get(th);
            if ( iunit !== undefined ) {
                env.bits = catBits01; env.iunit = iunit;
                filterUnits[iunit].matchAndFetchModifiers(env);
            }
        }
        if ( bucket10 !== undefined ) {
            const iunit = bucket10.get(th);
            if ( iunit !== undefined ) {
                env.bits = catBits10; env.iunit = iunit;
                filterUnits[iunit].matchAndFetchModifiers(env);
            }
        }
        if ( bucket11 !== undefined ) {
            const iunit = bucket11.get(th);
            if ( iunit !== undefined ) {
                env.bits = catBits11; env.iunit = iunit;
                filterUnits[iunit].matchAndFetchModifiers(env);
            }
        }
        i += 2;
    }

    if ( results.length === 0 ) { return; }

    // One single result is expected to be a common occurrence, and in such
    // case there is no need to process exception vs. block, block important
    // occurrences.
    if ( results.length === 1 ) {
        const result = results[0];
        if ( (result.bits & AllowAction) !== 0 ) { return; }
        return [ result ];
    }

    const toAddImportant = new Map();
    const toAdd = new Map();
    const toRemove = new Map();

    for ( const result of results ) {
        const actionBits = result.bits & ActionBitsMask;
        const modifyValue = result.modifier.value;
        if ( actionBits === BlockImportant ) {
            toAddImportant.set(modifyValue, result);
        } else if ( actionBits === BlockAction ) {
            toAdd.set(modifyValue, result);
        } else {
            toRemove.set(modifyValue, result);
        }
    }
    if ( toAddImportant.size === 0 && toAdd.size === 0 ) { return; }

    // Remove entries overriden by important block filters.
    if ( toAddImportant.size !== 0 ) {
        for ( const key of toAddImportant.keys() ) {
            toAdd.delete(key);
            toRemove.delete(key);
        }
    }

    // Exception filters
    //
    // Remove excepted block filters and unused exception filters.
    //
    // Special case, except-all:
    // - Except-all applies only if there is at least one normal block filters.
    // - Except-all does not apply to important block filters.
    if ( toRemove.size !== 0 ) {
        if ( toRemove.has('') === false ) {
            for ( const key of toRemove.keys() ) {
                if ( toAdd.has(key) ) {
                    toAdd.delete(key);
                } else {
                    toRemove.delete(key);
                }
            }
        }
        else if ( toAdd.size !== 0 ) {
            toAdd.clear();
            if ( toRemove.size !== 1 ) {
                const entry = toRemove.get('');
                toRemove.clear();
                toRemove.set('', entry);
            }
        } else {
            toRemove.clear();
        }
    }

    if (
        toAdd.size === 0 &&
        toAddImportant.size === 0 &&
        toRemove.size === 0
    ) {
        return;
    }

    const out = Array.from(toAdd.values());
    if ( toAddImportant.size !== 0 ) {
        out.push(...toAddImportant.values());
    }
    if ( toRemove.size !== 0 ) {
        out.push(...toRemove.values());
    }
    return out;
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
        ? this.categories[catBits00]
        : undefined;
    const bucket01 = exactType !== 0 || typeBits !== 0
        ? this.categories[catBits01]
        : undefined;
    const bucket10 = exactType === 0 && partyBits !== 0
        ? this.categories[catBits10]
        : undefined;
    const bucket11 = (exactType !== 0 || typeBits !== 0) && partyBits !== 0
        ? this.categories[catBits11]
        : undefined;

    if (
        bucket00 === undefined && bucket01 === undefined &&
        bucket10 === undefined && bucket11 === undefined
    ) {
        return false;
    }

    let catBits = 0, iunit = 0;

    // Pure hostname-based filters
    let tokenHash = this.dotTokenHash;
    if (
        (bucket00 !== undefined) &&
        (iunit = bucket00.get(tokenHash) || 0) !== 0 &&
        (filterUnits[iunit].match() === true)
    ) {
        catBits = catBits00;
    } else if (
        (bucket01 !== undefined) &&
        (iunit = bucket01.get(tokenHash) || 0) !== 0 &&
        (filterUnits[iunit].match() === true)
    ) {
        catBits = catBits01;
    } else if (
        (bucket10 !== undefined) &&
        (iunit = bucket10.get(tokenHash) || 0) !== 0 &&
        (filterUnits[iunit].match() === true)
    ) {
        catBits = catBits10;
    } else if (
        (bucket11 !== undefined) &&
        (iunit = bucket11.get(tokenHash) || 0) !== 0 &&
        (filterUnits[iunit].match() === true)
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
                (filterUnits[iunit].match() === true)
            ) {
                catBits = catBits00;
                break;
            }
            if (
                (bucket01 !== undefined) &&
                (iunit = bucket01.get(tokenHash) || 0) !== 0 &&
                (filterUnits[iunit].match() === true)
            ) {
                catBits = catBits01;
                break;
            }
            if (
                (bucket10 !== undefined) &&
                (iunit = bucket10.get(tokenHash) || 0) !== 0 &&
                (filterUnits[iunit].match() === true)
            ) {
                catBits = catBits10;
                break;
            }
            if (
                (bucket11 !== undefined) &&
                (iunit = bucket11.get(tokenHash) || 0) !== 0 &&
                (filterUnits[iunit].match() === true)
            ) {
                catBits = catBits11;
                break;
            }
            i += 2;
        }
    }

    this.$catBits = catBits;
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
    $requestURLRaw = url;
    this.$filterUnit = 0;

    // These registers will be used by various filters
    $docHostname = $requestHostname = vAPI.hostnameFromNetworkURL(url);
    $docDomain = vAPI.domainFromHostname($docHostname);
    $docEntity.reset();

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
// https://github.com/uBlockOrigin/uBlock-issues/issues/1501
//   Add support to evaluate allow realm before block realm.

/**
 * Matches a URL string using filtering context.
 * @param {FilteringContext} fctxt - The filtering context
 * @param {integer} [modifier=0] - A bit vector modifying the behavior of the
 *   matching algorithm:
 *   Bit 0: match exact type.
 *   Bit 1: lookup allow realm regardless of whether there was a match in
 *          block realm.
 *
 * @returns {integer} 0=no match, 1=block, 2=allow (exeption)
 */
FilterContainer.prototype.matchString = function(fctxt, modifiers = 0) {
    let typeValue = typeNameToTypeValue[fctxt.type];
    if ( modifiers === 0 ) {
        if ( typeValue === undefined ) {
            typeValue = otherTypeBitValue;
        } else if ( typeValue === 0 || typeValue > otherTypeBitValue ) {
            modifiers |= 0b0001;
        }
    }
    if ( (modifiers & 0b0001) !== 0 ) {
        if ( typeValue === undefined ) { return 0; }
        typeValue |= 0x80000000;
    }

    const partyBits = fctxt.is3rdPartyToDoc() ? ThirdParty : FirstParty;

    // Prime tokenizer: we get a normalized URL in return.
    $requestURL = urlTokenizer.setURL(fctxt.url);
    $requestURLRaw = fctxt.url;
    this.$filterUnit = 0;

    // These registers will be used by various filters
    $docHostname = fctxt.getDocHostname();
    $docDomain = fctxt.getDocDomain();
    $docEntity.reset();
    $requestHostname = fctxt.getHostname();

    // Important block realm.
    if ( this.realmMatchString(BlockImportant, typeValue, partyBits) ) {
        return 1;
    }

    // Evaluate block realm before allow realm.
    const r = this.realmMatchString(BlockAction, typeValue, partyBits);
    if ( r || (modifiers & 0b0010) !== 0 ) {
        if ( this.realmMatchString(AllowAction, typeValue, partyBits) ) {
            return 2;
        }
        if ( r ) { return 1; }
    }
    return 0;
};

/******************************************************************************/

FilterContainer.prototype.matchHeaders = function(fctxt, headers) {
    const typeValue = typeNameToTypeValue[fctxt.type] || otherTypeBitValue;
    const partyBits = fctxt.is3rdPartyToDoc() ? ThirdParty : FirstParty;

    // Prime tokenizer: we get a normalized URL in return.
    $requestURL = urlTokenizer.setURL(fctxt.url);
    $requestURLRaw = fctxt.url;
    this.$filterUnit = 0;

    // These registers will be used by various filters
    $docHostname = fctxt.getDocHostname();
    $docDomain = fctxt.getDocDomain();
    $docEntity.reset();
    $requestHostname = fctxt.getHostname();
    $httpHeaders.init(headers);

    let r = 0;
    if ( this.realmMatchString(Headers | BlockImportant, typeValue, partyBits) ) {
        r = 1;
    } else if ( this.realmMatchString(Headers | BlockAction, typeValue, partyBits) ) {
        r = this.realmMatchString(Headers | AllowAction, typeValue, partyBits)
            ? 2
            : 1;
    }

    $httpHeaders.reset();

    return r;
};

/******************************************************************************/

FilterContainer.prototype.redirectRequest = function(fctxt) {
    const directives = this.matchAndFetchModifiers(fctxt, 'redirect-rule');
    // No directive is the most common occurrence.
    if ( directives === undefined ) { return; }
    const highest = directives.length - 1;
    // More than a single directive means more work.
    if ( highest !== 0 ) {
        directives.sort(FilterContainer.compareRedirectRequests);
    }
    // Redirect to highest-ranked directive
    const directive = directives[highest];
    if ( (directive.bits & AllowAction) === 0 ) {
        const { token } =
            FilterContainer.parseRedirectRequestValue(directive.modifier);
        fctxt.redirectURL = µb.redirectEngine.tokenToURL(fctxt, token);
        if ( fctxt.redirectURL === undefined ) { return; }
    }
    return directives;
};

FilterContainer.parseRedirectRequestValue = function(modifier) {
    if ( modifier.cache === undefined ) {
        modifier.cache =
            vAPI.StaticFilteringParser.parseRedirectValue(modifier.value);
    }
    return modifier.cache;
};

FilterContainer.compareRedirectRequests = function(a, b) {
    const { token: atok, priority: aint, bits: abits } =
        FilterContainer.parseRedirectRequestValue(a.modifier);
    if ( µb.redirectEngine.hasToken(atok) === false ) { return -1; }
    const { token: btok, priority: bint, bits: bbits } =
        FilterContainer.parseRedirectRequestValue(b.modifier);
    if ( µb.redirectEngine.hasToken(btok) === false ) { return 1; }
    if ( abits !== bbits ) {
        if ( (abits & Important) !== 0 ) { return 1; }
        if ( (bbits & Important) !== 0 ) { return -1; }
        if ( (abits & AllowAction) !== 0 ) { return -1; }
        if ( (bbits & AllowAction) !== 0 ) { return 1; }
    }
    return aint - bint;
};

/******************************************************************************/

FilterContainer.prototype.filterQuery = function(fctxt) {
    const directives = this.matchAndFetchModifiers(fctxt, 'queryprune');
    if ( directives === undefined ) { return; }
    const url = fctxt.url;
    const qpos = url.indexOf('?');
    if ( qpos === -1 ) { return; }
    let hpos = url.indexOf('#', qpos + 1);
    if ( hpos === -1 ) { hpos = url.length; }
    const params = new Map(new self.URLSearchParams(url.slice(qpos + 1, hpos)));
    const out = [];
    for ( const directive of directives ) {
        if ( params.size === 0 ) { break; }
        const modifier = directive.modifier;
        const isException = (directive.bits & AllowAction) !== 0;
        if ( isException && modifier.value === '' ) {
            out.push(directive);
            break;
        }
        const { all, bad, name, not, re } = this.parseQueryPruneValue(modifier);
        if ( bad ) { continue; }
        if ( all ) {
            if ( isException === false ) { params.clear(); }
            out.push(directive);
            break;
        }
        if ( name !== undefined ) {
            const value = params.get(name);
            if ( not === false ) {
                if ( value !== undefined ) {
                    if ( isException === false ) { params.delete(name); }
                    out.push(directive);
                }
                continue;
            }
            if ( value !== undefined ) { params.delete(name); }
            if ( params.size !== 0 ) {
                if ( isException === false ) { params.clear(); }
                out.push(directive);
            }
            if ( value !== undefined ) { params.set(name, value); }
            continue;
        }
        if ( re === undefined ) { continue; }
        let filtered = false;
        for ( const [ key, value ] of params ) {
            if ( re.test(`${key}=${value}`) === not ) { continue; }
            if ( isException === false ) { params.delete(key); }
            filtered = true;
        }
        if ( filtered ) {
            out.push(directive);
        }
    }
    if ( out.length === 0 ) { return; }
    fctxt.redirectURL = url.slice(0, qpos);
    if ( params.size !== 0 ) {
        fctxt.redirectURL += '?' + Array.from(params).map(a =>
            a[1] === '' ? a[0] : `${a[0]}=${encodeURIComponent(a[1])}`
        ).join('&');
    }
    if ( hpos !== url.length ) {
        fctxt.redirectURL += url.slice(hpos);
    }
    return out;
};

FilterContainer.prototype.parseQueryPruneValue = function(modifier) {
    if ( modifier.cache === undefined ) {
        modifier.cache =
            vAPI.StaticFilteringParser.parseQueryPruneValue(modifier.value);
    }
    return modifier.cache;
};

/******************************************************************************/

FilterContainer.prototype.hasQuery = function(fctxt) {
    urlTokenizer.setURL(fctxt.url);
    return urlTokenizer.hasQuery();
};

/******************************************************************************/

FilterContainer.prototype.toLogData = function() {
    if ( this.$filterUnit === 0 ) { return; }
    const logData = toLogDataInternal(
        this.$catBits,
        this.$tokenHash,
        this.$filterUnit
    );
    logData.source = 'static';
    logData.tokenHash = this.$tokenHash;
    logData.result = this.$filterUnit === 0
        ? 0
        : ((this.$catBits & AllowAction) === 0 ? 1 : 2);
    return logData;
};

/******************************************************************************/

FilterContainer.prototype.isBlockImportant = function() {
    return (this.$catBits & ActionBitsMask) === BlockImportant;
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
        const text = 'No dataset found to benchmark';
        console.info(text);
        return text;
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
    let matchCount = 0;
    for ( let i = 0; i < requests.length; i++ ) {
        const request = requests[i];
        fctxt.setURL(request.url);
        fctxt.setDocOriginFromURL(request.frameUrl);
        fctxt.setType(request.cpt);
        this.redirectURL = undefined;
        const r = this.matchString(fctxt);
        matchCount += 1;
        if ( recorded !== undefined ) { recorded.push(r); }
        if ( expected !== undefined && r !== expected[i] ) {
            print(`Mismatch with reference results at ${i}:`);
            print(`\tExpected ${expected[i]}, got ${r}:`);
            print(`\ttype=${fctxt.type}`);
            print(`\turl=${fctxt.url}`);
            print(`\tdocOrigin=${fctxt.getDocOrigin()}`);
        }
        if ( r !== 1 ) {
            if ( this.hasQuery(fctxt) ) {
                this.filterQuery(fctxt, 'queryprune');
            }
            if ( fctxt.type === 'main_frame' || fctxt.type === 'sub_frame' ) {
                this.matchAndFetchModifiers(fctxt, 'csp');
            }
            this.matchHeaders(fctxt, []);
        } else {
            this.redirectRequest(fctxt);
        }
    }
    const t1 = self.performance.now();
    const dur = t1 - t0;

    if ( recorded !== undefined ) {
        vAPI.localStorage.setItem(
            'FilterContainer.benchmark.results',
            JSON.stringify(recorded)
        );
    }

    const output = [
        'Benchmarked static network filtering engine:',
        `\tEvaluated ${matchCount} match calls in ${dur.toFixed(0)} ms`,
        `\tAverage: ${(dur / matchCount).toFixed(3)} ms per request`,
    ];
    if ( expected !== undefined ) {
        output.push(
            `\tBlocked: ${expected.reduce((n,r)=>{return r===1?n+1:n;},0)}`,
            `\tExcepted: ${expected.reduce((n,r)=>{return r===2?n+1:n;},0)}`,
        );
    }
    const s = output.join('\n');
    print(s);
    return s;
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
    for ( let bits = 0, n = this.categories.length; bits < n; bits++ ) {
        const category = this.categories[bits];
        if ( category === undefined ) { continue; }
        for ( const [ th, iunit ] of category ) {
            const token = urlTokenizer.stringFromTokenHash(th);
            const f = filterUnits[iunit];
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

    As of 2020-05-15:

        "FilterHostnameDict" Content => 60772}
        "FilterPatternPlain" => 26432}
        "FilterCompositeAll" => 17125}
        "FilterPlainTrie Content" => 13519}
        "FilterAnchorHnLeft" => 11931}
        "FilterOriginHit" => 5524}
        "FilterPatternRight" => 3376}
        "FilterPatternRightEx" => 3130}
        "FilterBucket" => 1961}
        "FilterPlainTrie" => 1578}
        "FilterOriginHitSet" => 1475}
        "FilterAnchorHn" => 1453}
        "FilterOriginMiss" => 730}
        "FilterPatternGeneric" => 601}
        "FilterModifier" => 404}
        "FilterOriginMissSet" => 316}
        "FilterTrailingSeparator" => 235}
        "FilterAnchorRight" => 174}
        "FilterPatternLeft" => 164}
        "FilterRegex" => 125}
        "FilterPatternLeftEx" => 68}
        "FilterHostnameDict" => 62}
        "FilterAnchorLeft" => 51}
        "FilterJustOrigin" => 25}
        "FilterTrue" => 18}
        "FilterHTTPSJustOrigin" => 16}
        "FilterHTTPJustOrigin" => 16}
        "FilterType" => 0}
        "FilterDenyAllow" => 0}

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
        if ( f instanceof FilterCompositeAll ) {
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

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

/* globals vAPI */

'use strict';

/******************************************************************************/

import { queueTask, dropTask } from './tasks.js';
import BidiTrieContainer from './biditrie.js';
import HNTrieContainer from './hntrie.js';
import { sparseBase64 } from './base64-custom.js';
import { StaticFilteringParser } from './static-filtering-parser.js';
import { CompiledListReader } from './static-filtering-io.js';

import {
    domainFromHostname,
    hostnameFromNetworkURL,
} from './uri-utils.js';

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import#browser_compatibility
//
// This import would be best done dynamically, but since dynamic imports are
// not supported by older browsers, for now a static import is necessary.
import { FilteringContext } from './filtering-context.js';

/******************************************************************************/

// Access to a key-val store is optional and useful only for optimal
// initialization at module load time. Probably could re-arrange code
// to export an init() function with optimization parameters which would
// need to be called by module clients. For now, I want modularizing with
// minimal amount of changes.

const keyvalStore = typeof vAPI !== 'undefined'
    ? vAPI.localStorage
    : { getItem() { return null; }, setItem() {}, removeItem() {} };

/******************************************************************************/

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

const CategoryCount  = 1 << 0xb; // shift left to first unused bit

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
const HEADERS        = 0b10000000000;

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
            'webrtc': 20 << TypeBitsOffset,
       'unsupported': 21 << TypeBitsOffset,
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
    '',
    '',
    'webrtc',
    'unsupported',
];

//const typeValueFromCatBits = catBits => (catBits >>> TypeBitsOffset) & 0b11111;

const MAX_TOKEN_LENGTH = 7;

// Four upper bits of token hash are reserved for built-in predefined
// token hashes, which should never end up being used when tokenizing
// any arbitrary string.
const        NO_TOKEN_HASH = 0x50000000;
const       DOT_TOKEN_HASH = 0x10000000;
const       ANY_TOKEN_HASH = 0x20000000;
const ANY_HTTPS_TOKEN_HASH = 0x30000000;
const  ANY_HTTP_TOKEN_HASH = 0x40000000;
const     EMPTY_TOKEN_HASH = 0xF0000000;
const   INVALID_TOKEN_HASH = 0xFFFFFFFF;

/******************************************************************************/

// See the following as short-lived registers, used during evaluation. They are
// valid until the next evaluation.

let $requestTypeValue = 0;
let $requestURL = '';
let $requestURLRaw = '';
let $requestHostname = '';
let $docHostname = '';
let $docDomain = '';
let $tokenBeg = 0;
let $patternMatchLeft = 0;
let $patternMatchRight = 0;
let $isBlockImportant = false;

const $docEntity = {
    entity: '',
    last: '',
    compute() {
        if ( this.last !== $docHostname ) {
            this.last = $docHostname;
            const pos = $docDomain.indexOf('.');
            this.entity = pos !== -1
                ? `${$docHostname.slice(0, pos - $docDomain.length)}.*`
                : '';
        }
        return this.entity;
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

/******************************************************************************/

class LogData {
    constructor(categoryBits, tokenHash, iunit) {
        this.result = 0;
        this.source = 'static';
        this.tokenHash = tokenHash;
        if ( iunit === 0 ) {
            this.raw = this.regex = '';
            return;
        }
        this.result = (categoryBits & AllowAction) === 0 ? 1 : 2;
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
        filterLogData(iunit, logData);
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
        this.raw = raw;
        this.regex = logData.regex.join('');
    }
    isUntokenized() {
        return this.tokenHash === NO_TOKEN_HASH;
    }
    isPureHostname() {
        return this.tokenHash === DOT_TOKEN_HASH;
    }
}

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

const FILTER_DATA_PAGE_SIZE = 65536;

const roundToFilterDataPageSize =
    len => (len + FILTER_DATA_PAGE_SIZE-1) & ~(FILTER_DATA_PAGE_SIZE-1);

let filterData = new Int32Array(FILTER_DATA_PAGE_SIZE * 5);
let filterDataWritePtr = 2;
function filterDataGrow(len) {
    if ( len <= filterData.length ) { return; }
    const newLen = roundToFilterDataPageSize(len);
    const newBuf = new Int32Array(newLen);
    newBuf.set(filterData);
    filterData = newBuf;
}
function filterDataShrink() {
    const newLen = Math.max(
        roundToFilterDataPageSize(filterDataWritePtr),
        FILTER_DATA_PAGE_SIZE
    );
    if ( newLen >= filterData.length ) { return; }
    const newBuf = new Int32Array(newLen);
    newBuf.set(filterData.subarray(0, filterDataWritePtr));
    filterData = newBuf;
}
function filterDataAlloc(...args) {
    const len = args.length;
    const idata = filterDataAllocLen(len);
    for ( let i = 0; i < len; i++ ) {
        filterData[idata+i] = args[i];
    }
    return idata;
}
function filterDataAllocLen(len) {
    const idata = filterDataWritePtr;
    filterDataWritePtr += len;
    if ( filterDataWritePtr > filterData.length ) {
        filterDataGrow(filterDataWritePtr);
    }
    return idata;
}
const filterSequenceAdd = (a, b) => {
    const iseq = filterDataAllocLen(2);
    filterData[iseq+0] = a;
    filterData[iseq+1] = b;
    return iseq;
};
function filterDataReset() {
    filterData.fill(0);
    filterDataWritePtr = 2;
}
function filterDataToSelfie() {
    return JSON.stringify(Array.from(filterData.subarray(0, filterDataWritePtr)));
}
function filterDataFromSelfie(selfie) {
    if ( typeof selfie !== 'string' || selfie === '' ) { return false; }
    const data = JSON.parse(selfie);
    if ( Array.isArray(data) === false ) { return false; }
    filterDataGrow(data.length);
    filterDataWritePtr = data.length;
    filterData.set(data);
    filterDataShrink();
    return true;
}

const filterRefs = [ null ];
let filterRefsWritePtr = 1;
const filterRefAdd = function(ref) {
    const i = filterRefsWritePtr;
    filterRefs[i] = ref;
    filterRefsWritePtr += 1;
    return i;
};
function filterRefsReset() {
    filterRefs.fill(null);
    filterRefsWritePtr = 1;
}
function filterRefsToSelfie() {
    const refs = [];
    for ( let i = 0; i < filterRefsWritePtr; i++ ) {
        const v = filterRefs[i];
        if ( v instanceof RegExp ) {
            refs.push({ t: 1, s: v.source, f: v.flags });
            continue;
        }
        if ( Array.isArray(v) ) {
            refs.push({ t: 2, v });
            continue;
        }
        if ( typeof v !== 'object' || v === null ) {
            refs.push({ t: 0, v });
            continue;
        }
        const out = Object.create(null);
        for ( const prop of Object.keys(v) ) {
            const value = v[prop];
            out[prop] = prop.startsWith('$')
                ? (typeof value === 'string' ? '' : null)
                : value;
        }
        refs.push({ t: 3, v: out });
    }
    return JSON.stringify(refs);
}
function filterRefsFromSelfie(selfie) {
    if ( typeof selfie !== 'string' || selfie === '' ) { return false; }
    const refs = JSON.parse(selfie);
    if ( Array.isArray(refs) === false ) { return false; }
    for ( let i = 0; i < refs.length; i++ ) {
        const v = refs[i];
        switch ( v.t ) {
        case 0:
        case 2:
        case 3:
            filterRefs[i] = v.v;
            break;
        case 1:
            filterRefs[i] = new RegExp(v.s, v.f);
            break;
        default:
            throw new Error('Unknown filter reference!');
        }
    }
    filterRefsWritePtr = refs.length;
    return true;
}

/******************************************************************************/

const origHNTrieContainer = new HNTrieContainer();
const destHNTrieContainer = new HNTrieContainer();

/******************************************************************************/

const bidiTrieMatchExtra = function(l, r, ix) {
    for (;;) {
        $patternMatchLeft = l;
        $patternMatchRight = r;
        const iu = filterData[ix+0];
        if ( filterMatch(iu) ) { return iu; }
        ix = filterData[ix+1];
        if ( ix === 0 ) { break; }
    }
    return 0;
};

const bidiTrie = new BidiTrieContainer(bidiTrieMatchExtra);

const bidiTriePrime = function() {
    bidiTrie.reset(keyvalStore.getItem('SNFE.bidiTrie'));
};

const bidiTrieOptimize = function(shrink = false) {
    keyvalStore.setItem('SNFE.bidiTrie', bidiTrie.optimize(shrink));
};

/*******************************************************************************

    Each filter class will register itself in the map.

    IMPORTANT: any change which modifies the mapping will have to be
    reflected with µBlock.systemSettings.compiledMagic.

*/

const filterClasses = [];
const filterArgsToUnit = new Map();
let   filterClassIdGenerator = 0;

const registerFilterClass = function(fc) {
    const fid = filterClassIdGenerator++;
    fc.fid = fid;
    fc.fidstr = `${fid}`;
    filterClasses[fid] = fc;
};

const filterFromCompiled = args => {
    const fc = filterClasses[args[0]];
    const keygen = fc.keyFromArgs;
    if ( keygen === undefined ) {
        return fc.fromCompiled(args);
    }
    const key = `${fc.fidstr} ${(keygen(args) || '')}`;
    let idata = filterArgsToUnit.get(key);
    if ( idata !== undefined ) { return idata; }
    idata = fc.fromCompiled(args);
    filterArgsToUnit.set(key, idata);
    return idata;
};

const filterGetClass = idata => {
    return filterClasses[filterData[idata+0]];
};

const filterMatch = idata => filterClasses[filterData[idata+0]].match(idata);

const filterHasOriginHit = idata => {
    const fc = filterClasses[filterData[idata+0]];
    return fc.hasOriginHit !== undefined && fc.hasOriginHit(idata);
};

const filterGetDomainOpt = (idata, out) => {
    const fc = filterClasses[filterData[idata+0]];
    if ( fc.getDomainOpt === undefined ) { return; }
    const domainOpt = fc.getDomainOpt(idata);
    if ( out === undefined ) { return domainOpt; }
    out.push(domainOpt);
};

const filterGetRegexPattern = (idata, out) => {
    const fc = filterClasses[filterData[idata+0]];
    if ( fc.hasRegexPattern === undefined ) { return; }
    const reStr = fc.getRegexPattern(idata);
    if ( out === undefined ) { return reStr; }
    out.push(reStr);
};

const filterIsBidiTrieable = idata => {
    const fc = filterClasses[filterData[idata+0]];
    if ( fc.isBidiTrieable === undefined ) { return false; }
    return fc.isBidiTrieable(idata) === true;
};

const filterToBidiTrie = idata => {
    const fc = filterClasses[filterData[idata+0]];
    if ( fc.toBidiTrie === undefined ) { return; }
    return fc.toBidiTrie(idata);
};

const filterMatchAndFetchModifiers = (idata, env) => {
    const fc = filterClasses[filterData[idata+0]];
    if ( fc.matchAndFetchModifiers === undefined ) { return; }
    return fc.matchAndFetchModifiers(idata, env);
};

const filterGetModifierType = idata => {
    const fc = filterClasses[filterData[idata+0]];
    if ( fc.getModifierType === undefined ) { return; }
    return fc.getModifierType(idata);
};

const filterLogData = (idata, details) => {
    const fc = filterClasses[filterData[idata+0]];
    if ( fc.logData === undefined ) { return; }
    fc.logData(idata, details);
};

const filterDumpInfo = (idata) => {
    const fc = filterGetClass(idata);
    if ( fc.dumpInfo === undefined ) { return; }
    return fc.dumpInfo(idata);
};


/*******************************************************************************

    Filter classes

    Pattern:
        FilterPatternAny
        FilterPatternPlain
            FilterPatternPlain1
            FilterPatternPlainX
        FilterPatternGeneric
        FilterRegex
        FilterPlainTrie
        FilterHostnameDict

    Pattern modifiers:
        FilterAnchorHnLeft
            FilterAnchorHn
        FilterAnchorRight
        FilterAnchorLeft
        FilterTrailingSeparator

    Context, immediate:
        FilterOriginHit
            FilterOriginMiss
                FilterOriginEntityMiss
            FilterOriginEntityHit
        FilterOriginHitSet
            FilterOriginMissSet
            FilterJustOrigin
                FilterHTTPJustOrigin
                FilterHTTPSJustOrigin

    Other options:
        FilterDenyAllow
        FilterImportant
        FilterNotType
        FilterStrictParty
        FilterModifier

    Collection:
        FilterCollection
            FilterCompositeAll
            FilterBucket
                FilterBucketIf
                    FilterBucketIfOriginHits
                    FilterBucketIfRegexHits
            FilterOriginHitAny

    A single filter can be made of many parts, in which case FilterCompositeAll
    is used to hold all the parts, and where all the parts must be a match in
    order for the filter to be a match.

**/

/******************************************************************************/

const FilterPatternAny = class {
    static match() {
        return true;
    }

    static compile() {
        return [ FilterPatternAny.fid ];
    }

    static fromCompiled(args) {
        return filterDataAlloc(args[0]);
    }

    static keyFromArgs() {
    }

    static logData(idata, details) {
        details.pattern.push('*');
        details.regex.push('^');
    }
};

registerFilterClass(FilterPatternAny);

/******************************************************************************/

const FilterImportant = class {
    static match() {
        return ($isBlockImportant = true);
    }

    static compile() {
        return [ FilterImportant.fid ];
    }

    static fromCompiled(args) {
        return filterDataAlloc(args[0]);
    }

    static keyFromArgs() {
    }

    static logData(idata, details) {
        details.options.unshift('important');
    }
};

registerFilterClass(FilterImportant);

/******************************************************************************/

const FilterPatternPlain = class {
    static isBidiTrieable(idata) {
        return filterData[idata+2] <= 255;
    }

    static toBidiTrie(idata) {
        return {
            i: filterData[idata+1],
            n: filterData[idata+2],
            itok: filterData[idata+3],
        };
    }

    static match(idata) {
        const left = $tokenBeg;
        const n = filterData[idata+2];
        if (
            bidiTrie.startsWith(
                left,
                bidiTrie.haystackLen,
                filterData[idata+1],
                n
            ) === 0
        ) {
            return false;
        }
        $patternMatchLeft = left;
        $patternMatchRight = left + n;
        return true;
    }

    static compile(details) {
        const { tokenBeg } = details;
        if ( tokenBeg === 0 ) {
            return [ FilterPatternPlain.fid, details.pattern, 0 ];
        }
        if ( tokenBeg === 1 ) {
            return [ FilterPatternPlain1.fid, details.pattern, 1 ];
        }
        return [ FilterPatternPlainX.fid, details.pattern, tokenBeg ];
    }

    static fromCompiled(args) {
        const idata = filterDataAllocLen(4);
        filterData[idata+0] = args[0];                          // fid
        filterData[idata+1] = bidiTrie.storeString(args[1]);    // i
        filterData[idata+2] = args[1].length;                   // n   
        filterData[idata+3] = args[2];                          // tokenBeg
        return idata;
    }

    static logData(idata, details) {
        const s = bidiTrie.extractString(
            filterData[idata+1],
            filterData[idata+2]
        );
        details.pattern.push(s);
        details.regex.push(restrFromPlainPattern(s));
        // https://github.com/gorhill/uBlock/issues/3037
        //   Make sure the logger reflects accurately internal match, taking
        //   into account MAX_TOKEN_LENGTH.
        if ( /^[0-9a-z%]{1,6}$/i.exec(s.slice(filterData[idata+3])) !== null ) {
            details.regex.push('(?![0-9A-Za-z%])');
        }
    }

    static dumpInfo(idata) {
        const pattern = bidiTrie.extractString(
            filterData[idata+1],
            filterData[idata+2]
        );
        return `${pattern} ${filterData[idata+3]}`;
    }
};

FilterPatternPlain.isPatternPlain = true;

registerFilterClass(FilterPatternPlain);


const FilterPatternPlain1 = class extends FilterPatternPlain {
    static match(idata) {
        const left = $tokenBeg - 1;
        const n = filterData[idata+2];
        if (
            bidiTrie.startsWith(
                left,
                bidiTrie.haystackLen,
                filterData[idata+1],
                n
            ) === 0
        ) {
            return false;
        }
        $patternMatchLeft = left;
        $patternMatchRight = left + n;
        return true;
    }
};

registerFilterClass(FilterPatternPlain1);


const FilterPatternPlainX = class extends FilterPatternPlain {
    static match(idata) {
        const left = $tokenBeg - filterData[idata+3];
        const n = filterData[idata+2];
        if (
            bidiTrie.startsWith(
                left,
                bidiTrie.haystackLen,
                filterData[idata+1],
                n
            ) === 0
        ) {
            return false;
        }
        $patternMatchLeft = left;
        $patternMatchRight = left + n;
        return true;
    }
};

registerFilterClass(FilterPatternPlainX);

/******************************************************************************/

const FilterPatternGeneric = class {
    static hasRegexPattern() {
        return true;
    }

    static getRegexPattern(idata) {
        return restrFromGenericPattern(
            bidiTrie.extractString(
                filterData[idata+1],
                filterData[idata+2]
            ),
            filterData[idata+3]
        );
    }

    static match(idata) {
        const refs = filterRefs[filterData[idata+4]];
        if ( refs.$re === null ) {
            refs.$re = new RegExp(this.getRegexPattern(idata));
        }
        return refs.$re.test($requestURL);
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
        const idata = filterDataAllocLen(5);
        filterData[idata+0] = args[0];                          // fid
        filterData[idata+1] = bidiTrie.storeString(args[1]);    // i
        filterData[idata+2] = args[1].length;                   // n
        filterData[idata+3] = args[2];                          // anchor
        filterData[idata+4] = filterRefAdd({ $re: null });
        return idata;
    }

    static keyFromArgs(args) {
        return `${args[1]}\t${args[2]}`;
    }

    static logData(idata, details) {
        details.pattern.length = 0;
        const anchor = filterData[idata+3];
        if ( (anchor & 0b100) !== 0 ) {
            details.pattern.push('||');
        } else if ( (anchor & 0b010) !== 0 ) {
            details.pattern.push('|');
        }
        const s = bidiTrie.extractString(
            filterData[idata+1],
            filterData[idata+2]
        );
        details.pattern.push(s);
        if ( (anchor & 0b001) !== 0 ) {
            details.pattern.push('|');
        }
        details.regex.length = 0;
        details.regex.push(restrFromGenericPattern(s, anchor & ~0b100));
    }

    static dumpInfo(idata) {
        return bidiTrie.extractString(
            filterData[idata+1],
            filterData[idata+2]
        );
    }
};

FilterPatternGeneric.isSlow = true;

registerFilterClass(FilterPatternGeneric);

/******************************************************************************/

const FilterAnchorHnLeft = class {
    static match(idata) {
        const len = $requestHostname.length;
        const haystackCodes = bidiTrie.haystack;
        let lastBeg = filterData[idata+2];
        let lastEnd = filterData[idata+3];
        if (
            len !== filterData[idata+1] ||
            lastBeg === -1 ||
            haystackCodes[lastBeg-3] !== 0x3A /* ':' */ ||
            haystackCodes[lastBeg-2] !== 0x2F /* '/' */ ||
            haystackCodes[lastBeg-1] !== 0x2F /* '/' */
        ) {
            lastBeg = len !== 0 ? haystackCodes.indexOf(0x3A) : -1;
            if ( lastBeg !== -1 ) {
                if (
                    lastBeg >= bidiTrie.haystackLen ||
                    haystackCodes[lastBeg+1] !== 0x2F ||
                    haystackCodes[lastBeg+2] !== 0x2F
                ) {
                    lastBeg = -1;
                }
            }
            if ( lastBeg !== -1 ) {
                lastBeg += 3;
                lastEnd = lastBeg + len;
            } else {
                lastEnd = -1;
            }
            filterData[idata+1] = len;
            filterData[idata+2] = lastBeg;
            filterData[idata+3] = lastEnd;
        }
        const left = $patternMatchLeft;
        return left < lastEnd && (
            left === lastBeg ||
            left > lastBeg && haystackCodes[left-1] === 0x2E /* '.' */
        );
    }

    static compile() {
        return [ FilterAnchorHnLeft.fid ];
    }

    static fromCompiled(args) {
        const idata = filterDataAllocLen(4);
        filterData[idata+0] = args[0];  // fid
        filterData[idata+1] = 0;        // lastLen
        filterData[idata+2] = -1;       // lastBeg
        filterData[idata+3] = -1;       // lastEnd
        return idata;
    }

    static keyFromArgs() {
    }

    static logData(idata, details) {
        details.pattern.unshift('||');
    }
};

registerFilterClass(FilterAnchorHnLeft);

/******************************************************************************/

const FilterAnchorHn = class extends FilterAnchorHnLeft {
    static match(idata) {
        return super.match(idata) && filterData[idata+3] === $patternMatchRight;
    }

    static compile() {
        return [ FilterAnchorHn.fid ];
    }

    static keyFromArgs() {
    }

    static logData(idata, details) {
        super.logData(idata, details);
        details.pattern.push('^');
        details.regex.push('\\.?', restrSeparator);
    }
};

registerFilterClass(FilterAnchorHn);

/******************************************************************************/

const FilterAnchorLeft = class {
    static match() {
        return $patternMatchLeft === 0;
    }

    static compile() {
        return [ FilterAnchorLeft.fid ];
    }

    static fromCompiled(args) {
        return filterDataAlloc(args[0]);
    }

    static keyFromArgs() {
    }

    static logData(idata, details) {
        details.pattern.unshift('|');
        details.regex.unshift('^');
    }
};

registerFilterClass(FilterAnchorLeft);

/******************************************************************************/

const FilterAnchorRight = class {
    static match() {
        return $patternMatchRight === $requestURL.length;
    }

    static compile() {
        return [ FilterAnchorRight.fid ];
    }

    static fromCompiled(args) {
        return filterDataAlloc(args[0]);
    }

    static keyFromArgs() {
    }

    static logData(idata, details) {
        details.pattern.push('|');
        details.regex.push('$');
    }
};

registerFilterClass(FilterAnchorRight);

/******************************************************************************/

const FilterTrailingSeparator = class {
    static match() {
        if ( $patternMatchRight === $requestURL.length ) { return true; }
        if ( isSeparatorChar(bidiTrie.haystack[$patternMatchRight]) ) {
            $patternMatchRight += 1;
            return true;
        }
        return false;
    }

    static compile() {
        return [ FilterTrailingSeparator.fid ];
    }

    static fromCompiled(args) {
        return filterDataAlloc(args[0]);
    }

    static keyFromArgs() {
    }

    static logData(idata, details) {
        details.pattern.push('^');
        details.regex.push(restrSeparator);
    }
};

registerFilterClass(FilterTrailingSeparator);

/******************************************************************************/

const FilterRegex = class {
    static hasRegexPattern() {
        return true;
    }

    static getRegexPattern(idata) {
        return bidiTrie.extractString(
            filterData[idata+1],
            filterData[idata+2]
        );
    }

    static match(idata) {
        const refs = filterRefs[filterData[idata+4]];
        if ( refs.$re === null ) {
            refs.$re = new RegExp(
                this.getRegexPattern(idata),
                filterData[idata+3] === 0 ? 'i' : ''
            );
        }
        if ( refs.$re.test($requestURLRaw) === false ) { return false; }
        $patternMatchLeft = $requestURLRaw.search(refs.$re);
        return true;
    }

    static compile(details) {
        return [
            FilterRegex.fid,
            details.pattern,
            details.patternMatchCase ? 1 : 0
        ];
    }

    static fromCompiled(args) {
        const idata = filterDataAllocLen(5);
        filterData[idata+0] = args[0];                          // fid
        filterData[idata+1] = bidiTrie.storeString(args[1]);    // i
        filterData[idata+2] = args[1].length;                   // n
        filterData[idata+3] = args[2];                          // match-case
        filterData[idata+4] = filterRefAdd({ $re: null });
        return idata;
    }

    static keyFromArgs(args) {
        return `${args[1]}\t${args[2]}`;
    }

    static logData(idata, details) {
        const s = bidiTrie.extractString(
            filterData[idata+1],
            filterData[idata+2]
        );
        details.pattern.push('/', s, '/');
        details.regex.push(s);
        details.isRegex = true;
        if ( filterData[idata+3] !== 0 ) {
            details.options.push('match-case');
        }
    }

    static dumpInfo(idata) {
        return [
            '/',
            bidiTrie.extractString(
                filterData[idata+1],
                filterData[idata+2]
            ),
            '/',
            filterData[idata+3] !== 0 ? ' (match-case)' : '',
        ].join('');
    }
};

FilterRegex.isSlow = true;

registerFilterClass(FilterRegex);

/******************************************************************************/

// stylesheet: 1 => bit 0
// image: 2 => bit 1
// object: 3 => bit 2
// script: 4 => bit 3
// ...

const FilterNotType = class {
    static match(idata) {
        return $requestTypeValue !== 0 &&
            (filterData[idata+1] & (1 << ($requestTypeValue - 1))) === 0;
    }

    static compile(details) {
        return [ FilterNotType.fid, details.notTypeBits ];
    }

    static fromCompiled(args) {
        const idata = filterDataAllocLen(2);
        filterData[idata+0] = args[0];  // fid
        filterData[idata+1] = args[1];  // notTypeBits
        return idata;
    }

    static keyFromArgs(args) {
        return `${args[1]}`;
    }

    static logData(idata, details) {
        let bits = filterData[idata+1];
        for ( let i = 1; bits !== 0 && i < typeValueToTypeName.length; i++ ) {
            const bit = 1 << (i - 1);
            if ( (bits & bit) === 0 ) { continue; }
            bits &= ~bit;
            details.options.push(`~${typeValueToTypeName[i]}`);
        }
    }

    static dumpInfo(idata) {
        return `0b${filterData[idata+1].toString(2)}`;
    }
};

registerFilterClass(FilterNotType);

/******************************************************************************/

// A helper class to parse `domain=` option.

class DomainOptIterator {
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
}

// A helper instance to reuse throughout
const domainOptIterator = new DomainOptIterator('');

/******************************************************************************/

// The optimal class is picked according to the content of the `domain=`
// filter option.
function compileDomainOpt(iterable, prepend, units) {
    const hostnameHits = [];
    const hostnameMisses = [];
    const entityHits = [];
    const entityMisses = [];
    for ( const s of iterable ) {
        const len = s.length;
        const beg = len > 1 && s.charCodeAt(0) === 0x7E ? 1 : 0;
        if ( len <= beg ) {  continue; }
        if ( s.endsWith('.*') === false ) {
            if ( beg === 0 ) {
                hostnameHits.push(s);
            } else {
                hostnameMisses.push(s.slice(1));
            }
        } else if ( beg === 0 ) {
            entityHits.push(s);
        } else {
            entityMisses.push(s.slice(1));
        }
    }
    const toTrie = [];
    let trieWhich = 0b00;
    if ( hostnameHits.length > 1 ) {
        toTrie.push(...hostnameHits);
        hostnameHits.length = 0;
        trieWhich |= 0b01;
    }
    if ( entityHits.length > 1 ) {
        toTrie.push(...entityHits);
        entityHits.length = 0;
        trieWhich |= 0b10;
    }
    const compiledHit = [];
    if ( toTrie.length !== 0 ) {
        compiledHit.push(
            FilterOriginHitSet.compile(toTrie.sort(), trieWhich)
        );
    }
    for ( const hn of hostnameHits ) {
        compiledHit.push(FilterOriginHit.compile(hn));
    }
    for ( const hn of entityHits ) {
        compiledHit.push(FilterOriginEntityHit.compile(hn));
    }
    if ( compiledHit.length > 1 ) {
        compiledHit[0] = FilterOriginHitAny.compile(compiledHit.slice());
        compiledHit.length = 1;
    }
    toTrie.length = trieWhich = 0;
    if ( hostnameMisses.length > 1 ) {
        toTrie.push(...hostnameMisses);
        hostnameMisses.length = 0;
        trieWhich |= 0b01;
    }
    if ( entityMisses.length > 1 ) {
        toTrie.push(...entityMisses);
        entityMisses.length = 0;
        trieWhich |= 0b10;
    }
    const compiledMiss = [];
    if ( toTrie.length !== 0 ) {
        compiledMiss.push(
            FilterOriginMissSet.compile(toTrie.sort(), trieWhich)
        );
    }
    for ( const hn of hostnameMisses ) {
        compiledMiss.push(FilterOriginMiss.compile(hn));
    }
    for ( const hn of entityMisses ) {
        compiledMiss.push(FilterOriginEntityMiss.compile(hn));
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

/******************************************************************************/

const FilterOriginHit = class {
    static getDomainOpt(idata) {
        return origHNTrieContainer.extractHostname(
            filterData[idata+1],
            filterData[idata+2]
        );
    }

    static hasOriginHit() {
        return true;
    }

    static getMatchTarget() {
        return $docHostname;
    }

    static match(idata) {
        return origHNTrieContainer.matchesHostname(
            this.getMatchTarget(),
            filterData[idata+1],
            filterData[idata+2]
        );
    }

    static compile(hostname) {
        return [ FilterOriginHit.fid, hostname ];
    }

    static fromCompiled(args) {
        const idata = filterDataAllocLen(3);
        filterData[idata+0] = args[0];                                      // fid
        filterData[idata+1] = origHNTrieContainer.storeHostname(args[1]);   // i
        filterData[idata+2] = args[1].length;                               // n
        return idata;
    }

    static logData(idata, details) {
        details.domains.push(this.getDomainOpt(idata));
    }

    static dumpInfo(idata) {
        return this.getDomainOpt(idata);
    }
};

registerFilterClass(FilterOriginHit);

/******************************************************************************/

const FilterOriginMiss = class extends FilterOriginHit {
    static hasOriginHit() {
        return false;
    }

    static match(idata) {
        return super.match(idata) === false;
    }

    static compile(hostname) {
        return [ FilterOriginMiss.fid, hostname ];
    }

    static logData(idata, details) {
        details.domains.push(`~${this.getDomainOpt(idata)}`);
    }
};

registerFilterClass(FilterOriginMiss);

/******************************************************************************/

const FilterOriginHitSet = class {
    static getDomainOpt(idata) {
        return origHNTrieContainer.extractDomainOpt(
            filterData[idata+1],
            filterData[idata+2]
        );
    }

    static hasOriginHit() {
        return true;
    }

    static getTrieCount(idata) {
        const itrie = filterData[idata+4];
        if ( itrie === 0 ) { return 0; }
        return Array.from(
            origHNTrieContainer.trieIterator(filterData[idata+4])
        ).length;
    }

    static getLastResult(idata) {
        return filterData[idata+5];
    }

    static getMatchTarget(which) {
        return (which & 0b01) !== 0
            ? $docHostname
            : $docEntity.compute();
    }

    static getMatchedHostname(idata) {
        const lastResult = filterData[idata+5];
        if ( lastResult === -1 ) { return ''; }
        return this.getMatchTarget(lastResult >>> 8).slice(lastResult & 0xFF);
    }

    static match(idata) {
        const refs = filterRefs[filterData[idata+6]];
        const docHostname = this.getMatchTarget(0b01);
        if ( docHostname === refs.$last ) {
            return filterData[idata+5] !== -1;
        }
        refs.$last = docHostname;
        const which = filterData[idata+3];
        const itrie = filterData[idata+4] || this.toTrie(idata);
        if ( itrie === 0 ) { return false; }
        if ( (which & 0b01) !== 0 ) {
            const pos = origHNTrieContainer
                .setNeedle(docHostname)
                .matches(itrie);
            if ( pos !== -1 ) {
                filterData[idata+5] = 0b01 << 8 | pos;
                return true;
            }
        }
        if ( (which & 0b10) !== 0 ) {
            const pos = origHNTrieContainer
                .setNeedle(this.getMatchTarget(0b10))
                .matches(itrie);
            if ( pos !== -1 ) {
                filterData[idata+5] = 0b10 << 8 | pos;
                return true;
            }
        }
        filterData[idata+5] = -1;
        return false;
    }

    static add(idata, hn) {
        origHNTrieContainer.setNeedle(hn).add(filterData[idata+4]);
        filterData[idata+3] |= hn.charCodeAt(hn.length - 1) !== 0x2A /* '*' */
            ? 0b01
            : 0b10;
        filterData[idata+5] = -1;
    }

    static create(fid = -1) {
        const idata = filterDataAllocLen(7);
        filterData[idata+0] = fid !== -1 ? fid : FilterOriginHitSet.fid;
        filterData[idata+1] = 0;
        filterData[idata+2] = 0;
        filterData[idata+3] = 0;
        filterData[idata+4] = origHNTrieContainer.createTrie();
        filterData[idata+5] = -1;           // $lastResult
        filterData[idata+6] = filterRefAdd({ $last: '' });
        return idata;
    }

    static compile(hostnames, which) {
        return [
            FilterOriginHitSet.fid,
            hostnames.join('|'),
            which
        ];
    }

    static fromCompiled(args) {
        const idata = filterDataAllocLen(7);
        filterData[idata+0] = args[0];      // fid
        filterData[idata+1] = origHNTrieContainer.storeDomainOpt(args[1]);
        filterData[idata+2] = args[1].length;
        filterData[idata+3] = args[2];      // which
        filterData[idata+4] = 0;            // itrie
        filterData[idata+5] = -1;           // $lastResult
        filterData[idata+6] = filterRefAdd({ $last: '' });
        return idata;
    }

    static toTrie(idata) {
        if ( filterData[idata+2] === 0 ) { return 0; }
        const itrie = filterData[idata+4] =
            origHNTrieContainer.createTrieFromStoredDomainOpt(
                filterData[idata+1],
                filterData[idata+2]
            );
        return itrie;
    }

    static keyFromArgs(args) {
        return args[1];
    }

    static logData(idata, details) {
        details.domains.push(this.getDomainOpt(idata));
    }

    static dumpInfo(idata) {
        return `0b${filterData[idata+3].toString(2)} ${this.getDomainOpt(idata)}`;
    }
};

registerFilterClass(FilterOriginHitSet);

/******************************************************************************/

const FilterOriginMissSet = class extends FilterOriginHitSet {
    static hasOriginHit() {
        return false;
    }

    static match(idata) {
        return super.match(idata) === false;
    }

    static compile(hostnames, which) {
        return [
            FilterOriginMissSet.fid,
            hostnames.join('|'),
            which
        ];
    }

    static keyFromArgs(args) {
        return args[1];
    }

    static logData(idata, details) {
        details.domains.push(
            '~' + this.getDomainOpt(idata).replace(/\|/g, '|~')
        );
    }
};

registerFilterClass(FilterOriginMissSet);

/******************************************************************************/

const FilterOriginEntityHit = class extends FilterOriginHit {
    static getMatchTarget() {
        return $docEntity.compute();
    }

    static compile(entity) {
        return [ FilterOriginEntityHit.fid, entity ];
    }
};

registerFilterClass(FilterOriginEntityHit);

/******************************************************************************/

const FilterOriginEntityMiss = class extends FilterOriginMiss {
    static getMatchTarget() {
        return $docEntity.compute();
    }

    static compile(entity) {
        return [ FilterOriginEntityMiss.fid, entity ];
    }
};

registerFilterClass(FilterOriginEntityMiss);

/******************************************************************************/

const FilterModifier = class {
    static getModifierType(idata) {
        return filterData[idata+2];
    }

    static match() {
        return true;
    }

    static matchAndFetchModifiers(idata, env) {
        if ( this.getModifierType(idata) !== env.type ) { return; }
        env.results.push(new FilterModifierResult(idata, env));
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
        const idata = filterDataAllocLen(4);
        filterData[idata+0] = args[0];          // fid
        filterData[idata+1] = args[1];          // actionBits
        filterData[idata+2] = args[2];          // type
        filterData[idata+3] = filterRefAdd({
            value: args[3],
            $cache: null,
        });
        return idata;
    }

    static keyFromArgs(args) {
        return `${args[1]}\t${args[2]}\t${args[3]}`;
    }

    static logData(idata, details) {
        let opt = StaticFilteringParser.netOptionTokenNames.get(filterData[idata+2]);
        const refs = filterRefs[filterData[idata+3]];
        if ( refs.value !== '' ) {
            opt += `=${refs.value}`;
        }
        details.options.push(opt);
    }

    static dumpInfo(idata) {
        const s = StaticFilteringParser.netOptionTokenNames.get(filterData[idata+2]);
        const refs = filterRefs[filterData[idata+3]];
        if ( refs.value === '' ) { return s; }
        return `${s}=${refs.value}`;
    }
};

registerFilterClass(FilterModifier);

// Helper class for storing instances of FilterModifier which were found to
// be a match.

const FilterModifierResult = class {
    constructor(imodifierunit, env) {
        this.imodifierunit = imodifierunit;
        this.refs = filterRefs[filterData[imodifierunit+3]];
        this.ireportedunit = env.iunit;
        this.th = env.th;
        this.bits = (env.bits & ~RealmBitsMask) | filterData[imodifierunit+1];
    }

    get result() {
        return (this.bits & AllowAction) === 0 ? 1 : 2;
    }

    get value() {
        return this.refs.value;
    }

    get cache() {
        return this.refs.$cache;
    }

    set cache(a) {
        this.refs.$cache = a;
    }

    logData() {
        const r = new LogData(this.bits, this.th, this.ireportedunit);
        r.result = this.result;
        r.modifier = true;
        return r;
    }
};

/******************************************************************************/

const FilterCollection = class {
    static getCount(idata) {
        let n = 0;
        this.forEach(idata, ( ) => { n += 1; });
        return n;
    }

    static forEach(idata, fn) {
        let i = filterData[idata+1];
        if ( i === 0 ) { return; }
        do {
            const iunit = filterData[i+0];
            const r = fn(iunit);
            if ( r !== undefined ) { return r; }
            i = filterData[i+1];
        } while ( i !== 0 );
    }

    static unshift(idata, iunit) {
        filterData[idata+1] = filterSequenceAdd(iunit, filterData[idata+1]);
    }

    static shift(idata) {
        filterData[idata+1] = filterData[filterData[idata+1]+1];
    }

    static create(fid = -1) {
        return filterDataAlloc(
            fid !== -1 ? fid : FilterCollection.fid,
            0
        );
    }

    static compile(fc, fdata) {
        return [ fc.fid, fdata ];
    }

    static fromCompiled(args) {
        const units = args[1];
        const n = units.length;
        let iunit, inext = 0;
        let i = n;
        while ( i-- ) {
            iunit = filterFromCompiled(units[i]);
            inext = filterSequenceAdd(iunit, inext);
        }
        const idata = filterDataAllocLen(2);
        filterData[idata+0] = args[0];  // fid
        filterData[idata+1] = inext;    // i
        return idata;
    }

    static logData(idata, details) {
        this.forEach(idata, iunit => {
            filterLogData(iunit, details);
        });
    }

    static dumpInfo(idata) {
        return this.getCount(idata);
    }
};

registerFilterClass(FilterCollection);

/******************************************************************************/

const FilterOriginHitAny = class extends FilterCollection {
    static getDomainOpt(idata) {
        const domainOpts = [];
        this.forEach(idata, iunit => {
            if ( filterHasOriginHit(iunit) !== true ) { return; }
            filterGetDomainOpt(iunit, domainOpts);
        });
        return domainOpts.join('|');
    }

    static hasOriginHit() {
        return true;
    }

    static match(idata) {
        let i = filterData[idata+1];
        while ( i !== 0 ) {
            if ( filterMatch(filterData[i+0]) ) { return true; }
            i = filterData[i+1];
        }
        return false;
    }

    static compile(fdata) {
        return super.compile(FilterOriginHitAny, fdata);
    }

    static fromCompiled(args) {
        return super.fromCompiled(args);
    }
};

registerFilterClass(FilterOriginHitAny);

/******************************************************************************/

const FilterCompositeAll = class extends FilterCollection {
    // FilterPatternPlain is assumed to be first filter in sequence. This can
    // be revisited if needed.
    static isBidiTrieable(idata) {
        return filterIsBidiTrieable(filterData[filterData[idata+1]+0]);
    }

    static toBidiTrie(idata) {
        const iseq = filterData[idata+1];
        const details = filterToBidiTrie(filterData[iseq+0]);
        this.shift(idata);
        return details;
    }

    static getDomainOpt(idata) {
        return this.forEach(idata, iunit => {
            if ( filterHasOriginHit(iunit) !== true ) { return; }
            return filterGetDomainOpt(iunit);
        });
    }

    static hasOriginHit(idata) {
        return this.forEach(idata, iunit => {
            if ( filterHasOriginHit(iunit) === true ) { return true; }
        }) || false;
    }

    static hasRegexPattern(idata) {
        return this.forEach(idata, iunit => {
            const fc = filterGetClass(iunit);
            if ( fc.hasRegexPattern === undefined ) { return; }
            if ( fc.hasRegexPattern(iunit) === true ) { return true; }
        }) || false;
    }

    static getRegexPattern(idata) {
        return this.forEach(idata, iunit => {
            const fc = filterGetClass(iunit);
            if ( fc.getRegexPattern === undefined ) { return; }
            return fc.getRegexPattern(iunit);
        });
    }

    static match(idata) {
        let i = filterData[idata+1];
        while ( i !== 0 ) {
            if ( filterMatch(filterData[i+0]) !== true ) {
                return false;
            }
            i = filterData[i+1];
        }
        return true;
    }

    // IMPORTANT: the modifier filter unit is assumed to be ALWAYS the
    // first unit in the sequence. This requirement ensures that we do
    // not have to traverse the sequence to find the modifier filter
    // unit.
    static getModifierType(idata) {
        const iseq = filterData[idata+1];
        const iunit = filterData[iseq+0];
        return filterGetModifierType(iunit);
    }

    static matchAndFetchModifiers(idata, env) {
        const iseq = filterData[idata+1];
        const iunit = filterData[iseq+0];
        if (
            filterGetModifierType(iunit) === env.type &&
            this.match(idata)
        ) {
            filterMatchAndFetchModifiers(iunit, env);
        }
    }

    static compile(fdata) {
        return super.compile(FilterCompositeAll, fdata);
    }

    static fromCompiled(args) {
        return super.fromCompiled(args);
    }
};

registerFilterClass(FilterCompositeAll);

/******************************************************************************/

// Dictionary of hostnames

const FilterHostnameDict = class {
    static getCount(idata) {
        const itrie = filterData[idata+1];
        if ( itrie !== 0 ) {
            return Array.from(destHNTrieContainer.trieIterator(itrie)).length;
        }
        return filterRefs[filterData[idata+3]].length;
    }

    static match(idata) {
        const itrie = filterData[idata+1] || this.optimize(idata);
        return (
            filterData[idata+2] = destHNTrieContainer
                .setNeedle($requestHostname)
                .matches(itrie)
        ) !== -1;
    }

    static add(idata, hn) {
        const itrie = filterData[idata+1];
        if ( itrie === 0 ) {
            filterRefs[filterData[idata+3]].push(hn);
        } else {
            destHNTrieContainer.setNeedle(hn).add(itrie);
        }
    }

    static optimize(idata) {
        const itrie = filterData[idata+1];
        if ( itrie !== 0 ) { return itrie; }
        const hostnames = filterRefs[filterData[idata+3]];
        filterData[idata+1] = destHNTrieContainer.createTrieFromIterable(hostnames);
        filterRefs[filterData[idata+3]] = null;
        return filterData[idata+1];
    }

    static create() {
        const idata = filterDataAllocLen(4);
        filterData[idata+0] = FilterHostnameDict.fid;   // fid
        filterData[idata+1] = 0;                        // itrie
        filterData[idata+2] = -1;                       // lastResult
        filterData[idata+3] = filterRefAdd([]);         // []: hostnames
        return idata;
    }

    static logData(idata, details) {
        const hostname = $requestHostname.slice(filterData[idata+2]);
        details.pattern.push('||', hostname, '^');
        details.regex.push(
            restrFromPlainPattern(hostname),
            '\\.?',
            restrSeparator
        );
    }

    static dumpInfo(idata) {
        return this.getCount(idata);
    }
};

registerFilterClass(FilterHostnameDict);

/******************************************************************************/

const FilterDenyAllow = class {
    static match(idata) {
        return destHNTrieContainer
            .setNeedle($requestHostname)
            .matches(filterData[idata+1]) === -1;
    }

    static compile(details) {
        return [ FilterDenyAllow.fid, details.denyallowOpt ];
    }

    static fromCompiled(args) {
        const itrie = destHNTrieContainer.createTrieFromIterable(
            domainOptIterator.reset(args[1])
        );
        const idata = filterDataAllocLen(3);
        filterData[idata+0] = args[0];                  // fid
        filterData[idata+1] = itrie;                    // itrie
        filterData[idata+2] = filterRefAdd(args[1]);    // denyallowOpt
        return idata;
    }

    static keyFromArgs(args) {
        return args[1];
    }

    static logData(idata, details) {
        details.denyallow.push(filterRefs[filterData[idata+2]]);
    }

    static dumpInfo(idata) {
        return filterRefs[filterData[idata+2]];
    }
};

registerFilterClass(FilterDenyAllow);

/******************************************************************************/

// Dictionary of hostnames for filters which only purpose is to match
// the document origin.

const FilterJustOrigin = class extends FilterOriginHitSet {
    static create(fid = -1) {
        return super.create(fid !== -1 ? fid : FilterJustOrigin.fid);
    }

    static logPattern(idata, details) {
        details.pattern.push('*');
        details.regex.push('^');
    }

    static logData(idata, details) {
        this.logPattern(idata, details);
        details.domains.push(this.getMatchedHostname(idata));
    }

    static dumpInfo(idata) {
        return this.getTrieCount(idata);
    }
};

registerFilterClass(FilterJustOrigin);

/******************************************************************************/

const FilterHTTPSJustOrigin = class extends FilterJustOrigin {
    static match(idata) {
        return $requestURL.startsWith('https://') && super.match(idata);
    }

    static create() {
        return super.create(FilterHTTPSJustOrigin.fid);
    }

    static logPattern(idata, details) {
        details.pattern.push('|https://');
        details.regex.push('^https://');
    }
};

registerFilterClass(FilterHTTPSJustOrigin);

/******************************************************************************/

const FilterHTTPJustOrigin = class extends FilterJustOrigin {
    static match(idata) {
        return $requestURL.startsWith('http://') && super.match(idata);
    }

    static create() {
        return super.create(FilterHTTPJustOrigin.fid);
    }

    static logPattern(idata, details) {
        details.pattern.push('|http://');
        details.regex.push('^http://');
    }
};

registerFilterClass(FilterHTTPJustOrigin);

/******************************************************************************/

const FilterPlainTrie = class {
    static match(idata) {
        if ( bidiTrie.matches(filterData[idata+1], $tokenBeg) !== 0 ) {
            filterData[idata+2] = bidiTrie.$iu;
            return true;
        }
        return false;
    }

    static create() {
        const idata = filterDataAllocLen(3);
        filterData[idata+0] = FilterPlainTrie.fid;      // fid
        filterData[idata+1] = bidiTrie.createTrie();    // itrie
        filterData[idata+2] = 0;                        // matchedUnit
        return idata;
    }

    static addUnitToTrie(idata, iunit) {
        const trieDetails = filterToBidiTrie(iunit);
        const itrie = filterData[idata+1];
        const id = bidiTrie.add(
            itrie,
            trieDetails.i,
            trieDetails.n,
            trieDetails.itok
        );
        // No point storing a pattern with conditions if the bidi-trie already
        // contain a pattern with no conditions.
        const ix = bidiTrie.getExtra(id);
        if ( ix === 1 ) { return; }
        // If the newly stored pattern has no condition, short-circuit existing
        // ones since they will always be short-circuited by the condition-less
        // pattern.
        const fc = filterGetClass(iunit);
        if ( fc.isPatternPlain ) {
            bidiTrie.setExtra(id, 1);
            return;
        }
        // FilterCompositeAll is assumed here, i.e. with conditions.
        if ( fc === FilterCompositeAll && fc.getCount(iunit) === 1 ) {
            iunit = filterData[filterData[iunit+1]+0];
        }
        bidiTrie.setExtra(id, filterSequenceAdd(iunit, ix));
    }

    static logData(idata, details) {
        const s = $requestURL.slice(bidiTrie.$l, bidiTrie.$r);
        details.pattern.push(s);
        details.regex.push(restrFromPlainPattern(s));
        if ( filterData[idata+2] !== -1 ) {
            filterLogData(filterData[idata+2], details);
        }
    }

    static dumpInfo(idata) {
        return `${Array.from(bidiTrie.trieIterator(filterData[idata+1])).length}`;
    }
};

registerFilterClass(FilterPlainTrie);

/******************************************************************************/

const FilterBucket = class extends FilterCollection {
    static getCount(idata) {
        return filterData[idata+2];
    }

    static forEach(idata, fn) {
        return super.forEach(filterData[idata+1], fn);
    }

    static match(idata) {
        const icollection = filterData[idata+1];
        let iseq = filterData[icollection+1];
        while ( iseq !== 0 ) {
            const iunit = filterData[iseq+0];
            if ( filterMatch(iunit) ) {
                filterData[idata+3] = iunit;
                return true;
            }
            iseq = filterData[iseq+1];
        }
        return false;
    }

    static matchAndFetchModifiers(idata, env) {
        const icollection = filterData[idata+1];
        let iseq = filterData[icollection+1];
        while ( iseq !== 0 ) {
            const iunit = filterData[iseq+0];
            env.iunit = iunit;
            filterMatchAndFetchModifiers(iunit, env);
            iseq = filterData[iseq+1];
        }
    }

    static unshift(idata, iunit) {
        super.unshift(filterData[idata+1], iunit);
        filterData[idata+2] += 1;
    }

    static shift(idata) {
        super.shift(filterData[idata+1]);
        filterData[idata+2] -= 1;
    }

    static create() {
        const idata = filterDataAllocLen(4);
        filterData[idata+0] = FilterBucket.fid;             // fid
        filterData[idata+1] = FilterCollection.create();    // icollection
        filterData[idata+2] = 0;                            // n
        filterData[idata+3] = 0;                            // $matchedUnit
        return idata;
    }

    static logData(idata, details) {
        filterLogData(filterData[idata+3], details);
    }

    static optimize(idata, optimizeBits = 0b11) {
        if ( filterData[idata+2] >= 3 && (optimizeBits & 0b01) !== 0 ) {
            const iplaintrie = this.optimizePatternTests(idata);
            if ( iplaintrie !== 0 ) {
                const icollection = filterData[idata+1];
                const i = filterData[icollection+1];
                if ( i === 0 ) { return iplaintrie; }
                this.unshift(idata, iplaintrie);
            }
        }
        if ( filterData[idata+2] >= 5 && (optimizeBits & 0b10) !== 0 ) {
            const ioptimized = this.optimizeMatch(
                idata,
                FilterBucketIfOriginHits,
                5
            );
            if ( ioptimized !== 0 ) {
                const icollection = filterData[idata+1];
                const i = filterData[icollection+1];
                if ( i === 0 ) { return ioptimized; }
                this.unshift(idata, ioptimized);
            }
        }
        if ( filterData[idata+2] >= 5 && (optimizeBits & 0b10) !== 0 ) {
            const ioptimized = this.optimizeMatch(
                idata,
                FilterBucketIfRegexHits,
                5
            );
            if ( ioptimized !== 0 ) {
                const icollection = filterData[idata+1];
                const i = filterData[icollection+1];
                if ( i === 0 ) { return ioptimized; }
                this.unshift(idata, ioptimized);
            }
        }
        return 0;
    }

    static optimizePatternTests(idata) {
        const isrccollection = filterData[idata+1];
        let n = 0;
        let iseq = filterData[isrccollection+1];
        do {
            if ( filterIsBidiTrieable(filterData[iseq+0]) ) { n += 1; }
            iseq = filterData[iseq+1];
        } while ( iseq !== 0 && n < 3 );
        if ( n < 3 ) { return 0; }
        const iplaintrie = FilterPlainTrie.create();
        iseq = filterData[isrccollection+1];
        let iprev = 0;
        for (;;) {
            const iunit = filterData[iseq+0];
            const inext = filterData[iseq+1];
            if ( filterIsBidiTrieable(iunit) ) {
                FilterPlainTrie.addUnitToTrie(iplaintrie, iunit);
                if ( iprev !== 0 ) {
                    filterData[iprev+1] = inext;
                } else {
                    filterData[isrccollection+1] = inext;
                }
                filterData[idata+2] -= 1;
            } else {
                iprev = iseq;
            }
            if ( inext === 0 ) { break; }
            iseq = inext;
        }
        return iplaintrie;
    }

    static optimizeMatch(idata, fc, min) {
        const isrccollection = filterData[idata+1];
        const candidates = [];
        this.forEach(idata, iunit => {
            if ( fc.canCoallesce(iunit) === false ) { return; }
            candidates.push(iunit);
        });
        if ( candidates.length < min ) { return 0; }
        const idesbucket = FilterBucket.create();
        const idescollection = filterData[idesbucket+1];
        let coallesced;
        let isrcseq = filterData[isrccollection+1];
        let iprev = 0;
        for (;;) {
            const iunit = filterData[isrcseq+0];
            const inext = filterData[isrcseq+1];
            if ( candidates.includes(iunit) ) {
                coallesced = fc.coallesce(iunit, coallesced);
                // move the sequence slot to new bucket
                filterData[isrcseq+1] = filterData[idescollection+1];
                filterData[idescollection+1] = isrcseq;
                filterData[idesbucket+2] += 1;
                if ( iprev !== 0 ) {
                    filterData[iprev+1] = inext;
                } else {
                    filterData[isrccollection+1] = inext;
                }
                filterData[idata+2] -= 1;
            } else {
                iprev = isrcseq;
            }
            if ( inext === 0 ) { break; }
            isrcseq = inext;
        }
        return fc.create(coallesced, idesbucket);
    }

    static dumpInfo(idata) {
        return this.getCount(idata);
    }
};

registerFilterClass(FilterBucket);

/******************************************************************************/

// Filter bucket objects which have a pre-test method before being treated
// as a plain filter bucket -- the pre-test method should be fast as it is
// used to avoid having to iterate through the content of the filter bicket.

const FilterBucketIf = class extends FilterBucket {
    static getCount(idata) {
        return super.getCount(filterData[idata+1]);
    }

    static forEach(idata, fn) {
        return super.forEach(filterData[idata+1], fn);
    }

    static match(idata) {
        return this.preTest(idata) && super.match(filterData[idata+1]);
    }

    static matchAndFetchModifiers(idata, env) {
        if ( this.preTest(idata) ) {
            super.matchAndFetchModifiers(filterData[idata+1], env);
        }
    }

    static create(fid, ibucket, itest) {
        const idata = filterDataAllocLen(3);
        filterData[idata+0] = fid;
        filterData[idata+1] = ibucket;
        filterData[idata+2] = itest;
        return idata;
    }

    static logData(idata, details) {
        filterLogData(filterData[idata+1], details);
    }
};

registerFilterClass(FilterBucketIf);

/******************************************************************************/

const FilterBucketIfOriginHits = class extends FilterBucketIf {
    static preTest(idata) {
        return filterMatch(filterData[idata+2]);
    }

    static canCoallesce(iunit) {
        return filterHasOriginHit(iunit);
    }

    static coallesce(iunit, coallesced) {
        if ( coallesced === undefined ) {
            coallesced = new Set();
        }
        const domainOpt = filterGetDomainOpt(iunit);
        if ( domainOpt.includes('|') ) {
            for ( const hn of domainOptIterator.reset(domainOpt) ) {
                coallesced.add(hn);
            }
        } else {
            coallesced.add(domainOpt);
        }
        return coallesced;
    }

    static create(coallesced, ibucket) {
        const units = [];
        compileDomainOpt(coallesced, false, units);
        const ihittest = filterFromCompiled(units[0]);
        const ipretest = super.create(
            FilterBucketIfOriginHits.fid,
            ibucket,
            ihittest
        );
        return ipretest;
    }
};

registerFilterClass(FilterBucketIfOriginHits);

/******************************************************************************/

const FilterBucketIfRegexHits = class extends FilterBucketIf {
    static preTest(idata) {
        return filterRefs[filterData[idata+2]].test($requestURLRaw);
    }

    static canCoallesce(iunit) {
        const fc = filterGetClass(iunit);
        if ( fc.hasRegexPattern === undefined ) { return false; }
        if ( fc.hasRegexPattern(iunit) !== true ) { return false; }
        return true;
    }

    static coallesce(iunit, coallesced) {
        if ( coallesced === undefined ) {
            coallesced = new Set();
        }
        coallesced.add(filterGetRegexPattern(iunit));
        return coallesced;
    }

    static create(coallesced, ibucket) {
        const reString = Array.from(coallesced).join('|');
        return super.create(
            FilterBucketIfRegexHits.fid,
            ibucket,
            filterRefAdd(new RegExp(reString, 'i'))
        );
    }

    static dumpInfo(idata) {
        return filterRefs[filterData[idata+2]].source;
    }
};

registerFilterClass(FilterBucketIfRegexHits);

/******************************************************************************/

const FilterStrictParty = class {
    // TODO: diregard `www.`?
    static match(idata) {
        return ($requestHostname === $docHostname) === (filterData[idata+1] === 0);
    }

    static compile(details) {
        return [
            FilterStrictParty.fid,
            details.strictParty > 0 ? 0 : 1
        ];
    }

    static fromCompiled(args) {
        return filterDataAlloc(
            args[0],    // fid
            args[1]     // not
        );
    }

    static keyFromArgs(args) {
        return `${args[1]}`;
    }

    static logData(idata, details) {
        details.options.push(
            filterData[idata+1] === 0 ? 'strict1p' : 'strict3p'
        );
    }
};

registerFilterClass(FilterStrictParty);

/******************************************************************************/

const FilterOnHeaders = class {
    static match(idata) {
        const refs = filterRefs[filterData[idata+1]];
        if ( refs.$parsed === null ) {
            refs.$parsed = StaticFilteringParser.parseHeaderValue(refs.headerOpt);
        }
        const { bad, name, not, re, value } = refs.$parsed;
        if ( bad ) { return false; }
        const headerValue = $httpHeaders.lookup(name);
        if ( headerValue === undefined ) { return false; }
        if ( value === '' ) { return true; }
        return re === undefined
            ? (headerValue === value) !== not
            : re.test(headerValue) !== not;
    }

    static compile(details) {
        return [ FilterOnHeaders.fid, details.headerOpt ];
    }

    static fromCompiled(args) {
        return filterDataAlloc(
            args[0],                // fid
            filterRefAdd({
                headerOpt: args[1],
                $parsed: null,
            })
        );
    }

    static logData(idata, details) {
        const irefs = filterData[idata+1];
        const headerOpt = filterRefs[irefs].headerOpt;
        let opt = 'header';
        if ( headerOpt !== '' ) {
            opt += `=${headerOpt}`;
        }
        details.options.push(opt);
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

        this._urlIn = '';
        this._urlOut = '';
        this._tokenized = false;
        this._hasQuery = 0;
        // https://www.reddit.com/r/uBlockOrigin/comments/dzw57l/
        //   Remember: 1 token needs two slots
        this._tokens = new Uint32Array(2064);

        this.knownTokens = new Uint8Array(65536);
        this.resetKnownTokens();
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
        this.addKnownToken(DOT_TOKEN_HASH);
        this.addKnownToken(ANY_TOKEN_HASH);
        this.addKnownToken(ANY_HTTPS_TOKEN_HASH);
        this.addKnownToken(ANY_HTTP_TOKEN_HASH);
        this.addKnownToken(NO_TOKEN_HASH);
    }

    addKnownToken(th) {
        this.knownTokens[th & 0xFFFF ^ th >>> 16] = 1;
    }

    // Tokenize on demand.
    getTokens(encodeInto) {
        if ( this._tokenized ) { return this._tokens; }
        let i = this._tokenize(encodeInto);
        this._tokens[i+0] = ANY_TOKEN_HASH;
        this._tokens[i+1] = 0;
        i += 2;
        if ( this._urlOut.startsWith('https://') ) {
            this._tokens[i+0] = ANY_HTTPS_TOKEN_HASH;
            this._tokens[i+1] = 0;
            i += 2;
        } else if ( this._urlOut.startsWith('http://') ) {
            this._tokens[i+0] = ANY_HTTP_TOKEN_HASH;
            this._tokens[i+1] = 0;
            i += 2;
        }
        this._tokens[i+0] = NO_TOKEN_HASH;
        this._tokens[i+1] = 0;
        this._tokens[i+2] = INVALID_TOKEN_HASH;
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
        if ( l === 0 ) { return EMPTY_TOKEN_HASH; }
        const vtc = this._validTokenChars;
        let th = vtc[s.charCodeAt(0)];
        for ( let i = 1; i !== 7 /* MAX_TOKEN_LENGTH */ && i !== l; i++ ) {
            th = th << 4 ^ vtc[s.charCodeAt(i)];
        }
        return th;
    }

    stringFromTokenHash(th) {
        if ( th === 0 ) { return ''; }
        return th.toString(16);
    }

    toSelfie() {
        return sparseBase64.encode(
            this.knownTokens.buffer,
            this.knownTokens.byteLength
        );
    }

    fromSelfie(selfie) {
        return sparseBase64.decode(selfie, this.knownTokens.buffer);
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
                    if ( n === 7 /* MAX_TOKEN_LENGTH */ ) { continue; }
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

class FilterCompiler {
    constructor(parser, other = undefined) {
        this.parser = parser;
        if ( other !== undefined ) {
            return Object.assign(this, other);
        }
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
        this.error = undefined;
        this.modifyType = undefined;
        this.modifyValue = undefined;
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
        this.tokenHash = NO_TOKEN_HASH;
        this.tokenBeg = 0;
        this.typeBits = 0;
        this.notTypeBits = 0;
        this.wildcardPos = -1;
        this.caretPos = -1;
        return this;
    }

    start(/* writer */) {
    }

    finish(/* writer */) {
    }

    clone() {
        return new FilterCompiler(this.parser, this);
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

    processTypeOption(id, not) {
        if ( id !== -1 ) {
            const typeBit = this.tokenIdToNormalizedType.get(id);
            if ( not ) {
                this.notTypeBits |= typeBit;
            } else {
                this.typeBits |= typeBit;
            }
            return;
        }
        // `all` option
        if ( not ) {
            this.notTypeBits |= allTypesBits;
        } else {
            this.typeBits |= allTypesBits;
        }
    }

    processPartyOption(firstParty, not) {
        if ( not ) {
            firstParty = !firstParty;
        }
        this.party |= firstParty ? FirstParty : ThirdParty;
    }

    processHostnameList(s, modeBits, out = []) {
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

    processModifierOption(modifier, value) {
        if ( this.modifyType !== undefined ) { return false; }
        this.modifyType = modifier;
        this.modifyValue = value || '';
        return true;
    }

    processOptions() {
        for ( let { id, val, not } of this.parser.netOptions() ) {
            switch ( id ) {
            case this.parser.OPTToken1p:
                this.processPartyOption(true, not);
                break;
            case this.parser.OPTToken1pStrict:
                this.strictParty = this.strictParty === -1 ? 0 : 1;
                this.optionUnitBits |= this.STRICT_PARTY_BIT;
                break;
            case this.parser.OPTToken3p:
                this.processPartyOption(false, not);
                break;
            case this.parser.OPTToken3pStrict:
                this.strictParty = this.strictParty === 1 ? 0 : -1;
                this.optionUnitBits |= this.STRICT_PARTY_BIT;
                break;
            case this.parser.OPTTokenAll:
                this.processTypeOption(-1);
                break;
            // https://github.com/uBlockOrigin/uAssets/issues/192
            case this.parser.OPTTokenBadfilter:
                this.badFilter = true;
                break;
            case this.parser.OPTTokenCsp:
                if ( this.processModifierOption(id, val) === false ) {
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
                this.domainOpt = this.processHostnameList(
                    val,
                    0b1010,
                    this.domainOptList
                );
                if ( this.domainOpt === '' ) { return false; }
                this.optionUnitBits |= this.DOMAIN_BIT;
                break;
            case this.parser.OPTTokenDenyAllow:
                this.denyallowOpt = this.processHostnameList(val, 0b0000);
                if ( this.denyallowOpt === '' ) { return false; }
                this.optionUnitBits |= this.DENYALLOW_BIT;
                break;
            // https://www.reddit.com/r/uBlockOrigin/comments/d6vxzj/
            //   Add support for `elemhide`. Rarely used but it happens.
            case this.parser.OPTTokenEhide:
                this.processTypeOption(this.parser.OPTTokenShide, not);
                this.processTypeOption(this.parser.OPTTokenGhide, not);
                break;
            case this.parser.OPTTokenHeader:
                this.headerOpt = val !== undefined ? val : '';
                this.optionUnitBits |= this.HEADER_BIT;
                break;
            case this.parser.OPTTokenImportant:
                if ( this.action === AllowAction ) { return false; }
                this.optionUnitBits |= this.IMPORTANT_BIT;
                this.action = BlockImportant;
                break;
            // Used by Adguard:
            // https://kb.adguard.com/en/general/how-to-create-your-own-ad-filters#empty-modifier
            case this.parser.OPTTokenEmpty:
                id = this.action === AllowAction
                    ? this.parser.OPTTokenRedirectRule
                    : this.parser.OPTTokenRedirect;
                if ( this.processModifierOption(id, 'empty') === false ) {
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
                if ( this.processModifierOption(id, 'noopmp4-1s') === false ) {
                    return false;
                }
                this.optionUnitBits |= this.REDIRECT_BIT;
                break;
            case this.parser.OPTTokenNoop:
                break;
            case this.parser.OPTTokenRemoveparam:
                if ( this.processModifierOption(id, val) === false ) {
                    return false;
                }
                this.optionUnitBits |= this.REMOVEPARAM_BIT;
                break;
            case this.parser.OPTTokenRedirect:
                if ( this.action === AllowAction ) {
                    id = this.parser.OPTTokenRedirectRule;
                }
                if ( this.processModifierOption(id, val) === false ) {
                    return false;
                }
                this.optionUnitBits |= this.REDIRECT_BIT;
                break;
            case this.parser.OPTTokenRedirectRule:
                if ( this.processModifierOption(id, val) === false ) {
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
                this.processTypeOption(id, not);
                break;
            }
        }

        if ( this.party === AllParties ) {
            this.party = AnyParty;
        }

        // Negated network types? Toggle on all network type bits.
        // Negated non-network types can only toggle themselves.
        //
        // https://github.com/gorhill/uBlock/issues/2385
        //   Toggle on all network types if:
        //   - at least one network type is negated; or
        //   - no network type is present -- i.e. all network types are
        //     implicitly toggled on
        if ( this.notTypeBits !== 0 ) {
            if ( (this.typeBits && allNetworkTypesBits) === allNetworkTypesBits ) {
                this.typeBits &= ~this.notTypeBits | allNetworkTypesBits;
            } else {
                this.typeBits &= ~this.notTypeBits;
            }
            this.optionUnitBits |= this.NOT_TYPE_BIT;
        }

        // CSP directives implicitly apply only to document/subdocument.
        if ( this.modifyType === this.parser.OPTTokenCsp ) {
            if ( this.typeBits === 0 ) {
                this.processTypeOption(this.parser.OPTTokenDoc, false);
                this.processTypeOption(this.parser.OPTTokenFrame, false);
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

    process() {
        // important!
        this.reset();

        if ( this.parser.hasError() ) {
            return this.FILTER_INVALID;
        }

        // Filters which pattern is a single character other than `*` and have
        // no narrowing options are discarded as invalid.
        if ( this.parser.patternIsDubious() ) {
            return this.FILTER_INVALID;
        }

        // block or allow filter?
        // Important: this must be executed before parsing options
        if ( this.parser.isException() ) {
            this.action = AllowAction;
        }

        this.isPureHostname = this.parser.patternIsPlainHostname();

        // Plain hostname? (from HOSTS file)
        if ( this.isPureHostname && this.parser.hasOptions() === false ) {
            this.pattern = this.parser.patternToLowercase();
            this.anchor |= 0b100;
            return this.FILTER_OK;
        }

        // options
        if ( this.parser.hasOptions() && this.processOptions() === false ) {
            return this.FILTER_UNSUPPORTED;
        }

        // regex?
        if ( this.parser.patternIsRegex() ) {
            this.isRegex = true;
            // https://github.com/gorhill/uBlock/issues/1246
            //   If the filter is valid, use the corrected version of the
            //   source string -- this ensure reverse-lookup will work fine.
            this.pattern = this.normalizeRegexSource(this.parser.getNetPattern());
            if ( this.pattern === '' ) {
                return this.FILTER_UNSUPPORTED;
            }
            return this.FILTER_OK;
        }

        const pattern = this.parser.patternIsMatchAll()
            ? '*'
            : this.parser.patternToLowercase();

        if ( this.parser.patternIsLeftHostnameAnchored() ) {
            this.anchor |= 0b100;
        } else if ( this.parser.patternIsLeftAnchored() ) {
            this.anchor |= 0b010;
        }
        if ( this.parser.patternIsRightAnchored() ) {
            this.anchor |= 0b001;
        }

        if ( this.parser.patternHasWildcard() ) {
            this.wildcardPos = pattern.indexOf('*');
        }

        if ( this.parser.patternHasCaret() ) {
            this.caretPos = pattern.indexOf('^');
        }

        if ( pattern.length > 1024 ) {
            return this.FILTER_UNSUPPORTED;
        }

        this.pattern = pattern;
        return this.FILTER_OK;
    }

    // Given a string, find a good token. Tokens which are too generic,
    // i.e. very common with a high probability of ending up as a miss,
    // are not good. Avoid if possible. This has a significant positive
    // impact on performance.
    //
    // For pattern-less removeparam filters, try to derive a pattern from
    // the removeparam value.

    makeToken() {
        if ( this.pattern === '*' ) {
            if ( this.modifyType !== this.parser.OPTTokenRemoveparam ) {
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
            if ( token.length < MAX_TOKEN_LENGTH ) {
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
        pattern = StaticFilteringParser.regexUtils.toTokenizableStr(pattern);
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
                token.length < MAX_TOKEN_LENGTH && (
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
        this.extractTokenFromPattern(pattern.toLowerCase());
    }

    hasNoOptionUnits() {
        return this.optionUnitBits === 0;
    }

    isJustOrigin() {
        if ( this.optionUnitBits !== this.DOMAIN_BIT ) { return false; }
        if ( this.isRegex ) { return false; }
        if ( this.domainOpt.includes('~') ) { return false; }
        if ( this.pattern === '*' ) { return true; }
        if ( this.anchor !== 0b010 ) { return false; }
        if ( /^(?:http[s*]?:(?:\/\/)?)$/.test(this.pattern) ) { return true; }
        return false;
    }

    domainIsEntity(s) {
        const l = s.length;
        return l > 2 &&
               s.charCodeAt(l-1) === 0x2A /* '*' */ &&
               s.charCodeAt(l-2) === 0x2E /* '.' */;
    }

    compile(writer) {
        const r = this.process();

        // Ignore non-static network filters
        if ( r === this.FILTER_INVALID ) { return false; }

        // Ignore filters with unsupported options
        if ( r === this.FILTER_UNSUPPORTED ) {
            const who = writer.properties.get('name') || '?';
            this.error = `Invalid network filter in ${who}: ${this.parser.raw}`;
            return false;
        }

        writer.select(
            this.badFilter
                ? 'NETWORK_FILTERS:BAD'
                : 'NETWORK_FILTERS:GOOD'
        );

        // Reminder:
        //   `redirect=` is a combination of a `redirect-rule` filter and a
        //   block filter.
        if ( this.modifyType === this.parser.OPTTokenRedirect ) {
            this.modifyType = this.parser.OPTTokenRedirectRule;
            const parsedBlock = this.clone();
            parsedBlock.modifyType = undefined;
            parsedBlock.optionUnitBits &= ~this.REDIRECT_BIT;
            parsedBlock.compileToFilter(writer);
        }

        this.compileToFilter(writer);

        return true;
    }

    compileToFilter(writer) {
        // Pure hostnames, use more efficient dictionary lookup
        if ( this.isPureHostname && this.hasNoOptionUnits() ) {
            this.tokenHash = DOT_TOKEN_HASH;
            this.compileToAtomicFilter(this.pattern, writer);
            return;
        }

        this.makeToken();

        // Special pattern/option cases:
        // - `*$domain=...`
        // - `|http://$domain=...`
        // - `|https://$domain=...`
        // The semantic of "just-origin" filters is that contrary to normal
        // filters, the original filter is split into as many filters as there
        // are entries in the `domain=` option.
        if ( this.isJustOrigin() ) {
            if ( this.pattern === '*' || this.pattern.startsWith('http*') ) {
                this.tokenHash = ANY_TOKEN_HASH;
            } else if /* 'https:' */ ( this.pattern.startsWith('https') ) {
                this.tokenHash = ANY_HTTPS_TOKEN_HASH;
            } else /* 'http:' */ {
                this.tokenHash = ANY_HTTP_TOKEN_HASH;
            }
            for ( const hn of this.domainOptList ) {
                this.compileToAtomicFilter(hn, writer);
            }
            return;
        }

        const units = [];

        // Pattern
        this.compilePattern(units);

        // Anchor
        if ( (this.anchor & 0b100) !== 0 ) {
            if ( this.isPureHostname ) {
                units.push(FilterAnchorHn.compile());
            } else {
                units.push(FilterAnchorHnLeft.compile());
            }
        } else if ( (this.anchor & 0b010) !== 0 ) {
            units.push(FilterAnchorLeft.compile());
        }
        if ( (this.anchor & 0b001) !== 0 ) {
            units.push(FilterAnchorRight.compile());
        }

        // Not types
        if ( this.notTypeBits !== 0 ) {
            units.push(FilterNotType.compile(this));
        }

        // Strict partiness
        if ( this.strictParty !== 0 ) {
            units.push(FilterStrictParty.compile(this));
        }

        // Origin
        if ( this.domainOpt !== '' ) {
            compileDomainOpt(
                this.domainOptList,
                units.length !== 0 && filterClasses[units[0][0]].isSlow === true,
                units
            );
        }

        // Deny-allow
        if ( this.denyallowOpt !== '' ) {
            units.push(FilterDenyAllow.compile(this));
        }

        // Header
        if ( this.headerOpt !== undefined ) {
            units.push(FilterOnHeaders.compile(this));
            this.action |= HEADERS;
        }

        // Important
        //
        // IMPORTANT: must always appear at the end of the sequence, so as to
        // ensure $isBlockImportant is set only for matching filters.
        if ( (this.optionUnitBits & this.IMPORTANT_BIT) !== 0 ) {
            units.push(FilterImportant.compile());
        }

        // Modifier
        //
        // IMPORTANT: the modifier unit MUST always appear first in a sequence
        if ( this.modifyType !== undefined ) {
            units.unshift(FilterModifier.compile(this));
            this.action = (this.action & ~ActionBitsMask) | ModifyAction;
        }

        this.compileToAtomicFilter(
            units.length === 1
                ? units[0]
                : FilterCompositeAll.compile(units),
            writer
        );
    }

    compilePattern(units) {
        if ( this.isRegex ) {
            units.push(FilterRegex.compile(this));
            return;
        }
        if ( this.pattern === '*' ) {
            units.push(FilterPatternAny.compile());
            return;
        }
        if ( this.tokenHash === NO_TOKEN_HASH ) {
            units.push(FilterPatternGeneric.compile(this));
            return;
        }
        if ( this.wildcardPos === -1 ) {
            if ( this.caretPos === -1 ) {
                units.push(FilterPatternPlain.compile(this));
                return;
            }
            if ( this.caretPos === (this.pattern.length - 1) ) {
                this.pattern = this.pattern.slice(0, -1);
                units.push(FilterPatternPlain.compile(this));
                units.push(FilterTrailingSeparator.compile());
                return;
            }
        }
        units.push(FilterPatternGeneric.compile(this));
    }

    compileToAtomicFilter(fdata, writer) {
        const catBits = this.action | this.party;
        let { typeBits } = this;

        // Typeless
        if ( typeBits === 0 ) {
            writer.push([ catBits, this.tokenHash, fdata ]);
            return;
        }
        // If all network types are set, create a typeless filter. Excluded
        // network types are tested at match time, se we act as if they are
        // set.
        if ( (typeBits & allNetworkTypesBits) === allNetworkTypesBits ) {
            writer.push([ catBits, this.tokenHash, fdata ]);
            typeBits &= ~allNetworkTypesBits;
            if ( typeBits === 0 ) { return; }
        }
        // One filter per specific types
        let bitOffset = 1;
        do {
            if ( typeBits & 1 ) {
                writer.push([
                    catBits | (bitOffset << TypeBitsOffset),
                    this.tokenHash,
                    fdata
                ]);
            }
            bitOffset += 1;
            typeBits >>>= 1;
        } while ( typeBits !== 0 );
    }
}

FilterCompiler.prototype.DOMAIN_BIT       = 0b000000001;
FilterCompiler.prototype.DENYALLOW_BIT    = 0b000000010;
FilterCompiler.prototype.HEADER_BIT       = 0b000000100;
FilterCompiler.prototype.STRICT_PARTY_BIT = 0b000001000;
FilterCompiler.prototype.CSP_BIT          = 0b000010000;
FilterCompiler.prototype.REMOVEPARAM_BIT  = 0b000100000;
FilterCompiler.prototype.REDIRECT_BIT     = 0b001000000;
FilterCompiler.prototype.NOT_TYPE_BIT     = 0b010000000;
FilterCompiler.prototype.IMPORTANT_BIT    = 0b100000000;

FilterCompiler.prototype.FILTER_OK          = 0;
FilterCompiler.prototype.FILTER_INVALID     = 1;
FilterCompiler.prototype.FILTER_UNSUPPORTED = 2;

/******************************************************************************/
/******************************************************************************/

const FilterContainer = function() {
    this.compilerVersion = '8';
    this.selfieVersion = '9';

    this.MAX_TOKEN_LENGTH = MAX_TOKEN_LENGTH;
    this.optimizeTaskId = undefined;
    // As long as CategoryCount is reasonably low, we will use an array to
    // store buckets using category bits as index. If ever CategoryCount
    // becomes too large, we can just go back to using a Map.
    this.bitsToBucketIndices = JSON.parse(`[${'0,'.repeat(CategoryCount-1)}0]`);
    this.buckets = [ new Map() ];
    this.goodFilters = new Set();
    this.badFilters = new Set();
    this.unitsToOptimize = [];
    this.reset();
};

/******************************************************************************/

FilterContainer.prototype.prime = function() {
    origHNTrieContainer.reset(
        keyvalStore.getItem('SNFE.origHNTrieContainer.trieDetails')
    );
    destHNTrieContainer.reset(
        keyvalStore.getItem('SNFE.destHNTrieContainer.trieDetails')
    );
    bidiTriePrime();
    // Remove entries with obsolete name.
    // TODO: Remove before publishing 1.41.0
    keyvalStore.removeItem('SNFE.filterOrigin.trieDetails');
    keyvalStore.removeItem('SNFE.FilterHostnameDict.trieDetails');
    keyvalStore.removeItem('SNFE.filterDocOrigin.trieDetails');
};

/******************************************************************************/

FilterContainer.prototype.reset = function() {
    this.processedFilterCount = 0;
    this.acceptedCount = 0;
    this.discardedCount = 0;
    this.goodFilters.clear();
    this.badFilters.clear();
    this.unitsToOptimize.length = 0;
    this.bitsToBucketIndices.fill(0);
    this.buckets.length = 1;

    urlTokenizer.resetKnownTokens();

    filterDataReset();
    filterRefsReset();
    origHNTrieContainer.reset();
    destHNTrieContainer.reset();
    bidiTrie.reset();
    filterArgsToUnit.clear();

    // Cancel potentially pending optimization run.
    if ( this.optimizeTaskId !== undefined ) {
        dropTask(this.optimizeTaskId);
        this.optimizeTaskId = undefined;
    }

    // Runtime registers
    this.$catBits = 0;
    this.$tokenHash = 0;
    this.$filterUnit = 0;
};

/******************************************************************************/

FilterContainer.prototype.freeze = function() {
    const unserialize = CompiledListReader.unserialize;

    for ( const line of this.goodFilters ) {
        if ( this.badFilters.has(line) ) {
            this.discardedCount += 1;
            continue;
        }

        const args = unserialize(line);

        const bits = args[0];
        let ibucket = this.bitsToBucketIndices[bits];
        if ( ibucket === 0 ) {
            ibucket = this.bitsToBucketIndices[bits] = this.buckets.length;
            this.buckets.push(new Map());
        }

        const tokenHash = args[1];
        const fdata = args[2];

        const bucket = this.buckets[ibucket];
        let iunit = bucket.get(tokenHash) || 0;

        if ( tokenHash === DOT_TOKEN_HASH ) {
            if ( iunit === 0 ) {
                iunit = FilterHostnameDict.create();
                bucket.set(DOT_TOKEN_HASH, iunit);
                this.unitsToOptimize.push({ bits, tokenHash });
            }
            FilterHostnameDict.add(iunit, fdata);
            continue;
        }

        if ( tokenHash === ANY_TOKEN_HASH ) {
            if ( iunit === 0 ) {
                iunit = FilterJustOrigin.create();
                bucket.set(ANY_TOKEN_HASH, iunit);
            }
            FilterJustOrigin.add(iunit, fdata);
            continue;
        }

        if ( tokenHash === ANY_HTTPS_TOKEN_HASH ) {
            if ( iunit === 0 ) {
                iunit = FilterHTTPSJustOrigin.create();
                bucket.set(ANY_HTTPS_TOKEN_HASH, iunit);
            }
            FilterHTTPSJustOrigin.add(iunit, fdata);
            continue;
        }

        if ( tokenHash === ANY_HTTP_TOKEN_HASH ) {
            if ( iunit === 0 ) {
                iunit = FilterHTTPJustOrigin.create();
                bucket.set(ANY_HTTP_TOKEN_HASH, iunit);
            }
            FilterHTTPJustOrigin.add(iunit, fdata);
            continue;
        }

        urlTokenizer.addKnownToken(tokenHash);

        this.addFilterUnit(bits, tokenHash, filterFromCompiled(fdata));

        // Add block-important filters to the block realm, so as to avoid
        // to unconditionally match against the block-important realm for
        // every network request. Block-important filters are quite rare so
        // the block-important realm should be checked when and only when
        // there is a matched exception filter, which important filters are
        // meant to override.
        if ( (bits & ActionBitsMask) === BlockImportant ) {
            this.addFilterUnit(
                bits & ~Important,
                tokenHash,
                filterFromCompiled(fdata)
            );
        }
    }

    this.badFilters.clear();
    this.goodFilters.clear();
    filterArgsToUnit.clear();

    // Optimizing is not critical for the static network filtering engine to
    // work properly, so defer this until later to allow for reduced delay to
    // readiness when no valid selfie is available.
    if ( this.optimizeTaskId !== undefined ) { return; }

    this.optimizeTaskId = queueTask(( ) => {
        this.optimizeTaskId = undefined;
        this.optimize(30);
    }, 2000);
};

/******************************************************************************/

FilterContainer.prototype.addFilterUnit = function(
    bits,
    tokenHash,
    inewunit
) {
    let ibucket = this.bitsToBucketIndices[bits];
    if ( ibucket === 0 ) {
        ibucket = this.bitsToBucketIndices[bits] = this.buckets.length;
        this.buckets.push(new Map());
    }
    const bucket = this.buckets[ibucket];
    const istoredunit = bucket.get(tokenHash) || 0;
    if ( istoredunit === 0 ) {
        bucket.set(tokenHash, inewunit);
        return;
    }
    if ( filterData[istoredunit+0] === FilterBucket.fid ) {
        FilterBucket.unshift(istoredunit, inewunit);
        return;
    }
    const ibucketunit = FilterBucket.create();
    FilterBucket.unshift(ibucketunit, istoredunit);
    FilterBucket.unshift(ibucketunit, inewunit);
    bucket.set(tokenHash, ibucketunit);
    this.unitsToOptimize.push({ bits, tokenHash });
};

/******************************************************************************/

FilterContainer.prototype.optimize = function(throttle = 0) {
    if ( this.optimizeTaskId !== undefined ) {
        dropTask(this.optimizeTaskId);
        this.optimizeTaskId = undefined;
    }

    const later = throttle => {
        this.optimizeTaskId = queueTask(( ) => {
            this.optimizeTaskId = undefined;
            this.optimize(throttle);
        }, 1000);
    };

    const t0 = Date.now();
    while ( this.unitsToOptimize.length !== 0 ) {
        const { bits, tokenHash } = this.unitsToOptimize.pop();
        const bucket = this.buckets[this.bitsToBucketIndices[bits]];
        const iunit = bucket.get(tokenHash);
        const fc = filterGetClass(iunit);
        switch ( fc ) {
        case FilterHostnameDict:
            FilterHostnameDict.optimize(iunit);
            break;
        case FilterBucket: {
            const optimizeBits =
                (tokenHash === NO_TOKEN_HASH) || (bits & ModifyAction) !== 0
                    ? 0b10
                    : 0b01;
            const inewunit = FilterBucket.optimize(iunit, optimizeBits);
            if ( inewunit !== 0 ) {
                bucket.set(tokenHash, inewunit);
            }
            break;
        }
        default:
            break;
        }
        if ( throttle > 0 && (Date.now() - t0) > 40 ) {
            return later(throttle - 1);
        }
    }

    filterArgsToUnit.clear();

    // Here we do not optimize origHNTrieContainer because many origin-related
    // tries are instantiated on demand.
    keyvalStore.setItem(
        'SNFE.destHNTrieContainer.trieDetails',
        destHNTrieContainer.optimize()
    );
    bidiTrieOptimize();
    filterDataShrink();
};

/******************************************************************************/

FilterContainer.prototype.toSelfie = async function(storage, path) {
    if ( typeof storage !== 'object' || storage === null ) { return; }
    if ( typeof storage.put !== 'function' ) { return; }

    const bucketsToSelfie = ( ) => {
        const selfie = [];
        for ( const bucket of this.buckets ) {
            selfie.push(Array.from(bucket));
        }
        return selfie;
    };

    bidiTrieOptimize(true);
    keyvalStore.setItem(
        'SNFE.origHNTrieContainer.trieDetails',
        origHNTrieContainer.optimize()
    );

    return Promise.all([
        storage.put(
            `${path}/destHNTrieContainer`,
            destHNTrieContainer.serialize(sparseBase64)
        ),
        storage.put(
            `${path}/origHNTrieContainer`,
            origHNTrieContainer.serialize(sparseBase64)
        ),
        storage.put(
            `${path}/bidiTrie`,
            bidiTrie.serialize(sparseBase64)
        ),
        storage.put(
            `${path}/filterData`,
            filterDataToSelfie()
        ),
        storage.put(
            `${path}/filterRefs`,
            filterRefsToSelfie()
        ),
        storage.put(
            `${path}/main`,
            JSON.stringify({
                version: this.selfieVersion,
                processedFilterCount: this.processedFilterCount,
                acceptedCount: this.acceptedCount,
                discardedCount: this.discardedCount,
                bitsToBucketIndices: this.bitsToBucketIndices,
                buckets: bucketsToSelfie(),
                urlTokenizer: urlTokenizer.toSelfie(),
            })
        )
    ]);
};

FilterContainer.prototype.serialize = async function() {
    const selfie = [];
    const storage = {
        put(name, data) {
            selfie.push([ name, data ]);
        }
    };
    await this.toSelfie(storage, '');
    return JSON.stringify(selfie);
};

/******************************************************************************/

FilterContainer.prototype.fromSelfie = async function(storage, path) {
    if ( typeof storage !== 'object' || storage === null ) { return; }
    if ( typeof storage.get !== 'function' ) { return; }

    this.reset();

    const results = await Promise.all([
        storage.get(`${path}/main`),
        storage.get(`${path}/destHNTrieContainer`).then(details =>
            destHNTrieContainer.unserialize(details.content, sparseBase64)
        ),
        storage.get(`${path}/origHNTrieContainer`).then(details =>
            origHNTrieContainer.unserialize(details.content, sparseBase64)
        ),
        storage.get(`${path}/bidiTrie`).then(details =>
            bidiTrie.unserialize(details.content, sparseBase64)
        ),
        storage.get(`${path}/filterData`).then(details =>
            filterDataFromSelfie(details.content)
        ),
        storage.get(`${path}/filterRefs`).then(details =>
            filterRefsFromSelfie(details.content)
        ),
    ]);

    if ( results.slice(1).every(v => v === true) === false ) { return false; }

    const bucketsFromSelfie = selfie => {
        for ( let i = 0; i < selfie.length; i++ ) {
            this.buckets[i] = new Map(selfie[i]);
        }
    };

    const details = results[0];
    if ( typeof details !== 'object' || details === null ) { return false; }
    if ( typeof details.content !== 'string' ) { return false; }
    if ( details.content === '' ) { return false; }
    let selfie;
    try {
        selfie = JSON.parse(details.content);
    } catch (ex) {
    }
    if ( typeof selfie !== 'object' || selfie === null ) { return false; }
    if ( selfie.version !== this.selfieVersion ) { return false; }
    this.processedFilterCount = selfie.processedFilterCount;
    this.acceptedCount = selfie.acceptedCount;
    this.discardedCount = selfie.discardedCount;
    this.bitsToBucketIndices = selfie.bitsToBucketIndices;
    bucketsFromSelfie(selfie.buckets);
    urlTokenizer.fromSelfie(selfie.urlTokenizer);
    return true;
};

FilterContainer.prototype.unserialize = async function(s) {
    const selfie = new Map(JSON.parse(s));
    const storage = {
        async get(name) {
            return { content: selfie.get(name) };
        }
    };
    return this.fromSelfie(storage, '');
};

/******************************************************************************/

FilterContainer.prototype.createCompiler = function(parser) {
    return new FilterCompiler(parser);
};

/******************************************************************************/

FilterContainer.prototype.fromCompiled = function(reader) {
    reader.select('NETWORK_FILTERS:GOOD');
    while ( reader.next() ) {
        this.acceptedCount += 1;
        if ( this.goodFilters.has(reader.line) ) {
            this.discardedCount += 1;
        } else {
            this.goodFilters.add(reader.line);
        }
    }

    reader.select('NETWORK_FILTERS:BAD');
    while ( reader.next() ) {
        this.badFilters.add(reader.line);
    }
};

/******************************************************************************/

FilterContainer.prototype.matchAndFetchModifiers = function(
    fctxt,
    modifierType
) {
    const typeBits = typeNameToTypeValue[fctxt.type] || otherTypeBitValue;

    $requestURL = urlTokenizer.setURL(fctxt.url);
    $requestURLRaw = fctxt.url;
    $docHostname = fctxt.getDocHostname();
    $docDomain = fctxt.getDocDomain();
    $requestHostname = fctxt.getHostname();
    $requestTypeValue = (typeBits & TypeBitsMask) >>> TypeBitsOffset;

    const partyBits = fctxt.is3rdPartyToDoc() ? ThirdParty : FirstParty;

    const catBits00 = ModifyAction;
    const catBits01 = ModifyAction | typeBits;
    const catBits10 = ModifyAction | partyBits;
    const catBits11 = ModifyAction | typeBits | partyBits;

    const ibucket00 = this.bitsToBucketIndices[catBits00];
    const ibucket01 = typeBits !== 0 ? this.bitsToBucketIndices[catBits01]
        : 0;
    const ibucket10 = partyBits !== 0
        ? this.bitsToBucketIndices[catBits10]
        : 0;
    const ibucket11 = typeBits !== 0 && partyBits !== 0
        ? this.bitsToBucketIndices[catBits11]
        : 0;

    if (
        ibucket00 === 0 && ibucket01 === 0 &&
        ibucket10 === 0 && ibucket11 === 0
    ) {
        return;
    }

    const bucket00 = this.buckets[ibucket00];
    const bucket01 = this.buckets[ibucket01];
    const bucket10 = this.buckets[ibucket10];
    const bucket11 = this.buckets[ibucket11];

    const results = [];
    const env = {
        type: StaticFilteringParser.netOptionTokenIds.get(modifierType) || 0,
        bits: 0,
        th: 0,
        iunit: 0,
        results,
    };

    const tokenHashes = urlTokenizer.getTokens(bidiTrie);
    let i = 0;
    let th = 0, iunit = 0;
    for (;;) {
        th = tokenHashes[i];
        if ( th === INVALID_TOKEN_HASH ) { break; }
        env.th = th;
        $tokenBeg = tokenHashes[i+1];
        if (
            (ibucket00 !== 0) &&
            (iunit = bucket00.get(th) || 0) !== 0
        ) {
            env.bits = catBits00; env.iunit = iunit;
            filterMatchAndFetchModifiers(iunit, env);
        }
        if (
            (ibucket01 !== 0) &&
            (iunit = bucket01.get(th) || 0) !== 0
        ) {
            env.bits = catBits01; env.iunit = iunit;
            filterMatchAndFetchModifiers(iunit, env);
        }
        if (
            (ibucket10 !== 0) &&
            (iunit = bucket10.get(th) || 0) !== 0
        ) {
            env.bits = catBits10; env.iunit = iunit;
            filterMatchAndFetchModifiers(iunit, env);
        }
        if (
            (ibucket11 !== 0) &&
            (iunit = bucket11.get(th) || 0) !== 0
        ) {
            env.bits = catBits11; env.iunit = iunit;
            filterMatchAndFetchModifiers(iunit, env);
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
        const modifyValue = result.value;
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

    const ibucket00 = exactType === 0
        ? this.bitsToBucketIndices[catBits00]
        : 0;
    const ibucket01 = exactType !== 0 || typeBits !== 0
        ? this.bitsToBucketIndices[catBits01]
        : 0;
    const ibucket10 = exactType === 0 && partyBits !== 0
        ? this.bitsToBucketIndices[catBits10]
        : 0;
    const ibucket11 = (exactType !== 0 || typeBits !== 0) && partyBits !== 0
        ? this.bitsToBucketIndices[catBits11]
        : 0;

    if (
        ibucket00 === 0 && ibucket01 === 0 &&
        ibucket10 === 0 && ibucket11 === 0
    ) {
        return false;
    }

    const bucket00 = this.buckets[ibucket00];
    const bucket01 = this.buckets[ibucket01];
    const bucket10 = this.buckets[ibucket10];
    const bucket11 = this.buckets[ibucket11];

    let catBits = 0, iunit = 0;

    // Pure hostname-based filters
    let tokenHash = DOT_TOKEN_HASH;
    if (
        (ibucket00 !== 0) &&
        (iunit = bucket00.get(tokenHash) || 0) !== 0 &&
        (filterMatch(iunit) === true)
    ) {
        catBits = catBits00;
    } else if (
        (ibucket01 !== 0) &&
        (iunit = bucket01.get(tokenHash) || 0) !== 0 &&
        (filterMatch(iunit) === true)
    ) {
        catBits = catBits01;
    } else if (
        (ibucket10 !== 0) &&
        (iunit = bucket10.get(tokenHash) || 0) !== 0 &&
        (filterMatch(iunit) === true)
    ) {
        catBits = catBits10;
    } else if (
        (ibucket11 !== 0) &&
        (iunit = bucket11.get(tokenHash) || 0) !== 0 &&
        (filterMatch(iunit) === true)
    ) {
        catBits = catBits11;
    }
    // Pattern-based filters
    else {
        const tokenHashes = urlTokenizer.getTokens(bidiTrie);
        let i = 0;
        for (;;) {
            tokenHash = tokenHashes[i];
            if ( tokenHash === INVALID_TOKEN_HASH ) { return false; }
            $tokenBeg = tokenHashes[i+1];
            if (
                (ibucket00 !== 0) &&
                (iunit = bucket00.get(tokenHash) || 0) !== 0 &&
                (filterMatch(iunit) === true)
            ) {
                catBits = catBits00;
                break;
            }
            if (
                (ibucket01 !== 0) &&
                (iunit = bucket01.get(tokenHash) || 0) !== 0 &&
                (filterMatch(iunit) === true)
            ) {
                catBits = catBits01;
                break;
            }
            if (
                (ibucket10 !== 0) &&
                (iunit = bucket10.get(tokenHash) || 0) !== 0 &&
                (filterMatch(iunit) === true)
            ) {
                catBits = catBits10;
                break;
            }
            if (
                (ibucket11 !== 0) &&
                (iunit = bucket11.get(tokenHash) || 0) !== 0 &&
                (filterMatch(iunit) === true)
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

FilterContainer.prototype.matchRequestReverse = function(type, url) {
    const typeBits = typeNameToTypeValue[type] | 0x80000000;

    // Prime tokenizer: we get a normalized URL in return.
    $requestURL = urlTokenizer.setURL(url);
    $requestURLRaw = url;
    $requestTypeValue = (typeBits & TypeBitsMask) >>> TypeBitsOffset;
    $isBlockImportant = false;
    this.$filterUnit = 0;

    // These registers will be used by various filters
    $docHostname = $requestHostname = hostnameFromNetworkURL(url);
    $docDomain = domainFromHostname($docHostname);

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
FilterContainer.prototype.matchRequest = function(fctxt, modifiers = 0) {
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
    $requestURL = urlTokenizer.setURL(fctxt.url);
    $requestURLRaw = fctxt.url;
    this.$filterUnit = 0;

    // These registers will be used by various filters
    $docHostname = fctxt.getDocHostname();
    $docDomain = fctxt.getDocDomain();
    $requestHostname = fctxt.getHostname();
    $requestTypeValue = (typeBits & TypeBitsMask) >>> TypeBitsOffset;
    $isBlockImportant = false;

    // Evaluate block realm before allow realm, and allow realm before
    // block-important realm, i.e. by order of likelihood of a match.
    const r = this.realmMatchString(BlockAction, typeBits, partyBits);
    if ( r || (modifiers & 0b0010) !== 0 ) {
        if ( $isBlockImportant ) { return 1; }
        if ( this.realmMatchString(AllowAction, typeBits, partyBits) ) {
            if ( this.realmMatchString(BlockImportant, typeBits, partyBits) ) {
                return 1;
            }
            return 2;
        }
        if ( r ) { return 1; }
    }
    return 0;
};

/******************************************************************************/

FilterContainer.prototype.matchHeaders = function(fctxt, headers) {
    const typeBits = typeNameToTypeValue[fctxt.type] || otherTypeBitValue;
    const partyBits = fctxt.is3rdPartyToDoc() ? ThirdParty : FirstParty;

    // Prime tokenizer: we get a normalized URL in return.
    $requestURL = urlTokenizer.setURL(fctxt.url);
    $requestURLRaw = fctxt.url;
    this.$filterUnit = 0;

    // These registers will be used by various filters
    $docHostname = fctxt.getDocHostname();
    $docDomain = fctxt.getDocDomain();
    $requestHostname = fctxt.getHostname();
    $requestTypeValue = (typeBits & TypeBitsMask) >>> TypeBitsOffset;
    $httpHeaders.init(headers);

    let r = 0;
    if ( this.realmMatchString(HEADERS | BlockImportant, typeBits, partyBits) ) {
        r = 1;
    } else if ( this.realmMatchString(HEADERS | BlockAction, typeBits, partyBits) ) {
        r = this.realmMatchString(HEADERS | AllowAction, typeBits, partyBits)
            ? 2
            : 1;
    }

    $httpHeaders.reset();

    return r;
};

/******************************************************************************/

FilterContainer.prototype.redirectRequest = function(redirectEngine, fctxt) {
    const directives = this.matchAndFetchModifiers(fctxt, 'redirect-rule');
    // No directive is the most common occurrence.
    if ( directives === undefined ) { return; }
    const highest = directives.length - 1;
    // More than a single directive means more work.
    if ( highest !== 0 ) {
        directives.sort((a, b) => compareRedirectRequests(redirectEngine, a, b));
    }
    // Redirect to highest-ranked directive
    const directive = directives[highest];
    if ( (directive.bits & AllowAction) === 0 ) {
        const { token } = parseRedirectRequestValue(directive);
        fctxt.redirectURL = redirectEngine.tokenToURL(fctxt, token);
        if ( fctxt.redirectURL === undefined ) { return; }
    }
    return directives;
};

function parseRedirectRequestValue(directive) {
    if ( directive.cache === null ) {
        directive.cache =
            StaticFilteringParser.parseRedirectValue(directive.value);
    }
    return directive.cache;
}

function compareRedirectRequests(redirectEngine, a, b) {
    const { token: atok, priority: aint, bits: abits } =
        parseRedirectRequestValue(a);
    if ( redirectEngine.hasToken(atok) === false ) { return -1; }
    const { token: btok, priority: bint, bits: bbits } =
        parseRedirectRequestValue(b);
    if ( redirectEngine.hasToken(btok) === false ) { return 1; }
    if ( abits !== bbits ) {
        if ( (abits & Important) !== 0 ) { return 1; }
        if ( (bbits & Important) !== 0 ) { return -1; }
        if ( (abits & AllowAction) !== 0 ) { return -1; }
        if ( (bbits & AllowAction) !== 0 ) { return 1; }
    }
    return aint - bint;
}

/******************************************************************************/

// https://github.com/uBlockOrigin/uBlock-issues/issues/1626
//   Do not redirect when the number of query parameters does not change.

FilterContainer.prototype.filterQuery = function(fctxt) {
    const directives = this.matchAndFetchModifiers(fctxt, 'removeparam');
    if ( directives === undefined ) { return; }
    const url = fctxt.url;
    const qpos = url.indexOf('?');
    if ( qpos === -1 ) { return; }
    let hpos = url.indexOf('#', qpos + 1);
    if ( hpos === -1 ) { hpos = url.length; }
    const params = new Map();
    const query = url.slice(qpos + 1, hpos);
    for ( let i = 0; i < query.length; ) {
        let pos = query.indexOf('&', i);
        if ( pos === -1 ) { pos = query.length; }
        const kv = query.slice(i, pos);
        i = pos + 1;
        pos = kv.indexOf('=');
        if ( pos !== -1 ) {
            params.set(kv.slice(0, pos), kv.slice(pos + 1));
        } else {
            params.set(kv, '');
        }
    }
    const inParamCount = params.size;
    const out = [];
    for ( const directive of directives ) {
        if ( params.size === 0 ) { break; }
        const isException = (directive.bits & AllowAction) !== 0;
        if ( isException && directive.value === '' ) {
            out.push(directive);
            break;
        }
        const { all, bad, name, not, re } = parseQueryPruneValue(directive);
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
        for ( const [ key, raw ] of params ) {
            let value = raw;
            try { value = decodeURIComponent(value); }
            catch(ex) { }
            if ( re.test(`${key}=${value}`) === not ) { continue; }
            if ( isException === false ) { params.delete(key); }
            filtered = true;
        }
        if ( filtered ) {
            out.push(directive);
        }
    }
    if ( out.length === 0 ) { return; }
    if ( params.size !== inParamCount ) {
        fctxt.redirectURL = url.slice(0, qpos);
        if ( params.size !== 0 ) {
            fctxt.redirectURL += '?' + Array.from(params).map(a =>
                a[1] === '' ? a[0] : `${a[0]}=${a[1]}`
            ).join('&');
        }
        if ( hpos !== url.length ) {
            fctxt.redirectURL += url.slice(hpos);
        }
    }
    return out;
};

function parseQueryPruneValue(directive) {
    if ( directive.cache === null ) {
        directive.cache =
            StaticFilteringParser.parseQueryPruneValue(directive.value);
    }
    return directive.cache;
}

/******************************************************************************/

FilterContainer.prototype.hasQuery = function(fctxt) {
    urlTokenizer.setURL(fctxt.url);
    return urlTokenizer.hasQuery();
};

/******************************************************************************/

FilterContainer.prototype.toLogData = function() {
    if ( this.$filterUnit !== 0 ) {
        return new LogData(this.$catBits, this.$tokenHash, this.$filterUnit);
    }
};

/******************************************************************************/

FilterContainer.prototype.isBlockImportant = function() {
    return this.$filterUnit !== 0 && $isBlockImportant;
};

/******************************************************************************/

FilterContainer.prototype.getFilterCount = function() {
    return this.acceptedCount - this.discardedCount;
};

/******************************************************************************/

FilterContainer.prototype.enableWASM = function(wasmModuleFetcher, path) {
    return Promise.all([
        bidiTrie.enableWASM(wasmModuleFetcher, path),
        origHNTrieContainer.enableWASM(wasmModuleFetcher, path),
        destHNTrieContainer.enableWASM(wasmModuleFetcher, path),
    ]).then(results => {
        return results.every(a => a === true);
    });
};

/******************************************************************************/

FilterContainer.prototype.test = async function(docURL, type, url) {
    const fctxt = new FilteringContext();
    fctxt.setDocOriginFromURL(docURL);
    fctxt.setType(type);
    fctxt.setURL(url);
    const r = this.matchRequest(fctxt);
    console.info(`${r}`);
    if ( r !== 0 ) {
        console.info(this.toLogData());
    }
};

/******************************************************************************/

FilterContainer.prototype.bucketHistogram = function() {
    const results = [];
    for ( let bits = 0; bits < this.bitsToBucketIndices.length; bits++ ) {
        const ibucket = this.bitsToBucketIndices[bits];
        if ( ibucket === 0 ) { continue; }
        for ( const [ th, iunit ] of this.buckets[ibucket] ) {
            const token = urlTokenizer.stringFromTokenHash(th);
            const fc = filterGetClass(iunit);
            const count = fc.getCount !== undefined ? fc.getCount(iunit) : 1;
            results.push({ bits: bits.toString(16), token, count, f: fc.name });
        }
    }
    results.sort((a, b) => {
        return b.count - a.count;
    });
    console.info(results);
};

/******************************************************************************/

// Dump the internal state of the filtering engine to the console.
// Useful to make development decisions and investigate issues.

FilterContainer.prototype.dump = function() {
    const thConstants = new Map([
        [ NO_TOKEN_HASH, 'NO_TOKEN_HASH' ],
        [ DOT_TOKEN_HASH, 'DOT_TOKEN_HASH' ],
        [ ANY_TOKEN_HASH, 'ANY_TOKEN_HASH' ],
        [ ANY_HTTPS_TOKEN_HASH, 'ANY_HTTPS_TOKEN_HASH' ],
        [ ANY_HTTP_TOKEN_HASH, 'ANY_HTTP_TOKEN_HASH' ],
        [ EMPTY_TOKEN_HASH, 'EMPTY_TOKEN_HASH' ],
    ]);

    const out = [];

    const toOutput = (depth, line, out) => {
        out.push(`${' '.repeat(depth*2)}${line}`);
    };

    // TODO: Also report filters "hidden" behind FilterPlainTrie
    const dumpUnit = (idata, out, depth = 0) => {
        const fc = filterGetClass(idata);
        fcCounts.set(fc.name, (fcCounts.get(fc.name) || 0) + 1);
        const info = filterDumpInfo(idata) || '';
        toOutput(depth, info !== '' ? `${fc.name}: ${info}` : fc.name, out);
        switch ( fc ) {
        case FilterBucket:
        case FilterCompositeAll:
        case FilterOriginHitAny: {
            fc.forEach(idata, i => {
                dumpUnit(i, out, depth+1);
            });
            break;
        }
        case FilterBucketIfOriginHits: {
            dumpUnit(filterData[idata+2], out, depth+1);
            dumpUnit(filterData[idata+1], out, depth+1);
            break;
        }
        case FilterBucketIfRegexHits: {
            dumpUnit(filterData[idata+1], out, depth+1);
            break;
        }
        default:
            break;
        }
    };

    const fcCounts = new Map();
    const thCounts = new Set();

    const realms = new Map([
        [ BlockAction, 'block' ],
        [ BlockImportant, 'block-important' ],
        [ AllowAction, 'unblock' ],
        [ ModifyAction, 'modify' ],
    ]);
    const partyness = new Map([
        [ AnyParty, 'any-party' ],
        [ FirstParty, '1st-party' ],
        [ ThirdParty, '3rd-party' ],
    ]);
    for ( const [ realmBits, realmName ] of realms ) {
        toOutput(1, `+ realm: ${realmName}`, out);
        for ( const [ partyBits, partyName ] of partyness ) {
            toOutput(2, `+ party: ${partyName}`, out);
            const processedTypeBits = new Set();
            for ( const typeName in typeNameToTypeValue ) {
                const typeBits = typeNameToTypeValue[typeName];
                if ( processedTypeBits.has(typeBits) ) { continue; }
                processedTypeBits.add(typeBits);
                const bits = realmBits | partyBits | typeBits;
                const ibucket = this.bitsToBucketIndices[bits];
                if ( ibucket === 0 ) { continue; }
                const thCount = this.buckets[ibucket].size;
                toOutput(3, `+ type: ${typeName} (${thCount})`, out);
                for ( const [ th, iunit ] of this.buckets[ibucket] ) {
                    thCounts.add(th);
                    const ths = thConstants.has(th)
                        ? thConstants.get(th)
                        : `0x${th.toString(16)}`;
                    toOutput(4, `+ th: ${ths}`, out);
                    dumpUnit(iunit, out, 5);
                }
            }
        }
    }

    const knownTokens =
        urlTokenizer.knownTokens
                    .reduce((a, b) => b !== 0 ? a+1 : a, 0);

    out.unshift([
        'Static Network Filtering Engine internals:',
        `  Distinct token hashes: ${thCounts.size.toLocaleString('en')}`,
        `  Known-token sieve (Uint8Array): ${knownTokens.toLocaleString('en')} out of 65,536`,
        `  Filter data (Int32Array): ${filterDataWritePtr.toLocaleString('en')}`,
        `  Filter refs (JS array): ${filterRefsWritePtr.toLocaleString('en')}`,
        '  Origin trie container:',
        origHNTrieContainer.dumpInfo().split('\n').map(a => `    ${a}`).join('\n'),
        '  Request trie container:',
        destHNTrieContainer.dumpInfo().split('\n').map(a => `    ${a}`).join('\n'),
        '  Pattern trie container:',
        bidiTrie.dumpInfo().split('\n').map(a => `    ${a}`).join('\n'),
        '+ Filter class stats:',
        Array.from(fcCounts)
             .sort((a, b) => b[1] - a[1])
             .map(a => `    ${a[0]}: ${a[1].toLocaleString('en')}`)
             .join('\n'),
        '+ Filter tree:',
    ].join('\n'));
    return out.join('\n');
};

/******************************************************************************/

const staticNetFilteringEngine = new FilterContainer();

export default staticNetFilteringEngine;

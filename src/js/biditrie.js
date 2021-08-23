/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2019-present Raymond Hill

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

/* globals WebAssembly, vAPI */

'use strict';

/*******************************************************************************

  A BidiTrieContainer is mostly a large buffer in which distinct but related
  tries are stored. The memory layout of the buffer is as follow:

      0-2047: haystack section
   2048-2051: number of significant characters in the haystack
   2052-2055: offset to start of trie data section (=> trie0)
   2056-2059: offset to end of trie data section (=> trie1)
   2060-2063: offset to start of character data section  (=> char0)
   2064-2067: offset to end of character data section (=> char1)
        2068: start of trie data section

                  +--------------+
  Normal cell:    | And          |  If "Segment info" matches:
  (aka CELL)      +--------------+      Goto "And"
                  | Or           |  Else
                  +--------------+      Goto "Or"
                  | Segment info |
                  +--------------+

                  +--------------+
  Boundary cell:  | Right And    |  "Right And" and/or "Left And"
  (aka BCELL)     +--------------+  can be 0 in last-segment condition.
                  | Left And     |
                  +--------------+
                  | 0            |
                  +--------------+

  Given following filters and assuming token is "ad" for all of them:

    -images/ad-
    /google_ad.
    /images_ad.
    _images/ad.

  We get the following internal representation:

  +-----------+     +-----------+     +---+
  |           |---->|           |---->| 0 |
  +-----------+     +-----------+     +---+     +-----------+
  | 0         |  +--|           |     |   |---->| 0         |
  +-----------+  |  +-----------+     +---+     +-----------+
  | ad        |  |  | -         |     | 0 |     | 0         |
  +-----------+  |  +-----------+     +---+     +-----------+
                 |                              | -images/  |
                 |  +-----------+     +---+     +-----------+
                 +->|           |---->| 0 |
                    +-----------+     +---+     +-----------+     +-----------+
                    | 0         |     |   |---->|           |---->| 0         |
                    +-----------+     +---+     +-----------+     +-----------+
                    | .         |     | 0 |  +--|           |  +--|           |
                    +-----------+     +---+  |  +-----------+  |  +-----------+
                                             |  | _         |  |  | /google   |
                                             |  +-----------+  |  +-----------+
                                             |                 |
                                             |                 |  +-----------+
                                             |                 +->| 0         |
                                             |                    +-----------+
                                             |                    | 0         |
                                             |                    +-----------+
                                             |                    | /images   |
                                             |                    +-----------+
                                             |
                                             |  +-----------+
                                             +->| 0         |
                                                +-----------+
                                                | 0         |
                                                +-----------+
                                                | _images/  |
                                                +-----------+

*/

const PAGE_SIZE = 65536*2;
const HAYSTACK_START = 0;
const HAYSTACK_SIZE = 2048;                         //   i32 /   i8
const HAYSTACK_SIZE_SLOT = HAYSTACK_SIZE >>> 2;     //   512 / 2048
const TRIE0_SLOT     = HAYSTACK_SIZE_SLOT + 1;      //   513 / 2052
const TRIE1_SLOT     = HAYSTACK_SIZE_SLOT + 2;      //   514 / 2056
const CHAR0_SLOT     = HAYSTACK_SIZE_SLOT + 3;      //   515 / 2060
const CHAR1_SLOT     = HAYSTACK_SIZE_SLOT + 4;      //   516 / 2064
const RESULT_L_SLOT  = HAYSTACK_SIZE_SLOT + 5;      //   517 / 2068
const RESULT_R_SLOT  = HAYSTACK_SIZE_SLOT + 6;      //   518 / 2072
const RESULT_IU_SLOT = HAYSTACK_SIZE_SLOT + 7;      //   519 / 2076
const TRIE0_START    = HAYSTACK_SIZE_SLOT + 8 << 2; //         2080

const CELL_BYTE_LENGTH = 12;
const MIN_FREE_CELL_BYTE_LENGTH = CELL_BYTE_LENGTH * 8;

const CELL_AND = 0;
const CELL_OR = 1;
const SEGMENT_INFO = 2;
const BCELL_NEXT_AND = 0;
const BCELL_ALT_AND = 1;
const BCELL_EXTRA = 2;
const BCELL_EXTRA_MAX = 0x00FFFFFF;

const toSegmentInfo = (aL, l, r) => ((r - l) << 24) | (aL + l);
const roundToPageSize = v => (v + PAGE_SIZE-1) & ~(PAGE_SIZE-1);


const BidiTrieContainer = class {

    constructor(extraHandler) {
        const len = PAGE_SIZE * 4;
        this.buf8 = new Uint8Array(len);
        this.buf32 = new Uint32Array(this.buf8.buffer);
        this.buf32[TRIE0_SLOT] = TRIE0_START;
        this.buf32[TRIE1_SLOT] = this.buf32[TRIE0_SLOT];
        this.buf32[CHAR0_SLOT] = len >>> 1;
        this.buf32[CHAR1_SLOT] = this.buf32[CHAR0_SLOT];
        this.haystack = this.buf8.subarray(
            HAYSTACK_START,
            HAYSTACK_START + HAYSTACK_SIZE
        );
        this.extraHandler = extraHandler;
        this.textDecoder = null;
        this.wasmMemory = null;

        this.lastStored = '';
        this.lastStoredLen = this.lastStoredIndex = 0;
    }

    //--------------------------------------------------------------------------
    // Public methods
    //--------------------------------------------------------------------------

    get haystackLen() {
        return this.buf32[HAYSTACK_SIZE_SLOT];
    }

    set haystackLen(v) {
        this.buf32[HAYSTACK_SIZE_SLOT] = v;
    }

    reset(details) {
        if (
            details instanceof Object &&
            typeof details.byteLength === 'number' &&
            typeof details.char0 === 'number'
        ) {
            if ( details.byteLength > this.buf8.byteLength ) {
                this.reallocateBuf(details.byteLength);
            }
            this.buf32[CHAR0_SLOT] = details.char0;
        }
        this.buf32[TRIE1_SLOT] = this.buf32[TRIE0_SLOT];
        this.buf32[CHAR1_SLOT] = this.buf32[CHAR0_SLOT];

        this.lastStored = '';
        this.lastStoredLen = this.lastStoredIndex = 0;
    }

    matches(icell, ai) {
        const buf32 = this.buf32;
        const buf8 = this.buf8;
        const char0 = buf32[CHAR0_SLOT];
        const aR = buf32[HAYSTACK_SIZE_SLOT];
        let al = ai, x = 0, y = 0;
        for (;;) {
            x = buf8[al];
            al += 1;
            // find matching segment
            for (;;) {
                y = buf32[icell+SEGMENT_INFO];
                let bl = char0 + (y & 0x00FFFFFF);
                if ( buf8[bl] === x ) {
                    y = (y >>> 24) - 1;
                    if ( y !== 0 ) {
                        x = al + y;
                        if ( x > aR ) { return 0; }
                        for (;;) {
                            bl += 1;
                            if ( buf8[bl] !== buf8[al] ) { return 0; }
                            al += 1;
                            if ( al === x ) { break; }
                        }
                    }
                    break;
                }
                icell = buf32[icell+CELL_OR];
                if ( icell === 0 ) { return 0; }
            }
            // next segment
            icell = buf32[icell+CELL_AND];
            x = buf32[icell+BCELL_EXTRA];
            if ( x <= BCELL_EXTRA_MAX ) {
                if ( x !== 0 && this.matchesExtra(ai, al, x) !== 0 ) {
                    return 1;
                }
                x = buf32[icell+BCELL_ALT_AND];
                if ( x !== 0 && this.matchesLeft(x, ai, al) !== 0 ) {
                    return 1;
                }
                icell = buf32[icell+BCELL_NEXT_AND];
                if ( icell === 0 ) { return 0; }
            }
            if ( al === aR ) { return 0; }
        }
        return 0; // eslint-disable-line no-unreachable
    }

    matchesLeft(icell, ar, r) {
        const buf32 = this.buf32;
        const buf8 = this.buf8;
        const char0 = buf32[CHAR0_SLOT];
        let x = 0, y = 0;
        for (;;) {
            if ( ar === 0 ) { return 0; }
            ar -= 1;
            x = buf8[ar];
            // find first segment with a first-character match
            for (;;) {
                y = buf32[icell+SEGMENT_INFO];
                let br = char0 + (y & 0x00FFFFFF);
                y = (y >>> 24) - 1;
                br += y;
                if ( buf8[br] === x ) { // all characters in segment must match
                    if ( y !== 0 ) {
                        x = ar - y;
                        if ( x < 0 ) { return 0; }
                        for (;;) {
                            ar -= 1; br -= 1;
                            if ( buf8[ar] !== buf8[br] ) { return 0; }
                            if ( ar === x ) { break; }
                        }
                    }
                    break;
                }
                icell = buf32[icell+CELL_OR];
                if ( icell === 0 ) { return 0; }
            }
            // next segment
            icell = buf32[icell+CELL_AND];
            x = buf32[icell+BCELL_EXTRA];
            if ( x <= BCELL_EXTRA_MAX ) {
                if ( x !== 0 && this.matchesExtra(ar, r, x) !== 0 ) {
                    return 1;
                }
                icell = buf32[icell+BCELL_NEXT_AND];
                if ( icell === 0 ) { return 0; }
            }
        }
        return 0; // eslint-disable-line no-unreachable
    }

    matchesExtra(l, r, ix) {
        let iu = 0;
        if ( ix !== 1 ) {
            iu = this.extraHandler(l, r, ix);
            if ( iu === 0 ) { return 0; }
        } else {
            iu = -1;
        }
        this.buf32[RESULT_IU_SLOT] = iu;
        this.buf32[RESULT_L_SLOT] = l;
        this.buf32[RESULT_R_SLOT] = r;
        return 1;
    }

    createOne(args) {
        if ( Array.isArray(args) ) {
            return new this.STrieRef(this, args[0], args[1]);
        }
        // grow buffer if needed
        if ( (this.buf32[CHAR0_SLOT] - this.buf32[TRIE1_SLOT]) < CELL_BYTE_LENGTH ) {
            this.growBuf(CELL_BYTE_LENGTH, 0);
        }
        const iroot = this.buf32[TRIE1_SLOT] >>> 2;
        this.buf32[TRIE1_SLOT] += CELL_BYTE_LENGTH;
        this.buf32[iroot+CELL_OR] = 0;
        this.buf32[iroot+CELL_AND] = 0;
        this.buf32[iroot+SEGMENT_INFO] = 0;
        return new this.STrieRef(this, iroot, 0);
    }

    compileOne(trieRef) {
        return [ trieRef.iroot, trieRef.size ];
    }

    add(iroot, aL0, n, pivot = 0) {
        const aR = n;
        if ( aR === 0 ) { return 0; }
        // Grow buffer if needed. The characters are already in our character
        // data buffer, so we do not need to grow character data buffer.
        if (
            (this.buf32[CHAR0_SLOT] - this.buf32[TRIE1_SLOT]) <
                MIN_FREE_CELL_BYTE_LENGTH
        ) {
            this.growBuf(MIN_FREE_CELL_BYTE_LENGTH, 0);
        }
        const buf32 = this.buf32;
        const char0 = buf32[CHAR0_SLOT];
        let icell = iroot;
        let aL = char0 + aL0;
        // special case: first node in trie
        if ( buf32[icell+SEGMENT_INFO] === 0 ) {
            buf32[icell+SEGMENT_INFO] = toSegmentInfo(aL0, pivot, aR);
            return this.addLeft(icell, aL0, pivot);
        }
        const buf8 = this.buf8;
        let al = pivot;
        let inext;
        // find a matching cell: move down
        for (;;) {
            const binfo = buf32[icell+SEGMENT_INFO];
            // length of segment
            const bR = binfo >>> 24;
            // skip boundary cells
            if ( bR === 0 ) {
                icell = buf32[icell+BCELL_NEXT_AND];
                continue;
            }
            let bl = char0 + (binfo & 0x00FFFFFF);
            // if first character is no match, move to next descendant
            if ( buf8[bl] !== buf8[aL+al] ) {
                inext = buf32[icell+CELL_OR];
                if ( inext === 0 ) {
                    inext = this.addCell(0, 0, toSegmentInfo(aL0, al, aR));
                    buf32[icell+CELL_OR] = inext;
                    return this.addLeft(inext, aL0, pivot);
                }
                icell = inext;
                continue;
            }
            // 1st character was tested
            let bi = 1;
            al += 1;
            // find 1st mismatch in rest of segment
            if ( bR !== 1 ) {
                for (;;) {
                    if ( bi === bR ) { break; }
                    if ( al === aR ) { break; }
                    if ( buf8[bl+bi] !== buf8[aL+al] ) { break; }
                    bi += 1;
                    al += 1;
                }
            }
            // all segment characters matched
            if ( bi === bR ) {
                // needle remainder: no
                if ( al === aR ) {
                    return this.addLeft(icell, aL0, pivot);
                }
                // needle remainder: yes
                inext = buf32[icell+CELL_AND];
                if ( buf32[inext+CELL_AND] !== 0 ) {
                    icell = inext;
                    continue;
                }
                // add needle remainder
                icell = this.addCell(0, 0, toSegmentInfo(aL0, al, aR));
                buf32[inext+CELL_AND] = icell;
                return this.addLeft(icell, aL0, pivot);
            }
            // some characters matched
            // split current segment
            bl -= char0;
            buf32[icell+SEGMENT_INFO] = bi << 24 | bl;
            inext = this.addCell(
                buf32[icell+CELL_AND], 0, bR - bi << 24 | bl + bi
            );
            buf32[icell+CELL_AND] = inext;
            // needle remainder: no = need boundary cell
            if ( al === aR ) {
                return this.addLeft(icell, aL0, pivot);
            }
            // needle remainder: yes = need new cell for remaining characters
            icell = this.addCell(0, 0, toSegmentInfo(aL0, al, aR));
            buf32[inext+CELL_OR] = icell;
            return this.addLeft(icell, aL0, pivot);
        }
    }

    addLeft(icell, aL0, pivot) {
        const buf32 = this.buf32;
        const char0 = buf32[CHAR0_SLOT];
        let aL = aL0 + char0;
        // fetch boundary cell
        let iboundary = buf32[icell+CELL_AND];
        // add boundary cell if none exist
        if (
            iboundary === 0 ||
            buf32[iboundary+SEGMENT_INFO] > BCELL_EXTRA_MAX
        ) {
            const inext = iboundary;
            iboundary = this.allocateCell();
            buf32[icell+CELL_AND] = iboundary;
            buf32[iboundary+BCELL_NEXT_AND] = inext;
            if ( pivot === 0 ) { return iboundary; }
        }
        // shortest match with no extra conditions will always win
        if ( buf32[iboundary+BCELL_EXTRA] === 1 ) {
            return iboundary;
        }
        // bail out if no left segment
        if ( pivot === 0 ) { return iboundary; }
        // fetch root cell of left segment
        icell = buf32[iboundary+BCELL_ALT_AND];
        if ( icell === 0 ) {
            icell = this.allocateCell();
            buf32[iboundary+BCELL_ALT_AND] = icell;
        }
        // special case: first node in trie
        if ( buf32[icell+SEGMENT_INFO] === 0 ) {
            buf32[icell+SEGMENT_INFO] = toSegmentInfo(aL0, 0, pivot);
            iboundary = this.allocateCell();
            buf32[icell+CELL_AND] = iboundary;
            return iboundary;
        }
        const buf8 = this.buf8;
        let ar = pivot, inext;
        // find a matching cell: move down
        for (;;) {
            const binfo = buf32[icell+SEGMENT_INFO];
            // skip boundary cells
            if ( binfo <= BCELL_EXTRA_MAX ) {
                inext = buf32[icell+CELL_AND];
                if ( inext !== 0 ) {
                    icell = inext;
                    continue;
                }
                iboundary = this.allocateCell();
                buf32[icell+CELL_AND] =
                    this.addCell(iboundary, 0, toSegmentInfo(aL0, 0, ar));
                // TODO: boundary cell might be last
                // add remainder + boundary cell
                return iboundary;
            }
            const bL = char0 + (binfo & 0x00FFFFFF);
            const bR = bL + (binfo >>> 24);
            let br = bR;
            // if first character is no match, move to next descendant
            if ( buf8[br-1] !== buf8[aL+ar-1] ) {
                inext = buf32[icell+CELL_OR];
                if ( inext === 0 ) {
                    iboundary = this.allocateCell();
                    inext = this.addCell(
                        iboundary, 0, toSegmentInfo(aL0, 0, ar)
                    );
                    buf32[icell+CELL_OR] = inext;
                    return iboundary;
                }
                icell = inext;
                continue;
            }
            // 1st character was tested
            br -= 1;
            ar -= 1;
            // find 1st mismatch in rest of segment
            if ( br !== bL ) {
                for (;;) {
                    if ( br === bL ) { break; }
                    if ( ar === 0 ) { break; }
                    if ( buf8[br-1] !== buf8[aL+ar-1] ) { break; }
                    br -= 1;
                    ar -= 1;
                }
            }
            // all segment characters matched
            // a:     ...vvvvvvv
            // b:        vvvvvvv
            if ( br === bL ) {
                inext = buf32[icell+CELL_AND];
                // needle remainder: no
                // a:        vvvvvvv
                // b:        vvvvvvv
                // r: 0 & vvvvvvv
                if ( ar === 0 ) {
                    // boundary cell already present
                    if ( buf32[inext+BCELL_EXTRA] <= BCELL_EXTRA_MAX ) {
                        return inext;
                    }
                    // need boundary cell
                    iboundary = this.allocateCell();
                    buf32[iboundary+CELL_AND] = inext;
                    buf32[icell+CELL_AND] = iboundary;
                    return iboundary;
                }
                // needle remainder: yes
                // a: yyyyyyyvvvvvvv
                // b:        vvvvvvv
                else {
                    if ( inext !== 0 ) {
                        icell = inext;
                        continue;
                    }
                    // TODO: we should never reach here because there will
                    // always be a boundary cell.
                    // eslint-disable-next-line no-debugger
                    debugger; // jshint ignore:line
                    // boundary cell + needle remainder
                    inext = this.addCell(0, 0, 0);
                    buf32[icell+CELL_AND] = inext;
                    buf32[inext+CELL_AND] =
                        this.addCell(0, 0, toSegmentInfo(aL0, 0, ar));
                }
            }
            // some segment characters matched
            // a:     ...vvvvvvv
            // b: yyyyyyyvvvvvvv
            else {
                // split current cell
                buf32[icell+SEGMENT_INFO] = (bR - br) << 24 | (br - char0);
                inext = this.addCell(
                    buf32[icell+CELL_AND],
                    0,
                    (br - bL) << 24 | (bL - char0)
                );
                // needle remainder: no = need boundary cell
                // a:        vvvvvvv
                // b: yyyyyyyvvvvvvv
                // r: yyyyyyy & 0 & vvvvvvv
                if ( ar === 0 ) {
                    iboundary = this.allocateCell();
                    buf32[icell+CELL_AND] = iboundary;
                    buf32[iboundary+CELL_AND] = inext;
                    return iboundary;
                }
                // needle remainder: yes = need new cell for remaining
                // characters
                // a:    wwwwvvvvvvv
                // b: yyyyyyyvvvvvvv
                // r: (0 & wwww | yyyyyyy) & vvvvvvv
                else {
                    buf32[icell+CELL_AND] = inext;
                    iboundary = this.allocateCell();
                    buf32[inext+CELL_OR] = this.addCell(
                        iboundary, 0, toSegmentInfo(aL0, 0, ar)
                    );
                    return iboundary;
                }
            }
            //debugger; // jshint ignore:line
        }
    }

    optimize(shrink = false) {
        if ( shrink ) {
            this.shrinkBuf();
        }
        return {
            byteLength: this.buf8.byteLength,
            char0: this.buf32[CHAR0_SLOT],
        };
    }

    serialize(encoder) {
        if ( encoder instanceof Object ) {
            return encoder.encode(
                this.buf32.buffer,
                this.buf32[CHAR1_SLOT]
            );
        }
        return Array.from(
            new Uint32Array(
                this.buf32.buffer,
                0,
                this.buf32[CHAR1_SLOT] + 3 >>> 2
            )
        );
    }

    unserialize(selfie, decoder) {
        const shouldDecode = typeof selfie === 'string';
        let byteLength = shouldDecode
            ? decoder.decodeSize(selfie)
            : selfie.length << 2;
        if ( byteLength === 0 ) { return false; }
        this.reallocateBuf(byteLength);
        if ( shouldDecode ) {
            decoder.decode(selfie, this.buf8.buffer);
        } else {
            this.buf32.set(selfie);
        }
        return true;
    }

    storeString(s) {
        const n = s.length;
        if ( n === this.lastStoredLen && s === this.lastStored ) {
            return this.lastStoredIndex;
        }
        this.lastStored = s;
        this.lastStoredLen = n;
        if ( (this.buf8.length - this.buf32[CHAR1_SLOT]) < n ) {
            this.growBuf(0, n);
        }
        const offset = this.buf32[CHAR1_SLOT];
        this.buf32[CHAR1_SLOT] = offset + n;
        const buf8 = this.buf8;
        for ( let i = 0; i < n; i++ ) {
            buf8[offset+i] = s.charCodeAt(i);
        }
        return (this.lastStoredIndex = offset - this.buf32[CHAR0_SLOT]);
    }

    extractString(i, n) {
        if ( this.textDecoder === null ) {
            this.textDecoder = new TextDecoder();
        }
        const offset = this.buf32[CHAR0_SLOT] + i;
        return this.textDecoder.decode(
            this.buf8.subarray(offset, offset + n)
        );
    }

    // WASMable.
    startsWith(haystackLeft, haystackRight, needleLeft, needleLen) {
        if ( haystackLeft < 0 || (haystackLeft + needleLen) > haystackRight ) {
            return 0;
        }
        const charCodes = this.buf8;
        needleLeft += this.buf32[CHAR0_SLOT];
        const needleRight = needleLeft + needleLen;
        while ( charCodes[haystackLeft] === charCodes[needleLeft] ) {
            needleLeft += 1;
            if ( needleLeft === needleRight ) { return 1; }
            haystackLeft += 1;
        }
        return 0;
    }

    // Find the left-most instance of substring in main string
    // WASMable.
    indexOf(haystackLeft, haystackEnd, needleLeft, needleLen) {
        if ( needleLen === 0 ) { return haystackLeft; }
        haystackEnd -= needleLen;
        if ( haystackEnd < haystackLeft ) { return -1; }
        needleLeft += this.buf32[CHAR0_SLOT];
        const needleRight = needleLeft + needleLen;
        const charCodes = this.buf8;
        for (;;) {
            let i = haystackLeft;
            let j = needleLeft;
            while ( charCodes[i] === charCodes[j] ) {
                j += 1;
                if ( j === needleRight ) { return haystackLeft; }
                i += 1;
            }
            haystackLeft += 1;
            if ( haystackLeft > haystackEnd ) { break; }
        }
        return -1;
    }

    // Find the right-most instance of substring in main string.
    // WASMable.
    lastIndexOf(haystackBeg, haystackEnd, needleLeft, needleLen) {
        if ( needleLen === 0 ) { return haystackBeg; }
        let haystackLeft = haystackEnd - needleLen;
        if ( haystackLeft < haystackBeg ) { return -1; }
        needleLeft += this.buf32[CHAR0_SLOT];
        const needleRight = needleLeft + needleLen;
        const charCodes = this.buf8;
        for (;;) {
            let i = haystackLeft;
            let j = needleLeft;
            while ( charCodes[i] === charCodes[j] ) {
                j += 1;
                if ( j === needleRight ) { return haystackLeft; }
                i += 1;
            }
            if ( haystackLeft === haystackBeg ) { break; }
            haystackLeft -= 1;
        }
        return -1;
    }

    async enableWASM(wasmModuleFetcher, path) {
        if ( typeof WebAssembly !== 'object' ) { return false; }
        if ( this.wasmMemory instanceof WebAssembly.Memory ) { return true; }
        const module = await getWasmModule(wasmModuleFetcher, path);
        if ( module instanceof WebAssembly.Module === false ) { return false; }
        const memory = new WebAssembly.Memory({
            initial: roundToPageSize(this.buf8.length) >>> 16
        });
        const instance = await WebAssembly.instantiate(module, {
            imports: { memory, extraHandler: this.extraHandler }
        });
        if ( instance instanceof WebAssembly.Instance === false ) {
            return false;
        }
        this.wasmMemory = memory;
        const curPageCount = memory.buffer.byteLength >>> 16;
        const newPageCount = roundToPageSize(this.buf8.byteLength) >>> 16;
        if ( newPageCount > curPageCount ) {
            memory.grow(newPageCount - curPageCount);
        }
        const buf8 = new Uint8Array(memory.buffer);
        buf8.set(this.buf8);
        this.buf8 = buf8;
        this.buf32 = new Uint32Array(this.buf8.buffer);
        this.haystack = this.buf8.subarray(
            HAYSTACK_START,
            HAYSTACK_START + HAYSTACK_SIZE
        );
        this.matches = instance.exports.matches;
        this.startsWith = instance.exports.startsWith;
        this.indexOf = instance.exports.indexOf;
        this.lastIndexOf = instance.exports.lastIndexOf;
        return true;
    }

    //--------------------------------------------------------------------------
    // Private methods
    //--------------------------------------------------------------------------

    allocateCell() {
        let icell = this.buf32[TRIE1_SLOT];
        this.buf32[TRIE1_SLOT] = icell + CELL_BYTE_LENGTH;
        icell >>>= 2;
        this.buf32[icell+0] = 0;
        this.buf32[icell+1] = 0;
        this.buf32[icell+2] = 0;
        return icell;
    }

    addCell(iand, ior, v) {
        const icell = this.allocateCell();
        this.buf32[icell+CELL_AND] = iand;
        this.buf32[icell+CELL_OR] = ior;
        this.buf32[icell+SEGMENT_INFO] = v;
        return icell;
    }

    growBuf(trieGrow, charGrow) {
        const char0 = Math.max(
            roundToPageSize(this.buf32[TRIE1_SLOT] + trieGrow),
            this.buf32[CHAR0_SLOT]
        );
        const char1 = char0 + this.buf32[CHAR1_SLOT] - this.buf32[CHAR0_SLOT];
        const bufLen = Math.max(
            roundToPageSize(char1 + charGrow),
            this.buf8.length
        );
        if ( bufLen > this.buf8.length ) {
            this.reallocateBuf(bufLen);
        }
        if ( char0 !== this.buf32[CHAR0_SLOT] ) {
            this.buf8.copyWithin(
                char0,
                this.buf32[CHAR0_SLOT],
                this.buf32[CHAR1_SLOT]
            );
            this.buf32[CHAR0_SLOT] = char0;
            this.buf32[CHAR1_SLOT] = char1;
        }
    }

    shrinkBuf() {
        const char0 = this.buf32[TRIE1_SLOT] + MIN_FREE_CELL_BYTE_LENGTH;
        const char1 = char0 + this.buf32[CHAR1_SLOT] - this.buf32[CHAR0_SLOT];
        const bufLen = char1 + 256;
        if ( char0 !== this.buf32[CHAR0_SLOT] ) {
            this.buf8.copyWithin(
                char0,
                this.buf32[CHAR0_SLOT],
                this.buf32[CHAR1_SLOT]
            );
            this.buf32[CHAR0_SLOT] = char0;
            this.buf32[CHAR1_SLOT] = char1;
        }
        if ( bufLen < this.buf8.length ) {
            this.reallocateBuf(bufLen);
        }
    }

    reallocateBuf(newSize) {
        newSize = roundToPageSize(newSize);
        if ( newSize === this.buf8.length ) { return; }
        if ( this.wasmMemory === null ) {
            const newBuf = new Uint8Array(newSize);
            newBuf.set(
                newBuf.length < this.buf8.length
                    ? this.buf8.subarray(0, newBuf.length)
                    : this.buf8
            );
            this.buf8 = newBuf;
        } else {
            const growBy =
                ((newSize + 0xFFFF) >>> 16) - (this.buf8.length >>> 16);
            if ( growBy <= 0 ) { return; }
            this.wasmMemory.grow(growBy);
            this.buf8 = new Uint8Array(this.wasmMemory.buffer);
        }
        this.buf32 = new Uint32Array(this.buf8.buffer);
        this.haystack = this.buf8.subarray(
            HAYSTACK_START,
            HAYSTACK_START + HAYSTACK_SIZE
        );
    }
};

/*******************************************************************************

    Class to hold reference to a specific trie

*/

BidiTrieContainer.prototype.STrieRef = class {
    constructor(container, iroot, size) {
        this.container = container;
        this.iroot = iroot;
        this.size = size;
    }

    add(i, n, pivot = 0) {
        const iboundary = this.container.add(this.iroot, i, n, pivot);
        if ( iboundary !== 0 ) {
            this.size += 1;
        }
        return iboundary;
    }

    getExtra(iboundary) {
        return this.container.buf32[iboundary+BCELL_EXTRA];
    }

    setExtra(iboundary, v) {
        this.container.buf32[iboundary+BCELL_EXTRA] = v;
    }

    matches(i) {
        return this.container.matches(this.iroot, i);
    }

    dump() {
        for ( const s of this ) {
            console.log(s);
        }
    }

    get $l() { return this.container.buf32[RESULT_L_SLOT] | 0; }
    get $r() { return this.container.buf32[RESULT_R_SLOT] | 0; }
    get $iu() { return this.container.buf32[RESULT_IU_SLOT] | 0; }

    [Symbol.iterator]() {
        return {
            value: undefined,
            done: false,
            next: function() {
                if ( this.icell === 0 ) {
                    if ( this.forks.length === 0 ) {
                        this.value = undefined;
                        this.done = true;
                        return this;
                    }
                    this.charPtr = this.forks.pop();
                    this.icell = this.forks.pop();
                }
                for (;;) {
                    const idown = this.container.buf32[this.icell+CELL_OR];
                    if ( idown !== 0 ) {
                        this.forks.push(idown, this.charPtr);
                    }
                    const v = this.container.buf32[this.icell+SEGMENT_INFO];
                    let i0 = this.container.buf32[CHAR0_SLOT] + (v & 0x00FFFFFF);
                    const i1 = i0 + (v >>> 24);
                    while ( i0 < i1 ) {
                        this.charBuf[this.charPtr] = this.container.buf8[i0];
                        this.charPtr += 1;
                        i0 += 1;
                    }
                    this.icell = this.container.buf32[this.icell+CELL_AND];
                    if ( this.icell === 0 ) {
                        return this.toPattern();
                    }
                    if ( this.container.buf32[this.icell+SEGMENT_INFO] === 0 ) {
                        this.icell = this.container.buf32[this.icell+CELL_AND];
                        return this.toPattern();
                    }
                }
            },
            toPattern: function() {
                this.value = this.textDecoder.decode(
                    new Uint8Array(this.charBuf.buffer, 0, this.charPtr)
                );
                return this;
            },
            container: this.container,
            icell: this.iroot,
            charBuf: new Uint8Array(256),
            charPtr: 0,
            forks: [],
            textDecoder: new TextDecoder()
        };
    }
};

/******************************************************************************/

// Code below is to attempt to load a WASM module which implements:
//
// - BidiTrieContainer.startsWith()
//
// The WASM module is entirely optional, the JS implementations will be
// used should the WASM module be unavailable for whatever reason.

const getWasmModule = (( ) => {
    let wasmModulePromise;

    return async function(wasmModuleFetcher, path) {
        if ( wasmModulePromise instanceof Promise ) {
            return wasmModulePromise;
        }

        if ( typeof WebAssembly !== 'object' ) { return; }

        // Soft-dependency on vAPI so that the code here can be used outside of
        // uBO (i.e. tests, benchmarks)
        if ( typeof vAPI === 'object' && vAPI.canWASM !== true ) { return; }

        // The wasm module will work only if CPU is natively little-endian,
        // as we use native uint32 array in our js code.
        const uint32s = new Uint32Array(1);
        const uint8s = new Uint8Array(uint32s.buffer);
        uint32s[0] = 1;
        if ( uint8s[0] !== 1 ) { return; }

        wasmModulePromise = wasmModuleFetcher(`${path}biditrie`).catch(reason => {
            console.info(reason);
        });

        return wasmModulePromise;
    };
})();

/******************************************************************************/

export { BidiTrieContainer };

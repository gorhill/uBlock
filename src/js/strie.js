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

'use strict';

// *****************************************************************************
// start of local namespace

{

/*******************************************************************************

  A BidiTrieContainer is mostly a large buffer in which distinct but related
  tries are stored. The memory layout of the buffer is as follow:

    0-255: reserved
  256-259: offset to start of trie data section (=> trie0)
  260-263: offset to end of trie data section (=> trie1)
  264-267: offset to start of character data section  (=> char0)
  268-271: offset to end of character data section (=> char1)
      272: start of trie data section

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

const PAGE_SIZE   = 65536;
                                            // i32 /  i8
const TRIE0_SLOT  = 256 >>> 2;              //  64 / 256
const TRIE1_SLOT  = TRIE0_SLOT + 1;         //  65 / 260
const CHAR0_SLOT  = TRIE0_SLOT + 2;         //  66 / 264
const CHAR1_SLOT  = TRIE0_SLOT + 3;         //  67 / 268
const TRIE0_START = TRIE0_SLOT + 4 << 2;    //       272

const CELL_BYTE_LENGTH = 12;
const MIN_FREE_CELL_BYTE_LENGTH = CELL_BYTE_LENGTH * 4;

const CELL_AND = 0;
const CELL_OR = 1;
const BCELL_RIGHT_AND = 0;
const BCELL_LEFT_AND = 1;
const SEGMENT_INFO = 2;


µBlock.BidiTrieContainer = class {

    constructor(details) {
        if ( details instanceof Object === false ) { details = {}; }
        const len = (details.byteLength || 0) + PAGE_SIZE-1 & ~(PAGE_SIZE-1);
        this.buf = new Uint8Array(Math.max(len, 131072));
        this.buf32 = new Uint32Array(this.buf.buffer);
        this.buf32[TRIE0_SLOT] = TRIE0_START;
        this.buf32[TRIE1_SLOT] = this.buf32[TRIE0_SLOT];
        this.buf32[CHAR0_SLOT] = details.char0 || 65536;
        this.buf32[CHAR1_SLOT] = this.buf32[CHAR0_SLOT];
    }

    //--------------------------------------------------------------------------
    // Public methods
    //--------------------------------------------------------------------------

    reset() {
        this.buf32[TRIE1_SLOT] = this.buf32[TRIE0_SLOT];
        this.buf32[CHAR1_SLOT] = this.buf32[CHAR0_SLOT];
    }

    matches(iroot, a, i) {
        const buf32 = this.buf32;
        const buf8 = this.buf;
        const char0 = buf32[CHAR0_SLOT];
        const aR = a.length;
        let icell = iroot;
        let al = i;
        let c, v, bl, n;
        for (;;) {
            c = a.charCodeAt(al);
            al += 1;
            // find first segment with a first-character match
            for (;;) {
                v = buf32[icell+SEGMENT_INFO];
                bl = char0 + (v & 0x00FFFFFF);
                if ( buf8[bl] === c ) { break; }
                icell = buf32[icell+CELL_OR];
                if ( icell === 0 ) { return -1; }
            }
            // all characters in segment must match
            n = v >>> 24;
            if ( n > 1 ) {
                n -= 1;
                if ( (al + n) > aR ) { return -1; }
                bl += 1;
                for ( let i = 0; i < n; i++ ) {
                    if ( a.charCodeAt(al+i) !== buf8[bl+i] ) { return -1; }
                }
                al += n;
            }
            // next segment
            icell = buf32[icell+CELL_AND];
            if ( /* icell === 0 || */ buf32[icell+SEGMENT_INFO] === 0 ) {
                const inext = buf32[icell+BCELL_LEFT_AND];
                if ( inext === 0 ) { return (i << 16) | al; }
                const r = this.matchesLeft(inext, a, i);
                if ( r !== -1 ) { return (r << 16) | al; }
                icell = buf32[icell+CELL_AND];
                if ( icell === 0 ) { return -1; }
            }
            if ( al === aR ) { return -1; }
        }
    }

    matchesLeft(iroot, a, i) {
        const buf32 = this.buf32;
        const buf8 = this.buf;
        const char0 = buf32[CHAR0_SLOT];
        let icell = iroot;
        let ar = i;
        let c, v, br, n;
        for (;;) {
            ar -= 1;
            c = a.charCodeAt(ar);
            // find first segment with a first-character match
            for (;;) {
                v = buf32[icell+SEGMENT_INFO];
                n = v >>> 24;
                br = char0 + (v & 0x00FFFFFF) + n - 1;
                if ( buf8[br] === c ) { break; }
                icell = buf32[icell+CELL_OR];
                if ( icell === 0 ) { return -1; }
            }
            // all characters in segment must match
            if ( n > 1 ) {
                n -= 1;
                if ( n > ar ) { return -1; }
                for ( let i = 1; i <= n; i++ ) {
                    if ( a.charCodeAt(ar-i) !== buf8[br-i] ) { return -1; }
                }
                ar -= n;
            }
            // next segment
            icell = buf32[icell+CELL_AND];
            if ( icell === 0 || buf32[icell+SEGMENT_INFO] === 0 ) { return ar; }
            if ( ar === 0 ) { return -1; }
        }
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

    add(iroot, a, i = 0) {
        const aR = a.length;
        if ( aR === 0 ) { return 0; }
        // grow buffer if needed
        if (
            (this.buf32[CHAR0_SLOT] - this.buf32[TRIE1_SLOT]) < MIN_FREE_CELL_BYTE_LENGTH ||
            (this.buf.length - this.buf32[CHAR1_SLOT]) < 256
        ) {
            this.growBuf(MIN_FREE_CELL_BYTE_LENGTH, 256);
        }
        const buf32 = this.buf32;
        let icell = iroot;
        // special case: first node in trie
        if ( buf32[icell+SEGMENT_INFO] === 0 ) {
            buf32[icell+SEGMENT_INFO] = this.addSegment(a, i, aR);
            return this.addLeft(icell, a, i);
        }
        const buf8 = this.buf;
        const char0 = buf32[CHAR0_SLOT];
        let al = i;
        let inext;
        // find a matching cell: move down
        for (;;) {
            const binfo = buf32[icell+SEGMENT_INFO];
            // skip boundary cells
            if ( binfo === 0 ) {
                icell = buf32[icell+BCELL_RIGHT_AND];
                continue;
            }
            let bl = char0 + (binfo & 0x00FFFFFF);
            // if first character is no match, move to next descendant
            if ( buf8[bl] !== a.charCodeAt(al) ) {
                inext = buf32[icell+CELL_OR];
                if ( inext === 0 ) {
                    inext = this.addCell(0, 0, this.addSegment(a, al, aR));
                    buf32[icell+CELL_OR] = inext;
                    return this.addLeft(inext, a, i);
                }
                icell = inext;
                continue;
            }
            // 1st character was tested
            let bi = 1;
            al += 1;
            // find 1st mismatch in rest of segment
            const bR = binfo >>> 24;
            if ( bR !== 1 ) {
                for (;;) {
                    if ( bi === bR ) { break; }
                    if ( al === aR ) { break; }
                    if ( buf8[bl+bi] !== a.charCodeAt(al) ) { break; }
                    bi += 1;
                    al += 1;
                }
            }
            // all segment characters matched
            if ( bi === bR ) {
                // needle remainder: no
                if ( al === aR ) {
                    return this.addLeft(icell, a, i);
                }
                // needle remainder: yes
                inext = buf32[icell+CELL_AND];
                if ( buf32[inext+CELL_AND] !== 0 ) {
                    icell = inext;
                    continue;
                }
                // add needle remainder
                icell = this.addCell(0, 0, this.addSegment(a, al, aR));
                buf32[inext+CELL_AND] = icell;
                return this.addLeft(icell, a, i);
            }
            // some characters matched
            // split current segment
            bl -= char0;
            buf32[icell+SEGMENT_INFO] = bi << 24 | bl;
            inext = this.addCell(
                buf32[icell+CELL_AND],
                0,
                bR - bi << 24 | bl + bi
            );
            buf32[icell+CELL_AND] = inext;
            // needle remainder: no = need boundary cell
            if ( al === aR ) {
                return this.addLeft(icell, a, i);
            }
            // needle remainder: yes = need new cell for remaining characters
            icell = this.addCell(0, 0, this.addSegment(a, al, aR));
            buf32[inext+CELL_OR] = icell;
            return this.addLeft(icell, a, i);
        }
    }

    addLeft(icell, a, i) {
        const buf32 = this.buf32;
        // fetch boundary cell
        let inext = buf32[icell+CELL_AND];
        // add boundary cell if none exist
        if ( inext === 0 || buf32[inext+SEGMENT_INFO] !== 0 ) {
            const iboundary = this.allocateCell();
            buf32[icell+CELL_AND] = iboundary;
            buf32[iboundary+BCELL_RIGHT_AND] = inext;
            if ( i === 0 ) { return 1; }
            buf32[iboundary+BCELL_LEFT_AND] = this.allocateCell();
            inext = iboundary;
        }
        // shortest match is always first so no point storing whatever is left
        if ( buf32[inext+BCELL_LEFT_AND] === 0 ) {
            return i === 0 ? 0 : 1;
        }
        // bail out if no left segment
        if ( i === 0 ) {
            buf32[inext+BCELL_LEFT_AND] = 0;
            return 1;
        }
        // fetch root cell of left segment
        icell = buf32[inext+BCELL_LEFT_AND];
        // special case: first node in trie
        if ( buf32[icell+SEGMENT_INFO] === 0 ) {
            buf32[icell+SEGMENT_INFO] = this.addSegment(a, 0, i);
            return 1;
        }
        const buf8 = this.buf;
        const char0 = buf32[CHAR0_SLOT];
        let ar = i;
        // find a matching cell: move down
        for (;;) {
            const binfo = buf32[icell+SEGMENT_INFO];
            // skip boundary cells
            if ( binfo === 0 ) {
                icell = buf32[icell+CELL_AND];
                continue;
            }
            const bL = char0 + (binfo & 0x00FFFFFF);
            const bR = bL + (binfo >>> 24);
            let br = bR;
            // if first character is no match, move to next descendant
            if ( buf8[br-1] !== a.charCodeAt(ar-1) ) {
                inext = buf32[icell+CELL_OR];
                if ( inext === 0 ) {
                    inext = this.addCell(0, 0, this.addSegment(a, 0, ar));
                    buf32[icell+CELL_OR] = inext;
                    return 1;
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
                    if ( buf8[br-1] !== a.charCodeAt(ar-1) ) { break; }
                    br -= 1;
                    ar -= 1;
                }
            }
            // all segment characters matched
            if ( br === bL ) {
                inext = buf32[icell+CELL_AND];
                // needle remainder: no
                if ( ar === 0 ) {
                    // boundary cell already present
                    if ( inext === 0 || buf32[inext+SEGMENT_INFO] === 0 ) {
                        return 0;
                    }
                    // need boundary cell
                    buf32[icell+CELL_AND] = this.addCell(inext, 0, 0);
                }
                // needle remainder: yes
                else {
                    if ( inext !== 0 ) {
                        icell = inext;
                        continue;
                    }
                    // boundary cell + needle remainder
                    inext = this.addCell(0, 0, 0);
                    buf32[icell+CELL_AND] = inext;
                    buf32[inext+CELL_AND] =
                        this.addCell(0, 0, this.addSegment(a, 0, ar));
                }
            }
            // some segment characters matched
            else {
                // split current cell
                buf32[icell+SEGMENT_INFO] = (bR - br) << 24 | (br - char0);
                inext = this.addCell(
                    buf32[icell+CELL_AND],
                    0,
                    (br - bL) << 24 | (bL - char0)
                );
                buf32[icell+CELL_AND] = inext;
                // needle remainder: no = need boundary cell
                if ( ar === 0 ) {
                    buf32[icell+CELL_AND] = this.addCell(inext, 0, 0);
                }
                // needle remainder: yes = need new cell for remaining characters
                else {
                    buf32[inext+CELL_OR] =
                        this.addCell(0, 0, this.addSegment(a, 0, ar));
                }
            }
            return 1;
        }
    }

    optimize() {
        this.shrinkBuf();
        return {
            byteLength: this.buf.byteLength,
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
        byteLength = byteLength + PAGE_SIZE-1 & ~(PAGE_SIZE-1);
        if ( byteLength > this.buf.length ) {
            this.buf = new Uint8Array(byteLength);
            this.buf32 = new Uint32Array(this.buf.buffer);
        }
        if ( shouldDecode ) {
            decoder.decode(selfie, this.buf.buffer);
        } else {
            this.buf32.set(selfie);
        }
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

    addSegment(s, l, r) {
        const n = r - l;
        if ( n === 0 ) { return 0; }
        const buf32 = this.buf32;
        const des = buf32[CHAR1_SLOT];
        buf32[CHAR1_SLOT] = des + n;
        const buf8 = this.buf;
        for ( let i = 0; i < n; i++ ) {
            buf8[des+i] = s.charCodeAt(l+i);
        }
        return (n << 24) | (des - buf32[CHAR0_SLOT]);
    }

    growBuf(trieGrow, charGrow) {
        const char0 = Math.max(
            (this.buf32[TRIE1_SLOT] + trieGrow + PAGE_SIZE-1) & ~(PAGE_SIZE-1),
            this.buf32[CHAR0_SLOT]
        );
        const char1 = char0 + this.buf32[CHAR1_SLOT] - this.buf32[CHAR0_SLOT];
        const bufLen = Math.max(
            (char1 + charGrow + PAGE_SIZE-1) & ~(PAGE_SIZE-1),
            this.buf.length
        );
        this.resizeBuf(bufLen, char0);
    }

    shrinkBuf() {
        const char0 = this.buf32[TRIE1_SLOT] + MIN_FREE_CELL_BYTE_LENGTH;
        const char1 = char0 + this.buf32[CHAR1_SLOT] - this.buf32[CHAR0_SLOT];
        const bufLen = char1 + 256;
        this.resizeBuf(bufLen, char0);
    }

    resizeBuf(bufLen, char0) {
        bufLen = bufLen + PAGE_SIZE-1 & ~(PAGE_SIZE-1);
        if (
            bufLen === this.buf.length &&
            char0 === this.buf32[CHAR0_SLOT]
        ) {
            return;
        }
        const charDataLen = this.buf32[CHAR1_SLOT] - this.buf32[CHAR0_SLOT];
        if ( bufLen !== this.buf.length ) {
            const newBuf = new Uint8Array(bufLen);
            newBuf.set(
                new Uint8Array(
                    this.buf.buffer,
                    0,
                    this.buf32[TRIE1_SLOT]
                ),
                0
            );
            newBuf.set(
                new Uint8Array(
                    this.buf.buffer,
                    this.buf32[CHAR0_SLOT],
                    charDataLen
                ),
                char0
            );
            this.buf = newBuf;
            this.buf32 = new Uint32Array(this.buf.buffer);
            this.buf32[CHAR0_SLOT] = char0;
            this.buf32[CHAR1_SLOT] = char0 + charDataLen;
        }
        if ( char0 !== this.buf32[CHAR0_SLOT] ) {
            this.buf.set(
                new Uint8Array(
                    this.buf.buffer,
                    this.buf32[CHAR0_SLOT],
                    charDataLen
                ),
                char0
            );
            this.buf32[CHAR0_SLOT] = char0;
            this.buf32[CHAR1_SLOT] = char0 + charDataLen;
        }
    }
};

/*******************************************************************************

    Class to hold reference to a specific trie

*/

µBlock.BidiTrieContainer.prototype.STrieRef = class {
    constructor(container, iroot, size) {
        this.container = container;
        this.iroot = iroot;
        this.size = size;
    }

    add(s, i = 0) {
        if ( this.container.add(this.iroot, s, i) === 1 ) {
            this.size += 1;
            return true;
        }
        return false;
    }

    matches(a, i) {
        return this.container.matches(this.iroot, a, i);
    }

    dump() {
        for ( const s of this ) {
            console.log(s);
        }
    }

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
                        this.charBuf[this.charPtr] = this.container.buf[i0];
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

// end of local namespace
// *****************************************************************************

}

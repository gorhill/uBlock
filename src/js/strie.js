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

/* exported STrieContainer */

'use strict';

/*******************************************************************************

  A STrieContainer is mostly a large buffer in which distinct but related
  tries are stored. The memory layout of the buffer is as follow:

    0-255: reserved
  256-259: offset to start of trie data section (=> trie0)
  260-263: offset to end of trie data section (=> trie1)
  264-267: offset to start of character data section  (=> char0)
  268-271: offset to end of character data section (=> char1)
      272: start of trie data section

*/

const STRIE_PAGE_SIZE   = 65536;
                                                        // i32 /  i8
const STRIE_TRIE0_SLOT  = 256 >>> 2;                    //  64 / 256
const STRIE_TRIE1_SLOT  = STRIE_TRIE0_SLOT + 1;         //  65 / 260
const STRIE_CHAR0_SLOT  = STRIE_TRIE0_SLOT + 2;         //  66 / 264
const STRIE_CHAR1_SLOT  = STRIE_TRIE0_SLOT + 3;         //  67 / 268
const STRIE_TRIE0_START = STRIE_TRIE0_SLOT + 4 << 2;    //       272


const STrieContainer = class {

    constructor(details) {
        if ( details instanceof Object === false ) { details = {}; }
        const len = (details.byteLength || 0) + STRIE_PAGE_SIZE-1 & ~(STRIE_PAGE_SIZE-1);
        this.buf = new Uint8Array(Math.max(len, 131072));
        this.buf32 = new Uint32Array(this.buf.buffer);
        this.buf32[STRIE_TRIE0_SLOT] = STRIE_TRIE0_START;
        this.buf32[STRIE_TRIE1_SLOT] = this.buf32[STRIE_TRIE0_SLOT];
        this.buf32[STRIE_CHAR0_SLOT] = details.char0 || 65536;
        this.buf32[STRIE_CHAR1_SLOT] = this.buf32[STRIE_CHAR0_SLOT];
    }

    //--------------------------------------------------------------------------
    // Public methods
    //--------------------------------------------------------------------------

    reset() {
        this.buf32[STRIE_TRIE1_SLOT] = this.buf32[STRIE_TRIE0_SLOT];
        this.buf32[STRIE_CHAR1_SLOT] = this.buf32[STRIE_CHAR0_SLOT];
    }

    matches(iroot, a, al) {
        const ar = a.length;
        const char0 = this.buf32[STRIE_CHAR0_SLOT];
        let icell = iroot;
        for (;;) {
            let c = a.charCodeAt(al);
            al += 1;
            let v, bl;
            // find first segment with a first-character match
            for (;;) {
                v = this.buf32[icell+2];
                bl = char0 + (v & 0x00FFFFFF);
                if ( this.buf[bl] === c ) { break; }
                icell = this.buf32[icell+0];
                if ( icell === 0 ) { return -1; }
            }
            // all characters in segment must match
            let n = v >>> 24;
            if ( n > 1 ) {
                n -= 1;
                if ( (al + n) > ar ) { return -1; }
                bl += 1;
                const br = bl + n;
                do {
                    if ( a.charCodeAt(al) !== this.buf[bl] ) { return -1; }
                    al += 1;
                    bl += 1;
                } while ( bl < br );
            }
            // next segment
            icell = this.buf32[icell+1];
            if ( icell === 0 || this.buf32[icell+2] === 0 ) { return al; }
            if ( al === ar ) { return -1; }
        }
    }

    createOne(args) {
        if ( Array.isArray(args) ) {
            return new this.STrieRef(this, args[0], args[1]);
        }
        // grow buffer if needed
        if ( (this.buf32[STRIE_CHAR0_SLOT] - this.buf32[STRIE_TRIE1_SLOT]) < 12 ) {
            this.growBuf(12, 0);
        }
        const iroot = this.buf32[STRIE_TRIE1_SLOT] >>> 2;
        this.buf32[STRIE_TRIE1_SLOT] += 12;
        this.buf32[iroot+0] = 0;
        this.buf32[iroot+1] = 0;
        this.buf32[iroot+2] = 0;
        return new this.STrieRef(this, iroot, 0);
    }

    compileOne(trieRef) {
        return [ trieRef.iroot, trieRef.size ];
    }

    add(iroot, s) {
        const lschar = s.length;
        if ( lschar === 0 ) { return 0; }
        let ischar = 0;
        let icell = iroot;
        // special case: first node in trie
        if ( this.buf32[icell+2] === 0 ) {
            this.buf32[icell+2] = this.addSegment(s.slice(ischar));
            return 1;
        }
        // grow buffer if needed
        if (
            (this.buf32[STRIE_CHAR0_SLOT] - this.buf32[STRIE_TRIE1_SLOT]) < 24 ||
            (this.buf.length - this.buf32[STRIE_CHAR1_SLOT]) < 256
        ) {
            this.growBuf(24, 256);
        }
        //
        const char0 = this.buf32[STRIE_CHAR0_SLOT];
        let inext;
        // find a matching cell: move down
        for (;;) {
            const vseg = this.buf32[icell+2];
            // skip boundary cells
            if ( vseg === 0 ) {
                icell = this.buf32[icell+1];
                continue;
            }
            let isegchar0 = char0 + (vseg & 0x00FFFFFF);
            // if first character is no match, move to next descendant
            if ( this.buf[isegchar0] !== s.charCodeAt(ischar) ) {
                inext = this.buf32[icell+0];
                if ( inext === 0 ) {
                    this.buf32[icell+0] = this.addCell(0, 0, this.addSegment(s.slice(ischar)));
                    return 1;
                }
                icell = inext;
                continue;
            }
            // 1st character was tested
            let isegchar = 1;
            ischar += 1;
            // find 1st mismatch in rest of segment
            const lsegchar = vseg >>> 24;
            if ( lsegchar !== 1 ) {
                for (;;) {
                    if ( isegchar === lsegchar ) { break; }
                    if ( ischar === lschar ) { break; }
                    if ( this.buf[isegchar0+isegchar] !== s.charCodeAt(ischar) ) { break; }
                    isegchar += 1;
                    ischar += 1;
                }
            }
            // all segment characters matched
            if ( isegchar === lsegchar ) {
                inext = this.buf32[icell+1];
                // needle remainder: no
                if ( ischar === lschar ) {
                    // boundary cell already present
                    if ( inext === 0 || this.buf32[inext+2] === 0 ) { return 0; }
                    // need boundary cell
                    this.buf32[icell+1] = this.addCell(0, inext, 0);
                }
                // needle remainder: yes
                else {
                    if ( inext !== 0 ) {
                        icell = inext;
                        continue;
                    }
                    // boundary cell + needle remainder
                    inext = this.addCell(0, 0, 0);
                    this.buf32[icell+1] = inext;
                    this.buf32[inext+1] = this.addCell(0, 0, this.addSegment(s.slice(ischar)));
                }
            }
            // some segment characters matched
            else {
                // split current cell
                isegchar0 -= char0;
                this.buf32[icell+2] = isegchar << 24 | isegchar0;
                inext = this.addCell(
                    0,
                    this.buf32[icell+1],
                    lsegchar - isegchar << 24 | isegchar0 + isegchar
                );
                this.buf32[icell+1] = inext;
                // needle remainder: no = need boundary cell
                if ( ischar === lschar ) {
                    this.buf32[icell+1] = this.addCell(0, inext, 0);
                }
                // needle remainder: yes = need new cell for remaining characters
                else {
                    this.buf32[inext+0] = this.addCell(0, 0, this.addSegment(s.slice(ischar)));
                }
            }
            return 1;
        }
    }

    optimize() {
        this.shrinkBuf();
        return {
            byteLength: this.buf.byteLength,
            char0: this.buf32[STRIE_CHAR0_SLOT],
        };
    }

    serialize(encoder) {
        if ( encoder instanceof Object ) {
            return encoder.encode(
                this.buf32.buffer,
                this.buf32[STRIE_CHAR1_SLOT]
            );
        }
        return Array.from(
            new Uint32Array(
                this.buf32.buffer,
                0,
                this.buf32[STRIE_CHAR1_SLOT] + 3 >>> 2
            )
        );
    }

    unserialize(selfie, decoder) {
        const shouldDecode = typeof selfie === 'string';
        let byteLength = shouldDecode
            ? decoder.decodeSize(selfie)
            : selfie.length << 2;
        if ( byteLength === 0 ) { return false; }
        byteLength = byteLength + STRIE_PAGE_SIZE-1 & ~(STRIE_PAGE_SIZE-1);
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

    addCell(idown, iright, v) {
        let icell = this.buf32[STRIE_TRIE1_SLOT];
        this.buf32[STRIE_TRIE1_SLOT] = icell + 12;
        icell >>>= 2;
        this.buf32[icell+0] = idown;
        this.buf32[icell+1] = iright;
        this.buf32[icell+2] = v;
        return icell;
    }

    addSegment(segment) {
        const lsegchar = segment.length;
        if ( lsegchar === 0 ) { return 0; }
        let char1 = this.buf32[STRIE_CHAR1_SLOT];
        const isegchar = char1 - this.buf32[STRIE_CHAR0_SLOT];
        let i = 0;
        do {
            this.buf[char1++] = segment.charCodeAt(i++);
        } while ( i !== lsegchar );
        this.buf32[STRIE_CHAR1_SLOT] = char1;
        return (lsegchar << 24) | isegchar;
    }

    growBuf(trieGrow, charGrow) {
        const char0 = Math.max(
            (this.buf32[STRIE_TRIE1_SLOT] + trieGrow + STRIE_PAGE_SIZE-1) & ~(STRIE_PAGE_SIZE-1),
            this.buf32[STRIE_CHAR0_SLOT]
        );
        const char1 = char0 + this.buf32[STRIE_CHAR1_SLOT] - this.buf32[STRIE_CHAR0_SLOT];
        const bufLen = Math.max(
            (char1 + charGrow + STRIE_PAGE_SIZE-1) & ~(STRIE_PAGE_SIZE-1),
            this.buf.length
        );
        this.resizeBuf(bufLen, char0);
    }

    shrinkBuf() {
        const char0 = this.buf32[STRIE_TRIE1_SLOT] + 24;
        const char1 = char0 + this.buf32[STRIE_CHAR1_SLOT] - this.buf32[STRIE_CHAR0_SLOT];
        const bufLen = char1 + 256;
        this.resizeBuf(bufLen, char0);
    }

    resizeBuf(bufLen, char0) {
        bufLen = bufLen + STRIE_PAGE_SIZE-1 & ~(STRIE_PAGE_SIZE-1);
        if (
            bufLen === this.buf.length &&
            char0 === this.buf32[STRIE_CHAR0_SLOT]
        ) {
            return;
        }
        const charDataLen = this.buf32[STRIE_CHAR1_SLOT] - this.buf32[STRIE_CHAR0_SLOT];
        if ( bufLen !== this.buf.length ) {
            const newBuf = new Uint8Array(bufLen);
            newBuf.set(
                new Uint8Array(
                    this.buf.buffer,
                    0,
                    this.buf32[STRIE_TRIE1_SLOT]
                ),
                0
            );
            newBuf.set(
                new Uint8Array(
                    this.buf.buffer,
                    this.buf32[STRIE_CHAR0_SLOT],
                    charDataLen
                ),
                char0
            );
            this.buf = newBuf;
            this.buf32 = new Uint32Array(this.buf.buffer);
            this.buf32[STRIE_CHAR0_SLOT] = char0;
            this.buf32[STRIE_CHAR1_SLOT] = char0 + charDataLen;
        }
        if ( char0 !== this.buf32[STRIE_CHAR0_SLOT] ) {
            this.buf.set(
                new Uint8Array(
                    this.buf.buffer,
                    this.buf32[STRIE_CHAR0_SLOT],
                    charDataLen
                ),
                char0
            );
            this.buf32[STRIE_CHAR0_SLOT] = char0;
            this.buf32[STRIE_CHAR1_SLOT] = char0 + charDataLen;
        }
    }
};

/*******************************************************************************

    Class to hold reference to a specific trie

*/

STrieContainer.prototype.STrieRef = class {
    constructor(container, iroot, size) {
        this.container = container;
        this.iroot = iroot;
        this.size = size;
    }

    add(pattern) {
        if ( this.container.add(this.iroot, pattern) === 1 ) {
            this.size += 1;
            return true;
        }
        return false;
    }

    matches(a, al) {
        return this.container.matches(this.iroot, a, al);
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
                    const idown = this.container.buf32[this.icell+0];
                    if ( idown !== 0 ) {
                        this.forks.push(idown, this.charPtr);
                    }
                    const v = this.container.buf32[this.icell+2];
                    let i0 = this.container.buf32[STRIE_CHAR0_SLOT] + (v & 0x00FFFFFF);
                    const i1 = i0 + (v >>> 24);
                    while ( i0 < i1 ) {
                        this.charBuf[this.charPtr] = this.container.buf[i0];
                        this.charPtr += 1;
                        i0 += 1;
                    }
                    this.icell = this.container.buf32[this.icell+1];
                    if ( this.icell === 0 ) {
                        return this.toPattern();
                    }
                    if ( this.container.buf32[this.icell+2] === 0 ) {
                        this.icell = this.container.buf32[this.icell+1];
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

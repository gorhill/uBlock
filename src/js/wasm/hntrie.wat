;;
;; uBlock Origin - a browser extension to block requests.
;; Copyright (C) 2018-present Raymond Hill
;;
;; This program is free software: you can redistribute it and/or modify
;; it under the terms of the GNU General Public License as published by
;; the Free Software Foundation, either version 3 of the License, or
;; (at your option) any later version.
;;
;; This program is distributed in the hope that it will be useful,
;; but WITHOUT ANY WARRANTY; without even the implied warranty of
;; MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
;; GNU General Public License for more details.
;;
;; You should have received a copy of the GNU General Public License
;; along with this program.  If not, see {http://www.gnu.org/licenses/}.
;;
;; Home: https://github.com/gorhill/uBlock
;; File: hntrie.wat
;; Description: WebAssembly code used by src/js/hntrie.js
;; How to compile: See README.md in this directory.

(module
;;
;; module start
;;

(func $growBuf (import "imports" "growBuf"))
(memory (import "imports" "memory") 1)

;; Trie container
;;
;; Memory layout, byte offset:
;;    0-254: needle being processed
;;      255: length of needle
;;  256-259: offset to start of trie data section (=> trie0)
;;  260-263: offset to end of trie data section (=> trie1)
;;  264-267: offset to start of character data section  (=> char0)
;;  268-271: offset to end of character data section (=> char1)
;;      272: start of trie data section
;;

;;
;; Public functions
;;

;;
;; unsigned int matches(icell)
;;
;; Test whether the currently set needle matches the trie at specified trie
;; offset.
;;
(func (export "matches")
    (param $iroot i32)          ;; offset to root cell of the trie
    (result i32)                ;; result = match index, -1 = miss
    (local $icell i32)          ;; offset to the current cell
    (local $char0 i32)          ;; offset to first character data
    (local $ineedle i32)        ;; current needle offset
    (local $c i32)
    (local $v i32)
    (local $n i32)
    (local $i0 i32)
    (local $i1 i32)
    ;;
    i32.const 264               ;; start of char section is stored at addr 264
    i32.load
    set_local $char0
    ;; let ineedle = this.buf[255];
    i32.const 255               ;; addr of needle is stored at addr 255
    i32.load8_u
    set_local $ineedle
    ;; let icell = this.buf32[iroot+0];
    get_local $iroot
    i32.const 2
    i32.shl
    i32.load
    i32.const 2
    i32.shl
    tee_local $icell
    ;; if ( icell === 0 ) { return -1; }
    i32.eqz
    if
        i32.const -1
        return
    end
    ;; for (;;) {
    block $noSegment loop $nextSegment
        ;; if ( ineedle === 0 ) { return -1; }
        get_local $ineedle
        i32.eqz
        if
            i32.const -1
            return
        end
        ;; ineedle -= 1;
        get_local $ineedle
        i32.const -1
        i32.add
        tee_local $ineedle
        ;; let c = this.buf[ineedle];
        i32.load8_u
        set_local $c
        ;; for (;;) {
        block $foundSegment loop $findSegment
            ;; v = this.buf32[icell+2];
            get_local $icell
            i32.load offset=8
            tee_local $v
            ;; i0 = char0 + (v >>> 8);
            i32.const 8
            i32.shr_u
            get_local $char0
            i32.add
            tee_local $i0
            ;; if ( this.buf[i0] === c ) { break; }
            i32.load8_u
            get_local $c
            i32.eq
            br_if $foundSegment
            ;; icell = this.buf32[icell+0];
            get_local $icell
            i32.load
            i32.const 2
            i32.shl
            tee_local $icell
            i32.eqz
            if
                i32.const -1
                return
            end
            br 0
        end end
        ;; let n = v & 0x7F;
        get_local $v
        i32.const 0x7F
        i32.and
        tee_local $n
        ;; if ( n > 1 ) {
        i32.const 1
        i32.gt_u
        if
            ;; n -= 1;
            get_local $n
            i32.const -1
            i32.add
            tee_local $n
            ;; if ( n > ineedle ) { return -1; }
            get_local $ineedle
            i32.gt_u
            if
                i32.const -1
                return
            end
            get_local $i0
            i32.const 1
            i32.add
            tee_local $i0
            ;; const i1 = i0 + n;
            get_local $n
            i32.add
            set_local $i1
            ;; do {
            loop
                ;; ineedle -= 1;
                get_local $ineedle
                i32.const -1
                i32.add
                tee_local $ineedle
                ;; if ( this.buf[i0] !== this.buf[ineedle] ) { return -1; }
                i32.load8_u
                get_local $i0
                i32.load8_u
                i32.ne
                if
                    i32.const -1
                    return
                end
                ;; i0 += 1;
                get_local $i0
                i32.const 1
                i32.add
                tee_local $i0
                ;; } while ( i0 < i1 );
                get_local $i1
                i32.lt_u
                br_if 0
            end
        end
        ;; if ( (v & 0x80) !== 0 ) {
        get_local $v
        i32.const 0x80
        i32.and
        if
            ;; if ( ineedle === 0 || buf8[ineedle-1] === 0x2E /* '.' */ ) {
            ;;     return ineedle;
            ;; }
            get_local $ineedle
            i32.eqz
            if
                i32.const 0
                return
            end
            get_local $ineedle
            i32.const -1
            i32.add
            i32.load8_u
            i32.const 0x2E
            i32.eq
            if
                get_local $ineedle
                return
            end
        end
        ;; icell = this.buf32[icell+1];
        get_local $icell
        i32.load offset=4
        i32.const 2
        i32.shl
        tee_local $icell
        ;; if ( icell === 0 ) { break; }
        br_if 0
    end end
    ;; return -1;
    i32.const -1
)

;;
;; unsigned int add(icell)
;;
;; Add a new hostname to a trie which root cell is passed as argument.
;;
(func (export "add")
    (param $iroot i32)          ;; index of root cell of the trie
    (result i32)                ;; result: 0 not added, 1 = added
    (local $icell i32)          ;; index of current cell in the trie
    (local $lhnchar i32)        ;; number of characters left to process in hostname
    (local $char0 i32)          ;; offset to start of character data section
    (local $v i32)              ;; integer value describing a segment
    (local $isegchar0 i32)      ;; offset to start of current segment's character data
    (local $isegchar i32)
    (local $lsegchar i32)       ;; number of character in current segment
    (local $inext i32)          ;; index of next cell to process
    (local $boundaryBit i32)    ;; the boundary bit state of the current cell
    ;;
    ;; let lhnchar = this.buf[255];
    i32.const 255
    i32.load8_u
    tee_local $lhnchar
    ;; if ( lhnchar === 0 ) { return 0; }
    i32.eqz
    if
        i32.const 0
        return
    end
    ;; if (
    ;;     (this.buf32[HNBIGTRIE_CHAR0_SLOT] - this.buf32[HNBIGTRIE_TRIE1_SLOT]) < 24 ||
    ;;     (this.buf.length - this.buf32[HNBIGTRIE_CHAR1_SLOT]) < 256
    ;; ) {
    ;;     this.growBuf();
    ;; }
    i32.const 264
    i32.load
    i32.const 260
    i32.load
    i32.sub
    i32.const 24
    i32.lt_u
    if
        call $growBuf
    else
        memory.size
        i32.const 16
        i32.shl
        i32.const 268
        i32.load
        i32.sub
        i32.const 256
        i32.lt_u
        if
            call $growBuf
        end
    end
    ;; let icell = this.buf32[iroot+0];
    get_local $iroot
    i32.const 2
    i32.shl
    tee_local $iroot
    i32.load
    i32.const 2
    i32.shl
    tee_local $icell
    ;; if ( this.buf32[icell+2] === 0 ) {
    i32.eqz
    if
        ;; this.buf32[iroot+0] = this.addLeafCell(lhnchar);
        ;; return 1;
        get_local $iroot
        get_local $lhnchar
        call $addLeafCell
        i32.store
        i32.const 1
        return
    end
    ;; const char0 = this.buf32[HNBIGTRIE_CHAR0_SLOT];
    i32.const 264
    i32.load
    set_local $char0
    ;; for (;;) {
    loop $nextSegment
        ;; const v = this.buf32[icell+2];
        get_local $icell
        i32.load offset=8
        tee_local $v
        ;; let isegchar0 = char0 + (v >>> 8);
        i32.const 8
        i32.shr_u
        get_local $char0
        i32.add
        tee_local $isegchar0
        ;; if ( this.buf[isegchar0] !== this.buf[lhnchar-1] ) {
        i32.load8_u
        get_local $lhnchar
        i32.const -1
        i32.add
        i32.load8_u
        i32.ne
        if
            ;; inext = this.buf32[icell+0];
            get_local $icell
            i32.load
            tee_local $inext
            ;; if ( inext === 0 ) {
            i32.eqz
            if
                ;; this.buf32[icell+0] = this.addLeafCell(lhnchar);
                get_local $icell
                get_local $lhnchar
                call $addLeafCell
                i32.store
                ;; return 1;
                i32.const 1
                return
            end
            ;; icell = inext;
            get_local $inext
            i32.const 2
            i32.shl
            set_local $icell
            br $nextSegment
        end
        ;; let isegchar = 1;
        i32.const 1
        set_local $isegchar
        ;; lhnchar -= 1;
        get_local $lhnchar
        i32.const -1
        i32.add
        set_local $lhnchar
        ;; const lsegchar = v & 0x7F;
        get_local $v
        i32.const 0x7F
        i32.and
        tee_local $lsegchar
        ;; if ( lsegchar !== 1 ) {
        i32.const 1
        i32.ne
        if
            ;; for (;;) {
            block $mismatch loop
                ;; if ( isegchar === lsegchar ) { break; }
                get_local $isegchar
                get_local $lsegchar
                i32.eq
                br_if $mismatch
                get_local $lhnchar
                i32.eqz
                br_if $mismatch
                ;; if ( this.buf[isegchar0+isegchar] !== this.buf[lhnchar-1] ) { break; }
                get_local $isegchar0
                get_local $isegchar
                i32.add
                i32.load8_u
                get_local $lhnchar
                i32.const -1
                i32.add
                i32.load8_u
                i32.ne
                br_if $mismatch
                ;; isegchar += 1;
                get_local $isegchar
                i32.const 1
                i32.add
                set_local $isegchar
                ;; lhnchar -= 1;
                get_local $lhnchar
                i32.const -1
                i32.add
                set_local $lhnchar
                br 0
            end end
        end
        ;; const boundaryBit = v & 0x80;
        get_local $v
        i32.const 0x80
        i32.and
        set_local $boundaryBit
        ;; if ( isegchar === lsegchar ) {
        get_local $isegchar
        get_local $lsegchar
        i32.eq
        if
            ;; if ( lhnchar === 0 ) {
            get_local $lhnchar
            i32.eqz
            if
                ;; if ( boundaryBit !== 0 ) { return 0; }
                get_local $boundaryBit
                if
                    i32.const 0
                    return
                end
                ;; this.buf32[icell+2] = v | 0x80;
                get_local $icell
                get_local $v
                i32.const 0x80
                i32.or
                i32.store offset=8
            else
                ;; if ( boundaryBit !== 0 ) {
                get_local $boundaryBit
                if
                    ;; if ( this.buf[lhnchar-1] === 0x2E /* '.' */ ) { return -1; }
                    get_local $lhnchar
                    i32.const -1
                    i32.add
                    i32.load8_u
                    i32.const 0x2E
                    i32.eq
                    if
                        i32.const -1
                        return
                    end
                end
                ;; inext = this.buf32[icell+1];
                get_local $icell
                i32.load offset=4
                tee_local $inext
                ;; if ( inext !== 0 ) {
                if
                    ;; icell = inext;
                    get_local $inext
                    i32.const 2
                    i32.shl
                    set_local $icell
                    ;; continue;
                    br $nextSegment
                end
                ;; this.buf32[icell+1] = this.addLeafCell(lhnchar);
                get_local $icell
                get_local $lhnchar
                call $addLeafCell
                i32.store offset=4
            end
        else
            ;; isegchar0 -= char0;
            get_local $icell
            get_local $isegchar0
            get_local $char0
            i32.sub
            tee_local $isegchar0
            ;; this.buf32[icell+2] = isegchar0 << 8 | isegchar;
            i32.const 8
            i32.shl
            get_local $isegchar
            i32.or
            i32.store offset=8
            ;; inext = this.addCell(
            ;;     0,
            ;;     this.buf32[icell+1],
            ;;     isegchar0 + isegchar << 8 | boundaryBit | lsegchar - isegchar
            ;; );
            get_local $icell
            i32.const 0
            get_local $icell
            i32.load offset=4
            get_local $isegchar0
            get_local $isegchar
            i32.add
            i32.const 8
            i32.shl
            get_local $boundaryBit
            i32.or
            get_local $lsegchar
            get_local $isegchar
            i32.sub
            i32.or
            call $addCell
            tee_local $inext
            ;; this.buf32[icell+1] = inext;
            i32.store offset=4
            ;; if ( lhnchar !== 0 ) {
            get_local $lhnchar
            if
                ;; this.buf32[inext+0] = this.addLeafCell(lhnchar);
                get_local $inext
                i32.const 2
                i32.shl
                get_local $lhnchar
                call $addLeafCell
                i32.store
            else
                ;; this.buf32[icell+2] |= 0x80;
                get_local $icell
                get_local $icell
                i32.load offset=8
                i32.const 0x80
                i32.or
                i32.store offset=8
            end
        end
        ;; return 1;
        i32.const 1
        return
    end
    ;;
    i32.const 1
)

;;
;; Private functions
;;

;;
;; unsigned int addCell(idown, iright, v)
;;
;; Add a new cell, return cell index.
;;
(func $addCell
    (param $idown i32)
    (param $iright i32)
    (param $v i32)
    (result i32)                ;; result: index of added cell
    (local $icell i32)
    ;;
    ;; let icell = this.buf32[HNBIGTRIE_TRIE1_SLOT];
    ;; this.buf32[HNBIGTRIE_TRIE1_SLOT] = icell + 12;
    i32.const 260
    i32.const 260
    i32.load
    tee_local $icell
    i32.const 12
    i32.add
    i32.store
    ;; this.buf32[icell+0] = idown;
    get_local $icell
    get_local $idown
    i32.store
    ;; this.buf32[icell+1] = iright;
    get_local $icell
    get_local $iright
    i32.store offset=4
    ;; this.buf32[icell+2] = v;
    get_local $icell
    get_local $v
    i32.store offset=8
    ;; return icell;
    get_local $icell
    i32.const 2
    i32.shr_u
)

;;
;; unsigned int addLeafCell(lsegchar)
;;
;; Add a new cell, return cell index.
;;
(func $addLeafCell
    (param $lsegchar i32)
    (result i32)                ;; result: index of added cell
    (local $r i32)
    (local $i i32)
    ;; const r = this.buf32[TRIE1_SLOT] >>> 2;
    i32.const 260
    i32.load
    tee_local $r
    ;; let i = r;
    set_local $i
    ;; while ( lsegchar > 127 ) {
    block $lastSegment loop
        get_local $lsegchar
        i32.const 127
        i32.le_u
        br_if $lastSegment
        ;; this.buf32[i+0] = 0;
        get_local $i
        i32.const 0
        i32.store
        ;; this.buf32[i+1] = i + 3;
        get_local $i
        get_local $i
        i32.const 12
        i32.add
        i32.const 2
        i32.shr_u
        i32.store offset=4
        ;; this.buf32[i+2] = this.addSegment(lsegchar, lsegchar - 127);
        get_local $i
        get_local $lsegchar
        get_local $lsegchar
        i32.const 127
        i32.sub
        call $addSegment
        i32.store offset=8
        ;; lsegchar -= 127;
        get_local $lsegchar
        i32.const 127
        i32.sub
        set_local $lsegchar
        ;; i += 3;
        get_local $i
        i32.const 12
        i32.add
        set_local $i
        br 0
    end end
    ;; this.buf32[i+0] = 0;
    get_local $i
    i32.const 0
    i32.store
    ;; this.buf32[i+1] = 0;
    get_local $i
    i32.const 0
    i32.store offset=4
    ;; this.buf32[i+2] = this.addSegment(lsegchar, 0) | 0x80;
    get_local $i
    get_local $lsegchar
    i32.const 0
    call $addSegment
    i32.const 0x80
    i32.or
    i32.store offset=8
    ;; this.buf32[TRIE1_SLOT] = i + 3 << 2;
    i32.const 260
    get_local $i
    i32.const 12
    i32.add
    i32.store
    ;; return r;
    get_local $r
    i32.const 2
    i32.shr_u
)

;;
;; unsigned int addSegment(lsegchar, lsegend)
;;
;; Store a segment of characters and return a segment descriptor. The segment
;; is created from the character data in the needle buffer.
;;
(func $addSegment
    (param $lsegchar i32)
    (param $lsegend i32)
    (result i32)                ;; result: segment descriptor
    (local $char1 i32)          ;; offset to end of character data section
    (local $isegchar i32)       ;; relative offset to first character of segment
    (local $i i32)              ;; iterator
    ;;
    ;; if ( lsegchar === 0 ) { return 0; }
    get_local $lsegchar
    i32.eqz
    if
        i32.const 0
        return
    end
    ;; let char1 = this.buf32[HNBIGTRIE_CHAR1_SLOT];
    i32.const 268
    i32.load
    tee_local $char1
    ;; const isegchar = char1 - this.buf32[HNBIGTRIE_CHAR0_SLOT];
    i32.const 264
    i32.load
    i32.sub
    set_local $isegchar
    ;; let i = lsegchar;
    get_local $lsegchar
    set_local $i
    ;; do {
    loop
        ;; this.buf[char1++] = this.buf[--i];
        get_local $char1
        get_local $i
        i32.const -1
        i32.add
        tee_local $i
        i32.load8_u
        i32.store8
        get_local $char1
        i32.const 1
        i32.add
        set_local $char1
        ;; } while ( i !== lsegend );
        get_local $i
        get_local $lsegend
        i32.ne
        br_if 0
    end
    ;; this.buf32[HNBIGTRIE_CHAR1_SLOT] = char1;
    i32.const 268
    get_local $char1
    i32.store
    ;; return isegchar << 8 | lsegchar - lsegend;
    get_local $isegchar
    i32.const 8
    i32.shl
    get_local $lsegchar
    get_local $lsegend
    i32.sub
    i32.or
)

;;
;; module end
;;
)

;;
;; uBlock Origin - a browser extension to block requests.
;; Copyright (C) 2019-present Raymond Hill
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
;; File: biditrie.wat
;; Description: WebAssembly code used by src/js/biditrie.js
;; How to compile: See README.md in this directory.

(module
;;
;; module start
;;

(memory (import "imports" "memory") 1)
(func $extraHandler (import "imports" "extraHandler") (param i32 i32 i32) (result i32))

;; Trie container
;;
;; Memory layout, byte offset:
;; const HAYSTACK_START = 0;
;; const HAYSTACK_SIZE = 2048;                         //   i32 /   i8
;; const HAYSTACK_SIZE_SLOT = HAYSTACK_SIZE >>> 2;     //   512 / 2048
;; const TRIE0_SLOT     = HAYSTACK_SIZE_SLOT + 1;      //   513 / 2052
;; const TRIE1_SLOT     = HAYSTACK_SIZE_SLOT + 2;      //   514 / 2056
;; const CHAR0_SLOT     = HAYSTACK_SIZE_SLOT + 3;      //   515 / 2060
;; const CHAR1_SLOT     = HAYSTACK_SIZE_SLOT + 4;      //   516 / 2064
;; const RESULT_L_SLOT  = HAYSTACK_SIZE_SLOT + 5;      //   517 / 2068
;; const RESULT_R_SLOT  = HAYSTACK_SIZE_SLOT + 6;      //   518 / 2072
;; const RESULT_IU_SLOT = HAYSTACK_SIZE_SLOT + 7;      //   519 / 2076
;; const TRIE0_START    = HAYSTACK_SIZE_SLOT + 8 << 2; //         2080
;;

;;
;; Public functions
;;

;;
;; unsigned int matches(icell, ai)
;;
;; Test whether the trie at icell matches the haystack content at position ai.
;;
(func (export "matches")
    (param $icell i32)          ;; start offset in haystack
    (param $ai i32)             ;; offset in haystack
    (result i32)                ;; result: 0 = no match, 1 = match
    (local $char0 i32)
    (local $aR i32)
    (local $al i32)
    (local $c i32)
    (local $v i32)
    (local $bl i32)
    (local $n i32)
    (local $ar i32)
    (local $i i32)
    (local $j i32)
    (local $inext i32)
    ;; trie index is a uint32 offset, need to convert to uint8 offset
    get_local $icell
    i32.const 2
    i32.shl
    set_local $icell
    ;; const buf32 = this.buf32;
    ;; const buf8 = this.buf8;
    ;; const char0 = buf32[CHAR0_SLOT];
    i32.const 2060
    i32.load align=4
    set_local $char0
    ;; const aR = buf32[HAYSTACK_SIZE_SLOT];
    i32.const 2048
    i32.load align=4
    set_local $aR
    ;; let al = ai;
    get_local $ai
    set_local $al
    block $matchFound
    block $matchNotFound
    ;; for (;;) {
    loop $mainLoop
        ;; c = buf8[al];
        get_local $al
        i32.load8_u
        set_local $c
        ;; al += 1;
        get_local $al
        i32.const 1
        i32.add
        set_local $al
        ;; // find first segment with a first-character match
        ;; for (;;) {
        block $breakMatchFirstChar loop $matchFirstChar
            ;; v = buf32[icell+SEGMENT_INFO];
            get_local $icell
            i32.load offset=8 align=4
            tee_local $v
            ;; bl = char0 + (v & 0x00FFFFFF);
            i32.const 0x00FFFFFF
            i32.and
            get_local $char0
            i32.add
            tee_local $bl
            ;; if ( buf8[bl] === c ) { break; }
            i32.load8_u
            get_local $c
            i32.eq
            br_if $breakMatchFirstChar
            ;; icell = buf32[icell+CELL_OR];
            get_local $icell
            i32.load offset=4 align=4
            i32.const 2
            i32.shl
            tee_local $icell
            ;; if ( icell === 0 ) { return 0; }
            i32.eqz
            br_if $matchNotFound
            br $matchFirstChar
        ;; }
        end end
        ;; // all characters in segment must match
        ;; n = (v >>> 24) - 1;
        get_local $v
        i32.const 24
        i32.shr_u
        i32.const 1
        i32.sub
        tee_local $n
        ;; if ( n !== 0 ) {
        if
            ;; const ar = al + n;
            get_local $n
            get_local $al
            i32.add
            tee_local $ar
            ;; if ( ar > aR ) { return 0; }
            get_local $aR
            i32.gt_u
            br_if $matchNotFound
            ;; let i = al, j = bl + 1;
            get_local $al
            set_local $i
            get_local $bl
            i32.const 1
            i32.add
            set_local $j
            ;; do {
            loop
                ;; if ( buf8[i] !== buf8[j] ) { return 0; }
                get_local $i
                i32.load8_u
                get_local $j
                i32.load8_u
                i32.ne
                br_if $matchNotFound
                ;; j += 1; i += 1;
                get_local $j
                i32.const 1
                i32.add
                set_local $j
                get_local $i
                i32.const 1
                i32.add
                tee_local $i
                ;; } while ( i !== ar );
                get_local $ar
                i32.ne
                br_if 0
            end
            ;; al = i;
            get_local $i
            set_local $al
        ;; }
        end
        ;; // next segment
        ;; icell = buf32[icell+CELL_AND];
        get_local $icell
        i32.load align=4
        i32.const 2
        i32.shl
        tee_local $icell
        ;; const v = buf32[icell+BCELL_EXTRA];
        i32.load offset=8 align=4
        tee_local $v
        ;; if ( v <= BCELL_EXTRA_MAX ) {
        i32.const 0x00FFFFFF
        i32.le_u
        if
            ;; if ( v !== 0 && this.matchesExtra(ai, al, v) !== 0 ) {
            ;;     return 1;
            ;; }
            get_local $v
            if
                get_local $ai
                get_local $al
                get_local $v
                call $matchesExtra
                br_if $matchFound
            end
            ;; let inext = buf32[icell+BCELL_ALT_AND];
            get_local $icell
            i32.load offset=4 align=4
            i32.const 2
            i32.shl
            tee_local $inext
            ;; if ( inext !== 0 && this.matchesLeft(inext, ai, al) !== 0 ) {
            if
                get_local $inext
                get_local $ai
                get_local $al
                call $matchesLeft
                br_if $matchFound
            ;; }
            end
            ;; icell = buf32[icell+BCELL_NEXT_AND];
            get_local $icell
            i32.load align=4
            i32.const 2
            i32.shl
            tee_local $icell
            ;; if ( icell === 0 ) { return 0; }
            i32.eqz
            br_if $matchNotFound
        ;; }
        end
        ;; if ( al === aR ) { return 0; }
        get_local $al
        get_local $aR
        i32.ne
        br_if $mainLoop
    ;; }
    end ;; $mainLoop
    end ;; $matchNotFound
    i32.const 0
    return
    end ;; $matchFound
    i32.const 1
    return
)

;;
;; unsigned int matchesLeft(icell, ar, r)
;;
;; Test whether the trie at icell matches the haystack content at position ai.
;;
(func $matchesLeft
    (param $icell i32)          ;; start offset in haystack
    (param $ar i32)             ;; offset of where to start in haystack
    (param $r i32)              ;; right bound of match so far
    (result i32)                ;; result: 0 = no match, 1 = match
    (local $char0 i32)
    (local $c i32)
    (local $v i32)
    (local $bl i32)
    (local $n i32)
    (local $al i32)
    (local $br i32)
    (local $i i32)
    (local $j i32)
    ;; const buf32 = this.buf32;
    ;; const buf8 = this.buf8;
    ;; const char0 = buf32[CHAR0_SLOT];
    i32.const 2060
    i32.load align=4
    set_local $char0
    block $matchFound
    block $matchNotFound
    ;; for (;;) {
    loop $mainLoop
        ;; if ( ar === 0 ) { return 0; }
        get_local $ar
        i32.eqz
        br_if $matchNotFound
        ;; ar -= 1;
        get_local $ar
        i32.const 1
        i32.sub
        tee_local $ar
        ;; c = buf8[ar];
        i32.load8_u
        set_local $c
        ;; // find first segment with a first-character match
        ;; for (;;) {
        block $breakMatchFirstChar loop $matchFirstChar
            ;; v = buf32[icell+SEGMENT_INFO];
            get_local $icell
            i32.load offset=8 align=4
            tee_local $v
            ;; n = (v >>> 24) - 1;
            i32.const 24
            i32.shr_u
            i32.const 1
            i32.sub
            tee_local $n
            ;; br = char0 + (v & 0x00FFFFFF) + n;
            get_local $char0
            i32.add
            get_local $v
            i32.const 0x00FFFFFF
            i32.and
            i32.add
            tee_local $br
            ;; if ( buf8[br] === c ) { break; }
            i32.load8_u
            get_local $c
            i32.eq
            br_if $breakMatchFirstChar
            ;; icell = buf32[icell+CELL_OR];
            get_local $icell
            i32.load offset=4 align=4
            i32.const 2
            i32.shl
            tee_local $icell
            ;; if ( icell === 0 ) { return 0; }
            i32.eqz
            br_if $matchNotFound
            br $matchFirstChar
        ;; }
        end end
        ;; // all characters in segment must match
        ;; if ( n !== 0 ) {
        get_local $n
        if
            ;; const al = ar - n;
            get_local $ar
            get_local $n
            i32.sub
            tee_local $al
            ;; if ( al < 0 ) { return 0; }
            i32.const 0
            i32.lt_s
            br_if $matchNotFound
            ;; let i = ar, j = br;
            get_local $ar
            set_local $i
            get_local $br
            set_local $j
            ;; do {
            loop
                ;; i -= 1; j -= 1;
                ;; if ( buf8[i] !== buf8[j] ) { return 0; }
                get_local $i
                i32.const 1
                i32.sub
                tee_local $i
                i32.load8_u
                get_local $j
                i32.const 1
                i32.sub
                tee_local $j
                i32.load8_u
                i32.ne
                br_if $matchNotFound
                ;; } while ( i !== al );
                get_local $i
                get_local $al
                i32.ne
                br_if 0
            end
            ;; ar = i;
            get_local $i
            set_local $ar
        ;; }
        end
        ;; // next segment
        ;; icell = buf32[icell+CELL_AND];
        get_local $icell
        i32.load align=4
        i32.const 2
        i32.shl
        tee_local $icell
        ;; const v = buf32[icell+BCELL_EXTRA];
        i32.load offset=8 align=4
        tee_local $v
        ;; if ( v <= BCELL_EXTRA_MAX ) {
        i32.const 0x00FFFFFF
        i32.le_u
        if
            ;; if ( v !== 0 && this.matchesExtra(ar, r, v) !== 0 ) {
            ;;     return 1;
            ;; }
            get_local $v
            if
                get_local $ar
                get_local $r
                get_local $v
                call $matchesExtra
                br_if $matchFound
            end
            ;; icell = buf32[icell+BCELL_NEXT_AND];
            get_local $icell
            i32.load align=4
            i32.const 2
            i32.shl
            tee_local $icell
            ;; if ( icell === 0 ) { return 0; }
            i32.eqz
            br_if $matchNotFound
        ;; }
        end
        br $mainLoop
    ;; }
    end ;; $mainLoop
    end ;; $matchNotFound
    i32.const 0
    return
    end ;; $matchFound
    i32.const 1
    return
)

;;
;; int matchExtra(l, r, ix)
;;
;; Test whether extra handler returns a match.
;;
(func $matchesExtra
    (param $l i32)              ;; left bound of match so far
    (param $r i32)              ;; right bound of match so far
    (param $ix i32)             ;; extra token
    (result i32)                ;; result: 0 = no match, 1 = match
    (local $iu i32)             ;; filter unit
    ;; let iu;
    ;; if ( ix !== 1 ) {
    ;;     iu = this.extraHandler(l, r, ix);
    ;;     if ( iu === 0 ) { return 0; }
    get_local $ix
    i32.const 1
    i32.ne
    if
        get_local $l
        get_local $r
        get_local $ix
        call $extraHandler
        tee_local $iu
        i32.eqz
        if
            i32.const 0
            return
        end
    ;; } else {
    ;;     iu = -1;
    else
        i32.const -1
        set_local $iu
    ;; }
    end
    ;; this.buf32[RESULT_L_SLOT] = l;
    i32.const 2068
    get_local $l
    i32.store align=4
    ;; this.buf32[RESULT_R_SLOT] = r;
    i32.const 2072
    get_local $r
    i32.store align=4
    ;; this.buf32[RESULT_IU_SLOT] = iu;
    i32.const 2076
    get_local $iu
    i32.store align=4
    i32.const 1
)

;;
;; unsigned int startsWith(haystackLeft, haystackRight, needleLeft, needleLen)
;;
;; Test whether the string at needleOffset and of length needleLen matches
;; the haystack at offset haystackOffset.
;;
(func (export "startsWith")
    (param $haystackLeft i32)   ;; start offset in haystack
    (param $haystackRight i32)  ;; end offset in haystack
    (param $needleLeft i32)     ;; start of needle in character buffer
    (param $needleLen i32)      ;; number of characters to match
    (result i32)                ;; result: 0 = no match, 1 = match
    (local $needleRight i32)
    ;;
    ;; if ( haystackLeft < 0 || (haystackLeft + needleLen) > haystackRight ) {
    ;;     return 0;
    ;; }
    get_local $haystackLeft
    i32.const 0
    i32.lt_s
    if
        i32.const 0
        return
    end
    get_local $haystackLeft
    get_local $needleLen
    i32.add
    get_local $haystackRight
    i32.gt_u
    if
        i32.const 0
        return
    end
    ;; const charCodes = this.buf8;
    ;; needleLeft += this.buf32[CHAR0_SLOT];
    get_local $needleLeft
    i32.const 2060              ;; CHAR0_SLOT memory address
    i32.load align=4            ;; CHAR0 memory address
    i32.add                     ;; needle memory address
    ;; const needleRight = needleLeft + needleLen;
    tee_local $needleLeft
    get_local $needleLen
    i32.add
    set_local $needleRight
    ;; while ( charCodes[haystackLeft] === charCodes[needleLeft] ) {
    block $breakCompare loop $compare
        get_local $haystackLeft
        i32.load8_u
        get_local $needleLeft
        i32.load8_u
        i32.ne 
        br_if $breakCompare
        ;; needleLeft += 1;
        get_local $needleLeft
        i32.const 1
        i32.add
        tee_local $needleLeft
        ;; if ( needleLeft === needleRight ) { return 1; }
        get_local $needleRight
        i32.eq
        if
            i32.const 1
            return
        end
        ;; haystackLeft += 1;
        i32.const 1
        get_local $haystackLeft
        i32.add
        set_local $haystackLeft
        br $compare
    end end
    ;; }
    ;; return 0;
    i32.const 0
)

;;
;; int indexOf(haystackLeft, haystackEnd, needleLeft, needleLen)
;;
;; Test whether the string at needleOffset and of length needleLen is found in
;; the haystack at or to the left of haystackLeft, but not farther than
;; haystackEnd.
;;
(func (export "indexOf")
    (param $haystackLeft i32)   ;; start offset in haystack
    (param $haystackEnd i32)    ;; end offset in haystack
    (param $needleLeft i32)     ;; start of needle in character buffer
    (param $needleLen i32)      ;; number of characters to match
    (result i32)                ;; result: index of match, -1 = no match
    (local $needleRight i32)
    (local $i i32)
    (local $j i32)
    (local $c0 i32)
    ;; haystackEnd -= needleLen;
    get_local $haystackEnd
    get_local $needleLen
    i32.sub
    tee_local $haystackEnd
    ;; if ( haystackEnd < haystackLeft ) { return -1; }
    get_local $haystackLeft
    i32.lt_s
    if
        i32.const -1
        return
    end
    ;; needleLeft += this.buf32[CHAR0_SLOT];
    get_local $needleLeft
    i32.const 2060              ;; CHAR0_SLOT memory address
    i32.load align=4            ;; CHAR0 memory address
    i32.add                     ;; needle memory address
    tee_local $needleLeft
    ;; const needleRight = needleLeft + needleLen;
    get_local $needleLen
    i32.add
    set_local $needleRight
    ;; const charCodes = this.buf8;
    ;; for (;;) {
    block $breakMainLoop loop $mainLoop
        ;; let i = haystackLeft;
        ;; let j = needleLeft;
        get_local $haystackLeft
        set_local $i
        get_local $needleLeft
        set_local $j
        ;; while ( charCodes[i] === charCodes[j] ) {
        block $breakMatchChars loop $matchChars
            get_local $i
            i32.load8_u
            get_local $j
            i32.load8_u
            i32.ne
            br_if $breakMatchChars
            ;; j += 1;
            get_local $j
            i32.const 1
            i32.add
            tee_local $j
            ;; if ( j === needleRight ) { return haystackLeft; }
            get_local $needleRight
            i32.eq
            if
                get_local $haystackLeft
                return
            end
            ;; i += 1;
            get_local $i
            i32.const 1
            i32.add
            set_local $i
            br $matchChars
        ;; }
        end end
        ;; haystackLeft += 1;
        get_local $haystackLeft
        i32.const 1
        i32.add
        tee_local $haystackLeft
        ;; if ( haystackLeft === haystackEnd ) { break; }
        get_local $haystackEnd
        i32.ne
        br_if $mainLoop
    ;; }
    end end
    ;; return -1;
    i32.const -1
)

;;
;; int lastIndexOf(haystackBeg, haystackEnd, needleLeft, needleLen)
;;
;; Test whether the string at needleOffset and of length needleLen is found in
;; the haystack at or to the right of haystackBeg, but not farther than
;; haystackEnd.
;;
(func (export "lastIndexOf")
    (param $haystackBeg i32)    ;; start offset in haystack
    (param $haystackEnd i32)    ;; end offset in haystack
    (param $needleLeft i32)     ;; start of needle in character buffer
    (param $needleLen i32)      ;; number of characters to match
    (result i32)                ;; result: index of match, -1 = no match
    (local $haystackLeft i32)
    (local $needleRight i32)
    (local $i i32)
    (local $j i32)
    (local $c0 i32)
    ;; let haystackLeft = haystackEnd - needleLen;
    get_local $haystackEnd
    get_local $needleLen
    i32.sub
    tee_local $haystackLeft
    ;; if ( haystackLeft < haystackBeg ) { return -1; }
    get_local $haystackBeg
    i32.lt_s
    if
        i32.const -1
        return
    end
    ;; needleLeft += this.buf32[CHAR0_SLOT];
    get_local $needleLeft
    i32.const 2060              ;; CHAR0_SLOT memory address
    i32.load align=4            ;; CHAR0 memory address
    i32.add                     ;; needle memory address
    tee_local $needleLeft
    ;; const needleRight = needleLeft + needleLen;
    get_local $needleLen
    i32.add
    set_local $needleRight
    ;; const charCodes = this.buf8;
    ;; for (;;) {
    block $breakMainLoop loop $mainLoop
        ;; let i = haystackLeft;
        ;; let j = needleLeft;
        get_local $haystackLeft
        set_local $i
        get_local $needleLeft
        set_local $j
        ;; while ( charCodes[i] === charCodes[j] ) {
        block $breakMatchChars loop $matchChars
            get_local $i
            i32.load8_u
            get_local $j
            i32.load8_u
            i32.ne
            br_if $breakMatchChars
            ;; j += 1;
            get_local $j
            i32.const 1
            i32.add
            tee_local $j
            ;; if ( j === needleRight ) { return haystackLeft; }
            get_local $needleRight
            i32.eq
            if
                get_local $haystackLeft
                return
            end
            ;; i += 1;
            get_local $i
            i32.const 1
            i32.add
            set_local $i
            br $matchChars
        ;; }
        end end
        ;; if ( haystackLeft === haystackBeg ) { break; }
        ;; haystackLeft -= 1;
        get_local $haystackLeft
        get_local $haystackBeg
        i32.eq
        br_if $breakMainLoop
        get_local $haystackLeft
        i32.const 1
        i32.sub
        set_local $haystackLeft
        br $mainLoop
    ;; }
    end end
    ;; return -1;
    i32.const -1
)

;;
;; module end
;;
)

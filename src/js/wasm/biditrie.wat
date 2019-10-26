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

;; Trie container
;;
;; Memory layout, byte offset:
;; HAYSTACK_START = 0;
;; HAYSTACK_SIZE = 2048;                         //   i32 /   i8
;; HAYSTACK_SIZE_SLOT = HAYSTACK_SIZE >>> 2;     //   512 / 2048
;; TRIE0_SLOT  = HAYSTACK_SIZE_SLOT + 1;         //   512 / 2052
;; TRIE1_SLOT  = HAYSTACK_SIZE_SLOT + 2;         //   513 / 2056
;; CHAR0_SLOT  = HAYSTACK_SIZE_SLOT + 3;         //   514 / 2060
;; CHAR1_SLOT  = HAYSTACK_SIZE_SLOT + 4;         //   515 / 2064
;; TRIE0_START = HAYSTACK_SIZE_SLOT + 5 << 2;    //         2068
;;

;;
;; Public functions
;;

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
    i32.load                    ;; CHAR0 memory address
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
        ;; if ( needleLeft === needleRight ) { break; }
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
    ;; return true;
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
    i32.load                    ;; CHAR0 memory address
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
    i32.load                    ;; CHAR0 memory address
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

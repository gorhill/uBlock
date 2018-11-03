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

;; (func $log (import "imports" "log") (param i32 i32 i32))

(memory (import "imports" "memory") 1)

;;
;; Public functions
;;

;;
;; unsigned int matches(offset)
;;
;; Test whether the currently set needle matches the trie at specified offset.
;;
;; Memory layout, byte offset:
;;   0-254: encoded needle (ASCII)
;; 255    : needle length
;; 256-   : tries
;;
(func (export "matches")
    (param $itrie i32)
    (result i32)                        ;; result: 0 = miss, 1 = hit
    (local $ineedle i32)                ;; current needle offset
    (local $nchar i32)                  ;; needle char being processed
    (local $tchar i32)                  ;; trie char being processed
    (local $lxtra i32)
    (local $ixtra i32)
    i32.const 255
    i32.load8_u
    set_local $ineedle
    loop $nextNeedleChar
        ;; ineedle -= 1;
        get_local $ineedle
        i32.const -1
        i32.add
        tee_local $ineedle
        ;; let nchar = ineedle === -1 ? 0 : buf[ineedle];
        i32.const 0
        i32.lt_s
        if
            i32.const 0
            set_local $nchar
        else
            get_local $ineedle
            i32.load8_u
            set_local $nchar
        end
        block $trieCharEqNeedleChar loop $nextTrieChar
            ;; let tchar = buf[itrie+8];
            get_local $itrie
            i32.load8_u offset=8
            tee_local $tchar
            ;; if ( tchar === nchar ) { break; }
            get_local $nchar
            i32.eq
            br_if $trieCharEqNeedleChar
            ;; if ( tchar === 0 && nchar === 0x2E ) { return 1; }
            get_local $tchar
            i32.eqz
            if
                get_local $nchar
                i32.const 0x2E
                i32.eq
                if
                    i32.const 1
                    return
                end
            end
            ;; itrie = buf32[itrie >>> 2];
            get_local $itrie
            i32.load
            tee_local $itrie
            ;; if ( itrie === 0 ) { return 0; }
            i32.eqz
            if
                i32.const 0
                return
            end
            br $nextTrieChar
        end end
        ;; if ( nchar === 0 ) { return 1; }
        get_local $nchar
        i32.eqz
        if
            i32.const 1
            return
        end
        ;; let lxtra = buf[itrie+9];
        get_local $itrie
        i32.load8_u offset=9
        tee_local $lxtra
        i32.eqz
        if else
            ;; if ( lxtra > ineedle ) { return 0; }
            get_local $lxtra
            get_local $ineedle
            i32.gt_u
            if
                i32.const 0
                return
            end
            ;; let ixtra = itrie + 10;
            get_local $itrie
            i32.const 10
            i32.add
            tee_local $ixtra
            ;; lxtra += ixtra;
            get_local $lxtra
            i32.add
            set_local $lxtra
            ;; do {
            block $noMoreExtraChars loop
                ;; ineedle -= 1;
                get_local $ineedle
                i32.const -1
                i32.add
                tee_local $ineedle
                ;; if ( buf[ineedle] !== buf[ixtra] ) { return 0; }
                i32.load8_u
                get_local $ixtra
                i32.load8_u
                i32.ne
                if
                    i32.const 0
                    return
                end
                ;; ixtra += 1;
                get_local $ixtra
                i32.const 1
                i32.add
                tee_local $ixtra
                ;; while ( ixtra !== lxtra ) {
                get_local $lxtra
                i32.eq
                br_if $noMoreExtraChars
                br 0
            end end
        end
        ;; itrie = buf32[itrie + 4 >>> 2];
        get_local $itrie
        i32.load offset=4
        tee_local $itrie
        ;; if ( itrie === 0 ) {
        i32.eqz
        if
            ;; return ineedle === 0 || buf[ineedle-1] === 0x2E ? 1 : 0;
            get_local $ineedle
            i32.eqz
            if
                i32.const 1
                return
            end
            get_local $ineedle
            i32.const -1
            i32.add
            i32.load8_u
            i32.const 0x2E
            i32.eq
            if
                i32.const 1
                return
            end
            i32.const 0
            return
        end
        br 0
    end
    i32.const 0
)

;;
;; module end
;;
)

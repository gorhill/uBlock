;;
;; uBlock Origin - a browser extension to block requests.
;; Copyright (C) 2019-present Raymond Hill
;;
;; License: pick the one which suits you:
;;   GPL v3 see <https://www.gnu.org/licenses/gpl.html>
;;   APL v2 see <http://www.apache.org/licenses/LICENSE-2.0>
;;
;; Home: https://github.com/gorhill/publicsuffixlist.js
;; File: publicsuffixlist.wat
;;
;; Description: WebAssembly implementation for core lookup method in
;;              publicsuffixlist.js
;;
;; How to compile:
;;
;;     wat2wasm publicsuffixlist.wat -o publicsuffixlist.wasm
;;
;; The `wat2wasm` tool can be downloaded from an official WebAssembly
;; project:
;; https://github.com/WebAssembly/wabt/releases


(module
;;
;; module start
;;

(memory (import "imports" "memory") 1)

;;
;; Tree encoding in array buffer:
;;
;;  Node:
;;  +  u8: length of char data
;;  +  u8: flags => bit 0: is_publicsuffix, bit 1: is_exception
;;  + u16: length of array of children
;;  + u32: char data or offset to char data
;;  + u32: offset to array of children
;;  = 12 bytes
;;
;;                                      // i32 /  i8
;; const HOSTNAME_SLOT         = 0;     // jshint ignore:line
;; const LABEL_INDICES_SLOT    = 256;   //  -- / 256
;; const RULES_PTR_SLOT        = 100;   // 100 / 400
;; const SUFFIX_NOT_FOUND_SLOT = 399;   //  -- / 399
;; const CHARDATA_PTR_SLOT     = 101;   // 101 / 404
;; const EMPTY_STRING          = '';
;; const SELFIE_MAGIC          = 2;
;;

;;
;; Public functions
;;

;;
;; unsigned int getPublicSuffixPos()
;;
;; Returns an offset to the start of the public suffix.
;;
(func (export "getPublicSuffixPos")
    (result i32)                ;; result = match index, -1 = miss
    (local $iCharData i32)      ;; offset to start of character data
    (local $iNode i32)          ;; offset to current node
    (local $iLabel i32)         ;; offset to label indices
    (local $cursorPos i32)      ;; position of cursor within hostname argument
    (local $labelBeg i32)
    (local $labelLen i32)
    (local $nCandidates i32)
    (local $iCandidates i32)
    (local $iFound i32)
    (local $l i32)
    (local $r i32)
    (local $d i32)
    (local $iCandidate i32)
    (local $iCandidateNode i32)
    (local $candidateLen i32)
    (local $iCandidateChar i32)
    (local $_1 i32)
    (local $_2 i32)
    (local $_3 i32)
    ;;
    ;; const iCharData = buf32[CHARDATA_PTR_SLOT];
    i32.const 404
    i32.load
    set_local $iCharData
    ;; let iNode = pslBuffer32[RULES_PTR_SLOT];
    i32.const 400
    i32.load
    i32.const 2
    i32.shl
    set_local $iNode
    ;; let iLabel = LABEL_INDICES_SLOT;
    i32.const 256
    set_local $iLabel
    ;; let cursorPos = -1;
    i32.const -1
    set_local $cursorPos
    ;; label-lookup loop
    ;; for (;;) {
    block $labelLookupDone loop $labelLookup
        ;; // Extract label indices
        ;; const labelBeg = buf8[iLabel+1];
        ;; const labelLen = buf8[iLabel+0] - labelBeg;
        get_local $iLabel
        i32.load8_u
        get_local $iLabel
        i32.load8_u offset=1
        tee_local $labelBeg
        i32.sub
        set_local $labelLen
        ;; // Match-lookup loop: binary search
        ;; let r = buf32[iNode+0] >>> 16;
        ;; if ( r === 0 ) { break; }
        get_local $iNode
        i32.load16_u offset=2
        tee_local $r
        i32.eqz
        br_if $labelLookupDone
        ;; const iCandidates = buf32[iNode+2];
        get_local $iNode
        i32.load offset=8
        i32.const 2
        i32.shl
        set_local $iCandidates
        ;; let l = 0;
        ;; let iFound = 0;
        i32.const 0
        tee_local $l
        set_local $iFound
        ;; while ( l < r ) {
        block $binarySearchDone loop $binarySearch
            get_local $l
            get_local $r
            i32.ge_u
            br_if $binarySearchDone
            ;; const iCandidate = l + r >>> 1;
            get_local $l
            get_local $r
            i32.add
            i32.const 1
            i32.shr_u
            tee_local $iCandidate
            ;; const iCandidateNode = iCandidates + iCandidate + (iCandidate << 1);
            i32.const 2
            i32.shl
            tee_local $_1
            get_local $_1
            i32.const 1
            i32.shl
            i32.add
            get_local $iCandidates
            i32.add
            tee_local $iCandidateNode
            ;; const candidateLen = buf32[iCandidateNode+0] & 0x000000FF;
            i32.load8_u
            set_local $candidateLen
            ;; let d = labelLen - candidateLen;
            get_local $labelLen
            get_local $candidateLen
            i32.sub
            tee_local $d
            ;; if ( d === 0 ) {
            i32.eqz
            if
                ;; const iCandidateChar = candidateLen <= 4
                get_local $candidateLen
                i32.const 4
                i32.le_u
                if
                    ;; ? iCandidateNode + 1 << 2
                    get_local $iCandidateNode
                    i32.const 4
                    i32.add
                    set_local $iCandidateChar
                else
                    ;; : buf32[CHARDATA_PTR_SLOT] + buf32[iCandidateNode+1];
                    get_local $iCharData
                    get_local $iCandidateNode
                    i32.load offset=4
                    i32.add
                    set_local $iCandidateChar
                end
                ;; for ( let i = 0; i < labelLen; i++ ) {
                get_local $labelBeg
                tee_local $_1
                get_local $labelLen
                i32.add
                set_local $_3
                get_local $iCandidateChar
                set_local $_2
                block $findDiffDone loop $findDiff
                    ;; d = buf8[labelBeg+i] - buf8[iCandidateChar+i];
                    ;; if ( d !== 0 ) { break; }
                    get_local $_1
                    i32.load8_u
                    get_local $_2
                    i32.load8_u
                    i32.sub
                    tee_local $d
                    br_if $findDiffDone
                    get_local $_1
                    i32.const 1
                    i32.add
                    tee_local $_1
                    get_local $_3
                    i32.eq
                    br_if $findDiffDone
                    get_local $_2
                    i32.const 1
                    i32.add
                    set_local $_2
                    br $findDiff
                ;; }
                end end
            ;; }
            end
            ;; if ( d < 0 ) {
            ;;     r = iCandidate;
            get_local $d
            i32.const 0
            i32.lt_s
            if
                get_local $iCandidate
                set_local $r
                br $binarySearch
            end
            ;; } else if ( d > 0 ) {
            ;;     l = iCandidate + 1;
            get_local $d
            i32.const 0
            i32.gt_s
            if
                get_local $iCandidate
                i32.const 1
                i32.add
                set_local $l
                br $binarySearch
            end
            ;; } else /* if ( d === 0 ) */ {
            ;;     iFound = iCandidateNode;
            ;;     break;
            ;; }
            get_local $iCandidateNode
            set_local $iFound
        end end
        ;; }
        ;; // 2. If no rules match, the prevailing rule is "*".
        ;; if ( iFound === 0 ) {
        ;;     if ( buf32[iCandidates + 1] !== 0x2A /* '*' */ ) { break; }
        ;;     buf8[SUFFIX_NOT_FOUND_SLOT] = 1;
        ;;     iFound = iCandidates;
        ;; }
        get_local $iFound
        i32.eqz
        if
            get_local $iCandidates
            i32.load offset=4
            i32.const 0x2A
            i32.ne
            br_if $labelLookupDone
            i32.const 399
            i32.const 1
            i32.store8
            get_local $iCandidates
            set_local $iFound
        end
        ;; iNode = iFound;
        get_local $iFound
        tee_local $iNode
        ;; // 5. If the prevailing rule is a exception rule, modify it by
        ;; //    removing the leftmost label.
        ;; if ( (buf32[iNode+0] & 0x00000200) !== 0 ) {
        ;;     if ( iLabel > LABEL_INDICES_SLOT ) {
        ;;         return iLabel - 2;
        ;;     }
        ;;     break;
        ;; }
        i32.load8_u offset=1
        tee_local $_1
        i32.const 0x02
        i32.and
        if
            get_local $iLabel
            i32.const 256
            i32.gt_u
            if
                get_local $iLabel
                i32.const -2
                i32.add
                return
            end
            br $labelLookupDone
        end
        ;; if ( (buf32[iNode+0] & 0x00000100) !== 0 ) {
        ;;     cursorPos = labelBeg;
        ;; }
        get_local $_1
        i32.const 0x01
        i32.and
        if
            get_local $iLabel
            set_local $cursorPos
        end
        ;; if ( labelBeg === 0 ) { break; }
        get_local $labelBeg
        i32.eqz
        br_if $labelLookupDone
        ;; iLabel += 2;
        get_local $iLabel
        i32.const 2
        i32.add
        set_local $iLabel
        br $labelLookup
    end end
    get_local $cursorPos
)

;;
;; module end
;;
)

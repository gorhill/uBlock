/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2020-present Raymond Hill

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

/* globals CSSStyleSheet, document */

'use strict';

/******************************************************************************/

import Regex from '../lib/regexanalyzer/regex.js';

/*******************************************************************************

    The goal is for the static filtering parser to avoid external
    dependencies to other code in the project.

    Roughly, this is how things work: each input string (passed to analyze())
    is decomposed into a minimal set of distinct slices. Each slice is a
    triplet of integers consisting of:

    - a bit vector describing the characters inside the slice
    - an index of where in the origin string the slice starts
    - a length for the number of character in the slice

    Slice descriptors are all flatly stored in an array of integers so as to
    avoid the need for a secondary data structure. Example:

    raw string: toto.com
                  toto         .           com
                  |            |           |
        slices: [ 65536, 0, 4, 1024, 4, 1, 65536, 5, 3 ]
                  ^      ^  ^
                  |      |  |
                  |      |  +---- number of characters
                  |      +---- index in raw string
                  +---- bit vector

    Thus the number of slices to describe the `toto.com` string is made of
    three slices, encoded into nine integers.

    Once a string has been encoded into slices, the parser will only work
    with those slices in order to parse the filter represented by the
    string, rather than performing string operations on the original string.
    The result is that parsing is essentially number-crunching operations
    rather than string operations, for the most part (potentially opening
    the door for WASM code in the future to parse static filters).

    The array used to hold the slices is reused across string analysis, in
    order to eliminate memory churning.

    Beyond the slices, there are various span objects used to describe
    consecutive sequences of slices and which are filled in as a result
    of parsing.

**/

/******************************************************************************/

const Parser = class {
    constructor(options = {}) {
        this.interactive = options.interactive === true;
        this.raw = '';
        this.slices = [];
        this.leftSpaceSpan = new Span();
        this.exceptionSpan = new Span();
        this.patternLeftAnchorSpan = new Span();
        this.patternSpan = new Span();
        this.patternRightAnchorSpan = new Span();
        this.optionsAnchorSpan = new Span();
        this.optionsSpan = new Span();
        this.commentSpan = new Span();
        this.rightSpaceSpan = new Span();
        this.eolSpan = new Span();
        this.spans = [
            this.leftSpaceSpan,
            this.exceptionSpan,
            this.patternLeftAnchorSpan,
            this.patternSpan,
            this.patternRightAnchorSpan,
            this.optionsAnchorSpan,
            this.optionsSpan,
            this.commentSpan,
            this.rightSpaceSpan,
            this.eolSpan,
        ];
        this.patternTokenIterator = new PatternTokenIterator(this);
        this.netOptionsIterator = new NetOptionsIterator(this);
        this.extOptionsIterator = new ExtOptionsIterator(this);
        this.maxTokenLength = Number.MAX_SAFE_INTEGER;
        this.expertMode = options.expertMode !== false;
        this.reIsLocalhostRedirect = /(?:0\.0\.0\.0|broadcasthost|local|localhost(?:\.localdomain)?|ip6-\w+)(?:[^\w.-]|$)/;
        this.reHostname = /^[^\x00-\x24\x26-\x29\x2B\x2C\x2F\x3A-\x40\x5B-\x5E\x60\x7B-\x7F]+/;
        this.reHostsSink = /^[\w%.:\[\]-]+$/;
        this.reHostsSource = /^[^\x00-\x24\x26-\x29\x2B\x2C\x2F\x3A-\x40\x5B-\x5E\x60\x7B-\x7F]+$/;
        this.reUnicodeChar = /[^\x00-\x7F]/;
        this.reUnicodeChars = /[^\x00-\x7F]/g;
        this.reHostnameLabel = /[^.]+/g;
        this.rePlainHostname = /^(?:[\w-]+\.)*[a-z]+$/;
        this.rePlainEntity = /^(?:[\w-]+\.)+\*$/;
        this.reEntity = /^[^*]+\.\*$/;
        // https://github.com/uBlockOrigin/uBlock-issues/issues/1146
        //   From https://codemirror.net/doc/manual.html#option_specialChars
        this.reInvalidCharacters = /[\x00-\x1F\x7F-\x9F\xAD\u061C\u200B-\u200F\u2028\u2029\uFEFF\uFFF9-\uFFFC]/;
        this.punycoder = new URL('https://ublock0.invalid/');
        // TODO: mind maxTokenLength
        this.reGoodRegexToken
            = /[^\x01%0-9A-Za-z][%0-9A-Za-z]{7,}|[^\x01%0-9A-Za-z][%0-9A-Za-z]{1,6}[^\x01%0-9A-Za-z]/;
        this.selectorCompiler = new this.SelectorCompiler(this);
        // TODO: reuse for network filtering analysis
        this.result = {
            exception: false,
            raw: '',
            compiled: '',
        };
        this.reset();
    }

    reset() {
        this.sliceWritePtr = 0;
        this.category = CATNone;
        this.allBits = 0;       // bits found in any slices
        this.patternBits = 0;   // bits found in any pattern slices
        this.optionsBits = 0;   // bits found in any option slices
        this.flavorBits = 0;
        for ( const span of this.spans ) { span.reset(); }
        this.pattern = '';
    }

    analyze(raw) {
        this.slice(raw);
        let slot = this.leftSpaceSpan.len;
        if ( slot === this.rightSpaceSpan.i ) { return; }

        // test for `!`, `#`, or `[`
        if ( hasBits(this.slices[slot], BITLineComment) ) {
            // static extended filter?
            if ( hasBits(this.slices[slot], BITHash) ) {
                this.analyzeExt(slot);
                if ( this.category === CATStaticExtFilter ) { return; }
            }
            // if not `#`, no ambiguity
            this.category = CATComment;
            return;
        }

        // assume no inline comment
        this.commentSpan.i = this.rightSpaceSpan.i;

        // extended filtering with options?
        if ( hasBits(this.allBits, BITHash) ) {
            let hashSlot = this.findFirstMatch(slot, BITHash);
            if ( hashSlot !== -1 ) {
                this.analyzeExt(hashSlot);
                if ( this.category === CATStaticExtFilter ) { return; }
                // inline comment? (a space followed by a hash)
                if ( (this.allBits & BITSpace) !== 0 ) {
                    for (;;) {
                        if ( hasBits(this.slices[hashSlot-3], BITSpace) ) {
                            this.commentSpan.i = hashSlot-3;
                            this.commentSpan.len = this.rightSpaceSpan.i - hashSlot;
                            break;
                        }
                        hashSlot = this.findFirstMatch(hashSlot + 6, BITHash);
                        if ( hashSlot === -1 ) { break; }
                    }
                }
            }
        }
        // assume network filtering
        this.analyzeNet();
    }

    // Use in syntax highlighting contexts
    analyzeExtra() {
        if ( this.category === CATStaticExtFilter ) {
            this.analyzeExtExtra();
        } else if ( this.category === CATStaticNetFilter ) {
            this.analyzeNetExtra();
        }
    }

    // Static extended filters are all of the form:
    //
    // 1. options (optional): a comma-separated list of hostnames
    // 2. anchor: regex equivalent => /^#@?[\$\??|%|\?)?#$/
    // 3. pattern
    //
    // Return true if a valid extended filter is found, otherwise false.
    // When a valid extended filter is found:
    //     optionsSpan: first slot which contains options
    //     optionsAnchorSpan: first slot to anchor
    //     patternSpan: first slot to pattern
    analyzeExt(from) {
        let end = this.rightSpaceSpan.i;
        // Number of consecutive #s.
        const len = this.slices[from+2];
        // More than 3 #s is likely to be a comment in a hosts file.
        if ( len > 3 ) { return; }
        if ( len !== 1 ) {
            // If a space immediately follows 2 #s, assume a comment.
            if ( len === 2 ) {
                if ( from+3 === end || hasBits(this.slices[from+3], BITSpace) ) {
                    return;
                }
            } else /* len === 3 */ {
                this.splitSlot(from, 2);
                end = this.rightSpaceSpan.i;
            }
            this.optionsSpan.i = this.leftSpaceSpan.i + this.leftSpaceSpan.len;
            this.optionsSpan.len = from - this.optionsSpan.i;
            this.optionsAnchorSpan.i = from;
            this.optionsAnchorSpan.len = 3;
            this.patternSpan.i = from + 3;
            this.patternSpan.len = this.rightSpaceSpan.i - this.patternSpan.i;
            this.category = CATStaticExtFilter;
            this.analyzeExtPattern();
            return;
        }
        let flavorBits = 0;
        let to = from + 3;
        if ( to === end ) { return; }
        // #@...
        //  ^
        if ( hasBits(this.slices[to], BITAt) ) {
            if ( this.slices[to+2] !== 1 ) { return; }
            flavorBits |= BITFlavorException;
            to += 3; if ( to === end ) { return; }
        }
        // #$...
        //  ^
        if ( hasBits(this.slices[to], BITDollar) ) {
            if ( this.slices[to+2] !== 1 ) { return; }
            flavorBits |= BITFlavorExtStyle;
            to += 3; if ( to === end ) { return; }
            // #$?...
            //   ^
            if ( hasBits(this.slices[to], BITQuestion) ) {
                if ( this.slices[to+2] !== 1 ) { return; }
                flavorBits |= BITFlavorExtStrong;
                to += 3; if ( to === end ) { return; }
            }
        }
        // #[%?]...
        //   ^^
        else if ( hasBits(this.slices[to], BITPercent | BITQuestion) ) {
            if ( this.slices[to+2] !== 1 ) { return; }
            flavorBits |= hasBits(this.slices[to], BITQuestion)
                ? BITFlavorExtStrong
                : BITFlavorUnsupported;
            to += 3; if ( to === end ) { return; }
        }
        // ##...
        //  ^
        if ( hasNoBits(this.slices[to], BITHash) ) { return; }
        if ( this.slices[to+2] > 1 ) {
            this.splitSlot(to, 1);
        }
        to += 3;
        this.optionsSpan.i = this.leftSpaceSpan.i + this.leftSpaceSpan.len;
        this.optionsSpan.len = from - this.optionsSpan.i;
        this.optionsAnchorSpan.i = from;
        this.optionsAnchorSpan.len = to - this.optionsAnchorSpan.i;
        this.patternSpan.i = to;
        this.patternSpan.len = this.rightSpaceSpan.i - to;
        this.flavorBits = flavorBits;
        this.category = CATStaticExtFilter;
        this.analyzeExtPattern();
    }

    analyzeExtPattern() {
        this.result.exception = this.isException();
        this.result.compiled = undefined;

        let selector = this.strFromSpan(this.patternSpan);
        if ( selector === '' ) {
            this.flavorBits |= BITFlavorUnsupported;
            this.result.raw = '';
            return;
        }
        const { i } = this.patternSpan;
        // ##+js(...)
        if (
            hasBits(this.slices[i], BITPlus) &&
            selector.startsWith('+js(') && selector.endsWith(')')
        ) {
            this.flavorBits |= BITFlavorExtScriptlet;
            this.result.raw = selector;
            this.result.compiled = selector.slice(4, -1);
            return;
        }
        // ##^...
        if ( hasBits(this.slices[i], BITCaret) ) {
            // ##^responseheader(...)
            if (
                selector.startsWith('^responseheader(') &&
                selector.endsWith(')')
            ) {
                this.flavorBits |= BITFlavorExtResponseHeader;
                this.result.raw = selector.slice(1);
                const headerName = selector.slice(16, -1).trim().toLowerCase();
                this.result.compiled = `responseheader(${headerName})`;
                if ( this.removableHTTPHeaders.has(headerName) === false ) {
                    this.flavorBits |= BITFlavorUnsupported;
                }
                return;
            }
            this.flavorBits |= BITFlavorExtHTML;
            selector = selector.slice(1);
            if ( (this.hasOptions() || this.isException()) === false ) {
                this.flavorBits |= BITFlavorUnsupported;
            }
        }
        // ##...
        else {
            this.flavorBits |= BITFlavorExtCosmetic;
        }
        this.result.raw = selector;
        if (
            this.selectorCompiler.compile(
                selector,
                hasBits(this.flavorBits, BITFlavorExtStrong | BITFlavorExtStyle),
                this.result
            ) === false
        ) {
            this.flavorBits |= BITFlavorUnsupported;
        }
    }

    // Use in syntax highlighting contexts
    analyzeExtExtra() {
        if ( this.hasOptions() ) {
            const { i, len } = this.optionsSpan;
            this.analyzeDomainList(i, i + len, BITComma, 0b1110);
        }
        if ( hasBits(this.flavorBits, BITFlavorUnsupported) ) {
            this.markSpan(this.patternSpan, BITError);
        }
    }

    // Static network filters are all of the form:
    //
    // 1. exception declarator (optional): `@@`
    // 2. left-hand pattern anchor (optional): `||` or `|`
    // 3. pattern: a valid pattern, one of
    //       a regex, starting and ending with `/`
    //       a sequence of characters with optional wildcard characters
    //          wildcard `*` : regex equivalent => /./
    //          wildcard `^` : regex equivalent => /[^%.0-9a-z_-]|$/
    // 4. right-hand anchor (optional): `|`
    // 5. options declarator (optional): `$`
    //       options: one or more options
    // 6. inline comment (optional): ` #`
    //
    // When a valid static filter is found:
    //     exceptionSpan: first slice of exception declarator
    //     patternLeftAnchorSpan: first slice to left-hand pattern anchor
    //     patternSpan: all slices belonging to pattern
    //     patternRightAnchorSpan: first slice to right-hand pattern anchor
    //     optionsAnchorSpan: first slice to options anchor
    //     optionsSpan: first slice to options
    //     commentSpan: first slice to trailing comment
    analyzeNet() {
        let islice = this.leftSpaceSpan.len;

        // Assume no exception
        this.exceptionSpan.i = this.leftSpaceSpan.len;
        // Exception?
        if (
            islice < this.commentSpan.i &&
            hasBits(this.slices[islice], BITAt)
        ) {
            const len = this.slices[islice+2];
            // @@@*, ...  =>  @@, @*, ...
            if ( len >= 2 ) {
                if ( len > 2 ) {
                    this.splitSlot(islice, 2);
                }
                this.exceptionSpan.len = 3;
                islice += 3;
                this.flavorBits |= BITFlavorException;
            }
        }

        // Assume no options
        this.optionsAnchorSpan.i = this.optionsSpan.i = this.commentSpan.i;

        // Assume all is part of pattern
        this.patternSpan.i = islice;
        this.patternSpan.len = this.optionsAnchorSpan.i - islice;

        let patternStartIsRegex =
            islice < this.optionsAnchorSpan.i &&
            hasBits(this.slices[islice], BITSlash);
        let patternIsRegex = patternStartIsRegex;
        if ( patternStartIsRegex ) {
            const { i, len } = this.patternSpan;
            patternIsRegex = (
                len === 3 && this.slices[i+2] > 2 ||
                len > 3 && hasBits(this.slices[i+len-3], BITSlash)
            );
            // https://github.com/uBlockOrigin/uBlock-issues/issues/1932
            //   Resolve ambiguity with options ending with `/` by verifying
            //   that when a `$` is present, what follows make sense regex-wise.
            if ( patternIsRegex && hasBits(this.allBits, BITDollar) ) {
                patternIsRegex =
                    this.strFromSpan(this.patternSpan).search(/[^\\]\$[^/|)]/) === -1;
            }
        }

        // If the pattern is not a regex, there might be options.
        //
        // The character `$` is deemed to be an option anchor if and only if
        // all the following conditions are fulfilled:
        // - `$` is not the last character in the filter
        // - The character following `$` is either comma, alphanumeric, or `~`.
        if ( patternIsRegex === false ) {
            let optionsBits = 0;
            let i = this.optionsAnchorSpan.i - 3;
            for (;;) {
                i -= 3;
                if ( i < islice ) { break; }
                const bits = this.slices[i];
                if (
                    hasBits(bits, BITDollar) &&
                    hasBits(this.slices[i+3], BITAlphaNum | BITComma | BITTilde)
                ) {
                    break;
                }
                optionsBits |= bits;
            }
            if ( i >= islice ) {
                const len = this.slices[i+2];
                if ( len > 1 ) {
                    // https://github.com/gorhill/uBlock/issues/952
                    //   AdGuard-specific `$$` filters => unsupported.
                    if ( this.findFirstOdd(0, BITHostname | BITComma | BITAsterisk) === i ) {
                        this.flavorBits |= BITFlavorError;
                        if ( this.interactive ) {
                            this.errorSlices(i, i+3);
                        }
                    } else {
                        this.splitSlot(i, len - 1);
                        i += 3;
                    }
                }
                this.patternSpan.len = i - this.patternSpan.i;
                this.optionsAnchorSpan.i = i;
                this.optionsAnchorSpan.len = 3;
                i += 3;
                this.optionsSpan.i = i;
                this.optionsSpan.len = this.commentSpan.i - i;
                this.optionsBits = optionsBits;
                if ( patternStartIsRegex ) {
                    const { i, len } = this.patternSpan;
                    patternIsRegex = (
                        len === 3 && this.slices[i+2] > 2 ||
                        len > 3 && hasBits(this.slices[i+len-3], BITSlash)
                    );
                }
            }
        }

        // Assume no anchors.
        this.patternLeftAnchorSpan.i = this.patternSpan.i;
        this.patternRightAnchorSpan.i = this.optionsAnchorSpan.i;

        // Skip all else if pattern is a regex
        if ( patternIsRegex ) {
            this.patternBits = this.bitsFromSpan(this.patternSpan);
            this.flavorBits |= BITFlavorNetRegex;
            this.category = CATStaticNetFilter;
            return;
        }

        // Refine by processing pattern anchors.
        //
        // Not a regex, there might be anchors.
        // Left anchor?
        //   `|`: anchor to start of URL
        //   `||`: anchor to left of a hostname label
        if (
            this.patternSpan.len !== 0 &&
            hasBits(this.slices[this.patternSpan.i], BITPipe)
        ) {
            this.patternLeftAnchorSpan.len = 3;
            const len = this.slices[this.patternSpan.i+2];
            // |||*, ...  =>  ||, |*, ...
            if ( len > 2 ) {
                this.splitSlot(this.patternSpan.i, 2);
            } else {
                this.patternSpan.len -= 3;
            }
            this.patternSpan.i += 3;
            this.flavorBits |= len === 1
                ? BITFlavorNetLeftURLAnchor
                : BITFlavorNetLeftHnAnchor;
        }
        // Right anchor?
        //   `|`: anchor to end of URL
        //   `^`: anchor to end of hostname, when other conditions are
        //        fulfilled:
        //          the pattern is hostname-anchored on the left
        //          the pattern is made only of hostname characters
        if ( this.patternSpan.len !== 0 ) {
            const lastPatternSlice = this.patternSpan.len > 3
                ? this.patternRightAnchorSpan.i - 3
                : this.patternSpan.i;
            const bits = this.slices[lastPatternSlice];
            if ( (bits & BITPipe) !== 0 ) {
                this.patternRightAnchorSpan.i = lastPatternSlice;
                this.patternRightAnchorSpan.len = 3;
                const len = this.slices[this.patternRightAnchorSpan.i+2];
                // ..., ||*  =>  ..., |*, |
                if ( len > 1 ) {
                    this.splitSlot(this.patternRightAnchorSpan.i, len - 1);
                    this.patternRightAnchorSpan.i += 3;
                } else {
                    this.patternSpan.len -= 3;
                }
                this.flavorBits |= BITFlavorNetRightURLAnchor;
            } else if (
                hasBits(bits, BITCaret) &&
                this.slices[lastPatternSlice+2] === 1 &&
                hasBits(this.flavorBits, BITFlavorNetLeftHnAnchor) &&
                this.skipUntilNot(
                    this.patternSpan.i,
                    lastPatternSlice,
                    BITHostname
                ) === lastPatternSlice
            ) {
                this.patternRightAnchorSpan.i = lastPatternSlice;
                this.patternRightAnchorSpan.len = 3;
                this.patternSpan.len -= 3;
                this.flavorBits |= BITFlavorNetRightHnAnchor;
            }
        }

        // Collate useful pattern bits information for further use.
        //
        // https://github.com/gorhill/httpswitchboard/issues/15
        //   When parsing a hosts file, ensure localhost et al. don't end up
        //   in the pattern. To accomplish this we establish the rule that
        //   if a pattern contains a space character, the pattern will be only
        //   the part following the space character.
        // https://github.com/uBlockOrigin/uBlock-issues/issues/1118
        //   Patterns with more than one space are dubious.
        if ( hasBits(this.allBits, BITSpace) ) {
            const { i, len } = this.patternSpan;
            const noOptionsAnchor = this.optionsAnchorSpan.len === 0;
            let j = len;
            for (;;) {
                if ( j === 0 ) { break; }
                j -= 3;
                if ( noOptionsAnchor && hasBits(this.slices[i+j], BITSpace) ) {
                    break;
                }
            }
            if ( j !== 0 ) {
                const sink = this.strFromSlices(this.patternSpan.i, j - 3);
                if ( this.reHostsSink.test(sink) ) {
                    this.patternSpan.i += j + 3;
                    this.patternSpan.len -= j + 3;
                    if ( this.interactive ) {
                        this.markSlices(0, this.patternSpan.i, BITIgnore);
                    }
                    const source = this.getNetPattern();
                    if ( this.reIsLocalhostRedirect.test(source) ) {
                        this.flavorBits |= BITFlavorIgnore;
                    } else if ( this.reHostsSource.test(source) === false ) {
                        this.patternBits |= BITError;
                    }
                } else {
                    this.patternBits |= BITError;
                }
                if ( hasBits(this.patternBits, BITError) ) {
                    this.markSpan(this.patternSpan, BITError);
                }
            }
        }

        // Pointless wildcards:
        // - Eliminate leading wildcard not followed by a pattern token slice
        // - Eliminate trailing wildcard not preceded by a pattern token slice
        // - Eliminate pointless trailing asterisk-caret (`*^`)
        //
        // Leading wildcard history:
        // https://github.com/gorhill/uBlock/issues/1669#issuecomment-224822448
        //   Remove pointless leading *.
        if ( hasBits(this.allBits, BITAsterisk) ) {
            let { i, len } = this.patternSpan;
            let pattern = this.strFromSpan(this.patternSpan);
            // Pointless leading wildcard
            if ( /^\*+[^0-9a-z%]/.test(pattern) ) {
                this.slices[i] |= BITIgnore;
                this.patternSpan.i = (i += 3);
                this.patternSpan.len = (len -= 3);
                pattern = this.strFromSpan(this.patternSpan);
            }
            // Pointless trailing wildcard
            if ( /([^0-9a-z%]|[0-9a-z%]{7,})\*+$/.test(pattern) ) {
                this.patternSpan.len = (len -= 3);
                pattern = this.strFromSpan(this.patternSpan);
                // Ignore only if the pattern would not end up looking like
                // a regex.
                if ( /^\/.+\/$/.test(pattern) === false ) {
                    this.slices[i+len] |= BITIgnore;
                }
                // We can ignore right-hand pattern anchor
                if ( this.patternRightAnchorSpan.len !== 0 ) {
                    this.slices[this.patternRightAnchorSpan.i] |= BITIgnore;
                    this.flavorBits &= ~BITFlavorNetRightAnchor;
                }
            }
            // Pointless trailing asterisk-caret: `..*^`,  `..*^|`
            if ( hasBits(this.allBits, BITCaret) && /\*+\^$/.test(pattern) ) {
                this.slices[i+len-3] |= BITIgnore;
                this.slices[i+len-6] |= BITIgnore;
                this.patternSpan.len = (len -= 6);
                pattern = this.strFromSpan(this.patternSpan);
                // We can ignore right-hand pattern anchor
                if ( this.patternRightAnchorSpan.len !== 0 ) {
                    this.slices[this.patternRightAnchorSpan.i] |= BITIgnore;
                    this.flavorBits &= ~BITFlavorNetRightAnchor;
                }
            }
        }

        // Pointless left-hand pattern anchoring
        //
        // Leading wildcard history:
        // https://github.com/gorhill/uBlock/issues/3034
        //   We can remove anchoring if we need to match all at the start.
        if ( hasBits(this.flavorBits, BITFlavorNetLeftAnchor) ) {
            const i = this.patternLeftAnchorSpan.i;
            if (
                this.patternSpan.len === 0 ||
                hasBits(this.slices[i+3], BITIgnore|BITAsterisk)
            ) {
                this.slices[i] |= BITIgnore;
                this.flavorBits &= ~BITFlavorNetLeftAnchor;
            }
        }

        // Pointless right-hand pattern anchoring
        //
        // Trailing wildcard history:
        // https://github.com/gorhill/uBlock/issues/3034
        //   We can remove anchoring if we need to match all at the end.
        if ( hasBits(this.flavorBits, BITFlavorNetRightAnchor) ) {
            const i = this.patternRightAnchorSpan.i;
            if (
                this.patternSpan.len === 0 ||
                hasBits(this.slices[i-3], BITIgnore|BITAsterisk)
            ) {
                this.slices[i] |= BITIgnore;
                this.flavorBits &= ~BITFlavorNetRightAnchor;
            }
        }

        // Collate effective pattern bits
        this.patternBits = this.bitsFromSpan(this.patternSpan);

        this.category = CATStaticNetFilter;
    }

    analyzeNetExtra() {
        if ( this.patternIsRegex() ) {
            if ( this.regexUtils.isValid(this.getNetPattern()) === false ) {
                this.markSpan(this.patternSpan, BITError);
            }
        } else if (
            this.patternIsDubious() === false &&
            this.toASCII(true) === false
        ) {
            this.errorSlices(
                this.patternLeftAnchorSpan.i,
                this.optionsAnchorSpan.i
            );
        }
        this.netOptionsIterator.init();
    }

    analyzeDomainList(from, to, bitSeparator, optionBits) {
        if ( from >= to ) { return; }
        let beg = from;
        // Dangling leading separator?
        if ( hasBits(this.slices[beg], bitSeparator) ) {
            this.errorSlices(beg, beg + 3);
            beg += 3;
        }
        while ( beg < to ) {
            let end = this.skipUntil(beg, to, bitSeparator);
            if ( end < to && this.slices[end+2] !== 1 ) {
                this.errorSlices(end, end + 3);
            }
            if ( this.analyzeDomain(beg, end, optionBits) === false ) {
                this.errorSlices(beg, end);
            }
            beg = end + 3;
        }
        // Dangling trailing separator?
        if ( hasBits(this.slices[to-3], bitSeparator) ) {
            this.errorSlices(to - 3, to);
        }
    }

    analyzeDomain(from, to, modeBits) {
        if ( to === from ) { return false; }
        return this.normalizeHostnameValue(
            this.strFromSlices(from, to - 3),
            modeBits
        ) !== undefined;
    }

    // Ultimately, let the browser API do the hostname normalization, after
    // making some other trivial checks.
    //
    // modeBits:
    //   0: can use wildcard at any position
    //   1: can use entity-based hostnames
    //   2: can use single wildcard
    //   3: can be negated
    normalizeHostnameValue(s, modeBits = 0b0000) {
        const not = s.charCodeAt(0) === 0x7E /* '~' */;
        if ( not && (modeBits & 0b1000) === 0 ) { return; }
        let hn = not === false ? s : s.slice(1);
        if ( this.rePlainHostname.test(hn) ) { return s; }
        const hasWildcard = hn.lastIndexOf('*') !== -1;
        if ( hasWildcard ) {
            if ( modeBits === 0 ) { return; }
            if ( hn.length === 1 ) {
                if ( not || (modeBits & 0b0100) === 0 ) { return; }
                return s;
            }
            if ( (modeBits & 0b0010) !== 0 ) {
                if ( this.rePlainEntity.test(hn) ) { return s; }
                if ( this.reEntity.test(hn) === false ) { return; }
            } else if ( (modeBits & 0b0001) === 0 ) {
                return;
            }
            hn = hn.replace(/\*/g, '__asterisk__');
        }
        this.punycoder.hostname = '_';
        try {
            this.punycoder.hostname = hn;
            hn = this.punycoder.hostname;
        } catch (_) {
            return;
        }
        if ( hn === '_' || hn === '' ) { return; }
        if ( hasWildcard ) {
            hn = this.punycoder.hostname.replace(/__asterisk__/g, '*');
        }
        if (
            (modeBits & 0b0001) === 0 && (
                hn.charCodeAt(0) === 0x2E /* '.' */ ||
                hn.charCodeAt(hn.length - 1) === 0x2E /* '.' */
            )
        ) {
            return;
        }
        return not ? '~' + hn : hn;
    }

    slice(raw) {
        this.reset();
        this.raw = raw;
        const rawEnd = raw.length;
        if ( rawEnd === 0 ) { return; }
        // All unicode characters are allowed in hostname
        const unicodeBits = BITUnicode | BITAlpha;
        // Create raw slices
        const slices = this.slices;
        let ptr = this.sliceWritePtr;
        let c = raw.charCodeAt(0);
        let aBits = c < 0x80 ? charDescBits[c] : unicodeBits;
        slices[ptr+0] = aBits;
        slices[ptr+1] = 0;
        ptr += 2;
        let allBits = aBits;
        let i = 0, j = 1;
        while ( j < rawEnd ) {
            c = raw.charCodeAt(j);
            const bBits = c < 0x80 ? charDescBits[c] : unicodeBits;
            if ( bBits !== aBits ) {
                slices[ptr+0] = j - i;
                slices[ptr+1] = bBits;
                slices[ptr+2] = j;
                ptr += 3;
                allBits |= bBits;
                aBits = bBits;
                i = j;
            }
            j += 1;
        }
        slices[ptr+0] = j - i;
        ptr += 1;
        // End-of-line slice
        this.eolSpan.i = ptr;
        slices[ptr+0] = 0;
        slices[ptr+1] = rawEnd;
        slices[ptr+2] = 0;
        ptr += 3;
        // Trim left
        if ( (slices[0] & BITSpace) !== 0 ) {
            this.leftSpaceSpan.len = 3;
        } else {
            this.leftSpaceSpan.len = 0;
        }
        // Trim right
        const lastSlice = this.eolSpan.i - 3;
        if (
            (lastSlice > this.leftSpaceSpan.i) &&
            (slices[lastSlice] & BITSpace) !== 0
        ) {
            this.rightSpaceSpan.i = lastSlice;
            this.rightSpaceSpan.len = 3;
        } else {
            this.rightSpaceSpan.i = this.eolSpan.i;
            this.rightSpaceSpan.len = 0;
        }
        // Quit cleanly
        this.sliceWritePtr = ptr;
        this.allBits = allBits;
    }

    splitSlot(slot, len) {
        this.sliceWritePtr += 3;
        if ( this.sliceWritePtr > this.slices.length ) {
            this.slices.push(0, 0, 0);
        }
        this.slices.copyWithin(slot + 3, slot, this.sliceWritePtr - 3);
        this.slices[slot+3+1] = this.slices[slot+1] + len;
        this.slices[slot+3+2] = this.slices[slot+2] - len;
        this.slices[slot+2] = len;
        for ( const span of this.spans ) {
            if ( span.i > slot ) {
                span.i += 3;
            }
        }
    }

    markSlices(beg, end, bits) {
        while ( beg < end ) {
            this.slices[beg] |= bits;
            beg += 3;
        }
    }

    markSpan(span, bits) {
        const { i, len } = span;
        this.markSlices(i, i + len, bits);
    }

    unmarkSlices(beg, end, bits) {
        while ( beg < end ) {
            this.slices[beg] &= ~bits;
            beg += 3;
        }
    }

    errorSlices(beg, end) {
        this.markSlices(beg, end, BITError);
    }

    findFirstMatch(from, bits) {
        let to = from;
        while ( to < this.sliceWritePtr ) {
            if ( (this.slices[to] & bits) !== 0 ) { return to; }
            to += 3;
        }
        return -1;
    }

    findFirstOdd(from, bits) {
        let to = from;
        while ( to < this.sliceWritePtr ) {
            if ( (this.slices[to] & bits) === 0 ) { return to; }
            to += 3;
        }
        return -1;
    }

    skipUntil(from, to, bits) {
        let i = from;
        while ( i < to ) {
            if ( (this.slices[i] & bits) !== 0 ) { break; }
            i += 3;
        }
        return i;
    }

    skipUntilNot(from, to, bits) {
        let i = from;
        while ( i < to ) {
            if ( (this.slices[i] & bits) === 0 ) { break; }
            i += 3;
        }
        return i;
    }

    // Important: the from-to indices are inclusive.
    strFromSlices(from, to) {
        return this.raw.slice(
            this.slices[from+1],
            this.slices[to+1] + this.slices[to+2]
        );
    }

    strFromSpan(span) {
        if ( span.len === 0 ) { return ''; }
        const beg = span.i;
        return this.strFromSlices(beg, beg + span.len - 3);
    }

    isBlank() {
        return this.allBits === BITSpace;
    }

    hasOptions() {
        return this.optionsSpan.len !== 0;
    }

    getPattern() {
        if ( this.pattern !== '' ) { return this.pattern; }
        const { i, len } = this.patternSpan;
        if ( len === 0 ) { return ''; }
        let beg = this.slices[i+1];
        let end = this.slices[i+len+1];
        this.pattern = this.raw.slice(beg, end);
        return this.pattern;
    }

    getNetPattern() {
        if ( this.pattern !== '' ) { return this.pattern; }
        const { i, len } = this.patternSpan;
        if ( len === 0 ) { return ''; }
        let beg = this.slices[i+1];
        let end = this.slices[i+len+1];
        if ( hasBits(this.flavorBits, BITFlavorNetRegex) ) {
            beg += 1; end -= 1;
        }
        this.pattern = this.raw.slice(beg, end);
        return this.pattern;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/1096
    // https://github.com/ryanbr/fanboy-adblock/issues/1384
    // Examples of dubious filter content:
    //   - Spaces characters
    //   - Single character with no options
    //   - Wildcard(s) with no options
    //   - Zero-length pattern with no options
    patternIsDubious() {
        if ( hasBits(this.patternBits, BITError) ) { return true; }
        if ( hasBits(this.patternBits, BITSpace) ) {
            if ( this.interactive ) {
                this.markSpan(this.patternSpan, BITError);
            }
            return true;
        }
        if ( this.patternSpan.len > 3 || this.optionsSpan.len !== 0 ) {
            return false;
        }
        if (
            this.patternSpan.len === 3 &&
            this.slices[this.patternSpan.i+2] !== 1 &&
            hasNoBits(this.patternBits, BITAsterisk)
        ) {
            return false;
        }
        if ( this.interactive === false ) { return true; }
        let l, r;
        if ( this.patternSpan.len !== 0 ) {
            l = this.patternSpan.i;
            r = this.optionsAnchorSpan.i;
        } else {
            l = this.patternLeftAnchorSpan.i;
            r = this.patternLeftAnchorSpan.len !== 0
                ? this.optionsAnchorSpan.i
                : this.optionsSpan.i;
        }
        this.errorSlices(l, r);
        return true;
    }

    patternIsMatchAll() {
        const { len } = this.patternSpan;
        return len === 0 ||
               len === 3 && hasBits(this.patternBits, BITAsterisk);
    }

    patternIsPlainHostname() {
        if (
            hasBits(this.patternBits, ~BITHostname) || (
                hasBits(this.flavorBits, BITFlavorNetAnchor) &&
                hasNotAllBits(this.flavorBits, BITFlavorNetHnAnchor)
            )
        ) {
            return false;
        }
        const { i, len } = this.patternSpan;
        return hasBits(this.slices[i], BITAlphaNum) &&
               hasBits(this.slices[i+len-3], BITAlphaNum);
    }

    patternIsLeftHostnameAnchored() {
        return hasBits(this.flavorBits, BITFlavorNetLeftHnAnchor);
    }

    patternIsRightHostnameAnchored() {
        return hasBits(this.flavorBits, BITFlavorNetRightHnAnchor);
    }

    patternIsLeftAnchored() {
        return hasBits(this.flavorBits, BITFlavorNetLeftURLAnchor);
    }

    patternIsRightAnchored() {
        return hasBits(this.flavorBits, BITFlavorNetRightURLAnchor);
    }

    patternIsRegex() {
        return (this.flavorBits & BITFlavorNetRegex) !== 0;
    }

    patternIsTokenizable() {
        // TODO: not necessarily true, this needs more work.
        if ( this.patternIsRegex === false ) { return true; }
        return this.reGoodRegexToken.test(
            this.regexUtils.toTokenizableStr(this.getNetPattern())
        );
    }

    patternHasWildcard() {
        return hasBits(this.patternBits, BITAsterisk);
    }

    patternHasCaret() {
        return hasBits(this.patternBits, BITCaret);
    }

    patternHasUnicode() {
        return hasBits(this.patternBits, BITUnicode);
    }

    patternHasUppercase() {
        return hasBits(this.patternBits, BITUppercase);
    }

    patternToLowercase() {
        const hasUpper = this.patternHasUppercase();
        if ( hasUpper === false && this.pattern !== '' ) {
            return this.pattern;
        }
        const { i, len } = this.patternSpan;
        if ( len === 0 ) { return ''; }
        const beg = this.slices[i+1];
        const end = this.slices[i+len+1];
        this.pattern = this.pattern || this.raw.slice(beg, end);
        if ( hasUpper === false ) { return this.pattern; }
        this.pattern = this.pattern.toLowerCase();
        this.raw = this.raw.slice(0, beg) +
                   this.pattern +
                   this.raw.slice(end);
        this.unmarkSlices(i, i + len, BITUppercase);
        this.patternBits &= ~BITUppercase;
        return this.pattern;
    }

    patternHasSpace() {
        return hasBits(this.flavorBits, BITFlavorNetSpaceInPattern);
    }

    patternHasLeadingWildcard() {
        if ( hasBits(this.patternBits, BITAsterisk) === false ) {
            return false;
        }
        const { i, len } = this.patternSpan;
        return len !== 0 && hasBits(this.slices[i], BITAsterisk);
    }

    patternHasTrailingWildcard() {
        if ( hasBits(this.patternBits, BITAsterisk) === false ) {
            return false;
        }
        const { i, len } = this.patternSpan;
        return len !== 0 && hasBits(this.slices[i+len-1], BITAsterisk);
    }

    optionHasUnicode() {
        return hasBits(this.optionsBits, BITUnicode);
    }

    netOptions() {
        return this.netOptionsIterator;
    }

    extOptions() {
        return this.extOptionsIterator;
    }

    patternTokens() {
        if ( this.category === CATStaticNetFilter ) {
            return this.patternTokenIterator;
        }
        return [];
    }

    setMaxTokenLength(len) {
        this.maxTokenLength = len;
    }

    hasUnicode() {
        return hasBits(this.allBits, BITUnicode);
    }

    toLowerCase() {
        if ( hasBits(this.allBits, BITUppercase) ) {
            this.raw = this.raw.toLowerCase();
        }
        return this.raw;
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/1118#issuecomment-650730158
    //   Be ready to deal with non-punycode-able Unicode characters.
    // https://github.com/uBlockOrigin/uBlock-issues/issues/772
    //   Encode Unicode characters beyond the hostname part.
    // Prepend with '*' character to prevent the browser API from refusing to
    // punycode -- this occurs when the extracted label starts with a dash.
    toASCII(dryrun = false) {
        if ( this.patternHasUnicode() === false ) { return true; }
        const { i, len } = this.patternSpan;
        if ( len === 0 ) { return true; }
        const patternIsRegex = this.patternIsRegex();
        let pattern = this.getNetPattern();
        if ( this.reInvalidCharacters.test(pattern) ) { return false; }
        // Punycode hostname part of the pattern.
        if ( patternIsRegex === false ) {
            const match = this.reHostname.exec(pattern);
            if ( match !== null ) {
                const hn = match[0].replace(this.reHostnameLabel, s => {
                    if ( this.reUnicodeChar.test(s) === false ) { return s; }
                    if ( s.charCodeAt(0) === 0x2D /* '-' */ ) { s = '*' + s; }
                    return this.normalizeHostnameValue(s, 0b0001) || s;
                });
                pattern = hn + pattern.slice(match.index + match[0].length);
            }
        }
        // Percent-encode remaining Unicode characters.
        if ( this.reUnicodeChar.test(pattern) ) {
            try {
                pattern = pattern.replace(
                    this.reUnicodeChars,
                    s => encodeURIComponent(s)
                );
            } catch (ex) {
                return false;
            }
        }
        if ( dryrun ) { return true; }
        if ( patternIsRegex ) {
            pattern = `/${pattern}/`;
        }
        const beg = this.slices[i+1];
        const end = this.slices[i+len+1];
        const raw = this.raw.slice(0, beg) + pattern + this.raw.slice(end);
        this.analyze(raw);
        return true;
    }

    bitsFromSpan(span) {
        const { i, len } = span;
        let bits = 0;
        for ( let j = 0; j < len; j += 3 ) {
            bits |= this.slices[i+j];
        }
        return bits;
    }

    hasFlavor(bits) {
        return hasBits(this.flavorBits, bits);
    }

    isException() {
        return hasBits(this.flavorBits, BITFlavorException);
    }

    shouldIgnore() {
        return hasBits(this.flavorBits, BITFlavorIgnore);
    }

    hasError() {
        return hasBits(this.flavorBits, BITFlavorError);
    }

    shouldDiscard() {
        return hasBits(
            this.flavorBits,
            BITFlavorError | BITFlavorUnsupported | BITFlavorIgnore
        );
    }

    static parseRedirectValue(arg) {
        let token = arg.trim();
        let priority = 0;
        const asDataURI = token.charCodeAt(0) === 0x25 /* '%' */;
        if ( asDataURI ) { token = token.slice(1); }
        const match = /:-?\d+$/.exec(token);
        if ( match !== null ) {
            priority = parseInt(token.slice(match.index + 1), 10);
            token = token.slice(0, match.index);
        }
        return { token, priority, asDataURI };
    }

    static parseQueryPruneValue(arg) {
        let s = arg.trim();
        if ( s === '' ) { return { all: true }; }
        const out = { };
        out.not = s.charCodeAt(0) === 0x7E /* '~' */;
        if ( out.not ) {
            s = s.slice(1);
        }
        const match = /^\/(.+)\/(i)?$/.exec(s);
        if ( match !== null ) {
            try {
                out.re = new RegExp(match[1], match[2] || '');
            }
            catch(ex) {
                out.bad = true;
            }
            return out;
        }
        // TODO: remove once no longer used in filter lists
        if ( s.startsWith('|') ) {
            try {
                out.re = new RegExp('^' + s.slice(1), 'i');
            } catch(ex) {
                out.bad = true;
            }
            return out;
        }
        // Multiple values not supported (because very inefficient)
        if ( s.includes('|') ) {
            out.bad = true;
            return out;
        }
        out.name = s;
        return out;
    }

    static parseHeaderValue(arg) {
        let s = arg.trim();
        const out = { };
        let pos = s.indexOf(':');
        if ( pos === -1 ) { pos = s.length; }
        out.name = s.slice(0, pos);
        out.bad = out.name === '';
        s = s.slice(pos + 1);
        out.not = s.charCodeAt(0) === 0x7E /* '~' */;
        if ( out.not ) { s = s.slice(1); }
        out.value = s;
        const match = /^\/(.+)\/(i)?$/.exec(s);
        if ( match !== null ) {
            try {
                out.re = new RegExp(match[1], match[2] || '');
            }
            catch(ex) {
                out.bad = true;
            }
        }
        return out;
    }
};

/******************************************************************************/

Parser.removableHTTPHeaders = Parser.prototype.removableHTTPHeaders = new Set([
    '',
    'location',
    'refresh',
    'report-to',
    'set-cookie',
]);

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/1004
//   Detect and report invalid CSS selectors.

// Discard new ABP's `-abp-properties` directive until it is
// implemented (if ever). Unlikely, see:
// https://github.com/gorhill/uBlock/issues/1752

// https://github.com/gorhill/uBlock/issues/2624
//   Convert Adguard's `-ext-has='...'` into uBO's `:has(...)`.

// https://github.com/uBlockOrigin/uBlock-issues/issues/89
//   Do not discard unknown pseudo-elements.

Parser.prototype.SelectorCompiler = class {
    constructor(parser) {
        this.parser = parser;
        this.reExtendedSyntax = /\[-(?:abp|ext)-[a-z-]+=(['"])(?:.+?)(?:\1)\]/;
        this.reExtendedSyntaxParser = /\[-(?:abp|ext)-([a-z-]+)=(['"])(.+?)\2\]/;
        this.reParseRegexLiteral = /^\/(.+)\/([imu]+)?$/;
        this.normalizedExtendedSyntaxOperators = new Map([
            [ 'contains', ':has-text' ],
            [ 'has', ':has' ],
            [ 'matches-css', ':matches-css' ],
            [ 'matches-css-after', ':matches-css-after' ],
            [ 'matches-css-before', ':matches-css-before' ],
        ]);
        this.reSimpleSelector = /^[#.]?[A-Za-z_][\w-]*$/;
        // https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet#browser_compatibility
        //   Firefox does not support constructor for CSSStyleSheet
        this.stylesheet = (( ) => {
            if ( typeof document !== 'object' ) { return null; }
            if ( document instanceof Object === false ) { return null; }
            try {
                return new CSSStyleSheet();
            } catch(ex) {
            }
            const style = document.createElement('style');
            document.body.append(style);
            const stylesheet = style.sheet;
            style.remove();
            return stylesheet;
        })();
        this.div = (( ) => {
            if ( typeof document !== 'object' ) { return null; }
            if ( document instanceof Object === false ) { return null; }
            return document.createElement('div');
        })();
        this.reProceduralOperator = new RegExp([
            '^(?:',
            Array.from(parser.proceduralOperatorTokens.keys()).join('|'),
            ')\\('
        ].join(''));
        this.reEatBackslashes = /\\([()])/g;
        this.reEscapeRegex = /[.*+?^${}()|[\]\\]/g;
        this.reDropScope = /^\s*:scope\s*(?=[+>~])/;
        this.reIsDanglingSelector = /[+>~\s]\s*$/;
        this.reIsCombinator = /^\s*[+>~]/;
        this.regexToRawValue = new Map();
        // https://github.com/gorhill/uBlock/issues/2793
        this.normalizedOperators = new Map([
            [ ':-abp-contains', ':has-text' ],
            [ ':-abp-has', ':has' ],
            [ ':contains', ':has-text' ],
            [ ':nth-ancestor', ':upward' ],
            [ ':watch-attrs', ':watch-attr' ],
        ]);
        this.actionOperators = new Set([
            ':remove',
            ':style',
        ]);
    }

    compile(raw, asProcedural, out) {
        // https://github.com/gorhill/uBlock/issues/952
        //   Find out whether we are dealing with an Adguard-specific cosmetic
        //   filter, and if so, translate it if supported, or discard it if not
        //   supported.
        //   We have an Adguard/ABP cosmetic filter if and only if the
        //   character is `$`, `%` or `?`, otherwise it's not a cosmetic
        //   filter.
        // Adguard's style injection: translate to uBO's format.
        if ( hasBits(this.parser.flavorBits, BITFlavorExtStyle) ) {
            raw = this.translateAdguardCSSInjectionFilter(raw);
            if ( raw === '' ) { return false; }
            this.parser.flavorBits &= ~BITFlavorExtStyle;
            out.raw = raw;
        }

        // Can be used in a declarative CSS rule?
        if ( asProcedural === false && this.sheetSelectable(raw) ) {
            out.compiled = raw;
            return true;
        }

        // We  rarely reach this point -- majority of selectors are plain
        // CSS selectors.

        // Supported Adguard/ABP advanced selector syntax: will translate
        // into uBO's syntax before further processing.
        // Mind unsupported advanced selector syntax, such as ABP's
        // `-abp-properties`.
        // Note: extended selector syntax has been deprecated in ABP, in
        // favor of the procedural one (i.e. `:operator(...)`).
        // See https://issues.adblockplus.org/ticket/5287
        if ( asProcedural && this.reExtendedSyntax.test(raw) ) {
            let matches;
            while ( (matches = this.reExtendedSyntaxParser.exec(raw)) !== null ) {
                const operator = this.normalizedExtendedSyntaxOperators.get(matches[1]);
                if ( operator === undefined ) { return false; }
                raw = raw.slice(0, matches.index) +
                      operator + '(' + matches[3] + ')' +
                      raw.slice(matches.index + matches[0].length);
            }
            return this.compile(raw, true, out);
        }

        // Procedural selector?
        const compiled = this.compileProceduralSelector(raw);
        if ( compiled === undefined ) { return false; }

        out.compiled =
            compiled.selector !== compiled.raw ||
            this.sheetSelectable(compiled.selector) === false
                ? JSON.stringify(compiled)
                : compiled.selector;

        return true;
    }

    translateAdguardCSSInjectionFilter(suffix) {
        const matches = /^(.*)\s*\{([^}]+)\}\s*$/.exec(suffix);
        if ( matches === null ) { return ''; }
        const selector = matches[1].trim();
        const style = matches[2].trim();
        // Special style directive `remove: true` is converted into a
        // `:remove()` operator.
        if ( /^\s*remove:\s*true[; ]*$/.test(style) ) {
            return `${selector}:remove()`;
        }
        // For some reasons, many of Adguard's plain cosmetic filters are
        // "disguised" as style-based cosmetic filters: convert such filters
        // to plain cosmetic filters.
        return /display\s*:\s*none\s*!important;?$/.test(style)
            ? selector
            : `${selector}:style(${style})`;
    }

    // Quick regex-based validation -- most cosmetic filters are of the
    // simple form and in such case a regex is much faster.
    // Keep in mind:
    //   https://github.com/gorhill/uBlock/issues/693
    //   https://github.com/gorhill/uBlock/issues/1955
    // https://github.com/gorhill/uBlock/issues/3111
    //   Workaround until https://bugzilla.mozilla.org/show_bug.cgi?id=1406817
    //   is fixed.
    // https://github.com/uBlockOrigin/uBlock-issues/issues/1751
    //   Do not rely on matches() or querySelector() to test whether a
    //   selector is declarative or not.
    // https://github.com/uBlockOrigin/uBlock-issues/issues/1806#issuecomment-963278382
    //   Forbid multiple and unexpected CSS style declarations.
    sheetSelectable(s) {
        if ( this.reSimpleSelector.test(s) ) { return true; }
        if ( this.stylesheet === null ) { return true; }
        try {
            this.stylesheet.insertRule(`${s}{color:red}`);
            if ( this.stylesheet.cssRules.length !== 1 ) { return false; }
            const style = this.stylesheet.cssRules[0].style;
            if ( style.length !== 1 ) { return false; }
            if ( style.getPropertyValue('color') !== 'red' ) { return false; }
            this.stylesheet.deleteRule(0);
        } catch (ex) {
            return false;
        }
        return true;
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/1806
    //   Forbid instances of:
    //   - opening comment `/*`
    querySelectable(s) {
        if ( this.reSimpleSelector.test(s) ) { return true; }
        if ( this.div === null ) { return true; }
        try {
            this.div.querySelector(`${s},${s}:not(#foo)`);
            if ( s.includes('/*') ) { return false; }
        } catch (ex) {
            return false;
        }
        return true;
    }

    compileProceduralSelector(raw) {
        const compiled = this.compileProcedural(raw, true);
        if ( compiled !== undefined ) {
            compiled.raw = this.decompileProcedural(compiled);
        }
        return compiled;
    }

    isBadRegex(s) {
        try {
            void new RegExp(s);
        } catch (ex) {
            this.isBadRegex.message = ex.toString();
            return true;
        }
        return false;
    }

    // When dealing with literal text, we must first eat _some_
    // backslash characters.
    compileText(s) {
        const match = this.reParseRegexLiteral.exec(s);
        let regexDetails;
        if ( match !== null ) {
            regexDetails = match[1];
            if ( this.isBadRegex(regexDetails) ) { return; }
            if ( match[2] ) {
                regexDetails = [ regexDetails, match[2] ];
            }
        } else {
            regexDetails = s.replace(this.reEatBackslashes, '$1')
                            .replace(this.reEscapeRegex, '\\$&');
            this.regexToRawValue.set(regexDetails, s);
        }
        return regexDetails;
    }

    compileCSSDeclaration(s) {
        const pos = s.indexOf(':');
        if ( pos === -1 ) { return; }
        const name = s.slice(0, pos).trim();
        const value = s.slice(pos + 1).trim();
        const match = this.reParseRegexLiteral.exec(value);
        let regexDetails;
        if ( match !== null ) {
            regexDetails = match[1];
            if ( this.isBadRegex(regexDetails) ) { return; }
            if ( match[2] ) {
                regexDetails = [ regexDetails, match[2] ];
            }
        } else {
            regexDetails = '^' + value.replace(this.reEscapeRegex, '\\$&') + '$';
            this.regexToRawValue.set(regexDetails, value);
        }
        return { name: name, value: regexDetails };
    }

    compileInteger(s, min = 0, max = 0x7FFFFFFF) {
        if ( /^\d+$/.test(s) === false ) { return; }
        const n = parseInt(s, 10);
        if ( n < min || n >= max ) { return; }
        return n;
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/341#issuecomment-447603588
    //   Reject instances of :not() filters for which the argument is
    //   a valid CSS selector, otherwise we would be adversely changing the
    //   behavior of CSS4's :not().
    compileNotSelector(s) {
        if ( this.querySelectable(s) === false ) {
            return this.compileProcedural(s);
        }
    }

    compileUpwardArgument(s) {
        const i = this.compileInteger(s, 1, 256);
        if ( i !== undefined ) { return i; }
        if ( this.querySelectable(s) ) { return s; }
    }

    compileNoArgument(s) {
        if ( s === '' ) { return s; }
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/382#issuecomment-703725346
    //   Prepend `:scope` only when it can be deemed implicit.
    compileSpathExpression(s) {
        if ( this.querySelectable(/^\s*[+:>~]/.test(s) ? `:scope${s}` : s) ) {
            return s;
        }
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/668
    // https://github.com/uBlockOrigin/uBlock-issues/issues/1693
    // https://github.com/uBlockOrigin/uBlock-issues/issues/1811
    //   Forbid instances of:
    //   - `image-set(`
    //   - `url(`
    //   - any instance of `//`
    //   - backslashes `\`
    //   - opening comment `/*`
    compileStyleProperties(s) {
        if ( /image-set\(|url\(|\/\s*\/|\\|\/\*/i.test(s) ) { return; }
        if ( this.stylesheet === null ) { return s; }
        let valid = false;
        try {
            this.stylesheet.insertRule(`a{${s}}`);
            const rules = this.stylesheet.cssRules;
            valid = rules.length !== 0 && rules[0].style.cssText !== '';
        } catch(ex) {
            return;
        }
        if ( this.stylesheet.cssRules.length !== 0 ) {
            this.stylesheet.deleteRule(0);
        }
        if ( valid ) { return s; }
    }

    compileAttrList(s) {
        const attrs = s.split('\s*,\s*');
        const out = [];
        for ( const attr of attrs ) {
            if ( attr !== '' ) {
                out.push(attr);
            }
        }
        return out;
    }

    compileXpathExpression(s) {
        try {
            document.createExpression(s, null);
        } catch (e) {
            return;
        }
        return s;
    }

    // https://github.com/gorhill/uBlock/issues/2793#issuecomment-333269387
    //   Normalize (somewhat) the stringified version of procedural
    //   cosmetic filters -- this increase the likelihood of detecting
    //   duplicates given that uBO is able to understand syntax specific
    //   to other blockers.
    //   The normalized string version is what is reported in the logger,
    //   by design.
    decompileProcedural(compiled) {
        const tasks = compiled.tasks || [];
        const raw = [ compiled.selector ];
        for ( const task of tasks ) {
            let value;
            switch ( task[0] ) {
            case ':has':
            case ':if':
                raw.push(`:has(${this.decompileProcedural(task[1])})`);
                break;
            case ':has-text':
            case ':matches-path':
                if ( Array.isArray(task[1]) ) {
                    value = `/${task[1][0]}/${task[1][1]}`;
                } else {
                    value = this.regexToRawValue.get(task[1]);
                    if ( value === undefined ) {
                        value = `/${task[1]}/`;
                    }
                }
                raw.push(`${task[0]}(${value})`);
                break;
            case ':matches-css':
            case ':matches-css-after':
            case ':matches-css-before':
                if ( Array.isArray(task[1].value) ) {
                    value = `/${task[1].value[0]}/${task[1].value[1]}`;
                } else {
                    value = this.regexToRawValue.get(task[1].value);
                    if ( value === undefined ) {
                        value = `/${task[1].value}/`;
                    }
                }
                raw.push(`${task[0]}(${task[1].name}: ${value})`);
                break;
            case ':not':
            case ':if-not':
                raw.push(`:not(${this.decompileProcedural(task[1])})`);
                break;
            case ':spath':
                raw.push(task[1]);
                break;
            case ':min-text-length':
            case ':others':
            case ':upward':
            case ':watch-attr':
            case ':xpath':
                raw.push(`${task[0]}(${task[1]})`);
                break;
            }
        }
        if ( Array.isArray(compiled.action) ) {
            const [ op, arg ] = compiled.action;
            raw.push(`${op}(${arg})`);
        }
        return raw.join('');
    }

    compileProcedural(raw, root = false) {
        if ( raw === '' ) { return; }

        const tasks = [];
        const n = raw.length;
        let prefix = '';
        let i = 0;
        let opPrefixBeg = 0;
        let action;

        // TODO: use slices instead of charCodeAt()
        for (;;) {
            let c, match;
            // Advance to next operator.
            while ( i < n ) {
                c = raw.charCodeAt(i++);
                if ( c === 0x3A /* ':' */ ) {
                    match = this.reProceduralOperator.exec(raw.slice(i));
                    if ( match !== null ) { break; }
                }
            }
            if ( i === n ) { break; }
            const opNameBeg = i - 1;
            const opNameEnd = i + match[0].length - 1;
            i += match[0].length;
            // Find end of argument: first balanced closing parenthesis.
            // Note: unbalanced parenthesis can be used in a regex literal
            // when they are escaped using `\`.
            // TODO: need to handle quoted parentheses.
            let pcnt = 1;
            while ( i < n ) {
                c = raw.charCodeAt(i++);
                if ( c === 0x5C /* '\\' */ ) {
                    if ( i < n ) { i += 1; }
                } else if ( c === 0x28 /* '(' */ ) {
                    pcnt +=1 ;
                } else if ( c === 0x29 /* ')' */ ) {
                    pcnt -= 1;
                    if ( pcnt === 0 ) { break; }
                }
            }
            // Unbalanced parenthesis? An unbalanced parenthesis is fine
            // as long as the last character is a closing parenthesis.
            if ( pcnt !== 0 && c !== 0x29 ) { return; }
            // https://github.com/uBlockOrigin/uBlock-issues/issues/341#issuecomment-447603588
            //   Maybe that one operator is a valid CSS selector and if so,
            //   then consider it to be part of the prefix.
            if ( this.querySelectable(raw.slice(opNameBeg, i)) ) { continue; }
            // Extract and remember operator details.
            let operator = raw.slice(opNameBeg, opNameEnd);
            operator = this.normalizedOperators.get(operator) || operator;
            // Action operator can only be used as trailing operator in the
            // root task list.
            // Per-operator arguments validation
            const args = this.compileArgument(
                operator,
                raw.slice(opNameEnd + 1, i - 1)
            );
            if ( args === undefined ) { return; }
            if ( opPrefixBeg === 0 ) {
                prefix = raw.slice(0, opNameBeg);
            } else if ( opNameBeg !== opPrefixBeg ) {
                if ( action !== undefined ) { return; }
                const spath = this.compileSpathExpression(
                    raw.slice(opPrefixBeg, opNameBeg)
                );
                if ( spath === undefined ) { return; }
                tasks.push([ ':spath', spath ]);
            }
            if ( action !== undefined ) { return; }
            const task = [ operator, args ];
            if ( this.actionOperators.has(operator) ) {
                if ( root === false ) { return; }
                action = task;
            } else {
                tasks.push(task);
            }
            opPrefixBeg = i;
            if ( i === n ) { break; }
        }

        // No task found: then we have a CSS selector.
        // At least one task found: nothing should be left to parse.
        if ( tasks.length === 0 ) {
            if ( action === undefined ) {
                prefix = raw;
            }
            if ( root && this.sheetSelectable(prefix) ) {
                if ( action === undefined ) {
                    return { selector: prefix };
                } else if ( action[0] === ':style' ) {
                    return { selector: prefix, action };
                }
            }

        } else if ( opPrefixBeg < n ) {
            if ( action !== undefined ) { return; }
            const spath = this.compileSpathExpression(raw.slice(opPrefixBeg));
            if ( spath === undefined ) { return; }
            tasks.push([ ':spath', spath ]);
        }

        // https://github.com/NanoAdblocker/NanoCore/issues/1#issuecomment-354394894
        // https://www.reddit.com/r/uBlockOrigin/comments/c6iem5/
        //   Convert sibling-selector prefix into :spath operator, but
        //   only if context is not the root.
        // https://github.com/uBlockOrigin/uBlock-issues/issues/1011#issuecomment-884806241
        //   Drop explicit `:scope` in case of leading combinator, all such
        //   cases are normalized to implicit `:scope`.
        if ( prefix !== '' ) {
            if ( this.reIsDanglingSelector.test(prefix) && tasks.length !== 0 ) {
                prefix += ' *';
            }
            prefix = prefix.replace(this.reDropScope, '');
            if ( this.querySelectable(prefix) === false ) {
                if (
                    root ||
                    this.reIsCombinator.test(prefix) === false ||
                    this.compileSpathExpression(prefix) === undefined
                ) {
                    return;
                }
                tasks.unshift([ ':spath', prefix ]);
                prefix = '';
            }
        }

        const out = { selector: prefix };

        if ( tasks.length !== 0 ) {
            out.tasks = tasks;
        }

        // Expose action to take in root descriptor.
        if ( action !== undefined ) {
            out.action = action;
        }

        return out;
    }

    compileArgument(operator, args) {
        switch ( operator ) {
        case ':has':
            return this.compileProcedural(args);
        case ':has-text':
            return this.compileText(args);
        case ':if':
            return this.compileProcedural(args);
        case ':if-not':
            return this.compileProcedural(args);
        case ':matches-css':
            return this.compileCSSDeclaration(args);
        case ':matches-css-after':
            return this.compileCSSDeclaration(args);
        case ':matches-css-before':
            return this.compileCSSDeclaration(args);
        case ':matches-path':
            return this.compileText(args);
        case ':min-text-length':
            return this.compileInteger(args);
        case ':not':
            return this.compileNotSelector(args);
        case ':others':
            return this.compileNoArgument(args);
        case ':remove':
            return this.compileNoArgument(args);
        case ':spath':
            return this.compileSpathExpression(args);
        case ':style':
            return this.compileStyleProperties(args);
        case ':upward':
            return this.compileUpwardArgument(args);
        case ':watch-attr':
            return this.compileAttrList(args);
        case ':xpath':
            return this.compileXpathExpression(args);
        default:
            break;
        }
    }
};

// bit 0: can be used as auto-completion hint
// bit 1: can not be used in HTML filtering
//
Parser.prototype.proceduralOperatorTokens = new Map([
    [ '-abp-contains', 0b00 ],
    [ '-abp-has', 0b00, ],
    [ 'contains', 0b00, ],
    [ 'has', 0b01 ],
    [ 'has-text', 0b01 ],
    [ 'if', 0b00 ],
    [ 'if-not', 0b00 ],
    [ 'matches-css', 0b11 ],
    [ 'matches-css-after', 0b11 ],
    [ 'matches-css-before', 0b11 ],
    [ 'matches-path', 0b01 ],
    [ 'min-text-length', 0b01 ],
    [ 'not', 0b01 ],
    [ 'nth-ancestor', 0b00 ],
    [ 'others', 0b01 ],
    [ 'remove', 0b11 ],
    [ 'style', 0b11 ],
    [ 'upward', 0b01 ],
    [ 'watch-attr', 0b11 ],
    [ 'watch-attrs', 0b00 ],
    [ 'xpath', 0b01 ],
]);

/******************************************************************************/

const hasNoBits = (v, bits) => (v & bits) === 0;
const hasBits = (v, bits) => (v & bits) !== 0;
const hasNotAllBits = (v, bits) => (v & bits) !== bits;
//const hasAllBits = (v, bits) => (v & bits) === bits;

/******************************************************************************/

const CATNone = 0;
const CATStaticExtFilter = 1;
const CATStaticNetFilter = 2;
const CATComment = 3;

const BITSpace          = 1 <<  0;
const BITGlyph          = 1 <<  1;
const BITExclamation    = 1 <<  2;
const BITHash           = 1 <<  3;
const BITDollar         = 1 <<  4;
const BITPercent        = 1 <<  5;
const BITParen          = 1 <<  6;
const BITAsterisk       = 1 <<  7;
const BITPlus           = 1 <<  8;
const BITComma          = 1 <<  9;
const BITDash           = 1 << 10;
const BITPeriod         = 1 << 11;
const BITSlash          = 1 << 12;
const BITNum            = 1 << 13;
const BITEqual          = 1 << 14;
const BITQuestion       = 1 << 15;
const BITAt             = 1 << 16;
const BITAlpha          = 1 << 17;
const BITUppercase      = 1 << 18;
const BITSquareBracket  = 1 << 19;
const BITBackslash      = 1 << 20;
const BITCaret          = 1 << 21;
const BITUnderscore     = 1 << 22;
const BITBrace          = 1 << 23;
const BITPipe           = 1 << 24;
const BITTilde          = 1 << 25;
const BITOpening        = 1 << 26;
const BITClosing        = 1 << 27;
const BITUnicode        = 1 << 28;
// TODO: separate from character bits into a new slice slot.
const BITIgnore         = 1 << 30;
const BITError          = 1 << 31;

const BITAll            = 0xFFFFFFFF;
const BITAlphaNum       = BITNum | BITAlpha;
const BITHostname       = BITNum | BITAlpha | BITUppercase | BITDash | BITPeriod | BITUnderscore | BITUnicode;
const BITPatternToken   = BITNum | BITAlpha | BITPercent;
const BITLineComment    = BITExclamation | BITHash | BITSquareBracket;

// Important: it is expected that lines passed to the parser have been
// trimmed of new line characters. Given this, any newline characters found
// will be interpreted as normal white spaces.

const charDescBits = [
    /* 0x00 - 0x08 */ 0, 0, 0, 0, 0, 0, 0, 0, 0,
    /* 0x09   */ BITSpace,  // \t
    /* 0x0A   */ BITSpace,  // \n
    /* 0x0B - 0x0C */ 0, 0,
    /* 0x0D   */ BITSpace,  // \r
    /* 0x0E - 0x0F */ 0, 0,
    /* 0x10 - 0x1F */ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    /* 0x20   */ BITSpace,
    /* 0x21 ! */ BITExclamation,
    /* 0x22 " */ BITGlyph,
    /* 0x23 # */ BITHash,
    /* 0x24 $ */ BITDollar,
    /* 0x25 % */ BITPercent,
    /* 0x26 & */ BITGlyph,
    /* 0x27 ' */ BITGlyph,
    /* 0x28 ( */ BITParen | BITOpening,
    /* 0x29 ) */ BITParen | BITClosing,
    /* 0x2A * */ BITAsterisk,
    /* 0x2B + */ BITPlus,
    /* 0x2C , */ BITComma,
    /* 0x2D - */ BITDash,
    /* 0x2E . */ BITPeriod,
    /* 0x2F / */ BITSlash,
    /* 0x30 0 */ BITNum,
    /* 0x31 1 */ BITNum,
    /* 0x32 2 */ BITNum,
    /* 0x33 3 */ BITNum,
    /* 0x34 4 */ BITNum,
    /* 0x35 5 */ BITNum,
    /* 0x36 6 */ BITNum,
    /* 0x37 7 */ BITNum,
    /* 0x38 8 */ BITNum,
    /* 0x39 9 */ BITNum,
    /* 0x3A : */ BITGlyph,
    /* 0x3B ; */ BITGlyph,
    /* 0x3C < */ BITGlyph,
    /* 0x3D = */ BITEqual,
    /* 0x3E > */ BITGlyph,
    /* 0x3F ? */ BITQuestion,
    /* 0x40 @ */ BITAt,
    /* 0x41 A */ BITAlpha | BITUppercase,
    /* 0x42 B */ BITAlpha | BITUppercase,
    /* 0x43 C */ BITAlpha | BITUppercase,
    /* 0x44 D */ BITAlpha | BITUppercase,
    /* 0x45 E */ BITAlpha | BITUppercase,
    /* 0x46 F */ BITAlpha | BITUppercase,
    /* 0x47 G */ BITAlpha | BITUppercase,
    /* 0x48 H */ BITAlpha | BITUppercase,
    /* 0x49 I */ BITAlpha | BITUppercase,
    /* 0x4A J */ BITAlpha | BITUppercase,
    /* 0x4B K */ BITAlpha | BITUppercase,
    /* 0x4C L */ BITAlpha | BITUppercase,
    /* 0x4D M */ BITAlpha | BITUppercase,
    /* 0x4E N */ BITAlpha | BITUppercase,
    /* 0x4F O */ BITAlpha | BITUppercase,
    /* 0x50 P */ BITAlpha | BITUppercase,
    /* 0x51 Q */ BITAlpha | BITUppercase,
    /* 0x52 R */ BITAlpha | BITUppercase,
    /* 0x53 S */ BITAlpha | BITUppercase,
    /* 0x54 T */ BITAlpha | BITUppercase,
    /* 0x55 U */ BITAlpha | BITUppercase,
    /* 0x56 V */ BITAlpha | BITUppercase,
    /* 0x57 W */ BITAlpha | BITUppercase,
    /* 0x58 X */ BITAlpha | BITUppercase,
    /* 0x59 Y */ BITAlpha | BITUppercase,
    /* 0x5A Z */ BITAlpha | BITUppercase,
    /* 0x5B [ */ BITSquareBracket | BITOpening,
    /* 0x5C \ */ BITBackslash,
    /* 0x5D ] */ BITSquareBracket | BITClosing,
    /* 0x5E ^ */ BITCaret,
    /* 0x5F _ */ BITUnderscore,
    /* 0x60 ` */ BITGlyph,
    /* 0x61 a */ BITAlpha,
    /* 0x62 b */ BITAlpha,
    /* 0x63 c */ BITAlpha,
    /* 0x64 d */ BITAlpha,
    /* 0x65 e */ BITAlpha,
    /* 0x66 f */ BITAlpha,
    /* 0x67 g */ BITAlpha,
    /* 0x68 h */ BITAlpha,
    /* 0x69 i */ BITAlpha,
    /* 0x6A j */ BITAlpha,
    /* 0x6B k */ BITAlpha,
    /* 0x6C l */ BITAlpha,
    /* 0x6D m */ BITAlpha,
    /* 0x6E n */ BITAlpha,
    /* 0x6F o */ BITAlpha,
    /* 0x70 p */ BITAlpha,
    /* 0x71 q */ BITAlpha,
    /* 0x72 r */ BITAlpha,
    /* 0x73 s */ BITAlpha,
    /* 0x74 t */ BITAlpha,
    /* 0x75 u */ BITAlpha,
    /* 0x76 v */ BITAlpha,
    /* 0x77 w */ BITAlpha,
    /* 0x78 x */ BITAlpha,
    /* 0x79 y */ BITAlpha,
    /* 0x7A z */ BITAlpha,
    /* 0x7B { */ BITBrace | BITOpening,
    /* 0x7C | */ BITPipe,
    /* 0x7D } */ BITBrace | BITClosing,
    /* 0x7E ~ */ BITTilde,
    /* 0x7F   */ 0,
];

const BITFlavorException         = 1 <<  0;
const BITFlavorNetRegex          = 1 <<  1;
const BITFlavorNetLeftURLAnchor  = 1 <<  2;
const BITFlavorNetRightURLAnchor = 1 <<  3;
const BITFlavorNetLeftHnAnchor   = 1 <<  4;
const BITFlavorNetRightHnAnchor  = 1 <<  5;
const BITFlavorNetSpaceInPattern = 1 <<  6;
const BITFlavorExtStyle          = 1 <<  7;
const BITFlavorExtStrong         = 1 <<  8;
const BITFlavorExtCosmetic       = 1 <<  9;
const BITFlavorExtScriptlet      = 1 << 10;
const BITFlavorExtHTML           = 1 << 11;
const BITFlavorExtResponseHeader = 1 << 12;
const BITFlavorIgnore            = 1 << 29;
const BITFlavorUnsupported       = 1 << 30;
const BITFlavorError             = 1 << 31;

const BITFlavorNetLeftAnchor     = BITFlavorNetLeftURLAnchor | BITFlavorNetLeftHnAnchor;
const BITFlavorNetRightAnchor    = BITFlavorNetRightURLAnchor | BITFlavorNetRightHnAnchor;
const BITFlavorNetHnAnchor       = BITFlavorNetLeftHnAnchor | BITFlavorNetRightHnAnchor;
const BITFlavorNetAnchor         = BITFlavorNetLeftAnchor | BITFlavorNetRightAnchor;

const OPTTokenMask               = 0x000000ff;
const OPTTokenInvalid            =  0;
const OPTToken1p                 =  1;
const OPTToken1pStrict           =  2;
const OPTToken3p                 =  3;
const OPTToken3pStrict           =  4;
const OPTTokenAll                =  5;
const OPTTokenBadfilter          =  6;
const OPTTokenCname              =  7;
const OPTTokenCsp                =  8;
const OPTTokenCss                =  9;
const OPTTokenDenyAllow          = 10;
const OPTTokenDoc                = 11;
const OPTTokenDomain             = 12;
const OPTTokenEhide              = 13;
const OPTTokenEmpty              = 14;
const OPTTokenFont               = 15;
const OPTTokenFrame              = 16;
const OPTTokenGenericblock       = 17;
const OPTTokenGhide              = 18;
const OPTTokenHeader             = 19;
const OPTTokenImage              = 20;
const OPTTokenImportant          = 21;
const OPTTokenInlineFont         = 22;
const OPTTokenInlineScript       = 23;
const OPTTokenMatchCase          = 24;
const OPTTokenMedia              = 25;
const OPTTokenMp4                = 26;
const OPTTokenNoop               = 27;
const OPTTokenObject             = 28;
const OPTTokenOther              = 29;
const OPTTokenPing               = 30;
const OPTTokenPopunder           = 31;
const OPTTokenPopup              = 32;
const OPTTokenRedirect           = 33;
const OPTTokenRedirectRule       = 34;
const OPTTokenRemoveparam        = 35;
const OPTTokenScript             = 36;
const OPTTokenShide              = 37;
const OPTTokenXhr                = 38;
const OPTTokenWebrtc             = 39;
const OPTTokenWebsocket          = 40;
const OPTTokenCount              = 41;

//const OPTPerOptionMask           = 0x0000ff00;
const OPTCanNegate               = 1 <<  8;
const OPTBlockOnly               = 1 <<  9;
const OPTAllowOnly               = 1 << 10;
const OPTMustAssign              = 1 << 11;
const OPTAllowMayAssign          = 1 << 12;
const OPTMayAssign               = 1 << 13;
const OPTDomainList              = 1 << 14;

//const OPTGlobalMask              = 0x0fff0000;
const OPTNetworkType             = 1 << 16;
const OPTNonNetworkType          = 1 << 17;
const OPTModifiableType          = 1 << 18;
const OPTModifierType            = 1 << 19;
const OPTRedirectableType        = 1 << 20;
const OPTNonRedirectableType     = 1 << 21;
const OPTNonCspableType          = 1 << 22;
const OPTNeedDomainOpt           = 1 << 23;
const OPTNotSupported            = 1 << 24;

/******************************************************************************/

Parser.prototype.CATNone = CATNone;
Parser.prototype.CATStaticExtFilter = CATStaticExtFilter;
Parser.prototype.CATStaticNetFilter = CATStaticNetFilter;
Parser.prototype.CATComment = CATComment;

Parser.prototype.BITSpace = BITSpace;
Parser.prototype.BITGlyph = BITGlyph;
Parser.prototype.BITComma = BITComma;
Parser.prototype.BITLineComment = BITLineComment;
Parser.prototype.BITPipe = BITPipe;
Parser.prototype.BITAsterisk = BITAsterisk;
Parser.prototype.BITCaret = BITCaret;
Parser.prototype.BITUppercase = BITUppercase;
Parser.prototype.BITHostname = BITHostname;
Parser.prototype.BITPeriod = BITPeriod;
Parser.prototype.BITDash = BITDash;
Parser.prototype.BITHash = BITHash;
Parser.prototype.BITNum = BITNum;
Parser.prototype.BITEqual = BITEqual;
Parser.prototype.BITQuestion = BITQuestion;
Parser.prototype.BITPercent = BITPercent;
Parser.prototype.BITAlpha = BITAlpha;
Parser.prototype.BITTilde = BITTilde;
Parser.prototype.BITUnicode = BITUnicode;
Parser.prototype.BITIgnore = BITIgnore;
Parser.prototype.BITError = BITError;
Parser.prototype.BITAll = BITAll;

Parser.prototype.BITFlavorException = BITFlavorException;
Parser.prototype.BITFlavorExtStyle = BITFlavorExtStyle;
Parser.prototype.BITFlavorExtStrong = BITFlavorExtStrong;
Parser.prototype.BITFlavorExtCosmetic = BITFlavorExtCosmetic;
Parser.prototype.BITFlavorExtScriptlet = BITFlavorExtScriptlet;
Parser.prototype.BITFlavorExtHTML = BITFlavorExtHTML;
Parser.prototype.BITFlavorExtResponseHeader = BITFlavorExtResponseHeader;
Parser.prototype.BITFlavorIgnore = BITFlavorIgnore;
Parser.prototype.BITFlavorUnsupported = BITFlavorUnsupported;
Parser.prototype.BITFlavorError = BITFlavorError;

Parser.prototype.OPTToken1p = OPTToken1p;
Parser.prototype.OPTToken1pStrict = OPTToken1pStrict;
Parser.prototype.OPTToken3p = OPTToken3p;
Parser.prototype.OPTToken3pStrict = OPTToken3pStrict;
Parser.prototype.OPTTokenAll = OPTTokenAll;
Parser.prototype.OPTTokenBadfilter = OPTTokenBadfilter;
Parser.prototype.OPTTokenCname = OPTTokenCname;
Parser.prototype.OPTTokenCsp = OPTTokenCsp;
Parser.prototype.OPTTokenDenyAllow = OPTTokenDenyAllow;
Parser.prototype.OPTTokenDoc = OPTTokenDoc;
Parser.prototype.OPTTokenDomain = OPTTokenDomain;
Parser.prototype.OPTTokenEhide = OPTTokenEhide;
Parser.prototype.OPTTokenEmpty = OPTTokenEmpty;
Parser.prototype.OPTTokenFont = OPTTokenFont;
Parser.prototype.OPTTokenGenericblock = OPTTokenGenericblock;
Parser.prototype.OPTTokenGhide = OPTTokenGhide;
Parser.prototype.OPTTokenHeader = OPTTokenHeader;
Parser.prototype.OPTTokenImage = OPTTokenImage;
Parser.prototype.OPTTokenImportant = OPTTokenImportant;
Parser.prototype.OPTTokenInlineFont = OPTTokenInlineFont;
Parser.prototype.OPTTokenInlineScript = OPTTokenInlineScript;
Parser.prototype.OPTTokenInvalid = OPTTokenInvalid;
Parser.prototype.OPTTokenMatchCase = OPTTokenMatchCase;
Parser.prototype.OPTTokenMedia = OPTTokenMedia;
Parser.prototype.OPTTokenMp4 = OPTTokenMp4;
Parser.prototype.OPTTokenNoop = OPTTokenNoop;
Parser.prototype.OPTTokenObject = OPTTokenObject;
Parser.prototype.OPTTokenOther = OPTTokenOther;
Parser.prototype.OPTTokenPing = OPTTokenPing;
Parser.prototype.OPTTokenPopunder = OPTTokenPopunder;
Parser.prototype.OPTTokenPopup = OPTTokenPopup;
Parser.prototype.OPTTokenRemoveparam = OPTTokenRemoveparam;
Parser.prototype.OPTTokenRedirect = OPTTokenRedirect;
Parser.prototype.OPTTokenRedirectRule = OPTTokenRedirectRule;
Parser.prototype.OPTTokenScript = OPTTokenScript;
Parser.prototype.OPTTokenShide = OPTTokenShide;
Parser.prototype.OPTTokenCss = OPTTokenCss;
Parser.prototype.OPTTokenFrame = OPTTokenFrame;
Parser.prototype.OPTTokenXhr = OPTTokenXhr;
Parser.prototype.OPTTokenWebrtc = OPTTokenWebrtc;
Parser.prototype.OPTTokenWebsocket = OPTTokenWebsocket;

Parser.prototype.OPTCanNegate = OPTCanNegate;
Parser.prototype.OPTBlockOnly = OPTBlockOnly;
Parser.prototype.OPTAllowOnly = OPTAllowOnly;
Parser.prototype.OPTMustAssign = OPTMustAssign;
Parser.prototype.OPTAllowMayAssign = OPTAllowMayAssign;
Parser.prototype.OPTDomainList = OPTDomainList;
Parser.prototype.OPTNetworkType = OPTNetworkType;
Parser.prototype.OPTModifiableType = OPTModifiableType;
Parser.prototype.OPTNotSupported = OPTNotSupported;

/******************************************************************************/

const netOptionTokenDescriptors = new Map([
    [ '1p', OPTToken1p | OPTCanNegate ],
    /* synonym */ [ 'first-party', OPTToken1p | OPTCanNegate ],
    [ 'strict1p', OPTToken1pStrict ],
    [ '3p', OPTToken3p | OPTCanNegate ],
    /* synonym */ [ 'third-party', OPTToken3p | OPTCanNegate ],
    [ 'strict3p', OPTToken3pStrict ],
    [ 'all', OPTTokenAll | OPTNetworkType | OPTNonCspableType ],
    [ 'badfilter', OPTTokenBadfilter ],
    [ 'cname', OPTTokenCname | OPTAllowOnly | OPTModifierType ],
    [ 'csp', OPTTokenCsp | OPTMustAssign | OPTAllowMayAssign | OPTModifierType ],
    [ 'css', OPTTokenCss | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTRedirectableType | OPTNonCspableType ],
    /* synonym */ [ 'stylesheet', OPTTokenCss | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTRedirectableType | OPTNonCspableType ],
    [ 'denyallow', OPTTokenDenyAllow | OPTMustAssign | OPTDomainList | OPTNeedDomainOpt | OPTNonCspableType ],
    [ 'doc', OPTTokenDoc | OPTNetworkType | OPTCanNegate | OPTModifiableType | OPTRedirectableType ],
    /* synonym */ [ 'document', OPTTokenDoc | OPTNetworkType | OPTCanNegate | OPTModifiableType | OPTRedirectableType ],
    [ 'domain', OPTTokenDomain | OPTMustAssign | OPTDomainList ],
    [ 'ehide', OPTTokenEhide | OPTNonNetworkType | OPTNonCspableType | OPTNonRedirectableType ],
    /* synonym */ [ 'elemhide', OPTTokenEhide | OPTNonNetworkType | OPTNonCspableType | OPTNonRedirectableType ],
    [ 'empty', OPTTokenEmpty | OPTBlockOnly | OPTModifierType ],
    [ 'frame', OPTTokenFrame | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTRedirectableType ],
    /* synonym */ [ 'subdocument', OPTTokenFrame | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTRedirectableType ],
    [ 'font', OPTTokenFont | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTNonCspableType ],
    [ 'genericblock', OPTTokenGenericblock | OPTNotSupported ],
    [ 'ghide', OPTTokenGhide | OPTNonNetworkType | OPTNonCspableType | OPTNonRedirectableType ],
    /* synonym */ [ 'generichide', OPTTokenGhide | OPTNonNetworkType | OPTNonCspableType | OPTNonRedirectableType ],
    [ 'header', OPTTokenHeader | OPTMustAssign | OPTAllowMayAssign | OPTNonCspableType | OPTNonRedirectableType ],
    [ 'image', OPTTokenImage | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTRedirectableType | OPTNonCspableType ],
    [ 'important', OPTTokenImportant | OPTBlockOnly ],
    [ 'inline-font', OPTTokenInlineFont | OPTNonNetworkType | OPTCanNegate | OPTNonCspableType | OPTNonRedirectableType ],
    [ 'inline-script', OPTTokenInlineScript | OPTNonNetworkType | OPTCanNegate | OPTNonCspableType | OPTNonRedirectableType ],
    [ 'match-case', OPTTokenMatchCase ],
    [ 'media', OPTTokenMedia | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTRedirectableType | OPTNonCspableType ],
    [ 'mp4', OPTTokenMp4 | OPTNetworkType | OPTBlockOnly |  OPTModifierType ],
    [ '_', OPTTokenNoop ],
    [ 'object', OPTTokenObject | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTRedirectableType | OPTNonCspableType ],
    /* synonym */ [ 'object-subrequest', OPTTokenObject | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTRedirectableType | OPTNonCspableType ],
    [ 'other', OPTTokenOther | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTRedirectableType | OPTNonCspableType ],
    [ 'ping', OPTTokenPing | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTNonCspableType | OPTNonRedirectableType ],
    /* synonym */ [ 'beacon', OPTTokenPing | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTNonCspableType | OPTNonRedirectableType ],
    [ 'popunder', OPTTokenPopunder | OPTNonNetworkType | OPTNonCspableType | OPTNonRedirectableType ],
    [ 'popup', OPTTokenPopup | OPTNonNetworkType | OPTCanNegate | OPTNonCspableType | OPTNonRedirectableType ],
    [ 'redirect', OPTTokenRedirect | OPTMustAssign | OPTAllowMayAssign | OPTModifierType ],
    /* synonym */ [ 'rewrite', OPTTokenRedirect | OPTMustAssign | OPTAllowMayAssign | OPTModifierType ],
    [ 'redirect-rule', OPTTokenRedirectRule | OPTMustAssign | OPTAllowMayAssign | OPTModifierType | OPTNonCspableType ],
    [ 'removeparam', OPTTokenRemoveparam | OPTMayAssign | OPTModifierType | OPTNonCspableType | OPTNonRedirectableType ],
    /* synonym */ [ 'queryprune', OPTTokenRemoveparam | OPTMayAssign | OPTModifierType | OPTNonCspableType | OPTNonRedirectableType ],
    [ 'script', OPTTokenScript | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTRedirectableType | OPTNonCspableType ],
    [ 'shide', OPTTokenShide | OPTNonNetworkType | OPTNonCspableType | OPTNonRedirectableType ],
    /* synonym */ [ 'specifichide', OPTTokenShide | OPTNonNetworkType | OPTNonCspableType | OPTNonRedirectableType ],
    [ 'xhr', OPTTokenXhr | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTRedirectableType | OPTNonCspableType ],
    /* synonym */ [ 'xmlhttprequest', OPTTokenXhr | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTRedirectableType | OPTNonCspableType ],
    [ 'webrtc', OPTTokenWebrtc | OPTNotSupported ],
    [ 'websocket', OPTTokenWebsocket | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTNonCspableType | OPTNonRedirectableType ],
]);

Parser.prototype.netOptionTokenDescriptors =
    Parser.netOptionTokenDescriptors = netOptionTokenDescriptors;

Parser.netOptionTokenIds = new Map([
    [ '1p', OPTToken1p ],
    /* synonym */ [ 'first-party', OPTToken1p ],
    [ 'strict1p', OPTToken1pStrict ],
    [ '3p', OPTToken3p ],
    /* synonym */ [ 'third-party', OPTToken3p ],
    [ 'strict3p', OPTToken3pStrict ],
    [ 'all', OPTTokenAll ],
    [ 'badfilter', OPTTokenBadfilter ],
    [ 'cname', OPTTokenCname ],
    [ 'csp', OPTTokenCsp ],
    [ 'css', OPTTokenCss ],
    /* synonym */ [ 'stylesheet', OPTTokenCss ],
    [ 'denyallow', OPTTokenDenyAllow ],
    [ 'doc', OPTTokenDoc ],
    /* synonym */ [ 'document', OPTTokenDoc ],
    [ 'domain', OPTTokenDomain ],
    [ 'ehide', OPTTokenEhide ],
    /* synonym */ [ 'elemhide', OPTTokenEhide ],
    [ 'empty', OPTTokenEmpty ],
    [ 'frame', OPTTokenFrame ],
    /* synonym */ [ 'subdocument', OPTTokenFrame ],
    [ 'font', OPTTokenFont ],
    [ 'genericblock', OPTTokenGenericblock ],
    [ 'ghide', OPTTokenGhide ],
    /* synonym */ [ 'generichide', OPTTokenGhide ],
    [ 'header', OPTTokenHeader ],
    [ 'image', OPTTokenImage ],
    [ 'important', OPTTokenImportant ],
    [ 'inline-font', OPTTokenInlineFont ],
    [ 'inline-script', OPTTokenInlineScript ],
    [ 'match-case', OPTTokenMatchCase ],
    [ 'media', OPTTokenMedia ],
    [ 'mp4', OPTTokenMp4 ],
    [ '_', OPTTokenNoop ],
    [ 'object', OPTTokenObject ],
    /* synonym */ [ 'object-subrequest', OPTTokenObject ],
    [ 'other', OPTTokenOther ],
    [ 'ping', OPTTokenPing ],
    /* synonym */ [ 'beacon', OPTTokenPing ],
    [ 'popunder', OPTTokenPopunder ],
    [ 'popup', OPTTokenPopup ],
    [ 'redirect', OPTTokenRedirect ],
    /* synonym */ [ 'rewrite', OPTTokenRedirect ],
    [ 'redirect-rule', OPTTokenRedirectRule ],
    [ 'removeparam', OPTTokenRemoveparam ],
    /* synonym */ [ 'queryprune', OPTTokenRemoveparam ],
    [ 'script', OPTTokenScript ],
    [ 'shide', OPTTokenShide ],
    /* synonym */ [ 'specifichide', OPTTokenShide ],
    [ 'xhr', OPTTokenXhr ],
    /* synonym */ [ 'xmlhttprequest', OPTTokenXhr ],
    [ 'webrtc', OPTTokenWebrtc ],
    [ 'websocket', OPTTokenWebsocket ],
]);

Parser.netOptionTokenNames = new Map([
    [ OPTToken1p, '1p' ],
    [ OPTToken1pStrict, 'strict1p' ],
    [ OPTToken3p, '3p' ],
    [ OPTToken3pStrict, 'strict3p' ],
    [ OPTTokenAll, 'all' ],
    [ OPTTokenBadfilter, 'badfilter' ],
    [ OPTTokenCname, 'cname' ],
    [ OPTTokenCsp, 'csp' ],
    [ OPTTokenCss, 'stylesheet' ],
    [ OPTTokenDenyAllow, 'denyallow' ],
    [ OPTTokenDoc, 'document' ],
    [ OPTTokenDomain, 'domain' ],
    [ OPTTokenEhide, 'elemhide' ],
    [ OPTTokenEmpty, 'empty' ],
    [ OPTTokenFrame, 'subdocument' ],
    [ OPTTokenFont, 'font' ],
    [ OPTTokenGenericblock, 'genericblock' ],
    [ OPTTokenGhide, 'generichide' ],
    [ OPTTokenHeader, 'header' ],
    [ OPTTokenImage, 'image' ],
    [ OPTTokenImportant, 'important' ],
    [ OPTTokenInlineFont, 'inline-font' ],
    [ OPTTokenInlineScript, 'inline-script' ],
    [ OPTTokenMatchCase, 'match-case' ],
    [ OPTTokenMedia, 'media' ],
    [ OPTTokenMp4, 'mp4' ],
    [ OPTTokenNoop, '_' ],
    [ OPTTokenObject, 'object' ],
    [ OPTTokenOther, 'other' ],
    [ OPTTokenPing, 'ping' ],
    [ OPTTokenPopunder, 'popunder' ],
    [ OPTTokenPopup, 'popup' ],
    [ OPTTokenRemoveparam, 'removeparam' ],
    [ OPTTokenRedirect, 'redirect' ],
    [ OPTTokenRedirectRule, 'redirect-rule' ],
    [ OPTTokenScript, 'script' ],
    [ OPTTokenShide, 'specifichide' ],
    [ OPTTokenXhr, 'xmlhttprequest' ],
    [ OPTTokenWebrtc, 'webrtc' ],
    [ OPTTokenWebsocket, 'websocket' ],
]);

/******************************************************************************/

const Span = class {
    constructor() {
        this.reset();
    }
    reset() {
        this.i = this.len = 0;
    }
};

/******************************************************************************/

// https://github.com/uBlockOrigin/uBlock-issues/issues/760#issuecomment-951146371
//   Quick fix: auto-escape commas.

const NetOptionsIterator = class {
    constructor(parser) {
        this.parser = parser;
        this.exception = false;
        this.interactive = false;
        this.optSlices = [];
        this.writePtr = 0;
        this.readPtr = 0;
        this.tokenPos = (( ) => {
            const out = [];
            for ( let i = 0; i < OPTTokenCount; i++ ) { out[i] = -1; }
            return out;
        })();
        this.item = {
            id: OPTTokenInvalid,
            val: undefined,
            not: false,
        };
        this.value = undefined;
        this.done = true;
    }
    [Symbol.iterator]() {
        return this.init();
    }
    init() {
        this.readPtr = this.writePtr = 0;
        this.done = this.parser.optionsSpan.len === 0;
        if ( this.done ) {
            this.value = undefined;
            return this;
        }
        // Prime iterator
        this.value = this.item;
        this.exception = this.parser.isException();
        this.interactive = this.parser.interactive;
        // Each option is encoded as follow:
        //
        // desc  ~token=value,
        // 0     1|    3|    5
        //        2     4
        //
        // At index 0 is the option descriptor.
        // At indices 1-5 is a slice index.
        this.tokenPos.fill(-1);
        const lopts =  this.parser.optionsSpan.i;
        const ropts =  lopts + this.parser.optionsSpan.len;
        const slices = this.parser.slices;
        const optSlices = this.optSlices;
        let allBits = 0;
        let writePtr = 0;
        let lopt = lopts;
        while ( lopt < ropts ) {
            let good = true;
            let ltok = lopt;
            // Parse optional negation
            if ( hasBits(slices[lopt], BITTilde) ) {
                if ( slices[lopt+2] > 1 ) { good = false; }
                ltok += 3;
            }
            // Find end of current option
            let lval = 0;
            let i = ltok;
            while ( i < ropts ) {
                const bits = slices[i];
                if ( hasBits(bits, BITComma) ) {
                    if ( this.interactive && (i === lopt || slices[i+2] > 1) ) {
                        slices[i] |= BITError;
                    } else if ( /^,\d*?\}/.test(this.parser.raw.slice(slices[i+1])) === false ) {
                        break;
                    }
                }
                if ( lval === 0 && hasBits(bits, BITEqual) ) { lval = i; }
                i += 3;
            }
            // Check for proper assignment
            let assigned = false;
            if ( good && lval !== 0 ) {
                good = assigned = slices[lval+2] === 1 && lval + 3 !== i;
            }
            let descriptor;
            if ( good ) {
                const rtok = lval === 0 ? i : lval;
                const token = this.parser.raw.slice(slices[ltok+1], slices[rtok+1]);
                descriptor = netOptionTokenDescriptors.get(token);
            }
            // Validate option according to context
            if ( !this.optionIsValidInContext(descriptor, ltok !== lopt, assigned) ) {
                descriptor = OPTTokenInvalid;
            }
            // Keep track of which options are present: any given option can
            // appear only once.
            // TODO: might need to make an exception for `header=` option so as
            //       to allow filters which need to match more than one header.
            const tokenId = descriptor & OPTTokenMask;
            if ( tokenId !== OPTTokenInvalid ) {
                if ( this.tokenPos[tokenId] !== -1 ) {
                    descriptor = OPTTokenInvalid;
                } else {
                    this.tokenPos[tokenId] = writePtr;
                }
            }
            // Only one modifier can be present
            if (
                hasBits(descriptor, OPTModifierType) &&
                hasBits(allBits, OPTModifierType)
            ) {
                descriptor = OPTTokenInvalid;
            }
            // Accumulate description bits
            allBits |= descriptor;
            // Mark slices in case of invalid filter option
            if (
                this.interactive && (
                    descriptor === OPTTokenInvalid ||
                    hasBits(descriptor, OPTNotSupported)
                )
            ) {
                this.parser.errorSlices(lopt, i);
            }
            // Store indices to raw slices, this will be used during iteration
            optSlices[writePtr+0] = descriptor;
            optSlices[writePtr+1] = lopt;
            optSlices[writePtr+2] = ltok;
            if ( lval !== 0 ) {
                optSlices[writePtr+3] = lval;
                optSlices[writePtr+4] = lval+3;
                if ( this.interactive && hasBits(descriptor, OPTDomainList) ) {
                    this.parser.analyzeDomainList(
                        lval + 3, i, BITPipe,
                        tokenId === OPTTokenDomain ? 0b1010 : 0b0000
                    );
                }
            } else {
                optSlices[writePtr+3] = i;
                optSlices[writePtr+4] = i;
            }
            optSlices[writePtr+5] = i;
            // Advance to next option
            writePtr += 6;
            lopt = i + 3;
        }
        this.writePtr = writePtr;
        // Dangling comma
        if (
            this.interactive &&
            hasBits(this.parser.slices[ropts-3], BITComma)
        ) {
            this.parser.slices[ropts-3] |= BITError;
        }
        // `denyallow=` option requires `domain=` option.
        {
            const i = this.tokenPos[OPTTokenDenyAllow];
            if ( i !== -1 && this.tokenPos[OPTTokenDomain] === -1 ) {
                optSlices[i] = OPTTokenInvalid;
                if ( this.interactive ) {
                    this.parser.errorSlices(optSlices[i+1], optSlices[i+5]);
                }
            }
        }
        // `redirect=`: can't redirect non-redirectable types
        {
            let i = this.tokenPos[OPTTokenRedirect];
            if ( i === -1 ) {
                i = this.tokenPos[OPTTokenRedirectRule];
            }
            if ( i !== -1 && hasBits(allBits, OPTNonRedirectableType) ) {
                optSlices[i] = OPTTokenInvalid;
                if ( this.interactive ) {
                    this.parser.errorSlices(optSlices[i+1], optSlices[i+5]);
                }
            }
        }
        // `empty`: can't apply to non-redirectable types
        {
            let i = this.tokenPos[OPTTokenEmpty];
            if ( i !== -1 &&  hasBits(allBits, OPTNonRedirectableType) ) {
                optSlices[i] = OPTTokenInvalid;
                if ( this.interactive ) {
                    this.parser.errorSlices(optSlices[i+1], optSlices[i+5]);
                }
            }
        }
        // `csp=`: only to "csp-able" types, which currently are only
        // document types.
        {
            const i = this.tokenPos[OPTTokenCsp];
            if ( i !== -1 &&  hasBits(allBits, OPTNonCspableType) ) {
                optSlices[i] = OPTTokenInvalid;
                if ( this.interactive ) {
                    this.parser.errorSlices(optSlices[i+1], optSlices[i+5]);
                }
            }
        }
        // `removeparam=`:  only for network requests.
        {
            const i = this.tokenPos[OPTTokenRemoveparam];
            if ( i !== -1 ) {
                if ( hasBits(allBits, OPTNonNetworkType) ) {
                    optSlices[i] = OPTTokenInvalid;
                    if ( this.interactive ) {
                        this.parser.errorSlices(optSlices[i+1], optSlices[i+5]);
                    }
                } else {
                    const val = this.parser.strFromSlices(
                        optSlices[i+4],
                        optSlices[i+5] - 3
                    );
                    const r = Parser.parseQueryPruneValue(val);
                    if ( r.bad ) {
                        optSlices[i] = OPTTokenInvalid;
                        if ( this.interactive ) {
                            this.parser.errorSlices(
                                optSlices[i+4],
                                optSlices[i+5]
                            );
                        }
                    }
                }
            }
        }
        // `cname`: can't be used with any type
        {
            const i = this.tokenPos[OPTTokenCname];
            if (
                i !== -1 && (
                    hasBits(allBits, OPTNetworkType) ||
                    hasBits(allBits, OPTNonNetworkType)
                )
            ) {
                optSlices[i] = OPTTokenInvalid;
                if ( this.interactive ) {
                    this.parser.errorSlices(optSlices[i+1], optSlices[i+5]);
                }
            }
        }
        // `header`: can't be used with any modifier type
        {
            const i = this.tokenPos[OPTTokenHeader];
            if ( i !== -1 ) {
                if (
                    this.parser.expertMode === false ||
                    hasBits(allBits, OPTModifierType)
                ) {
                    optSlices[i] = OPTTokenInvalid;
                    if ( this.interactive ) {
                        this.parser.errorSlices(optSlices[i+1], optSlices[i+5]);
                    }
                } else {
                    const val = this.parser.strFromSlices(
                        optSlices[i+4],
                        optSlices[i+5] - 3
                    );
                    const r = Parser.parseHeaderValue(val);
                    if ( r.bad ) {
                        optSlices[i] = OPTTokenInvalid;
                        if ( this.interactive ) {
                            this.parser.errorSlices(
                                optSlices[i+4],
                                optSlices[i+5]
                            );
                        }
                    }
                }
            }
        }
        // `match-case`: valid only for regex-based filters
        {
            const i = this.tokenPos[OPTTokenMatchCase];
            if ( i !== -1 && this.parser.patternIsRegex() === false ) {
                optSlices[i] = OPTTokenInvalid;
                if ( this.interactive ) {
                    this.parser.errorSlices(optSlices[i+1], optSlices[i+5]);
                }
            }
        }
        return this;
    }
    next() {
        const i = this.readPtr;
        if ( i === this.writePtr ) {
            this.value = undefined;
            this.done = true;
            return this;
        }
        const optSlices = this.optSlices;
        const descriptor = optSlices[i+0];
        this.item.id = descriptor & OPTTokenMask;
        this.item.not = optSlices[i+2] !== optSlices[i+1];
        this.item.val = undefined;
        if ( optSlices[i+4] !== optSlices[i+5] ) {
            const parser = this.parser;
            this.item.val = parser.raw.slice(
                parser.slices[optSlices[i+4]+1],
                parser.slices[optSlices[i+5]+1]
            );
        }
        this.readPtr = i + 6;
        return this;
    }

    optionIsValidInContext(descriptor, negated, assigned) {
        if ( descriptor === undefined ) {
            return false;
        }
        if ( negated && hasNoBits(descriptor, OPTCanNegate) )  {
            return false;
        }
        if ( this.exception && hasBits(descriptor, OPTBlockOnly) ) {
            return false;
        }
        if ( this.exception === false && hasBits(descriptor, OPTAllowOnly) ) {
            return false;
        }
        if ( assigned && hasNoBits(descriptor, OPTMayAssign | OPTMustAssign) ) {
            return false;
        }
        if ( assigned === false && hasBits(descriptor, OPTMustAssign) ) {
            if ( this.exception === false || hasNoBits(descriptor, OPTAllowMayAssign) ) {
                return false;
            }
        }
        return true;
    }
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/997
//   Ignore token if preceded by wildcard.

const PatternTokenIterator = class {
    constructor(parser) {
        this.parser = parser;
        this.l = this.r = this.i = 0;
        this.value = undefined;
        this.done = true;
    }
    [Symbol.iterator]() {
        const { i, len } = this.parser.patternSpan;
        if ( len === 0 ) {
            return this.end();
        }
        this.l = i;
        this.r = i + len;
        this.i = i;
        this.done = false;
        this.value = { token: '', pos: 0 };
        return this;
    }
    end() {
        this.value = undefined;
        this.done = true;
        return this;
    }
    next() {
        const { slices, maxTokenLength } = this.parser;
        let { l, r, i, value } = this;
        let sl = i, sr = 0;
        for (;;) {
            for (;;) {
                if ( sl >= r ) { return this.end(); }
                if ( hasBits(slices[sl], BITPatternToken) ) { break; }
                sl += 3;
            }
            sr = sl + 3;
            while ( sr < r && hasBits(slices[sr], BITPatternToken) ) {
                sr += 3;
            }
            if (
                (
                    sl === 0 ||
                    hasNoBits(slices[sl-3], BITAsterisk)
                ) &&
                (
                    sr === r ||
                    hasNoBits(slices[sr], BITAsterisk) ||
                    (slices[sr+1] - slices[sl+1]) >= maxTokenLength
                )
            ) {
                break;
            }
            sl = sr + 3;
        }
        this.i = sr + 3;
        const beg = slices[sl+1];
        value.token = this.parser.raw.slice(beg, slices[sr+1]);
        value.pos = beg - slices[l+1];
        return this;
    }
};

/******************************************************************************/

const ExtOptionsIterator = class {
    constructor(parser) {
        this.parser = parser;
        this.l = this.r = 0;
        this.value = undefined;
        this.done = true;
    }
    [Symbol.iterator]() {
        const { i, len } = this.parser.optionsSpan;
        if ( len === 0 ) {
            this.l = this.r = 0;
            this.done = true;
            this.value = undefined;
        } else {
            this.l = i;
            this.r = i + len;
            this.done = false;
            this.value = { hn: undefined, not: false, bad: false };
        }
        return this;
    }
    next() {
        if ( this.l === this.r ) {
            this.value = undefined;
            this.done = true;
            return this;
        }
        const parser = this.parser;
        const { slices, interactive } = parser;
        const value = this.value;
        value.not = value.bad = false;
        let i0 = this.l;
        let i = i0;
        if ( hasBits(slices[i], BITTilde) ) {
            if ( slices[i+2] !== 1 ) {
                value.bad = true;
                if ( interactive ) { slices[i] |= BITError; }
            }
            value.not = true;
            i += 3;
            i0 = i;
        }
        while ( i < this.r ) {
            if ( hasBits(slices[i], BITComma) ) { break; }
            i += 3;
        }
        if ( i === i0 ) { value.bad = true; }
        value.hn = parser.raw.slice(slices[i0+1], slices[i+1]);
        if ( i < this.r ) { i += 3; }
        this.l = i;
        return this;
    }
};

/******************************************************************************/

// Depends on:
// https://github.com/foo123/RegexAnalyzer

Parser.regexUtils = Parser.prototype.regexUtils = (( ) => {

    const firstCharCodeClass = s => {
        return /^[\x01%0-9A-Za-z]/.test(s) ? 1 : 0;
    };

    const lastCharCodeClass = s => {
        return /[\x01%0-9A-Za-z]$/.test(s) ? 1 : 0;
    };

    const toTokenizableStr = node => {
        switch ( node.type ) {
        case 1: /* T_SEQUENCE, 'Sequence' */ {
            let s = '';
            for ( let i = 0; i < node.val.length; i++ ) {
                s += toTokenizableStr(node.val[i]);
            }
            return s;
        }
        case 2: /* T_ALTERNATION, 'Alternation' */
        case 8: /* T_CHARGROUP, 'CharacterGroup' */ {
            let firstChar = 0;
            let lastChar = 0;
            for ( let i = 0; i < node.val.length; i++ ) {
                const s = toTokenizableStr(node.val[i]);
                if ( firstChar === 0 && firstCharCodeClass(s) === 1 ) {
                    firstChar = 1;
                }
                if ( lastChar === 0 && lastCharCodeClass(s) === 1 ) {
                    lastChar = 1;
                }
                if ( firstChar === 1 && lastChar === 1 ) { break; }
            }
            return String.fromCharCode(firstChar, lastChar);
        }
        case 4: /* T_GROUP, 'Group' */ {
            if ( node.flags.NegativeLookAhead === 1 ) { return '\x01'; }
            if ( node.flags.NegativeLookBehind === 1 ) { return '\x01'; }
            return toTokenizableStr(node.val);
        }
        case 16: /* T_QUANTIFIER, 'Quantifier' */ {
            const s = toTokenizableStr(node.val);
            const first = firstCharCodeClass(s);
            const last = lastCharCodeClass(s);
            if ( node.flags.min === 0 && first === 0 && last === 0 ) {
                return '';
            }
            return String.fromCharCode(first, last);
        }
        case 64: /* T_HEXCHAR, 'HexChar' */ {
            return String.fromCharCode(parseInt(node.val.slice(1), 16));
        }
        case 128: /* T_SPECIAL, 'Special' */ {
            const flags = node.flags;
            if (
                flags.EndCharGroup === 1 || // dangling `]`
                flags.EndGroup === 1 ||     // dangling `)`
                flags.EndRepeats === 1      // dangling `}`
            ) {
                throw new Error('Unmatched bracket');
            }
            return flags.MatchEnd === 1 ||
                   flags.MatchStart === 1 ||
                   flags.MatchWordBoundary === 1
                ? '\x00'
                : '\x01';
        }
        case 256: /* T_CHARS, 'Characters' */ {
            for ( let i = 0; i < node.val.length; i++ ) {
                if ( firstCharCodeClass(node.val[i]) === 1 ) {
                    return '\x01';
                }
            }
            return '\x00';
        }
        // Ranges are assumed to always involve token-related characters.
        case 512: /* T_CHARRANGE, 'CharacterRange' */ {
            return '\x01';
        }
        case 1024: /* T_STRING, 'String' */ {
            return node.val;
        }
        case 2048: /* T_COMMENT, 'Comment' */ {
            return '';
        }
        default:
            break;
        }
        return '\x01';
    };

    if (
        Regex instanceof Object === false ||
        Regex.Analyzer instanceof Object === false
    ) {
        return {
            isValid: function(reStr)  {
                try {
                    void new RegExp(reStr);
                } catch(ex) {
                    return false;
                }
                return true;
            },
            toTokenizableStr: ( ) => '',
        };
    }

    return {
        isValid: function(reStr) {
            try {
                void new RegExp(reStr);
                void toTokenizableStr(Regex.Analyzer(reStr, false).tree());
            } catch(ex) {
                return false;
            }
            return true;
        },
        toTokenizableStr: function(reStr) {
            try {
                return toTokenizableStr(Regex.Analyzer(reStr, false).tree());
            } catch(ex) {
            }
            return '';
        },
    };
})();

/******************************************************************************/

const StaticFilteringParser = Parser;

export { StaticFilteringParser };

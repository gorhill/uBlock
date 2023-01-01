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

'use strict';

/******************************************************************************/

import Regex from '../lib/regexanalyzer/regex.js';
import * as cssTree from '../lib/csstree/css-tree.js';

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
    constructor(instanceOptions = {}) {
        this.interactive = instanceOptions.interactive === true;
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
        this.expertMode = instanceOptions.expertMode !== false;
        this.reIsLocalhostRedirect = /(?:0\.0\.0\.0|broadcasthost|local|localhost(?:\.localdomain)?|ip6-\w+)(?:[^\w.-]|$)/;
        this.reHostname = /^[^\x00-\x24\x26-\x29\x2B\x2C\x2F\x3A-\x40\x5B-\x5E\x60\x7B-\x7F]+/;
        this.reHostsSink = /^[\w%.:\[\]-]+$/;
        this.reHostsSource = /^[^\x00-\x24\x26-\x29\x2B\x2C\x2F\x3A-\x40\x5B-\x5E\x60\x7B-\x7F]+$/;
        this.reUnicodeChar = /[^\x00-\x7F]/;
        this.reUnicodeChars = /[^\x00-\x7F]/g;
        this.reHostnameLabel = /[^.]+/g;
        this.rePlainHostname = /^(?:[\w-]+\.)*[a-z]+$/;
        this.reBadHostnameChars = /[\x00-\x24\x26-\x29\x2b\x2c\x2f\x3b-\x40\x5c\x5e\x60\x7b-\x7f]/;
        this.rePlainEntity = /^(?:[\w-]+\.)+\*$/;
        this.reEntity = /^[^*]+\.\*$/;
        // https://github.com/uBlockOrigin/uBlock-issues/issues/1146
        //   From https://codemirror.net/doc/manual.html#option_specialChars
        this.reInvalidCharacters = /[\x00-\x1F\x7F-\x9F\xAD\u061C\u200B-\u200F\u2028\u2029\uFEFF\uFFF9-\uFFFC]/;
        this.punycoder = new URL('https://ublock0.invalid/');
        // TODO: mind maxTokenLength
        this.reGoodRegexToken
            = /[^\x01%0-9A-Za-z][%0-9A-Za-z]{7,}|[^\x01%0-9A-Za-z][%0-9A-Za-z]{1,6}[^\x01%0-9A-Za-z]/;
        this.selectorCompiler = new this.SelectorCompiler(this, instanceOptions);
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
            flavorBits |= hasBits(this.slices[to], BITPercent)
                ? BITFlavorUnsupported
                : BITFlavorExtStrong;
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

        if ( hasBits(this.flavorBits, BITFlavorUnsupported) ) { return; }

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
            this.selectorCompiler.compile(selector, this.result, {
                asProcedural: hasBits(this.flavorBits, BITFlavorExtStrong | BITFlavorExtStyle),
            }) === false
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
            if ( this.utils.regex.isValid(this.getNetPattern()) === false ) {
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
        if ( this.reBadHostnameChars.test(hn) ) { return; }
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
            this.utils.regex.toTokenizableStr(this.getNetPattern())
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
    constructor(parser, instanceOptions) {
        this.parser = parser;
        this.reParseRegexLiteral = /^\/(.+)\/([imu]+)?$/;

        // Use a regex for most common CSS selectors known to be valid in any
        // context.
        const cssIdentifier = '[A-Za-z_][\\w-]*';
        const cssClassOrId = `[.#]${cssIdentifier}`;
        const cssAttribute = `\\[${cssIdentifier}(?:[*^$]?="[^"\\]\\\\]+")?\\]`;
        const cssSimple =
            '(?:' +
            `${cssIdentifier}(?:${cssClassOrId})*(?:${cssAttribute})*` + '|' +
            `${cssClassOrId}(?:${cssClassOrId})*(?:${cssAttribute})*` + '|' +
            `${cssAttribute}(?:${cssAttribute})*` +
            ')';
        const cssCombinator = '(?:\\s+|\\s*[+>~]\\s*)';
        this.reCommonSelector = new RegExp(
            `^${cssSimple}(?:${cssCombinator}${cssSimple})*$`
        );
        // Resulting regex literal:
        // /^(?:[A-Za-z_][\w-]*(?:[.#][A-Za-z_][\w-]*)*(?:\[[A-Za-z_][\w-]*(?:[*^$]?="[^"\]\\]+")?\])*|[.#][A-Za-z_][\w-]*(?:[.#][A-Za-z_][\w-]*)*(?:\[[A-Za-z_][\w-]*(?:[*^$]?="[^"\]\\]+")?\])*|\[[A-Za-z_][\w-]*(?:[*^$]?="[^"\]\\]+")?\](?:\[[A-Za-z_][\w-]*(?:[*^$]?="[^"\]\\]+")?\])*)(?:(?:\s+|\s*[>+~]\s*)(?:[A-Za-z_][\w-]*(?:[.#][A-Za-z_][\w-]*)*(?:\[[A-Za-z_][\w-]*(?:[*^$]?="[^"\]\\]+")?\])*|[.#][A-Za-z_][\w-]*(?:[.#][A-Za-z_][\w-]*)*(?:\[[A-Za-z_][\w-]*(?:[*^$]?="[^"\]\\]+")?\])*|\[[A-Za-z_][\w-]*(?:[*^$]?="[^"\]\\]+")?\](?:\[[A-Za-z_][\w-]*(?:[*^$]?="[^"\]\\]+")?\])*))*$/

        this.reEatBackslashes = /\\([()])/g;
        this.reEscapeRegex = /[.*+?^${}()|[\]\\]/g;
        // https://github.com/gorhill/uBlock/issues/2793
        this.normalizedOperators = new Map([
            [ '-abp-has', 'has' ],
            [ '-abp-contains', 'has-text' ],
            [ 'contains', 'has-text' ],
            [ 'nth-ancestor', 'upward' ],
            [ 'watch-attrs', 'watch-attr' ],
        ]);
        this.actionOperators = new Set([
            ':remove',
            ':style',
        ]);

        this.proceduralOperatorNames = new Set([
            'has-text',
            'if',
            'if-not',
            'matches-attr',
            'matches-css',
            'matches-css-after',
            'matches-css-before',
            'matches-media',
            'matches-path',
            'min-text-length',
            'others',
            'upward',
            'watch-attr',
            'xpath',
        ]);
        this.maybeProceduralOperatorNames = new Set([
            'has',
            'not',
        ]);
        this.proceduralActionNames = new Set([
            'remove',
            'remove-attr',
            'remove-class',
            'style',
        ]);
        this.normalizedExtendedSyntaxOperators = new Map([
            [ 'contains', 'has-text' ],
            [ 'has', 'has' ],
        ]);
        this.reIsRelativeSelector = /^\s*[+>~]/;
        this.reExtendedSyntax = /\[-(?:abp|ext)-[a-z-]+=(['"])(?:.+?)(?:\1)\]/;
        this.reExtendedSyntaxReplacer = /\[-(?:abp|ext)-([a-z-]+)=(['"])(.+?)\2\]/g;
        this.abpProceduralOpReplacer = /:-abp-(?:contains|has)\(/g;
        this.nativeCssHas = instanceOptions.nativeCssHas === true;

        // https://www.w3.org/TR/css-syntax-3/#typedef-ident-token
        this.reInvalidIdentifier = /^\d/;
    }

    compile(raw, out, compileOptions = {}) {
        this.asProcedural = compileOptions.asProcedural === true;

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
        }

        // Normalize AdGuard's attribute-based procedural operators.
        // Normalize ABP's procedural operator names
        if ( this.asProcedural ) {
            if ( this.reExtendedSyntax.test(raw) ) {
                raw = raw.replace(this.reExtendedSyntaxReplacer, (a, a1, a2, a3) => {
                    const op = this.normalizedExtendedSyntaxOperators.get(a1);
                    if ( op === undefined ) { return a; }
                    return `:${op}(${a3})`;
                });
            } else {
                raw = raw.replace(this.abpProceduralOpReplacer, match => {
                    if ( match === ':-abp-contains(' ) {
                        return ':has-text(';
                    } else if ( match === ':-abp-has(' ) {
                        this.asProcedural = false;
                        return ':has(';
                    }
                    return match;
                });
            }
        }

        // Relative selectors not allowed at top level.
        if ( this.reIsRelativeSelector.test(raw) ) { return false; }

        if ( this.reCommonSelector.test(raw) ) {
            out.compiled = raw;
            return true;
        }

        out.compiled = this.compileSelector(raw);
        if ( out.compiled === undefined ) { return false; }

        if ( out.compiled instanceof Object ) {
            out.compiled.raw = raw;
            out.compiled = JSON.stringify(out.compiled);
        }
        return true;
    }

    compileSelector(raw) {
        const parts = this.astFromRaw(raw, 'selectorList');
        if ( parts === undefined ) { return; }
        if ( this.astHasType(parts, 'Error') ) { return; }
        if ( this.astHasType(parts, 'Selector') === false ) { return; }
        if (
            this.astHasType(parts, 'ProceduralSelector') === false &&
            this.astHasType(parts, 'ActionSelector') === false
        ) {
            return this.astSerialize(parts);
        }
        const r = this.astCompile(parts);
        if ( this.isCssable(r) ) {
            r.cssable = true;
        }
        return r;
    }

    isCssable(r) {
        if ( r instanceof Object === false ) { return false; }
        if ( Array.isArray(r.action) && r.action[0] !== 'style' ) { return false; }
        if ( r.tasks === undefined ) { return true; }
        if ( r.tasks.length > 1 ) { return false; }
        if ( r.tasks[0][0] === 'matches-media' ) { return true; }
        return false;
    }

    astFromRaw(raw, type) {
        let ast;
        try {
            ast = cssTree.parse(raw, {
                context: type,
                parseValue: false,
            });
        } catch(reason) {
            return;
        }
        const parts = [];
        this.astFlatten(ast, parts);
        return parts;
    }

    astFlatten(data, out) {
        const head = data.children && data.children.head;
        let args;
        switch ( data.type ) {
        case 'AttributeSelector':
        case 'ClassSelector':
        case 'Combinator':
        case 'IdSelector':
        case 'MediaFeature':
        case 'Nth':
        case 'Raw':
        case 'TypeSelector':
            out.push({ data });
            break;
        case 'Declaration':
            if ( data.value ) {
                this.astFlatten(data.value, args = []);
            }
            out.push({ data, args });
            args = undefined;
            break;
        case 'DeclarationList':
        case 'Identifier':
        case 'MediaQueryList':
        case 'Selector':
        case 'SelectorList':
            args = out;
            out.push({ data });
            break;
        case 'MediaQuery':
        case 'PseudoClassSelector':
        case 'PseudoElementSelector':
            if ( head ) { args = []; }
            out.push({ data, args });
            break;
        case 'Value':
            args = out;
            break;
        default:
            break;
        }
        if ( head ) {
            if ( args ) {
                this.astFlatten(head.data, args);
            }
            let next = head.next;
            while ( next ) {
                this.astFlatten(next.data, args);
                next = next.next;
            }
        }
        if ( data.type !== 'PseudoClassSelector' ) { return; }
        if ( data.name.startsWith('-abp-') && this.asProcedural === false ) {
            return;
        }
        // Post-analysis, mind:
        // - https://w3c.github.io/csswg-drafts/selectors-4/#has-pseudo
        // - https://w3c.github.io/csswg-drafts/selectors-4/#negation
        data.name = this.normalizedOperators.get(data.name) || data.name;
        if ( this.proceduralOperatorNames.has(data.name) ) {
            data.type = 'ProceduralSelector';
        } else if ( this.proceduralActionNames.has(data.name) ) {
            data.type = 'ActionSelector';
        } else if ( data.name.startsWith('-abp-') ) {
            data.type = 'Error';
            return;
        }
        if ( this.maybeProceduralOperatorNames.has(data.name) === false ) {
            return;
        }
        if ( this.astHasType(args, 'ActionSelector') ) {
            data.type = 'Error';
            return;
        }
        if ( this.astHasType(args, 'ProceduralSelector') ) {
            data.type = 'ProceduralSelector';
            return;
        }
        switch ( data.name ) {
        case 'has':
            if (
                this.asProcedural ||
                this.nativeCssHas !== true ||
                this.astHasName(args, 'has')
            ) {
                data.type = 'ProceduralSelector';
            } else if ( this.astHasType(args, 'PseudoElementSelector') ) {
                data.type = 'Error';
            }
            break;
        case 'not': {
            if ( this.astHasType(args, 'Combinator', 0) === false ) { break; }
            const selectors = this.astSelectorsFromSelectorList(args);
            if ( Array.isArray(selectors) === false || selectors.length === 0 ) {
                data.type = 'Error';
                break;
            }
            for ( const selector of selectors ) {
                if ( this.astIsValidSelector(selector) ) { continue; }
                data.type = 'Error';
                break;
            }
            break;
        }
        default:
            break;
        }
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/2300
    //   Unquoted attribute values are parsed as Identifier instead of String.
    astSerializePart(part) {
        const out = [];
        const { data } = part;
        switch ( data.type ) {
        case 'AttributeSelector': {
            const name = data.name.name;
            if ( this.reInvalidIdentifier.test(name) ) { return; }
            if ( data.matcher === null ) {
                out.push(`[${name}]`);
                break;
            }
            let value = data.value.value;
            if ( typeof value !== 'string' ) {
                value = data.value.name;
            }
            value = value.replace(/["\\]/g, '\\$&');
            let flags = '';
            if ( typeof data.flags === 'string' ) {
                if ( /^(is?|si?)$/.test(data.flags) === false ) { return; }
                flags = ` ${data.flags}`;
            }
            out.push(`[${name}${data.matcher}"${value}"${flags}]`);
            break;
        }
        case 'ClassSelector':
            if ( this.reInvalidIdentifier.test(data.name) ) { return; }
            out.push(`.${data.name}`);
            break;
        case 'Combinator':
            out.push(data.name === ' ' ? ' ' : ` ${data.name} `);
            break;
        case 'Identifier':
            if ( this.reInvalidIdentifier.test(data.name) ) { return; }
            out.push(data.name);
            break;
        case 'IdSelector':
            if ( this.reInvalidIdentifier.test(data.name) ) { return; }
            out.push(`#${data.name}`);
            break;
        case 'Nth': {
            if ( data.selector !== null ) { return; }
            if ( data.nth.type === 'AnPlusB' ) {
                const a = parseInt(data.nth.a, 10) || null;
                const b = parseInt(data.nth.b, 10) || null;
                if ( a !== null ) {
                    out.push(`${a}n`);
                    if ( b === null ) { break; }
                    if ( b < 0 ) {
                        out.push(`${b}`);
                    } else {
                        out.push(`+${b}`);
                    }
                } else if ( b !== null ) {
                    out.push(`${b}`);
                }
            } else if ( data.nth.type === 'Identifier' ) {
                out.push(data.nth.name);
            }
            break;
        }
        case 'PseudoElementSelector':
            out.push(':');
            /* fall through */
        case 'PseudoClassSelector':
            out.push(`:${data.name}`);
            if ( Array.isArray(part.args) ) {
                const arg = this.astSerialize(part.args);
                if ( typeof arg !== 'string' ) { return; }
                out.push(`(${arg})`);
            }
            break;
        case 'Raw':
            out.push(data.value);
            break;
        case 'TypeSelector':
            if ( this.reInvalidIdentifier.test(data.name) ) { return; }
            out.push(data.name);
            break;
        default:
            break;
        }
        return out.join('');
    }

    astSerialize(parts, plainCSS = true) {
        const out = [];
        for ( const part of parts ) {
            const { data } = part;
            switch ( data.type ) {
            case 'AttributeSelector':
            case 'ClassSelector':
            case 'Combinator':
            case 'Identifier':
            case 'IdSelector':
            case 'Nth':
            case 'PseudoClassSelector':
            case 'PseudoElementSelector':
            case 'TypeSelector': {
                const s = this.astSerializePart(part);
                if ( typeof s !== 'string' ) { return; }
                out.push(s);
                break;
            }
            case 'Raw':
                if ( plainCSS ) { return; }
                out.push(this.astSerializePart(part));
                break;
            case 'Selector':
                if ( out.length !== 0 ) { out.push(','); }
                break;
            case 'SelectorList':
                break;
            default:
                return;
            }
        }
        return out.join('');
    }

    astCompile(parts, details = {}) {
        if ( Array.isArray(parts) === false ) { return; }
        if ( parts.length === 0 ) { return; }
        if ( parts[0].data.type !== 'SelectorList' ) { return; }
        const out = { selector: '' };
        const prelude = [];
        const tasks = [];
        for ( const part of parts ) {
            const { data } = part;
            switch ( data.type ) {
            case 'ActionSelector': {
                if ( details.noaction ) { return; }
                if ( out.action !== undefined ) { return; }
                if ( prelude.length !== 0 ) {
                    if ( tasks.length === 0 ) {
                        out.selector = prelude.join('');
                    } else {
                        tasks.push(this.createSpathTask(prelude.join('')));
                    }
                    prelude.length = 0;
                }
                const args = this.compileArgumentAst(data.name, part.args);
                if ( args === undefined ) { return; }
                out.action = [ data.name, args ];
                break;
            }
            case 'AttributeSelector':
            case 'ClassSelector':
            case 'Combinator':
            case 'IdSelector':
            case 'PseudoClassSelector':
            case 'PseudoElementSelector':
            case 'TypeSelector':
                prelude.push(this.astSerializePart(part));
                break;
            case 'ProceduralSelector': {
                if ( prelude.length !== 0 ) {
                    let spath = prelude.join('');
                    prelude.length = 0;
                    if ( spath.endsWith(' ') ) { spath += '*'; }
                    if ( tasks.length === 0 ) {
                        out.selector = spath;
                    } else {
                        tasks.push(this.createSpathTask(spath));
                    }
                }
                const args = this.compileArgumentAst(data.name, part.args);
                if ( args === undefined ) { return; }
                tasks.push([ data.name, args ]);
                break;
            }
            case 'Selector':
                if ( prelude.length !== 0 ) {
                    prelude.push(', ');
                }
                break;
            case 'SelectorList':
                break;
            default:
                return;
            }
        }
        if ( tasks.length === 0 && out.action === undefined ) {
            if ( prelude.length === 0 ) { return; }
            return prelude.join('');
        }
        if ( prelude.length !== 0 ) {
            tasks.push(this.createSpathTask(prelude.join('')));
        }
        if ( tasks.length !== 0 ) {
            out.tasks = tasks;
        }
        return out;
    }

    astHasType(parts, type, depth = 0x7FFFFFFF) {
        if ( Array.isArray(parts) === false ) { return false; }
        for ( const part of parts ) {
            if ( part.data.type === type ) { return true; }
            if (
                Array.isArray(part.args) &&
                depth !== 0 &&
                this.astHasType(part.args, type, depth-1)
            ) {
                return true;
            }
        }
        return false;
    }

    astHasName(parts, name) {
        if ( Array.isArray(parts) === false ) { return false; }
        for ( const part of parts ) {
            if ( part.data.name === name ) { return true; }
            if ( Array.isArray(part.args) && this.astHasName(part.args, name) ) {
                return true;
            }
        }
        return false;
    }

    astSelectorsFromSelectorList(args) {
        if ( args.length < 3 ) { return; }
        if ( args[0].data instanceof Object === false ) { return; }
        if ( args[0].data.type !== 'SelectorList' ) { return; }
        if ( args[1].data instanceof Object === false ) { return; }
        if ( args[1].data.type !== 'Selector' ) { return; }
        const out = [];
        let beg = 1, end = 0, i = 2;
        for (;;) {
            if ( i < args.length ) {
                const type = args[i].data instanceof Object && args[i].data.type;
                if ( type === 'Selector' ) {
                    end = i;
                }
            } else {
                end = args.length;
            }
            if ( end !== 0 ) {
                const components = args.slice(beg+1, end);
                if ( components.length === 0 ) { return; }
                out.push(components);
                if ( end === args.length ) { break; }
                beg = end; end = 0;
            }
            if ( i === args.length ) { break; }
            i += 1;
        }
        return out;
    }

    astIsValidSelector(components) {
        const len = components.length;
        if ( len === 0 ) { return false; }
        if ( components[0].data.type === 'Combinator' ) { return false; }
        if ( len === 1 ) { return true; }
        if ( components[len-1].data.type === 'Combinator' ) { return false; }
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

    createSpathTask(selector) {
        return [ 'spath', selector ];
    }

    compileArgumentAst(operator, parts) {
        switch ( operator ) {
        case 'has': {
            let r = this.astCompile(parts, { noaction: true });
            if ( typeof r === 'string' ) {
                r = { selector: r.replace(/^\s*:scope\s*/, ' ') };
            }
            return r;
        }
        case 'not': {
            return this.astCompile(parts, { noaction: true });
        }
        default:
            break;
        }
        if ( Array.isArray(parts) === false || parts.length === 0 ) { return; }
        const arg = this.astSerialize(parts, false);
        if ( arg === undefined ) { return; }
        switch ( operator ) {
        case 'has-text':
            return this.compileText(arg);
        case 'if':
            return this.compileSelector(arg);
        case 'if-not':
            return this.compileSelector(arg);
        case 'matches-attr':
            return this.compileMatchAttrArgument(arg);
        case 'matches-css':
            return this.compileCSSDeclaration(arg);
        case 'matches-css-after':
            return this.compileCSSDeclaration(`after, ${arg}`);
        case 'matches-css-before':
            return this.compileCSSDeclaration(`before, ${arg}`);
        case 'matches-media':
            return this.compileMediaQuery(arg);
        case 'matches-path':
            return this.compileText(arg);
        case 'min-text-length':
            return this.compileInteger(arg);
        case 'others':
            return this.compileNoArgument(arg);
        case 'remove':
            return this.compileNoArgument(arg);
        case 'remove-attr':
            return this.compileText(arg);
        case 'remove-class':
            return this.compileText(arg);
        case 'style':
            return this.compileStyleProperties(arg);
        case 'upward':
            return this.compileUpwardArgument(arg);
        case 'watch-attr':
            return this.compileAttrList(arg);
        case 'xpath':
            return this.compileXpathExpression(arg);
        default:
            break;
        }
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

    unquoteString(s) {
        const end = s.length;
        if ( end === 0 ) {
            return { s: '', end };
        }
        if ( /^['"]/.test(s) === false ) {
            return { s, i: end };
        }
        const quote = s.charCodeAt(0);
        const out = [];
        let i = 1, c = 0;
        for (;;) {
            c = s.charCodeAt(i);
            if ( c === quote ) {
                i += 1;
                break;
            }
            if ( c === 0x5C /* '\\' */ ) {
                i += 1;
                if ( i === end ) { break; }
                c = s.charCodeAt(i);
                if ( c !== 0x5C && c !== quote ) {
                    out.push(0x5C);
                }
            }
            out.push(c);
            i += 1;
            if ( i === end ) { break; }
        }
        return { s: String.fromCharCode(...out), i };
    }

    compileMatchAttrArgument(s) {
        if ( s === '' ) { return; }
        let attr = '', value = '';
        let r = this.unquoteString(s);
        if ( r.i === s.length ) {
            const pos = r.s.indexOf('=');
            if ( pos === -1 ) {
                attr = r.s;
            } else {
                attr = r.s.slice(0, pos);
                value = r.s.slice(pos+1);
            }
        } else {
            attr = r.s;
            if ( s.charCodeAt(r.i) !== 0x3D ) { return; }
            value = s.slice(r.i+1);
        }
        if ( attr === '' ) { return; }
        if ( value.length !== 0 ) {
            r = this.unquoteString(value);
            if ( r.i !== value.length ) { return; }
            value = r.s;
        }
        return { attr, value };
    }

    // When dealing with literal text, we must first eat _some_
    // backslash characters.
    // Remove potentially present quotes before processing.
    compileText(s) {
        if ( s === '' ) { return; }
        const r = this.unquoteString(s);
        if ( r.i !== s.length ) { return; }
        return r.s;
    }

    compileCSSDeclaration(s) {
        let pseudo; {
            const match = /^[a-z-]+,/.exec(s);
            if ( match !== null ) {
                pseudo = match[0].slice(0, -1);
                s = s.slice(match[0].length).trim();
            }
        }
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
        }
        return { name, pseudo, value: regexDetails };
    }

    compileInteger(s, min = 0, max = 0x7FFFFFFF) {
        if ( /^\d+$/.test(s) === false ) { return; }
        const n = parseInt(s, 10);
        if ( n < min || n >= max ) { return; }
        return n;
    }

    compileMediaQuery(s) {
        const parts = this.astFromRaw(s, 'mediaQueryList');
        if ( parts === undefined ) { return; }
        if ( this.astHasType(parts, 'Raw') ) { return; }
        if ( this.astHasType(parts, 'MediaQuery') === false ) { return; }
        // TODO: normalize by serializing resulting AST
        return s;
    }

    compileUpwardArgument(s) {
        const i = this.compileInteger(s, 1, 256);
        if ( i !== undefined ) { return i; }
        const parts = this.astFromRaw(s, 'selectorList' );
        if ( this.astHasType(parts, 'ProceduralSelector') ) { return; }
        if ( this.astHasType(parts, 'ActionSelector') ) { return; }
        if ( this.astHasType(parts, 'Error') ) { return; }
        return s;
    }

    compileNoArgument(s) {
        if ( s === '' ) { return s; }
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
        const parts = this.astFromRaw(s, 'declarationList');
        if ( parts === undefined ) { return; }
        if ( this.astHasType(parts, 'Declaration') === false ) { return; }
        return s;
    }

    compileAttrList(s) {
        if ( s === '' ) { return s; }
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
        const r = this.unquoteString(s);
        if ( r.i !== s.length ) { return; }
        try {
            globalThis.document.createExpression(r.s, null);
        } catch (e) {
            return;
        }
        return r.s;
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
    [ 'matches-attr', 0b11 ],
    [ 'matches-css', 0b11 ],
    [ 'matches-media', 0b11 ],
    [ 'matches-path', 0b11 ],
    [ 'min-text-length', 0b01 ],
    [ 'not', 0b01 ],
    [ 'nth-ancestor', 0b00 ],
    [ 'others', 0b11 ],
    [ 'remove', 0b11 ],
    [ 'remove-attr', 0b11 ],
    [ 'remove-class', 0b11 ],
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
const OPTTokenEhide              = 12;
const OPTTokenEmpty              = 13;
const OPTTokenFont               = 14;
const OPTTokenFrame              = 15;
const OPTTokenFrom               = 16;
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
const OPTTokenTo                 = 38;
const OPTTokenXhr                = 39;
const OPTTokenWebrtc             = 40;
const OPTTokenWebsocket          = 41;
const OPTTokenMethod             = 42;
const OPTTokenCount              = 43;

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
Parser.prototype.OPTTokenCss = OPTTokenCss;
Parser.prototype.OPTTokenDenyAllow = OPTTokenDenyAllow;
Parser.prototype.OPTTokenDoc = OPTTokenDoc;
Parser.prototype.OPTTokenEhide = OPTTokenEhide;
Parser.prototype.OPTTokenEmpty = OPTTokenEmpty;
Parser.prototype.OPTTokenFont = OPTTokenFont;
Parser.prototype.OPTTokenFrame = OPTTokenFrame;
Parser.prototype.OPTTokenFrom = OPTTokenFrom;
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
Parser.prototype.OPTTokenTo = OPTTokenTo;
Parser.prototype.OPTTokenXhr = OPTTokenXhr;
Parser.prototype.OPTTokenWebrtc = OPTTokenWebrtc;
Parser.prototype.OPTTokenWebsocket = OPTTokenWebsocket;
Parser.prototype.OPTTokenMethod = OPTTokenMethod;

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
    [ 'ehide', OPTTokenEhide | OPTNonNetworkType | OPTNonCspableType | OPTNonRedirectableType ],
    /* synonym */ [ 'elemhide', OPTTokenEhide | OPTNonNetworkType | OPTNonCspableType | OPTNonRedirectableType ],
    [ 'empty', OPTTokenEmpty | OPTBlockOnly | OPTModifierType ],
    [ 'frame', OPTTokenFrame | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTRedirectableType ],
    /* synonym */ [ 'subdocument', OPTTokenFrame | OPTCanNegate | OPTNetworkType | OPTModifiableType | OPTRedirectableType ],
    [ 'from', OPTTokenFrom | OPTMustAssign | OPTDomainList ],
    /* synonym */ [ 'domain', OPTTokenFrom | OPTMustAssign | OPTDomainList ],
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
    [ 'method', OPTTokenMethod | OPTNetworkType | OPTMustAssign ],
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
    [ 'to', OPTTokenTo | OPTMustAssign | OPTDomainList ],
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
    [ 'from', OPTTokenFrom ],
    /* synonym */ [ 'domain', OPTTokenFrom ],
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
    [ 'method', OPTTokenMethod ],
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
    [ OPTTokenEhide, 'elemhide' ],
    [ OPTTokenEmpty, 'empty' ],
    [ OPTTokenFrame, 'subdocument' ],
    [ OPTTokenFont, 'font' ],
    [ OPTTokenFrom, 'from' ],
    [ OPTTokenGenericblock, 'genericblock' ],
    [ OPTTokenGhide, 'generichide' ],
    [ OPTTokenHeader, 'header' ],
    [ OPTTokenImage, 'image' ],
    [ OPTTokenImportant, 'important' ],
    [ OPTTokenInlineFont, 'inline-font' ],
    [ OPTTokenInlineScript, 'inline-script' ],
    [ OPTTokenMatchCase, 'match-case' ],
    [ OPTTokenMedia, 'media' ],
    [ OPTTokenMethod, 'method' ],
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
    [ OPTTokenTo, 'to' ],
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
                        tokenId === OPTTokenDenyAllow ? 0b0000 : 0b1010 
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
            if ( i !== -1 && this.tokenPos[OPTTokenFrom] === -1 ) {
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
        if ( parser.hasUnicode() && parser.reUnicodeChar.test(value.hn) ) {
            value.hn = parser.normalizeHostnameValue(value.hn, 0b0110);
        }
        if ( i < this.r ) { i += 3; }
        this.l = i;
        return this;
    }
};

/******************************************************************************/

Parser.utils = Parser.prototype.utils = (( ) => {

    // Depends on:
    // https://github.com/foo123/RegexAnalyzer
    const regexAnalyzer = Regex && Regex.Analyzer || null;

    class regex {
        static firstCharCodeClass(s) {
            return /^[\x01\x03%0-9A-Za-z]/.test(s) ? 1 : 0;
        }

        static lastCharCodeClass(s) {
            return /[\x01\x03%0-9A-Za-z]$/.test(s) ? 1 : 0;
        }

        static tokenizableStrFromNode(node) {
            switch ( node.type ) {
            case 1: /* T_SEQUENCE, 'Sequence' */ {
                let s = '';
                for ( let i = 0; i < node.val.length; i++ ) {
                    s += this.tokenizableStrFromNode(node.val[i]);
                }
                return s;
            }
            case 2: /* T_ALTERNATION, 'Alternation' */
            case 8: /* T_CHARGROUP, 'CharacterGroup' */ {
                if ( node.flags.NegativeMatch ) { return '\x01'; }
                let firstChar = 0;
                let lastChar = 0;
                for ( let i = 0; i < node.val.length; i++ ) {
                    const s = this.tokenizableStrFromNode(node.val[i]);
                    if ( firstChar === 0 && this.firstCharCodeClass(s) === 1 ) {
                        firstChar = 1;
                    }
                    if ( lastChar === 0 && this.lastCharCodeClass(s) === 1 ) {
                        lastChar = 1;
                    }
                    if ( firstChar === 1 && lastChar === 1 ) { break; }
                }
                return String.fromCharCode(firstChar, lastChar);
            }
            case 4: /* T_GROUP, 'Group' */ {
                if (
                    node.flags.NegativeLookAhead === 1 ||
                    node.flags.NegativeLookBehind === 1
                ) {
                    return '';
                }
                return this.tokenizableStrFromNode(node.val);
            }
            case 16: /* T_QUANTIFIER, 'Quantifier' */ {
                if ( node.flags.max === 0 ) { return ''; }
                const s = this.tokenizableStrFromNode(node.val);
                const first = this.firstCharCodeClass(s);
                const last = this.lastCharCodeClass(s);
                if ( node.flags.min !== 0 ) {
                    return String.fromCharCode(first, last);
                }
                return String.fromCharCode(first+2, last+2);
            }
            case 64: /* T_HEXCHAR, 'HexChar' */ {
                if (
                    node.flags.Code === '01' ||
                    node.flags.Code === '02' ||
                    node.flags.Code === '03'
                ) {
                    return '\x00';
                }
                return node.flags.Char;
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
                    if ( this.firstCharCodeClass(node.val[i]) === 1 ) {
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
        }

        static isValid(reStr) {
            try {
                void new RegExp(reStr);
                if ( regexAnalyzer !== null ) {
                    void this.tokenizableStrFromNode(
                        regexAnalyzer(reStr, false).tree()
                    );
                }
            } catch(ex) {
                return false;
            }
            return true;
        }

        static isRE2(reStr) {
            if ( regexAnalyzer === null ) { return true; }
            let tree;
            try {
                tree = regexAnalyzer(reStr, false).tree();
            } catch(ex) {
                return;
            }
            const isRE2 = node => {
                if ( node instanceof Object === false ) { return true; }
                if ( node.flags instanceof Object ) {
                    if ( node.flags.LookAhead === 1 ) { return false; }
                    if ( node.flags.NegativeLookAhead === 1 ) { return false; }
                    if ( node.flags.LookBehind === 1 ) { return false; }
                    if ( node.flags.NegativeLookBehind === 1 ) { return false; }
                }
                if ( Array.isArray(node.val) ) {
                    for ( const entry of node.val ) {
                        if ( isRE2(entry) === false ) { return false; }
                    }
                }
                if ( node.val instanceof Object ) {
                    return isRE2(node.val);
                }
                return true;
            };
            return isRE2(tree);
        }

        static toTokenizableStr(reStr) {
            if ( regexAnalyzer === null ) { return ''; }
            let s = '';
            try {
                s = this.tokenizableStrFromNode(
                    regexAnalyzer(reStr, false).tree()
                );
            } catch(ex) {
            }
            // Process optional sequences
            const reOptional = /[\x02\x03]+/;
            for (;;) {
                const match = reOptional.exec(s);
                if ( match === null ) { break; }
                const left = s.slice(0, match.index);
                const middle = match[0];
                const right = s.slice(match.index + middle.length);
                s = left;
                s += this.firstCharCodeClass(right) === 1 ||
                        this.firstCharCodeClass(middle) === 1
                    ? '\x01'
                    : '\x00';
                s += this.lastCharCodeClass(left) === 1 ||
                        this.lastCharCodeClass(middle) === 1
                    ? '\x01'
                    : '\x00';
                s += right;
            }
            return s;
        }
    }

    const preparserTokens = new Map([
        [ 'ext_ublock', 'ublock' ],
        [ 'ext_ubol', 'ubol' ],
        [ 'env_chromium', 'chromium' ],
        [ 'env_edge', 'edge' ],
        [ 'env_firefox', 'firefox' ],
        [ 'env_legacy', 'legacy' ],
        [ 'env_mobile', 'mobile' ],
        [ 'env_mv3', 'mv3' ],
        [ 'env_safari', 'safari' ],
        [ 'cap_html_filtering', 'html_filtering' ],
        [ 'cap_user_stylesheet', 'user_stylesheet' ],
        [ 'false', 'false' ],
        // Hoping ABP-only list maintainers can at least make use of it to
        // help non-ABP content blockers better deal with filters benefiting
        // only ABP.
        [ 'ext_abp', 'false' ],
        // Compatibility with other blockers
        // https://kb.adguard.com/en/general/how-to-create-your-own-ad-filters#adguard-specific
        [ 'adguard', 'adguard' ],
        [ 'adguard_app_android', 'false' ],
        [ 'adguard_app_ios', 'false' ],
        [ 'adguard_app_mac', 'false' ],
        [ 'adguard_app_windows', 'false' ],
        [ 'adguard_ext_android_cb', 'false' ],
        [ 'adguard_ext_chromium', 'chromium' ],
        [ 'adguard_ext_edge', 'edge' ],
        [ 'adguard_ext_firefox', 'firefox' ],
        [ 'adguard_ext_opera', 'chromium' ],
        [ 'adguard_ext_safari', 'false' ],
    ]);

    const toURL = url => {
        try {
            return new URL(url.trim());
        } catch (ex) {
        }
    };

    class preparser {
        // This method returns an array of indices, corresponding to position in
        // the content string which should alternatively be parsed and discarded.
        static splitter(content, env = []) {
            const reIf = /^!#(if|endif)\b([^\n]*)(?:[\n\r]+|$)/gm;
            const stack = [];
            const shouldDiscard = ( ) => stack.some(v => v);
            const parts = [ 0 ];
            let discard = false;

            for (;;) {
                const match = reIf.exec(content);
                if ( match === null ) { break; }

                switch ( match[1] ) {
                case 'if': {
                    let expr = match[2].trim();
                    const target = expr.charCodeAt(0) === 0x21 /* '!' */;
                    if ( target ) { expr = expr.slice(1); }
                    const token = preparserTokens.get(expr);
                    const startDiscard =
                        token === 'false' && target === false ||
                        token !== undefined && env.includes(token) === target;
                    if ( discard === false && startDiscard ) {
                        parts.push(match.index);
                        discard = true;
                    }
                    stack.push(startDiscard);
                    break;
                }
                case 'endif': {
                    stack.pop();
                    const stopDiscard = shouldDiscard() === false;
                    if ( discard && stopDiscard ) {
                        parts.push(match.index + match[0].length);
                        discard = false;
                    }
                    break;
                }
                default:
                    break;
                }
            }

            parts.push(content.length);
            return parts;
        }

        static expandIncludes(parts, env = []) {
            const out = [];
            const reInclude = /^!#include +(\S+)[^\n\r]*(?:[\n\r]+|$)/gm;
            for ( const part of parts ) {
                if ( typeof part === 'string' ) {
                    out.push(part);
                    continue;
                }
                if ( part instanceof Object === false ) { continue; }
                const content = part.content;
                const slices = this.splitter(content, env);
                for ( let i = 0, n = slices.length - 1; i < n; i++ ) {
                    const slice = content.slice(slices[i+0], slices[i+1]);
                    if ( (i & 1) !== 0 ) {
                        out.push(slice);
                        continue;
                    }
                    let lastIndex = 0;
                    for (;;) {
                        const match = reInclude.exec(slice);
                        if ( match === null ) { break; }
                        if ( toURL(match[1]) !== undefined ) { continue; }
                        if ( match[1].indexOf('..') !== -1 ) { continue; }
                        // Compute nested list path relative to parent list path
                        const pos = part.url.lastIndexOf('/');
                        if ( pos === -1 ) { continue; }
                        const subURL = part.url.slice(0, pos + 1) + match[1].trim();
                        out.push(
                            slice.slice(lastIndex, match.index + match[0].length),
                            `! >>>>>>>> ${subURL}\n`,
                            { url: subURL },
                            `! <<<<<<<< ${subURL}\n`
                        );
                        lastIndex = reInclude.lastIndex;
                    }
                    out.push(lastIndex === 0 ? slice : slice.slice(lastIndex));
                }
            }
            return out;
        }

        static prune(content, env) {
            const parts = this.splitter(content, env);
            const out = [];
            for ( let i = 0, n = parts.length - 1; i < n; i += 2 ) {
                const beg = parts[i+0];
                const end = parts[i+1];
                out.push(content.slice(beg, end));
            }
            return out.join('\n');
        }

        static getHints() {
            const out = [];
            const vals = new Set();
            for ( const [ key, val ] of preparserTokens ) {
                if ( vals.has(val) ) { continue; }
                vals.add(val);
                out.push(key);
            }
            return out;
        }

        static getTokens(env) {
            const out = new Map();
            for ( const [ key, val ] of preparserTokens ) {
                out.set(key, val !== 'false' && env.includes(val));
            }
            return Array.from(out);
        }
    }

    return {
        preparser,
        regex,
    };
})();

/******************************************************************************/

const StaticFilteringParser = Parser;

export { StaticFilteringParser };

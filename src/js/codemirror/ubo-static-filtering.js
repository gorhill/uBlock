/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2018-present Raymond Hill

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

/* global CodeMirror */

'use strict';

/******************************************************************************/

import { StaticFilteringParser } from '../static-filtering-parser.js';

/******************************************************************************/

const redirectNames = new Map();
const scriptletNames = new Map();
const preparseDirectiveTokens = new Map();
const preparseDirectiveHints = [];
const originHints = [];
let hintHelperRegistered = false;

/******************************************************************************/

CodeMirror.defineMode('ubo-static-filtering', function() {
    if ( StaticFilteringParser instanceof Object === false ) { return; }
    const parser = new StaticFilteringParser({ interactive: true });

    const reURL = /\bhttps?:\/\/\S+/;
    const rePreparseDirectives = /^!#(?:if|endif|include )\b/;
    const rePreparseIfDirective = /^(!#if ?)(.*)$/;
    let parserSlot = 0;
    let netOptionValueMode = false;

    const colorCommentSpan = function(stream) {
        const { string, pos } = stream;
        if ( rePreparseDirectives.test(string) === false ) {
            const match = reURL.exec(string.slice(pos));
            if ( match !== null ) {
                if ( match.index === 0 ) {
                    stream.pos += match[0].length;
                    return 'comment link';
                }
                stream.pos += match.index;
                return 'comment';
            }
            stream.skipToEnd();
            return 'comment';
        }
        const match = rePreparseIfDirective.exec(string);
        if ( match === null ) {
            stream.skipToEnd();
            return 'directive';
        }
        if ( pos < match[1].length ) {
            stream.pos += match[1].length;
            return 'directive';
        }
        stream.skipToEnd();
        if ( match[1].endsWith(' ') === false ) {
            return 'error strong';
        }
        if ( preparseDirectiveTokens.size === 0 ) {
            return 'positive strong';
        }
        let token = match[2];
        const not = token.startsWith('!');
        if ( not ) {
            token = token.slice(1);
        }
        if ( preparseDirectiveTokens.has(token) === false ) {
            return 'error strong';
        }
        if ( not !== preparseDirectiveTokens.get(token) ) {
            return 'positive strong';
        }
        return 'negative strong';
    };

    const colorExtHTMLPatternSpan = function(stream) {
        const { i } = parser.patternSpan;
        if ( stream.pos === parser.slices[i+1] ) {
            stream.pos += 1;
            return 'def';
        }
        stream.skipToEnd();
        return 'variable';
    };

    const colorExtScriptletPatternSpan = function(stream) {
        const { pos, string } = stream;
        const { i, len } = parser.patternSpan;
        const patternBeg = parser.slices[i+1];
        if ( pos === patternBeg ) {
            stream.pos = pos + 4;
            return 'def';
        }
        if ( len > 3 ) {
            if ( pos === patternBeg + 4 ) {
                const match = /^[^,)]+/.exec(string.slice(pos));
                const token = match && match[0].trim();
                if ( token && scriptletNames.has(token) === false ) {
                    stream.pos = pos + match[0].length;
                    return 'warning';
                }
            }
            const r = parser.slices[i+len+1] - 1;
            if ( pos < r ) {
                stream.pos = r;
                return 'variable';
            }
            if ( pos === r ) {
                stream.pos = pos + 1;
                return 'def';
            }
        }
        stream.skipToEnd();
        return 'variable';
    };

    const colorExtPatternSpan = function(stream) {
        if ( (parser.flavorBits & parser.BITFlavorExtScriptlet) !== 0 ) {
            return colorExtScriptletPatternSpan(stream);
        }
        if ( (parser.flavorBits & parser.BITFlavorExtHTML) !== 0 ) {
            return colorExtHTMLPatternSpan(stream);
        }
        stream.skipToEnd();
        return 'variable';
    };

    const colorExtSpan = function(stream) {
        if ( parserSlot < parser.optionsAnchorSpan.i ) {
            const style = (parser.slices[parserSlot] & parser.BITComma) === 0
                ? 'value'
                : 'def';
            stream.pos += parser.slices[parserSlot+2];
            parserSlot += 3;
            return style;
        }
        if (
            parserSlot >= parser.optionsAnchorSpan.i &&
            parserSlot < parser.patternSpan.i
        ) {
            const style = (parser.flavorBits & parser.BITFlavorException) !== 0
                ? 'tag'
                : 'def';
            stream.pos += parser.slices[parserSlot+2];
            parserSlot += 3;
            return `${style} strong`;
        }
        if (
            parserSlot >= parser.patternSpan.i &&
            parserSlot < parser.rightSpaceSpan.i
        ) {
            return colorExtPatternSpan(stream);
        }
        stream.skipToEnd();
        return null;
    };

    const colorNetOptionValueSpan = function(stream, bits) {
        const { pos, string } = stream;
        let style;
        // Warn about unknown redirect tokens.
        if (
            string.charCodeAt(pos - 1) === 0x3D /* '=' */ &&
            /[$,](redirect(-rule)?|rewrite)=$/.test(string.slice(0, pos))
        ) {
            style = 'value';
            const end = parser.skipUntil(
                parserSlot,
                parser.commentSpan.i,
                parser.BITComma
            );
            const raw = parser.strFromSlices(parserSlot, end - 3);
            const { token } = StaticFilteringParser.parseRedirectValue(raw);
            if ( redirectNames.has(token) === false ) {
                style += ' warning';
            }
            stream.pos += raw.length;
            parserSlot = end;
            return style;
        }
        if ( (bits & parser.BITTilde) !== 0 ) {
            style = 'keyword strong';
        } else if ( (bits & parser.BITPipe) !== 0 ) {
            style = 'def';
        }
        stream.pos += parser.slices[parserSlot+2];
        parserSlot += 3;
        return style || 'value';
    };

    // https://github.com/uBlockOrigin/uBlock-issues/issues/760#issuecomment-951146371
    //   Quick fix: auto-escape commas.
    const colorNetOptionSpan = function(stream) {
        const [ slotBits, slotPos, slotLen ] =
            parser.slices.slice(parserSlot, parserSlot+3);
        if ( (slotBits & parser.BITComma) !== 0 ) {
            if ( /^,\d*?\}/.test(parser.raw.slice(slotPos)) === false ) {
                netOptionValueMode = false;
                stream.pos += slotLen;
                parserSlot += 3;
                return 'def strong';
            }
        }
        if ( netOptionValueMode ) {
            return colorNetOptionValueSpan(stream, slotBits);
        }
        if ( (slotBits & parser.BITTilde) !== 0 ) {
            stream.pos += slotLen;
            parserSlot += 3;
            return 'keyword strong';
        }
        if ( (slotBits & parser.BITEqual) !== 0 ) {
            netOptionValueMode = true;
            stream.pos += slotLen;
            parserSlot += 3;
            return 'def';
        }
        parserSlot = parser.skipUntil(
            parserSlot,
            parser.commentSpan.i,
            parser.BITComma | parser.BITEqual
        );
        stream.pos = parser.slices[parserSlot+1];
        return 'def';
    };

    const colorNetSpan = function(stream) {
        if ( parserSlot < parser.exceptionSpan.i ) {
            stream.pos += parser.slices[parserSlot+2];
            parserSlot += 3;
            return null;
        }
        if (
            parserSlot === parser.exceptionSpan.i &&
            parser.exceptionSpan.len !== 0
        ) {
            stream.pos += parser.slices[parserSlot+2];
            parserSlot += 3;
            return 'tag strong';
        }
        if (
            parserSlot === parser.patternLeftAnchorSpan.i &&
            parser.patternLeftAnchorSpan.len !== 0 ||
            parserSlot === parser.patternRightAnchorSpan.i &&
            parser.patternRightAnchorSpan.len !== 0
        ) {
            stream.pos += parser.slices[parserSlot+2];
            parserSlot += 3;
            return 'keyword strong';
        }
        if (
            parserSlot >= parser.patternSpan.i &&
            parserSlot < parser.optionsAnchorSpan.i
        ) {
            if ( parser.patternIsRegex() ) {
                stream.pos = parser.slices[parser.optionsAnchorSpan.i+1];
                parserSlot = parser.optionsAnchorSpan.i;
                return parser.patternIsTokenizable()
                    ? 'variable notice'
                    : 'variable warning';
            }
            if ( (parser.slices[parserSlot] & (parser.BITAsterisk | parser.BITCaret)) !== 0 ) {
                stream.pos += parser.slices[parserSlot+2];
                parserSlot += 3;
                return 'keyword strong';
            }
            const nextSlot = parser.skipUntil(
                parserSlot + 3,
                parser.patternRightAnchorSpan.i,
                parser.BITAsterisk | parser.BITCaret
            );
            stream.pos = parser.slices[nextSlot+1];
            parserSlot = nextSlot;
            return 'variable';
        }
        if (
            parserSlot === parser.optionsAnchorSpan.i &&
            parserSlot < parser.optionsSpan.i !== 0
        ) {
            stream.pos += parser.slices[parserSlot+2];
            parserSlot += 3;
            return 'def strong';
        }
        if (
            parserSlot >= parser.optionsSpan.i &&
            parserSlot < parser.commentSpan.i
        ) {
            return colorNetOptionSpan(stream);
        }
        if (
            parserSlot >= parser.commentSpan.i &&
            parser.commentSpan.len !== 0
        ) {
            stream.skipToEnd();
            return 'comment';
        }
        stream.skipToEnd();
        return null;
    };

    const colorSpan = function(stream) {
        if ( parser.category === parser.CATNone || parser.shouldIgnore() ) {
            stream.skipToEnd();
            return 'comment';
        }
        if ( parser.category === parser.CATComment ) {
            return colorCommentSpan(stream);
        }
        if ( (parser.slices[parserSlot] & parser.BITError) !== 0 ) {
            stream.pos += parser.slices[parserSlot+2];
            parserSlot += 3;
            return 'error';
        }
        if ( (parser.slices[parserSlot] & parser.BITIgnore) !== 0 ) {
            stream.pos += parser.slices[parserSlot+2];
            parserSlot += 3;
            return 'comment';
        }
        if ( parser.category === parser.CATStaticExtFilter ) {
            const style = colorExtSpan(stream) || '';
            let flavor = '';
            if ( (parser.flavorBits & parser.BITFlavorExtCosmetic) !== 0 ) {
                flavor = 'line-cm-ext-dom';
            } else if ( (parser.flavorBits & parser.BITFlavorExtScriptlet) !== 0 ) {
                flavor = 'line-cm-ext-js';
            } else if ( (parser.flavorBits & parser.BITFlavorExtHTML) !== 0 ) {
                flavor = 'line-cm-ext-html';
            }
            return `${flavor} ${style}`.trim();
        }
        if ( parser.category === parser.CATStaticNetFilter ) {
            const style = colorNetSpan(stream);
            return style ? `line-cm-net ${style}` : 'line-cm-net';
        }
        stream.skipToEnd();
        return null;
    };

    return {
        lineComment: '!',
        token: function(stream) {
            let style = '';
            if ( stream.sol() ) {
                parser.analyze(stream.string);
                parser.analyzeExtra();
                parserSlot = 0;
                netOptionValueMode = false;
            }
            style += colorSpan(stream) || '';
            if ( (parser.flavorBits & parser.BITFlavorError) !== 0 ) {
                style += ' line-background-error';
            }
            style = style.trim();
            return style !== '' ? style : null;
        },
        setHints: function(details) {
            if ( Array.isArray(details.redirectResources) ) {
                for ( const [ name, desc ] of details.redirectResources ) {
                    const displayText = desc.aliasOf !== ''
                        ? `${name} (${desc.aliasOf})`
                        : '';
                    if ( desc.canRedirect ) {
                        redirectNames.set(name, displayText);
                    }
                    if ( desc.canInject && name.endsWith('.js') ) {
                        scriptletNames.set(name.slice(0, -3), displayText);
                    }
                }
            }
            if ( Array.isArray(details.preparseDirectiveTokens)) {
                details.preparseDirectiveTokens.forEach(([ a, b ]) => {
                    preparseDirectiveTokens.set(a, b);
                });
            }
            if ( Array.isArray(details.preparseDirectiveHints)) {
                preparseDirectiveHints.push(...details.preparseDirectiveHints);
            }
            if ( Array.isArray(details.originHints) ) {
                originHints.length = 0;
                for ( const hint of details.originHints ) {
                    originHints.push(hint);
                }
            }
            if ( hintHelperRegistered === false ) {
                hintHelperRegistered = true;
                initHints();
            }
        },
        get parser() {
            return parser;
        },
    };
});

/******************************************************************************/

// Following code is for auto-completion. Reference:
//   https://codemirror.net/demo/complete.html

const initHints = function() {
    if ( StaticFilteringParser instanceof Object === false ) { return; }

    const parser = new StaticFilteringParser();
    const proceduralOperatorNames = new Map(
        Array.from(parser.proceduralOperatorTokens)
             .filter(item => (item[1] & 0b01) !== 0)
    );
    const excludedHints = new Set([
        'genericblock',
        'object-subrequest',
        'rewrite',
        'webrtc',
    ]);

    const pickBestHints = function(cursor, seedLeft, seedRight, hints) {
        const seed = (seedLeft + seedRight).trim();
        const out = [];
        // First, compare against whole seed
        for ( const hint of hints ) {
            const text = hint instanceof Object
                ? hint.displayText || hint.text
                : hint;
            if ( text.startsWith(seed) === false ) { continue; }
            out.push(hint);
        }
        if ( out.length !== 0 ) {
            return {
                from: { line: cursor.line, ch: cursor.ch - seedLeft.length },
                to: { line: cursor.line, ch: cursor.ch + seedRight.length },
                list: out,
            };
        }
        // If no match, try again with a different heuristic: valid hints are
        // those matching left seed, not matching right seed but right seed is
        // found to be a valid hint. This is to take care of cases like:
        //
        //     *$script,redomain=example.org
        //                ^
        //                + cursor position
        //
        // In such case, [ redirect=, redirect-rule= ] should be returned
        // as valid hints.
        for ( const hint of hints ) {
            const text = hint instanceof Object
                ? hint.displayText || hint.text
                : hint;
            if ( seedLeft.length === 0 ) { continue; }
            if ( text.startsWith(seedLeft) === false ) { continue; }
            if ( hints.includes(seedRight) === false ) { continue; }
            out.push(hint);
        }
        if ( out.length !== 0 ) {
            return {
                from: { line: cursor.line, ch: cursor.ch - seedLeft.length },
                to: { line: cursor.line, ch: cursor.ch },
                list: out,
            };
        }
        // If no match, try again with a different heuristic: valid hints are
        // those containing seed as a substring. This is to take care of cases
        // like:
        //
        //     *$script,redirect=gif
        //                       ^
        //                       + cursor position
        //
        // In such case, [ 1x1.gif, 1x1-transparent.gif ] should be returned
        // as valid hints.
        for ( const hint of hints ) {
            const text = hint instanceof Object
                ? hint.displayText || hint.text
                : hint;
            if ( seedLeft.length === 1 ) {
                if ( text.startsWith(seedLeft) === false ) { continue; }
            } else if ( text.includes(seed) === false ) { continue; }
            out.push(hint);
        }
        if ( out.length !== 0 ) {
            return {
                from: { line: cursor.line, ch: cursor.ch - seedLeft.length },
                to: { line: cursor.line, ch: cursor.ch + seedRight.length },
                list: out,
            };
        }
        // If still no match, try again with a different heuristic: valid hints
        // are those containing left seed as a substring. This is to take care
        // of cases like:
        //
        //     *$script,redirect=gifdomain=example.org
        //                          ^
        //                          + cursor position
        //
        // In such case, [ 1x1.gif, 1x1-transparent.gif ] should be returned
        // as valid hints.
        for ( const hint of hints ) {
            const text = hint instanceof Object
                ? hint.displayText || hint.text
                : hint;
            if ( text.includes(seedLeft) === false ) { continue; }
            out.push(hint);
        }
        if ( out.length !== 0 ) {
            return {
                from: { line: cursor.line, ch: cursor.ch - seedLeft.length },
                to: { line: cursor.line, ch: cursor.ch },
                list: out,
            };
        }
    };

    const getOriginHints = function(cursor, line, suffix = '') {
        const beg = cursor.ch;
        const matchLeft = /[^,|=~]*$/.exec(line.slice(0, beg));
        const matchRight = /^[^#,|]*/.exec(line.slice(beg));
        if ( matchLeft === null || matchRight === null ) { return; }
        const hints = [];
        for ( const text of originHints ) {
            hints.push(text + suffix);
        }
        return pickBestHints(cursor, matchLeft[0], matchRight[0], hints);
    };

    const getNetPatternHints = function(cursor, line) {
        if ( /\|\|[\w.-]*$/.test(line.slice(0, cursor.ch)) ) {
            return getOriginHints(cursor, line, '^');
        }
        // Maybe a static extended filter is meant to be crafted.
        if ( /[^\w\x80-\xF4#,.-]/.test(line) === false ) {
            return getOriginHints(cursor, line);
        }
    };

    const getNetOptionHints = function(cursor, seedLeft, seedRight) {
        const isNegated = seedLeft.startsWith('~');
        if ( isNegated ) {
            seedLeft = seedLeft.slice(1);
        }
        const assignPos = seedRight.indexOf('=');
        if ( assignPos !== -1 ) { seedRight = seedRight.slice(0, assignPos); }
        const isException = parser.isException();
        const hints = [];
        for ( let [ text, bits ] of parser.netOptionTokenDescriptors ) {
            if ( excludedHints.has(text) ) { continue; }
            if ( isNegated && (bits & parser.OPTCanNegate) === 0 ) { continue; }
            if ( isException ) {
                if ( (bits & parser.OPTBlockOnly) !== 0 ) { continue; }
            } else {
                if ( (bits & parser.OPTAllowOnly) !== 0 ) { continue; }
                if ( (assignPos === -1) && (bits & parser.OPTMustAssign) !== 0 ) {
                    text += '=';
                }
            }
            hints.push(text);
        }
        return pickBestHints(cursor, seedLeft, seedRight, hints);
    };

    const getNetRedirectHints = function(cursor, seedLeft, seedRight) {
        const hints = [];
        for ( const text of redirectNames.keys() ) {
            if ( text.startsWith('abp-resource:') ) { continue; }
            hints.push(text);
        }
        return pickBestHints(cursor, seedLeft, seedRight, hints);
    };

    const getNetHints = function(cursor, line) {
        const beg = cursor.ch;
        if ( beg <= parser.slices[parser.optionsAnchorSpan.i+1] ) {
            return getNetPatternHints(cursor, line);
        }
        const lineBefore = line.slice(0, beg);
        const lineAfter = line.slice(beg);
        let matchLeft = /[^$,]*$/.exec(lineBefore);
        let matchRight = /^[^,]*/.exec(lineAfter);
        if ( matchLeft === null || matchRight === null ) { return; }
        const assignPos = matchLeft[0].indexOf('=');
        if ( assignPos === -1 ) {
            return getNetOptionHints(cursor, matchLeft[0], matchRight[0]);
        }
        if ( /^(redirect(-rule)?|rewrite)=/.test(matchLeft[0]) ) {
            return getNetRedirectHints(
                cursor,
                matchLeft[0].slice(assignPos + 1),
                matchRight[0]
            );
        }
        if ( matchLeft[0].startsWith('domain=') ) {
            return getOriginHints(cursor, line);
        }
    };

    const getExtSelectorHints = function(cursor, line) {
        const beg = cursor.ch;
        // Special selector case: `^responseheader`
        {
            const match = /#\^([a-z]+)$/.exec(line.slice(0, beg));
            if (
                match !== null &&
                'responseheader'.startsWith(match[1]) &&
                line.slice(beg) === ''
            ) {
                return pickBestHints(
                    cursor,
                    match[1],
                    '',
                    [ 'responseheader()' ]
                );
            }
        }
        // Procedural operators
        const matchLeft = /#\^?.*:([^:]*)$/.exec(line.slice(0, beg));
        const matchRight = /^([a-z-]*)\(?/.exec(line.slice(beg));
        if ( matchLeft === null || matchRight === null ) { return; }
        const isStaticDOM = matchLeft[0].indexOf('^') !== -1;
        const hints = [];
        for ( let [ text, bits ] of proceduralOperatorNames ) {
            if ( isStaticDOM && (bits & 0b10) !== 0 ) { continue; }
            hints.push(text);
        }
        return pickBestHints(cursor, matchLeft[1], matchRight[1], hints);
    };

    const getExtHeaderHints = function(cursor, line) {
        const beg = cursor.ch;
        const matchLeft = /#\^responseheader\((.*)$/.exec(line.slice(0, beg));
        const matchRight = /^([^)]*)/.exec(line.slice(beg));
        if ( matchLeft === null || matchRight === null ) { return; }
        const hints = [];
        for ( const hint of parser.removableHTTPHeaders ) {
            hints.push(hint);
        }
        return pickBestHints(cursor, matchLeft[1], matchRight[1], hints);
    };

    const getExtScriptletHints = function(cursor, line) {
        const beg = cursor.ch;
        const matchLeft = /#\+\js\(([^,]*)$/.exec(line.slice(0, beg));
        const matchRight = /^([^,)]*)/.exec(line.slice(beg));
        if ( matchLeft === null || matchRight === null ) { return; }
        const hints = [];
        for ( const [ text, displayText ] of scriptletNames ) {
            const hint = { text };
            if ( displayText !== '' ) {
                hint.displayText = displayText;
            }
            hints.push(hint);
        }
        return pickBestHints(cursor, matchLeft[1], matchRight[1], hints);
    };

    const getCommentHints = function(cursor, line) {
        const beg = cursor.ch;
        if ( line.startsWith('!#if ') ) {
            const matchLeft = /^!#if !?(\w*)$/.exec(line.slice(0, beg));
            const matchRight = /^\w*/.exec(line.slice(beg));
            if ( matchLeft === null || matchRight === null ) { return; }
            return pickBestHints(
                cursor,
                matchLeft[1],
                matchRight[0],
                preparseDirectiveHints
            );
        }
        if ( line.startsWith('!#') && line !== '!#endif' ) {
            const matchLeft = /^!#(\w*)$/.exec(line.slice(0, beg));
            const matchRight = /^\w*/.exec(line.slice(beg));
            if ( matchLeft === null || matchRight === null ) { return; }
            const hints = [ 'if ', 'endif\n', 'include ' ];
            return pickBestHints(cursor, matchLeft[1], matchRight[0], hints);
        }
    };

    CodeMirror.registerHelper('hint', 'ubo-static-filtering', function(cm) {
        const cursor = cm.getCursor();
        const line = cm.getLine(cursor.line);
        parser.analyze(line);
        if ( parser.category === parser.CATStaticExtFilter ) {
            let hints;
            if ( cursor.ch <= parser.slices[parser.optionsAnchorSpan.i+1] ) {
                hints = getOriginHints(cursor, line);
            } else if ( parser.hasFlavor(parser.BITFlavorExtScriptlet) ) {
                hints = getExtScriptletHints(cursor, line);
            } else if ( parser.hasFlavor(parser.BITFlavorExtResponseHeader) ) {
                hints = getExtHeaderHints(cursor, line);
            } else {
                hints = getExtSelectorHints(cursor, line);
            }
            return hints;
        }
        if ( parser.category === parser.CATStaticNetFilter ) {
            return getNetHints(cursor, line);
        }
        if ( parser.category === parser.CATComment ) {
            return getCommentHints(cursor, line);
        }
        if ( parser.category === parser.CATNone ) {
            return getOriginHints(cursor, line);
        }
    });
};

/******************************************************************************/

CodeMirror.registerHelper('fold', 'ubo-static-filtering', (( ) => {
    const foldIfEndif = function(startLineNo, startLine, cm) {
        const lastLineNo = cm.lastLine();
        let endLineNo = startLineNo;
        let depth = 1;
        while ( endLineNo < lastLineNo ) {
            endLineNo += 1;
            const line = cm.getLine(endLineNo);
            if ( line.startsWith('!#endif') ) {
                depth -= 1;
                if ( depth === 0 ) {
                    return {
                        from: CodeMirror.Pos(startLineNo, startLine.length),
                        to: CodeMirror.Pos(endLineNo, 0)
                    };
                }
            }
            if ( line.startsWith('!#if') ) {
                depth += 1;
            }
        }
    };

    const foldInclude = function(startLineNo, startLine, cm) {
        const lastLineNo = cm.lastLine();
        let endLineNo = startLineNo + 1;
        if ( endLineNo >= lastLineNo ) { return; }
        if ( cm.getLine(endLineNo).startsWith('! >>>>>>>> ') === false ) {
            return;
        }
        while ( endLineNo < lastLineNo ) {
            endLineNo += 1;
            const line = cm.getLine(endLineNo);
            if ( line.startsWith('! <<<<<<<< ') ) {
                return {
                    from: CodeMirror.Pos(startLineNo, startLine.length),
                    to: CodeMirror.Pos(endLineNo, line.length)
                };
            }
        }
    };

    return function(cm, start) {
        const startLineNo = start.line;
        const startLine = cm.getLine(startLineNo);
        if ( startLine.startsWith('!#if') ) {
            return foldIfEndif(startLineNo, startLine, cm);
        }
        if ( startLine.startsWith('!#include ') ) {
            return foldInclude(startLineNo, startLine, cm);
        }
    };
})());

/******************************************************************************/

// Enhanced word selection

{
    const selectWordAt = function(cm, pos) {
        const { line, ch } = pos;
        const s = cm.getLine(line);
        const { type: token } = cm.getTokenAt(pos);
        let beg, end;

        // Select URL in comments
        if ( /\bcomment\b/.test(token) && /\blink\b/.test(token) ) {
            const l = /\S+$/.exec(s.slice(0, ch));
            if ( l && /^https?:\/\//.test(s.slice(l.index)) ) {
                const r = /^\S+/.exec(s.slice(ch));
                if ( r ) {
                    beg = l.index;
                    end = ch + r[0].length;
                }
            }
        }

        // Better word selection for extended filters: prefix
        else if (
            /\bline-cm-ext-(?:dom|html|js)\b/.test(token) &&
            /\bvalue\b/.test(token)
        ) {
            const l = /[^,.]*$/i.exec(s.slice(0, ch));
            const r = /^[^#,]*/i.exec(s.slice(ch));
            if ( l && r ) {
                beg = l.index;
                end = ch + r[0].length;
            }
        }

        // Better word selection for cosmetic and HTML filters: suffix
        else if ( /\bline-cm-ext-(?:dom|html)\b/.test(token) ) {
            const l = /[#.]?[a-z0-9_-]+$/i.exec(s.slice(0, ch));
            const r = /^[a-z0-9_-]+/i.exec(s.slice(ch));
            if ( l && r ) {
                beg = l.index;
                end = ch + r[0].length;
                if ( /\bdef\b/.test(cm.getTokenTypeAt({ line, ch: beg + 1 })) ) {
                    beg += 1;
                }
            }
        }

        // Better word selection for network filters
        else if ( /\bline-cm-net\b/.test(token) ) {
            if ( /\bvalue\b/.test(token) ) {
                const l = /[^ ,.=|]*$/i.exec(s.slice(0, ch));
                const r = /^[^ #,|]*/i.exec(s.slice(ch));
                if ( l && r ) {
                    beg = l.index;
                    end = ch + r[0].length;
                }
            } else if ( /\bdef\b/.test(token) ) {
                const l = /[a-z0-9-]+$/i.exec(s.slice(0, ch));
                const r = /^[^,]*=[^,]+/i.exec(s.slice(ch));
                if ( l && r ) {
                    beg = l.index;
                    end = ch + r[0].length;
                }
            }
        }

        if ( beg === undefined ) {
            const { anchor, head } = cm.findWordAt(pos);
            return { from: anchor, to: head };
        }

        return {
            from: { line, ch: beg },
            to: { line, ch: end },
        };
    };

    CodeMirror.defineInitHook(cm => {
        cm.setOption('configureMouse', function(cm, repeat) {
            return {
                unit: repeat === 'double' ? selectWordAt : null,
            };
        });
    });
}

/******************************************************************************/

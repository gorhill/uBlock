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

CodeMirror.defineMode('ubo-static-filtering', function() {
    const StaticFilteringParser = typeof vAPI === 'object'
        ? vAPI.StaticFilteringParser
        : self.StaticFilteringParser;
    if ( StaticFilteringParser instanceof Object === false ) { return; }
    const parser = new StaticFilteringParser({ interactive: true });

    const reDirective = /^!#(?:if|endif|include)\b/;
    let parserSlot = 0;
    let netOptionValueMode = false;

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
        const { i, len } = parser.patternSpan;
        if ( stream.pos === parser.slices[i+1] ) {
            stream.pos += 4;
            return 'def';
        }
        if ( len > 3 ) {
            const r = parser.slices[i+len+1] - 1;
            if ( stream.pos < r ) {
                stream.pos = r;
                return 'variable';
            }
            if ( stream.pos === r ) {
                stream.pos += 1;
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
                return 'variable regex';
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
            const bits = parser.slices[parserSlot];
            let style;
            if ( (bits & parser.BITComma) !== 0  ) {
                style = 'def strong';
                netOptionValueMode = false;
            } else if ( (bits & parser.BITTilde) !== 0 ) {
                style = 'keyword strong';
            } else if ( (bits & parser.BITPipe) !== 0 ) {
                style = 'def';
            } else if ( netOptionValueMode ) {
                style = 'value';
            } else if ( (bits & parser.BITEqual) !== 0 ) {
                netOptionValueMode = true;
            }
            stream.pos += parser.slices[parserSlot+2];
            parserSlot += 3;
            return style || 'def';
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
            stream.skipToEnd();
            return reDirective.test(stream.string)
                ? 'variable strong'
                : 'comment';
        }
        if ( (parser.slices[parserSlot] & parser.BITIgnore) !== 0 ) {
            stream.pos += parser.slices[parserSlot+2];
            parserSlot += 3;
            return 'comment';
        }
        if ( (parser.slices[parserSlot] & parser.BITError) !== 0 ) {
            stream.pos += parser.slices[parserSlot+2];
            parserSlot += 3;
            return 'error';
        }
        if ( parser.category === parser.CATStaticExtFilter ) {
            return colorExtSpan(stream);
        }
        if ( parser.category === parser.CATStaticNetFilter ) {
            return colorNetSpan(stream);
        }
        stream.skipToEnd();
        return null;
    };

    return {
        lineComment: '!',
        token: function(stream) {
            if ( stream.sol() ) {
                parser.analyze(stream.string);
                parser.analyzeExtra(stream.string);
                parserSlot = 0;
                netOptionValueMode = false;
            }
            let style = colorSpan(stream) || '';
            if ( (parser.flavorBits & parser.BITFlavorError) !== 0 ) {
                style += ' line-background-error';
            }
            style = style.trim();
            return style !== '' ? style : null;
        },
    };
});

/******************************************************************************/

// Following code is for auto-completion. Reference:
//   https://codemirror.net/demo/complete.html

(( ) => {
    if ( typeof vAPI !== 'object' ) { return; }

    const StaticFilteringParser = typeof vAPI === 'object'
        ? vAPI.StaticFilteringParser
        : self.StaticFilteringParser;
    if ( StaticFilteringParser instanceof Object === false ) { return; }

    const parser = new StaticFilteringParser();
    const redirectNames = new Map();
    const scriptletNames = new Map();
    const proceduralOperatorNames = new Map(
        Array.from(parser.proceduralOperatorTokens).filter(item => {
            return (item[1] & 0b01) !== 0;
        })
    );

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
        // If no match, try again with a different heuristic
        if ( out.length === 0 ) {
            for ( const hint of hints ) {
                const text = hint instanceof Object
                    ? hint.displayText || hint.text
                    : hint;
                if ( seedLeft.length === 1 ) {
                    if ( text.startsWith(seedLeft) === false ) { continue; }
                } else if ( text.includes(seed) === false ) { continue; }
                out.push(hint);
            }
        }
        return {
            from: { line: cursor.line, ch: cursor.ch - seedLeft.length },
            to: { line: cursor.line, ch: cursor.ch + seedRight.length },
            list: out,
        };
    };

    const getNetOptionHints = function(cursor, isNegated, seedLeft, seedRight) {
        const assignPos = seedRight.indexOf('=');
        if ( assignPos !== -1 ) { seedRight = seedRight.slice(0, assignPos); }
        const isException = parser.isException();
        const hints = [];
        for ( let [ text, bits ] of parser.netOptionTokens ) {
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
            hints.push(text);
        }
        return pickBestHints(cursor, seedLeft, seedRight, hints);
    };

    const getNetHints = function(cursor, line) {
        const beg = cursor.ch;
        if ( beg < parser.optionsSpan ) { return; }
        const lineBefore = line.slice(0, beg);
        const lineAfter = line.slice(beg);
        let matchLeft = /~?([^$,~]*)$/.exec(lineBefore);
        let matchRight = /^([^,]*)/.exec(lineAfter);
        if ( matchLeft === null || matchRight === null ) { return; }
        let pos = matchLeft[1].indexOf('=');
        if ( pos === -1 ) {
            return getNetOptionHints(
                cursor,
                matchLeft[0].startsWith('~'),
                matchLeft[1],
                matchRight[1]
            );
        }
        return getNetRedirectHints(
            cursor,
            matchLeft[1].slice(pos + 1),
            matchRight[1]
        );
    };

    const getExtSelectorHints = function(cursor, line) {
        const beg = cursor.ch;
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

    const getHints = function(cm) {
        const cursor = cm.getCursor();
        const line = cm.getLine(cursor.line);
        parser.analyze(line);
        if ( parser.category === parser.CATStaticExtFilter ) {
            if ( parser.hasFlavor(parser.BITFlavorExtScriptlet) ) {
                return getExtScriptletHints(cursor, line);
            }
            return getExtSelectorHints(cursor, line);
        }
        if ( parser.category === parser.CATStaticNetFilter ) {
            return getNetHints(cursor, line);
        }
    };

    vAPI.messaging.send('dashboard', {
        what: 'getResourceDetails'
    }).then(response => {
        if ( Array.isArray(response) === false ) { return; }
        for ( const [ name, details ] of response ) {
            const displayText = details.aliasOf !== ''
                ? `${name} (${details.aliasOf})`
                : '';
            if ( details.canRedirect ) {
                redirectNames.set(name, displayText);
            }
            if ( details.canInject && name.endsWith('.js') ) {
                scriptletNames.set(name.slice(0, -3), displayText);
            }
        }
        CodeMirror.registerHelper('hint', 'ubo-static-filtering', getHints);
    });
})();

/******************************************************************************/

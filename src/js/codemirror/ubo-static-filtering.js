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
    const parser = new vAPI.StaticFilteringParser({ interactive: true });
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
                parserSlot += parser.optionsAnchorSpan.i;
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
            parserSlot < parser.rightSpaceSpan.i
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
//
// TODO: implement auto-completion for `redirect=`

(( ) => {
    if ( typeof vAPI !== 'object' ) { return; }

    let resourceNames = new Map();

    vAPI.messaging.send('dashboard', {
        what: 'getResourceDetails'
    }).then(response => {
        if ( Array.isArray(response) === false ) { return; }
        resourceNames = new Map(response);
    });

    const parser = new vAPI.StaticFilteringParser();

    const getHints = function(cm) {
        const cursor = cm.getCursor();
        const line = cm.getLine(cursor.line);
        parser.analyze(line);
        if ( parser.category !== parser.CATStaticExtFilter ) {
            return;
        }
        if ( parser.hasFlavor(parser.BITFlavorExtScriptlet) === false ) {
            return;
        }
        const beg = cursor.ch;
        const matchLeft = /#\+\js\(([^,]*)$/.exec(line.slice(0, beg));
        const matchRight = /^([^,)]*)/.exec(line.slice(beg));
        if ( matchLeft === null || matchRight === null ) { return; }
        const seed = (matchLeft[1] + matchRight[1]).trim();
        const out = [];
        for ( const [ name, details ] of resourceNames ) {
            if ( name.startsWith(seed) === false ) { continue; }
            if ( details.hasData !== true ) { continue; }
            if ( name.endsWith('.js') === false ) { continue; }
            const hint = { text: name.slice(0, -3) };
            if ( details.aliasOf !== '' ) {
                hint.displayText = `${hint.text} (${details.aliasOf})`;
            }
            out.push(hint);
        }
        return {
            from: { line: cursor.line, ch: cursor.ch - matchLeft[1].length },
            to: { line: cursor.line, ch: cursor.ch + matchRight[1].length },
            list: out,
        };
    };

    CodeMirror.registerHelper('hint', 'ubo-static-filtering', getHints);
})();

/******************************************************************************/

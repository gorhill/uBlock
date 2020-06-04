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

CodeMirror.defineMode("ubo-static-filtering", function() {
    const parser = new vAPI.StaticFilteringParser(true);
    const reDirective = /^!#(?:if|endif|include)\b/;
    let parserSlot = 0;
    let netOptionValueMode = false;

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
            if ( parserSlot < parser.optionsAnchorSpan.i ) {
                const style = (parser.slices[parserSlot] & parser.BITComma) === 0
                    ? 'string-2'
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
            if ( parserSlot >= parser.patternSpan.i ) {
                stream.skipToEnd();
                return 'variable';
            }
            stream.skipToEnd();
            return '';
        }
        if ( parserSlot < parser.exceptionSpan.i ) {
            stream.pos += parser.slices[parserSlot+2];
            parserSlot += 3;
            return '';
        }
        if (
            parserSlot === parser.exceptionSpan.i &&
            parser.exceptionSpan.l !== 0
        ) {
            stream.pos += parser.slices[parserSlot+2];
            parserSlot += 3;
            return 'tag strong';
        }
        if (
            parserSlot === parser.patternLeftAnchorSpan.i &&
            parser.patternLeftAnchorSpan.l !== 0 ||
            parserSlot === parser.patternRightAnchorSpan.i &&
            parser.patternRightAnchorSpan.l !== 0
        ) {
            stream.pos += parser.slices[parserSlot+2];
            parserSlot += 3;
            return 'keyword strong';
        }
        if (
            parserSlot >= parser.patternSpan.i &&
            parserSlot < parser.patternRightAnchorSpan.i
        ) {
            if ( (parser.slices[parserSlot] & (parser.BITAsterisk | parser.BITCaret)) !== 0 ) {
                stream.pos += parser.slices[parserSlot+2];
                parserSlot += 3;
                return 'keyword strong';
            }
            const nextSlot = parser.skipUntil(
                parserSlot,
                parser.patternRightAnchorSpan.i,
                parser.BITAsterisk | parser.BITCaret
            );
            stream.pos = parser.slices[nextSlot+1];
            parserSlot = nextSlot;
            return 'variable';
        }
        if (
            parserSlot === parser.optionsAnchorSpan.i &&
            parser.optionsAnchorSpan.l !== 0
        ) {
            stream.pos += parser.slices[parserSlot+2];
            parserSlot += 3;
            return 'def strong';
        }
        if (
            parserSlot >= parser.optionsSpan.i &&
            parser.optionsSpan.l !== 0
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
                style = 'string-2';
            } else if ( (bits & parser.BITEqual) !== 0 ) {
                netOptionValueMode = true;
            }
            stream.pos += parser.slices[parserSlot+2];
            parserSlot += 3;
            return style || 'def';
        }
        if (
            parserSlot >= parser.commentSpan.i &&
            parser.commentSpan.l !== 0
        ) {
            stream.skipToEnd();
            return 'comment';
        }
        stream.skipToEnd();
        return '';
    };

    return {
        token: function(stream) {
            if ( stream.sol() ) {
                parser.analyze(stream.string);
                parser.analyzeExtra(stream.string);
                parserSlot = 0;
                netOptionValueMode = false;
            }
            let style = colorSpan(stream);
            if ( (parser.flavorBits & parser.BITFlavorError) !== 0 ) {
                style += ' line-background-error';
            }
            style = style.trim();
            return style !== '' ? style : null;
        },
    };
});

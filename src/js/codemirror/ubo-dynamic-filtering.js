/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2019-present Raymond Hill

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

CodeMirror.defineMode('ubo-dynamic-filtering', ( ) => {

    const validSwitches = new Set([
        'no-strict-blocking:',
        'no-popups:',
        'no-cosmetic-filtering:',
        'no-remote-fonts:',
        'no-large-media:',
        'no-csp-reports:',
        'no-scripting:',
    ]);
    const validSwitcheStates = new Set([
        'true',
        'false',
    ]);
    const validHnRuleTypes = new Set([
        '*',
        '3p',
        'image',
        'inline-script',
        '1p-script',
        '3p-script',
        '3p-frame',
    ]);
    const invalidURLRuleTypes = new Set([
        'doc',
        'main_frame',
    ]);
    const validActions = new Set([
        'block',
        'allow',
        'noop',
    ]);
    const reIsNotHostname = /[:/#?*]/;
    const tokens = [];

    const isSwitchRule = ( ) => {
        const token = tokens[0];
        return token.charCodeAt(token.length-1) === 0x3A /* ':' */;
    };

    const isURLRule = ( ) => {
        return tokens[1].indexOf('://') > 0;
    };

    const skipToEnd = (stream, style = null) => {
        stream.skipToEnd();
        return style;
    };

    const token = stream => {
        if ( stream.sol() ) { tokens.length = 0; }
        stream.eatSpace();
        const match = stream.match(/\S+/);
        if ( Array.isArray(match) === false ) {
            return skipToEnd(stream);
        }
        if ( tokens.length === 4 ) {
            return skipToEnd(stream, 'error');
        }
        const token = match[0];
        tokens.push(token);
        // Field 1: per-site switch or hostname
        if ( tokens.length === 1 ) {
            if ( isSwitchRule(token) ) {
                if ( validSwitches.has(token) === false ) {
                    return skipToEnd(stream, 'error');
                }
            } else if ( reIsNotHostname.test(token) && token !== '*' ) {
                return skipToEnd(stream, 'error');
            }
            return null;
        }
        // Field 2: hostname or url
        if ( tokens.length === 2 ) {
            if ( isSwitchRule(tokens[0]) ) {
                if ( reIsNotHostname.test(token) && token !== '*' ) {
                    return skipToEnd(stream, 'error');
                }
            }
            if (
                reIsNotHostname.test(token) &&
                token !== '*' &&
                isURLRule(token) === false
            ) {
                return skipToEnd(stream, 'error');
            }
            return null;
        }
        // Field 3
        if ( tokens.length === 3 ) {
            // Switch rule
            if ( isSwitchRule(tokens[0]) ) {
                if ( validSwitcheStates.has(token) === false ) {
                    return skipToEnd(stream, 'error');
                }
                return null;
            }
            // Hostname rule
            if ( isURLRule(tokens[1]) === false ) {
                if (
                    tokens[1] !== '*' && token !== '*' ||
                    tokens[1] === '*' && validHnRuleTypes.has(token) === false
                ) {
                    return skipToEnd(stream, 'error');
                }
                return null;
            }
            // URL rule
            if (
                /[^a-z_-]/.test(token) && token !== '*' ||
                invalidURLRuleTypes.has(token)
            ) {
                return skipToEnd(stream, 'error');
            }
            return null;
        }
        // Field 4
        if ( tokens.length === 4 ) {
            if (
                isSwitchRule(tokens[0]) ||
                validActions.has(token) === false
            ) {
                return skipToEnd(stream, 'error');
            }
            return null;
        }
        return skipToEnd(stream);
    };

    return { token };
});

/*
Code below is to address
https://github.com/uBlockOrigin/uMatrix-issues/issues/128

But this needs fixing because glitchiness in some cases.
I may end up having to create a custom merge view rather
than using the existing CodeMirror one.

CodeMirror.registerHelper('fold', 'ubo-dynamic-filtering', (cm, start) => {
    function isHeader(lineNo) {
        const tokentype = cm.getTokenTypeAt(CodeMirror.Pos(lineNo, 0));
        return tokentype && /\bheader\b/.test(tokentype);
    }

    function headerLevel(lineNo, line, nextLine) {
        let match = line && line.match(/^#+/);
        if (match && isHeader(lineNo)) return match[0].length;
        match = nextLine && nextLine.match(/^[=\-]+\s*$/);
        if (match && isHeader(lineNo + 1)) return nextLine[0] === '=' ? 1 : 2;
        return 100;
    }

    const firstLine = cm.getLine(start.line);
    let nextLine = cm.getLine(start.line + 1);
    const level = headerLevel(start.line, firstLine, nextLine);
    if ( level === 100 ) { return; }

    const lastLineNo = cm.lastLine();
    let end = start.line,
        nextNextLine = cm.getLine(end + 2);
    while ( end < lastLineNo ) {
        if ( headerLevel(end + 1, nextLine, nextNextLine) <= level ) { break; }
        ++end;
        nextLine = nextNextLine;
        nextNextLine = cm.getLine(end + 2);
    }

    return {
        from: CodeMirror.Pos(start.line, firstLine.length),
        to: CodeMirror.Pos(end, cm.getLine(end).length),
    };
});
*/

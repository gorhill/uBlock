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
    const reDirective = /^\s*!#(?:if|endif|include)\b/;
    const reComment1 = /^\s*!/;
    const reComment2 = /^\s*#/;
    const reExt = /(#@?(?:\$\??|\?)?#)(?!##)/;
    const reNet = /^\s*(?:@@)?.*(?:(\$)(?:[^$]+)?)?$/;
    let lineStyle = null;
    let anchorOptPos = null;
    
    const lines = [];
    let iLine = 0;

    const lineFromLineBuffer = function() {
        return lines.length === 1
            ? lines[0]
            : lines.filter(a => a.replace(/^\s*|\s+\\$/g, '')).join('');
    };

    const parseExtFilter = function() {
        lineStyle = 'staticext';
        for ( let i = 0; i < lines.length; i++ ) {
            const match = reExt.exec(lines[i]);
            if ( match === null ) { continue; }
            anchorOptPos = { y: i, x: match.index, l: match[1].length };
            break;
        }
    };

    const parseNetFilter = function() {
        lineStyle = lineFromLineBuffer().startsWith('@@')
            ? 'staticnetAllow'
            : 'staticnetBlock';
        let i = lines.length;
        while ( i-- ) {
            const pos = lines[i].lastIndexOf('$');
            if ( pos === -1 ) { continue; }
            anchorOptPos = { y: i, x: pos, l: 1 };
            break;
        }
    };

    const highlight = function(stream) {
        if ( anchorOptPos !== null && iLine === anchorOptPos.y ) {
            if ( stream.pos === anchorOptPos.x ) {
                stream.pos += anchorOptPos.l;
                return `${lineStyle} staticOpt`;
            }
            if ( stream.pos < anchorOptPos.x ) {
                stream.pos = anchorOptPos.x;
                return lineStyle;
            }
        }
        stream.skipToEnd();
        return lineStyle;
    };

    const parseMultiLine = function() {
        anchorOptPos = null;
        const line = lineFromLineBuffer();
        if ( reDirective.test(line) ) {
            lineStyle = 'directive';
            return;
        }
        if ( reComment1.test(line) ) {
            lineStyle = 'comment';
            return;
        }
        if ( line.indexOf('#') !== -1 ) {
            if ( reExt.test(line) ) {
                return parseExtFilter();
            }
            if ( reComment2.test(line) ) {
                lineStyle = 'comment';
                return;
            }
        }
        if ( reNet.test(line) ) {
            return parseNetFilter();
        }
        lineStyle = null;
    };

    return {
        startState: function() {
        },
        token: function(stream) {
            if ( iLine === lines.length || stream.string !== lines[iLine] ) {
                iLine = 0;
            }
            if ( iLine === 0 ) {
                if ( lines.length > 1 ) {
                    lines.length = 1;
                }
                let line = stream.string;
                lines[0] = line;
                if ( line.endsWith(' \\') ) {
                    do {
                        line = stream.lookAhead(lines.length);
                        if (
                            line === undefined ||
                            line.startsWith('    ') === false
                        ) { break; }
                        lines.push(line);
                    } while ( line.endsWith(' \\') );
                }
                parseMultiLine();
            }
            const style = highlight(stream);
            if ( stream.eol() ) {
                iLine += 1;
            }
            return style;
        },
    };
});

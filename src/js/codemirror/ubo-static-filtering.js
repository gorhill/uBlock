/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2018 Raymond Hill

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
    var reComment1 = /^\s*!/;
    var reComment2 = /^\s*#/;
    var reExt = /^(\s*[^#]*)(#(?:#|@#|\$#|@\$#|\?#|@\?#))(.+)$/;
    var reNet = /^(.*?)(?:(\$)([^$]+)?)?$/;
    var reNetAllow = /^\s*@@/;
    var lineStyle = null;
    var lineMatches = null;

    var lineStyles = new Map([
        [ 'staticext',      [ '', 'staticOpt', '' ] ],
        [ 'staticnetAllow', [ '', 'staticOpt', '' ] ],
        [ 'staticnetBlock', [ '', 'staticOpt', '' ] ],
    ]);

    var styleFromStream = function(stream) {
        for ( var i = 1, l = 0; i < lineMatches.length; i++ ) {
            if ( typeof lineMatches[i] !== 'string' ) { continue; }
            l += lineMatches[i].length;
            if ( stream.pos < l ) {
                stream.pos = l;
                var style = lineStyle;
                var xstyle = lineStyles.get(style)[i-1];
                if ( xstyle !== '' ) { style += ' ' + xstyle; }
                return style;
            }
        }
        stream.skipToEnd();
        return '';
    };

    return {
        token: function(stream) {
            if ( stream.sol() ) {
                lineStyle = null;
                lineMatches = null;
            } else if ( lineStyle !== null ) {
                return styleFromStream(stream);
            }
            if ( reComment1.test(stream.string) ) {
                stream.skipToEnd();
                return 'comment';
            }
            if ( stream.string.indexOf('#') !== -1 ) {
                lineMatches = reExt.exec(stream.string);
                if (
                    lineMatches !== null &&
                    lineMatches[3].startsWith('##') === false
                ) {
                    lineStyle = 'staticext';
                    return styleFromStream(stream);
                }
                if ( reComment2.test(stream.string) ) {
                    stream.skipToEnd();
                    return 'comment';
                }
            }
            lineMatches = reNet.exec(stream.string);
            if ( lineMatches !== null ) {
                lineStyle = reNetAllow.test(stream.string) ?
                    'staticnetAllow' :
                    'staticnetBlock';
                return styleFromStream(stream);
            }
            stream.skipToEnd();
            return null;
        }
    };
});

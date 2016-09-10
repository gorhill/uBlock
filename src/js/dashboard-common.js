/*******************************************************************************

    µBlock - a browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

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

/* global uDom */
'use strict';

/******************************************************************************/

self.uBlockDashboard = self.uBlockDashboard || {};

/******************************************************************************/

// Helper for client panes:
//   Remove literal duplicate lines from a set based on another set.

self.uBlockDashboard.mergeNewLines = function(text, newText) {
    var lineBeg, textEnd, lineEnd;
    var line, hash, bucket;

    // Step 1: build dictionary for existing lines.
    var fromDict = Object.create(null);
    lineBeg = 0;
    textEnd = text.length;
    while ( lineBeg < textEnd ) {
        lineEnd = text.indexOf('\n', lineBeg);
        if ( lineEnd === -1 ) {
            lineEnd = text.indexOf('\r', lineBeg);
            if ( lineEnd === -1 ) {
                lineEnd = textEnd;
            }
        }
        line = text.slice(lineBeg, lineEnd).trim();
        lineBeg = lineEnd + 1;
        if ( line.length === 0 ) {
            continue;
        }
        hash = line.slice(0, 8);
        bucket = fromDict[hash];
        if ( bucket === undefined ) {
            fromDict[hash] = line;
        } else if ( typeof bucket === 'string' ) {
            fromDict[hash] = [bucket, line];
        } else /* if ( Array.isArray(bucket) ) */ {
            bucket.push(line);
        }
    }

    // Step 2: use above dictionary to filter out duplicate lines.
    var out = [ '' ];
    lineBeg = 0;
    textEnd = newText.length;
    while ( lineBeg < textEnd ) {
        lineEnd = newText.indexOf('\n', lineBeg);
        if ( lineEnd === -1 ) {
            lineEnd = newText.indexOf('\r', lineBeg);
            if ( lineEnd === -1 ) {
                lineEnd = textEnd;
            }
        }
        line = newText.slice(lineBeg, lineEnd).trim();
        lineBeg = lineEnd + 1;
        if ( line.length === 0 ) {
            if ( out[out.length - 1] !== '' ) {
                out.push('');
            }
            continue;
        }
        bucket = fromDict[line.slice(0, 8)];
        if ( bucket === undefined ) {
            out.push(line);
            continue;
        }
        if ( typeof bucket === 'string' && line !== bucket ) {
            out.push(line);
            continue;
        }
        if ( bucket.indexOf(line) === -1 ) {
            out.push(line);
            /* continue; */
        }
    }

    return text.trim() + '\n' + out.join('\n');
};

/******************************************************************************/

// Open links in the proper window
uDom('a').attr('target', '_blank');
uDom('a[href*="dashboard.html"]').attr('target', '_parent');
uDom('.whatisthis').on('click', function() {
    uDom(this)
        .parent()
        .descendants('.whatisthis-expandable')
        .first()
        .toggleClass('whatisthis-expanded');
});

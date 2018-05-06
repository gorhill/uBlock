/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2018 Raymond Hill

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

/* global CodeMirror, uDom */

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

self.uBlockDashboard.dateNowToSensibleString = function() {
    var now = new Date(Date.now() - (new Date()).getTimezoneOffset() * 60000);
    return now.toISOString().replace(/\.\d+Z$/, '')
                            .replace(/:/g, '.')
                            .replace('T', '_');
};

/******************************************************************************/

self.uBlockDashboard.patchCodeMirrorEditor = (function() {
    var grabFocusTimer;
    var grabFocusTarget;
    var grabFocus = function() {
        grabFocusTarget.focus();
        grabFocusTimer = grabFocusTarget = undefined;
    };
    var grabFocusAsync = function(cm) {
        grabFocusTarget = cm;
        if ( grabFocusTimer === undefined ) {
            grabFocusTimer = vAPI.setTimeout(grabFocus, 1);
        }
    };

    // https://github.com/gorhill/uBlock/issues/3646
    var patchSelectAll = function(cm, details) {
        var vp = cm.getViewport();
        if ( details.ranges.length !== 1 ) { return; }
        var range = details.ranges[0],
            lineFrom = range.anchor.line,
            lineTo = range.head.line;
        if ( lineTo === lineFrom ) { return; }
        if ( range.head.ch !== 0 ) { lineTo += 1; }
        if ( lineFrom !== vp.from || lineTo !== vp.to ) { return; }
        details.update([
            {
                anchor: { line: 0, ch: 0 },
                head: { line: cm.lineCount(), ch: 0 }
            }
        ]);
        grabFocusAsync(cm);
    };

    var lastGutterClick = 0;
    var lastGutterLine = 0;

    var onGutterClicked = function(cm, line) {
        var delta = Date.now() - lastGutterClick;
        if ( delta >= 500 || line !== lastGutterLine ) {
            cm.setSelection(
                { line: line, ch: 0 },
                { line: line + 1, ch: 0 }
            );
            lastGutterClick = Date.now();
            lastGutterLine = line;
        } else {
            cm.setSelection(
                { line: 0, ch: 0 },
                { line: cm.lineCount(), ch: 0 },
                { scroll: false }
            );
            lastGutterClick = 0;
        }
        grabFocusAsync(cm);
    };

    var resizeTimer,
        resizeObserver;
    var resize = function(cm) {
        resizeTimer = undefined;
        var child = document.querySelector('.codeMirrorFillVertical');
        if ( child === null ) { return; }
        var prect = document.documentElement.getBoundingClientRect();
        var crect = child.getBoundingClientRect();
        var cssHeight = Math.floor(Math.max(prect.bottom - crect.top, 80)) + 'px';
        if ( child.style.height !== cssHeight ) {
            child.style.height = cssHeight;
            if ( cm instanceof CodeMirror ) {
                cm.refresh();
            }
        }
    };
    var resizeAsync = function(cm, delay) {
        if ( resizeTimer !== undefined ) { return; }
        resizeTimer = vAPI.setTimeout(
            resize.bind(null, cm),
            typeof delay === 'number' ? delay : 66
        );
    };

    return function(cm) {
        if ( document.querySelector('.codeMirrorFillVertical') !== null ) {
            var boundResizeAsync = resizeAsync.bind(null, cm);
            window.addEventListener('resize', boundResizeAsync);
            resizeObserver = new MutationObserver(boundResizeAsync);
            resizeObserver.observe(document.querySelector('.body'), {
                childList: true,
                subtree: true
            });
            resizeAsync(cm, 1);
        }
        if ( cm.options.inputStyle === 'contenteditable' ) {
            cm.on('beforeSelectionChange', patchSelectAll);
        }
        cm.on('gutterClick', onGutterClicked);
    };
})();

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

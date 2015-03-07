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

/* exported quickProfiler */

/******************************************************************************/

var quickProfiler = (function() {
    'use strict';

    var timer = window.performance || Date;
    var time = 0;
    var count = 0;
    var tstart = 0;
    var lastlog = timer.now();
    var prompt = '';
    var reset = function() {
        time = 0;
        count = 0;
        tstart = 0;
    };
    var avg = function() {
        return count > 0 ? time / count : 0;
    };
    var start = function(s) {
        prompt = s || '';
        tstart = timer.now();
    };
    var stop = function(period) {
        if ( period === undefined ) {
            period = 10000;
        }
        var now = timer.now();
        count += 1;
        time += (now - tstart);
        if ( (now - lastlog) >= period ) {
            console.log('µBlock> %s: %s ms (%d samples)', prompt, avg().toFixed(3), count);
            lastlog = now;
        }
    };
    return {
        reset: reset,
        start: start,
        stop: stop
    };
})();

/******************************************************************************/

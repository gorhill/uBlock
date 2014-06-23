/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
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

/******************************************************************************/

var quickProfiler = (function() {

/******************************************************************************/

var timer = performance;
var time = 0;
var count = -3;
var tstart = 0;
var lastlog = timer.now();
var prompt = '';

/******************************************************************************/

var reset = function() {
    time = 0;
    count = -3;
    tstart = 0;
};

/******************************************************************************/

var avg = function() {
    return count > 0 ? time / count : 0;
};

/******************************************************************************/

var start = function(s) {
    prompt = s || '';
    tstart = timer.now();
};

/******************************************************************************/

var stop = function() {
    count += 1;
    if ( count > 0 ) {
        var now = timer.now();
        time += (now - tstart);
        if ( (now - lastlog) > 10000 ) {
            console.log('µBlock() > %s: %s ms', prompt, avg().toFixed(3));
            lastlog = now;
        }
    }
};

/******************************************************************************/

return {
    reset: reset,
    start: start,
    stop: stop
};

/******************************************************************************/

})();

/******************************************************************************/

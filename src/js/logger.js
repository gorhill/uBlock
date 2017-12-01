/*******************************************************************************

    uBlock - a browser extension to block requests.
    Copyright (C) 2015-2017 Raymond Hill

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

'use strict';

/******************************************************************************/
/******************************************************************************/

µBlock.logger = (function() {

    var LogEntry = function(args) {
        this.init(args);
    };

    LogEntry.prototype.init = function(args) {
        this.tstamp = Date.now();
        this.tab = args[0] || '';
        this.cat = args[1] || '';
        this.d0 = args[2];
        this.d1 = args[3];
        this.d2 = args[4];
        this.d3 = args[5];
        this.d4 = args[6];
    };

    var buffer = null;
    var lastReadTime = 0;
    var writePtr = 0;

    // After 60 seconds without being read, a buffer will be considered
    // unused, and thus removed from memory.
    var logBufferObsoleteAfter = 60 * 1000;

    var janitor = function() {
        if (
            buffer !== null &&
            lastReadTime < (Date.now() - logBufferObsoleteAfter)
        ) {
            buffer = null;
            writePtr = 0;
            vAPI.messaging.broadcast({ what: 'loggerDisabled' });
        }
        if ( buffer !== null ) {
            vAPI.setTimeout(janitor, logBufferObsoleteAfter);
        }
    };

    return {
        writeOne: function() {
            if ( buffer === null ) { return; }
            if ( writePtr === buffer.length ) {
                buffer.push(new LogEntry(arguments));
            } else {
                buffer[writePtr].init(arguments);
            }
            writePtr += 1;
        },
        readAll: function() {
            if ( buffer === null ) {
                buffer = [];
                vAPI.setTimeout(janitor, logBufferObsoleteAfter);
            }
            var out = buffer.slice(0, writePtr);
            writePtr = 0;
            lastReadTime = Date.now();
            return out;
        },
        isEnabled: function() {
            return buffer !== null;
        }
    };

})();

/******************************************************************************/

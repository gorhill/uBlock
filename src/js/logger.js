/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-present Raymond Hill

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

    let buffer = null;
    let lastReadTime = 0;
    let writePtr = 0;

    // After 60 seconds without being read, a buffer will be considered
    // unused, and thus removed from memory.
    const logBufferObsoleteAfter = 30 * 1000;

    const janitor = ( ) => {
        if (
            buffer !== null &&
            lastReadTime < (Date.now() - logBufferObsoleteAfter)
        ) {
            api.enabled = false;
            buffer = null;
            writePtr = 0;
            api.ownerId = undefined;
            vAPI.messaging.broadcast({ what: 'loggerDisabled' });
        }
        if ( buffer !== null ) {
            vAPI.setTimeout(janitor, logBufferObsoleteAfter);
        }
    };

    const boxEntry = function(details) {
        if ( details.tstamp === undefined ) {
            details.tstamp = Date.now();
        }
        return JSON.stringify(details);
    };

    const api = {
        enabled: false,
        ownerId: undefined,
        writeOne: function(details) {
            if ( buffer === null ) { return; }
            const box = boxEntry(details);
            if ( writePtr === buffer.length ) {
                buffer.push(box);
            } else {
                buffer[writePtr] = box;
            }
            writePtr += 1;
        },
        readAll: function(ownerId) {
            this.ownerId = ownerId;
            if ( buffer === null ) {
                this.enabled = true;
                buffer = [];
                vAPI.setTimeout(janitor, logBufferObsoleteAfter);
            }
            const out = buffer.slice(0, writePtr);
            writePtr = 0;
            lastReadTime = Date.now();
            return out;
        },
    };

    return api;

})();

/******************************************************************************/

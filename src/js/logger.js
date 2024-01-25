/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
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

import { broadcast, broadcastToAll } from './broadcast.js';

/******************************************************************************/

let buffer = null;
let lastReadTime = 0;
let writePtr = 0;
let lastBoxedEntry = '';

// After 30 seconds without being read, the logger buffer will be considered
// unused, and thus disabled.
const logBufferObsoleteAfter = 30 * 1000;

const janitorTimer = vAPI.defer.create(( ) => {
    if ( buffer === null ) { return; }
    if ( lastReadTime >= (Date.now() - logBufferObsoleteAfter) ) {
        return janitorTimer.on(logBufferObsoleteAfter);
    }
    logger.enabled = false;
    buffer = null;
    writePtr = 0;
    lastBoxedEntry = '';
    logger.ownerId = undefined;
    broadcastToAll({ what: 'loggerDisabled' });
});

const boxEntry = details => {
    details.tstamp = Date.now() / 1000 | 0;
    return JSON.stringify(details);
};

const pushOne = box => {
    if ( writePtr === buffer.length ) {
        buffer.push(box);
    } else {
        buffer[writePtr] = box;
    }
    writePtr += 1;
};

const logger = {
    enabled: false,
    ownerId: undefined,
    writeOne(details) {
        if ( buffer === null ) { return; }
        const box = boxEntry(details);
        if ( box === lastBoxedEntry ) { return; }
        if ( lastBoxedEntry !== '' ) {
            pushOne(lastBoxedEntry);
        }
        lastBoxedEntry = box;
    },
    readAll(ownerId) {
        this.ownerId = ownerId;
        if ( buffer === null ) {
            this.enabled = true;
            buffer = [];
            janitorTimer.on(logBufferObsoleteAfter);
            broadcast({ what: 'loggerEnabled' });
        }
        if ( lastBoxedEntry !== '' ) {
            pushOne(lastBoxedEntry);
            lastBoxedEntry = '';
        }
        const out = buffer.slice(0, writePtr);
        writePtr = 0;
        lastReadTime = Date.now();
        return out;
    },
};

/******************************************************************************/

export default logger;

/******************************************************************************/

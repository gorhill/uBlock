/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-present Raymond Hill

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

/* globals process */

'use strict';

/******************************************************************************/

import { readFile } from 'fs';

import {
    FilteringContext,
    pslInit,
    restart,
} from './main.js';

/******************************************************************************/

function fetch(path) {
    return new Promise((resolve, reject) => {
        readFile(path, 'utf8', (err, data) => {
            if ( err ) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

(async ( ) => {
    /*
     * WASM require fetch(), not present in Node
        try {
            await enableWASM('//ublock/dist/build/uBlock0.nodejs');
        } catch(ex) {
        }
    */

    await fetch('./data/effective_tld_names.dat').then(pslRaw => {
        pslInit(pslRaw);
    });

    const snfe = await Promise.all([
        fetch('./data/easylist.txt'),
        fetch('./data/easyprivacy.txt'),
    ]).then(rawLists => {
        return restart([
            { name: 'easylist', raw: rawLists[0] },
            { name: 'easyprivacy', raw: rawLists[1] },
        ]);
    });

    // Reuse filtering context: it's what uBO does
    const fctxt = new FilteringContext();

    // Tests
    // Not blocked
    fctxt.setDocOriginFromURL('https://www.bloomberg.com/');
    fctxt.setURL('https://www.bloomberg.com/tophat/assets/v2.6.1/that.css');
    fctxt.setType('stylesheet');
    if ( snfe.matchRequest(fctxt) !== 0 ) {
        console.log(snfe.toLogData());
    }

    // Blocked
    fctxt.setDocOriginFromURL('https://www.bloomberg.com/');
    fctxt.setURL('https://securepubads.g.doubleclick.net/tag/js/gpt.js');
    fctxt.setType('script');
    if ( snfe.matchRequest(fctxt) !== 0 ) {
        console.log(snfe.toLogData());
    }

    // Unblocked
    fctxt.setDocOriginFromURL('https://www.bloomberg.com/');
    fctxt.setURL('https://sourcepointcmp.bloomberg.com/ccpa.js');
    fctxt.setType('script');
    if ( snfe.matchRequest(fctxt) !== 0 ) {
        console.log(snfe.toLogData());
    }

    // Remove all filters
    restart();

    process.exit();
})();

/******************************************************************************/

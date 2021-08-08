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

/* eslint-disable-next-line no-redeclare */
/* globals process */

'use strict';

/******************************************************************************/

import { createRequire } from 'module';

import {
    enableWASM,
    StaticNetFilteringEngine,
} from './index.js';

/******************************************************************************/

function fetch(listName) {
    return new Promise(resolve => {
        const require = createRequire(import.meta.url); // jshint ignore:line
        resolve(require(`./data/${listName}.json`));
    });
}

async function main() {
    try {
        const result = await enableWASM();
        if ( result !== true ) {
            console.log('Failed to enable all WASM code paths');
        }
    } catch(ex) {
        console.log(ex);
    }

    await StaticNetFilteringEngine.initialize();

    const engine = new StaticNetFilteringEngine();

    await engine.useLists([
        fetch('easylist').then(raw => ({ name: 'easylist', raw })),
        fetch('easyprivacy').then(raw => ({ name: 'easyprivacy', raw })),
    ]);

    let result = null;

    // Tests
    // Not blocked
    result = engine.matchRequest({
      originURL: 'https://www.bloomberg.com/',
      url: 'https://www.bloomberg.com/tophat/assets/v2.6.1/that.css',
      type: 'stylesheet'
    });
    if ( result !== 0 ) {
        console.log(engine.toLogData());
    }

    // Blocked
    result = engine.matchRequest({
      originURL: 'https://www.bloomberg.com/',
      url: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
      type: 'script'
    });
    if ( result !== 0 ) {
        console.log(engine.toLogData());
    }

    // Unblocked
    result = engine.matchRequest({
      originURL: 'https://www.bloomberg.com/',
      url: 'https://sourcepointcmp.bloomberg.com/ccpa.js',
      type: 'script'
    });
    if ( result !== 0 ) {
        console.log(engine.toLogData());
    }

    process.exit();
}

main();

/******************************************************************************/

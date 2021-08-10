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

import HNTrieContainer from './js/hntrie.js';

/******************************************************************************/

function fetch(listName) {
    return new Promise(resolve => {
        const require = createRequire(import.meta.url); // jshint ignore:line
        resolve(require(`./data/${listName}.json`));
    });
}

function testSNFE(engine) {
    let result = 0;

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
}

async function doSNFE() {
    const engine = await StaticNetFilteringEngine.create();

    await engine.useLists([
        fetch('easylist').then(raw => ({ name: 'easylist', raw })),
        fetch('easyprivacy').then(raw => ({ name: 'easyprivacy', raw })),
    ]);

    testSNFE(engine);

    const serialized = await engine.serialize();
    engine.useLists([]);

    testSNFE(engine);

    await engine.deserialize(serialized);

    testSNFE(engine);
}

async function doHNTrie() {
    const trieContainer = new HNTrieContainer();

    const aTrie = trieContainer.createOne();
    aTrie.add('example.org');
    aTrie.add('example.com');

    const anotherTrie = trieContainer.createOne();
    anotherTrie.add('foo.invalid');
    anotherTrie.add('bar.invalid');

    // matches() return the position at which the match starts, or -1 when
    // there is no match.

    // Matches: return 4
    console.log("aTrie.matches('www.example.org')", aTrie.matches('www.example.org'));

    // Does not match: return -1
    console.log("aTrie.matches('www.foo.invalid')", aTrie.matches('www.foo.invalid'));

    // Does not match: return -1
    console.log("anotherTrie.matches('www.example.org')", anotherTrie.matches('www.example.org'));

    // Matches: return 0
    console.log("anotherTrie.matches('foo.invalid')", anotherTrie.matches('foo.invalid'));
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

    await doSNFE();
    await doHNTrie();

    process.exit();
}

main();

/******************************************************************************/

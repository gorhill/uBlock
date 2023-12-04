/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
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

'use strict';

/******************************************************************************/

import { strict as assert } from 'assert';
import { readFile } from 'fs/promises';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { createWorld } from 'esm-world';

import './_common.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const require = createRequire(import.meta.url);

const requests = require('scaling-palm-tree/requests.json');
const results = require('./data/results.json');

async function read(path) {
    return readFile(resolve(__dirname, path), 'utf8');
}

describe('Request data', () => {
    const typeMap = {
        document: 'sub_frame',
        stylesheet: 'stylesheet',
        image: 'image',
        media: 'media',
        font: 'font',
        script: 'script',
        xhr: 'xmlhttprequest',
        fetch: 'xmlhttprequest',
        websocket: 'websocket',
        ping: 'ping',

        other: 'other',
        eventsource: 'other',
        manifest: 'other',
        texttrack: 'other',
    };

    for ( let wasm of [ false, true ] ) {
        context(`${wasm ? 'Wasm on' : 'Wasm off'}`, () => {
            let engine = null;

            before(async () => {
                const { StaticNetFilteringEngine, enableWASM } = await createWorld('./index.js', { globals: global });

                if ( wasm ) {
                    assert(await enableWASM());
                }

                engine = await StaticNetFilteringEngine.create();

                await engine.useLists([
                    read('./data/assets/ublock/badware.txt')
                        .then(raw => ({ name: 'badware', raw })),
                    read('./data/assets/ublock/filters.txt')
                        .then(raw => ({ name: 'filters', raw })),
                    read('./data/assets/ublock/filters-2020.txt')
                        .then(raw => ({ name: 'filters-2020', raw })),
                    read('./data/assets/ublock/filters-2021.txt')
                        .then(raw => ({ name: 'filters-2021', raw })),
                    read('./data/assets/ublock/privacy.txt')
                        .then(raw => ({ name: 'privacy', raw })),
                    read('./data/assets/ublock/resource-abuse.txt')
                        .then(raw => ({ name: 'resource-abuse', raw })),
                    read('./data/assets/ublock/unbreak.txt')
                        .then(raw => ({ name: 'unbreak.txt', raw })),
                    read('./data/assets/thirdparties/easylist-downloads.adblockplus.org/easylist.txt')
                        .then(raw => ({ name: 'easylist', raw })),
                    read('./data/assets/thirdparties/easylist-downloads.adblockplus.org/easyprivacy.txt')
                        .then(raw => ({ name: 'easyprivacy', raw })),
                    read('./data/assets/thirdparties/pgl.yoyo.org/as/serverlist')
                        .then(raw => ({ name: 'PGL', raw })),
                    read('./data/assets/thirdparties/urlhaus-filter/urlhaus-filter-online.txt')
                        .then(raw => ({ name: 'urlhaus', raw })),
                ]);
            });

            for ( let i = 0; i < requests.length; i++ ) {
                const { url, frameUrl, cpt } = requests[i];
                const request = { url, originURL: frameUrl, type: typeMap[cpt] };

                const expected = results[i];

                it(`should ${expected === 1 ? 'block' : 'allow'} ${request.type} URL ${request.url} from origin ${request.originURL}`, () => {
                    assert.equal(engine.matchRequest(request), expected);
                });
            }
        });
    }
});

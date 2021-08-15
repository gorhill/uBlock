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

'use strict';

/******************************************************************************/

import { strict as assert } from 'assert';
import process from 'process';

import { createWorld } from 'esm-world';

process.on('warning', warning => {
    // Ignore warnings about experimental features like
    // --experimental-vm-modules
    if ( warning.name !== 'ExperimentalWarning' ) {
        console.warn(warning.stack);
    }
});

let engine = null;

describe('SNFE', () => {
    describe('Initialization', () => {
        let StaticNetFilteringEngine = null;

        beforeEach(async () => {
            const module = await createWorld('./index.js', { globals: { URL } });

            StaticNetFilteringEngine = module.StaticNetFilteringEngine;
        });

        it('should not reject on first attempt', async () => {
            await StaticNetFilteringEngine.create();
        });

        it('should reject on second attempt', async () => {
            await StaticNetFilteringEngine.create();
            await assert.rejects(StaticNetFilteringEngine.create());
        });

        it('should reject on third attempt', async () => {
            await StaticNetFilteringEngine.create();

            try {
                await StaticNetFilteringEngine.create();
            } catch (error) {
            }

            await assert.rejects(StaticNetFilteringEngine.create());
        });
    });

    describe('Filter loading', () => {
        beforeEach(async () => {
            const globals = { URL, setTimeout, clearTimeout };

            const { StaticNetFilteringEngine } = await createWorld('./index.js', { globals });

            engine = await StaticNetFilteringEngine.create();
        });

        it('should not reject on no lists', async () => {
            await engine.useLists([]);
        });

        it('should not reject on one empty list', async () => {
            await engine.useLists([
                { name: 'easylist', raw: '' },
            ]);
        });

        it('should not reject on one list containing one filter', async () => {
            await engine.useLists([
                { name: 'easylist', raw: '/foo^' },
            ]);
        });

        it('should not reject on one list containing multiple filters', async () => {
            await engine.useLists([
                { name: 'easylist', raw: '/foo^\n||example.com^' },
            ]);
        });

        it('should not reject on multiple lists containing multiple filters', async () => {
            await engine.useLists([
                { name: 'easylist', raw: '/foo^\n||example.com^' },
                { name: 'easyprivacy', raw: '||example.net/bar/\n^bar.js?' },
            ]);
        });

        it('should not reject on promised-based lists', async () => {
            await engine.useLists([
                Promise.resolve({ name: 'easylist', raw: '/foo^\n||example.com^' }),
                Promise.resolve({ name: 'easyprivacy', raw: '||example.net/bar/\n^bar.js?' }),
            ]);
        });

        it('should reject on promised-based lists in which a promise is rejected', async () => {
            await assert.rejects(engine.useLists([
                Promise.reject({ name: 'easylist', raw: '/foo^\n||example.com^' }),
                Promise.resolve({ name: 'easyprivacy', raw: '||example.net/bar/\n^bar.js?' }),
            ]));
        });

        it('should reject on promised-based lists in which all promises are rejected', async () => {
            await assert.rejects(engine.useLists([
                Promise.reject({ name: 'easylist', raw: '/foo^\n||example.com^' }),
                Promise.reject({ name: 'easyprivacy', raw: '||example.net/bar/\n^bar.js?' }),
            ]));
        });
    });
});

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

import { createWorld } from 'esm-world';

import './_common.js';

describe('SNFE', () => {
    for ( let wasm of [ false, true ] ) {
        context(`${wasm ? 'Wasm on' : 'Wasm off'}`, () => {
            let module = null;
            let engine = null;

            beforeEach(async () => {
                module = await createWorld('./index.js', { globals: global });

                if ( wasm ) {
                    assert(await module.enableWASM());
                }
            });

            afterEach(() => {
                engine = null;
                module = null;
            });

            describe('Initialization', () => {
                it('should not reject on first attempt', async () => {
                    await module.StaticNetFilteringEngine.create();
                });

                it('should reject on second attempt', async () => {
                    await module.StaticNetFilteringEngine.create();
                    await assert.rejects(module.StaticNetFilteringEngine.create());
                });

                it('should reject on third attempt', async () => {
                    await module.StaticNetFilteringEngine.create();

                    try {
                        await module.StaticNetFilteringEngine.create();
                    } catch (error) {
                    }

                    await assert.rejects(module.StaticNetFilteringEngine.create());
                });
            });

            describe('Filter loading', () => {
                beforeEach(async () => {
                    engine = await module.StaticNetFilteringEngine.create();
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

                it('should not reject on second call in sequence', async () => {
                    await engine.useLists([
                        Promise.resolve({ name: 'easylist', raw: '/foo^\n||example.com^' }),
                        Promise.resolve({ name: 'easyprivacy', raw: '||example.net/bar/\n^bar.js?' }),
                    ]);

                    await engine.useLists([
                        Promise.resolve({ name: 'easylist', raw: '/foo^\n||example.com^' }),
                        Promise.resolve({ name: 'easyprivacy', raw: '||example.net/bar/\n^bar.js?' }),
                    ]);
                });
            });

            describe('Serialization', () => {
                beforeEach(async () => {
                    engine = await module.StaticNetFilteringEngine.create();
                });

                it('should not reject with no lists', async () => {
                    await engine.useLists([]);

                    await engine.serialize();
                });

                it('should not reject with one empty list', async () => {
                    await engine.useLists([
                        { name: 'easylist', raw: '' },
                    ]);

                    await engine.serialize();
                });

                it('should not reject with one list containing one filter', async () => {
                    await engine.useLists([
                        { name: 'easylist', raw: '/foo^' },
                    ]);

                    await engine.serialize();
                });

                it('should not reject with one list containing multiple filters', async () => {
                    await engine.useLists([
                        { name: 'easylist', raw: '/foo^\n||example.com^' },
                    ]);

                    await engine.serialize();
                });

                it('should not reject with multiple lists containing multiple filters', async () => {
                    await engine.useLists([
                        { name: 'easylist', raw: '/foo^\n||example.com^' },
                        { name: 'easyprivacy', raw: '||example.net/bar/\n^bar.js?' },
                    ]);

                    await engine.serialize();
                });
            });

            describe('Deserialization', () => {
                beforeEach(async () => {
                    engine = await module.StaticNetFilteringEngine.create();
                });

                it('should not reject with no lists', async () => {
                    await engine.useLists([]);

                    const serialized = await engine.serialize();
                    await engine.deserialize(serialized);
                });

                it('should not reject with one empty list', async () => {
                    await engine.useLists([
                        { name: 'easylist', raw: '' },
                    ]);

                    const serialized = await engine.serialize();
                    await engine.deserialize(serialized);
                });

                it('should not reject with one list containing one filter', async () => {
                    await engine.useLists([
                        { name: 'easylist', raw: '/foo^' },
                    ]);

                    const serialized = await engine.serialize();
                    await engine.deserialize(serialized);
                });

                it('should not reject with one list containing multiple filters', async () => {
                    await engine.useLists([
                        { name: 'easylist', raw: '/foo^\n||example.com^' },
                    ]);

                    const serialized = await engine.serialize();
                    await engine.deserialize(serialized);
                });

                it('should not reject with multiple lists containing multiple filters', async () => {
                    await engine.useLists([
                        { name: 'easylist', raw: '/foo^\n||example.com^' },
                        { name: 'easyprivacy', raw: '||example.net/bar/\n^bar.js?' },
                    ]);

                    const serialized = await engine.serialize();
                    await engine.deserialize(serialized);
                });
            });
        });
    }
});

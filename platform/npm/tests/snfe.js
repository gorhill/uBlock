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

import { createWorld } from 'esm-world';

import './_common.js';

describe('SNFE', () => {
    for ( let wasm of [ false/*, true*/ ] ) {
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

                // https://github.com/gorhill/uBlock/commit/8f461072f576cdf72c088a952ef342281a7c44d6
                it('should correctly remove query parameter following deserialization', async () => {
                    await engine.useLists([
                        { name: 'custom', raw: '*$removeparam=/^utm_/' },
                    ]);
                    const request = {
                        originURL: 'https://www.example.com/?utm_source=1',
                        type: 'document',
                        url: 'https://www.example.com/?utm_source=1',
                    };
                    let result = engine.filterQuery(request);
                    assert.strictEqual(result.redirectURL, 'https://www.example.com/');
                    const serialized = await engine.serialize();
                    await engine.deserialize(serialized);
                    result = engine.filterQuery(request);
                    assert.strictEqual(result.redirectURL, 'https://www.example.com/');
                });
            });

            describe('Filter matching', () => {
                beforeEach(async () => {
                    engine = await module.StaticNetFilteringEngine.create();
                });

                it('should match pure-hostname block filter', async () => {
                    await engine.useLists([
                        { name: 'test', raw: '||example.net^' },
                    ]);
                    const r = engine.matchRequest({
                        originURL: 'https://www.example.com/',
                        type: 'image',
                        url: 'https://www.example.net/',
                    });
                    assert.strictEqual(r, 1);
                });

                it('should match pure-hostname exception filter', async () => {
                    await engine.useLists([
                        { name: 'test', raw: '||example.net^\n@@||example.net^' },
                    ]);
                    const r = engine.matchRequest({
                        originURL: 'https://www.example.com/',
                        type: 'image',
                        url: 'https://www.example.net/',
                    });
                    assert.strictEqual(r, 2);
                });

                it('should match pure-hostname block-important filter', async () => {
                    await engine.useLists([
                        { name: 'test', raw: '@@||example.net^\n||example.net^$important' },
                    ]);
                    const r = engine.matchRequest({
                        originURL: 'https://www.example.com/',
                        type: 'image',
                        url: 'https://www.example.net/',
                    });
                    assert.strictEqual(r, 1);
                    assert(engine.isBlockImportant());
                });

                it('should detect the filter is block-important', async () => {
                    await engine.useLists([
                        { name: 'test', raw: '||example.net^$important' },
                    ]);
                    engine.matchRequest({
                        originURL: 'https://www.example.com/',
                        type: 'image',
                        url: 'https://www.example.net/',
                    });
                    assert(engine.isBlockImportant());
                });

                it('should block all except stylesheets #1', async () => {
                    await engine.useLists([
                        { name: 'test', raw: '||example.com^$~stylesheet,all' },
                    ]);
                    const r = engine.matchRequest({
                        originURL: 'https://www.example.com/',
                        type: 'stylesheet',
                        url: 'https://www.example.com/',
                    });
                    assert.strictEqual(r, 0);
                });

                it('should block all except stylesheets #2', async () => {
                    await engine.useLists([
                        { name: 'test', raw: '||example.com^$all,~stylesheet' },
                    ]);
                    const r = engine.matchRequest({
                        originURL: 'https://www.example.com/',
                        type: 'stylesheet',
                        url: 'https://www.example.com/',
                    });
                    assert.strictEqual(r, 0);
                });

                // https://github.com/gorhill/uBlock/commit/d66cd1116c0e
                it('should not match on localhost', async () => {
                    await engine.useLists([
                        { name: 'test', raw: '.js$domain=foo.*|bar.*\n/^/$domain=example.*|foo.*' },
                    ]);
                    const r = engine.matchRequest({
                        originURL: 'https://localhost/',
                        type: 'script',
                        url: 'https://localhost/baz.js',
                    });
                    assert.strictEqual(r, 0);
                });

                // https://github.com/AdguardTeam/AdguardFilters/issues/88067#issuecomment-1019518277
                it('should match regex-based filter without `match-case` option', async () => {
                    await engine.useLists([
                        { name: 'test', raw: '/\.com\/[a-z]{9,}\/[a-z]{9,}\.js$/$script,1p' },
                    ]);
                    const r = engine.matchRequest({
                        originURL: 'https://example.com/',
                        type: 'script',
                        url: 'https://example.com/LQMDQSMLDAZAEHERE/LQMDQSMLDAZAEHERE.js',
                    });
                    assert.strictEqual(r, 1);
                });

                it('should not match regex-based filter with `match-case` option', async () => {
                    await engine.useLists([
                        { name: 'test', raw: '/\.com\/[a-z]{9,}\/[a-z]{9,}\.js$/$script,1p,match-case' },
                    ]);
                    const r = engine.matchRequest({
                        originURL: 'https://example.com/',
                        type: 'script',
                        url: 'https://example.com/LQMDQSMLDAZAEHERE/LQMDQSMLDAZAEHERE.js',
                    });
                    assert.strictEqual(r, 0);
                });
            });
        });
    }
});

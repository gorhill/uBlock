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

/* globals process */

import * as s14e from './js/s14e-serializer.js';
import * as sfp from './js/static-filtering-parser.js';

import {
    CompiledListReader,
    CompiledListWriter,
} from './js/static-filtering-io.js';
import {
    TextDecoder,
    TextEncoder,
} from 'util';
import {
    dirname,
    resolve
} from 'path';
import {
    domainToASCII,
    fileURLToPath
} from 'url';

import { FilteringContext } from './js/filtering-context.js';
import { LineIterator } from './js/text-utils.js';
import { createRequire } from 'module';
import publicSuffixList from './lib/publicsuffixlist/publicsuffixlist.js';
import { readFileSync } from 'fs';
import snfe from './js/static-net-filtering.js';

/******************************************************************************/

const __dirname = dirname(fileURLToPath(import.meta.url));

// https://stackoverflow.com/questions/69187442/const-utf8encoder-new-textencoder-in-node-js
globalThis.TextDecoder = TextDecoder;
globalThis.TextEncoder = TextEncoder;

/******************************************************************************/

function loadJSON(path) {
    return JSON.parse(readFileSync(resolve(__dirname, path), 'utf8'));
}

/******************************************************************************/

async function enableWASM() {
    const wasmModuleFetcher = function(path) {
        const require = createRequire(import.meta.url); // jshint ignore:line
        const wasm = new Uint8Array(require(`${path}.wasm.json`));
        return WebAssembly.compile(wasm);
    };
    try {
        const results = await Promise.all([
            publicSuffixList.enableWASM(wasmModuleFetcher, './lib/publicsuffixlist/wasm/'),
            snfe.enableWASM(wasmModuleFetcher, './js/wasm/'),
        ]);
        return results.every(a => a === true);
    } catch(reason) {
        console.log(reason);
    }
    return false;
}

/******************************************************************************/

function pslInit(raw) {
    if ( typeof raw === 'string' && raw.trim() !== '' ) {
        publicSuffixList.parse(raw, domainToASCII);
        return publicSuffixList;
    }

    // Use serialized version if available
    let serialized = null;
    try {
        // Use loadJSON() because require() would keep the string in memory.
        serialized = loadJSON('build/publicsuffixlist.json');
    } catch (error) {
        if ( process.env.npm_lifecycle_event !== 'build' ) {
            // This should never happen except during package building.
            console.error(error);
        }
    }
    if ( serialized !== null ) {
        publicSuffixList.fromSelfie(serialized);
        return publicSuffixList;
    }

    raw = readFileSync(
        resolve(__dirname, './assets/thirdparties/publicsuffix.org/list/effective_tld_names.dat'),
        'utf8'
    );
    if ( typeof raw !== 'string' || raw.trim() === '' ) {
        console.error('Unable to populate public suffix list');
        return;
    }
    publicSuffixList.parse(raw, domainToASCII);
    return publicSuffixList;
}

/******************************************************************************/

function compileList({ name, raw }, compiler, writer, options = {}) {
    if ( typeof raw !== 'string' || raw === '' ) { return; }
    const lineIter = new LineIterator(raw);
    const events = Array.isArray(options.events) ? options.events : undefined;

    if ( name ) {
        writer.properties.set('name', name);
    }

    const parser = new sfp.AstFilterParser({
        maxTokenLength: snfe.MAX_TOKEN_LENGTH,
    });

    while ( lineIter.eot() === false ) {
        let line = lineIter.next();
        while ( line.endsWith(' \\') ) {
            if ( lineIter.peek(4) !== '    ' ) { break; }
            line = line.slice(0, -2).trim() + lineIter.next().trim();
        }
        parser.parse(line);
        if ( parser.isFilter() === false ) { continue; }
        if ( parser.isNetworkFilter() === false ) { continue; }
        if ( compiler.compile(parser, writer) ) { continue; }
        if ( compiler.error !== undefined && events !== undefined ) {
            options.events.push({
                type: 'error',
                text: compiler.error
            });
        }
    }

    return writer.toString();
}

/******************************************************************************/

async function useLists(lists, options = {}) {
    if ( useLists.promise !== null ) {
        throw new Error('Pending useLists() operation');
    }

    // Remove all filters
    snfe.reset();

    if ( Array.isArray(lists) === false || lists.length === 0 ) {
        return;
    }

    let compiler = null;

    const consumeList = list => {
        let { compiled } = list;
        if ( typeof compiled !== 'string' || compiled === '' ) {
            const writer = new CompiledListWriter();
            if ( compiler === null ) {
                compiler = snfe.createCompiler();
            }
            compiled = compileList(list, compiler, writer, options);
        }
        snfe.fromCompiled(new CompiledListReader(compiled));
    };

    // Populate filtering engine with resolved filter lists
    const promises = [];
    for ( const list of lists ) {
        promises.push(Promise.resolve(list).then(list => consumeList(list)));
    }

    useLists.promise = Promise.all(promises);
    await useLists.promise;
    useLists.promise = null;

    // Commit changes
    snfe.freeze();
    snfe.optimize();
}

useLists.promise = null;

/******************************************************************************/

const fctx = new FilteringContext();
let snfeProxyInstance = null;

class StaticNetFilteringEngine {
    constructor() {
        if ( snfeProxyInstance !== null ) {
            throw new Error('Only a single instance is supported.');
        }
        snfeProxyInstance = this;
    }

    useLists(lists) {
        return useLists(lists);
    }

    matchRequest(details) {
        return snfe.matchRequest(fctx.fromDetails(details));
    }

    matchAndFetchModifiers(details, modifier) {
        return snfe.matchAndFetchModifiers(fctx.fromDetails(details), modifier);
    }

    hasQuery(details) {
        return snfe.hasQuery(details);
    }

    filterQuery(details) {
        fctx.redirectURL = undefined;
        const directives = snfe.filterQuery(fctx.fromDetails(details));
        if ( directives === undefined ) { return; }
        return { redirectURL: fctx.redirectURL, directives };
    }

    isBlockImportant() {
        return snfe.isBlockImportant();
    }

    toLogData() {
        return snfe.toLogData();
    }

    createCompiler(parser) {
        return snfe.createCompiler(parser);
    }

    compileList(...args) {
        return compileList(...args);
    }

    async serialize() {
        const data = snfe.serialize();
        return s14e.serialize(data, { compress: true });
    }

    async deserialize(serialized) {
        const data = s14e.deserialize(serialized);
        return snfe.unserialize(data);
    }

    static async create({ noPSL = false } = {}) {
        const instance = new StaticNetFilteringEngine();

        if ( noPSL !== true && !pslInit() ) {
            throw new Error('Failed to initialize public suffix list.');
        }

        return instance;
    }

    static async release() {
        if ( snfeProxyInstance === null ) { return; }
        snfeProxyInstance = null;
        await useLists([]);
    }
}

/******************************************************************************/

// rollup.js needs module.exports to be set back to the local exports object.
// This is because some of the code (e.g. publicsuffixlist.js) sets
// module.exports. Once all included files are written like ES modules, using
// export statements, this should no longer be necessary.
if ( typeof module !== 'undefined' && typeof exports !== 'undefined' ) {
    module.exports = exports; // eslint-disable-line no-undef
}

export {
    enableWASM,
    pslInit,
    StaticNetFilteringEngine,
};

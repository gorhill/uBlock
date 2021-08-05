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

import { createRequire } from 'module';

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

import './lib/punycode.js';
import './lib/publicsuffixlist/publicsuffixlist.js';

import globals from './js/globals.js';
import snfe from './js/static-net-filtering.js';
import { FilteringContext } from './js/filtering-context.js';
import { LineIterator } from './js/text-utils.js';
import { StaticFilteringParser } from './js/static-filtering-parser.js';

import {
    CompiledListReader,
    CompiledListWriter,
} from './js/static-filtering-io.js';

/******************************************************************************/

function loadJSON(path) {
    return JSON.parse(readFileSync(resolve(__dirname, path), 'utf8'));
}

function compileList(list, compiler, writer, options = {}) {
    const lineIter = new LineIterator(list.raw);
    const events = Array.isArray(options.events) ? options.events : undefined;

    if ( list.name ) {
        writer.properties.set('name', list.name);
    }

    const { parser } = compiler;

    while ( lineIter.eot() === false ) {
        let line = lineIter.next();
        while ( line.endsWith(' \\') ) {
            if ( lineIter.peek(4) !== '    ' ) { break; }
            line = line.slice(0, -2).trim() + lineIter.next().trim();
        }
        parser.analyze(line);
        if ( parser.shouldIgnore() ) { continue; }
        if ( parser.category !== parser.CATStaticNetFilter ) { continue; }
        if ( parser.patternHasUnicode() && parser.toASCII() === false ) {
            continue;
        }
        if ( compiler.compile(writer) ) { continue; }
        if ( compiler.error !== undefined && events !== undefined ) {
            options.events.push({
                type: 'error',
                text: compiler.error
            });
        }
    }
}

async function enableWASM() {
    const wasmModuleFetcher = function(path) {
        const require = createRequire(import.meta.url); // jshint ignore:line
        const wasm = new Uint8Array(require(`${path}.wasm.json`));
        return globals.WebAssembly.compile(wasm);
    };
    try {
        const results = await Promise.all([
            globals.publicSuffixList.enableWASM(wasmModuleFetcher, './lib/publicsuffixlist/wasm/'),
            snfe.enableWASM(wasmModuleFetcher, './js/wasm/'),
        ]);
        return results.every(a => a === true);
    } catch(reason) {
        console.log(reason);
    }
    return false;
}

function pslInit(raw) {
    if ( typeof raw !== 'string' || raw.trim() === '' ) {
        const require = createRequire(import.meta.url); // jshint ignore:line

        let serialized = null;

        // Use serialized version if available
        try {
            // Use loadJSON() because require() would keep the string in memory.
            serialized = loadJSON('build/publicsuffixlist.json');
        } catch (error) {
            if ( process.env.npm_lifecycle_event !== 'install' ) {
                // This should never happen except during package installation.
                console.error(error);
            }
        }

        if ( serialized !== null ) {
            globals.publicSuffixList.fromSelfie(serialized);
            return globals.publicSuffixList;
        }

        raw = require('./data/effective_tld_names.json');
        if ( typeof raw !== 'string' || raw.trim() === '' ) {
            console.error('Unable to populate public suffix list');
            return;
        }
    }
    globals.publicSuffixList.parse(raw, globals.punycode.toASCII);
    return globals.publicSuffixList;
}

function createCompiler(parser) {
    return snfe.createCompiler(parser);
}

async function useCompiledLists(lists) {
    // Remove all filters
    reset();

    if ( Array.isArray(lists) === false || lists.length === 0 ) {
        return snfe;
    }

    const consumeList = list => {
        snfe.fromCompiled(new CompiledListReader(list.compiled));
    };

    // Populate filtering engine with filter lists
    const promises = [];
    for ( const list of lists ) {
        const promise = list instanceof Promise ? list : Promise.resolve(list);
        promises.push(promise.then(list => consumeList(list)));
    }

    await Promise.all(promises);

    // Commit changes
    snfe.freeze();
    snfe.optimize();

    return snfe;
}

async function useRawLists(lists, options = {}) {
    // Remove all filters
    reset();

    if ( Array.isArray(lists) === false || lists.length === 0 ) {
        return snfe;
    }

    const compiler = createCompiler(new StaticFilteringParser());

    const consumeList = list => {
        const writer = new CompiledListWriter();
        compileList(list, compiler, writer, options);
        snfe.fromCompiled(new CompiledListReader(writer.toString()));
    };

    // Populate filtering engine with filter lists
    const promises = [];
    for ( const list of lists ) {
        const promise = list instanceof Promise ? list : Promise.resolve(list);
        promises.push(promise.then(list => consumeList(list)));
    }

    await Promise.all(promises);

    // Commit changes
    snfe.freeze();
    snfe.optimize();

    return snfe;
}

function reset() {
    snfe.reset();
}

// rollup.js needs module.exports to be set back to the local exports object.
// This is because some of the code (e.g. publicsuffixlist.js) sets
// module.exports. Once all included files are written like ES modules, using
// export statements, this should no longer be necessary.
if ( typeof module !== 'undefined' && typeof exports !== 'undefined' ) {
    module.exports = exports;
}

export {
    FilteringContext,
    enableWASM,
    pslInit,
    createCompiler,
    useCompiledLists,
    useRawLists,
};

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

import './lib/punycode.js';
import './lib/publicsuffixlist/publicsuffixlist.js';

import globals from './js/globals.js';
import snfe from './js/static-net-filtering.js';
import { FilteringContext } from './js/filtering-context.js';
import { LineIterator } from './js/text-iterators.js';
import { StaticFilteringParser } from './js/static-filtering-parser.js';

import {
    CompiledListReader,
    CompiledListWriter,
} from './js/static-filtering-io.js';

/******************************************************************************/

function compileList(rawText, writer, options = {}) {
    const lineIter = new LineIterator(rawText);
    const parser = new StaticFilteringParser(true);
    const events = Array.isArray(options.events) ? options.events : undefined;

    parser.setMaxTokenLength(snfe.MAX_TOKEN_LENGTH);

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
        if ( snfe.compile(parser, writer) ) { continue; }
        if ( snfe.error !== undefined && events !== undefined ) {
            options.events.push({
                type: 'error',
                text: snfe.error
            });
        }
    }

    return writer.toString();
}

function applyList(name, raw) {
    const writer = new CompiledListWriter();
    writer.properties.set('name', name);
    const compiled = compileList(raw, writer);
    const reader = new CompiledListReader(compiled);
    snfe.fromCompiled(reader);
}

function enableWASM(path) {
    return Promise.all([
        globals.publicSuffixList.enableWASM(`${path}/lib/publicsuffixlist`),
        snfe.enableWASM(`${path}/js`),
    ]);
}

function pslInit(raw) {
    if ( typeof raw !== 'string' || raw.trim() === '' ) {
        const require = createRequire(import.meta.url); // jshint ignore:line
        raw = require('./data/effective_tld_names.json');
        if ( typeof raw !== 'string' || raw.trim() === '' ) {
            console.error('Unable to populate public suffix list');
            return;
        }
    }
    globals.publicSuffixList.parse(raw, globals.punycode.toASCII);
}

function restart(lists, options = {}) {
    // Remove all filters
    reset();

    if ( Array.isArray(lists) && lists.length !== 0 ) {
        // Populate filtering engine with filter lists
        for ( const { name, raw } of lists ) {
            applyList(name, raw, options);
        }
        // Commit changes
        snfe.freeze();
        snfe.optimize();
    }

    return snfe;
}

function reset() {
    snfe.reset();
}

export {
    FilteringContext,
    enableWASM,
    pslInit,
    restart,
};

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

import publicSuffixList from './lib/publicsuffixlist/publicsuffixlist.js';
import punycode from './lib/punycode.js';

import staticNetFilteringEngine from './js/static-net-filtering.js';
import { FilteringContext } from './js/filtering-context.js';
import { LineIterator } from './js/text-utils.js';
import * as sfp from './js/static-filtering-parser.js';

import {
    CompiledListReader,
    CompiledListWriter
} from './js/static-filtering-io.js';

/******************************************************************************/

function compileList(rawText, writer) {
    const lineIter = new LineIterator(rawText);
    const parser = new sfp.AstFilterParser({
        interactive: true,
        maxTokenLength: staticNetFilteringEngine.MAX_TOKEN_LENGTH,
    });
    const compiler = staticNetFilteringEngine.createCompiler();

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
        if ( compiler.error !== undefined ) {
            console.info(JSON.stringify({
                realm: 'message',
                type: 'error',
                text: compiler.error
            }));
        }
    }

    return writer.toString();
}

function applyList(name, raw) {
    const writer = new CompiledListWriter();
    writer.properties.set('name', name);
    const compiled = compileList(raw, writer);
    const reader = new CompiledListReader(compiled);
    staticNetFilteringEngine.fromCompiled(reader);
}

function enableWASM(path) {
    return Promise.all([
        publicSuffixList.enableWASM(`${path}/lib/publicsuffixlist`),
        staticNetFilteringEngine.enableWASM(`${path}/js`),
    ]);
}

function pslInit(raw) {
    if ( typeof raw !== 'string' || raw.trim() === '' ) {
        console.info('Unable to populate public suffix list');
        return;
    }
    publicSuffixList.parse(raw, punycode.toASCII);
    console.info('Public suffix list populated');
}

function restart(lists) {
    // Remove all filters
    reset();

    if ( Array.isArray(lists) && lists.length !== 0 ) {
        // Populate filtering engine with filter lists
        for ( const { name, raw } of lists ) {
            applyList(name, raw);
        }
        // Commit changes
        staticNetFilteringEngine.freeze();
        staticNetFilteringEngine.optimize();
    }

    return staticNetFilteringEngine;
}

function reset() {
    staticNetFilteringEngine.reset();
}

export {
    FilteringContext,
    enableWASM,
    pslInit,
    restart,
};

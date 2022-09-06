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

import staticNetFilteringEngine from './static-net-filtering.js';
import { LineIterator } from './text-utils.js';
import { StaticFilteringParser } from './static-filtering-parser.js';

import {
    CompiledListReader,
    CompiledListWriter,
} from './static-filtering-io.js';

/******************************************************************************/

function addToDNR(context, list) {
    const writer = new CompiledListWriter();
    const lineIter = new LineIterator(
        StaticFilteringParser.utils.preparser.prune(
            list.text,
            context.env || []
        )
    );
    const parser = new StaticFilteringParser();
    const compiler = staticNetFilteringEngine.createCompiler(parser);

    writer.properties.set('name', list.name);
    parser.setMaxTokenLength(staticNetFilteringEngine.MAX_TOKEN_LENGTH);
    compiler.start(writer);

    while ( lineIter.eot() === false ) {
        let line = lineIter.next();
        while ( line.endsWith(' \\') ) {
            if ( lineIter.peek(4) !== '    ' ) { break; }
            line = line.slice(0, -2).trim() + lineIter.next().trim();
        }

        parser.analyze(line);

        if ( parser.shouldIgnore() ) { continue; }
        if ( parser.category !== parser.CATStaticNetFilter ) { continue; }

        // https://github.com/gorhill/uBlock/issues/2599
        //   convert hostname to punycode if needed
        if ( parser.patternHasUnicode() && parser.toASCII() === false ) {
            continue;
        }

        if ( compiler.compile(writer) ) { continue; }

        if ( compiler.error !== undefined ) {
            context.invalid.add(compiler.error);
        }
    }

    compiler.finish(writer);

    staticNetFilteringEngine.dnrFromCompiled(
        'add',
        context,
        new CompiledListReader(writer.toString())
    );
}

/******************************************************************************/

async function dnrRulesetFromRawLists(lists, options = {}) {
    const context = staticNetFilteringEngine.dnrFromCompiled('begin');
    context.extensionPaths = new Map(options.extensionPaths || []);
    context.env = options.env;
    const toLoad = [];
    const toDNR = (context, list) => addToDNR(context, list);
    for ( const list of lists ) {
        toLoad.push(list.then(list => toDNR(context, list)));
    }
    await Promise.all(toLoad);
    const ruleset = staticNetFilteringEngine.dnrFromCompiled('end', context);
    return ruleset;
}

/******************************************************************************/

export { dnrRulesetFromRawLists };

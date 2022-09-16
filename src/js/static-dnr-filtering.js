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

function addExtendedToDNR(context, parser) {
    if ( parser.category !== parser.CATStaticExtFilter ) { return false; }

    if ( (parser.flavorBits & parser.BITFlavorUnsupported) !== 0 ) { return; }

    // Scriptlet injection
    if ( (parser.flavorBits & parser.BITFlavorExtScriptlet) !== 0 ) {
        if ( parser.hasOptions() === false ) { return; }
        if ( context.scriptletFilters === undefined ) {
            context.scriptletFilters = new Map();
        }
        const { raw, exception } = parser.result;
        for ( const { hn, not, bad } of parser.extOptions() ) {
            if ( bad ) { continue; }
            if ( hn.endsWith('.*') ) { continue; }
            if ( exception ) { continue; }
            let details = context.scriptletFilters.get(raw);
            if ( details === undefined ) {
                details = {};
                context.scriptletFilters.set(raw, details);
            }
            if ( not ) {
                if ( details.excludeMatches === undefined ) {
                    details.excludeMatches = [];
                }
                details.excludeMatches.push(hn);
                continue;
            }
            if ( details.matches === undefined ) {
                details.matches = [];
            }
            if ( details.matches.includes('*') ) { continue; }
            if ( hn === '*' ) {
                details.matches = [ '*' ];
                continue;
            }
            details.matches.push(hn);
        }
        return;
    }

    // Response header filtering
    if ( (parser.flavorBits & parser.BITFlavorExtResponseHeader) !== 0 ) {
        return;
    }

    // HTML filtering
    if ( (parser.flavorBits & parser.BITFlavorExtHTML) !== 0 ) {
        return;
    }

    // Cosmetic filtering
    if ( context.cosmeticFilters === undefined ) {
        context.cosmeticFilters = new Map();
    }

    // https://github.com/chrisaljoudi/uBlock/issues/151
    //   Negated hostname means the filter applies to all non-negated hostnames
    //   of same filter OR globally if there is no non-negated hostnames.
    for ( const { hn, not, bad } of parser.extOptions() ) {
        if ( bad ) { continue; }
        if ( hn.endsWith('.*') ) { continue; }
        const { compiled, exception } = parser.result;
        if ( compiled.startsWith('{') ) { continue; }
        if ( exception ) { continue; }
        let details = context.cosmeticFilters.get(compiled);
        if ( details === undefined ) {
            details = {};
            context.cosmeticFilters.set(compiled, details);
        }
        if ( not ) {
            if ( details.excludeMatches === undefined ) {
                details.excludeMatches = [];
            }
            details.excludeMatches.push(hn);
            continue;
        }
        if ( details.matches === undefined ) {
            details.matches = [];
        }
        if ( details.matches.includes('*') ) { continue; }
        if ( hn === '*' ) {
            details.matches = [ '*' ];
            continue;
        }
        details.matches.push(hn);
    }
}

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
    compiler.start(writer);

    while ( lineIter.eot() === false ) {
        let line = lineIter.next();
        while ( line.endsWith(' \\') ) {
            if ( lineIter.peek(4) !== '    ' ) { break; }
            line = line.slice(0, -2).trim() + lineIter.next().trim();
        }

        parser.analyze(line);

        if ( parser.shouldIgnore() ) { continue; }

        if ( parser.category !== parser.CATStaticNetFilter ) {
            addExtendedToDNR(context, parser);
            continue;
        }

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
    const context = {};
    staticNetFilteringEngine.dnrFromCompiled('begin', context);
    context.extensionPaths = new Map(options.extensionPaths || []);
    context.env = options.env;
    const toLoad = [];
    const toDNR = (context, list) => addToDNR(context, list);
    for ( const list of lists ) {
        if ( list instanceof Promise ) {
            toLoad.push(list.then(list => toDNR(context, list)));
        } else {
            toLoad.push(toDNR(context, list));
        }
    }
    await Promise.all(toLoad);

    return {
        network: staticNetFilteringEngine.dnrFromCompiled('end', context),
        cosmetic: context.cosmeticFilters,
        scriptlet: context.scriptletFilters,
    };
}

/******************************************************************************/

export { dnrRulesetFromRawLists };

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

// http://www.cse.yorku.ca/~oz/hash.html#djb2
//   Must mirror content script surveyor's version

const hashFromStr = (type, s) => {
    const len = s.length;
    const step = len + 7 >>> 3;
    let hash = (type << 5) + type ^ len;
    for ( let i = 0; i < len; i += step ) {
        hash = (hash << 5) + hash ^ s.charCodeAt(i);
    }
    return hash & 0xFFFFFF;
};

/******************************************************************************/

// Copied from cosmetic-filter.js for the time being to avoid unwanted
// dependencies

const rePlainSelector = /^[#.][\w\\-]+/;
const rePlainSelectorEscaped = /^[#.](?:\\[0-9A-Fa-f]+ |\\.|\w|-)+/;
const reEscapeSequence = /\\([0-9A-Fa-f]+ |.)/g;

const keyFromSelector = selector => {
    let matches = rePlainSelector.exec(selector);
    if ( matches === null ) { return; }
    let key = matches[0];
    if ( key.indexOf('\\') === -1 ) {
        return key;
    }
    matches = rePlainSelectorEscaped.exec(selector);
    if ( matches === null ) { return; }
    key = '';
    const escaped = matches[0];
    let beg = 0;
    reEscapeSequence.lastIndex = 0;
    for (;;) {
        matches = reEscapeSequence.exec(escaped);
        if ( matches === null ) {
            return key + escaped.slice(beg);
        }
        key += escaped.slice(beg, matches.index);
        beg = reEscapeSequence.lastIndex;
        if ( matches[1].length === 1 ) {
            key += matches[1];
        } else {
            key += String.fromCharCode(parseInt(matches[1], 16));
        }
    }
};

/******************************************************************************/

function addExtendedToDNR(context, parser) {
    if ( parser.category !== parser.CATStaticExtFilter ) { return false; }

    // Scriptlet injection
    if ( (parser.flavorBits & parser.BITFlavorExtScriptlet) !== 0 ) {
        if ( (parser.flavorBits & parser.BITFlavorUnsupported) !== 0 ) {
            return;
        }
        if ( parser.hasOptions() === false ) { return; }
        if ( context.scriptletFilters === undefined ) {
            context.scriptletFilters = new Map();
        }
        const { raw, exception } = parser.result;
        for ( const { hn, not, bad } of parser.extOptions() ) {
            if ( bad ) { continue; }
            if ( exception ) { continue; }
            let details = context.scriptletFilters.get(raw);
            if ( details === undefined ) {
                context.scriptletFilters.set(raw, details = {});
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

    // Generic cosmetic filtering
    if ( parser.hasOptions() === false ) {
        if ( context.genericCosmeticFilters === undefined ) {
            context.genericCosmeticFilters = new Map();
        }
        const { compiled } = parser.result;
        if ( compiled === undefined ) { return; }
        if ( compiled.length <= 1 ) { return; }
        if ( compiled.charCodeAt(0) === 0x7B /* '{' */ ) { return; }
        const key = keyFromSelector(compiled);
        if ( key === undefined ) { return; }
        const type = key.charCodeAt(0);
        const hash = hashFromStr(type, key.slice(1));
        let bucket = context.genericCosmeticFilters.get(hash);
        if ( bucket === undefined ) {
            context.genericCosmeticFilters.set(hash, bucket = []);
        }
        bucket.push(compiled);
        return;
    }

    // Specific cosmetic filtering
    // https://github.com/chrisaljoudi/uBlock/issues/151
    //   Negated hostname means the filter applies to all non-negated hostnames
    //   of same filter OR globally if there is no non-negated hostnames.
    if ( context.specificCosmeticFilters === undefined ) {
        context.specificCosmeticFilters = new Map();
    }
    for ( const { hn, not, bad } of parser.extOptions() ) {
        if ( bad ) { continue; }
        let { compiled, exception, raw } = parser.result;
        if ( exception ) { continue; }
        let rejected;
        if ( compiled === undefined ) {
            rejected = `Invalid filter: ${hn}##${raw}`;
        }
        if ( rejected ) {
            compiled = rejected;
        }
        let details = context.specificCosmeticFilters.get(compiled);
        if ( details === undefined ) {
            details = {};
            if ( rejected ) { details.rejected = true; }
            context.specificCosmeticFilters.set(compiled, details);
        }
        if ( rejected ) { continue; }
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
    const env = context.env || [];
    const writer = new CompiledListWriter();
    const lineIter = new LineIterator(
        StaticFilteringParser.utils.preparser.prune(list.text, env)
    );
    const parser = new StaticFilteringParser({
        nativeCssHas: env.includes('native_css_has'),
    });
    const compiler = staticNetFilteringEngine.createCompiler(parser);

    // Can't enforce `redirect-rule=` with DNR
    compiler.excludeOptions([ parser.OPTTokenRedirectRule ]);

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
    const context = Object.assign({}, options);
    staticNetFilteringEngine.dnrFromCompiled('begin', context);
    context.extensionPaths = new Map(context.extensionPaths || []);
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
        genericCosmetic: context.genericCosmeticFilters,
        specificCosmetic: context.specificCosmeticFilters,
        scriptlet: context.scriptletFilters,
    };
}

/******************************************************************************/

export { dnrRulesetFromRawLists };

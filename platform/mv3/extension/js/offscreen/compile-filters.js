/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2026-present Raymond Hill

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

import * as makeScriptlets from './make-scriptlets.js';
import * as s14e from '../../lib/s14e-serializer.js';
import * as sfp from '../static-filtering-parser.js';
import { minimizeRules, minimizeRuleset, validateRules } from '../ubo-parser.js';
import { fetchList } from './fetch-list.js';
import { makeCosmeticScripts } from './make-cosmetic-filters.js';
import { parseNetworkFilter } from '../ubo-parser.js';
import { safeReplace } from './safe-replace.js';

/******************************************************************************/

const browser = (self.browser || self.chrome);

/******************************************************************************/

function parseExpires(s) {
    const matches = s.match(/(\d+)\s*([wdhm]?)/i);
    if ( matches === null ) { return; }
    let updateAfter = parseInt(matches[1], 10);
    if ( updateAfter === 0 ) { return; }
    if ( matches[2] === 'w' ) {
        updateAfter *= 7 * 24;
    } else if ( matches[2] === 'h' ) {
        updateAfter = Math.max(updateAfter, 4) / 24;
    } else if ( matches[2] === 'm' ) {
        updateAfter = Math.max(updateAfter, 240) / 1440;
    }
    return updateAfter;
}

/******************************************************************************/

function extractMetadataFromList(content, fields) {
    const out = {};
    const head = content.slice(0, 1024);
    for ( let field of fields ) {
        field = field.replace(/\s+/g, '-');
        const re = new RegExp(`^(?:! *|# +)${field.replace(/-/g, '(?: +|-)')}: *(.+)$`, 'im');
        const match = re.exec(head);
        let value = match && match[1].trim() || undefined;
        if ( value !== undefined && value.startsWith('%') ) {
            value = undefined;
        }
        field = field.toLowerCase().replace(
            /-[a-z]/g, s => s.charAt(1).toUpperCase()
        );
        out[field] = value;
    }
    // Pre-process known fields
    if ( out.lastModified ) {
        out.lastModified = (new Date(out.lastModified)).getTime() || 0;
    }
    if ( out.expires ) {
        out.expires = parseExpires(out.expires);
    }
    return out;
}

/******************************************************************************/

function compileScriptletFilter(parser, output) {
    if ( parser.hasOptions() === false ) { return; }
    const exception = parser.isException();
    const args = parser.getScriptletArgs();
    const argsToken = JSON.stringify(args);
    for ( const { hn, not, bad } of parser.getExtFilterDomainIterator() ) {
        if ( bad ) { continue; }
        if ( exception ) { continue; }
        const details = output.get(argsToken) ?? {};
        if ( details.args === undefined ) {
            details.args = args;
            details.trustedSource = parser.options.trustedSource;
            output.set(argsToken, details);
        }
        if ( not ) {
            details.excludeMatches ??= [];
            details.excludeMatches.push(hn);
            continue;
        }
        details.matches ??= [];
        if ( details.matches.includes('*') ) { continue; }
        if ( hn === '*' ) {
            details.matches = [ '*' ];
            continue;
        }
        details.matches.push(hn);
    }
}

/******************************************************************************/

export function compileCosmeticFilter(parser, output) {
    const { compiled, exception } = parser.result;
    if ( compiled === undefined ) { return; }
    const sanitized = sanitizeCompiledCosmeticFilter(compiled);
    const matches = [];
    const excludeMatches = [];
    for ( const { hn, not, bad } of parser.getExtFilterDomainIterator() ) {
        if ( bad ) { continue; }
        if ( not && exception ) { continue; }
        if ( not || exception ) {
            excludeMatches.push(hn);
        } else if ( hn !== '*' ) {
            matches.push(hn);
        }
    }
    // This should not happen
    if ( matches.length === 0 && excludeMatches.length === 0 ) { return; }
    // Only negated hostnames => generic cosmetic filter
    if ( exception === false ) {
        if ( matches.length === 0 && excludeMatches.length !== 0 ) { return; }
    }
    const details = output.get(sanitized) ?? {};
    if ( details.matches === undefined ) {
        details.matches = [];
        details.excludeMatches = [];
        output.set(sanitized, details);
    }
    if ( matches.length ) {
        if ( matches.includes('*') ) {
            details.matches = [ '*' ];
        } else if ( details.matches.includes('*') === false ) {
            details.matches.push(...matches);
        }
    }
    if ( excludeMatches.length ) {
        details.excludeMatches.push(...excludeMatches);
    }
}

function sanitizeCompiledCosmeticFilter(compiled) {
    if ( compiled.startsWith('{') === false ) { return compiled; }
    const parsed = JSON.parse(compiled);
    parsed.raw = undefined;
    return JSON.stringify(parsed);
}

/******************************************************************************/

export function compileFilters(listid, text, context = {}) {
    if ( Boolean(text) === false ) { return; }

    const parser = new sfp.AstFilterParser(context);

    const unminimizedRules = [];
    const specificCosmeticDetails = new Map();
    const scriptletDetails = new Map();

    const lines = text.split(/\n/).map(a => a.trim());
    const filterStats = {
       total: 0,
       accepted: 0,
       rejected: 0,
    };
    for ( const line of lines ) {
        parser.parse(line);
        if ( parser.hasError() ) { continue; }
        if ( parser.isScriptletFilter() ) {
            if ( parser.hasOptions() === false ) { continue; }
            compileScriptletFilter(parser, scriptletDetails);
            continue;
        }
        if ( parser.isCosmeticFilter() ) {
            if ( parser.hasOptions() === false ) { continue; }
            compileCosmeticFilter(parser, specificCosmeticDetails);
            continue;
        }
        if ( parser.isNetworkFilter() ) {
            filterStats.total += 1;
            const rule = parseNetworkFilter(parser);
            if ( rule ) {
                unminimizedRules.push(rule);
                filterStats.accepted += 1;
            } else {
                filterStats.rejected += 1;
            }
            continue;
        }
    }

    let minimizedRules = minimizeRuleset(unminimizedRules);
    minimizedRules = minimizeRules(minimizedRules);
    minimizedRules = validateRules(minimizedRules);
    const regexRuleCount = minimizedRules.reduce((a, b) => {
        return b.condition.regexFilter ? a+1 : a;
    }, 0);

    return {
        filterStats,
        ruleStats: {
            total: minimizedRules.length,
            plain: minimizedRules.length - regexRuleCount,
            regex: regexRuleCount,
        },
        dnrRules: minimizedRules,
        specificCosmeticDetails,
        scriptletDetails,
    };
}

/******************************************************************************/

export async function toMv3Data(rulesetid, compiledData) {
    const isolated = [];
    const main = [];

    if ( Boolean(compiledData) === false ) { return; }

    if ( compiledData.scriptletDetails.size !== 0 ) {
        for ( const details of compiledData.scriptletDetails.values() ) {
            makeScriptlets.compile(rulesetid, details);
        }
        const template = await fetch('./scriptlet.template.js').then(response =>
            response.text()
        );
        const result = makeScriptlets.commit(rulesetid, template);
        if ( result.ISOLATED ) {
            const { hasRegexes, hasAncestors, hasEntities } = result.ISOLATED;
            const hostnames = hasRegexes || hasAncestors || hasEntities
                ? '*'
                : result.ISOLATED.hostnames;
            isolated.push({
                id: `${rulesetid}-isolated-scriptlets`,
                code: result.ISOLATED.code,
                hostnames,
            });
        }
        if ( result.MAIN ) {
            const { hasRegexes, hasAncestors, hasEntities } = result.MAIN;
            const hostnames = hasRegexes || hasAncestors || hasEntities
                ? '*'
                : result.MAIN.hostnames;
            main.push({
                id: `${rulesetid}-main-scriptlets`,
                code: result.MAIN.code,
                hostnames,
            });
        }
        makeScriptlets.reset();
    }

    if ( compiledData.specificCosmeticDetails.size ) {
        const result = makeCosmeticScripts(rulesetid, compiledData.specificCosmeticDetails);
        if ( result ) {
            const [
                cssAPI,
                isolatedAPI,
                proceduralAPI,
                template,
            ] = await Promise.all([
                fetch('../scripting/css-api.js').then(response => response.text()),
                fetch('../scripting/isolated-api.js').then(response => response.text()),
                fetch('../scripting/css-procedural-api.js').then(response => response.text()),
                fetch('./css-compiled.template.js').then(response => response.text()),
            ]);
            const code = [
                cssAPI,
                isolatedAPI,
                proceduralAPI,
                safeReplace(template, 'self.$cssSpecificData$', JSON.stringify(result.data)),
            ].join('\n');
            const hostnames = result.data.hasEntities || result.data.regexes.length
                ? '*'
                : result.data.hostnames;
            isolated.push({
                id: `${rulesetid}-css-specific`,
                code,
                hostnames,
            });
        }
    }

    const output = {}
    if ( compiledData.dnrRules.length ) {
        output.dnrRules = minimizeRuleset(compiledData.dnrRules);
        output.dnrRules = minimizeRules(output.dnrRules);
        output.dnrRules = validateRules(output.dnrRules);
    }
    if ( isolated.length ) {
        output.isolated = isolated;
    }
    if ( main.length ) {
        output.main = main;
    }

    return output;
}

/******************************************************************************/

async function updateList(list) {
    const context = {
        env: [
            'chromium',
            'native_css_has',
            'mv3',
            'ublock',
            'ubol',
            'user_stylesheet',
        ],
    };
    const asset = { urls: [ list.id ] };
    const text = await fetchList(context, asset);
    if ( Boolean(text) === false ) { return; }

    const metadata = extractMetadataFromList(text, [
        'Expires',
        'Homepage',
        'Title',
    ])
    if ( /^https?:\/\/\S+/.test(metadata.homepage) === false ) {
        metadata.homepage = undefined;
    }

    const compiled = compileFilters(list.id, text, {
        nativeCssHas: true,
    });
    if ( Boolean(compiled) === false ) { return; }

    await browser.runtime.sendMessage({
        what: 'compileFilters:updateImportedListData',
        listid: list.id,
        compiled: s14e.serialize(compiled, { compress: true }),
        title: metadata.title,
        homeURL: metadata.homepage,
        expires: metadata.expires || 7,
        filterStats: compiled.filterStats,
        ruleStats: compiled.ruleStats,
    });

    return compiled;
}

/******************************************************************************/

async function getCompiledListData(list) {
    const result = await browser.runtime.sendMessage({
        what: 'compileFilters:getImportedListCompiledData',
        listid: list.id,
    });
    if ( Boolean(result?.serialized) === false ) {
        return updateList(list);
    }
    return s14e.deserialize(result.serialized);
}

/******************************************************************************/

function mergeCompiledData(to, from) {
    if ( from.dnrRules ) {
        if ( to.dnrRules ) {
            to.dnrRules = to.dnrRules.concat(from.dnrRules);
        } else {
            to.dnrRules = from.dnrRules;
        }
    }
    if ( from.specificCosmeticDetails ) {
        if ( to.specificCosmeticDetails ) {
            for ( const [ fromSelector, fromDetails ] of from.specificCosmeticDetails ) {
                const toDetails = to.specificCosmeticDetails.get(fromSelector);
                if ( toDetails ) {
                    if ( toDetails.matches?.length ) {
                        toDetails.matches = toDetails.matches.concat(fromDetails.matches);
                    } else {
                        toDetails.matches = fromDetails.matches;
                    }
                    if ( toDetails.excludeMatches?.length ) {
                        toDetails.excludeMatches = toDetails.excludeMatches.concat(fromDetails.excludeMatches);
                    } else {
                        toDetails.excludeMatches = fromDetails.excludeMatches;
                    }
                } else {
                    to.specificCosmeticDetails.set(fromSelector, fromDetails);
                }
            }
        } else {
            to.specificCosmeticDetails = from.specificCosmeticDetails;
        }
    }
    if ( from.scriptletDetails ) {
        if ( to.scriptletDetails ) {
            for ( const [ fromKey, fromDetails ] of from.scriptletDetails ) {
                const toDetails = to.scriptletDetails.get(fromKey);
                if ( toDetails ) {
                    toDetails.trustedSource ||= fromDetails.trustedSource;
                    if ( toDetails.matches?.length ) {
                        toDetails.matches = toDetails.matches.concat(fromDetails.matches);
                    } else {
                        toDetails.matches = fromDetails.matches;
                    }
                    if ( toDetails.excludeMatches?.length ) {
                        toDetails.excludeMatches = toDetails.excludeMatches.concat(fromDetails.excludeMatches);
                    } else {
                        toDetails.excludeMatches = fromDetails.excludeMatches;
                    }
                } else {
                    to.scriptletDetails.set(fromKey, fromDetails);
                }
            }
        } else {
            to.scriptletDetails = from.scriptletDetails;
        }
    }
}

/******************************************************************************/

async function compileImportedList() {
    const lists = await browser.runtime.sendMessage({
        what: 'compileFilters:getEnabledImportedLists'
    });
    if ( Boolean(lists?.length) === false ) { return; }
    const promises = [];
    for ( const list of lists ) {
        if ( list.enabled !== true ) { continue; }
        promises.push(getCompiledListData(list));
    }
    const compiledData = await Promise.all(promises);
    const toMerge = compiledData.filter(a => Boolean(a));
    if ( toMerge.length === 0 ) { return; }
    const merged = toMerge[0];
    while ( toMerge.length > 1 ) {
        mergeCompiledData(merged, toMerge.pop());
    }
    return merged;
}

/******************************************************************************/

async function compileSandboxFilters() {
    const text = await browser.runtime.sendMessage({
        what: 'compileFilters:getUserList'
    });
    if ( Boolean(text) === false ) { return; }
    return compileFilters('sandbox', text, {
        localSource: true,
        nativeCssHas: true,
        trustedSource: true,
    });
}

/******************************************************************************/

(async ( ) => {
    const [
        sandboxResult,
        importedResult,
    ] = await Promise.all([
        compileSandboxFilters(),
        compileImportedList(),
    ]);
    const sandboxCompiled = await toMv3Data('sandbox', sandboxResult) ?? {};
    const importedCompiled = await toMv3Data('imported', importedResult) ?? {};
    const msg = {
        what: 'compileFilters:result',
        sandbox: {},
        imported: {},
    };
    if ( sandboxCompiled.isolated?.length ) {
        msg.sandbox.ISOLATED = sandboxCompiled.isolated;
    }
    if ( sandboxCompiled.main?.length ) {
        msg.sandbox.MAIN = sandboxCompiled.main;
    }
    if ( sandboxCompiled.dnrRules?.length ) {
        msg.sandbox.dnrRules = sandboxCompiled.dnrRules;
    }
    if ( importedCompiled.isolated?.length ) {
        msg.imported.ISOLATED = importedCompiled.isolated;
    }
    if ( importedCompiled.main?.length ) {
        msg.imported.MAIN = importedCompiled.main;
    }
    if ( importedCompiled.dnrRules?.length ) {
        msg.imported.dnrRules = importedCompiled.dnrRules;
    }
    browser.runtime.sendMessage(msg);
})();

/******************************************************************************/

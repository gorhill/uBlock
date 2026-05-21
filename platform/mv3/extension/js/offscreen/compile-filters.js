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

import * as makeScriptlet from './make-scriptlets.js';
import * as sfp from '../static-filtering-parser.js';

import {
    minimizeRules,
    minimizeRuleset,
    parseNetworkFilter,
    validateRules,
} from '../ubo-parser.js';

import { makeCosmeticScripts } from './make-cosmetic-filters.js';
import { safeReplace } from './safe-replace.js';

/******************************************************************************/

const parser = new sfp.AstFilterParser({
    localSource: true,
    trustedSource: true,
});
const specificCosmeticDetails = new Map();
const scriptletDetails = new Map();
const dnrRules = [];

/******************************************************************************/

function compileScriptletFilter(parser) {
    if ( parser.hasOptions() === false ) { return; }
    const exception = parser.isException();
    const args = parser.getScriptletArgs();
    const argsToken = JSON.stringify(args);
    for ( const { hn, not, bad } of parser.getExtFilterDomainIterator() ) {
        if ( bad ) { continue; }
        if ( exception ) { continue; }
        const details = scriptletDetails.get(argsToken) ?? {};
        if ( details.args === undefined ) {
            details.args = args;
            details.trustedSource = true;
            scriptletDetails.set(argsToken, details);
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

function compileCosmeticFilter(parser) {
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
    const details = specificCosmeticDetails.get(sanitized) ?? {};
    if ( details.matches === undefined ) {
        details.matches = [];
        details.excludeMatches = [];
        specificCosmeticDetails.set(sanitized, details);
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

(async ( ) => {
    const text = await chrome.runtime.sendMessage({ what: 'getRawFilters' });
    if ( Boolean(text) === false ) { return; }
    const lines = text.split(/\n/).map(a => a.trim());
    for ( const line of lines ) {
        parser.parse(line);
        if ( parser.hasError() ) { continue; }
        if ( parser.isScriptletFilter() ) {
            compileScriptletFilter(parser);
            continue;
        }
        if ( parser.isCosmeticFilter() ) {
            compileCosmeticFilter(parser);
            continue;
        }
        if ( parser.isNetworkFilter() ) {
            const rule = parseNetworkFilter(parser);
            if ( rule === undefined ) { continue; }
            dnrRules.push(rule);
            continue;
        }
    }

    const isolated = [];
    const main = [];

    if ( scriptletDetails.size !== 0 ) {
        for ( const details of scriptletDetails.values() ) {
            makeScriptlet.compile('sandbox', details);
        }
        const template = await fetch('./scriptlet.template.js').then(response =>
            response.text()
        );
        const result = makeScriptlet.commit('sandbox', template);
        if ( result.ISOLATED ) {
            isolated.push(result.ISOLATED.code);
        }
        if ( result.MAIN ) {
            main.push(result.MAIN.code);
        }
    }

    if ( specificCosmeticDetails.size !== 0 ) {
        const result = makeCosmeticScripts('sandbox', specificCosmeticDetails);
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
                fetch('./css-sandbox.template.js').then(response => response.text()),
            ]);
            const code = [
                cssAPI,
                isolatedAPI,
                proceduralAPI,
                safeReplace(template, 'self.$cssSpecificData$', result.json),
            ].join('\n');
            isolated.push(code);
        }
    }

    const msg = { what: 'compiledRawFilters' };
    if ( isolated.length ) {
        msg.ISOLATED = isolated;
    }
    if ( main.length ) {
        msg.MAIN = main;
    }

    if ( dnrRules.length ) {
        let rules = minimizeRuleset(dnrRules);
        rules = minimizeRules(rules);
        rules = validateRules(rules);
        msg.dnrRules = rules;
    }

    chrome.runtime.sendMessage(msg);
})();

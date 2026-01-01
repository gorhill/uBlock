/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2017-present Raymond Hill

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

import { builtinScriptlets } from './js/resources/scriptlets.js';
import fs from 'fs/promises';
import { literalStrFromRegex } from './js/regex-analyzer.js';
import { safeReplace } from './safe-replace.js';

/******************************************************************************/

const resourceDetails = new Map();
const resourceAliases = new Map();
const worldTemplate = {
    scriptletFunctions: new Map(),
    allFunctions: new Map(),
    args: new Map(),
    arglists: new Map(),
    hostnames: new Map(),
    regexesOrPaths: new Map(),
    matches: new Set(),
    hasEntities: false,
    hasAncestors: false,
};
const worlds = {
    ISOLATED: structuredClone(worldTemplate),
    MAIN: structuredClone(worldTemplate),
};

/******************************************************************************/

function createScriptletCoreCode(worldDetails, resourceEntry) {
    const { allFunctions } = worldDetails;
    allFunctions.set(resourceEntry.name, resourceEntry.code);
    const dependencies = resourceEntry.dependencies &&
        resourceEntry.dependencies.slice() || [];
    while ( dependencies.length !== 0 ) {
        const token = dependencies.shift();
        const details = resourceDetails.get(token);
        if ( details === undefined ) { continue; }
        if ( allFunctions.has(details.name) ) { continue; }
        allFunctions.set(details.name, details.code);
        if ( Array.isArray(details.dependencies) === false ) { continue; }
        dependencies.push(...details.dependencies);
    }
}

/******************************************************************************/

export function reset() {
    worlds.ISOLATED = structuredClone(worldTemplate);
    worlds.MAIN = structuredClone(worldTemplate);
}

/******************************************************************************/

export function compile(assetDetails, details) {
    if ( details.args[0].endsWith('.js') === false ) {
        details.args[0] += '.js';
    }
    if ( resourceAliases.has(details.args[0]) ) {
        details.args[0] = resourceAliases.get(details.args[0]);
    }
    const scriptletToken = details.args[0];
    const resourceEntry = resourceDetails.get(scriptletToken);
    if ( resourceEntry === undefined ) { return; }
    if ( resourceEntry.requiresTrust && details.trustedSource !== true ) {
        console.log(`Rejecting +js(${details.args.join()}): ${assetDetails.id} is not trusted`);
        return;
    }
    const worldDetails = worlds[resourceEntry.world];
    const { scriptletFunctions } = worldDetails;
    if ( scriptletFunctions.has(resourceEntry.name) === false ) {
        scriptletFunctions.set(resourceEntry.name, scriptletFunctions.size);
        createScriptletCoreCode(worldDetails, resourceEntry);
    }
    // Convert args to arg indices
    const arglist = details.args.slice();
    arglist[0] = scriptletFunctions.get(resourceEntry.name);
    for ( let i = 1; i < arglist.length; i++ ) {
        const arg = arglist[i];
        if ( worldDetails.args.has(arg) === false ) {
            worldDetails.args.set(arg, worldDetails.args.size);
        }
        arglist[i] = worldDetails.args.get(arg);
    }
    const arglistKey = JSON.stringify(arglist).slice(1, -1);
    if ( worldDetails.arglists.has(arglistKey) === false ) {
        worldDetails.arglists.set(arglistKey, worldDetails.arglists.size);
    }
    const arglistIndex = worldDetails.arglists.get(arglistKey);
    if ( details.matches ) {
        for ( const hn of details.matches ) {
            if ( hn.includes('/') ) {
                worldDetails.matches.clear();
                worldDetails.matches.add('*');
                if ( worldDetails.regexesOrPaths.has(hn) === false ) {
                    worldDetails.regexesOrPaths.set(hn, new Set());
                }
                worldDetails.regexesOrPaths.get(hn).add(arglistIndex);
                continue;
            }
            const isEntity = hn.endsWith('.*') || hn.endsWith('.*>>');
            worldDetails.hasEntities ||= isEntity;
            const isAncestor = hn.endsWith('>>')
            worldDetails.hasAncestors ||= isAncestor;
            if ( isEntity || isAncestor ) {
                worldDetails.matches.clear();
                worldDetails.matches.add('*');
            }
            if ( worldDetails.matches.has('*') === false ) {
                worldDetails.matches.add(hn);
            }
            if ( worldDetails.hostnames.has(hn) === false ) {
                worldDetails.hostnames.set(hn, new Set());
            }
            worldDetails.hostnames.get(hn).add(arglistIndex);
        }
    } else {
        worldDetails.matches.add('*');
    }
    if ( details.excludeMatches ) {
        for ( const hn of details.excludeMatches ) {
            if ( hn.includes('/') ) {
                if ( worldDetails.regexesOrPaths.has(hn) === false ) {
                    worldDetails.regexesOrPaths.set(hn, new Set());
                }
                worldDetails.regexesOrPaths.get(hn).add(~arglistIndex);
                continue;
            }
            if ( worldDetails.hostnames.has(hn) === false ) {
                worldDetails.hostnames.set(hn, new Set());
            }
            worldDetails.hostnames.get(hn).add(~arglistIndex);
        }
    }
}

/******************************************************************************/

export async function commit(rulesetId, path, writeFn) {
    const scriptletTemplate = await fs.readFile(
        './scriptlets/scriptlet.template.js',
        { encoding: 'utf8' }
    );
    const stats = {};
    for ( const world of Object.keys(worlds) ) {
        const worldDetails = worlds[world];
        const { scriptletFunctions, allFunctions, args, arglists } = worldDetails;
        if ( scriptletFunctions.size === 0 ) { continue; }
        const hostnames = Array.from(worldDetails.hostnames).toSorted((a, b) => {
            const d = a[0].length - b[0].length;
            if ( d !== 0 ) { return d; }
            return a[0] < b[0] ? -1 : 1;
        }).map(a => ([ a[0], JSON.stringify(Array.from(a[1]).map(a => JSON.parse(a))).slice(1,-1)]));
        const scriptletFromRegexes = Array.from(worldDetails.regexesOrPaths)
            .filter(a => a[0].startsWith('/') && a[0].endsWith('/'))
            .map(a => {
                const restr = a[0].slice(1,-1);
                return [
                    literalStrFromRegex(restr).slice(0,8),
                    restr,
                    JSON.stringify(Array.from(a[1])).slice(1,-1),
                ];
            }).flat();
        let content = safeReplace(scriptletTemplate, 'self.$hasEntities$', JSON.stringify(worldDetails.hasEntities));
        content = safeReplace(content, 'self.$hasAncestors$', JSON.stringify(worldDetails.hasAncestors));
        content = safeReplace(content, 'self.$hasRegexes$', JSON.stringify(scriptletFromRegexes.length !== 0));
        content = safeReplace(content,
            'self.$scriptletFromRegexes$',
            `/* ${worldDetails.regexesOrPaths.size} */ ${JSON.stringify(scriptletFromRegexes)}`
        );
        content = safeReplace(content,
            'self.$scriptletHostnames$',
            `/* ${hostnames.length} */ ${JSON.stringify(hostnames.map(a => a[0]))}`
        );
        content = safeReplace(content,
            'self.$scriptletArglistRefs$',
            `/* ${hostnames.length} */ ${JSON.stringify(hostnames.map(a => a[1]).join(';'))}`
        );
        content = safeReplace(content,
            'self.$scriptletArglists$',
            `/* ${arglists.size} */ ${JSON.stringify(Array.from(arglists.keys()).join(';'))}`
        );
        content = safeReplace(content,
            'self.$scriptletArgs$',
            `/* ${args.size} */ ${JSON.stringify(Array.from(args.keys()))}`
        );
        content = safeReplace(content,
            'self.$scriptletFunctions$',
            `/* ${scriptletFunctions.size} */\n[${Array.from(scriptletFunctions.keys()).join(',')}]`
        );
        content = safeReplace(content,
            'self.$scriptletCode$',
            Array.from(allFunctions.values()).sort().join('\n\n')
        );
        content = safeReplace(content, /\$rulesetId\$/, rulesetId, 0);
        writeFn(`${path}/${world.toLowerCase()}/${rulesetId}.js`, content);
        stats[world] = Array.from(worldDetails.matches).sort();
    }
    return stats;
}

/******************************************************************************/

function init() {
    for ( const scriptlet of builtinScriptlets ) {
        const { name, aliases, fn } = scriptlet;
        const entry = {
            name: fn.name,
            code: fn.toString(),
            world: scriptlet.world || 'MAIN',
            dependencies: scriptlet.dependencies,
            requiresTrust: scriptlet.requiresTrust === true,
        };
        resourceDetails.set(name, entry);
        if ( Array.isArray(aliases) === false ) { continue; }
        for ( const alias of aliases ) {
            resourceAliases.set(alias, name);
        }
    }
}

init();

/******************************************************************************/

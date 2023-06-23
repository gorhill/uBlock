/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
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

'use strict';

/******************************************************************************/

import fs from 'fs/promises';
import { builtinScriptlets } from './scriptlets.js';
import { safeReplace } from './safe-replace.js';

/******************************************************************************/

const resourceDetails = new Map();
const resourceAliases = new Map();
const scriptletFiles = new Map();

/******************************************************************************/

function createScriptletCoreCode(scriptletToken) {
    const details = resourceDetails.get(scriptletToken);
    const components = new Map([ [ scriptletToken, details.code ] ]);
    const dependencies = details.dependencies && details.dependencies.slice() || [];
    while ( dependencies.length !== 0 ) {
        const token = dependencies.shift();
        if ( components.has(token) ) { continue; }
        const details = resourceDetails.get(token);
        if ( details === undefined ) { continue; }
        components.set(token, details.code);
        if ( Array.isArray(details.dependencies) === false ) { continue; }
        dependencies.push(...details.dependencies);
    }
    return Array.from(components.values()).join('\n\n');
}

/******************************************************************************/

export function init() {
    for ( const scriptlet of builtinScriptlets ) {
        const { name, aliases, fn } = scriptlet;
        const entry = {
            name: fn.name,
            code: fn.toString(),
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

/******************************************************************************/

export function reset() {
    scriptletFiles.clear();
}

/******************************************************************************/

export function compile(details) {
    if ( details.args[0].endsWith('.js') === false ) {
        details.args[0] += '.js';
    }
    if ( resourceAliases.has(details.args[0]) ) {
        details.args[0] = resourceAliases.get(details.args[0]);
    }
    const scriptletToken = details.args[0];
    const resourceEntry = resourceDetails.get(scriptletToken);
    if ( resourceEntry === undefined ) { return; }
    if ( resourceEntry.requiresTrust && details.isTrusted !== true ) {
        console.log(`Rejecting ${scriptletToken}: source is not trusted`);
        return;
    }
    if ( scriptletFiles.has(scriptletToken) === false ) {
        scriptletFiles.set(scriptletToken, {
            name: resourceEntry.name,
            code: createScriptletCoreCode(scriptletToken),
            args: new Map(),
            hostnames: new Map(),
            entities: new Map(),
            exceptions: new Map(),
            matches: new Set(),
        });
    }
    const scriptletDetails = scriptletFiles.get(scriptletToken);
    const argsToken = JSON.stringify(details.args.slice(1));
    if ( scriptletDetails.args.has(argsToken) === false ) {
        scriptletDetails.args.set(argsToken, scriptletDetails.args.size);
    }
    const iArgs = scriptletDetails.args.get(argsToken);
    if ( details.matches ) {
        for ( const hn of details.matches ) {
            if ( hn.endsWith('.*') ) {
                scriptletDetails.matches.clear();
                scriptletDetails.matches.add('*');
                const entity = hn.slice(0, -2);
                if ( scriptletDetails.entities.has(entity) === false ) {
                    scriptletDetails.entities.set(entity, new Set());
                }
                scriptletDetails.entities.get(entity).add(iArgs);
            } else {
                if ( scriptletDetails.matches.has('*') === false ) {
                    scriptletDetails.matches.add(hn);
                }
                if ( scriptletDetails.hostnames.has(hn) === false ) {
                    scriptletDetails.hostnames.set(hn, new Set());
                }
                scriptletDetails.hostnames.get(hn).add(iArgs);
            }
        }
    } else {
        scriptletDetails.matches.add('*');
    }
    if ( details.excludeMatches ) {
        for ( const hn of details.excludeMatches ) {
            if ( scriptletDetails.exceptions.has(hn) === false ) {
                scriptletDetails.exceptions.set(hn, []);
            }
            scriptletDetails.exceptions.get(hn).push(iArgs);
        }
    }
}

/******************************************************************************/

export async function commit(rulesetId, path, writeFn) {
    const scriptletTemplate = await fs.readFile(
        './scriptlets/scriptlet.template.js',
        { encoding: 'utf8' }
    );
    const patchHnMap = hnmap => {
        const out = Array.from(hnmap);
        out.forEach(a => {
            const values = Array.from(a[1]);
            a[1] = values.length === 1 ? values[0] : values;
        });
        return out;
    };
    const scriptletStats = [];
    for ( const [ name, details ] of scriptletFiles ) {
        let content = safeReplace(scriptletTemplate,
            'function $scriptletName$(){}',
            details.code
        );
        content = safeReplace(content, /\$rulesetId\$/, rulesetId, 0);
        content = safeReplace(content, /\$scriptletName\$/, details.name, 0);
        content = safeReplace(content,
            'self.$argsList$',
            JSON.stringify(Array.from(details.args.keys()))
        );
        content = safeReplace(content,
            'self.$hostnamesMap$',
            JSON.stringify(patchHnMap(details.hostnames))
        );
        content = safeReplace(content,
            'self.$entitiesMap$',
            JSON.stringify(patchHnMap(details.entities))
        );
        content = safeReplace(content,
            'self.$exceptionsMap$',
            JSON.stringify(Array.from(details.exceptions))
        );
        writeFn(`${path}/${rulesetId}.${name}`, content);
        scriptletStats.push([ name.slice(0, -3), Array.from(details.matches).sort() ]);
    }
    return scriptletStats;
}

/******************************************************************************/

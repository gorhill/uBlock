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

import { StaticExtFilteringHostnameDB } from './static-ext-filtering-db.js';
import { redirectEngine as reng } from './redirect-engine.js';

/******************************************************************************/

// Increment when internal representation changes
const VERSION = 1;

const $scriptlets = new Set();
const $exceptions = new Set();
const $mainWorldMap = new Map();
const $isolatedWorldMap = new Map();

/******************************************************************************/

const normalizeRawFilter = (parser, sourceIsTrusted = false) => {
    const args = parser.getScriptletArgs();
    if ( args.length !== 0 ) {
        let token = `${args[0]}.js`;
        if ( reng.aliases.has(token) ) {
            token = reng.aliases.get(token);
        }
        if ( parser.isException() !== true ) {
            if ( sourceIsTrusted !== true ) {
                if ( reng.tokenRequiresTrust(token) ) { return; }
            }
        }
        args[0] = token.slice(0, -3);
    }
    return JSON.stringify(args);
};

const lookupScriptlet = (rawToken, mainMap, isolatedMap, debug = false) => {
    if ( mainMap.has(rawToken) || isolatedMap.has(rawToken) ) { return; }
    const args = JSON.parse(rawToken);
    const token = `${args[0]}.js`;
    const details = reng.contentFromName(token, 'text/javascript');
    if ( details === undefined ) { return; }
    const targetWorldMap = details.world !== 'ISOLATED' ? mainMap : isolatedMap;
    const content = patchScriptlet(details.js, args.slice(1));
    const dependencies = details.dependencies || [];
    while ( dependencies.length !== 0 ) {
        const token = dependencies.shift();
        if ( targetWorldMap.has(token) ) { continue; }
        const details = reng.contentFromName(token, 'fn/javascript') ||
            reng.contentFromName(token, 'text/javascript');
        if ( details === undefined ) { continue; }
        targetWorldMap.set(token, details.js);
        if ( Array.isArray(details.dependencies) === false ) { continue; }
        dependencies.push(...details.dependencies);
    }
    targetWorldMap.set(rawToken, [
        'try {',
            '// >>>> scriptlet start',
            content,
            '// <<<< scriptlet end',
        '} catch (e) {',
            debug ? 'console.error(e);' : '',
        '}',
    ].join('\n'));
};

// Fill-in scriptlet argument placeholders.
const patchScriptlet = (content, arglist) => {
    if ( content.startsWith('function') && content.endsWith('}') ) {
        content = `(${content})({{args}});`;
    }
    for ( let i = 0; i < arglist.length; i++ ) {
        content = content.replace(`{{${i+1}}}`, arglist[i]);
    }
    return content.replace('{{args}}',
        JSON.stringify(arglist).slice(1,-1).replace(/\$/g, '$$$')
    );
};

const requote = s => {
    if ( /^(["'`]).*\1$|,|^$/.test(s) === false ) { return s; }
    if ( s.includes("'") === false ) { return `'${s}'`; }
    if ( s.includes('"') === false ) { return `"${s}"`; }
    if ( s.includes('`') === false ) { return `\`${s}\``; }
    return `'${s.replace(/'/g, "\\'")}'`;
};

const decompile = json => {
    const args = JSON.parse(json);
    if ( args.length === 0 ) { return '+js()'; }
    return `+js(${args.map(s => requote(s)).join(', ')})`;
};

/******************************************************************************/

export class ScriptletFilteringEngine {
    constructor() {
        this.acceptedCount = 0;
        this.discardedCount = 0;
        this.scriptletDB = new StaticExtFilteringHostnameDB(1, VERSION);
        this.duplicates = new Set();
    }

    getFilterCount() {
        return this.scriptletDB.size;
    }

    reset() {
        this.scriptletDB.clear();
        this.duplicates.clear();
        this.acceptedCount = 0;
        this.discardedCount = 0;
    }

    freeze() {
        this.duplicates.clear();
        this.scriptletDB.collectGarbage();
    }

    // parser: instance of AstFilterParser from static-filtering-parser.js
    // writer: instance of CompiledListWriter from static-filtering-io.js
    compile(parser, writer) {
        writer.select('SCRIPTLET_FILTERS');

        // Only exception filters are allowed to be global.
        const isException = parser.isException();
        const normalized = normalizeRawFilter(parser, writer.properties.get('trustedSource'));

        // Can fail if there is a mismatch with trust requirement
        if ( normalized === undefined ) { return; }

        // Tokenless is meaningful only for exception filters.
        if ( normalized === '[]' && isException === false ) { return; }

        if ( parser.hasOptions() === false ) {
            if ( isException ) {
                writer.push([ 32, '', 1, normalized ]);
            }
            return;
        }

        // https://github.com/gorhill/uBlock/issues/3375
        //   Ignore instances of exception filter with negated hostnames,
        //   because there is no way to create an exception to an exception.

        for ( const { hn, not, bad } of parser.getExtFilterDomainIterator() ) {
            if ( bad ) { continue; }
            let kind = 0;
            if ( isException ) {
                if ( not ) { continue; }
                kind |= 1;
            } else if ( not ) {
                kind |= 1;
            }
            writer.push([ 32, hn, kind, normalized ]);
        }
    }

    // writer: instance of CompiledListReader from static-filtering-io.js
    fromCompiledContent(reader) {
        reader.select('SCRIPTLET_FILTERS');

        while ( reader.next() ) {
            this.acceptedCount += 1;
            const fingerprint = reader.fingerprint();
            if ( this.duplicates.has(fingerprint) ) {
                this.discardedCount += 1;
                continue;
            }
            this.duplicates.add(fingerprint);
            const args = reader.args();
            if ( args.length < 4 ) { continue; }
            this.scriptletDB.store(args[1], args[2], args[3]);
        }
    }

    toSelfie() {
        return this.scriptletDB.toSelfie();
    }

    fromSelfie(selfie) {
        if ( typeof selfie !== 'object' || selfie === null ) { return false; }
        if ( selfie.version !== VERSION ) { return false; }
        this.scriptletDB.fromSelfie(selfie);
        return true;
    }

    retrieve(request, options = {}) {
        if ( this.scriptletDB.size === 0 ) { return; }

        $scriptlets.clear();
        $exceptions.clear();

        const { hostname } = request;

        this.scriptletDB.retrieve(hostname, [ $scriptlets, $exceptions ]);
        const entity = request.entity !== ''
            ? `${hostname.slice(0, -request.domain.length)}${request.entity}`
            : '*';
        this.scriptletDB.retrieve(entity, [ $scriptlets, $exceptions ], 1);
        if ( $scriptlets.size === 0 ) { return; }

        // Wholly disable scriptlet injection?
        if ( $exceptions.has('[]') ) {
            return { filters: '#@#+js()' };
        }

        for ( const token of $exceptions ) {
            if ( $scriptlets.has(token) ) {
                $scriptlets.delete(token);
            } else {
                $exceptions.delete(token);
            }
        }

        for ( const token of $scriptlets ) {
            lookupScriptlet(token, $mainWorldMap, $isolatedWorldMap, options.debug);
        }

        const mainWorldCode = [];
        for ( const js of $mainWorldMap.values() ) {
            mainWorldCode.push(js);
        }

        const isolatedWorldCode = [];
        for ( const js of $isolatedWorldMap.values() ) {
            isolatedWorldCode.push(js);
        }

        const scriptletDetails = {
            mainWorld: mainWorldCode.join('\n\n'),
            isolatedWorld: isolatedWorldCode.join('\n\n'),
            filters: [
                ...Array.from($scriptlets).map(s => `##${decompile(s)}`),
                ...Array.from($exceptions).map(s => `#@#${decompile(s)}`),
            ].join('\n'),
        };
        $mainWorldMap.clear();
        $isolatedWorldMap.clear();

        const scriptletGlobals = options.scriptletGlobals || {};

        if ( options.debug ) {
            scriptletGlobals.canDebug = true;
        }

        return {
            mainWorld: scriptletDetails.mainWorld === '' ? '' : [
                '(function() {',
                '// >>>> start of private namespace',
                '',
                options.debugScriptlets ? 'debugger;' : ';',
                '',
                // For use by scriptlets to share local data among themselves
                `const scriptletGlobals = ${JSON.stringify(scriptletGlobals, null, 4)}`,
                '',
                scriptletDetails.mainWorld,
                '',
                '// <<<< end of private namespace',
                '})();',
            ].join('\n'),
            isolatedWorld: scriptletDetails.isolatedWorld === '' ? '' : [
                'function() {',
                '// >>>> start of private namespace',
                '',
                options.debugScriptlets ? 'debugger;' : ';',
                '',
                // For use by scriptlets to share local data among themselves
                `const scriptletGlobals = ${JSON.stringify(scriptletGlobals, null, 4)}`,
                '',
                scriptletDetails.isolatedWorld,
                '',
                '// <<<< end of private namespace',
                '}',
            ].join('\n'),
            filters: scriptletDetails.filters,
        };
    }
}

/******************************************************************************/

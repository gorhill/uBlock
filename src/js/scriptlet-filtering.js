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

import logger from './logger.js';
import µb from './background.js';
import { redirectEngine } from './redirect-engine.js';
import { sessionFirewall } from './filtering-engines.js';
import { StaticExtFilteringHostnameDB } from './static-ext-filtering-db.js';
import * as sfp from './static-filtering-parser.js';

import {
    domainFromHostname,
    entityFromDomain,
    hostnameFromURI,
} from './uri-utils.js';

/******************************************************************************/

const duplicates = new Set();
const scriptletCache = new µb.MRUCache(32);
const reEscapeScriptArg = /[\\'"]/g;

const scriptletDB = new StaticExtFilteringHostnameDB(1);

let acceptedCount = 0;
let discardedCount = 0;

let isDevBuild;

const scriptletFilteringEngine = {
    get acceptedCount() {
        return acceptedCount;
    },
    get discardedCount() {
        return discardedCount;
    },
    getFilterCount() {
        return scriptletDB.size;
    },
};

// Purpose of `contentscriptCode` below is too programmatically inject
// content script code which only purpose is to inject scriptlets. This
// essentially does the same as what uBO's declarative content script does,
// except that this allows to inject the scriptlets earlier than it is
// possible through the declarative content script.
//
// Declaratively:
//  1. Browser injects generic content script =>
//      2. Content script queries scriptlets =>
//          3. Main process sends scriptlets =>
//              4. Content script injects scriptlets
//
// Programmatically:
//  1. uBO injects specific scriptlets-aware content script =>
//      2. Content script injects scriptlets
//
// However currently this programmatic injection works well only on
// Chromium-based browsers, it does not work properly with Firefox. More
// investigations is needed to find out why this fails with Firefox.
// Consequently, the programmatic-injection code path is taken only with
// Chromium-based browsers.

const contentscriptCode = (( ) => {
    const parts = [
        '(',
        function(injector, hostname, scriptlets) {
            const doc = document;
            if (
                doc.location === null ||
                hostname !== doc.location.hostname ||
                typeof self.uBO_scriptletsInjected === 'boolean'
            ) {
                return;
            }
            injector(doc, decodeURIComponent(scriptlets));
            if ( typeof self.uBO_scriptletsInjected === 'boolean' ) { return 0; }
        }.toString(),
        ')(',
            vAPI.scriptletsInjector, ', ',
            '"', 'hostname-slot', '", ',
            '"', 'scriptlets-slot', '"',
        ');',
    ];
    return {
        parts: parts,
        hostnameSlot: parts.indexOf('hostname-slot'),
        scriptletsSlot: parts.indexOf('scriptlets-slot'),
        assemble: function(hostname, scriptlets) {
            this.parts[this.hostnameSlot] = hostname;
            this.parts[this.scriptletsSlot] = encodeURIComponent(scriptlets);
            return this.parts.join('');
        }
    };
})();

// TODO: Probably should move this into StaticFilteringParser
// https://github.com/uBlockOrigin/uBlock-issues/issues/1031
//   Normalize scriptlet name to its canonical, unaliased name.
const normalizeRawFilter = function(parser) {
    const root = parser.getBranchFromType(sfp.NODE_TYPE_EXT_PATTERN_SCRIPTLET);
    const walker = parser.getWalker(root);
    const args = [];
    for ( let node = walker.next(); node !== 0; node = walker.next() ) {
        switch ( parser.getNodeType(node) ) {
            case sfp.NODE_TYPE_EXT_PATTERN_SCRIPTLET_TOKEN:
            case sfp.NODE_TYPE_EXT_PATTERN_SCRIPTLET_ARG:
                args.push(parser.getNodeString(node));
                break;
            default:
                break;
        }
    }
    walker.dispose();
    if ( args.length !== 0 ) {
        const full = `${args[0]}.js`;
        if ( redirectEngine.aliases.has(full) ) {
            args[0] = redirectEngine.aliases.get(full).slice(0, -3);
        }
    }
    return `+js(${args.join(', ')})`;
};

const lookupScriptlet = function(rawToken, scriptletMap, dependencyMap) {
    if ( scriptletMap.has(rawToken) ) { return; }
    const pos = rawToken.indexOf(',');
    let token, args = '';
    if ( pos === -1 ) {
        token = rawToken;
    } else {
        token = rawToken.slice(0, pos).trim();
        args = rawToken.slice(pos + 1).trim();
    }
    // TODO: The alias lookup can be removed once scriptlet resources
    //       with obsolete name are converted to their new name.
    if ( redirectEngine.aliases.has(token) ) {
        token = redirectEngine.aliases.get(token);
    } else {
        token = `${token}.js`;
    }
    const details = redirectEngine.contentFromName(token, 'text/javascript');
    if ( details === undefined ) { return; }
    const content = patchScriptlet(details.js, args);
    const dependencies = details.dependencies || [];
    while ( dependencies.length !== 0 ) {
        const token = dependencies.shift();
        if ( dependencyMap.has(token) ) { continue; }
        const details = redirectEngine.contentFromName(token, 'fn/javascript');
        if ( details === undefined ) { continue; }
        dependencyMap.set(token, details.js);
        if ( Array.isArray(details.dependencies) === false ) { continue; }
        dependencies.push(...details.dependencies);
    }
    scriptletMap.set(rawToken, [
        'try {',
        '// >>>> scriptlet start',
        content,
        '// <<<< scriptlet end',
        '} catch (e) {',
        '}',
    ].join('\n'));
};

// Fill-in scriptlet argument placeholders.
const patchScriptlet = function(content, args) {
    if ( content.startsWith('function') && content.endsWith('}') ) {
        content = `(${content})({{args}});`;
    }
    if ( args.startsWith('{') && args.endsWith('}') ) {
        return content.replace('{{args}}', args);
    }
    if ( args === '' ) {
        return content.replace('{{args}}', '');
    }
    const arglist = [];
    let s = args;
    let len = s.length;
    let beg = 0, pos = 0;
    let i = 1;
    while ( beg < len ) {
        pos = s.indexOf(',', pos);
        // Escaped comma? If so, skip.
        if ( pos > 0 && s.charCodeAt(pos - 1) === 0x5C /* '\\' */ ) {
            s = s.slice(0, pos - 1) + s.slice(pos);
            len -= 1;
            continue;
        }
        if ( pos === -1 ) { pos = len; }
        arglist.push(s.slice(beg, pos).trim().replace(reEscapeScriptArg, '\\$&'));
        beg = pos = pos + 1;
        i++;
    }
    for ( let i = 0; i < arglist.length; i++ ) {
        content = content.replace(`{{${i+1}}}`, arglist[i]);
    }
    return content.replace(
        '{{args}}',
        arglist.map(a => `'${a}'`).join(', ').replace(/\$/g, '$$$')
    );
};

const logOne = function(tabId, url, filter) {
    µb.filteringContext
        .duplicate()
        .fromTabId(tabId)
        .setRealm('extended')
        .setType('dom')
        .setURL(url)
        .setDocOriginFromURL(url)
        .setFilter({ source: 'extended', raw: filter })
        .toLogger();
};

scriptletFilteringEngine.reset = function() {
    scriptletDB.clear();
    duplicates.clear();
    scriptletCache.reset();
    acceptedCount = 0;
    discardedCount = 0;
};

scriptletFilteringEngine.freeze = function() {
    duplicates.clear();
    scriptletDB.collectGarbage();
    scriptletCache.reset();
};

scriptletFilteringEngine.compile = function(parser, writer) {
    writer.select('SCRIPTLET_FILTERS');

    // Only exception filters are allowed to be global.
    const isException = parser.isException();
    const normalized = normalizeRawFilter(parser);

    // Tokenless is meaningful only for exception filters.
    if ( normalized === '+js()' && isException === false ) { return; }

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
};

// 01234567890123456789
// +js(token[, arg[, ...]])
//     ^                  ^
//     4                 -1

scriptletFilteringEngine.fromCompiledContent = function(reader) {
    reader.select('SCRIPTLET_FILTERS');

    while ( reader.next() ) {
        acceptedCount += 1;
        const fingerprint = reader.fingerprint();
        if ( duplicates.has(fingerprint) ) {
            discardedCount += 1;
            continue;
        }
        duplicates.add(fingerprint);
        const args = reader.args();
        if ( args.length < 4 ) { continue; }
        scriptletDB.store(args[1], args[2], args[3].slice(4, -1));
    }
};

const $scriptlets = new Set();
const $exceptions = new Set();
const $scriptletMap = new Map();
const $scriptletDependencyMap = new Map();

scriptletFilteringEngine.retrieve = function(request, options = {}) {
    if ( scriptletDB.size === 0 ) { return; }

    const hostname = request.hostname;

    $scriptlets.clear();
    $exceptions.clear();

    scriptletDB.retrieve(hostname, [ $scriptlets, $exceptions ]);
    const entity = request.entity !== ''
        ? `${hostname.slice(0, -request.domain.length)}${request.entity}`
        : '*';
    scriptletDB.retrieve(entity, [ $scriptlets, $exceptions ], 1);
    if ( $scriptlets.size === 0 ) { return; }

    // https://github.com/gorhill/uBlock/issues/2835
    //   Do not inject scriptlets if the site is under an `allow` rule.
    if (
        µb.userSettings.advancedUserEnabled &&
        sessionFirewall.evaluateCellZY(hostname, hostname, '*') === 2
    ) {
        return;
    }

    const mustLog = Array.isArray(options.logEntries);

    // Wholly disable scriptlet injection?
    if ( $exceptions.has('') ) {
        if ( mustLog ) {
            logOne(request.tabId, request.url, '#@#+js()');
        }
        return;
    }

    if ( scriptletCache.resetTime < redirectEngine.modifyTime ) {
        scriptletCache.reset();
    }

    let cacheDetails = scriptletCache.lookup(hostname);
    if ( cacheDetails === undefined ) {
        const fullCode = [];
        for ( const token of $scriptlets ) {
            if ( $exceptions.has(token) ) { continue; }
            lookupScriptlet(token, $scriptletMap, $scriptletDependencyMap);
        }
        for ( const token of $scriptlets ) {
            const isException = $exceptions.has(token);
            if ( isException === false ) {
                fullCode.push($scriptletMap.get(token));
            }
        }
        for ( const code of $scriptletDependencyMap.values() ) {
            fullCode.push(code);
        }
        cacheDetails = {
            code: fullCode.join('\n\n'),
            tokens: Array.from($scriptlets),
            exceptions: Array.from($exceptions),
        };
        scriptletCache.add(hostname, cacheDetails);
        $scriptletMap.clear();
        $scriptletDependencyMap.clear();
    }

    if ( mustLog ) {
        for ( const token of cacheDetails.tokens ) {
            if ( cacheDetails.exceptions.includes(token) ) {
                logOne(request.tabId, request.url, `#@#+js(${token})`);
            } else {
                options.logEntries.push({
                    token: `##+js(${token})`,
                    tabId: request.tabId,
                    url: request.url,
                });
            }
        }
    }

    if ( cacheDetails.code === '' ) { return; }

    const scriptletGlobals = [];

    if ( isDevBuild === undefined ) {
        isDevBuild = vAPI.webextFlavor.soup.has('devbuild');
    }
    if ( isDevBuild || µb.hiddenSettings.filterAuthorMode ) {
        scriptletGlobals.push([ 'canDebug', true ]);
    }

    const out = [
        '(function() {',
        '// >>>> start of private namespace',
        '',
        µb.hiddenSettings.debugScriptlets ? 'debugger;' : ';',
        '',
        // For use by scriptlets to share local data among themselves
        `const scriptletGlobals = new Map(${JSON.stringify(scriptletGlobals, null, 2)});`,
        '',
        cacheDetails.code,
        '',
        '// <<<< end of private namespace',
        '})();',
    ];

    return out.join('\n');
};

scriptletFilteringEngine.injectNow = function(details) {
    if ( typeof details.frameId !== 'number' ) { return; }
    const request = {
        tabId: details.tabId,
        frameId: details.frameId,
        url: details.url,
        hostname: hostnameFromURI(details.url),
        domain: undefined,
        entity: undefined
    };
    request.domain = domainFromHostname(request.hostname);
    request.entity = entityFromDomain(request.domain);
    const logEntries = logger.enabled ? [] : undefined;
    const scriptlets = this.retrieve(request, { logEntries });
    if ( scriptlets === undefined ) { return; }
    let code = contentscriptCode.assemble(request.hostname, scriptlets);
    if ( µb.hiddenSettings.debugScriptletInjector ) {
        code = 'debugger;\n' + code;
    }
    const promise = vAPI.tabs.executeScript(details.tabId, {
        code,
        frameId: details.frameId,
        matchAboutBlank: true,
        runAt: 'document_start',
    });
    if ( logEntries !== undefined ) {
        promise.then(results => {
            if ( Array.isArray(results) === false || results[0] !== 0 ) {
                return;
            }
            for ( const entry of logEntries ) {
                logOne(entry.tabId, entry.url, entry.token);
            }
        });
    }
    return scriptlets;
};

scriptletFilteringEngine.toSelfie = function() {
    return scriptletDB.toSelfie();
};

scriptletFilteringEngine.fromSelfie = function(selfie) {
    scriptletDB.fromSelfie(selfie);
};

/******************************************************************************/

export default scriptletFilteringEngine;

/******************************************************************************/

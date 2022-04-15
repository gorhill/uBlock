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

import {
    StaticExtFilteringHostnameDB,
    StaticExtFilteringSessionDB,
} from './static-ext-filtering-db.js';

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
const sessionScriptletDB = new StaticExtFilteringSessionDB();

let acceptedCount = 0;
let discardedCount = 0;

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
        function(hostname, scriptlets) {
            if (
                document.location === null ||
                hostname !== document.location.hostname
            ) {
                return;
            }
            const injectScriptlets = function(d) {
                let script;
                try {
                    script = d.createElement('script');
                    script.appendChild(d.createTextNode(
                        decodeURIComponent(scriptlets))
                    );
                    (d.head || d.documentElement).appendChild(script);
                } catch (ex) {
                }
                if ( script ) {
                    if ( script.parentNode ) {
                        script.parentNode.removeChild(script);
                    }
                    script.textContent = '';
                }
            };
            injectScriptlets(document);
        }.toString(),
        ')(',
            '"', 'hostname-slot', '", ',
            '"', 'scriptlets-slot', '"',
        ');',
        '\n0;',
    ];
    return {
        parts: parts,
        hostnameSlot: parts.indexOf('hostname-slot'),
        scriptletsSlot: parts.indexOf('scriptlets-slot'),
        assemble: function(hostname, scriptlets) {
            this.parts[this.hostnameSlot] = hostname;
            this.parts[this.scriptletsSlot] =
                encodeURIComponent(scriptlets);
            return this.parts.join('');
        }
    };
})();

// TODO: Probably should move this into StaticFilteringParser
// https://github.com/uBlockOrigin/uBlock-issues/issues/1031
//   Normalize scriptlet name to its canonical, unaliased name.
const normalizeRawFilter = function(rawFilter) {
    const rawToken = rawFilter.slice(4, -1);
    const rawEnd = rawToken.length;
    let end = rawToken.indexOf(',');
    if ( end === -1 ) { end = rawEnd; }
    const token = rawToken.slice(0, end).trim();
    const alias = token.endsWith('.js') ? token.slice(0, -3) : token;
    let normalized = redirectEngine.aliases.get(`${alias}.js`);
    normalized = normalized === undefined
        ? alias
        : normalized.slice(0, -3);
    let beg = end + 1;
    while ( beg < rawEnd ) {
        end = rawToken.indexOf(',', beg);
        if ( end === -1 ) { end = rawEnd; }
        normalized += ', ' + rawToken.slice(beg, end).trim();
        beg = end + 1;
    }
    return `+js(${normalized})`;
};

const lookupScriptlet = function(rawToken, reng, toInject) {
    if ( toInject.has(rawToken) ) { return; }
    if ( scriptletCache.resetTime < reng.modifyTime ) {
        scriptletCache.reset();
    }
    let content = scriptletCache.lookup(rawToken);
    if ( content === undefined ) {
        const pos = rawToken.indexOf(',');
        let token, args;
        if ( pos === -1 ) {
            token = rawToken;
        } else {
            token = rawToken.slice(0, pos).trim();
            args = rawToken.slice(pos + 1).trim();
        }
        // TODO: The alias lookup can be removed once scriptlet resources
        //       with obsolete name are converted to their new name.
        if ( reng.aliases.has(token) ) {
            token = reng.aliases.get(token);
        } else {
            token = `${token}.js`;
        }
        content = reng.resourceContentFromName(
            token,
            'application/javascript'
        );
        if ( !content ) { return; }
        if ( args ) {
            content = patchScriptlet(content, args);
            if ( !content ) { return; }
        }
        content =
            'try {\n' +
                content + '\n' +
            '} catch ( e ) { }';
        scriptletCache.add(rawToken, content);
    }
    toInject.set(rawToken, content);
};

// Fill-in scriptlet argument placeholders.
const patchScriptlet = function(content, args) {
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
        content = content.replace(
            `{{${i}}}`,
            s.slice(beg, pos).trim().replace(reEscapeScriptArg, '\\$&')
        );
        beg = pos = pos + 1;
        i++;
    }
    return content;
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
    acceptedCount = 0;
    discardedCount = 0;
};

scriptletFilteringEngine.freeze = function() {
    duplicates.clear();
    scriptletDB.collectGarbage();
};

scriptletFilteringEngine.compile = function(parser, writer) {
    writer.select('SCRIPTLET_FILTERS');

    // Only exception filters are allowed to be global.
    const { raw, exception } = parser.result;
    const normalized = normalizeRawFilter(raw);

    // Tokenless is meaningful only for exception filters.
    if ( normalized === '+js()' && exception === false ) { return; }

    if ( parser.hasOptions() === false ) {
        if ( exception ) {
            writer.push([ 32, '', 1, normalized ]);
        }
        return;
    }

    // https://github.com/gorhill/uBlock/issues/3375
    //   Ignore instances of exception filter with negated hostnames,
    //   because there is no way to create an exception to an exception.

    for ( const { hn, not, bad } of parser.extOptions() ) {
        if ( bad ) { continue; }
        let kind = 0;
        if ( exception ) {
            if ( not ) { continue; }
            kind |= 1;
        } else if ( not ) {
            kind |= 1;
        }
        writer.push([ 32, hn, kind, normalized ]);
    }
};

scriptletFilteringEngine.compileTemporary = function(parser) {
    return {
        session: sessionScriptletDB,
        selector: parser.result.compiled,
    };
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

scriptletFilteringEngine.getSession = function() {
    return sessionScriptletDB;
};

const $scriptlets = new Set();
const $exceptions = new Set();
const $scriptletToCodeMap = new Map();

scriptletFilteringEngine.retrieve = function(request, options = {}) {
    if ( scriptletDB.size === 0 ) { return; }

    const hostname = request.hostname;

    $scriptlets.clear();
    $exceptions.clear();

    if ( sessionScriptletDB.isNotEmpty ) {
        sessionScriptletDB.retrieve([ null, $exceptions ]);
    }
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

    $scriptletToCodeMap.clear();
    for ( const token of $scriptlets ) {
        lookupScriptlet(token, redirectEngine, $scriptletToCodeMap);
    }
    if ( $scriptletToCodeMap.size === 0 ) { return; }

    // Return an array of scriptlets, and log results if needed.
    const out = [];
    for ( const [ token, code ] of $scriptletToCodeMap ) {
        const isException = $exceptions.has(token);
        if ( isException === false ) {
            out.push(code);
        }
        if ( mustLog === false ) { continue; }
        if ( isException ) {
            logOne(request.tabId, request.url, `#@#+js(${token})`);
        } else {
            options.logEntries.push({
                token: `##+js(${token})`,
                tabId: request.tabId,
                url: request.url,
            });
        }
    }

    if ( out.length === 0 ) { return; }

    if ( µb.hiddenSettings.debugScriptlets ) {
        out.unshift('debugger;');
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/156
    //   Provide a private Map() object available for use by all
    //   scriptlets.
    out.unshift(
        '(function() {',
        '// >>>> start of private namespace',
        ''
    );
    out.push(
        '',
        '// <<<< end of private namespace',
        '})();'
    );

    return out.join('\n');
};

scriptletFilteringEngine.hasScriptlet = function(hostname, exceptionBit, scriptlet) {
    return scriptletDB.hasStr(hostname, exceptionBit, scriptlet);
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
    if ( logEntries === undefined ) { return; }
    promise.then(results => {
        if ( Array.isArray(results) === false || results[0] !== 0 ) { return; }
        for ( const entry of logEntries ) {
            logOne(entry.tabId, entry.url, entry.token);
        }
    });
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

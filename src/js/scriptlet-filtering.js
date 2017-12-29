/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2017 Raymond Hill

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

µBlock.scriptletFilteringEngine = (function() {
    var api = {};

    var µb = µBlock,
        scriptletDB = new µb.staticExtFilteringEngine.HostnameBasedDB(),
        duplicates = new Set(),
        acceptedCount = 0,
        discardedCount = 0,
        scriptletCache = new µb.MRUCache(32),
        exceptionsRegister = new Set(),
        scriptletsRegister = new Map(),
        reEscapeScriptArg = /[\\'"]/g;

    var scriptletRemover = [
        '(function() {',
        '  var c = document.currentScript, p = c && c.parentNode;',
        '  if ( p ) { p.removeChild(c); }',
        '})();'
    ].join('\n');


    var lookupScriptlet = function(raw, reng, toInject) {
        if ( toInject.has(raw) ) { return; }
        if ( scriptletCache.resetTime < reng.modifyTime ) {
            scriptletCache.reset();
        }
        var content = scriptletCache.lookup(raw);
        if ( content === undefined ) {
            var token, args,
                pos = raw.indexOf(',');
            if ( pos === -1 ) {
                token = raw;
            } else {
                token = raw.slice(0, pos).trim();
                args = raw.slice(pos + 1).trim();
            }
            content = reng.resourceContentFromName(token, 'application/javascript');
            if ( !content ) { return; }
            if ( args ) {
                content = patchScriptlet(content, args);
                if ( !content ) { return; }
            }
            scriptletCache.add(raw, content);
        }
        toInject.set(raw, content);
    };

    // Fill template placeholders. Return falsy if:
    // - At least one argument contains anything else than /\w/ and `.`

    var patchScriptlet = function(content, args) {
        var i = 1,
            pos, arg;
        while ( args !== '' ) {
            pos = args.indexOf(',');
            if ( pos === -1 ) { pos = args.length; }
            arg = args.slice(0, pos).trim().replace(reEscapeScriptArg, '\\$&');
            content = content.replace('{{' + i + '}}', arg);
            args = args.slice(pos + 1).trim();
            i++;
        }
        return content;
    };

    var logOne = function(isException, token, details) {
        µb.logger.writeOne(
            details.tabId,
            'cosmetic',
            {
                source: 'cosmetic',
                raw: (isException ? '#@#' : '##') + 'script:inject(' + token + ')'
            },
            'dom',
            details.url,
            null,
            details.hostname
        );
    };

    api.reset = function() {
        scriptletDB.clear();
        duplicates.clear();
        acceptedCount = 0;
        discardedCount = 0;
    };

    api.freeze = function() {
        duplicates.clear();
    };

    api.compile = function(parsed, writer) {
        // 1001 = scriptlet injection
        writer.select(1001);

        // Only exception filters are allowed to be global.

        if ( parsed.hostnames.length === 0 ) {
            if ( parsed.exception ) {
                writer.push([ 32, '!', '', parsed.suffix ]);
            }
            return;
        }

        // https://github.com/gorhill/uBlock/issues/3375
        //   Ignore instances of exception filter with negated hostnames,
        //   because there is no way to create an exception to an exception.

        var µburi = µb.URI;

        for ( var hostname of parsed.hostnames ) {
            var negated = hostname.charCodeAt(0) === 0x7E /* '~' */;
            if ( negated ) {
                hostname = hostname.slice(1);
            }
            var hash = µburi.domainFromHostname(hostname);
            if ( parsed.exception ) {
                if ( negated ) { continue; }
                hash = '!' + hash;
            } else if ( negated ) {
                hash = '!' + hash;
            }
            writer.push([ 32, hash, hostname, parsed.suffix ]);
        }
    };

    // 01234567890123456789
    // script:inject(token[, arg[, ...]])
    //               ^                 ^
    //              14                 -1

    api.fromCompiledContent = function(reader) {
        // 1001 = scriptlet injection
        reader.select(1001);

        while ( reader.next() ) {
            acceptedCount += 1;
            var fingerprint = reader.fingerprint();
            if ( duplicates.has(fingerprint) ) {
                discardedCount += 1;
                continue;
            }
            duplicates.add(fingerprint);
            var args = reader.args();
            if ( args.length < 4 ) { continue; }
            scriptletDB.add(
                args[1],
                { hostname: args[2], token: args[3].slice(14, -1) }
            );
        }
    };

    api.retrieve = function(request) {
        if ( scriptletDB.size === 0 ) { return; }
        if ( µb.hiddenSettings.ignoreScriptInjectFilters ) { return; }

        var reng = µb.redirectEngine;
        if ( !reng ) { return; }

        var hostname = request.hostname;

        // https://github.com/gorhill/uBlock/issues/2835
        //   Do not inject scriptlets if the site is under an `allow` rule.
        if (
            µb.userSettings.advancedUserEnabled &&
            µb.sessionFirewall.evaluateCellZY(hostname, hostname, '*') === 2
        ) {
            return;
        }

        var domain = request.domain,
            entity = request.entity,
            entries, entry;

        // https://github.com/gorhill/uBlock/issues/1954
        // Implicit
        var hn = hostname;
        for (;;) {
            lookupScriptlet(hn + '.js', reng, scriptletsRegister);
            if ( hn === domain ) { break; }
            var pos = hn.indexOf('.');
            if ( pos === -1 ) { break; }
            hn = hn.slice(pos + 1);
        }
        if ( entity !== '' ) {
            lookupScriptlet(entity + '.js', reng, scriptletsRegister);
        }

        // Explicit
        entries = [];
        if ( domain !== '' ) {
            scriptletDB.retrieve(domain, hostname, entries);
            scriptletDB.retrieve(entity, entity, entries);
        }
        scriptletDB.retrieve('', hostname, entries);
        for ( entry of entries ) {
            lookupScriptlet(entry.token, reng, scriptletsRegister);
        }

        if ( scriptletsRegister.size === 0 ) { return; }

        // Collect exception filters.
        entries = [];
        if ( domain !== '' ) {
            scriptletDB.retrieve('!' + domain, hostname, entries);
            scriptletDB.retrieve('!' + entity, entity, entries);
        }
        scriptletDB.retrieve('!', hostname, entries);
        for ( entry of entries ) {
            exceptionsRegister.add(entry.token);
        }

        // Return an array of scriptlets, and log results if needed. 
        var out = [],
            logger = µb.logger.isEnabled() ? µb.logger : null,
            isException;
        for ( entry of scriptletsRegister ) {
            if ( (isException = exceptionsRegister.has(entry[0])) === false ) {
                out.push(entry[1]);
            }
            if ( logger !== null ) {
                logOne(isException, entry[0], request);
            }
        }

        scriptletsRegister.clear();
        exceptionsRegister.clear();

        if ( out.length === 0 ) { return; }

        out.push(scriptletRemover);

        return out.join('\n');
    };

    api.apply = function(doc, details) {
        var script = doc.createElement('script');
        script.textContent = details.scriptlets;
        doc.head.insertBefore(script, doc.head.firstChild);
        return true;
    };

    api.toSelfie = function() {
        return scriptletDB.toSelfie();
    };

    api.fromSelfie = function(selfie) {
        scriptletDB = new µb.staticExtFilteringEngine.HostnameBasedDB(selfie);
    };

    Object.defineProperties(api, {
        acceptedCount: {
            get: function() {
                return acceptedCount;
            }
        },
        discardedCount: {
            get: function() {
                return discardedCount;
            }
        }
    });

    return api;
})();

/******************************************************************************/

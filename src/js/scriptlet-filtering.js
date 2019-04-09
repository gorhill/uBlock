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

µBlock.scriptletFilteringEngine = (function() {
    let api = {};

    let µb = µBlock,
        scriptletDB = new µb.staticExtFilteringEngine.HostnameBasedDB(),
        duplicates = new Set(),
        acceptedCount = 0,
        discardedCount = 0,
        scriptletCache = new µb.MRUCache(32),
        exceptionsRegister = new Set(),
        scriptletsRegister = new Map(),
        reEscapeScriptArg = /[\\'"]/g;

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

    let contentscriptCode = (function() {
        let parts = [
            '(',
            function(hostname, scriptlets) {
                if (
                    document.location === null ||
                    hostname !== document.location.hostname
                ) {
                    return;
                }
                let injectScriptlets = function(d) {
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
                let processIFrame = function(iframe) {
                    let src = iframe.src;
                    if ( /^https?:\/\//.test(src) === false ) {
                        injectScriptlets(iframe.contentDocument);
                    }
                };
                let observerTimer,
                    observerLists = [];
                let observerAsync = function() {
                    for ( let nodelist of observerLists ) {
                        for ( let node of nodelist ) {
                            if ( node.nodeType !== 1 ) { continue; }
                            if ( node.parentElement === null ) { continue; }
                            if ( node.localName === 'iframe' ) {
                                processIFrame(node);
                            }
                            if ( node.childElementCount === 0 ) { continue; }
                            let iframes = node.querySelectorAll('iframe');
                            for ( let iframe of iframes ) {
                                processIFrame(iframe);
                            }
                        }
                    }
                    observerLists = [];
                    observerTimer = undefined;
                };
                let ready = function(ev) {
                    if ( ev !== undefined ) {
                        window.removeEventListener(ev.type, ready);
                    }
                    let iframes = document.getElementsByTagName('iframe');
                    if ( iframes.length !== 0 ) {
                        observerLists.push(iframes);
                        observerTimer = setTimeout(observerAsync, 1);
                    }
                    let observer = new MutationObserver(function(mutations) {
                        for ( let mutation of mutations ) {
                            if ( mutation.addedNodes.length !== 0 ) {
                                observerLists.push(mutation.addedNodes);
                            }
                        }
                        if (
                            observerLists.length !== 0 &&
                            observerTimer === undefined
                        ) {
                            observerTimer = setTimeout(observerAsync, 1);
                        }
                    });
                    observer.observe(
                        document.documentElement,
                        { childList: true, subtree: true }
                    );
                };
                if ( document.readyState === 'loading' ) {
                    window.addEventListener('DOMContentLoaded', ready);
                } else {
                    ready();
                }
            }.toString(),
            ')(',
                '"', 'hostname-slot', '", ',
                '"', 'scriptlets-slot', '"',
            '); void 0;',
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
    
    let lookupScriptlet = function(raw, reng, toInject) {
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
            content =
                'try {\n' +
                    content + '\n' +
                '} catch ( e ) { }';
            scriptletCache.add(raw, content);
        }
        toInject.set(raw, content);
    };

    // Fill template placeholders. Return falsy if:
    // - At least one argument contains anything else than /\w/ and `.`

    let patchScriptlet = function(content, args) {
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

    let logOne = function(isException, token, details) {
        µb.logger.writeOne(
            details.tabId,
            'cosmetic',
            {
                source: 'cosmetic',
                raw: (isException ? '#@#' : '##') + '+js(' + token + ')'
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
                writer.push([ 32, 0 | 0b0001, '', parsed.suffix ]);
            }
            return;
        }

        // https://github.com/gorhill/uBlock/issues/3375
        //   Ignore instances of exception filter with negated hostnames,
        //   because there is no way to create an exception to an exception.

        for ( let hn of parsed.hostnames ) {
            let negated = hn.charCodeAt(0) === 0x7E /* '~' */;
            if ( negated ) {
                hn = hn.slice(1);
            }
            let hash = µb.staticExtFilteringEngine.compileHostnameToHash(hn);
            if ( parsed.exception ) {
                if ( negated ) { continue; }
                hash |= 0b0001;
            } else if ( negated ) {
                hash |= 0b0001;
            }
            writer.push([ 32, hash, hn, parsed.suffix ]);
        }
    };

    // 01234567890123456789
    // +js(token[, arg[, ...]])
    //     ^                 ^
    //     4                -1

    api.fromCompiledContent = function(reader) {
        // 1001 = scriptlet injection
        reader.select(1001);

        while ( reader.next() ) {
            acceptedCount += 1;
            let fingerprint = reader.fingerprint();
            if ( duplicates.has(fingerprint) ) {
                discardedCount += 1;
                continue;
            }
            duplicates.add(fingerprint);
            let args = reader.args();
            if ( args.length < 4 ) { continue; }
            scriptletDB.add(
                args[1],
                { hostname: args[2], token: args[3].slice(4, -1) }
            );
        }
    };

    api.retrieve = function(request) {
        if ( scriptletDB.size === 0 ) { return; }
        if ( µb.hiddenSettings.ignoreScriptInjectFilters ) { return; }

        let reng = µb.redirectEngine;
        if ( !reng ) { return; }

        let hostname = request.hostname;

        // https://github.com/gorhill/uBlock/issues/2835
        //   Do not inject scriptlets if the site is under an `allow` rule.
        if (
            µb.userSettings.advancedUserEnabled &&
            µb.sessionFirewall.evaluateCellZY(hostname, hostname, '*') === 2
        ) {
            return;
        }

        let domain = request.domain,
            entity = request.entity;

        // https://github.com/gorhill/uBlock/issues/1954
        // Implicit
        let hn = hostname;
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
        let entries = [];
        let domainHash = µb.staticExtFilteringEngine.makeHash(domain);
        if ( domainHash !== 0 ) {
            scriptletDB.retrieve(domainHash, hostname, entries);
        }
        let entityHash = µb.staticExtFilteringEngine.makeHash(entity);
        if ( entityHash !== 0 ) {
            scriptletDB.retrieve(entityHash, entity, entries);
        }
        scriptletDB.retrieve(0, hostname, entries);
        for ( let entry of entries ) {
            lookupScriptlet(entry.token, reng, scriptletsRegister);
        }

        if ( scriptletsRegister.size === 0 ) { return; }

        // Collect exception filters.
        entries = [];
        if ( domainHash !== 0 ) {
            scriptletDB.retrieve(domainHash | 0b0001, hostname, entries);
        }
        if ( entityHash !== 0 ) {
            scriptletDB.retrieve(entityHash | 0b0001, entity, entries);
        }
        scriptletDB.retrieve(0 | 0b0001, hostname, entries);
        for ( let entry of entries ) {
            exceptionsRegister.add(entry.token);
        }

        // Return an array of scriptlets, and log results if needed. 
        let out = [],
            logger = µb.logger.isEnabled() ? µb.logger : null,
            isException;
        for ( let entry of scriptletsRegister ) {
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

        return out.join('\n');
    };

    api.injectNow = function(details) {
        if ( typeof details.frameId !== 'number' ) { return; }
        if ( µb.URI.isNetworkURI(details.url) === false ) { return; }
        let request = {
            tabId: details.tabId,
            frameId: details.frameId,
            url: details.url,
            hostname: µb.URI.hostnameFromURI(details.url),
            domain: undefined,
            entity: undefined
        };
        request.domain = µb.URI.domainFromHostname(request.hostname);
        request.entity = µb.URI.entityFromDomain(request.domain);
        let scriptlets = µb.scriptletFilteringEngine.retrieve(request);
        if ( scriptlets === undefined ) { return; }
        let code = contentscriptCode.assemble(request.hostname, scriptlets);
        if ( µb.hiddenSettings.debugScriptlets ) {
            code = 'debugger;\n' + code;
        }
        vAPI.tabs.injectScript(
            details.tabId,
            {
                code: code,
                frameId: details.frameId,
                matchAboutBlank: false,
                runAt: 'document_start'
            }
        );
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

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
    const µb = µBlock;
    const duplicates = new Set();
    const scriptletCache = new µb.MRUCache(32);
    const reEscapeScriptArg = /[\\'"]/g;

    const scriptletDB = new µb.staticExtFilteringEngine.HostnameBasedDB(1);
    const sessionScriptletDB = new (
        class extends µb.staticExtFilteringEngine.SessionDB {
            compile(s) {
                return s.slice(4, -1).trim();
            }
        }
    )();

    let acceptedCount = 0;
    let discardedCount = 0;

    const api = {
        get acceptedCount() {
            return acceptedCount;
        },
        get discardedCount() {
            return discardedCount;
        }
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
                const processIFrame = function(iframe) {
                    const src = iframe.src;
                    if ( /^https?:\/\//.test(src) === false ) {
                        injectScriptlets(iframe.contentDocument);
                    }
                };
                let observerTimer,
                    observerLists = [];
                const observerAsync = function() {
                    for ( const nodelist of observerLists ) {
                        for ( const node of nodelist ) {
                            if ( node.nodeType !== 1 ) { continue; }
                            if ( node.parentElement === null ) { continue; }
                            if ( node.localName === 'iframe' ) {
                                processIFrame(node);
                            }
                            if ( node.childElementCount === 0 ) { continue; }
                            let iframes = node.querySelectorAll('iframe');
                            for ( const iframe of iframes ) {
                                processIFrame(iframe);
                            }
                        }
                    }
                    observerLists = [];
                    observerTimer = undefined;
                };
                const ready = function(ev) {
                    if ( ev !== undefined ) {
                        window.removeEventListener(ev.type, ready);
                    }
                    const iframes = document.getElementsByTagName('iframe');
                    if ( iframes.length !== 0 ) {
                        observerLists.push(iframes);
                        observerTimer = setTimeout(observerAsync, 1);
                    }
                    const observer = new MutationObserver(function(mutations) {
                        for ( const mutation of mutations ) {
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

    const normalizeRawFilter = function(rawFilter) {
        let rawToken = rawFilter.slice(4, -1);
        let rawEnd = rawToken.length;
        let end = rawToken.indexOf(',');
        if ( end === -1 ) {
            end = rawEnd;
        }
        let token = rawToken.slice(0, end).trim();
        let normalized = token.endsWith('.js') ? token.slice(0, -3) : token;
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

    const logOne = function(isException, token, details) {
        µBlock.filteringContext
            .duplicate()
            .fromTabId(details.tabId)
            .setRealm('cosmetic')
            .setType('dom')
            .setURL(details.url)
            .setDocOriginFromURL(details.url)
            .setFilter({
                source: 'cosmetic',
                raw: (isException ? '#@#' : '##') + `+js(${token})`
            })
            .toLogger();
    };

    api.reset = function() {
        scriptletDB.clear();
        duplicates.clear();
        acceptedCount = 0;
        discardedCount = 0;
    };

    api.freeze = function() {
        duplicates.clear();
        scriptletDB.collectGarbage();
    };

    api.compile = function(parsed, writer) {
        // 1001 = scriptlet injection
        writer.select(1001);

        // Only exception filters are allowed to be global.
        const normalized = normalizeRawFilter(parsed.suffix);

        // Tokenless is meaningful only for exception filters.
        if ( normalized === '+js()' && parsed.exception === false ) {
            return;
        }

        if ( parsed.hostnames.length === 0 ) {
            if ( parsed.exception ) {
                writer.push([ 32, '', 1, normalized ]);
            }
            return;
        }

        // https://github.com/gorhill/uBlock/issues/3375
        //   Ignore instances of exception filter with negated hostnames,
        //   because there is no way to create an exception to an exception.

        for ( let hn of parsed.hostnames ) {
            const negated = hn.charCodeAt(0) === 0x7E /* '~' */;
            if ( negated ) {
                hn = hn.slice(1);
            }
            let kind = 0;
            if ( parsed.exception ) {
                if ( negated ) { continue; }
                kind |= 1;
            } else if ( negated ) {
                kind |= 1;
            }
            writer.push([ 32, hn, kind, normalized ]);
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

    api.getSession = function() {
        return sessionScriptletDB;
    };

    const $scriptlets = new Set();
    const $exceptions = new Set();
    const $scriptletToCodeMap = new Map();

    api.retrieve = function(request) {
        if ( scriptletDB.size === 0 ) { return; }
        if ( µb.hiddenSettings.ignoreScriptInjectFilters ) { return; }

        const reng = µb.redirectEngine;
        if ( !reng ) { return; }

        const hostname = request.hostname;

        // https://github.com/gorhill/uBlock/issues/2835
        //   Do not inject scriptlets if the site is under an `allow` rule.
        if (
            µb.userSettings.advancedUserEnabled &&
            µb.sessionFirewall.evaluateCellZY(hostname, hostname, '*') === 2
        ) {
            return;
        }

        $scriptlets.clear();
        $exceptions.clear();

        if ( sessionScriptletDB.isNotEmpty ) {
            sessionScriptletDB.retrieve([ null, $exceptions ]);
        }
        scriptletDB.retrieve(hostname, [ $scriptlets, $exceptions ]);
        if ( request.entity !== '' ) {
            scriptletDB.retrieve(
                `${hostname.slice(0, -request.domain.length)}${request.entity}`,
                [ $scriptlets, $exceptions ]
            );
        }
        if ( $scriptlets.size === 0 ) { return; }

        const loggerEnabled = µb.logger.enabled;

        // Wholly disable scriptlet injection?
        if ( $exceptions.has('') ) {
            if ( loggerEnabled ) {
                logOne(true, '', request);
            }
            return;
        }

        $scriptletToCodeMap.clear();
        for ( const rawToken of $scriptlets ) {
            lookupScriptlet(rawToken, reng, $scriptletToCodeMap);
        }
        if ( $scriptletToCodeMap.size === 0 ) { return; }

        // Return an array of scriptlets, and log results if needed.
        const out = [];
        for ( const [ rawToken, code ] of $scriptletToCodeMap ) {
            const isException = $exceptions.has(rawToken);
            if ( isException === false ) {
                out.push(code);
            }
            if ( loggerEnabled ) {
                logOne(isException, rawToken, request);
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

    api.injectNow = function(details) {
        if ( typeof details.frameId !== 'number' ) { return; }
        if ( µb.URI.isNetworkURI(details.url) === false ) { return; }
        const request = {
            tabId: details.tabId,
            frameId: details.frameId,
            url: details.url,
            hostname: µb.URI.hostnameFromURI(details.url),
            domain: undefined,
            entity: undefined
        };
        request.domain = µb.URI.domainFromHostname(request.hostname);
        request.entity = µb.URI.entityFromDomain(request.domain);
        const scriptlets = µb.scriptletFilteringEngine.retrieve(request);
        if ( scriptlets === undefined ) { return; }
        let code = contentscriptCode.assemble(request.hostname, scriptlets);
        if ( µb.hiddenSettings.debugScriptletInjector ) {
            code = 'debugger;\n' + code;
        }
        vAPI.tabs.executeScript(details.tabId, {
            code: code,
            frameId: details.frameId,
            matchAboutBlank: false,
            runAt: 'document_start'
        });
    };

    api.toSelfie = function() {
        return scriptletDB.toSelfie();
    };

    api.fromSelfie = function(selfie) {
        scriptletDB.fromSelfie(selfie);
    };

    api.benchmark = async function() {
        const requests = await µb.loadBenchmarkDataset();
        if ( Array.isArray(requests) === false || requests.length === 0 ) {
            console.info('No requests found to benchmark');
            return;
        }
        console.info('Benchmarking scriptletFilteringEngine.retrieve()...');
        const details = {
            domain: '',
            entity: '',
            hostname: '',
            tabId: 0,
            url: '',
        };
        let count = 0;
        const t0 = self.performance.now();
        for ( let i = 0; i < requests.length; i++ ) {
            const request = requests[i];
            if ( request.cpt !== 'document' ) { continue; }
            count += 1;
            details.url = request.url;
            details.hostname = µb.URI.hostnameFromURI(request.url);
            details.domain = µb.URI.domainFromHostname(details.hostname);
            details.entity = µb.URI.entityFromDomain(details.domain);
            void this.retrieve(details);
        }
        const t1 = self.performance.now();
        const dur = t1 - t0;
        console.info(`Evaluated ${count} requests in ${dur.toFixed(0)} ms`);
        console.info(`\tAverage: ${(dur / count).toFixed(3)} ms per request`);
    };

    return api;
})();

/******************************************************************************/

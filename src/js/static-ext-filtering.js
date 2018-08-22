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

/* global punycode */

'use strict';

/*******************************************************************************

  All static extended filters are of the form:

  field 1: one hostname, or a list of comma-separated hostnames
  field 2: `##` or `#@#`
  field 3: selector

  The purpose of the static extended filtering engine is to coarse-parse and
  dispatch to appropriate specialized filtering engines. There are currently
  three specialized filtering engines:

  - cosmetic filtering (aka "element hiding" in Adblock Plus)
  - scriptlet injection: selector starts with `script:inject`
  - html filtering: selector starts with `^`

  Depending on the specialized filtering engine, field 1 may or may not be
  optional.

  The static extended filtering engine also offers parsing capabilities which
  are available to all other specialized fitlering engines. For example,
  cosmetic and html filtering can ask the extended filtering engine to
  compile/validate selectors.

**/

µBlock.staticExtFilteringEngine = (function() {
    var µb = µBlock,
        reHostnameSeparator = /\s*,\s*/,
        reHasUnicode = /[^\x00-\x7F]/,
        reParseRegexLiteral = /^\/(.+)\/([im]+)?$/,
        emptyArray = [],
        parsed = {
            hostnames: [],
            exception: false,
            suffix: ''
        };

    var isValidCSSSelector = (function() {
        var div = document.createElement('div'),
            matchesFn;
        // Keep in mind:
        //   https://github.com/gorhill/uBlock/issues/693
        //   https://github.com/gorhill/uBlock/issues/1955
        if ( div.matches instanceof Function ) {
            matchesFn = div.matches.bind(div);
        } else if ( div.mozMatchesSelector instanceof Function ) {
            matchesFn = div.mozMatchesSelector.bind(div);
        } else if ( div.webkitMatchesSelector instanceof Function ) {
            matchesFn = div.webkitMatchesSelector.bind(div);
        } else if ( div.msMatchesSelector instanceof Function ) {
            matchesFn = div.msMatchesSelector.bind(div);
        } else {
            matchesFn = div.querySelector.bind(div);
        }
        // https://github.com/gorhill/uBlock/issues/3111
        //   Workaround until https://bugzilla.mozilla.org/show_bug.cgi?id=1406817
        //   is fixed.
        try {
            matchesFn(':scope');
        } catch (ex) {
            matchesFn = div.querySelector.bind(div);
        }
        return function(s) {
            try {
                matchesFn(s + ', ' + s + ':not(#foo)');
            } catch (ex) {
                return false;
            }
            return true;
        };
    })();


    var isBadRegex = function(s) {
        try {
            void new RegExp(s);
        } catch (ex) {
            isBadRegex.message = ex.toString();
            return true;
        }
        return false;
    };

    var translateAdguardCSSInjectionFilter = function(suffix) {
        var matches = /^([^{]+)\{([^}]+)\}$/.exec(suffix);
        if ( matches === null ) { return ''; }
        return matches[1].trim() + ':style(' +  matches[2].trim() + ')';
    };

    var toASCIIHostnames = function(hostnames) {
        var i = hostnames.length;
        while ( i-- ) {
            var hostname = hostnames[i];
            hostnames[i] = hostname.charCodeAt(0) === 0x7E /* '~' */ ?
                '~' + punycode.toASCII(hostname.slice(1)) :
                punycode.toASCII(hostname);
        }
    };

    var compileProceduralSelector = (function() {
        var reProceduralOperator = new RegExp([
            '^(?:',
                [
                '-abp-contains',
                '-abp-has',
                'contains',
                'has',
                'has-text',
                'if',
                'if-not',
                'matches-css',
                'matches-css-after',
                'matches-css-before',
                'xpath'
                ].join('|'),
            ')\\('
        ].join(''));

        var reEscapeRegex = /[.*+?^${}()|[\]\\]/g,
            reNeedScope = /^\s*[+>~]/,
            reIsDanglingSelector = /(?:[+>~]\s*|\s+)$/;

        var lastProceduralSelector = '',
            lastProceduralSelectorCompiled,
            regexToRawValue = new Map();

        var compileText = function(s) {
            var regexDetails,
                match = reParseRegexLiteral.exec(s);
            if ( match !== null ) {
                regexDetails = match[1];
                if ( isBadRegex(regexDetails) ) { return; }
                if ( match[2] ) {
                    regexDetails = [ regexDetails, match[2] ];
                }
            } else {
                regexDetails = s.replace(reEscapeRegex, '\\$&');
                regexToRawValue.set(regexDetails, s);
            }
            return regexDetails;
        };

        var compileCSSDeclaration = function(s) {
            var name, value, regexDetails,
                pos = s.indexOf(':');
            if ( pos === -1 ) { return; }
            name = s.slice(0, pos).trim();
            value = s.slice(pos + 1).trim();
            var match = reParseRegexLiteral.exec(value);
            if ( match !== null ) {
                regexDetails = match[1];
                if ( isBadRegex(regexDetails) ) { return; }
                if ( match[2] ) {
                    regexDetails = [ regexDetails, match[2] ];
                }
            } else {
                regexDetails = '^' + value.replace(reEscapeRegex, '\\$&') + '$';
                regexToRawValue.set(regexDetails, value);
            }
            return { name: name, value: regexDetails };
        };

        var compileConditionalSelector = function(s) {
            // https://github.com/AdguardTeam/ExtendedCss/issues/31#issuecomment-302391277
            // Prepend `:scope ` if needed.
            if ( reNeedScope.test(s) ) {
                s = ':scope ' + s;
            }
            return compile(s);
        };

        var compileXpathExpression = function(s) {
            try {
                document.createExpression(s, null);
            } catch (e) {
                return;
            }
            return s;
        };

        // https://github.com/gorhill/uBlock/issues/2793
        var normalizedOperators = new Map([
            [ ':-abp-contains', ':has-text' ],
            [ ':-abp-has', ':if' ],
            [ ':contains', ':has-text' ]
        ]);

        var compileArgument = new Map([
            [ ':has', compileConditionalSelector ],
            [ ':has-text', compileText ],
            [ ':if', compileConditionalSelector ],
            [ ':if-not', compileConditionalSelector ],
            [ ':matches-css', compileCSSDeclaration ],
            [ ':matches-css-after', compileCSSDeclaration ],
            [ ':matches-css-before', compileCSSDeclaration ],
            [ ':xpath', compileXpathExpression ]
        ]);

        // https://github.com/gorhill/uBlock/issues/2793#issuecomment-333269387
        //   Normalize (somewhat) the stringified version of procedural
        //   cosmetic filters -- this increase the likelihood of detecting
        //   duplicates given that uBO is able to understand syntax specific
        //   to other blockers.
        //   The normalized string version is what is reported in the logger,
        //   by design.
        var decompile = function(compiled) {
            var tasks = compiled.tasks;
            if ( Array.isArray(tasks) === false ) {
                return compiled.selector;
            }
            var raw = [ compiled.selector ],
                value;                
            for ( var i = 0, n = tasks.length, task; i < n; i++ ) {
                task = tasks[i];
                switch ( task[0] ) {
                case ':xpath':
                    raw.push(task[0], '(', task[1], ')');
                    break;
                case ':has-text':
                    if ( Array.isArray(task[1]) ) {
                        value = '/' + task[1][0] + '/' + task[1][1];
                    } else {
                        value = regexToRawValue.get(task[1]);
                        if ( value === undefined ) {
                            value = '/' + task[1] + '/';
                        }
                    }
                    raw.push(task[0], '(', value, ')');
                    break;
                case ':matches-css':
                case ':matches-css-after':
                case ':matches-css-before':
                    if ( Array.isArray(task[1].value) ) {
                        value = '/' + task[1].value[0] + '/' + task[1].value[1];
                    } else {
                        value = regexToRawValue.get(task[1].value);
                        if ( value === undefined ) {
                            value = '/' + task[1].value + '/';
                        }
                    }
                    raw.push(task[0], '(', task[1].name, ': ', value, ')');
                    break;
                case ':has':
                case ':if':
                case ':if-not':
                    raw.push(task[0], '(', decompile(task[1]), ')');
                    break;
                }
            }
            return raw.join('');
        };

        var compile = function(raw) {
            if ( raw === '' ) { return; }
            var prefix = '',
                tasks = [];
            for (;;) {
                var i = 0,
                    n = raw.length,
                    c, match;
                // Advance to next operator.
                while ( i < n ) {
                    c = raw.charCodeAt(i++);
                    if ( c === 0x3A /* ':' */ ) {
                        match = reProceduralOperator.exec(raw.slice(i));
                        if ( match !== null ) { break; }
                    }
                }
                if ( i === n ) { break; }
                var opNameBeg = i - 1;
                var opNameEnd = i + match[0].length - 1;
                i += match[0].length;
                // Find end of argument: first balanced closing parenthesis.
                // Note: unbalanced parenthesis can be used in a regex literal
                // when they are escaped using `\`.
                var pcnt = 1;
                while ( i < n ) {
                    c = raw.charCodeAt(i++);
                    if ( c === 0x5C /* '\\' */ ) {
                        if ( i < n ) { i += 1; }
                    } else if ( c === 0x28 /* '(' */ ) {
                        pcnt +=1 ;
                    } else if ( c === 0x29 /* ')' */ ) {
                        pcnt -= 1;
                        if ( pcnt === 0 ) { break; }
                    }
                }
                // Unbalanced parenthesis?
                if ( pcnt !== 0 ) { return; }
                // Extract and remember operator details.
                var operator = raw.slice(opNameBeg, opNameEnd);
                operator = normalizedOperators.get(operator) || operator;
                var args = raw.slice(opNameEnd + 1, i - 1);
                args = compileArgument.get(operator)(args);
                if ( args === undefined ) { return; }
                if ( tasks.length === 0 ) {
                    prefix = raw.slice(0, opNameBeg);
                } else if ( opNameBeg !== 0 ) {
                    return;
                }
                tasks.push([ operator, args ]);
                raw = raw.slice(i);
                if ( i === n ) { break; }
            }
            // No task found: then we have a CSS selector.
            // At least one task found: nothing should be left to parse.
            if ( tasks.length === 0 ) {
                prefix = raw;
                tasks = undefined;
            } else if ( raw.length !== 0 ) {
                return;
            }
            // https://github.com/NanoAdblocker/NanoCore/issues/1#issuecomment-354394894
            if ( prefix !== '' ) {
                if ( reIsDanglingSelector.test(prefix) ) { prefix += '*'; }
                if ( isValidCSSSelector(prefix) === false ) { return; }
            }
            return { selector: prefix, tasks: tasks };
        };

        var entryPoint = function(raw) {
            if ( raw === lastProceduralSelector ) {
                return lastProceduralSelectorCompiled;
            }
            lastProceduralSelector = raw;
            var compiled = compile(raw);
            if ( compiled !== undefined ) {
                compiled.raw = decompile(compiled);
                compiled = JSON.stringify(compiled);
            }
            lastProceduralSelectorCompiled = compiled;
            return compiled;
        };

        entryPoint.reset = function() {
            regexToRawValue = new Map();
            lastProceduralSelector = '';
            lastProceduralSelectorCompiled = undefined;
        };

        return entryPoint;
    })();

    //--------------------------------------------------------------------------
    // Public API
    //--------------------------------------------------------------------------

    var api = {};

    //--------------------------------------------------------------------------
    // Public classes
    //--------------------------------------------------------------------------

    api.HostnameBasedDB = function(selfie) {
        if ( selfie !== undefined ) {
            this.db = new Map(selfie.map);
            this.size = selfie.size;
        } else {
            this.db = new Map();
            this.size = 0;
        }
    };

    api.HostnameBasedDB.prototype = {
        add: function(hash, entry) {
            var bucket = this.db.get(hash);
            if ( bucket === undefined ) {
                this.db.set(hash, entry);
            } else if ( Array.isArray(bucket) ) {
                bucket.push(entry);
            } else {
                this.db.set(hash, [ bucket, entry ]);
            }
            this.size += 1;
        },
        clear: function() {
            this.db.clear();
            this.size = 0;
        },
        retrieve: function(hash, hostname, out) {
            var bucket = this.db.get(hash);
            if ( bucket === undefined ) { return; }
            if ( Array.isArray(bucket) === false ) {
                if ( hostname.endsWith(bucket.hostname) ) { out.push(bucket); }
                return;
            }
            var i = bucket.length;
            while ( i-- ) {
                var entry = bucket[i];
                if ( hostname.endsWith(entry.hostname) ) { out.push(entry); }
            }
        },
        toSelfie: function() {
            return {
                map: Array.from(this.db),
                size: this.size
            };
        }
    };

    api.HostnameBasedDB.prototype[Symbol.iterator] = (function() {
        var Iter = function(db) {
            this.mapIter = db.values();
            this.arrayIter = undefined;
        };
        Iter.prototype.next = function() {
            var result;
            if ( this.arrayIter !== undefined ) {
                result = this.arrayIter.next();
                if ( result.done === false ) { return result; }
                this.arrayIter = undefined;
            }
            result = this.mapIter.next();
            if ( result.done || Array.isArray(result.value) === false ) {
                return result;
            }
            this.arrayIter = result.value[Symbol.iterator]();
            return this.arrayIter.next(); // array should never be empty
        };
        return function() {
            return new Iter(this.db);
        };
    })();

    //--------------------------------------------------------------------------
    // Public methods
    //--------------------------------------------------------------------------

    api.reset = function() {
        compileProceduralSelector.reset();
        µb.cosmeticFilteringEngine.reset();
        µb.scriptletFilteringEngine.reset();
        µb.htmlFilteringEngine.reset();
    };

    api.freeze = function() {
        compileProceduralSelector.reset();
        µb.cosmeticFilteringEngine.freeze();
        µb.scriptletFilteringEngine.freeze();
        µb.htmlFilteringEngine.freeze();
    };

    // https://github.com/chrisaljoudi/uBlock/issues/1004
    // Detect and report invalid CSS selectors.

    // Discard new ABP's `-abp-properties` directive until it is
    // implemented (if ever). Unlikely, see:
    // https://github.com/gorhill/uBlock/issues/1752

    // https://github.com/gorhill/uBlock/issues/2624
    // Convert Adguard's `-ext-has='...'` into uBO's `:has(...)`.

    api.compileSelector = (function() {
        var reAfterBeforeSelector = /^(.+?)(::?after|::?before)$/,
            reStyleSelector = /^(.+?):style\((.+?)\)$/,
            reStyleBad = /url\([^)]+\)/,
            reExtendedSyntax = /\[-(?:abp|ext)-[a-z-]+=(['"])(?:.+?)(?:\1)\]/,
            reExtendedSyntaxParser = /\[-(?:abp|ext)-([a-z-]+)=(['"])(.+?)\2\]/,
            div = document.createElement('div');

        var normalizedExtendedSyntaxOperators = new Map([
            [ 'contains', ':has-text' ],
            [ 'has', ':if' ],
            [ 'matches-css', ':matches-css' ],
            [ 'matches-css-after', ':matches-css-after' ],
            [ 'matches-css-before', ':matches-css-before' ],
        ]);

        var isValidStyleProperty = function(cssText) {
            if ( reStyleBad.test(cssText) ) { return false; }
            div.style.cssText = cssText;
            if ( div.style.cssText === '' ) { return false; }
            div.style.cssText = '';
            return true;
        };

        var entryPoint = function(raw) {
            var extendedSyntax = reExtendedSyntax.test(raw);
            if ( isValidCSSSelector(raw) && extendedSyntax === false ) {
                return raw;
            }

            // We  rarely reach this point -- majority of selectors are plain
            // CSS selectors.

            var matches, operator;

            // Supported Adguard/ABP advanced selector syntax: will translate into
            // uBO's syntax before further processing.
            // Mind unsupported advanced selector syntax, such as ABP's
            // `-abp-properties`.
            // Note: extended selector syntax has been deprecated in ABP, in favor
            // of the procedural one (i.e. `:operator(...)`). See
            // https://issues.adblockplus.org/ticket/5287
            if ( extendedSyntax ) {
                while ( (matches = reExtendedSyntaxParser.exec(raw)) !== null ) {
                    operator = normalizedExtendedSyntaxOperators.get(matches[1]);
                    if ( operator === undefined ) { return; }
                    raw = raw.slice(0, matches.index) +
                          operator + '(' + matches[3] + ')' +
                          raw.slice(matches.index + matches[0].length);
                }
                return entryPoint(raw);
            }

            var selector = raw,
                pseudoclass, style;

            // `:style` selector?
            if ( (matches = reStyleSelector.exec(selector)) !== null ) {
                selector = matches[1];
                style = matches[2];
            }

            // https://github.com/gorhill/uBlock/issues/2448
            // :after- or :before-based selector?
            if ( (matches = reAfterBeforeSelector.exec(selector)) ) {
                selector = matches[1];
                pseudoclass = matches[2];
            }

            if ( style !== undefined || pseudoclass !== undefined ) {
                if ( isValidCSSSelector(selector) === false ) {
                    return;
                }
                if ( pseudoclass !== undefined ) {
                    selector += pseudoclass;
                }
                if ( style !== undefined ) {
                    if ( isValidStyleProperty(style) === false ) { return; }
                    return JSON.stringify({
                        raw: raw,
                        style: [ selector, style ]
                    });
                }
                return JSON.stringify({
                    raw: raw,
                    pseudoclass: true
                });
            }

            // Procedural selector?
            var compiled;
            if ( (compiled = compileProceduralSelector(raw)) ) {
                return compiled;
            }

            µb.logger.writeOne(
                '',
                'error',
                'Cosmetic filtering – invalid filter: ' + raw
            );
        };

        return entryPoint;
    })();

    api.compile = function(raw, writer) {
        var lpos = raw.indexOf('#');
        if ( lpos === -1 ) { return false; }
        var rpos = lpos + 1;
        if ( raw.charCodeAt(rpos) !== 0x23 /* '#' */ ) {
            rpos = raw.indexOf('#', rpos + 1);
            if ( rpos === -1 ) { return false; }
        }

        // Coarse-check that the anchor is valid.
        // `##`: l = 1
        // `#@#`, `#$#`, `#%#`, `#?#`: l = 2
        // `#@$#`, `#@%#`, `#@?#`: l = 3
        if ( (rpos - lpos) > 3 ) { return false; }

        // Extract the selector.
        var suffix = raw.slice(rpos + 1).trim();
        if ( suffix.length === 0 ) { return false; }
        parsed.suffix = suffix;

        // https://github.com/gorhill/uBlock/issues/952
        //   Find out whether we are dealing with an Adguard-specific cosmetic
        //   filter, and if so, translate it if supported, or discard it if not
        //   supported.
        //   We have an Adguard/ABP cosmetic filter if and only if the
        //   character is `$`, `%` or `?`, otherwise it's not a cosmetic
        //   filter.
        var cCode = raw.charCodeAt(rpos - 1);
        if ( cCode !== 0x23 /* '#' */ && cCode !== 0x40 /* '@' */ ) {
            // Adguard's scriptlet injection: not supported.
            if ( cCode === 0x25 /* '%' */ ) { return true; }
            // Not a known extended filter.
            if ( cCode !== 0x24 /* '$' */ && cCode !== 0x3F /* '?' */ ) {
                return false;
            }
            // Adguard's style injection: translate to uBO's format.
            if ( cCode === 0x24 /* '$' */ ) {
                suffix = translateAdguardCSSInjectionFilter(suffix);
                if ( suffix === '' ) { return true; }
                parsed.suffix = suffix;
            }
        }

        // Exception filter?
        parsed.exception = raw.charCodeAt(lpos + 1) === 0x40 /* '@' */;

        // Extract the hostname(s), punycode if required.
        if ( lpos === 0 ) {
            parsed.hostnames = emptyArray;
        } else {
            var prefix = raw.slice(0, lpos);
            parsed.hostnames = prefix.split(reHostnameSeparator);
            if ( reHasUnicode.test(prefix) ) {
                toASCIIHostnames(parsed.hostnames);
            }
        }

        if ( suffix.startsWith('script:') ) {
            // Scriptlet injection engine.
            if ( suffix.startsWith('script:inject') ) {
                µb.scriptletFilteringEngine.compile(parsed, writer);
                return true;
            }
            // Script tag filtering: courtesy-conversion to HTML filtering.
            if ( suffix.startsWith('script:contains') ) {
                console.info(
                    'uBO: ##script:contains(...) is deprecated, ' +
                    'converting to ##^script:has-text(...)'
                );
                suffix = suffix.replace(/^script:contains/, '^script:has-text');
                parsed.suffix = suffix;
            }
        }

        // HTML filtering engine.
        // TODO: evaluate converting Adguard's `$$` syntax into uBO's HTML
        //       filtering syntax.
        if ( suffix.charCodeAt(0) === 0x5E /* '^' */ ) {
            µb.htmlFilteringEngine.compile(parsed, writer);
            return true;
        }

        // Cosmetic filtering engine.
        µb.cosmeticFilteringEngine.compile(parsed, writer);
        return true;
    };

    api.fromCompiledContent = function(reader, options) {
        µb.cosmeticFilteringEngine.fromCompiledContent(reader, options);
        µb.scriptletFilteringEngine.fromCompiledContent(reader, options);
        µb.htmlFilteringEngine.fromCompiledContent(reader, options);
    };

    api.toSelfie = function() {
        return {
            cosmetic: µb.cosmeticFilteringEngine.toSelfie(),
            scriptlets: µb.scriptletFilteringEngine.toSelfie(),
            html: µb.htmlFilteringEngine.toSelfie()
            
        };
    };

    Object.defineProperties(api, {
        acceptedCount: {
            get: function() {
                return µb.cosmeticFilteringEngine.acceptedCount +
                       µb.scriptletFilteringEngine.acceptedCount +
                       µb.htmlFilteringEngine.acceptedCount;
            }
        },
        discardedCount: {
            get: function() {
                return µb.cosmeticFilteringEngine.discardedCount +
                       µb.scriptletFilteringEngine.discardedCount +
                       µb.htmlFilteringEngine.discardedCount;
            }
        }
    });

    api.fromSelfie = function(selfie) {
        µb.cosmeticFilteringEngine.fromSelfie(selfie.cosmetic);
        µb.scriptletFilteringEngine.fromSelfie(selfie.scriptlets);
        µb.htmlFilteringEngine.fromSelfie(selfie.html);
    };

    return api;
})();

/******************************************************************************/

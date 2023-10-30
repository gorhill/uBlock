/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2019-present Raymond Hill

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

    The scriptlets below are meant to be injected only into a
    web page context.
*/

// Externally added to the private namespace in which scriptlets execute.
/* global scriptletGlobals */

'use strict';

export const builtinScriptlets = [];

/*******************************************************************************

    Helper functions
    
    These are meant to be used as dependencies to injectable scriptlets.

*******************************************************************************/

builtinScriptlets.push({
    name: 'safe-self.fn',
    fn: safeSelf,
});
function safeSelf() {
    if ( scriptletGlobals.has('safeSelf') ) {
        return scriptletGlobals.get('safeSelf');
    }
    const self = globalThis;
    const safe = {
        'Array_from': Array.from,
        'Error': self.Error,
        'Math_floor': Math.floor,
        'Math_random': Math.random,
        'Object_defineProperty': Object.defineProperty.bind(Object),
        'RegExp': self.RegExp,
        'RegExp_test': self.RegExp.prototype.test,
        'RegExp_exec': self.RegExp.prototype.exec,
        'Request_clone': self.Request.prototype.clone,
        'XMLHttpRequest': self.XMLHttpRequest,
        'addEventListener': self.EventTarget.prototype.addEventListener,
        'removeEventListener': self.EventTarget.prototype.removeEventListener,
        'fetch': self.fetch,
        'JSON': self.JSON,
        'JSON_parseFn': self.JSON.parse,
        'JSON_stringifyFn': self.JSON.stringify,
        'JSON_parse': (...args) => safe.JSON_parseFn.call(safe.JSON, ...args),
        'JSON_stringify': (...args) => safe.JSON_stringifyFn.call(safe.JSON, ...args),
        'log': console.log.bind(console),
        uboLog(...args) {
            if ( scriptletGlobals.has('canDebug') === false ) { return; }
            if ( args.length === 0 ) { return; }
            if ( `${args[0]}` === '' ) { return; }
            this.log('[uBO]', ...args);
        },
        initPattern(pattern, options = {}) {
            if ( pattern === '' ) {
                return { matchAll: true };
            }
            const expect = (options.canNegate !== true || pattern.startsWith('!') === false);
            if ( expect === false ) {
                pattern = pattern.slice(1);
            }
            const match = /^\/(.+)\/([gimsu]*)$/.exec(pattern);
            if ( match !== null ) {
                return {
                    pattern,
                    re: new this.RegExp(
                        match[1],
                        match[2] || options.flags
                    ),
                    expect,
                };
            }
            return {
                pattern,
                re: new this.RegExp(pattern.replace(
                    /[.*+?^${}()|[\]\\]/g, '\\$&'),
                    options.flags
                ),
                expect,
            };
        },
        testPattern(details, haystack) {
            if ( details.matchAll ) { return true; }
            return this.RegExp_test.call(details.re, haystack) === details.expect;
        },
        patternToRegex(pattern, flags = undefined, verbatim = false) {
            if ( pattern === '' ) { return /^/; }
            const match = /^\/(.+)\/([gimsu]*)$/.exec(pattern);
            if ( match === null ) {
                const reStr = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                return new RegExp(verbatim ? `^${reStr}$` : reStr, flags);
            }
            try {
                return new RegExp(match[1], match[2] || flags);
            }
            catch(ex) {
            }
            return /^/;
        },
        getExtraArgs(args, offset = 0) {
            const entries = args.slice(offset).reduce((out, v, i, a) => {
                if ( (i & 1) === 0 ) {
                    const rawValue = a[i+1];
                    const value = /^\d+$/.test(rawValue)
                        ? parseInt(rawValue, 10)
                        : rawValue;
                    out.push([ a[i], value ]);
                }
                return out;
            }, []);
            return Object.fromEntries(entries);
        },
    };
    scriptletGlobals.set('safeSelf', safe);
    return safe;
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'get-exception-token.fn',
    fn: getExceptionToken,
    dependencies: [
        'safe-self.fn',
    ],
});
function getExceptionToken() {
    const safe = safeSelf();
    const token =
        String.fromCharCode(Date.now() % 26 + 97) +
        safe.Math_floor(safe.Math_random() * 982451653 + 982451653).toString(36);
    const oe = self.onerror;
    self.onerror = function(msg, ...args) {
        if ( typeof msg === 'string' && msg.includes(token) ) { return true; }
        if ( oe instanceof Function ) {
            return oe.call(this, msg, ...args);
        }
    }.bind();
    return token;
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'should-debug.fn',
    fn: shouldDebug,
});
function shouldDebug(details) {
    if ( details instanceof Object === false ) { return false; }
    return scriptletGlobals.has('canDebug') && details.debug;
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'should-log.fn',
    fn: shouldLog,
});
function shouldLog(details) {
    if ( details instanceof Object === false ) { return false; }
    return scriptletGlobals.has('canDebug') && details.log;
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'run-at.fn',
    fn: runAt,
    dependencies: [
        'safe-self.fn',
    ],
});
function runAt(fn, when) {
    const intFromReadyState = state => {
        const targets = {
            'loading': 1,
            'interactive': 2, 'end': 2, '2': 2,
            'complete': 3, 'idle': 3, '3': 3,
        };
        const tokens = Array.isArray(state) ? state : [ state ];
        for ( const token of tokens ) {
            const prop = `${token}`;
            if ( targets.hasOwnProperty(prop) === false ) { continue; }
            return targets[prop];
        }
        return 0;
    };
    const runAt = intFromReadyState(when);
    if ( intFromReadyState(document.readyState) >= runAt ) {
        fn(); return;
    }
    const onStateChange = ( ) => {
        if ( intFromReadyState(document.readyState) < runAt ) { return; }
        fn();
        safe.removeEventListener.apply(document, args);
    };
    const safe = safeSelf();
    const args = [ 'readystatechange', onStateChange, { capture: true } ];
    safe.addEventListener.apply(document, args);
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'run-at-html-element.fn',
    fn: runAtHtmlElementFn,
});
function runAtHtmlElementFn(fn) {
    if ( document.documentElement ) {
        fn();
        return;
    }
    const observer = new MutationObserver(( ) => {
        observer.disconnect();
        fn();
    });
    observer.observe(document, { childList: true });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'abort-current-script-core.fn',
    fn: abortCurrentScriptCore,
    dependencies: [
        'get-exception-token.fn',
        'safe-self.fn',
        'should-debug.fn',
        'should-log.fn',
    ],
});
// Issues to mind before changing anything:
//  https://github.com/uBlockOrigin/uBlock-issues/issues/2154
function abortCurrentScriptCore(
    target = '',
    needle = '',
    context = ''
) {
    if ( typeof target !== 'string' ) { return; }
    if ( target === '' ) { return; }
    const safe = safeSelf();
    const reNeedle = safe.patternToRegex(needle);
    const reContext = safe.patternToRegex(context);
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 3);
    const thisScript = document.currentScript;
    const chain = target.split('.');
    let owner = window;
    let prop;
    for (;;) {
        prop = chain.shift();
        if ( chain.length === 0 ) { break; }
        if ( prop in owner === false ) { break; }
        owner = owner[prop];
        if ( owner instanceof Object === false ) { return; }
    }
    let value;
    let desc = Object.getOwnPropertyDescriptor(owner, prop);
    if (
        desc instanceof Object === false ||
        desc.get instanceof Function === false
    ) {
        value = owner[prop];
        desc = undefined;
    }
    const log = shouldLog(extraArgs);
    const debug = shouldDebug(extraArgs);
    const exceptionToken = getExceptionToken();
    const scriptTexts = new WeakMap();
    const getScriptText = elem => {
        let text = elem.textContent;
        if ( text.trim() !== '' ) { return text; }
        if ( scriptTexts.has(elem) ) { return scriptTexts.get(elem); }
        const [ , mime, content ] =
            /^data:([^,]*),(.+)$/.exec(elem.src.trim()) ||
            [ '', '', '' ];
        try {
            switch ( true ) {
            case mime.endsWith(';base64'):
                text = self.atob(content);
                break;
            default:
                text = self.decodeURIComponent(content);
                break;
            }
        } catch(ex) {
        }
        scriptTexts.set(elem, text);
        return text;
    };
    const validate = ( ) => {
        const e = document.currentScript;
        if ( e instanceof HTMLScriptElement === false ) { return; }
        if ( e === thisScript ) { return; }
        if ( context !== '' && reContext.test(e.src) === false ) {
            if ( debug === 'nomatch' || debug === 'all' ) { debugger; }  // jshint ignore: line
            return;
        }
        if ( log && e.src !== '' ) { safe.uboLog(`matched src: ${e.src}`); }
        const scriptText = getScriptText(e);
        if ( reNeedle.test(scriptText) === false ) {
            if ( debug === 'nomatch' || debug === 'all' ) { debugger; }  // jshint ignore: line
            return;
        }
        if ( log ) { safe.uboLog(`matched script text: ${scriptText}`); }
        if ( debug === 'match' || debug === 'all' ) { debugger; }  // jshint ignore: line
        throw new ReferenceError(exceptionToken);
    };
    if ( debug === 'install' ) { debugger; }  // jshint ignore: line
    try {
        Object.defineProperty(owner, prop, {
            get: function() {
                validate();
                return desc instanceof Object
                    ? desc.get.call(owner)
                    : value;
            },
            set: function(a) {
                validate();
                if ( desc instanceof Object ) {
                    desc.set.call(owner, a);
                } else {
                    value = a;
                }
            }
        });
    } catch(ex) {
        if ( log ) { safe.uboLog(ex); }
    }
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'set-constant-core.fn',
    fn: setConstantCore,
    dependencies: [
        'run-at.fn',
        'safe-self.fn',
    ],
});

function setConstantCore(
    trusted = false,
    chain = '',
    cValue = ''
) {
    if ( chain === '' ) { return; }
    const safe = safeSelf();
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 3);
    function setConstant(chain, cValue) {
        const trappedProp = (( ) => {
            const pos = chain.lastIndexOf('.');
            if ( pos === -1 ) { return chain; }
            return chain.slice(pos+1);
        })();
        if ( trappedProp === '' ) { return; }
        const thisScript = document.currentScript;
        const cloakFunc = fn => {
            safe.Object_defineProperty(fn, 'name', { value: trappedProp });
            const proxy = new Proxy(fn, {
                defineProperty(target, prop) {
                    if ( prop !== 'toString' ) {
                        return Reflect.defineProperty(...arguments);
                    }
                    return true;
                },
                deleteProperty(target, prop) {
                    if ( prop !== 'toString' ) {
                        return Reflect.deleteProperty(...arguments);
                    }
                    return true;
                },
                get(target, prop) {
                    if ( prop === 'toString' ) {
                        return function() {
                            return `function ${trappedProp}() { [native code] }`;
                        }.bind(null);
                    }
                    return Reflect.get(...arguments);
                },
            });
            return proxy;
        };
        if ( cValue === 'undefined' ) {
            cValue = undefined;
        } else if ( cValue === 'false' ) {
            cValue = false;
        } else if ( cValue === 'true' ) {
            cValue = true;
        } else if ( cValue === 'null' ) {
            cValue = null;
        } else if ( cValue === "''" || cValue === '' ) {
            cValue = '';
        } else if ( cValue === '[]' ) {
            cValue = [];
        } else if ( cValue === '{}' ) {
            cValue = {};
        } else if ( cValue === 'noopFunc' ) {
            cValue = cloakFunc(function(){});
        } else if ( cValue === 'trueFunc' ) {
            cValue = cloakFunc(function(){ return true; });
        } else if ( cValue === 'falseFunc' ) {
            cValue = cloakFunc(function(){ return false; });
        } else if ( /^-?\d+$/.test(cValue) ) {
            cValue = parseInt(cValue);
            if ( isNaN(cValue) ) { return; }
            if ( Math.abs(cValue) > 0x7FFF ) { return; }
        } else if ( trusted ) {
            if ( cValue.startsWith('{') && cValue.endsWith('}') ) {
                try { cValue = safe.JSON_parse(cValue).value; } catch(ex) { return; }
            }
        } else {
            return;
        }
        if ( extraArgs.as !== undefined ) {
            if ( extraArgs.as === 'function' ) {
                cValue = ( ) => cValue;
            } else if ( extraArgs.as === 'callback' ) {
                cValue = ( ) => (( ) => cValue);
            } else if ( extraArgs.as === 'resolved' ) {
                cValue = Promise.resolve(cValue);
            } else if ( extraArgs.as === 'rejected' ) {
                cValue = Promise.reject(cValue);
            }
        }
        let aborted = false;
        const mustAbort = function(v) {
            if ( trusted ) { return false; }
            if ( aborted ) { return true; }
            aborted =
                (v !== undefined && v !== null) &&
                (cValue !== undefined && cValue !== null) &&
                (typeof v !== typeof cValue);
            return aborted;
        };
        // https://github.com/uBlockOrigin/uBlock-issues/issues/156
        //   Support multiple trappers for the same property.
        const trapProp = function(owner, prop, configurable, handler) {
            if ( handler.init(configurable ? owner[prop] : cValue) === false ) { return; }
            const odesc = Object.getOwnPropertyDescriptor(owner, prop);
            let prevGetter, prevSetter;
            if ( odesc instanceof Object ) {
                owner[prop] = cValue;
                if ( odesc.get instanceof Function ) {
                    prevGetter = odesc.get;
                }
                if ( odesc.set instanceof Function ) {
                    prevSetter = odesc.set;
                }
            }
            try {
                safe.Object_defineProperty(owner, prop, {
                    configurable,
                    get() {
                        if ( prevGetter !== undefined ) {
                            prevGetter();
                        }
                        return handler.getter(); // cValue
                    },
                    set(a) {
                        if ( prevSetter !== undefined ) {
                            prevSetter(a);
                        }
                        handler.setter(a);
                    }
                });
            } catch(ex) {
            }
        };
        const trapChain = function(owner, chain) {
            const pos = chain.indexOf('.');
            if ( pos === -1 ) {
                trapProp(owner, chain, false, {
                    v: undefined,
                    init: function(v) {
                        if ( mustAbort(v) ) { return false; }
                        this.v = v;
                        return true;
                    },
                    getter: function() {
                        return document.currentScript === thisScript
                            ? this.v
                            : cValue;
                    },
                    setter: function(a) {
                        if ( mustAbort(a) === false ) { return; }
                        cValue = a;
                    }
                });
                return;
            }
            const prop = chain.slice(0, pos);
            const v = owner[prop];
            chain = chain.slice(pos + 1);
            if ( v instanceof Object || typeof v === 'object' && v !== null ) {
                trapChain(v, chain);
                return;
            }
            trapProp(owner, prop, true, {
                v: undefined,
                init: function(v) {
                    this.v = v;
                    return true;
                },
                getter: function() {
                    return this.v;
                },
                setter: function(a) {
                    this.v = a;
                    if ( a instanceof Object ) {
                        trapChain(a, chain);
                    }
                }
            });
        };
        trapChain(window, chain);
    }
    runAt(( ) => {
        setConstant(chain, cValue);
    }, extraArgs.runAt);
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'replace-node-text.fn',
    fn: replaceNodeTextFn,
    dependencies: [
        'run-at.fn',
        'safe-self.fn',
    ],
});
function replaceNodeTextFn(
    nodeName = '',
    pattern = '',
    replacement = ''
) {
    const safe = safeSelf();
    const reNodeName = safe.patternToRegex(nodeName, 'i', true);
    const rePattern = safe.patternToRegex(pattern, 'gms');
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 3);
    const shouldLog = scriptletGlobals.has('canDebug') && extraArgs.log || 0;
    const reCondition = safe.patternToRegex(extraArgs.condition || '', 'gms');
    const stop = (takeRecord = true) => {
        if ( takeRecord ) {
            handleMutations(observer.takeRecords());
        }
        observer.disconnect();
        if ( shouldLog !== 0 ) {
            safe.uboLog(`replace-node-text-core.fn: quitting "${pattern}" => "${replacement}"`);
        }
    };
    let sedCount = extraArgs.sedCount || 0;
    const handleNode = node => {
        const before = node.textContent;
        if ( safe.RegExp_test.call(rePattern, before) === false ) { return true; }
        if ( safe.RegExp_test.call(reCondition, before) === false ) { return true; }
        const after = pattern !== ''
            ? before.replace(rePattern, replacement)
            : replacement;
        node.textContent = after;
        if ( shouldLog !== 0 ) {
            safe.uboLog('replace-node-text.fn before:\n', before);
            safe.uboLog('replace-node-text.fn after:\n', after);
        }
        return sedCount === 0 || (sedCount -= 1) !== 0;
    };
    const handleMutations = mutations => {
        for ( const mutation of mutations ) {
            for ( const node of mutation.addedNodes ) {
                if ( reNodeName.test(node.nodeName) === false ) { continue; }
                if ( handleNode(node) ) { continue; }
                stop(false); return;
            }
        }
    };
    const observer = new MutationObserver(handleMutations);
    observer.observe(document, { childList: true, subtree: true });
    if ( document.documentElement ) {
        const treeWalker = document.createTreeWalker(
            document.documentElement,
            NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
        );
        let count = 0;
        for (;;) {
            const node = treeWalker.nextNode();
            count += 1;
            if ( node === null ) { break; }
            if ( reNodeName.test(node.nodeName) === false ) { continue; }
            if ( handleNode(node) ) { continue; }
            stop(); break;
        }
        if ( shouldLog !== 0 ) {
            safe.uboLog(`replace-node-text-core.fn ${count} nodes present before installing mutation observer`);
        }
    }
    if ( extraArgs.stay ) { return; }
    runAt(( ) => {
        const quitAfter = extraArgs.quitAfter || 0;
        if ( quitAfter !== 0 ) {
            setTimeout(( ) => { stop(); }, quitAfter);
        } else {
            stop();
        }
    }, 'interactive');
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'object-prune.fn',
    fn: objectPruneFn,
    dependencies: [
        'matches-stack-trace.fn',
        'object-find-owner.fn',
        'safe-self.fn',
        'should-log.fn',
    ],
});
//  When no "prune paths" argument is provided, the scriptlet is
//  used for logging purpose and the "needle paths" argument is
//  used to filter logging output.
//
//  https://github.com/uBlockOrigin/uBlock-issues/issues/1545
//  - Add support for "remove everything if needle matches" case
function objectPruneFn(
    obj,
    rawPrunePaths,
    rawNeedlePaths,
    stackNeedleDetails = { matchAll: true },
    extraArgs = {}
) {
    if ( typeof rawPrunePaths !== 'string' ) { return; }
    const safe = safeSelf();
    const prunePaths = rawPrunePaths !== ''
        ? rawPrunePaths.split(/ +/)
        : [];
    const needlePaths = prunePaths.length !== 0 && rawNeedlePaths !== ''
        ? rawNeedlePaths.split(/ +/)
        : [];
    const logLevel = shouldLog({ log: rawPrunePaths === '' || extraArgs.log });
    const reLogNeedle = safe.patternToRegex(logLevel === true ? rawNeedlePaths : '');
    if ( stackNeedleDetails.matchAll !== true ) {
        if ( matchesStackTrace(stackNeedleDetails, extraArgs.logstack) === false ) {
            return;
        }
    }
    if ( objectPruneFn.mustProcess === undefined ) {
        objectPruneFn.mustProcess = (root, needlePaths) => {
            for ( const needlePath of needlePaths ) {
                if ( objectFindOwnerFn(root, needlePath) === false ) {
                    return false;
                }
            }
            return true;
        };
        objectPruneFn.logJson = (json, msg, reNeedle) => {
            if ( reNeedle.test(json) === false ) { return; }
            safeSelf().uboLog(`objectPrune()`, msg, location.hostname, json);
        };
    }
    const jsonBefore = logLevel ? safe.JSON_stringify(obj, null, 2) : '';
    if ( logLevel === true || logLevel === 'all' ) {
        objectPruneFn.logJson(jsonBefore, `prune:"${rawPrunePaths}" log:"${logLevel}"`, reLogNeedle);
    }
    if ( prunePaths.length === 0 ) { return; }
    let outcome = 'nomatch';
    if ( objectPruneFn.mustProcess(obj, needlePaths) ) {
        for ( const path of prunePaths ) {
            if ( objectFindOwnerFn(obj, path, true) ) {
                outcome = 'match';
            }
        }
    }
    if ( logLevel === outcome ) {
        objectPruneFn.logJson(jsonBefore, `prune:"${rawPrunePaths}" log:"${logLevel}"`, reLogNeedle);
    }
    if ( outcome === 'match' ) { return obj; }
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'object-find-owner.fn',
    fn: objectFindOwnerFn,
});
function objectFindOwnerFn(
    root,
    path,
    prune = false
) {
    let owner = root;
    let chain = path;
    for (;;) {
        if ( typeof owner !== 'object' || owner === null  ) { return false; }
        const pos = chain.indexOf('.');
        if ( pos === -1 ) {
            if ( prune === false ) {
                return owner.hasOwnProperty(chain);
            }
            let modified = false;
            if ( chain === '*' ) {
                for ( const key in owner ) {
                    if ( owner.hasOwnProperty(key) === false ) { continue; }
                    delete owner[key];
                    modified = true;
                }
            } else if ( owner.hasOwnProperty(chain) ) {
                delete owner[chain];
                modified = true;
            }
            return modified;
        }
        const prop = chain.slice(0, pos);
        if (
            prop === '[]' && Array.isArray(owner) ||
            prop === '*' && owner instanceof Object
        ) {
            const next = chain.slice(pos + 1);
            let found = false;
            for ( const key of Object.keys(owner) ) {
                found = objectFindOwnerFn(owner[key], next, prune) || found;
            }
            return found;
        }
        if ( owner.hasOwnProperty(prop) === false ) { return false; }
        owner = owner[prop];
        chain = chain.slice(pos + 1);
    }
    return true;
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'set-cookie.fn',
    fn: setCookieFn,
});
function setCookieFn(
    trusted = false,
    name = '',
    value = '',
    expires = '',
    path = '',
    options = {},
) {
    const getCookieValue = name => {
        for ( const s of document.cookie.split(/\s*;\s*/) ) {
            const pos = s.indexOf('=');
            if ( pos === -1 ) { continue; }
            if ( s.slice(0, pos) !== name ) { continue; }
            return s.slice(pos+1);
        }
    };

    const cookieBefore = getCookieValue(name);
    if ( cookieBefore !== undefined && options.dontOverwrite ) { return; }
    if ( cookieBefore === value && options.reload ) { return; }

    const cookieParts = [ name, '=', value ];
    if ( expires !== '' ) {
        cookieParts.push('; expires=', expires);
    }

    if ( path === '' ) { path = '/'; }
    else if ( path === 'none' ) { path = ''; }
    if ( path !== '' && path !== '/' ) { return; }
    if ( path === '/' ) {
        cookieParts.push('; path=/');
    }

    if ( trusted ) {
        if ( options.domain ) {
            cookieParts.push(`; domain=${options.domain}`);
        }
        cookieParts.push('; Secure');
    }

    try {
        document.cookie = cookieParts.join('');
    } catch(_) {
    }

    if ( options.reload && getCookieValue(name) === value ) {
        window.location.reload();
    }
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'set-local-storage-item.fn',
    fn: setLocalStorageItemFn,
    dependencies: [
        'safe-self.fn',
    ],
});
function setLocalStorageItemFn(
    which = 'local',
    trusted = false,
    key = '',
    value = '',
) {
    if ( key === '' ) { return; }

    const trustedValues = [
        '',
        'undefined', 'null',
        'false', 'true',
        'on', 'off',
        'yes', 'no',
        '{}', '[]', '""',
        '$remove$',
    ];

    if ( trusted ) {
        if ( value === '$now$' ) {
            value = Date.now();
        } else if ( value === '$currentDate$' ) {
            value = `${Date()}`;
        } else if ( value === '$currentISODate$' ) {
            value = (new Date()).toISOString();
        }
    } else {
        if ( trustedValues.includes(value.toLowerCase()) === false ) {
            if ( /^\d+$/.test(value) === false ) { return; }
            value = parseInt(value, 10);
            if ( value > 32767 ) { return; }
        }
    }

    try {
        const storage = self[`${which}Storage`];
        if ( value === '$remove$' ) {
            const safe = safeSelf();
            const pattern = safe.patternToRegex(key, undefined, true );
            const toRemove = [];
            for ( let i = 0, n = storage.length; i < n; i++ ) {
                const key = storage.key(i);
                if ( pattern.test(key) ) { toRemove.push(key); }
            }
            for ( const key of toRemove ) {
                storage.removeItem(key);
            }
        } else {
            storage.setItem(key, `${value}`);
        }
    } catch(ex) {
    }
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'matches-stack-trace.fn',
    fn: matchesStackTrace,
    dependencies: [
        'get-exception-token.fn',
        'safe-self.fn',
    ],
});
function matchesStackTrace(
    needleDetails,
    logLevel = 0
) {
    const safe = safeSelf();
    const exceptionToken = getExceptionToken();
    const error = new safe.Error(exceptionToken);
    const docURL = new URL(self.location.href);
    docURL.hash = '';
    // Normalize stack trace
    const reLine = /(.*?@)?(\S+)(:\d+):\d+\)?$/;
    const lines = [];
    for ( let line of error.stack.split(/[\n\r]+/) ) {
        if ( line.includes(exceptionToken) ) { continue; }
        line = line.trim();
        const match = safe.RegExp_exec.call(reLine, line);
        if ( match === null ) { continue; }
        let url = match[2];
        if ( url.startsWith('(') ) { url = url.slice(1); }
        if ( url === docURL.href ) {
            url = 'inlineScript';
        } else if ( url.startsWith('<anonymous>') ) {
            url = 'injectedScript';
        }
        let fn = match[1] !== undefined
            ? match[1].slice(0, -1)
            : line.slice(0, match.index).trim();
        if ( fn.startsWith('at') ) { fn = fn.slice(2).trim(); }
        let rowcol = match[3];
        lines.push(' ' + `${fn} ${url}${rowcol}:1`.trim());
    }
    lines[0] = `stackDepth:${lines.length-1}`;
    const stack = lines.join('\t');
    const r = safe.testPattern(needleDetails, stack);
    if (
        logLevel === 1 ||
        logLevel === 2 && r ||
        logLevel === 3 && !r
    ) {
        safe.uboLog(stack.replace(/\t/g, '\n'));
    }
    return r;
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'parse-properties-to-match.fn',
    fn: parsePropertiesToMatch,
    dependencies: [
        'safe-self.fn',
    ],
});
function parsePropertiesToMatch(propsToMatch, implicit = '') {
    const safe = safeSelf();
    const needles = new Map();
    if ( propsToMatch === undefined || propsToMatch === '' ) { return needles; }
    const options = { canNegate: true };
    for ( const needle of propsToMatch.split(/\s+/) ) {
        const [ prop, pattern ] = needle.split(':');
        if ( prop === '' ) { continue; }
        if ( pattern !== undefined ) {
            needles.set(prop, safe.initPattern(pattern, options));
        } else if ( implicit !== '' ) {
            needles.set(implicit, safe.initPattern(prop, options));
        }
    }
    return needles;
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'match-object-properties.fn',
    fn: matchObjectProperties,
    dependencies: [
        'safe-self.fn',
    ],
});
function matchObjectProperties(propNeedles, ...objs) {
    if ( matchObjectProperties.extractProperties === undefined ) {
        matchObjectProperties.extractProperties = (src, des, props) => {
            for ( const p of props ) {
                const v = src[p];
                if ( v === undefined ) { continue; }
                des[p] = src[p];
            }
        };
    }
    const safe = safeSelf();
    const haystack = {};
    const props = safe.Array_from(propNeedles.keys());
    for ( const obj of objs ) {
        if ( obj instanceof Object === false ) { continue; }
        matchObjectProperties.extractProperties(obj, haystack, props);
    }
    for ( const [ prop, details ] of propNeedles ) {
        let value = haystack[prop];
        if ( value === undefined ) { continue; }
        if ( typeof value !== 'string' ) {
            try { value = JSON.stringify(value); }
            catch(ex) { }
            if ( typeof value !== 'string' ) { continue; }
        }
        if ( safe.testPattern(details, value) ) { continue; }
        return false;
    }
    return true;
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'json-prune-fetch-response.fn',
    fn: jsonPruneFetchResponseFn,
    dependencies: [
        'match-object-properties.fn',
        'object-prune.fn',
        'parse-properties-to-match.fn',
        'safe-self.fn',
        'should-log.fn',
    ],
});
function jsonPruneFetchResponseFn(
    rawPrunePaths = '',
    rawNeedlePaths = ''
) {
    const safe = safeSelf();
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 2);
    const logLevel = shouldLog({ log: rawPrunePaths === '' || extraArgs.log, });
    const log = logLevel ? ((...args) => { safe.uboLog(...args); }) : (( ) => { }); 
    const propNeedles = parsePropertiesToMatch(extraArgs.propsToMatch, 'url');
    const stackNeedle = safe.initPattern(extraArgs.stackToMatch || '', { canNegate: true });
    const applyHandler = function(target, thisArg, args) {
        const fetchPromise = Reflect.apply(target, thisArg, args);
        if ( logLevel === true ) {
            log('json-prune-fetch-response:', JSON.stringify(Array.from(args)).slice(1,-1));
        }
        if ( rawPrunePaths === '' ) { return fetchPromise; }
        let outcome = 'match';
        if ( propNeedles.size !== 0 ) {
            const objs = [ args[0] instanceof Object ? args[0] : { url: args[0] } ];
            if ( objs[0] instanceof Request ) {
                try { objs[0] = safe.Request_clone.call(objs[0]); }
                catch(ex) { log(ex); }
            }
            if ( args[1] instanceof Object ) {
                objs.push(args[1]);
            }
            if ( matchObjectProperties(propNeedles, ...objs) === false ) {
                outcome = 'nomatch';
            }
            if ( outcome === logLevel || logLevel === 'all' ) {
                log(
                    `json-prune-fetch-response (${outcome})`,
                    `\n\tfetchPropsToMatch: ${JSON.stringify(Array.from(propNeedles)).slice(1,-1)}`,
                    '\n\tprops:', ...objs,
                );
            }
        }
        if ( outcome === 'nomatch' ) { return fetchPromise; }
        return fetchPromise.then(responseBefore => {
            const response = responseBefore.clone();
            return response.json().then(objBefore => {
                if ( typeof objBefore !== 'object' ) { return responseBefore; }
                const objAfter = objectPruneFn(
                    objBefore,
                    rawPrunePaths,
                    rawNeedlePaths,
                    stackNeedle,
                    extraArgs
                );
                if ( typeof objAfter !== 'object' ) { return responseBefore; }
                const responseAfter = Response.json(objAfter, {
                    status: responseBefore.status,
                    statusText: responseBefore.statusText,
                    headers: responseBefore.headers,
                });
                Object.defineProperties(responseAfter, {
                    ok: { value: responseBefore.ok },
                    redirected: { value: responseBefore.redirected },
                    type: { value: responseBefore.type },
                    url: { value: responseBefore.url },
                });
                return responseAfter;
            }).catch(reason => {
                log('json-prune-fetch-response:', reason);
                return responseBefore;
            });
        }).catch(reason => {
            log('json-prune-fetch-response:', reason);
            return fetchPromise;
        });
    };
    self.fetch = new Proxy(self.fetch, {
        apply: applyHandler
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'replace-fetch-response.fn',
    fn: replaceFetchResponseFn,
    dependencies: [
        'match-object-properties.fn',
        'parse-properties-to-match.fn',
        'safe-self.fn',
        'should-log.fn',
    ],
});
function replaceFetchResponseFn(
    trusted = false,
    pattern = '',
    replacement = '',
    propsToMatch = ''
) {
    if ( trusted !== true ) { return; }
    const safe = safeSelf();
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 4);
    const logLevel = shouldLog({
        log: pattern === '' || extraArgs.log,
    });
    const log = logLevel ? ((...args) => { safe.uboLog(...args); }) : (( ) => { }); 
    if ( pattern === '*' ) { pattern = '.*'; }
    const rePattern = safe.patternToRegex(pattern);
    const propNeedles = parsePropertiesToMatch(propsToMatch, 'url');
    self.fetch = new Proxy(self.fetch, {
        apply: function(target, thisArg, args) {
            if ( logLevel === true ) {
                log('replace-fetch-response:', JSON.stringify(Array.from(args)).slice(1,-1));
            }
            const fetchPromise = Reflect.apply(target, thisArg, args);
            if ( pattern === '' ) { return fetchPromise; }
            let outcome = 'match';
            if ( propNeedles.size !== 0 ) {
                const objs = [ args[0] instanceof Object ? args[0] : { url: args[0] } ];
                if ( objs[0] instanceof Request ) {
                    try { objs[0] = safe.Request_clone.call(objs[0]); }
                    catch(ex) { log(ex); }
                }
                if ( args[1] instanceof Object ) {
                    objs.push(args[1]);
                }
                if ( matchObjectProperties(propNeedles, ...objs) === false ) {
                    outcome = 'nomatch';
                }
                if ( outcome === logLevel || logLevel === 'all' ) {
                    log(
                        `replace-fetch-response (${outcome})`,
                        `\n\tpropsToMatch: ${JSON.stringify(Array.from(propNeedles)).slice(1,-1)}`,
                        '\n\tprops:', ...args,
                    );
                }
            }
            if ( outcome === 'nomatch' ) { return fetchPromise; }
            return fetchPromise.then(responseBefore => {
                const response = responseBefore.clone();
                return response.text().then(textBefore => {
                    const textAfter = textBefore.replace(rePattern, replacement);
                    const outcome = textAfter !== textBefore ? 'match' : 'nomatch';
                    if ( outcome === logLevel || logLevel === 'all' ) {
                        log(
                            `replace-fetch-response (${outcome})`,
                            `\n\tpattern: ${pattern}`, 
                            `\n\treplacement: ${replacement}`,
                        );
                    }
                    if ( outcome === 'nomatch' ) { return responseBefore; }
                    const responseAfter = new Response(textAfter, {
                        status: responseBefore.status,
                        statusText: responseBefore.statusText,
                        headers: responseBefore.headers,
                    });
                    Object.defineProperties(responseAfter, {
                        ok: { value: responseBefore.ok },
                        redirected: { value: responseBefore.redirected },
                        type: { value: responseBefore.type },
                        url: { value: responseBefore.url },
                    });
                    return responseAfter;
                }).catch(reason => {
                    log('replace-fetch-response:', reason);
                    return responseBefore;
                });
            }).catch(reason => {
                log('replace-fetch-response:', reason);
                return fetchPromise;
            });
        }
    });
}


/*******************************************************************************

    Injectable scriptlets

    These are meant to be used in the MAIN (webpage) execution world.

*******************************************************************************/

builtinScriptlets.push({
    name: 'abort-current-script.js',
    aliases: [
        'acs.js',
        'abort-current-inline-script.js',
        'acis.js',
    ],
    fn: abortCurrentScript,
    dependencies: [
        'abort-current-script-core.fn',
        'run-at-html-element.fn',
    ],
});
// Issues to mind before changing anything:
//  https://github.com/uBlockOrigin/uBlock-issues/issues/2154
function abortCurrentScript(...args) {
    runAtHtmlElementFn(( ) => {
        abortCurrentScriptCore(...args);
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'abort-on-property-read.js',
    aliases: [
        'aopr.js',
    ],
    fn: abortOnPropertyRead,
    dependencies: [
        'get-exception-token.fn',
    ],
});
function abortOnPropertyRead(
    chain = ''
) {
    if ( typeof chain !== 'string' ) { return; }
    if ( chain === '' ) { return; }
    const exceptionToken = getExceptionToken();
    const abort = function() {
        throw new ReferenceError(exceptionToken);
    };
    const makeProxy = function(owner, chain) {
        const pos = chain.indexOf('.');
        if ( pos === -1 ) {
            const desc = Object.getOwnPropertyDescriptor(owner, chain);
            if ( !desc || desc.get !== abort ) {
                Object.defineProperty(owner, chain, {
                    get: abort,
                    set: function(){}
                });
            }
            return;
        }
        const prop = chain.slice(0, pos);
        let v = owner[prop];
        chain = chain.slice(pos + 1);
        if ( v ) {
            makeProxy(v, chain);
            return;
        }
        const desc = Object.getOwnPropertyDescriptor(owner, prop);
        if ( desc && desc.set !== undefined ) { return; }
        Object.defineProperty(owner, prop, {
            get: function() { return v; },
            set: function(a) {
                v = a;
                if ( a instanceof Object ) {
                    makeProxy(a, chain);
                }
            }
        });
    };
    const owner = window;
    makeProxy(owner, chain);
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'abort-on-property-write.js',
    aliases: [
        'aopw.js',
    ],
    fn: abortOnPropertyWrite,
    dependencies: [
        'get-exception-token.fn',
    ],
});
function abortOnPropertyWrite(
    prop = ''
) {
    if ( typeof prop !== 'string' ) { return; }
    if ( prop === '' ) { return; }
    const exceptionToken = getExceptionToken();
    let owner = window;
    for (;;) {
        const pos = prop.indexOf('.');
        if ( pos === -1 ) { break; }
        owner = owner[prop.slice(0, pos)];
        if ( owner instanceof Object === false ) { return; }
        prop = prop.slice(pos + 1);
    }
    delete owner[prop];
    Object.defineProperty(owner, prop, {
        set: function() {
            throw new ReferenceError(exceptionToken);
        }
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'abort-on-stack-trace.js',
    aliases: [
        'aost.js',
    ],
    fn: abortOnStackTrace,
    dependencies: [
        'get-exception-token.fn',
        'matches-stack-trace.fn',
        'safe-self.fn',
    ],
});
function abortOnStackTrace(
    chain = '',
    needle = ''
) {
    if ( typeof chain !== 'string' ) { return; }
    const safe = safeSelf();
    const needleDetails = safe.initPattern(needle, { canNegate: true });
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 2);
    const makeProxy = function(owner, chain) {
        const pos = chain.indexOf('.');
        if ( pos === -1 ) {
            let v = owner[chain];
            Object.defineProperty(owner, chain, {
                get: function() {
                    if ( matchesStackTrace(needleDetails, extraArgs.log) ) {
                        throw new ReferenceError(getExceptionToken());
                    }
                    return v;
                },
                set: function(a) {
                    if ( matchesStackTrace(needleDetails, extraArgs.log) ) {
                        throw new ReferenceError(getExceptionToken());
                    }
                    v = a;
                },
            });
            return;
        }
        const prop = chain.slice(0, pos);
        let v = owner[prop];
        chain = chain.slice(pos + 1);
        if ( v ) {
            makeProxy(v, chain);
            return;
        }
        const desc = Object.getOwnPropertyDescriptor(owner, prop);
        if ( desc && desc.set !== undefined ) { return; }
        Object.defineProperty(owner, prop, {
            get: function() { return v; },
            set: function(a) {
                v = a;
                if ( a instanceof Object ) {
                    makeProxy(a, chain);
                }
            }
        });
    };
    const owner = window;
    makeProxy(owner, chain);
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'addEventListener-defuser.js',
    aliases: [
        'aeld.js',
        'prevent-addEventListener.js',
    ],
    fn: addEventListenerDefuser,
    dependencies: [
        'run-at.fn',
        'safe-self.fn',
        'should-debug.fn',
        'should-log.fn',
    ],
});
// https://github.com/uBlockOrigin/uAssets/issues/9123#issuecomment-848255120
function addEventListenerDefuser(
    type = '',
    pattern = ''
) {
    const safe = safeSelf();
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 2);
    const reType = safe.patternToRegex(type, undefined, true);
    const rePattern = safe.patternToRegex(pattern);
    const log = shouldLog(extraArgs);
    const debug = shouldDebug(extraArgs);
    const trapEddEventListeners = ( ) => {
        const eventListenerHandler = {
            apply: function(target, thisArg, args) {
                let type, handler;
                try {
                    type = String(args[0]);
                    handler = String(args[1]);
                } catch(ex) {
                }
                const matchesType = safe.RegExp_test.call(reType, type);
                const matchesHandler = safe.RegExp_test.call(rePattern, handler);
                const matchesEither = matchesType || matchesHandler;
                const matchesBoth = matchesType && matchesHandler;
                if ( log === 1 && matchesBoth || log === 2 && matchesEither || log === 3 ) {
                    safe.uboLog(`addEventListener('${type}', ${handler})`);
                }
                if ( debug === 1 && matchesBoth || debug === 2 && matchesEither ) {
                    debugger; // jshint ignore:line
                }
                if ( matchesBoth ) { return; }
                return Reflect.apply(target, thisArg, args);
            },
            get(target, prop, receiver) {
                if ( prop === 'toString' ) {
                    return target.toString.bind(target);
                }
                return Reflect.get(target, prop, receiver);
            },
        };
        self.EventTarget.prototype.addEventListener = new Proxy(
            self.EventTarget.prototype.addEventListener,
            eventListenerHandler
        );
    };
    runAt(( ) => {
        trapEddEventListeners();
    }, extraArgs.runAt);
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'json-prune.js',
    fn: jsonPrune,
    dependencies: [
        'object-prune.fn',
        'safe-self.fn',
    ],
});
function jsonPrune(
    rawPrunePaths = '',
    rawNeedlePaths = '',
    stackNeedle = ''
) {
    const safe = safeSelf();
    const stackNeedleDetails = safe.initPattern(stackNeedle, { canNegate: true });
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 3);
    JSON.parse = new Proxy(JSON.parse, {
        apply: function(target, thisArg, args) {
            const objBefore = Reflect.apply(target, thisArg, args);
            const objAfter = objectPruneFn(
                objBefore,
                rawPrunePaths,
                rawNeedlePaths,
                stackNeedleDetails,
                extraArgs
           );
           return objAfter || objBefore;
        },
    });
}

/*******************************************************************************
 * 
 * json-prune-fetch-response.js
 * 
 * Prune JSON response of fetch requests.
 * 
 **/

builtinScriptlets.push({
    name: 'json-prune-fetch-response.js',
    fn: jsonPruneFetchResponse,
    dependencies: [
        'json-prune-fetch-response.fn',
    ],
});
function jsonPruneFetchResponse(...args) {
    jsonPruneFetchResponseFn(...args);
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'json-prune-xhr-response.js',
    fn: jsonPruneXhrResponse,
    dependencies: [
        'match-object-properties.fn',
        'object-prune.fn',
        'parse-properties-to-match.fn',
        'safe-self.fn',
        'should-log.fn',
    ],
});
function jsonPruneXhrResponse(
    rawPrunePaths = '',
    rawNeedlePaths = ''
) {
    const safe = safeSelf();
    const xhrInstances = new WeakMap();
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 2);
    const logLevel = shouldLog({ log: rawPrunePaths === '' || extraArgs.log, });
    const log = logLevel ? ((...args) => { safe.uboLog(...args); }) : (( ) => { }); 
    const propNeedles = parsePropertiesToMatch(extraArgs.propsToMatch, 'url');
    const stackNeedle = safe.initPattern(extraArgs.stackToMatch || '', { canNegate: true });
    self.XMLHttpRequest = class extends self.XMLHttpRequest {
        open(method, url, ...args) {
            const xhrDetails = { method, url };
            let outcome = 'match';
            if ( propNeedles.size !== 0 ) {
                if ( matchObjectProperties(propNeedles, xhrDetails) === false ) {
                    outcome = 'nomatch';
                }
            }
            if ( outcome === logLevel || outcome === 'all' ) {
                log(`xhr.open(${method}, ${url}, ${args.join(', ')})`);
            }
            if ( outcome === 'match' ) {
                xhrInstances.set(this, xhrDetails);
            }
            return super.open(method, url, ...args);
        }
        get response() {
            const innerResponse = super.response;
            const xhrDetails = xhrInstances.get(this);
            if ( xhrDetails === undefined ) {
                return innerResponse;
            }
            const responseLength = typeof innerResponse === 'string'
                ? innerResponse.length
                : undefined;
            if ( xhrDetails.lastResponseLength !== responseLength ) {
                xhrDetails.response = undefined;
                xhrDetails.lastResponseLength = responseLength;
            }
            if ( xhrDetails.response !== undefined ) {
                return xhrDetails.response;
            }
            let objBefore;
            if ( typeof innerResponse === 'object' ) {
                objBefore = innerResponse;
            } else if ( typeof innerResponse === 'string' ) {
                try { objBefore = safe.JSON_parse(innerResponse); }
                catch(ex) { }
            }
            if ( typeof objBefore !== 'object' ) {
                return (xhrDetails.response = innerResponse);
            }
            const objAfter = objectPruneFn(
                objBefore,
                rawPrunePaths,
                rawNeedlePaths,
                stackNeedle,
                extraArgs
            );
            let outerResponse;
            if ( typeof objAfter === 'object' ) {
                outerResponse = typeof innerResponse === 'string'
                    ? safe.JSON_stringify(objAfter)
                    : objAfter;
            } else {
                outerResponse = innerResponse;
            }
            return (xhrDetails.response = outerResponse);
        }
        get responseText() {
            const response = this.response;
            return typeof response !== 'string'
                ? super.responseText
                : response;
        }
    };
}

/******************************************************************************/

// There is still code out there which uses `eval` in lieu of `JSON.parse`.

builtinScriptlets.push({
    name: 'evaldata-prune.js',
    fn: evaldataPrune,
    dependencies: [
        'object-prune.fn',
    ],
});
function evaldataPrune(
    rawPrunePaths = '',
    rawNeedlePaths = ''
) {
    self.eval = new Proxy(self.eval, {
        apply(target, thisArg, args) {
            const before = Reflect.apply(target, thisArg, args);
            if ( typeof before === 'object' ) {
                const after = objectPruneFn(before, rawPrunePaths, rawNeedlePaths);
                return after || before;
            }
            return before;
        }
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'adjust-setInterval.js',
    aliases: [
        'nano-setInterval-booster.js',
        'nano-sib.js',
    ],
    fn: adjustSetInterval,
    dependencies: [
        'safe-self.fn',
    ],
});
// Imported from:
// https://github.com/NanoAdblocker/NanoFilters/blob/1f3be7211bb0809c5106996f52564bf10c4525f7/NanoFiltersSource/NanoResources.txt#L126
//
// Speed up or down setInterval, 3 optional arguments.
//      The payload matcher, a string literal or a JavaScript RegExp, defaults
//      to match all.
// delayMatcher
//      The delay matcher, an integer, defaults to 1000.
//      Use `*` to match any delay.
// boostRatio - The delay multiplier when there is a match, 0.5 speeds up by
//      2 times and 2 slows down by 2 times, defaults to 0.05 or speed up
//      20 times. Speed up and down both cap at 50 times.
function adjustSetInterval(
    needleArg = '',
    delayArg = '',
    boostArg = ''
) {
    if ( typeof needleArg !== 'string' ) { return; }
    const safe = safeSelf();
    const reNeedle = safe.patternToRegex(needleArg);
    let delay = delayArg !== '*' ? parseInt(delayArg, 10) : -1;
    if ( isNaN(delay) || isFinite(delay) === false ) { delay = 1000; }
    let boost = parseFloat(boostArg);
    boost = isNaN(boost) === false && isFinite(boost)
        ? Math.min(Math.max(boost, 0.001), 50)
        : 0.05;
    self.setInterval = new Proxy(self.setInterval, {
        apply: function(target, thisArg, args) {
            const [ a, b ] = args;
            if (
                (delay === -1 || b === delay) &&
                reNeedle.test(a.toString())
            ) {
                args[1] = b * boost;
            }
            return target.apply(thisArg, args);
        }
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'adjust-setTimeout.js',
    aliases: [
        'nano-setTimeout-booster.js',
        'nano-stb.js',
    ],
    fn: adjustSetTimeout,
    dependencies: [
        'safe-self.fn',
    ],
});
// Imported from:
// https://github.com/NanoAdblocker/NanoFilters/blob/1f3be7211bb0809c5106996f52564bf10c4525f7/NanoFiltersSource/NanoResources.txt#L82
//
// Speed up or down setTimeout, 3 optional arguments.
// funcMatcher
//      The payload matcher, a string literal or a JavaScript RegExp, defaults
//      to match all.
// delayMatcher
//      The delay matcher, an integer, defaults to 1000.
//      Use `*` to match any delay.
// boostRatio - The delay multiplier when there is a match, 0.5 speeds up by
//      2 times and 2 slows down by 2 times, defaults to 0.05 or speed up
//      20 times. Speed up and down both cap at 50 times.
function adjustSetTimeout(
    needleArg = '',
    delayArg = '',
    boostArg = ''
) {
    if ( typeof needleArg !== 'string' ) { return; }
    const safe = safeSelf();
    const reNeedle = safe.patternToRegex(needleArg);
    let delay = delayArg !== '*' ? parseInt(delayArg, 10) : -1;
    if ( isNaN(delay) || isFinite(delay) === false ) { delay = 1000; }
    let boost = parseFloat(boostArg);
    boost = isNaN(boost) === false && isFinite(boost)
        ? Math.min(Math.max(boost, 0.001), 50)
        : 0.05;
    self.setTimeout = new Proxy(self.setTimeout, {
        apply: function(target, thisArg, args) {
            const [ a, b ] = args;
            if (
                (delay === -1 || b === delay) &&
                reNeedle.test(a.toString())
            ) {
                args[1] = b * boost;
            }
            return target.apply(thisArg, args);
        }
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'noeval-if.js',
    aliases: [
        'prevent-eval-if.js',
    ],
    fn: noEvalIf,
    dependencies: [
        'safe-self.fn',
    ],
});
function noEvalIf(
    needle = ''
) {
    if ( typeof needle !== 'string' ) { return; }
    const safe = safeSelf();
    const reNeedle = safe.patternToRegex(needle);
    window.eval = new Proxy(window.eval, {  // jshint ignore: line
        apply: function(target, thisArg, args) {
            const a = args[0];
            if ( reNeedle.test(a.toString()) ) { return; }
            return target.apply(thisArg, args);
        }
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'no-fetch-if.js',
    aliases: [
        'prevent-fetch.js',
    ],
    fn: noFetchIf,
    dependencies: [
        'safe-self.fn',
    ],
});
function noFetchIf(
    arg1 = '',
) {
    if ( typeof arg1 !== 'string' ) { return; }
    const safe = safeSelf();
    const needles = [];
    for ( const condition of arg1.split(/\s+/) ) {
        if ( condition === '' ) { continue; }
        const pos = condition.indexOf(':');
        let key, value;
        if ( pos !== -1 ) {
            key = condition.slice(0, pos);
            value = condition.slice(pos + 1);
        } else {
            key = 'url';
            value = condition;
        }
        needles.push({ key, re: safe.patternToRegex(value) });
    }
    const log = needles.length === 0 ? console.log.bind(console) : undefined;
    self.fetch = new Proxy(self.fetch, {
        apply: function(target, thisArg, args) {
            let proceed = true;
            try {
                let details;
                if ( args[0] instanceof self.Request ) {
                    details = args[0];
                } else {
                    details = Object.assign({ url: args[0] }, args[1]);
                }
                const props = new Map();
                for ( const prop in details ) {
                    let v = details[prop];
                    if ( typeof v !== 'string' ) {
                        try { v = JSON.stringify(v); }
                        catch(ex) { }
                    }
                    if ( typeof v !== 'string' ) { continue; }
                    props.set(prop, v);
                }
                if ( log !== undefined ) {
                    const out = Array.from(props)
                                     .map(a => `${a[0]}:${a[1]}`)
                                     .join(' ');
                    log(`uBO: fetch(${out})`);
                }
                proceed = needles.length === 0;
                for ( const { key, re } of needles ) {
                    if (
                        props.has(key) === false ||
                        re.test(props.get(key)) === false
                    ) {
                        proceed = true;
                        break;
                    }
                }
            } catch(ex) {
            }
            return proceed
                ? Reflect.apply(target, thisArg, args)
                : Promise.resolve(new Response());
        }
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'prevent-refresh.js',
    aliases: [
        'refresh-defuser.js',
    ],
    fn: preventRefresh,
    world: 'ISOLATED',
    dependencies: [
        'run-at.fn',
    ],
});
// https://www.reddit.com/r/uBlockOrigin/comments/q0frv0/while_reading_a_sports_article_i_was_redirected/hf7wo9v/
function preventRefresh(
    arg1 = ''
) {
    if ( typeof arg1 !== 'string' ) { return; }
    const defuse = ( ) => {
        const meta = document.querySelector('meta[http-equiv="refresh" i][content]');
        if ( meta === null ) { return; }
        const s = arg1 === ''
            ? meta.getAttribute('content')
            : arg1;
        const ms = Math.max(parseFloat(s) || 0, 0) * 1000;
        setTimeout(( ) => { window.stop(); }, ms);
    };
    runAt(( ) => {
        defuse();
    }, 'interactive');
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'remove-attr.js',
    aliases: [
        'ra.js',
    ],
    fn: removeAttr,
    dependencies: [
        'run-at.fn',
    ],
});
function removeAttr(
    token = '',
    selector = '',
    behavior = ''
) {
    if ( typeof token !== 'string' ) { return; }
    if ( token === '' ) { return; }
    const tokens = token.split(/\s*\|\s*/);
    if ( selector === '' ) {
        selector = `[${tokens.join('],[')}]`;
    }
    let timer;
    const rmattr = ( ) => {
        timer = undefined;
        try {
            const nodes = document.querySelectorAll(selector);
            for ( const node of nodes ) {
                for ( const attr of tokens ) {
                    node.removeAttribute(attr);
                }
            }
        } catch(ex) {
        }
    };
    const mutationHandler = mutations => {
        if ( timer !== undefined ) { return; }
        let skip = true;
        for ( let i = 0; i < mutations.length && skip; i++ ) {
            const { type, addedNodes, removedNodes } = mutations[i];
            if ( type === 'attributes' ) { skip = false; }
            for ( let j = 0; j < addedNodes.length && skip; j++ ) {
                if ( addedNodes[j].nodeType === 1 ) { skip = false; break; }
            }
            for ( let j = 0; j < removedNodes.length && skip; j++ ) {
                if ( removedNodes[j].nodeType === 1 ) { skip = false; break; }
            }
        }
        if ( skip ) { return; }
        timer = self.requestIdleCallback(rmattr, { timeout: 17 });
    };
    const start = ( ) => {
        rmattr();
        if ( /\bstay\b/.test(behavior) === false ) { return; }
        const observer = new MutationObserver(mutationHandler);
        observer.observe(document, {
            attributes: true,
            attributeFilter: tokens,
            childList: true,
            subtree: true,
        });
    };
    runAt(( ) => {
        start();
    }, /\bcomplete\b/.test(behavior) ? 'idle' : 'interactive');
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'remove-class.js',
    aliases: [
        'rc.js',
    ],
    fn: removeClass,
    world: 'ISOLATED',
    dependencies: [
        'run-at.fn',
    ],
});
function removeClass(
    token = '',
    selector = '',
    behavior = ''
) {
    if ( typeof token !== 'string' ) { return; }
    if ( token === '' ) { return; }
    const classTokens = token.split(/\s*\|\s*/);
    if ( selector === '' ) {
        selector = '.' + classTokens.map(a => CSS.escape(a)).join(',.');
    }
    const mustStay = /\bstay\b/.test(behavior);
    let timer;
    const rmclass = function() {
        timer = undefined;
        try {
            const nodes = document.querySelectorAll(selector);
            for ( const node of nodes ) {
                node.classList.remove(...classTokens);
            }
        } catch(ex) {
        }
        if ( mustStay ) { return; }
        if ( document.readyState !== 'complete' ) { return; }
        observer.disconnect();
    };
    const mutationHandler = mutations => {
        if ( timer !== undefined ) { return; }
        let skip = true;
        for ( let i = 0; i < mutations.length && skip; i++ ) {
            const { type, addedNodes, removedNodes } = mutations[i];
            if ( type === 'attributes' ) { skip = false; }
            for ( let j = 0; j < addedNodes.length && skip; j++ ) {
                if ( addedNodes[j].nodeType === 1 ) { skip = false; break; }
            }
            for ( let j = 0; j < removedNodes.length && skip; j++ ) {
                if ( removedNodes[j].nodeType === 1 ) { skip = false; break; }
            }
        }
        if ( skip ) { return; }
        timer = self.requestIdleCallback(rmclass, { timeout: 67 });
    };
    const observer = new MutationObserver(mutationHandler);
    const start = ( ) => {
        rmclass();
        observer.observe(document, {
            attributes: true,
            attributeFilter: [ 'class' ],
            childList: true,
            subtree: true,
        });
    };
    runAt(( ) => {
        start();
    }, /\bcomplete\b/.test(behavior) ? 'idle' : 'loading');
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'no-requestAnimationFrame-if.js',
    aliases: [
        'norafif.js',
        'prevent-requestAnimationFrame.js',
    ],
    fn: noRequestAnimationFrameIf,
    dependencies: [
        'safe-self.fn',
    ],
});
function noRequestAnimationFrameIf(
    needle = ''
) {
    if ( typeof needle !== 'string' ) { return; }
    const safe = safeSelf();
    const needleNot = needle.charAt(0) === '!';
    if ( needleNot ) { needle = needle.slice(1); }
    const log = needleNot === false && needle === '' ? console.log : undefined;
    const reNeedle = safe.patternToRegex(needle);
    window.requestAnimationFrame = new Proxy(window.requestAnimationFrame, {
        apply: function(target, thisArg, args) {
            const a = String(args[0]);
            let defuse = false;
            if ( log !== undefined ) {
                log('uBO: requestAnimationFrame("%s")', a);
            } else {
                defuse = reNeedle.test(a) !== needleNot;
            }
            if ( defuse ) {
                args[0] = function(){};
            }
            return target.apply(thisArg, args);
        }
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'set-constant.js',
    aliases: [
        'set.js',
    ],
    fn: setConstant,
    dependencies: [
        'set-constant-core.fn'
    ],
});
function setConstant(
    ...args
) {
    setConstantCore(false, ...args);
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'no-setInterval-if.js',
    aliases: [
        'nosiif.js',
        'prevent-setInterval.js',
        'setInterval-defuser.js',
    ],
    fn: noSetIntervalIf,
    dependencies: [
        'safe-self.fn',
    ],
});
function noSetIntervalIf(
    needle = '',
    delay = ''
) {
    if ( typeof needle !== 'string' ) { return; }
    const safe = safeSelf();
    const needleNot = needle.charAt(0) === '!';
    if ( needleNot ) { needle = needle.slice(1); }
    if ( delay === '' ) { delay = undefined; }
    let delayNot = false;
    if ( delay !== undefined ) {
        delayNot = delay.charAt(0) === '!';
        if ( delayNot ) { delay = delay.slice(1); }
        delay = parseInt(delay, 10);
    }
    const log = needleNot === false && needle === '' && delay === undefined
        ? console.log
        : undefined;
    const reNeedle = safe.patternToRegex(needle);
    self.setInterval = new Proxy(self.setInterval, {
        apply: function(target, thisArg, args) {
            const a = String(args[0]);
            const b = args[1];
            if ( log !== undefined ) {
                log('uBO: setInterval("%s", %s)', a, b);
            } else {
                let defuse;
                if ( needle !== '' ) {
                    defuse = reNeedle.test(a) !== needleNot;
                }
                if ( defuse !== false && delay !== undefined ) {
                    defuse = (b === delay || isNaN(b) && isNaN(delay) ) !== delayNot;
                }
                if ( defuse ) {
                    args[0] = function(){};
                }
            }
            return Reflect.apply(target, thisArg, args);
        },
        get(target, prop, receiver) {
            if ( prop === 'toString' ) {
                return target.toString.bind(target);
            }
            return Reflect.get(target, prop, receiver);
        },
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'no-setTimeout-if.js',
    aliases: [
        'nostif.js',
        'prevent-setTimeout.js',
        'setTimeout-defuser.js',
    ],
    fn: noSetTimeoutIf,
    dependencies: [
        'safe-self.fn',
    ],
});
function noSetTimeoutIf(
    needle = '',
    delay = ''
) {
    if ( typeof needle !== 'string' ) { return; }
    const safe = safeSelf();
    const needleNot = needle.charAt(0) === '!';
    if ( needleNot ) { needle = needle.slice(1); }
    if ( delay === '' ) { delay = undefined; }
    let delayNot = false;
    if ( delay !== undefined ) {
        delayNot = delay.charAt(0) === '!';
        if ( delayNot ) { delay = delay.slice(1); }
        delay = parseInt(delay, 10);
    }
    const log = needleNot === false && needle === '' && delay === undefined
        ? console.log
        : undefined;
    const reNeedle = safe.patternToRegex(needle);
    self.setTimeout = new Proxy(self.setTimeout, {
        apply: function(target, thisArg, args) {
            const a = String(args[0]);
            const b = args[1];
            if ( log !== undefined ) {
                log('uBO: setTimeout("%s", %s)', a, b);
            } else {
                let defuse;
                if ( needle !== '' ) {
                    defuse = reNeedle.test(a) !== needleNot;
                }
                if ( defuse !== false && delay !== undefined ) {
                    defuse = (b === delay || isNaN(b) && isNaN(delay) ) !== delayNot;
                }
                if ( defuse ) {
                    args[0] = function(){};
                }
            }
            return Reflect.apply(target, thisArg, args);
        },
        get(target, prop, receiver) {
            if ( prop === 'toString' ) {
                return target.toString.bind(target);
            }
            return Reflect.get(target, prop, receiver);
        },
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'webrtc-if.js',
    fn: webrtcIf,
    dependencies: [
        'safe-self.fn',
    ],
});
function webrtcIf(
    good = ''
) {
    if ( typeof good !== 'string' ) { return; }
    const safe = safeSelf();
    const reGood = safe.patternToRegex(good);
    const rtcName = window.RTCPeerConnection
        ? 'RTCPeerConnection'
        : (window.webkitRTCPeerConnection ? 'webkitRTCPeerConnection' : '');
    if ( rtcName === '' ) { return; }
    const log = console.log.bind(console);
    const neuteredPeerConnections = new WeakSet();
    const isGoodConfig = function(instance, config) {
        if ( neuteredPeerConnections.has(instance) ) { return false; }
        if ( config instanceof Object === false ) { return true; }
        if ( Array.isArray(config.iceServers) === false ) { return true; }
        for ( const server of config.iceServers ) {
            const urls = typeof server.urls === 'string'
                ? [ server.urls ]
                : server.urls;
            if ( Array.isArray(urls) ) {
                for ( const url of urls ) {
                    if ( reGood.test(url) ) { return true; }
                }
            }
            if ( typeof server.username === 'string' ) {
                if ( reGood.test(server.username) ) { return true; }
            }
            if ( typeof server.credential === 'string' ) {
                if ( reGood.test(server.credential) ) { return true; }
            }
        }
        neuteredPeerConnections.add(instance);
        return false;
    };
    const peerConnectionCtor = window[rtcName];
    const peerConnectionProto = peerConnectionCtor.prototype;
    peerConnectionProto.createDataChannel =
        new Proxy(peerConnectionProto.createDataChannel, {
            apply: function(target, thisArg, args) {
                if ( isGoodConfig(target, args[1]) === false ) {
                    log('uBO:', args[1]);
                    return Reflect.apply(target, thisArg, args.slice(0, 1));
                }
                return Reflect.apply(target, thisArg, args);
            },
        });
    window[rtcName] =
        new Proxy(peerConnectionCtor, {
            construct: function(target, args) {
                if ( isGoodConfig(target, args[0]) === false ) {
                    log('uBO:', args[0]);
                    return Reflect.construct(target);
                }
                return Reflect.construct(target, args);
            }
        });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'no-xhr-if.js',
    aliases: [
        'prevent-xhr.js',
    ],
    fn: noXhrIf,
    dependencies: [
        'match-object-properties.fn',
        'parse-properties-to-match.fn',
        'safe-self.fn',
    ],
});
function noXhrIf(
    propsToMatch = '',
    directive = ''
) {
    if ( typeof propsToMatch !== 'string' ) { return; }
    const safe = safeSelf();
    const xhrInstances = new WeakMap();
    const propNeedles = parsePropertiesToMatch(propsToMatch, 'url');
    const log = propNeedles.size === 0 ? console.log.bind(console) : undefined;
    const warOrigin = scriptletGlobals.get('warOrigin');
    const generateRandomString = len => {
            let s = '';
            do { s += safe.Math_random().toString(36).slice(2); }
            while ( s.length < 10 );
            return s.slice(0, len);
    };
    const generateContent = async directive => {
        if ( directive === 'true' ) {
            return generateRandomString(10);
        }
        if ( directive.startsWith('war:') ) {
            if ( warOrigin === undefined ) { return ''; }
            return new Promise(resolve => {
                const warName = directive.slice(4);
                const fullpath = [ warOrigin, '/', warName ];
                const warSecret = scriptletGlobals.get('warSecret');
                if ( warSecret !== undefined ) {
                    fullpath.push('?secret=', warSecret);
                }
                const warXHR = new safe.XMLHttpRequest();
                warXHR.responseType = 'text';
                warXHR.onloadend = ev => {
                    resolve(ev.target.responseText || '');
                };
                warXHR.open('GET', fullpath.join(''));
                warXHR.send();
            });
        }
        return '';
    };
    self.XMLHttpRequest = class extends self.XMLHttpRequest {
        open(method, url, ...args) {
            if ( log !== undefined ) {
                log(`uBO: xhr.open(${method}, ${url}, ${args.join(', ')})`);
                return super.open(method, url, ...args);
            }
            if ( warOrigin !== undefined && url.startsWith(warOrigin) ) {
                return super.open(method, url, ...args);
            }
            const haystack = { method, url };
            if ( matchObjectProperties(propNeedles, haystack) ) {
                xhrInstances.set(this, haystack);
            }
            return super.open(method, url, ...args);
        }
        send(...args) {
            const haystack = xhrInstances.get(this);
            if ( haystack === undefined ) {
                return super.send(...args);
            }
            let promise = Promise.resolve({
                xhr: this,
                directive,
                props: {
                    readyState: { value: 4 },
                    response: { value: '' },
                    responseText: { value: '' },
                    responseXML: { value: null },
                    responseURL: { value: haystack.url },
                    status: { value: 200 },
                    statusText: { value: 'OK' },
                },
            });
            switch ( this.responseType ) {
                case 'arraybuffer':
                    promise = promise.then(details => {
                        details.props.response.value = new ArrayBuffer(0);
                        return details;
                    });
                    break;
                case 'blob':
                    promise = promise.then(details => {
                        details.props.response.value = new Blob([]);
                        return details;
                    });
                    break;
                case 'document': {
                    promise = promise.then(details => {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString('', 'text/html');
                        details.props.response.value = doc;
                        details.props.responseXML.value = doc;
                        return details;
                    });
                    break;
                }
                case 'json':
                    promise = promise.then(details => {
                        details.props.response.value = {};
                        details.props.responseText.value = '{}';
                        return details;
                    });
                    break;
                default:
                    if ( directive === '' ) { break; }
                    promise = promise.then(details => {
                        return generateContent(details.directive).then(text => {
                            details.props.response.value = text;
                            details.props.responseText.value = text;
                            return details;
                        });
                    });
                    break;
            }
            promise.then(details => {
                Object.defineProperties(details.xhr, details.props);
                details.xhr.dispatchEvent(new Event('readystatechange'));
                details.xhr.dispatchEvent(new Event('load'));
                details.xhr.dispatchEvent(new Event('loadend'));
            });
        }
    };
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'no-window-open-if.js',
    aliases: [
        'nowoif.js',
        'prevent-window-open.js',
        'window.open-defuser.js',
    ],
    fn: noWindowOpenIf,
    dependencies: [
        'safe-self.fn',
        'should-log.fn',
    ],
});
function noWindowOpenIf(
    pattern = '',
    delay = '',
    decoy = ''
) {
    const safe = safeSelf();
    const targetMatchResult = pattern.startsWith('!') === false;
    if ( targetMatchResult === false ) {
        pattern = pattern.slice(1);
    }
    const rePattern = safe.patternToRegex(pattern);
    let autoRemoveAfter = parseInt(delay);
    if ( isNaN(autoRemoveAfter) ) {
        autoRemoveAfter = -1;
    }
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 3);
    const logLevel = shouldLog(extraArgs);
    const createDecoy = function(tag, urlProp, url) {
        const decoyElem = document.createElement(tag);
        decoyElem[urlProp] = url;
        decoyElem.style.setProperty('height','1px', 'important');
        decoyElem.style.setProperty('position','fixed', 'important');
        decoyElem.style.setProperty('top','-1px', 'important');
        decoyElem.style.setProperty('width','1px', 'important');
        document.body.appendChild(decoyElem);
        setTimeout(( ) => { decoyElem.remove(); }, autoRemoveAfter * 1000);
        return decoyElem;
    };
    window.open = new Proxy(window.open, {
        apply: function(target, thisArg, args) {
            const haystack = args.join(' ');
            if ( logLevel ) {
                safe.uboLog('window.open:', haystack);
            }
            if ( rePattern.test(haystack) !== targetMatchResult ) {
                return Reflect.apply(target, thisArg, args);
            }
            if ( autoRemoveAfter < 0 ) { return null; }
            const decoyElem = decoy === 'obj'
                ? createDecoy('object', 'data', ...args)
                : createDecoy('iframe', 'src', ...args);
            let popup = decoyElem.contentWindow;
            if ( typeof popup === 'object' && popup !== null ) {
                Object.defineProperty(popup, 'closed', { value: false });
            } else {
                const noopFunc = (function(){}).bind(self);
                popup = new Proxy(self, {
                    get: function(target, prop) {
                        if ( prop === 'closed' ) { return false; }
                        const r = Reflect.get(...arguments);
                        if ( typeof r === 'function' ) { return noopFunc; }
                        return target[prop];
                    },
                    set: function() {
                        return Reflect.set(...arguments);
                    },
                });
            }
            if ( logLevel ) {
                popup = new Proxy(popup, {
                    get: function(target, prop) {
                        safe.uboLog('window.open / get', prop, '===', target[prop]);
                        return Reflect.get(...arguments);
                    },
                    set: function(target, prop, value) {
                        safe.uboLog('window.open / set', prop, '=', value);
                        return Reflect.set(...arguments);
                    },
                });
            }
            return popup;
        }
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'close-window.js',
    aliases: [
        'window-close-if.js',
    ],
    fn: closeWindow,
    world: 'ISOLATED',
    dependencies: [
        'safe-self.fn',
    ],
});
// https://github.com/uBlockOrigin/uAssets/issues/10323#issuecomment-992312847
// https://github.com/AdguardTeam/Scriptlets/issues/158
// https://github.com/uBlockOrigin/uBlock-issues/discussions/2270
function closeWindow(
    arg1 = ''
) {
    if ( typeof arg1 !== 'string' ) { return; }
    const safe = safeSelf();
    let subject = '';
    if ( /^\/.*\/$/.test(arg1) ) {
        subject = window.location.href;
    } else if ( arg1 !== '' ) {
        subject = `${window.location.pathname}${window.location.search}`;
    }
    try {
        const re = safe.patternToRegex(arg1);
        if ( re.test(subject) ) {
            window.close();
        }
    } catch(ex) {
        console.log(ex);
    }
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'window.name-defuser.js',
    fn: windowNameDefuser,
});
// https://github.com/gorhill/uBlock/issues/1228
function windowNameDefuser() {
    if ( window === window.top ) {
        window.name = '';
    }
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'overlay-buster.js',
    fn: overlayBuster,
});
// Experimental: Generic nuisance overlay buster.
// if this works well and proves to be useful, this may end up
// as a stock tool in uBO's popup panel.
function overlayBuster() {
    if ( window !== window.top ) { return; }
    var tstart;
    var ttl = 30000;
    var delay = 0;
    var delayStep = 50;
    var buster = function() {
        var docEl = document.documentElement,
            bodyEl = document.body,
            vw = Math.min(docEl.clientWidth, window.innerWidth),
            vh = Math.min(docEl.clientHeight, window.innerHeight),
            tol = Math.min(vw, vh) * 0.05,
            el = document.elementFromPoint(vw/2, vh/2),
            style, rect;
        for (;;) {
            if ( el === null || el.parentNode === null || el === bodyEl ) {
                break;
            }
            style = window.getComputedStyle(el);
            if ( parseInt(style.zIndex, 10) >= 1000 || style.position === 'fixed' ) {
                rect = el.getBoundingClientRect();
                if ( rect.left <= tol && rect.top <= tol && (vw - rect.right) <= tol && (vh - rect.bottom) < tol ) {
                    el.parentNode.removeChild(el);
                    tstart = Date.now();
                    el = document.elementFromPoint(vw/2, vh/2);
                    bodyEl.style.setProperty('overflow', 'auto', 'important');
                    docEl.style.setProperty('overflow', 'auto', 'important');
                    continue;
                }
            }
            el = el.parentNode;
        }
        if ( (Date.now() - tstart) < ttl ) {
            delay = Math.min(delay + delayStep, 1000);
            setTimeout(buster, delay);
        }
    };
    var domReady = function(ev) {
        if ( ev ) {
            document.removeEventListener(ev.type, domReady);
        }
        tstart = Date.now();
        setTimeout(buster, delay);
    };
    if ( document.readyState === 'loading' ) {
        document.addEventListener('DOMContentLoaded', domReady);
    } else {
        domReady();
    }
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'alert-buster.js',
    fn: alertBuster,
});
// https://github.com/uBlockOrigin/uAssets/issues/8
function alertBuster() {
    window.alert = new Proxy(window.alert, {
        apply: function(a) {
            console.info(a);
        },
        get(target, prop, receiver) {
            if ( prop === 'toString' ) {
                return target.toString.bind(target);
            }
            return Reflect.get(target, prop, receiver);
        },
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'nowebrtc.js',
    fn: noWebrtc,
});
// Prevent web pages from using RTCPeerConnection(), and report attempts in console.
function noWebrtc() {
    var rtcName = window.RTCPeerConnection ? 'RTCPeerConnection' : (
        window.webkitRTCPeerConnection ? 'webkitRTCPeerConnection' : ''
    );
    if ( rtcName === '' ) { return; }
    var log = console.log.bind(console);
    var pc = function(cfg) {
        log('Document tried to create an RTCPeerConnection: %o', cfg);
    };
    const noop = function() {
    };
    pc.prototype = {
        close: noop,
        createDataChannel: noop,
        createOffer: noop,
        setRemoteDescription: noop,
        toString: function() {
            return '[object RTCPeerConnection]';
        }
    };
    var z = window[rtcName];
    window[rtcName] = pc.bind(window);
    if ( z.prototype ) {
        z.prototype.createDataChannel = function() {
            return {
                close: function() {},
                send: function() {}
            };
        }.bind(null);
    }
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'golem.de.js',
    fn: golemDe,
});
// https://github.com/uBlockOrigin/uAssets/issues/88
function golemDe() {
    const rael = window.addEventListener;
    window.addEventListener = function(a, b) {
        rael(...arguments);
        let haystack;
        try {
            haystack = b.toString();
        } catch(ex) {
        }
        if (
            typeof haystack === 'string' &&
            /^\s*function\s*\(\)\s*\{\s*window\.clearTimeout\(r\)\s*\}\s*$/.test(haystack)
        ) {
            b();
        }
    }.bind(window);
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'disable-newtab-links.js',
    fn: disableNewtabLinks,
});
// https://github.com/uBlockOrigin/uAssets/issues/913
function disableNewtabLinks() {
    document.addEventListener('click', function(ev) {
        var target = ev.target;
        while ( target !== null ) {
            if ( target.localName === 'a' && target.hasAttribute('target') ) {
                ev.stopPropagation();
                ev.preventDefault();
                break;
            }
            target = target.parentNode;
        }
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'cookie-remover.js',
    aliases: [
        'remove-cookie.js',
    ],
    fn: cookieRemover,
    world: 'ISOLATED',
    dependencies: [
        'safe-self.fn',
    ],
});
// https://github.com/NanoAdblocker/NanoFilters/issues/149
function cookieRemover(
    needle = ''
) {
    if ( typeof needle !== 'string' ) { return; }
    const safe = safeSelf();
    const reName = safe.patternToRegex(needle);
    const removeCookie = function() {
        document.cookie.split(';').forEach(cookieStr => {
            let pos = cookieStr.indexOf('=');
            if ( pos === -1 ) { return; }
            let cookieName = cookieStr.slice(0, pos).trim();
            if ( !reName.test(cookieName) ) { return; }
            let part1 = cookieName + '=';
            let part2a = '; domain=' + document.location.hostname;
            let part2b = '; domain=.' + document.location.hostname;
            let part2c, part2d;
            let domain = document.domain;
            if ( domain ) {
                if ( domain !== document.location.hostname ) {
                    part2c = '; domain=.' + domain;
                }
                if ( domain.startsWith('www.') ) {
                    part2d = '; domain=' + domain.replace('www', '');
                }
            }
            let part3 = '; path=/';
            let part4 = '; Max-Age=-1000; expires=Thu, 01 Jan 1970 00:00:00 GMT';
            document.cookie = part1 + part4;
            document.cookie = part1 + part2a + part4;
            document.cookie = part1 + part2b + part4;
            document.cookie = part1 + part3 + part4;
            document.cookie = part1 + part2a + part3 + part4;
            document.cookie = part1 + part2b + part3 + part4;
            if ( part2c !== undefined ) {
                document.cookie = part1 + part2c + part3 + part4;
            }
            if ( part2d !== undefined ) {
                document.cookie = part1 + part2d + part3 + part4;
            }
        });
    };
    removeCookie();
    window.addEventListener('beforeunload', removeCookie);
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'xml-prune.js',
    fn: xmlPrune,
    dependencies: [
        'safe-self.fn',
        'should-log.fn',
    ],
});
function xmlPrune(
    selector = '',
    selectorCheck = '',
    urlPattern = ''
) {
    if ( typeof selector !== 'string' ) { return; }
    if ( selector === '' ) { return; }
    const safe = safeSelf();
    const reUrl = safe.patternToRegex(urlPattern);
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 3);
    const log = shouldLog(extraArgs) ? ((...args) => { safe.uboLog(...args); }) : (( ) => { });
    const queryAll = (xmlDoc, selector) => {
        const isXpath = /^xpath\(.+\)$/.test(selector);
        if ( isXpath === false ) {
            return Array.from(xmlDoc.querySelectorAll(selector));
        }
        const xpr = xmlDoc.evaluate(
            selector.slice(6, -1),
            xmlDoc,
            null,
            XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
            null
        );
        const out = [];
        for ( let i = 0; i < xpr.snapshotLength; i++ ) {
            const node = xpr.snapshotItem(i);
            out.push(node);
        }
        return out;
    };
    const pruneFromDoc = xmlDoc => {
        try {
            if ( selectorCheck !== '' && xmlDoc.querySelector(selectorCheck) === null ) {
                return xmlDoc;
            }
            if ( extraArgs.logdoc ) {
                const serializer = new XMLSerializer();
                log(`xmlPrune: document is\n\t${serializer.serializeToString(xmlDoc)}`);
            }
            const items = queryAll(xmlDoc, selector);
            if ( items.length === 0 ) { return xmlDoc; }
            log(`xmlPrune: removing ${items.length} items`);
            for ( const item of items ) {
                if ( item.nodeType === 1 ) {
                    item.remove();
                } else if ( item.nodeType === 2 ) {
                    item.ownerElement.removeAttribute(item.nodeName);
                }
                log(`xmlPrune: ${item.constructor.name}.${item.nodeName} removed`);
            }
        } catch(ex) {
            log(ex);
        }
        return xmlDoc;
    };
    const pruneFromText = text => {
        if ( (/^\s*</.test(text) && />\s*$/.test(text)) === false ) {
            return text;
        }
        try {
            const xmlParser = new DOMParser();
            const xmlDoc = xmlParser.parseFromString(text, 'text/xml');
            pruneFromDoc(xmlDoc);
            const serializer = new XMLSerializer();
            text = serializer.serializeToString(xmlDoc);
        } catch(ex) {
        }
        return text;
    };
    const urlFromArg = arg => {
        if ( typeof arg === 'string' ) { return arg; }
        if ( arg instanceof Request ) { return arg.url; }
        return String(arg);
    };
    self.fetch = new Proxy(self.fetch, {
        apply: function(target, thisArg, args) {
            const fetchPromise = Reflect.apply(target, thisArg, args);
            if ( reUrl.test(urlFromArg(args[0])) === false ) {
                return fetchPromise;
            }
            return fetchPromise.then(responseBefore => {
                const response = responseBefore.clone();
                return response.text().then(text => {
                    const responseAfter = new Response(pruneFromText(text), {
                        status: responseBefore.status,
                        statusText: responseBefore.statusText,
                        headers: responseBefore.headers,
                    });
                    Object.defineProperties(responseAfter, {
                        ok: { value: responseBefore.ok },
                        redirected: { value: responseBefore.redirected },
                        type: { value: responseBefore.type },
                        url: { value: responseBefore.url },
                    });
                    return responseAfter;
                }).catch(( ) =>
                    responseBefore
                );
            });
        }
    });
    self.XMLHttpRequest.prototype.open = new Proxy(self.XMLHttpRequest.prototype.open, {
        apply: async (target, thisArg, args) => {
            if ( reUrl.test(urlFromArg(args[1])) === false ) {
                return Reflect.apply(target, thisArg, args);
            }
            thisArg.addEventListener('readystatechange', function() {
                if ( thisArg.readyState !== 4 ) { return; }
                const type = thisArg.responseType;
                if (
                    type === 'document' ||
                    type === '' && thisArg.responseXML instanceof XMLDocument
                ) {
                    pruneFromDoc(thisArg.responseXML);
                    return;
                }
                if (
                    type === 'text' ||
                    type === '' && typeof thisArg.responseText === 'string'
                ) {
                    const textin = thisArg.responseText;
                    const textout = pruneFromText(textin);
                    if ( textout === textin ) { return; }
                    Object.defineProperty(thisArg, 'response', { value: textout });
                    Object.defineProperty(thisArg, 'responseText', { value: textout });
                    return;
                }
            });
            return Reflect.apply(target, thisArg, args);
        }
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'm3u-prune.js',
    fn: m3uPrune,
    dependencies: [
        'safe-self.fn',
        'should-log.fn',
    ],
});
// https://en.wikipedia.org/wiki/M3U
function m3uPrune(
    m3uPattern = '',
    urlPattern = ''
) {
    if ( typeof m3uPattern !== 'string' ) { return; }
    const safe = safeSelf();
    const options = safe.getExtraArgs(Array.from(arguments), 2);
    const logLevel = shouldLog(options);
    const uboLog = logLevel ? ((...args) => safe.uboLog(...args)) : (( ) => { });
    const regexFromArg = arg => {
        if ( arg === '' ) { return /^/; }
        const match = /^\/(.+)\/([gms]*)$/.exec(arg);
        if ( match !== null ) {
            let flags = match[2] || '';
            if ( flags.includes('m') ) { flags += 's'; }
            return new RegExp(match[1], flags);
        }
        return new RegExp(
            arg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '.*?')
        );
    };
    const reM3u = regexFromArg(m3uPattern);
    const reUrl = regexFromArg(urlPattern);
    const pruneSpliceoutBlock = (lines, i) => {
        if ( lines[i].startsWith('#EXT-X-CUE:TYPE="SpliceOut"') === false ) {
            return false;
        }
        uboLog('m3u-prune: discarding', `\n\t${lines[i]}`);
        lines[i] = undefined; i += 1;
        if ( lines[i].startsWith('#EXT-X-ASSET:CAID') ) {
            uboLog(`\t${lines[i]}`);
            lines[i] = undefined; i += 1;
        }
        if ( lines[i].startsWith('#EXT-X-SCTE35:') ) {
            uboLog(`\t${lines[i]}`);
            lines[i] = undefined; i += 1;
        }
        if ( lines[i].startsWith('#EXT-X-CUE-IN') ) {
            uboLog(`\t${lines[i]}`);
            lines[i] = undefined; i += 1;
        }
        if ( lines[i].startsWith('#EXT-X-SCTE35:') ) {
            uboLog(`\t${lines[i]}`);
            lines[i] = undefined; i += 1;
        }
        return true;
    };
    const pruneInfBlock = (lines, i) => {
        if ( lines[i].startsWith('#EXTINF') === false ) { return false; }
        if ( reM3u.test(lines[i+1]) === false ) { return false; }
        uboLog('m3u-prune: discarding', `\n\t${lines[i]}, \n\t${lines[i+1]}`);
        lines[i] = lines[i+1] = undefined; i += 2;
        if ( lines[i].startsWith('#EXT-X-DISCONTINUITY') ) {
            uboLog(`\t${lines[i]}`);
            lines[i] = undefined; i += 1;
        }
        return true;
    };
    const pruner = text => {
        if ( (/^\s*#EXTM3U/.test(text)) === false ) { return text; }
        if ( reM3u.multiline ) {
            reM3u.lastIndex = 0;
            for (;;) {
                const match = reM3u.exec(text);
                if ( match === null ) { break; }
                let discard = match[0];
                let before = text.slice(0, match.index);
                if (
                    /^[\n\r]+/.test(discard) === false &&
                    /[\n\r]+$/.test(before) === false
                ) {
                    const startOfLine = /[^\n\r]+$/.exec(before);
                    if ( startOfLine !== null ) {
                        before = before.slice(0, startOfLine.index);
                        discard = startOfLine[0] + discard;
                    }
                }
                let after = text.slice(match.index + match[0].length);
                if (
                    /[\n\r]+$/.test(discard) === false &&
                    /^[\n\r]+/.test(after) === false
                ) {
                    const endOfLine = /^[^\n\r]+/.exec(after);
                    if ( endOfLine !== null ) {
                        after = after.slice(endOfLine.index);
                        discard += discard + endOfLine[0];
                    }
                }
                text = before.trim() + '\n' + after.trim();
                reM3u.lastIndex = before.length + 1;
                uboLog('m3u-prune: discarding\n',
                    discard.split(/\n+/).map(s => `\t${s}`).join('\n')
                );
                if ( reM3u.global === false ) { break; }
            }
            return text;
        }
        const lines = text.split(/\n\r|\n|\r/);
        for ( let i = 0; i < lines.length; i++ ) {
            if ( lines[i] === undefined ) { continue; }
            if ( pruneSpliceoutBlock(lines, i) ) { continue; }
            if ( pruneInfBlock(lines, i) ) { continue; }
        }
        return lines.filter(l => l !== undefined).join('\n');
    };
    const urlFromArg = arg => {
        if ( typeof arg === 'string' ) { return arg; }
        if ( arg instanceof Request ) { return arg.url; }
        return String(arg);
    };
    const realFetch = self.fetch;
    self.fetch = new Proxy(self.fetch, {
        apply: function(target, thisArg, args) {
            if ( reUrl.test(urlFromArg(args[0])) === false ) {
                return Reflect.apply(target, thisArg, args);
            }
            return realFetch(...args).then(realResponse =>
                realResponse.text().then(text =>
                    new Response(pruner(text), {
                        status: realResponse.status,
                        statusText: realResponse.statusText,
                        headers: realResponse.headers,
                    })
                )
            );
        }
    });
    self.XMLHttpRequest.prototype.open = new Proxy(self.XMLHttpRequest.prototype.open, {
        apply: async (target, thisArg, args) => {
            if ( reUrl.test(urlFromArg(args[1])) === false ) {
                return Reflect.apply(target, thisArg, args);
            }
            thisArg.addEventListener('readystatechange', function() {
                if ( thisArg.readyState !== 4 ) { return; }
                const type = thisArg.responseType;
                if ( type !== '' && type !== 'text' ) { return; }
                const textin = thisArg.responseText;
                const textout = pruner(textin);
                if ( textout === textin ) { return; }
                Object.defineProperty(thisArg, 'response', { value: textout });
                Object.defineProperty(thisArg, 'responseText', { value: textout });
            });
            return Reflect.apply(target, thisArg, args);
        }
    });
}

/*******************************************************************************
 * 
 * @scriptlet href-sanitizer
 * 
 * @description
 * Set the `href` attribute to a value found in the DOM at, or below the
 * targeted `a` element.
 * 
 * ### Syntax
 * 
 * ```text
 * example.org##+js(href-sanitizer, selector [, source])
 * ```
 * 
 * - `selector`: required, CSS selector, specifies `a` elements for which the
 *   `href` attribute must be overridden.
 * - `source`: optional, default to `text`, specifies from where to get the
 *   value which will override the `href` attribute.
 *     - `text`: the value will be the first valid URL found in the text
 *       content of the targeted `a` element.
 *     - `[attr]`: the value will be the attribute _attr_ of the targeted `a`
 *       element.
 *     - `?param`: the value will be the query parameter _param_ of the URL
 *       found in the `href` attribute of the targeted `a` element.
 * 
 * ### Examples
 * 
 * example.org##+js(href-sanitizer, a)
 * example.org##+js(href-sanitizer, a[title], [title])
 * example.org##+js(href-sanitizer, a[href*="/away.php?to="], ?to)
 * 
 * */

builtinScriptlets.push({
    name: 'href-sanitizer.js',
    fn: hrefSanitizer,
    world: 'ISOLATED',
    dependencies: [
        'run-at.fn',
    ],
});
function hrefSanitizer(
    selector = '',
    source = ''
) {
    if ( typeof selector !== 'string' ) { return; }
    if ( selector === '' ) { return; }
    if ( source === '' ) { source = 'text'; }
    const sanitizeCopycats = (href, text) => {
        let elems = [];
        try {
            elems = document.querySelectorAll(`a[href="${href}"`);
        }
        catch(ex) {
        }
        for ( const elem of elems ) {
            elem.setAttribute('href', text);
        }
    };
    const validateURL = text => {
        if ( text === '' ) { return ''; }
        if ( /[^\x21-\x7e]/.test(text) ) { return ''; }
        try {
            const url = new URL(text, document.location);
            return url.href;
        } catch(ex) {
        }
        return '';
    };
    const extractText = (elem, source) => {
        if ( /^\[.*\]$/.test(source) ) {
            return elem.getAttribute(source.slice(1,-1).trim()) || '';
        }
        if ( source.startsWith('?') ) {
            try {
                const url = new URL(elem.href, document.location);
                return url.searchParams.get(source.slice(1)) || '';
            } catch(x) {
            }
            return '';
        }
        if ( source === 'text' ) {
            return elem.textContent
                .replace(/^[^\x21-\x7e]+/, '') // remove leading invalid characters
                .replace(/[^\x21-\x7e]+$/, '') // remove trailing invalid characters
                ;
        }
        return '';
    };
    const sanitize = ( ) => {
        let elems = [];
        try {
            elems = document.querySelectorAll(selector);
        }
        catch(ex) {
            return false;
        }
        for ( const elem of elems ) {
            if ( elem.localName !== 'a' ) { continue; }
            if ( elem.hasAttribute('href') === false ) { continue; }
            const href = elem.getAttribute('href');
            const text = extractText(elem, source);
            const hrefAfter = validateURL(text);
            if ( hrefAfter === '' ) { continue; }
            if ( hrefAfter === href ) { continue; }
            elem.setAttribute('href', hrefAfter);
            sanitizeCopycats(href, hrefAfter);
        }
        return true;
    };
    let observer, timer;
    const onDomChanged = mutations => {
        if ( timer !== undefined ) { return; }
        let shouldSanitize = false;
        for ( const mutation of mutations ) {
            if ( mutation.addedNodes.length === 0 ) { continue; }
            for ( const node of mutation.addedNodes ) {
                if ( node.nodeType !== 1 ) { continue; }
                shouldSanitize = true;
                break;
            }
            if ( shouldSanitize ) { break; }
        }
        if ( shouldSanitize === false ) { return; }
        timer = self.requestAnimationFrame(( ) => {
            timer = undefined;
            sanitize();
        });
    };
    const start = ( ) => {
        if ( sanitize() === false ) { return; }
        observer = new MutationObserver(onDomChanged);
        observer.observe(document.body, {
            subtree: true,
            childList: true,
        });
    };
    runAt(( ) => { start(); }, 'interactive');
}

/*******************************************************************************
 * 
 * @scriptlet call-nothrow
 * 
 * @description
 * Prevent a function call from throwing. The function will be called, however
 * should it throw, the scriptlet will silently process the exception and
 * returns as if no exception has occurred.
 * 
 * ### Syntax
 * 
 * ```text
 * example.org##+js(call-nothrow, propertyChain)
 * ```
 * 
 * - `propertyChain`: a chain of dot-separated properties which leads to the
 * function to be trapped.
 * 
 * ### Examples
 * 
 * example.org##+js(call-nothrow, Object.defineProperty)
 * 
 * */

builtinScriptlets.push({
    name: 'call-nothrow.js',
    fn: callNothrow,
});
function callNothrow(
    chain = ''
) {
    if ( typeof chain !== 'string' ) { return; }
    if ( chain === '' ) { return; }
    const parts = chain.split('.');
    let owner = window, prop;
    for (;;) {
        prop = parts.shift();
        if ( parts.length === 0 ) { break; }
        owner = owner[prop];
        if ( owner instanceof Object === false ) { return; }
    }
    if ( prop === '' ) { return; }
    const fn = owner[prop];
    if ( typeof fn !== 'function' ) { return; }
    owner[prop] = new Proxy(fn, {
        apply: function(...args) {
            let r;
            try {
                r = Reflect.apply(...args);
            } catch(ex) {
            }
            return r;
        },
    });
}


/******************************************************************************/

builtinScriptlets.push({
    name: 'spoof-css.js',
    fn: spoofCSS,
    dependencies: [
        'safe-self.fn',
    ],
});
function spoofCSS(
    selector,
    ...args
) {
    if ( typeof selector !== 'string' ) { return; }
    if ( selector === '' ) { return; }
    const toCamelCase = s => s.replace(/-[a-z]/g, s => s.charAt(1).toUpperCase());
    const propToValueMap = new Map();
    for ( let i = 0; i < args.length; i += 2 ) {
        if ( typeof args[i+0] !== 'string' ) { break; }
        if ( args[i+0] === '' ) { break; }
        if ( typeof args[i+1] !== 'string' ) { break; }
        propToValueMap.set(toCamelCase(args[i+0]), args[i+1]);
    }
    const safe = safeSelf();
    const canDebug = scriptletGlobals.has('canDebug');
    const shouldDebug = canDebug && propToValueMap.get('debug') || 0;
    const shouldLog = canDebug && propToValueMap.has('log') || 0;
    const spoofStyle = (prop, real) => {
        const normalProp = toCamelCase(prop);
        const shouldSpoof = propToValueMap.has(normalProp);
        const value = shouldSpoof ? propToValueMap.get(normalProp) : real;
        if ( shouldLog === 2 || shouldSpoof && shouldLog === 1 ) {
            safe.uboLog(prop, value);
        }
        return value;
    };
    self.getComputedStyle = new Proxy(self.getComputedStyle, {
        apply: function(target, thisArg, args) {
            if ( shouldDebug !== 0 ) { debugger; }    // jshint ignore: line
            const style = Reflect.apply(target, thisArg, args);
            const targetElements = new WeakSet(document.querySelectorAll(selector));
            if ( targetElements.has(args[0]) === false ) { return style; }
            const proxiedStyle = new Proxy(style, {
                get(target, prop, receiver) {
                    if ( typeof target[prop] === 'function' ) {
                        if ( prop === 'getPropertyValue' ) {
                            return (function(prop) {
                                return spoofStyle(prop, target[prop]);
                            }).bind(target);
                        }
                        return target[prop].bind(target);
                    }
                    return spoofStyle(prop, Reflect.get(target, prop, receiver));
                },
                getOwnPropertyDescriptor(target, prop) {
                    if ( propToValueMap.has(prop) ) {
                        return {
                            configurable: true,
                            enumerable: true,
                            value: propToValueMap.get(prop),
                            writable: true,
                        };
                    }
                    return Reflect.getOwnPropertyDescriptor(target, prop);
                },
            });
            return proxiedStyle;
        },
        get(target, prop, receiver) {
            if ( prop === 'toString' ) {
                return target.toString.bind(target);
            }
            return Reflect.get(target, prop, receiver);
        },
    });
    Element.prototype.getBoundingClientRect = new Proxy(Element.prototype.getBoundingClientRect, {
        apply: function(target, thisArg, args) {
            if ( shouldDebug !== 0 ) { debugger; }    // jshint ignore: line
            const rect = Reflect.apply(target, thisArg, args);
            const targetElements = new WeakSet(document.querySelectorAll(selector));
            if ( targetElements.has(thisArg) === false ) { return rect; }
            let { height, width } = rect;
            if ( propToValueMap.has('width') ) {
                width = parseFloat(propToValueMap.get('width'));
            }
            if ( propToValueMap.has('height') ) {
                height = parseFloat(propToValueMap.get('height'));
            }
            return new self.DOMRect(rect.x, rect.y, width, height);
        },
        get(target, prop, receiver) {
            if ( prop === 'toString' ) {
                return target.toString.bind(target);
            }
            return Reflect.get(target, prop, receiver);
        },
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'remove-node-text.js',
    aliases: [
        'rmnt.js',
    ],
    fn: removeNodeText,
    world: 'ISOLATED',
    dependencies: [
        'replace-node-text.fn',
    ],
});
function removeNodeText(
    nodeName,
    condition,
    ...extraArgs
) {
    replaceNodeTextFn(nodeName, '', '', 'condition', condition || '', ...extraArgs);
}

/*******************************************************************************
 * 
 * set-cookie.js
 * 
 * Set specified cookie to a specific value.
 * 
 * Reference:
 * https://github.com/AdguardTeam/Scriptlets/blob/master/src/scriptlets/set-cookie.js
 * 
 **/

builtinScriptlets.push({
    name: 'set-cookie.js',
    fn: setCookie,
    world: 'ISOLATED',
    dependencies: [
        'safe-self.fn',
        'set-cookie.fn',
    ],
});
function setCookie(
    name = '',
    value = '',
    path = ''
) {
    if ( name === '' ) { return; }
    name = encodeURIComponent(name);

    const validValues = [
        'accept', 'reject',
        'accepted', 'rejected', 'notaccepted',
        'allow', 'deny',
        'allowed', 'disallow',
        'enable', 'disable',
        'enabled', 'disabled',
        'ok',
        'on', 'off',
        'true', 'false',
        'y', 'n',
        'yes', 'no',
    ];
    if ( validValues.includes(value.toLowerCase()) === false ) {
        if ( /^\d+$/.test(value) === false ) { return; }
        const n = parseInt(value, 10);
        if ( n > 15 ) { return; }
    }
    value = encodeURIComponent(value);

    setCookieFn(
        false,
        name,
        value,
        '',
        path,
        safeSelf().getExtraArgs(Array.from(arguments), 3)
    );
}

// For compatibility with AdGuard
builtinScriptlets.push({
    name: 'set-cookie-reload.js',
    fn: setCookieReload,
    world: 'ISOLATED',
    dependencies: [
        'set-cookie.js',
    ],
});
function setCookieReload(name, value, path, ...args) {
    setCookie(name, value, path, 'reload', '1', ...args);
}

/*******************************************************************************
 * 
 * set-local-storage-item.js
 * set-session-storage-item.js
 * 
 * Set a local/session storage entry to a specific, allowed value.
 * 
 * Reference:
 * https://github.com/AdguardTeam/Scriptlets/blob/master/src/scriptlets/set-local-storage-item.js
 * https://github.com/AdguardTeam/Scriptlets/blob/master/src/scriptlets/set-session-storage-item.js
 * 
 **/

builtinScriptlets.push({
    name: 'set-local-storage-item.js',
    fn: setLocalStorageItem,
    world: 'ISOLATED',
    dependencies: [
        'set-local-storage-item.fn',
    ],
});
function setLocalStorageItem(key = '', value = '') {
    setLocalStorageItemFn('local', false, key, value);
}

builtinScriptlets.push({
    name: 'set-session-storage-item.js',
    fn: setSessionStorageItem,
    world: 'ISOLATED',
    dependencies: [
        'set-local-storage-item.fn',
    ],
});
function setSessionStorageItem(key = '', value = '') {
    setLocalStorageItemFn('session', false, key, value);
}

/*******************************************************************************
 * 
 * @scriptlet set-attr
 * 
 * @description
 * Sets the specified attribute on the specified elements. This scriptlet runs
 * once when the page loads then afterward on DOM mutations.

 * Reference: https://github.com/AdguardTeam/Scriptlets/blob/master/src/scriptlets/set-attr.js
 * 
 * ### Syntax
 * 
 * ```text
 * example.org##+js(set-attr, selector, attr [, value])
 * ```
 * 
 * - `selector`: CSS selector of DOM elements for which the attribute `attr`
 *   must be modified.
 * - `attr`: the name of the attribute to modify
 * - `value`: the value to assign to the target attribute. Possible values:
 *     - `''`: empty string (default)
 *     - `true`
 *     - `false`
 *     - positive decimal integer 0 <= value < 32768
 *     - `[other]`: copy the value from attribute `other` on the same element
 * */

builtinScriptlets.push({
    name: 'set-attr.js',
    fn: setAttr,
    world: 'ISOLATED',
    dependencies: [
        'run-at.fn',
    ],
});
function setAttr(
    selector = '',
    attr = '',
    value = ''
) {
    if ( typeof selector !== 'string' ) { return; }
    if ( selector === '' ) { return; }

    const validValues = [ '', 'false', 'true' ];
    let copyFrom = '';

    if ( validValues.includes(value.toLowerCase()) === false ) {
        if ( /^\d+$/.test(value) ) {
            const n = parseInt(value, 10);
            if ( n >= 32768 ) { return; }
            value = `${n}`;
        } else if ( /^\[.+\]$/.test(value) ) {
            copyFrom = value.slice(1, -1);
        } else {
            return;
        }
    }

    const extractValue = elem => {
        if ( copyFrom !== '' ) {
            return elem.getAttribute(copyFrom) || '';
        }
        return value;
    };

    const applySetAttr = ( ) => {
        const elems = [];
        try {
            elems.push(...document.querySelectorAll(selector));
        }
        catch(ex) {
            return false;
        }
        for ( const elem of elems ) {
            const before = elem.getAttribute(attr);
            const after = extractValue(elem);
            if ( after === before ) { continue; }
            elem.setAttribute(attr, after);
        }
        return true;
    };
    let observer, timer;
    const onDomChanged = mutations => {
        if ( timer !== undefined ) { return; }
        let shouldWork = false;
        for ( const mutation of mutations ) {
            if ( mutation.addedNodes.length === 0 ) { continue; }
            for ( const node of mutation.addedNodes ) {
                if ( node.nodeType !== 1 ) { continue; }
                shouldWork = true;
                break;
            }
            if ( shouldWork ) { break; }
        }
        if ( shouldWork === false ) { return; }
        timer = self.requestAnimationFrame(( ) => {
            timer = undefined;
            applySetAttr();
        });
    };
    const start = ( ) => {
        if ( applySetAttr() === false ) { return; }
        observer = new MutationObserver(onDomChanged);
        observer.observe(document.body, {
            subtree: true,
            childList: true,
        });
    };
    runAt(( ) => { start(); }, 'idle');
}

/*******************************************************************************
 * 
 * @scriptlet prevent-canvas
 * 
 * @description
 * Prevent usage of specific or all (default) canvas APIs.
 *
 * ### Syntax
 * 
 * ```text
 * example.com##+js(prevent-canvas [, contextType])
 * ```
 * 
 * - `contextType`: A specific type of canvas API to prevent (default to all
 *   APIs). Can be a string or regex which will be matched against the type
 *   used in getContext() call. Prepend with `!` to test for no-match.
 * 
 * ### Examples
 * 
 * 1. Prevent `example.com` from accessing all canvas APIs
 * 
 * ```adblock
 * example.com##+js(prevent-canvas)
 * ```
 * 
 * 2. Prevent access to any flavor of WebGL API, everywhere
 * 
 * ```adblock
 * *##+js(prevent-canvas, /webgl/)
 * ```
 * 
 * 3. Prevent `example.com` from accessing any flavor of canvas API except `2d`
 * 
 * ```adblock
 * example.com##+js(prevent-canvas, !2d)
 * ```
 * 
 * ### References
 * 
 * https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext
 * 
 * */

builtinScriptlets.push({
    name: 'prevent-canvas.js',
    fn: preventCanvas,
    dependencies: [
        'safe-self.fn',
    ],
});
function preventCanvas(
    contextType = ''
) {
    const safe = safeSelf();
    const pattern = safe.initPattern(contextType, { canNegate: true });
    const proto = globalThis.HTMLCanvasElement.prototype;
    proto.getContext = new Proxy(proto.getContext, {
        apply(target, thisArg, args) {
            if ( safe.testPattern(pattern, args[0]) ) { return null; }
            return Reflect.apply(target, thisArg, args);
        }
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'multiup.js',
    fn: multiup,
    world: 'ISOLATED',
});
function multiup() {
    const handler = ev => {
        const target = ev.target;
        if ( target.matches('button[link]') === false ) { return; }
        const ancestor = target.closest('form');
        if ( ancestor === null ) { return; }
        if ( ancestor !== target.parentElement ) { return; }
        const link = (target.getAttribute('link') || '').trim();
        if ( link === '' ) { return; }
        ev.preventDefault();
        ev.stopPropagation();
        document.location.href = link;
    };
    document.addEventListener('click', handler, { capture: true });
}


/*******************************************************************************
 * 
 * Scriplets below this section are only available for filter lists from
 * trusted sources. They all have the property `requiresTrust` set to `true`.
 * 
 * Trusted sources are:
 *
 * - uBO's own filter lists, which name starts with "uBlock filters – ", and
 *   maintained at: https://github.com/uBlockOrigin/uAssets
 * 
 * - The user's own filters as seen in "My filters" pane in uBO's dashboard. 
 * 
 * The trustworthiness of filters using these privileged scriptlets are
 * evaluated at filter list compiled time: when a filter using one of the
 * privileged scriptlet originates from a non-trusted filter list source, it
 * is discarded at compile time, specifically from within:
 * 
 * - Source: ./src/js/scriptlet-filtering.js
 * - Method: scriptletFilteringEngine.compile(), via normalizeRawFilter()
 * 
 **/

/*******************************************************************************
 * 
 * replace-node-text.js
 * 
 * Replace text instance(s) with another text instance inside specific
 * DOM nodes. By default, the scriplet stops and quits at the interactive
 * stage of a document.
 * 
 * See commit messages for usage:
 * - https://github.com/gorhill/uBlock/commit/99ce027fd702
 * - https://github.com/gorhill/uBlock/commit/41876336db48
 * 
 **/

builtinScriptlets.push({
    name: 'replace-node-text.js',
    requiresTrust: true,
    aliases: [
        'rpnt.js',
    ],
    fn: replaceNodeText,
    world: 'ISOLATED',
    dependencies: [
        'replace-node-text.fn',
    ],
});
function replaceNodeText(
    nodeName,
    pattern,
    replacement,
    ...extraArgs
) {
    replaceNodeTextFn(nodeName, pattern, replacement, ...extraArgs);
}

/*******************************************************************************
 * 
 * trusted-set-constant.js
 * 
 * Set specified property to any value. This is essentially the same as
 * set-constant.js, but with no restriction as to which values can be used.
 * 
 **/

builtinScriptlets.push({
    name: 'trusted-set-constant.js',
    requiresTrust: true,
    aliases: [
        'trusted-set.js',
    ],
    fn: trustedSetConstant,
    dependencies: [
        'set-constant-core.fn'
    ],
});
function trustedSetConstant(
    ...args
) {
    setConstantCore(true, ...args);
}

/*******************************************************************************
 * 
 * trusted-set-cookie.js
 * 
 * Set specified cookie to an arbitrary value.
 * 
 * Reference:
 * https://github.com/AdguardTeam/Scriptlets/blob/master/src/scriptlets/trusted-set-cookie.js#L23
 * 
 **/

builtinScriptlets.push({
    name: 'trusted-set-cookie.js',
    requiresTrust: true,
    fn: trustedSetCookie,
    world: 'ISOLATED',
    dependencies: [
        'safe-self.fn',
        'set-cookie.fn',
    ],
});
function trustedSetCookie(
    name = '',
    value = '',
    offsetExpiresSec = '',
    path = ''
) {
    if ( name === '' ) { return; }

    const time = new Date();

    if ( value === '$now$' ) {
        value = Date.now();
    } else if ( value === '$currentDate$' ) {
        value = time.toUTCString();
    }

    let expires = '';
    if ( offsetExpiresSec !== '' ) {
        if ( offsetExpiresSec === '1day' ) {
            time.setDate(time.getDate() + 1);
        } else if ( offsetExpiresSec === '1year' ) {
            time.setFullYear(time.getFullYear() + 1);
        } else {
            if ( /^\d+$/.test(offsetExpiresSec) === false ) { return; }
            time.setSeconds(time.getSeconds() + parseInt(offsetExpiresSec, 10));
        }
        expires = time.toUTCString();
    }

    setCookieFn(
        true,
        name,
        value,
        expires,
        path,
        safeSelf().getExtraArgs(Array.from(arguments), 4)
    );
}

// For compatibility with AdGuard
builtinScriptlets.push({
    name: 'trusted-set-cookie-reload.js',
    requiresTrust: true,
    fn: trustedSetCookieReload,
    world: 'ISOLATED',
    dependencies: [
        'trusted-set-cookie.js',
    ],
});
function trustedSetCookieReload(name, value, offsetExpiresSec, path, ...args) {
    trustedSetCookie(name, value, offsetExpiresSec, path, 'reload', '1', ...args);
}

/*******************************************************************************
 * 
 * trusted-set-local-storage-item.js
 * 
 * Set a local storage entry to an arbitrary value.
 * 
 * Reference:
 * https://github.com/AdguardTeam/Scriptlets/blob/master/src/scriptlets/trusted-set-local-storage-item.js
 * 
 **/

builtinScriptlets.push({
    name: 'trusted-set-local-storage-item.js',
    requiresTrust: true,
    fn: trustedSetLocalStorageItem,
    world: 'ISOLATED',
    dependencies: [
        'set-local-storage-item.fn',
    ],
});
function trustedSetLocalStorageItem(key = '', value = '') {
    setLocalStorageItemFn('local', true, key, value);
}

/*******************************************************************************
 * 
 * trusted-replace-fetch-response.js
 * 
 * Replaces response text content of fetch requests if all given parameters
 * match.
 * 
 * Reference:
 * https://github.com/AdguardTeam/Scriptlets/blob/master/src/scriptlets/trusted-replace-fetch-response.js
 * 
 **/

builtinScriptlets.push({
    name: 'trusted-replace-fetch-response.js',
    requiresTrust: true,
    fn: trustedReplaceFetchResponse,
    dependencies: [
        'replace-fetch-response.fn',
    ],
});
function trustedReplaceFetchResponse(...args) {
    replaceFetchResponseFn(true, ...args);
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'trusted-replace-xhr-response.js',
    requiresTrust: true,
    fn: trustedReplaceXhrResponse,
    dependencies: [
        'match-object-properties.fn',
        'parse-properties-to-match.fn',
        'safe-self.fn',
        'should-log.fn',
    ],
});
function trustedReplaceXhrResponse(
    pattern = '',
    replacement = '',
    propsToMatch = ''
) {
    const safe = safeSelf();
    const xhrInstances = new WeakMap();
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 3);
    const logLevel = shouldLog({
        log: pattern === '' && 'all' || extraArgs.log,
    });
    const log = logLevel ? ((...args) => { safe.uboLog(...args); }) : (( ) => { }); 
    if ( pattern === '*' ) { pattern = '.*'; }
    const rePattern = safe.patternToRegex(pattern);
    const propNeedles = parsePropertiesToMatch(propsToMatch, 'url');
    self.XMLHttpRequest = class extends self.XMLHttpRequest {
        open(method, url, ...args) {
            const outerXhr = this;
            const xhrDetails = { method, url };
            let outcome = 'match';
            if ( propNeedles.size !== 0 ) {
                if ( matchObjectProperties(propNeedles, xhrDetails) === false ) {
                    outcome = 'nomatch';
                }
            }
            if ( outcome === logLevel || outcome === 'all' ) {
                log(`xhr.open(${method}, ${url}, ${args.join(', ')})`);
            }
            if ( outcome === 'match' ) {
                xhrInstances.set(outerXhr, xhrDetails);
            }
            return super.open(method, url, ...args);
        }
        get response() {
            const innerResponse = super.response;
            const xhrDetails = xhrInstances.get(this);
            if ( xhrDetails === undefined ) {
                return innerResponse;
            }
            const responseLength = typeof innerResponse === 'string'
                ? innerResponse.length
                : undefined;
            if ( xhrDetails.lastResponseLength !== responseLength ) {
                xhrDetails.response = undefined;
                xhrDetails.lastResponseLength = responseLength;
            }
            if ( xhrDetails.response !== undefined ) {
                return xhrDetails.response;
            }
            if ( typeof innerResponse !== 'string' ) {
                return (xhrDetails.response = innerResponse);
            }
            const textBefore = innerResponse;
            const textAfter = textBefore.replace(rePattern, replacement);
            const outcome = textAfter !== textBefore ? 'match' : 'nomatch';
            if ( outcome === logLevel || logLevel === 'all' ) {
                log(
                    `trusted-replace-xhr-response (${outcome})`,
                    `\n\tpattern: ${pattern}`, 
                    `\n\treplacement: ${replacement}`,
                );
            }
            return (xhrDetails.response = textAfter);
        }
        get responseText() {
            const response = this.response;
            if ( typeof response !== 'string' ) {
                return super.responseText;
            }
            return response;
        }
    };
}

/*******************************************************************************
 * 
 * trusted-click-element.js
 * 
 * Reference API:
 * https://github.com/AdguardTeam/Scriptlets/blob/master/src/scriptlets/trusted-click-element.js
 * 
 **/

builtinScriptlets.push({
    name: 'trusted-click-element.js',
    requiresTrust: true,
    fn: trustedClickElement,
    world: 'ISOLATED',
    dependencies: [
        'run-at-html-element.fn',
        'safe-self.fn',
    ],
});
function trustedClickElement(
    selectors = '',
    extraMatch = '', // not yet supported
    delay = ''
) {
    if ( extraMatch !== '' ) { return; }

    const safe = safeSelf();
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 3);
    const uboLog = extraArgs.log !== undefined
        ? ((...args) => { safe.uboLog(...args); })
        : (( ) => { });

    const selectorList = selectors.split(/\s*,\s*/)
        .filter(s => {
            try {
                void document.querySelector(s);
            } catch(_) {
                return false;
            }
            return true;
        });
    if ( selectorList.length === 0 ) { return; }

    const clickDelay = parseInt(delay, 10) || 1;
    const t0 = Date.now();
    const tbye = t0 + 10000;
    let tnext = selectorList.length !== 1 ? t0 : t0 + clickDelay;

    const terminate = ( ) => {
        selectorList.length = 0;
        next.stop();
        observe.stop();
    };

    const next = notFound => {
        if ( selectorList.length === 0 ) {
            uboLog(`trusted-click-element: Completed`);
            return terminate();
        }
        const tnow = Date.now();
        if ( tnow >= tbye ) {
            uboLog(`trusted-click-element: Timed out`);
            return terminate();
        }
        if ( notFound ) { observe(); }
        const delay = Math.max(notFound ? tbye - tnow : tnext - tnow, 1);
        next.timer = setTimeout(( ) => {
            next.timer = undefined;
            process();
        }, delay);
        uboLog(`trusted-click-element: Waiting for ${selectorList[0]}...`);
    };
    next.stop = ( ) => {
        if ( next.timer === undefined ) { return; }
        clearTimeout(next.timer);
        next.timer = undefined;
    };

    const observe = ( ) => {
        if ( observe.observer !== undefined ) { return; }
        observe.observer = new MutationObserver(( ) => {
            if ( observe.timer !== undefined ) { return; }
            observe.timer = setTimeout(( ) => {
                observe.timer = undefined;
                process();
            }, 20);
        });
        observe.observer.observe(document, {
            attributes: true,
            childList: true,
            subtree: true,
        });
    };
    observe.stop = ( ) => {
        if ( observe.timer !== undefined ) {
            clearTimeout(observe.timer);
            observe.timer = undefined;
        }
        if ( observe.observer ) {
            observe.observer.disconnect();
            observe.observer = undefined;
        }
    };

    const process = ( ) => {
        next.stop();
        if ( Date.now() < tnext ) { return next(); }
        const selector = selectorList.shift();
        if ( selector === undefined ) { return terminate(); }
        const elem = document.querySelector(selector);
        if ( elem === null ) {
            selectorList.unshift(selector);
            return next(true);
        }
        uboLog(`trusted-click-element: Clicked ${selector}`);
        elem.click();
        tnext += clickDelay;
        next();
    };

    runAtHtmlElementFn(process);
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'trusted-prune-inbound-object.js',
    requiresTrust: true,
    fn: trustedPruneInboundObject,
    dependencies: [
        'object-find-owner.fn',
        'object-prune.fn',
        'safe-self.fn',
    ],
});
function trustedPruneInboundObject(
    entryPoint = '',
    argPos = '',
    rawPrunePaths = '',
    rawNeedlePaths = ''
) {
    if ( entryPoint === '' ) { return; }
    let context = globalThis;
    let prop = entryPoint;
    for (;;) {
        const pos = prop.indexOf('.');
        if ( pos === -1 ) { break; }
        context = context[prop.slice(0, pos)];
        if ( context instanceof Object === false ) { return; }
        prop = prop.slice(pos+1);
    }
    if ( typeof context[prop] !== 'function' ) { return; }
    const argIndex = parseInt(argPos);
    if ( isNaN(argIndex) ) { return; }
    if ( argIndex < 1 ) { return; }
    const safe = safeSelf();
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 4);
    const needlePaths = [];
    if ( rawPrunePaths !== '' ) {
        needlePaths.push(...rawPrunePaths.split(/ +/));
    }
    if ( rawNeedlePaths !== '' ) {
        needlePaths.push(...rawNeedlePaths.split(/ +/));
    }
    const mustProcess = root => {
        for ( const needlePath of needlePaths ) {
            if ( objectFindOwnerFn(root, needlePath) === false ) {
                return false;
            }
        }
        return true;
    };
    context[prop] = new Proxy(context[prop], {
        apply: function(target, thisArg, args) {
            const targetArg = argIndex <= args.length
                ? args[argIndex-1]
                : undefined;
            if ( targetArg instanceof Object && mustProcess(targetArg) ) {
                let objBefore = targetArg;
                if ( extraArgs.dontOverwrite ) {
                    try {
                        objBefore = safe.JSON_parse(safe.JSON_stringify(targetArg));
                    } catch(_) {
                        objBefore = undefined;
                    }
                }
                if ( objBefore !== undefined ) {
                    const objAfter = objectPruneFn(
                        objBefore,
                        rawPrunePaths,
                        rawNeedlePaths,
                        { matchAll: true },
                        extraArgs
                    );
                    args[argIndex-1] = objAfter || objBefore;
                }
            }
            return Reflect.apply(target, thisArg, args);
        },
    });
}

/******************************************************************************/

builtinScriptlets.push({
    name: 'trusted-prune-outbound-object.js',
    requiresTrust: true,
    fn: trustedPruneOutboundObject,
    dependencies: [
        'object-prune.fn',
        'safe-self.fn',
    ],
});
function trustedPruneOutboundObject(
    entryPoint = '',
    rawPrunePaths = '',
    rawNeedlePaths = ''
) {
    if ( entryPoint === '' ) { return; }
    let context = globalThis;
    let prop = entryPoint;
    for (;;) {
        const pos = prop.indexOf('.');
        if ( pos === -1 ) { break; }
        context = context[prop.slice(0, pos)];
        if ( context instanceof Object === false ) { return; }
        prop = prop.slice(pos+1);
    }
    if ( typeof context[prop] !== 'function' ) { return; }
    const safe = safeSelf();
    const extraArgs = safe.getExtraArgs(Array.from(arguments), 3);
    context[prop] = new Proxy(context[prop], {
        apply: function(target, thisArg, args) {
            const objBefore = Reflect.apply(target, thisArg, args);
            if ( objBefore instanceof Object === false ) { return objBefore; }
            const objAfter = objectPruneFn(
                objBefore,
                rawPrunePaths,
                rawNeedlePaths,
                { matchAll: true },
                extraArgs
            );
            return objAfter || objBefore;
        },
    });
}

/******************************************************************************/

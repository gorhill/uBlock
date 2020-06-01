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

// The lines below are skipped by the resource parser. Purpose is clean
// jshinting.
(function() {
// >>>> start of private namespace
'use strict';





/// abort-current-inline-script.js
/// alias acis.js
(function() {
    const target = '{{1}}';
    if ( target === '' || target === '{{1}}' ) { return; }
    const needle = '{{2}}';
    let reText = '.?';
    if ( needle !== '' && needle !== '{{2}}' ) {
        reText = /^\/.+\/$/.test(needle)
            ? needle.slice(1,-1)
            : needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    const thisScript = document.currentScript;
    const re = new RegExp(reText);
    const chain = target.split('.');
    let owner = window;
    let prop;
    for (;;) {
        prop = chain.shift();
        if ( chain.length === 0 ) { break; }
        owner = owner[prop];
        if ( owner instanceof Object === false ) { return; }
    }
    const desc = Object.getOwnPropertyDescriptor(owner, prop);
    if ( desc && desc.get !== undefined ) { return; }
    const magic = String.fromCharCode(Date.now() % 26 + 97) +
                  Math.floor(Math.random() * 982451653 + 982451653).toString(36);
    let value = owner[prop];
    const validate = function() {
        const e = document.currentScript;
        if (
            e instanceof HTMLScriptElement &&
            e.src === '' &&
            e !== thisScript &&
            re.test(e.textContent)
        ) {
            throw new ReferenceError(magic);
        }
    };
    Object.defineProperty(owner, prop, {
        get: function() {
            validate();
            return value;
        },
        set: function(a) {
            validate();
            value = a;
        }
    });
    const oe = window.onerror;
    window.onerror = function(msg) {
        if ( typeof msg === 'string' && msg.indexOf(magic) !== -1 ) {
            return true;
        }
        if ( oe instanceof Function ) {
            return oe.apply(this, arguments);
        }
    }.bind();
})();


/// abort-on-property-read.js
/// alias aopr.js
(function() {
    const magic = String.fromCharCode(Date.now() % 26 + 97) +
                  Math.floor(Math.random() * 982451653 + 982451653).toString(36);
    const abort = function() {
        throw new ReferenceError(magic);
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
    let chain = '{{1}}';
    makeProxy(owner, chain);
    const oe = window.onerror;
    window.onerror = function(msg, src, line, col, error) {
        if ( typeof msg === 'string' && msg.indexOf(magic) !== -1 ) {
            return true;
        }
        if ( oe instanceof Function ) {
            return oe(msg, src, line, col, error);
        }
    }.bind();
})();


/// abort-on-property-write.js
/// alias aopw.js
(function() {
    const magic = String.fromCharCode(Date.now() % 26 + 97) +
                  Math.floor(Math.random() * 982451653 + 982451653).toString(36);
    let prop = '{{1}}';
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
            throw new ReferenceError(magic);
        }
    });
    const oe = window.onerror;
    window.onerror = function(msg, src, line, col, error) {
        if ( typeof msg === 'string' && msg.indexOf(magic) !== -1 ) {
            return true;
        }
        if ( oe instanceof Function ) {
            return oe(msg, src, line, col, error);
        }
    }.bind();
})();


/// addEventListener-defuser.js
/// alias aeld.js
(function() {
    let needle1 = '{{1}}';
    if ( needle1 === '' || needle1 === '{{1}}' ) {
        needle1 = '.?';
    } else if ( /^\/.+\/$/.test(needle1) ) {
        needle1 = needle1.slice(1,-1);
    } else {
        needle1 = needle1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    needle1 = new RegExp(needle1);
    let needle2 = '{{2}}';
    if ( needle2 === '' || needle2 === '{{2}}' ) {
        needle2 = '.?';
    } else if ( /^\/.+\/$/.test(needle2) ) {
        needle2 = needle2.slice(1,-1);
    } else {
        needle2 = needle2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    needle2 = new RegExp(needle2);
    self.EventTarget.prototype.addEventListener = new Proxy(
        self.EventTarget.prototype.addEventListener,
        {
            apply: function(target, thisArg, args) {
                const type = args[0].toString();
                const handler = String(args[1]);
                if (
                    needle1.test(type) === false ||
                    needle2.test(handler) === false
                ) {
                    return target.apply(thisArg, args);
                }
            }
        }
    );
})();


/// addEventListener-logger.js
/// alias aell.js
(function() {
    const log = console.log.bind(console);
    self.EventTarget.prototype.addEventListener = new Proxy(
        self.EventTarget.prototype.addEventListener,
        {
            apply: function(target, thisArg, args) {
                const type = args[0].toString();
                const handler = String(args[1]);
                log('addEventListener("%s", %s)', type, handler);
                return target.apply(thisArg, args);
            }
        }
    );
})();


/// json-prune.js
(function() {
    const log = console.log.bind(console);
    const rawPrunePaths = '{{1}}';
    const rawNeedlePaths = '{{2}}';
    const prunePaths = rawPrunePaths !== '{{1}}' && rawPrunePaths !== ''
        ? rawPrunePaths.split(/ +/)
        : [];
    const needlePaths = rawNeedlePaths !== '{{2}}' && rawNeedlePaths !== ''
        ? rawNeedlePaths.split(/ +/)
        : [];
    const findOwner = function(root, path) {
        let owner = root;
        let chain = path;
        for (;;) {
            if ( owner instanceof Object === false ) { return; }
            const pos = chain.indexOf('.');
            if ( pos === -1 ) {
                return owner.hasOwnProperty(chain)
                    ? [ owner, chain ]
                    : undefined;
            }
            const prop = chain.slice(0, pos);
            if ( owner.hasOwnProperty(prop) === false ) { return; }
            owner = owner[prop];
            chain = chain.slice(pos + 1);
        }
    };
    const mustProcess = function(root) {
        for ( const needlePath of needlePaths ) {
            const details = findOwner(root, needlePath);
            if ( details === undefined ) { return false; }
        }
        return true;
    };
    JSON.parse = new Proxy(JSON.parse, {
        apply: function() {
            const r = Reflect.apply(...arguments);
            if ( prunePaths.length === 0 ) {
                log(location.hostname, r);
                return r;
            }
            if ( mustProcess(r) === false ) { return r; }
            for ( const path of prunePaths ) {
                const details = findOwner(r, path);
                if ( details !== undefined ) {
                    delete details[0][details[1]];
                }
            }
            return r;
        },
    });
})();


// Imported from:
// https://github.com/NanoAdblocker/NanoFilters/blob/1f3be7211bb0809c5106996f52564bf10c4525f7/NanoFiltersSource/NanoResources.txt#L126
//
// Speed up or down setInterval, 3 optional arguments.
//      The payload matcher, a string literal or a JavaScript RegExp, defaults
//      to match all.
// delayMatcher
//      The delay matcher, an integer, defaults to 1000.
// boostRatio - The delay multiplier when there is a match, 0.5 speeds up by
//      2 times and 2 slows down by 2 times, defaults to 0.05 or speed up
//      20 times. Speed up and down both cap at 50 times.
/// nano-setInterval-booster.js
/// alias nano-sib.js
(function() {
    let needle = '{{1}}';
    let delay = parseInt('{{2}}', 10);
    let boost = parseFloat('{{3}}');
    if ( needle === '' || needle === '{{1}}' ) {
        needle = '.?';
    } else if ( needle.charAt(0) === '/' && needle.slice(-1) === '/' ) {
        needle = needle.slice(1, -1);
    } else {
        needle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    needle = new RegExp(needle);
    if ( isNaN(delay) || !isFinite(delay) ) {
        delay = 1000;
    }
    if ( isNaN(boost) || !isFinite(boost) ) {
        boost = 0.05;
    }
    if ( boost < 0.02 ) {
        boost = 0.02;
    }
    if ( boost > 50 ) {
        boost = 50;
    }
    window.setInterval = new Proxy(window.setInterval, {
        apply: function(target, thisArg, args) {
            const a = args[0];
            const b = args[1];
            if ( b === delay && needle.test(a.toString()) ) {
                args[1] = b * boost;
            }
            return target.apply(thisArg, args);
        }
    });
})();


// Imported from:
// https://github.com/NanoAdblocker/NanoFilters/blob/1f3be7211bb0809c5106996f52564bf10c4525f7/NanoFiltersSource/NanoResources.txt#L82
//
// Speed up or down setTimeout, 3 optional arguments.
// funcMatcher
//      The payload matcher, a string literal or a JavaScript RegExp, defaults
//      to match all.
// delayMatcher
//      The delay matcher, an integer, defaults to 1000.
// boostRatio - The delay multiplier when there is a match, 0.5 speeds up by
//      2 times and 2 slows down by 2 times, defaults to 0.05 or speed up
//      20 times. Speed up and down both cap at 50 times.
/// nano-setTimeout-booster.js
/// alias nano-stb.js
(function() {
    let needle = '{{1}}';
    let delay = parseInt('{{2}}', 10);
    let boost = parseFloat('{{3}}');
    if ( needle === '' || needle === '{{1}}' ) {
        needle = '.?';
    } else if ( needle.startsWith('/') && needle.endsWith('/') ) {
        needle = needle.slice(1, -1);
    } else {
        needle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    needle = new RegExp(needle);
    if ( isNaN(delay) || !isFinite(delay) ) {
        delay = 1000;
    }
    if ( isNaN(boost) || !isFinite(boost) ) {
        boost = 0.05;
    }
    if ( boost < 0.02 ) {
        boost = 0.02;
    }
    if ( boost > 50 ) {
        boost = 50;
    }
    window.setTimeout = new Proxy(window.setTimeout, {
        apply: function(target, thisArg, args) {
            const a = args[0];
            const b = args[1];
            if ( b === delay && needle.test(a.toString()) ) {
                args[1] = b * boost;
            }
            return target.apply(thisArg, args);
        }
    });
})();


/// noeval-if.js
(function() {
    let needle = '{{1}}';
    if ( needle === '' || needle === '{{1}}' ) {
        needle = '.?';
    } else if ( needle.slice(0,1) === '/' && needle.slice(-1) === '/' ) {
        needle = needle.slice(1,-1);
    } else {
        needle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    needle = new RegExp(needle);
    window.eval = new Proxy(window.eval, {          // jshint ignore: line
        apply: function(target, thisArg, args) {
            const a = args[0];
            if ( needle.test(a.toString()) === false ) {
                return target.apply(thisArg, args);
            }
        }
    });
})();


/// remove-attr.js
/// alias ra.js
(function() {
    const token = '{{1}}';
    if ( token === '' || token === '{{1}}' ) { return; }
    const tokens = token.split(/\s*\|\s*/);
    let selector = '{{2}}';
    if ( selector === '' || selector === '{{2}}' ) {
        selector = `[${tokens.join('],[')}]`;
    }
    const rmattr = function(ev) {
        if ( ev ) {
            window.removeEventListener(ev.type, rmattr, true);
        }
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
    if ( document.readyState === 'loading' ) {
        window.addEventListener('DOMContentLoaded', rmattr, true);
    } else {
        rmattr();
    }
})();


/// requestAnimationFrame-if.js
/// alias raf-if.js
(function() {
    let needle = '{{1}}';
    const not = needle.charAt(0) === '!';
    if ( not ) { needle = needle.slice(1); }
    if ( needle === '' || needle === '{{1}}' ) {
        needle = '.?';
    } else if ( needle.startsWith('/') && needle.endsWith('/') ) {
        needle = needle.slice(1,-1);
    } else {
        needle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    const log = needle === '.?' && not === false ? console.log : undefined;
    needle = new RegExp(needle);
    window.requestAnimationFrame = new Proxy(window.requestAnimationFrame, {
        apply: function(target, thisArg, args) {
            const a = String(args[0]);
            if ( log !== undefined ) {
                log('uBO: requestAnimationFrame("%s")', a);
            } else if ( needle.test(a) === not ) {
                args[0] = function(){};
            }
            return target.apply(thisArg, args);
        }
    });
})();


/// set-constant.js
/// alias set.js
(function() {
    const thisScript = document.currentScript;
    let cValue = '{{2}}';
    if ( cValue === 'undefined' ) {
        cValue = undefined;
    } else if ( cValue === 'false' ) {
        cValue = false;
    } else if ( cValue === 'true' ) {
        cValue = true;
    } else if ( cValue === 'null' ) {
        cValue = null;
    } else if ( cValue === 'noopFunc' ) {
        cValue = function(){};
    } else if ( cValue === 'trueFunc' ) {
        cValue = function(){ return true; };
    } else if ( cValue === 'falseFunc' ) {
        cValue = function(){ return false; };
    } else if ( /^\d+$/.test(cValue) ) {
        cValue = parseFloat(cValue);
        if ( isNaN(cValue) ) { return; }
        if ( Math.abs(cValue) > 0x7FFF ) { return; }
    } else if ( cValue === "''" ) {
        cValue = '';
    } else {
        return;
    }
    let aborted = false;
    const mustAbort = function(v) {
        if ( aborted ) { return true; }
        aborted = v !== undefined && cValue !== undefined && typeof v !== typeof cValue;
        return aborted;
    };
    const makeProxy = function(owner, chain) {
        const pos = chain.indexOf('.');
        if ( pos === -1 ) {
            const original = owner[chain];
            if ( mustAbort(original) ) { return; }
            const desc = Object.getOwnPropertyDescriptor(owner, chain);
            if ( desc === undefined || desc.get === undefined ) {
                Object.defineProperty(owner, chain, {
                    get: function() {
                        return document.currentScript === thisScript
                            ? original
                            : cValue;
                    },
                    set: function(a) {
                        if ( mustAbort(a) ) {
                            cValue = a;
                        }
                    }
                });
            }
            return;
        }
        const prop = chain.slice(0, pos);
        let v = owner[prop];
        chain = chain.slice(pos + 1);
        if ( v !== undefined ) {
            makeProxy(v, chain);
            return;
        }
        const desc = Object.getOwnPropertyDescriptor(owner, prop);
        if ( desc && desc.set !== undefined ) { return; }
        Object.defineProperty(owner, prop, {
            get: function() {
                return v;
            },
            set: function(a) {
                v = a;
                if ( a instanceof Object ) {
                    makeProxy(a, chain);
                }
            }
        });
    };
    makeProxy(window, '{{1}}');
})();


/// setInterval-defuser.js
/// alias sid.js
(function() {
    let needle = '{{1}}';
    const delay = parseInt('{{2}}', 10);
    if ( needle === '' || needle === '{{1}}' ) {
        needle = '.?';
    } else if ( needle.startsWith('/') && needle.endsWith('/') ) {
        needle = needle.slice(1,-1);
    } else {
        needle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    needle = new RegExp(needle);
    window.setInterval = new Proxy(window.setInterval, {
        apply: function(target, thisArg, args) {
            const a = args[0];
            const b = args[1];
            if ( (isNaN(delay) || b === delay) && needle.test(a.toString()) ) {
                args[0] = function(){};
            }
            return target.apply(thisArg, args);
        }
    });
})();


/// no-setInterval-if.js
/// alias nosiif.js
(function() {
    let needle = '{{1}}';
    const needleNot = needle.charAt(0) === '!';
    if ( needleNot ) { needle = needle.slice(1); }
    let delay = '{{2}}';
    const delayNot = delay.charAt(0) === '!';
    if ( delayNot ) { delay = delay.slice(1); }
    delay = parseInt(delay, 10);
    if ( needle === '' || needle === '{{1}}' ) {
        needle = '';
    } else if ( needle.startsWith('/') && needle.endsWith('/') ) {
        needle = needle.slice(1,-1);
    } else {
        needle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    const log = needleNot === false && needle === '' &&
                delayNot === false && isNaN(delay)
        ? console.log
        : undefined;
    const reNeedle = new RegExp(needle);
    window.setInterval = new Proxy(window.setInterval, {
        apply: function(target, thisArg, args) {
            const a = String(args[0]);
            const b = args[1];
            let defuse = false;
            if ( log !== undefined ) {
                log('uBO: setInterval("%s", %s)', a, b);
            } else if ( isNaN(delay) ) {
                defuse = reNeedle.test(a) !== needleNot;
            } else if ( needle === '' ) {
                defuse = (b === delay) !== delayNot;
            } else {
                defuse = reNeedle.test(a) !== needleNot && (b === delay) !== delayNot;
            }
            if ( defuse ) {
                args[0] = function(){};
            }
            return target.apply(thisArg, args);
        }
    });
})();


/// setTimeout-defuser.js
/// alias std.js
(function() {
    let needle = '{{1}}';
    const delay = parseInt('{{2}}', 10);
    if ( needle === '' || needle === '{{1}}' ) {
        needle = '.?';
    } else if ( needle.startsWith('/') && needle.endsWith('/') ) {
        needle = needle.slice(1,-1);
    } else {
        needle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    needle = new RegExp(needle);
    window.setTimeout = new Proxy(window.setTimeout, {
        apply: function(target, thisArg, args) {
            const a = args[0];
            const b = args[1];
            if ( (isNaN(delay) || b === delay) && needle.test(a.toString()) ) {
                args[0] = function(){};
            }
            return target.apply(thisArg, args);
        }
    });
})();


/// no-setTimeout-if.js
/// alias nostif.js
(function() {
    let needle = '{{1}}';
    const needleNot = needle.charAt(0) === '!';
    if ( needleNot ) { needle = needle.slice(1); }
    let delay = '{{2}}';
    const delayNot = delay.charAt(0) === '!';
    if ( delayNot ) { delay = delay.slice(1); }
    delay = parseInt(delay, 10);
    if ( needle === '' || needle === '{{1}}' ) {
        needle = '';
    } else if ( needle.startsWith('/') && needle.endsWith('/') ) {
        needle = needle.slice(1,-1);
    } else {
        needle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    const log = needleNot === false && needle === '' &&
                delayNot === false && isNaN(delay)
        ? console.log
        : undefined;
    const reNeedle = new RegExp(needle);
    window.setTimeout = new Proxy(window.setTimeout, {
        apply: function(target, thisArg, args) {
            const a = String(args[0]);
            const b = args[1];
            let defuse = false;
            if ( log !== undefined ) {
                log('uBO: setTimeout("%s", %s)', a, b);
            } else if ( isNaN(delay) ) {
                defuse = reNeedle.test(a) !== needleNot;
            } else if ( needle === '' ) {
                defuse = (b === delay) !== delayNot;
            } else {
                defuse = reNeedle.test(a) !== needleNot && (b === delay) !== delayNot;
            }
            if ( defuse ) {
                args[0] = function(){};
            }
            return target.apply(thisArg, args);
        }
    });
})();


/// webrtc-if.js
(function() {
    let good = '{{1}}';
    if ( good.startsWith('/') && good.endsWith('/') ) {
        good = good.slice(1, -1);
    } else {
        good = good.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    let reGood;
    try {
        reGood = new RegExp(good);
    } catch(ex) {
        return;
    }
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
                    log(args[1]);
                    return Reflect.apply(target, thisArg, args.slice(0, 1));
                }
                return Reflect.apply(target, thisArg, args);
            },
        });
    window[rtcName] =
        new Proxy(peerConnectionCtor, {
            construct: function(target, args) {
                if ( isGoodConfig(target, args[0]) === false ) {
                    log(args[0]);
                    return Reflect.construct(target);
                }
                return Reflect.construct(target, args);
            }
        });
})();


// https://github.com/gorhill/uBlock/issues/1228
/// window.name-defuser
(function() {
    if ( window === window.top ) {
        window.name = '';
    }
})();


// Experimental: Generic nuisance overlay buster.
// if this works well and proves to be useful, this may end up
// as a stock tool in uBO's popup panel.
/// overlay-buster.js
(function() {
    if ( window !== window.top ) {
        return;
    }
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
})();


// https://github.com/uBlockOrigin/uAssets/issues/8
/// alert-buster.js
(function() {
    window.alert = function(a) {
        console.info(a);
    };
})();


// https://github.com/uBlockOrigin/uAssets/issues/58
/// gpt-defuser.js
(function() {
    const noopfn = function() {
    };
    let props = '_resetGPT resetGPT resetAndLoadGPTRecovery _resetAndLoadGPTRecovery setupGPT setupGPTuo';
    props = props.split(/\s+/);
    while ( props.length ) {
        var prop = props.pop();
        if ( typeof window[prop] === 'function' ) {
            window[prop] = noopfn;
        } else {
            Object.defineProperty(window, prop, {
                get: function() { return noopfn; },
                set: noopfn
            });
        }
    }
})();


// Prevent web pages from using RTCPeerConnection(), and report attempts in console.
/// nowebrtc.js
(function() {
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
})();


// https://github.com/uBlockOrigin/uAssets/issues/88
/// golem.de.js
(function() {
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
})();


// https://forums.lanik.us/viewtopic.php?f=64&t=32278
// https://www.reddit.com/r/chrome/comments/58eix6/ublock_origin_not_working_on_certain_sites/
/// upmanager-defuser.js
(function() {
    var onerror = window.onerror;
    window.onerror = function(msg, source, lineno, colno, error) {
        if ( typeof msg === 'string' && msg.indexOf('upManager') !== -1 ) {
            return true;
        }
        if ( onerror instanceof Function ) {
            onerror.call(window, msg, source, lineno, colno, error);
        }
    };
    Object.defineProperty(window, 'upManager', { value: function() {} });
})();


// https://github.com/uBlockOrigin/uAssets/issues/110
/// smartadserver.com.js
(function() {
    Object.defineProperties(window, {
        SmartAdObject: { value: function(){} },
        SmartAdServerAjax: { value: function(){} },
        smartAd: { value: { LoadAds: function() {}, Register: function() {} } }
    });
})();


// https://github.com/reek/anti-adblock-killer/issues/3774#issuecomment-348536138
// https://github.com/uBlockOrigin/uAssets/issues/883
/// adfly-defuser.js
(function() {
    // Based on AdsBypasser
    // License:
    //   https://github.com/adsbypasser/adsbypasser/blob/master/LICENSE
    var isDigit = /^\d$/;
    var handler = function(encodedURL) {
        var var1 = "", var2 = "", i;
        for (i = 0; i < encodedURL.length; i++) {
            if (i % 2 === 0) {
                var1 = var1 + encodedURL.charAt(i);
            } else {
                var2 = encodedURL.charAt(i) + var2;
            }
        }
        var data = (var1 + var2).split("");
        for (i = 0; i < data.length; i++) {
            if (isDigit.test(data[i])) {
                for (var ii = i + 1; ii < data.length; ii++) {
                    if (isDigit.test(data[ii])) {
                        var temp = parseInt(data[i],10) ^ parseInt(data[ii],10);
                        if (temp < 10) {
                            data[i] = temp.toString();
                        }
                        i = ii;
                        break;
                    }
                }
            }
        }
        data = data.join("");
        var decodedURL = window.atob(data).slice(16, -16);
        window.stop();
        window.onbeforeunload = null;
        window.location.href = decodedURL;
    };
    try {
        var val;
        var flag = true;
        window.Object.defineProperty(window, "ysmm", {
            configurable: false,
            set: function(value) {
                if (flag) {
                    flag = false;
                    try {
                        if (typeof value === "string") {
                            handler(value);
                        }
                    } catch (err) { }
                }
                val = value;
            },
            get: function() {
                return val;
            }
        });
    } catch (err) {
        window.console.error("Failed to set up Adfly bypasser!");
    }
})();


// https://github.com/uBlockOrigin/uAssets/issues/913
/// disable-newtab-links.js
(function() {
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
})();


/// damoh-defuser.js
(function() {
    var handled = new WeakSet();
    var asyncTimer;
    var cleanVideo = function() {
        asyncTimer = undefined;
        var v = document.querySelector('video');
        if ( v === null ) { return; }
        if ( handled.has(v) ) { return; }
        handled.add(v);
        v.pause();
        v.controls = true;
        var el = v.querySelector('meta[itemprop="contentURL"][content]');
        if ( el === null ) { return; }
        v.src = el.getAttribute('content');
        el = v.querySelector('meta[itemprop="thumbnailUrl"][content]');
        if ( el !== null ) { v.poster = el.getAttribute('content'); }
    };
    var cleanVideoAsync = function() {
        if ( asyncTimer !== undefined ) { return; }
        asyncTimer = window.requestAnimationFrame(cleanVideo);
    };
    var observer = new MutationObserver(cleanVideoAsync);
    observer.observe(document.documentElement, { childList: true, subtree: true });
})();


// https://github.com/uBlockOrigin/uAssets/pull/3517
/// twitch-videoad.js
(function() {
    if ( /(^|\.)twitch\.tv$/.test(document.location.hostname) === false ) { return; }
    var realFetch = window.fetch;
    window.fetch = function(input) {
        if ( arguments.length >= 2 && typeof input === 'string' && input.includes('/access_token') ) {
            var url = new URL(arguments[0]);
            url.searchParams.set('platform', '_');
            arguments[0] = url.href;
        }
        return realFetch.apply(this, arguments);
    };
})();


// https://github.com/uBlockOrigin/uAssets/issues/2912
/// fingerprint2.js
(function() {
    let fp2 = function(){};
    fp2.prototype = {
        get: function(cb) {
            setTimeout(function() { cb('', []); }, 1);
        }
    };
    window.Fingerprint2 = fp2;
})();


// https://github.com/NanoAdblocker/NanoFilters/issues/149
/// cookie-remover.js
(function() {
    let needle = '{{1}}',
        reName = /./;
    if ( /^\/.+\/$/.test(needle) ) {
        reName = new RegExp(needle.slice(1,-1));
    } else if ( needle !== '' && needle !== '{{1}}' ) {
        reName = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
    let removeCookie = function() {
        document.cookie.split(';').forEach(cookieStr => {
            let pos = cookieStr.indexOf('=');
            if ( pos === -1 ) { return; }
            let cookieName = cookieStr.slice(0, pos).trim();
            if ( !reName.test(cookieName) ) { return; }
            let part1 = cookieName + '=';
            let part2a = '; domain=' + document.location.hostname;
            let part2b = '; domain=.' + document.location.hostname;
            let domain = document.domain;
            let part2c = domain && domain !== document.location.hostname ? '; domain=.' + domain : undefined;
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
        });
    };
    removeCookie();
    window.addEventListener('beforeunload', removeCookie);
})();





// These lines below are skipped by the resource parser.
// <<<< end of private namespace
})();

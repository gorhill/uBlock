/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2026-present Fanboynz

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

    Surrogate for the Transcend consent manager banner, served from
    transcend-cdn.com/cm<tenant>/<build>/ui.js and uiV2.js, and from the
    first-party path some tenants host it on.

    Transcend ships in two halves, and which one this replaces matters.
    airgap.js is the engine: it carries the tenant's whole configuration -
    the purposes, the cookie-to-purpose table, the allowed hosts - and it
    blocks requests and cookies itself, by consent, and owns the tcm cookie.
    It is left alone, because with a refusal recorded it is the thing
    enforcing that refusal. ui.js is the banner, 390 kB of Preact, fetched
    only once airgap has decided to prompt, and nothing is expected back from
    it - so a stub that renders nothing is a banner that never appears.

    The refusal is recorded through airgap's own API rather than faked:
    getConsent() gives the tenant's purpose names, whatever they are called,
    and every one is set to false through setConsent(). Their setConsent
    wants a trusted event where the tenant leaves requireAuth on, which is
    the default, so the page's own load event is waited for and handed in -
    their path for a decision nobody clicked. Where the page has already
    loaded by the time this runs, the refusal is written to their tcm cookie
    instead, which is read on the next page. The console line says which way
    it went: setConsent, load or cookie.

    Built from src/transcend/ in https://github.com/ryanbr/consent-rr, which
    carries the commented source and the tests. The body below is that repo's
    single-file build, which is the artefact those tests run against.

*/

(function() {
    'use strict';
function consentRRWhenPresent(w, probes, run) {
    'use strict';
    const names = Array.isArray(probes.globals) ? probes.globals : [];
    const held = name => {
        try {
            const value = w[name];
            if ( value === null || value === undefined ) { return undefined; }
            if ( typeof value !== 'object' && typeof value !== 'function' ) {
                return undefined;
            }
            return value;
        } catch ( ex ) {
        }
        return undefined;
    };
    for ( const name of names ) {
        const already = held(name);
        if ( already !== undefined ) {
            run(name, already);
            return;
        }
    }
    try {
        const current = w.document.currentScript;
        if ( current !== null && current !== undefined ) {
            if ( String(current.src || '') !== '' ) {
                run('', undefined);
                return;
            }
        }
    } catch ( ex ) {
    }
    let done = false;
    const once = (name, value) => {
        if ( done ) { return; }
        done = true;
        run(name, value);
    };
    for ( const name of names ) {
        let waiting;
        try {
            const own = Object.getOwnPropertyDescriptor(w, name);
            if ( own !== undefined && own.configurable === false ) { continue; }
            Object.defineProperty(w, name, {
                configurable: true,
                enumerable: true,
                get: function() { return waiting; },
                set: function(value) {
                    waiting = value;
                    try {
                        Object.defineProperty(w, name, {
                            value: value,
                            writable: true,
                            enumerable: true,
                            configurable: true,
                        });
                    } catch ( ex ) {
                    }
                    if ( value === null || value === undefined ) { return; }
                    if (
                        typeof value !== 'object' &&
                        typeof value !== 'function'
                    ) {
                        return;
                    }
                    once(name, value);
                },
            });
        } catch ( ex ) {
        }
    }
}
function consentRRTranscend() {
    const w = self;
    const doc = w.document;
    const VERSION = '1.5.4';
    const NAME = 'transcend-reject';
    const BASE_COOKIE = 'tcm';
    const existing = w.airgap;
    if ( existing !== null && typeof existing === 'object' ) {
        if ( existing.consentRR !== undefined ) { return; }
    }
    let SERVED_AS_FILE = false;
    try {
        const current = doc.currentScript;
        if ( current !== null && current !== undefined ) {
            SERVED_AS_FILE = String(current.src || '') !== '';
        }
    } catch(ex) {
    }
    const readCookie = name => {
        const pairs = String(doc.cookie).split(';');
        for ( const pair of pairs ) {
            const pos = pair.indexOf('=');
            if ( pos === -1 ) { continue; }
            if ( pair.slice(0, pos).trim() !== name ) { continue; }
            return pair.slice(pos + 1).trim();
        }
        return undefined;
    };
    const option = name => {
        try {
            const held = w.airgap.loadOptions;
            if ( held === null || typeof held !== 'object' ) { return undefined; }
            return held[name];
        } catch(ex) {
        }
        return undefined;
    };
    let cookieDomain;
    const findCookieDomain = ( ) => {
        const host = String(w.location.hostname);
        if ( host === '' ) { return ''; }
        if ( host.charAt(0) === '[' ) { return ''; }
        if ( /^[\d.]+$/.test(host) ) { return ''; }
        const labels = host.split('.');
        const probe = 'consentRRProbe';
        for ( let i = labels.length - 2; i >= 0; i-- ) {
            const candidate = labels.slice(i).join('.');
            try {
                doc.cookie = probe + '=1; path=/; domain=' + candidate;
                if ( readCookie(probe) !== '1' ) { continue; }
                doc.cookie = probe + '=; path=/; max-age=0; domain=' + candidate;
                return candidate;
            } catch(ex) {
            }
        }
        return '';
    };
    const record = (purposes, prompted) => {
        const held = {
            purposes,
            timestamp: new Date().toISOString(),
            confirmed: true,
        };
        if ( prompted === true ) { held.prompted = true; }
        held.updated = false;
        return JSON.stringify(held);
    };
    const cookieName = ( ) => {
        const partition = String(option('partition') || '');
        return partition !== ''
            ? BASE_COOKIE + '-' + partition
            : BASE_COOKIE;
    };
    const writeCookie = value => {
        const COOKIE = cookieName();
        if ( cookieDomain === undefined ) {
            try {
                cookieDomain = findCookieDomain();
            } catch(ex) {
                cookieDomain = '';
            }
        }
        const secure = w.location.protocol === 'https:' ? '; secure' : '';
        const attributes = '; path=/; max-age=31536000; samesite=lax' + secure;
        try {
            if ( cookieDomain !== '' ) {
                doc.cookie = COOKIE + '=; path=/; max-age=0';
                doc.cookie = COOKIE + '=' + value + attributes +
                    '; domain=' + cookieDomain;
                if ( readCookie(COOKIE) === value ) { return true; }
            }
            doc.cookie = COOKIE + '=' + value + attributes;
            return readCookie(COOKIE) === value;
        } catch(ex) {
        }
        return false;
    };
    let spoke = false;
    const storageRecord = value => {
        const partition = String(option('partition') || '');
        const key = 'tcm' + (partition !== '' ? 'MP' : '') + 'Consent';
        let payload = value;
        if ( partition !== '' ) {
            let held = {};
            try {
                const raw = w.localStorage.getItem(key);
                if ( typeof raw === 'string' && raw !== '' ) {
                    const parsed = JSON.parse(raw);
                    if ( parsed !== null && typeof parsed === 'object' ) {
                        held = parsed;
                    }
                }
            } catch(ex) {
                held = {};
            }
            try {
                held[partition] = JSON.parse(value);
                payload = JSON.stringify(held);
            } catch(ex) {
                return false;
            }
        }
        try {
            w.localStorage.setItem(key, payload);
            return w.localStorage.getItem(key) === payload;
        } catch(ex) {
        }
        return false;
    };
    const store = (purposes, prompted) => {
        const value = record(purposes, prompted);
        const inStorage = storageRecord(value);
        const inCookie = String(option('localSync') || '') !== 'private-only'
            ? writeCookie(value)
            : false;
        if ( inCookie && inStorage ) { return 'cookie+storage'; }
        if ( inCookie ) { return 'cookie'; }
        if ( inStorage ) { return 'storage'; }
        return '';
    };
    const announce = (names, how) => {
        spoke = true;
        if ( typeof console !== 'object' ) { return; }
        if ( typeof console.info !== 'function' ) { return; }
        console.info(
            '[consent-rr] ' + NAME + ' ' + VERSION +
            ' refused=' + (names.length !== 0 ? names.join(',') : '(none)') +
            ' via=' + how
        );
    };
    let readied = false;
    const refuse = airgap => {
        readied = true;
        let purposes = {};
        try {
            const consent = airgap.getConsent();
            if ( consent !== null && typeof consent === 'object' ) {
                if ( consent.purposes !== null && typeof consent.purposes === 'object' ) {
                    purposes = consent.purposes;
                }
            }
        } catch(ex) {
        }
        const refused = {};
        for ( const name of Object.keys(purposes) ) { refused[name] = false; }
        const names = Object.keys(refused);
        if ( names.length === 0 ) {
            announce(names, 'nothing to refuse');
            return;
        }
        const options = ( ) => {
            const held = {
                confirmed: true,
                timestamp: new Date().toISOString(),
            };
            if ( SERVED_AS_FILE ) { held.prompted = true; }
            return held;
        };
        const record = auth => {
            try {
                return airgap.setConsent(auth, refused, options()) !== false;
            } catch(ex) {
            }
            return false;
        };
        const authOff = option('requireAuth') === 'off';
        if ( authOff && record(null) ) {
            announce(names, 'setConsent');
            return;
        }
        if ( doc.readyState !== 'complete' ) {
            w.addEventListener('load', ev => {
                if ( record(ev) ) {
                    announce(names, 'load');
                    return;
                }
                announce(names,
                    store(refused, SERVED_AS_FILE) || 'no store');
            }, { once: true });
            return;
        }
        announce(names, store(refused, SERVED_AS_FILE) || 'no store');
    };
    const start = ( ) => {
        try {
            w.airgap.consentRR = { mode: 'reject', version: VERSION };
        } catch(ex) {
        }
        try {
            w.airgap.ready(refuse);
        } catch(ex) {
        }
        arm();
    };
    const preludeRefusal = ( ) => {
        const out = {};
        let types;
        try {
            const held = w.airgap.purposes;
            if ( held === null || typeof held !== 'object' ) { return out; }
            types = held.types;
        } catch(ex) {
            return out;
        }
        if ( types === null || typeof types !== 'object' ) { return out; }
        for ( const name of Object.keys(types) ) {
            const entry = types[name];
            if ( entry === null || typeof entry !== 'object' ) { continue; }
            if ( entry.essential === true ) { continue; }
            if ( entry.configurable === false ) { continue; }
            out[name] = false;
        }
        return out;
    };
    const WITHOUT_THEIRS = [
        'Advertising',
        'Analytics',
        'BrowserCookies',
        'EnrichmentConsent',
        'Functional',
        'Marketing',
        'SaleOfInfo',
        'Sales',
    ];
    const theirMarkers = ( ) => {
        try {
            const held = w.airgap;
            if ( held === null || typeof held !== 'object' ) { return false; }
            if ( typeof held.getConsent === 'function' ) { return true; }
            if ( typeof held.setConsent === 'function' ) { return true; }
            const purposes = held.purposes;
            return purposes !== null && typeof purposes === 'object';
        } catch(ex) {
        }
        return false;
    };
    const withoutTheirs = ( ) => {
        if ( theirMarkers() ) { return false; }
        if ( SERVED_AS_FILE ) { return true; }
        try {
            return w.airgap === null || typeof w.airgap !== 'object';
        } catch(ex) {
        }
        return true;
    };
    const GRACE = 1000;
    const watch = ( ) => {
        if ( spoke ) { return; }
        const why = readied ? 'no record' : 'no engine';
        const refused = preludeRefusal();
        let names = Object.keys(refused);
        if ( names.length === 0 && withoutTheirs() ) {
            for ( const name of WITHOUT_THEIRS ) {
                refused[name] = false;
            }
            names = Object.keys(refused);
        }
        if ( names.length === 0 ) {
            announce(names, why);
            return;
        }
        const where = store(refused, false);
        announce(names, where !== '' ? where + ', ' + why : why);
    };
    const arm = ( ) => {
        try {
            if ( doc.readyState === 'complete' ) {
                w.setTimeout(watch, GRACE);
            } else {
                w.addEventListener('load', ( ) => {
                    w.setTimeout(watch, GRACE);
                }, { once: true });
            }
        } catch(ex) {
        }
    };
    consentRRWhenPresent(w, { globals: [ 'airgap' ] }, start);
}
    consentRRTranscend();
})();

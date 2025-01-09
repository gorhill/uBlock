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

import {
    domainFromHostname,
    hostnameFromNetworkURL,
} from './uri-utils.js';

/******************************************************************************/

const dnsAPI = browser.dns || {
    resolve() {
        return Promise.resolve();
    }
};

const isPromise = o => o instanceof Promise;
const isResolvedObject = o => o instanceof Object &&
    o instanceof Promise === false;
const reIPv4 = /^\d+\.\d+\.\d+\.\d+$/
const skipDNS = proxyInfo =>
    proxyInfo && (proxyInfo.proxyDNS || proxyInfo.type?.charCodeAt(0) === 0x68 /* h */);

/******************************************************************************/

// Related issues:
// - https://github.com/gorhill/uBlock/issues/1327
// - https://github.com/uBlockOrigin/uBlock-issues/issues/128
// - https://bugzilla.mozilla.org/show_bug.cgi?id=1503721

// Extend base class to normalize as per platform.

vAPI.Net = class extends vAPI.Net {
    constructor() {
        super();
        this.pendingRequests = [];
        this.dnsList = [];          // ring buffer
        this.dnsWritePtr = 0;       // next write pointer in ring buffer
        this.dnsMaxCount = 512;     // max size of ring buffer
        this.dnsDict = new Map();   // hn to index in ring buffer
        this.dnsCacheTTL = 600;     // TTL in seconds
        this.canUncloakCnames = true;
        this.cnameUncloakEnabled = true;
        this.cnameIgnoreList = null;
        this.cnameIgnore1stParty = true;
        this.cnameIgnoreExceptions = true;
        this.cnameIgnoreRootDocument = true;
        this.cnameReplayFullURL = false;
        this.dnsResolveEnabled = true;
    }

    setOptions(options) {
        super.setOptions(options);
        if ( 'cnameUncloakEnabled' in options ) {
            this.cnameUncloakEnabled =
                options.cnameUncloakEnabled !== false;
        }
        if ( 'cnameIgnoreList' in options ) {
            this.cnameIgnoreList =
                this.regexFromStrList(options.cnameIgnoreList);
        }
        if ( 'cnameIgnore1stParty' in options ) {
            this.cnameIgnore1stParty =
                options.cnameIgnore1stParty !== false;
        }
        if ( 'cnameIgnoreExceptions' in options ) {
            this.cnameIgnoreExceptions =
                options.cnameIgnoreExceptions !== false;
        }
        if ( 'cnameIgnoreRootDocument' in options ) {
            this.cnameIgnoreRootDocument =
                options.cnameIgnoreRootDocument !== false;
        }
        if ( 'cnameReplayFullURL' in options ) {
            this.cnameReplayFullURL = options.cnameReplayFullURL === true;
        }
        if ( 'dnsCacheTTL' in options ) {
            this.dnsCacheTTL = options.dnsCacheTTL;
        }
        if ( 'dnsResolveEnabled' in options ) {
            this.dnsResolveEnabled = options.dnsResolveEnabled === true;
        }
        this.dnsList.fill(null);
        this.dnsDict.clear();
    }

    normalizeDetails(details) {
        // https://github.com/uBlockOrigin/uBlock-issues/issues/3379
        if ( skipDNS(details.proxyInfo) && details.ip === '0.0.0.0' ) {
            details.ip = null;
        }
        const type = details.type;
        if ( type === 'imageset' ) {
            details.type = 'image';
            return;
        }
        if ( type !== 'object' ) { return; }
        // Try to extract type from response headers if present.
        if ( details.responseHeaders === undefined ) { return; }
        const ctype = this.headerValue(details.responseHeaders, 'content-type');
        // https://github.com/uBlockOrigin/uBlock-issues/issues/345
        //   Re-categorize an embedded object as a `sub_frame` if its
        //   content type is that of a HTML document.
        if ( ctype === 'text/html' ) {
            details.type = 'sub_frame';
        }
    }

    denormalizeTypes(types) {
        if ( types.length === 0 ) {
            return Array.from(this.validTypes);
        }
        const out = new Set();
        for ( const type of types ) {
            if ( this.validTypes.has(type) ) {
                out.add(type);
            }
            if ( type === 'image' && this.validTypes.has('imageset') ) {
                out.add('imageset');
            }
            if ( type === 'sub_frame' ) {
                out.add('object');
            }
        }
        return Array.from(out);
    }

    canonicalNameFromHostname(hn) {
        if ( hn === '' ) { return; }
        const dnsEntry = this.dnsFromCache(hn, true);
        if ( isResolvedObject(dnsEntry) === false ) { return; }
        return dnsEntry.cname;
    }

    regexFromStrList(list) {
        if ( typeof list !== 'string' || list.length === 0 || list === 'unset' ) {
            return null;
        }
        if ( list === '*' ) { return /^./; }
        return new RegExp(
            '(?:^|\\.)(?:' +
            list.trim()
                .split(/\s+/)
                .map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                .join('|') +
            ')$'
        );
    }

    onBeforeSuspendableRequest(details) {
        const hn = hostnameFromNetworkURL(details.url);
        const dnsEntry = this.dnsFromCache(hn);
        if ( isResolvedObject(dnsEntry) && dnsEntry.ip ) {
            details.ip = dnsEntry.ip;
        }
        const r = super.onBeforeSuspendableRequest(details);
        if ( r !== undefined ) {
            if (
                r.cancel === true ||
                r.redirectUrl !== undefined ||
                this.cnameIgnoreExceptions
            ) {
                return r;
            }
        }
        if ( isResolvedObject(dnsEntry) ) {
            return this.onAfterDNSResolution(hn, details, dnsEntry);
        }
        if ( skipDNS(details.proxyInfo) ) { return; }
        if ( this.dnsShouldResolve(hn) === false ) { return; }
        const promise = dnsEntry || this.dnsResolve(hn, details);
        return promise.then(( ) => this.onAfterDNSResolution(hn, details));
    }

    onAfterDNSResolution(hn, details, dnsEntry) {
        if ( dnsEntry === undefined ) {
            dnsEntry = this.dnsFromCache(hn);
            if ( isResolvedObject(dnsEntry) === false ) { return; }
        }
        let proceed = false;
        if ( dnsEntry.cname && this.cnameUncloakEnabled ) {
            const newURL = this.uncloakURL(hn, dnsEntry, details);
            if ( newURL ) {
                details.aliasURL = details.url;
                details.url = newURL;
                proceed = true;
            }
        }
        if ( dnsEntry.ip && details.ip !== dnsEntry.ip ) {
            details.ip = dnsEntry.ip
            proceed = true;
        }
        if ( proceed === false ) { return; }
        // Must call method on base class
        return super.onBeforeSuspendableRequest(details);
    }

    dnsToCache(hn, record, details) {
        const dnsEntry = { hn, until: Date.now() + this.dnsCacheTTL * 1000 };
        if ( record ) {
            const cname = this.cnameFromRecord(hn, record, details);
            if ( cname ) { dnsEntry.cname = cname; }
            const ip = this.ipFromRecord(record);
            if ( ip ) { dnsEntry.ip = ip; }
        }
        this.dnsSetCache(-1, hn, dnsEntry);
        return dnsEntry;
    }

    dnsFromCache(hn, passive = false) {
        const i = this.dnsDict.get(hn);
        if ( i === undefined ) { return; }
        if ( isPromise(i) ) { return i; }
        const dnsEntry = this.dnsList[i];
        if ( dnsEntry !== null && dnsEntry.hn === hn ) {
            if ( passive || dnsEntry.until >= Date.now() ) {
                return dnsEntry;
            }
        }
        this.dnsSetCache(i);
    }

    dnsSetCache(i, hn, after) {
        if ( i < 0 ) {
            const j = this.dnsDict.get(hn);
            if ( typeof j === 'number' ) {
                this.dnsList[j] = after;
                return;
            }
            i = this.dnsWritePtr++;
            this.dnsWritePtr %= this.dnsMaxCount;
        }
        const before = this.dnsList[i];
        if ( before ) {
            this.dnsDict.delete(before.hn);
        }
        if ( after ) {
            this.dnsDict.set(hn, i);
            this.dnsList[i] = after;
        } else {
            if ( hn ) { this.dnsDict.delete(hn); }
            this.dnsList[i] = null;
        }
    }

    dnsShouldResolve(hn) {
        if ( this.dnsResolveEnabled === false ) { return false; }
        if ( hn === '' ) { return false; }
        const c0 = hn.charCodeAt(0);
        if ( c0 === 0x5B /* [ */ ) { return false; }
        if ( c0 > 0x39 /* 9 */ ) { return true; }
        return reIPv4.test(hn) === false;
    }

    dnsResolve(hn, details) {
        const promise = dnsAPI.resolve(hn, [ 'canonical_name' ]).then(
            rec => this.dnsToCache(hn, rec, details),
            ( ) => this.dnsToCache(hn)
        );
        this.dnsDict.set(hn, promise);
        return promise;
    }

    cnameFromRecord(hn, record, details) {
        const cn = record.canonicalName;
        if ( cn === undefined ) { return; }
        if ( cn === hn ) { return; }
        if ( this.cnameIgnore1stParty ) {
            if ( domainFromHostname(cn) === domainFromHostname(hn) ) { return; }
        }
        if ( this.cnameIgnoreList !== null ) {
            if ( this.cnameIgnoreList.test(cn) === false ) { return; }
        }
        if ( this.cnameIgnoreRootDocument ) {
            const origin = hostnameFromNetworkURL(details.documentUrl || details.url);
            if ( hn === origin ) { return; }
        }
        return cn;
    }

    uncloakURL(hn, dnsEntry, details) {
        const hnBeg = details.url.indexOf(hn);
        if ( hnBeg === -1 ) { return; }
        const oldURL = details.url;
        const newURL = oldURL.slice(0, hnBeg) + dnsEntry.cname;
        const hnEnd = hnBeg + hn.length;
        if ( this.cnameReplayFullURL ) {
            return newURL + oldURL.slice(hnEnd);
        }
        const pathBeg = oldURL.indexOf('/', hnEnd);
        if ( pathBeg !== -1 ) {
            return newURL + oldURL.slice(hnEnd, pathBeg + 1);
        }
        return newURL;
    }

    ipFromRecord(record) {
        const { addresses } = record;
        if ( Array.isArray(addresses) === false ) { return; }
        if ( addresses.length === 0 ) { return; }
        return addresses.join('\n');
    }

    suspendOneRequest(details) {
        const pending = {
            details: Object.assign({}, details),
            resolve: undefined,
            promise: undefined
        };
        pending.promise = new Promise(resolve => {
            pending.resolve = resolve;
        });
        this.pendingRequests.push(pending);
        return pending.promise;
    }

    unsuspendAllRequests(discard = false) {
        const pendingRequests = this.pendingRequests;
        this.pendingRequests = [];
        for ( const entry of pendingRequests ) {
            entry.resolve(
                discard !== true
                    ? this.onBeforeSuspendableRequest(entry.details)
                    : undefined
            );
        }
    }

    static canSuspend() {
        return true;
    }
};

/******************************************************************************/

vAPI.scriptletsInjector = (( ) => {
    const parts = [
        '(',
        function(details) {
            if ( typeof self.uBO_scriptletsInjected === 'string' ) { return; }
            const doc = document;
            const { location } = doc;
            if ( location === null ) { return; }
            const { hostname } = location;
            if ( hostname !== '' && details.hostname !== hostname ) { return; }
            // Use a page world sentinel to verify that execution was
            // successful
            const { sentinel } = details;
            let script;
            try {
                const code = [
                    `self['${sentinel}'] = true;`,
                    details.scriptlets,
                ].join('\n');
                script = doc.createElement('script');
                script.appendChild(doc.createTextNode(code));
                (doc.head || doc.documentElement).appendChild(script);
            } catch {
            }
            if ( script ) {
                script.remove();
                script.textContent = '';
                script = undefined;
            }
            if ( self.wrappedJSObject[sentinel] ) {
                delete self.wrappedJSObject[sentinel];
                self.uBO_scriptletsInjected = details.filters;
                return 0;
            }
            // https://github.com/uBlockOrigin/uBlock-issues/issues/235
            //   Fall back to blob injection if execution through direct
            //   injection failed
            let url;
            try {
                const blob = new self.Blob(
                    [ details.scriptlets ],
                    { type: 'text/javascript; charset=utf-8' }
                );
                url = self.URL.createObjectURL(blob);
                script = doc.createElement('script');
                script.async = false;
                script.src = url;
                (doc.head || doc.documentElement || doc).append(script);
                self.uBO_scriptletsInjected = details.filters;
            } catch {
            }
            if ( url ) {
                if ( script ) { script.remove(); }
                self.URL.revokeObjectURL(url);
            }
            return 0;
        }.toString(),
        ')(',
            'json-slot',
        ');',
    ];
    const jsonSlot = parts.indexOf('json-slot');
    return (hostname, details) => {
        parts[jsonSlot] = JSON.stringify({
            hostname,
            scriptlets: details.mainWorld,
            filters: details.filters,
            sentinel: vAPI.generateSecret(3),
        });
        return parts.join('');
    };
})();

/******************************************************************************/

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

/* globals browser */

'use strict';

/******************************************************************************/

import {
    domainFromHostname,
    hostnameFromNetworkURL,
} from './uri-utils.js';

/******************************************************************************/

// Canonical name-uncloaking feature.
let cnameUncloakEnabled = browser.dns instanceof Object;
let cnameUncloakProxied = false;

// https://github.com/uBlockOrigin/uBlock-issues/issues/911
//   We detect here whether network requests are proxied, and if so,
//   de-aliasing of hostnames will be disabled to avoid possible
//   DNS leaks.
const proxyDetector = function(details) {
    if ( details.proxyInfo instanceof Object ) {
        cnameUncloakEnabled = false;
        proxyDetectorTryCount = 0;
    }
    if ( proxyDetectorTryCount === 0 ) {
        browser.webRequest.onHeadersReceived.removeListener(proxyDetector);
        return;
    }
    proxyDetectorTryCount -= 1;
};
let proxyDetectorTryCount = 0;

// Related issues:
// - https://github.com/gorhill/uBlock/issues/1327
// - https://github.com/uBlockOrigin/uBlock-issues/issues/128
// - https://bugzilla.mozilla.org/show_bug.cgi?id=1503721

// Extend base class to normalize as per platform.

vAPI.Net = class extends vAPI.Net {
    constructor() {
        super();
        this.pendingRequests = [];
        this.canUncloakCnames = browser.dns instanceof Object;
        this.cnames = new Map([ [ '', null ] ]);
        this.cnameIgnoreList = null;
        this.cnameIgnore1stParty = true;
        this.cnameIgnoreExceptions = true;
        this.cnameIgnoreRootDocument = true;
        this.cnameMaxTTL = 120;
        this.cnameReplayFullURL = false;
        this.cnameFlushTime = Date.now() + this.cnameMaxTTL * 60000;
    }
    setOptions(options) {
        super.setOptions(options);
        if ( 'cnameUncloakEnabled' in options ) {
            cnameUncloakEnabled =
                this.canUncloakCnames &&
                options.cnameUncloakEnabled !== false;
        }
        if ( 'cnameUncloakProxied' in options ) {
            cnameUncloakProxied = options.cnameUncloakProxied === true;
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
        if ( 'cnameMaxTTL' in options ) {
            this.cnameMaxTTL = options.cnameMaxTTL || 120;
        }
        if ( 'cnameReplayFullURL' in options ) {
            this.cnameReplayFullURL = options.cnameReplayFullURL === true;
        }
        this.cnames.clear(); this.cnames.set('', null);
        this.cnameFlushTime = Date.now() + this.cnameMaxTTL * 60000;
        // https://github.com/uBlockOrigin/uBlock-issues/issues/911
        //   Install/remove proxy detector.
        if ( vAPI.webextFlavor.major < 80 ) {
            const wrohr = browser.webRequest.onHeadersReceived;
            if ( cnameUncloakEnabled === false || cnameUncloakProxied ) {
                if ( wrohr.hasListener(proxyDetector) ) {
                    wrohr.removeListener(proxyDetector);
                }
            } else if ( wrohr.hasListener(proxyDetector) === false ) {
                wrohr.addListener(
                    proxyDetector,
                    { urls: [ '*://*/*' ] },
                    [ 'blocking' ]
                );
            }
            proxyDetectorTryCount = 32;
        }
    }
    normalizeDetails(details) {
        const type = details.type;

        if ( type === 'imageset' ) {
            details.type = 'image';
            return;
        }

        // https://github.com/uBlockOrigin/uBlock-issues/issues/345
        //   Re-categorize an embedded object as a `sub_frame` if its
        //   content type is that of a HTML document.
        if ( type === 'object' && Array.isArray(details.responseHeaders) ) {
            for ( const header of details.responseHeaders ) {
                if ( header.name.toLowerCase() === 'content-type' ) {
                    if ( header.value.startsWith('text/html') ) {
                        details.type = 'sub_frame';
                    }
                    break;
                }
            }
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
        const cnRecord = this.cnames.get(hn);
        if ( cnRecord !== undefined && cnRecord !== null ) {
            return cnRecord.cname;
        }
    }
    processCanonicalName(hn, cnRecord, details) {
        if ( cnRecord === null ) { return; }
        if ( cnRecord.isRootDocument ) { return; }
        const hnBeg = details.url.indexOf(hn);
        if ( hnBeg === -1 ) { return; }
        const oldURL = details.url;
        let newURL = oldURL.slice(0, hnBeg) + cnRecord.cname;
        const hnEnd = hnBeg + hn.length;
        if ( this.cnameReplayFullURL ) {
            newURL += oldURL.slice(hnEnd);
        } else {
            const pathBeg = oldURL.indexOf('/', hnEnd);
            if ( pathBeg !== -1 ) {
                newURL += oldURL.slice(hnEnd, pathBeg + 1);
            }
        }
        details.url = newURL;
        details.aliasURL = oldURL;
        return super.onBeforeSuspendableRequest(details);
    }
    recordCanonicalName(hn, record, isRootDocument) {
        if ( (this.cnames.size & 0b111111) === 0 ) {
            const now = Date.now();
            if ( now >= this.cnameFlushTime ) {
                this.cnames.clear(); this.cnames.set('', null);
                this.cnameFlushTime = now + this.cnameMaxTTL * 60000;
            }
        }
        let cname =
            typeof record.canonicalName === 'string' &&
            record.canonicalName !== hn
                ? record.canonicalName
                : '';
        if (
            cname !== '' &&
            this.cnameIgnore1stParty &&
            domainFromHostname(cname) === domainFromHostname(hn)
        ) {
            cname = '';
        }
        if (
            cname !== '' &&
            this.cnameIgnoreList !== null &&
            this.cnameIgnoreList.test(cname)
        ) {
            cname = '';
        }
        const cnRecord = cname !== '' ? { cname, isRootDocument } : null;
        this.cnames.set(hn, cnRecord);
        return cnRecord;
    }
    regexFromStrList(list) {
        if (
            typeof list !== 'string' ||
            list.length === 0 ||
            list === 'unset' ||
            browser.dns instanceof Object === false
        ) {
            return null;
        }
        if ( list === '*' ) {
            return /^./;
        }
        return new RegExp(
            '(?:^|\.)(?:' +
            list.trim()
                .split(/\s+/)
                .map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                .join('|') +
            ')$'
        );
    }
    onBeforeSuspendableRequest(details) {
        const r = super.onBeforeSuspendableRequest(details);
        if ( cnameUncloakEnabled === false ) { return r; }
        if ( r !== undefined ) {
            if (
                r.cancel === true ||
                r.redirectUrl !== undefined ||
                this.cnameIgnoreExceptions
            ) {
                return r;
            }
        }
        const hn = hostnameFromNetworkURL(details.url);
        const cnRecord = this.cnames.get(hn);
        if ( cnRecord !== undefined ) {
            return this.processCanonicalName(hn, cnRecord, details);
        }
        const documentUrl = details.documentUrl || details.url;
        const isRootDocument = this.cnameIgnoreRootDocument &&
            hn === hostnameFromNetworkURL(documentUrl);
        return browser.dns.resolve(hn, [ 'canonical_name' ]).then(
            rec => {
                const cnRecord = this.recordCanonicalName(hn, rec, isRootDocument);
                return this.processCanonicalName(hn, cnRecord, details);
            },
            ( ) => {
                this.cnames.set(hn, null);
            }
        );
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

vAPI.scriptletsInjector = ((doc, details) => {
    let script, url;
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
    } catch (ex) {
    }
    if ( url ) {
        if ( script ) { script.remove(); }
        self.URL.revokeObjectURL(url);
    }
}).toString();

/******************************************************************************/

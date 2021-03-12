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

// For background page

'use strict';

/******************************************************************************/

(( ) => {
    // https://github.com/uBlockOrigin/uBlock-issues/issues/407
    if ( vAPI.webextFlavor.soup.has('firefox') === false ) { return; }

    // https://github.com/gorhill/uBlock/issues/2950
    // Firefox 56 does not normalize URLs to ASCII, uBO must do this itself.
    // https://bugzilla.mozilla.org/show_bug.cgi?id=945240
    const evalMustPunycode = ( ) => {
        return vAPI.webextFlavor.soup.has('firefox') &&
               vAPI.webextFlavor.major < 57;
    };

    let mustPunycode = evalMustPunycode();

    // The real actual webextFlavor value may not be set in stone, so listen
    // for possible future changes.
    window.addEventListener('webextFlavor', ( ) => {
        mustPunycode = evalMustPunycode();
    }, { once: true });

    const punycode = self.punycode;
    const reAsciiHostname  = /^https?:\/\/[0-9a-z_.:@-]+[/?#]/;
    const parsedURL = new URL('about:blank');

    // Canonical name-uncloaking feature.
    let cnameUncloak = browser.dns instanceof Object;
    let cnameUncloakProxied = false;

    // https://github.com/uBlockOrigin/uBlock-issues/issues/911
    //   We detect here whether network requests are proxied, and if so,
    //   de-aliasing of hostnames will be disabled to avoid possible
    //   DNS leaks.
    const proxyDetector = function(details) {
        if ( details.proxyInfo instanceof Object ) {
            cnameUncloak = false;
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
            this.cnames = new Map([ [ '', '' ] ]);
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
            if ( 'cnameUncloak' in options ) {
                cnameUncloak = browser.dns instanceof Object &&
                               options.cnameUncloak !== false;
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
            this.cnames.clear(); this.cnames.set('', '');
            this.cnameFlushTime = Date.now() + this.cnameMaxTTL * 60000;
            // https://github.com/uBlockOrigin/uBlock-issues/issues/911
            //   Install/remove proxy detector.
            if ( vAPI.webextFlavor.major < 80 ) {
                const wrohr = browser.webRequest.onHeadersReceived;
                if ( cnameUncloak === false || cnameUncloakProxied ) {
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
            if ( mustPunycode && !reAsciiHostname.test(details.url) ) {
                parsedURL.href = details.url;
                details.url = details.url.replace(
                    parsedURL.hostname,
                    punycode.toASCII(parsedURL.hostname)
                );
            }

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
            const cn = this.cnames.get(hn);
            if ( cn !== undefined && cn !== '' ) {
                return cn;
            }
        }
        processCanonicalName(hn, cn, details) {
            const hnBeg = details.url.indexOf(hn);
            if ( hnBeg === -1 ) { return; }
            const oldURL = details.url;
            let newURL = oldURL.slice(0, hnBeg) + cn;
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
        recordCanonicalName(hn, record) {
            if ( (this.cnames.size & 0b111111) === 0 ) {
                const now = Date.now();
                if ( now >= this.cnameFlushTime ) {
                    this.cnames.clear(); this.cnames.set('', '');
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
                vAPI.domainFromHostname(cname) === vAPI.domainFromHostname(hn)
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
            this.cnames.set(hn, cname);
            return cname;
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
            if ( cnameUncloak === false ) { return r; }
            if ( r !== undefined ) {
                if (
                    r.cancel === true ||
                    r.redirectUrl !== undefined ||
                    this.cnameIgnoreExceptions
                ) {
                    return r;
                }
            }
            if (
                details.type === 'main_frame' &&
                this.cnameIgnoreRootDocument
            ) {
                return;
            }
            const hn = vAPI.hostnameFromNetworkURL(details.url);
            const cname = this.cnames.get(hn);
            if ( cname === '' ) { return; }
            if ( cname !== undefined ) {
                return this.processCanonicalName(hn, cname, details);
            }
            return browser.dns.resolve(hn, [ 'canonical_name' ]).then(
                rec => {
                    const cname = this.recordCanonicalName(hn, rec);
                    if ( cname === '' ) { return; }
                    return this.processCanonicalName(hn, cname, details);
                },
                ( ) => {
                    this.cnames.set(hn, '');
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
        unsuspendAllRequests() {
            const pendingRequests = this.pendingRequests;
            this.pendingRequests = [];
            for ( const entry of pendingRequests ) {
                entry.resolve(this.onBeforeSuspendableRequest(entry.details));
            }
        }
        canSuspend() {
            return true;
        }
    };
})();

/******************************************************************************/

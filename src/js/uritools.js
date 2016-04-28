/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 Raymond Hill

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

/* global publicSuffixList */

/*******************************************************************************

RFC 3986 as reference: http://tools.ietf.org/html/rfc3986#appendix-A

Naming convention from https://en.wikipedia.org/wiki/URI_scheme#Examples

*/

/******************************************************************************/

µBlock.URI = (function() {

'use strict';

/******************************************************************************/

// Favorite regex tool: http://regex101.com/

// Ref: <http://tools.ietf.org/html/rfc3986#page-50>
// I removed redundant capture groups: capture less = peform faster. See
// <http://jsperf.com/old-uritools-vs-new-uritools>
// Performance improvements welcomed.
// jsperf: <http://jsperf.com/old-uritools-vs-new-uritools>
var reRFC3986 = /^([^:\/?#]+:)?(\/\/[^\/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?/;

// Derived
var reSchemeFromURI          = /^[^:\/?#]+:/;
var reAuthorityFromURI       = /^(?:[^:\/?#]+:)?(\/\/[^\/?#]+)/;
var reOriginFromURI          = /^(?:[^:\/?#]+:)?(?:\/\/[^\/?#]+)/;
var reCommonHostnameFromURL  = /^https?:\/\/([0-9a-z_][0-9a-z._-]*[0-9a-z])\//;
var rePathFromURI            = /^(?:[^:\/?#]+:)?(?:\/\/[^\/?#]*)?([^?#]*)/;

// These are to parse authority field, not parsed by above official regex
// IPv6 is seen as an exception: a non-compatible IPv6 is first tried, and
// if it fails, the IPv6 compatible regex istr used. This helps
// peformance by avoiding the use of a too complicated regex first.

// https://github.com/gorhill/httpswitchboard/issues/211
// "While a hostname may not contain other characters, such as the
// "underscore character (_), other DNS names may contain the underscore"
var reHostPortFromAuthority  = /^(?:[^@]*@)?([0-9a-z._-]*)(:\d*)?$/i;
var reIPv6PortFromAuthority  = /^(?:[^@]*@)?(\[[0-9a-f:]*\])(:\d*)?$/i;

var reHostFromNakedAuthority = /^[0-9a-z._-]+[0-9a-z]$/i;
var reHostFromAuthority      = /^(?:[^@]*@)?([0-9a-z._-]+)(?::\d*)?$/i;
var reIPv6FromAuthority      = /^(?:[^@]*@)?(\[[0-9a-f:]+\])(?::\d*)?$/i;

// Coarse (but fast) tests
var reValidHostname          = /^([a-z\d]+(-*[a-z\d]+)*)(\.[a-z\d]+(-*[a-z\d])*)*$/;
var reIPAddressNaive         = /^\d+\.\d+\.\d+\.\d+$|^\[[\da-zA-Z:]+\]$/;

/******************************************************************************/

var reset = function(o) {
    o.scheme = '';
    o.hostname = '';
    o._ipv4 = undefined;
    o._ipv6 = undefined;
    o.port = '';
    o.path = '';
    o.query = '';
    o.fragment = '';
    return o;
};

var resetAuthority = function(o) {
    o.hostname = '';
    o._ipv4 = undefined;
    o._ipv6 = undefined;
    o.port = '';
    return o;
};

/******************************************************************************/

// This will be exported

var URI = {
    scheme:      '',
    authority:   '',
    hostname:    '',
    _ipv4:       undefined,
    _ipv6:       undefined,
    port:        '',
    domain:      undefined,
    path:        '',
    query:       '',
    fragment:    '',
    schemeBit:   (1 << 0),
    userBit:     (1 << 1),
    passwordBit: (1 << 2),
    hostnameBit: (1 << 3),
    portBit:     (1 << 4),
    pathBit:     (1 << 5),
    queryBit:    (1 << 6),
    fragmentBit: (1 << 7),
    allBits:     (0xFFFF)
};

URI.authorityBit  = (URI.userBit | URI.passwordBit | URI.hostnameBit | URI.portBit);
URI.normalizeBits = (URI.schemeBit | URI.hostnameBit | URI.pathBit | URI.queryBit);

/******************************************************************************/

// See: https://en.wikipedia.org/wiki/URI_scheme#Examples
//     URI = scheme ":" hier-part [ "?" query ] [ "#" fragment ]
//
//       foo://example.com:8042/over/there?name=ferret#nose
//       \_/   \______________/\_________/ \_________/ \__/
//        |           |            |            |        |
//     scheme     authority       path        query   fragment
//        |   _____________________|__
//       / \ /                        \
//       urn:example:animal:ferret:nose

URI.set = function(uri) {
    if ( uri === undefined ) {
        return reset(URI);
    }
    var matches = reRFC3986.exec(uri);
    if ( !matches ) {
        return reset(URI);
    }
    this.scheme = matches[1] !== undefined ? matches[1].slice(0, -1) : '';
    this.authority = matches[2] !== undefined ? matches[2].slice(2).toLowerCase() : '';
    this.path = matches[3] !== undefined ? matches[3] : '';

    // <http://tools.ietf.org/html/rfc3986#section-6.2.3>
    // "In general, a URI that uses the generic syntax for authority
    // "with an empty path should be normalized to a path of '/'."
    if ( this.authority !== '' && this.path === '' ) {
        this.path = '/';
    }
    this.query = matches[4] !== undefined ? matches[4].slice(1) : '';
    this.fragment = matches[5] !== undefined ? matches[5].slice(1) : '';

    // Assume very simple authority, i.e. just a hostname (highest likelihood
    // case for µBlock)
    if ( reHostFromNakedAuthority.test(this.authority) ) {
        this.hostname = this.authority;
        this.port = '';
        return this;
    }
    // Authority contains more than just a hostname
    matches = reHostPortFromAuthority.exec(this.authority);
    if ( !matches ) {
        matches = reIPv6PortFromAuthority.exec(this.authority);
        if ( !matches ) {
            return resetAuthority(URI);
        }
    }
    this.hostname = matches[1] !== undefined ? matches[1] : '';
    // http://en.wikipedia.org/wiki/FQDN
    if ( this.hostname.endsWith('.') ) {
        this.hostname = this.hostname.slice(0, -1);
    }
    this.port = matches[2] !== undefined ? matches[2].slice(1) : '';
    return this;
};

/******************************************************************************/

//     URI = scheme ":" hier-part [ "?" query ] [ "#" fragment ]
//
//       foo://example.com:8042/over/there?name=ferret#nose
//       \_/   \______________/\_________/ \_________/ \__/
//        |           |            |            |        |
//     scheme     authority       path        query   fragment
//        |   _____________________|__
//       / \ /                        \
//       urn:example:animal:ferret:nose

URI.assemble = function(bits) {
    if ( bits === undefined ) {
        bits = this.allBits;
    }
    var s = [];
    if ( this.scheme && (bits & this.schemeBit) ) {
        s.push(this.scheme, ':');
    }
    if ( this.hostname && (bits & this.hostnameBit) ) {
        s.push('//', this.hostname);
    }
    if ( this.port && (bits & this.portBit) ) {
        s.push(':', this.port);
    }
    if ( this.path && (bits & this.pathBit) ) {
        s.push(this.path);
    }
    if ( this.query && (bits & this.queryBit) ) {
        s.push('?', this.query);
    }
    if ( this.fragment && (bits & this.fragmentBit) ) {
        s.push('#', this.fragment);
    }
    return s.join('');
};

/******************************************************************************/

URI.originFromURI = function(uri) {
    var matches = reOriginFromURI.exec(uri);
    return matches !== null ? matches[0].toLowerCase() : '';
};

/******************************************************************************/

URI.schemeFromURI = function(uri) {
    var matches = reSchemeFromURI.exec(uri);
    if ( !matches ) {
        return '';
    }
    return matches[0].slice(0, -1).toLowerCase();
};

/******************************************************************************/

URI.authorityFromURI = function(uri) {
    var matches = reAuthorityFromURI.exec(uri);
    if ( !matches ) {
        return '';
    }
    return matches[1].slice(2).toLowerCase();
};

/******************************************************************************/

// The most used function, so it better be fast.

URI.hostnameFromURI = function(uri) {
    var matches = reCommonHostnameFromURL.exec(uri);
    if ( matches ) {
        return matches[1];
    }
    matches = reAuthorityFromURI.exec(uri);
    if ( !matches ) {
        return '';
    }
    var authority = matches[1].slice(2);
    // Assume very simple authority (most common case for µBlock)
    if ( reHostFromNakedAuthority.test(authority) ) {
        return authority.toLowerCase();
    }
    matches = reHostFromAuthority.exec(authority);
    if ( !matches ) {
        matches = reIPv6FromAuthority.exec(authority);
        if ( !matches ) {
            return '';
        }
    }
    // http://en.wikipedia.org/wiki/FQDN
    // Also:
    // - https://github.com/gorhill/uBlock/issues/1559
    var hostname = matches[1];
    while ( hostname.endsWith('.') ) {
        hostname = hostname.slice(0, -1);
    }
    return hostname.toLowerCase();
};

/******************************************************************************/

URI.domainFromHostname = function(hostname) {
    // Try to skip looking up the PSL database
    var entry = domainCache[hostname];
    if ( entry !== undefined ) {
        entry.tstamp = Date.now();
        return entry.domain;
    }
    // Meh.. will have to search it
    if ( reIPAddressNaive.test(hostname) === false ) {
        return domainCacheAdd(hostname, psl.getDomain(hostname));
    }
    return domainCacheAdd(hostname, hostname);
};

URI.domain = function() {
    return this.domainFromHostname(this.hostname);
};

// It is expected that there is higher-scoped `publicSuffixList` lingering
// somewhere. Cache it. See <https://github.com/gorhill/publicsuffixlist.js>.
var psl = publicSuffixList;

/******************************************************************************/

URI.pathFromURI = function(uri) {
    var matches = rePathFromURI.exec(uri);
    return matches !== null ? matches[1] : '';
};

/******************************************************************************/

// Trying to alleviate the worries of looking up too often the domain name from
// a hostname. With a cache, uBlock benefits given that it deals with a
// specific set of hostnames within a narrow time span -- in other words, I
// believe probability of cache hit are high in uBlock.

var domainCache = Object.create(null);
var domainCacheCount = 0;
var domainCacheCountLowWaterMark = 35;
var domainCacheCountHighWaterMark = 50;
var domainCacheEntryJunkyardMax = domainCacheCountHighWaterMark - domainCacheCountLowWaterMark;

var DomainCacheEntry = function(domain) {
    this.init(domain);
};

DomainCacheEntry.prototype.init = function(domain) {
    this.domain = domain;
    this.tstamp = Date.now();
    return this;
};

DomainCacheEntry.prototype.dispose = function() {
    this.domain = '';
    if ( domainCacheEntryJunkyard.length < domainCacheEntryJunkyardMax ) {
        domainCacheEntryJunkyard.push(this);
    }
};

var domainCacheEntryFactory = function(domain) {
    var entry = domainCacheEntryJunkyard.pop();
    if ( entry ) {
        return entry.init(domain);
    }
    return new DomainCacheEntry(domain);
};

var domainCacheEntryJunkyard = [];

var domainCacheAdd = function(hostname, domain) {
    var entry = domainCache[hostname];
    if ( entry !== undefined ) {
        entry.tstamp = Date.now();
    } else {
        domainCache[hostname] = domainCacheEntryFactory(domain);
        domainCacheCount += 1;
        if ( domainCacheCount === domainCacheCountHighWaterMark ) {
            domainCachePrune();
        }
    }
    return domain;
};

var domainCacheEntrySort = function(a, b) {
    return domainCache[b].tstamp - domainCache[a].tstamp;
};

var domainCachePrune = function() {
    var hostnames = Object.keys(domainCache)
                          .sort(domainCacheEntrySort)
                          .slice(domainCacheCountLowWaterMark);
    var i = hostnames.length;
    domainCacheCount -= i;
    var hostname;
    while ( i-- ) {
        hostname = hostnames[i];
        domainCache[hostname].dispose();
        delete domainCache[hostname];
    }
};

var domainCacheReset = function() {
    domainCache = Object.create(null);
    domainCacheCount = 0;
};

psl.onChanged.addListener(domainCacheReset);

/******************************************************************************/

URI.domainFromURI = function(uri) {
    if ( !uri ) {
        return '';
    }
    return this.domainFromHostname(this.hostnameFromURI(uri));
};

/******************************************************************************/

// Normalize the way µBlock expects it

URI.normalizedURI = function() {
    // Will be removed:
    // - port
    // - user id/password
    // - fragment
    return this.assemble(this.normalizeBits);
};

/******************************************************************************/

URI.rootURL = function() {
    if ( !this.hostname ) {
        return '';
    }
    return this.assemble(this.schemeBit | this.hostnameBit);
};

/******************************************************************************/

URI.isValidHostname = function(hostname) {
    var r;
    try {
        r = reValidHostname.test(hostname);
    }
    catch (e) {
        return false;
    }
    return r;
};

/******************************************************************************/

// Return the parent domain. For IP address, there is no parent domain.

URI.parentHostnameFromHostname = function(hostname) {
    // `locahost` => ``
    // `example.org` => `example.org`
    // `www.example.org` => `example.org`
    // `tomato.www.example.org` => `example.org`
    var domain = this.domainFromHostname(hostname);

    // `locahost` === `` => bye
    // `example.org` === `example.org` => bye
    // `www.example.org` !== `example.org` => stay
    // `tomato.www.example.org` !== `example.org` => stay
    if ( domain === '' || domain === hostname ) {
        return undefined;
    }

    // Parent is hostname minus first label
    return hostname.slice(hostname.indexOf('.') + 1);
};

/******************************************************************************/

// Return all possible parent hostnames which can be derived from `hostname`,
// ordered from direct parent up to domain inclusively.

URI.parentHostnamesFromHostname = function(hostname) {
    // TODO: I should create an object which is optimized to receive
    // the list of hostnames by making it reusable (junkyard etc.) and which
    // has its own element counter property in order to avoid memory
    // alloc/dealloc.
    var domain = this.domainFromHostname(hostname);
    if ( domain === '' || domain === hostname ) {
        return [];
    }
    var nodes = [];
    var pos;
    for (;;) {
        pos = hostname.indexOf('.');
        if ( pos < 0 ) {
            break;
        }
        hostname = hostname.slice(pos + 1);
        nodes.push(hostname);
        if ( hostname === domain ) {
            break;
        }
    }
    return nodes;
};

/******************************************************************************/

// Return all possible hostnames which can be derived from `hostname`,
// ordered from self up to domain inclusively.

URI.allHostnamesFromHostname = function(hostname) {
    var nodes = this.parentHostnamesFromHostname(hostname);
    nodes.unshift(hostname);
    return nodes;
};

/******************************************************************************/

URI.toString = function() {
    return this.assemble();
};

/******************************************************************************/

// Export

return URI;

/******************************************************************************/

})();

/******************************************************************************/


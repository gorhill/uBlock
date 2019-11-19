/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-present Raymond Hill

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

/*******************************************************************************

RFC 3986 as reference: http://tools.ietf.org/html/rfc3986#appendix-A

Naming convention from https://en.wikipedia.org/wiki/URI_scheme#Examples

*/

/******************************************************************************/

µBlock.URI = (( ) => {

/******************************************************************************/

// Favorite regex tool: http://regex101.com/

// Ref: <http://tools.ietf.org/html/rfc3986#page-50>
// I removed redundant capture groups: capture less = peform faster. See
// <http://jsperf.com/old-uritools-vs-new-uritools>
// Performance improvements welcomed.
// jsperf: <http://jsperf.com/old-uritools-vs-new-uritools>
const reRFC3986 = /^([^:\/?#]+:)?(\/\/[^\/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?/;

// Derived
const reSchemeFromURI          = /^[^:\/?#]+:/;
const reOriginFromURI          = /^(?:[^:\/?#]+:)\/\/[^\/?#]+/;
const rePathFromURI            = /^(?:[^:\/?#]+:)?(?:\/\/[^\/?#]*)?([^?#]*)/;

// These are to parse authority field, not parsed by above official regex
// IPv6 is seen as an exception: a non-compatible IPv6 is first tried, and
// if it fails, the IPv6 compatible regex istr used. This helps
// peformance by avoiding the use of a too complicated regex first.

// https://github.com/gorhill/httpswitchboard/issues/211
// "While a hostname may not contain other characters, such as the
// "underscore character (_), other DNS names may contain the underscore"
const reHostPortFromAuthority  = /^(?:[^@]*@)?([^:]*)(:\d*)?$/;
const reIPv6PortFromAuthority  = /^(?:[^@]*@)?(\[[0-9a-f:]*\])(:\d*)?$/i;

const reHostFromNakedAuthority = /^[0-9a-z._-]+[0-9a-z]$/i;

// Coarse (but fast) tests
const reValidHostname          = /^([a-z\d]+(-*[a-z\d]+)*)(\.[a-z\d]+(-*[a-z\d])*)*$/;

/******************************************************************************/

const reset = function(o) {
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

const resetAuthority = function(o) {
    o.hostname = '';
    o._ipv4 = undefined;
    o._ipv6 = undefined;
    o.port = '';
    return o;
};

/******************************************************************************/

// This will be exported

const URI = {
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
    let matches = reRFC3986.exec(uri);
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
    const s = [];
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
    const matches = reOriginFromURI.exec(uri);
    return matches !== null ? matches[0].toLowerCase() : '';
};

/******************************************************************************/

URI.schemeFromURI = function(uri) {
    const matches = reSchemeFromURI.exec(uri);
    if ( !matches ) { return ''; }
    return matches[0].slice(0, -1).toLowerCase();
};

/******************************************************************************/

URI.hostnameFromURI = vAPI.hostnameFromURI;
URI.domainFromHostname = vAPI.domainFromHostname;

URI.domain = function() {
    return this.domainFromHostname(this.hostname);
};

/******************************************************************************/

URI.entityFromDomain = function(domain) {
    const pos = domain.indexOf('.');
    return pos !== -1 ? domain.slice(0, pos) + '.*' : '';
};

/******************************************************************************/

URI.pathFromURI = function(uri) {
    const matches = rePathFromURI.exec(uri);
    return matches !== null ? matches[1] : '';
};

/******************************************************************************/

URI.domainFromURI = function(uri) {
    if ( !uri ) { return ''; }
    return this.domainFromHostname(this.hostnameFromURI(uri));
};

/******************************************************************************/

URI.isNetworkURI = function(uri) {
    return reNetworkURI.test(uri);
};

const reNetworkURI = /^(?:ftps?|https?|wss?):\/\//;

/******************************************************************************/

URI.isNetworkScheme = function(scheme) {
    return reNetworkScheme.test(scheme);
};

const reNetworkScheme = /^(?:ftps?|https?|wss?)$/;

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
    if ( !this.hostname ) { return ''; }
    return this.assemble(this.schemeBit | this.hostnameBit);
};

/******************************************************************************/

URI.isValidHostname = function(hostname) {
    try {
        return reValidHostname.test(hostname);
    }
    catch (e) {
    }
    return false;
};

/******************************************************************************/

// Return the parent domain. For IP address, there is no parent domain.

URI.parentHostnameFromHostname = function(hostname) {
    // `locahost` => ``
    // `example.org` => `example.org`
    // `www.example.org` => `example.org`
    // `tomato.www.example.org` => `example.org`
    const domain = this.domainFromHostname(hostname);

    // `locahost` === `` => bye
    // `example.org` === `example.org` => bye
    // `www.example.org` !== `example.org` => stay
    // `tomato.www.example.org` !== `example.org` => stay
    if ( domain === '' || domain === hostname ) { return; }

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
    const domain = this.domainFromHostname(hostname);
    if ( domain === '' || domain === hostname ) {
        return [];
    }
    const nodes = [];
    for (;;) {
        const pos = hostname.indexOf('.');
        if ( pos < 0 ) { break; }
        hostname = hostname.slice(pos + 1);
        nodes.push(hostname);
        if ( hostname === domain ) { break; }
    }
    return nodes;
};

/******************************************************************************/

// Return all possible hostnames which can be derived from `hostname`,
// ordered from self up to domain inclusively.

URI.allHostnamesFromHostname = function(hostname) {
    const nodes = this.parentHostnamesFromHostname(hostname);
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


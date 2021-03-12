/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2018-present Raymond Hill

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

{
// >>>>> start of local scope

/******************************************************************************/

const originFromURI = µBlock.URI.originFromURI;
const hostnameFromURI = vAPI.hostnameFromURI;
const domainFromHostname = vAPI.domainFromHostname;

/******************************************************************************/

// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/ResourceType

// Long term, convert code wherever possible to work with integer-based type
// values -- the assumption being that integer operations are faster than
// string operations.

const           NO_TYPE = 0;
const            BEACON = 1 <<  0;
const        CSP_REPORT = 1 <<  1;
const              FONT = 1 <<  2;
const             IMAGE = 1 <<  4;
const          IMAGESET = 1 <<  4;
const        MAIN_FRAME = 1 <<  5;
const             MEDIA = 1 <<  6;
const            OBJECT = 1 <<  7;
const OBJECT_SUBREQUEST = 1 <<  7;
const              PING = 1 <<  8;
const            SCRIPT = 1 <<  9;
const        STYLESHEET = 1 << 10;
const         SUB_FRAME = 1 << 11;
const         WEBSOCKET = 1 << 12;
const    XMLHTTPREQUEST = 1 << 13;
const       INLINE_FONT = 1 << 14;
const     INLINE_SCRIPT = 1 << 15;
const             OTHER = 1 << 16;
const         FRAME_ANY = MAIN_FRAME | SUB_FRAME;
const          FONT_ANY = FONT | INLINE_FONT;
const        INLINE_ANY = INLINE_FONT | INLINE_SCRIPT;
const          PING_ANY = BEACON | CSP_REPORT | PING;
const        SCRIPT_ANY = SCRIPT | INLINE_SCRIPT;

const typeStrToIntMap = {
           'no_type': NO_TYPE,
            'beacon': BEACON,
        'csp_report': CSP_REPORT,
              'font': FONT,
             'image': IMAGE,
          'imageset': IMAGESET,
        'main_frame': MAIN_FRAME,
             'media': MEDIA,
            'object': OBJECT,
 'object_subrequest': OBJECT_SUBREQUEST,
              'ping': PING,
            'script': SCRIPT,
        'stylesheet': STYLESHEET,
         'sub_frame': SUB_FRAME,
         'websocket': WEBSOCKET,
    'xmlhttprequest': XMLHTTPREQUEST,
       'inline-font': INLINE_FONT,
     'inline-script': INLINE_SCRIPT,
             'other': OTHER,
};

/******************************************************************************/

const FilteringContext = class {
    constructor(other) {
        if ( other instanceof FilteringContext ) {
            return this.fromFilteringContext(other);
        }
        this.tstamp = 0;
        this.realm = '';
        this.id = undefined;
        this.itype = 0;
        this.stype = undefined;
        this.url = undefined;
        this.aliasURL = undefined;
        this.hostname = undefined;
        this.domain = undefined;
        this.docId = -1;
        this.frameId = -1;
        this.docOrigin = undefined;
        this.docHostname = undefined;
        this.docDomain = undefined;
        this.tabId = undefined;
        this.tabOrigin = undefined;
        this.tabHostname = undefined;
        this.tabDomain = undefined;
        this.redirectURL = undefined;
        this.filter = undefined;
    }

    get type() {
        return this.stype;
    }

    set type(a) {
        this.itype = typeStrToIntMap[a] || NO_TYPE;
        this.stype = a;
    }

    isDocument() {
        return (this.itype & FRAME_ANY) !== 0;
    }

    isFont() {
        return (this.itype & FONT_ANY) !== 0;
    }

    fromTabId(tabId) {
        const tabContext = µBlock.tabContextManager.mustLookup(tabId);
        this.tabOrigin = tabContext.origin;
        this.tabHostname = tabContext.rootHostname;
        this.tabDomain = tabContext.rootDomain;
        this.tabId = tabContext.tabId;
        return this;
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/459
    //   In case of a request for frame and if ever no context is specified,
    //   assume the origin of the context is the same as the request itself.
    fromWebrequestDetails(details) {
        const tabId = details.tabId;
        this.type = details.type;
        if ( this.itype === MAIN_FRAME && tabId > 0 ) {
            µBlock.tabContextManager.push(tabId, details.url);
        }
        this.fromTabId(tabId); // Must be called AFTER tab context management
        this.realm = '';
        this.id = details.requestId;
        this.setURL(details.url);
        this.aliasURL = details.aliasURL || undefined;
        if ( this.itype !== SUB_FRAME ) {
            this.docId = details.frameId;
            this.frameId = -1;
        } else {
            this.docId = details.parentFrameId;
            this.frameId = details.frameId;
        }
        if ( this.tabId > 0 ) {
            if ( this.docId === 0 ) {
                this.docOrigin = this.tabOrigin;
                this.docHostname = this.tabHostname;
                this.docDomain = this.tabDomain;
            } else if ( details.documentUrl !== undefined ) {
                this.setDocOriginFromURL(details.documentUrl);
            } else {
                const pageStore = µBlock.pageStoreFromTabId(this.tabId);
                const docStore = pageStore && pageStore.getFrameStore(this.docId);
                if ( docStore ) {
                    this.setDocOriginFromURL(docStore.rawURL);
                } else {
                    this.setDocOrigin(this.tabOrigin);
                }
            }
        } else if ( details.documentUrl !== undefined ) {
            const origin = originFromURI(
                µBlock.normalizePageURL(0, details.documentUrl)
            );
            this.setDocOrigin(origin).setTabOrigin(origin);
        } else if ( this.docId === -1 || (this.itype & FRAME_ANY) !== 0 ) {
            const origin = originFromURI(this.url);
            this.setDocOrigin(origin).setTabOrigin(origin);
        } else {
            this.setDocOrigin(this.tabOrigin);
        }
        this.redirectURL = undefined;
        this.filter = undefined;
        return this;
    }

    fromFilteringContext(other) {
        this.realm = other.realm;
        this.type = other.type;
        this.url = other.url;
        this.hostname = other.hostname;
        this.domain = other.domain;
        this.docId = other.docId;
        this.frameId = other.frameId;
        this.docOrigin = other.docOrigin;
        this.docHostname = other.docHostname;
        this.docDomain = other.docDomain;
        this.tabId = other.tabId;
        this.tabOrigin = other.tabOrigin;
        this.tabHostname = other.tabHostname;
        this.tabDomain = other.tabDomain;
        this.redirectURL = other.redirectURL;
        this.filter = undefined;
        return this;
    }

    duplicate() {
        return (new FilteringContext(this));
    }

    setRealm(a) {
        this.realm = a;
        return this;
    }

    setType(a) {
        this.type = a;
        return this;
    }

    setURL(a) {
        if ( a !== this.url ) {
            this.hostname = this.domain = undefined;
            this.url = a;
        }
        return this;
    }

    getHostname() {
        if ( this.hostname === undefined ) {
            this.hostname = hostnameFromURI(this.url);
        }
        return this.hostname;
    }

    setHostname(a) {
        if ( a !== this.hostname ) {
            this.domain = undefined;
            this.hostname = a;
        }
        return this;
    }

    getDomain() {
        if ( this.domain === undefined ) {
            this.domain = domainFromHostname(this.getHostname());
        }
        return this.domain;
    }

    setDomain(a) {
        this.domain = a;
        return this;
    }

    getDocOrigin() {
        if ( this.docOrigin === undefined ) {
            this.docOrigin = this.tabOrigin;
        }
        return this.docOrigin;
    }

    setDocOrigin(a) {
        if ( a !== this.docOrigin ) {
            this.docHostname = this.docDomain = undefined;
            this.docOrigin = a;
        }
        return this;
    }

    setDocOriginFromURL(a) {
        return this.setDocOrigin(originFromURI(a));
    }

    getDocHostname() {
        if ( this.docHostname === undefined ) {
            this.docHostname = hostnameFromURI(this.getDocOrigin());
        }
        return this.docHostname;
    }

    setDocHostname(a) {
        if ( a !== this.docHostname ) {
            this.docDomain = undefined;
            this.docHostname = a;
        }
        return this;
    }

    getDocDomain() {
        if ( this.docDomain === undefined ) {
            this.docDomain = domainFromHostname(this.getDocHostname());
        }
        return this.docDomain;
    }

    setDocDomain(a) {
        this.docDomain = a;
        return this;
    }

    // The idea is to minimize the amout of work done to figure out whether
    // the resource is 3rd-party to the document.
    is3rdPartyToDoc() {
        let docDomain = this.getDocDomain();
        if ( docDomain === '' ) { docDomain = this.docHostname; }
        if ( this.domain !== undefined && this.domain !== '' ) {
            return this.domain !== docDomain;
        }
        const hostname = this.getHostname();
        if ( hostname.endsWith(docDomain) === false ) { return true; }
        const i = hostname.length - docDomain.length;
        if ( i === 0 ) { return false; }
        return hostname.charCodeAt(i - 1) !== 0x2E /* '.' */;
    }

    setTabId(a) {
        this.tabId = a;
        return this;
    }

    getTabOrigin() {
        if ( this.tabOrigin === undefined ) {
            const tabContext = µBlock.tabContextManager.mustLookup(this.tabId);
            this.tabOrigin = tabContext.origin;
            this.tabHostname = tabContext.rootHostname;
            this.tabDomain = tabContext.rootDomain;
        }
        return this.tabOrigin;
    }

    setTabOrigin(a) {
        if ( a !== this.tabOrigin ) {
            this.tabHostname = this.tabDomain = undefined;
            this.tabOrigin = a;
        }
        return this;
    }

    setTabOriginFromURL(a) {
        return this.setTabOrigin(originFromURI(a));
    }

    getTabHostname() {
        if ( this.tabHostname === undefined ) {
            this.tabHostname = hostnameFromURI(this.getTabOrigin());
        }
        return this.tabHostname;
    }

    setTabHostname(a) {
        if ( a !== this.tabHostname ) {
            this.tabDomain = undefined;
            this.tabHostname = a;
        }
        return this;
    }

    getTabDomain() {
        if ( this.tabDomain === undefined ) {
            this.tabDomain = domainFromHostname(this.getTabHostname());
        }
        return this.tabDomain;
    }

    setTabDomain(a) {
        this.docDomain = a;
        return this;
    }

    // The idea is to minimize the amout of work done to figure out whether
    // the resource is 3rd-party to the top document.
    is3rdPartyToTab() {
        let tabDomain = this.getTabDomain();
        if ( tabDomain === '' ) { tabDomain = this.tabHostname; }
        if ( this.domain !== undefined && this.domain !== '' ) {
            return this.domain !== tabDomain;
        }
        const hostname = this.getHostname();
        if ( hostname.endsWith(tabDomain) === false ) { return true; }
        const i = hostname.length - tabDomain.length;
        if ( i === 0 ) { return false; }
        return hostname.charCodeAt(i - 1) !== 0x2E /* '.' */;
    }

    setFilter(a) {
        this.filter = a;
        return this;
    }

    pushFilter(a) {
        if ( this.filter === undefined ) {
            return this.setFilter(a);
        }
        if ( Array.isArray(this.filter) ) {
            this.filter.push(a);
        } else {
            this.filter = [ this.filter, a ];
        }
        return this;
    }

    pushFilters(a) {
        if ( this.filter === undefined ) {
            return this.setFilter(a);
        }
        if ( Array.isArray(this.filter) ) {
            this.filter.push(...a);
        } else {
            this.filter = [ this.filter, ...a ];
        }
        return this;
    }

    toLogger() {
        this.tstamp = Date.now();
        if ( this.domain === undefined ) {
            void this.getDomain();
        }
        if ( this.docDomain === undefined ) {
            void this.getDocDomain();
        }
        if ( this.tabDomain === undefined ) {
            void this.getTabDomain();
        }
        const logger = µBlock.logger;
        const filters = this.filter;
        // Many filters may have been applied to the current context
        if ( Array.isArray(filters) === false ) {
            return logger.writeOne(this);
        }
        for ( const filter of filters ) {
            this.filter = filter;
            logger.writeOne(this);
        }
    }
};

/******************************************************************************/

FilteringContext.prototype.BEACON = FilteringContext.BEACON = BEACON;
FilteringContext.prototype.CSP_REPORT = FilteringContext.CSP_REPORT = CSP_REPORT;
FilteringContext.prototype.FONT = FilteringContext.FONT = FONT;
FilteringContext.prototype.IMAGE = FilteringContext.IMAGE = IMAGE;
FilteringContext.prototype.IMAGESET = FilteringContext.IMAGESET = IMAGESET;
FilteringContext.prototype.MAIN_FRAME = FilteringContext.MAIN_FRAME = MAIN_FRAME;
FilteringContext.prototype.MEDIA = FilteringContext.MEDIA = MEDIA;
FilteringContext.prototype.OBJECT = FilteringContext.OBJECT = OBJECT;
FilteringContext.prototype.OBJECT_SUBREQUEST = FilteringContext.OBJECT_SUBREQUEST = OBJECT_SUBREQUEST;
FilteringContext.prototype.PING = FilteringContext.PING = PING;
FilteringContext.prototype.SCRIPT = FilteringContext.SCRIPT = SCRIPT;
FilteringContext.prototype.STYLESHEET = FilteringContext.STYLESHEET = STYLESHEET;
FilteringContext.prototype.SUB_FRAME = FilteringContext.SUB_FRAME = SUB_FRAME;
FilteringContext.prototype.WEBSOCKET = FilteringContext.WEBSOCKET = WEBSOCKET;
FilteringContext.prototype.XMLHTTPREQUEST = FilteringContext.XMLHTTPREQUEST = XMLHTTPREQUEST;
FilteringContext.prototype.INLINE_FONT = FilteringContext.INLINE_FONT = INLINE_FONT;
FilteringContext.prototype.INLINE_SCRIPT = FilteringContext.INLINE_SCRIPT = INLINE_SCRIPT;
FilteringContext.prototype.OTHER = FilteringContext.OTHER = OTHER;
FilteringContext.prototype.FRAME_ANY = FilteringContext.FRAME_ANY = FRAME_ANY;
FilteringContext.prototype.FONT_ANY = FilteringContext.FONT_ANY = FONT_ANY;
FilteringContext.prototype.INLINE_ANY = FilteringContext.INLINE_ANY = INLINE_ANY;
FilteringContext.prototype.PING_ANY = FilteringContext.PING_ANY = PING_ANY;
FilteringContext.prototype.SCRIPT_ANY = FilteringContext.SCRIPT_ANY = SCRIPT_ANY;

/******************************************************************************/

µBlock.FilteringContext = FilteringContext;
µBlock.filteringContext = new FilteringContext();

// <<<<< end of local scope
}

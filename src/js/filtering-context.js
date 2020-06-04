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

µBlock.FilteringContext = function(other) {
    if ( other instanceof µBlock.FilteringContext ) {
        return this.fromFilteringContext(other);
    }
    this.tstamp = 0;
    this.realm = '';
    this.id = undefined;
    this.type = undefined;
    this.url = undefined;
    this.aliasURL = undefined;
    this.hostname = undefined;
    this.domain = undefined;
    this.docId = undefined;
    this.docOrigin = undefined;
    this.docHostname = undefined;
    this.docDomain = undefined;
    this.tabId = undefined;
    this.tabOrigin = undefined;
    this.tabHostname = undefined;
    this.tabDomain = undefined;
    this.filter = undefined;
};

µBlock.FilteringContext.prototype = {
    fromTabId: function(tabId) {
        const tabContext = µBlock.tabContextManager.mustLookup(tabId);
        this.tabOrigin = tabContext.origin;
        this.tabHostname = tabContext.rootHostname;
        this.tabDomain = tabContext.rootDomain;
        this.tabId = tabContext.tabId;
        return this;
    },
    // https://github.com/uBlockOrigin/uBlock-issues/issues/459
    //   In case of a request for frame and if ever no context is specified,
    //   assume the origin of the context is the same as the request itself.
    fromWebrequestDetails: function(details) {
        const tabId = details.tabId;
        if ( tabId > 0 && details.type === 'main_frame' ) {
            µBlock.tabContextManager.push(tabId, details.url);
        }
        this.fromTabId(tabId);
        this.realm = '';
        this.id = details.requestId;
        this.type = details.type;
        this.setURL(details.url);
        this.aliasURL = details.aliasURL || undefined;
        this.docId = details.type !== 'sub_frame'
            ? details.frameId
            : details.parentFrameId;
        if ( this.tabId > 0 ) {
            if ( this.docId === 0 ) {
                this.docOrigin = this.tabOrigin;
                this.docHostname = this.tabHostname;
                this.docDomain = this.tabDomain;
            } else if ( details.documentUrl !== undefined ) {
                this.setDocOriginFromURL(details.documentUrl);
            } else {
                const pageStore = µBlock.pageStoreFromTabId(this.tabId);
                const docStore = pageStore && pageStore.getFrame(this.docId);
                if ( docStore ) {
                    this.setDocOriginFromURL(docStore.rawURL);
                } else {
                    this.setDocOrigin(this.tabOrigin);
                }
            }
        } else if ( details.documentUrl !== undefined ) {
            const origin = this.originFromURI(
                µBlock.normalizePageURL(0, details.documentUrl)
            );
            this.setDocOrigin(origin).setTabOrigin(origin);
        } else if ( this.docId === -1 || this.type.endsWith('_frame') ) {
            const origin = this.originFromURI(this.url);
            this.setDocOrigin(origin).setTabOrigin(origin);
        } else {
            this.setDocOrigin(this.tabOrigin);
        }
        this.filter = undefined;
        return this;
    },
    fromFilteringContext: function(other) {
        this.realm = other.realm;
        this.type = other.type;
        this.url = other.url;
        this.hostname = other.hostname;
        this.domain = other.domain;
        this.docId = other.docId;
        this.docOrigin = other.docOrigin;
        this.docHostname = other.docHostname;
        this.docDomain = other.docDomain;
        this.tabId = other.tabId;
        this.tabOrigin = other.tabOrigin;
        this.tabHostname = other.tabHostname;
        this.tabDomain = other.tabDomain;
        this.filter = undefined;
        return this;
    },
    duplicate: function() {
        return (new µBlock.FilteringContext(this));
    },
    setRealm: function(a) {
        this.realm = a;
        return this;
    },
    setType: function(a) {
        this.type = a;
        return this;
    },
    setURL: function(a) {
        if ( a !== this.url ) {
            this.hostname = this.domain = undefined;
            this.url = a;
        }
        return this;
    },
    getHostname: function() {
        if ( this.hostname === undefined ) {
            this.hostname = this.hostnameFromURI(this.url);
        }
        return this.hostname;
    },
    setHostname: function(a) {
        if ( a !== this.hostname ) {
            this.domain = undefined;
            this.hostname = a;
        }
        return this;
    },
    getDomain: function() {
        if ( this.domain === undefined ) {
            this.domain = this.domainFromHostname(this.getHostname());
        }
        return this.domain;
    },
    setDomain: function(a) {
        this.domain = a;
        return this;
    },
    getDocOrigin: function() {
        if ( this.docOrigin === undefined ) {
            this.docOrigin = this.tabOrigin;
        }
        return this.docOrigin;
    },
    setDocOrigin: function(a) {
        if ( a !== this.docOrigin ) {
            this.docHostname = this.docDomain = undefined;
            this.docOrigin = a;
        }
        return this;
    },
    setDocOriginFromURL: function(a) {
        return this.setDocOrigin(this.originFromURI(a));
    },
    getDocHostname: function() {
        if ( this.docHostname === undefined ) {
            this.docHostname = this.hostnameFromURI(this.getDocOrigin());
        }
        return this.docHostname;
    },
    setDocHostname: function(a) {
        if ( a !== this.docHostname ) {
            this.docDomain = undefined;
            this.docHostname = a;
        }
        return this;
    },
    getDocDomain: function() {
        if ( this.docDomain === undefined ) {
            this.docDomain = this.domainFromHostname(this.getDocHostname());
        }
        return this.docDomain;
    },
    setDocDomain: function(a) {
        this.docDomain = a;
        return this;
    },
    // The idea is to minimize the amout of work done to figure out whether
    // the resource is 3rd-party to the document.
    is3rdPartyToDoc: function() {
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
    },
    setTabId: function(a) {
        this.tabId = a;
        return this;
    },
    getTabOrigin: function() {
        if ( this.tabOrigin === undefined ) {
            const tabContext = µBlock.tabContextManager.mustLookup(this.tabId);
            this.tabOrigin = tabContext.origin;
            this.tabHostname = tabContext.rootHostname;
            this.tabDomain = tabContext.rootDomain;
        }
        return this.tabOrigin;
    },
    setTabOrigin: function(a) {
        if ( a !== this.tabOrigin ) {
            this.tabHostname = this.tabDomain = undefined;
            this.tabOrigin = a;
        }
        return this;
    },
    setTabOriginFromURL: function(a) {
        return this.setTabOrigin(this.originFromURI(a));
    },
    getTabHostname: function() {
        if ( this.tabHostname === undefined ) {
            this.tabHostname = this.hostnameFromURI(this.getTabOrigin());
        }
        return this.tabHostname;
    },
    setTabHostname: function(a) {
        if ( a !== this.tabHostname ) {
            this.tabDomain = undefined;
            this.tabHostname = a;
        }
        return this;
    },
    getTabDomain: function() {
        if ( this.tabDomain === undefined ) {
            this.tabDomain = this.domainFromHostname(this.getTabHostname());
        }
        return this.tabDomain;
    },
    setTabDomain: function(a) {
        this.docDomain = a;
        return this;
    },
    // The idea is to minimize the amout of work done to figure out whether
    // the resource is 3rd-party to the top document.
    is3rdPartyToTab: function() {
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
    },
    setFilter: function(a) {
        this.filter = a;
        return this;
    },
    toLogger: function() {
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
        µBlock.logger.writeOne(this);
    },
    originFromURI: µBlock.URI.originFromURI,
    hostnameFromURI: µBlock.URI.hostnameFromURI,
    domainFromHostname: µBlock.URI.domainFromHostname,
};

µBlock.filteringContext = new µBlock.FilteringContext();

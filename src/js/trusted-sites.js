/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
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

import { hostnameFromURI } from './uri-utils.js';

/******************************************************************************/

export class TrustedSiteMatcher {
    static match(url, hostname, data) {
        let pos = 0;
        do {
            const key = hostname.slice(pos);
            const bucket = data.get(key);
            if ( bucket ) {
                const i = this.#matchBucket(url, bucket);
                if ( i !== -1 ) { return { key, i, bucket }; }
            }
            pos = hostname.indexOf('.', pos) + 1;
        } while ( pos !== 0 );
        const bucket = data.get('//');
        if ( bucket === undefined ) { return; }
        const i = this.#matchBucket(url, bucket);
        if ( i !== -1 ) { return { key: '//', i , bucket }; }
    }
    static regexFromDirective(directive) {
        if ( directive.includes('/') === false ) {
            return new RegExp(`^[a-z-]+://([^/.]+\\.)*${this.#toRegex(directive)}/`);
        }
        if ( /^\/.+\/$/.test(directive) ) {
            return new RegExp(directive.slice(1, -1));
        }
        if ( directive.includes('*') ) {
            return new RegExp(this.#toRegex(directive).replace(/\*/g, '.*?'));
        }
        return new RegExp(`^${this.#toRegex(directive)}$`);
    }
    static #matchBucket(url, bucket) {
        for ( let i = 0, n = bucket.length; i < n; i++ ) {
            if ( this.regexFromDirective(bucket[i]).test(url) ) {
                return i;
            }
        }
        return -1;
    }
    static #toRegex(s) {
        return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
}

/******************************************************************************/

export class TrustedSiteParser {
    static fromText(text, out) {
        const lines = text.split(/\n+/);
        return this.fromLines(lines, out);
    }
    static fromLines(lines, out) {
        const trustedSites = out ?? new Map([['#',[]]]);
        for ( const line of lines ) {
            const result = this.fromLine(line.trim());
            if ( result === undefined ) { continue; }
            const { key, directive } = result;
            if ( key === '' ) { continue; }
            const bucket = trustedSites.get(key) ?? [];
            if ( bucket.length === 0 ) {
                trustedSites.set(key, bucket);
            }
            bucket.push(directive);
        }
        return trustedSites;
    }
    static fromLine(line) {
        if ( line === '' ) { return; }
        // Don't throw out comments
        if ( line.startsWith('#') ) {
            return { key: '#', directive: line };
        }
        // Plain hostname
        if ( line.indexOf('/') === -1 ) {
            if ( this.isBadHostname(line) ) {
                return { key: '#', directive: `# ${line}` };
            }
            return { key: line, directive: line };
        }
        // Regex-based (ensure it is valid)
        if ( line.length > 2 && line.startsWith('/') && line.endsWith('/') ) {
            try {
                void new RegExp(line.slice(1, -1));
            } catch {
                return { key: '#', directive: `# ${line}` };
            }
            return { key: '//', directive: line };
        }
        // URL, possibly wildcarded: there MUST be at least one hostname
        // label (or else it would be just impossible to make an efficient
        // dictionary)
        const r = this.parseDirective(line);
        if ( r ) { return r };
        return { key: '#', directive: `# ${line}` };
    }
    static isBadHostname(hostname) {
        return this.#reBadHostname.test(hostname);
    }
    static parseDirective(directive) {
        const match = this.#reWhitelistHostnameExtractor.exec(directive);
        if ( match?.length !== 2 ) { return; }
        return { key: match[1], directive };
    }
    static #reBadHostname = /[^a-z0-9.\-_[\]:]/;
    static #reWhitelistHostnameExtractor =
        /([a-z0-9.\-_[\]]+)(?::[\d*]+)?\/(?:[^\x00-\x20/]|$)[^\x00-\x20]*$/;
}

/******************************************************************************/

export class TrustedSiteManager {
    isTrusted(url) {
        return TrustedSiteMatcher.match(
            url, hostnameFromURI(url), this.#map
        ) !== undefined;
    }
    toggle(url, scope, newState) {
        const targetHostname = hostnameFromURI(url);
        const currentState =
            TrustedSiteMatcher.match(url, targetHostname, this.#map) !== undefined;
        newState = newState ?? currentState === false;
        if ( newState === currentState ) { return 0; }
        const hashpos = url.indexOf('#');
        const targetURL = hashpos !== -1 ? url.slice(0, hashpos) : url;
        // Add to directive list
        if ( newState ) {
            const bucket = this.#map.get(targetHostname) ?? [];
            if ( bucket.length === 0 ) {
                this.#map.set(targetHostname, bucket);
            }
            bucket.push(scope === 'page' ? targetURL : targetHostname);
            return 1;
        }
        // Remove all directives which cause current URL to be whitelisted
        let count = 0;
        let hnpos = 0;
        for (;;) {
            for (;;) {
                const r = TrustedSiteMatcher.match(
                    targetURL, targetHostname.slice(hnpos), this.#map
                );
                if ( r === undefined ) { break; }
                const directive = r.bucket.splice(r.i, 1)[0];
                if ( r.bucket.length === 0 ) {
                    this.#map.delete(r.key);
                }
                if ( this.#isHandcrafted(directive) ) {
                    this.#map.get('#').push(`# ${directive}`);
                }
                count -= 1;
            }
            hnpos = targetHostname.indexOf('.', hnpos) + 1;
            if ( hnpos === 0 ) { break; }
        }
        return count;
    }
    assign(data) {
        this.#map = new Map(data);
    }
    fromLines(directives) {
        this.#map = TrustedSiteParser.fromLines(directives);
    }
    toLines() {
        const out = [];
        for ( const bucket of this.#map.values() ) {
            out.push(...bucket);
        }
        return out.sort((a, b) => a.localeCompare(b));
    }
    fromText(text) {
        this.fromLines(text.split(/\n+/));
    }
    toText() {
        return this.toLines().join('\n');
    }
    directiveRegexesFromHostname(hostname) {
        const out = [];
        let pos = 0;
        do {
            const bucket = this.#map.get(hostname.slice(pos));
            if ( bucket ) { out.push(...bucket); }
            pos = hostname.indexOf('.', pos) + 1;
        } while ( pos !== 0 );
        out.push(...this.#map.get('//') ?? []);
        return out.map(a => TrustedSiteMatcher.regexFromDirective(a).source);
    }
    #map = new Map();
    #isHandcrafted(directive) {
        return directive.startsWith('/') && directive.endsWith('/') ||
               directive.indexOf('/') !== -1 && directive.indexOf('*') !== -1;
    }
}

/******************************************************************************/

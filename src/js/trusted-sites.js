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

// Ensure this function is serializable, it will also be used in other contexts.

function trustedSiteMatcher(data, url, hn) {
    if ( data.size === 0 ) { return false; }
    const matchDirective = trustedSiteMatcher.matchDirective ??
        (trustedSiteMatcher.matchDirective = (directive, url, hn) => {
            if ( directive.includes('/') === false ) {
                if ( hn.endsWith(directive) === false ) { return false; }
                if ( hn.length === directive.length ) { return true; }
                return hn.at(-directive.length-1) === '.';
            }
            if ( directive.at(0) === '/' ) {
                return (new RegExp(directive.slice(1, -1))).test(url);
            }
            if ( directive.includes('*') === false ) { return url === directive; }
            return (new RegExp(directive.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*?'))).test(url);
        });
    const matchBucket = trustedSiteMatcher.matchBucket ??
        (trustedSiteMatcher.matchBucket = (bucket, url, hn) => {
            if ( bucket === undefined ) { return -1; }
            for ( let i = 0; i < bucket.length; i++ ) {
                if ( matchDirective(bucket[i], url, hn) ) { return i; }
            }
            return -1;
        });
    for ( let pos = 0; ; pos += 1 ) {
        const key = hn.slice(pos);
        const i = matchBucket(data.get(key), url, hn);
        if ( i !== -1 ) { return { key, i }; }
        pos = hn.indexOf('.', pos);
        if ( pos === -1 ) { break; }
    }
    const i = matchBucket(data.get('//'), url, hn);
    if ( i !== -1 ) { return { key: '//', i }; }
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
        if ( this.#matcher === undefined ) {
            this.#matcher = this.getMatcher();
        }
        return Boolean(
            this.#matcher.match(this.#matcher.data, url, hostnameFromURI(url))
        );
    }
    toggle(url, scope, newState) {
        const currentState = this.isTrusted(url);
        newState = newState ?? currentState === false;
        if ( newState === currentState ) { return 0; }
        const hashpos = url.indexOf('#');
        const targetURL = hashpos !== -1 ? url.slice(0, hashpos) : url;
        const targetHostname = hostnameFromURI(targetURL);
        // Add to directive list
        if ( newState ) {
            const bucket = this.#map.get(targetHostname) ?? [];
            if ( bucket.length === 0 ) {
                this.#map.set(targetHostname, bucket);
            }
            bucket.push(scope === 'page' ? targetURL : targetHostname);
            this.#matcher = undefined;
            return 1;
        }
        // Remove all directives which cause current URL to be whitelisted
        let count = 0;
        let hnpos = 0;
        for (;;) {
            for (;;) {
                const r = this.#matcher.match(this.#matcher.data,
                    targetURL, targetHostname.slice(hnpos)
                );
                if ( Boolean(r) === false ) { break; }
                const bucket = this.#map.get(r.key);
                const directive = bucket.splice(r.i, 1)[0];
                if ( bucket.length === 0 ) {
                    this.#map.delete(r.key);
                }
                if ( this.#isHandcrafted(directive) ) {
                    this.#map.get('#').push(`# ${directive}`);
                }
                count -= 1;
                this.#matcher = this.getMatcher();
            }
            hnpos = targetHostname.indexOf('.', hnpos) + 1;
            if ( hnpos === 0 ) { break; }
        }
        return count;
    }
    assign(data) {
        this.#map = new Map(data);
        this.#matcher = undefined;
    }
    fromLines(directives) {
        this.#map = TrustedSiteParser.fromLines(directives);
        this.#matcher = undefined;
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
    getMatcher() {
        return {
            data: this.#map,
            match: trustedSiteMatcher,
        };
    }
    #map = new Map();
    #matcher = undefined;
    #isHandcrafted(directive) {
        return directive.startsWith('/') && directive.endsWith('/') ||
               directive.indexOf('/') !== -1 && directive.indexOf('*') !== -1;
    }
}

/******************************************************************************/

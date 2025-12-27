/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2022-present Raymond Hill

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

    Home: https://github.com/gorhill/uBlock/

*/

/******************************************************************************/

(api => {
    if ( typeof api === 'object' ) { return; }

    const isolatedAPI = self.isolatedAPI = {};

    const hostnameStack = (( ) => {
        const docloc = document.location;
        const origins = [ docloc.origin ];
        if ( docloc.ancestorOrigins ) {
            origins.push(...docloc.ancestorOrigins);
        }
        return origins.map((origin, i) => {
            const beg = origin.lastIndexOf('://');
            if ( beg === -1 ) { return; }
            const hn1 = origin.slice(beg+3)
            const end = hn1.indexOf(':');
            const hn2 = end === -1 ? hn1 : hn1.slice(0, end);
            return { hnparts: hn2.split('.'), i };
        }).filter(a => a !== undefined);
    })();

    isolatedAPI.topHostname = hostnameStack.at(-1)?.hnparts.join('.') ?? '';

    const forEachHostname = (entry, callback, details) => {
        const hnparts = entry.hnparts;
        const hnpartslen = hnparts.length;
        if ( hnpartslen === 0 ) { return; }
        for ( let i = 0; i < hnpartslen; i++ ) {
            const r = callback(`${hnparts.slice(i).join('.')}`, details);
            if ( r !== undefined ) { return r; }
        }
        if ( details?.hasEntities !== true ) { return; }
        const n = hnpartslen - 1;
        for ( let i = 0; i < n; i++ ) {
            for ( let j = n; j > i; j-- ) {
                const r = callback(`${hnparts.slice(i,j).join('.')}.*`, details);
                if ( r !== undefined ) { return r; }
            }
        }
    };

    isolatedAPI.forEachHostname = (callback, details) => {
        if ( hostnameStack.length === 0 ) { return; }
        return forEachHostname(hostnameStack[0], callback, details);
    };

    isolatedAPI.forEachHostnameAncestors = (callback, details) => {
        for ( const entry of hostnameStack ) {
            if ( entry.i === 0 ) { continue; }
            const r = forEachHostname(entry, callback, details);
            if ( r !== undefined ) { return r; }
        }
    };

})(self.isolatedAPI);


(api => {
    if ( typeof api === 'object' ) { return; }

    const cosmeticAPI = self.cosmeticAPI = {};
    const { isolatedAPI } = self;
    const { topHostname } = isolatedAPI;
    const thisHostname = document.location.hostname || '';

    const sessionRead = async function(key) {
        try {
            const bin = await chrome.storage.session.get(key);
            return bin?.[key] ?? undefined;
        } catch {
        }
    };

    const sessionWrite = function(key, data) {
        try {
            chrome.storage.session.set({ [key]: data });
        } catch {
        }
    };

    const localRead = async function(key) {
        try {
            const bin = await chrome.storage.local.get(key);
            return bin?.[key] ?? undefined;
        } catch {
        }
    };

    const binarySearch = (sorted, target) => {
        let l = 0, i = 0, d = 0;
        let r = sorted.length;
        let candidate;
        while ( l < r ) {
            i = l + r >>> 1;
            candidate = sorted[i];
            d = target.length - candidate.length;
            if ( d === 0 ) {
                if ( target === candidate ) { return i; }
                d = target < candidate ? -1 : 1;
            }
            if ( d < 0 ) {
                r = i;
            } else {
                l = i + 1;
            }
        }
        return -1;
    };

    const selectorsFromListIndex = (data, ilist) => {
        const list = JSON.parse(`[${data.selectorLists[ilist]}]`);
        const { result } = data;
        for ( const iselector of list ) {
            if ( iselector >= 0 ) {
                result.selectors.add(data.selectors[iselector]);
            } else {
                result.exceptions.add(data.selectors[~iselector]);
            }
        }
    };

    const lookupHostname = (hostname, data) => {
        const listref = binarySearch(data.hostnames, hostname);
        if ( listref !== -1 ) {
            selectorsFromListIndex(data, data.selectorListRefs[listref]);
        }
        const { fromRegexes } = data;
        for ( let i = 0, n = fromRegexes.length; i < n; i += 3 ) {
            if ( hostname.includes(fromRegexes[i+0]) === false ) { continue; }
            if ( typeof fromRegexes[i+1] === 'string' ) {
                fromRegexes[i+1] = new RegExp(fromRegexes[i+1]);
            }
            if ( fromRegexes[i+1].test(hostname) === false ) { continue; }
            selectorsFromListIndex(data, fromRegexes[i+2]);
        }
    };

    const selectorsFromRuleset = async (realm, rulesetId, result) => {
        const data = await localRead(`css.${realm}.${rulesetId}`);
        if ( typeof data !== 'object' || data === null ) { return; }
        data.result = result;
        isolatedAPI.forEachHostname(lookupHostname, data);
    };

    const fillCache = async function(realm, rulesetIds) {
        const selectors = new Set();
        const exceptions = new Set();
        const result = { selectors, exceptions };
        const [ filteringModeDetails ] = await Promise.all([
            localRead('filteringModeDetails'),
            ...rulesetIds.map(a => selectorsFromRuleset(realm, a, result)),
        ]);
        const skip = filteringModeDetails?.none.some(a => {
            if ( topHostname.endsWith(a) === false ) { return false; }
            const n = a.length;
            return topHostname.length === n || topHostname.at(-n-1) === '.';
        });
        for ( const selector of exceptions ) {
            selectors.delete(selector);
        }
        if ( skip ) {
            selectors.clear();
        }
        cacheEntry[realm.charAt(0)] = Array.from(selectors).map(a =>
            a.startsWith('{') ? JSON.parse(a) : a
        );
    };

    const readCache = async ( ) => {
        cacheEntry = await sessionRead(cacheKey) || {};
    };

    const cacheKey =
        `cache.css.${thisHostname || ''}${topHostname !== thisHostname ? `/${topHostname}` : ''}`;
    let clientCount = 0;
    let cacheEntry;

    cosmeticAPI.getSelectors = async function(realm, rulesetIds) {
        clientCount += 1;
        const slot = realm.charAt(0);
        if ( cacheEntry === undefined ) {
            cacheEntry = readCache();
        }
        if ( cacheEntry instanceof Promise ) {
            await cacheEntry;
        }
        if ( cacheEntry[slot] === undefined ) {
            cacheEntry[slot] = fillCache(realm, rulesetIds);
        }
        if ( cacheEntry[slot] instanceof Promise ) {
            await cacheEntry[slot];
        }
        return cacheEntry[slot];
    };

    cosmeticAPI.release = function() {
        clientCount -= 1;
        if ( clientCount !== 0 ) { return; }
        self.cosmeticAPI = undefined;
        const now = Math.round(Date.now() / 15000);
        const since = now - (cacheEntry.t || 0);
        if ( since <= 1 ) { return; }
        cacheEntry.t = now;
        sessionWrite(cacheKey, cacheEntry);
    };
})(self.cosmeticAPI);

/******************************************************************************/

void 0;
/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2019-present Raymond Hill

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

// Important!
// Isolate from global scope
(async function uBOL_cssSpecific() {

/******************************************************************************/

const specificImports = self.specificImports || [];
self.specificImports = undefined;

/******************************************************************************/

const { isolatedAPI } = self;

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

const selectorsFromHostnames = (haystack, needles, data) => {
    let listref = -1;
    for ( const needle of needles ) {
        listref = isolatedAPI.binarySearch(haystack, needle, listref);
        if ( listref >= 0 ) {
            selectorsFromListIndex(data, data.selectorListRefs[listref]);
        } else {
            listref = ~listref;
        }
    }
};

const selectorsFromRuleset = async (rulesetId, result) => {
    const data = await localRead(`css.specific.${rulesetId}`);
    if ( typeof data !== 'object' || data === null ) { return; }
    data.result = result;
    selectorsFromHostnames(data.hostnames, isolatedAPI.contexts.hostnames, data);
    if ( data.hasEntities ) {
        selectorsFromHostnames(data.hostnames, isolatedAPI.contexts.entities, data);
    }
    const { regexes } = data;
    for ( let i = 0, n = regexes.length; i < n; i += 3 ) {
        if ( thisHostname.includes(regexes[i+0]) === false ) { continue; }
        if ( typeof regexes[i+1] === 'string' ) {
            regexes[i+1] = new RegExp(regexes[i+1]);
        }
        if ( regexes[i+1].test(thisHostname) === false ) { continue; }
        selectorsFromListIndex(data, regexes[i+2]);
    }
};

const fillCache = async function(rulesetIds) {
    const selectors = new Set();
    const exceptions = new Set();
    const result = { selectors, exceptions };
    const [ filteringModeDetails ] = await Promise.all([
        localRead('filteringModeDetails'),
        ...rulesetIds.map(a => selectorsFromRuleset(a, result)),
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
    cacheEntry.s = [];
    cacheEntry.p = [];
    for ( const selector of selectors ) {
        if ( selector.startsWith('{') ) {
            cacheEntry.p.push(JSON.parse(selector));
        } else {
            cacheEntry.s.push(selector);
        }
    }
    return cacheEntry;
};

const topHostname = isolatedAPI.contexts.topHostname;
const thisHostname = document.location.hostname || '';
const cachePath = topHostname !== thisHostname ? `${topHostname}/` : '';
const cacheKey = `cache.css.${cachePath}${thisHostname}`;

let cacheEntry = await sessionRead(cacheKey) ?? { t: 0 };
if ( cacheEntry.t === 0 ) {
    cacheEntry = await fillCache(specificImports);
}
const now = Math.round(Date.now() / 15000);
const since = now - cacheEntry.t;
if ( since > 1 ) {
    cacheEntry.t = now;
    sessionWrite(cacheKey, cacheEntry);
}

const { s, p } = cacheEntry;

if ( s.length !== 0 ) {
    self.cssAPI.insert(`${s.join(',\n')}{display:none!important;}`);
}

if ( p.length === 0 ) { return; }

if ( self.ProceduralFiltererAPI === undefined ) {
    self.ProceduralFiltererAPI = chrome.runtime.sendMessage({
        what: 'injectCSSProceduralAPI'
    }).catch(( ) => {
    });
}

await self.ProceduralFiltererAPI;
self.listsProceduralFiltererAPI = new self.ProceduralFiltererAPI();

const declaratives = p.filter(a => a.cssable);
if ( declaratives.length !== 0 ) {
    self.listsProceduralFiltererAPI.addDeclaratives(declaratives);
}
const procedurals = p.filter(a => !a.cssable);
if ( procedurals.length !== 0 ) {
    self.listsProceduralFiltererAPI.addProcedurals(procedurals);
}

/******************************************************************************/

})();

void 0;

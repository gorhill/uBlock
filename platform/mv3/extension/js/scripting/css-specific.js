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

const isolatedAPI = self.isolatedAPI;

const lookupHostname = (hostname, details) => {
    const listref = isolatedAPI.binarySearch(details.hostnames, hostname);
    if ( listref === -1 ) { return; }
    details.listrefs ||= [];
    details.listrefs.push(listref);
};

const lookupAll = hostname => {
    for ( const details of specificImports ) {
        lookupHostname(hostname, details);
    }
};

isolatedAPI.forEachHostname(lookupAll, {
    hasEntities: specificImports.some(a => a.hasEntities)
});

const toLookup = specificImports.filter(a => Array.isArray(a.listrefs));
if ( toLookup.length === 0 ) { return; }

const selectors = new Set();
const exceptions = new Set();

const lookupSelectors = async details => {
    const { rulesetId } = details;
    const key = `css.specific.data.${rulesetId}`;
    const data = await isolatedAPI.storageGet(key);
    if ( Boolean(data) === false ) { return; }
    if ( data.signature !== details.signature ) { return; }
    for ( const listref of details.listrefs ) {
        const ilist = data.selectorListRefs[listref];
        const list = JSON.parse(`[${data.selectorLists[ilist]}]`);
        for ( const iselector of list ) {
            if ( iselector >= 0 ) {
                selectors.add(data.selectors[iselector]);
            } else {
                exceptions.add(data.selectors[~iselector]);
            }
        }
    }
};

const promises = [];
for ( const details of toLookup ) {
    promises.push(lookupSelectors(details));
}

await Promise.all(promises);

for ( const selector of exceptions ) {
    selectors.delete(selector);
}

if ( selectors.size === 0 ) { return; }

const css = `${Array.from(selectors).join(',\n')}{display:none!important;}`;
self.cssAPI.insert(css);

/******************************************************************************/

})();

void 0;

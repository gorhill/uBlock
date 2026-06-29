/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
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

    Home: https://github.com/gorhill/uBlock
*/

import { hostnameCompare, isHnRegexOrPath } from './make-utils.js';
import { literalStrFromRegex } from './regex-analyzer.js';

/******************************************************************************/

export function makeCosmeticScripts(rulesetId, mapin) {
    if ( mapin === undefined ) { return; }
    if ( mapin.size === 0 ) { return; }

    // Collate all distinct selectors
    const allSelectors = new Map();
    const allHostnames = new Map();
    const allRegexesOrPaths = new Map();
    let hasEntities = false;

    const storeHostnameSelectorPair = (hn, iSelector) => {
        if ( isHnRegexOrPath(hn) ) {
            if ( allRegexesOrPaths.has(hn) === false ) {
                allRegexesOrPaths.set(hn, new Set());
            }
            allRegexesOrPaths.get(hn).add(iSelector);
        } else {
            if ( allHostnames.has(hn) === false ) {
                allHostnames.set(hn, new Set());
            }
            allHostnames.get(hn).add(iSelector);
            hasEntities ||= hn.endsWith('.*');
        }
    };

    for ( const [ selector, details ] of mapin ) {
        if ( details.rejected ) { continue; }
        if ( allSelectors.has(selector) === false ) {
            allSelectors.set(selector, allSelectors.size);
        }
        const iSelector = allSelectors.get(selector);
        if ( details.matches ) {
            for ( const hn of details.matches ) {
                storeHostnameSelectorPair(hn, iSelector);
            }
        }
        if ( details.excludeMatches ) {
            for ( const hn of details.excludeMatches ) {
                storeHostnameSelectorPair(hn, ~iSelector);
            }
        }
    }
    const allSelectorLists = new Map();

    const ilistFromSelectorSet = selectorSet => {
        const list = JSON.stringify(Array.from(selectorSet).sort()).slice(1, -1);
        if ( allSelectorLists.has(list) === false ) {
            allSelectorLists.set(list, allSelectorLists.size);
        }
        return allSelectorLists.get(list);
    };

    for ( const [ hn, selectorSet ] of allHostnames ) {
        allHostnames.set(hn, ilistFromSelectorSet(selectorSet));
    }
    for ( const [ regexOrPath, selectorSet ] of allRegexesOrPaths ) {
        allRegexesOrPaths.set(regexOrPath, ilistFromSelectorSet(selectorSet));
    }

    const sortedHostnames = Array.from(allHostnames.keys()).toSorted(hostnameCompare);

    const data = {
        rulesetId,
        selectors: Array.from(allSelectors.keys()),
        selectorLists: Array.from(allSelectorLists.keys()),
        selectorListRefs: sortedHostnames.map(a => allHostnames.get(a)),
        hostnames: sortedHostnames,
        hasEntities,
        regexes: Array.from(allRegexesOrPaths)
            .filter(a => a[0].startsWith('/') && a[0].endsWith('/'))
            .map(a => {
                const restr = a[0].slice(1,-1);
                return [ literalStrFromRegex(restr).slice(0,8), restr, a[1] ]
            }).flat(),
    };

    return {
        selectorCount: allSelectors.size,
        hostnameCount: sortedHostnames.length,
        regexCount: allRegexesOrPaths.size,
        data,
    };
}

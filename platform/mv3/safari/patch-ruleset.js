/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2025-present Raymond Hill

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

function patchRule(rule, out) {
    const copy = structuredClone(rule);
    const condition = copy.condition;
    if ( copy.action.type === 'modifyHeaders' ) { return; }
    if ( Array.isArray(copy.condition.responseHeaders) ) { return; }
    if ( Array.isArray(condition.requestMethods) ) { return; }
    if ( Array.isArray(condition.excludedRequestMethods) ) { return; }
    // https://github.com/uBlockOrigin/uBOL-home/issues/476#issuecomment-3299309478
    if ( copy.action.redirect?.transform?.queryTransform?.removeParams ) {
        const resourceTypes = condition.resourceTypes;
        if ( resourceTypes?.includes('main_frame') ) {
            condition.resourceTypes = resourceTypes.filter(a => a !== 'main_frame');
            if ( condition.resourceTypes.length === 0 ) { return; }
        }
    }
    if ( Array.isArray(condition.initiatorDomains) ) {
        condition.domains = condition.initiatorDomains;
        delete condition.initiatorDomains;
    }
    if ( Array.isArray(condition.excludedInitiatorDomains) ) {
        condition.excludedDomains = condition.excludedInitiatorDomains;
        delete condition.excludedInitiatorDomains;
    }
    // https://github.com/uBlockOrigin/uBOL-home/issues/434
    let { urlFilter } = condition;
    if ( urlFilter?.endsWith('^') ) {
        urlFilter = urlFilter.slice(0, -1);
        const match = /^(.*?\/\/|\|\|)/.exec(urlFilter);
        const pattern = match
            ? urlFilter.slice(match[0].length)
            : urlFilter;
        if ( /[^\w.%*-]/.test(pattern) ) {
            const extra = structuredClone(copy);
            extra.condition.urlFilter = `${urlFilter}|`;
            out.push(extra);
            console.log(`\tAdd ${extra.condition.urlFilter}`);
        }
    }
    out.push(copy);
    return copy;
}

export function patchRuleset(ruleset) {
    const out = [];
    for ( const rule of ruleset ) {
        if ( patchRule(rule, out) ) { continue; }
        console.log(`\tReject ${JSON.stringify(rule)}`);
    }
    return out;
}

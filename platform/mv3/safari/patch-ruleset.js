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

// https://github.com/WebKit/WebKit/blob/6cef2858442a4012b783876efd7dd8c0c5669cf9/Source/WebKit/UIProcess/Extensions/Cocoa/_WKWebExtensionDeclarativeNetRequestRule.mm#L1134
function patchRemoveParams(ruleset) {
    const isRemoveParamsRule = rule =>
        Array.isArray(rule.action.redirect?.transform?.queryTransform?.removeParams);
    const patchResourceTypes = rule => {
        const { condition } = rule;
        // https://github.com/uBlockOrigin/uBOL-home/issues/476#issuecomment-3299309478
        // https://github.com/uBlockOrigin/uBOL-home/issues/608
        const { resourceTypes } = condition;
        if ( resourceTypes?.length ) {
            condition.resourceTypes = resourceTypes.filter(a => a !== 'main_frame' && a !== 'image');
            console.log(`\tPatch requestParams types: "${resourceTypes.join()}" => "${condition.resourceTypes.join()}"`);
            return condition.resourceTypes.length !== 0;
        }
        return true;
    };
    const out = [];
    for ( const rule of ruleset ) {
        if ( isRemoveParamsRule(rule) ) {
            if ( patchResourceTypes(rule) !== true ) { continue; }
        }
        out.push(rule);
    }
    return out;
}

// https://github.com/uBlockOrigin/uBOL-home/issues/539
function patchForIssue539(ruleset) {
    const patchRule = rule => {
        const { condition } = rule;
        if ( Array.isArray(condition.requestDomains) === false ) { return; }
        if ( Array.isArray(condition.initiatorDomains) ) { return; }
        if ( Array.isArray(condition.excludedRequestDomains) ) {
            if ( Array.isArray(condition.excludedInitiatorDomains) ) { return; }
        }
        if ( Array.isArray(condition.resourceTypes) === false ) { return; }
        if ( condition.resourceTypes.length !== 1 ) { return; }
        if ( condition.resourceTypes.includes('main_frame') === false ) { return; }
        if ( condition.regexFilter === undefined ) { return; }
        condition.initiatorDomains = condition.requestDomains;
        delete condition.requestDomains;
        if ( Array.isArray(condition.excludedRequestDomains) ) {
            condition.excludedInitiatorDomains = condition.excludedRequestDomains;
            delete condition.excludedRequestDomains;
        }
        console.log(`\tIssue 539/Patch requestDomains to initiatorDomains: "${condition.initiatorDomains.join()}"`);
    };
    const out = [];
    for ( const rule of ruleset ) {
        patchRule(rule);
        out.push(rule);
    }
    return out;
}

// https://github.com/uBlockOrigin/uBOL-home/issues/434
function patchForIssue434(ruleset) {
    const out = [];
    for ( const rule of ruleset ) {
        out.push(rule);
        const { condition } = rule;
        let { urlFilter } = condition;
        if ( Boolean(urlFilter?.endsWith('^')) === false ) { continue; }
        urlFilter = urlFilter.slice(0, -1);
        const match = /^(.*?\/\/|\|\|)/.exec(urlFilter);
        const pattern = match
            ? urlFilter.slice(match[0].length)
            : urlFilter;
        if ( /[^\w.%*-]/.test(pattern) === false ) { continue; }
        const extra = structuredClone(rule);
        extra.condition.urlFilter = `${urlFilter}|`;
        out.push(extra);
        console.log(`\tIssue 434/Add rule for "${extra.condition.urlFilter}"`);
    }
    return out;
}

function discardUnsupportedRules(ruleset) {
    const isValidRule = rule => {
        const { action, condition } = rule;
        if ( action.type === 'modifyHeaders' ) { return false; }
        if ( Array.isArray(condition.topDomains) ) { return false; }
        if ( Array.isArray(condition.excludedTopDomains) ) { return false; }
        if ( Array.isArray(condition.responseHeaders) ) { return false; }
        if ( Array.isArray(condition.requestHeaders) ) { return false; }
        return true;
    };
    const out = [];
    for ( const rule of ruleset ) {
        if ( isValidRule(rule) ) {
            out.push(rule);
        } else {
            console.log(`\tReject ${JSON.stringify(rule)}`);
        }
    }
    return out;
}

function patchRequestDomains(ruleset) {
    const canMerge = rule => {
        const { condition } = rule;
        if ( Array.isArray(condition.requestDomains) === false ) { return false; }
        if ( condition.regexFilter ) { return false; }
        const { urlFilter } = condition;
        if ( urlFilter === undefined ) { return true; }
        if ( urlFilter.startsWith('^') ) { return true; }
        if ( urlFilter.startsWith('/') ) { return true; }
        if ( urlFilter.startsWith('?') ) { return true; }
        if ( urlFilter.startsWith('=') ) { return true; }
        return false;
        
    };
    const merge = (domain, urlFilter) => {
        if ( urlFilter === undefined ) {
            return `||${domain}/`;
        }
        if ( urlFilter.startsWith('^') ) {
            return `||${domain}/*${urlFilter}`;
        }
        if ( urlFilter.startsWith('/') ) {
            return `||${domain}*${urlFilter}`;
        }
        if ( urlFilter.startsWith('?') ) {
            return `||${domain}/*${urlFilter}`;
        }
        if ( urlFilter.startsWith('=') ) {
            return `||${domain}/*${urlFilter}`;
        }
    };
    const out = [];
    for ( const rule of ruleset ) {
        const { condition } = rule;
        if ( canMerge(rule) === false ) {
            out.push(rule); continue;
        }
        const { requestDomains, urlFilter } = condition;
        condition.requestDomains = undefined;
        for ( const domain of requestDomains ) {
            const copy = structuredClone(rule);
            copy.condition.urlFilter = merge(domain, urlFilter);
            console.log(`\tConvert requestDomains entry to urlFilter "${copy.condition.urlFilter}"`);
            out.push(copy);
        }
    }
    return out;
}

export function patchRuleset(ruleset) {
    ruleset = discardUnsupportedRules(ruleset);
    ruleset = patchForIssue434(ruleset);
    ruleset = patchForIssue539(ruleset);
    ruleset = patchRemoveParams(ruleset);
    ruleset = patchRequestDomains(ruleset);
    return ruleset;
}

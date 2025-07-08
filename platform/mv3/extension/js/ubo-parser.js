/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
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

import * as sfp from './static-filtering-parser.js';
import punycode from './punycode.js';
import redirectResourceMap from './redirect-resources.js';

/******************************************************************************/

const validResourceTypes = [
    'main_frame',
    'sub_frame',
    'stylesheet',
    'script',
    'image',
    'font',
    'object',
    'xmlhttprequest',
    'ping',
    'csp_report',
    'media',
    'websocket',
    'webtransport',
    'webbundle',
    'other',
];

/******************************************************************************/

const validRedirectResources = (( ) => {
    const out = new Map();
    for ( const [ name, resource ] of redirectResourceMap ) {
        out.set(name, name);
        if ( resource.alias === undefined ) { continue; }
        if ( typeof resource.alias === 'string' ) {
            out.set(resource.alias, name);
            continue;
        }
        if ( Array.isArray(resource.alias) ) {
            for ( const alias of resource.alias ) {
                out.set(alias, name);
            }
        }
    }
    return out;
})();

/******************************************************************************/

function parseHostnameList(iter) {
    const out = {
        included: {
            good: [],
            bad: [],
        },
        excluded: {
            good: [],
            bad: [],
        },
    };
    for ( let { hn, not, bad } of iter ) {
        bad ||= hn.includes('/') || hn.includes('*');
        const hnAscii = bad === false && hn.startsWith('xn--')
            ? punycode.toASCII(hn)
            : hn;
        const destination = not ? out.excluded : out.included;
        if ( bad ) {
            destination.bad.push(hnAscii);
        } else {
            destination.good.push(hnAscii);
        }
    }
    return out;
}

/******************************************************************************/

export function mergeIncludeExclude(rules) {
    const includeExcludes = [
        { includeName: 'requestDomains', excludeName: 'excludedRequestDomains' },
        { includeName: 'initiatorDomains', excludeName: 'excludedInitiatorDomains' },
        { includeName: 'resourceTypes', excludeName: 'excludedResourceTypes' },
        { includeName: 'requestMethods', excludeName: 'excludedRequestMethods' },
    ];
    for ( const { includeName, excludeName } of includeExcludes ) {
        const out = [];
        const distinctRules = new Map();
        for ( const rule of rules ) {
            const { id, condition } = rule;
            if ( Boolean(condition[includeName]?.length) === false ) {
                if ( Boolean(condition[excludeName]?.length) === false ) {
                    out.push(rule);
                    continue;
                }
            }
            const included = condition[includeName] || [];
            condition[includeName] = undefined;
            const excluded = condition[excludeName] || [];
            condition[excludeName] = undefined;
            rule.id = undefined;
            const hash = JSON.stringify(rule);
            const details = distinctRules.get(hash) ||
                { id, included: new Set(), excluded: new Set() };
            if ( details.included.size === 0 && details.excluded.size === 0 ) {
                distinctRules.set(hash, details);
            }
            for ( const hn of included ) {
                details.included.add(hn);
            }
            for ( const hn of excluded ) {
                if ( details.included.has(hn) ) { continue; }
                details.excluded.add(hn);
            }
        }
        for ( const [ hash, { id, included, excluded } ] of distinctRules ) {
            const rule = JSON.parse(hash);
            if ( id ) {
                rule.id = id;
            }
            if ( included.size !== 0 ) {
                rule.condition[includeName] = Array.from(included);
            }
            if ( excluded.size !== 0 ) {
                rule.condition[excludeName] = Array.from(excluded);
            }
            out.push(rule);
        }
        rules = out;
    }
    return rules;
}

/******************************************************************************/

function parseNetworkFilter(parser) {
    if ( parser.isNetworkFilter() === false ) { return; }
    if ( parser.hasError() ) { return; }

    const rule = {
        action: { type: 'block' },
        condition: { },
    };
    if ( parser.isException() ) {
        rule.action.type = 'allow';
    }

    let pattern = parser.getNetPattern();
    if ( parser.isHostnamePattern() ) {
        rule.condition.requestDomains = [ pattern ];
    } else if ( parser.isPlainPattern() || parser.isGenericPattern() ) {
        if ( parser.isLeftHnAnchored() ) {
            pattern = `||${pattern}`;
        } else if ( parser.isLeftAnchored() ) {
            pattern = `|${pattern}`;
        }
        if ( parser.isRightAnchored() ) {
            pattern = `${pattern}|`;
        }
        rule.condition.urlFilter = pattern;
    } else if ( parser.isRegexPattern() ) {
        rule.condition.regexFilter = pattern;
    } else if ( parser.isAnyPattern() === false ) {
        rule.condition.urlFilter = pattern;
    }

    const initiatorDomains = new Set();
    const excludedInitiatorDomains = new Set();
    const requestDomains = new Set();
    const excludedRequestDomains = new Set();
    const requestMethods = new Set();
    const excludedRequestMethods = new Set();
    const resourceTypes = new Set();
    const excludedResourceTypes = new Set();

    const processResourceType = (resourceType, nodeType) => {
        const not = parser.isNegatedOption(nodeType)
        if ( validResourceTypes.includes(resourceType) === false ) {
            if ( not ) { return; }
        }
        if ( not ) {
            excludedResourceTypes.add(resourceType);
        } else {
            resourceTypes.add(resourceType);
        }
    };

    let priority = 0;

    for ( const type of parser.getNodeTypes() ) {
        switch ( type ) {
        case sfp.NODE_TYPE_NET_OPTION_NAME_1P:
            rule.condition.domainType = parser.isNegatedOption(type)
                ? 'thirdParty'
                : 'firstParty';
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_STRICT1P:
        case sfp.NODE_TYPE_NET_OPTION_NAME_STRICT3P:
        case sfp.NODE_TYPE_NET_OPTION_NAME_BADFILTER:
        case sfp.NODE_TYPE_NET_OPTION_NAME_CNAME:
        case sfp.NODE_TYPE_NET_OPTION_NAME_EHIDE:
        case sfp.NODE_TYPE_NET_OPTION_NAME_GENERICBLOCK:
        case sfp.NODE_TYPE_NET_OPTION_NAME_GHIDE:
        case sfp.NODE_TYPE_NET_OPTION_NAME_IPADDRESS:
        case sfp.NODE_TYPE_NET_OPTION_NAME_REDIRECTRULE:
        case sfp.NODE_TYPE_NET_OPTION_NAME_REPLACE:
        case sfp.NODE_TYPE_NET_OPTION_NAME_SHIDE:
        case sfp.NODE_TYPE_NET_OPTION_NAME_URLSKIP:
            return;
        case sfp.NODE_TYPE_NET_OPTION_NAME_INLINEFONT:
        case sfp.NODE_TYPE_NET_OPTION_NAME_INLINESCRIPT:
        case sfp.NODE_TYPE_NET_OPTION_NAME_POPUNDER:
        case sfp.NODE_TYPE_NET_OPTION_NAME_POPUP:
        case sfp.NODE_TYPE_NET_OPTION_NAME_WEBRTC:
            processResourceType('', type);
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_3P:
            rule.condition.domainType = parser.isNegatedOption(type)
                ? 'firstParty'
                : 'thirdParty';
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_ALL:
            validResourceTypes.forEach(a => resourceTypes.add(a));
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_CSP:
            if ( rule.action.responseHeaders ) { return; }
            rule.action.type = 'modifyHeaders';
            rule.action.responseHeaders = [ {
                header: 'content-security-policy',
                operation: 'append',
                value: parser.getNetOptionValue(type),
            } ];
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_CSS:
            processResourceType('stylesheet', type);
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_DENYALLOW: {
            const { included, excluded } = parseHostnameList(
                parser.getNetFilterDenyallowOptionIterator()
            );
            if ( excluded.good.length !== 0 || excluded.bad.length !== 0 ) { return; }
            if ( included.bad.length !== 0 ) { return; }
            if ( included.good.length === 0 ) { return; }
            for ( const hn of included.good ) {
                excludedRequestDomains.add(hn);
            }
            break;
        }
        case sfp.NODE_TYPE_NET_OPTION_NAME_DOC:
            processResourceType('main_frame', type);
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_FONT:
            processResourceType('font', type);
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_FRAME:
            processResourceType('sub_frame', type);
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_FROM: {
            const { included, excluded } = parseHostnameList(
                parser.getNetFilterFromOptionIterator()
            );
            if ( included.good.length === 0 ) {
                if ( included.bad.length !== 0 ) { return; }
            }
            if ( excluded.bad.length !== 0 ) { return; }
            for ( const hn of included.good ) {
                initiatorDomains.add(hn);
            }
            for ( const hn of excluded.good ) {
                excludedInitiatorDomains.add(hn);
            }
            break;
        }
        case sfp.NODE_TYPE_NET_OPTION_NAME_HEADER: {
            const details = sfp.parseHeaderValue(parser.getNetOptionValue(type));
            const headerInfo = {
                header: details.name,
            };
            if ( details.value !== '' ) {
                if ( details.isRegex ) { return; }
                headerInfo.values = [ details.value ];
            }
            rule.condition.responseHeaders = [ headerInfo ];
            break;
        }
        case sfp.NODE_TYPE_NET_OPTION_NAME_IMAGE:
            processResourceType('image', type);
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_IMPORTANT:
            priority += 30;
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_MATCHCASE:
            rule.condition.isUrlFilterCaseSensitive = true;
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_MEDIA:
            processResourceType('media', type);
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_METHOD: {
            const value = parser.getNetOptionValue(type);
            for ( const method of value.toUpperCase().split('|') ) {
                const not = method.charCodeAt(0) === 0x7E /* '~' */;
                if ( not ) {
                    excludedRequestMethods.add(method.slice(1));
                } else {
                    requestMethods.add(method);
                }
            }
            break;
        }
        case sfp.NODE_TYPE_NET_OPTION_NAME_OBJECT:
            processResourceType('object', type);
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_OTHER:
            processResourceType('other', type);
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_PERMISSIONS:
            if ( rule.action.responseHeaders ) { return; }
            rule.action.type = 'modifyHeaders';
            rule.action.responseHeaders = [ {
                header: 'permissions-policy',
                operation: 'append',
                value: parser.getNetOptionValue(type),
            } ];
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_PING:
            processResourceType('ping', type);
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_REASON:
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_REDIRECT: {
            if ( rule.action.type !== 'block' ) { return; }
            let value = parser.getNetOptionValue(type);
            const match = /:(\d+)$/.exec(value);
            if ( match ) {
                const subpriority = parseInt(match[1], 10);
                priority += Math.min(subpriority, 8);
                value = value.slice(0, match.index);
            }
            if ( validRedirectResources.has(value) === false ) { return; }
            rule.action.type = 'redirect';
            rule.action.redirect = {
                extensionPath: `/web_accessible_resources/${validRedirectResources.get(value)}`,
            };
            priority += 11;
            break;
        }
        case sfp.NODE_TYPE_NET_OPTION_NAME_REMOVEPARAM: {
            const details = sfp.parseQueryPruneValue(parser.getNetOptionValue(type));
            if ( details.bad ) { return; }
            if ( details.not ) { return; }
            if ( details.re ) { return; }
            const removeParams = [];
            if ( details.name ) {
                removeParams.push(details.name);
            }
            rule.action.type = 'redirect';
            rule.action.redirect = {
                transform: { queryTransform: { removeParams } }
            };
            break;
        }
        case sfp.NODE_TYPE_NET_OPTION_NAME_SCRIPT:
            processResourceType('script', type);
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_TO: {
            const { included, excluded } = parseHostnameList(
                parser.getNetFilterToOptionIterator()
            );
            if ( included.good.length === 0 ) {
                if ( included.bad.length !== 0 ) { return; }
            }
            if ( excluded.bad.length !== 0 ) { return; }
            for ( const hn of included.good ) {
                requestDomains.add(hn);
            }
            for ( const hn of excluded.good ) {
                excludedRequestDomains.add(hn);
            }
            break;
        }
        case sfp.NODE_TYPE_NET_OPTION_NAME_URLTRANSFORM:
            if ( this.processOptionWithValue(parser, type) === false ) {
                return this.FILTER_INVALID;
            }
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_XHR:
            processResourceType('xmlhttprequest', type);
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_WEBSOCKET:
            processResourceType('websocket', type);
            break;
        default:
            break;
        }
    }
    if ( initiatorDomains.size !== 0 ) {
        rule.condition.initiatorDomains = Array.from(initiatorDomains);
    }
    if ( excludedInitiatorDomains.size !== 0 ) {
        rule.condition.excludedInitiatorDomains = Array.from(excludedInitiatorDomains);
    }
    if ( requestDomains.size !== 0 ) {
        rule.condition.requestDomains = Array.from(requestDomains);
    }
    if ( excludedRequestDomains.size !== 0 ) {
        rule.condition.excludedRequestDomains = Array.from(excludedRequestDomains);
    }
    if ( requestMethods.size !== 0 ) {
        rule.condition.requestMethods = Array.from(requestMethods);
    }
    if ( excludedRequestMethods.size !== 0 ) {
        rule.condition.excludedRequestMethods = Array.from(excludedRequestMethods);
    }
    if ( resourceTypes.size !== 0 ) {
        const types = Array.from(resourceTypes).filter(a => a !== '');
        if ( types.length === 0 ) { return; }
        rule.condition.resourceTypes = types;
    }
    if ( excludedResourceTypes.size !== 0 ) {
        if ( resourceTypes.size !== 0 ) {
            if ( excludedResourceTypes.size !== 0 ) { return; }
        }
        rule.condition.excludedResourceTypes = Array.from(excludedResourceTypes);
    }
    if ( priority !== 0 ) {
        rule.priority = priority;
    }
    return rule;
}

/******************************************************************************/

export function parseFilters(text) {
    if ( text.startsWith('---') ) { return; }
    if ( text.endsWith('---') ) { return; }
    const lines = text.split(/\n/);
    if ( lines.some(a => a.startsWith(' ')) ) { return; }
    const rules = [];
    const parser = new sfp.AstFilterParser({ trustedSource: true });
    for ( const line of lines ) {
        parser.parse(line);
        if ( parser.isNetworkFilter() === false ) { continue; }
        const rule = parseNetworkFilter(parser);
        if ( rule === undefined ) { continue; }
        rules.push(rule);
    }
    return mergeIncludeExclude(rules);
}

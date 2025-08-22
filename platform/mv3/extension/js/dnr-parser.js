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

/******************************************************************************/

const validActionValues = [
    'block',
    'redirect',
    'allow',
    'upgradeScheme',
    'modifyHeaders',
    'allowAllRequests',
];

const validBoolValues = [
    'false',
    'true',
];

const validHeaderOpValues = [
    'append',
    'remove',
    'set',
];

const validDomainTypeValues = [
    'firstParty',
    'thirdParty',
];

const validRequestMethodValues = [
    'connect',
    'delete',
    'get',
    'head',
    'options',
    'patch',
    'post',
    'put',
    'other',
];

const validResourceTypeValues = [
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

function selectParser(scope, rule, node) {
    const parser = perScopeParsers[scope.join('.')];
    if ( parser === undefined ) { return false; }
    return parser(scope, rule, node);
}

const perScopeParsers = {
    '': function(scope, rule, node) {
        const { key, val } = node;
        switch ( key ) {
        case 'action':
        case 'condition':
            if ( val !== undefined ) { return false; }
            rule[key] = {};
            scope.push(key);
            break;
        case 'id': {
            const n = parseInt(val, 10);
            if ( isNaN(n) || n < 1) { return false; }
            rule.id = n;
            break;
        }
        case 'priority': {
            const n = parseInt(val, 10);
            if ( isNaN(n) || n < 1 ) { return false; }
            rule.priority = n;
            break;
        }
        default:
            return false;
        }
        return true;
    },
    'action': function(scope, rule, node) {
        const { key, val } = node;
        switch ( key ) {
        case 'type':
            if ( validActionValues.includes(val) === false ) { return false; }
            rule.action.type = val;
            break;
        case 'redirect':
            rule.action.redirect = {};
            scope.push('redirect');
            break;
        case 'requestHeaders':
        case 'responseHeaders':
            rule.action[key] = [];
            scope.push(key);
            break;
        default:
            return false;
        }
        return true;
    },
    'action.redirect': function(scope, rule, node) {
        const { key, val } = node;
        switch ( key ) {
        case 'extensionPath':
        case 'regexSubstitution':
        case 'url':
            rule.action.redirect[key] = val;
            break;
        case 'transform':
            rule.action.redirect.transform = {};
            scope.push('transform');
            break;
        default:
            return false;
        }
        return true;
    },
    'action.redirect.transform': function(scope, rule, node) {
        const { key, val } = node;
        switch ( key ) {
        case 'fragment':
        case 'host':
        case 'path':
        case 'port':
        case 'query':
        case 'scheme': {
            if ( val === undefined ) { return false; }
            rule.action.redirect.transform[key] = val;
            break;
        }
        case 'queryTransform':
            rule.action.redirect.transform.queryTransform = {};
            scope.push('queryTransform');
            break;
        default:
            return false;
        }
        return true;
    },
    'action.redirect.transform.queryTransform': function(scope, rule, node) {
        const { key, val } = node;
        if ( val !== undefined ) { return false; }
        switch ( key ) {
        case 'addOrReplaceParams':
        case 'removeParams':
            rule.action.redirect.transform.queryTransform[key] = [];
            scope.push(key);
            break;
        default:
            return false;
        }
        return true;
    },
    'action.redirect.transform.queryTransform.addOrReplaceParams': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        rule.action.redirect.transform.queryTransform.addOrReplaceParams.push({});
        scope.push('@');
        return selectParser(scope, rule, node);
    },
    'action.redirect.transform.queryTransform.addOrReplaceParams.@': function(scope, rule, node) {
        const { key, val } = node;
        if ( val === undefined ) { return false; }
        const item = rule.action.redirect.transform.queryTransform.addOrReplaceParams.at(-1);
        switch ( key ) {
        case 'key':
        case 'value':
            item[key] = val;
            break;
        case 'replaceOnly':
            if ( validBoolValues.includes(val) === false ) { return false; }
            item.replaceOnly = val === 'true';
            break;
        default:
            return false;
        }
        return true;
    },
    'action.redirect.transform.queryTransform.removeParams': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        rule.action.redirect.transform.queryTransform.removeParams.push(node.val);
        return true;
    },
    'action.requestHeaders': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        rule.action.requestHeaders.push({});
        scope.push('@');
        return selectParser(scope, rule, node);
    },
    'action.requestHeaders.@': function(scope, rule, node) {
        const { key, val } = node;
        const item = rule.action.requestHeaders.at(-1);
        switch ( key ) {
        case 'header':
        case 'value':
            item[key] = val;
            break;
        case 'operation':
            if ( validHeaderOpValues.includes(val) === false ) { return false; }
            item.operation = val;
            break;
        default:
            return false;
        }
        return true;
    },
    'action.responseHeaders': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        rule.action.responseHeaders.push({});
        scope.push('@');
        return selectParser(scope, rule, node);
    },
    'action.responseHeaders.@': function(scope, rule, node) {
        const { key, val } = node;
        const item = rule.action.responseHeaders.at(-1);
        switch ( key ) {
        case 'header':
        case 'value':
            item[key] = val;
            break;
        case 'operation':
            if ( validHeaderOpValues.includes(val) === false ) { return false; }
            item.operation = val;
            break;
        default:
            return false;
        }
        return true;
    },
    'condition': function(scope, rule, node) {
        const { key, val } = node;
        switch ( key ) {
        case 'domainType':
            if ( validDomainTypeValues.includes(val) === false ) { return false; }
            rule.condition.domainType = val;
            break;
        case 'isUrlFilterCaseSensitive':
            if ( validBoolValues.includes(val) === false ) { return false; }
            rule.condition.isUrlFilterCaseSensitive = val === 'true';
            break;
        case 'regexFilter':
        case 'urlFilter':
            if ( val === undefined ) { return false; }
            rule.condition[key] = val;
            break;
        case 'initiatorDomains':
        case 'excludedInitiatorDomains':
        case 'requestDomains':
        case 'excludedRequestDomains':
        case 'resourceTypes':
        case 'excludedResourceTypes':
        case 'requestMethods':
        case 'excludedRequestMethods':
        case 'responseHeaders':
        case 'excludedResponseHeaders':
            rule.condition[key] = [];
            scope.push(key);
            break;
        case 'tabIds':
            rule.condition.tabIds = [];
            scope.push('tabIds');
            break;
        default:
            return false;
        }
        return true;
    },
    'condition.initiatorDomains': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        rule.condition.initiatorDomains.push(node.val);
        return true;
    },
    'condition.excludedInitiatorDomains': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        rule.condition.excludedInitiatorDomains.push(node.val);
        return true;
    },
    'condition.domains': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        rule.condition.domains.push(node.val);
        return true;
    },
    'condition.excludedDomains': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        rule.condition.excludedDomains.push(node.val);
        return true;
    },
    'condition.requestDomains': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        rule.condition.requestDomains.push(node.val);
        return true;
    },
    'condition.excludedRequestDomains': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        rule.condition.excludedRequestDomains.push(node.val);
        return true;
    },
    'condition.resourceTypes': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        if ( validResourceTypeValues.includes(node.val) === false ) { return false; }
        rule.condition.resourceTypes.push(node.val);
        return true;
    },
    'condition.excludedResourceTypes': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        if ( validResourceTypeValues.includes(node.val) === false ) { return false; }
        rule.condition.excludedResourceTypes.push(node.val);
        return true;
    },
    'condition.requestMethods': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        if ( validRequestMethodValues.includes(node.val) === false ) { return false; }
        rule.condition.requestMethods.push(node.val);
        return true;
    },
    'condition.excludedRequestMethods': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        if ( validRequestMethodValues.includes(node.val) === false ) { return false; }
        rule.condition.excludedRequestMethods.push(node.val);
        return true;
    },
    'condition.responseHeaders': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        rule.condition.responseHeaders.push({});
        scope.push('@');
        return selectParser(scope, rule, node);
    },
    'condition.responseHeaders.@': function(scope, rule, node) {
        const item = rule.condition.responseHeaders.at(-1);
        switch ( node.key ) {
        case 'header':
            if ( node.val === undefined ) { return false; }
            item.header = node.val;
            break;
        case 'values':
        case 'excludedValues':
            item[node.key] = [];
            scope.push(node.key);
            break;
        default:
            return false;
        }
        return true;
    },
    'condition.responseHeaders.@.values': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        const item = rule.condition.responseHeaders.at(-1);
        item.values.push(node.val);
        return true;
    },
    'condition.responseHeaders.@.excludedValues': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        const item = rule.condition.responseHeaders.at(-1);
        item.excludedValues.push(node.val);
        return true;
    },
    'condition.excludedResponseHeaders': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        rule.condition.excludedResponseHeaders.push({});
        scope.push('@');
        return selectParser(scope, rule, node);
    },
    'condition.excludedResponseHeaders.@': function(scope, rule, node) {
        const item = rule.condition.excludedResponseHeaders.at(-1);
        switch ( node.key ) {
        case 'header':
            if ( node.val === undefined ) { return false; }
            item.header = node.val;
            break;
        case 'values':
        case 'excludedValues':
            item[node.key] = [];
            scope.push(node.key);
            break;
        default:
            return false;
        }
        return true;
    },
    'condition.excludedResponseHeaders.@.values': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        const item = rule.condition.excludedResponseHeaders.at(-1);
        item.values.push(node.val);
        return true;
    },
    'condition.excludedResponseHeaders.@.excludedValues': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        const item = rule.condition.excludedResponseHeaders.at(-1);
        item.excludedValues.push(node.val);
        return true;
    },
    'condition.tabIds': function(scope, rule, node) {
        if ( node.list !== true ) { return false; }
        const n = parseInt(node.val, 10);
        if ( isNaN(n) || n === 0 ) { return false; }
        rule.condition.tabIds.push(n);
    },
};

/******************************************************************************/

function depthFromIndent(line) {
    const match = /^\s*/.exec(line);
    const count = match[0].length;
    if ( (count & 1) !== 0 ) { return -1; }
    return count / 2;
}

/******************************************************************************/

function nodeFromLine(line) {
    const match = reNodeParser.exec(line);
    const out = {};
    if ( match === null ) { return out; }
    if ( match[1] ) {
        out.list = true;
    }
    if ( match[4] ) {
        out.val = match[4].trim();
    } else if ( match[3] ) {
        out.key = match[2];
        out.val = match[3].trim();
        if ( out.val === "''" ) { out.val = '' };
    } else {
        out.key = match[2];
    }
    return out;
}

const reNodeParser = /^\s*(- )?(?:(\S+):( \S.*)?|(\S.*))$/;

/******************************************************************************/

function ruleFromLines(lines, indices) {
    const rule = {};
    const bad = [];
    const scope = [];
    for ( const i of indices ) {
        const line = lines[i];
        const depth = depthFromIndent(line);
        if ( depth < 0 ) {
            bad.push(i);
            continue;
        }
        scope.length = depth;
        const node = nodeFromLine(line);
        const result = selectParser(scope, rule, node);
        if ( result === false ) {
            bad.push(i);
        }
    }
    if ( bad.length !== 0 ) { return { bad }; }
    return { rule };
}

/******************************************************************************/

export function rulesFromText(text) {
    const rules = [];
    const bad = [];
    const lines = [ ...text.split(/\n\r|\r\n|\n|\r/), '---' ];
    const indices = [];
    for ( let i = 0; i < lines.length; i++ ) {
        const line = lines[i].trimEnd();
        if ( line.trim().startsWith('#') ) { continue; }
        if ( line !== '---' && line !== '...' ) {
            indices.push(i);
            continue;
        }
        // Discard leading empty lines
        while ( indices.length !== 0 ) {
            const s = lines[indices[0]].trim();
            if ( s.length !== 0 ) { break; }
            indices.shift();
        }
        // Discard trailing empty lines
        while ( indices.length !== 0 ) {
            const s = lines[indices.at(-1)].trim();
            if ( s.length !== 0 ) { break; }
            indices.pop();
        }
        if ( indices.length === 0 ) { continue; }
        const result = ruleFromLines(lines, indices);
        if ( result.bad ) {
            bad.push(...result.bad.slice(4));
        } else if ( result.rule ) {
            rules.push(result.rule);
        }
        indices.length = 0;
    }
    return { rules, bad };
}

/******************************************************************************/

function textFromValue(val, depth) {
    const indent = '  '.repeat(depth);
    switch ( typeof val ) {
    case 'boolean':
    case 'number':
        return `${val}`;
    case 'string':
        if ( val === '' ) { return "''"; }
        return val;
    }
    const out = [];
    if ( Array.isArray(val) ) {
        for ( const a of val ) {
            const s = textFromValue(a, depth+1);
            if ( s === undefined ) { continue; }
            out.push(`${indent}- ${s.trimStart()}`);
        }
        return out.join('\n');
    }
    if ( val instanceof Object ) {
        for ( const [ a, b ] of Object.entries(val) ) {
            const s = textFromValue(b, depth+1);
            if ( s === undefined ) { continue; }
            if ( b instanceof Object ) {
                out.push(`${indent}${a}:\n${s}`);
            } else {
                out.push(`${indent}${a}: ${s}`);
            }
        }
        return out.join('\n');
    }
}

/******************************************************************************/

export function textFromRules(rules, option = {}) {
    if ( Array.isArray(rules) === false ) {
        if ( rules instanceof Object === false ) { return; }
        rules = [ rules ];
    }
    const out = [];
    for ( const rule of rules ) {
        if ( option.keepId !== true && rule.id ) { rule.id = undefined };
        const text = textFromValue(rule, 0);
        if ( text === undefined ) { continue; }
        out.push(text, '---' );
    }
    if ( out.length !== 0 ) {
        out.unshift('---');
        out.push('');
    }
    return out.join('\n');
}

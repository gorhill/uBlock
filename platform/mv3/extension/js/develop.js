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

import { dom, qs$ } from './dom.js';
import {
    localRead,
    localRemove,
    localWrite,
    sendMessage,
} from './ext.js';
import { rulesFromText } from './dnr-parser.js';

/******************************************************************************/

// Details of YAML document(s) intersecting with a text span. If the text span
// starts on a YAML document divider, the previous YAML document will be
// included. If the text span ends on a YAML document divider, the next YAML
// document will be included.

function snapToYamlDocument(doc, start, end) {
    let yamlDocStart = doc.lineAt(start).number;
    if ( reYamlDocSeparator.test(doc.line(yamlDocStart).text) ) {
        if ( yamlDocStart > 1 ) {
            yamlDocStart -= 1;
        }
    }
    while ( yamlDocStart > 1 ) {
        const line = doc.line(yamlDocStart);
        if ( reYamlDocSeparator.test(line.text) ) { break; }
        yamlDocStart -= 1;
    }
    const lastLine = doc.lines;
    let yamlDocEnd = doc.lineAt(end).number;
    if ( reYamlDocSeparator.test(doc.line(yamlDocEnd).text) ) {
        if ( yamlDocEnd < lastLine ) {
            yamlDocEnd += 1;
        }
    }
    while ( yamlDocEnd < lastLine ) {
        const line = doc.line(yamlDocEnd);
        if ( reYamlDocSeparator.test(line.text) ) { break; }
        yamlDocEnd += 1;
    }
    return { yamlDocStart, yamlDocEnd };
}

function addToModifiedRange(doc, start, end) {
    const { yamlDocStart, yamlDocEnd } = snapToYamlDocument(doc, start, end);
    if ( modifiedRange.start === -1 || yamlDocStart < modifiedRange.start ) {
        modifiedRange.start = yamlDocStart;
    }
    if ( modifiedRange.end === -1 || yamlDocEnd > modifiedRange.end ) {
        modifiedRange.end = yamlDocEnd;
    }
}

const reYamlDocSeparator = /^(?:---|...)\s*$/;
const modifiedRange = { start: -1, end: -1 };

/******************************************************************************/

function lineIndentAt(line) {
    const match = /^(?: {2})*/.exec(line.text);
    const indent = match !== null ? match[0].length : -1;
    if ( indent === -1 || (indent & 1) !== 0 ) { return -1; }
    return indent / 2;
}

function getScopeAt(from) {
    const { doc }  = cmRules.state;
    const lineFrom = doc.lineAt(from);
    let depth = lineIndentAt(lineFrom);
    if ( depth === -1 ) { return; }
    const text = lineFrom.text.trim();
    if ( text.startsWith('#') ) { return; }
    const path = [];
    const pos = text.indexOf(':');
    if ( pos !== -1 ) {
        path.push(text.slice(0, pos+1));
    }
    let lineNo = lineFrom.number;
    while ( depth > 0 && lineNo > 1 ) {
        lineNo -= 1;
        const lineBefore = doc.line(lineNo);
        const text = lineBefore.text.trim();
        if ( text.startsWith('#') ) { continue; }
        if ( lineIndentAt(lineBefore) === (depth-1) ) {
            path.unshift(text);
            depth -= 1;
        }
    }
    return path.join('');
}

function getAutocompleteCandidates(from) {
    const scope = getScopeAt(from);
    switch ( scope ) {
    case '':
        return [
            [ 'action:', '\n  ' ],
            [ 'condition:', '\n  ' ],
            [ 'priority:', ' ' ],
            [ '---', '\n' ],
        ];
    case 'action:':
        return [
            [ 'type:', ' ' ],
            [ 'redirect:', '\n    ' ],
            [ 'requestHeaders:', '\n    ' ],
            [ 'responseHeaders:', '\n    ' ],
        ];
    case 'action:type:':
        return [
            [ 'block', '\n  ' ],
            [ 'redirect', '\n  ' ],
            [ 'upgradeScheme', '\n  ' ],
            [ 'allow', '\n  ' ],
            [ 'allowAllRequest', '\n  ' ],
        ];
    case 'action:redirect:':
        return [
            [ 'extensionPath:', ' ' ],
            [ 'regexSubstitution:', ' ' ],
            [ 'transform:', '\n      ' ],
            [ 'url:', ' ' ],
        ];
    case 'action:redirect:transform:':
        return [
            [ 'fragment:', ' ' ],
            [ 'host:', ' ' ],
            [ 'path:', ' ' ],
            [ 'port:', ' ' ],
            [ 'query:', ' ' ],
            [ 'scheme:', ' ' ],
            [ 'queryTransform:', '\n        ' ],
        ];
    case 'action:redirect:transform:queryTransform:':
        return [
            [ 'addOrReplaceParams:', '\n          - ' ],
            [ 'removeParams:', '\n          - ' ],
        ];
    case 'condition:':
        return [
            [ 'domainType:', ' ' ],
            [ 'isUrlFilterCaseSensitive:', ' ' ],
            [ 'regexFilter:', ' ' ],
            [ 'urlFilter:', ' ' ],
            [ 'initiatorDomains:', '\n    - ' ],
            [ 'excludedInitiatorDomains:', '\n    - ' ],
            [ 'requestDomains:', '\n    - ' ],
            [ 'excludedRequestDomains:', '\n    - ' ],
            [ 'resourceTypes:', '\n    - ' ],
            [ 'excludedResourceTypes:', '\n    - ' ],
            [ 'requestMethods:', '\n    - ' ],
            [ 'excludedRequestMethods:', '\n    - ' ],
            [ 'responseHeaders:', '\n    - ' ],
            [ 'excludedResponseHeaders:', '\n    - ' ],
        ];
    case 'condition:domainType:':
        return [
            [ 'firstParty', '\n  ' ],
            [ 'thirdParty', '\n  ' ],
        ];
    case 'condition:isUrlFilterCaseSensitive:':
        return [
            [ 'true', '\n  ' ],
            [ 'false', '\n  ' ],
        ];
    case 'condition:requestMethods:':
    case 'condition:excludedRequestMethods:':
        return [
            [ 'connect', '\n    - ' ],
            [ 'delete', '\n    - ' ],
            [ 'get', '\n    - ' ],
            [ 'head', '\n    - ' ],
            [ 'options', '\n    - ' ],
            [ 'patch', '\n    - ' ],
            [ 'post', '\n    - ' ],
            [ 'put', '\n    - ' ],
            [ 'other', '\n  ' ],
        ];
    case 'condition:resourceTypes:':
    case 'condition:excludedResourceTypes:':
        return [
            [ 'main_frame', '\n    - ' ],
            [ 'sub_frame', '\n    - ' ],
            [ 'stylesheet', '\n    - ' ],
            [ 'script', '\n    - ' ],
            [ 'image', '\n    - ' ],
            [ 'font', '\n    - ' ],
            [ 'object', '\n    - ' ],
            [ 'xmlhttprequest', '\n    - ' ],
            [ 'ping', '\n    - ' ],
            [ 'csp_report', '\n    - ' ],
            [ 'media', '\n    - ' ],
            [ 'websocket', '\n    - ' ],
            [ 'webtransport', '\n    - ' ],
            [ 'webbundle', '\n    - ' ],
            [ 'other', '\n  ' ],
        ];
    }
}

function autoComplete(context) {
    const match = context.matchBefore(/[\w-]*/);
    if ( match === undefined ) { return null; }
    const candidates = getAutocompleteCandidates(match.from);
    if ( candidates === undefined ) { return null; }
    return {
        from: match.from,
        options: candidates.map(e => ({ label: e[0], apply: `${e[0]}${e[1]}` })),
    };
}

/******************************************************************************/

function setEditorText(text) {
    if ( text === undefined ) { return; }
    if ( text !== '' ) { text += '\n'; }
    cmRules.dispatch({
        changes: {
            from: 0, to: cmRules.state.doc.length,
            insert: text
        },
    });
}

function getEditorText() {
    return cmRules.state.doc.toString();
}

/******************************************************************************/

function saveEditorText() {
    const text = getEditorText().trim();
    const promise = text.length !== 0
        ? localWrite('userDnrRules', text)
        : localRemove('userDnrRules');
    promise.then(( ) => {
        lastSavedText = text;
        updateWidgets();
    }).then(( ) => {
        sendMessage({ what: 'updateUserDnrRules' });
    });
}

/******************************************************************************/

function updateWidgets() {
    const { doc } = cmRules.state;
    const changed = doc.toString().trim() !== 
        lastSavedText.trim();
    dom.attr('#dnrRulesApply', 'disabled', changed ? null : '');
    dom.attr('#dnrRulesRevert', 'disabled', changed ? null : '');
    const { start, end } = modifiedRange;
    if ( start === -1 || end === -1 ) { return; }
    modifiedRange.start = modifiedRange.end = -1;
    self.cm6.lineErrorClear(cmRules, start, end);
    const firstLine = doc.line(start);
    const lastLine = doc.line(end);
    const text = doc.sliceString(firstLine.from, lastLine.to);
    const { bad } = rulesFromText(text);
    if ( Boolean(bad?.length) === false ) { return; }
    self.cm6.lineErrorAdd(cmRules, bad.map(i => i + start));
}

function updateWidgetsAsync() {
    if ( updateWidgetsAsync.timer !== undefined ) { return; }
    updateWidgetsAsync.timer = self.setTimeout(( ) => {
        updateWidgetsAsync.timer = undefined;
        updateWidgets();
    }, 71);
}

/******************************************************************************/

const cmRules = (( ) => {
    return self.cm6.createEditorView({
        dnrRules: true,
        oneDark: dom.cl.has(':root', 'dark'),
        updateListener: function(info) {
            if ( info.docChanged === false ) { return; }
            const doc = info.state.doc;
            info.changes.desc.iterChangedRanges((fromA, toA, fromB, toB) => {
                addToModifiedRange(doc, fromB, toB);
            });
            updateWidgetsAsync();
        },
        saveListener: function() {
            saveEditorText();
        },
        lineError: 'bad',
        // https://codemirror.net/examples/autocompletion/
        autocompletion: {
            override: [ autoComplete ],
            activateOnCompletion: ( ) => true,
        },
    }, qs$('#cm-dnrRules'));
})();

/******************************************************************************/

let lastSavedText = '';

localRead('userDnrRules').then(text => {
    text ||= '';
    setEditorText(text);
    lastSavedText = text;
});

/******************************************************************************/

dom.on('#dnrRulesApply', 'click', ( ) => {
    saveEditorText();
});

dom.on('#dnrRulesRevert', 'click', ( ) => {
    setEditorText(lastSavedText);
    sendMessage({ what: 'updateUserDnrRules' });
});

/******************************************************************************/

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

import {
    browser,
    localRead,
    localRemove,
    localWrite,
    sendMessage,
} from './ext.js';
import { dom, qs$ } from './dom.js';
import { rulesFromText, textFromRules } from './dnr-parser.js';
import { dnr } from './ext-compat.js';
import { i18n$ } from './i18n.js';

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

function rangeFromTransaction(transaction) {
    let from, to;
    transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
        if ( from === undefined || fromB < from ) { from = fromB; }
        if ( to === undefined || toB > to ) { to = toB; }
    });
    return { from, to };
}

function addToModifiedRange(transaction) {
    const { newDoc } = transaction;
    const { from, to } = rangeFromTransaction(transaction);
    if ( from === undefined || to === undefined ) { return; }
    const { yamlDocStart, yamlDocEnd } = snapToYamlDocument(newDoc, from, to);
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

function rulesFromJSON(json) {
    let content = json.trim();
    if ( /^[[{]/.test(content) === false ) {
        const match = /^[^[{]+/.exec(content);
        if ( match === null ) { return; }
        content = content.slice(match[0].length);
    }
    const firstChar = content.charAt(0);
    const expectedLastChar = firstChar === '[' ? ']' : '}';
    if ( content.at(-1) !== expectedLastChar ) {
        const re = new RegExp(`\\${expectedLastChar}[^\\${expectedLastChar}]+$`);
        const match = re.exec(content);
        if ( match === null ) { return; }
        content = content.slice(0, match.index+1);
    }
    if ( content.startsWith('{') && content.endsWith('}') ) {
        content = `[${content}]`;
    }
    try {
        const rules = JSON.parse(content);
        if ( Array.isArray(rules) ) { return rules; }
    }
    catch {
    }
}

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
        if ( lineIndentAt(lineBefore) > (depth-1) ) { continue; }
        const match = /^- ([^:]+:)/.exec(text);
        if ( match !== null ) {
            path.unshift(match[1]);
        } else {
            path.unshift(text);
        }
        depth -= 1;
    }
    return path.join('');
}

function getAutocompleteCandidates(from) {
    const scope = getScopeAt(from);
    switch ( scope ) {
    case '':
        return {
            before: /^$/,
            candidates: [
                { token: 'action:', after: '\n  ' },
                { token: 'condition:', after: '\n  ' },
                { token: 'priority:', after: ' ' },
                { token: '---', after: '\n' },
            ]
        };
    case 'action:':
        return {
            before: /^ {2}$/,
            candidates: [
                { token: 'type:', after: ' ' },
                { token: 'redirect:', after: '\n    ' },
                { token: 'requestHeaders:', after: '\n    - header: ' },
                { token: 'responseHeaders:', after: '\n    - header: ' },
            ],
        };
    case 'action:type:':
        return {
            before: /: $/,
            candidates: [
                { token: 'block', after: '\n  ' },
                { token: 'redirect', after: '\n  ' },
                { token: 'allow', after: '\n  ' },
                { token: 'modifyHeaders', after: '\n  ' },
                { token: 'upgradeScheme', after: '\n  ' },
                { token: 'allowAllRequest', after: '\n  ' },
            ],
        };
    case 'action:redirect:':
        return {
            before: /^ {4}$/,
            candidates: [
                { token: 'extensionPath:', after: ' ' },
                { token: 'regexSubstitution:', after: ' ' },
                { token: 'transform:', after: '\n      ' },
                { token: 'url:', after: ' ' },
            ],
        };
    case 'action:redirect:transform:':
        return {
            before: /^ {6}$/,
            candidates: [
                { token: 'fragment:', after: ' ' },
                { token: 'host:', after: ' ' },
                { token: 'path:', after: ' ' },
                { token: 'port:', after: ' ' },
                { token: 'query:', after: ' ' },
                { token: 'scheme:', after: ' ' },
                { token: 'queryTransform:', after: '\n        ' },
            ],
        };
    case 'action:redirect:transform:queryTransform:':
        return {
            before: /^ {8}$/,
            candidates: [
                { token: 'addOrReplaceParams:', after: '\n          - ' },
                { token: 'removeParams:', after: '\n          - ' },
            ],
        };
    case 'action:responseHeaders:':
        return {
            before: /^ {4}- $/,
            candidates: [
                { token: 'header:', after: ' ' },
            ],
        };
    case 'action:responseHeaders:header:':
        return {
            before: /^ {6}$/,
            candidates: [
                { token: 'operation:', after: ' ' },
                { token: 'value:', after: ' ' },
            ],
        };
    case 'action:responseHeaders:header:operation:':
        return {
            before: /: $/,
            candidates: [
                { token: 'append', after: '\n      value: ' },
                { token: 'set', after: '\n      value: ' },
                { token: 'remove', after: '\n    ' },
            ],
        };
    case 'condition:':
        return {
            before: /^ {2}$/,
            candidates: [
                { token: 'domainType:', after: ' ' },
                { token: 'isUrlFilterCaseSensitive:', after: ' ' },
                { token: 'regexFilter:', after: ' ' },
                { token: 'urlFilter:', after: ' ' },
                { token: 'initiatorDomains:', after: '\n    - ' },
                { token: 'excludedInitiatorDomains:', after: '\n    - ' },
                { token: 'requestDomains:', after: '\n    - ' },
                { token: 'excludedRequestDomains:', after: '\n    - ' },
                { token: 'resourceTypes:', after: '\n    - ' },
                { token: 'excludedResourceTypes:', after: '\n    - ' },
                { token: 'requestMethods:', after: '\n    - ' },
                { token: 'excludedRequestMethods:', after: '\n    - ' },
                { token: 'responseHeaders:', after: '\n    - ' },
                { token: 'excludedResponseHeaders:', after: '\n    - ' },
            ],
        };
    case 'condition:domainType:':
        return {
            before: /: $/,
            candidates: [
                { token: 'firstParty', after: '\n  ' },
                { token: 'thirdParty', after: '\n  ' },
            ],
        };
    case 'condition:isUrlFilterCaseSensitive:':
        return {
            before: /: $/,
            candidates: [
                { token: 'true', after: '\n  ' },
                { token: 'false', after: '\n  ' },
            ],
        };
    case 'condition:requestMethods:':
    case 'condition:excludedRequestMethods:':
        return {
            before: /^ {4}- $/,
            candidates: [
                { token: 'connect', after: '\n    - ' },
                { token: 'delete', after: '\n    - ' },
                { token: 'get', after: '\n    - ' },
                { token: 'head', after: '\n    - ' },
                { token: 'options', after: '\n    - ' },
                { token: 'patch', after: '\n    - ' },
                { token: 'post', after: '\n    - ' },
                { token: 'put', after: '\n    - ' },
                { token: 'other', after: '\n  ' },
            ],
        };
    case 'condition:resourceTypes:':
    case 'condition:excludedResourceTypes:':
        return {
            before: /^ {4}- $/,
            candidates: [
                { token: 'main_frame', after: '\n    - ' },
                { token: 'sub_frame', after: '\n    - ' },
                { token: 'stylesheet', after: '\n    - ' },
                { token: 'script', after: '\n    - ' },
                { token: 'image', after: '\n    - ' },
                { token: 'font', after: '\n    - ' },
                { token: 'object', after: '\n    - ' },
                { token: 'xmlhttprequest', after: '\n    - ' },
                { token: 'ping', after: '\n    - ' },
                { token: 'csp_report', after: '\n    - ' },
                { token: 'media', after: '\n    - ' },
                { token: 'websocket', after: '\n    - ' },
                { token: 'webtransport', after: '\n    - ' },
                { token: 'webbundle', after: '\n    - ' },
                { token: 'other', after: '\n  ' },
            ],
        };
    }
}

function autoComplete(context) {
    const match = context.matchBefore(/[\w-]*/);
    if ( match === undefined ) { return null; }
    const result = getAutocompleteCandidates(match.from);
    if ( result === undefined ) { return null; }
    if ( result.before !== undefined ) {
        const { doc } = context.state;
        const line = doc.lineAt(context.pos);
        const before = doc.sliceString(line.from, match.from);
        if ( result.before.test(before) === false ) { return null; }
    }
    const filtered = result.candidates.filter(e =>
        e.token !== match.text || e.after !== '\n'
    ); 
    return {
        from: match.from,
        options: filtered.map(e => ({ label: e.token, apply: `${e.token}${e.after}` })),
        validFor: /\w*/,
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
        updateView();
    }).then(( ) =>
        sendMessage({ what: 'updateUserDnrRules' })
    ).then(result => {
        if ( result instanceof Object === false ) { return; }
        updateFeedbackPanel(result);
    });
}

/******************************************************************************/

async function validateRegexes(regexes) {
    if ( regexes.length === 0 ) { return; }
    const promises = regexes.map(regex => validateRegex(regex));
    await Promise.all(promises);
    for ( const regex of regexes ) {
        const i = validatedRegexes.regexes.indexOf(regex);
        if ( i === -1 ) { continue; }
        const reason = validatedRegexes.results[i];
        if ( reason === true ) { continue; }
        const entries = self.cm6.findAll(cmRules,
            `(?<=\\bregexFilter: )${RegExp.escape(regex)}`
        );
        for ( const entry of entries ) {
            self.cm6.spanErrorAdd(cmRules, entry.from, entry.to, reason);
        }
    }
}

async function validateRegex(regex) {
    const details = await dnr.isRegexSupported({ regex });
    const result = details.isSupported || details.reason;
    if ( validatedRegexes.regexes.length > 32 ) {
        validatedRegexes.regexes.pop();
        validatedRegexes.results.pop();
    }
    validatedRegexes.regexes.unshift(regex);
    validatedRegexes.results.unshift(result);
}

const validatedRegexes = {
    regexes: [],
    results: [],
};

/******************************************************************************/

function updateView() {
    const { doc } = cmRules.state;
    const changed = doc.toString().trim() !== 
        lastSavedText.trim();
    dom.attr('#dnrRulesApply', 'disabled', changed ? null : '');
    dom.attr('#dnrRulesRevert', 'disabled', changed ? null : '');
    const { start, end } = modifiedRange;
    if ( start === -1 || end === -1 ) { return; }
    modifiedRange.start = modifiedRange.end = -1;
    self.cm6.lineErrorClear(cmRules, start, end);
    self.cm6.spanErrorClear(cmRules, start, end);
    const firstLine = doc.line(start);
    const lastLine = doc.line(end);
    const text = doc.sliceString(firstLine.from, lastLine.to);
    const { bad } = rulesFromText(text);
    if ( Array.isArray(bad) && bad.length !== 0 ) {
        self.cm6.lineErrorAdd(cmRules, bad.map(i => i + start));
    }
    const entries = self.cm6.findAll(
        cmRules,
        '\\bregexFilter: (\\S+)',
        firstLine.from,
        lastLine.to
    );
    const regexes = [];
    for ( const entry of entries ) {
        const regex = entry.match[1];
        const i = validatedRegexes.regexes.indexOf(regex);
        if ( i !== -1 ) {
            const reason = validatedRegexes.results[i];
            if ( reason === true ) { continue; }
            self.cm6.spanErrorAdd(cmRules, entry.from+13, entry.to, reason);
        } else { 
            regexes.push(regex);
        }
    }
    validateRegexes(regexes);
}

function updateViewAsync() {
    if ( updateViewAsync.timer !== undefined ) { return; }
    updateViewAsync.timer = self.setTimeout(( ) => {
        updateViewAsync.timer = undefined;
        updateView();
    }, 71);
}

/******************************************************************************/

function updateSummaryPanel(info) {
    self.cm6.showSummaryPanel(cmRules, {
        template: '.summary-panel',
        text: i18n$('dnrRulesCountInfo')
            .replace('{count}', (info.userDnrRuleCount || 0).toLocaleString()),
    });
}

browser.storage.onChanged.addListener((changes, area) => {
    if ( area !== 'local' ) { return; }
    const { userDnrRuleCount } = changes;
    if ( userDnrRuleCount instanceof Object === false ) { return; }
    const { newValue } = changes.userDnrRuleCount;
    updateSummaryPanel({ userDnrRuleCount: newValue });
});

localRead('userDnrRuleCount').then(userDnrRuleCount => {
    updateSummaryPanel({ userDnrRuleCount })
});

function updateFeedbackPanel(info) {
    const errors = [];
    if ( Array.isArray(info.errors) ) {
        info.errors.forEach(e => errors.push(e));
    }
    const text = errors.join('\n');
    self.cm6.showFeedbackPanel(cmRules, { template: '.feedback-panel', text });
}

/******************************************************************************/

function importRulesFromFile() {
    const input = qs$('input[type="file"]');
    input.onchange = ev => {
        input.onchange = null;
        const file = ev.target.files[0];
        if ( file === undefined || file.name === '' ) { return; }
        if ( file.type !== 'application/json' ) { return; }
        const fr = new FileReader();
        fr.onload = ( ) => {
            if ( typeof fr.result !== 'string' ) { return; }
            const rules = rulesFromJSON(fr.result);
            if ( rules === undefined ) { return; }
            const text = textFromRules(rules);
            if ( text === undefined ) { return; }
            const { doc } = cmRules.state;
            const lastChars = doc.toString().trimEnd().slice(-4);
            const lastLine = doc.line(doc.lines);
            let from = lastLine.to;
            let prepend = '';
            if ( lastLine.text !== '' ) {
                prepend = '\n';
            } else {
                from = lastLine.from;
            }
            if ( /(?:^|\n)---$/.test(lastChars) === false ) {
                prepend = `${prepend}---\n`;
            }
            cmRules.dispatch({ changes: { from, insert: `${prepend}${text}` } });
            cmRules.focus();
        };
        fr.readAsText(file);
    };
    // Reset to empty string, this will ensure a change event is properly
    // triggered if the user pick a file, even if it's the same as the last
    // one picked.
    input.value = '';
    input.click();
}

dom.on('#dnrRulesImport', 'click', importRulesFromFile);

/******************************************************************************/

function exportRulesToFile() {
    const text = getEditorText();
    const { rules } = rulesFromText(text);
    if ( Array.isArray(rules) === false ) { return; }
    let ruleId = 1;
    for ( const rule of rules ) {
        rule.id = ruleId++;
    }
    const filename = 'my-ubol-dnr-rules.json';
    const a = document.createElement('a');
    a.href = `data:application/json;charset=utf-8,${JSON.stringify(rules, null, 2)}`;
    dom.attr(a, 'download', filename || '');
    dom.attr(a, 'type', 'application/json');
    a.click();
}

dom.on('#dnrRulesExport', 'click', exportRulesToFile);

/******************************************************************************/

function importRulesFromPaste(transaction) {
    const { from, to } = rangeFromTransaction(transaction);
    if ( from === undefined || to === undefined ) { return; }
    // Paste position must match start of a line
    const { doc } = transaction.newDoc;
    const lineFrom = doc.lineAt(from);
    if ( lineFrom.from !== from ) { return; }
    // Paste position must match a rule boundary
    if ( lineFrom.number !== 1 ) {
        const lineBefore = doc.line(lineFrom.number-1);
        if ( /^---\s*$/.test(lineBefore.text) === false ) { return; }
    }
    const pastedText = doc.sliceString(from, to);
    const rules = rulesFromJSON(pastedText);
    if ( rules === undefined ) { return; }
    const yamlText = textFromRules(rules);
    if ( yamlText === undefined ) { return; }
    cmRules.dispatch({ changes: { from, to, insert: yamlText } });
    return true;
}

/******************************************************************************/

function smartBackspace(transaction) {
    const { from, to } = rangeFromTransaction(transaction);
    if ( from === undefined || to === undefined ) { return; }
    const { newDoc } = transaction;
    const line = newDoc.lineAt(from);
    if ( /^(?: {2})+-$/.test(line.text) === false ) { return; }
    cmRules.dispatch({ changes: { from: from-3, to: from, insert: '' } });
    return true;
}

/******************************************************************************/

function cmUpdateListener(info) {
    if ( info.docChanged === false ) { return; }
    for ( const transaction of info.transactions ) {
        if ( transaction.docChanged === false ) { continue; }
        addToModifiedRange(transaction);
        if ( transaction.isUserEvent('delete.backward') ) {
            if ( smartBackspace(transaction) ) { break; }
        } else if ( transaction.isUserEvent('input.paste') ) {
            if ( importRulesFromPaste(transaction) ) { break; }
        }
    }
    updateViewAsync();
}

/******************************************************************************/

function gutterClick(view, info) {
    const reSeparator = /^---\s*/;
    const { doc } = view.state;
    const lineFirst = doc.lineAt(info.from);
    if ( lineFirst.text === '' ) { return false; }
    let { from, to } = lineFirst;
    if ( reSeparator.test(lineFirst.text) ) {
        let lineNo = lineFirst.number + 1;
        while ( lineNo < doc.lines ) {
            const line = doc.line(lineNo);
            if ( reSeparator.test(line.text) ) { break; }
            to = line.to;
            lineNo += 1;
        }
    }
    view.dispatch({
        selection: { anchor: from, head: to+1 }
    });
    view.focus();
    return true;
}

/******************************************************************************/

function hoverTooltip(view, pos, side) {
    const details = view.domAtPos(pos);
    const textNode = details.node;
    if ( textNode.nodeType !== 3 ) { return null; }
    const { parentElement } = textNode;
    const targetElement = parentElement.closest('[data-tooltip]');
    if ( targetElement === null ) { return null; }
    const tooltipText = targetElement.getAttribute('data-tooltip');
    if ( Boolean(tooltipText) === false ) { return null; }
    const start = pos - details.offset;
    const end = start + textNode.nodeValue.length;
    if ( start === pos && side < 0 || end === pos && side > 0 ) { return null; }
    return {
        above: true,
        pos: start,
        end,
        create() {
            const template = document.querySelector('.badmark-tooltip');
            const fragment = template.content.cloneNode(true);
            const dom = fragment.querySelector('.badmark-tooltip');
            dom.textContent = tooltipText;
            return { dom };
        },
    };
}

/******************************************************************************/

const cmRules = (( ) => {
    return self.cm6.createEditorView({
        dnrRules: true,
        oneDark: dom.cl.has(':root', 'dark'),
        updateListener: cmUpdateListener,
        saveListener: ( ) => {
            saveEditorText();
        },
        lineError: true,
        spanError: true,
        // https://codemirror.net/examples/autocompletion/
        autocompletion: {
            override: [ autoComplete ],
            activateOnCompletion: ( ) => true,
        },
        gutterClick,
        hoverTooltip,
    }, qs$('#cm-dnrRules'));
})();

/******************************************************************************/

let lastSavedText = '';

localRead('userDnrRules').then(text => {
    text ||= '';
    setEditorText(text);
    lastSavedText = text;
    self.cm6.resetUndoRedo(cmRules);

    dom.on('#dnrRulesApply', 'click', ( ) => {
        saveEditorText();
    });

    dom.on('#dnrRulesRevert', 'click', ( ) => {
        setEditorText(lastSavedText);
        sendMessage({ what: 'updateUserDnrRules' });
    });
});

/******************************************************************************/

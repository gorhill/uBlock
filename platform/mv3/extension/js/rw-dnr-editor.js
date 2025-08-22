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
import { i18n, i18n$ } from './i18n.js';
import { DNREditor } from './dnr-editor.js';
import { parseFilters } from './ubo-parser.js';
import { textFromRules } from './dnr-parser.js';

/******************************************************************************/

export class ReadWriteDNREditor extends DNREditor {
    constructor(editor) {
        super();
        this.feedbackPanel = self.cm6.createViewPanel();
        editor.panels.push(this.feedbackPanel);
    }

    async getText() {
        return localRead('userDnrRules');
    }

    on(editor) {
        localRead('userDnrRuleCount').then(userDnrRuleCount => {
            this.updateSummaryPanel(editor, { userDnrRuleCount })
        });
        browser.storage.onChanged.addListener((changes, area) => {
            if ( area !== 'local' ) { return; }
            const { userDnrRuleCount } = changes;
            if ( userDnrRuleCount instanceof Object === false ) { return; }
            const { newValue } = changes.userDnrRuleCount;
            this.updateSummaryPanel(editor, { userDnrRuleCount: newValue });
        });
    }

    off(editor) {
        this.updateSummaryPanel(editor, null);
        this.updateFeedbackPanel(editor, null);
    }

    rulesFromJSON(json) {
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

    getAutocompleteCandidates(editor, from) {
        const { scope } = editor.getScopeAt(from);
        switch ( scope ) {
        case '':
            return {
                before: /^$/,
                candidates: [
                    { token: 'action:', after: '\n' },
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
        case 'action:requestHeaders:':
            return {
                before: /^ {4}- $/,
                candidates: [
                    { token: 'header:', after: ' ' },
                ],
            };
        case 'action:responseHeaders:header:':
        case 'action:requestHeaders:header:':
            return {
                before: /^ {6}$/,
                candidates: [
                    { token: 'operation:', after: ' ' },
                    { token: 'value:', after: ' ' },
                ],
            };
        case 'action:responseHeaders:header:operation:':
        case 'action:requestHeaders:header:operation:':
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

    autoComplete(editor, context) {
        const match = context.matchBefore(/[\w-]*/);
        if ( match === undefined ) { return null; }
        const result = this.getAutocompleteCandidates(editor, match.from);
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

    async saveEditorText(editor) {
        const text = editor.getEditorText().trim();
        await (text.length !== 0
            ? localWrite('userDnrRules', text)
            : localRemove('userDnrRules')
        );
        const response = await sendMessage({ what: 'updateUserDnrRules' })
        if ( response instanceof Object ) {
            this.updateFeedbackPanel(editor, response);
        }
        return true;
    }

    updateSummaryPanel(editor, details) {
        if ( details instanceof Object === false ) {
            return editor.updateSummaryPanel(null);
        }
        const template = document.querySelector('template.summary-panel');
        const fragment = template.content.cloneNode(true);
        const root = fragment.querySelector('.summary-panel');
        i18n.render(root);
        const info = root.querySelector('.info');
        info.textContent = i18n$('dnrRulesCountInfo')
            .replace('{count}', (details.userDnrRuleCount || 0).toLocaleString())
        editor.updateSummaryPanel(root);
    }

    updateFeedbackPanel(editor, details) {
        if ( details instanceof Object === false ) {
            return this.feedbackPanel.render(editor.view, null);
        }
        const errors = [];
        if ( Array.isArray(details.errors) ) {
            details.errors.forEach(e => errors.push(e));
        }
        const text = errors.join('\n');
        const config = (( ) => {
            if ( text === '' ) { return null; }
            const template = document.querySelector('template.feedback-panel');
            const fragment = template.content.cloneNode(true);
            const root = fragment.querySelector('.feedback-panel');
            const info = root.querySelector('.info');
            info.textContent = text;
            const closeFn = this.updateFeedbackPanel.bind(this, editor, null);
            return {
                dom: root,
                mount() {
                    dom.on(qs$('.feedback-panel .close'), 'click', closeFn);
                }
            };
        })();
        this.feedbackPanel.render(editor.view, config);
    }

    importFromFile(editor, json) {
        const rules = this.rulesFromJSON(json);
        if ( rules === undefined ) { return; }
        const text = textFromRules(rules);
        if ( text === undefined ) { return; }
        const { doc } = editor.view.state;
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
        editor.view.dispatch({ changes: { from, insert: `${prepend}${text}` } });
        self.cm6.foldAll(editor.view);
        editor.view.focus();
    }

    exportToFile(text) {
        return super.exportToFile(text, 'my-ubol-dnr-rules.json');
    }

    importFromPaste(editor, transaction) {
        const { from, to } = editor.rangeFromTransaction(transaction);
        if ( from === undefined || to === undefined ) { return; }
        // Paste position must match start of a line
        const { newDoc } = transaction;
        const lineFrom = newDoc.lineAt(from);
        if ( lineFrom.from !== from ) { return; }
        // Paste position must match a rule boundary
        let separatorBefore = false;
        if ( lineFrom.number !== 1 ) {
            const lineBefore = newDoc.line(lineFrom.number-1);
            if ( /^---\s*$/.test(lineBefore.text) === false ) { return; }
            separatorBefore = true;
        }
        const pastedText = newDoc.sliceString(from, to);
        let linesToPrepend;
        let rules = this.rulesFromJSON(pastedText);
        if ( Boolean(rules?.length) === false ) {
            rules = parseFilters(pastedText);
            if ( Boolean(rules?.length) === false ) { return; }
            const lines = pastedText.trim().split(/\n/);
            linesToPrepend = lines.slice(0, 10).map(a => `# ${a}`);
            if ( lines.length > linesToPrepend.length ) {
                linesToPrepend.push('# ...');
            }
        }
        let yamlText = textFromRules(rules);
        if ( yamlText === undefined ) { return; }
        if ( linesToPrepend ) {
            yamlText = yamlText.replace('---\n', `---\n${linesToPrepend.join('\n')}\n`);
        }
        if ( separatorBefore && yamlText.startsWith('---\n') ) {
            yamlText = yamlText.slice(4);
        }
        editor.view.dispatch({ changes: { from, to, insert: yamlText } });
        self.cm6.foldAll(editor.view);
        return true;
    }

    newlineAssistant = {
        'action:': '  type: ',
        'action:responseHeaders:header:': '      operation: ',
    };

    ioAccept = '.json,application/json';
};

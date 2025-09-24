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

import { dom, qs$, qsa$ } from './dom.js';
import { localRead, localWrite, sendMessage } from './ext.js';
import { faIconsInit } from './fa-icons.js';
import { i18n } from './i18n.js';

/******************************************************************************/

class Editor {
    constructor() {
        this.lastSavedText = '';
        this.view = null;
        this.reYamlDocSeparator = /^(?:---|...)\s*$/;
        this.modifiedRange = { start: 0, end: 0 };
        this.updateTimer = undefined;
        this.ioPanel = self.cm6.createViewPanel();
        this.summaryPanel = self.cm6.createViewPanel();
        this.panels = [];
        this.editors = {};
    }

    async init() {
        await Promise.all([
            import('./mode-editor.js').then(module => {
                this.editors['modes'] = new module.ModeEditor(this);
            }),
            import('./ro-dnr-editor.js').then(module => {
                this.editors['dnr.ro'] = new module.ReadOnlyDNREditor(this);
            }),
            import('./rw-dnr-editor.js').then(module => {
                this.editors['dnr.rw'] = new module.ReadWriteDNREditor(this);
            }),
        ]);
        const rulesetDetails = await sendMessage({ what: 'getRulesetDetails' });
        const parent = qs$('#editors optgroup');
        for ( const details of rulesetDetails ) {
            const option = document.createElement('option');
            option.value = `dnr.ro.${details.id}`;
            option.textContent = details.name;
            parent.append(option);
        }
        this.validModes = Array.from(qsa$('#editors option')).map(a => a.value);
        const mode = await localRead('dashboard.develop.editor');
        this.editorFromMode(mode);
        const text = this.normalizeEditorText(await this.editor.getText(this.mode));
        const viewConfig = {
            text,
            yamlLike: true,
            oneDark: dom.cl.has(':root', 'dark'),
            updateListener: info => { this.viewUpdateListener(info); },
            saveListener: ( ) => { this.saveEditorText(); },
            lineError: true,
            spanError: true,
            // https://codemirror.net/examples/autocompletion/
            autocompletion: {
                override: [
                    context => {
                        return this.autoComplete(context);
                    },
                ],
                activateOnCompletion: ( ) => true,
            },
            gutterClick: (view, info) => {
                return this.gutterClick(view, info);
            },
            hoverTooltip: (view, pos, side) => {
                return this.hoverTooltip(view, pos, side);
            },
            streamParser: this.streamParser,
            foldService: (state, from) => {
                return this.foldService(state, from);
            },
            readOnly: this.isReadOnly(),
        };
        viewConfig.panels = [ this.ioPanel, this.summaryPanel, ...this.panels ];
        this.view = self.cm6.createEditorView(viewConfig, qs$('#cm-container'));
        this.lastSavedText = text;
        self.cm6.foldAll(this.view);
        self.cm6.resetUndoRedo(this.view);
        this.updateIOPanel();
        this.editor.on?.(this);
        this.modifiedRange.start = 1;
        this.modifiedRange.end = this.view.state.doc.lines;
        this.updateViewAsync();
    }

    normalizeEditorText(text) {
        text ||= '';
        text = text.trim();
        if ( text !== '' ) { text += '\n'; }
        return text;
    }

    setEditorText(text, saved = false) {
        text = this.normalizeEditorText(text);
        if ( saved ) {
            this.lastSavedText = text;
        }
        this.view.dispatch({
            changes: {
                from: 0, to: this.view.state.doc.length,
                insert: text,
            },
        });
        this.view.focus();
    }

    getEditorText() {
        return this.view.state.doc.toString();
    }

    editorTextChanged() {
        const text = this.normalizeEditorText(this.getEditorText());
        return text !== this.lastSavedText;
    }

    async selectEditor(mode) {
        if ( mode === this.mode ) { return; }
        this.editorFromMode(mode);
        const text = await this.editor.getText(this.mode);
        this.setEditorText(text);
        this.lastSavedText = this.getEditorText();
        self.cm6.foldAll(this.view)
        self.cm6.resetUndoRedo(this.view);
        self.cm6.toggleReadOnly(this.view, this.isReadOnly());
        this.updateIOPanel();
        this.editor.on?.(this);
        this.modifiedRange.start = 1;
        this.modifiedRange.end = this.view.state.doc.lines;
        this.updateViewAsync();
    }

    editorFromMode(mode) {
        if ( this.validModes.includes(mode) === false ) {
            mode = 'modes';
        }
        if ( mode === this.mode ) { return mode; }
        let editor;
        if ( mode === 'modes' ) {
            editor = this.editors['modes'];
        } else if ( mode.startsWith('dnr.rw.') ) {
            editor = this.editors['dnr.rw'];
        } else if ( mode.startsWith('dnr.ro.') ) {
            editor = this.editors['dnr.ro'];
        } else {
            return;
        }
        this.editor?.off?.(this);
        this.editor = editor;
        this.mode = mode;
        const select = qs$('#editors');
        select.value = mode;
    }

    isReadOnly() {
        return typeof this.editor.saveEditorText !== 'function';
    }

    viewUpdateListener(info) {
        if ( info.docChanged === false ) { return; }
        for ( const transaction of info.transactions ) {
            if ( transaction.docChanged === false ) { continue; }
            this.addToModifiedRange(transaction);
            if ( transaction.isUserEvent('delete.backward') ) {
                this.smartBackspace(transaction);
            } else if ( transaction.isUserEvent('input.paste') ) {
                if ( this.editor.importFromPaste ) {
                    this.editor.importFromPaste(this, transaction);
                }
            } else if ( transaction.isUserEvent('input') ) {
                if ( this.smartReturn(transaction) ) { continue; }
                this.smartSpacebar(transaction);
            }
        }
        this.updateViewAsync();
    }

    updateViewAsync() {
        if ( this.updateTimer !== undefined ) { return; }
        this.updateTimer = self.setTimeout(( ) => {
            this.updateTimer = undefined;
            this.updateView();
        }, 71);
    }

    updateView() {
        const { doc } = this.view.state;
        const changed = this.editorTextChanged();
        dom.attr('#apply', 'disabled', changed ? null : '');
        dom.attr('#revert', 'disabled', changed ? null : '');
        if ( typeof this.editor.updateView !== 'function' ) { return; }
        let { start, end } = this.modifiedRange;
        if ( start === 0 || end === 0 ) { return; }
        this.modifiedRange.start = this.modifiedRange.end = 0;
        if ( start > doc.lines ) { start = doc.lines; }
        if ( end > doc.lines ) { end = doc.lines; }
        self.cm6.lineErrorClear(this.view, start, end);
        self.cm6.spanErrorClear(this.view, start, end);
        const firstLine = doc.line(start);
        const lastLine = doc.line(end);
        this.editor.updateView(this, firstLine, lastLine);
    }

    updateIOPanel() {
        const ioButtons = [];
        if ( this.editor.saveEditorText ) {
            ioButtons.push('apply', 'revert');
        }
        if ( this.editor.importFromFile ) {
            ioButtons.push('import');
        }
        if ( this.editor.exportToFile ) {
            ioButtons.push('export');
        }
        if ( ioButtons.length === 0 ) {
            return this.ioPanel.render(this.view, null);
        }
        const template = document.querySelector('template.io-panel');
        const fragment = template.content.cloneNode(true);
        const root = fragment.querySelector('.io-panel');
        i18n.render(root);
        faIconsInit(root);
        root.dataset.io = ioButtons.join(' ');
        const config = {
            dom: root,
            mount: ( ) => {
                dom.on('#apply', 'click', ( ) => {
                    this.saveEditorText();
                });
                dom.on('#revert', 'click', ( ) => {
                    this.revertEditorText();
                });
                dom.on('#import', 'click', ( ) => {
                    this.importFromFile()
                });
                dom.on('#export', 'click', ( ) => {
                    this.exportToFile();
                });
            }
        };
        this.ioPanel.render(this.view, config);
    }

    updateSummaryPanel(dom) {
        if ( dom instanceof Object ) {
            if ( this.updateSummaryPanel.timer !== undefined ) {
                self.clearTimeout(this.updateSummaryPanel.timer);
                this.updateSummaryPanel.timer = undefined;
            }
            return this.summaryPanel.render(this.view, { dom });
        }
        if ( this.updateSummaryPanel.timer !== undefined ) { return; }
        this.updateSummaryPanel.timer = self.setTimeout(( ) => {
            this.updateSummaryPanel.timer = undefined;
            this.summaryPanel.render(this.view, null);
        }, 157);
    }

    autoComplete(context) {
        if ( typeof this.editor.autoComplete !== 'function' ) { return null; }
        return this.editor.autoComplete(this, context);
    }

    hoverTooltip(view, pos, side) {
        if ( typeof this.editor.createTooltipWidget !== 'function' ) { return null; }
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
            create: ( ) => {
                return { dom: this.editor.createTooltipWidget(tooltipText) };
            },
        };
    }

    foldService(state, from) {
        if ( typeof this.editor.foldService !== 'function' ) { return null; }
        return this.editor.foldService(state, from);
    }

    // Details of YAML document(s) intersecting with a text span. If the text span
    // starts on a YAML document divider, the previous YAML document will be
    // included. If the text span ends on a YAML document divider, the next YAML
    // document will be included.

    snapToYamlDocument(doc, start, end) {
        let yamlDocStart = doc.lineAt(start).number;
        if ( this.reYamlDocSeparator.test(doc.line(yamlDocStart).text) ) {
            if ( yamlDocStart > 1 ) {
                yamlDocStart -= 1;
            }
        }
        while ( yamlDocStart > 1 ) {
            const line = doc.line(yamlDocStart);
            if ( this.reYamlDocSeparator.test(line.text) ) { break; }
            yamlDocStart -= 1;
        }
        const lastLine = doc.lines;
        let yamlDocEnd = doc.lineAt(end).number;
        if ( this.reYamlDocSeparator.test(doc.line(yamlDocEnd).text) ) {
            if ( yamlDocEnd < lastLine ) {
                yamlDocEnd += 1;
            }
        }
        while ( yamlDocEnd < lastLine ) {
            const line = doc.line(yamlDocEnd);
            if ( this.reYamlDocSeparator.test(line.text) ) { break; }
            yamlDocEnd += 1;
        }
        return { yamlDocStart, yamlDocEnd };
    }

    rangeFromTransaction(transaction) {
        let from, to;
        transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
            if ( from === undefined || fromB < from ) { from = fromB; }
            if ( to === undefined || toB > to ) { to = toB; }
        });
        return { from, to };
    }

    addToModifiedRange(transaction) {
        const { from, to } = this.rangeFromTransaction(transaction);
        if ( from === undefined || to === undefined ) { return; }
        const { newDoc } = transaction;
        const { yamlDocStart, yamlDocEnd } = this.snapToYamlDocument(newDoc, from, to);
        if ( this.modifiedRange.start === 0 || yamlDocStart < this.modifiedRange.start ) {
            this.modifiedRange.start = yamlDocStart;
        }
        if ( this.modifiedRange.end === 0 || yamlDocEnd > this.modifiedRange.end ) {
            this.modifiedRange.end = yamlDocEnd;
        }
    }

    lineIndentAt(line) {
        const match = /^(?: {2})*/.exec(line.text);
        const indent = match !== null ? match[0].length : -1;
        if ( indent === -1 || (indent & 1) !== 0 ) { return -1; }
        return indent / 2;
    }

    getScopeAt(from, doc) {
        doc ||= this.view.state.doc;
        const lineFrom = doc.lineAt(from);
        const out = {};
        let depth = this.lineIndentAt(lineFrom);
        if ( depth === -1 ) { return out; }
        const text = lineFrom.text.trim();
        if ( text.startsWith('#') ) { return out; }
        const path = [];
        const end = text.indexOf(':');
        if ( end !== -1 ) {
            const beg = text.startsWith('- ') ? 2 : 0;
            path.push(text.slice(beg, end+1));
        }
        let lineNo = lineFrom.number;
        while ( depth > 0 && lineNo > 1 ) {
            lineNo -= 1;
            const lineBefore = doc.line(lineNo);
            const text = lineBefore.text.trim();
            if ( text.startsWith('#') ) { continue; }
            if ( this.lineIndentAt(lineBefore) > (depth-1) ) { continue; }
            const match = /^- ([^:]+:)/.exec(text);
            if ( match !== null ) {
                path.unshift(match[1]);
            } else {
                path.unshift(text);
            }
            depth -= 1;
        }
        out.scope = path.join('');
        out.depth = path.length;
        return out;
    }

    async saveEditorText() {
        if ( typeof this.editor.saveEditorText !== 'function' ) { return; }
        if ( this.editorTextChanged() === false ) { return; }
        const saved = await this.editor.saveEditorText(this);
        if ( saved !== true ) { return; }
        this.lastSavedText = this.normalizeEditorText(this.getEditorText());
        this.updateView();
    }

    revertEditorText() {
        if ( this.editorTextChanged() === false ) { return; }
        this.setEditorText(this.lastSavedText);
    }

    smartBackspace(transaction) {
        const { from, to } = this.rangeFromTransaction(transaction);
        if ( from === undefined || to === undefined ) { return; }
        if ( to !== from ) { return; }
        const { newDoc } = transaction;
        const line = newDoc.lineAt(from);
        if ( /^(?: {2})+-$/.test(line.text) === false ) { return; }
        this.view.dispatch({ changes: { from: from-3, to: from, insert: '' } });
        return true;
    }

    lineIsArrayItem(doc, lineNo) {
        if ( lineNo < 1 || lineNo > doc.lines ) { return false; }
        const line = doc.line(lineNo);
        return /^(?: {2})+- /.test(line.text);
    }

    smartArrayItem(doc, from) {
        const line = doc.lineAt(from);
        if ( line.from === 0 ) { return; }
        const blanks = /^ *$/.exec(line.text);
        if ( blanks === null ) { return; }
        if ( this.editor.newlineAssistant ) {
            const { scope } = this.getScopeAt(line.from-1, doc);
            const insert = this.editor.newlineAssistant[scope];
            if ( insert ) {
                this.view.dispatch({
                    changes: { from: line.from, to: line.to, insert },
                    selection: { anchor: line.from + insert.length },
                });
                return true;
            }
        }
        let targetIndent;
        if ( this.lineIsArrayItem(doc, line.number-1) ) {
            targetIndent = doc.line(line.number-1).text.indexOf('- ');
        } else if ( this.lineIsArrayItem(doc, line.number+1) ) {
            targetIndent = doc.line(line.number+1).text.indexOf('- ');
        }
        if ( targetIndent === undefined ) { return; }
        const indent = targetIndent - blanks[0].length;
        if ( indent < 0 || indent > 2 ) { return; }
        const insert = `${' '.repeat(indent)}- `;
        this.view.dispatch({
            changes: { from, insert },
            selection: { anchor: from + insert.length },
        });
        return true;
    }

    smartReturn(transaction) {
        const { from, to } = this.rangeFromTransaction(transaction);
        if ( from === undefined || to === undefined ) { return; }
        const { newDoc } = transaction;
        return this.smartArrayItem(newDoc, to);
    }

    smartSpacebar(transaction) {
        const { from, to } = this.rangeFromTransaction(transaction);
        if ( from === undefined || to === undefined ) { return; }
        if ( (to - from) !== 1 ) { return; }
        const { newDoc } = transaction;
        const line = newDoc.lineAt(to);
        const localTo = to - line.from;
        const before = line.text.slice(0, localTo);
        if ( /^(?: {1}| {3})$/.test(before) === false ) { return; }
        if ( this.smartArrayItem(newDoc, to) ) { return true; }
        this.view.dispatch({
            changes: { from: to, insert: ' ' },
            selection: { anchor: to + 1 },
        });
        return true;
    }

    gutterClick(view, info) {
        const reSeparator = /^(?:---|# ---)\s*/;
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
            selection: { anchor: from, head: Math.min(to+1, doc.length) }
        });
        view.focus();
        return true;
    }

    importFromFile() {
        const editor = this.editor;
        if ( typeof editor.importFromFile !== 'function' ) { return; }
        const input = qs$('section[data-pane="develop"] input[type="file"]');
        input.accept = editor.ioAccept || '';
        input.onchange = ev => {
            input.onchange = null;
            const file = ev.target.files[0];
            if ( file === undefined || file.name === '' ) { return; }
            const fr = new FileReader();
            fr.onload = ( ) => {
                if ( typeof fr.result !== 'string' ) { return; }
                editor.importFromFile(this, fr.result);
            };
            fr.readAsText(file);
        };
        // Reset to empty string, this will ensure a change event is properly
        // triggered if the user pick a file, even if it's the same as the last
        // one picked.
        input.value = '';
        input.click();
    }

    exportToFile() {
        const editor = this.editor;
        if ( typeof editor.exportToFile !== 'function' ) { return; }
        const text = this.getEditorText();
        const result = editor.exportToFile(text);
        if ( result === undefined ) { return; }
        const { fname, data, mime } = result;
        const a = document.createElement('a');
        a.href = `data:${mime};charset=utf-8,${encodeURIComponent(data)}`;
        dom.attr(a, 'download', fname || '');
        dom.attr(a, 'type', mime);
        a.click();
    }

    streamParser = {
        startState: ( ) => {
            return { scope: 0 };
        },
        token: (stream, state) => {
            if ( stream.sol() ) {
                if ( stream.match(/^---\s*$/) ) { return 'ubol-boundary'; }
                if ( stream.match(/^# ---\s*$/) ) { return 'ubol-boundary ubol-comment'; }
                if ( stream.match(/\.\.\.\s*$/) ) { return 'ubol-boundary'; }
            }
            const c = stream.peek();
            if ( c === '#' ) {
                if ( (stream.pos === 0 || /\s/.test(stream.string.charAt(stream.pos - 1))) ) {
                    stream.skipToEnd();
                    return 'ubol-comment';
                }
            }
            if ( stream.eatSpace() ) { return null; }
            const { scope } = state;
            state.scope = 0;
            if ( scope === 0 && stream.match(/^[^:]+(?=:)/) ) {
                state.scope = 1;
                return 'ubol-keyword';
            }
            if ( scope === 1 && stream.match(/^:(?: |$)/) ) {
                return 'ubol-punctuation';
            }
            if ( stream.match(/^- /) ) {
                return 'ubol-punctuation';
            }
            if ( this.editor.streamParserKeywords ) {
                if ( stream.match(this.editor.streamParserKeywords) ) {
                    return 'ubol-literal';
                }
            }
            if ( stream.match(/^\S+/) ) {
                return null;
            }
            stream.next();
            return null;
        },
        languageData: {
            commentTokens: { line: '#' },
        },
        tokenTable: [
            'ubol-boundary',
            'ubol-keyword',
            'ubol-comment',
            'ubol-punctuation',
            'ubol-literal',
        ],
    };
}

/******************************************************************************/

async function start() {
    const editor = new Editor();
    await editor.init();
    dom.on('#editors', 'change', ( ) => {
        const select = qs$('#editors');
        const mode = select.value;
        if ( mode === editor.mode ) { return; }
        editor.selectEditor(mode);
        localWrite('dashboard.develop.editor', editor.mode);
    });
}

dom.onFirstShown(start, qs$('section[data-pane="develop"]'));

/******************************************************************************/

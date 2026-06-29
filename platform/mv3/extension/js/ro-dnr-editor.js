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

import { DNREditor } from './dnr-editor.js';
import { deserialize } from '../lib/s14e-serializer.js';
import { i18n$ } from './i18n.js';
import { normalizeDNRRules } from './ext-compat.js';
import { sendMessage } from './ext.js';
import { textFromRules } from './dnr-parser.js';

/******************************************************************************/

export class ReadOnlyDNREditor extends DNREditor {
    async getText(hint) {
        if ( hint === 'dnr.ro.dynamic' ) {
            const rules = await sendMessage({ what: 'getAllDynamicRules' });
            if ( Array.isArray(rules) === false ) { return; }
            rules.sort((a, b) => a.id - b.id);
            this.id = 'dynamic';
            this.count = rules.length;
            return textFromRules(rules, { keepId: true });
        }
        if ( hint === 'dnr.ro.session' ) {
            const rules = await sendMessage({ what: 'getAllSessionRules' });
            if ( Array.isArray(rules) === false ) { return; }
            rules.sort((a, b) => a.id - b.id);
            this.id = 'session';
            this.count = rules.length;
            return textFromRules(rules, { keepId: true });
        }
        const match = /^dnr\.ro\.(.+)$/.exec(hint);
        if ( match === null ) { return; }
        this.id = match[1];
        const result = await sendMessage({ what: 'getRulesetRules', id: this.id }) || {};
        const allRules = result.serialized
            ? deserialize(result.serialized).dnrRules ?? {}
            : result.rules ?? {};
        this.count = allRules.length ?? 0;
        return textFromRules(normalizeDNRRules(allRules), { keepId: true });
    }

    on(editor) {
        if ( typeof this.count !== 'number' ) {
            return editor.updateSummaryPanel(null);
        }
        const template = document.querySelector('template.ro-summary-panel');
        const fragment = template.content.cloneNode(true);
        const root = fragment.querySelector('.summary-panel');
        root.textContent = i18n$('dnrRulesCountInfo')
            .replace('{count}', (this.count || 0).toLocaleString())
        editor.updateSummaryPanel(root);
    }

    off(editor) {
        editor.updateSummaryPanel(null);
    }

    exportToFile(text) {
        return super.exportToFile(text, `${this.id}-dnr-ruleset.json`);
    }
};

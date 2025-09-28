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

import { runtime, sendMessage } from './ext.js';
import { DNREditor } from './dnr-editor.js';
import { i18n$ } from './i18n.js';
import { normalizeDNRRules } from './ext-compat.js';
import { textFromRules } from './dnr-parser.js';

/******************************************************************************/

export class ReadOnlyDNREditor extends DNREditor {
    async getText(hint) {
        if ( hint === 'dnr.ro.dynamic' ) {
            const rules = await sendMessage({ what: 'getEffectiveDynamicRules' });
            if ( Array.isArray(rules) === false ) { return; }
            this.id = 'dynamic';
            this.count = rules.length;
            return textFromRules(rules, { keepId: true });
        }
        if ( hint === 'dnr.ro.session' ) {
            const rules = await sendMessage({ what: 'getEffectiveSessionRules' });
            if ( Array.isArray(rules) === false ) { return; }
            this.id = 'session';
            this.count = rules.length;
            return textFromRules(rules, { keepId: true });
        }
        const match = /^dnr\.ro\.(.+)$/.exec(hint);
        if ( match === null ) { return; }
        this.id = match[1];
        const allRulesetDetails = await sendMessage({ what: 'getRulesetDetails' });
        const rulesetDetails = allRulesetDetails.find(a => a.id === this.id);
        if ( rulesetDetails === undefined ) { return; }
        const manifestRulesets = runtime.getManifest().declarative_net_request.rule_resources;
        const mainPathMap = new Map(
            manifestRulesets.map(({ id, path }) => [ id, path ])
        );
        const realms = {
            plain: 'main',
            regex: 'regex',
        };
        const promises = [];
        for ( const [ realm, dir ] of Object.entries(realms) ) {
            if ( Boolean(rulesetDetails.rules?.[realm]) === false ) { continue; }
            const url = dir === 'main'
                ? mainPathMap.get(this.id)
                : `./rulesets/${dir}/${this.id}.json`;
            promises.push(
                fetch(url).then(response =>
                    response.json()
                ).then(rules =>
                    normalizeDNRRules(rules)
                )
            );
        }
        const parts = await Promise.all(promises);
        const allRules = [];
        for ( const rules of parts ) {
            for ( const rule of rules ) {
                allRules.push(rule);
            }
        }
        this.count = allRules.length;
        return textFromRules(allRules, { keepId: true });
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

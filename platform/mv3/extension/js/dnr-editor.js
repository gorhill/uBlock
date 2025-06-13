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

import { dnr } from './ext-compat.js';
import { rulesFromText } from './dnr-parser.js';

/******************************************************************************/

export class DNREditor {
    constructor() {
        this.validatedRegexes = [];
        this.validatedRegexResults = [];
    }

    updateView(editor, firstLine, lastLine) {
        const { doc } = editor.view.state;
        const text = doc.sliceString(firstLine.from, lastLine.to);
        const { bad } = rulesFromText(text);
        if ( Array.isArray(bad) && bad.length !== 0 ) {
            self.cm6.lineErrorAdd(editor.view, bad.map(i => i + firstLine.number));
        }
        const entries = self.cm6.findAll(
            editor.view,
            '\\bregexFilter: (\\S+)',
            firstLine.from,
            lastLine.to
        );
        const regexes = [];
        for ( const entry of entries ) {
            const regex = entry.match[1];
            const i = this.validatedRegexes.indexOf(regex);
            if ( i !== -1 ) {
                const reason = this.validatedRegexResults[i];
                if ( reason === true ) { continue; }
                self.cm6.spanErrorAdd(editor.view, entry.from+13, entry.to, reason);
            } else { 
                regexes.push(regex);
            }
        }
        this.validateRegexes(editor, regexes);
    }

    exportToFile(text, fname) {
        const { rules } = rulesFromText(text);
        if ( Array.isArray(rules) === false ) { return; }
        let ruleId = 1;
        for ( const rule of rules ) {
            rule.id = ruleId++;
        }
        return {
            fname,
            data: JSON.stringify(rules, null, 2),
            mime: 'application/json',
        };
    }

    async validateRegexes(editor, regexes) {
        if ( regexes.length === 0 ) { return; }
        const promises = regexes.map(regex => this.validateRegex(regex));
        await Promise.all(promises);
        for ( const regex of regexes ) {
            const i = this.validatedRegexes.indexOf(regex);
            if ( i === -1 ) { continue; }
            const reason = this.validatedRegexResults[i];
            if ( reason === true ) { continue; }
            const entries = self.cm6.findAll(editor.view,
                `(?<=\\bregexFilter: )${RegExp.escape(regex)}`
            );
            for ( const entry of entries ) {
                self.cm6.spanErrorAdd(editor.view, entry.from, entry.to, reason);
            }
        }
    }

    async validateRegex(regex) {
        const details = await dnr.isRegexSupported({ regex });
        const result = details.isSupported || details.reason;
        if ( this.validatedRegexes.length > 32 ) {
            this.validatedRegexes.pop();
            this.validatedRegexResults.pop();
        }
        this.validatedRegexes.unshift(regex);
        this.validatedRegexResults.unshift(result);
    }

    createTooltipWidget(text) {
        const template = document.querySelector('.badmark-tooltip');
        const fragment = template.content.cloneNode(true);
        const dom = fragment.querySelector('.badmark-tooltip');
        dom.textContent = text;
        return dom;
    }

    foldService(state, from) {
        const { doc } = state;
        const lineFrom = doc.lineAt(from);
        if ( this.reFoldable.test(lineFrom.text) === false ) { return null; }
        if ( lineFrom.number <= 5 ) { return null ; }
        const lineBlockStart = doc.line(lineFrom.number - 5);
        if ( this.reFoldCandidates.test(lineBlockStart.text) === false ) { return null; }
        for ( let i = lineFrom.number-4; i < lineFrom.number; i++ ) {
            const line = doc.line(i);
            if ( this.reFoldable.test(line.text) === false ) { return null; }
        }
        let i = lineFrom.number + 1;
        for ( ; i <= doc.lines; i++ ) {
            const lineNext = doc.line(i);
            if ( this.reFoldable.test(lineNext.text) === false ) { break; }
        }
        i -= 1;
        if ( i === lineFrom.number ) { return null; }
        const lineFoldEnd = doc.line(i);
        return { from: lineFrom.from+6, to: lineFoldEnd.to };
    }
    reFoldable = /^ {4}- \S/;
    reFoldCandidates = new RegExp(`^(?: {2})+${[
        'initiatorDomains',
        'excludedInitiatorDomains',
        'requestDomains',
        'excludedRequestDomains',
    ].join('|')}:$`);

    streamParserKeywords = new RegExp(`\\b(${[
        'block',
        'redirect',
        'allow',
        'modifyHeaders',
        'upgradeScheme',
        'allowAllRequest',
        'append',
        'set',
        'remove',
        'firstParty',
        'thirdParty',
        'true',
        'false',
        'connect',
        'delete',
        'get',
        'head',
        'options',
        'patch',
        'post',
        'put',
        'other',
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
    ].join('|')})\\b`);
};

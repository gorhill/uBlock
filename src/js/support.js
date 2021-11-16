/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
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

/* global CodeMirror, uBlockDashboard, uDom */

'use strict';

/******************************************************************************/

let supportData;

const uselessKeys = [
    'modifiedHiddenSettings.benchmarkDatasetURL',
    'modifiedUserSettings.popupPanelSections',
    'modifiedUserSettings.externalLists',
    'modifiedUserSettings.importedLists',
];

const sensitiveValues = [
    'filterset (user)',
    'modifiedUserSettings.popupPanelSections',
    'modifiedHiddenSettings.userResourcesLocation',
    'trustedset.added',
    'hostRuleset.added',
    'switchRuleset.added',
    'urlRuleset.added',
];

const sensitiveKeys = [
    'listset.added',
];

/******************************************************************************/

function removeKey(data, prop) {
    if ( data instanceof Object === false ) { return; }
    const pos = prop.indexOf('.');
    if ( pos !== -1 ) {
        const key = prop.slice(0, pos);
        return removeKey(data[key], prop.slice(pos + 1));
    }
    delete data[prop];
}

function redactValue(data, prop) {
    if ( data instanceof Object === false ) { return; }
    const pos = prop.indexOf('.');
    if ( pos !== -1 ) {
        return redactValue(data[prop.slice(0, pos)], prop.slice(pos + 1));
    }
    let value = data[prop];
    if ( value === undefined ) { return; }
    if ( Array.isArray(value) ) {
        if ( value.length !== 0 ) {
            value = `[array of ${value.length} redacted]`;
        } else {
            value = '[empty]';
        }
    } else {
        value = '[redacted]';
    }
    data[prop] = value;
}

function redactKeys(data, prop) {
    if ( data instanceof Object === false ) { return; }
    const pos = prop.indexOf('.');
    if ( pos !== -1 ) {
        return redactKeys(data[prop.slice(0, pos)], prop.slice(pos + 1));
    }
    const obj = data[prop];
    if ( obj instanceof Object === false ) { return; }
    let count = 1;
    for ( const key in obj ) {
        if ( key.startsWith('file://') === false ) { continue; }
        const newkey = `[list name ${count} redacted]`;
        obj[newkey] = obj[key];
        obj[key] = undefined; 
        count += 1;
    }
}

function patchEmptiness(data, prop) {
    const entry = data[prop];
    if ( Array.isArray(entry) && entry.length === 0 ) {
        data[prop] = '[empty]';
        return;
    }
    if ( entry instanceof Object === false ) { return; }
    if ( Object.keys(entry).length === 0 ) {
        data[prop] = '[none]';
        return;
    }
    for ( const key in entry ) {
        patchEmptiness(entry, key);
    }
}

function configToMarkdown(collapse = false) {
    const text = cmEditor.getValue();
    return collapse
        ? '<details>\n\n```yaml\n' + text + '\n```\n</details>'
        : '```yaml\n' + text + '\n```\n';
}

function addDetailsToReportURL(id, collapse = false) {
    const elem = uDom.nodeFromId(id);
    const url = new URL(elem.getAttribute('data-url'));
    url.searchParams.set('configuration', configToMarkdown(collapse));
    elem.setAttribute('data-url', url);
}

function showData() {
    const shownData = JSON.parse(JSON.stringify(supportData));
    uselessKeys.forEach(prop => { removeKey(shownData, prop); });
    const redacted = document.body.classList.contains('redacted');
    // If the report is for a specific site, report per-site switches which
    // are triggered on the reported site.
    if (
        reportURL !== null &&
        shownData.switchRuleset instanceof Object &&
        Array.isArray(shownData.switchRuleset.added)
    ) {
        const hostname = reportURL.hostname;
        const added = [];
        const triggered = [];
        for ( const rule of shownData.switchRuleset.added ) {
            const match = /^[^:]+:\s+(\S+)/.exec(rule);
            if (
                match[1] === '*' ||
                hostname === match[1] ||
                hostname.endsWith(`.${match[1]}`)
            ) {
                triggered.push(rule);
            } else {
                added.push(rule);
            }
        }
        if ( triggered.length !== 0 ) {
            shownData.switchRuleset.triggered = triggered;
            shownData.switchRuleset.added = added;
        }
    }
    if ( redacted ) {
        sensitiveValues.forEach(prop => { redactValue(shownData, prop); });
        sensitiveKeys.forEach(prop => { redactKeys(shownData, prop); });
    }
    for ( const prop in shownData ) {
        patchEmptiness(shownData, prop);
    }
    const text = JSON.stringify(shownData, null, 2)
        .split('\n')
        .slice(1, -1)
        .map(v => {
            return v
                .replace( /^( *?)  "/, '$1')
                .replace( /^( *.*[^\\])(?:": "|": \{$|": \[$|": )/, '$1: ')
                .replace( /(?:",?|\},?|\],?|,)$/, '');
        })
        .filter(v => v.trim() !== '')
        .join('\n') + '\n';

    cmEditor.setValue(text);
    cmEditor.clearHistory();

    addDetailsToReportURL('filterReport', redacted === false);
    addDetailsToReportURL('bugReport', redacted === false);
}

/******************************************************************************/

const reportURL = (( ) => {
    const url = new URL(window.location.href);
    try {
        const reportURL = url.searchParams.get('reportURL');
        if ( reportURL !== null ) {
            document.body.classList.add('filterIssue');
        }
        document.querySelector('[data-i18n="supportS6URL"] ~ input').value = reportURL;
        return new URL(reportURL);
    } catch(ex) {
    }
    return null;
})();

function reportSpecificFilterHostname() {
    return reportURL.hostname.replace(/^www\./, '');
}

function reportSpecificFilterType() {
    return document.querySelector('[data-i18n="supportS6Select1"] ~ select').value;
}

function reportSpecificFilterIssue(ev) {
    const githubURL = new URL('https://github.com/uBlockOrigin/uAssets/issues/new?template=specific_report_from_ubo.yml');
    const issueType = reportSpecificFilterType();
    let title = `${reportSpecificFilterHostname()}: ${issueType}`;
    if ( document.getElementById('isNSFW').checked ) {
        title = `[nsfw] ${title}`;
    }
    githubURL.searchParams.set('title', title);
    githubURL.searchParams.set('url_address_of_the_web_page', '`' + reportURL.href + '`');
    githubURL.searchParams.set('category', issueType);
    githubURL.searchParams.set('configuration', configToMarkdown(false));
    vAPI.messaging.send('default', {
        what: 'gotoURL',
        details: { url: githubURL.href, select: true, index: -1 },
    });
    ev.preventDefault();
}

/******************************************************************************/

const cmEditor = new CodeMirror(document.getElementById('supportData'), {
    autofocus: true,
    readOnly: true,
    styleActiveLine: true,
});

uBlockDashboard.patchCodeMirrorEditor(cmEditor);

/******************************************************************************/

(async ( ) => {
    supportData = await vAPI.messaging.send('dashboard', {
        what: 'getSupportData',
    });

    showData();

    uDom('[data-url]').on('click', ev => {
        const elem = ev.target.closest('[data-url]');
        const url = elem.getAttribute('data-url');
        if ( typeof url !== 'string' || url === '' ) { return; }
        vAPI.messaging.send('default', {
            what: 'gotoURL',
            details: { url, select: true, index: -1 },
        });
        ev.preventDefault();
    });

    uDom('[data-i18n="supportReportSpecificButton"]').on('click', ev => {
        reportSpecificFilterIssue(ev);
    });

    uDom('[data-i18n="supportFindSpecificButton"]').on('click', ev => {
        const url = new URL('https://github.com/uBlockOrigin/uAssets/issues');
        url.searchParams.set('q', `is:issue "${reportSpecificFilterHostname()}" in:title`);
        vAPI.messaging.send('default', {
            what: 'gotoURL',
            details: { url: url.href, select: true, index: -1 },
        });
        ev.preventDefault();
    });

    uDom('#redactButton').on('click', ( ) => {
        document.body.classList.add('redacted');
        showData();
    });

    uDom('#unredactButton').on('click', ( ) => {
        document.body.classList.remove('redacted');
        showData();
    });

    uDom('#selectAllButton').on('click', ( ) => {
        cmEditor.focus();
        cmEditor.execCommand('selectAll');
    });
})();

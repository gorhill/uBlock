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
    'modifiedHiddenSettings.blockingProfiles',
    'modifiedHiddenSettings.consoleLogLevel',
    'modifiedHiddenSettings.uiPopupConfig',
    'modifiedUserSettings.alwaysDetachLogger',
    'modifiedUserSettings.firewallPaneMinimized',
    'modifiedUserSettings.externalLists',
    'modifiedUserSettings.importedLists',
    'modifiedUserSettings.popupPanelSections',
    'modifiedUserSettings.uiAccentCustom',
    'modifiedUserSettings.uiAccentCustom0',
    'modifiedUserSettings.uiTheme',
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
    const text = cmEditor.getValue().trim();
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
    const redacted = true;
    if ( redacted ) {
        sensitiveValues.forEach(prop => { redactValue(shownData, prop); });
        sensitiveKeys.forEach(prop => { redactKeys(shownData, prop); });
    }
    for ( const prop in shownData ) {
        patchEmptiness(shownData, prop);
    }
    if ( reportedPage !== null ) {
        shownData.popupPanel = reportedPage.popupPanel;
    }
    const text = JSON.stringify(shownData, null, 2)
        .split('\n')
        .slice(1, -1)
        .map(v => {
            return v
                .replace(/^( *?)  "/, '$1')
                .replace(/^( *.*[^\\])(?:": "|": \{$|": \[$|": )/, '$1: ')
                .replace(/(?:",?|\},?|\],?|,)$/, '');
        })
        .filter(v => v.trim() !== '')
        .join('\n') + '\n';

    cmEditor.setValue(text);
    cmEditor.clearHistory();

    addDetailsToReportURL('filterReport', true);
    addDetailsToReportURL('bugReport', true);
}

/******************************************************************************/

const reportedPage = (( ) => {
    const url = new URL(window.location.href);
    try {
        const pageURL = url.searchParams.get('pageURL');
        if ( pageURL === null ) { return null; }
        const parsedURL = new URL(pageURL);
        parsedURL.username = '';
        parsedURL.password = '';
        parsedURL.hash = '';
        const select = document.querySelector('select[name="url"]');
        select.options[0].textContent = parsedURL.href;
        if ( parsedURL.search !== '' ) {
            const option = document.createElement('option');
            parsedURL.search = '';
            option.textContent = parsedURL.href;
            select.append(option);
        }
        if ( parsedURL.pathname !== '/' ) {
            const option = document.createElement('option');
            parsedURL.pathname = '';
            option.textContent = parsedURL.href;
            select.append(option);
        }
        document.body.classList.add('filterIssue');
        return {
            hostname: parsedURL.hostname.replace(/^(m|mobile|www)\./, ''),
            popupPanel: JSON.parse(url.searchParams.get('popupPanel')),
        };
    } catch(ex) {
    }
    return null;
})();

function reportSpecificFilterType() {
    return document.querySelector('select[name="type"]').value;
}

function reportSpecificFilterIssue(ev) {
    const githubURL = new URL('https://github.com/uBlockOrigin/uAssets/issues/new?template=specific_report_from_ubo.yml');
    const issueType = reportSpecificFilterType();
    let title = `${reportedPage.hostname}: ${issueType}`;
    if ( document.getElementById('isNSFW').checked ) {
        title = `[nsfw] ${title}`;
    }
    githubURL.searchParams.set('title', title);
    githubURL.searchParams.set(
        'url_address_of_the_web_page', '`' +
        document.querySelector('select[name="url"]').value +
        '`'
    );
    githubURL.searchParams.set('category', issueType);
    githubURL.searchParams.set('configuration', configToMarkdown(true));
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
            details: { url, select: true, index: -1, shiftKey: ev.shiftKey },
        });
        ev.preventDefault();
    });

    if ( reportedPage !== null ) {
        uDom('[data-i18n="supportReportSpecificButton"]').on('click', ev => {
            reportSpecificFilterIssue(ev);
        });

        uDom('[data-i18n="supportFindSpecificButton"]').on('click', ev => {
            const url = new URL('https://github.com/uBlockOrigin/uAssets/issues');
            url.searchParams.set('q', `is:issue sort:updated-desc "${reportedPage.hostname}" in:title`);
            vAPI.messaging.send('default', {
                what: 'gotoURL',
                details: { url: url.href, select: true, index: -1 },
            });
            ev.preventDefault();
        });

        uDom('#showSupportInfo').on('click', ev => {
            const button = ev.target;
            button.classList.add('hidden');
            uDom.nodeFromSelector('.a.b.c.d').classList.add('e');
            cmEditor.refresh();
        });
    }

    uDom('#selectAllButton').on('click', ( ) => {
        cmEditor.focus();
        cmEditor.execCommand('selectAll');
    });
})();

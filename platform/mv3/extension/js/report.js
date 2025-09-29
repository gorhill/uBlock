/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2024-present Raymond Hill

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
import { getTroubleshootingInfo } from './troubleshooting.js';
import { sendMessage } from './ext.js';

/******************************************************************************/

const reportedPage = (( ) => {
    const url = new URL(window.location.href);
    try {
        const pageURL = url.searchParams.get('url');
        if ( pageURL === null ) { return null; }
        const parsedURL = new URL(pageURL);
        parsedURL.username = '';
        parsedURL.password = '';
        parsedURL.hash = '';
        const select = qs$('select[name="url"]');
        dom.text(select.options[0], parsedURL.href);
        if ( parsedURL.search !== '' ) {
            const option = dom.create('option');
            parsedURL.search = '';
            dom.text(option, parsedURL.href);
            select.append(option);
        }
        if ( parsedURL.pathname !== '/' ) {
            const option = dom.create('option');
            parsedURL.pathname = '';
            dom.text(option, parsedURL.href);
            select.append(option);
        }
        return {
            hostname: parsedURL.hostname.replace(/^(m|mobile|www)\./, ''),
            mode: url.searchParams.get('mode'),
        };
    } catch {
    }
    return null;
})();

/******************************************************************************/

function reportSpecificFilterType() {
    return qs$('select[name="type"]').value;
}

/******************************************************************************/

async function reportSpecificFilterIssue() {
    const githubURL = new URL(
        'https://github.com/uBlockOrigin/uAssets/issues/new?template=specific_report_from_ubol.yml'
    );
    const issueType = reportSpecificFilterType();
    let title = `${reportedPage.hostname}: ${issueType}`;
    if ( qs$('#isNSFW').checked ) {
        title = `[nsfw] ${title}`;
    }
    githubURL.searchParams.set('title', title);
    githubURL.searchParams.set(
        'url_address_of_the_web_page',
        '`' + qs$('select[name="url"]').value + '`'
    );
    githubURL.searchParams.set('category', issueType);

    const configBody = [
        '```yaml',
        qs$('[data-i18n="supportS5H"] + pre').textContent,
        '```',
        '',
    ].join('\n');
    githubURL.searchParams.set('configuration', configBody);
    sendMessage({ what: 'gotoURL', url: githubURL.href });
}

/******************************************************************************/

getTroubleshootingInfo(reportedPage.mode).then(config => {
    qs$('[data-i18n="supportS5H"] + pre').textContent = config;

    dom.on('[data-url]', 'click', ev => {
        const elem = ev.target.closest('[data-url]');
        const url = dom.attr(elem, 'data-url');
        if ( typeof url !== 'string' || url === '' ) { return; }
        sendMessage({ what: 'gotoURL', url });
        ev.preventDefault();
    });

    if ( reportedPage !== null ) {
        dom.on('[data-i18n="supportReportSpecificButton"]', 'click', ev => {
            reportSpecificFilterIssue();
            ev.preventDefault();
        });

        dom.on('[data-i18n="supportFindSpecificButton"]', 'click', ev => {
            const url = new URL('https://github.com/uBlockOrigin/uAssets/issues');
            url.searchParams.set('q', `is:issue sort:updated-desc "${reportedPage.hostname}" in:title`);
            sendMessage({ what: 'gotoURL', url: url.href });
            ev.preventDefault();
        });
    }
});

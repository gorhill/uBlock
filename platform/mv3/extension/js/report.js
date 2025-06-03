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

import {
    dom,
    qs$,
} from './dom.js';

import {
    localRead,
    runtime,
    sendMessage,
} from './ext.js';

import { dnr } from './ext-compat.js';

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

function renderData(data, depth = 0) {
    const indent = ' '.repeat(depth);
    if ( Array.isArray(data) ) {
        const out = [];
        for ( const value of data ) {
            out.push(renderData(value, depth));
        }
        return out.join('\n');
    }
    if ( typeof data !== 'object' || data === null ) {
        return `${indent}${data}`;
    }
    const out = [];
    for ( const [ name, value ] of Object.entries(data) ) {
        if ( typeof value === 'object' && value !== null ) {
            out.push(`${indent}${name}:`);
            out.push(renderData(value, depth + 1));
            continue;
        }
        out.push(`${indent}${name}: ${value}`);
    }
    return out.join('\n');
}

/******************************************************************************/

async function getConfigData() {
    const manifest = runtime.getManifest();
    const [
        platformInfo,
        rulesets,
        defaultMode,
        userRules,
        registerContentScriptsReason,
        unregisterContentScriptsReason,
    ] = await Promise.all([
        runtime.getPlatformInfo(),
        dnr.getEnabledRulesets(),
        sendMessage({ what: 'getDefaultFilteringMode' }),
        sendMessage({ what: 'getEffectiveUserRules' }),
        localRead('$scripting.registerContentScripts'),
        localRead('$scripting.unregisterContentScripts'),
    ]);
    const browser = (( ) => {
        const extURL = runtime.getURL('');
        let agent = '';
        if ( extURL.startsWith('moz-extension:') ) {
            agent = 'Firefox';
        } else if ( extURL.startsWith('safari-web-extension:') ) {
            agent = 'Safari';
        } else if ( /\bEdg\/\b/.test(navigator.userAgent) ) {
            agent = 'Edge';
        } else {
            agent = 'Chrome';
        }
        dom.cl.add('html', agent.toLowerCase());
        if ( /\bMobile\b/.test(navigator.userAgent) ) {
            agent += ' Mobile';
        }
        const reVersion = new RegExp(`\\b${agent.slice(0,3)}[^/]*/(\\d+)`);
        const match = reVersion.exec(navigator.userAgent);
        if ( match ) {
            agent += ` ${match[1]}`;
        }
        agent += ` (${platformInfo.os})`
        return agent;
    })();
    const modes = [ 'no filtering', 'basic', 'optimal', 'complete' ];
    const config = {
        name: manifest.name,
        version: manifest.version,
        browser,
        filtering: {
            'site': `${modes[reportedPage.mode]}`,
            'default': `${modes[defaultMode]}`,
        },
    };
    if ( userRules.length !== 0 ) {
        config['user rules'] = userRules.length;
    }
    config.rulesets = rulesets;
    if ( registerContentScriptsReason !== undefined ) {
        config.registerContentScripts = registerContentScriptsReason;
    }
    if ( unregisterContentScriptsReason !== undefined ) {
        config.unregisterContentScripts = unregisterContentScriptsReason;
    }
    return renderData(config);
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

getConfigData().then(config => {
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

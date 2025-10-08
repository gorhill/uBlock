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

import { runtime, sendMessage } from './ext.js';

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

export async function getTroubleshootingInfo(siteMode) {
    const manifest = runtime.getManifest();
    const [
        platformInfo,
        defaultConfig,
        enabledRulesets,
        defaultMode,
        userRules,
        consoleOutput,
        hasOmnipotence,
    ] = await Promise.all([
        runtime.getPlatformInfo(),
        sendMessage({ what: 'getDefaultConfig' }),
        sendMessage({ what: 'getEnabledRulesets' }),
        sendMessage({ what: 'getDefaultFilteringMode' }),
        sendMessage({ what: 'getEffectiveUserRules' }),
        sendMessage({ what: 'getConsoleOutput' }),
        sendMessage({ what: 'hasBroadHostPermissions' }),
    ]);
    const browser = (( ) => {
        const extURL = runtime.getURL('');
        let agent = '', version = '?';
        if ( extURL.startsWith('moz-extension:') ) {
            agent = 'Firefox';
            const match = /\bFirefox\/(\d+\.\d+)\b/.exec(navigator.userAgent);
            version = match && match[1] || '?';
        } else if ( extURL.startsWith('safari-web-extension:') ) {
            agent = 'Safari';
            const match = /\bVersion\/(\d+\.\d+)\b/.exec(navigator.userAgent);
            version = match && match[1] || '?';
        } else if ( /\bEdg\/\b/.test(navigator.userAgent) ) {
            agent = 'Edge';
            const match = /\bEdg\/(\d+)\b/.exec(navigator.userAgent);
            version = match && match[1] || '?';
        } else {
            agent = 'Chrome';
            const match = /\bChrome\/(\d+)\b/.exec(navigator.userAgent);
            version = match && match[1] || '?';
        }
        if ( /\bMobile\b/.test(navigator.userAgent) ) {
            agent += ' Mobile';
        }
        agent += ` ${version} (${platformInfo.os})`
        return agent;
    })();
    const modes = [ 'no filtering', 'basic', 'optimal', 'complete' ];
    const filtering = {};
    if ( siteMode ) {
        filtering.site = `${modes[siteMode]}`
    }
    filtering.default = `${modes[defaultMode]}`;
    const config = {
        name: manifest.name,
        version: manifest.version,
        browser,
        filtering,
        permission: hasOmnipotence ? 'all' : 'ask',
    };
    if ( userRules.length !== 0 ) {
        config['user rules'] = userRules.length;
    }
    const defaultRulesets = defaultConfig.rulesets;
    for ( let i = 0; i < enabledRulesets.length; i++ ) {
        const id = enabledRulesets[i];
        if ( defaultRulesets.includes(id) ) { continue; }
        enabledRulesets[i] = `+${id}`;
    }
    for ( const id of defaultRulesets ) {
        if ( enabledRulesets.includes(id) ) { continue; }
        enabledRulesets.push(`-${id}`);
    }
    config.rulesets = enabledRulesets.sort();
    if ( consoleOutput.length !== 0 ) {
        config.console = siteMode
            ? consoleOutput.slice(-8)
            : consoleOutput;
    }
    return renderData(config);
}

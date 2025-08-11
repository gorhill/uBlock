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

import { dnr } from './ext-compat.js';
import { getConsoleOutput } from './debug.js';
import { getDefaultFilteringMode } from './mode-manager.js';
import { getEffectiveUserRules } from './ruleset-manager.js';
import { runtime } from './ext.js';

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
        rulesets,
        defaultMode,
        userRules,
    ] = await Promise.all([
        runtime.getPlatformInfo(),
        dnr.getEnabledRulesets(),
        getDefaultFilteringMode(),
        getEffectiveUserRules(),
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
    };
    if ( userRules.length !== 0 ) {
        config['user rules'] = userRules.length;
    }
    config.rulesets = rulesets;
    const consoleOutput = getConsoleOutput();
    if ( consoleOutput.length !== 0 ) {
        config.console = siteMode
            ? consoleOutput.slice(-8)
            : consoleOutput;
    }
    return renderData(config);
}

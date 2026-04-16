/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2026-present Raymond Hill

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

import * as makeScriptlet from '../make-scriptlets.js';
import * as sfp from '../static-filtering-parser.js';

/******************************************************************************/

(async ( ) => {
    const parser = new sfp.AstFilterParser({ trustedSource: true });
    const scriptletDetails = new Map();

    const data = await chrome.runtime.sendMessage({ what: 'getAllCustomFilters' });

    for ( const [ hostname, selectors ] of data ) {
        for ( const selector of selectors ) {
            if ( selector.startsWith('+js') === false ) { continue; }
            parser.parse(`##${selector}`);
            if ( parser.isScriptletFilter() === false ) { continue; }
            const args = parser.getScriptletArgs();
            const argsToken = JSON.stringify(args);
            const details = scriptletDetails.get(argsToken) || {
                args,
                matches: [],
                trustedSource: true,
            };
            if ( details.matches.length === 0 ) {
                scriptletDetails.set(argsToken, details);
            }
            details.matches.push(hostname);
        }
    }

    for ( const details of scriptletDetails.values() ) {
        makeScriptlet.compile('user', details);
    }

    const template = await fetch('../scriptlet.template.js').then(response =>
        response.text()
    );
    const result = makeScriptlet.commit('user', template);
    chrome.runtime.sendMessage(Object.assign({ what: 'registerCustomScriptlets', }, result));
})();

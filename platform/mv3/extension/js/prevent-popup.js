/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
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

import { matchesFromHostnames } from './utils.js';

/******************************************************************************/

// https://github.com/uBlockOrigin/uBOL-home/issues/632

export async function registerPreventPopup(context) {
    const js = [];
    for ( const { id, popups } of context.rulesetsDetails ) {
        if ( popups === undefined ) { continue; }
        js.push(`/rulesets/scripting/popup/${id}.js`);
    }
    if ( js.length === 0 ) { return; }
    js.push(
        '/js/scripting/prevent-popup-target.js',
        '/js/scripting/prevent-popup.js'
    );

    const { none, basic, optimal, complete } = context.filteringModeDetails;
    let matches = [];
    let excludeMatches = [];
    if ( complete.has('all-urls') ) {
        matches = [ '*' ];
        excludeMatches = [ ...none, ...basic, ...optimal ];
    } else {
        matches = [ ...complete ];
    }
    if ( matches.length === 0 ) { return; }

    const directive = {
        id: 'prevent-popup',
        js,
        matches: matchesFromHostnames(matches),
        excludeMatches: matchesFromHostnames(excludeMatches),
        runAt: 'document_start',
    };
    context.toAdd.push(directive);
}

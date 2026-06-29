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

import { registerScriptlet } from './base.js';
import { safeSelf } from './safe-self.js';

/**
 * @scriptlet prevent-navigation
 * 
 * @description
 * Conditionally abort navigation events.
 * 
 * @param [pattern]
 * Optional. A pattern to match against the assigned value. The pattern can be
 * a plain string, or a regex. Prepend with `!` to reverse the match condition.
 * No pattern 
 * 
 * Reference:
 * https://github.com/AdguardTeam/Scriptlets/commit/cd2d8eefd5
 * */

export function preventNavigation(
    pattern = ''
) {
    const safe = safeSelf();
    const logPrefix = safe.makeLogPrefix('prevent-navigation', pattern);
    const needle = pattern === 'location.href' ? self.location.href : pattern;
    const matcher = safe.initPattern(needle, { canNegate: true });
    self.navigation.addEventListener('navigate', ev => {
        if ( ev.userInitiated ) { return; }
        const { url } = ev.destination;
        if ( pattern === '' ) {
            safe.uboLog(logPrefix, `Navigation to ${url}`);
            return;
        }
        if ( safe.testPattern(matcher, url) ) {
            ev.preventDefault();
            safe.uboLog(logPrefix, `Prevented navigation to ${url}`);
        }
    });
}
registerScriptlet(preventNavigation, {
    name: 'prevent-navigation.js',
    dependencies: [
        safeSelf,
    ],
    world: 'ISOLATED',
});

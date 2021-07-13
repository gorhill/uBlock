/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2021-present Raymond Hill

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

(function() {
    'use strict';
    // https://developer.mixpanel.com/docs/javascript-full-api-reference
    const mixpanel = {
        get_distinct_id() {
            return '';
        },
        init(t, cfg) {
            if ( cfg instanceof Object === false ) { return; }
            if ( 'loaded' in cfg === false ) { return; }
            if ( cfg.loaded instanceof Function === false ) { return; }
            cfg.loaded();
        },
        register() {
        },
        register_once() {
        },
        track() {
            const cb = Array.from(arguments).pop();
            if ( cb instanceof Function === false ) { return; }
            cb();
        },
    };
    const q = self.mixpanel && self.mixpanel._i || [];
    self.mixpanel = mixpanel;
    for ( const i of q ) {
        if ( Array.isArray(i) === false ) { continue; }
        mixpanel.init(...i);
    }
})();

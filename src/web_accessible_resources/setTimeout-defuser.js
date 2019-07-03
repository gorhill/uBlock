/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2019-present Raymond Hill

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
    let needle = '{{1}}';
    const delay = parseInt('{{2}}', 10);
    if ( needle === '' || needle === '{{1}}' ) {
        needle = '.?';
    } else if ( needle.startsWith('/') && needle.endsWith('/') ) {
        needle = needle.slice(1,-1);
    } else {
        needle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    needle = new RegExp(needle);
    window.setTimeout = new Proxy(window.setTimeout, {
        apply: function(target, thisArg, args) {
            const a = args[0];
            const b = args[1];
            if ( (isNaN(delay) || b === delay) && needle.test(a.toString()) ) {
                args[0] = function(){};
            }
            return target.apply(thisArg, args);
        }
    });
})();

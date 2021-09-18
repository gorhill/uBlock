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

(function() {
    'use strict';
    let browserId = '';
    for ( let i = 0; i < 8; i++ ) {
        browserId += (Math.random() * 0x10000 + 0x1000 | 0).toString(16).slice(-4);
    }
    const fp2 = function(){};
    fp2.get = function(opts, cb) {
        if ( !cb  ) { cb = opts; }
        setTimeout(( ) => { cb(browserId, []); }, 1);
    };
    fp2.prototype = {
        get: fp2.get
    };
    window.Fingerprint2 = fp2;
})();

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
    const init = ( ) => {
        window.adsbygoogle = {
            loaded: true,
            push: function() {
            }
        };
        const phs = document.querySelectorAll('.adsbygoogle');
        const css = 'height:1px!important;max-height:1px!important;max-width:1px!important;width:1px!important;';
        for ( let i = 0; i < phs.length; i++ ) {
            const id = `aswift_${i}`;
            if ( document.querySelector(`iframe#${id}`) !== null ) { continue; }
            const fr = document.createElement('iframe');
            fr.id = id;
            fr.style = css;
            const cfr = document.createElement('iframe');
            cfr.id = `google_ads_frame${i}`;
            fr.appendChild(cfr);
            phs[i].appendChild(fr);
        }
    };
    if (
        document.querySelectorAll('.adsbygoogle').length === 0 &&
        document.readyState === 'loading'
    ) {
        window.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();

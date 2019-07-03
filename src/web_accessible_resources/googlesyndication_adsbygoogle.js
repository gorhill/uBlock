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
    window.adsbygoogle = window.adsbygoogle || {
        length: 0,
        loaded: true,
        push: function Si() {
            /*
            client = client || google_ad_client || google_ad_client;
            slotname = slotname || google_ad_slot;
            tag_origin = tag_origin || google_tag_origin
            */
            this.length += 1;
        }
    };
    const phs = document.querySelectorAll('.adsbygoogle');
    const css = 'height:1px!important;max-height:1px!important;max-width:1px!important;width:1px!important;';
    for ( let i = 0; i < phs.length; i++ ) {
        const fr = document.createElement('iframe');
        fr.id = 'aswift_' + (i+1);
        fr.style = css;
        const cfr = document.createElement('iframe');
        cfr.id = 'google_ads_frame' + i;
        fr.appendChild(cfr);
        document.body.appendChild(fr);
    }
})();

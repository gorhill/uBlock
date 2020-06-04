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

    Completely experimental: load Disqus on demand only. Purpose is to avoid
    connecting to Disqus' servers, unless the user explicitly asks for the
    comments to be loaded.
    Works with following filters:
    ||disqus.com/forums/*embed.js$script,redirect=disqus.com/forums/*embed.js
    ||disqus.com/embed.js$script,redirect=disqus.com/embed.js
    ||disqus.com/count.js$script
    @@||disqus.com/embed.js?_=1457540*$script
    If you want a site you regularly visit to always have the comment loaded,
    just use an exception static filter. Example for wired.com:
    @@||wired.disqus.com/embed.js

*/

(function() {
    'use strict';
    const ee = document.getElementsByTagName('script');
    let i = ee.length, src;
    while ( i-- ) {
        src = ee[i].src || '';
        if ( src === '' ) {
            continue;
        }
        if ( src.lastIndexOf('disqus.com/embed.js') === (src.length - 19) ) {
            return;
        }
    }
    const e = document.createElement('script');
    e.async = true;
    e.src = '//' + window.disqus_shortname + '.disqus.com/embed.js';
    document.body.appendChild(e);
})();

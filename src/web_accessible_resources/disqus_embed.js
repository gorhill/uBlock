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
    const p = document.getElementById(window.disqus_container_id || 'disqus_thread');
    if ( p === null ) { return; }
    const b = document.createElement('button');
    b.textContent = 'Disqus blocked by uBlock Origin: click to unblock';
    b.type = 'button';
    p.appendChild(b);
    const loadDisqus = function(ev) {
        b.removeEventListener('click', loadDisqus);
        p.removeChild(b);
        const script = document.createElement('script');
        script.async = true;
        const t = Date.now().toString();
        script.src = '//' + window.disqus_shortname + '.disqus.com/embed.js?_=1457540' + t.slice(-6);
        document.body.appendChild(script);
        ev.preventDefault();
        ev.stopPropagation();
    };
    b.addEventListener('click', loadDisqus);
})();

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
        b.remove();
        let disqusScript =
            document.querySelector('script[src$=".disqus.com/embed.js"]');
        let newScript;
        if ( disqusScript !== null ) {
            disqusScript.remove();
            newScript = document.createElement('script');
            if ( disqusScript.hasAttributes() ) {
                const attrs = disqusScript.attributes;
                for ( let i = 0; i < attrs.length; i++ ) {
                    const attr = attrs[i];
                    newScript.setAttribute(attr.name, attr.value);
                }
            }
        } else if ( typeof self.disqus_shortname === 'string' ) {
            newScript = document.createElement('script');
            newScript.async = true;
            newScript.src = `//${self.disqus_shortname}.disqus.com/embed.js`;
        }
        if ( newScript === undefined ) { return; }
        const t = Date.now().toString();
        newScript.src += '?_=1457540' + t.slice(-6);
        document.body.appendChild(newScript);
        ev.preventDefault();
        ev.stopPropagation();
    };
    b.addEventListener('click', loadDisqus, { once: true });
})();

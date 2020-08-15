/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2018-present Raymond Hill

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

    Home: https://github.com/gorhill/uMatrix
*/

'use strict';

/******************************************************************************/

const faIconsInit = function(root) {
    const icons = (root || document).querySelectorAll('.fa-icon');
    for ( const icon of icons ) {
        if ( icon.firstChild === null || icon.firstChild.nodeType !== 3 ) {
            continue;
        }
        const name = icon.firstChild.nodeValue.trim();
        if ( name === '' ) { continue; }
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        let file;
        if ( name.startsWith('ph-') ) {
            file = 'photon';
        } else if ( name.startsWith('md-') ) {
            file = 'material-design';
        } else {
            file = 'fontawesome/fontawesome-defs';
        }
        svg.classList.add('fa-icon_' + name);
        use.setAttribute('href', `/img/${file}.svg#${name}`);
        svg.appendChild(use);
        icon.replaceChild(svg, icon.firstChild);
        if ( icon.classList.contains('fa-icon-badged') ) {
            const badge = document.createElement('span');
            badge.className = 'fa-icon-badge';
            icon.insertBefore(badge, icon.firstChild.nextSibling);
        }
    }
};

faIconsInit();

/*******************************************************************************

    µBlock - a browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

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

    Home: https://github.com/chrisaljoudi/uBlock
*/

/* global uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var resizeFrame = function() {
    var navRect = document.getElementById('dashboard-nav').getBoundingClientRect();
    var viewRect = document.documentElement.getBoundingClientRect();
    document.getElementById('iframe').style.setProperty('height', (viewRect.bottom - navRect.bottom) + 'px');
};

/******************************************************************************/

var loadDashboardPanel = function(tab, q) {
    var tabButton = uDom('[href="#' + tab + '"]');
    if ( !tabButton ) {
        return;
    }
    q = q || '';
    uDom('iframe').attr('src', tab + q);
    uDom('.tabButton').toggleClass('selected', false);
    tabButton.toggleClass('selected', true);
};

/******************************************************************************/

var onTabClickHandler = function(e) {
    loadDashboardPanel(this.hash.slice(1));
    e.preventDefault();
};

/******************************************************************************/

uDom.onLoad(function() {
    window.addEventListener('resize', resizeFrame);
    resizeFrame();

    var matches = window.location.search.slice(1).match(/\??(tab=([^&]+))?(.*)$/);
    var tab = '', q = '';
    if ( matches && matches.length === 4 ) {
        tab = matches[2];
        q = matches[3];
        if ( q !== '' && q.charAt(0) === '&' ) {
            q = '?' + q.slice(1);
        }
    }
    if ( !tab ) {
        tab = 'settings';
    }
    loadDashboardPanel(tab + '.html', q);
    uDom('.tabButton').on('click', onTabClickHandler);
});

/******************************************************************************/

})();

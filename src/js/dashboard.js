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

/* global uDom */

'use strict';

/******************************************************************************/

(function() {

/******************************************************************************/

let resizeFrame = function() {
    let navRect = document.getElementById('dashboard-nav').getBoundingClientRect();
    let viewRect = document.documentElement.getBoundingClientRect();
    document.getElementById('iframe').style.setProperty(
        'height',
        (viewRect.height - navRect.height) + 'px'
    );
};

let loadDashboardPanel = function() {
    let pane = window.location.hash.slice(1);
    if ( pane === '' ) {
        pane = vAPI.localStorage.getItem('dashboardLastVisitedPane');
        if ( pane === null ) {
             pane = 'settings.html';
        }
    } else {
        vAPI.localStorage.setItem('dashboardLastVisitedPane', pane);
    }
    let tabButton = uDom('[href="#' + pane + '"]');
    if ( !tabButton || tabButton.hasClass('selected') ) { return; }
    uDom('.tabButton.selected').toggleClass('selected', false);
    uDom('iframe').attr('src', pane);
    tabButton.toggleClass('selected', true);
};

let onTabClickHandler = function(e) {
    let url = window.location.href,
        pos = url.indexOf('#');
    if ( pos !== -1 ) {
        url = url.slice(0, pos);
    }
    url += this.hash;
    if ( url !== window.location.href ) {
        window.location.replace(url);
        loadDashboardPanel();
    }
    e.preventDefault();
};

// https://github.com/uBlockOrigin/uBlock-issues/issues/106
vAPI.messaging.send('dashboard', { what: 'canUpdateShortcuts' }, response => {
    document.body.classList.toggle('canUpdateShortcuts', response === true);
});

vAPI.messaging.send('dashboard', { what: 'benchmarkingPane' }, response => {
    document.body.classList.toggle('canBenchmark', response === true);
});

resizeFrame();
window.addEventListener('resize', resizeFrame);
uDom('.tabButton').on('click', onTabClickHandler);
loadDashboardPanel();

/******************************************************************************/

})();

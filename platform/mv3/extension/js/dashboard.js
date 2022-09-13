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

'use strict';

/******************************************************************************/

import { simpleStorage } from './storage.js';
import { dom, qs$ } from './dom.js';

/******************************************************************************/

const discardUnsavedData = function(synchronous = false) {
    const paneFrame = document.getElementById('iframe');
    const paneWindow = paneFrame.contentWindow;
    if (
        typeof paneWindow.hasUnsavedData !== 'function' ||
        paneWindow.hasUnsavedData() === false
    ) {
        return true;
    }

    if ( synchronous ) {
        return false;
    }

    return new Promise(resolve => {
        const modal = document.querySelector('#unsavedWarning');
        modal.classList.add('on');
        modal.focus();

        const onDone = status => {
            modal.classList.remove('on');
            document.removeEventListener('click', onClick, true);
            resolve(status);
        };

        const onClick = ev => {
            const target = ev.target;
            if ( target.matches('[data-i18n="dashboardUnsavedWarningStay"]') ) {
                return onDone(false);
            }
            if ( target.matches('[data-i18n="dashboardUnsavedWarningIgnore"]') ) {
                return onDone(true);
            }
            if ( modal.querySelector('[data-i18n="dashboardUnsavedWarning"]').contains(target) ) {
                return;
            }
            onDone(false);
        };

        document.addEventListener('click', onClick, true);
    });
};

const loadDashboardPanel = function(pane, first) {
    const tabButton = document.querySelector(`[data-pane="${pane}"]`);
    if ( tabButton === null || tabButton.classList.contains('selected') ) {
        return;
    }
    const loadPane = ( ) => {
        self.location.replace(`#${pane}`);
        for ( const node of document.querySelectorAll('.tabButton.selected') ) {
            node.classList.remove('selected');
        }
        tabButton.classList.add('selected');
        tabButton.scrollIntoView();
        document.querySelector('#iframe').contentWindow.location.replace(pane);
        if ( pane !== 'no-dashboard.html' ) {
            simpleStorage.setItem('dashboardLastVisitedPane', pane);
        }
    };
    if ( first ) {
        return loadPane();
    }
    const r = discardUnsavedData();
    if ( r === false ) { return; }
    if ( r === true ) {
        return loadPane();
    }
    r.then(status => {
        if ( status === false ) { return; }
        loadPane();
    });
};

const onTabClickHandler = function(ev) {
    loadDashboardPanel(ev.target.getAttribute('data-pane'));
};

if ( self.location.hash.slice(1) === 'no-dashboard.html' ) {
    document.body.classList.add('noDashboard');
}

(async ( ) => {
    let pane = null;
    if ( self.location.hash !== '' ) {
        pane = self.location.hash.slice(1) || null;
    }
    loadDashboardPanel(pane !== null ? pane : '3p-filters.html', true);

    dom.on(
        qs$('#dashboard-nav'),
        'click',
        '.tabButton',
        onTabClickHandler
    );

    // https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event
    window.addEventListener('beforeunload', ( ) => {
        if ( discardUnsavedData(true) ) { return; }
        event.preventDefault();
        event.returnValue = '';
    });
})();

/******************************************************************************/

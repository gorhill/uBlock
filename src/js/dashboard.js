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

{
// >>>>> start of local scope

/******************************************************************************/

const resizeFrame = function() {
    const navRect = document.getElementById('dashboard-nav')
                            .getBoundingClientRect();
    const viewRect = document.documentElement.getBoundingClientRect();
    document.getElementById('iframe').style.setProperty(
        'height',
        (viewRect.height - navRect.height) + 'px'
    );
};

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
        const modal = uDom.nodeFromId('unsavedWarning');
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
    const tabButton = uDom(`[href="#${pane}"]`);
    if ( !tabButton || tabButton.hasClass('selected') ) { return; }
    const loadPane = ( ) => {
        self.location.replace(`#${pane}`);
        uDom('.tabButton.selected').toggleClass('selected', false);
        tabButton.toggleClass('selected', true);
        uDom.nodeFromId('iframe').setAttribute('src', pane);
        vAPI.localStorage.setItem('dashboardLastVisitedPane', pane);
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
    loadDashboardPanel(ev.target.hash.slice(1));
    ev.preventDefault();
};

// https://github.com/uBlockOrigin/uBlock-issues/issues/106
vAPI.messaging.send('dashboard', {
    what: 'canUpdateShortcuts',
}).then(response => {
    document.body.classList.toggle('canUpdateShortcuts', response === true);
});

resizeFrame();

vAPI.localStorage.getItemAsync('dashboardLastVisitedPane').then(value => {
    loadDashboardPanel(value !== null ? value : 'settings.html', true);

    window.addEventListener('resize', resizeFrame);
    uDom('.tabButton').on('click', onTabClickHandler);

    // https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event
    window.addEventListener('beforeunload', ( ) => {
        if ( discardUnsavedData(true) ) { return; }
        event.preventDefault();
        event.returnValue = '';
    });
});

/******************************************************************************/

// <<<<< end of local scope
}

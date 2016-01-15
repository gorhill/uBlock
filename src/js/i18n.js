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

    Home: https://github.com/gorhill/uBlock
*/

/* global vAPI, uDom */

/******************************************************************************/

// This file should always be included at the end of the `body` tag, so as
// to ensure all i18n targets are already loaded.

(function() {

'use strict';

/******************************************************************************/

// Helper to deal with the i18n'ing of HTML files.
vAPI.i18n.render = function(context) {
    var docu = document;
    var root = context || docu;
    var elems, n, i, elem, text;

    elems = root.querySelectorAll('[data-i18n]');
    n = elems.length;
    for ( i = 0; i < n; i++ ) {
        elem = elems[i];
        text = vAPI.i18n(elem.getAttribute('data-i18n'));
        if ( !text ) {
            continue;
        }
        if ( text.indexOf('{') !== -1 ) {
            text = text.replace(/\{\{input:([^}]+)\}\}/g, '<input type="$1">');
        }
        uDom(elem).html(text);
    }

    elems = root.querySelectorAll('[title]');
    n = elems.length;
    for ( i = 0; i < n; i++ ) {
        elem = elems[i];
        text = vAPI.i18n(elem.getAttribute('title'));
        if ( text ) {
            elem.setAttribute('title', text);
        }
    }

    elems = root.querySelectorAll('[placeholder]');
    n = elems.length;
    for ( i = 0; i < n; i++ ) {
        elem = elems[i];
        elem.setAttribute('placeholder', vAPI.i18n(elem.getAttribute('placeholder')));
    }

    elems = root.querySelectorAll('[data-i18n-tip]');
    n = elems.length;
    for ( i = 0; i < n; i++ ) {
        elem = elems[i];
        elem.setAttribute(
            'data-tip',
            vAPI.i18n(elem.getAttribute('data-i18n-tip')).replace(/<br>/g, '\n').replace(/\n{3,}/g, '\n\n')
        );
    }
};

vAPI.i18n.render();

/******************************************************************************/

vAPI.i18n.renderElapsedTimeToString = function(tstamp) {
    var value = (Date.now() - tstamp) / 60000;
    if ( value < 2 ) {
        return vAPI.i18n('elapsedOneMinuteAgo');
    }
    if ( value < 60 ) {
        return vAPI.i18n('elapsedManyMinutesAgo').replace('{{value}}', Math.floor(value).toLocaleString());
    }
    value /= 60;
    if ( value < 2 ) {
        return vAPI.i18n('elapsedOneHourAgo');
    }
    if ( value < 24 ) {
        return vAPI.i18n('elapsedManyHoursAgo').replace('{{value}}', Math.floor(value).toLocaleString());
    }
    value /= 24;
    if ( value < 2 ) {
        return vAPI.i18n('elapsedOneDayAgo');
    }
    return vAPI.i18n('elapsedManyDaysAgo').replace('{{value}}', Math.floor(value).toLocaleString());
};

/******************************************************************************/

})();

/******************************************************************************/

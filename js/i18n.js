/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
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

// Helper to deal with the i18n'ing of HTML files.
// jQuery must be present at this point.

$(function() {
    $('[data-i18n]').each(function() {
        var me = $(this);
        var key = me.data('i18n');
        me.html(chrome.i18n.getMessage(key));
    });
    // copy text of <h1> if any to document title
    document.title = $('h1').first().text();

    // Tool tips
    $('[data-i18n-tip]').each(function() {
        var me = $(this);
        var key = me.data('i18nTip');
        me.attr('data-tip', chrome.i18n.getMessage(key));
    });
});

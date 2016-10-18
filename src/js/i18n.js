/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 Raymond Hill

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

// This file should always be included at the end of the `body` tag, so as
// to ensure all i18n targets are already loaded.

(function() {

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/2084
//   Anything else than <a>, <b>, <code>, <em>, <i>, <input>, and <span> will
//   be rendered as plain text.
//   For <input>, only the type attribute is allowed.
//   For <a>, only href attribute must be present, and it MUST starts with
//   `https://`, and includes no single- or double-quotes.
//   No HTML entities are allowed, there is code to handle existing HTML
//   entities already present in translation files until they are all gone.

var reSafeTags = /^([\s\S]*?)<(b|code|em|i|span)>(.+?)<\/\2>([\s\S]*)$/,
    reSafeInput = /^([\s\S]*?)<(input type="[^"]+")>(.*?)([\s\S]*)$/,
    reInput = /^input type=(['"])([a-z]+)\1$/,
    reSafeLink = /^([\s\S]*?)<(a href=['"]https:\/\/[^'" <>]+['"])>(.+?)<\/a>([\s\S]*)$/,
    reLink = /^a href=(['"])(https:\/\/[^'"]+)\1$/;

var safeTextToTagNode = function(text) {
    var matches, node;
    if ( text.lastIndexOf('a ', 0) === 0 ) {
        matches = reLink.exec(text);
        if ( matches === null ) { return null; }
        node = document.createElement('a');
        node.setAttribute('href', matches[2]);
        return node;
    }
    if ( text.lastIndexOf('input ', 0) === 0 ) {
        matches = reInput.exec(text);
        if ( matches === null ) { return null; }
        node = document.createElement('input');
        node.setAttribute('type', matches[2]);
        return node;
    }
    return document.createElement(text);
};

var safeTextToTextNode = function(text) {
    // TODO: remove once no more HTML entities in translation files.
    if ( text.indexOf('&') !== -1 ) {
        text = text.replace(/&ldquo;/g, '“')
                   .replace(/&rdquo;/g, '”')
                   .replace(/&lsquo;/g, '‘')
                   .replace(/&rsquo;/g, '’');
    }
    return document.createTextNode(text);
};

var safeTextToDOM = function(text, parent) {
    if ( text === '' ) { return; }
    // Fast path (most common).
    if ( text.indexOf('<') === -1 ) {
        return parent.appendChild(safeTextToTextNode(text));
    }
    // Slow path.
    // `<p>` no longer allowed. Code below can be remove once all <p>'s are
    // gone from translation files.
    text = text.replace(/^<p>|<\/p>/g, '')
               .replace(/<p>/g, '\n\n');
    // Parse allowed HTML tags.
    var matches = reSafeTags.exec(text);
    if ( matches === null ) {
        matches = reSafeLink.exec(text);
        if ( matches === null ) {
            matches = reSafeInput.exec(text);
            if ( matches === null ) {
                parent.appendChild(safeTextToTextNode(text));
                return;
            }
        }
    }
    safeTextToDOM(matches[1], parent);
    var node = safeTextToTagNode(matches[2]) || parent;
    safeTextToDOM(matches[3], node);
    parent.appendChild(node);
    safeTextToDOM(matches[4], parent);
};

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
        // TODO: remove once it's all replaced with <input type="...">
        if ( text.indexOf('{') !== -1 ) {
            text = text.replace(/\{\{input:([^}]+)\}\}/g, '<input type="$1">');
        }
        safeTextToDOM(text, elem);
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

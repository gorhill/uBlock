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

// This file should always be included at the end of the `body` tag, so as
// to ensure all i18n targets are already loaded.

{
// >>>>> start of local scope

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/2084
//   Anything else than <a>, <b>, <code>, <em>, <i>, and <span> will
//   be rendered as plain text.
//   For <a>, only href attribute must be present, and it MUST starts with
//   `https://`, and includes no single- or double-quotes.
//   No HTML entities are allowed, there is code to handle existing HTML
//   entities already present in translation files until they are all gone.

const reSafeTags = /^([\s\S]*?)<(b|code|em|i|span)>(.+?)<\/\2>([\s\S]*)$/;
const reSafeLink = /^([\s\S]*?)<(a href=['"]https:\/\/[^'" <>]+['"])>(.+?)<\/a>([\s\S]*)$/;
const reLink = /^a href=(['"])(https:\/\/[^'"]+)\1$/;

const safeTextToTagNode = function(text) {
    if ( text.lastIndexOf('a ', 0) === 0 ) {
        const matches = reLink.exec(text);
        if ( matches === null ) { return null; }
        const node = document.createElement('a');
        node.setAttribute('href', matches[2]);
        return node;
    }
    // Firefox extension validator warns if using a variable as argument for
    // document.createElement().
    switch ( text ) {
    case 'b':
        return document.createElement('b');
    case 'code':
        return document.createElement('code');
    case 'em':
        return document.createElement('em');
    case 'i':
        return document.createElement('i');
    case 'span':
        return document.createElement('span');
    default:
        break;
    }
};

const expandHtmlEntities = (( ) => {
    const entities = new Map([
        // TODO: Remove quote entities once no longer present in translation
        // files. Other entities must stay.
        [ '&shy;', '\u00AD' ],
        [ '&ldquo;', '“' ],
        [ '&rdquo;', '”' ],
        [ '&lsquo;', '‘' ],
        [ '&rsquo;', '’' ],
        [ '&lt;', '<' ],
        [ '&gt;', '>' ],
    ]);
    const decodeEntities = match => {
        return entities.get(match) || match;
    };
    return function(text) {
        if ( text.indexOf('&') !== -1 ) {
            text = text.replace(/&[a-z]+;/g, decodeEntities);
        }
        return text;
    };
})();

const safeTextToTextNode = function(text) {
    return document.createTextNode(expandHtmlEntities(text));
};

const safeTextToDOM = function(text, parent) {
    if ( text === '' ) { return; }

    // Fast path (most common).
    if ( text.indexOf('<') === -1 ) {
        const toInsert = safeTextToTextNode(text);
        let toReplace = parent.childElementCount !== 0
            ? parent.firstChild
            : null;
        while ( toReplace !== null ) {
            if ( toReplace.nodeType === 3 && toReplace.nodeValue === '_' ) {
                break;
            }
            toReplace = toReplace.nextSibling;
        }
        if ( toReplace !== null ) {
            parent.replaceChild(toInsert, toReplace);
        } else {
            parent.appendChild(toInsert);
        }
        return;
    }
    // Slow path.
    // `<p>` no longer allowed. Code below can be removed once all <p>'s are
    // gone from translation files.
    text = text.replace(/^<p>|<\/p>/g, '')
               .replace(/<p>/g, '\n\n');
    // Parse allowed HTML tags.
    let matches = reSafeTags.exec(text);
    if ( matches === null ) {
        matches = reSafeLink.exec(text);
        if ( matches === null ) {
            parent.appendChild(safeTextToTextNode(text));
            return;
        }
    }
    const fragment = document.createDocumentFragment();
    safeTextToDOM(matches[1], fragment);
    let node = safeTextToTagNode(matches[2]);
    safeTextToDOM(matches[3], node);
    fragment.appendChild(node);
    safeTextToDOM(matches[4], fragment);
    parent.appendChild(fragment);
};

/******************************************************************************/

vAPI.i18n.safeTemplateToDOM = function(id, dict, parent) {
    if ( parent === undefined ) {
        parent = document.createDocumentFragment();
    }
    let textin = vAPI.i18n(id);
    if ( textin === '' ) {
        return parent;
    }
    if ( textin.indexOf('{{') === -1 ) {
        safeTextToDOM(textin, parent);
        return parent;
    }
    const re = /\{\{\w+\}\}/g;
    let textout = '';
    for (;;) {
        let match = re.exec(textin);
        if ( match === null ) {
            textout += textin;
            break;
        }
        textout += textin.slice(0, match.index);
        let prop = match[0].slice(2, -2);
        if ( dict.hasOwnProperty(prop) ) {
            textout += dict[prop].replace(/</g, '&lt;')
                                 .replace(/>/g, '&gt;');
        } else {
            textout += prop;
        }
        textin = textin.slice(re.lastIndex);
    }
    safeTextToDOM(textout, parent);
    return parent;
};

/******************************************************************************/

// Helper to deal with the i18n'ing of HTML files.
vAPI.i18n.render = function(context) {
    const docu = document;
    const root = context || docu;

    for ( const elem of root.querySelectorAll('[data-i18n]') ) {
        let text = vAPI.i18n(elem.getAttribute('data-i18n'));
        if ( !text ) { continue; }
        if ( text.indexOf('{{') === -1 ) {
            safeTextToDOM(text, elem);
            continue;
        }
        // Handle selector-based placeholders: these placeholders tell where
        // existing child DOM element are to be positioned relative to the
        // localized text nodes.
        const parts = text.split(/(\{\{[^}]+\}\})/);
        const fragment = document.createDocumentFragment();
        let textBefore = '';
        for ( let part of parts ) {
            if ( part === '' ) { continue; }
            if ( part.startsWith('{{') && part.endsWith('}}') ) {
                // TODO: remove detection of ':' once it no longer appears
                //       in translation files.
                const pos = part.indexOf(':');
                if ( pos !== -1 ) {
                    part = part.slice(0, pos) + part.slice(-2);
                }
                const selector = part.slice(2, -2);
                let node;
                // Ideally, the i18n strings explicitly refer to the
                // class of the element to insert. However for now we
                // will create a class from what is currently found in
                // the placeholder and first try to lookup the resulting
                // selector. This way we don't have to revisit all
                // translations just for the sake of declaring the proper
                // selector in the placeholder field.
                if ( selector.charCodeAt(0) !== 0x2E /* '.' */ ) {
                    node = elem.querySelector(`.${selector}`);
                }
                if ( node instanceof Element === false ) {
                    node = elem.querySelector(selector);
                }
                if ( node instanceof Element ) {
                    safeTextToDOM(textBefore, fragment);
                    fragment.appendChild(node);
                    textBefore = '';
                    continue;
                }
            }
            textBefore += part;
        }
        if ( textBefore !== '' ) {
            safeTextToDOM(textBefore, fragment);
        }
        elem.appendChild(fragment);
    }

    for ( const elem of root.querySelectorAll('[data-i18n-title]') ) {
        const text = vAPI.i18n(elem.getAttribute('data-i18n-title'));
        if ( !text ) { continue; }
        elem.setAttribute('title', expandHtmlEntities(text));
    }

    for ( const elem of root.querySelectorAll('[placeholder]') ) {
        elem.setAttribute(
            'placeholder',
            vAPI.i18n(elem.getAttribute('placeholder'))
        );
    }

    for ( const elem of root.querySelectorAll('[data-i18n-tip]') ) {
        const text = vAPI.i18n(elem.getAttribute('data-i18n-tip'))
                   .replace(/<br>/g, '\n')
                   .replace(/\n{3,}/g, '\n\n');
        elem.setAttribute('data-tip', text);
        if ( elem.getAttribute('aria-label') === 'data-tip' ) {
            elem.setAttribute('aria-label', text);
        }
    }
};

vAPI.i18n.render();

/******************************************************************************/

vAPI.i18n.renderElapsedTimeToString = function(tstamp) {
    let value = (Date.now() - tstamp) / 60000;
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

// <<<<< end of local scope
}

/******************************************************************************/

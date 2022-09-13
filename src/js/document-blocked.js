/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-present Raymond Hill

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

import { i18n$ } from './i18n.js';

/******************************************************************************/

const messaging = vAPI.messaging;
let details = {};

{
    const matches = /details=([^&]+)/.exec(window.location.search);
    if ( matches !== null ) {
        details = JSON.parse(decodeURIComponent(matches[1]));
    }
}

/******************************************************************************/

(async ( ) => {
    const response = await messaging.send('documentBlocked', {
        what: 'listsFromNetFilter',
        rawFilter: details.fs,
    });
    if ( response instanceof Object === false ) { return; }

    let lists;
    for ( const rawFilter in response ) {
        if ( response.hasOwnProperty(rawFilter) ) {
            lists = response[rawFilter];
            break;
        }
    }

    if ( Array.isArray(lists) === false || lists.length === 0 ) { return; }

    const parent = uDom.nodeFromSelector('#whyex > ul');
    for ( const list of lists ) {
        const listElem = document.querySelector('#templates .filterList')
                                 .cloneNode(true);
        const sourceElem = listElem.querySelector('.filterListSource');
        sourceElem.href += encodeURIComponent(list.assetKey);
        sourceElem.textContent = list.title;
        if ( typeof list.supportURL === 'string' && list.supportURL !== '' ) {
            const supportElem = listElem.querySelector('.filterListSupport');
            supportElem.setAttribute('href', list.supportURL);
            supportElem.classList.remove('hidden');
        }
        parent.appendChild(listElem);
    }
    uDom.nodeFromId('whyex').style.removeProperty('display');
})();

/******************************************************************************/

uDom.nodeFromSelector('#theURL > p > span:first-of-type').textContent = details.url;
uDom.nodeFromId('why').textContent = details.fs;

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/691
//   Parse URL to extract as much useful information as possible. This is
//   useful to assist the user in deciding whether to navigate to the web page.
(( ) => {
    if ( typeof URL !== 'function' ) { return; }

    const reURL = /^https?:\/\//;

    const liFromParam = function(name, value) {
        if ( value === '' ) {
            value = name;
            name = '';
        }
        const li = document.createElement('li');
        let span = document.createElement('span');
        span.textContent = name;
        li.appendChild(span);
        if ( name !== '' && value !== '' ) {
            li.appendChild(document.createTextNode(' = '));
        }
        span = document.createElement('span');
        if ( reURL.test(value) ) {
            const a = document.createElement('a');
            a.href = a.textContent = value;
            span.appendChild(a);
        } else {
            span.textContent = value;
        }
        li.appendChild(span);
        return li;
    };

    // https://github.com/uBlockOrigin/uBlock-issues/issues/1649
    //   Limit recursion.
    const renderParams = function(parentNode, rawURL, depth = 0) {
        let url;
        try {
            url = new URL(rawURL);
        } catch(ex) {
            return false;
        }

        const search = url.search.slice(1);
        if ( search === '' ) { return false; }

        url.search = '';
        const li = liFromParam(i18n$('docblockedNoParamsPrompt'), url.href);
        parentNode.appendChild(li);

        const params = new self.URLSearchParams(search);
        for ( const [ name, value ] of params ) {
            const li = liFromParam(name, value);
            if ( depth < 2 && reURL.test(value) ) {
                const ul = document.createElement('ul');
                renderParams(ul, value, depth + 1);
                li.appendChild(ul);
            }
            parentNode.appendChild(li);
        }

        return true;
    };

    if ( renderParams(uDom.nodeFromId('parsed'), details.url) === false ) {
        return;
    }

    const toggler = document.querySelector('#toggleParse');
    toggler.classList.remove('hidden');

    toggler.addEventListener('click', ( ) => {
        const cl = uDom.nodeFromId('theURL').classList;
        cl.toggle('collapsed');
        vAPI.localStorage.setItem(
            'document-blocked-expand-url',
            (cl.contains('collapsed') === false).toString()
        );
    });

    vAPI.localStorage.getItemAsync('document-blocked-expand-url').then(value => {
        uDom.nodeFromId('theURL').classList.toggle(
            'collapsed',
            value !== 'true' && value !== true
        );
    });
})();

/******************************************************************************/

// https://www.reddit.com/r/uBlockOrigin/comments/breeux/close_this_window_doesnt_work_on_firefox/

if ( window.history.length > 1 ) {
    uDom('#back').on(
        'click',
        ( ) => {
            window.history.back();
        }
    );
    uDom('#bye').css('display', 'none');
} else {
    uDom('#bye').on(
        'click',
        ( ) => {
            messaging.send('documentBlocked', {
                what: 'closeThisTab',
            });
        }
    );
    uDom('#back').css('display', 'none');
}

/******************************************************************************/

const getTargetHostname = function() {
    return details.hn;
};

const proceedToURL = function() {
    window.location.replace(details.url);
};

const proceedTemporary = async function() {
    await messaging.send('documentBlocked', {
        what: 'temporarilyWhitelistDocument',
        hostname: getTargetHostname(),
    });
    proceedToURL();
};

const proceedPermanent = async function() {
    await messaging.send('documentBlocked', {
        what: 'toggleHostnameSwitch',
        name: 'no-strict-blocking',
        hostname: getTargetHostname(),
        deep: true,
        state: true,
        persist: true,
    });
    proceedToURL();
};

uDom('#disableWarning').on('change', ev => {
    const checked = ev.target.checked;
    document.querySelector('[data-i18n="docblockedBack"]').classList.toggle('disabled', checked);
    document.querySelector('[data-i18n="docblockedClose"]').classList.toggle('disabled', checked);
});

uDom('#proceed').on('click', ( ) => {
    const input = document.querySelector('#disableWarning');
    if ( input.checked ) {
        proceedPermanent();
    } else {
        proceedTemporary();
    }
});

/******************************************************************************/

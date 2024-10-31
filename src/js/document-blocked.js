/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
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

import { dom, qs$ } from './dom.js';
import { i18n, i18n$ } from './i18n.js';

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
        if ( Object.prototype.hasOwnProperty.call(response, rawFilter) ) {
            lists = response[rawFilter];
            break;
        }
    }

    if ( Array.isArray(lists) === false || lists.length === 0 ) {
        qs$('#whyex').style.setProperty('visibility', 'collapse');
        return;
    }

    const parent = qs$('#whyex > ul');
    parent.firstElementChild.remove(); // remove placeholder element
    for ( const list of lists ) {
        const listElem = dom.clone('#templates .filterList');
        const sourceElem = qs$(listElem, '.filterListSource');
        sourceElem.href += encodeURIComponent(list.assetKey);
        sourceElem.append(i18n.patchUnicodeFlags(list.title));
        if ( typeof list.supportURL === 'string' && list.supportURL !== '' ) {
            const supportElem = qs$(listElem, '.filterListSupport');
            dom.attr(supportElem, 'href', list.supportURL);
            dom.cl.remove(supportElem, 'hidden');
        }
        parent.appendChild(listElem);
    }
    qs$('#whyex').style.removeProperty('visibility');
})();

/******************************************************************************/

const urlToFragment = raw => {
    try {
        const fragment = new DocumentFragment();
        const url = new URL(raw);
        const hn = url.hostname;
        const i = raw.indexOf(hn);
        const b = document.createElement('b');
        b.append(hn);
        fragment.append(raw.slice(0,i), b, raw.slice(i+hn.length));
        return fragment;
    } catch(_) {
    }
    return raw;
};

/******************************************************************************/

dom.clear('#theURL > p > span:first-of-type');
qs$('#theURL > p > span:first-of-type').append(urlToFragment(details.url));
dom.text('#why', details.fs);

if ( typeof details.to === 'string' && details.to.length !== 0 ) {
    const fragment = new DocumentFragment();
    const text = i18n$('docblockedRedirectPrompt');
    const linkPlaceholder = '{{url}}';
    let pos = text.indexOf(linkPlaceholder);
    if ( pos !== -1 ) {
        const link = document.createElement('a');
        link.href = details.to;
        dom.cl.add(link, 'code');
        link.append(urlToFragment(details.to)); 
        fragment.append(
            text.slice(0, pos),
            link,
            text.slice(pos + linkPlaceholder.length)
        );
        qs$('#urlskip').append(fragment);
        dom.attr('#urlskip', 'hidden', null);
    }
}

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
        const li = dom.create('li');
        let span = dom.create('span');
        dom.text(span, name);
        li.appendChild(span);
        if ( name !== '' && value !== '' ) {
            li.appendChild(document.createTextNode(' = '));
        }
        span = dom.create('span');
        if ( reURL.test(value) ) {
            const a = dom.create('a');
            dom.attr(a, 'href', value);
            dom.text(a, value);
            span.appendChild(a);
        } else {
            dom.text(span, value);
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
                const ul = dom.create('ul');
                renderParams(ul, value, depth + 1);
                li.appendChild(ul);
            }
            parentNode.appendChild(li);
        }

        return true;
    };

    if ( renderParams(qs$('#parsed'), details.url) === false ) {
        return;
    }

    dom.cl.remove('#toggleParse', 'hidden');

    dom.on('#toggleParse', 'click', ( ) => {
        dom.cl.toggle('#theURL', 'collapsed');
        vAPI.localStorage.setItem(
            'document-blocked-expand-url',
            (dom.cl.has('#theURL', 'collapsed') === false).toString()
        );
    });

    vAPI.localStorage.getItemAsync('document-blocked-expand-url').then(value => {
        dom.cl.toggle('#theURL', 'collapsed', value !== 'true' && value !== true);
    });
})();

/******************************************************************************/

// https://www.reddit.com/r/uBlockOrigin/comments/breeux/close_this_window_doesnt_work_on_firefox/

if ( window.history.length > 1 ) {
    dom.on('#back', 'click', ( ) => {
        window.history.back();
    });
    qs$('#bye').style.display = 'none';
} else {
    dom.on('#bye', 'click', ( ) => {
        messaging.send('documentBlocked', {
            what: 'closeThisTab',
        });
    });
    qs$('#back').style.display = 'none';
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

dom.on('#disableWarning', 'change', ev => {
    const checked = ev.target.checked;
    dom.cl.toggle('[data-i18n="docblockedBack"]', 'disabled', checked);
    dom.cl.toggle('[data-i18n="docblockedClose"]', 'disabled', checked);
});

dom.on('#proceed', 'click', ( ) => {
    if ( qs$('#disableWarning').checked ) {
        proceedPermanent();
    } else {
        proceedTemporary();
    }
});

/******************************************************************************/

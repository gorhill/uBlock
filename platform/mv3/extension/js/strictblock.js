/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2024-present Raymond Hill

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
import { fetchJSON } from './fetch.js';
import { getEnabledRulesetsDetails } from './ruleset-manager.js';
import { i18n$ } from './i18n.js';
import { sendMessage } from './ext.js';
import { urlSkip } from './urlskip.js';

/******************************************************************************/

const rulesetDetailsPromise = getEnabledRulesetsDetails();

/******************************************************************************/

function urlToFragment(raw) {
    try {
        const fragment = new DocumentFragment();
        const url = new URL(raw);
        const hn = url.hostname;
        const i = raw.indexOf(hn);
        const b = document.createElement('b');
        b.append(hn);
        fragment.append(raw.slice(0,i), b, raw.slice(i+hn.length));
        return fragment;
    } catch {
    }
    return raw;
}

/******************************************************************************/

const toURL = new URL('about:blank');
const toFinalURL = new URL('about:blank');

try {
    toURL.href = self.location.hash.slice(1);
    toFinalURL.href = toURL.href;
} catch {
}

dom.clear('#theURL > p > span:first-of-type');
qs$('#theURL > p > span:first-of-type').append(urlToFragment(toURL.href));

/******************************************************************************/

async function proceed() {
    const permanent = qs$('#disableWarning').checked;
    // Do not exclude current hostname from strict-block ruleset if a urlskip
    // directive to another site is in effect.
    // TODO: what if the urlskip directive leads to a different subdomain on
    //       same site?
    if ( toFinalURL.hostname !== toURL.hostname && permanent !== true ) {
        return window.location.replace(toFinalURL.href);
    }
    await sendMessage({
        what: 'excludeFromStrictBlock',
        hostname: toURL.hostname,
        permanent,
    });
    window.location.replace(toURL.href);
}

/******************************************************************************/

function fragmentFromTemplate(template, placeholder, text, details) {
    const fragment = new DocumentFragment();
    const pos = template.indexOf(placeholder);
    if ( pos === -1 ) {
        fragment.append(template);
        return fragment;
    }
    const elem = document.createElement(details.tag);
    const { attributes } = details;
    if ( attributes ) {
        for ( let i = 0; i < attributes.length; i+= 2 ) {
            elem.setAttribute(attributes[i+0], attributes[i+1]);
        }
    }
    elem.append(text);
    fragment.append(
        template.slice(0, pos),
        elem,
        template.slice(pos + placeholder.length)
    );
    return fragment;
}

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/691
//   Parse URL to extract as much useful information as possible. This is
//   useful to assist the user in deciding whether to navigate to the web page.
(( ) => {
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
        } catch {
            return false;
        }

        const search = url.search.slice(1);
        if ( search === '' ) { return false; }

        url.search = '';
        const li = liFromParam(i18n$('strictblockNoParamsPrompt'), url.href);
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

    if ( renderParams(qs$('#parsed'), toURL.href) === false ) { return; }

    dom.cl.remove('#toggleParse', 'hidden');

    dom.on('#toggleParse', 'click', ( ) => {
        dom.cl.toggle('#theURL', 'collapsed');
    });
})();

/******************************************************************************/

// Find which list caused the blocking.
(async ( ) => {
    const rulesetDetails = await rulesetDetailsPromise;
    let iList = -1;
    const searchInList = async i => {
        if ( iList !== -1 ) { return; }
        const rules = await fetchJSON(`/rulesets/strictblock/${rulesetDetails[i].id}`);
        if ( iList !== -1 ) { return; }
        const toHref = toURL.href;
        for ( const rule of rules ) {
            const { regexFilter, requestDomains } = rule.condition;
            let matchesDomain = requestDomains === undefined;
            if ( requestDomains ) {
                let hn = toURL.hostname;
                for (;;) {
                    if ( requestDomains.includes(hn) ) {
                        matchesDomain = true;
                        break;
                    }
                    const pos = hn.indexOf('.');
                    if ( pos === -1 ) { break; }
                    hn = hn.slice(pos+1);
                }
                if ( matchesDomain === false ) { continue; }
            }
            const re = new RegExp(regexFilter);
            const matchesRegex = re.test(toHref);
            if ( matchesDomain && matchesRegex ) {
                iList = i;
            }
        }
    };
    const toFetch = [];
    for ( let i = 0; i < rulesetDetails.length; i++ ) {
        if ( rulesetDetails[i].rules.strictblock === 0 ) { continue; }
        toFetch.push(searchInList(i));
    }
    if ( toFetch.length === 0 ) { return; }
    await Promise.all(toFetch);
    if ( iList === -1 ) { return; }
    const fragment = fragmentFromTemplate(
        i18n$('strictblockReasonSentence1'),
        '{{listname}}', rulesetDetails[iList].name,
        { tag: 'q' }
    );
    qs$('#reason').append(fragment);
    dom.attr('#reason', 'hidden', null);
})();

/******************************************************************************/

// Offer to skip redirection whenever possible
(async ( ) => {
    const rulesetDetails = await rulesetDetailsPromise;
    const toFetch = [];
    for ( const details of rulesetDetails ) {
        if ( details.rules.urlskip === 0 ) { continue; }
        toFetch.push(fetchJSON(`/rulesets/urlskip/${details.id}`));
    }
    if ( toFetch.length === 0 ) { return; }
    const urlskipLists = await Promise.all(toFetch);
    const toHn = toURL.hostname;
    const matchesHn = hn => {
        if ( hn.endsWith(toHn) === false ) { return false; }
        if ( hn.length === toHn.length ) { return true; }
        return toHn.charAt(toHn.length - hn.length - 1) === '.';
    };
    for ( const urlskips of urlskipLists ) {
        for ( const urlskip of urlskips ) {
            const re = new RegExp(urlskip.re, urlskip.c ? undefined : 'i');
            if ( re.test(toURL.href) === false ) { continue; }
            if ( urlskip.hostnames ) {
                if ( urlskip.hostnames.some(hn => matchesHn(hn)) === false ) {
                    continue;
                }
            }
            const finalURL = urlSkip(toURL.href, false, urlskip.steps);
            if ( finalURL === undefined ) { continue; }
            toFinalURL.href = finalURL;
            const fragment = fragmentFromTemplate(
                i18n$('strictblockRedirectSentence1'),
                '{{url}}', urlToFragment(finalURL),
                { tag: 'a', attributes: [ 'href', finalURL, 'class', 'code' ] }
            );
            qs$('#urlskip').append(fragment);
            dom.attr('#urlskip', 'hidden', null);
            return;
        }
    }
})();

/******************************************************************************/

// https://www.reddit.com/r/uBlockOrigin/comments/breeux/
if ( window.history.length > 1 ) {
    dom.on('#back', 'click', ( ) => { window.history.back(); });
    qs$('#bye').style.display = 'none';
} else {
    dom.on('#bye', 'click', ( ) => { window.close(); });
    qs$('#back').style.display = 'none';
}

dom.on('#disableWarning', 'change', ev => {
    const checked = ev.target.checked;
    dom.cl.toggle('[data-i18n="strictblockBack"]', 'disabled', checked);
    dom.cl.toggle('[data-i18n="strictblockClose"]', 'disabled', checked);
});

dom.on('#proceed', 'click', ( ) => { proceed(); });

dom.cl.remove(dom.body, 'loading');

/******************************************************************************/

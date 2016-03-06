/*******************************************************************************

    uBlock - a browser extension to block requests.
    Copyright (C) 2015 Raymond Hill

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

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var messaging = vAPI.messaging;
var details = {};

(function() {
    var matches = /details=([^&]+)/.exec(window.location.search);
    if ( matches === null ) {
        return;
    }
    details = JSON.parse(atob(matches[1]));
})();

/******************************************************************************/

(function() {
    var onReponseReady = function(response) {
        if ( typeof response !== 'object' ) {
            return;
        }
        var lists;
        for ( var rawFilter in response ) {
            if ( response.hasOwnProperty(rawFilter) === false ) {
                continue;
            }
            lists = response[rawFilter];
            break;
        }
        
        if ( Array.isArray(lists) === false || lists.length === 0 ) {
            return;
        }
        var parent = uDom.nodeFromSelector('#whyex > span:nth-of-type(2)');
        var separator = '';
        var entry, url, node;
        for ( var i = 0; i < lists.length; i++ ) {
            entry = lists[i];
            if ( separator !== '' ) {
                parent.appendChild(document.createTextNode(separator));
            }
            url = entry.supportURL;
            if ( typeof url === 'string' && url !== '' ) {
                node = document.createElement('a');
                node.textContent = entry.title;
                node.setAttribute('href', url);
                node.setAttribute('target', '_blank');
            } else {
                node = document.createTextNode(entry.title);
            }
            parent.appendChild(node);
            separator = ' \u2022 ';
        }
        uDom.nodeFromId('whyex').style.removeProperty('display');
    };

    messaging.send(
        'documentBlocked',
        {
            what: 'listsFromNetFilter',
            compiledFilter: details.fc,
            rawFilter: details.fs
        },
        onReponseReady
    );
})();

/******************************************************************************/

var getTargetHostname = function() {
    var hostname = details.hn;
    var elem = document.querySelector('#proceed select');
    if ( elem !== null ) {
        hostname = elem.value;
    }
    return hostname;
};

/******************************************************************************/

var proceedToURL = function() {
    window.location.replace(details.url);
};

/******************************************************************************/

var proceedTemporary = function() {
    messaging.send(
        'documentBlocked',
        {
            what: 'temporarilyWhitelistDocument',
            hostname: getTargetHostname()
        },
        proceedToURL
    );
};

/******************************************************************************/

var proceedPermanent = function() {
    messaging.send(
        'documentBlocked',
        {
            what: 'toggleHostnameSwitch',
            name: 'no-strict-blocking',
            hostname: getTargetHostname(),
            deep: true,
            state: true
        },
        proceedToURL
    );
};

/******************************************************************************/

(function() {
    var matches = /^(.*)\{\{hostname\}\}(.*)$/.exec(vAPI.i18n('docblockedProceed'));
    if ( matches === null ) {
        return;
    }
    var proceed = uDom('#proceedTemplate').clone();
    proceed.descendants('span:nth-of-type(1)').text(matches[1]);
    proceed.descendants('span:nth-of-type(4)').text(matches[2]);

    if ( details.hn === details.dn ) {
        proceed.descendants('span:nth-of-type(2)').remove();
        proceed.descendants('.hn').text(details.hn);
    } else {
        proceed.descendants('span:nth-of-type(3)').remove();
        proceed.descendants('.hn').text(details.hn).attr('value', details.hn);
        proceed.descendants('.dn').text(details.dn).attr('value', details.dn);
    }

    uDom('#proceed').append(proceed);
})();

/******************************************************************************/

uDom.nodeFromSelector('#theURL > p').textContent = details.url;
uDom.nodeFromId('why').textContent = details.fs;

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/691
// Parse URL to extract as much useful information as possible. This is useful
// to assist the user in deciding whether to navigate to the web page.

(function() {
    if ( typeof URL !== 'function' ) {
        return;
    }

    var reURL = /^https?:\/\//;

    var liFromParam = function(name, value) {
        if ( value === '' ) {
            value = name;
            name = '';
        }
        var li = document.createElement('li');
        var span = document.createElement('span');
        span.textContent = name;
        li.appendChild(span);
        if ( name !== '' && value !== '' ) {
            li.appendChild(document.createTextNode(' = '));
        }
        span = document.createElement('span');
        if ( reURL.test(value) ) {
            var a = document.createElement('a');
            a.href = a.textContent = value;
            span.appendChild(a);
        } else {
            span.textContent = value;
        }
        li.appendChild(span);
        return li;
    };

    var safeDecodeURIComponent = function(s) {
        try {
            s = decodeURIComponent(s);
        } catch (ex) {
        }
        return s;
    };

    var renderParams = function(parentNode, rawURL) {
        var a = document.createElement('a');
        a.href = rawURL;
        if ( a.search.length === 0 ) {
            return false;
        }

        var pos = rawURL.indexOf('?');
        var li = liFromParam(
            vAPI.i18n('docblockedNoParamsPrompt'),
            rawURL.slice(0, pos)
        );
        parentNode.appendChild(li);

        var params = a.search.slice(1).split('&');
        var param, name, value, ul;
        for ( var i = 0; i < params.length; i++ ) {
            param = params[i];
            pos = param.indexOf('=');
            if ( pos === -1 ) {
                pos = param.length;
            }
            name = safeDecodeURIComponent(param.slice(0, pos));
            value = safeDecodeURIComponent(param.slice(pos + 1));
            li = liFromParam(name, value);
            if ( reURL.test(value) ) {
                ul = document.createElement('ul');
                renderParams(ul, value);
                li.appendChild(ul);
            }
            parentNode.appendChild(li);
        }
        return true;
    };

    if ( renderParams(uDom.nodeFromId('parsed'), details.url) === false ) {
        return;
    }

    var toggler = document.createElement('span');
    toggler.className = 'fa';
    uDom('#theURL > p').append(toggler);

    uDom(toggler).on('click', function() {
        var cl = uDom.nodeFromId('theURL').classList;
        cl.toggle('collapsed');
        vAPI.localStorage.setItem(
            'document-blocked-expand-url',
            (cl.contains('collapsed') === false).toString()
        );
    });

    uDom.nodeFromId('theURL').classList.toggle(
        'collapsed',
        vAPI.localStorage.getItem('document-blocked-expand-url') !== 'true'
    );
})();

/******************************************************************************/

if ( window.history.length > 1 ) {
    uDom('#back').on('click', function() { window.history.back(); });
    uDom('#bye').css('display', 'none');
} else {
    uDom('#bye').on('click', function() { window.close(); });
    uDom('#back').css('display', 'none');
}

uDom('#proceedTemporary').attr('href', details.url).on('click', proceedTemporary);
uDom('#proceedPermanent').attr('href', details.url).on('click', proceedPermanent);

/******************************************************************************/

})();

/******************************************************************************/

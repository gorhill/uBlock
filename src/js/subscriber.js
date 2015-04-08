/*******************************************************************************

    µBlock - a browser extension to block requests.
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

    Home: https://github.com/chrisaljoudi/uBlock
*/

/* global vAPI, HTMLDocument */

/******************************************************************************/

// Injected into specific web pages, those which have been pre-selected
// because they are known to contains `abp:subscribe` links.

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/464
if ( document instanceof HTMLDocument === false ) {
    //console.debug('contentscript-start.js > not a HTLMDocument');
    return;
}

// Because in case
if ( !vAPI ) {
    //console.debug('contentscript-start.js > vAPI not found');
    return;
}

/******************************************************************************/

// Only if at least one relevant link exists on the page
// The links look like this:
//   abp:subscribe?location=https://easylist-downloads.adblockplus.org/easyprivacy.txt[...]

if ( document.querySelector('a[href^="abp:"]') === null ) {
    return;
}

/******************************************************************************/

var messager = vAPI.messaging.channel('subscriber.js');

/******************************************************************************/

var onAbpLinkClicked = function(ev) {
    if ( ev.button !== 0 ) {
        return;
    }
    var target = ev.target;
    var limit = 3;
    var href = '';
    do {
        if ( target instanceof HTMLAnchorElement ) {
            href = target.href;
            break;
        }
        target = target.parentNode;
    } while ( target && --limit );
    if ( href === '' ) {
        return;
    }
    var matches = /^abp:\/*subscribe\/*\?location=([^&]+).*title=([^&]+)/.exec(href);
    if ( matches === null ) {
        return;
    }
    var location = decodeURIComponent(matches[1]);
    var title = decodeURIComponent(matches[2]);

    ev.stopPropagation();
    ev.preventDefault();

    var onListsSelectionDone = function() {
        messager.send({ what: 'reloadAllFilters' });
    };

    var onExternalListsSaved = function() {
        messager.send({
            what: 'selectFilterLists',
            switches: [ { location: location, off: false } ]
        }, onListsSelectionDone);
    };

    var onSubscriberDataReady = function(details) {
        var confirmStr = details.confirmStr
                            .replace('{{url}}', location)
                            .replace('{{title}}', title);
        if ( !window.confirm(confirmStr) ) {
            return;
        }

        // List already subscribed to?
        // https://github.com/chrisaljoudi/uBlock/issues/1033
        // Split on line separators, not whitespaces.
        var externalLists = details.externalLists.trim().split(/\s*[\n\r]+\s*/);
        if ( externalLists.indexOf(location) !== -1 ) {
            return;
        }

        externalLists.push(location);

        messager.send({
            what: 'userSettings',
            name: 'externalLists',
            value: externalLists.join('\n')
        }, onExternalListsSaved);
    };

    messager.send({ what: 'subscriberData' }, onSubscriberDataReady);
};

document.addEventListener('click', onAbpLinkClicked, true);

/******************************************************************************/

})();

/******************************************************************************/

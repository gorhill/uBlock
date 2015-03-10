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

    Home: https://github.com/gorhill/uBlock
*/

/* global vAPI, HTMLDocument */

/******************************************************************************/

// Injected into specific web pages, those which have been pre-selected
// because they are known to contains `abp:subscribe` links.

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/464
if ( document instanceof HTMLDocument === false ) {
    //console.debug('contentscript-start.js > not a HTLMDocument');
    return false;
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

if ( document.querySelector('[href^="abp:subscribe?"]') === null ) {
    return;
}

/******************************************************************************/

var messager = vAPI.messaging.channel('subscriber.js');

/******************************************************************************/

var onAbpLinkClicked = function(ev) {
    var receiver = ev.target;
    if ( receiver === null ) {
        return;
    }
    if ( receiver.tagName.toLowerCase() !== 'a' ) {
        return;
    }
    var href = receiver.getAttribute('href') || '';
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

    var onExternalListsSaved = function() {
        messager.send({
            what: 'reloadAllFilters',
            switches: [ { location: location, off: false } ],
            update: false
        });
    };

    var onSubscriberDataReady = function(details) {
        var confirmStr = details.confirmStr
                            .replace('{{url}}', location)
                            .replace('{{title}}', title);
        if ( !window.confirm(confirmStr) ) {
            return;
        }

        // List already subscribed to?
        var externalLists = details.externalLists.trim().split(/\s+/);
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

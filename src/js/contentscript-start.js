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

/* jshint multistr: true */
/* global vAPI */

/******************************************************************************/

// Injected into content pages

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

// https://github.com/gorhill/uBlock/issues/456
// Already injected?
if ( vAPI.contentscriptStartInjected ) {
    //console.debug('contentscript-start.js > content script already injected');
    return;
}
vAPI.contentscriptStartInjected = true;

/******************************************************************************/

var localMessager = vAPI.messaging.channel('contentscript-start.js');

/******************************************************************************/
/******************************************************************************/

// Domain-based ABP cosmetic filters.
// These can be inserted before the DOM is loaded.

var cosmeticFilters = function(details) {
    var donthideCosmeticFilters = {};
    var hideCosmeticFilters = {};
    var style = document.createElement('style');
    style.setAttribute('id', 'ublock-preload-1ae7a5f130fc79b4fdb8a4272d9426b5');
    var donthide = details.cosmeticDonthide;
    var hide = details.cosmeticHide;
    if ( donthide.length !== 0 ) {
        donthide = donthide.length !== 1 ? donthide.join(',\n') : donthide[0];
        donthide = donthide.split(',\n');
        var i = donthide.length;
        while ( i-- ) {
            donthideCosmeticFilters[donthide[i]] = true;
        }
        // https://github.com/gorhill/uBlock/issues/143
        if ( hide.length !== 0 ) {
            hide = hide.length !== 1 ? hide.join(',\n') : hide[0];
            hide = hide.split(',\n');
            i = hide.length;
            var selector;
            while ( i-- ) {
                selector = hide[i];
                if ( donthideCosmeticFilters[selector] ) {
                    hide.splice(i, 1);
                } else {
                    hideCosmeticFilters[selector] = true;
                }
            }
        }
    }
    if ( hide.length !== 0 ) {
        var text = hide.join(',\n');
        hideElements(text);
        // The linefeed before the style block is very important: do not remove!
        style.appendChild(document.createTextNode(text + '\n{display:none !important;}'));
        //console.debug('µBlock> "%s" cosmetic filters: injecting %d CSS rules:', details.domain, details.hide.length, hideStyleText);
    }
    var parent = document.head || document.documentElement;
    if ( parent ) {
        parent.appendChild(style);
    }
    vAPI.donthideCosmeticFilters = donthideCosmeticFilters;
    vAPI.hideCosmeticFilters = hideCosmeticFilters;
};

var netFilters = function(details) {
    var parent = document.head || document.documentElement;
    if ( !parent ) {
        return;
    }
    var style = document.createElement('style');
    style.setAttribute('class', 'ublock-preload-1ae7a5f130fc79b4fdb8a4272d9426b5');
    var text = details.netHide.join(',\n');
    var css = details.netCollapse ?
        '\n{display:none !important;}' :
        '\n{visibility:hidden !important;}';
    style.appendChild(document.createTextNode(text + css));
    parent.appendChild(style);
    //console.debug('document.querySelectorAll("%s") = %o', text, document.querySelectorAll(text));
};

var filteringHandler = function(details) {
    vAPI.skipCosmeticFiltering = !details || details.skipCosmeticFiltering;
    if ( details ) {
        if ( details.cosmeticHide.length !== 0 || details.cosmeticDonthide.length !== 0 ) {
            cosmeticFilters(details);
        }
        if ( details.netHide.length !== 0 ) {
            netFilters(details);
        }
        // The port will never be used again at this point, disconnecting allows
        // the browser to flush this script from memory.
    }

    // https://github.com/gorhill/uBlock/issues/587
    // If no filters were found, maybe the script was injected before uBlock's
    // process was fully initialized. When this happens, pages won't be 
    // cleaned right after browser launch.
    vAPI.contentscriptStartInjected = details && details.ready;

    // Cleanup before leaving
    localMessager.close();
};

var hideElements = function(selectors) {
    if ( document.body === null ) {
        return;
    }
    // https://github.com/gorhill/uBlock/issues/158
    // Using CSSStyleDeclaration.setProperty is more reliable
    var elems = document.querySelectorAll(selectors);
    var i = elems.length;
    while ( i-- ) {
        elems[i].style.setProperty('display', 'none', 'important');
    }
};

localMessager.send(
    {
        what: 'retrieveDomainCosmeticSelectors',
        pageURL: window.location.href,
        locationURL: window.location.href
    },
    filteringHandler
);

/******************************************************************************/
/******************************************************************************/

})();

/******************************************************************************/

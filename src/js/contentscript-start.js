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

/* jshint multistr: true */

/******************************************************************************/

// Injected into content pages

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

// This can happen
if ( typeof vAPI !== 'object' ) {
    return;
}

// https://github.com/chrisaljoudi/uBlock/issues/456
// Already injected?
if ( vAPI.contentscriptStartInjected ) {
    return;
}
vAPI.contentscriptStartInjected = true;
vAPI.styles = vAPI.styles || [];

/******************************************************************************/
/******************************************************************************/

// Domain-based ABP cosmetic filters.
// These can be inserted before the DOM is loaded.

var cosmeticFilters = function(details) {
    var donthideCosmeticFilters = {};
    var hideCosmeticFilters = {};
    var donthide = details.cosmeticDonthide;
    var hide = details.cosmeticHide;
    var i;
    if ( donthide.length !== 0 ) {
        i = donthide.length;
        while ( i-- ) {
            donthideCosmeticFilters[donthide[i]] = true;
        }
    }
    // https://github.com/chrisaljoudi/uBlock/issues/143
    if ( hide.length !== 0 ) {
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
    if ( hide.length !== 0 ) {
        // https://github.com/gorhill/uBlock/issues/1015
        // Boost specificity of our CSS rules.
        var styleText = ':root ' + hide.join(',\n:root ');
        var style = document.createElement('style');
        style.setAttribute('type', 'text/css');
        // The linefeed before the style block is very important: do not remove!
        style.appendChild(document.createTextNode(styleText + '\n{display:none !important;}'));
        //console.debug('µBlock> "%s" cosmetic filters: injecting %d CSS rules:', details.domain, details.hide.length, hideStyleText);
        var parent = document.head || document.documentElement;
        if ( parent ) {
            parent.appendChild(style);
            vAPI.styles.push(style);
        }
        hideElements(styleText);
    }
    vAPI.donthideCosmeticFilters = donthideCosmeticFilters;
    vAPI.hideCosmeticFilters = hideCosmeticFilters;
};

/******************************************************************************/

var netFilters = function(details) {
    var parent = document.head || document.documentElement;
    if ( !parent ) {
        return;
    }
    var style = document.createElement('style');
    var text = details.netHide.join(',\n');
    var css = details.netCollapse ?
        '\n{display:none !important;}' :
        '\n{visibility:hidden !important;}';
    style.appendChild(document.createTextNode(text + css));
    parent.appendChild(style);
    //console.debug('document.querySelectorAll("%s") = %o', text, document.querySelectorAll(text));
};

/******************************************************************************/

// Create script tags and assign data URIs looked up from our library of
// redirection resources: Sometimes it is useful to use these resources as
// standalone scriptlets. These scriptlets are injected from within the
// content scripts because what must be injected, if anything, depends on the
// currently active filters, as selected by the user.
// Library of redirection resources is located at:
// https://github.com/gorhill/uBlock/blob/master/assets/ublock/resources.txt

var injectScripts = function(scripts) {
    var parent = document.head || document.documentElement;
    if ( !parent ) {
        return;
    }
    var scriptTag = document.createElement('script');
    scriptTag.appendChild(document.createTextNode(scripts));
    parent.appendChild(scriptTag);
    vAPI.injectedScripts = scripts;
};

/******************************************************************************/

var filteringHandler = function(details) {
    var styleTagCount = vAPI.styles.length;

    if ( details ) {
        if (
            (vAPI.skipCosmeticFiltering = details.skipCosmeticFiltering) !== true &&
            (details.cosmeticHide.length !== 0 || details.cosmeticDonthide.length !== 0)
        ) {
            cosmeticFilters(details);
        }
        if ( details.netHide.length !== 0 ) {
            netFilters(details);
        }
        if ( details.scripts ) {
            injectScripts(details.scripts);
        }
        // The port will never be used again at this point, disconnecting allows
        // the browser to flush this script from memory.
    }

    // This is just to inform the background process that cosmetic filters were
    // actually injected.
    if ( vAPI.styles.length !== styleTagCount ) {
        vAPI.messaging.send('contentscript', { what: 'cosmeticFiltersActivated' });
    }

    // https://github.com/chrisaljoudi/uBlock/issues/587
    // If no filters were found, maybe the script was injected before uBlock's
    // process was fully initialized. When this happens, pages won't be
    // cleaned right after browser launch.
    vAPI.contentscriptStartInjected = details && details.ready;
};

/******************************************************************************/

var hideElements = function(selectors) {
    if ( document.body === null ) {
        return;
    }
    var elems = document.querySelectorAll(selectors);
    var i = elems.length;
    if ( i === 0 ) {
        return;
    }
    // https://github.com/chrisaljoudi/uBlock/issues/158
    // Using CSSStyleDeclaration.setProperty is more reliable
    if ( document.body.shadowRoot === undefined ) {
        while ( i-- ) {
            elems[i].style.setProperty('display', 'none', 'important');
        }
        return;
    }
    // https://github.com/gorhill/uBlock/issues/435
    // Using shadow content so that we do not have to modify style
    // attribute.
    var sessionId = vAPI.sessionId;
    var elem, shadow;
    while ( i-- ) {
        elem = elems[i];
        shadow = elem.shadowRoot;
        // https://www.chromestatus.com/features/4668884095336448
        // "Multiple shadow roots is being deprecated."
        if ( shadow !== null ) {
            if ( shadow.className !== sessionId ) {
                elem.style.setProperty('display', 'none', 'important');
            }
            continue;
        }
        // https://github.com/gorhill/uBlock/pull/555
        // Not all nodes can be shadowed:
        //   https://github.com/w3c/webcomponents/issues/102
        // https://github.com/gorhill/uBlock/issues/762
        // Remove display style that might get in the way of the shadow
        // node doing its magic.
        try {
            shadow = elem.createShadowRoot();
            shadow.className = sessionId;
            elem.style.removeProperty('display');
        } catch (ex) {
            elem.style.setProperty('display', 'none', 'important');
        }
    }
};

/******************************************************************************/

var url = window.location.href;
vAPI.messaging.send(
    'contentscript',
    {
        what: 'retrieveDomainCosmeticSelectors',
        pageURL: url,
        locationURL: url
    },
    filteringHandler
);

/******************************************************************************/
/******************************************************************************/

})();

/******************************************************************************/

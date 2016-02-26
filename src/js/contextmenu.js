/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2015 Raymond Hill

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

/******************************************************************************/

µBlock.contextMenu = (function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

/******************************************************************************/

var onBlockElement = function(details, tab) {
    if ( tab === undefined ) {
        return;
    }
    if ( /^https?:\/\//.test(tab.url) === false ) {
        return;
    }
    var tagName = details.tagName || '';
    var src = details.frameUrl || details.srcUrl || details.linkUrl || '';

    if ( !tagName ) {
        if ( typeof details.frameUrl === 'string' ) {
            tagName = 'iframe';
        } else if ( typeof details.srcUrl === 'string' ) {
            if ( details.mediaType === 'image' ) {
                tagName = 'img';
            } else if ( details.mediaType === 'video' ) {
                tagName = 'video';
            } else if ( details.mediaType === 'audio' ) {
                tagName = 'audio';
            }
        } else if ( typeof details.linkUrl === 'string' ) {
            tagName = 'a';
        }
    }

    µb.elementPickerExec(tab.id, tagName + '\t' + src);
};

/******************************************************************************/

var onTemporarilyAllowLargeMediaElements = function(details, tab) {
    if ( tab === undefined ) {
        return;
    }
    var pageStore = µb.pageStoreFromTabId(tab.id);
    if ( pageStore === null ) {
        return;
    }
    pageStore.temporarilyAllowLargeMediaElements();
};

/******************************************************************************/

var onEntryClicked = function(details, tab) {
    if ( details.menuItemId === 'uBlock0-blockElement' ) {
        return onBlockElement(details, tab);
    }
    if ( details.menuItemId === 'uBlock0-temporarilyAllowLargeMediaElements' ) {
        return onTemporarilyAllowLargeMediaElements(details, tab);
    }
};

/******************************************************************************/

var menuEntries = [
    {
        id: 'uBlock0-blockElement',
        title: vAPI.i18n('pickerContextMenuEntry'),
        contexts: ['all'],
        documentUrlPatterns: ['https://*/*', 'http://*/*']
    },
    {
        id: 'uBlock0-temporarilyAllowLargeMediaElements',
        title: vAPI.i18n('contextMenuTemporarilyAllowLargeMediaElements'),
        contexts: ['all'],
        documentUrlPatterns: ['https://*/*', 'http://*/*']
    }
];

/******************************************************************************/

var update = function(tabId) {
    var newBits = 0;
    if ( µb.userSettings.contextMenuEnabled && tabId !== null ) {
        var pageStore = µb.pageStoreFromTabId(tabId);
        if ( pageStore ) {
            newBits |= 0x01;
            if ( pageStore.largeMediaCount !== 0 ) {
                newBits |= 0x02;
            }
        }
    }
    if ( newBits === currentBits ) {
        return;
    }
    currentBits = newBits;
    var usedEntries = [];
    if ( newBits & 0x01 ) {
        usedEntries.push(menuEntries[0]);
    }
    if ( newBits & 0x02 ) {
        usedEntries.push(menuEntries[1]);
    }
    vAPI.contextMenu.setEntries(usedEntries, onEntryClicked);
};

var currentBits = 0;

vAPI.contextMenu.onMustUpdate = update;

/******************************************************************************/

return {
    update: function(tabId) {
        if ( µb.userSettings.contextMenuEnabled && tabId === undefined ) {
            vAPI.tabs.get(null, function(tab) {
                if ( tab ) {
                    update(tab.id);
                }
            });
            return;
        }
        update(tabId);
    }
};

/******************************************************************************/

})();

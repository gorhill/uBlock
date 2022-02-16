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

import µb from './background.js';

/******************************************************************************/

const contextMenu = (( ) => {

/******************************************************************************/

if ( vAPI.contextMenu === undefined ) {
    return {
        update: function() {}
    };
}

/******************************************************************************/

const onBlockElement = function(details, tab) {
    if ( tab === undefined ) { return; }
    if ( /^https?:\/\//.test(tab.url) === false ) { return; }
    let tagName = details.tagName || '';
    let src = details.frameUrl || details.srcUrl || details.linkUrl || '';

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

    µb.epickerArgs.mouse = true;
    µb.elementPickerExec(tab.id, 0, `${tagName}\t${src}`);
};

/******************************************************************************/

const onBlockElementInFrame = function(details, tab) {
    if ( tab === undefined ) { return; }
    if ( /^https?:\/\//.test(details.frameUrl) === false ) { return; }
    µb.epickerArgs.mouse = false;
    µb.elementPickerExec(tab.id, details.frameId);
};

/******************************************************************************/

const onSubscribeToList = function(details) {
    let parsedURL;
    try {
        parsedURL = new URL(details.linkUrl);
    }
    catch(ex) {
    }
    if ( parsedURL instanceof URL === false ) { return; }
    const url = parsedURL.searchParams.get('location');
    if ( url === null ) { return; }
    const title = parsedURL.searchParams.get('title') || '?';
    const hash = µb.selectedFilterLists.indexOf(parsedURL) !== -1
        ? '#subscribed'
        : '';
    vAPI.tabs.open({
        url:
            `/asset-viewer.html` +
            `?url=${encodeURIComponent(url)}` +
            `&title=${encodeURIComponent(title)}` + 
            `&subscribe=1${hash}`,
        select: true,
    });
};

/******************************************************************************/

const onTemporarilyAllowLargeMediaElements = function(details, tab) {
    if ( tab === undefined ) { return; }
    const pageStore = µb.pageStoreFromTabId(tab.id);
    if ( pageStore === null ) { return; }
    pageStore.temporarilyAllowLargeMediaElements(true);
};

/******************************************************************************/

const onEntryClicked = function(details, tab) {
    if ( details.menuItemId === 'uBlock0-blockElement' ) {
        return onBlockElement(details, tab);
    }
    if ( details.menuItemId === 'uBlock0-blockElementInFrame' ) {
        return onBlockElementInFrame(details, tab);
    }
    if ( details.menuItemId === 'uBlock0-blockResource' ) {
        return onBlockElement(details, tab);
    }
    if ( details.menuItemId === 'uBlock0-subscribeToList' ) {
        return onSubscribeToList(details);
    }
    if ( details.menuItemId === 'uBlock0-temporarilyAllowLargeMediaElements' ) {
        return onTemporarilyAllowLargeMediaElements(details, tab);
    }
};

/******************************************************************************/

const menuEntries = {
    blockElement: {
        id: 'uBlock0-blockElement',
        title: vAPI.i18n('pickerContextMenuEntry'),
        contexts: [ 'all' ],
    },
    blockElementInFrame: {
        id: 'uBlock0-blockElementInFrame',
        title: vAPI.i18n('contextMenuBlockElementInFrame'),
        contexts: [ 'frame' ],
    },
    blockResource: {
        id: 'uBlock0-blockResource',
        title: vAPI.i18n('pickerContextMenuEntry'),
        contexts: [ 'audio', 'frame', 'image', 'video' ],
    },
    subscribeToList: {
        id: 'uBlock0-subscribeToList',
        title: vAPI.i18n('contextMenuSubscribeToList'),
        contexts: [ 'link' ],
        targetUrlPatterns: [ 'abp:*', 'https://subscribe.adblockplus.org/*' ],
    },
    temporarilyAllowLargeMediaElements: {
        id: 'uBlock0-temporarilyAllowLargeMediaElements',
        title: vAPI.i18n('contextMenuTemporarilyAllowLargeMediaElements'),
        contexts: [ 'all' ],
    }
};

/******************************************************************************/

let currentBits = 0;

const update = function(tabId = undefined) {
    let newBits = 0;
    if ( µb.userSettings.contextMenuEnabled && tabId !== undefined ) {
        const pageStore = µb.pageStoreFromTabId(tabId);
        if ( pageStore && pageStore.getNetFilteringSwitch() ) {
            if ( pageStore.shouldApplySpecificCosmeticFilters(0) ) {
                newBits |= 0b0001;
            } else {
                newBits |= 0b0010;
            }
            if ( pageStore.largeMediaCount !== 0 ) {
                newBits |= 0b0100;
            }
        }
        newBits |= 0b1000;
    }
    if ( newBits === currentBits ) { return; }
    currentBits = newBits;
    const usedEntries = [];
    if ( newBits & 0b0001 ) {
        usedEntries.push(menuEntries.blockElement);
        usedEntries.push(menuEntries.blockElementInFrame);
    }
    if ( newBits & 0b0010 ) {
        usedEntries.push(menuEntries.blockResource);
    }
    if ( newBits & 0b0100 ) {
        usedEntries.push(menuEntries.temporarilyAllowLargeMediaElements);
    }
    if ( newBits & 0b1000 ) {
        usedEntries.push(menuEntries.subscribeToList);
    }
    vAPI.contextMenu.setEntries(usedEntries, onEntryClicked);
};

/******************************************************************************/

// https://github.com/uBlockOrigin/uBlock-issues/issues/151
//   For unknown reasons, the currently active tab will not be successfully
//   looked up after closing a window.

vAPI.contextMenu.onMustUpdate = async function(tabId = undefined) {
    if ( µb.userSettings.contextMenuEnabled === false ) {
        return update();
    }
    if ( tabId !== undefined ) {
        return update(tabId);
    }
    const tab = await vAPI.tabs.getCurrent();
    if ( tab instanceof Object === false ) { return; }
    update(tab.id);
};

return { update: vAPI.contextMenu.onMustUpdate };

/******************************************************************************/

})();

/******************************************************************************/

export default contextMenu;

/******************************************************************************/

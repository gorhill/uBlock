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

/* global chrome, messaging, uDom */

/******************************************************************************/

uDom.onLoad(function() {

/******************************************************************************/

var updateList = {};
var assetListSwitches = ['o', 'o', 'o'];
var commitHistoryURLPrefix = 'https://github.com/gorhill/ublock/commits/master/';

/******************************************************************************/

var setAssetListClassBit = function(bit, state) {
    assetListSwitches[assetListSwitches.length-1-bit] = !state ? 'o' : 'x';
    uDom('#assetList')
        .removeClass()
        .addClass(assetListSwitches.join(''));
};

/******************************************************************************/

var renderAssetList = function(details) {
    var dirty = false;
    var paths = Object.keys(details.list).sort();
    if ( paths.length > 0 ) {
        uDom('#assetList .assetEntry').remove();
        var i = 0;
        var path, status, html = [];
        while ( path = paths[i++] ) {
            status = details.list[path].status;
            dirty = dirty || status !== 'Unchanged';
            html.push(
                '<tr class="assetEntry ' + status.toLowerCase().replace(/ +/g, '-') + '">',
                '<td>',
                '<a href="' + commitHistoryURLPrefix + path + '">',
                path.replace(/^(assets\/[^/]+\/)(.+)$/, '$1<b>$2</b>'),
                '</a>',
                '<td>',
                chrome.i18n.getMessage('aboutAssetsUpdateStatus' + status)
            );
        }
        uDom('#assetList table tBody').append(html.join(''));
        uDom('#assetList a').attr('target', '_blank');
        updateList = details.list;
    }
    setAssetListClassBit(0, paths.length !== 0);
    setAssetListClassBit(1, dirty);
    setAssetListClassBit(2, false);
};

/******************************************************************************/

var updateAssets = function() {
    setAssetListClassBit(2, true);
    var onDone = function(details) {
        if ( details.changedCount !== 0 ) {
            messaging.tell({ what: 'loadUpdatableAssets' });
        }
    };
    messaging.ask({ what: 'launchAssetUpdater', list: updateList }, onDone);
};

/******************************************************************************/

var updateAssetsList = function() {
    messaging.ask({ what: 'getAssetUpdaterList' }, renderAssetList);
};

/******************************************************************************/

// Updating all assets could be done from elsewhere and if so the
// list here needs to be updated.

var onAnnounce = function(msg) {
    switch ( msg.what ) {
        case 'allLocalAssetsUpdated':
            updateAssetsList();
            break;

        default:
            break;
    }
};

messaging.start('about.js');
messaging.listen(onAnnounce);

/******************************************************************************/

uDom('#aboutVersion').html(chrome.runtime.getManifest().version);
uDom('#aboutAssetsUpdateButton').on('click', updateAssets);

/******************************************************************************/

updateAssetsList();

/******************************************************************************/

});

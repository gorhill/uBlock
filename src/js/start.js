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

/* global µBlock */
'use strict';

/******************************************************************************/

// Automatic update of non-user assets
// https://github.com/gorhill/httpswitchboard/issues/334

µBlock.updater = (function() {

/******************************************************************************/

var µb = µBlock;

var jobCallback = function() {
    // Simpler to fire restart here, and safe given how far this will happen
    // in the future.
    restart();

    // If auto-update is disabled, check again in a while.
    if ( µb.userSettings.autoUpdate !== true ) {
        return;
    }

    var onMetadataReady = function(metadata) {
        // Check PSL
        var mdEntry = metadata[µb.pslPath];
        if ( mdEntry.repoObsolete ) {
            // console.log('µBlock.updater> updating all updatable assets');
            µb.loadUpdatableAssets({ update: true });
            return;
        }
        // Check used filter lists
        var lists = µb.remoteBlacklists;
        for ( var path in lists ) {
            if ( lists.hasOwnProperty(path) === false ) {
                continue;
            }
            if ( lists[path].off ) {
                continue;
            }
            if ( metadata.hasOwnProperty(path) === false ) {
                continue;
            }
            mdEntry = metadata[path];
            if ( mdEntry.cacheObsolete || mdEntry.repoObsolete ) {
                // console.log('µBlock.updater> updating only filter lists');
                µb.loadUpdatableAssets({ update: true, psl: false });
                return;
            }
        }

        // console.log('µBlock.updater> all is up to date');
    };

    µb.assets.metadata(onMetadataReady);
};

// https://www.youtube.com/watch?v=cIrGQD84F1g

/******************************************************************************/

var restart = function(after) {
    if ( after === undefined ) {
        after = µb.nextUpdateAfter;
    }

    µb.asyncJobs.add(
        'autoUpdateAssets',
        null,
        jobCallback,
        after,
        false
    );
};

/******************************************************************************/

return {
    restart: restart
};

/******************************************************************************/

})();

/******************************************************************************/

// Load everything

µBlock.load();

/******************************************************************************/

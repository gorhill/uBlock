/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2017 Raymond Hill

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

// For background page

'use strict';

/******************************************************************************/

(function() {
    let µb = µBlock;
    let migratedKeys = new Set();
    let reCacheStorageKeys = /^(?:assetCacheRegistry|assetSourceRegistry|cache\/.+|selfie)$/;

    let migrateAll = function(callback) {
        let migrateKeyValue = function(details, callback) {
            // https://github.com/gorhill/uBlock/issues/2653
            // Be ready to deal graciously with corrupted DB.
            if ( migratedKeys.has(details.key) ) {
                callback();
                return;
            }
            migratedKeys.add(details.key);
            let bin = {};
            bin[details.key] = JSON.parse(details.value);
            if ( reCacheStorageKeys.test(details.key) ) {
                vAPI.cacheStorage.set(bin, callback);
            } else {
                vAPI.storage.set(bin, callback);
            }
        };

        let migrateNext = function() {
            self.browser.runtime.sendMessage({ what: 'webext:storageMigrateNext' }, response => {
                if ( response.key === undefined ) {
                    if ( migratedKeys.size !== 0 ) {
                        self.browser.runtime.reload();
                    } else {
                        callback();
                    }
                    return;
                }
                migrateKeyValue(response, migrateNext);
            });
        };

        self.browser.storage.local.get('legacyStorageMigrated', bin => {
            if ( bin && bin.legacyStorageMigrated ) {
                self.browser.runtime.sendMessage({ what: 'webext:storageMigrateDone' });
                return callback();
            }
            vAPI.storage.set({ legacyStorageMigrated: true });
            migrateNext();
        });
    };

    µb.onBeforeStartQueue.push(migrateAll);
})();

/******************************************************************************/

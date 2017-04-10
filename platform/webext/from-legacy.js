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

    let migrateAll = function(callback) {
        let mustRestart = false;

        let migrateKeyValue = function(details, callback) {
            let bin = {};
            bin[details.key] = JSON.parse(details.value);
            self.browser.storage.local.set(bin, callback);
            mustRestart = true;
        };

        let migrateNext = function() {
            self.browser.runtime.sendMessage({ what: 'webext:storageMigrateNext' }, response => {
                if ( response.key === undefined ) {
                    if ( mustRestart ) {
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
            self.browser.storage.local.set({ legacyStorageMigrated: true });
            migrateNext();
        });
    };

    µb.onBeforeStartQueue.push(migrateAll);
})();

/******************************************************************************/

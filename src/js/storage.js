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

/* global µBlock, punycode, publicSuffixList */
'use strict';

/******************************************************************************/

µBlock.getBytesInUse = function() {
    var getBytesInUseHandler = function(bytesInUse) {
        µBlock.storageUsed = bytesInUse;
    };
    vAPI.storage.getBytesInUse(null, getBytesInUseHandler);
};

/******************************************************************************/

µBlock.saveLocalSettings = function(callback) {
    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }
    vAPI.storage.set(this.localSettings, callback);
};

/******************************************************************************/

µBlock.loadLocalSettings = function() {
    var settingsLoaded = function(store) {
        µBlock.localSettings = store;
    };

    vAPI.storage.get(this.localSettings, settingsLoaded);
};

/******************************************************************************/

// Save local settings regularly. Not critical.

µBlock.asyncJobs.add(
    'autoSaveLocalSettings',
    null,
    µBlock.saveLocalSettings.bind(µBlock),
    2 * 60 * 1000,
    true
);

/******************************************************************************/

µBlock.saveUserSettings = function() {
    vAPI.storage.set(this.userSettings, function() {
        µBlock.getBytesInUse();
    });
};

/******************************************************************************/

µBlock.loadUserSettings = function(callback) {
    var settingsLoaded = function(store) {
        µBlock.userSettings = store;
        if ( typeof callback === 'function' ) {
            callback(store);
        }
    };

    vAPI.storage.get(this.userSettings, settingsLoaded);
};

/******************************************************************************/

µBlock.saveWhitelist = function() {
    var bin = {
        'netWhitelist': this.stringFromWhitelist(this.netWhitelist)
    };
    vAPI.storage.set(bin, function() {
        µBlock.getBytesInUse();
    });
    this.netWhitelistModifyTime = Date.now();
};

/******************************************************************************/

µBlock.loadWhitelist = function(callback) {
    var onWhitelistLoaded = function(store) {
        var µb = µBlock;
        // Backward compatibility after fix to #5
        // TODO: remove once all users are up to date with latest version.
        if ( store.netExceptionList ) {
            if ( store.netWhitelist === '' ) {
                store.netWhitelist = Object.keys(store.netExceptionList).join('\n');
                if ( store.netWhitelist !== '' ) {
                    vAPI.storage.set({ 'netWhitelist': store.netWhitelist });
                }
            }
            vAPI.storage.remove('netExceptionList');
        }
        µb.netWhitelist = µb.whitelistFromString(store.netWhitelist);
        µb.netWhitelistModifyTime = Date.now();

        if ( typeof callback === 'function' ) {
            callback();
        }
    };

    var bin = {
        'netWhitelist': '',
        'netExceptionList': ''
    };
    vAPI.storage.get(bin, onWhitelistLoaded);
};

/******************************************************************************/

µBlock.saveUserFilters = function(content, callback) {
    return this.assets.put(this.userFiltersPath, content, callback);
};

/******************************************************************************/

µBlock.loadUserFilters = function(callback) {
    return this.assets.get(this.userFiltersPath, callback);
};

/******************************************************************************/

µBlock.appendUserFilters = function(content) {
    var µb = this;

    var onSaved = function(details) {
        if ( details.error ) {
            return;
        }
        µb.mergeFilterText(content);
        µb.netFilteringEngine.freeze();
        µb.cosmeticFilteringEngine.freeze();
        µb.destroySelfie();
        µb.toSelfieAsync();
    };

    var onLoaded = function(details) {
        if ( details.error ) {
            return;
        }
        if ( details.content.indexOf(content.trim()) !== -1 ) {
            return;
        }
        µb.saveUserFilters(details.content + '\n' + content, onSaved);
    };

    if ( content.length > 0 ) {
        this.loadUserFilters(onLoaded);
    }
};

/******************************************************************************/

µBlock.getAvailableLists = function(callback) {
    var availableLists = {};
    var redirections = {};

    // selected lists
    var onSelectedListsLoaded = function(store) {
        var µb = µBlock;
        var lists = store.remoteBlacklists;
        var locations = Object.keys(lists);
        var oldLocation, newLocation;
        var availableEntry, storedEntry;

        while ( oldLocation = locations.pop() ) {
            newLocation = redirections[oldLocation] || oldLocation;
            availableEntry = availableLists[newLocation];
            if ( availableEntry === undefined ) {
                continue;
            }
            storedEntry = lists[oldLocation];
            availableEntry.off = storedEntry.off || false;
            µb.assets.setHomeURL(newLocation, availableEntry.homeURL);
            if ( storedEntry.entryCount !== undefined ) {
                availableEntry.entryCount = storedEntry.entryCount;
            }
            if ( storedEntry.entryUsedCount !== undefined ) {
                availableEntry.entryUsedCount = storedEntry.entryUsedCount;
            }
            // This may happen if the list name was pulled from the list content
            if ( availableEntry.title === '' && storedEntry.title !== '' ) {
                availableEntry.title = storedEntry.title;
            }
        }
        callback(availableLists);
    };

    // built-in lists
    var onBuiltinListsLoaded = function(details) {
        var location, locations;
        try {
            locations = JSON.parse(details.content);
        } catch (e) {
            locations = {};
        }
        var entry;
        for ( location in locations ) {
            if ( locations.hasOwnProperty(location) === false ) {
                continue;
            }
            entry = locations[location];
            availableLists['assets/thirdparties/' + location] = entry;
            if ( entry.old !== undefined ) {
                redirections[entry.old] = location;
                delete entry.old;
            }
        }

        // Now get user's selection of lists
        vAPI.storage.get(
            { 'remoteBlacklists': availableLists },
            onSelectedListsLoaded
        );
    };

    // permanent lists
    var location;
    var lists = this.permanentLists;
    for ( location in lists ) {
        if ( lists.hasOwnProperty(location) === false ) {
            continue;
        }
        availableLists[location] = lists[location];
    }

    // custom lists
    var c;
    var locations = this.userSettings.externalLists.split('\n');
    for ( var i = 0; i < locations.length; i++ ) {
        location = locations[i].trim();
        c = location.charAt(0);
        if ( location === '' || c === '!' || c === '#' ) {
            continue;
        }
        // Coarse validation
        if ( /[^0-9A-Za-z!*'();:@&=+$,\/?%#\[\]_.~-]/.test(location) ) {
            continue;
        }
        availableLists[location] = {
            title: '',
            group: 'custom',
            external: true
        };
    }

    // get built-in block lists.
    this.assets.get('assets/ublock/filter-lists.json', onBuiltinListsLoaded);
};

/******************************************************************************/

µBlock.loadFilterLists = function(callback) {
    var µb = this;
    var blacklistLoadCount;

    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }

    var loadBlacklistsEnd = function() {
        µb.netFilteringEngine.freeze();
        µb.cosmeticFilteringEngine.freeze();
        vAPI.storage.set({ 'remoteBlacklists': µb.remoteBlacklists });
        vAPI.messaging.broadcast({ what: 'loadUbiquitousBlacklistCompleted' });
        µb.toSelfieAsync();
        callback();
    };

    var mergeBlacklist = function(details) {
        µb.mergeFilterList(details);
        blacklistLoadCount -= 1;
        if ( blacklistLoadCount === 0 ) {
            loadBlacklistsEnd();
        }
    };

    var loadBlacklistsStart = function(lists) {
        µb.remoteBlacklists = lists;
        µb.netFilteringEngine.reset();
        µb.cosmeticFilteringEngine.reset();
        µb.destroySelfie();
        var locations = Object.keys(lists);
        blacklistLoadCount = locations.length;
        if ( blacklistLoadCount === 0 ) {
            loadBlacklistsEnd();
            return;
        }

        // Load each preset blacklist which is not disabled.
        var location;
        while ( location = locations.pop() ) {
            // rhill 2013-12-09:
            // Ignore list if disabled
            // https://github.com/gorhill/httpswitchboard/issues/78
            if ( lists[location].off ) {
                blacklistLoadCount -= 1;
                continue;
            }
            µb.assets.get(location, mergeBlacklist);
        }
    };

    this.getAvailableLists(loadBlacklistsStart);
};

/******************************************************************************/

µBlock.mergeFilterList = function(details) {
    // console.log('µBlock > mergeFilterList from "%s": "%s..."', details.path, details.content.slice(0, 40));

    var netFilteringEngine = this.netFilteringEngine;
    var cosmeticFilteringEngine = this.cosmeticFilteringEngine;
    var duplicateCount = netFilteringEngine.duplicateCount + cosmeticFilteringEngine.duplicateCount;
    var acceptedCount = netFilteringEngine.acceptedCount + cosmeticFilteringEngine.acceptedCount;

    this.mergeFilterText(details.content);

    // For convenience, store the number of entries for this
    // blacklist, user might be happy to know this information.
    duplicateCount = netFilteringEngine.duplicateCount + cosmeticFilteringEngine.duplicateCount - duplicateCount;
    acceptedCount = netFilteringEngine.acceptedCount + cosmeticFilteringEngine.acceptedCount - acceptedCount;

    var filterListMeta = this.remoteBlacklists[details.path];

    filterListMeta.entryCount = acceptedCount;
    filterListMeta.entryUsedCount = acceptedCount - duplicateCount;

    // Try to extract a human-friendly name (works only for
    // ABP-compatible filter lists)
    if ( filterListMeta.title === '' ) {
        var matches = details.content.slice(0, 1024).match(/(?:^|\n)!\s*Title:([^\n]+)/i);
        if ( matches !== null ) {
            filterListMeta.title = matches[1].trim();
        }
    }
};

/******************************************************************************/

µBlock.mergeFilterText = function(rawText) {
    var rawEnd = rawText.length;

    // Useful references:
    //    https://adblockplus.org/en/filter-cheatsheet
    //    https://adblockplus.org/en/filters
    var netFilteringEngine = this.netFilteringEngine;
    var cosmeticFilteringEngine = this.cosmeticFilteringEngine;
    var parseCosmeticFilters = this.userSettings.parseAllABPHideFilters;

    var reIsCosmeticFilter = /#@?#/;
    var reLocalhost = /(?:^|\s)(?:localhost\.localdomain|localhost|local|broadcasthost|0\.0\.0\.0|127\.0\.0\.1|::1|fe80::1%lo0)(?=\s|$)/g;
    var reAsciiSegment = /^[\x21-\x7e]+$/;
    var matches;
    var lineBeg = 0, lineEnd, currentLineBeg;
    var line, c;

    while ( lineBeg < rawEnd ) {
        lineEnd = rawText.indexOf('\n', lineBeg);
        if ( lineEnd === -1 ) {
            lineEnd = rawText.indexOf('\r', lineBeg);
            if ( lineEnd === -1 ) {
                lineEnd = rawEnd;
            }
        }

        // rhill 2014-04-18: The trim is important here, as without it there
        // could be a lingering `\r` which would cause problems in the
        // following parsing code.
        line = rawText.slice(lineBeg, lineEnd).trim();
        currentLineBeg = lineBeg;
        lineBeg = lineEnd + 1;

        // Strip comments
        c = line.charAt(0);
        if ( c === '!' || c === '[' ) {
            continue;
        }

        // Parse or skip cosmetic filters
        if ( parseCosmeticFilters ) {
            if ( cosmeticFilteringEngine.add(line) ) {
                continue;
            }
        } else if ( reIsCosmeticFilter.test(line) ) {
            continue;
        }

        if ( c === '#' ) {
            continue;
        }

        // https://github.com/gorhill/httpswitchboard/issues/15
        // Ensure localhost et al. don't end up in the ubiquitous blacklist.
        line = line
            .replace(/\s+#.*$/, '')
            .toLowerCase()
            .replace(reLocalhost, '')
            .trim();

        // The filter is whatever sequence of printable ascii character without
        // whitespaces
        matches = reAsciiSegment.exec(line);
        if ( matches === null ) {
            //console.debug('µBlock.mergeFilterList(): skipping "%s"', lineRaw);
            continue;
        }

        // Bypass anomalies
        // For example, when a filter contains whitespace characters, or
        // whatever else outside the range of printable ascii characters.
        if ( matches[0] !== line ) {
            // console.error('"%s" !== "%s"', matches[0], line);
            continue;
        }

        netFilteringEngine.add(matches[0]);
    }
};

/******************************************************************************/

// `switches` contains the preset blacklists for which the switch must be
// revisited.

µBlock.reloadPresetBlacklists = function(switches, update) {
    var µb = µBlock;

    var onFilterListsReady = function() {
        µb.loadUpdatableAssets({ update: update, psl: update });
    };

    // Toggle switches, if any
    if ( switches !== undefined ) {
        var filterLists = this.remoteBlacklists;
        var i = switches.length;
        while ( i-- ) {
            if ( filterLists.hasOwnProperty(switches[i].location) === false ) {
                continue;
            }
            filterLists[switches[i].location].off = !!switches[i].off;
        }
        // Save switch states
        vAPI.storage.set({ 'remoteBlacklists': filterLists }, onFilterListsReady);
    } else {
        onFilterListsReady();
    }
};

/******************************************************************************/

µBlock.loadPublicSuffixList = function(callback) {
    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }
    var applyPublicSuffixList = function(details) {
        // TODO: Not getting proper suffix list is a bit serious, I think
        // the extension should be force-restarted if it occurs..
        if ( !details.error ) {
            publicSuffixList.parse(details.content, punycode.toASCII);
        }
        callback();
    };
    this.assets.get(this.pslPath, applyPublicSuffixList);
};

/******************************************************************************/

// Load updatable assets

µBlock.loadUpdatableAssets = function(details) {
    var µb = this;

    details = details || {};
    var update = details.update !== false;

    this.assets.autoUpdate = update || this.userSettings.autoUpdate;
    this.assets.autoUpdateDelay = this.updateAssetsEvery;

    var onFiltersReady = function() {
        if ( update ) {
            µb.updater.restart();
        }
    };

    var onPSLReady = function() {
        µb.loadFilterLists(onFiltersReady);
    };

    if ( details.psl !== false ) {
        this.loadPublicSuffixList(onPSLReady);
    } else {
        this.loadFilterLists(onFiltersReady);
    }
};

/******************************************************************************/

µBlock.toSelfie = function() {
    var selfie = {
        magic: this.selfieMagic,
        publicSuffixList: publicSuffixList.toSelfie(),
        filterLists: this.remoteBlacklists,
        netFilteringEngine: this.netFilteringEngine.toSelfie(),
        cosmeticFilteringEngine: this.cosmeticFilteringEngine.toSelfie()
    };
    vAPI.storage.set({ selfie: selfie });
    // console.log('µBlock.toSelfie> made a selfie!');
};

// This is to be sure the selfie is generated in a sane manner: the selfie will
// be generated if the user doesn't change his filter lists selection for
// some set time.

µBlock.toSelfieAsync = function(after) {
    if ( typeof after !== 'number' ) {
        after = this.selfieAfter;
    }
    this.asyncJobs.add(
        'toSelfie',
        null,
        this.toSelfie.bind(this),
        after,
        false
    );
};

/******************************************************************************/

µBlock.fromSelfie = function(callback) {
    var µb = this;

    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }

    var onSelfieReady = function(store) {
        var selfie = store.selfie;
        if ( typeof selfie !== 'object' || selfie.magic !== µb.selfieMagic ) {
            callback(false);
            return;
        }
        if ( publicSuffixList.fromSelfie(selfie.publicSuffixList) !== true ) {
            callback(false);
            return;
        }
        // console.log('µBlock.fromSelfie> selfie looks good');
        µb.remoteBlacklists = selfie.filterLists;
        µb.netFilteringEngine.fromSelfie(selfie.netFilteringEngine);
        µb.cosmeticFilteringEngine.fromSelfie(selfie.cosmeticFilteringEngine);
        callback(true);
    };

    vAPI.storage.get('selfie', onSelfieReady);
};

/******************************************************************************/

µBlock.destroySelfie = function() {
    vAPI.storage.remove('selfie');
};

/******************************************************************************/

// Load all

µBlock.load = function() {
    var µb = this;
    var fromSelfie = false;

    // Final initialization steps after all needed assets are in memory.
    // - Initialize internal state with maybe already existing tabs.
    // - Schedule next update operation.
    var onAllDone = function() {
        if (vAPI.chrome) {
            // http://code.google.com/p/chromium/issues/detail?id=410868#c11
            // Need to be sure to access `vAPI.lastError` to prevent
            // spurious warnings in the console.
            var scriptDone = function() {
                vAPI.lastError;
            };
            var scriptEnd = function(tabId) {
                if ( vAPI.lastError ) {
                    return;
                }
                vAPI.tabs.injectScript(tabId, {
                    file: 'js/contentscript-end.js',
                    allFrames: true,
                    runAt: 'document_idle'
                }, scriptDone);
            };
            var scriptStart = function(tabId) {
                vAPI.tabs.injectScript(tabId, {
                    file: 'js/vapi-client.js',
                    allFrames: true,
                    runAt: 'document_start'
                }, function(){ });
                vAPI.tabs.injectScript(tabId, {
                    file: 'js/contentscript-start.js',
                    allFrames: true,
                    runAt: 'document_idle'
                }, function(){ scriptEnd(tabId); });
            };
            var bindToTabs = function(tabs) {
                var i = tabs.length, tab;
                while ( i-- ) {
                    tab = tabs[i];
                    µb.bindTabToPageStats(tab.id, tab.url);
                    // https://github.com/gorhill/uBlock/issues/129
                    scriptStart(tab.id);
                }
            };

            chrome.tabs.query({ url: 'http://*/*' }, bindToTabs);
            chrome.tabs.query({ url: 'https://*/*' }, bindToTabs);
        }

        // https://github.com/gorhill/uBlock/issues/184
        // If we restored a selfie, check for updates not too far
        // in the future.
        var nextUpdate = fromSelfie === false && µb.userSettings.autoUpdate ?
            µb.nextUpdateAfter :
            µb.firstUpdateAfter;
        µb.updater.restart(nextUpdate);
    };

    // https://github.com/gorhill/uBlock/issues/226
    // Whitelist in memory.
    // Whitelist parser needs PSL to be ready.
    var onWhitelistReady = function() {
        onAllDone();
    };

    // Filters are in memory.
    // Filter engines need PSL to be ready.
    var onFiltersReady = function() {
        µb.loadWhitelist(onWhitelistReady);
    };

    // Load order because dependencies:
    // User settings -> PSL -> [filter lists, user whitelist]
    var onPSLReady = function() {
        µb.loadFilterLists(onFiltersReady);
    };

    // If no selfie available, take the long way, i.e. load and parse
    // raw data.
    var onSelfieReady = function(success) {
        if ( success === true ) {
            fromSelfie = true;
            µb.loadWhitelist(onWhitelistReady);
            return;
        }
        µb.loadPublicSuffixList(onPSLReady);
    };

    // User settings are in memory
    var onUserSettingsReady = function(settings) {
        µb.assets.autoUpdate = settings.autoUpdate;
        µb.netFilteringEngine.dynamicFiltersFromSelfie(settings.dynamicFilteringSelfie);
        µb.fromSelfie(onSelfieReady);
        µb.mirrors.toggle(settings.experimentalEnabled);
        µb.contextMenu.toggle(settings.contextMenuEnabled);
    };

    this.loadUserSettings(onUserSettingsReady);
    this.loadLocalSettings();
    this.getBytesInUse();
};

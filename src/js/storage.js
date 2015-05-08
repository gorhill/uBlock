/*******************************************************************************

    µBlock - a browser extension to block requests.
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

/* global YaMD5, µBlock, vAPI, punycode, publicSuffixList */

'use strict';

/******************************************************************************/

µBlock.getBytesInUse = function(callback) {
    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }
    var getBytesInUseHandler = function(bytesInUse) {
        µBlock.storageUsed = bytesInUse;
        callback(bytesInUse);
    };
    vAPI.storage.getBytesInUse(null, getBytesInUseHandler);
};

/******************************************************************************/

µBlock.keyvalSetOnePref = function(key, val, callback) {
    var bin = {};
    bin[key] = val;
    vAPI.storage.preferences.set(bin, callback || this.noopFunc);
};

/******************************************************************************/

µBlock.saveLocalSettings = function(force) {
    if ( force ) {
        this.localSettingsModifyTime = Date.now();
    }
    if ( this.localSettingsModifyTime <= this.localSettingsSaveTime ) {
        return;
    }
    this.localSettingsSaveTime = Date.now();
    vAPI.storage.preferences.set(this.localSettings);
};

/******************************************************************************/

// Save local settings regularly. Not critical.

µBlock.asyncJobs.add(
    'autoSaveLocalSettings',
    null,
    µBlock.saveLocalSettings.bind(µBlock),
    4 * 60 * 1000,
    true
);

/******************************************************************************/

µBlock.saveUserSettings = function() {
    vAPI.storage.preferences.set(this.userSettings);
};

/******************************************************************************/

µBlock.savePermanentFirewallRules = function() {
    this.keyvalSetOnePref('dynamicFilteringString', this.permanentFirewall.toString());
};

/******************************************************************************/

µBlock.saveWhitelist = function() {
    var bin = {
        'netWhitelist': this.stringFromWhitelist(this.netWhitelist)
    };
    vAPI.storage.preferences.set(bin);
    this.netWhitelistModifyTime = Date.now();
};

/******************************************************************************/

// This will remove all unused filter list entries from
// µBlock.remoteBlacklists`. This helps reduce the size of backup files.

µBlock.extractSelectedFilterLists = function(callback) {
    var µb = this;

    var onBuiltinListsLoaded = function(details) {
        var builtin;
        try {
            builtin = JSON.parse(details.content);
        } catch (e) {
            builtin = {};
        }

        var result = JSON.parse(JSON.stringify(µb.remoteBlacklists));
        var builtinPath;
        var defaultState;

        for ( var path in result ) {
            if ( result.hasOwnProperty(path) === false ) {
                continue;
            }
            builtinPath = path.replace(/^assets\/thirdparties\//, '');
            defaultState = builtin.hasOwnProperty(builtinPath) === false ||
                           builtin[builtinPath].off === true;
            if ( result[path].off === true && result[path].off === defaultState ) {
                delete result[path];
            }
        }

        callback(result);
    };

    // https://github.com/gorhill/uBlock/issues/63
    // Get built-in block lists: this will help us determine whether a
    // specific list must be included in the result.
    this.assets.get('assets/ublock/filter-lists.json', onBuiltinListsLoaded);
};

/******************************************************************************/

µBlock.saveUserFilters = function(content, callback) {
    vAPI.storage.preferences.set({"userFilters": content});
    this.assets.put(this.userFiltersPath, content, callback);
    return;
};

/******************************************************************************/

µBlock.loadUserFilters = function(callback) {
    return this.assets.get(this.userFiltersPath, callback);
};

/******************************************************************************/

µBlock.appendUserFilters = function(filters) {
    if ( filters.length === 0 ) {
        return;
    }

    var µb = this;

    var onSaved = function() {
        var compiledFilters = µb.compileFilters(filters);
        var snfe = µb.staticNetFilteringEngine;
        var cfe = µb.cosmeticFilteringEngine;
        var acceptedCount = snfe.acceptedCount + cfe.acceptedCount;
        var duplicateCount = snfe.duplicateCount + cfe.duplicateCount;
        µb.applyCompiledFilters(compiledFilters);
        var entry = µb.remoteBlacklists[µb.userFiltersPath];
        var deltaEntryCount = snfe.acceptedCount + cfe.acceptedCount - acceptedCount;
        var deltaEntryUsedCount = deltaEntryCount - (snfe.duplicateCount + cfe.duplicateCount - duplicateCount);
        entry.entryCount += deltaEntryCount;
        entry.entryUsedCount += deltaEntryUsedCount;
        vAPI.storage.preferences.set({ 'remoteBlacklists': µb.remoteBlacklists });
        µb.staticNetFilteringEngine.freeze();
        µb.cosmeticFilteringEngine.freeze();
    };

    var onLoaded = function(details) {
        // https://github.com/chrisaljoudi/uBlock/issues/976
        // If we reached this point, the filter quite probably needs to be
        // added for sure: do not try to be too smart, trying to avoid
        // duplicates at this point may lead to more issues.
        µb.saveUserFilters(details.content.trim() + '\n\n' + filters.trim(), onSaved);
    };

    this.loadUserFilters(onLoaded);
};

/******************************************************************************/

µBlock.getAvailableLists = function(callback) {
    var availableLists = {};
    var relocationMap = {};

    var fixLocation = function(location) {
        // https://github.com/chrisaljoudi/uBlock/issues/418
        // We now support built-in external filter lists
        if ( /^https?:/.test(location) === false ) {
            location = 'assets/thirdparties/' + location;
        }
        return location;
    };

    // selected lists
    var onSelectedListsLoaded = function(store) {
        var µb = µBlock;
        var lists = store.remoteBlacklists;
        var locations = Object.keys(lists);
        var location, availableEntry, storedEntry;
        var off;

        while ( location = locations.pop() ) {
            storedEntry = lists[location];
            off = storedEntry.off === true;
            // New location?
            if ( relocationMap.hasOwnProperty(location) ) {
                µb.purgeFilterList(location);
                location = relocationMap[location];
                if ( off && lists.hasOwnProperty(location) ) {
                    off = lists[location].off === true;
                }
            }
            availableEntry = availableLists[location];
            if ( availableEntry === undefined ) {
                µb.purgeFilterList(location);
                continue;
            }
            availableEntry.off = off;
            µb.assets.setHomeURL(location, availableEntry.homeURL);
            if ( storedEntry.entryCount !== undefined ) {
                availableEntry.entryCount = storedEntry.entryCount;
            }
            if ( storedEntry.entryUsedCount !== undefined ) {
                availableEntry.entryUsedCount = storedEntry.entryUsedCount;
            }
            // This may happen if the list name was pulled from the list
            // content.
            // https://github.com/chrisaljoudi/uBlock/issues/982
            // There is no guarantee the title was successfully extracted from
            // the list content.
            if ( availableEntry.title === '' &&
                 typeof storedEntry.title === 'string' &&
                 storedEntry.title !== ''
            ) {
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
            location = fixLocation(location);
            // Migrate obsolete location to new location, if any
            if ( typeof entry.oldLocation === 'string' ) {
                entry.oldLocation = fixLocation(entry.oldLocation);
                relocationMap[entry.oldLocation] = location;
            }
            availableLists[location] = entry;
        }

        // Now get user's selection of lists
        vAPI.storage.preferences.get(
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

µBlock.createShortUniqueId = function(path) {
    var md5 = YaMD5.hashStr(path);
    return md5.slice(0, 4) + md5.slice(-4);
};

µBlock.createShortUniqueId.idLength = 8;

/******************************************************************************/

µBlock.loadFilterLists = function(callback) {

    //quickProfiler.start('µBlock.loadFilterLists()');

    var µb = this;
    var filterlistsCount = 0;

    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }

    // Never fetch from remote servers when we load filter lists: this has to
    // be as fast as possible.
    µb.assets.remoteFetchBarrier += 1;

    var onDone = function() {
        // Remove barrier to remote fetching
        µb.assets.remoteFetchBarrier -= 1;

        µb.staticNetFilteringEngine.freeze();
        µb.cosmeticFilteringEngine.freeze();
        vAPI.storage.preferences.set({ 'remoteBlacklists': µb.remoteBlacklists });

        //quickProfiler.stop(0);

        vAPI.messaging.broadcast({ what: 'allFilterListsReloaded' });
        callback();

        µb.toSelfieAsync();
    };

    var applyCompiledFilters = function(path, compiled) {
        var snfe = µb.staticNetFilteringEngine;
        var cfe = µb.cosmeticFilteringEngine;
        var acceptedCount = snfe.acceptedCount + cfe.acceptedCount;
        var duplicateCount = snfe.duplicateCount + cfe.duplicateCount;
        µb.applyCompiledFilters(compiled);
        if ( µb.remoteBlacklists.hasOwnProperty(path) ) {
            var entry = µb.remoteBlacklists[path];
            entry.entryCount = snfe.acceptedCount + cfe.acceptedCount - acceptedCount;
            entry.entryUsedCount = entry.entryCount - (snfe.duplicateCount + cfe.duplicateCount - duplicateCount);
        }
    };

    var onCompiledListLoaded = function(details) {
        applyCompiledFilters(details.path, details.content);
        filterlistsCount -= 1;
        if ( filterlistsCount === 0 ) {
            onDone();
        }
    };

    var onFilterListsReady = function(lists) {
        µb.remoteBlacklists = lists;

        µb.cosmeticFilteringEngine.reset();
        µb.staticNetFilteringEngine.reset();
        µb.destroySelfie();

        // We need to build a complete list of assets to pull first: this is
        // because it *may* happens that some load operations are synchronous:
        // This happens for assets which do not exist, ot assets with no
        // content.
        var toLoad = [];
        for ( var path in lists ) {
            if ( lists.hasOwnProperty(path) === false ) {
                continue;
            }
            if ( lists[path].off ) {
                continue;
            }
            toLoad.push(path);
        }
        filterlistsCount = toLoad.length;
        if ( filterlistsCount === 0 ) {
            onDone();
            return;
        }

        var i = toLoad.length;
        while ( i-- ) {
            µb.getCompiledFilterList(toLoad[i], onCompiledListLoaded);
        }
    };

    this.getAvailableLists(onFilterListsReady);
};

/******************************************************************************/

µBlock.getCompiledFilterListPath = function(path) {
    return 'cache://compiled-filter-list:' + this.createShortUniqueId(path);
};

/******************************************************************************/

µBlock.getCompiledFilterList = function(path, callback) {
    var compiledPath = this.getCompiledFilterListPath(path);
    var µb = this;

    var onRawListLoaded = function(details) {
        if ( details.content !== '' ) {
            var listMeta = µb.remoteBlacklists[path];
            if ( listMeta && listMeta.title === '' ) {
                var matches = details.content.slice(0, 1024).match(/(?:^|\n)!\s*Title:([^\n]+)/i);
                if ( matches !== null ) {
                    listMeta.title = matches[1].trim();
                }
            }

            //console.debug('µBlock.getCompiledFilterList/onRawListLoaded: compiling "%s"', path);
            details.content = µb.compileFilters(details.content);
            µb.assets.put(compiledPath, details.content);
        }
        callback(details);
    };

    var onCompiledListLoaded = function(details) {
        if ( details.content === '' ) {
            //console.debug('µBlock.getCompiledFilterList/onCompiledListLoaded: no compiled version for "%s"', path);
            µb.assets.get(path, onRawListLoaded);
            return;
        }
        //console.debug('µBlock.getCompiledFilterList/onCompiledListLoaded: using compiled version for "%s"', path);
        details.path = path;
        callback(details);
    };

    this.assets.get(compiledPath, onCompiledListLoaded);
};

/******************************************************************************/

µBlock.purgeCompiledFilterList = function(path) {
    this.assets.purge(this.getCompiledFilterListPath(path));
};

/******************************************************************************/

µBlock.purgeFilterList = function(path) {
    this.purgeCompiledFilterList(path);
    this.assets.purge(path);
};

/******************************************************************************/

µBlock.compileFilters = function(rawText) {
    var rawEnd = rawText.length;
    var compiledFilters = [];

    // Useful references:
    //    https://adblockplus.org/en/filter-cheatsheet
    //    https://adblockplus.org/en/filters
    var staticNetFilteringEngine = this.staticNetFilteringEngine;
    var cosmeticFilteringEngine = this.cosmeticFilteringEngine;
    var reIsWhitespaceChar = /\s/;
    var reMaybeLocalIp = /^[\d:f]/;
    var reIsLocalhostRedirect = /\s+(?:broadcasthost|local|localhost|localhost\.localdomain)(?=\s|$)/;
    var reLocalIp = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1|fe80::1%lo0)/;

    var lineBeg = 0, lineEnd, currentLineBeg;
    var line, lineRaw, c, pos;

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
        line = lineRaw = rawText.slice(lineBeg, lineEnd).trim();
        currentLineBeg = lineBeg;
        lineBeg = lineEnd + 1;

        if ( line.length === 0 ) {
            continue;
        }

        // Strip comments
        c = line.charAt(0);
        if ( c === '!' || c === '[' ) {
            continue;
        }

        // Parse or skip cosmetic filters
        // All cosmetic filters are caught here
        if ( cosmeticFilteringEngine.compile(line, compiledFilters) ) {
            continue;
        }

        // Whatever else is next can be assumed to not be a cosmetic filter

        // Most comments start in first column
        if ( c === '#' ) {
            continue;
        }

        // Catch comments somewhere on the line
        // Remove:
        //   ... #blah blah blah
        //   ... # blah blah blah
        // Don't remove:
        //   ...#blah blah blah
        // because some ABP filters uses the `#` character (URL fragment)
        pos = line.indexOf('#');
        if ( pos !== -1 && reIsWhitespaceChar.test(line.charAt(pos - 1)) ) {
            line = line.slice(0, pos).trim();
        }

        // https://github.com/gorhill/httpswitchboard/issues/15
        // Ensure localhost et al. don't end up in the ubiquitous blacklist.
        // With hosts files, we need to remove local IP redirection
        if ( reMaybeLocalIp.test(c) ) {
            // Ignore hosts file redirect configuration
            // 127.0.0.1 localhost
            // 255.255.255.255 broadcasthost
            if ( reIsLocalhostRedirect.test(line) ) {
                continue;
            }
            line = line.replace(reLocalIp, '').trim();
        }

        if ( line.length === 0 ) {
            continue;
        }

        //staticNetFilteringEngine.add(line);
        staticNetFilteringEngine.compile(line, compiledFilters);
    }

    return compiledFilters.join('\n');
};

/******************************************************************************/

µBlock.applyCompiledFilters = function(rawText) {
    var skipCosmetic = !this.userSettings.parseAllABPHideFilters;
    var staticNetFilteringEngine = this.staticNetFilteringEngine;
    var cosmeticFilteringEngine = this.cosmeticFilteringEngine;
    var lineBeg = 0;
    var rawEnd = rawText.length;
    while ( lineBeg < rawEnd ) {
        lineBeg = cosmeticFilteringEngine.fromCompiledContent(rawText, lineBeg, skipCosmetic);
        lineBeg = staticNetFilteringEngine.fromCompiledContent(rawText, lineBeg);
    }
};

/******************************************************************************/

// `switches` contains the filter lists for which the switch must be revisited.

µBlock.selectFilterLists = function(switches) {
    switches = switches || {};

    // Only the lists referenced by the switches are touched.
    var filterLists = this.remoteBlacklists;
    var entry, state, location;
    var i = switches.length;
    while ( i-- ) {
        entry = switches[i];
        state = entry.off === true;
        location = entry.location;
        if ( filterLists.hasOwnProperty(location) === false ) {
            if ( state !== true ) {
                filterLists[location] = { off: state };
            }
            continue;
        }
        if ( filterLists[location].off === state ) {
            continue;
        }
        filterLists[location].off = state;
    }

    vAPI.storage.preferences.set({ 'remoteBlacklists': filterLists });
};

/******************************************************************************/

// Plain reload of all filters.

µBlock.reloadAllFilters = function() {
    var µb = this;

    // We are just reloading the filter lists: we do not want assets to update.
    this.assets.autoUpdate = false;

    var onFiltersReady = function() {
        µb.assets.autoUpdate = µb.userSettings.autoUpdate;
    };

    this.loadFilterLists(onFiltersReady);
};

/******************************************************************************/

µBlock.loadPublicSuffixList = function(callback) {
    var µb = this;
    var path = µb.pslPath;
    var compiledPath = 'cache://compiled-publicsuffixlist';

    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }
    var onRawListLoaded = function(details) {
        if ( details.content !== '' ) {
            //console.debug('µBlock.loadPublicSuffixList/onRawListLoaded: compiling "%s"', path);
            publicSuffixList.parse(details.content, punycode.toASCII);
            µb.assets.put(compiledPath, JSON.stringify(publicSuffixList.toSelfie()));
        }
        callback();
    };

    var onCompiledListLoaded = function(details) {
        if ( details.content === '' ) {
            //console.debug('µBlock.loadPublicSuffixList/onCompiledListLoaded: no compiled version for "%s"', path);
            µb.assets.get(path, onRawListLoaded);
            return;
        }
        //console.debug('µBlock.loadPublicSuffixList/onCompiledListLoaded: using compiled version for "%s"', path);
        publicSuffixList.fromSelfie(JSON.parse(details.content));
        callback();
    };

    this.assets.get(compiledPath, onCompiledListLoaded);
};

/******************************************************************************/

µBlock.toSelfie = function() {
    var selfie = {
        magic: this.systemSettings.selfieMagic,
        publicSuffixList: publicSuffixList.toSelfie(),
        filterLists: this.remoteBlacklists,
        staticNetFilteringEngine: this.staticNetFilteringEngine.toSelfie(),
        cosmeticFilteringEngine: this.cosmeticFilteringEngine.toSelfie()
    };
    vAPI.storage.set({ selfie: selfie });
    //console.debug('storage.js > µBlock.toSelfie()');
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

µBlock.destroySelfie = function() {
    vAPI.storage.remove('selfie');
    this.asyncJobs.remove('toSelfie');
    //console.debug('µBlock.destroySelfie()');
};

/******************************************************************************/

µBlock.updateStartHandler = function(callback) {
    var µb = this;
    var onListsReady = function(lists) {
        var assets = {};
        for ( var location in lists ) {
            if ( lists.hasOwnProperty(location) === false ) {
                continue;
            }
            if ( lists[location].off ) {
                continue;
            }
            assets[location] = true;
        }
        assets[µb.pslPath] = true;
        assets['assets/ublock/mirror-candidates.txt'] = true;
        callback(assets);
    };

    this.getAvailableLists(onListsReady);
};

/******************************************************************************/

µBlock.assetUpdatedHandler = function(details) {
    var path = details.path || '';
    if ( this.remoteBlacklists.hasOwnProperty(path) === false ) {
        return;
    }
    var entry = this.remoteBlacklists[path];
    if ( entry.off ) {
        return;
    }
    // Compile the list while we have the raw version in memory
    //console.debug('µBlock.getCompiledFilterList/onRawListLoaded: compiling "%s"', path);
    this.assets.put(
        this.getCompiledFilterListPath(path),
        this.compileFilters(details.content)
    );
};

/******************************************************************************/

µBlock.updateCompleteHandler = function(details) {
    var µb = this;
    var updatedCount = details.updatedCount;

    // Assets are supposed to have been all updated, prevent fetching from
    // remote servers.
    µb.assets.remoteFetchBarrier += 1;

    var onFiltersReady = function() {
        µb.assets.remoteFetchBarrier -= 1;
    };

    var onPSLReady = function() {
        if ( updatedCount !== 0 ) {
            //console.debug('storage.js > µBlock.updateCompleteHandler: reloading filter lists');
            µb.loadFilterLists(onFiltersReady);
        } else {
            onFiltersReady();
        }
    };

    if ( details.hasOwnProperty('assets/ublock/mirror-candidates.txt') ) {
        /* TODO */
    }

    if ( details.hasOwnProperty(this.pslPath) ) {
        //console.debug('storage.js > µBlock.updateCompleteHandler: reloading PSL');
        this.loadPublicSuffixList(onPSLReady);
        updatedCount -= 1;
    } else {
        onPSLReady();
    }
};

/******************************************************************************/

µBlock.assetCacheRemovedHandler = (function() {
    var barrier = false;

    var handler = function(paths) {
        if ( barrier ) {
            return;
        }
        barrier = true;
        var i = paths.length;
        var path;
        while ( i-- ) {
            path = paths[i];
            if ( this.remoteBlacklists.hasOwnProperty(path) ) {
                //console.debug('µBlock.assetCacheRemovedHandler: decompiling "%s"', path);
                this.purgeCompiledFilterList(path);
                continue;
            }
            if ( path === this.pslPath ) {
                //console.debug('µBlock.assetCacheRemovedHandler: decompiling "%s"', path);
                this.assets.purge('cache://compiled-publicsuffixlist');
                continue;
            }
        }
        this.destroySelfie();
        barrier = false;
    };

    return handler;
})();

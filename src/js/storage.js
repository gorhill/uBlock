/*******************************************************************************

    uBlock - a browser extension to block requests.
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

µBlock.keyvalSetOne = function(key, val, callback) {
    var bin = {};
    bin[key] = val;
    vAPI.storage.set(bin, callback || this.noopFunc);
};

/******************************************************************************/

µBlock.saveLocalSettings = (function() {
    var saveAfter = 4 * 60 * 1000;

    var save = function() {
        this.localSettingsSaveTime = Date.now();
        vAPI.storage.set(this.localSettings);
    };

    var onTimeout = function() {
        var µb = µBlock;
        if ( µb.localSettingsModifyTime > µb.localSettingsSaveTime ) {
            save.call(µb);
        }
        vAPI.setTimeout(onTimeout, saveAfter);
    };

    vAPI.setTimeout(onTimeout, saveAfter);

    return save;
})();

/******************************************************************************/

µBlock.saveUserSettings = function() {
    vAPI.storage.set(this.userSettings);
};

/******************************************************************************/

µBlock.savePermanentFirewallRules = function() {
    this.keyvalSetOne('dynamicFilteringString', this.permanentFirewall.toString());
};

/******************************************************************************/

µBlock.savePermanentURLFilteringRules = function() {
    this.keyvalSetOne('urlFilteringString', this.permanentURLFiltering.toString());
};

/******************************************************************************/

µBlock.saveHostnameSwitches = function() {
    this.keyvalSetOne('hostnameSwitchesString', this.hnSwitches.toString());
};

/******************************************************************************/

µBlock.saveWhitelist = function() {
    this.keyvalSetOne('netWhitelist', this.stringFromWhitelist(this.netWhitelist));
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
        var entry, builtinPath, defaultState;

        for ( var path in result ) {
            if ( result.hasOwnProperty(path) === false ) {
                continue;
            }
            entry = result[path];
            // https://github.com/gorhill/uBlock/issues/277
            // uBlock's filter lists are always enabled by default, so we
            // have to include in backup only those which are turned off.
            if ( path.startsWith('assets/ublock/') ) {
                if ( entry.off !== true ) {
                    delete result[path];
                }
                continue;
            }
            builtinPath = path.replace(/^assets\/thirdparties\//, '');
            defaultState = builtin.hasOwnProperty(builtinPath) === false ||
                           builtin[builtinPath].off === true;
            if ( entry.off === true && entry.off === defaultState ) {
                delete result[path];
            }
        }

        callback(result);
    };

    // https://github.com/gorhill/uBlock/issues/63
    // Get built-in block lists: this will help us determine whether a
    // specific list must be included in the result.
    this.loadAndPatchStockFilterLists(onBuiltinListsLoaded);
};

/******************************************************************************/

µBlock.saveUserFilters = function(content, callback) {
    // https://github.com/gorhill/uBlock/issues/1022
    // Be sure to end with an empty line.
    content = content.trim();
    if ( content !== '' ) {
        content += '\n';
    }
    this.assets.put(this.userFiltersPath, content, callback);
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
        var discardedCount = snfe.discardedCount + cfe.discardedCount;
        µb.applyCompiledFilters(compiledFilters, true);
        var entry = µb.remoteBlacklists[µb.userFiltersPath];
        var deltaEntryCount = snfe.acceptedCount + cfe.acceptedCount - acceptedCount;
        var deltaEntryUsedCount = deltaEntryCount - (snfe.discardedCount + cfe.discardedCount - discardedCount);
        entry.entryCount += deltaEntryCount;
        entry.entryUsedCount += deltaEntryUsedCount;
        vAPI.storage.set({ 'remoteBlacklists': µb.remoteBlacklists });
        µb.staticNetFilteringEngine.freeze();
        µb.redirectEngine.freeze();
        µb.cosmeticFilteringEngine.freeze();
        µb.selfieManager.create();
    };

    var onLoaded = function(details) {
        if ( details.error ) {
            return;
        }
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

        while ( (location = locations.pop()) ) {
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
            if ( typeof availableEntry.homeURL === 'string' ) {
                µb.assets.setHomeURL(location, availableEntry.homeURL);
            }
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

        // https://github.com/gorhill/uBlock/issues/747
        if ( µb.firstInstall ) {
            µb.autoSelectFilterLists(availableLists);
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
    this.loadAndPatchStockFilterLists(onBuiltinListsLoaded);
};

/******************************************************************************/

µBlock.autoSelectFilterLists = function(lists) {
    var lang = self.navigator.language.slice(0, 2),
        list;
    for ( var path in lists ) {
        if ( lists.hasOwnProperty(path) === false ) {
            continue;
        }
        list = lists[path];
        if ( list.off !== true ) {
            continue;
        }
        if ( list.lang === lang ) {
            list.off = false;
        }
    }
};

/******************************************************************************/

µBlock.createShortUniqueId = function(path) {
    var md5 = YaMD5.hashStr(path);
    return md5.slice(0, 4) + md5.slice(-4);
};

µBlock.createShortUniqueId.idLength = 8;

/******************************************************************************/

// This is used to be re-entrancy resistant.
µBlock.loadingFilterLists = false;

µBlock.loadFilterLists = function(callback) {
    // Callers are expected to check this first.
    if ( this.loadingFilterLists ) {
        return;
    }
    this.loadingFilterLists = true;

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
        µb.redirectEngine.freeze();
        vAPI.storage.set({ 'remoteBlacklists': µb.remoteBlacklists });

        //quickProfiler.stop(0);

        vAPI.messaging.broadcast({ what: 'allFilterListsReloaded' });
        callback();

        µb.selfieManager.create();
        µb.loadingFilterLists = false;
    };

    var applyCompiledFilters = function(path, compiled) {
        var snfe = µb.staticNetFilteringEngine;
        var cfe = µb.cosmeticFilteringEngine;
        var acceptedCount = snfe.acceptedCount + cfe.acceptedCount;
        var discardedCount = snfe.discardedCount + cfe.discardedCount;
        µb.applyCompiledFilters(compiled, path === µb.userFiltersPath);
        if ( µb.remoteBlacklists.hasOwnProperty(path) ) {
            var entry = µb.remoteBlacklists[path];
            entry.entryCount = snfe.acceptedCount + cfe.acceptedCount - acceptedCount;
            entry.entryUsedCount = entry.entryCount - (snfe.discardedCount + cfe.discardedCount - discardedCount);
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

        µb.redirectEngine.reset();
        µb.cosmeticFilteringEngine.reset();
        µb.staticNetFilteringEngine.reset();
        µb.selfieManager.destroy();
        µb.staticFilteringReverseLookup.resetLists();

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
            return onDone();
        }

        var i = toLoad.length;
        while ( i-- ) {
            µb.getCompiledFilterList(toLoad[i], onCompiledListLoaded);
        }
    };

    this.getAvailableLists(onFilterListsReady);
    this.loadRedirectResources();
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
        if ( details.content === '' ) {
            callback(details);
            return;
        }
        var listMeta = µb.remoteBlacklists[path];
        // https://github.com/gorhill/uBlock/issues/313
        // Always try to fetch the name if this is an external filter list.
        if ( listMeta && (listMeta.title === '' || listMeta.group === 'custom') ) {
            var matches = details.content.slice(0, 1024).match(/(?:^|\n)!\s*Title:([^\n]+)/i);
            if ( matches !== null ) {
                listMeta.title = matches[1].trim();
            }
        }

        //console.debug('µBlock.getCompiledFilterList/onRawListLoaded: compiling "%s"', path);
        details.content = µb.compileFilters(details.content);
        µb.assets.put(compiledPath, details.content);
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

        staticNetFilteringEngine.compile(line, compiledFilters);
    }

    return compiledFilters.join('\n');
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1395
//   Added `firstparty` argument: to avoid discarding cosmetic filters when
//   applying 1st-party filters.

µBlock.applyCompiledFilters = function(rawText, firstparty) {
    var skipCosmetic = !firstparty && !this.userSettings.parseAllABPHideFilters,
        skipGenericCosmetic = this.userSettings.ignoreGenericCosmeticFilters,
        staticNetFilteringEngine = this.staticNetFilteringEngine,
        cosmeticFilteringEngine = this.cosmeticFilteringEngine,
        lineIter = new this.LineIterator(rawText);
    while ( lineIter.eot() === false ) {
        cosmeticFilteringEngine.fromCompiledContent(lineIter, skipGenericCosmetic, skipCosmetic);
        staticNetFilteringEngine.fromCompiledContent(lineIter);
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

    vAPI.storage.set({ 'remoteBlacklists': filterLists });
};

/******************************************************************************/

// Plain reload of all filters.

µBlock.reloadAllFilters = function() {
    var µb = this;

    // We are just reloading the filter lists: we do not want assets to update.
    // TODO: probably not needed anymore, since filter lists are now always
    // loaded without update => see `µb.assets.remoteFetchBarrier`.
    this.assets.autoUpdate = false;

    var onFiltersReady = function() {
        µb.assets.autoUpdate = µb.userSettings.autoUpdate;
    };

    this.loadFilterLists(onFiltersReady);
};

/******************************************************************************/

µBlock.loadRedirectResources = function(callback) {
    var µb = this;

    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }

    var onResourcesLoaded = function(details) {
        if ( details.content !== '' ) {
            µb.redirectEngine.resourcesFromString(details.content);
        }
        callback();
    };

    this.assets.get('assets/ublock/resources.txt', onResourcesLoaded);
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

// This is to be sure the selfie is generated in a sane manner: the selfie will
// be generated if the user doesn't change his filter lists selection for
// some set time.

µBlock.selfieManager = (function() {
    var µb = µBlock;
    var timer = null;

    var create = function() {
        timer = null;

        var selfie = {
            magic: µb.systemSettings.selfieMagic,
            publicSuffixList: publicSuffixList.toSelfie(),
            filterLists: µb.remoteBlacklists,
            staticNetFilteringEngine: µb.staticNetFilteringEngine.toSelfie(),
            redirectEngine: µb.redirectEngine.toSelfie(),
            cosmeticFilteringEngine: µb.cosmeticFilteringEngine.toSelfie()
        };

        vAPI.storage.set({ selfie: selfie });
    };

    var createAsync = function(after) {
        if ( typeof after !== 'number' ) {
            after = µb.selfieAfter;
        }

        if ( timer !== null ) {
            clearTimeout(timer);
        }

        timer = vAPI.setTimeout(create, after);
    };

    var destroy = function() {
        if ( timer !== null ) {
            clearTimeout(timer);
            timer = null;
        }

        vAPI.storage.remove('selfie');
    };

    return {
        create: createAsync,
        destroy: destroy
    };
})();

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/531
// Overwrite user settings with admin settings if present.
//
// Admin settings match layout of a uBlock backup. Not all data is
// necessarily present, i.e. administrators may removed entries which
// values are left to the user's choice.

µBlock.restoreAdminSettings = function(callback) {
    var onRead = function(json) {
        var µb = µBlock;
        var data;
        if ( typeof json === 'string' && json !== '' ) {
            try {
                data = JSON.parse(json);
            } catch (ex) {
                console.error(ex);
            }
        }

        if ( typeof data !== 'object' || data === null ) {
            callback();
            return;
        }

        var bin = {};
        var binNotEmpty = false;

        if ( typeof data.userSettings === 'object' ) {
            for ( var name in µb.userSettings ) {
                if ( µb.userSettings.hasOwnProperty(name) === false ) {
                    continue;
                }
                if ( data.userSettings.hasOwnProperty(name) === false ) {
                    continue;
                }
                bin[name] = data.userSettings[name];
                binNotEmpty = true;
            }
        }

        if ( typeof data.filterLists === 'object' ) {
            bin.remoteBlacklists = data.filterLists;
            binNotEmpty = true;
        }

        if ( typeof data.netWhitelist === 'string' ) {
            bin.netWhitelist = data.netWhitelist;
            binNotEmpty = true;
        }

        if ( typeof data.dynamicFilteringString === 'string' ) {
            bin.dynamicFilteringString = data.dynamicFilteringString;
            binNotEmpty = true;
        }

        if ( typeof data.urlFilteringString === 'string' ) {
            bin.urlFilteringString = data.urlFilteringString;
            binNotEmpty = true;
        }

        if ( typeof data.hostnameSwitchesString === 'string' ) {
            bin.hostnameSwitchesString = data.hostnameSwitchesString;
            binNotEmpty = true;
        }

        if ( binNotEmpty ) {
            vAPI.storage.set(bin);
        }

        if ( typeof data.userFilters === 'string' ) {
            µb.assets.put(µb.userFiltersPath, data.userFilters);
        }

        callback();
    };

    vAPI.adminStorage.getItem('adminSettings', onRead);
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
        assets['assets/ublock/resources.txt'] = true;
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
        this.selfieManager.destroy();
        barrier = false;
    };

    return handler;
})();

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/602
// - Load and patch `filter-list.json`
// - Load and patch user's `remoteBlacklists`
// - Load and patch cached filter lists
// - Load and patch compiled filter lists
//
// Once enough time has passed to safely assume all uBlock Origin
// installations have been converted to the new stock filter lists, this code
// can be removed.

µBlock.patchFilterLists = function(filterLists) {
    var modified = false;
    var oldListKey, newListKey, listEntry;
    for ( var listKey in filterLists ) {
        if ( filterLists.hasOwnProperty(listKey) === false ) {
            continue;
        }
        oldListKey = listKey;
        if ( this.oldListToNewListMap.hasOwnProperty(oldListKey) === false ) {
            oldListKey = 'assets/thirdparties/' + listKey;
            if ( this.oldListToNewListMap.hasOwnProperty(oldListKey) === false ) {
                continue;
            }
        }
        newListKey = this.oldListToNewListMap[oldListKey];
        // https://github.com/gorhill/uBlock/issues/668
        // https://github.com/gorhill/uBlock/issues/669
        // Beware: an entry for the new list key may already exists. If it is
        // the case, leave it as is.
        if ( newListKey !== '' && filterLists.hasOwnProperty(newListKey) === false ) {
            listEntry = filterLists[listKey];
            listEntry.homeURL = undefined;
            filterLists[newListKey] = listEntry;
        }
        delete filterLists[listKey];
        modified = true;
    }
    return modified;
};

µBlock.loadAndPatchStockFilterLists = function(callback) {
    var onStockListsLoaded = function(details) {
        var µb = µBlock;
        var stockLists;
        try {
            stockLists = JSON.parse(details.content);
        } catch (e) {
            stockLists = {};
        }

        // Migrate assets affected by the change to their new name.
        var reExternalURL = /^https?:\/\//;
        var newListKey;
        for ( var oldListKey in stockLists ) {
            if ( stockLists.hasOwnProperty(oldListKey) === false ) {
                continue;
            }
            // https://github.com/gorhill/uBlock/issues/708
            // Support migrating external stock filter lists as well.
            if ( reExternalURL.test(oldListKey) === false ) {
                oldListKey = 'assets/thirdparties/' + oldListKey;
            }
            if ( µb.oldListToNewListMap.hasOwnProperty(oldListKey) === false ) {
                continue;
            }
            newListKey = µb.oldListToNewListMap[oldListKey];
            if ( newListKey === '' ) {
                continue;
            }
            // Rename cached asset to preserve content -- so it does not
            // need to be fetched from remote server.
            µb.assets.rename(oldListKey, newListKey);
            µb.assets.purge(µb.getCompiledFilterListPath(oldListKey));
        }
        µb.patchFilterLists(stockLists);

        // Stock lists information cascades into
        // - In-memory user's selected filter lists, so we need to patch this.
        µb.patchFilterLists(µb.remoteBlacklists);

        // Stock lists information cascades into
        // - In-storage user's selected filter lists, so we need to patch this.
        vAPI.storage.get('remoteBlacklists', function(bin) {
            var userLists = bin.remoteBlacklists || {};
            if ( µb.patchFilterLists(userLists) ) {
                µb.keyvalSetOne('remoteBlacklists', userLists);
            }
            details.content = JSON.stringify(stockLists);
            callback(details);
        });
    };

    this.assets.get('assets/ublock/filter-lists.json', onStockListsLoaded);
};

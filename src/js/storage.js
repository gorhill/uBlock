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

/* global punycode, publicSuffixList */

'use strict';

/******************************************************************************/

µBlock.getBytesInUse = function(callback) {
    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }
    let bytesInUse;
    let countdown = 0;

    let process = count => {
        if ( typeof count === 'number' ) {
            if ( bytesInUse === undefined ) {
                bytesInUse = 0;
            }
            bytesInUse += count;
        }
        countdown -= 1;
        if ( countdown > 0 ) { return; }
        µBlock.storageUsed = bytesInUse;
        callback(bytesInUse);
    };

    // Not all platforms implement this method.
    if ( vAPI.storage.getBytesInUse instanceof Function ) {
        countdown += 1;
        vAPI.storage.getBytesInUse(null, process);
    }
    if (
        this.cacheStorage !== vAPI.storage &&
        this.cacheStorage.getBytesInUse instanceof Function
    ) {
        countdown += 1;
        this.cacheStorage.getBytesInUse(null, process);
    }
    if ( countdown === 0 ) {
        callback();
    }
};

/******************************************************************************/

µBlock.saveLocalSettings = (function() {
    let saveAfter = 4 * 60 * 1000;

    let onTimeout = ( ) => {
        let µb = µBlock;
        if ( µb.localSettingsLastModified > µb.localSettingsLastSaved ) {
            µb.saveLocalSettings();
        }
        vAPI.setTimeout(onTimeout, saveAfter);
    };

    vAPI.setTimeout(onTimeout, saveAfter);

    return function(callback) {
        this.localSettingsLastSaved = Date.now();
        vAPI.storage.set(this.localSettings, callback);
    };
})();

/******************************************************************************/

µBlock.saveUserSettings = function() {
    vAPI.storage.set(this.userSettings);
};

/******************************************************************************/

µBlock.loadHiddenSettings = function() {
    vAPI.storage.get('hiddenSettings', bin => {
        if ( bin instanceof Object === false ) { return; }
        let hs = bin.hiddenSettings;
        if ( hs instanceof Object ) {
            let hsDefault = this.hiddenSettingsDefault;
            for ( let key in hsDefault ) {
                if (
                    hsDefault.hasOwnProperty(key) &&
                    hs.hasOwnProperty(key) &&
                    typeof hs[key] === typeof hsDefault[key]
                ) {
                    this.hiddenSettings[key] = hs[key];
                }
            }
        }
        if ( vAPI.localStorage.getItem('immediateHiddenSettings') === null ) {
            this.saveImmediateHiddenSettings();
        }
    });
};

// Note: Save only the settings which values differ from the default ones.
// This way the new default values in the future will properly apply for those
// which were not modified by the user.

µBlock.saveHiddenSettings = function(callback) {
    let bin = { hiddenSettings: {} };
    for ( let prop in this.hiddenSettings ) {
        if (
            this.hiddenSettings.hasOwnProperty(prop) &&
            this.hiddenSettings[prop] !== this.hiddenSettingsDefault[prop]
        ) {
            bin.hiddenSettings[prop] = this.hiddenSettings[prop];
        }
    }
    vAPI.storage.set(bin, callback);
    this.saveImmediateHiddenSettings();
};

/******************************************************************************/

µBlock.hiddenSettingsFromString = function(raw) {
    var out = Object.assign({}, this.hiddenSettingsDefault),
        lineIter = new this.LineIterator(raw),
        line, matches, name, value;
    while ( lineIter.eot() === false ) {
        line = lineIter.next();
        matches = /^\s*(\S+)\s+(.+)$/.exec(line);
        if ( matches === null || matches.length !== 3 ) { continue; }
        name = matches[1];
        if ( out.hasOwnProperty(name) === false ) { continue; }
        value = matches[2];
        switch ( typeof out[name] ) {
        case 'boolean':
            if ( value === 'true' ) {
                out[name] = true;
            } else if ( value === 'false' ) {
                out[name] = false;
            }
            break;
        case 'string':
            out[name] = value;
            break;
        case 'number':
            out[name] = parseInt(value, 10);
            if ( isNaN(out[name]) ) {
                out[name] = this.hiddenSettingsDefault[name];
            }
            break;
        default:
            break;
        }
    }
    return out;
};

µBlock.stringFromHiddenSettings = function() {
    var out = [],
        keys = Object.keys(this.hiddenSettings).sort();
    for ( var key of keys ) {
        out.push(key + ' ' + this.hiddenSettings[key]);
    }
    return out.join('\n');
};

/******************************************************************************/

// These settings must be available immediately on startup, without delay
// through the vAPI.localStorage. Add/remove settings as needed.

µBlock.saveImmediateHiddenSettings = function() {
    vAPI.localStorage.setItem(
        'immediateHiddenSettings',
        JSON.stringify({
               disableWebAssembly: this.hiddenSettings.disableWebAssembly,
            suspendTabsUntilReady: this.hiddenSettings.suspendTabsUntilReady,
            userResourcesLocation: this.hiddenSettings.userResourcesLocation
        })
    );
};

// Do this here to have these hidden settings loaded ASAP.
µBlock.loadHiddenSettings();

/******************************************************************************/

µBlock.savePermanentFirewallRules = function() {
    vAPI.storage.set({
        dynamicFilteringString: this.permanentFirewall.toString()
    });
};

/******************************************************************************/

µBlock.savePermanentURLFilteringRules = function() {
    vAPI.storage.set({
        urlFilteringString: this.permanentURLFiltering.toString()
    });
};

/******************************************************************************/

µBlock.saveHostnameSwitches = function() {
    vAPI.storage.set({
        hostnameSwitchesString: this.permanentSwitches.toString()
    });
};

/******************************************************************************/

µBlock.saveWhitelist = function() {
    vAPI.storage.set({
        netWhitelist: this.stringFromWhitelist(this.netWhitelist)
    });
    this.netWhitelistModifyTime = Date.now();
};

/*******************************************************************************

    TODO(seamless migration):
    The code related to 'remoteBlacklist' can be removed when I am confident
    all users have moved to a version of uBO which no longer depends on
    the property 'remoteBlacklists, i.e. v1.11 and beyond.

**/

µBlock.loadSelectedFilterLists = function(callback) {
    var µb = this;
    vAPI.storage.get('selectedFilterLists', function(bin) {
        // Select default filter lists if first-time launch.
        if ( !bin || Array.isArray(bin.selectedFilterLists) === false ) {
            µb.assets.metadata(function(availableLists) {
                µb.saveSelectedFilterLists(
                    µb.autoSelectRegionalFilterLists(availableLists)
                );
                callback();
            });
            return;
        }
        // TODO: Removes once 1.1.15 is in widespread use.
        // https://github.com/gorhill/uBlock/issues/3383
        vAPI.storage.remove('remoteBlacklists');
        µb.selectedFilterLists = bin.selectedFilterLists;
        callback();
    });
};

µBlock.saveSelectedFilterLists = function(newKeys, append, callback) {
    if ( typeof append === 'function' ) {
        callback = append;
        append = false;
    }
    var oldKeys = this.selectedFilterLists.slice();
    if ( append ) {
        newKeys = newKeys.concat(oldKeys);
    }
    var newSet = new Set(newKeys);
    // Purge unused filter lists from cache.
    for ( var i = 0, n = oldKeys.length; i < n; i++ ) {
        if ( newSet.has(oldKeys[i]) === false ) {
            this.removeFilterList(oldKeys[i]);
        }
    }
    newKeys = Array.from(newSet);
    var bin = {
        selectedFilterLists: newKeys
    };
    this.selectedFilterLists = newKeys;
    vAPI.storage.set(bin, callback);
};

/******************************************************************************/

µBlock.applyFilterListSelection = function(details, callback) {
    var µb = this,
        selectedListKeySet = new Set(this.selectedFilterLists),
        externalLists = this.userSettings.externalLists,
        i, n, assetKey;

    // Filter lists to select
    if ( Array.isArray(details.toSelect) ) {
        if ( details.merge ) {
            for ( i = 0, n = details.toSelect.length; i < n; i++ ) {
                selectedListKeySet.add(details.toSelect[i]);
            }
        } else {
            selectedListKeySet = new Set(details.toSelect);
        }
    }

    // Imported filter lists to remove
    if ( Array.isArray(details.toRemove) ) {
        var removeURLFromHaystack = function(haystack, needle) {
            return haystack.replace(
                new RegExp(
                    '(^|\\n)' +
                    µb.escapeRegex(needle) +
                    '(\\n|$)', 'g'),
                '\n'
            ).trim();
        };
        for ( i = 0, n = details.toRemove.length; i < n; i++ ) {
            assetKey = details.toRemove[i];
            selectedListKeySet.delete(assetKey);
            externalLists = removeURLFromHaystack(externalLists, assetKey);
            this.removeFilterList(assetKey);
        }
    }

    // Filter lists to import
    if ( typeof details.toImport === 'string' ) {
        // https://github.com/gorhill/uBlock/issues/1181
        //   Try mapping the URL of an imported filter list to the assetKey of an
        //   existing stock list.
        var assetKeyFromURL = function(url) {
            var needle = url.replace(/^https?:/, '');
            var assets = µb.availableFilterLists, asset;
            for ( var assetKey in assets ) {
                asset = assets[assetKey];
                if ( asset.content !== 'filters' ) { continue; }
                if ( typeof asset.contentURL === 'string' ) {
                    if ( asset.contentURL.endsWith(needle) ) { return assetKey; }
                    continue;
                }
                if ( Array.isArray(asset.contentURL) === false ) { continue; }
                for ( i = 0, n = asset.contentURL.length; i < n; i++ ) {
                    if ( asset.contentURL[i].endsWith(needle) ) {
                        return assetKey;
                    }
                }
            }
            return url;
        };
        var importedSet = new Set(this.listKeysFromCustomFilterLists(externalLists)),
            toImportSet = new Set(this.listKeysFromCustomFilterLists(details.toImport));
        for ( var urlKey of toImportSet ) {
            if ( importedSet.has(urlKey) ) { continue; }
            assetKey = assetKeyFromURL(urlKey);
            if ( assetKey === urlKey ) {
                importedSet.add(urlKey);
            }
            selectedListKeySet.add(assetKey);
        }
        externalLists = Array.from(importedSet).sort().join('\n');
    }

    var result = Array.from(selectedListKeySet);
    if ( externalLists !== this.userSettings.externalLists ) {
        this.userSettings.externalLists = externalLists;
        vAPI.storage.set({ externalLists: externalLists });
    }
    this.saveSelectedFilterLists(result);
    if ( typeof callback === 'function' ) {
        callback(result);
    }
};

/******************************************************************************/

µBlock.listKeysFromCustomFilterLists = function(raw) {
    var out = new Set(),
        reIgnore = /^[!#]/,
        reValid = /^[a-z-]+:\/\/\S+/,
        lineIter = new this.LineIterator(raw),
        location;
    while ( lineIter.eot() === false ) {
        location = lineIter.next().trim();
        if ( reIgnore.test(location) || !reValid.test(location) ) {
            continue;
        }
        out.add(location);
    }
    return Array.from(out);
};

/******************************************************************************/

µBlock.saveUserFilters = function(content, callback) {
    // https://github.com/gorhill/uBlock/issues/1022
    // Be sure to end with an empty line.
    content = content.trim();
    if ( content !== '' ) { content += '\n'; }
    this.assets.put(this.userFiltersPath, content, callback);
    this.removeCompiledFilterList(this.userFiltersPath);
};

µBlock.loadUserFilters = function(callback) {
    return this.assets.get(this.userFiltersPath, callback);
};

/******************************************************************************/

µBlock.appendUserFilters = function(filters) {
    if ( filters.length === 0 ) { return; }

    var µb = this;

    var onSaved = function() {
        var compiledFilters = µb.compileFilters(filters),
            snfe = µb.staticNetFilteringEngine,
            cfe = µb.cosmeticFilteringEngine,
            acceptedCount = snfe.acceptedCount + cfe.acceptedCount,
            discardedCount = snfe.discardedCount + cfe.discardedCount;
        µb.applyCompiledFilters(compiledFilters, true);
        var entry = µb.availableFilterLists[µb.userFiltersPath],
            deltaEntryCount = snfe.acceptedCount + cfe.acceptedCount - acceptedCount,
            deltaEntryUsedCount = deltaEntryCount - (snfe.discardedCount + cfe.discardedCount - discardedCount);
        entry.entryCount += deltaEntryCount;
        entry.entryUsedCount += deltaEntryUsedCount;
        vAPI.storage.set({ 'availableFilterLists': µb.availableFilterLists });
        µb.staticNetFilteringEngine.freeze();
        µb.redirectEngine.freeze();
        µb.staticExtFilteringEngine.freeze();
        µb.selfieManager.destroy();
    };

    var onLoaded = function(details) {
        if ( details.error ) { return; }
        // https://github.com/chrisaljoudi/uBlock/issues/976
        // If we reached this point, the filter quite probably needs to be
        // added for sure: do not try to be too smart, trying to avoid
        // duplicates at this point may lead to more issues.
        µb.saveUserFilters(details.content.trim() + '\n\n' + filters.trim(), onSaved);
    };

    this.loadUserFilters(onLoaded);
};

/******************************************************************************/

µBlock.autoSelectRegionalFilterLists = function(lists) {
    var selectedListKeys = [ this.userFiltersPath ],
        list;
    for ( var key in lists ) {
        if ( lists.hasOwnProperty(key) === false ) { continue; }
        list = lists[key];
        if ( list.off !== true ) {
            selectedListKeys.push(key);
            continue;
        }
        if ( this.listMatchesEnvironment(list) ) {
            selectedListKeys.push(key);
            list.off = false;
        }
    }
    return selectedListKeys;
};

/******************************************************************************/

µBlock.getAvailableLists = function(callback) {
    var µb = this,
        oldAvailableLists = {},
        newAvailableLists = {};

    // User filter list.
    newAvailableLists[this.userFiltersPath] = {
        group: 'user',
        title: vAPI.i18n('1pPageName')
    };

    // Custom filter lists.
    var importedListKeys = this.listKeysFromCustomFilterLists(µb.userSettings.externalLists),
        i = importedListKeys.length, listKey, entry;
    while ( i-- ) {
        listKey = importedListKeys[i];
        entry = {
            content: 'filters',
            contentURL: listKey,
            external: true,
            group: 'custom',
            submitter: 'user',
            title: ''
        };
        newAvailableLists[listKey] = entry;
        this.assets.registerAssetSource(listKey, entry);
    }

    // Convert a no longer existing stock list into an imported list.
    var customListFromStockList = function(assetKey) {
        var oldEntry = oldAvailableLists[assetKey];
        if ( oldEntry === undefined || oldEntry.off === true ) { return; }
        var listURL = oldEntry.contentURL;
        if ( Array.isArray(listURL) ) {
            listURL = listURL[0];
        }
        var newEntry = {
            content: 'filters',
            contentURL: listURL,
            external: true,
            group: 'custom',
            submitter: 'user',
            title: oldEntry.title || ''
        };
        newAvailableLists[listURL] = newEntry;
        µb.assets.registerAssetSource(listURL, newEntry);
        importedListKeys.push(listURL);
        µb.userSettings.externalLists += '\n' + listURL;
        µb.userSettings.externalLists = µb.userSettings.externalLists.trim();
        vAPI.storage.set({ externalLists: µb.userSettings.externalLists });
        µb.saveSelectedFilterLists([ listURL ], true);
    };

    // Final steps:
    // - reuse existing list metadata if any;
    // - unregister unreferenced imported filter lists if any.
    var finalize = function() {
        var assetKey, newEntry, oldEntry;

        // Reuse existing metadata.
        for ( assetKey in oldAvailableLists ) {
            oldEntry = oldAvailableLists[assetKey];
            newEntry = newAvailableLists[assetKey];
            // List no longer exists. If a stock list, try to convert to
            // imported list if it was selected.
            if ( newEntry === undefined ) {
                µb.removeFilterList(assetKey);
                if ( assetKey.indexOf('://') === -1 ) {
                    customListFromStockList(assetKey);
                }
                continue;
            }
            if ( oldEntry.entryCount !== undefined ) {
                newEntry.entryCount = oldEntry.entryCount;
            }
            if ( oldEntry.entryUsedCount !== undefined ) {
                newEntry.entryUsedCount = oldEntry.entryUsedCount;
            }
            // This may happen if the list name was pulled from the list
            // content.
            // https://github.com/chrisaljoudi/uBlock/issues/982
            // There is no guarantee the title was successfully extracted from
            // the list content.
            if (
                newEntry.title === '' &&
                typeof oldEntry.title === 'string' &&
                oldEntry.title !== ''
            ) {
                newEntry.title = oldEntry.title;
            }
        }

        // Remove unreferenced imported filter lists.
        var dict = new Set(importedListKeys);
        for ( assetKey in newAvailableLists ) {
            newEntry = newAvailableLists[assetKey];
            if ( newEntry.submitter !== 'user' ) { continue; }
            if ( dict.has(assetKey) ) { continue; }
            delete newAvailableLists[assetKey];
            µb.assets.unregisterAssetSource(assetKey);
            µb.removeFilterList(assetKey);
        }
    };

    // Built-in filter lists loaded.
    var onBuiltinListsLoaded = function(entries) {
        for ( var assetKey in entries ) {
            if ( entries.hasOwnProperty(assetKey) === false ) { continue; }
            entry = entries[assetKey];
            if ( entry.content !== 'filters' ) { continue; }
            newAvailableLists[assetKey] = Object.assign({}, entry);
        }

        // Load set of currently selected filter lists.
        var listKeySet = new Set(µb.selectedFilterLists);
        for ( listKey in newAvailableLists ) {
            if ( newAvailableLists.hasOwnProperty(listKey) ) {
                newAvailableLists[listKey].off = !listKeySet.has(listKey);
            }
        }

        finalize();
        callback(newAvailableLists);
    };

    // Available lists previously computed.
    var onOldAvailableListsLoaded = function(bin) {
        oldAvailableLists = bin && bin.availableFilterLists || {};
        µb.assets.metadata(onBuiltinListsLoaded);
    };

    // Load previously saved available lists -- these contains data
    // computed at run-time, we will reuse this data if possible.
    vAPI.storage.get('availableFilterLists', onOldAvailableListsLoaded);
};

/******************************************************************************/

// This is used to be re-entrancy resistant.
µBlock.loadingFilterLists = false;

µBlock.loadFilterLists = function(callback) {
    // Callers are expected to check this first.
    if ( this.loadingFilterLists ) { return; }
    this.loadingFilterLists = true;

    var µb = this,
        filterlistsCount = 0,
        loadedListKeys = [];

    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }

    var onDone = function() {
        µb.staticNetFilteringEngine.freeze();
        µb.staticExtFilteringEngine.freeze();
        µb.redirectEngine.freeze();
        vAPI.storage.set({ 'availableFilterLists': µb.availableFilterLists });

        vAPI.messaging.broadcast({
            what: 'staticFilteringDataChanged',
            parseCosmeticFilters: µb.userSettings.parseAllABPHideFilters,
            ignoreGenericCosmeticFilters: µb.userSettings.ignoreGenericCosmeticFilters,
            listKeys: loadedListKeys
        });

        callback();

        µb.selfieManager.destroy();
        µb.loadingFilterLists = false;
    };

    var applyCompiledFilters = function(assetKey, compiled) {
        var snfe = µb.staticNetFilteringEngine,
            sxfe = µb.staticExtFilteringEngine,
            acceptedCount = snfe.acceptedCount + sxfe.acceptedCount,
            discardedCount = snfe.discardedCount + sxfe.discardedCount;
        µb.applyCompiledFilters(compiled, assetKey === µb.userFiltersPath);
        if ( µb.availableFilterLists.hasOwnProperty(assetKey) ) {
            var entry = µb.availableFilterLists[assetKey];
            entry.entryCount = snfe.acceptedCount + sxfe.acceptedCount -
                acceptedCount;
            entry.entryUsedCount = entry.entryCount -
                (snfe.discardedCount + sxfe.discardedCount - discardedCount);
        }
        loadedListKeys.push(assetKey);
    };

    var onCompiledListLoaded = function(details) {
        applyCompiledFilters(details.assetKey, details.content);
        filterlistsCount -= 1;
        if ( filterlistsCount === 0 ) {
            onDone();
        }
    };

    var onFilterListsReady = function(lists) {
        µb.availableFilterLists = lists;

        µb.redirectEngine.reset();
        µb.staticExtFilteringEngine.reset();
        µb.staticNetFilteringEngine.reset();
        µb.selfieManager.destroy();
        µb.staticFilteringReverseLookup.resetLists();

        // We need to build a complete list of assets to pull first: this is
        // because it *may* happens that some load operations are synchronous:
        // This happens for assets which do not exist, ot assets with no
        // content.
        var toLoad = [];
        for ( var assetKey in lists ) {
            if ( lists.hasOwnProperty(assetKey) === false ) { continue; }
            if ( lists[assetKey].off ) { continue; }
            toLoad.push(assetKey);
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

µBlock.getCompiledFilterList = function(assetKey, callback) {
    var µb = this,
        compiledPath = 'compiled/' + assetKey,
        rawContent;

    var onCompiledListLoaded2 = function(details) {
        if ( details.content === '' ) {
            details.content = µb.compileFilters(rawContent);
            µb.assets.put(compiledPath, details.content);
        }
        rawContent = undefined;
        details.assetKey = assetKey;
        callback(details);
    };

    var onRawListLoaded = function(details) {
        if ( details.content === '' ) {
            details.assetKey = assetKey;
            callback(details);
            return;
        }
        µb.extractFilterListMetadata(assetKey, details.content);
        // Fectching the raw content may cause the compiled content to be
        // generated somewhere else in uBO, hence we try one last time to
        // fetch the compiled content in case it has become available.
        rawContent = details.content;
        µb.assets.get(compiledPath, onCompiledListLoaded2);
    };

    var onCompiledListLoaded1 = function(details) {
        if ( details.content === '' ) {
            µb.assets.get(assetKey, onRawListLoaded);
            return;
        }
        details.assetKey = assetKey;
        callback(details);
    };

    this.assets.get(compiledPath, onCompiledListLoaded1);
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/3406
//   Lower minimum update period to 1 day.

µBlock.extractFilterListMetadata = function(assetKey, raw) {
    let listEntry = this.availableFilterLists[assetKey];
    if ( listEntry === undefined ) { return; }
    // Metadata expected to be found at the top of content.
    let head = raw.slice(0, 1024);
    // https://github.com/gorhill/uBlock/issues/313
    // Always try to fetch the name if this is an external filter list.
    if ( listEntry.title === '' || listEntry.group === 'custom' ) {
        let matches = head.match(/(?:^|\n)(?:!|# )[\t ]*Title[\t ]*:([^\n]+)/i);
        if ( matches !== null ) {
            // https://bugs.chromium.org/p/v8/issues/detail?id=2869
            //   orphanizeString is to work around String.slice()
            //   potentially causing the whole raw filter list to be held in
            //   memory just because we cut out the title as a substring.
            listEntry.title = this.orphanizeString(matches[1].trim());
        }
    }
    // Extract update frequency information
    let matches = head.match(/(?:^|\n)(?:!|# )[\t ]*Expires[\t ]*:[\t ]*(\d+)[\t ]*(h)?/i);
    if ( matches !== null ) {
        let v = Math.max(parseInt(matches[1], 10), 1);
        if ( matches[2] !== undefined ) {
            v = Math.ceil(v / 24);
        }
        if ( v !== listEntry.updateAfter ) {
            this.assets.registerAssetSource(assetKey, { updateAfter: v });
        }
    }
};

/******************************************************************************/

µBlock.removeCompiledFilterList = function(assetKey) {
    this.assets.remove('compiled/' + assetKey);
};

µBlock.removeFilterList = function(assetKey) {
    this.removeCompiledFilterList(assetKey);
    this.assets.remove(assetKey);
};

/******************************************************************************/

µBlock.compileFilters = function(rawText) {
    let writer = new this.CompiledLineIO.Writer();

    // Useful references:
    //    https://adblockplus.org/en/filter-cheatsheet
    //    https://adblockplus.org/en/filters
    let staticNetFilteringEngine = this.staticNetFilteringEngine,
        staticExtFilteringEngine = this.staticExtFilteringEngine,
        reIsWhitespaceChar = /\s/,
        reMaybeLocalIp = /^[\d:f]/,
        reIsLocalhostRedirect = /\s+(?:0\.0\.0\.0|broadcasthost|localhost|local|ip6-\w+)\b/,
        reLocalIp = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1|fe80::1%lo0)/,
        lineIter = new this.LineIterator(this.processDirectives(rawText));

    while ( lineIter.eot() === false ) {
        // rhill 2014-04-18: The trim is important here, as without it there
        // could be a lingering `\r` which would cause problems in the
        // following parsing code.
        let line = lineIter.next().trim();
        if ( line.length === 0 ) { continue; }

        // Strip comments
        let c = line.charAt(0);
        if ( c === '!' || c === '[' ) { continue; }

        // Parse or skip cosmetic filters
        // All cosmetic filters are caught here
        if ( staticExtFilteringEngine.compile(line, writer) ) { continue; }

        // Whatever else is next can be assumed to not be a cosmetic filter

        // Most comments start in first column
        if ( c === '#' ) { continue; }

        // Catch comments somewhere on the line
        // Remove:
        //   ... #blah blah blah
        //   ... # blah blah blah
        // Don't remove:
        //   ...#blah blah blah
        // because some ABP filters uses the `#` character (URL fragment)
        let pos = line.indexOf('#');
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
            if ( reIsLocalhostRedirect.test(line) ) { continue; }
            line = line.replace(reLocalIp, '').trim();
        }

        if ( line.length === 0 ) { continue; }

        staticNetFilteringEngine.compile(line, writer);
    }

    return writer.toString();
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1395
//   Added `firstparty` argument: to avoid discarding cosmetic filters when
//   applying 1st-party filters.

µBlock.applyCompiledFilters = function(rawText, firstparty) {
    if ( rawText === '' ) { return; }
    let reader = new this.CompiledLineIO.Reader(rawText);
    this.staticNetFilteringEngine.fromCompiledContent(reader);
    this.staticExtFilteringEngine.fromCompiledContent(reader, {
        skipGenericCosmetic: this.userSettings.ignoreGenericCosmeticFilters,
        skipCosmetic: !firstparty && !this.userSettings.parseAllABPHideFilters
    });
};

/******************************************************************************/

// https://github.com/AdguardTeam/AdguardBrowserExtension/issues/917

µBlock.processDirectives = function(content) {
    var reIf = /^!#(if|endif)\b([^\n]*)/gm,
        parts = [],
        beg = 0, depth = 0, discard = false;
    while ( beg < content.length ) {
        var match = reIf.exec(content);
        if ( match === null ) { break; }
        if ( match[1] === 'if' ) {
            var expr = match[2].trim();
            var target = expr.startsWith('!');
            if ( target ) { expr = expr.slice(1); }
            var token = this.processDirectives.tokens.get(expr);
            if (
                depth === 0 &&
                discard === false &&
                token !== undefined &&
                vAPI.webextFlavor.soup.has(token) === target
            ) {
                parts.push(content.slice(beg, match.index));
                discard = true;
            }
            depth += 1;
            continue;
        }
        depth -= 1;
        if ( depth < 0 ) { break; }
        if ( depth === 0 && discard ) {
            beg = match.index + match[0].length + 1;
            discard = false;
        }
    }
    if ( depth === 0 && parts.length !== 0 ) {
        parts.push(content.slice(beg));
        content = parts.join('\n');
    }
    return content.trim();
};

µBlock.processDirectives.tokens = new Map([
    [ 'ext_ublock', 'ublock' ],
    [ 'env_chromium', 'chromium' ],
    [ 'env_edge', 'edge' ],
    [ 'env_firefox', 'firefox' ],
    [ 'env_mobile', 'mobile' ],
    [ 'env_safari', 'safari' ],
    [ 'cap_html_filtering', 'html_filtering' ],
    [ 'cap_user_stylesheet', 'user_stylesheet' ]
]);

/******************************************************************************/

µBlock.loadRedirectResources = function(updatedContent) {
    var µb = this,
        content = '';

    var onDone = function() {
        µb.redirectEngine.resourcesFromString(content);
    };

    var onUserResourcesLoaded = function(details) {
        if ( details.content !== '' ) {
            content += '\n\n' + details.content;
        }
        onDone();
    };

    var onResourcesLoaded = function(details) {
        if ( details.content !== '' ) {
            content = details.content;
        }
        if ( µb.hiddenSettings.userResourcesLocation === 'unset' ) {
            return onDone();
        }
        µb.assets.fetchText(µb.hiddenSettings.userResourcesLocation, onUserResourcesLoaded);
    };

    if ( typeof updatedContent === 'string' && updatedContent.length !== 0 ) {
        return onResourcesLoaded({ content: updatedContent });
    }

    var onSelfieReady = function(success) {
        if ( success !== true ) {
            µb.assets.get('ublock-resources', onResourcesLoaded);
        }
    };

    µb.redirectEngine.resourcesFromSelfie(onSelfieReady);
};

/******************************************************************************/

µBlock.loadPublicSuffixList = function() {
    return new Promise(resolve => {
    // start of executor
    this.assets.get('compiled/' + this.pslAssetKey, details => {
        let selfie;
        try {
            selfie = JSON.parse(details.content);
        } catch (ex) {
        }
        if (
            selfie instanceof Object &&
            publicSuffixList.fromSelfie(selfie)
        ) {
            resolve();
            return;
        }
        this.assets.get(this.pslAssetKey, details => {
            if ( details.content !== '' ) {
                this.compilePublicSuffixList(details.content);
            }
            resolve();
        });
    });
    // end of executor
    });
};

/******************************************************************************/

µBlock.compilePublicSuffixList = function(content) {
    publicSuffixList.parse(content, punycode.toASCII);
    this.assets.put(
        'compiled/' + this.pslAssetKey,
        JSON.stringify(publicSuffixList.toSelfie())
    );
};

/******************************************************************************/

// This is to be sure the selfie is generated in a sane manner: the selfie will
// be generated if the user doesn't change his filter lists selection for
// some set time.

µBlock.selfieManager = (function() {
    let µb = µBlock;
    let timer = null;

    // As of 2018-05-31:
    // JSON.stringify-ing ourselves results in a better baseline
    // memory usage at selfie-load time. For some reasons.

    let create = function() {
        timer = null;
        let selfie = JSON.stringify({
            magic: µb.systemSettings.selfieMagic,
            availableFilterLists: µb.availableFilterLists,
            staticNetFilteringEngine: µb.staticNetFilteringEngine.toSelfie(),
            redirectEngine: µb.redirectEngine.toSelfie(),
            staticExtFilteringEngine: µb.staticExtFilteringEngine.toSelfie()
        });
        µb.cacheStorage.set({ selfie: selfie });
    };

    let load = function(callback) {
        µb.cacheStorage.get('selfie', function(bin) {
            if (
                bin instanceof Object === false ||
                typeof bin.selfie !== 'string'
            ) {
                return callback(false);
            }
            let selfie;
            try {
                selfie = JSON.parse(bin.selfie);
            } catch(ex) {
            }
            if (
                selfie instanceof Object === false ||
                selfie.magic !== µb.systemSettings.selfieMagic
            ) {
                return callback(false);
            }
            µb.availableFilterLists = selfie.availableFilterLists;
            µb.staticNetFilteringEngine.fromSelfie(selfie.staticNetFilteringEngine);
            µb.redirectEngine.fromSelfie(selfie.redirectEngine);
            µb.staticExtFilteringEngine.fromSelfie(selfie.staticExtFilteringEngine);
            callback(true);
        });
    };

    let destroy = function() {
        if ( timer !== null ) {
            clearTimeout(timer);
            timer = null;
        }
        µb.cacheStorage.remove('selfie');
        timer = vAPI.setTimeout(create, µb.selfieAfter);
    };

    return {
        load: load,
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
    // Support for vAPI.adminStorage is optional (webext).
    if ( vAPI.adminStorage instanceof Object === false ) {
        callback();
        return;
    }

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

        // Allows an admin to set their own 'assets.json' file, with their own
        // set of stock assets.
        if ( typeof data.assetsBootstrapLocation === 'string' ) {
            bin.assetsBootstrapLocation = data.assetsBootstrapLocation;
            binNotEmpty = true;
        }

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

        // 'selectedFilterLists' is an array of filter list tokens. Each token
        // is a reference to an asset in 'assets.json'.
        if ( Array.isArray(data.selectedFilterLists) ) {
            bin.selectedFilterLists = data.selectedFilterLists;
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

// https://github.com/gorhill/uBlock/issues/2344
//   Support mutliple locales per filter list.

// https://github.com/gorhill/uBlock/issues/3210
//   Support ability to auto-enable a filter list based on user agent.

µBlock.listMatchesEnvironment = function(details) {
    var re;
    // Matches language?
    if ( typeof details.lang === 'string' ) {
        re = this.listMatchesEnvironment.reLang;
        if ( re === undefined ) {
            re = new RegExp('\\b' + self.navigator.language.slice(0, 2) + '\\b');
            this.listMatchesEnvironment.reLang = re;
        }
        if ( re.test(details.lang) ) { return true; }
    }
    // Matches user agent?
    if ( typeof details.ua === 'string' ) {
        re = new RegExp('\\b' + this.escapeRegex(details.ua) + '\\b', 'i');
        if ( re.test(self.navigator.userAgent) ) { return true; }
    }
    return false;
};

/******************************************************************************/

µBlock.scheduleAssetUpdater = (function() {
    var timer, next = 0;
    return function(updateDelay) {
        if ( timer ) {
            clearTimeout(timer);
            timer = undefined;
        }
        if ( updateDelay === 0 ) {
            next = 0;
            return;
        }
        var now = Date.now();
        // Use the new schedule if and only if it is earlier than the previous
        // one.
        if ( next !== 0 ) {
            updateDelay = Math.min(updateDelay, Math.max(next - now, 0));
        }
        next = now + updateDelay;
        timer = vAPI.setTimeout(function() {
            timer = undefined;
            next = 0;
            var µb = µBlock;
            µb.assets.updateStart({
                delay: µb.hiddenSettings.autoUpdateAssetFetchPeriod * 1000 || 120000
            });
        }, updateDelay);
    };
})();

/******************************************************************************/

µBlock.assetObserver = function(topic, details) {
    // Do not update filter list if not in use.
    if ( topic === 'before-asset-updated' ) {
        if ( details.type === 'filters' ) {
            if (
                this.availableFilterLists.hasOwnProperty(details.assetKey) === false ||
                this.selectedFilterLists.indexOf(details.assetKey) === -1
            ) {
                return;
            }
        }
        // https://github.com/gorhill/uBlock/issues/2594
        if ( details.assetKey === 'ublock-resources' ) {
            if (
                this.hiddenSettings.ignoreRedirectFilters === true &&
                this.hiddenSettings.ignoreScriptInjectFilters === true
            ) {
                return;
            }
        }
        return true;
    }

    // Compile the list while we have the raw version in memory
    if ( topic === 'after-asset-updated' ) {
        var cached = typeof details.content === 'string' && details.content !== '';
        if ( this.availableFilterLists.hasOwnProperty(details.assetKey) ) {
            if ( cached ) {
                if ( this.selectedFilterLists.indexOf(details.assetKey) !== -1 ) {
                    this.extractFilterListMetadata(
                        details.assetKey,
                        details.content
                    );
                    this.assets.put(
                        'compiled/' + details.assetKey,
                        this.compileFilters(details.content)
                    );
                }
            } else {
                this.removeCompiledFilterList(details.assetKey);
            }
        } else if ( details.assetKey === this.pslAssetKey ) {
            if ( cached ) {
                this.compilePublicSuffixList(details.content);
            }
        } else if ( details.assetKey === 'ublock-resources' ) {
            this.redirectEngine.invalidateResourcesSelfie();
            if ( cached ) {
                this.loadRedirectResources(details.content);
            }
        }
        vAPI.messaging.broadcast({
            what: 'assetUpdated',
            key: details.assetKey,
            cached: cached
        });
        // https://github.com/gorhill/uBlock/issues/2585
        // Whenever an asset is overwritten, the current selfie is quite
        // likely no longer valid.
        this.selfieManager.destroy();
        return;
    }

    // Update failed.
    if ( topic === 'asset-update-failed' ) {
        vAPI.messaging.broadcast({
            what: 'assetUpdated',
            key: details.assetKey,
            failed: true
        });
        return;
    }

    // Reload all filter lists if needed.
    if ( topic === 'after-assets-updated' ) {
        if ( details.assetKeys.length !== 0 ) {
            this.loadFilterLists();
        }
        if ( this.userSettings.autoUpdate ) {
            this.scheduleAssetUpdater(this.hiddenSettings.autoUpdatePeriod * 3600000 || 25200000);
        } else {
            this.scheduleAssetUpdater(0);
        }
        vAPI.messaging.broadcast({
            what: 'assetsUpdated',
            assetKeys: details.assetKeys
        });
        return;
    }

    // New asset source became available, if it's a filter list, should we
    // auto-select it?
    if ( topic === 'builtin-asset-source-added' ) {
        if ( details.entry.content === 'filters' ) {
            if (
                details.entry.off !== true ||
                this.listMatchesEnvironment(details.entry)
            ) {
                this.saveSelectedFilterLists([ details.assetKey ], true);
            }
        }
        return;
    }
};

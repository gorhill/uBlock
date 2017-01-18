/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2017 Raymond Hill

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

/* global objectAssign, punycode, publicSuffixList */

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
    // Not all platforms implement this method.
    if ( vAPI.storage.getBytesInUse instanceof Function ) {
        vAPI.storage.getBytesInUse(null, getBytesInUseHandler);
    } else {
        callback();
    }
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
        this.localSettingsLastSaved = Date.now();
        vAPI.storage.set(this.localSettings);
    };

    var onTimeout = function() {
        var µb = µBlock;
        if ( µb.localSettingsLastModified > µb.localSettingsLastSaved ) {
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

// For now, only boolean type is supported.

µBlock.hiddenSettingsFromString = function(raw) {
    var out = objectAssign({}, this.hiddenSettingsDefault),
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
    this.hiddenSettings = out;
    vAPI.localStorage.setItem('hiddenSettings', JSON.stringify(out));
    vAPI.storage.set({ hiddenSettingsString: this.stringFromHiddenSettings() });
};

/******************************************************************************/

µBlock.stringFromHiddenSettings = function() {
    var out = [],
        keys = Object.keys(this.hiddenSettings).sort(),
        key;
    for ( var i = 0; i < keys.length; i++ ) {
        key = keys[i];
        out.push(key + ' ' + this.hiddenSettings[key]);
    }
    return out.join('\n');
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

/*******************************************************************************

    TODO(seamless migration):
    The code related to 'remoteBlacklist' can be removed when I am confident
    all users have moved to a version of uBO which no longer depends on
    the property 'remoteBlacklists, i.e. v1.11 and beyond.

**/

µBlock.loadSelectedFilterLists = function(callback) {
    var µb = this;
    vAPI.storage.get([ 'selectedFilterLists', 'remoteBlacklists' ], function(bin) {
        if ( !bin || !bin.selectedFilterLists && !bin.remoteBlacklists ) {
            return callback();
        }
        var listKeys = [];
        if ( bin.selectedFilterLists ) {
            listKeys = bin.selectedFilterLists;
        }
        if ( bin.remoteBlacklists ) {
            var oldListKeys = µb.newListKeysFromOldData(bin.remoteBlacklists);
            if ( oldListKeys.sort().join() !== listKeys.sort().join() ) {
                listKeys = oldListKeys;
                µb.saveSelectedFilterLists(listKeys);
            }
            // TODO(seamless migration):
            // Uncomment when all have moved to v1.11 and beyond.
            //vAPI.storage.remove('remoteBlacklists');
        }
        callback(listKeys);
    });
};

µBlock.saveSelectedFilterLists = function(listKeys, append) {
    var µb = this;
    var save = function(keys) {
        var bin = {
            selectedFilterLists: keys,
            remoteBlacklists: µb.oldDataFromNewListKeys(keys)
        };
        vAPI.storage.set(bin);
    };
    if ( append ) {
        this.loadSelectedFilterLists(function(keys) {
            listKeys = listKeys.concat(keys || []);
            save(listKeys);
        });
    } else {
        save(listKeys);
    }
};

// TODO(seamless migration):
// Remove when all have moved to v1.11 and beyond.
// >>>>>>>>
µBlock.newListKeysFromOldData = function(oldLists) {
    var aliases = this.assets.listKeyAliases,
        listKeys = [], newKey;
    for ( var oldKey in oldLists ) {
        if ( oldLists[oldKey].off !== true ) {
            newKey = aliases[oldKey];
            listKeys.push(newKey ? newKey : oldKey);
        }
    }
    return listKeys;
};

µBlock.oldDataFromNewListKeys = function(selectedFilterLists) {
    var µb = this,
        remoteBlacklists = {};
    var reverseAliases = Object.keys(this.assets.listKeyAliases).reduce(
        function(a, b) {
            a[µb.assets.listKeyAliases[b]] = b; return a;
        },
        {}
    );
    remoteBlacklists = selectedFilterLists.reduce(
        function(a, b) {
            a[reverseAliases[b] || b] = { off: false };
            return a;
        },
        {}
    );
    remoteBlacklists = Object.keys(µb.assets.listKeyAliases).reduce(
        function(a, b) {
            var aliases = µb.assets.listKeyAliases;
            if (
                b.startsWith('assets/') &&
                aliases[b] !== 'public_suffix_list.dat' &&
                aliases[b] !== 'ublock-resources' &&
                !a[b]
            ) {
                a[b] = { off: true };
            }
            return a;
        },
        remoteBlacklists
    );
    return remoteBlacklists;
};
// <<<<<<<<

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
        µb.cosmeticFilteringEngine.freeze();
        µb.selfieManager.create();
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

µBlock.listKeysFromCustomFilterLists = function(raw) {
    var out = {};
    var reIgnore = /^[!#]|[^0-9A-Za-z!*'();:@&=+$,\/?%#\[\]_.~-]/,
        lineIter = new this.LineIterator(raw),
        location;
    while ( lineIter.eot() === false ) {
        location = lineIter.next().trim();
        if ( location === '' || reIgnore.test(location) ) { continue; }
        out[location] = true;
    }
    return Object.keys(out);
};

/******************************************************************************/

µBlock.autoSelectRegionalFilterLists = function(lists) {
    var lang = self.navigator.language.slice(0, 2),
        selectedListKeys = [],
        list;
    for ( var key in lists ) {
        if ( lists.hasOwnProperty(key) === false ) { continue; }
        list = lists[key];
        if ( list.off !== true ) {
            selectedListKeys.push(key);
            continue;
        }
        if ( list.lang === lang ) {
            selectedListKeys.push(key);
            list.off = false;
        }
    }
    return selectedListKeys;
};

/******************************************************************************/

µBlock.changeExternalFilterLists = function(before, after) {
    var µb = µBlock;
    var onLoaded = function(keys) {
        var fullDict = new Set(keys || []),
            mustSave = false,
            oldKeys = µb.listKeysFromCustomFilterLists(before),
            oldDict = new Set(oldKeys),
            newKeys = µb.listKeysFromCustomFilterLists(after),
            newDict = new Set(newKeys),
            i, key;
        i = oldKeys.length;
        while ( i-- ) {
            key = oldKeys[i];
            if ( fullDict.has(key) && !newDict.has(key) ) {
                fullDict.delete(key);
                mustSave = true;
            }
        }
        i = newKeys.length;
        while ( i-- ) {
            key = newKeys[i];
            if ( !fullDict.has(key) && !oldDict.has(key) ) {
                fullDict.add(key);
                mustSave = true;
            }
        }
        if ( mustSave ) {
            µb.saveSelectedFilterLists(µb.setToArray(fullDict));
        }
    };
    this.loadSelectedFilterLists(onLoaded);
};

/******************************************************************************/

µBlock.getAvailableLists = function(callback) {
    var µb = this,
        oldAvailableLists = {},
        newAvailableLists = {};

    // User filter list.
    newAvailableLists[this.userFiltersPath] = {
        group: 'default',
        title: vAPI.i18n('1pPageName')
    };

    // Custom filter lists.
    var importedListKeys = this.listKeysFromCustomFilterLists(µb.userSettings.externalLists),
        i = importedListKeys.length, listKey, entry;
    while ( i-- ) {
        listKey = importedListKeys[i];
        entry = {
            content: 'filters',
            contentURL: importedListKeys[i],
            external: true,
            group: 'custom',
            submitter: 'user',
            title: ''
        };
        newAvailableLists[listKey] = entry;
        this.assets.registerAssetSource(listKey, entry);
    }

    // Final steps:
    // - reuse existing list metadata if any;
    // - unregister unreferenced imported filter lists if any.
    var finalize = function() {
        var assetKey, newEntry, oldEntry;

        // Reuse existing metadata.
        for ( assetKey in oldAvailableLists ) {
            oldEntry = oldAvailableLists[assetKey];
            newEntry = newAvailableLists[assetKey];
            if ( newEntry === undefined ) {
                µb.removeFilterList(assetKey);
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

    // Selected lists.
    var onSelectedListsLoaded = function(keys) {
        var listKey;
        // No user lists data means use default settings.
        if ( Array.isArray(keys) ) {
            var listKeySet = new Set(keys);
            for ( listKey in newAvailableLists ) {
                if ( newAvailableLists.hasOwnProperty(listKey) ) {
                    newAvailableLists[listKey].off = !listKeySet.has(listKey);
                }
            }
        } else if ( µb.firstInstall ) {
            µb.saveSelectedFilterLists(µb.autoSelectRegionalFilterLists(newAvailableLists));
        }

        finalize();
        callback(newAvailableLists);
    };

    // Built-in filter lists.
    var onBuiltinListsLoaded = function(entries) {
        for ( var assetKey in entries ) {
            if ( entries.hasOwnProperty(assetKey) === false ) { continue; }
            entry = entries[assetKey];
            if ( entry.content !== 'filters' ) { continue; }
            newAvailableLists[assetKey] = objectAssign({}, entry);
        }

        // Load set of currently selected filter lists.
        µb.loadSelectedFilterLists(onSelectedListsLoaded);
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

    var onDone = function() {
        µb.staticNetFilteringEngine.freeze();
        µb.cosmeticFilteringEngine.freeze();
        µb.redirectEngine.freeze();
        vAPI.storage.set({ 'availableFilterLists': µb.availableFilterLists });

        //quickProfiler.stop(0);

        vAPI.messaging.broadcast({ what: 'staticFilteringDataChanged' });

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
        if ( µb.availableFilterLists.hasOwnProperty(path) ) {
            var entry = µb.availableFilterLists[path];
            entry.entryCount = snfe.acceptedCount + cfe.acceptedCount - acceptedCount;
            entry.entryUsedCount = entry.entryCount - (snfe.discardedCount + cfe.discardedCount - discardedCount);
        }
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
        µb.cosmeticFilteringEngine.reset();
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
        compiledPath = 'compiled/' + assetKey;

    var onRawListLoaded = function(details) {
        details.assetKey = assetKey;
        if ( details.content === '' ) {
            callback(details);
            return;
        }
        µb.extractFilterListMetadata(assetKey, details.content);
        details.content = µb.compileFilters(details.content);
        µb.assets.put(compiledPath, details.content);
        callback(details);
    };

    var onCompiledListLoaded = function(details) {
        if ( details.content === '' ) {
            µb.assets.get(assetKey, onRawListLoaded);
            return;
        }
        details.assetKey = assetKey;
        callback(details);
    };

    this.assets.get(compiledPath, onCompiledListLoaded);
};

/******************************************************************************/

µBlock.extractFilterListMetadata = function(assetKey, raw) {
    var listEntry = this.availableFilterLists[assetKey];
    if ( listEntry === undefined ) { return; }
    // Metadata expected to be found at the top of content.
    var head = raw.slice(0, 1024),
        matches, v;
    // https://github.com/gorhill/uBlock/issues/313
    // Always try to fetch the name if this is an external filter list.
    if ( listEntry.title === '' || listEntry.group === 'custom' ) {
        matches = head.match(/(?:^|\n)!\s*Title:([^\n]+)/i);
        if ( matches !== null ) {
            listEntry.title = matches[1].trim();
        }
    }
    // Extract update frequency information
    matches = head.match(/(?:^|\n)![\t ]*Expires:[\t ]*([\d]+)[\t ]*days?/i);
    if ( matches !== null ) {
        v = Math.max(parseInt(matches[1], 10), 2);
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
    var compiledFilters = [];

    // Useful references:
    //    https://adblockplus.org/en/filter-cheatsheet
    //    https://adblockplus.org/en/filters
    var staticNetFilteringEngine = this.staticNetFilteringEngine,
        cosmeticFilteringEngine = this.cosmeticFilteringEngine,
        reIsWhitespaceChar = /\s/,
        reMaybeLocalIp = /^[\d:f]/,
        reIsLocalhostRedirect = /\s+(?:broadcasthost|local|localhost|localhost\.localdomain)(?=\s|$)/,
        reLocalIp = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1|fe80::1%lo0)/,
        line, lineRaw, c, pos,
        lineIter = new this.LineIterator(rawText);

    while ( lineIter.eot() === false ) {
        line = lineRaw = lineIter.next().trim();

        // rhill 2014-04-18: The trim is important here, as without it there
        // could be a lingering `\r` which would cause problems in the
        // following parsing code.

        if ( line.length === 0 ) { continue; }

        // Strip comments
        c = line.charAt(0);
        if ( c === '!' || c === '[' ) { continue; }

        // Parse or skip cosmetic filters
        // All cosmetic filters are caught here
        if ( cosmeticFilteringEngine.compile(line, compiledFilters) ) {
            continue;
        }

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
            if ( reIsLocalhostRedirect.test(line) ) { continue; }
            line = line.replace(reLocalIp, '').trim();
        }

        if ( line.length === 0 ) { continue; }

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

    this.assets.get('ublock-resources', onResourcesLoaded);
};

/******************************************************************************/

µBlock.loadPublicSuffixList = function(callback) {
    var µb = this,
        assetKey = µb.pslAssetKey,
        compiledAssetKey = 'compiled/' + assetKey;

    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }
    var onRawListLoaded = function(details) {
        if ( details.content !== '' ) {
            µb.compilePublicSuffixList(details.content);
        }
        callback();
    };

    var onCompiledListLoaded = function(details) {
        if ( details.content === '' ) {
            µb.assets.get(assetKey, onRawListLoaded);
            return;
        }
        publicSuffixList.fromSelfie(JSON.parse(details.content));
        callback();
    };

    this.assets.get(compiledAssetKey, onCompiledListLoaded);
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
    var µb = µBlock;
    var timer = null;

    var create = function() {
        timer = null;

        var selfie = {
            magic: µb.systemSettings.selfieMagic,
            publicSuffixList: publicSuffixList.toSelfie(),
            availableFilterLists: µb.availableFilterLists,
            staticNetFilteringEngine: µb.staticNetFilteringEngine.toSelfie(),
            redirectEngine: µb.redirectEngine.toSelfie(),
            cosmeticFilteringEngine: µb.cosmeticFilteringEngine.toSelfie()
        };

        vAPI.cacheStorage.set({ selfie: selfie });
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

        vAPI.cacheStorage.remove('selfie');
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
        } else if ( typeof data.filterLists === 'object' ) {
            bin.selectedFilterLists = µb.newListKeysFromOldData(data.filterLists);
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
        if (
            this.availableFilterLists.hasOwnProperty(details.assetKey) &&
            this.availableFilterLists[details.assetKey].off === true
        ) {
            return false;
        }
        return;
    }

    // Compile the list while we have the raw version in memory
    if ( topic === 'after-asset-updated' ) {
        var cached = typeof details.content === 'string' && details.content !== '';
        if ( this.availableFilterLists.hasOwnProperty(details.assetKey) ) {
            if ( cached ) {
                if ( this.availableFilterLists[details.assetKey].off !== true ) {
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
            if ( cached ) {
                this.redirectEngine.resourcesFromString(details.content);
            }
        }
        vAPI.messaging.broadcast({
            what: 'assetUpdated',
            key: details.assetKey,
            cached: cached
            
        });
        return;
    }

    // Reload all filter lists if needed.
    if ( topic === 'after-assets-updated' ) {
        if ( details.assetKeys.length !== 0 ) {
            this.loadFilterLists();
        }
        if ( this.userSettings.autoUpdate ) {
            this.scheduleAssetUpdater(this.hiddenSettings.assetAutoUpdatePeriod * 3600000 || 25200000);
        } else {
            this.scheduleAssetUpdater(0);
        }
        return;
    }
};

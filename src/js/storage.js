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

    const process = count => {
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
        navigator.storage instanceof Object &&
        navigator.storage.estimate instanceof Function
    ) {
        countdown += 1;
        navigator.storage.estimate().then(estimate => {
            process(estimate.usage);
        });
    }
    if ( countdown === 0 ) {
        callback();
    }
};

/******************************************************************************/

µBlock.saveLocalSettings = (function() {
    const saveAfter = 4 * 60 * 1000;

    const onTimeout = ( ) => {
        const µb = µBlock;
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
    return new Promise(resolve => {
    // >>>> start of executor

    vAPI.storage.get('hiddenSettings', bin => {
        if ( bin instanceof Object === false ) {
            return resolve();
        }
        const hs = bin.hiddenSettings;
        if ( hs instanceof Object ) {
            const hsDefault = this.hiddenSettingsDefault;
            for ( const key in hsDefault ) {
                if (
                    hsDefault.hasOwnProperty(key) &&
                    hs.hasOwnProperty(key) &&
                    typeof hs[key] === typeof hsDefault[key]
                ) {
                    this.hiddenSettings[key] = hs[key];
                }
            }
            if ( typeof this.hiddenSettings.suspendTabsUntilReady === 'boolean' ) {
                this.hiddenSettings.suspendTabsUntilReady =
                    this.hiddenSettings.suspendTabsUntilReady
                        ? 'yes'
                        : 'unset';
            }
        }
        if ( vAPI.localStorage.getItem('immediateHiddenSettings') === null ) {
            this.saveImmediateHiddenSettings();
        }
        self.log.verbosity = this.hiddenSettings.consoleLogLevel;
        resolve();
    });

    // <<<< end of executor
    });
};

// Note: Save only the settings which values differ from the default ones.
// This way the new default values in the future will properly apply for those
// which were not modified by the user.

µBlock.saveHiddenSettings = function(callback) {
    const bin = { hiddenSettings: {} };
    for ( const prop in this.hiddenSettings ) {
        if (
            this.hiddenSettings.hasOwnProperty(prop) &&
            this.hiddenSettings[prop] !== this.hiddenSettingsDefault[prop]
        ) {
            bin.hiddenSettings[prop] = this.hiddenSettings[prop];
        }
    }
    vAPI.storage.set(bin, callback);
    this.saveImmediateHiddenSettings();
    self.log.verbosity = this.hiddenSettings.consoleLogLevel;
};

/******************************************************************************/

µBlock.hiddenSettingsFromString = function(raw) {
    const out = Object.assign({}, this.hiddenSettingsDefault);
    const lineIter = new this.LineIterator(raw);
    while ( lineIter.eot() === false ) {
        const line = lineIter.next();
        const matches = /^\s*(\S+)\s+(.+)$/.exec(line);
        if ( matches === null || matches.length !== 3 ) { continue; }
        const name = matches[1];
        if ( out.hasOwnProperty(name) === false ) { continue; }
        const value = matches[2];
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
    const out = [];
    for ( const key of Object.keys(this.hiddenSettings).sort() ) {
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
                  consoleLogLevel: this.hiddenSettings.consoleLogLevel,
               disableWebAssembly: this.hiddenSettings.disableWebAssembly,
            suspendTabsUntilReady: this.hiddenSettings.suspendTabsUntilReady,
        })
    );
};

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

µBlock.loadSelectedFilterLists = function() {
    return new Promise(resolve => {
    // >>>> start of executor

    vAPI.storage.get('selectedFilterLists', bin => {
        // Select default filter lists if first-time launch.
        if (
            bin instanceof Object === false ||
            Array.isArray(bin.selectedFilterLists) === false
        ) {
            this.assets.metadata(availableLists => {
                this.saveSelectedFilterLists(
                    this.autoSelectRegionalFilterLists(availableLists)
                );
                resolve();
            });
            return;
        }
        this.selectedFilterLists = bin.selectedFilterLists;
        resolve();
    });

    // <<<< end of executor
    });
};

µBlock.saveSelectedFilterLists = function(newKeys, append, callback) {
    if ( typeof append === 'function' ) {
        callback = append;
        append = false;
    }
    const oldKeys = this.selectedFilterLists.slice();
    if ( append ) {
        newKeys = newKeys.concat(oldKeys);
    }
    const newSet = new Set(newKeys);
    // Purge unused filter lists from cache.
    for ( let i = 0, n = oldKeys.length; i < n; i++ ) {
        if ( newSet.has(oldKeys[i]) === false ) {
            this.removeFilterList(oldKeys[i]);
        }
    }
    newKeys = Array.from(newSet);
    this.selectedFilterLists = newKeys;
    vAPI.storage.set({ selectedFilterLists: newKeys }, callback);
};

/******************************************************************************/

µBlock.applyFilterListSelection = function(details, callback) {
    let selectedListKeySet = new Set(this.selectedFilterLists);
    let externalLists = this.userSettings.externalLists;

    // Filter lists to select
    if ( Array.isArray(details.toSelect) ) {
        if ( details.merge ) {
            for ( let i = 0, n = details.toSelect.length; i < n; i++ ) {
                selectedListKeySet.add(details.toSelect[i]);
            }
        } else {
            selectedListKeySet = new Set(details.toSelect);
        }
    }

    // Imported filter lists to remove
    if ( Array.isArray(details.toRemove) ) {
        const removeURLFromHaystack = (haystack, needle) => {
            return haystack.replace(
                new RegExp(
                    '(^|\\n)' +
                    this.escapeRegex(needle) +
                    '(\\n|$)', 'g'),
                '\n'
            ).trim();
        };
        for ( let i = 0, n = details.toRemove.length; i < n; i++ ) {
            const assetKey = details.toRemove[i];
            selectedListKeySet.delete(assetKey);
            externalLists = removeURLFromHaystack(externalLists, assetKey);
            this.removeFilterList(assetKey);
        }
    }

    // Filter lists to import
    if ( typeof details.toImport === 'string' ) {
        // https://github.com/gorhill/uBlock/issues/1181
        //   Try mapping the URL of an imported filter list to the assetKey
        //   of an existing stock list.
        const assetKeyFromURL = url => {
            const needle = url.replace(/^https?:/, '');
            const assets = this.availableFilterLists;
            for ( const assetKey in assets ) {
                const asset = assets[assetKey];
                if ( asset.content !== 'filters' ) { continue; }
                if ( typeof asset.contentURL === 'string' ) {
                    if ( asset.contentURL.endsWith(needle) ) { return assetKey; }
                    continue;
                }
                if ( Array.isArray(asset.contentURL) === false ) { continue; }
                for ( let i = 0, n = asset.contentURL.length; i < n; i++ ) {
                    if ( asset.contentURL[i].endsWith(needle) ) {
                        return assetKey;
                    }
                }
            }
            return url;
        };
        const importedSet = new Set(this.listKeysFromCustomFilterLists(externalLists));
        const toImportSet = new Set(this.listKeysFromCustomFilterLists(details.toImport));
        for ( const urlKey of toImportSet ) {
            if ( importedSet.has(urlKey) ) { continue; }
            const assetKey = assetKeyFromURL(urlKey);
            if ( assetKey === urlKey ) {
                importedSet.add(urlKey);
            }
            selectedListKeySet.add(assetKey);
        }
        externalLists = Array.from(importedSet).sort().join('\n');
    }

    const result = Array.from(selectedListKeySet);
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
    const out = new Set();
    const reIgnore = /^[!#]/;
    const reValid = /^[a-z-]+:\/\/\S+/;
    const lineIter = new this.LineIterator(raw);
    while ( lineIter.eot() === false ) {
        const location = lineIter.next().trim();
        if ( reIgnore.test(location) || !reValid.test(location) ) { continue; }
        out.add(location);
    }
    return Array.from(out);
};

/******************************************************************************/

µBlock.saveUserFilters = function(content, callback) {
    // https://github.com/gorhill/uBlock/issues/1022
    //   Be sure to end with an empty line.
    content = content.trim();
    if ( content !== '' ) { content += '\n'; }
    this.assets.put(this.userFiltersPath, content, callback);
    this.removeCompiledFilterList(this.userFiltersPath);
};

µBlock.loadUserFilters = function(callback) {
    return this.assets.get(this.userFiltersPath, callback);
};

/******************************************************************************/

µBlock.appendUserFilters = function(filters, options) {
    filters = filters.trim();
    if ( filters.length === 0 ) { return; }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/372
    //   Auto comment using user-defined template.
    let comment = '';
    if (
        options instanceof Object &&
        options.autoComment === true &&
        this.hiddenSettings.autoCommentFilterTemplate.indexOf('{{') !== -1
    ) {
        const d = new Date();
        comment =
            '! ' +
            this.hiddenSettings.autoCommentFilterTemplate
                .replace('{{date}}', d.toLocaleDateString())
                .replace('{{time}}', d.toLocaleTimeString())
                .replace('{{origin}}', options.origin);
    }

    const onSaved = ( ) => {
        const compiledFilters = this.compileFilters(
            filters,
            { assetKey: this.userFiltersPath }
        );
        const snfe = this.staticNetFilteringEngine;
        const cfe = this.cosmeticFilteringEngine;
        const acceptedCount = snfe.acceptedCount + cfe.acceptedCount;
        const discardedCount = snfe.discardedCount + cfe.discardedCount;
        this.applyCompiledFilters(compiledFilters, true);
        const entry = this.availableFilterLists[this.userFiltersPath];
        const deltaEntryCount =
            snfe.acceptedCount +
            cfe.acceptedCount - acceptedCount;
        const deltaEntryUsedCount =
            deltaEntryCount -
            (snfe.discardedCount + cfe.discardedCount - discardedCount);
        entry.entryCount += deltaEntryCount;
        entry.entryUsedCount += deltaEntryUsedCount;
        vAPI.storage.set({ 'availableFilterLists': this.availableFilterLists });
        this.staticNetFilteringEngine.freeze();
        this.redirectEngine.freeze();
        this.staticExtFilteringEngine.freeze();
        this.selfieManager.destroy();
    };

    const onLoaded = details => {
        if ( details.error ) { return; }
        // The comment, if any, will be applied if and only if it is different
        // from the last comment found in the user filter list.
        if ( comment !== '' ) {
            const pos = details.content.lastIndexOf(comment);
            if (
                pos === -1 ||
                details.content.indexOf('\n!', pos + 1) !== -1
            ) {
                filters = '\n' + comment + '\n' + filters;
            }
        }
        // https://github.com/chrisaljoudi/uBlock/issues/976
        //   If we reached this point, the filter quite probably needs to be
        //   added for sure: do not try to be too smart, trying to avoid
        //   duplicates at this point may lead to more issues.
        this.saveUserFilters(details.content.trim() + '\n' + filters, onSaved);
    };

    this.loadUserFilters(onLoaded);
};

/******************************************************************************/

µBlock.autoSelectRegionalFilterLists = function(lists) {
    const selectedListKeys = [ this.userFiltersPath ];
    for ( const key in lists ) {
        if ( lists.hasOwnProperty(key) === false ) { continue; }
        const list = lists[key];
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
    let oldAvailableLists = {},
        newAvailableLists = {};

    // User filter list.
    newAvailableLists[this.userFiltersPath] = {
        group: 'user',
        title: vAPI.i18n('1pPageName')
    };

    // Custom filter lists.
    const importedListKeys = this.listKeysFromCustomFilterLists(
        this.userSettings.externalLists
    );
    for ( const listKey of importedListKeys ) {
        const entry = {
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
    const customListFromStockList = assetKey => {
        const oldEntry = oldAvailableLists[assetKey];
        if ( oldEntry === undefined || oldEntry.off === true ) { return; }
        let listURL = oldEntry.contentURL;
        if ( Array.isArray(listURL) ) {
            listURL = listURL[0];
        }
        const newEntry = {
            content: 'filters',
            contentURL: listURL,
            external: true,
            group: 'custom',
            submitter: 'user',
            title: oldEntry.title || ''
        };
        newAvailableLists[listURL] = newEntry;
        this.assets.registerAssetSource(listURL, newEntry);
        importedListKeys.push(listURL);
        this.userSettings.externalLists += '\n' + listURL;
        this.userSettings.externalLists = this.userSettings.externalLists.trim();
        vAPI.storage.set({ externalLists: this.userSettings.externalLists });
        this.saveSelectedFilterLists([ listURL ], true);
    };

    // Final steps:
    // - reuse existing list metadata if any;
    // - unregister unreferenced imported filter lists if any.
    const finalize = ( ) => {
        // Reuse existing metadata.
        for ( const assetKey in oldAvailableLists ) {
            const oldEntry = oldAvailableLists[assetKey];
            const newEntry = newAvailableLists[assetKey];
            // List no longer exists. If a stock list, try to convert to
            // imported list if it was selected.
            if ( newEntry === undefined ) {
                this.removeFilterList(assetKey);
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
        const dict = new Set(importedListKeys);
        for ( const assetKey in newAvailableLists ) {
            const newEntry = newAvailableLists[assetKey];
            if ( newEntry.submitter !== 'user' ) { continue; }
            if ( dict.has(assetKey) ) { continue; }
            delete newAvailableLists[assetKey];
            this.assets.unregisterAssetSource(assetKey);
            this.removeFilterList(assetKey);
        }
    };

    // Built-in filter lists loaded.
    const onBuiltinListsLoaded = entries => {
        for ( const assetKey in entries ) {
            if ( entries.hasOwnProperty(assetKey) === false ) { continue; }
            const entry = entries[assetKey];
            if ( entry.content !== 'filters' ) { continue; }
            newAvailableLists[assetKey] = Object.assign({}, entry);
        }

        // Load set of currently selected filter lists.
        const listKeySet = new Set(this.selectedFilterLists);
        for ( const listKey in newAvailableLists ) {
            if ( newAvailableLists.hasOwnProperty(listKey) ) {
                newAvailableLists[listKey].off = !listKeySet.has(listKey);
            }
        }

        finalize();
        callback(newAvailableLists);
    };

    // Available lists previously computed.
    const onOldAvailableListsLoaded = bin => {
        oldAvailableLists = bin && bin.availableFilterLists || {};
        this.assets.metadata(onBuiltinListsLoaded);
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

    const loadedListKeys = [];
    let filterlistsCount = 0;

    if ( typeof callback !== 'function' ) {
        callback = this.noopFunc;
    }

    const onDone = ( ) => {
        this.staticNetFilteringEngine.freeze();
        this.staticExtFilteringEngine.freeze();
        this.redirectEngine.freeze();
        vAPI.storage.set({ 'availableFilterLists': this.availableFilterLists });

        vAPI.messaging.broadcast({
            what: 'staticFilteringDataChanged',
            parseCosmeticFilters: this.userSettings.parseAllABPHideFilters,
            ignoreGenericCosmeticFilters: this.userSettings.ignoreGenericCosmeticFilters,
            listKeys: loadedListKeys
        });

        callback();

        this.selfieManager.destroy();
        this.lz4Codec.relinquish();

        this.loadingFilterLists = false;
    };

    const applyCompiledFilters = (assetKey, compiled) => {
        const snfe = this.staticNetFilteringEngine;
        const sxfe = this.staticExtFilteringEngine;
        let acceptedCount = snfe.acceptedCount + sxfe.acceptedCount,
            discardedCount = snfe.discardedCount + sxfe.discardedCount;
        this.applyCompiledFilters(compiled, assetKey === this.userFiltersPath);
        if ( this.availableFilterLists.hasOwnProperty(assetKey) ) {
            const entry = this.availableFilterLists[assetKey];
            entry.entryCount = snfe.acceptedCount + sxfe.acceptedCount -
                acceptedCount;
            entry.entryUsedCount = entry.entryCount -
                (snfe.discardedCount + sxfe.discardedCount - discardedCount);
        }
        loadedListKeys.push(assetKey);
    };

    const onCompiledListLoaded = details => {
        applyCompiledFilters(details.assetKey, details.content);
        filterlistsCount -= 1;
        if ( filterlistsCount === 0 ) {
            onDone();
        }
    };

    const onFilterListsReady = lists => {
        this.availableFilterLists = lists;

        this.redirectEngine.reset();
        this.staticExtFilteringEngine.reset();
        this.staticNetFilteringEngine.reset();
        this.selfieManager.destroy();
        this.staticFilteringReverseLookup.resetLists();

        // We need to build a complete list of assets to pull first: this is
        // because it *may* happens that some load operations are synchronous:
        // This happens for assets which do not exist, ot assets with no
        // content.
        const toLoad = [];
        for ( const assetKey in lists ) {
            if ( lists.hasOwnProperty(assetKey) === false ) { continue; }
            if ( lists[assetKey].off ) { continue; }
            toLoad.push(assetKey);
        }
        filterlistsCount = toLoad.length;
        if ( filterlistsCount === 0 ) {
            return onDone();
        }

        let i = toLoad.length;
        while ( i-- ) {
            this.getCompiledFilterList(toLoad[i], onCompiledListLoaded);
        }
    };

    this.getAvailableLists(onFilterListsReady);
    this.loadRedirectResources();
};

/******************************************************************************/

µBlock.getCompiledFilterList = function(assetKey, callback) {
    const compiledPath = 'compiled/' + assetKey;
    let rawContent;

    const onCompiledListLoaded2 = details => {
        if ( details.content === '' ) {
            details.content = this.compileFilters(
                rawContent,
                { assetKey: assetKey }
            );
            this.assets.put(compiledPath, details.content);
        }
        rawContent = undefined;
        details.assetKey = assetKey;
        callback(details);
    };

    const onRawListLoaded = details => {
        if ( details.content === '' ) {
            details.assetKey = assetKey;
            callback(details);
            return;
        }
        this.extractFilterListMetadata(assetKey, details.content);
        // Fectching the raw content may cause the compiled content to be
        // generated somewhere else in uBO, hence we try one last time to
        // fetch the compiled content in case it has become available.
        rawContent = details.content;
        this.assets.get(compiledPath, onCompiledListLoaded2);
    };

    const onCompiledListLoaded1 = details => {
        if ( details.content === '' ) {
            this.assets.get(assetKey, onRawListLoaded);
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
    const listEntry = this.availableFilterLists[assetKey];
    if ( listEntry === undefined ) { return; }
    // Metadata expected to be found at the top of content.
    const head = raw.slice(0, 1024);
    // https://github.com/gorhill/uBlock/issues/313
    // Always try to fetch the name if this is an external filter list.
    if ( listEntry.title === '' || listEntry.group === 'custom' ) {
        const matches = head.match(/(?:^|\n)(?:!|# )[\t ]*Title[\t ]*:([^\n]+)/i);
        if ( matches !== null ) {
            // https://bugs.chromium.org/p/v8/issues/detail?id=2869
            //   orphanizeString is to work around String.slice()
            //   potentially causing the whole raw filter list to be held in
            //   memory just because we cut out the title as a substring.
            listEntry.title = this.orphanizeString(matches[1].trim());
        }
    }
    // Extract update frequency information
    const matches = head.match(/(?:^|\n)(?:!|# )[\t ]*Expires[\t ]*:[\t ]*(\d+)[\t ]*(h)?/i);
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

µBlock.compileFilters = function(rawText, details) {
    let writer = new this.CompiledLineIO.Writer();

    // Populate the writer with information potentially useful to the
    // client compilers.
    if ( details ) {
        if ( details.assetKey ) {
            writer.properties.set('assetKey', details.assetKey);
        }
    }

    // Useful references:
    //    https://adblockplus.org/en/filter-cheatsheet
    //    https://adblockplus.org/en/filters
    const staticNetFilteringEngine = this.staticNetFilteringEngine;
    const staticExtFilteringEngine = this.staticExtFilteringEngine;
    const reIsWhitespaceChar = /\s/;
    const reMaybeLocalIp = /^[\d:f]/;
    const reIsLocalhostRedirect = /\s+(?:0\.0\.0\.0|broadcasthost|localhost|local|ip6-\w+)\b/;
    const reLocalIp = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1|fe80::1%lo0)/;
    const lineIter = new this.LineIterator(this.processDirectives(rawText));

    while ( lineIter.eot() === false ) {
        // rhill 2014-04-18: The trim is important here, as without it there
        // could be a lingering `\r` which would cause problems in the
        // following parsing code.
        let line = lineIter.next().trim();
        if ( line.length === 0 ) { continue; }

        // Strip comments
        const c = line.charAt(0);
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
        const pos = line.indexOf('#');
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
    const reIf = /^!#(if|endif)\b([^\n]*)/gm;
    const stack = [];
    const shouldDiscard = ( ) => stack.some(v => v);
    const parts = [];
    let  beg = 0, discard = false;

    while ( beg < content.length ) {
        const match = reIf.exec(content);
        if ( match === null ) { break; }

        switch ( match[1] ) {
        case 'if':
            let expr = match[2].trim();
            const target = expr.charCodeAt(0) === 0x21 /* '!' */;
            if ( target ) { expr = expr.slice(1); }
            const token = this.processDirectives.tokens.get(expr);
            const startDiscard =
                token !== undefined &&
                vAPI.webextFlavor.soup.has(token) === target;
            if ( discard === false && startDiscard ) {
                parts.push(content.slice(beg, match.index));
                discard = true;
            }
            stack.push(startDiscard);
            break;

        case 'endif':
            stack.pop();
            const stopDiscard = shouldDiscard() === false;
            if ( discard && stopDiscard ) {
                beg = match.index + match[0].length + 1;
                discard = false;
            }
            break;

        default:
            break;
        }
    }

    if ( stack.length === 0 && parts.length !== 0 ) {
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

µBlock.loadRedirectResources = function() {
    return this.redirectEngine.resourcesFromSelfie().then(success => {
        if ( success === true ) { return; }

        const fetchPromises = [ this.assets.get('ublock-resources') ];

        const userResourcesLocation = this.hiddenSettings.userResourcesLocation;
        if ( userResourcesLocation !== 'unset' ) {
            for ( const url of userResourcesLocation.split(/\s+/) ) {
                fetchPromises.push(this.assets.fetchText(url));
            }
        }

        return Promise.all(fetchPromises);
    }).then(results => {
        if ( Array.isArray(results) === false ) { return; }

        let content = '';

        for ( const result of results ) {
            if (
                result instanceof Object === false ||
                typeof result.content !== 'string' ||
                result.content === ''
            ) {
                continue;
            }
            content += '\n\n' + result.content;
        }

        this.redirectEngine.resourcesFromString(content);
    });
};

/******************************************************************************/

µBlock.loadPublicSuffixList = function() {
    if ( this.hiddenSettings.disableWebAssembly === false ) {
        publicSuffixList.enableWASM();
    }

    return this.assets.get(
        'compiled/' + this.pslAssetKey
    ).then(details =>
        publicSuffixList.fromSelfie(details.content, µBlock.base64)
    ).catch(reason => {
        console.info(reason);
        return false;
    }).then(success => {
        if ( success ) { return; }
        return this.assets.get(this.pslAssetKey, details => {
            if ( details.content !== '' ) {
                this.compilePublicSuffixList(details.content);
            }
        });
    });
};

µBlock.compilePublicSuffixList = function(content) {
    publicSuffixList.parse(content, punycode.toASCII);
    this.assets.put(
        'compiled/' + this.pslAssetKey,
        publicSuffixList.toSelfie(µBlock.base64)
    );
};

/******************************************************************************/

// This is to be sure the selfie is generated in a sane manner: the selfie will
// be generated if the user doesn't change his filter lists selection for
// some set time.

µBlock.selfieManager = (function() {
    const µb = µBlock;
    let timer;

    // As of 2018-05-31:
    //   JSON.stringify-ing ourselves results in a better baseline
    //   memory usage at selfie-load time. For some reasons.

    const create = function() {
        Promise.all([
            µb.assets.put(
                'selfie/main',
                JSON.stringify({
                    magic: µb.systemSettings.selfieMagic,
                    availableFilterLists: µb.availableFilterLists,
                })
            ),
            µb.redirectEngine.toSelfie('selfie/redirectEngine'),
            µb.staticExtFilteringEngine.toSelfie('selfie/staticExtFilteringEngine'),
            µb.staticNetFilteringEngine.toSelfie('selfie/staticNetFilteringEngine'),
        ]).then(( ) => {
            µb.lz4Codec.relinquish();
        });
    };

    const load = function() {
        return Promise.all([
            µb.assets.get('selfie/main').then(details => {
                if (
                    details instanceof Object === false ||
                    typeof details.content !== 'string' ||
                    details.content === ''
                ) {
                    return false;
                }
                let selfie;
                try {
                    selfie = JSON.parse(details.content);
                } catch(ex) {
                }
                if (
                    selfie instanceof Object === false ||
                    selfie.magic !== µb.systemSettings.selfieMagic
                ) {
                    return false;
                }
                µb.availableFilterLists = selfie.availableFilterLists;
                return true;
            }),
            µb.redirectEngine.fromSelfie('selfie/redirectEngine'),
            µb.staticExtFilteringEngine.fromSelfie('selfie/staticExtFilteringEngine'),
            µb.staticNetFilteringEngine.fromSelfie('selfie/staticNetFilteringEngine'),
        ]).then(results =>
            results.reduce((acc, v) => acc && v, true)
        ).catch(reason => {
            log.info(reason);
            return false;
        });
    };

    const destroy = function() {
        if ( timer !== undefined ) {
            clearTimeout(timer);
            timer = undefined;
        }
        µb.cacheStorage.remove('selfie'); // TODO: obsolete, remove eventually.
        µb.assets.remove(/^selfie\//);
        timer = vAPI.setTimeout(( ) => {
            timer = undefined;
            create();
        }, µb.hiddenSettings.selfieAfter * 60000);
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

µBlock.restoreAdminSettings = function() {
    return new Promise(resolve => {
    // >>>> start of executor

    if ( vAPI.adminStorage instanceof Object === false ) {
        return resolve();
    }

    vAPI.adminStorage.getItem('adminSettings', json => {
        let data;
        if ( typeof json === 'string' && json !== '' ) {
            try {
                data = JSON.parse(json);
            } catch (ex) {
                console.error(ex);
            }
        }

        if ( data instanceof Object === false ) {
            return resolve();
        }

        const bin = {};
        let binNotEmpty = false;

        // Allows an admin to set their own 'assets.json' file, with their own
        // set of stock assets.
        if ( typeof data.assetsBootstrapLocation === 'string' ) {
            bin.assetsBootstrapLocation = data.assetsBootstrapLocation;
            binNotEmpty = true;
        }

        if ( typeof data.userSettings === 'object' ) {
            for ( const name in this.userSettings ) {
                if ( this.userSettings.hasOwnProperty(name) === false ) {
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
            this.assets.put(this.userFiltersPath, data.userFilters);
        }

        resolve();
    });

    // <<<< end of executor
    });
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/2344
//   Support mutliple locales per filter list.

// https://github.com/gorhill/uBlock/issues/3210
//   Support ability to auto-enable a filter list based on user agent.

µBlock.listMatchesEnvironment = function(details) {
    // Matches language?
    if ( typeof details.lang === 'string' ) {
        let re = this.listMatchesEnvironment.reLang;
        if ( re === undefined ) {
            const match = /^[a-z]+/.exec(self.navigator.language);
            if ( match !== null ) {
                re = new RegExp('\\b' + match[0] + '\\b');
                this.listMatchesEnvironment.reLang = re;
            }
        }
        if ( re !== undefined && re.test(details.lang) ) { return true; }
    }
    // Matches user agent?
    if ( typeof details.ua === 'string' ) {
        let re = new RegExp('\\b' + this.escapeRegex(details.ua) + '\\b', 'i');
        if ( re.test(self.navigator.userAgent) ) { return true; }
    }
    return false;
};

/******************************************************************************/

µBlock.scheduleAssetUpdater = (function() {
    let timer, next = 0;

    return function(updateDelay) {
        if ( timer ) {
            clearTimeout(timer);
            timer = undefined;
        }
        if ( updateDelay === 0 ) {
            next = 0;
            return;
        }
        const now = Date.now();
        // Use the new schedule if and only if it is earlier than the previous
        // one.
        if ( next !== 0 ) {
            updateDelay = Math.min(updateDelay, Math.max(next - now, 0));
        }
        next = now + updateDelay;
        timer = vAPI.setTimeout(( ) => {
            timer = undefined;
            next = 0;
            this.assets.updateStart({
                delay: this.hiddenSettings.autoUpdateAssetFetchPeriod * 1000 ||
                       120000
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
        // Skip selfie-related content.
        if ( details.assetKey.startsWith('selfie/') ) { return; }
        const cached = typeof details.content === 'string' &&
                       details.content !== '';
        if ( this.availableFilterLists.hasOwnProperty(details.assetKey) ) {
            if ( cached ) {
                if ( this.selectedFilterLists.indexOf(details.assetKey) !== -1 ) {
                    this.extractFilterListMetadata(
                        details.assetKey,
                        details.content
                    );
                    this.assets.put(
                        'compiled/' + details.assetKey,
                        this.compileFilters(
                            details.content,
                            { assetKey: details.assetKey }
                        )
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
        }
        vAPI.messaging.broadcast({
            what: 'assetUpdated',
            key: details.assetKey,
            cached: cached
        });
        // https://github.com/gorhill/uBlock/issues/2585
        //   Whenever an asset is overwritten, the current selfie is quite
        //   likely no longer valid.
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

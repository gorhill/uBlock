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

µBlock.getBytesInUse = async function() {
    const promises = [];
    let bytesInUse;

    // Not all platforms implement this method.
    promises.push(
        vAPI.storage.getBytesInUse instanceof Function
            ? vAPI.storage.getBytesInUse(null)
            : undefined
    );

    if (
        navigator.storage instanceof Object &&
        navigator.storage.estimate instanceof Function
    ) {
        promises.push(navigator.storage.estimate());
    }

    const results = await Promise.all(promises);

    const processCount = count => {
        if ( typeof count !== 'number' ) { return; }
        if ( bytesInUse === undefined ) { bytesInUse = 0; }
        bytesInUse += count;
        return bytesInUse;
    };

    processCount(results[0]);
    if ( results.length > 1 && results[1] instanceof Object ) {
        processCount(results[1].usage);
    }
    µBlock.storageUsed = bytesInUse;
    return bytesInUse;
};

/******************************************************************************/

µBlock.saveLocalSettings = (( ) => {
    const saveAfter = 4 * 60 * 1000;

    const onTimeout = ( ) => {
        const µb = µBlock;
        if ( µb.localSettingsLastModified > µb.localSettingsLastSaved ) {
            µb.saveLocalSettings();
        }
        vAPI.setTimeout(onTimeout, saveAfter);
    };

    vAPI.setTimeout(onTimeout, saveAfter);

    return function() {
        this.localSettingsLastSaved = Date.now();
        return vAPI.storage.set(this.localSettings);
    };
})();

/******************************************************************************/

µBlock.loadUserSettings = async function() {
    const usDefault = this.userSettingsDefault;

    const results = await Promise.all([
        vAPI.storage.get(Object.assign(usDefault)),
        vAPI.adminStorage.get('userSettings'),
    ]);

    const usUser = results[0] instanceof Object && results[0] ||
                   Object.assign(usDefault);

    if ( Array.isArray(results[1]) ) {
        const adminSettings = results[1];
        for ( const entry of adminSettings ) {
            if ( entry.length < 1 ) { continue; }
            const name = entry[0];
            if ( usDefault.hasOwnProperty(name) === false ) { continue; }
            const value = entry.length < 2
                ? usDefault[name]
                : this.settingValueFromString(usDefault, name, entry[1]);
            if ( value === undefined ) { continue; }
            usUser[name] = usDefault[name] = value;
        }
    }

    return usUser;
};

µBlock.saveUserSettings = function() {
    const toSave = this.getModifiedSettings(
        this.userSettings,
        this.userSettingsDefault
    );

    // `externalLists` will be deprecated in some future, it is kept around
    // for forward compatibility purpose, and should reflect the content of
    // `importedLists`.
    this.userSettings.externalLists =
        this.userSettings.importedLists.join('\n');

    const toRemove = [];
    for ( const key in this.userSettings ) {
        if ( this.userSettings.hasOwnProperty(key) === false ) { continue; }
        if ( toSave.hasOwnProperty(key) ) { continue; }
        toRemove.push(key);
    }
    if ( toRemove.length !== 0 ) {
        vAPI.storage.remove(toRemove);
    }
    vAPI.storage.set(toSave);
};

/******************************************************************************/

// Admin hidden settings have precedence over user hidden settings.

µBlock.loadHiddenSettings = async function() {
    const hsDefault = this.hiddenSettingsDefault;
    const hsAdmin = this.hiddenSettingsAdmin;
    const hsUser = this.hiddenSettings;

    const results = await Promise.all([
        vAPI.adminStorage.get([
            'advancedSettings',
            'disableDashboard',
            'disabledPopupPanelParts',
        ]),
        vAPI.storage.get('hiddenSettings'),
    ]);

    if ( results[0] instanceof Object ) {
        const {
            advancedSettings,
            disableDashboard,
            disabledPopupPanelParts
        } = results[0];
        if ( Array.isArray(advancedSettings) ) {
            for ( const entry of advancedSettings ) {
                if ( entry.length < 1 ) { continue; }
                const name = entry[0];
                if ( hsDefault.hasOwnProperty(name) === false ) { continue; }
                const value = entry.length < 2
                    ? hsDefault[name]
                    : this.hiddenSettingValueFromString(name, entry[1]);
                if ( value === undefined ) { continue; }
                hsDefault[name] = hsAdmin[name] = hsUser[name] = value;
            }
        }
        µBlock.noDashboard = disableDashboard === true;
        if ( Array.isArray(disabledPopupPanelParts) ) {
            const partNameToBit = new Map([
                [  'globalStats', 0b00010 ],
                [   'basicTools', 0b00100 ],
                [   'extraTools', 0b01000 ],
                [ 'overviewPane', 0b10000 ],
            ]);
            let bits = hsDefault.popupPanelDisabledSections;
            for ( const part of disabledPopupPanelParts ) {
                const bit = partNameToBit.get(part);
                if ( bit === undefined ) { continue; }
                bits |= bit;
            }
            hsDefault.popupPanelDisabledSections =
            hsAdmin.popupPanelDisabledSections =
            hsUser.popupPanelDisabledSections = bits;
        }
    }

    const hs = results[1] instanceof Object && results[1].hiddenSettings || {};
    if ( Object.keys(hsAdmin).length === 0 && Object.keys(hs).length === 0 ) {
        return;
    }

    for ( const key in hsDefault ) {
        if ( hsDefault.hasOwnProperty(key) === false ) { continue; }
        if ( hsAdmin.hasOwnProperty(name) ) { continue; }
        if ( typeof hs[key] !== typeof hsDefault[key] ) { continue; }
        this.hiddenSettings[key] = hs[key];
    }
    if ( typeof this.hiddenSettings.suspendTabsUntilReady === 'boolean' ) {
        this.hiddenSettings.suspendTabsUntilReady =
            this.hiddenSettings.suspendTabsUntilReady
                ? 'yes'
                : 'unset';
    }
    this.fireDOMEvent('hiddenSettingsChanged');
};

// Note: Save only the settings which values differ from the default ones.
// This way the new default values in the future will properly apply for
// those which were not modified by the user.

µBlock.saveHiddenSettings = function() {
    vAPI.storage.set({
        hiddenSettings: this.getModifiedSettings(
            this.hiddenSettings,
            this.hiddenSettingsDefault
        )
    });
};

self.addEventListener('hiddenSettingsChanged', ( ) => {
    const µbhs = µBlock.hiddenSettings;
    self.log.verbosity = µbhs.consoleLogLevel;
    vAPI.net.setOptions({
        cnameIgnoreList: µbhs.cnameIgnoreList,
        cnameIgnore1stParty: µbhs.cnameIgnore1stParty,
        cnameIgnoreExceptions: µbhs.cnameIgnoreExceptions,
        cnameIgnoreRootDocument: µbhs.cnameIgnoreRootDocument,
        cnameMaxTTL: µbhs.cnameMaxTTL,
        cnameReplayFullURL: µbhs.cnameReplayFullURL,
        cnameUncloakProxied: µbhs.cnameUncloakProxied,
    });
});

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
        if ( this.hiddenSettingsAdmin.hasOwnProperty(name) ) { continue; }
        const value = this.hiddenSettingValueFromString(name, matches[2]);
        if ( value !== undefined ) {
            out[name] = value;
        }
    }
    return out;
};

µBlock.hiddenSettingValueFromString = function(name, value) {
    if ( typeof name !== 'string' || typeof value !== 'string' ) { return; }
    const hsDefault = this.hiddenSettingsDefault;
    if ( hsDefault.hasOwnProperty(name) === false ) { return; }
    let r;
    switch ( typeof hsDefault[name] ) {
    case 'boolean':
        if ( value === 'true' ) {
            r = true;
        } else if ( value === 'false' ) {
            r = false;
        }
        break;
    case 'string':
        r = value.trim();
        break;
    case 'number':
        if ( value.startsWith('0b') ) {
            r = parseInt(value.slice(2), 2);
        } else if ( value.startsWith('0x') ) {
            r = parseInt(value.slice(2), 16);
        } else {
            r = parseInt(value, 10);
        }
        if ( isNaN(r) ) { r = undefined; }
        break;
    default:
        break;
    }
    return r;
};

µBlock.stringFromHiddenSettings = function() {
    const out = [];
    for ( const key of Object.keys(this.hiddenSettings).sort() ) {
        out.push(key + ' ' + this.hiddenSettings[key]);
    }
    return out.join('\n');
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
        netWhitelist: this.arrayFromWhitelist(this.netWhitelist)
    });
    this.netWhitelistModifyTime = Date.now();
};

/*******************************************************************************

    TODO(seamless migration):
    The code related to 'remoteBlacklist' can be removed when I am confident
    all users have moved to a version of uBO which no longer depends on
    the property 'remoteBlacklists, i.e. v1.11 and beyond.

**/

µBlock.loadSelectedFilterLists = async function() {
    const bin = await vAPI.storage.get('selectedFilterLists');
    if ( bin instanceof Object && Array.isArray(bin.selectedFilterLists) ) {
        this.selectedFilterLists = bin.selectedFilterLists;
        return;
    }

    // https://github.com/gorhill/uBlock/issues/747
    //   Select default filter lists if first-time launch.
    const lists = await this.assets.metadata();
    this.saveSelectedFilterLists(this.autoSelectRegionalFilterLists(lists));
};

µBlock.saveSelectedFilterLists = function(newKeys, append = false) {
    const oldKeys = this.selectedFilterLists.slice();
    if ( append ) {
        newKeys = newKeys.concat(oldKeys);
    }
    const newSet = new Set(newKeys);
    // Purge unused filter lists from cache.
    for ( const oldKey of oldKeys ) {
        if ( newSet.has(oldKey) === false ) {
            this.removeFilterList(oldKey);
        }
    }
    newKeys = Array.from(newSet);
    this.selectedFilterLists = newKeys;
    return vAPI.storage.set({ selectedFilterLists: newKeys });
};

/******************************************************************************/

µBlock.applyFilterListSelection = function(details) {
    let selectedListKeySet = new Set(this.selectedFilterLists);
    let importedLists = this.userSettings.importedLists.slice();

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
        for ( let i = 0, n = details.toRemove.length; i < n; i++ ) {
            const assetKey = details.toRemove[i];
            selectedListKeySet.delete(assetKey);
            const pos = importedLists.indexOf(assetKey);
            if ( pos !== -1 ) {
                importedLists.splice(pos, 1);
            }
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
        const importedSet = new Set(this.listKeysFromCustomFilterLists(importedLists));
        const toImportSet = new Set(this.listKeysFromCustomFilterLists(details.toImport));
        for ( const urlKey of toImportSet ) {
            if ( importedSet.has(urlKey) ) {
                selectedListKeySet.add(urlKey);
                continue;
            }
            const assetKey = assetKeyFromURL(urlKey);
            if ( assetKey === urlKey ) {
                importedSet.add(urlKey);
            }
            selectedListKeySet.add(assetKey);
        }
        importedLists = Array.from(importedSet).sort();
    }

    const result = Array.from(selectedListKeySet);
    if ( importedLists.join() !== this.userSettings.importedLists.join() ) {
        this.userSettings.importedLists = importedLists;
        this.saveUserSettings();
    }
    this.saveSelectedFilterLists(result);
};

/******************************************************************************/

µBlock.listKeysFromCustomFilterLists = function(raw) {
    const urls = typeof raw === 'string'
        ? raw.trim().split(/[\n\r]+/)
        : raw;
    const out = new Set();
    const reIgnore = /^[!#]/;
    const reValid = /^[a-z-]+:\/\/\S+/;
    for ( const url of urls ) {
        if ( reIgnore.test(url) || !reValid.test(url) ) { continue; }
        // Ignore really bad lists.
        if ( this.badLists.get(url) === true ) { continue; }
        out.add(url);
    }
    return Array.from(out);
};

/******************************************************************************/

µBlock.saveUserFilters = function(content) {
    // https://github.com/gorhill/uBlock/issues/1022
    //   Be sure to end with an empty line.
    content = content.trim();
    if ( content !== '' ) { content += '\n'; }
    this.removeCompiledFilterList(this.userFiltersPath);
    return this.assets.put(this.userFiltersPath, content);
};

µBlock.loadUserFilters = function() {
    return this.assets.get(this.userFiltersPath);
};

µBlock.appendUserFilters = async function(filters, options) {
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
        // Date in YYYY-MM-DD format - https://stackoverflow.com/a/50130338
        const ISO8061Date = new Date(d.getTime() +
            (d.getTimezoneOffset()*60000)).toISOString().split('T')[0];
        const url = new URL(options.docURL);
        comment =
            '! ' +
            this.hiddenSettings.autoCommentFilterTemplate
                .replace('{{date}}', ISO8061Date)
                .replace('{{time}}', d.toLocaleTimeString())
                .replace('{{hostname}}', url.hostname)
                .replace('{{origin}}', url.origin)
                .replace('{{url}}', url.href);
    }

    const details = await this.loadUserFilters();
    if ( details.error ) { return; }

    // The comment, if any, will be applied if and only if it is different
    // from the last comment found in the user filter list.
    if ( comment !== '' ) {
        const beg = details.content.lastIndexOf(comment);
        const end = beg === -1 ? -1 : beg + comment.length;
        if (
            end === -1 ||
            details.content.startsWith('\n', end) === false ||
            details.content.includes('\n!', end)
        ) {
            filters = '\n' + comment + '\n' + filters;
        }
    }

    // https://github.com/chrisaljoudi/uBlock/issues/976
    //   If we reached this point, the filter quite probably needs to be
    //   added for sure: do not try to be too smart, trying to avoid
    //   duplicates at this point may lead to more issues.
    await this.saveUserFilters(details.content.trim() + '\n' + filters);

    const compiledFilters = this.compileFilters(filters, {
        assetKey: this.userFiltersPath
    });
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

    // https://www.reddit.com/r/uBlockOrigin/comments/cj7g7m/
    // https://www.reddit.com/r/uBlockOrigin/comments/cnq0bi/
    if ( options.killCache ) {
        browser.webRequest.handlerBehaviorChanged();
    }
};

µBlock.createUserFilters = function(details) {
    this.appendUserFilters(details.filters, details);
    // https://github.com/gorhill/uBlock/issues/1786
    if ( details.docURL === undefined ) { return; }
    this.cosmeticFilteringEngine.removeFromSelectorCache(
        vAPI.hostnameFromURI(details.docURL)
    );
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

µBlock.getAvailableLists = async function() {
    let oldAvailableLists = {},
        newAvailableLists = {};

    // User filter list.
    newAvailableLists[this.userFiltersPath] = {
        group: 'user',
        title: vAPI.i18n('1pPageName')
    };

    // Custom filter lists.
    const importedListKeys = this.listKeysFromCustomFilterLists(
        this.userSettings.importedLists
    );
    for ( const listKey of importedListKeys ) {
        const entry = {
            content: 'filters',
            contentURL: listKey,
            external: true,
            group: 'custom',
            submitter: 'user',
            title: '',
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
        this.userSettings.importedLists.push(listURL.trim());
        this.saveUserSettings();
        this.saveSelectedFilterLists([ listURL ], true);
    };

    const promises = [
        vAPI.storage.get('availableFilterLists'),
        this.assets.metadata(),
        this.badLists.size === 0 ? this.assets.get('ublock-badlists') : false,
    ];

    // Load previously saved available lists -- these contains data
    // computed at run-time, we will reuse this data if possible.
    const [ bin, entries, badlists ] = await Promise.all(promises);

    if ( badlists instanceof Object ) {
        for ( const line of badlists.content.split(/\s*[\n\r]+\s*/) ) {
            if ( line === '' || line.startsWith('#') ) { continue; }
            const fields = line.split(/\s+/);
            const remove = fields.length === 2;
            this.badLists.set(fields[0], remove);
        }
    }

    oldAvailableLists = bin && bin.availableFilterLists || {};

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

    //finalize();
    // Final steps:
    // - reuse existing list metadata if any;
    // - unregister unreferenced imported filter lists if any.
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
    for ( const assetKey in newAvailableLists ) {
        const newEntry = newAvailableLists[assetKey];
        if ( newEntry.submitter !== 'user' ) { continue; }
        if ( importedListKeys.indexOf(assetKey) !== -1 ) { continue; }
        delete newAvailableLists[assetKey];
        this.assets.unregisterAssetSource(assetKey);
        this.removeFilterList(assetKey);
    }

    return newAvailableLists;
};

/******************************************************************************/

µBlock.loadFilterLists = (( ) => {
    const loadedListKeys = [];
    let loadingPromise;
    let t0 = 0;

    const onDone = function() {
        log.info(`loadFilterLists() took ${Date.now()-t0} ms`);

        this.staticNetFilteringEngine.freeze();
        this.staticExtFilteringEngine.freeze();
        this.redirectEngine.freeze();
        vAPI.net.unsuspend();

        vAPI.storage.set({ 'availableFilterLists': this.availableFilterLists });

        vAPI.messaging.broadcast({
            what: 'staticFilteringDataChanged',
            parseCosmeticFilters: this.userSettings.parseAllABPHideFilters,
            ignoreGenericCosmeticFilters: this.userSettings.ignoreGenericCosmeticFilters,
            listKeys: loadedListKeys
        });

        this.selfieManager.destroy();
        this.lz4Codec.relinquish();
        this.compiledFormatChanged = false;

        loadingPromise = undefined;
    };

    const applyCompiledFilters = function(assetKey, compiled) {
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

    const onFilterListsReady = function(lists) {
        this.availableFilterLists = lists;

        vAPI.net.suspend();
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

            toLoad.push(
                this.getCompiledFilterList(assetKey).then(details => {
                    applyCompiledFilters.call(
                        this,
                        details.assetKey,
                        details.content
                    );
                })
            );
        }

        return Promise.all(toLoad);
    };

    return function() {
        if ( loadingPromise instanceof Promise === false ) {
            t0 = Date.now();
            loadedListKeys.length = 0;
            loadingPromise = Promise.all([
                this.getAvailableLists().then(lists =>
                    onFilterListsReady.call(this, lists)
                ),
                this.loadRedirectResources(),
            ]).then(( ) => {
                onDone.call(this);
            });
        }
        return loadingPromise;
    };
})();

/******************************************************************************/

µBlock.getCompiledFilterList = async function(assetKey) {
    const compiledPath = 'compiled/' + assetKey;

    // https://github.com/uBlockOrigin/uBlock-issues/issues/1365
    //   Verify that the list version matches that of the current compiled
    //   format.
    if (
        this.compiledFormatChanged === false &&
        this.badLists.has(assetKey) === false
    ) {
        const compiledDetails = await this.assets.get(compiledPath);
        if (
            parseInt(compiledDetails.content, 10) ===
            this.systemSettings.compiledMagic
        ) {
            compiledDetails.assetKey = assetKey;
            return compiledDetails;
        }
    }

    // Skip downloading really bad lists.
    if ( this.badLists.get(assetKey) ) {
        return { assetKey, content: '' };
    }

    const rawDetails = await this.assets.get(assetKey, { silent: true });
    // Compiling an empty string results in an empty string.
    if ( rawDetails.content === '' ) {
        rawDetails.assetKey = assetKey;
        return rawDetails;
    }

    this.extractFilterListMetadata(assetKey, rawDetails.content);

    // Skip compiling bad lists.
    if ( this.badLists.has(assetKey) ) {
        return { assetKey, content: '' };
    }

    const compiledContent =
        this.compileFilters(rawDetails.content, { assetKey });
    this.assets.put(compiledPath, compiledContent);

    return { assetKey, content: compiledContent };
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/3406
//   Lower minimum update period to 1 day.
// https://bugs.chromium.org/p/v8/issues/detail?id=2869
//   orphanizeString is to work around String.slice() potentially causing
//   the whole raw filter list to be held in memory just because we cut out
//   the title as a substring.

µBlock.extractFilterListMetadata = function(assetKey, raw) {
    const listEntry = this.availableFilterLists[assetKey];
    if ( listEntry === undefined ) { return; }
    // Metadata expected to be found at the top of content.
    const head = raw.slice(0, 1024);
    // https://github.com/gorhill/uBlock/issues/313
    // Always try to fetch the name if this is an external filter list.
    if ( listEntry.group === 'custom' ) {
        let matches = head.match(/(?:^|\n)(?:!|# )[\t ]*Title[\t ]*:([^\n]+)/i);
        const title = matches && matches[1].trim() || '';
        if ( title !== '' && title !== listEntry.title ) {
            listEntry.title = this.orphanizeString(title);
            this.assets.registerAssetSource(assetKey, { title });
        }
        matches = head.match(/(?:^|\n)(?:!|# )[\t ]*Homepage[\t ]*:[\t ]*(https?:\/\/\S+)\s/i);
        const supportURL = matches && matches[1] || '';
        if ( supportURL !== '' && supportURL !== listEntry.supportURL ) {
            listEntry.supportURL = this.orphanizeString(supportURL);
            this.assets.registerAssetSource(assetKey, { supportURL });
        }
    }
    // Extract update frequency information
    const matches = head.match(/(?:^|\n)(?:!|# )[\t ]*Expires[\t ]*:[\t ]*(\d+)[\t ]*(h)?/i);
    if ( matches !== null ) {
        let updateAfter = parseInt(matches[1], 10);
        if ( isNaN(updateAfter) === false ) {
            if ( matches[2] !== undefined ) {
                updateAfter = Math.ceil(updateAfter / 24);
            }
            updateAfter = Math.max(updateAfter, 1);
            if ( updateAfter !== listEntry.updateAfter ) {
                listEntry.updateAfter = updateAfter;
                this.assets.registerAssetSource(assetKey, { updateAfter });
            }
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

µBlock.compileFilters = function(rawText, details = {}) {
    const writer = new this.CompiledLineIO.Writer();

    // Populate the writer with information potentially useful to the
    // client compilers.
    if ( details.assetKey ) {
        writer.properties.set('assetKey', details.assetKey);
    }
    const expertMode =
        details.assetKey !== this.userFiltersPath ||
        this.hiddenSettings.filterAuthorMode !== false;
    // Useful references:
    //    https://adblockplus.org/en/filter-cheatsheet
    //    https://adblockplus.org/en/filters
    const staticNetFilteringEngine = this.staticNetFilteringEngine;
    const staticExtFilteringEngine = this.staticExtFilteringEngine;
    const lineIter = new this.LineIterator(this.preparseDirectives.prune(rawText));
    const parser = new vAPI.StaticFilteringParser({ expertMode });

    parser.setMaxTokenLength(staticNetFilteringEngine.MAX_TOKEN_LENGTH);

    while ( lineIter.eot() === false ) {
        let line = lineIter.next();

        while ( line.endsWith(' \\') ) {
            if ( lineIter.peek(4) !== '    ' ) { break; }
            line = line.slice(0, -2).trim() + lineIter.next().trim();
        }

        parser.analyze(line);

        if ( parser.shouldIgnore() ) { continue; }

        if ( parser.category === parser.CATStaticExtFilter ) {
            staticExtFilteringEngine.compile(parser, writer);
            continue;
        }

        if ( parser.category !== parser.CATStaticNetFilter ) { continue; }

        // https://github.com/gorhill/uBlock/issues/2599
        //   convert hostname to punycode if needed
        if ( parser.patternHasUnicode() && parser.toASCII() === false ) {
            continue;
        }
        staticNetFilteringEngine.compile(parser, writer);
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/1365
    //   Embed version into compiled list itself: it is encoded in as the
    //   first digits followed by a whitespace.
    const compiledContent
        = `${this.systemSettings.compiledMagic}\n` + writer.toString();

    return compiledContent;
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1395
//   Added `firstparty` argument: to avoid discarding cosmetic filters when
//   applying 1st-party filters.

µBlock.applyCompiledFilters = function(rawText, firstparty) {
    if ( rawText === '' ) { return; }
    const reader = new this.CompiledLineIO.Reader(rawText);
    this.staticNetFilteringEngine.fromCompiledContent(reader);
    this.staticExtFilteringEngine.fromCompiledContent(reader, {
        skipGenericCosmetic: this.userSettings.ignoreGenericCosmeticFilters,
        skipCosmetic: !firstparty && !this.userSettings.parseAllABPHideFilters
    });
};

/******************************************************************************/

// https://github.com/AdguardTeam/AdguardBrowserExtension/issues/917

µBlock.preparseDirectives = {
    // This method returns an array of indices, corresponding to position in
    // the content string which should alternatively be parsed and discarded.
    split: function(content) {
        const reIf = /^!#(if|endif)\b([^\n]*)(?:[\n\r]+|$)/gm;
        const soup = vAPI.webextFlavor.soup;
        const stack = [];
        const shouldDiscard = ( ) => stack.some(v => v);
        const parts = [ 0 ];
        let discard = false;

        for (;;) {
            const match = reIf.exec(content);
            if ( match === null ) { break; }

            switch ( match[1] ) {
            case 'if':
                let expr = match[2].trim();
                const target = expr.charCodeAt(0) === 0x21 /* '!' */;
                if ( target ) { expr = expr.slice(1); }
                const token = this.tokens.get(expr);
                const startDiscard =
                    token === 'false' && target === false ||
                    token !== undefined && soup.has(token) === target;
                if ( discard === false && startDiscard ) {
                    parts.push(match.index);
                    discard = true;
                }
                stack.push(startDiscard);
                break;

            case 'endif':
                stack.pop();
                const stopDiscard = shouldDiscard() === false;
                if ( discard && stopDiscard ) {
                    parts.push(match.index + match[0].length);
                    discard = false;
                }
                break;

            default:
                break;
            }
        }

        parts.push(content.length);
        return parts;
    },

    prune: function(content) {
        const parts = this.split(content);
        const out = [];
        for ( let i = 0, n = parts.length - 1; i < n; i += 2 ) {
            const beg = parts[i+0];
            const end = parts[i+1];
            out.push(content.slice(beg, end));
        }
        return out.join('\n');
    },

    getHints: function() {
        const out = [];
        const vals = new Set();
        for ( const [ key, val ] of this.tokens ) {
            if ( vals.has(val) ) { continue; }
            vals.add(val);
            out.push(key);
        }
        return out;
    },

    getTokens: function() {
        const out = new Map();
        const soup = vAPI.webextFlavor.soup;
        for ( const [ key, val ] of this.tokens ) {
            out.set(key, val !== 'false' && soup.has(val));
        }
        return Array.from(out);
    },

    tokens: new Map([
        [ 'ext_ublock', 'ublock' ],
        [ 'env_chromium', 'chromium' ],
        [ 'env_edge', 'edge' ],
        [ 'env_firefox', 'firefox' ],
        [ 'env_legacy', 'legacy' ],
        [ 'env_mobile', 'mobile' ],
        [ 'env_safari', 'safari' ],
        [ 'cap_html_filtering', 'html_filtering' ],
        [ 'cap_user_stylesheet', 'user_stylesheet' ],
        [ 'false', 'false' ],
        // Hoping ABP-only list maintainers can at least make use of it to
        // help non-ABP content blockers better deal with filters benefiting
        // only ABP.
        [ 'ext_abp', 'false' ],
        // Compatibility with other blockers
        // https://kb.adguard.com/en/general/how-to-create-your-own-ad-filters#adguard-specific
        [ 'adguard', 'adguard' ],
        [ 'adguard_app_android', 'false' ],
        [ 'adguard_app_ios', 'false' ],
        [ 'adguard_app_mac', 'false' ],
        [ 'adguard_app_windows', 'false' ],
        [ 'adguard_ext_android_cb', 'false' ],
        [ 'adguard_ext_chromium', 'chromium' ],
        [ 'adguard_ext_edge', 'edge' ],
        [ 'adguard_ext_firefox', 'firefox' ],
        [ 'adguard_ext_opera', 'chromium' ],
        [ 'adguard_ext_safari', 'false' ],
    ]),
};

/******************************************************************************/

µBlock.loadRedirectResources = async function() {
    try {
        const success = await this.redirectEngine.resourcesFromSelfie();
        if ( success === true ) { return true; }

        const fetchPromises = [
            this.redirectEngine.loadBuiltinResources()
        ];

        const userResourcesLocation = this.hiddenSettings.userResourcesLocation;
        if ( userResourcesLocation !== 'unset' ) {
            for ( const url of userResourcesLocation.split(/\s+/) ) {
                fetchPromises.push(this.assets.fetchText(url));
            }
        }

        const results = await Promise.all(fetchPromises);
        if ( Array.isArray(results) === false ) { return results; }

        let content = '';
        for ( let i = 1; i < results.length; i++ ) {
            const result = results[i];
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
        this.redirectEngine.selfieFromResources();
    } catch(ex) {
        log.info(ex);
        return false;
    }
    return true;
};

/******************************************************************************/

µBlock.loadPublicSuffixList = async function() {
    if ( this.hiddenSettings.disableWebAssembly !== true ) {
        publicSuffixList.enableWASM();
    }

    try {
        const result = await this.assets.get(`compiled/${this.pslAssetKey}`);
        if ( publicSuffixList.fromSelfie(result.content, this.base64) ) {
            return;
        }
    } catch (ex) {
        log.info(ex);
    }

    const result = await this.assets.get(this.pslAssetKey);
    if ( result.content !== '' ) {
        this.compilePublicSuffixList(result.content);
    }
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

µBlock.selfieManager = (( ) => {
    const µb = µBlock;
    let createTimer;
    let destroyTimer;

    // As of 2018-05-31:
    //   JSON.stringify-ing ourselves results in a better baseline
    //   memory usage at selfie-load time. For some reasons.

    const create = async function() {
        await Promise.all([
            µb.assets.put(
                'selfie/main',
                JSON.stringify({
                    magic: µb.systemSettings.selfieMagic,
                    availableFilterLists: µb.availableFilterLists,
                })
            ),
            µb.redirectEngine.toSelfie('selfie/redirectEngine'),
            µb.staticExtFilteringEngine.toSelfie(
                'selfie/staticExtFilteringEngine'
            ),
            µb.staticNetFilteringEngine.toSelfie(
                'selfie/staticNetFilteringEngine'
            ),
        ]);
        µb.lz4Codec.relinquish();
        µb.selfieIsInvalid = false;
    };

    const loadMain = async function() {
        const details = await µb.assets.get('selfie/main');
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
    };

    const load = async function() {
        if ( µb.selfieIsInvalid ) {
            return false;
        }
        try {
            const results = await Promise.all([
                loadMain(),
                µb.redirectEngine.fromSelfie('selfie/redirectEngine'),
                µb.staticExtFilteringEngine.fromSelfie(
                    'selfie/staticExtFilteringEngine'
                ),
                µb.staticNetFilteringEngine.fromSelfie(
                    'selfie/staticNetFilteringEngine'
                ),
            ]);
            if ( results.every(v => v) ) {
                return µb.loadRedirectResources();
            }
        }
        catch (reason) {
            log.info(reason);
        }
        destroy();
        return false;
    };

    const destroy = function() {
        µb.cacheStorage.remove('selfie'); // TODO: obsolete, remove eventually.
        µb.assets.remove(/^selfie\//);
        µb.selfieIsInvalid = true;
        createTimer = vAPI.setTimeout(( ) => {
            createTimer = undefined;
            create();
        }, µb.hiddenSettings.selfieAfter * 60000);
    };

    const destroyAsync = function() {
        if ( destroyTimer !== undefined ) { return; }
        if ( createTimer !== undefined ) {
            clearTimeout(createTimer);
            createTimer = undefined;
        }
        destroyTimer = vAPI.setTimeout(
            ( ) => {
                destroyTimer = undefined;
                destroy();
            },
            1019
        );
        µb.selfieIsInvalid = true;
    };

    return { load, destroy: destroyAsync };
})();

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/531
// Overwrite user settings with admin settings if present.
//
// Admin settings match layout of a uBlock backup. Not all data is
// necessarily present, i.e. administrators may removed entries which
// values are left to the user's choice.

µBlock.restoreAdminSettings = async function() {
    let toOverwrite = {};
    let data;
    try {
        const store = await vAPI.adminStorage.get([
            'adminSettings',
            'toOverwrite',
        ]) || {};
        if ( store.toOverwrite instanceof Object ) {
            toOverwrite = store.toOverwrite;
        }
        const json = store.adminSettings;
        if ( typeof json === 'string' && json !== '' ) {
            data = JSON.parse(json);
        } else if ( json instanceof Object ) {
            data = json;
        }
    } catch (ex) {
        console.error(ex);
    }

    if ( data instanceof Object === false ) { data = {}; }

    const bin = {};
    let binNotEmpty = false;

    // https://github.com/uBlockOrigin/uBlock-issues/issues/666
    //   Allows an admin to set their own 'assets.json' file, with their
    //   own set of stock assets.
    if (
        typeof data.assetsBootstrapLocation === 'string' &&
        data.assetsBootstrapLocation !== ''
    ) {
        µBlock.assetsBootstrapLocation = data.assetsBootstrapLocation;
    }

    if ( typeof data.userSettings === 'object' ) {
        const µbus = this.userSettings;
        const adminus = data.userSettings;
        for ( const name in µbus ) {
            if ( µbus.hasOwnProperty(name) === false ) { continue; }
            if ( adminus.hasOwnProperty(name) === false ) { continue; }
            bin[name] = adminus[name];
            binNotEmpty = true;
        }
    }

    // 'selectedFilterLists' is an array of filter list tokens. Each token
    // is a reference to an asset in 'assets.json', or a URL for lists not
    // present in 'assets.json'.
    if (
        Array.isArray(toOverwrite.filterLists) &&
        toOverwrite.filterLists.length !== 0
    ) {
        const importedLists = [];
        for ( const list of toOverwrite.filterLists ) {
            if ( /^[a-z-]+:\/\//.test(list) === false ) { continue; }
            importedLists.push(list);
        }
        if ( importedLists.length !== 0 ) {
            bin.importedLists = importedLists;
            bin.externalLists = importedLists.join('\n');
        }
        bin.selectedFilterLists = toOverwrite.filterLists;
        binNotEmpty = true;
    } else if ( Array.isArray(data.selectedFilterLists) ) {
        bin.selectedFilterLists = data.selectedFilterLists;
        binNotEmpty = true;
    }

    if (
        Array.isArray(toOverwrite.trustedSiteDirectives) &&
        toOverwrite.trustedSiteDirectives.length !== 0
    ) {
        µBlock.netWhitelistDefault = toOverwrite.trustedSiteDirectives.slice();
        bin.netWhitelist = toOverwrite.trustedSiteDirectives.slice();
        binNotEmpty = true;
    } else if ( Array.isArray(data.whitelist) ) {
        bin.netWhitelist = data.whitelist;
        binNotEmpty = true;
    } else if ( typeof data.netWhitelist === 'string' ) {
        bin.netWhitelist = data.netWhitelist.split('\n');
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

    if (
        Array.isArray(toOverwrite.filters) &&
        toOverwrite.filters.length !== 0
    ) {
        this.saveUserFilters(toOverwrite.filters.join('\n'));
    } else if ( typeof data.userFilters === 'string' ) {
        this.saveUserFilters(data.userFilters);
    }
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

µBlock.scheduleAssetUpdater = (( ) => {
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
                       120000,
                auto: true,
            });
        }, updateDelay);
    };
})();

/******************************************************************************/

µBlock.assetObserver = function(topic, details) {
    // Do not update filter list if not in use.
    // Also, ignore really bad lists, i.e. those which should not even be
    // fetched from a remote server.
    if ( topic === 'before-asset-updated' ) {
        if ( details.type === 'filters' ) {
            if (
                this.availableFilterLists.hasOwnProperty(details.assetKey) === false ||
                this.selectedFilterLists.indexOf(details.assetKey) === -1 ||
                this.badLists.get(details.assetKey)
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
                    if ( this.badLists.has(details.assetKey) === false ) {
                        this.assets.put(
                            'compiled/' + details.assetKey,
                            this.compileFilters(details.content, {
                                assetKey: details.assetKey
                            })
                        );
                    }
                }
            } else {
                this.removeCompiledFilterList(details.assetKey);
            }
        } else if ( details.assetKey === this.pslAssetKey ) {
            if ( cached ) {
                this.compilePublicSuffixList(details.content);
            }
        } else if ( details.assetKey === 'ublock-badlists' ) {
            this.badLists = new Map();
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
            // https://github.com/gorhill/uBlock/pull/2314#issuecomment-278716960
            if (
                this.hiddenSettings.userResourcesLocation !== 'unset' ||
                vAPI.webextFlavor.soup.has('devbuild')
            ) {
                this.redirectEngine.invalidateResourcesSelfie();
            }
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

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

/* globals WebAssembly */

'use strict';

/******************************************************************************/

import publicSuffixList from '../lib/publicsuffixlist/publicsuffixlist.js';
import punycode from '../lib/punycode.js';

import cosmeticFilteringEngine from './cosmetic-filtering.js';
import io from './assets.js';
import logger from './logger.js';
import lz4Codec from './lz4.js';
import staticExtFilteringEngine from './static-ext-filtering.js';
import staticFilteringReverseLookup from './reverselookup.js';
import staticNetFilteringEngine from './static-net-filtering.js';
import µb from './background.js';
import { hostnameFromURI } from './uri-utils.js';
import { i18n, i18n$ } from './i18n.js';
import { redirectEngine } from './redirect-engine.js';
import { sparseBase64 } from './base64-custom.js';
import { ubolog, ubologSet } from './console.js';
import * as sfp from './static-filtering-parser.js';

import {
    permanentFirewall,
    permanentSwitches,
    permanentURLFiltering,
} from './filtering-engines.js';

import {
    CompiledListReader,
    CompiledListWriter,
} from './static-filtering-io.js';

import {
    LineIterator,
    orphanizeString,
} from './text-utils.js';

/******************************************************************************/

µb.getBytesInUse = async function() {
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
    µb.storageUsed = bytesInUse;
    return bytesInUse;
};

/******************************************************************************/

{
    let localSettingsLastSaved = Date.now();

    const shouldSave = ( ) => {
        if ( µb.localSettingsLastModified > localSettingsLastSaved ) {
            µb.saveLocalSettings();
        }
        saveTimer.on(saveDelay);
    };

    const saveTimer = vAPI.defer.create(shouldSave);
    const saveDelay = { min: 4 };

    saveTimer.on(saveDelay);

    µb.saveLocalSettings = function() {
        localSettingsLastSaved = Date.now();
        return vAPI.storage.set(this.localSettings);
    };
}

/******************************************************************************/

µb.loadUserSettings = async function() {
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

µb.saveUserSettings = function() {
    // `externalLists` will be deprecated in some future, it is kept around
    // for forward compatibility purpose, and should reflect the content of
    // `importedLists`.
    // 
    // https://github.com/uBlockOrigin/uBlock-issues/issues/1803
    //   Do this before computing modified settings.
    this.userSettings.externalLists =
        this.userSettings.importedLists.join('\n');

    const toSave = this.getModifiedSettings(
        this.userSettings,
        this.userSettingsDefault
    );

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

µb.loadHiddenSettings = async function() {
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
        µb.noDashboard = disableDashboard === true;
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
    this.fireEvent('hiddenSettingsChanged');
};

// Note: Save only the settings which values differ from the default ones.
// This way the new default values in the future will properly apply for
// those which were not modified by the user.

µb.saveHiddenSettings = function() {
    vAPI.storage.set({
        hiddenSettings: this.getModifiedSettings(
            this.hiddenSettings,
            this.hiddenSettingsDefault
        )
    });
};

µb.onEvent('hiddenSettingsChanged', ( ) => {
    const µbhs = µb.hiddenSettings;
    ubologSet(µbhs.consoleLogLevel === 'info');
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

µb.hiddenSettingsFromString = function(raw) {
    const out = Object.assign({}, this.hiddenSettingsDefault);
    const lineIter = new LineIterator(raw);
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

µb.hiddenSettingValueFromString = function(name, value) {
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

µb.stringFromHiddenSettings = function() {
    const out = [];
    for ( const key of Object.keys(this.hiddenSettings).sort() ) {
        out.push(key + ' ' + this.hiddenSettings[key]);
    }
    return out.join('\n');
};

/******************************************************************************/

µb.savePermanentFirewallRules = function() {
    vAPI.storage.set({
        dynamicFilteringString: permanentFirewall.toString()
    });
};

/******************************************************************************/

µb.savePermanentURLFilteringRules = function() {
    vAPI.storage.set({
        urlFilteringString: permanentURLFiltering.toString()
    });
};

/******************************************************************************/

µb.saveHostnameSwitches = function() {
    vAPI.storage.set({
        hostnameSwitchesString: permanentSwitches.toString()
    });
};

/******************************************************************************/

µb.saveWhitelist = function() {
    vAPI.storage.set({
        netWhitelist: this.arrayFromWhitelist(this.netWhitelist)
    });
    this.netWhitelistModifyTime = Date.now();
};

/******************************************************************************/

µb.isTrustedList = function(assetKey) {
    if ( this.parsedTrustedListPrefixes.length === 0 ) {
        this.parsedTrustedListPrefixes =
            µb.hiddenSettings.trustedListPrefixes.split(/ +/).map(prefix => {
                if ( prefix === '' ) { return; }
                if ( prefix.startsWith('http://') ) { return; }
                if ( prefix.startsWith('file:///') ) { return prefix; }
                if ( prefix.startsWith('https://') === false ) {
                    return prefix.includes('://') ? undefined : prefix;
                }
                try {
                    const url = new URL(prefix);
                    if ( url.hostname.length > 0 ) { return url.href; }
                } catch(_) {
                }
            }).filter(prefix => prefix !== undefined);
    }
    for ( const prefix of this.parsedTrustedListPrefixes ) {
        if ( assetKey.startsWith(prefix) ) { return true; }
    }
    return false;
};

µb.onEvent('hiddenSettingsChanged', ( ) => {
    µb.parsedTrustedListPrefixes = [];
});

/******************************************************************************/

µb.loadSelectedFilterLists = async function() {
    const bin = await vAPI.storage.get('selectedFilterLists');
    if ( bin instanceof Object && Array.isArray(bin.selectedFilterLists) ) {
        this.selectedFilterLists = bin.selectedFilterLists;
        return;
    }

    // https://github.com/gorhill/uBlock/issues/747
    //   Select default filter lists if first-time launch.
    const lists = await io.metadata();
    this.saveSelectedFilterLists(this.autoSelectRegionalFilterLists(lists));
};

µb.saveSelectedFilterLists = function(newKeys, append = false) {
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

µb.applyFilterListSelection = function(details) {
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

µb.listKeysFromCustomFilterLists = function(raw) {
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

µb.saveUserFilters = function(content) {
    // https://github.com/gorhill/uBlock/issues/1022
    //   Be sure to end with an empty line.
    content = content.trim();
    if ( content !== '' ) { content += '\n'; }
    this.removeCompiledFilterList(this.userFiltersPath);
    return io.put(this.userFiltersPath, content);
};

µb.loadUserFilters = function() {
    return io.get(this.userFiltersPath);
};

µb.appendUserFilters = async function(filters, options) {
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
        const ISO8601Date = new Date(d.getTime() +
            (d.getTimezoneOffset()*60000)).toISOString().split('T')[0];
        const url = new URL(options.docURL);
        comment =
            '! ' +
            this.hiddenSettings.autoCommentFilterTemplate
                .replace('{{date}}', ISO8601Date)
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
        assetKey: this.userFiltersPath,
        trustedSource: true,
    });
    const snfe = staticNetFilteringEngine;
    const cfe = cosmeticFilteringEngine;
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
    staticNetFilteringEngine.freeze();
    redirectEngine.freeze();
    staticExtFilteringEngine.freeze();
    this.selfieManager.destroy();

    // https://www.reddit.com/r/uBlockOrigin/comments/cj7g7m/
    // https://www.reddit.com/r/uBlockOrigin/comments/cnq0bi/
    µb.filteringBehaviorChanged();

    vAPI.messaging.broadcast({ what: 'userFiltersUpdated' });
};

µb.createUserFilters = function(details) {
    this.appendUserFilters(details.filters, details);
    // https://github.com/gorhill/uBlock/issues/1786
    if ( details.docURL === undefined ) { return; }
    cosmeticFilteringEngine.removeFromSelectorCache(
        hostnameFromURI(details.docURL)
    );
};

/******************************************************************************/

µb.autoSelectRegionalFilterLists = function(lists) {
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

µb.hasInMemoryFilter = function(raw) {
    return this.inMemoryFilters.includes(raw);
};

µb.addInMemoryFilter = async function(raw) {
    if ( this.inMemoryFilters.includes(raw) ){ return true; }
    this.inMemoryFilters.push(raw);
    this.inMemoryFiltersCompiled = '';
    await this.loadFilterLists();
    return true;
};

µb.removeInMemoryFilter = async function(raw) {
    const pos = this.inMemoryFilters.indexOf(raw);
    if ( pos === -1 ) { return false; }
    this.inMemoryFilters.splice(pos, 1);
    this.inMemoryFiltersCompiled = '';
    await this.loadFilterLists();
    return false;
};

µb.clearInMemoryFilters = async function() {
    if ( this.inMemoryFilters.length === 0 ) { return; }
    this.inMemoryFilters = [];
    this.inMemoryFiltersCompiled = '';
    await this.loadFilterLists();
};

/******************************************************************************/

µb.getAvailableLists = async function() {
    const newAvailableLists = {};

    // User filter list
    newAvailableLists[this.userFiltersPath] = {
        content: 'filters',
        group: 'user',
        title: i18n$('1pPageName'),
    };

    // Custom filter lists
    const importedListKeys = new Set(
        this.listKeysFromCustomFilterLists(this.userSettings.importedLists)
    );
    for ( const listKey of importedListKeys ) {
        const asset = {
            content: 'filters',
            contentURL: listKey,
            external: true,
            group: 'custom',
            submitter: 'user',
            title: '',
        };
        newAvailableLists[listKey] = asset;
        io.registerAssetSource(listKey, asset);
    }

    // Load previously saved available lists -- these contains data
    // computed at run-time, we will reuse this data if possible
    const [ bin, registeredAssets, badlists ] = await Promise.all([
        Object.keys(this.availableFilterLists).length !== 0
            ? { availableFilterLists: this.availableFilterLists }
            : vAPI.storage.get('availableFilterLists'),
        io.metadata(),
        this.badLists.size === 0 ? io.get('ublock-badlists') : false,
    ]);

    if ( badlists instanceof Object ) {
        for ( const line of badlists.content.split(/\s*[\n\r]+\s*/) ) {
            if ( line === '' || line.startsWith('#') ) { continue; }
            const fields = line.split(/\s+/);
            const remove = fields.length === 2;
            this.badLists.set(fields[0], remove);
        }
    }

    const oldAvailableLists = bin && bin.availableFilterLists || {};

    for ( const [ assetKey, asset ] of Object.entries(registeredAssets) ) {
        if ( asset.content !== 'filters' ) { continue; }
        newAvailableLists[assetKey] = Object.assign({}, asset);
    }

    // Load set of currently selected filter lists
    const selectedListset = new Set(this.selectedFilterLists);

    // Remove imported filter lists which are already present in stock lists
    for ( const [ stockAssetKey, stockEntry ] of Object.entries(newAvailableLists) ) {
        if ( stockEntry.content !== 'filters' ) { continue; }
        if ( stockEntry.group === 'user' ) { continue; }
        if ( stockEntry.submitter === 'user' ) { continue; }
        if ( stockAssetKey.includes('://') ) { continue; }
        const contentURLs = Array.isArray(stockEntry.contentURL)
            ? stockEntry.contentURL
            : [ stockEntry.contentURL ];
        for ( const importedAssetKey of contentURLs ) {
            const importedEntry = newAvailableLists[importedAssetKey];
            if ( importedEntry === undefined ) { continue; }
            delete newAvailableLists[importedAssetKey];
            io.unregisterAssetSource(importedAssetKey);
            this.removeFilterList(importedAssetKey);
            if ( selectedListset.has(importedAssetKey) ) {
                selectedListset.add(stockAssetKey);
                selectedListset.delete(importedAssetKey);
            }
            importedListKeys.delete(importedAssetKey);
            break;
        }
    }

    // Unregister lists in old listset not present in new listset.
    // Convert a no longer existing stock list into an imported list, except
    // when the removed stock list is deemed a "bad list".
    for ( const [ assetKey, oldEntry ] of Object.entries(oldAvailableLists) ) {
        if ( newAvailableLists[assetKey] !== undefined ) { continue; }
        const on = selectedListset.delete(assetKey);
        this.removeFilterList(assetKey);
        io.unregisterAssetSource(assetKey);
        if ( assetKey.includes('://') ) { continue; }
        if ( on === false ) { continue; }
        const listURL = Array.isArray(oldEntry.contentURL)
            ? oldEntry.contentURL[0]
            : oldEntry.contentURL;
        if ( this.badLists.has(listURL) ) { continue; }
        const newEntry = {
            content: 'filters',
            contentURL: listURL,
            external: true,
            group: 'custom',
            submitter: 'user',
            title: oldEntry.title || ''
        };
        newAvailableLists[listURL] = newEntry;
        io.registerAssetSource(listURL, newEntry);
        importedListKeys.add(listURL);
        selectedListset.add(listURL);
    }

    // Remove unreferenced imported filter lists
    for ( const [ assetKey, asset ] of Object.entries(newAvailableLists) ) {
        if ( asset.submitter !== 'user' ) { continue; }
        if ( importedListKeys.has(assetKey) ) { continue; }
        selectedListset.delete(assetKey);
        delete newAvailableLists[assetKey];
        this.removeFilterList(assetKey);
        io.unregisterAssetSource(assetKey);
    }

    // Mark lists as disabled/enabled according to selected listset
    for ( const [ assetKey, asset ] of Object.entries(newAvailableLists) ) {
        asset.off = selectedListset.has(assetKey) === false;
    }

    // Reuse existing metadata
    for ( const [ assetKey, oldEntry ] of Object.entries(oldAvailableLists) ) {
        const newEntry = newAvailableLists[assetKey];
        if ( newEntry === undefined ) { continue; }
        if ( oldEntry.entryCount !== undefined ) {
            newEntry.entryCount = oldEntry.entryCount;
        }
        if ( oldEntry.entryUsedCount !== undefined ) {
            newEntry.entryUsedCount = oldEntry.entryUsedCount;
        }
        // This may happen if the list name was pulled from the list content
        // https://github.com/chrisaljoudi/uBlock/issues/982
        //   There is no guarantee the title was successfully extracted from
        //   the list content
        if (
            newEntry.title === '' &&
            typeof oldEntry.title === 'string' &&
            oldEntry.title !== ''
        ) {
            newEntry.title = oldEntry.title;
        }
    }

    if ( Array.from(importedListKeys).join('\n') !== this.userSettings.importedLists.join('\n') ) {
        this.userSettings.importedLists = Array.from(importedListKeys);
        this.saveUserSettings();
    }

    if ( Array.from(selectedListset).join() !== this.selectedFilterLists.join() ) {
        this.saveSelectedFilterLists(Array.from(selectedListset));
    }

    return newAvailableLists;
};

/******************************************************************************/

{
    const loadedListKeys = [];
    let loadingPromise;
    let t0 = 0;

    const onDone = ( ) => {
        ubolog(`loadFilterLists() took ${Date.now()-t0} ms`);

        staticNetFilteringEngine.freeze();
        staticExtFilteringEngine.freeze();
        redirectEngine.freeze();
        vAPI.net.unsuspend();
        µb.filteringBehaviorChanged();

        vAPI.storage.set({ 'availableFilterLists': µb.availableFilterLists });

        logger.writeOne({
            realm: 'message',
            type: 'info',
            text: 'Reloading all filter lists: done'
        });

        vAPI.messaging.broadcast({
            what: 'staticFilteringDataChanged',
            parseCosmeticFilters: µb.userSettings.parseAllABPHideFilters,
            ignoreGenericCosmeticFilters: µb.userSettings.ignoreGenericCosmeticFilters,
            listKeys: loadedListKeys
        });

        µb.selfieManager.destroy();
        lz4Codec.relinquish();
        µb.compiledFormatChanged = false;

        loadingPromise = undefined;
    };

    const applyCompiledFilters = (assetKey, compiled) => {
        const snfe = staticNetFilteringEngine;
        const sxfe = staticExtFilteringEngine;
        let acceptedCount = snfe.acceptedCount + sxfe.acceptedCount;
        let discardedCount = snfe.discardedCount + sxfe.discardedCount;
        µb.applyCompiledFilters(compiled, assetKey === µb.userFiltersPath);
        if ( µb.availableFilterLists.hasOwnProperty(assetKey) ) {
            const entry = µb.availableFilterLists[assetKey];
            entry.entryCount = snfe.acceptedCount + sxfe.acceptedCount -
                acceptedCount;
            entry.entryUsedCount = entry.entryCount -
                (snfe.discardedCount + sxfe.discardedCount - discardedCount);
        }
        loadedListKeys.push(assetKey);
    };

    const onFilterListsReady = lists => {
        logger.writeOne({
            realm: 'message',
            type: 'info',
            text: 'Reloading all filter lists: start'
        });

        µb.availableFilterLists = lists;

        if ( vAPI.Net.canSuspend() ) {
            vAPI.net.suspend();
        }
        redirectEngine.reset();
        staticExtFilteringEngine.reset();
        staticNetFilteringEngine.reset();
        µb.selfieManager.destroy();
        staticFilteringReverseLookup.resetLists();

        // We need to build a complete list of assets to pull first: this is
        // because it *may* happens that some load operations are synchronous:
        // This happens for assets which do not exist, or assets with no
        // content.
        const toLoad = [];
        for ( const assetKey in lists ) {
            if ( lists.hasOwnProperty(assetKey) === false ) { continue; }
            if ( lists[assetKey].off ) { continue; }
            toLoad.push(
                µb.getCompiledFilterList(assetKey).then(details => {
                    applyCompiledFilters(details.assetKey, details.content);
                })
            );
        }

        if ( µb.inMemoryFilters.length !== 0 ) {
            if ( µb.inMemoryFiltersCompiled === '' ) {
                µb.inMemoryFiltersCompiled =
                    µb.compileFilters(µb.inMemoryFilters.join('\n'), {
                        assetKey: 'in-memory',
                        trustedSource: true,
                    });
            }
            if ( µb.inMemoryFiltersCompiled !== '' ) {
                toLoad.push(
                    µb.applyCompiledFilters(µb.inMemoryFiltersCompiled, true)
                );
            }
        }

        return Promise.all(toLoad);
    };

    µb.loadFilterLists = function() {
        if ( loadingPromise instanceof Promise ) { return loadingPromise; }
        t0 = Date.now();
        loadedListKeys.length = 0;
        loadingPromise = Promise.all([
            this.getAvailableLists().then(lists => onFilterListsReady(lists)),
            this.loadRedirectResources(),
        ]).then(( ) => {
            onDone();
        });
        return loadingPromise;
    };
}

/******************************************************************************/

µb.getCompiledFilterList = async function(assetKey) {
    const compiledPath = 'compiled/' + assetKey;

    // https://github.com/uBlockOrigin/uBlock-issues/issues/1365
    //   Verify that the list version matches that of the current compiled
    //   format.
    if (
        this.compiledFormatChanged === false &&
        this.badLists.has(assetKey) === false
    ) {
        const compiledDetails = await io.get(compiledPath);
        const compilerVersion = `${this.systemSettings.compiledMagic}\n`;
        if ( compiledDetails.content.startsWith(compilerVersion) ) {
            compiledDetails.assetKey = assetKey;
            return compiledDetails;
        }
    }

    // Skip downloading really bad lists.
    if ( this.badLists.get(assetKey) ) {
        return { assetKey, content: '' };
    }

    const rawDetails = await io.get(assetKey, { silent: true });
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

    const compiledContent = this.compileFilters(rawDetails.content, {
        assetKey,
        trustedSource: this.isTrustedList(assetKey),
    });
    io.put(compiledPath, compiledContent);

    return { assetKey, content: compiledContent };
};

/******************************************************************************/

µb.extractFilterListMetadata = function(assetKey, raw) {
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
            listEntry.title = orphanizeString(title);
            io.registerAssetSource(assetKey, { title });
        }
        matches = head.match(/(?:^|\n)(?:!|# )[\t ]*Homepage[\t ]*:[\t ]*(https?:\/\/\S+)\s/i);
        const supportURL = matches && matches[1] || '';
        if ( supportURL !== '' && supportURL !== listEntry.supportURL ) {
            listEntry.supportURL = orphanizeString(supportURL);
            io.registerAssetSource(assetKey, { supportURL });
        }
    }
    // Extract update frequency information
    const matches = head.match(/(?:^|\n)(?:!|# )[\t ]*Expires[\t ]*:[\t ]*(\d+)[\t ]*(h)?/i);
    if ( matches !== null ) {
        let updateAfter = parseInt(matches[1], 10);
        if ( isNaN(updateAfter) === false ) {
            if ( matches[2] !== undefined ) {
                updateAfter = Math.ceil(updateAfter / 12) / 2;
            }
            updateAfter = Math.max(updateAfter, 0.5);
            if ( updateAfter !== listEntry.updateAfter ) {
                listEntry.updateAfter = updateAfter;
                io.registerAssetSource(assetKey, { updateAfter });
            }
        }
    }
};

/******************************************************************************/

µb.removeCompiledFilterList = function(assetKey) {
    io.remove('compiled/' + assetKey);
};

µb.removeFilterList = function(assetKey) {
    this.removeCompiledFilterList(assetKey);
    io.remove(assetKey);
};

/******************************************************************************/

µb.compileFilters = function(rawText, details = {}) {
    const writer = new CompiledListWriter();

    // Populate the writer with information potentially useful to the
    // client compilers.
    const trustedSource = details.trustedSource === true;
    if ( details.assetKey ) {
        writer.properties.set('name', details.assetKey);
        writer.properties.set('trustedSource', trustedSource);
    }
    const assetName = details.assetKey ? details.assetKey : '?';
    const parser = new sfp.AstFilterParser({
        trustedSource,
        maxTokenLength: staticNetFilteringEngine.MAX_TOKEN_LENGTH,
        nativeCssHas: vAPI.webextFlavor.env.includes('native_css_has'),
    });
    const compiler = staticNetFilteringEngine.createCompiler(parser);
    const lineIter = new LineIterator(
        sfp.utils.preparser.prune(rawText, vAPI.webextFlavor.env)
    );

    compiler.start(writer);

    while ( lineIter.eot() === false ) {
        let line = lineIter.next();

        while ( line.endsWith(' \\') ) {
            if ( lineIter.peek(4) !== '    ' ) { break; }
            line = line.slice(0, -2).trim() + lineIter.next().trim();
        }

        parser.parse(line);

        if ( parser.isFilter() === false ) { continue; }
        if ( parser.hasError() ) {
            logger.writeOne({
                realm: 'message',
                type: 'error',
                text: `Invalid filter (${assetName}): ${parser.raw}`
            });
            continue;
        }

        if ( parser.isExtendedFilter() ) {
            staticExtFilteringEngine.compile(parser, writer);
            continue;
        }

        if ( parser.isNetworkFilter() === false ) { continue; }

        if ( compiler.compile(parser, writer) ) { continue; }
        if ( compiler.error !== undefined ) {
            logger.writeOne({
                realm: 'message',
                type: 'error',
                text: compiler.error
            });
        }
    }

    compiler.finish(writer);

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

µb.applyCompiledFilters = function(rawText, firstparty) {
    if ( rawText === '' ) { return; }
    const reader = new CompiledListReader(rawText);
    staticNetFilteringEngine.fromCompiled(reader);
    staticExtFilteringEngine.fromCompiledContent(reader, {
        skipGenericCosmetic: this.userSettings.ignoreGenericCosmeticFilters,
        skipCosmetic: !firstparty && !this.userSettings.parseAllABPHideFilters
    });
};

/******************************************************************************/

µb.loadRedirectResources = async function() {
    try {
        const success = await redirectEngine.resourcesFromSelfie(io);
        if ( success === true ) { return true; }

        const fetcher = (path, options = undefined) => {
            if ( path.startsWith('/web_accessible_resources/') ) {
                path += `?secret=${vAPI.warSecret.short()}`;
                return io.fetch(path, options);
            }
            return io.fetchText(path);
        };

        const fetchPromises = [
            redirectEngine.loadBuiltinResources(fetcher)
        ];

        const userResourcesLocation = this.hiddenSettings.userResourcesLocation;
        if ( userResourcesLocation !== 'unset' ) {
            for ( const url of userResourcesLocation.split(/\s+/) ) {
                fetchPromises.push(io.fetchText(url));
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

        redirectEngine.resourcesFromString(content);
        redirectEngine.selfieFromResources(io);
    } catch(ex) {
        ubolog(ex);
        return false;
    }
    return true;
};

/******************************************************************************/

µb.loadPublicSuffixList = async function() {
    const psl = publicSuffixList;

    // WASM is nice but not critical
    if ( vAPI.canWASM && this.hiddenSettings.disableWebAssembly !== true ) {
        const wasmModuleFetcher = function(path) {
            return fetch( `${path}.wasm`, {
                mode: 'same-origin'
            }).then(
                WebAssembly.compileStreaming
            ).catch(reason => {
                ubolog(reason);
            });
        };
        let result = false;
        try {
            result = await psl.enableWASM(wasmModuleFetcher,
                './lib/publicsuffixlist/wasm/'
            );
        } catch(reason) {
            ubolog(reason);
        }
        if ( result ) {
            ubolog(`WASM PSL ready ${Date.now()-vAPI.T0} ms after launch`);
        }
    }

    try {
        const result = await io.get(`compiled/${this.pslAssetKey}`);
        if ( psl.fromSelfie(result.content, sparseBase64) ) { return; }
    } catch (reason) {
        ubolog(reason);
    }

    const result = await io.get(this.pslAssetKey);
    if ( result.content !== '' ) {
        this.compilePublicSuffixList(result.content);
    }
};

µb.compilePublicSuffixList = function(content) {
    const psl = publicSuffixList;
    psl.parse(content, punycode.toASCII);
    io.put(`compiled/${this.pslAssetKey}`, psl.toSelfie(sparseBase64));
};

/******************************************************************************/

// This is to be sure the selfie is generated in a sane manner: the selfie will
// be generated if the user doesn't change his filter lists selection for
// some set time.

{
    // As of 2018-05-31:
    //   JSON.stringify-ing ourselves results in a better baseline
    //   memory usage at selfie-load time. For some reasons.

    const create = async function() {
        if ( µb.inMemoryFilters.length !== 0 ) { return; }
        if ( Object.keys(µb.availableFilterLists).length === 0 ) { return; }
        await Promise.all([
            io.put(
                'selfie/main',
                JSON.stringify({
                    magic: µb.systemSettings.selfieMagic,
                    availableFilterLists: µb.availableFilterLists,
                })
            ),
            redirectEngine.toSelfie('selfie/redirectEngine'),
            staticExtFilteringEngine.toSelfie(
                'selfie/staticExtFilteringEngine'
            ),
            staticNetFilteringEngine.toSelfie(io,
                'selfie/staticNetFilteringEngine'
            ),
        ]);
        lz4Codec.relinquish();
        µb.selfieIsInvalid = false;
    };

    const loadMain = async function() {
        const details = await io.get('selfie/main');
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
        if ( selfie instanceof Object === false ) { return false; }
        if ( selfie.magic !== µb.systemSettings.selfieMagic ) { return false; }
        if ( selfie.availableFilterLists instanceof Object === false ) { return false; }
        if ( Object.keys(selfie.availableFilterLists).length === 0 ) { return false; }
        µb.availableFilterLists = selfie.availableFilterLists;
        return true;
    };

    const load = async function() {
        if ( µb.selfieIsInvalid ) { return false; }
        try {
            const results = await Promise.all([
                loadMain(),
                redirectEngine.fromSelfie('selfie/redirectEngine'),
                staticExtFilteringEngine.fromSelfie(
                    'selfie/staticExtFilteringEngine'
                ),
                staticNetFilteringEngine.fromSelfie(io,
                    'selfie/staticNetFilteringEngine'
                ),
            ]);
            if ( results.every(v => v) ) {
                return µb.loadRedirectResources();
            }
        }
        catch (reason) {
            ubolog(reason);
        }
        destroy();
        return false;
    };

    const destroy = function() {
        if ( µb.selfieIsInvalid === false ) {
            io.remove(/^selfie\//);
            µb.selfieIsInvalid = true;
        }
        createTimer.offon({ min: µb.hiddenSettings.selfieAfter });
    };

    const createTimer = vAPI.defer.create(create);

    µb.selfieManager = { load, destroy };
}

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/531
// Overwrite user settings with admin settings if present.
//
// Admin settings match layout of a uBlock backup. Not all data is
// necessarily present, i.e. administrators may removed entries which
// values are left to the user's choice.

µb.restoreAdminSettings = async function() {
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
        µb.assetsBootstrapLocation = data.assetsBootstrapLocation;
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
        µb.netWhitelistDefault = toOverwrite.trustedSiteDirectives.slice();
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
//   Support multiple locales per filter list.
// https://github.com/gorhill/uBlock/issues/3210
//   Support ability to auto-enable a filter list based on user agent.
// https://github.com/gorhill/uBlock/pull/3860
//   Get current language using extensions API (instead of `navigator.language`)

µb.listMatchesEnvironment = function(details) {
    // Matches language?
    if ( typeof details.lang === 'string' ) {
        let re = this.listMatchesEnvironment.reLang;
        if ( re === undefined ) {
            const match = /^[a-z]+/.exec(i18n.getUILanguage());
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

{
    let next = 0;
    let lastEmergencyUpdate = 0;

    const launchTimer = vAPI.defer.create(fetchDelay => {
        next = 0;
        io.updateStart({ delay: fetchDelay, auto: true });
    });

    µb.scheduleAssetUpdater = async function(updateDelay) {
        launchTimer.off();

        if ( updateDelay === 0 ) {
            next = 0;
            return;
        }

        const now = Date.now();
        let needEmergencyUpdate = false;

        // Respect cooldown period before launching an emergency update.
        const timeSinceLastEmergencyUpdate = (now - lastEmergencyUpdate) / 3600000;
        if ( timeSinceLastEmergencyUpdate > 1 ) {
            const entries = await io.getUpdateAges({
                filters: µb.selectedFilterLists,
                internal: [ '*' ],
            });
            for ( const entry of entries ) {
                if ( entry.ageNormalized < 2 ) { continue; }
                needEmergencyUpdate = true;
                lastEmergencyUpdate = now;
                break;
            }
        }

        // Use the new schedule if and only if it is earlier than the previous
        // one.
        if ( next !== 0 ) {
            updateDelay = Math.min(updateDelay, Math.max(next - now, 0));
        }

        if ( needEmergencyUpdate ) {
            updateDelay = Math.min(updateDelay, 15000);
        }

        next = now + updateDelay;

        const fetchDelay = needEmergencyUpdate
            ? 2000
            : this.hiddenSettings.autoUpdateAssetFetchPeriod * 1000 || 60000;

        launchTimer.on(updateDelay, fetchDelay);
    };
}

/******************************************************************************/

µb.assetObserver = function(topic, details) {
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
                        io.put(
                            'compiled/' + details.assetKey,
                            this.compileFilters(details.content, {
                                assetKey: details.assetKey,
                                trustedSource: this.isTrustedList(details.assetKey),
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
                redirectEngine.invalidateResourcesSelfie(io);
            }
            this.loadFilterLists();
        }
        if ( this.userSettings.autoUpdate ) {
            this.scheduleAssetUpdater(
                this.hiddenSettings.autoUpdatePeriod * 3600000 || 25200000
            );
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
                details.entry.off === true &&
                this.listMatchesEnvironment(details.entry)
            ) {
                this.saveSelectedFilterLists([ details.assetKey ], true);
            }
        }
        return;
    }

    if ( topic === 'assets.json-updated' ) {
        const { newDict, oldDict } = details;
        if ( newDict['assets.json'] === undefined ) { return; }
        if ( oldDict['assets.json'] === undefined ) { return; }
        const newDefaultListset = new Set(newDict['assets.json'].defaultListset || []);
        const oldDefaultListset = new Set(oldDict['assets.json'].defaultListset || []);
        if ( newDefaultListset.size === 0 ) { return; }
        if ( oldDefaultListset.size === 0 ) {
            Array.from(Object.entries(oldDict))
                .filter(a =>
                    a[1].content === 'filters' &&
                    a[1].off === undefined &&
                    /^https?:\/\//.test(a[0]) === false
                )
                .map(a => a[0])
                .forEach(a => oldDefaultListset.add(a));
            if ( oldDefaultListset.size === 0 ) { return; }
        }
        const selectedListset = new Set(this.selectedFilterLists);
        let selectedListModified = false;
        for ( const assetKey of oldDefaultListset ) {
            if ( newDefaultListset.has(assetKey) ) { continue; }
            selectedListset.delete(assetKey);
            selectedListModified = true;
        }
        for ( const assetKey of newDefaultListset ) {
            if ( oldDefaultListset.has(assetKey) ) { continue; }
            selectedListset.add(assetKey);
            selectedListModified = true;
        }
        if ( selectedListModified ) {
            this.saveSelectedFilterLists(Array.from(selectedListset));
        }
        return;
    }
};

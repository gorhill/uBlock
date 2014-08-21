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

/* global chrome, µBlock, YaMD5 */

/*******************************************************************************

File system structure:
    assets
        ublock
            ...
        thirdparties
            ...
        user
            filters.txt
            ...

*/

/******************************************************************************/

// Low-level asset files manager

µBlock.assets = (function() {

/******************************************************************************/

var repositoryRoot = µBlock.projectServerRoot;
var nullFunc = function() {};
var reIsExternalPath = /^https?:\/\/[a-z0-9]/;
var reIsUserPath = /^assets\/user\//;
var lastRepoMetaTimestamp = 0;
var refreshRepoMetaPeriod = 6 * 60 * 60 * 1000;

var exports = {
    autoUpdate: true,
    autoUpdateDelay: 2 * 24 * 60 * 60 * 1000
};

/******************************************************************************/

var AssetEntry = function() {
    this.localChecksum = '';
    this.repoChecksum = '';
    this.expireTimestamp = 0;
    this.homeURL = '';
};

var RepoMetadata = function() {
    this.entries = {};
    this.waiting = [];
};

var repoMetadata = null;

/******************************************************************************/

var cachedAssetsManager = (function() {
    var exports = {};
    var entries = null;
    var cachedAssetPathPrefix = 'cached_asset_content://';

    var getEntries = function(callback) {
        if ( entries !== null ) {
            callback(entries);
            return;
        }
        // Flush cached non-user assets if these are from a prior version.
        // https://github.com/gorhill/httpswitchboard/issues/212
        var onLastVersionRead = function(store) {
            var currentVersion = chrome.runtime.getManifest().version;
            var lastVersion = store.extensionLastVersion || '0.0.0.0';
            if ( currentVersion !== lastVersion ) {
                chrome.storage.local.set({ 'extensionLastVersion': currentVersion });
                exports.remove(/^assets\/(ublock|thirdparties)\//);
                exports.remove('assets/checksums.txt');
            }
            callback(entries);
        };
        var onLoaded = function(bin) {
            // https://github.com/gorhill/httpswitchboard/issues/381
            // Maybe the index was requested multiple times and already 
            // fetched by one of the occurrences.
            if ( entries === null ) {
                if ( chrome.runtime.lastError ) {
                    console.error(
                        'µBlock> cachedAssetsManager> getEntries():',
                        chrome.runtime.lastError.message
                    );
                }
                entries = bin.cached_asset_entries || {};
            }
            chrome.storage.local.get('extensionLastVersion', onLastVersionRead);
        };
        chrome.storage.local.get('cached_asset_entries', onLoaded);
    };
    exports.entries = getEntries;

    exports.load = function(path, cbSuccess, cbError) {
        cbSuccess = cbSuccess || nullFunc;
        cbError = cbError || cbSuccess;
        var details = {
            'path': path,
            'content': ''
        };
        var cachedContentPath = cachedAssetPathPrefix + path;
        var onLoaded = function(bin) {
            if ( chrome.runtime.lastError ) {
                details.error = 'Error: ' + chrome.runtime.lastError.message;
                console.error('µBlock> cachedAssetsManager.load():', details.error);
                cbError(details);
            } else {
                details.content = bin[cachedContentPath];
                cbSuccess(details);
            }
        };
        var onEntries = function(entries) {
            if ( entries[path] === undefined ) {
                details.error = 'Error: not found';
                cbError(details);
                return;
            }
            chrome.storage.local.get(cachedContentPath, onLoaded);
        };
        getEntries(onEntries);
    };

    exports.save = function(path, content, cbSuccess, cbError) {
        cbSuccess = cbSuccess || nullFunc;
        cbError = cbError || cbSuccess;
        var details = {
            path: path,
            content: content
        };
        var cachedContentPath = cachedAssetPathPrefix + path;
        var bin = {};
        bin[cachedContentPath] = content;
        var onSaved = function() {
            if ( chrome.runtime.lastError ) {
                details.error = 'Error: ' + chrome.runtime.lastError.message;
                console.error('µBlock> cachedAssetsManager.save():', details.error);
                cbError(details);
            } else {
                cbSuccess(details);
            }
        };
        var onEntries = function(entries) {
            entries[path] = Date.now();
            bin.cached_asset_entries = entries;
            chrome.storage.local.set(bin, onSaved);
        };
        getEntries(onEntries);
    };

    exports.remove = function(pattern, before) {
        var onEntries = function(entries) {
            var keystoRemove = [];
            var paths = Object.keys(entries);
            var i = paths.length;
            var path;
            while ( i-- ) {
                path = paths[i];
                if ( typeof pattern === 'string' && path !== pattern ) {
                    continue;
                }
                if ( pattern instanceof RegExp && !pattern.test(path) ) {
                    continue;
                }
                if ( typeof before === 'number' && entries[path] >= before ) {
                    continue;
                }
                keystoRemove.push(cachedAssetPathPrefix + path);
                delete entries[path];
            }
            if ( keystoRemove.length ) {
                chrome.storage.local.remove(keystoRemove);
                chrome.storage.local.set({ 'cached_asset_entries': entries });
            }
        };
        getEntries(onEntries);
    };

    return exports;
})();

/******************************************************************************/

var getTextFileFromURL = function(url, onLoad, onError) {
    // console.log('µBlock> getTextFileFromURL("%s"):', url);
    var xhr = new XMLHttpRequest();
    xhr.responseType = 'text';
    xhr.timeout = 15000;
    xhr.onload = onLoad;
    xhr.onerror = onError;
    xhr.ontimeout = onError;
    xhr.open('get', url, true);
    xhr.send();
};

/******************************************************************************/

var updateLocalChecksums = function() {
    var localChecksums = [];
    var entries = repoMetadata.entries;
    var entry;
    for ( var path in entries ) {
        if ( entries.hasOwnProperty(path) === false ) {
            continue;
        }
        entry = entries[path];
        if ( entry.localChecksum !== '' ) {
            localChecksums.push(entry.localChecksum + ' ' + path);
        }
    }
    cachedAssetsManager.save('assets/checksums.txt', localChecksums.join('\n'));
};

/******************************************************************************/

// Gather meta data of all assets.

var getRepoMetadata = function(callback) {
    callback = callback || nullFunc;

    if ( (Date.now() - lastRepoMetaTimestamp) >= refreshRepoMetaPeriod ) {
        repoMetadata = null;
    }
    if ( repoMetadata !== null ) {
        if ( repoMetadata.waiting.length !== 0 ) {
            repoMetadata.waiting.push(callback);
        } else {
            callback(repoMetadata);
        }
        return;
    }

    lastRepoMetaTimestamp = Date.now();

    // https://github.com/gorhill/uBlock/issues/84
    // First try to load from the actual home server of a third-party.
    var parseHomeURLs = function(text) {
        var entries = repoMetadata.entries;
        var urlPairs = text.split(/\n\n+/);
        var i = urlPairs.length;
        var pair, pos, k, v;
        while ( i-- ) {
            pair = urlPairs[i];
            pos = pair.indexOf('\n');
            if ( pos === -1 ) {
                continue;
            }
            k = 'assets/thirdparties/' + pair.slice(0, pos).trim();
            v = pair.slice(pos).trim();
            if ( k === '' || v === '' ) {
                continue;
            }
            if ( entries[k] === undefined ) {
                entries[k] = new AssetEntry();
            }
            entries[k].homeURL = v;
        }
        while ( callback = repoMetadata.waiting.pop() ) {
            callback(repoMetadata);
        }
    };

    var pathToHomeURLs = 'assets/ublock/thirdparty-lists.txt';

    var onLocalHomeURLsLoaded = function(details) {
        parseHomeURLs(details.content);
    };

    var onRepoHomeURLsLoaded = function(details) {
        var entries = repoMetadata.entries;
        var entry = entries[pathToHomeURLs];
        if ( YaMD5.hashStr(details.content) !== entry.repoChecksum ) {
            entry.repoChecksum = entry.localChecksum;
            readLocalFile(pathToHomeURLs, onLocalHomeURLsLoaded);
            return;
        }
        cachedAssetsManager.save(pathToHomeURLs, details.content, onLocalHomeURLsLoaded);
    };

    var localChecksums;
    var repoChecksums;

    var checksumsReceived = function() {
        if ( localChecksums === undefined || repoChecksums === undefined ) {
            return;
        }
        // Remove from cache assets which no longer exist in the repo
        var entries = repoMetadata.entries;
        var checksumsChanged = false;
        var entry;
        for ( var path in entries ) {
            if ( entries.hasOwnProperty(path) === false ) {
                continue;
            }
            entry = entries[path];
            // If repo checksums could not be fetched, assume no change
            if ( repoChecksums === '' ) {
                entry.repoChecksum = entry.localChecksum;
            }
            if ( entry.repoChecksum !== '' || entry.localChecksum === '' ) {
                continue;
            }
            checksumsChanged = true;
            cachedAssetsManager.remove(path);
            entry.localChecksum = '';
        }
        if ( checksumsChanged ) {
            updateLocalChecksums();
        }
        // Fetch and store homeURL associations
        entry = entries[pathToHomeURLs];
        if ( entry.localChecksum !== entry.repoChecksum ) {
            readRepoFile(pathToHomeURLs, onRepoHomeURLsLoaded);
        } else {
            readLocalFile(pathToHomeURLs, onLocalHomeURLsLoaded);
        }
    };

    var validateChecksums = function(details) {
        if ( details.error || details.content === '' ) {
            return '';
        }
        if ( /^(?:[0-9a-f]{32}\s+\S+(?:\s+|$))+/.test(details.content) === false ) {
            return '';
        }
        return details.content;
    };

    var parseChecksums = function(text, which) {
        var entries = repoMetadata.entries;
        var lines = text.split(/\n+/);
        var i = lines.length;
        var fields, assetPath;
        while ( i-- ) {
            fields = lines[i].trim().split(/\s+/);
            if ( fields.length !== 2 ) {
                continue;
            }
            assetPath = fields[1];
            if ( entries[assetPath] === undefined ) {
                entries[assetPath] = new AssetEntry();
            }
            entries[assetPath][which + 'Checksum'] = fields[0];
        }
    };

    var onLocalChecksumsLoaded = function(details) {
        if ( localChecksums = validateChecksums(details) ) {
            parseChecksums(localChecksums, 'local');
        }
        checksumsReceived();
    };

    var onRepoChecksumsLoaded = function(details) {
        if ( repoChecksums = validateChecksums(details) ) {
            parseChecksums(repoChecksums, 'repo');
        }
        checksumsReceived();
    };

    repoMetadata = new RepoMetadata();
    repoMetadata.waiting.push(callback);
    readRepoFile('assets/checksums.txt', onRepoChecksumsLoaded);
    readLocalFile('assets/checksums.txt', onLocalChecksumsLoaded);
};

// https://www.youtube.com/watch?v=-t3WYfgM4x8

/******************************************************************************/

// Get a local asset, do not look-up repo or remote location if local asset
// is not found.

var readLocalFile = function(path, callback) {
    var reportBack = function(content, err) {
        var details = {
            'path': path,
            'content': content
        };
        if ( err ) {
            details.error = err;
        }
        callback(details);
    };

    var onInstallFileLoaded = function() {
        //console.log('µBlock> readLocalFile("%s") / onInstallFileLoaded()', path);
        reportBack(this.responseText);
        this.onload = this.onerror = null;
    };

    var onInstallFileError = function() {
        console.error('µBlock> readLocalFile("%s") / onInstallFileError()', path);
        reportBack('', 'Error');
        this.onload = this.onerror = null;
    };

    var onCachedContentLoaded = function(details) {
        //console.log('µBlock> readLocalFile("%s") / onCachedContentLoaded()', path);
        reportBack(details.content);
    };

    var onCachedContentError = function(details) {
        //console.error('µBlock> readLocalFile("%s") / onCachedContentError()', path);
        if ( reIsExternalPath.test(path) ) {
            reportBack('', 'Error: asset not found');
            return;
        }
        getTextFileFromURL(chrome.runtime.getURL(details.path), onInstallFileLoaded, onInstallFileError);
    };

    cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
};

// https://www.youtube.com/watch?v=r9KVpuFPtHc

/******************************************************************************/

// Get the repository copy of a built-in asset.

var readRepoFile = function(path, callback) {
    var reportBack = function(content, err) {
        var details = {
            'path': path,
            'content': content,
            'error': err
        };
        callback(details);
    };

    var onRepoFileLoaded = function() {
        this.onload = this.onerror = null;
        //console.log('µBlock> readRepoFile("%s") / onRepoFileLoaded()', path);
        // https://github.com/gorhill/httpswitchboard/issues/263
        if ( this.status === 200 ) {
            reportBack(this.responseText);
        } else {
            reportBack('', 'Error: ' + this.statusText);
        }
    };

    var onRepoFileError = function() {
        this.onload = this.onerror = null;
        //console.error('µBlock> readRepoFile("%s") / onRepoFileError()', path);
        reportBack('', 'Error');
    };

    // 'ublock=...' is to skip browser cache
    getTextFileFromURL(
        repositoryRoot + path + '?ublock=' + Date.now(),
        onRepoFileLoaded,
        onRepoFileError
    );
};

/******************************************************************************/

// An asset from an external source with a copy shipped with the extension:
//       Path --> starts with 'assets/(thirdparties|ublock)/', with a home URL
//   External --> 
// Repository --> has checksum (to detect need for update only)
//      Cache --> has expiration timestamp (in cache)
//      Local --> install time version

var readRepoCopyAsset = function(path, callback) {
    var assetEntry;

    var reportBack = function(content, err) {
        var details = {
            'path': path,
            'content': content
        };
        if ( err ) {
            details.error = err;
        }
        callback(details);
    };

    var updateChecksum = function() {
        if ( assetEntry !== undefined && assetEntry.repoChecksum !== assetEntry.localChecksum ) {
            assetEntry.localChecksum = assetEntry.repoChecksum;
            updateLocalChecksums();
        }
    };

    var onInstallFileLoaded = function() {
        this.onload = this.onerror = null;
        //console.log('µBlock> readRepoCopyAsset("%s") / onInstallFileLoaded()', path);
        reportBack(this.responseText);
    };

    var onInstallFileError = function() {
        this.onload = this.onerror = null;
        console.error('µBlock> readRepoCopyAsset("%s") / onInstallFileError():', path, this.statusText);
        reportBack('', 'Error');
    };

    var onCachedContentLoaded = function(details) {
        //console.log('µBlock> readRepoCopyAsset("%s") / onCacheFileLoaded()', path);
        reportBack(details.content);
    };

    var onCachedContentError = function(details) {
        //console.log('µBlock> readRepoCopyAsset("%s") / onCacheFileError()', path);
        getTextFileFromURL(chrome.runtime.getURL(details.path), onInstallFileLoaded, onInstallFileError);
    };

    var repositoryURL = repositoryRoot + path + '?ublock=' + Date.now();

    var onRepoFileLoaded = function() {
        this.onload = this.onerror = null;
        if ( typeof this.responseText !== 'string' || this.responseText === '' ) {
            console.error('µBlock> readRepoCopyAsset("%s") / onRepoFileLoaded("%s"): error', path, repositoryURL);
            cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
            return;
        }
        //console.log('µBlock> readRepoCopyAsset("%s") / onRepoFileLoaded("%s")', path, repositoryURL);
        updateChecksum();
        cachedAssetsManager.save(path, this.responseText, callback);
    };

    var onRepoFileError = function() {
        this.onload = this.onerror = null;
        console.error('µBlock> readRepoCopyAsset("%s") / onRepoFileError("%s"):', path, repositoryURL, this.statusText);
        cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
    };

    var onHomeFileLoaded = function() {
        this.onload = this.onerror = null;
        if ( typeof this.responseText !== 'string' || this.responseText === '' ) {
            console.error('µBlock> readRepoCopyAsset("%s") / onHomeFileLoaded("%s"): no response', path, assetEntry.homeURL);
            // Fetch from repo only if obsolescence was due to repo checksum
            if ( assetEntry.localChecksum !== assetEntry.repoChecksum ) {
                getTextFileFromURL(repositoryURL, onRepoFileLoaded, onRepoFileError);
            } else {
                cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
            }
            return;
        }
        //console.log('µBlock> readRepoCopyAsset("%s") / onHomeFileLoaded("%s")', path, assetEntry.homeURL);
        updateChecksum();
        cachedAssetsManager.save(path, this.responseText, callback);
    };

    var onHomeFileError = function() {
        this.onload = this.onerror = null;
        console.error('µBlock> readRepoCopyAsset("%s") / onHomeFileError("%s"):', path, assetEntry.homeURL, this.statusText);
        // Fetch from repo only if obsolescence was due to repo checksum
        if ( assetEntry.localChecksum !== assetEntry.repoChecksum ) {
            getTextFileFromURL(repositoryURL, onRepoFileLoaded, onRepoFileError);
        } else {
            cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
        }
    };

    var onCacheMetaReady = function(entries) {
        // Fetch from remote if:
        // - Auto-update enabled AND (not in cache OR in cache but obsolete)
        var timestamp = entries[path];
        var obsolete = Date.now() - exports.autoUpdateDelay;
        if ( exports.autoUpdate && (typeof timestamp !== 'number' || timestamp <= obsolete) ) {
            //console.log('µBlock> readRepoCopyAsset("%s") / onCacheMetaReady(): not cached or obsolete', path);
            getTextFileFromURL(assetEntry.homeURL, onHomeFileLoaded, onHomeFileError);
            return;
        }

        // In cache
        if ( typeof timestamp === 'number' ) {
            cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
            return;
        }

        // Not in cache
        getTextFileFromURL(chrome.runtime.getURL(path), onInstallFileLoaded, onInstallFileError);
    };

    var onRepoMetaReady = function(meta) {
        assetEntry = meta.entries[path];

        // Asset doesn't exist
        if ( assetEntry === undefined ) {
            reportBack('', 'Error: asset not found');
            return;
        }

        // Repo copy changed: fetch from home URL
        if ( exports.autoUpdate && assetEntry.localChecksum !== assetEntry.repoChecksum ) {
            //console.log('µBlock> readRepoCopyAsset("%s") / onRepoMetaReady(): repo has newer version', path);
            getTextFileFromURL(assetEntry.homeURL, onHomeFileLoaded, onHomeFileError);
            return;
        }

        // Load from cache
        cachedAssetsManager.entries(onCacheMetaReady);
    };

    getRepoMetadata(onRepoMetaReady);
};

// https://www.youtube.com/watch?v=uvUW4ozs7pY

/******************************************************************************/

// An important asset shipped with the extension -- typically small, or 
// doesn't change often:
//       Path --> starts with 'assets/(thirdparties|ublock)/', without a home URL
// Repository --> has checksum (to detect need for update and corruption)
//      Cache --> whatever from above
//      Local --> install time version

var readRepoOnlyAsset = function(path, callback) {

    var assetEntry;

    var reportBack = function(content, err) {
        var details = {
            'path': path,
            'content': content
        };
        if ( err ) {
            details.error = err;
        }
        callback(details);
    };

    var onInstallFileLoaded = function() {
        this.onload = this.onerror = null;
        //console.log('µBlock> readRepoOnlyAsset("%s") / onInstallFileLoaded()', path);
        reportBack(this.responseText);
    };

    var onInstallFileError = function() {
        this.onload = this.onerror = null;
        console.error('µBlock> readRepoOnlyAsset("%s") / onInstallFileError()', path);
        reportBack('', 'Error');
    };

    var onCachedContentLoaded = function(details) {
        //console.log('µBlock> readRepoOnlyAsset("%s") / onCachedContentLoaded()', path);
        reportBack(details.content);
    };

    var onCachedContentError = function() {
        //console.log('µBlock> readRepoOnlyAsset("%s") / onCachedContentError()', path);
        getTextFileFromURL(chrome.runtime.getURL(path), onInstallFileLoaded, onInstallFileError);
    };

    var repositoryURL = repositoryRoot + path + '?ublock=' + Date.now();

    var onRepoFileLoaded = function() {
        this.onload = this.onerror = null;
        if ( typeof this.responseText !== 'string' ) {
            console.error('µBlock> readRepoOnlyAsset("%s") / onRepoFileLoaded("%s"): no response', path, repositoryURL);
            cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
            return;
        }
        if ( YaMD5.hashStr(this.responseText) !== assetEntry.repoChecksum ) {
            console.error('µBlock> readRepoOnlyAsset("%s") / onRepoFileLoaded("%s"): bad md5 checksum', path, repositoryURL);
            cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
            return;
        }
        //console.log('µBlock> readRepoOnlyAsset("%s") / onRepoFileLoaded("%s")', path, repositoryURL);
        assetEntry.localChecksum = assetEntry.repoChecksum;
        updateLocalChecksums();
        cachedAssetsManager.save(path, this.responseText, callback);
    };

    var onRepoFileError = function() {
        this.onload = this.onerror = null;
        console.error('µBlock> readRepoOnlyAsset("%s") / onRepoFileError("%s"):', path, repositoryURL, this.statusText);
        cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
    };

    var onRepoMetaReady = function(meta) {
        assetEntry = meta.entries[path];

        // Asset doesn't exist
        if ( assetEntry === undefined ) {
            reportBack('', 'Error: asset not found');
            return;
        }

        // Asset added or changed: load from repo URL and then cache result
        if ( exports.autoUpdate && assetEntry.localChecksum !== assetEntry.repoChecksum ) {
            //console.log('µBlock> readRepoOnlyAsset("%s") / onRepoMetaReady(): repo has newer version', path);
            getTextFileFromURL(repositoryURL, onRepoFileLoaded, onRepoFileError);
            return;
        }

        // Load from cache
        cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
    };

    getRepoMetadata(onRepoMetaReady);
};

/******************************************************************************/

// Asset doesn't exist. Just for symmetry purpose.

var readNilAsset = function(path, callback) {
    callback({
        'path': path,
        'content': '',
        'error': 'Error: asset not found'
    });
};

/******************************************************************************/

// An external asset:
//       Path --> starts with 'http'
//   External --> https://..., http://...
//      Cache --> has expiration timestamp (in cache)

var readExternalAsset = function(path, callback) {
    var reportBack = function(content, err) {
        var details = {
            'path': path,
            'content': content
        };
        if ( err ) {
            details.error = err;
        }
        callback(details);
    };

    var onCachedContentLoaded = function(details) {
        //console.log('µBlock> readExternalAsset("%s") / onCachedContentLoaded()', path);
        reportBack(details.content);
    };

    var onCachedContentError = function() {
        console.error('µBlock> readExternalAsset("%s") / onCachedContentError()', path);
        reportBack('', 'Error');
    };

    var onExternalFileLoaded = function() {
        this.onload = this.onerror = null;
        //console.log('µBlock> readExternalAsset("%s") / onExternalFileLoaded1()', path);
        cachedAssetsManager.save(path, this.responseText);
        reportBack(this.responseText);
    };

    var onExternalFileError = function() {
        this.onload = this.onerror = null;
        console.error('µBlock> readExternalAsset("%s") / onExternalFileError()', path);
        cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
    };

    var onCacheMetaReady = function(entries) {
        // Fetch from remote if:
        // - Not in cache OR
        // 
        // - Auto-update enabled AND in cache but obsolete
        var timestamp = entries[path];
        var obsolete = Date.now() - exports.autoUpdateDelay;
        if ( typeof timestamp !== 'number' || (exports.autoUpdate && timestamp <= obsolete) ) {
            getTextFileFromURL(path, onExternalFileLoaded, onExternalFileError);
            return;
        }

        // In cache
        cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
    };

    cachedAssetsManager.entries(onCacheMetaReady);
};

/******************************************************************************/

// User data:
//       Path --> starts with 'assets/user/'
//      Cache --> whatever user saved

var readUserAsset = function(path, callback) {
    var onCachedContentLoaded = function(details) {
        //console.log('µBlock> readUserAsset("%s") / onCachedContentLoaded()', path);
        callback({ 'path': path, 'content': details.content });
    };

    var onCachedContentError = function() {
        //console.log('µBlock> readUserAsset("%s") / onCachedContentError()', path);
        callback({ 'path': path, 'content': '' });
    };

    cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
};

/******************************************************************************/

// Assets
//
// A copy of an asset from an external source shipped with the extension:
//       Path --> starts with 'assets/(thirdparties|ublock)/', with a home URL
//   External --> 
// Repository --> has checksum (to detect obsolescence)
//      Cache --> has expiration timestamp (to detect obsolescence)
//      Local --> install time version
//
// An important asset shipped with the extension (usually small, or doesn't
// change often):
//       Path --> starts with 'assets/(thirdparties|ublock)/', without a home URL
// Repository --> has checksum (to detect obsolescence or data corruption)
//      Cache --> whatever from above
//      Local --> install time version
//
// An external filter list:
//       Path --> starts with 'http'
//   External --> 
//      Cache --> has expiration timestamp (to detect obsolescence)
//
// User data:
//       Path --> starts with 'assets/user/'
//      Cache --> whatever user saved
//
// When a checksum is present, it is used to determine whether the asset
// needs to be updated.
// When an expiration timestamp is present, it is used to determine whether
// the asset needs to be updated.
//
// If no update required, an asset if first fetched from the cache. If the
// asset is not cached it is fetched from the closest location: local for 
// an asset shipped with the extension, external for an asset not shipped
// with the extension.

exports.get = function(path, callback) {

    if ( reIsUserPath.test(path) ) {
        readUserAsset(path, callback);
        return;
    }

    if ( reIsExternalPath.test(path) ) {
        readExternalAsset(path, callback);
        return;
    }

    var onRepoMetaReady = function(meta) {
        var assetEntry = meta.entries[path];

        // Asset doesn't exist
        if ( assetEntry === undefined ) {
            readNilAsset(path, callback);
            return;
        }

        // Asset is repo copy of external content
        if ( assetEntry.homeURL !== '' ) {
            readRepoCopyAsset(path, callback);
            return;
        }

        // Asset is repo only
        readRepoOnlyAsset(path, callback);
    };

    getRepoMetadata(onRepoMetaReady);
};

// https://www.youtube.com/watch?v=98y0Q7nLGWk

/******************************************************************************/

exports.getLocal = readLocalFile;

/******************************************************************************/

exports.put = function(path, content, callback) {
    cachedAssetsManager.save(path, content, callback);
};

/******************************************************************************/

exports.purge = function(pattern, before) {
    cachedAssetsManager.remove(pattern, before);
};

/******************************************************************************/

exports.metadata = function(callback) {
    var out = {};

    var onRepoMetaReady = function(meta) {
        var entries = meta.entries;
        var entryRepo, entryOut;
        for ( var path in entries ) {
            if ( entries.hasOwnProperty(path) === false ) {
                continue;
            }
            entryRepo = entries[path];
            entryOut = out[path];
            if ( entryOut === undefined ) {
                entryOut = out[path] = {};
            }
            entryOut.localChecksum = entryRepo.localChecksum;
            entryOut.repoChecksum = entryRepo.repoChecksum;
            entryOut.homeURL = entryRepo.homeURL;
            entryOut.repoObsolete = entryOut.localChecksum !== entryOut.repoChecksum;
            // If the asset has a remote home and there is no corresponding
            // cache entry, it could be obsolete (because the asset could
            // have been modified after uBlock repo was updated).
            if ( entryOut.homeURL && typeof entryOut.lastModified !== 'number' ) {
                entryOut.cacheObsolete = true;
            }
        }
        callback(out);
    };

    var onCacheMetaReady = function(entries) {
        var obsolete = Date.now() - exports.autoUpdateDelay;
        var entryOut;
        for ( var path in entries ) {
            if ( entries.hasOwnProperty(path) === false ) {
                continue;
            }
            entryOut = out[path];
            if ( entryOut === undefined ) {
                entryOut = out[path] = {};
            }
            entryOut.lastModified = entries[path];
            // User data is not literally cache data
            if ( reIsUserPath.test(path) ) {
                continue;
            }
            entryOut.cached = true;
            entryOut.cacheObsolete = entryOut.lastModified <= obsolete;
            if ( reIsExternalPath.test(path) ) {
                entryOut.homeURL = path;
            }
        }
        getRepoMetadata(onRepoMetaReady);
    };

    cachedAssetsManager.entries(onCacheMetaReady);
};

/******************************************************************************/

exports.purgeAll = function(callback) {
    var onMetaDataReady = function(entries) {
        var out = {};
        var entry;
        for ( var path in entries ) {
            if ( entries.hasOwnProperty(path) === false ) {
                continue;
            }
            entry = entries[path];
            if ( !entry.cacheObsolete && !entry.repoObsolete ) {
                continue;
            }
            cachedAssetsManager.remove(path);
            out[path] = true;
        }
        callback(out);
    };

    exports.metadata(onMetaDataReady);
};

/******************************************************************************/

return exports;

/******************************************************************************/

})();

/******************************************************************************/

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

/* global vAPI, µBlock, YaMD5 */

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

'use strict';

/******************************************************************************/

var oneSecond = 1000;
var oneMinute = 60 * oneSecond;
var oneHour = 60 * oneMinute;
var oneDay = 24 * oneHour;

/******************************************************************************/

var projectRepositoryRoot = µBlock.projectServerRoot;
var thirdpartiesRepositoryRoot = 'https://raw.githubusercontent.com/gorhill/uAssets/master/src';
var nullFunc = function() {};
var reIsExternalPath = /^[a-z]+:\/\//;
var reIsUserPath = /^assets\/user\//;
var lastRepoMetaTimestamp = 0;
var lastRepoMetaIsRemote = false;
var refreshRepoMetaPeriod = 5 * oneHour;
var errorCantConnectTo = vAPI.i18n('errorCantConnectTo');

var exports = {
    autoUpdate: true,
    autoUpdateDelay: 4 * oneDay,

    // https://github.com/gorhill/uBlock/issues/426
    allowRemoteFetch: true
};

/******************************************************************************/

var AssetEntry = function() {
    this.localChecksum = '';
    this.repoChecksum = '';
    this.expireTimestamp = 0;
};

var RepoMetadata = function() {
    this.entries = {};
    this.waiting = [];
};

var repoMetadata = null;

// We need these to persist beyond repoMetaData
var homeURLs = {};

/******************************************************************************/

var stringIsNotEmpty = function(s) {
    return typeof s === 'string' && s !== '';
};

/******************************************************************************/

var cacheIsObsolete = function(t) {
    return typeof t !== 'number' || (Date.now() - t) >= exports.autoUpdateDelay;
};

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
            var currentVersion = vAPI.app.version;
            var lastVersion = store.extensionLastVersion || '0.0.0.0';
            if ( currentVersion !== lastVersion ) {
                vAPI.storage.set({ 'extensionLastVersion': currentVersion });
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
                var lastError = vAPI.lastError();
                if ( lastError ) {
                    console.error(
                        'µBlock> cachedAssetsManager> getEntries():',
                        lastError.message
                    );
                }
                entries = bin.cached_asset_entries || {};
            }
            vAPI.storage.get('extensionLastVersion', onLastVersionRead);
        };
        vAPI.storage.get('cached_asset_entries', onLoaded);
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
            var lastError = vAPI.lastError();
            if ( lastError ) {
                details.error = 'Error: ' + lastError.message;
                console.error('µBlock> cachedAssetsManager.load():', details.error);
                cbError(details);
                return;
            }
            // Not sure how this can happen, but I've seen it happen. It could
            // be because the save occurred while I was stepping in the code
            // though, which means it would not occur during normal operation.
            // Still, just to be safe.
            if ( stringIsNotEmpty(bin[cachedContentPath]) === false ) {
                exports.remove(path);
                details.error = 'Error: not found';
                cbError(details);
                return;
            }
            details.content = bin[cachedContentPath];
            cbSuccess(details);
        };
        var onEntries = function(entries) {
            if ( entries[path] === undefined ) {
                details.error = 'Error: not found';
                cbError(details);
                return;
            }
            vAPI.storage.get(cachedContentPath, onLoaded);
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
        if ( content === '' ) {
            exports.remove(path);
            cbSuccess(details);
            return;
        }
        var cachedContentPath = cachedAssetPathPrefix + path;
        var bin = {};
        bin[cachedContentPath] = content;
        var onSaved = function() {
            var lastError = vAPI.lastError();
            if ( lastError ) {
                details.error = 'Error: ' + lastError.message;
                console.error('µBlock> cachedAssetsManager.save():', details.error);
                cbError(details);
            } else {
                cbSuccess(details);
            }
        };
        var onEntries = function(entries) {
            entries[path] = Date.now();
            bin.cached_asset_entries = entries;
            vAPI.storage.set(bin, onSaved);
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
                vAPI.storage.remove(keystoRemove);
                vAPI.storage.set({ 'cached_asset_entries': entries });
            }
        };
        getEntries(onEntries);
    };

    exports.removeAll = function(callback) {
        var onEntries = function() {
            exports.remove(/^https?:\/\/[a-z0-9]+/);
            exports.remove(/^assets\/(ublock|thirdparties)\//);
            exports.remove('assets/checksums.txt');
            if ( typeof callback === 'function' ) {
                callback(null);
            }
        };
        getEntries(onEntries);
    };

    return exports;
})();

/******************************************************************************/

var getTextFileFromURL = function(url, onLoad, onError) {
    // https://github.com/gorhill/uMatrix/issues/15
    var onResponseReceived = function() {
        // xhr for local files gives status 0, but actually succeeds
        if ( (this.status >= 200 && this.status < 300) || (this.status === 0 && this.responseText) ) {
            return onLoad.call(this);
        }
        return onError.call(this);
    };
    // console.log('µBlock> getTextFileFromURL("%s"):', url);
    var xhr = new XMLHttpRequest();
    xhr.open('get', url, true);
    xhr.timeout = 15000;
    xhr.onload = onResponseReceived;
    xhr.onerror = onError;
    xhr.ontimeout = onError;
    xhr.responseType = 'text';
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

    // https://github.com/gorhill/uBlock/issues/515
    // Handle re-entrancy here, i.e. we MUST NOT tamper with the waiting list
    // of callers, if any, except to add one at the end of the list.
    if ( repoMetadata !== null && repoMetadata.waiting.length !== 0 ) {
        repoMetadata.waiting.push(callback);
        return;
    }

    if ( exports.allowRemoteFetch && lastRepoMetaIsRemote === false ) {
        lastRepoMetaTimestamp = 0;
    }
    if ( (Date.now() - lastRepoMetaTimestamp) >= refreshRepoMetaPeriod ) {
        repoMetadata = null;
    }
    if ( repoMetadata !== null ) {
        callback(repoMetadata);
        return;
    }

    lastRepoMetaTimestamp = Date.now();
    lastRepoMetaIsRemote = exports.allowRemoteFetch;

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
        // Notify all waiting callers
        // https://github.com/gorhill/uBlock/issues/515
        // VERY IMPORTANT: because of re-entrancy, we MUST:
        // - process the waiting callers in a FIFO manner
        // - not cache repoMetadata.waiting.length, we MUST use the live
        //   value, because it can change while looping
        // - not change the waiting list until they are all processed
        for ( var i = 0; i < repoMetadata.waiting.length; i++ ) {
            repoMetadata.waiting[i](repoMetadata);
        }
        repoMetadata.waiting.length = 0;
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

exports.setHomeURL = function(path, homeURL) {
    homeURLs[path] = homeURL;
};

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
        this.onload = this.onerror = null;
        //console.log('µBlock> readLocalFile("%s") / onInstallFileLoaded()', path);
        reportBack(this.responseText);
    };

    var onInstallFileError = function() {
        this.onload = this.onerror = null;
        console.error('µBlock> readLocalFile("%s") / onInstallFileError()', path);
        reportBack('', 'Error');
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
        // It's ok for user data to not be found
        if ( reIsUserPath.test(path) ) {
            reportBack('');
            return;
        }
        getTextFileFromURL(vAPI.getURL(details.path), onInstallFileLoaded, onInstallFileError);
    };

    cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
};

// https://www.youtube.com/watch?v=r9KVpuFPtHc

/******************************************************************************/

// Get the repository copy of a built-in asset.

var readRepoFile = function(path, callback) {
    // https://github.com/gorhill/uBlock/issues/426
    if ( exports.allowRemoteFetch === false ) {
        readLocalFile(path, callback);
        return;
    }

    var reportBack = function(content, err) {
        var details = {
            'path': path,
            'content': content,
            'error': err
        };
        callback(details);
    };

    var repositoryURL = projectRepositoryRoot + path;

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
        console.error(errorCantConnectTo.replace('{{url}}', repositoryURL));
        reportBack('', 'Error');
    };

    // 'ublock=...' is to skip browser cache
    getTextFileFromURL(
        repositoryURL + '?ublock=' + Date.now(),
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
    var homeURL = homeURLs[path];

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
        getTextFileFromURL(vAPI.getURL(details.path), onInstallFileLoaded, onInstallFileError);
    };

    var repositoryURL = projectRepositoryRoot + path;
    var repositoryURLSkipCache = repositoryURL + '?ublock=' + Date.now();

    var onRepoFileLoaded = function() {
        this.onload = this.onerror = null;
        if ( stringIsNotEmpty(this.responseText) === false ) {
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
        console.error(errorCantConnectTo.replace('{{url}}', repositoryURL));
        cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
    };

    var onHomeFileLoaded = function() {
        this.onload = this.onerror = null;
        if ( stringIsNotEmpty(this.responseText) === false ) {
            console.error('µBlock> readRepoCopyAsset("%s") / onHomeFileLoaded("%s"): no response', path, homeURL);
            // Fetch from repo only if obsolescence was due to repo checksum
            if ( assetEntry.localChecksum !== assetEntry.repoChecksum ) {
                getTextFileFromURL(repositoryURLSkipCache, onRepoFileLoaded, onRepoFileError);
            } else {
                cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
            }
            return;
        }
        //console.log('µBlock> readRepoCopyAsset("%s") / onHomeFileLoaded("%s")', path, homeURL);
        updateChecksum();
        cachedAssetsManager.save(path, this.responseText, callback);
    };

    var onHomeFileError = function() {
        this.onload = this.onerror = null;
        console.error(errorCantConnectTo.replace('{{url}}', homeURL));
        // Fetch from repo only if obsolescence was due to repo checksum
        if ( assetEntry.localChecksum !== assetEntry.repoChecksum ) {
            getTextFileFromURL(repositoryURLSkipCache, onRepoFileLoaded, onRepoFileError);
        } else {
            cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
        }
    };

    var onCacheMetaReady = function(entries) {
        // Fetch from remote if:
        // - Auto-update enabled AND (not in cache OR in cache but obsolete)
        var timestamp = entries[path];
        var inCache = typeof timestamp === 'number';
        if ( exports.allowRemoteFetch && exports.autoUpdate && stringIsNotEmpty(homeURL) ) {
            if ( inCache === false || cacheIsObsolete(timestamp) ) {
                //console.log('µBlock> readRepoCopyAsset("%s") / onCacheMetaReady(): not cached or obsolete', path);
                getTextFileFromURL(homeURL, onHomeFileLoaded, onHomeFileError);
                return;
            }
        }

        // In cache
        if ( inCache ) {
            cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
            return;
        }

        // Not in cache
        getTextFileFromURL(vAPI.getURL(path), onInstallFileLoaded, onInstallFileError);
    };

    var onRepoMetaReady = function(meta) {
        assetEntry = meta.entries[path];

        // Asset doesn't exist
        if ( assetEntry === undefined ) {
            reportBack('', 'Error: asset not found');
            return;
        }

        // Repo copy changed: fetch from home URL
        if ( exports.allowRemoteFetch && exports.autoUpdate && assetEntry.localChecksum !== assetEntry.repoChecksum ) {
            //console.log('µBlock> readRepoCopyAsset("%s") / onRepoMetaReady(): repo has newer version', path);
            if ( stringIsNotEmpty(homeURL) ) {
                getTextFileFromURL(homeURL, onHomeFileLoaded, onHomeFileError);
            } else {
                getTextFileFromURL(repositoryURLSkipCache, onRepoFileLoaded, onRepoFileError);
            }
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
        getTextFileFromURL(vAPI.getURL(path), onInstallFileLoaded, onInstallFileError);
    };

    var repositoryURL = projectRepositoryRoot + path + '?ublock=' + Date.now();

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
        console.error(errorCantConnectTo.replace('{{url}}', repositoryURL));
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
        if ( exports.allowRemoteFetch && exports.autoUpdate && assetEntry.localChecksum !== assetEntry.repoChecksum ) {
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
        // https://github.com/gorhill/uBlock/issues/708
        // A successful download should never return an empty file: turn this
        // into an error condition.
        if ( stringIsNotEmpty(this.responseText) === false ) {
            onExternalFileError();
            return;
        }
        //console.log('µBlock> readExternalAsset("%s") / onExternalFileLoaded1()', path);
        cachedAssetsManager.save(path, this.responseText);
        reportBack(this.responseText);
    };

    var onExternalFileError = function() {
        this.onload = this.onerror = null;
        console.error(errorCantConnectTo.replace('{{url}}', path));
        cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
    };

    var onCacheMetaReady = function(entries) {
        // Fetch from remote if:
        // - Not in cache OR
        //
        // - Auto-update enabled AND in cache but obsolete
        var timestamp = entries[path];
        var notInCache = typeof timestamp !== 'number';
        var updateCache = exports.allowRemoteFetch && exports.autoUpdate && cacheIsObsolete(timestamp);
        if ( notInCache || updateCache ) {
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
        if ( stringIsNotEmpty(homeURLs[path]) ) {
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

exports.metadata = function(callback) {
    var out = {};

    // https://github.com/gorhill/uBlock/issues/186
    // We need to check cache obsolescence when both cache and repo meta data
    // has been gathered.
    var checkCacheObsolescence = function() {
        var entry;
        for ( var path in out ) {
            if ( out.hasOwnProperty(path) === false ) {
                continue;
            }
            entry = out[path];
            entry.cacheObsolete = stringIsNotEmpty(homeURLs[path]) &&
                                  cacheIsObsolete(entry.lastModified);
        }
        callback(out);
    };

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
            entryOut.homeURL = homeURLs[path] || '';
            entryOut.repoObsolete = entryOut.localChecksum !== entryOut.repoChecksum;
        }
        checkCacheObsolescence();
    };

    var onCacheMetaReady = function(entries) {
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
            if ( reIsExternalPath.test(path) ) {
                entryOut.homeURL = path;
            }
        }
        getRepoMetadata(onRepoMetaReady);
    };

    cachedAssetsManager.entries(onCacheMetaReady);
};

/******************************************************************************/

exports.purge = function(pattern, before) {
    cachedAssetsManager.remove(pattern, before);
};

/******************************************************************************/

exports.purgeAll = function(callback) {
    cachedAssetsManager.removeAll(callback);
};

/******************************************************************************/

return exports;

/******************************************************************************/

})();

/******************************************************************************/

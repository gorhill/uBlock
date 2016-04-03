/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 Raymond Hill

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

/* global YaMD5 */

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
var assetsRepositoryRoot = 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/';
var nullFunc = function() {};
var reIsExternalPath = /^(file|ftps?|https?|resource):\/\//;
var reIsUserPath = /^assets\/user\//;
var reIsCachePath = /^cache:\/\//;
var lastRepoMetaTimestamp = 0;
var lastRepoMetaIsRemote = false;
var refreshRepoMetaPeriod = 5 * oneHour;
var errorCantConnectTo = vAPI.i18n('errorCantConnectTo');
var xhrTimeout = vAPI.localStorage.getItem('xhrTimeout') || 30000;

var exports = {
    autoUpdate: true,
    autoUpdateDelay: 4 * oneDay,

    // https://github.com/chrisaljoudi/uBlock/issues/426
    remoteFetchBarrier: 0
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
        var removedItems = [];
        var onSaved = function() {
            var lastError = vAPI.lastError();
            if ( lastError ) {
                details.error = 'Error: ' + lastError.message;
                console.error('µBlock> cachedAssetsManager.save():', details.error);
                cbError(details);
                return;
            }
            // Saving over an existing item must be seen as removing an
            // existing item and adding a new one.
            if ( typeof exports.onRemovedListener === 'function' ) {
                exports.onRemovedListener(removedItems);
            }
            cbSuccess(details);
        };
        var onEntries = function(entries) {
            if ( entries.hasOwnProperty(path) ) {
                removedItems.push(path);
            }
            entries[path] = Date.now();
            bin.cached_asset_entries = entries;
            vAPI.storage.set(bin, onSaved);
        };
        getEntries(onEntries);
    };

    exports.remove = function(pattern, before) {
        var onEntries = function(entries) {
            var keystoRemove = [];
            var removedItems = [];
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
                removedItems.push(path);
                keystoRemove.push(cachedAssetPathPrefix + path);
                delete entries[path];
            }
            if ( keystoRemove.length ) {
                vAPI.storage.remove(keystoRemove);
                vAPI.storage.set({ 'cached_asset_entries': entries });
                if ( typeof exports.onRemovedListener === 'function' ) {
                    exports.onRemovedListener(removedItems);
                }
            }
        };
        getEntries(onEntries);
    };

    exports.removeAll = function(callback) {
        var onEntries = function() {
            // Careful! do not remove 'assets/user/'
            exports.remove(/^https?:\/\/[a-z0-9]+/);
            exports.remove(/^assets\/(ublock|thirdparties)\//);
            exports.remove(/^cache:\/\//);
            exports.remove('assets/checksums.txt');
            if ( typeof callback === 'function' ) {
                callback(null);
            }
        };
        getEntries(onEntries);
    };

    exports.rmrf = function() {
        exports.remove(/./);
    };

    exports.exists = function(path) {
        return entries !== null && entries.hasOwnProperty(path);
    };

    exports.onRemovedListener = null;

    getEntries(function(){});

    return exports;
})();

/******************************************************************************/

var toRepoURL = function(path) {
    if ( path.startsWith('assets/ublock/filter-lists.json') ) {
        return projectRepositoryRoot + path;
    }

    if ( path.startsWith('assets/checksums.txt') ) {
        return path.replace(
            /^assets\/checksums.txt/,
            assetsRepositoryRoot + 'checksums/ublock0.txt'
        );
    }

    if ( path.startsWith('assets/thirdparties/') ) {
        return path.replace(
            /^assets\/thirdparties\//,
            assetsRepositoryRoot + 'thirdparties/'
        );
    }

    if ( path.startsWith('assets/ublock/') ) {
        return path.replace(
            /^assets\/ublock\//,
            assetsRepositoryRoot + 'filters/'
        );
    }

    // At this point, `path` is assumed to point to a resource specific to
    // this project.
    return projectRepositoryRoot + path;
};

/******************************************************************************/

var getTextFileFromURL = function(url, onLoad, onError) {
    // console.log('µBlock.assets/getTextFileFromURL("%s"):', url);

    if ( typeof onError !== 'function' ) {
        onError = onLoad;
    }

    // https://github.com/gorhill/uMatrix/issues/15
    var onResponseReceived = function() {
        this.onload = this.onerror = this.ontimeout = null;
        // xhr for local files gives status 0, but actually succeeds
        var status = this.status || 200;
        if ( status < 200 || status >= 300 ) {
            return onError.call(this);
        }
        // consider an empty result to be an error
        if ( stringIsNotEmpty(this.responseText) === false ) {
            return onError.call(this);
        }
        // we never download anything else than plain text: discard if response
        // appears to be a HTML document: could happen when server serves
        // some kind of error page I suppose
        var text = this.responseText.trim();
        if ( text.startsWith('<') && text.endsWith('>') ) {
            return onError.call(this);
        }
        return onLoad.call(this);
    };

    var onErrorReceived = function() {
        this.onload = this.onerror = this.ontimeout = null;
        onError.call(this);
    };

    // Be ready for thrown exceptions:
    // I am pretty sure it used to work, but now using a URL such as
    // `file:///` on Chromium 40 results in an exception being thrown.
    var xhr = new XMLHttpRequest();
    try {
        xhr.open('get', url, true);
        xhr.timeout = xhrTimeout;
        xhr.onload = onResponseReceived;
        xhr.onerror = onErrorReceived;
        xhr.ontimeout = onErrorReceived;
        xhr.responseType = 'text';
        xhr.send();
    } catch (e) {
        onErrorReceived.call(xhr);
    }
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

    // https://github.com/chrisaljoudi/uBlock/issues/515
    // Handle re-entrancy here, i.e. we MUST NOT tamper with the waiting list
    // of callers, if any, except to add one at the end of the list.
    if ( repoMetadata !== null && repoMetadata.waiting.length !== 0 ) {
        repoMetadata.waiting.push(callback);
        return;
    }

    if ( exports.remoteFetchBarrier === 0 && lastRepoMetaIsRemote === false ) {
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
    lastRepoMetaIsRemote = exports.remoteFetchBarrier === 0;

    var defaultChecksums;
    var localChecksums;
    var repoChecksums;

    var checksumsReceived = function() {
        if (
            defaultChecksums === undefined ||
            localChecksums === undefined ||
            repoChecksums === undefined
        ) {
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
            // https://github.com/gorhill/uBlock/issues/760
            // If the resource does not have a cached instance, we must reset
            // the checksum to its value at install time.
            if (
                stringIsNotEmpty(defaultChecksums[path]) &&
                entry.localChecksum !== defaultChecksums[path] &&
                cachedAssetsManager.exists(path) === false
            ) {
                entry.localChecksum = defaultChecksums[path];
                checksumsChanged = true;
            }
            // If repo checksums could not be fetched, assume no change.
            // https://github.com/gorhill/uBlock/issues/602
            //   Added: if repo checksum is that of the empty string,
            //   assume no change
            if (
                repoChecksums === '' ||
                entry.repoChecksum === 'd41d8cd98f00b204e9800998ecf8427e'
            ) {
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
        // https://github.com/chrisaljoudi/uBlock/issues/515
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
        // https://github.com/gorhill/uBlock/issues/602
        // External filter lists are not meant to appear in checksums.txt.
        // TODO: remove this code once v1.1.0.0 is everywhere.
        var out = [];
        var listMap = µBlock.oldListToNewListMap;
        var lines = details.content.split(/\s*\n\s*/);
        var line, matches;
        for ( var i = 0; i < lines.length; i++ ) {
            line = lines[i];
            matches = line.match(/^[0-9a-f]+ (.+)$/);
            if ( matches === null || listMap.hasOwnProperty(matches[1]) ) {
               continue;
            }
            out.push(line);
        }
        return out.join('\n');
    };

    var parseChecksums = function(text, eachFn) {
        var lines = text.split(/\n+/);
        var i = lines.length;
        var fields;
        while ( i-- ) {
            fields = lines[i].trim().split(/\s+/);
            if ( fields.length !== 2 ) {
                continue;
            }
            eachFn(fields[1], fields[0]);
        }
    };

    var onLocalChecksumsLoaded = function(details) {
        var entries = repoMetadata.entries;
        var processChecksum = function(path, checksum) {
            if ( entries.hasOwnProperty(path) === false ) {
                entries[path] = new AssetEntry();
            }
            entries[path].localChecksum = checksum;
        };
        if ( (localChecksums = validateChecksums(details)) ) {
            parseChecksums(localChecksums, processChecksum);
        }
        checksumsReceived();
    };

    var onRepoChecksumsLoaded = function(details) {
        var entries = repoMetadata.entries;
        var processChecksum = function(path, checksum) {
            if ( entries.hasOwnProperty(path) === false ) {
                entries[path] = new AssetEntry();
            }
            entries[path].repoChecksum = checksum;
        };
        if ( (repoChecksums = validateChecksums(details)) ) {
            parseChecksums(repoChecksums, processChecksum);
        }
        checksumsReceived();
    };

    // https://github.com/gorhill/uBlock/issues/760
    // We need the checksum values at install time, because some resources
    // may have been purged, in which case the checksum must be reset to the
    // value at install time.
    var onDefaultChecksumsLoaded = function() {
        defaultChecksums = Object.create(null);
        var processChecksum = function(path, checksum) {
            defaultChecksums[path] = checksum;
        };
        parseChecksums(this.responseText || '', processChecksum);
        checksumsReceived();
    };

    repoMetadata = new RepoMetadata();
    repoMetadata.waiting.push(callback);
    readRepoFile('assets/checksums.txt', onRepoChecksumsLoaded);
    getTextFileFromURL(vAPI.getURL('assets/checksums.txt'), onDefaultChecksumsLoaded);
    readLocalFile('assets/checksums.txt', onLocalChecksumsLoaded);
};

// https://www.youtube.com/watch?v=-t3WYfgM4x8

/******************************************************************************/

exports.setHomeURL = function(path, homeURL) {
    if ( typeof homeURL !== 'string' || homeURL === '' ) {
        return;
    }
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
        //console.log('µBlock> readLocalFile("%s") / onInstallFileLoaded()', path);
        reportBack(this.responseText);
    };

    var onInstallFileError = function() {
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
    // https://github.com/chrisaljoudi/uBlock/issues/426
    if ( exports.remoteFetchBarrier !== 0 ) {
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

    var repositoryURL = toRepoURL(path);

    var onRepoFileLoaded = function() {
        //console.log('µBlock> readRepoFile("%s") / onRepoFileLoaded()', path);
        // https://github.com/gorhill/httpswitchboard/issues/263
        if ( this.status === 200 ) {
            reportBack(this.responseText);
        } else {
            reportBack('', 'Error: ' + this.statusText);
        }
    };

    var onRepoFileError = function() {
        console.error(errorCantConnectTo.replace('{{url}}', repositoryURL));
        reportBack('', 'Error');
    };

    // '_=...' is to skip browser cache
    getTextFileFromURL(
        repositoryURL + '?_=' + Date.now(),
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
        //console.log('µBlock> readRepoCopyAsset("%s") / onInstallFileLoaded()', path);
        reportBack(this.responseText);
    };

    var onInstallFileError = function() {
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

    var repositoryURL = toRepoURL(path);
    var repositoryURLSkipCache = repositoryURL + '?_=' + Date.now();

    var onRepoFileLoaded = function() {
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
        console.error(errorCantConnectTo.replace('{{url}}', repositoryURL));
        cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
    };

    var onHomeFileLoaded = function() {
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
        if (
            exports.remoteFetchBarrier === 0 &&
            exports.autoUpdate && stringIsNotEmpty(homeURL)
        ) {
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
        if (
            exports.remoteFetchBarrier === 0 &&
            exports.autoUpdate &&
            assetEntry.localChecksum !== assetEntry.repoChecksum
        ) {
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
        //console.log('µBlock> readRepoOnlyAsset("%s") / onInstallFileLoaded()', path);
        reportBack(this.responseText);
    };

    var onInstallFileError = function() {
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

    var repositoryURL = toRepoURL(path + '?_=' + Date.now());

    var onRepoFileLoaded = function() {
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
        if (
            exports.remoteFetchBarrier === 0 &&
            exports.autoUpdate &&
            assetEntry.localChecksum !== assetEntry.repoChecksum
        ) {
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
        // https://github.com/chrisaljoudi/uBlock/issues/708
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
        var updateCache = exports.remoteFetchBarrier === 0 &&
                          exports.autoUpdate &&
                          cacheIsObsolete(timestamp);
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
        //console.log('µBlock.assets/readUserAsset("%s")/onCachedContentLoaded()', path);
        callback({ 'path': path, 'content': details.content });
    };

    var onCachedContentError = function() {
        //console.log('µBlock.assets/readUserAsset("%s")/onCachedContentError()', path);
        callback({ 'path': path, 'content': '' });
    };

    cachedAssetsManager.load(path, onCachedContentLoaded, onCachedContentError);
};

/******************************************************************************/

// Asset available only from the cache.
// Cache data:
//       Path --> starts with 'cache://'
//      Cache --> whatever

var readCacheAsset = function(path, callback) {
    var onCachedContentLoaded = function(details) {
        //console.log('µBlock.assets/readCacheAsset("%s")/onCachedContentLoaded()', path);
        callback({ 'path': path, 'content': details.content });
    };

    var onCachedContentError = function() {
        //console.log('µBlock.assets/readCacheAsset("%s")/onCachedContentError()', path);
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

    if ( reIsCachePath.test(path) ) {
        readCacheAsset(path, callback);
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

exports.rmrf = function() {
    cachedAssetsManager.rmrf();
};

/******************************************************************************/

exports.rename = function(from, to, callback) {
    var done = function() {
        if ( typeof callback === 'function' ) {
            callback();
        }
    };

    var fromLoaded = function(details) {
        cachedAssetsManager.remove(from);
        cachedAssetsManager.save(to, details.content, callback);
        done();
    };

    var toLoaded = function(details) {
        // `to` already exists: do nothing
        if ( details.content !== '' ) {
            return done();
        }
        cachedAssetsManager.load(from, fromLoaded);
    };

    // If `to` content already exists, do nothing.
    cachedAssetsManager.load(to, toLoaded);
};

/******************************************************************************/

exports.metadata = function(callback) {
    var out = {};

    // https://github.com/chrisaljoudi/uBlock/issues/186
    // We need to check cache obsolescence when both cache and repo meta data
    // has been gathered.
    var checkCacheObsolescence = function() {
        var entry, homeURL;
        for ( var path in out ) {
            if ( out.hasOwnProperty(path) === false ) {
                continue;
            }
            entry = out[path];
            // https://github.com/gorhill/uBlock/issues/528
            // Not having a homeURL property does not mean the filter list
            // is not external.
            homeURL = reIsExternalPath.test(path) ? path : homeURLs[path];
            entry.cacheObsolete = stringIsNotEmpty(homeURL) &&
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
            entryOut.supportURL = entryRepo.supportURL || '';
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

exports.purgeCacheableAsset = function(pattern, before) {
    cachedAssetsManager.remove(pattern, before);
    lastRepoMetaTimestamp = 0;
};

exports.purgeAll = function(callback) {
    cachedAssetsManager.removeAll(callback);
    lastRepoMetaTimestamp = 0;
};

/******************************************************************************/

exports.onAssetCacheRemoved = {
    addEventListener: function(callback) {
        cachedAssetsManager.onRemovedListener = callback || null;
    }
};

/******************************************************************************/

return exports;

})();

/******************************************************************************/
/******************************************************************************/

µBlock.assetUpdater = (function() {

'use strict';

/******************************************************************************/

var µb = µBlock;

var updateDaemonTimer = null;
var autoUpdateDaemonTimerPeriod   = 11 * 60 * 1000; // 11 minutes
var manualUpdateDaemonTimerPeriod =       5 * 1000; //  5 seconds

var updateCycleFirstPeriod  =       7 * 60 * 1000; //  7 minutes
var updateCycleNextPeriod   = 11 * 60 * 60 * 1000; // 11 hours
var updateCycleTime = 0;

var toUpdate = {};
var toUpdateCount = 0;
var updated = {};
var updatedCount = 0;
var metadata = null;

var onStartListener = null;
var onCompletedListener = null;
var onAssetUpdatedListener = null;

var exports = {
    manualUpdate: false,
    manualUpdateProgress: {
        value: 0,
        text: null
    }
};

/******************************************************************************/

var onOneUpdated = function(details) {
    // Resource fetched, we can safely restart the daemon.
    scheduleUpdateDaemon();

    var path = details.path;
    if ( details.error ) {
        manualUpdateNotify(false, updatedCount / (updatedCount + toUpdateCount));
        //console.debug('µBlock.assetUpdater/onOneUpdated: "%s" failed', path);
        return;
    }

    //console.debug('µBlock.assetUpdater/onOneUpdated: "%s"', path);
    updated[path] = true;
    updatedCount += 1;

    if ( typeof onAssetUpdatedListener === 'function' ) {
        onAssetUpdatedListener(details);
    }

    manualUpdateNotify(false, updatedCount / (updatedCount + toUpdateCount + 1));
};

/******************************************************************************/

var updateOne = function() {
    // Because this can be called from outside the daemon's main loop
    µb.assets.autoUpdate = µb.userSettings.autoUpdate || exports.manualUpdate;

    var metaEntry;
    var updatingCount = 0;
    var updatingText = null;

    for ( var path in toUpdate ) {
        if ( toUpdate.hasOwnProperty(path) === false ) {
            continue;
        }
        if ( toUpdate[path] !== true ) {
            continue;
        }
        toUpdate[path] = false;
        toUpdateCount -= 1;
        if ( metadata.hasOwnProperty(path) === false ) {
            continue;
        }
        metaEntry = metadata[path];
        if ( !metaEntry.cacheObsolete && !metaEntry.repoObsolete ) {
            continue;
        }

        // Will restart the update daemon once the resource is received: the
        // fetching of a resource may take some time, possibly beyond the
        // next scheduled daemon cycle, so this ensure the daemon won't do
        // anything else before the resource is fetched (or times out).
        suspendUpdateDaemon();

        //console.debug('µBlock.assetUpdater/updateOne: assets.get("%s")', path);
        µb.assets.get(path, onOneUpdated);
        updatingCount = 1;
        updatingText = metaEntry.homeURL || path;
        break;
    }

    manualUpdateNotify(
        false,
        (updatedCount + updatingCount/2) / (updatedCount + toUpdateCount + updatingCount + 1),
        updatingText
    );
};

/******************************************************************************/

// Update one asset, fetch metadata if not done yet.

var safeUpdateOne = function() {
    if ( metadata !== null ) {
        updateOne();
        return;
    }

    // Because this can be called from outside the daemon's main loop
    µb.assets.autoUpdate = µb.userSettings.autoUpdate || exports.manualUpdate;

    var onMetadataReady = function(response) {
        scheduleUpdateDaemon();
        metadata = response;
        updateOne();
    };

    suspendUpdateDaemon();
    µb.assets.metadata(onMetadataReady);
};

/******************************************************************************/

var safeStartListener = function(callback) {
    // Because this can be called from outside the daemon's main loop
    µb.assets.autoUpdate = µb.userSettings.autoUpdate || exports.manualUpdate;

    var onStartListenerDone = function(assets) {
        scheduleUpdateDaemon();
        assets = assets || {};
        for ( var path in assets ) {
            if ( assets.hasOwnProperty(path) === false ) {
                continue;
            }
            if ( toUpdate.hasOwnProperty(path) ) {
                continue;
            }
            //console.debug('assets.js > µBlock.assetUpdater/safeStartListener: "%s"', path);
            toUpdate[path] = true;
            toUpdateCount += 1;
        }
        if ( typeof callback === 'function' ) {
            callback();
        }
    };

    if ( typeof onStartListener === 'function' ) {
        suspendUpdateDaemon();
        onStartListener(onStartListenerDone);
    } else {
        onStartListenerDone(null);
    }
};

/******************************************************************************/

var updateDaemon = function() {
    updateDaemonTimer = null;
    scheduleUpdateDaemon();

    µb.assets.autoUpdate = µb.userSettings.autoUpdate || exports.manualUpdate;

    if ( µb.assets.autoUpdate !== true ) {
        return;
    }

    // Start an update cycle?
    if ( updateCycleTime !== 0 ) {
        if ( Date.now() >= updateCycleTime ) {
            //console.debug('µBlock.assetUpdater/updateDaemon: update cycle started');
            reset();
            safeStartListener();
        }
        return;
    }

    // Any asset to update?
    if ( toUpdateCount !== 0 ) {
        safeUpdateOne();
        return;
    }
    // Nothing left to update

    // In case of manual update, fire progress notifications
    manualUpdateNotify(true, 1, '');

    // If anything was updated, notify listener
    if ( updatedCount !== 0 ) {
        if ( typeof onCompletedListener === 'function' ) {
            //console.debug('µBlock.assetUpdater/updateDaemon: update cycle completed');
            onCompletedListener({
                updated: JSON.parse(JSON.stringify(updated)), // give callee its own safe copy
                updatedCount: updatedCount
            });
        }
    }

    // Schedule next update cycle
    if ( updateCycleTime === 0 ) {
        reset();
        //console.debug('µBlock.assetUpdater/updateDaemon: update cycle re-scheduled');
        updateCycleTime = Date.now() + updateCycleNextPeriod;
    }
};

/******************************************************************************/

var scheduleUpdateDaemon = function() {
    if ( updateDaemonTimer !== null ) {
        clearTimeout(updateDaemonTimer);
    }
    updateDaemonTimer = vAPI.setTimeout(
        updateDaemon,
        exports.manualUpdate ? manualUpdateDaemonTimerPeriod : autoUpdateDaemonTimerPeriod
    );
};

var suspendUpdateDaemon = function() {
    if ( updateDaemonTimer !== null ) {
        clearTimeout(updateDaemonTimer);
        updateDaemonTimer = null;
    }
};

scheduleUpdateDaemon();

/******************************************************************************/

var reset = function() {
    toUpdate = {};
    toUpdateCount = 0;
    updated = {};
    updatedCount = 0;
    updateCycleTime = 0;
    metadata = null;
};

/******************************************************************************/

var manualUpdateNotify = function(done, value, text) {
    if ( exports.manualUpdate === false ) {
        return;
    }

    exports.manualUpdate = !done;
    exports.manualUpdateProgress.value = value || 0;
    if ( typeof text === 'string' ) {
        exports.manualUpdateProgress.text = text;
    }

    vAPI.messaging.broadcast({
        what: 'forceUpdateAssetsProgress',
        done: !exports.manualUpdate,
        progress: exports.manualUpdateProgress,
        updatedCount: updatedCount
    });

    // When manually updating, whatever launched the manual update is
    // responsible to launch a reload of the filter lists.
    if ( exports.manualUpdate !== true ) {
        reset();
    }
};

/******************************************************************************/

// Manual update: just a matter of forcing the update daemon to work on a
// tighter schedule.

exports.force = function() {
    if ( exports.manualUpdate ) {
        return;
    }

    reset();

    exports.manualUpdate = true;

    var onStartListenerDone = function() {
        if ( toUpdateCount === 0 ) {
            updateCycleTime = Date.now() + updateCycleNextPeriod;
            manualUpdateNotify(true, 1);
        } else {
            manualUpdateNotify(false, 0);
            safeUpdateOne();
        }
    };

    safeStartListener(onStartListenerDone);
};

/******************************************************************************/

exports.onStart = {
    addEventListener: function(callback) {
        onStartListener = callback || null;
        if ( typeof onStartListener === 'function' ) {
            updateCycleTime = Date.now() + updateCycleFirstPeriod;
        }
    }
};

/******************************************************************************/

exports.onAssetUpdated = {
    addEventListener: function(callback) {
        onAssetUpdatedListener = callback || null;
    }
};

/******************************************************************************/

exports.onCompleted = {
    addEventListener: function(callback) {
        onCompletedListener = callback || null;
    }
};

/******************************************************************************/

// Typically called when an update has been forced.

exports.restart = function() {
    reset();
    updateCycleTime = Date.now() + updateCycleNextPeriod;
};

/******************************************************************************/

// Call when disabling uBlock, to ensure it doesn't stick around as a detached
// window object in Firefox.

exports.shutdown = function() {
    suspendUpdateDaemon();
    reset();
};

/******************************************************************************/

return exports;

})();

/******************************************************************************/

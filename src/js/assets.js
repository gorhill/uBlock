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

'use strict';

/******************************************************************************/

µBlock.assets = (function() {

/******************************************************************************/

var reIsExternalPath = /^(?:file|ftps?|https?|resource):\/\//;
var reIsUserAsset = /^user-/;
var errorCantConnectTo = vAPI.i18n('errorCantConnectTo');
var xhrTimeout = vAPI.localStorage.getItem('xhrTimeout') || 30000;

var api = {
};

/******************************************************************************/

var observers = [];

api.addObserver = function(observer) {
    if ( observers.indexOf(observer) === -1 ) {
        observers.push(observer);
    }
};

api.removeObserver = function(observer) {
    var pos;
    while ( (pos = observers.indexOf(observer)) !== -1 ) {
        observers.splice(pos, 1);
    }
};

var fireNotification = function(topic, details) {
    var result;
    for ( var i = 0; i < observers.length; i++ ) {
        if ( observers[i](topic, details) === false ) {
            result = false;
        }
    }
    return result;
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
        µBlock.logger.writeOne('', 'error', errorCantConnectTo.replace('{{msg}}', ''));
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

/*******************************************************************************

    The purpose of the asset source registry is to keep key detail information
    about an asset:
    - Where to load it from: this may consist of one or more URLs, either local
      or remote.
    - After how many days an asset should be deemed obsolete -- i.e. in need of
      an update.
    - The origin and type of an asset.
    - The last time an asset was registered.

**/

var assetSourceRegistryStatus,
    assetSourceRegistry = Object.create(null);

var registerAssetSource = function(assetKey, details) {
    var contentURL = details.contentURL || [];
    if ( typeof contentURL === 'string' ) {
        contentURL = [ contentURL ];
    }
    var updateAfter = details.updateAfter || 11;
    var submitter = details.submitter || undefined;
    var entry = assetSourceRegistry[assetKey];
    if ( entry === undefined ) {
        entry = Object.create(null);
    }
    var remoteURLCount = 0;
    for ( var i = 0; i < contentURL.length; i++ ) {
        if ( reIsExternalPath.test(contentURL[i]) ) {
            remoteURLCount += 1;
        }
    }
    entry.contentURL = contentURL;
    entry.hasLocalURL = remoteURLCount !== contentURL.length;
    entry.hasRemoteURL = remoteURLCount !== 0;
    entry.updateAfter = updateAfter;
    entry.submitter = submitter;
    if ( entry.submitter ) {
        entry.submitTime = Date.now(); // To detect stale entries
    }
    assetSourceRegistry[assetKey] = entry;
};

var registerAssetError = function(assetKey, details) {
    getAssetSourceRegistry(function() {
        var entry = assetSourceRegistry[assetKey];
        if ( entry === undefined ) { return; }
        entry.error = details;
    });
};

var saveAssetSourceRegistry = (function() {
    var timer;
    var save = function() {
        timer = undefined;
        vAPI.cacheStorage.set({ assetSourceRegistry: assetSourceRegistry });
    };
    return function(lazily) {
        if ( timer !== undefined ) {
            clearTimeout(timer);
        }
        if ( lazily ) {
            timer = vAPI.setTimeout(save, 500);
        } else {
            save();
        }
    };
})();

var getAssetSourceRegistry = function(callback) {
    // Already loaded.
    if ( assetSourceRegistryStatus === 'ready' ) {
        callback(assetSourceRegistry);
        return;
    }

    // Being loaded.
    if ( Array.isArray(assetSourceRegistryStatus) ) {
        assetSourceRegistryStatus.push(callback);
        return;
    }

    // Not loaded: load it.
    assetSourceRegistryStatus = [ callback ];

    var registryReady = function() {
        var callers = assetSourceRegistryStatus;
        assetSourceRegistryStatus = 'ready';
        var fn;
        while ( (fn = callers.shift()) ) {
            fn(assetSourceRegistry);
        }
    };

    // First-install case.
    var createRegistry = function() {
        getTextFileFromURL(vAPI.getURL('assets/assets.json'), function() {
            var assetDict;
            try {
                assetDict = JSON.parse(this.responseText);
            } catch (ex) {
            }
            for ( var assetKey in assetDict ) {
                registerAssetSource(assetKey, assetDict[assetKey]);
            }
            saveAssetSourceRegistry();
            registryReady();
        });
    };

    vAPI.cacheStorage.get('assetSourceRegistry', function(bin) {
        if ( !bin || !bin.assetSourceRegistry ) {
            createRegistry();
            return;
        }
        assetSourceRegistry = bin.assetSourceRegistry;
        registryReady();
    });
};

//var updateAssetSourceRegistry = function(raw) {};

api.getAssetSourceRegistry = function(callback) {
    getAssetSourceRegistry(function() {
        callback(JSON.parse(JSON.stringify(assetSourceRegistry)));
    });
};

api.registerAssetSource = function(assetKey, details) {
    getAssetSourceRegistry(function() {
        registerAssetSource(assetKey, details);
        saveAssetSourceRegistry();
    });
};

/*******************************************************************************

    The purpose of the asset cache registry is to keep track of all assets
    which have been persisted into the local cache.

**/

var assetCacheRegistryStatus,
    assetCacheRegistry = {};

var getAssetCacheRegistry = function(callback) {
    // Already loaded.
    if ( assetCacheRegistryStatus === 'ready' ) {
        callback(assetCacheRegistry);
        return;
    }

    // Being loaded.
    if ( Array.isArray(assetCacheRegistryStatus) ) {
        assetCacheRegistryStatus.push(callback);
        return;
    }

    // Not loaded: load it.
    assetCacheRegistryStatus = [ callback ];

    var registryReady = function() {
        var callers = assetCacheRegistryStatus;
        assetCacheRegistryStatus = 'ready';
        var fn;
        while ( (fn = callers.shift()) ) {
            fn(assetCacheRegistry);
        }
    };

    vAPI.cacheStorage.get('assetCacheRegistry', function(bin) {
        if ( bin && bin.assetCacheRegistry ) {
            assetCacheRegistry = bin.assetCacheRegistry;
        }
        registryReady();
    });
};

var saveAssetCacheRegistry = (function() {
    var timer;
    var save = function() {
        timer = undefined;
        vAPI.cacheStorage.set({ assetCacheRegistry: assetCacheRegistry });
    };
    return function(lazily) {
        if ( timer !== undefined ) {
            clearTimeout(timer);
        }
        if ( lazily ) {
            timer = vAPI.setTimeout(save, 500);
        } else {
            save();
        }
    };
})();

var assetCacheRead = function(assetKey, callback) {
    var internalKey = 'cache/' + assetKey;

    var reportBack = function(content, err) {
        var details = { assetKey: assetKey, content: content };
        if ( err ) { details.error = err; }
        callback(details);
    };

    var onAssetRead = function(bin) {
        if ( !bin || !bin[internalKey] ) {
            return reportBack('', 'E_NOTFOUND');
        }
        var entry = assetCacheRegistry[assetKey];
        if ( entry === undefined ) {
            return reportBack('', 'E_NOTFOUND');
        }
        entry.readTime = Date.now();
        saveAssetCacheRegistry(true);
        reportBack(bin[internalKey]);
    };

    var onReady = function() {
        vAPI.cacheStorage.get(internalKey, onAssetRead);
    };

    getAssetCacheRegistry(onReady);
};

var assetCacheWrite = function(assetKey, details, callback) {
    var internalKey = 'cache/' + assetKey;
    var content = '';
    if ( typeof details === 'string' ) {
        content = details;
    } else if ( details instanceof Object ) {
        content = details.content || '';
    }

    if ( content === '' ) {
        return assetCacheRemove(assetKey, callback);
    }

    var reportBack = function(content) {
        var details = { assetKey: assetKey, content: content };
        if ( typeof callback === 'function' ) {
            callback(details);
        }
        fireNotification('after-asset-updated', details);
    };

    var onReady = function() {
        var entry = assetCacheRegistry[assetKey];
        if ( entry === undefined ) {
            entry = assetCacheRegistry[assetKey] = {};
        }
        entry.writeTime = entry.readTime = Date.now();
        if ( details instanceof Object && typeof details.url === 'string' ) {
            entry.remoteURL = details.url;
        }
        var bin = { assetCacheRegistry: assetCacheRegistry };
        bin[internalKey] = content;
        vAPI.cacheStorage.set(bin);
        reportBack(content);
    };
    getAssetCacheRegistry(onReady);
};

var assetCacheRemove = function(pattern, callback) {
    var onReady = function() {
        var cacheDict = assetCacheRegistry,
            removedEntries = [],
            removedContent = [];
        for ( var assetKey in cacheDict ) {
            if ( pattern instanceof RegExp && !pattern.test(assetKey) ) {
                continue;
            }
            if ( typeof pattern === 'string' && assetKey !== pattern ) {
                continue;
            }
            removedEntries.push(assetKey);
            removedContent.push('cache/' + assetKey);
            delete cacheDict[assetKey];
        }
        if ( removedContent.length !== 0 ) {
            vAPI.cacheStorage.remove(removedContent);
            var bin = { assetCacheRegistry: assetCacheRegistry };
            vAPI.cacheStorage.set(bin);
        }
        if ( typeof callback === 'function' ) {
            callback();
        }
        for ( var i = 0; i < removedEntries.length; i++ ) {
            fireNotification('after-asset-updated', { assetKey: removedEntries[i] });
        }
    };

    getAssetCacheRegistry(onReady);
};

var assetCacheMarkAsDirty = function(pattern, callback) {
    var onReady = function() {
        var cacheDict = assetCacheRegistry,
            cacheEntry,
            mustSave = false;
        for ( var assetKey in cacheDict ) {
            if ( pattern instanceof RegExp && !pattern.test(assetKey) ) {
                continue;
            }
            if ( typeof pattern === 'string' && assetKey !== pattern ) {
                continue;
            }
            cacheEntry = cacheDict[assetKey];
            if ( !cacheEntry.writeTime ) { continue; }
            cacheDict[assetKey].writeTime = 0;
            mustSave = true;
        }
        if ( mustSave ) {
            var bin = { assetCacheRegistry: assetCacheRegistry };
            vAPI.cacheStorage.set(bin);
        }
        if ( typeof callback === 'function' ) {
            callback();
        }
    };

    getAssetCacheRegistry(onReady);
};

/******************************************************************************/

var stringIsNotEmpty = function(s) {
    return typeof s === 'string' && s !== '';
};

/*******************************************************************************

    TODO: This will be removed when I am confident all users have moved
    to a version of uBO which does not require the old way to persist cached
    assets.

**/

(function() {
    vAPI.cacheStorage.get('cached_asset_entries', function(bin) {
        var entries = bin && bin['cached_asset_entries'];
        if ( !entries ) { return; }
        var keystoRemove = [],
            paths = Object.keys(entries),
            i = paths.length,
            path;
        while ( i-- ) {
            path = paths[i];
            if ( path === 'assets/user/filters.txt' ) { continue; }
            keystoRemove.push('cached_asset_content://' + path);
        }
        keystoRemove.push('extensionLastVersion');
        keystoRemove.push('cached_asset_entries');
        vAPI.cacheStorage.remove(keystoRemove);
    });
})();

/*******************************************************************************

    User assets are NOT persisted in the cache storage. User assets are
    recognized by the asset key which always starts with 'user-'.

    TODO: Revisit when I am confident all users have moved to a version of uBO
    which does not require the old way to persist user assets.

**/

var readUserAsset = function(assetKey, callback) {
    // TODO: remove old cruft when confident all users moved to uBO 1.11.0+.
    var reportBack = function(content) {
        callback({ assetKey: assetKey, content: content });
    };

    var onLoaded = function(bin) {
        if ( !bin ) {
            return reportBack('');
        }
        var content = '';
        if ( typeof bin['cached_asset_content://assets/user/filters.txt'] === 'string' ) {
            content = bin['cached_asset_content://assets/user/filters.txt'];
            vAPI.cacheStorage.remove('cached_asset_content://assets/user/filters.txt');
        }
        if ( typeof bin['assets/user/filters.txt'] === 'string' ) {
            content = bin['assets/user/filters.txt'];
            vAPI.storage.remove('assets/user/filters.txt');
        }
        if ( typeof bin[assetKey] === 'string' ) {
            content = bin[assetKey];
        }
        return reportBack(content);
    };

    vAPI.storage.get(
        [
            assetKey,
            'assets/user/filters.txt',
            'cached_asset_content://assets/user/filters.txt'
        ],
        onLoaded
    );
};

var saveUserAsset = function(assetKey, content, callback) {
    var bin = {};
    bin[assetKey] = content;
    var onSaved = function() {
        if ( callback instanceof Function ) {
            callback({ assetKey: assetKey, content: content });
        }
    };
    vAPI.storage.set(bin, onSaved);
};

/******************************************************************************/

api.get = function(assetKey, callback) {
    if ( reIsUserAsset.test(assetKey) ) {
        readUserAsset(assetKey, callback);
        return;
    }

    var assetDetails = {},
        contentURLs,
        contentURL;

    var reportBack = function(content, err) {
        var details = { assetKey: assetKey, content: content };
        if ( err ) {
            details.error = assetDetails.lastError = err;
        } else {
            assetDetails.lastError = undefined;
        }
        callback(details);
    };

    var onContentNotLoaded = function() {
        var isExternal;
        while ( (contentURL = contentURLs.shift()) ) {
            isExternal = reIsExternalPath.test(contentURL);
            if ( isExternal === false || assetDetails.hasLocalURL !== true ) {
                break;
            }
        }
        if ( !contentURL ) {
            return reportBack('', 'E_NOTFOUND');
        }
        getTextFileFromURL(
            isExternal ? contentURL : vAPI.getURL(contentURL),
            onContentLoaded,
            onContentNotLoaded
        );
    };

    var onContentLoaded = function() {
        if ( stringIsNotEmpty(this.responseText) === false ) {
            onContentNotLoaded();
            return;
        }
        if ( reIsExternalPath.test(contentURL) ) {
            assetCacheWrite(assetKey, {
                content: this.responseText,
                url: contentURL
            });
        }
        reportBack(this.responseText);
    };

    var onCachedContentLoaded = function(details) {
        if ( details.content !== '' ) {
            return reportBack(details.content);
        }
        getAssetSourceRegistry(function(registry) {
            assetDetails = registry[assetKey] || {};
            if ( typeof assetDetails.contentURL === 'string' ) {
                contentURLs = [ assetDetails.contentURL ];
            } else if ( Array.isArray(assetDetails.contentURL) ) {
                contentURLs = assetDetails.contentURL.slice(0);
            } else {
                contentURLs = [];
            }
            onContentNotLoaded();
        });
    };

    assetCacheRead(assetKey, onCachedContentLoaded);
};

/******************************************************************************/

var getRemote = function(assetKey, callback) {
   var assetDetails = {},
        contentURLs,
        contentURL;

    var reportBack = function(content, err) {
        var details = { assetKey: assetKey, content: content };
        if ( err ) {
            details.error = assetDetails.lastError = err;
        } else {
            assetDetails.lastError = undefined;
        }
        callback(details);
    };

    var onRemoteContentLoaded = function() {
        if ( stringIsNotEmpty(this.responseText) === false ) {
            registerAssetError(assetKey, { time: Date.now(), error: 'No content' });
            tryLoading();
            return;
        }
        assetCacheWrite(assetKey, {
            content: this.responseText,
            url: contentURL
        });
        registerAssetError(assetKey);
        reportBack(this.responseText);
    };

    var onRemoteContentError = function() {
        registerAssetError(assetKey, { time: Date.now(), error: this.statusText });
        tryLoading();
    };

    var tryLoading = function() {
        while ( (contentURL = contentURLs.shift()) ) {
            if ( reIsExternalPath.test(contentURL) ) { break; }
        }
        if ( !contentURL ) {
            return reportBack('', 'E_NOTFOUND');
        }
        getTextFileFromURL(contentURL, onRemoteContentLoaded, onRemoteContentError);
    };

    getAssetSourceRegistry(function(registry) {
        assetDetails = registry[assetKey] || {};
        if ( typeof assetDetails.contentURL === 'string' ) {
            contentURLs = [ assetDetails.contentURL ];
        } else if ( Array.isArray(assetDetails.contentURL) ) {
            contentURLs = assetDetails.contentURL.slice(0);
        } else {
            contentURLs = [];
        }
        tryLoading();
    });
};

/******************************************************************************/

api.put = function(assetKey, content, callback) {
    if ( reIsUserAsset.test(assetKey) ) {
        return saveUserAsset(assetKey, content, callback);
    }
    assetCacheWrite(assetKey, content, callback);
};

/******************************************************************************/

api.metadata = function(callback) {
    var assetRegistryReady = false,
        cacheRegistryReady = false;

    var onReady = function() {
        var assetDict = JSON.parse(JSON.stringify(assetSourceRegistry)),
            cacheDict = assetCacheRegistry,
            assetEntry, cacheEntry,
            now = Date.now(), obsoleteAfter;
        for ( var assetKey in assetDict ) {
            assetEntry = assetDict[assetKey];
            cacheEntry = cacheDict[assetKey];
            if ( cacheEntry ) {
                assetEntry.cached = true;
                assetEntry.writeTime = cacheEntry.writeTime;
                obsoleteAfter = cacheEntry.writeTime + assetEntry.updateAfter * 86400000;
                assetEntry.obsolete = obsoleteAfter < now;
                assetEntry.remoteURL = cacheEntry.remoteURL;
            } else {
                assetEntry.writeTime = 0;
                obsoleteAfter = 0;
                assetEntry.obsolete = true;
            }
        }
        callback(assetDict);
    };

    getAssetSourceRegistry(function() {
        assetRegistryReady = true;
        if ( cacheRegistryReady ) { onReady(); }
    });

    getAssetCacheRegistry(function() {
        cacheRegistryReady = assetCacheRegistry;
        if ( assetRegistryReady ) { onReady(); }
    });
};

/******************************************************************************/

api.purge = function(pattern, callback) {
    assetCacheMarkAsDirty(pattern, callback);
};

api.remove = function(pattern, callback) {
    assetCacheRemove(pattern, callback);
};

api.rmrf = function() {
    assetCacheRemove(/./);
};

/******************************************************************************/

// Asset updater area.

var updateStatus;
var updateTimer;
var updateAssetDelay = 4000;
var updated = [];

var updateFirst = function() {
    updateStatus = 'updating';
    updated = [];

    fireNotification('before-assets-updated');

    updateNext();
};

var updateNext = function() {

    var assetDict, cacheDict;

    var findOne = function() {
        var now = Date.now(),
            assetEntry, cacheEntry;
        for ( var assetKey in assetDict ) {
            assetEntry = assetDict[assetKey];
            if ( assetEntry.hasRemoteURL !== true ) { continue; }
            cacheEntry = cacheDict[assetKey];
            if ( cacheEntry && (cacheEntry.writeTime + assetEntry.updateAfter * 86400000) > now ) {
                continue;
            }
            if ( assetEntry.error ) {
                if ( assetEntry.error.time + 3600000 > now ) {
                    continue;
                }
            }
            if ( fireNotification('before-asset-updated', { assetKey: assetKey }) !== false ) {
                return assetKey;
            }
        }
    };

    var updatedOne = function(details) {
        if ( details.content !== '' ) {
            updated.push(details.assetKey);
        }
        if ( findOne() !== undefined ) {
            vAPI.setTimeout(updateNext, updateAssetDelay);
        } else {
            updateDone();
        }
    };

    var updateOne = function() {
        var assetKey = findOne();
        if ( assetKey === undefined ) {
            return updateDone();
        }
        getRemote(assetKey, updatedOne);
    };

    getAssetSourceRegistry(function(dict) {
        assetDict = dict;
        if ( !cacheDict ) { return; }
        updateOne();
    });

    getAssetCacheRegistry(function(dict) {
        cacheDict = dict;
        if ( !assetDict ) { return; }
        updateOne();
    });
};

var updateDone = function() {
    var assetKeys = updated.slice(0);
    updated = [];
    updateStatus = undefined;
    fireNotification('after-assets-updated', { assetKeys: assetKeys });
};

api.updateStart = function(details) {
    updateAssetDelay = details.delay;
    if ( updateStatus !== undefined ) {
        clearTimeout(updateTimer);
        updateTimer = vAPI.setTimeout(updateNext, updateAssetDelay);
        return;
    }
    updateFirst();
};

api.updateStop = function() {
    if ( updateTimer ) {
        clearTimeout(updateTimer);
        updateTimer = undefined;
    }
    if ( updateStatus !== undefined ) {
        updateDone();
    }
};

/******************************************************************************/

return api;

/******************************************************************************/

})();

/******************************************************************************/

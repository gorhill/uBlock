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

'use strict';

/******************************************************************************/

µBlock.assets = (function() {

/******************************************************************************/

const reIsExternalPath = /^(?:[a-z-]+):\/\//,
    reIsUserAsset = /^user-/,
    errorCantConnectTo = vAPI.i18n('errorCantConnectTo'),
    noopfunc = function(){};

const api = {};

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
    var result, r;
    for ( var i = 0; i < observers.length; i++ ) {
        r = observers[i](topic, details);
        if ( r !== undefined ) { result = r; }
    }
    return result;
};

/******************************************************************************/

api.fetchText = function(url, onLoad, onError) {
    const isExternal = reIsExternalPath.test(url);
    let actualUrl = isExternal ? url : vAPI.getURL(url);

    // https://github.com/gorhill/uBlock/issues/2592
    //   Force browser cache to be bypassed, but only for resources which have
    //   been fetched more than one hour ago.
    if ( isExternal ) {
        const queryValue = `_=${Math.floor(Date.now() / 3600000) % 12}`;
        if ( actualUrl.indexOf('?') === -1 ) {
            actualUrl += '?';
        } else {
            actualUrl += '&';
        }
        actualUrl += queryValue;
    }

    if ( typeof onError !== 'function' ) {
        onError = onLoad;
    }

    return new Promise(resolve => {
    // Start of executor

    const timeoutAfter = µBlock.hiddenSettings.assetFetchTimeout * 1000 || 30000;
    const xhr = new XMLHttpRequest();
    let contentLoaded = 0;
    let timeoutTimer;

    const cleanup = function() {
        xhr.removeEventListener('load', onLoadEvent);
        xhr.removeEventListener('error', onErrorEvent);
        xhr.removeEventListener('abort', onErrorEvent);
        xhr.removeEventListener('progress', onProgressEvent);
        if ( timeoutTimer !== undefined ) {
            clearTimeout(timeoutTimer);
            timeoutTimer = undefined;
        }
    };

    const onResolve = function(details) {
        if ( onLoad instanceof Function ) {
            return onLoad(details);
        }
        resolve(details);
    };

    const onReject = function(details) {
        if ( onError instanceof Function ) {
            return onError(details);
        }
        resolve(details);
    };

    // https://github.com/gorhill/uMatrix/issues/15
    const onLoadEvent = function() {
        cleanup();
        // xhr for local files gives status 0, but actually succeeds
        const details = {
            url,
            content: '',
            statusCode: this.status || 200,
            statusText: this.statusText || ''
        };
        if ( details.statusCode < 200 || details.statusCode >= 300 ) {
            return onReject(details);
        }
        // consider an empty result to be an error
        if ( stringIsNotEmpty(this.responseText) === false ) {
            return onReject(details);
        }
        // we never download anything else than plain text: discard if response
        // appears to be a HTML document: could happen when server serves
        // some kind of error page I suppose
        const text = this.responseText.trim();
        if ( text.startsWith('<') && text.endsWith('>') ) {
            return onReject(details);
        }
        details.content = this.responseText;
        onResolve(details);
    };

    const onErrorEvent = function() {
        cleanup();
        µBlock.logger.writeOne({
            realm: 'message',
            type: 'error',
            text: errorCantConnectTo.replace('{{msg}}', actualUrl)
        });
        onReject({ url, content: '' });
    };

    const onTimeout = function() {
        xhr.abort();
    };

    // https://github.com/gorhill/uBlock/issues/2526
    // - Timeout only when there is no progress.
    const onProgressEvent = function(ev) {
        if ( ev.loaded === contentLoaded ) { return; }
        contentLoaded = ev.loaded;
        if ( timeoutTimer !== undefined ) {
            clearTimeout(timeoutTimer); 
        }
        timeoutTimer = vAPI.setTimeout(onTimeout, timeoutAfter);
    };

    // Be ready for thrown exceptions:
    // I am pretty sure it used to work, but now using a URL such as
    // `file:///` on Chromium 40 results in an exception being thrown.
    try {
        xhr.open('get', actualUrl, true);
        xhr.addEventListener('load', onLoadEvent);
        xhr.addEventListener('error', onErrorEvent);
        xhr.addEventListener('abort', onErrorEvent);
        xhr.addEventListener('progress', onProgressEvent);
        xhr.responseType = 'text';
        xhr.send();
        timeoutTimer = vAPI.setTimeout(onTimeout, timeoutAfter);
    } catch (e) {
        onErrorEvent.call(xhr);
    }

    // End of executor
    });
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/3331
//   Support the seamless loading of sublists.

api.fetchFilterList = function(mainlistURL, onLoad, onError) {
    const content = [];
    const pendingSublistURLs = new Set([ mainlistURL ]);
    const loadedSublistURLs = new Set();
    const toParsedURL = api.fetchFilterList.toParsedURL;

    // https://github.com/NanoAdblocker/NanoCore/issues/239
    //   Anything under URL's root directory is allowed to be fetched. The
    //   URL of a sublist will always be relative to the URL of the parent
    //   list (instead of the URL of the root list).
    const rootDirectoryURL = toParsedURL(mainlistURL);
    if ( rootDirectoryURL !== undefined ) {
        const pos = rootDirectoryURL.pathname.lastIndexOf('/');
        if ( pos !== -1 ) {
            rootDirectoryURL.pathname =
                rootDirectoryURL.pathname.slice(0, pos + 1);
        }
    }

    let errored = false;

    const processIncludeDirectives = function(details) {
        const reInclude = /^!#include +(\S+)/gm;
        const out = [];
        const content = details.content;
        let lastIndex = 0;
        for (;;) {
            const match = reInclude.exec(content);
            if ( match === null ) { break; }
            if ( toParsedURL(match[1]) !== undefined ) { continue; }
            if ( match[1].indexOf('..') !== -1 ) { continue; }
            const subURL = toParsedURL(details.url);
            subURL.pathname = subURL.pathname.replace(/[^/]+$/, match[1]);
            if ( subURL.href.startsWith(rootDirectoryURL.href) === false ) {
                continue;
            }
            if ( pendingSublistURLs.has(subURL.href) ) { continue; }
            if ( loadedSublistURLs.has(subURL.href) ) { continue; }
            pendingSublistURLs.add(subURL.href);
            api.fetchText(subURL.href, onLocalLoadSuccess, onLocalLoadError);
            out.push(content.slice(lastIndex, match.index).trim(), subURL.href);
            lastIndex = reInclude.lastIndex;
        }
        out.push(lastIndex === 0 ? content : content.slice(lastIndex).trim());
        return out;
    };

    const onLocalLoadSuccess = function(details) {
        if ( errored ) { return; }

        const isSublist = details.url !== mainlistURL;

        pendingSublistURLs.delete(details.url);
        loadedSublistURLs.add(details.url);

        // https://github.com/uBlockOrigin/uBlock-issues/issues/329
        //   Insert fetched content at position of related #!include directive
        let slot = isSublist ? content.indexOf(details.url) : 0;
        if ( isSublist ) {
            content.splice(
                slot,
                1,
                '! >>>>>>>> ' + details.url,
                details.content.trim(),
                '! <<<<<<<< ' + details.url
            );
            slot += 1;
        } else {
            content[0] = details.content.trim();
        }

        // Find and process #!include directives
        if (
            rootDirectoryURL !== undefined &&
            rootDirectoryURL.pathname.length > 0
        ) {
            const processed = processIncludeDirectives(details);
            if ( processed.length > 1 ) {
                content.splice(slot, 1, ...processed);
            }
        }

        if ( pendingSublistURLs.size !== 0 ) { return; }

        details.url = mainlistURL;
        details.content = content.join('\n').trim();
        onLoad(details);
    };

    // https://github.com/AdguardTeam/FiltersRegistry/issues/82
    //   Not checking for `errored` status was causing repeated notifications
    //   to the caller. This can happen when more than one out of multiple
    //   sublists can't be fetched.
    const onLocalLoadError = function(details) {
        if ( errored ) { return; }

        errored = true;
        details.url = mainlistURL;
        details.content = '';
        onError(details);
    };

    this.fetchText(mainlistURL, onLocalLoadSuccess, onLocalLoadError);
};

api.fetchFilterList.toParsedURL = function(url) {
    try {
        return new URL(url);
    } catch (ex) {
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

let assetSourceRegistryPromise,
    assetSourceRegistry = Object.create(null);

const registerAssetSource = function(assetKey, dict) {
    const entry = assetSourceRegistry[assetKey] || {};
    for ( const prop in dict ) {
        if ( dict.hasOwnProperty(prop) === false ) { continue; }
        if ( dict[prop] === undefined ) {
            delete entry[prop];
        } else {
            entry[prop] = dict[prop];
        }
    }
    let contentURL = dict.contentURL;
    if ( contentURL !== undefined ) {
        if ( typeof contentURL === 'string' ) {
            contentURL = entry.contentURL = [ contentURL ];
        } else if ( Array.isArray(contentURL) === false ) {
            contentURL = entry.contentURL = [];
        }
        let remoteURLCount = 0;
        for ( let i = 0; i < contentURL.length; i++ ) {
            if ( reIsExternalPath.test(contentURL[i]) ) {
                remoteURLCount += 1;
            }
        }
        entry.hasLocalURL = remoteURLCount !== contentURL.length;
        entry.hasRemoteURL = remoteURLCount !== 0;
    } else if ( entry.contentURL === undefined ) {
        entry.contentURL = [];
    }
    if ( typeof entry.updateAfter !== 'number' ) {
        entry.updateAfter = 5;
    }
    if ( entry.submitter ) {
        entry.submitTime = Date.now(); // To detect stale entries
    }
    assetSourceRegistry[assetKey] = entry;
};

const unregisterAssetSource = function(assetKey) {
    assetCacheRemove(assetKey);
    delete assetSourceRegistry[assetKey];
};

const saveAssetSourceRegistry = (function() {
    let timer;
    const save = function() {
        timer = undefined;
        µBlock.cacheStorage.set({ assetSourceRegistry: assetSourceRegistry });
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

const updateAssetSourceRegistry = function(json, silent) {
    let newDict;
    try {
        newDict = JSON.parse(json);
    } catch (ex) {
    }
    if ( newDict instanceof Object === false ) { return; }

    const oldDict = assetSourceRegistry;

    // Remove obsolete entries (only those which were built-in).
    for ( const assetKey in oldDict ) {
        if (
            newDict[assetKey] === undefined &&
            oldDict[assetKey].submitter === undefined
        ) {
            unregisterAssetSource(assetKey);
        }
    }
    // Add/update existing entries. Notify of new asset sources.
    for ( const assetKey in newDict ) {
        if ( oldDict[assetKey] === undefined && !silent ) {
            fireNotification(
                'builtin-asset-source-added',
                { assetKey: assetKey, entry: newDict[assetKey] }
            );
        }
        registerAssetSource(assetKey, newDict[assetKey]);
    }
    saveAssetSourceRegistry();
};

const getAssetSourceRegistry = function(callback) {
    if ( assetSourceRegistryPromise === undefined ) {
        assetSourceRegistryPromise = µBlock.cacheStorage.get(
            'assetSourceRegistry'
        ).then(bin => {
            if (
                bin instanceof Object &&
                bin.assetSourceRegistry instanceof Object
            ) {
                assetSourceRegistry = bin.assetSourceRegistry;
                return;
            }
            return new Promise(resolve => {
                api.fetchText(
                    µBlock.assetsBootstrapLocation || 'assets/assets.json',
                    details => {
                        updateAssetSourceRegistry(details.content, true);
                        resolve();
                    }
                );
            });
        });
    }

    assetSourceRegistryPromise.then(( ) => {
        callback(assetSourceRegistry);
    });
};

api.registerAssetSource = function(assetKey, details) {
    getAssetSourceRegistry(function() {
        registerAssetSource(assetKey, details);
        saveAssetSourceRegistry(true);
    });
};

api.unregisterAssetSource = function(assetKey) {
    getAssetSourceRegistry(function() {
        unregisterAssetSource(assetKey);
        saveAssetSourceRegistry(true);
    });
};

/*******************************************************************************

    The purpose of the asset cache registry is to keep track of all assets
    which have been persisted into the local cache.

**/

const assetCacheRegistryStartTime = Date.now();
let assetCacheRegistryPromise;
let assetCacheRegistry = {};

const getAssetCacheRegistry = function() {
    if ( assetCacheRegistryPromise === undefined ) {
        assetCacheRegistryPromise = µBlock.cacheStorage.get(
            'assetCacheRegistry'
        ).then(bin => {
            if (
                bin instanceof Object &&
                bin.assetCacheRegistry instanceof Object
            ) {
                assetCacheRegistry = bin.assetCacheRegistry;
            }
        });
    }

    return assetCacheRegistryPromise.then(( ) => assetCacheRegistry);
};

const saveAssetCacheRegistry = (function() {
    let timer;
    const save = function() {
        timer = undefined;
        µBlock.cacheStorage.set({ assetCacheRegistry });
    };
    return function(lazily) {
        if ( timer !== undefined ) { clearTimeout(timer); }
        if ( lazily ) {
            timer = vAPI.setTimeout(save, 500);
        } else {
            save();
        }
    };
})();

const assetCacheRead = function(assetKey, callback) {
    const internalKey = 'cache/' + assetKey;

    const reportBack = function(content) {
        if ( content instanceof Blob ) { content = ''; }
        let details = { assetKey: assetKey, content: content };
        if ( content === '' ) { details.error = 'E_NOTFOUND'; }
        callback(details);
    };

    const onAssetRead = function(bin) {
        if (
            bin instanceof Object === false ||
            bin.hasOwnProperty(internalKey) === false
        ) {
            return reportBack('');
        }
        let entry = assetCacheRegistry[assetKey];
        if ( entry === undefined ) {
            return reportBack('');
        }
        entry.readTime = Date.now();
        saveAssetCacheRegistry(true);
        reportBack(bin[internalKey]);
    };

    Promise.all([
        getAssetCacheRegistry(),
        µBlock.cacheStorage.get(internalKey),
    ]).then(results => {
        onAssetRead(results[1]);
    });
};

const assetCacheWrite = function(assetKey, details, callback) {
    let internalKey = 'cache/' + assetKey;
    let content = '';
    if ( typeof details === 'string' ) {
        content = details;
    } else if ( details instanceof Object ) {
        content = details.content || '';
    }

    if ( content === '' ) {
        return assetCacheRemove(assetKey, callback);
    }

    const onReady = function() {
        let entry = assetCacheRegistry[assetKey];
        if ( entry === undefined ) {
            entry = assetCacheRegistry[assetKey] = {};
        }
        entry.writeTime = entry.readTime = Date.now();
        if ( details instanceof Object && typeof details.url === 'string' ) {
            entry.remoteURL = details.url;
        }
        µBlock.cacheStorage.set({ assetCacheRegistry, [internalKey]: content });
        const result = { assetKey, content };
        if ( typeof callback === 'function' ) {
            callback(result);
        }
        // https://github.com/uBlockOrigin/uBlock-issues/issues/248
        fireNotification('after-asset-updated', result);
    };

    getAssetCacheRegistry().then(( ) => onReady());
};

const assetCacheRemove = function(pattern, callback) {
    getAssetCacheRegistry().then(cacheDict => {
        const removedEntries = [];
        const removedContent = [];
        for ( const assetKey in cacheDict ) {
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
            µBlock.cacheStorage.remove(removedContent);
            µBlock.cacheStorage.set({ assetCacheRegistry });
        }
        if ( typeof callback === 'function' ) {
            callback();
        }
        for ( let i = 0; i < removedEntries.length; i++ ) {
            fireNotification(
                'after-asset-updated',
                { assetKey: removedEntries[i] }
            );
        }
    });
};

const assetCacheMarkAsDirty = function(pattern, exclude, callback) {
    if ( typeof exclude === 'function' ) {
        callback = exclude;
        exclude = undefined;
    }
    getAssetCacheRegistry().then(cacheDict => {
        let mustSave = false;
        for ( const assetKey in cacheDict ) {
            if ( pattern instanceof RegExp ) {
                if ( pattern.test(assetKey) === false ) { continue; }
            } else if ( typeof pattern === 'string' ) {
                if ( assetKey !== pattern ) { continue; }
            } else if ( Array.isArray(pattern) ) {
                if ( pattern.indexOf(assetKey) === -1 ) { continue; }
            }
            if ( exclude instanceof RegExp ) {
                if ( exclude.test(assetKey) ) { continue; }
            } else if ( typeof exclude === 'string' ) {
                if ( assetKey === exclude ) { continue; }
            } else if ( Array.isArray(exclude) ) {
                if ( exclude.indexOf(assetKey) !== -1 ) { continue; }
            }
            const cacheEntry = cacheDict[assetKey];
            if ( !cacheEntry.writeTime ) { continue; }
            cacheDict[assetKey].writeTime = 0;
            mustSave = true;
        }
        if ( mustSave ) {
            µBlock.cacheStorage.set({ assetCacheRegistry });
        }
        if ( typeof callback === 'function' ) {
            callback();
        }
    });
};

/******************************************************************************/

const stringIsNotEmpty = function(s) {
    return typeof s === 'string' && s !== '';
};

/*******************************************************************************

    User assets are NOT persisted in the cache storage. User assets are
    recognized by the asset key which always starts with 'user-'.

    TODO(seamless migration):
    Can remove instances of old user asset keys when I am confident all users
    are using uBO v1.11 and beyond.

**/

/*******************************************************************************

    User assets are NOT persisted in the cache storage. User assets are
    recognized by the asset key which always starts with 'user-'.

**/

const readUserAsset = function(assetKey, callback) {
    const reportBack = function(content) {
        callback({ assetKey, content });
    };
    vAPI.storage.get(assetKey, bin => {
        const content =
            bin instanceof Object && typeof bin[assetKey] === 'string'
                ? bin[assetKey]
                : '';
        return reportBack(content);
    });
    // Remove obsolete entry
    // TODO: remove once everybody is well beyond 1.18.6
    vAPI.storage.remove('assets/user/filters.txt');
};

const saveUserAsset = function(assetKey, content, callback) {
    vAPI.storage.set({ [assetKey]: content }, ( ) => {
        if ( callback instanceof Function ) {
            callback({ assetKey, content });
        }
    });
};

/******************************************************************************/

api.get = function(assetKey, options, callback) {
    if ( typeof options === 'function' ) {
        callback = options;
        options = {};
    } else if ( typeof callback !== 'function' ) {
        callback = noopfunc;
    }
    // This can happen if the method was called as a thenable.
    if ( options instanceof Object === false ) {
        options = {};
    }

    return new Promise(resolve => {
    // start of executor
    if ( assetKey === µBlock.userFiltersPath ) {
        readUserAsset(assetKey, details => {
            callback(details);
            resolve(details);
        });
        return;
    }

    let assetDetails = {},
        contentURLs,
        contentURL;

    const reportBack = (content, err) => {
        const details = { assetKey, content };
        if ( err ) {
            details.error = assetDetails.lastError = err;
        } else {
            assetDetails.lastError = undefined;
        }
        if ( options.needSourceURL ) {
            if (
                contentURL === undefined &&
                assetCacheRegistry instanceof Object &&
                assetCacheRegistry[assetKey] instanceof Object
            ) {
                details.sourceURL = assetCacheRegistry[assetKey].remoteURL;
            }
            if ( reIsExternalPath.test(contentURL) ) {
                details.sourceURL = contentURL;
            }
        }
        callback(details);
        resolve(details);
    };

    const onContentNotLoaded = ( ) => {
        let isExternal;
        while ( (contentURL = contentURLs.shift()) ) {
            isExternal = reIsExternalPath.test(contentURL);
            if ( isExternal === false || assetDetails.hasLocalURL !== true ) {
                break;
            }
        }
        if ( !contentURL ) {
            return reportBack('', 'E_NOTFOUND');
        }
        if ( assetDetails.content === 'filters' ) {
            api.fetchFilterList(contentURL, onContentLoaded, onContentNotLoaded);
        } else {
            api.fetchText(contentURL, onContentLoaded, onContentNotLoaded);
        }
    };

    const onContentLoaded = details => {
        if ( stringIsNotEmpty(details.content) === false ) {
            onContentNotLoaded();
            return;
        }
        if ( reIsExternalPath.test(contentURL) && options.dontCache !== true ) {
            assetCacheWrite(assetKey, {
                content: details.content,
                url: contentURL
            });
        }
        reportBack(details.content);
    };

    const onCachedContentLoaded = details => {
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
    // end of executor
    });
};

/******************************************************************************/

const getRemote = function(assetKey, callback) {
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

    var onRemoteContentLoaded = function(details) {
        if ( stringIsNotEmpty(details.content) === false ) {
            registerAssetSource(assetKey, { error: { time: Date.now(), error: 'No content' } });
            tryLoading();
            return;
        }
        assetCacheWrite(assetKey, {
            content: details.content,
            url: contentURL
        });
        registerAssetSource(assetKey, { error: undefined });
        reportBack(details.content);
    };

    var onRemoteContentError = function(details) {
        var text = details.statusText;
        if ( details.statusCode === 0 ) {
            text = 'network error';
        }
        registerAssetSource(assetKey, { error: { time: Date.now(), error: text } });
        tryLoading();
    };

    var tryLoading = function() {
        while ( (contentURL = contentURLs.shift()) ) {
            if ( reIsExternalPath.test(contentURL) ) { break; }
        }
        if ( !contentURL ) {
            return reportBack('', 'E_NOTFOUND');
        }
        if ( assetDetails.content === 'filters' ) {
            api.fetchFilterList(contentURL, onRemoteContentLoaded, onRemoteContentError);
        } else {
            api.fetchText(contentURL, onRemoteContentLoaded, onRemoteContentError);
        }
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
    return new Promise(resolve => {
        const onDone = function(details) {
            if ( typeof callback === 'function' ) {
                callback(details);
            }
            resolve(details);
        };
        if ( reIsUserAsset.test(assetKey) ) {
            saveUserAsset(assetKey, content, onDone);
        } else {
            assetCacheWrite(assetKey, content, onDone);
        }
    });
};

/******************************************************************************/

api.metadata = function(callback) {
    let assetRegistryReady = false,
        cacheRegistryReady = false;

    const onReady = function() {
        const assetDict = JSON.parse(JSON.stringify(assetSourceRegistry));
        const cacheDict = assetCacheRegistry;
        const now = Date.now();
        for ( const assetKey in assetDict ) {
            const assetEntry = assetDict[assetKey];
            const cacheEntry = cacheDict[assetKey];
            if ( cacheEntry ) {
                assetEntry.cached = true;
                assetEntry.writeTime = cacheEntry.writeTime;
                const obsoleteAfter =
                    cacheEntry.writeTime + assetEntry.updateAfter * 86400000;
                assetEntry.obsolete = obsoleteAfter < now;
                assetEntry.remoteURL = cacheEntry.remoteURL;
            } else if (
                assetEntry.contentURL &&
                assetEntry.contentURL.length !== 0
            ) {
                assetEntry.writeTime = 0;
                assetEntry.obsolete = true;
            }
        }
        callback(assetDict);
    };

    getAssetSourceRegistry(( ) => {
        assetRegistryReady = true;
        if ( cacheRegistryReady ) { onReady(); }
    });

    getAssetCacheRegistry().then(( ) => {
        cacheRegistryReady = true;
        if ( assetRegistryReady ) { onReady(); }
    });
};

/******************************************************************************/

api.purge = assetCacheMarkAsDirty;

api.remove = function(pattern, callback) {
    assetCacheRemove(pattern, callback);
};

api.rmrf = function() {
    assetCacheRemove(/./);
};

/******************************************************************************/

// Asset updater area.
const updaterAssetDelayDefault = 120000;
const updaterUpdated = [];
const updaterFetched = new Set();

let updaterStatus,
    updaterTimer,
    updaterAssetDelay = updaterAssetDelayDefault,
    noRemoteResources;

const updateFirst = function() {
    // https://github.com/gorhill/uBlock/commit/126110c9a0a0630cd556f5cb215422296a961029
    //   Firefox extension reviewers do not want uBO/webext to fetch its own
    //   scriptlets/resources asset from the project's own repo (github.com).
    // https://github.com/uBlockOrigin/uAssets/issues/1647#issuecomment-371456830
    //   Allow self-hosted dev build to update: if update_url is present but
    //   null, assume the extension is hosted on AMO.
    if ( noRemoteResources === undefined ) {
        noRemoteResources =
            vAPI.webextFlavor.soup.has('firefox') &&
            vAPI.webextFlavor.soup.has('webext') &&
            vAPI.webextFlavor.soup.has('devbuild') === false;
    }
    updaterStatus = 'updating';
    updaterFetched.clear();
    updaterUpdated.length = 0;
    fireNotification('before-assets-updated');
    updateNext();
};

const updateNext = function() {
    let assetDict, cacheDict;

    // This will remove a cached asset when it's no longer in use.
    const garbageCollectOne = function(assetKey) {
        const cacheEntry = cacheDict[assetKey];
        if ( cacheEntry && cacheEntry.readTime < assetCacheRegistryStartTime ) {
            assetCacheRemove(assetKey);
        }
    };

    const findOne = function() {
        const now = Date.now();
        for ( const assetKey in assetDict ) {
            const assetEntry = assetDict[assetKey];
            if ( assetEntry.hasRemoteURL !== true ) { continue; }
            if ( updaterFetched.has(assetKey) ) { continue; }
            const cacheEntry = cacheDict[assetKey];
            if (
                cacheEntry &&
                (cacheEntry.writeTime + assetEntry.updateAfter * 86400000) > now
            ) {
                continue;
            }
            // Update of user scripts/resources forbidden?
            if ( assetKey === 'ublock-resources' && noRemoteResources ) {
                continue;
            }
            if (
                fireNotification(
                    'before-asset-updated',
                    { assetKey: assetKey,  type: assetEntry.content }
                ) === true
            ) {
                return assetKey;
            }
            garbageCollectOne(assetKey);
        }
    };

    const updatedOne = function(details) {
        if ( details.content !== '' ) {
            updaterUpdated.push(details.assetKey);
            if ( details.assetKey === 'assets.json' ) {
                updateAssetSourceRegistry(details.content);
            }
        } else {
            fireNotification('asset-update-failed', { assetKey: details.assetKey });
        }
        if ( findOne() !== undefined ) {
            vAPI.setTimeout(updateNext, updaterAssetDelay);
        } else {
            updateDone();
        }
    };

    const updateOne = function() {
        const assetKey = findOne();
        if ( assetKey === undefined ) {
            return updateDone();
        }
        updaterFetched.add(assetKey);
        getRemote(assetKey, updatedOne);
    };

    getAssetSourceRegistry(function(dict) {
        assetDict = dict;
        if ( !cacheDict ) { return; }
        updateOne();
    });

    getAssetCacheRegistry().then(dict => {
        cacheDict = dict;
        if ( !assetDict ) { return; }
        updateOne();
    });
};

const updateDone = function() {
    const assetKeys = updaterUpdated.slice(0);
    updaterFetched.clear();
    updaterUpdated.length = 0;
    updaterStatus = undefined;
    updaterAssetDelay = updaterAssetDelayDefault;
    fireNotification('after-assets-updated', { assetKeys: assetKeys });
};

api.updateStart = function(details) {
    const oldUpdateDelay = updaterAssetDelay;
    const newUpdateDelay = typeof details.delay === 'number' ?
        details.delay :
        updaterAssetDelayDefault;
    updaterAssetDelay = Math.min(oldUpdateDelay, newUpdateDelay);
    if ( updaterStatus !== undefined ) {
        if ( newUpdateDelay < oldUpdateDelay ) {
            clearTimeout(updaterTimer);
            updaterTimer = vAPI.setTimeout(updateNext, updaterAssetDelay);
        }
        return;
    }
    updateFirst();
};

api.updateStop = function() {
    if ( updaterTimer ) {
        clearTimeout(updaterTimer);
        updaterTimer = undefined;
    }
    if ( updaterStatus !== undefined ) {
        updateDone();
    }
};

api.isUpdating = function() {
    return updaterStatus === 'updating' &&
           updaterAssetDelay <= µBlock.hiddenSettings.manualUpdateAssetFetchPeriod;
};

/******************************************************************************/

return api;

/******************************************************************************/

})();

/******************************************************************************/

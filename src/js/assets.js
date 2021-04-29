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

µBlock.assets = (( ) => {

/******************************************************************************/

const reIsExternalPath = /^(?:[a-z-]+):\/\//;
const reIsUserAsset = /^user-/;
const errorCantConnectTo = vAPI.i18n('errorCantConnectTo');

const api = {};

// A hint for various pieces of code to take measures if possible to save
// bandwidth of remote servers.
let remoteServerFriendly = false;

/******************************************************************************/

const observers = [];

api.addObserver = function(observer) {
    if ( observers.indexOf(observer) === -1 ) {
        observers.push(observer);
    }
};

api.removeObserver = function(observer) {
    let pos;
    while ( (pos = observers.indexOf(observer)) !== -1 ) {
        observers.splice(pos, 1);
    }
};

const fireNotification = function(topic, details) {
    let result;
    for ( const observer of observers ) {
        const r = observer(topic, details);
        if ( r !== undefined ) { result = r; }
    }
    return result;
};

/******************************************************************************/

api.fetch = function(url, options = {}) {
    return new Promise((resolve, reject) => {
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

    const fail = function(details, msg) {
        µBlock.logger.writeOne({
            realm: 'message',
            type: 'error',
            text: msg,
        });
        details.content = '';
        details.error = msg;
        reject(details);
    };

    // https://github.com/gorhill/uMatrix/issues/15
    const onLoadEvent = function() {
        cleanup();
        // xhr for local files gives status 0, but actually succeeds
        const details = {
            url,
            statusCode: this.status || 200,
            statusText: this.statusText || ''
        };
        if ( details.statusCode < 200 || details.statusCode >= 300 ) {
            return fail(details, `${url}: ${details.statusCode} ${details.statusText}`);
        }
        details.content = this.response;
        resolve(details);
    };

    const onErrorEvent = function() {
        cleanup();
        fail({ url }, errorCantConnectTo.replace('{{msg}}', url));
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
        xhr.open('get', url, true);
        xhr.addEventListener('load', onLoadEvent);
        xhr.addEventListener('error', onErrorEvent);
        xhr.addEventListener('abort', onErrorEvent);
        xhr.addEventListener('progress', onProgressEvent);
        xhr.responseType = options.responseType || 'text';
        xhr.send();
        timeoutTimer = vAPI.setTimeout(onTimeout, timeoutAfter);
    } catch (e) {
        onErrorEvent.call(xhr);
    }

    // End of executor
    });
};

/******************************************************************************/

api.fetchText = async function(url) {
    const isExternal = reIsExternalPath.test(url);
    let actualUrl = isExternal ? url : vAPI.getURL(url);

    // https://github.com/gorhill/uBlock/issues/2592
    //   Force browser cache to be bypassed, but only for resources which have
    //   been fetched more than one hour ago.
    // https://github.com/uBlockOrigin/uBlock-issues/issues/682#issuecomment-515197130
    //   Provide filter list authors a way to completely bypass
    //   the browser cache.
    // https://github.com/gorhill/uBlock/commit/048bfd251c9b#r37972005
    //   Use modulo prime numbers to avoid generating the same token at the
    //   same time across different days.
    // Do not bypass browser cache if we are asked to be gentle on remote
    // servers.
    if ( isExternal && remoteServerFriendly !== true ) {
        const cacheBypassToken =
            µBlock.hiddenSettings.updateAssetBypassBrowserCache
                ? Math.floor(Date.now() /    1000) % 86413
                : Math.floor(Date.now() / 3600000) %    13;
        const queryValue = `_=${cacheBypassToken}`;
        if ( actualUrl.indexOf('?') === -1 ) {
            actualUrl += '?';
        } else {
            actualUrl += '&';
        }
        actualUrl += queryValue;
    }

    let details = { content: '' };
    try {
        details = await api.fetch(actualUrl);

        // Consider an empty result to be an error
        if ( stringIsNotEmpty(details.content) === false ) {
            details.content = '';
        }

        // We never download anything else than plain text: discard if
        // response appears to be a HTML document: could happen when server
        // serves some kind of error page for example.
        const text = details.content.trim();
        if ( text.startsWith('<') && text.endsWith('>') ) {
            details.content = '';
        }
    } catch(ex) {
        details = ex;
    }

    // We want to return the caller's URL, not our internal one which may
    // differ from the caller's one.
    details.url = url;

    return details;
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/3331
//   Support the seamless loading of sublists.

api.fetchFilterList = async function(mainlistURL) {
    const toParsedURL = url => {
        try {
            return new URL(url);
        } catch (ex) {
        }
    };

    // https://github.com/NanoAdblocker/NanoCore/issues/239
    //   Anything under URL's root directory is allowed to be fetched. The
    //   URL of a sublist will always be relative to the URL of the parent
    //   list (instead of the URL of the root list).
    let rootDirectoryURL = toParsedURL(
        reIsExternalPath.test(mainlistURL)
            ? mainlistURL
            : vAPI.getURL(mainlistURL)
    );
    if ( rootDirectoryURL !== undefined ) {
        const pos = rootDirectoryURL.pathname.lastIndexOf('/');
        if ( pos !== -1 ) {
            rootDirectoryURL.pathname =
                rootDirectoryURL.pathname.slice(0, pos + 1);
        } else {
            rootDirectoryURL = undefined;
        }
    }

    const sublistURLs = new Set();

    // https://github.com/uBlockOrigin/uBlock-issues/issues/1113
    //   Process only `!#include` directives which are not excluded by an
    //   `!#if` directive.
    const processIncludeDirectives = function(results) {
        const out = [];
        const reInclude = /^!#include +(\S+)/gm;
        for ( const result of results ) {
            if ( typeof result === 'string' ) {
                out.push(result);
                continue;
            }
            if ( result instanceof Object === false ) { continue; }
            const content = result.content;
            const slices = µBlock.preparseDirectives.split(content);
            for ( let i = 0, n = slices.length - 1; i < n; i++ ) {
                const slice = content.slice(slices[i+0], slices[i+1]);
                if ( (i & 1) !== 0 ) {
                    out.push(slice);
                    continue;
                }
                let lastIndex = 0;
                for (;;) {
                    if ( rootDirectoryURL === undefined ) { break; }
                    const match = reInclude.exec(slice);
                    if ( match === null ) { break; }
                    if ( toParsedURL(match[1]) !== undefined ) { continue; }
                    if ( match[1].indexOf('..') !== -1 ) { continue; }
                    // Compute nested list path relative to parent list path
                    const pos = result.url.lastIndexOf('/');
                    if ( pos === -1 ) { continue; }
                    const subURL = result.url.slice(0, pos + 1) + match[1];
                    if ( sublistURLs.has(subURL) ) { continue; }
                    sublistURLs.add(subURL);
                    out.push(
                        slice.slice(lastIndex, match.index + match[0].length),
                        `! >>>>>>>> ${subURL}`,
                        api.fetchText(subURL),
                        `! <<<<<<<< ${subURL}`
                    );
                    lastIndex = reInclude.lastIndex;
                }
                out.push(lastIndex === 0 ? slice : slice.slice(lastIndex));
            }
        }
        return out;
    };

    // https://github.com/AdguardTeam/FiltersRegistry/issues/82
    //   Not checking for `errored` status was causing repeated notifications
    //   to the caller. This can happen when more than one out of multiple
    //   sublists can't be fetched.

    let allParts = [
        this.fetchText(mainlistURL)
    ];
    // Abort processing `include` directives if at least one included sublist
    // can't be fetched.
    do {
        allParts = await Promise.all(allParts);
        const part = allParts.find(part => {
            return typeof part === 'object' && part.error !== undefined;
        });
        if ( part !== undefined ) {
            return { url: mainlistURL, content: '', error: part.error };
        }
        allParts = processIncludeDirectives(allParts);
    } while ( allParts.some(part => typeof part !== 'string') );
    // If we reach this point, this means all fetches were successful.
    return {
        url: mainlistURL,
        content: allParts.length === 1
            ? allParts[0]
            : allParts.map(s => s.trim()).filter(s => s !== '').join('\n') + '\n'
    };
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

const getAssetSourceRegistry = function() {
    if ( assetSourceRegistryPromise === undefined ) {
        assetSourceRegistryPromise = µBlock.cacheStorage.get(
            'assetSourceRegistry'
        ).then(bin => {
            if (
                bin instanceof Object &&
                bin.assetSourceRegistry instanceof Object
            ) {
                assetSourceRegistry = bin.assetSourceRegistry;
                return assetSourceRegistry;
            }
            return api.fetchText(
                µBlock.assetsBootstrapLocation || 'assets/assets.json'
            ).then(details => {
                return details.content !== ''
                    ? details
                    : api.fetchText('assets/assets.json');
            }).then(details => {
                updateAssetSourceRegistry(details.content, true);
                return assetSourceRegistry;
            });
        });
    }

    return assetSourceRegistryPromise;
};

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

const saveAssetSourceRegistry = (( ) => {
    let timer;
    const save = function() {
        timer = undefined;
        µBlock.cacheStorage.set({ assetSourceRegistry });
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

api.registerAssetSource = async function(assetKey, details) {
    await getAssetSourceRegistry();
    registerAssetSource(assetKey, details);
    saveAssetSourceRegistry(true);
};

api.unregisterAssetSource = async function(assetKey) {
    await getAssetSourceRegistry();
    unregisterAssetSource(assetKey);
    saveAssetSourceRegistry(true);
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
                if ( Object.keys(assetCacheRegistry).length === 0 ) {
                    assetCacheRegistry = bin.assetCacheRegistry;
                } else {
                    console.error(
                        'getAssetCacheRegistry(): assetCacheRegistry reassigned!'
                    );
                    if (
                        Object.keys(bin.assetCacheRegistry).sort().join() !==
                        Object.keys(assetCacheRegistry).sort().join()
                    ) {
                        console.error(
                            'getAssetCacheRegistry(): assetCacheRegistry changes overwritten!'
                        );
                    }
                }
            }
            return assetCacheRegistry;
        });
    }

    return assetCacheRegistryPromise;
};

const saveAssetCacheRegistry = (( ) => {
    let timer;
    const save = function() {
        timer = undefined;
        µBlock.cacheStorage.set({ assetCacheRegistry });
    };
    return function(lazily) {
        if ( timer !== undefined ) { clearTimeout(timer); }
        if ( lazily ) {
            timer = vAPI.setTimeout(save, 30000);
        } else {
            save();
        }
    };
})();

const assetCacheRead = async function(assetKey, updateReadTime = false) {
    const internalKey = `cache/${assetKey}`;

    const reportBack = function(content) {
        if ( content instanceof Blob ) { content = ''; }
        const details = { assetKey: assetKey, content: content };
        if ( content === '' ) { details.error = 'ENOTFOUND'; }
        return details;
    };

    const [ , bin ] = await Promise.all([
        getAssetCacheRegistry(),
        µBlock.cacheStorage.get(internalKey),
    ]);
    if (
        bin instanceof Object === false ||
        bin.hasOwnProperty(internalKey) === false
    ) {
        return reportBack('');
    }

    const entry = assetCacheRegistry[assetKey];
    if ( entry === undefined ) {
        return reportBack('');
    }

    entry.readTime = Date.now();
    if ( updateReadTime ) {
        saveAssetCacheRegistry(true);
    }

    return reportBack(bin[internalKey]);
};

const assetCacheWrite = async function(assetKey, details) {
    let content = '';
    let options = {};
    if ( typeof details === 'string' ) {
        content = details;
    } else if ( details instanceof Object ) {
        content = details.content || '';
        options = details;
    }

    if ( content === '' ) {
        return assetCacheRemove(assetKey);
    }

    const cacheDict = await getAssetCacheRegistry();

    let entry = cacheDict[assetKey];
    if ( entry === undefined ) {
        entry = cacheDict[assetKey] = {};
    }
    entry.writeTime = entry.readTime = Date.now();
    if ( typeof options.url === 'string' ) {
        entry.remoteURL = options.url;
    }
    µBlock.cacheStorage.set({
        assetCacheRegistry,
        [`cache/${assetKey}`]: content
    });

    const result = { assetKey, content };
    // https://github.com/uBlockOrigin/uBlock-issues/issues/248
    if ( options.silent !== true ) {
        fireNotification('after-asset-updated', result);
    }
    return result;
};

const assetCacheRemove = async function(pattern) {
    const cacheDict = await getAssetCacheRegistry();
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
        await Promise.all([
            µBlock.cacheStorage.remove(removedContent),
            µBlock.cacheStorage.set({ assetCacheRegistry }),
        ]);
    }
    for ( let i = 0; i < removedEntries.length; i++ ) {
        fireNotification('after-asset-updated', {
            assetKey: removedEntries[i]
        });
    }
};

const assetCacheMarkAsDirty = async function(pattern, exclude) {
    const cacheDict = await getAssetCacheRegistry();
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

const readUserAsset = async function(assetKey) {
    const bin = await vAPI.storage.get(assetKey);
    const content =
        bin instanceof Object && typeof bin[assetKey] === 'string'
            ? bin[assetKey]
            : '';

    // Remove obsolete entry
    // TODO: remove once everybody is well beyond 1.18.6
    vAPI.storage.remove('assets/user/filters.txt');

    return { assetKey, content };
};

const saveUserAsset = function(assetKey, content) {
    return vAPI.storage.set({ [assetKey]: content }).then(( ) => {
        return { assetKey, content };
    });
};

/******************************************************************************/

api.get = async function(assetKey, options = {}) {
    if ( assetKey === µBlock.userFiltersPath ) {
        return readUserAsset(assetKey);
    }

    let assetDetails = {};

    const reportBack = (content, url = '', err = undefined) => {
        const details = { assetKey, content };
        if ( err !== undefined ) {
            details.error = assetDetails.lastError = err;
        } else {
            assetDetails.lastError = undefined;
        }
        if ( options.needSourceURL ) {
            if (
                url === '' &&
                assetCacheRegistry instanceof Object &&
                assetCacheRegistry[assetKey] instanceof Object
            ) {
                details.sourceURL = assetCacheRegistry[assetKey].remoteURL;
            }
            if ( reIsExternalPath.test(url) ) {
                details.sourceURL = url;
            }
        }
        return details;
    };

    // Skip read-time property for non-updatable assets: the property is
    // completely unused for such assets and thus there is no point incurring
    // storage write overhead at launch when reading compiled or selfie assets.
    const updateReadTime = /^(?:compiled|selfie)\//.test(assetKey) === false;

    const details = await assetCacheRead(assetKey, updateReadTime);
    if ( details.content !== '' ) {
        return reportBack(details.content);
    }

    const assetRegistry = await getAssetSourceRegistry();
    assetDetails = assetRegistry[assetKey] || {};
    const contentURLs = [];
    if ( typeof assetDetails.contentURL === 'string' ) {
        contentURLs.push(assetDetails.contentURL);
    } else if ( Array.isArray(assetDetails.contentURL) ) {
        contentURLs.push(...assetDetails.contentURL);
    } else if ( reIsExternalPath.test(assetKey) ) {
        assetDetails.content = 'filters';
        contentURLs.push(assetKey);
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/1566#issuecomment-826473517
    //   Use CDN URLs as fall back URLs.
    if ( Array.isArray(assetDetails.cdnURLs) ) {
        contentURLs.push(...assetDetails.cdnURLs);
    }

    for ( const contentURL of contentURLs ) {
        if ( reIsExternalPath.test(contentURL) && assetDetails.hasLocalURL ) {
            continue;
        }
        const details = assetDetails.content === 'filters'
            ? await api.fetchFilterList(contentURL)
            : await api.fetchText(contentURL);
        if ( details.content === '' ) { continue; }
        if ( reIsExternalPath.test(contentURL) && options.dontCache !== true ) {
            assetCacheWrite(assetKey, {
                content: details.content,
                url: contentURL,
                silent: options.silent === true,
            });
        }
        return reportBack(details.content, contentURL);
    }
    return reportBack('', '', 'ENOTFOUND');
};

/******************************************************************************/

const getRemote = async function(assetKey) {
    const assetRegistry = await getAssetSourceRegistry();
    const assetDetails = assetRegistry[assetKey] || {};

    const reportBack = function(content, err) {
        const details = { assetKey: assetKey, content: content };
        if ( err ) {
            details.error = assetDetails.lastError = err;
        } else {
            assetDetails.lastError = undefined;
        }
        return details;
    };

    const contentURLs = [];
    if ( typeof assetDetails.contentURL === 'string' ) {
        contentURLs.push(assetDetails.contentURL);
    } else if ( Array.isArray(assetDetails.contentURL) ) {
        contentURLs.push(...assetDetails.contentURL);
    }

    // If asked to be gentle on remote servers, favour using dedicated CDN
    // servers. If more than one CDN server is present, randomly shuffle the
    // set of servers so as to spread the bandwidth burden.
    //
    // https://github.com/uBlockOrigin/uBlock-issues/issues/1566#issuecomment-826473517
    //   In case of manual update, use CDNs URLs as fall back URLs.
    if ( Array.isArray(assetDetails.cdnURLs) ) {
        const cdnURLs = assetDetails.cdnURLs.slice();
        for ( let i = 0, n = cdnURLs.length; i < n; i++ ) {
            const j = Math.floor(Math.random() * n);
            if ( j === i ) { continue; }
            [ cdnURLs[j], cdnURLs[i] ] = [ cdnURLs[i], cdnURLs[j] ];
        }
        if ( remoteServerFriendly ) {
            contentURLs.unshift(...cdnURLs);
        } else {
            contentURLs.push(...cdnURLs);
        }
    }

    for ( const contentURL of contentURLs ) {
        if ( reIsExternalPath.test(contentURL) === false ) { continue; }

        const result = assetDetails.content === 'filters'
            ? await api.fetchFilterList(contentURL)
            : await api.fetchText(contentURL);

        // Failure
        if ( stringIsNotEmpty(result.content) === false ) {
            let error = result.statusText;
            if ( result.statusCode === 0 ) {
                error = 'network error';
            }
            registerAssetSource(assetKey, {
                error: { time: Date.now(), error }
            });
            continue;
        }

        // Success
        assetCacheWrite(assetKey, {
            content: result.content,
            url: contentURL
        });
        registerAssetSource(assetKey, { error: undefined });
        return reportBack(result.content);
    }

    return reportBack('', 'ENOTFOUND');
};

/******************************************************************************/

api.put = async function(assetKey, content) {
    return reIsUserAsset.test(assetKey)
        ? await saveUserAsset(assetKey, content)
        : await assetCacheWrite(assetKey, content);
};

/******************************************************************************/

api.metadata = async function() {
    await Promise.all([
        getAssetSourceRegistry(),
        getAssetCacheRegistry(),
    ]);

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

    return assetDict;
};

/******************************************************************************/

api.purge = assetCacheMarkAsDirty;

api.remove = function(pattern) {
    return assetCacheRemove(pattern);
};

api.rmrf = function() {
    return assetCacheRemove(/./);
};

/******************************************************************************/

// Asset updater area.
const updaterAssetDelayDefault = 120000;
const updaterUpdated = [];
const updaterFetched = new Set();

let updaterStatus;
let updaterTimer;
let updaterAssetDelay = updaterAssetDelayDefault;
let updaterAuto = false;

const updateFirst = function() {
    updaterStatus = 'updating';
    updaterFetched.clear();
    updaterUpdated.length = 0;
    fireNotification('before-assets-updated');
    updateNext();
};

const updateNext = async function() {
    const [ assetDict, cacheDict ] = await Promise.all([
        getAssetSourceRegistry(),
        getAssetCacheRegistry(),
    ]);

    const now = Date.now();
    const toUpdate = [];
    for ( const assetKey in assetDict ) {
        const assetEntry = assetDict[assetKey];
        if ( assetEntry.hasRemoteURL !== true ) { continue; }
        if ( updaterFetched.has(assetKey) ) { continue; }
        const cacheEntry = cacheDict[assetKey];
        if (
            (cacheEntry instanceof Object) &&
            (cacheEntry.writeTime + assetEntry.updateAfter * 86400000) > now
        ) {
            continue;
        }
        if (
            fireNotification('before-asset-updated', {
                assetKey,
                type: assetEntry.content
            }) === true
        ) {
            toUpdate.push(assetKey);
            continue;
        }
        // This will remove a cached asset when it's no longer in use.
        if ( cacheEntry && cacheEntry.readTime < assetCacheRegistryStartTime ) {
            assetCacheRemove(assetKey);
        }
    }
    if ( toUpdate.length === 0 ) {
        return updateDone();
    }
    // https://github.com/uBlockOrigin/uBlock-issues/issues/1165
    //   Update most obsolete asset first.
    toUpdate.sort((a, b) => {
        const ta = cacheDict[a] !== undefined ? cacheDict[a].writeTime : 0;
        const tb = cacheDict[b] !== undefined ? cacheDict[b].writeTime : 0;
        return ta - tb;
    });
    updaterFetched.add(toUpdate[0]);

    // In auto-update context, be gentle on remote servers.
    remoteServerFriendly = updaterAuto;

    const result = await getRemote(toUpdate[0]);

    remoteServerFriendly = false;

    if ( result.content !== '' ) {
        updaterUpdated.push(result.assetKey);
        if ( result.assetKey === 'assets.json' ) {
            updateAssetSourceRegistry(result.content);
        }
    } else {
        fireNotification('asset-update-failed', { assetKey: result.assetKey });
    }

    vAPI.setTimeout(updateNext, updaterAssetDelay);
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
    const newUpdateDelay = typeof details.delay === 'number'
        ? details.delay
        : updaterAssetDelayDefault;
    updaterAssetDelay = Math.min(oldUpdateDelay, newUpdateDelay);
    updaterAuto = details.auto === true;
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

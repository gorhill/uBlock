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

var reIsExternalPath = /^(?:[a-z-]+):\/\//,
    reIsUserAsset = /^user-/,
    errorCantConnectTo = vAPI.i18n('errorCantConnectTo'),
    noopfunc = function(){};

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

api.fetchText = function(url, onLoad, onError) {
    var isExternal = reIsExternalPath.test(url),
        actualUrl = isExternal ? url : vAPI.getURL(url);

    // https://github.com/gorhill/uBlock/issues/2592
    // Force browser cache to be bypassed, but only for resources which have
    // been fetched more than one hour ago.
    if ( isExternal ) {
        var queryValue = '_=' + Math.floor(Date.now() / 7200000);
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

    var contentLoaded = 0,
        timeoutAfter = µBlock.hiddenSettings.assetFetchTimeout * 1000 || 30000,
        timeoutTimer,
        xhr = new XMLHttpRequest();

    var cleanup = function() {
        xhr.removeEventListener('load', onLoadEvent);
        xhr.removeEventListener('error', onErrorEvent);
        xhr.removeEventListener('abort', onErrorEvent);
        xhr.removeEventListener('progress', onProgressEvent);
        if ( timeoutTimer !== undefined ) {
            clearTimeout(timeoutTimer);
            timeoutTimer = undefined;
        }
    };

    // https://github.com/gorhill/uMatrix/issues/15
    var onLoadEvent = function() {
        cleanup();
        // xhr for local files gives status 0, but actually succeeds
        var details = {
            url: url,
            content: '',
            statusCode: this.status || 200,
            statusText: this.statusText || ''
        };
        if ( details.statusCode < 200 || details.statusCode >= 300 ) {
            return onError.call(null, details);
        }
        // consider an empty result to be an error
        if ( stringIsNotEmpty(this.responseText) === false ) {
            return onError.call(null, details);
        }
        // we never download anything else than plain text: discard if response
        // appears to be a HTML document: could happen when server serves
        // some kind of error page I suppose
        var text = this.responseText.trim();
        if ( text.startsWith('<') && text.endsWith('>') ) {
            return onError.call(null, details);
        }
        details.content = this.responseText;
        onLoad(details);
    };

    var onErrorEvent = function() {
        cleanup();
        µBlock.logger.writeOne('', 'error', errorCantConnectTo.replace('{{msg}}', actualUrl));
        onError({ url: url, content: '' });
    };

    var onTimeout = function() {
        xhr.abort();
    };

    // https://github.com/gorhill/uBlock/issues/2526
    // - Timeout only when there is no progress.
    var onProgressEvent = function(ev) {
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
};

/*******************************************************************************

    TODO(seamless migration):
    This block of code will be removed when I am confident all users have
    moved to a version of uBO which does not require the old way of caching
    assets.

    api.listKeyAliases: a map of old asset keys to new asset keys.

    migrate(): to seamlessly migrate the old cache manager to the new one:
    - attempt to preserve and move content of cached assets to new locations;
    - removes all traces of now obsolete cache manager entries in cacheStorage.

    This code will typically execute only once, when the newer version of uBO
    is first installed and executed.

**/

api.listKeyAliases = {
    "assets/thirdparties/publicsuffix.org/list/effective_tld_names.dat": "public_suffix_list.dat",
    "assets/user/filters.txt": "user-filters",
    "assets/ublock/resources.txt": "ublock-resources",
    "assets/ublock/filters.txt": "ublock-filters",
    "assets/ublock/privacy.txt": "ublock-privacy",
    "assets/ublock/unbreak.txt": "ublock-unbreak",
    "assets/ublock/badware.txt": "ublock-badware",
    "assets/ublock/experimental.txt": "ublock-experimental",
    "https://easylist-downloads.adblockplus.org/easylistchina.txt": "CHN-0",
    "https://raw.githubusercontent.com/cjx82630/cjxlist/master/cjxlist.txt": "CHN-1",
    "https://raw.githubusercontent.com/cjx82630/cjxlist/master/cjx-annoyance.txt": "CHN-2",
    "https://easylist-downloads.adblockplus.org/easylistgermany.txt": "DEU-0",
    "https://adblock.dk/block.csv": "DNK-0",
    "assets/thirdparties/easylist-downloads.adblockplus.org/easylist.txt": "easylist",
    "https://easylist-downloads.adblockplus.org/easylist_noelemhide.txt": "easylist-nocosmetic",
    "assets/thirdparties/easylist-downloads.adblockplus.org/easyprivacy.txt": "easyprivacy",
    "https://easylist-downloads.adblockplus.org/fanboy-annoyance.txt": "fanboy-annoyance",
    "https://easylist-downloads.adblockplus.org/fanboy-social.txt": "fanboy-social",
    "https://easylist-downloads.adblockplus.org/liste_fr.txt": "FRA-0",
    "http://adblock.gardar.net/is.abp.txt": "ISL-0",
    "https://easylist-downloads.adblockplus.org/easylistitaly.txt": "ITA-0",
    "https://dl.dropboxusercontent.com/u/1289327/abpxfiles/filtri.txt": "ITA-1",
    "https://easylist-downloads.adblockplus.org/advblock.txt": "RUS-0",
    "https://easylist-downloads.adblockplus.org/bitblock.txt": "RUS-1",
    "https://filters.adtidy.org/extension/chromium/filters/1.txt": "RUS-2",
    "https://adguard.com/en/filter-rules.html?id=1": "RUS-2",
    "https://easylist-downloads.adblockplus.org/easylistdutch.txt": "NLD-0",
    "https://notabug.org/latvian-list/adblock-latvian/raw/master/lists/latvian-list.txt": "LVA-0",
    "http://hosts-file.net/.%5Cad_servers.txt": "hphosts",
    "http://adblock.ee/list.php": "EST-0",
    "https://s3.amazonaws.com/lists.disconnect.me/simple_malvertising.txt": "disconnect-malvertising",
    "https://s3.amazonaws.com/lists.disconnect.me/simple_malware.txt": "disconnect-malware",
    "https://s3.amazonaws.com/lists.disconnect.me/simple_tracking.txt": "disconnect-tracking",
    "https://www.certyficate.it/adblock/adblock.txt": "POL-0",
    "https://raw.githubusercontent.com/MajkiIT/polish-ads-filter/master/polish-adblock-filters/adblock.txt": "POL-0",
    "https://easylist-downloads.adblockplus.org/antiadblockfilters.txt": "awrl-0",
    "http://adb.juvander.net/Finland_adb.txt": "FIN-0",
    "https://raw.githubusercontent.com/gfmaster/adblock-korea-contrib/master/filter.txt": "KOR-0",
    "https://raw.githubusercontent.com/yous/YousList/master/youslist.txt": "KOR-1",
    "https://www.fanboy.co.nz/fanboy-korean.txt": "KOR-2",
    "https://raw.githubusercontent.com/heradhis/indonesianadblockrules/master/subscriptions/abpindo.txt": "IDN-0",
    "https://raw.githubusercontent.com/ABPindo/indonesianadblockrules/master/subscriptions/abpindo.txt": "IDN-0",
    "https://raw.githubusercontent.com/k2jp/abp-japanese-filters/master/abpjf.txt": "JPN-0",
    "https://raw.githubusercontent.com/liamja/Prebake/master/obtrusive.txt": "EU-prebake",
    "https://easylist-downloads.adblockplus.org/Liste_AR.txt": "ara-0",
    "http://margevicius.lt/easylistlithuania.txt": "LTU-0",
    "assets/thirdparties/www.malwaredomainlist.com/hostslist/hosts.txt": "malware-0",
    "assets/thirdparties/mirror1.malwaredomains.com/files/justdomains": "malware-1",
    "http://malwaredomains.lehigh.edu/files/immortal_domains.txt": "malware-2",
    "assets/thirdparties/pgl.yoyo.org/as/serverlist": "plowe-0",
    "https://raw.githubusercontent.com/easylist/EasyListHebrew/master/EasyListHebrew.txt": "ISR-0",
    "https://raw.githubusercontent.com/reek/anti-adblock-killer/master/anti-adblock-killer-filters.txt": "reek-0",
    "https://raw.githubusercontent.com/szpeter80/hufilter/master/hufilter.txt": "HUN-0",
    "https://raw.githubusercontent.com/tomasko126/easylistczechandslovak/master/filters.txt": "CZE-0",
    "http://someonewhocares.org/hosts/hosts": "dpollock-0",
    "https://raw.githubusercontent.com/Dawsey21/Lists/master/adblock-list.txt": "spam404-0",
    "http://stanev.org/abp/adblock_bg.txt": "BGR-0",
    "http://winhelp2002.mvps.org/hosts.txt": "mvps-0",
    "https://www.fanboy.co.nz/enhancedstats.txt": "fanboy-enhanced",
    "https://www.fanboy.co.nz/fanboy-antifacebook.txt": "fanboy-thirdparty_social",
    "https://easylist-downloads.adblockplus.org/easylistspanish.txt": "spa-0",
    "https://www.fanboy.co.nz/fanboy-swedish.txt": "SWE-0",
    "https://www.fanboy.co.nz/r/fanboy-ultimate.txt": "fanboy-ultimate",
    "https://filters.adtidy.org/extension/chromium/filters/13.txt": "TUR-0",
    "https://adguard.com/filter-rules.html?id=13": "TUR-0",
    "https://www.fanboy.co.nz/fanboy-vietnam.txt": "VIE-0",
    "https://www.void.gr/kargig/void-gr-filters.txt": "GRC-0",
    "https://raw.githubusercontent.com/betterwebleon/slovenian-list/master/filters.txt": "SVN-0"
};

var migrate = function(callback) {
    var entries,
        moveCount = 0,
        toRemove = [];

    var countdown = function(change) {
        moveCount -= (change || 0);
        if ( moveCount !== 0 ) { return; }
        vAPI.cacheStorage.remove(toRemove);
        saveAssetCacheRegistry();
        callback();
    };

    var onContentRead = function(oldKey, newKey, bin) {
        var content = bin && bin['cached_asset_content://' + oldKey] || undefined;
        if ( content ) {
            assetCacheRegistry[newKey] = {
                readTime: Date.now(),
                writeTime: entries[oldKey]
            };
            if ( reIsExternalPath.test(oldKey) ) {
                assetCacheRegistry[newKey].remoteURL = oldKey;
            }
            bin = {};
            bin['cache/' + newKey] = content;
            vAPI.cacheStorage.set(bin);
        }
        countdown(1);
    };

    var onEntries = function(bin) {
        entries = bin && bin['cached_asset_entries'];
        if ( !entries ) { return callback(); }
        if ( bin && bin['assetCacheRegistry'] ) {
            assetCacheRegistry = bin['assetCacheRegistry'];
        }
        var aliases = api.listKeyAliases;
        for ( var oldKey in entries ) {
            if ( oldKey.endsWith('assets/user/filters.txt') ) { continue; }
            var newKey = aliases[oldKey];
            if ( !newKey && /^https?:\/\//.test(oldKey) ) {
                newKey = oldKey;
            }
            if ( newKey ) {
                vAPI.cacheStorage.get(
                    'cached_asset_content://' + oldKey,
                    onContentRead.bind(null, oldKey, newKey)
                );
                moveCount += 1;
            }
            toRemove.push('cached_asset_content://' + oldKey);
        }
        toRemove.push('cached_asset_entries', 'extensionLastVersion');
        countdown();
    };

    vAPI.cacheStorage.get(
        [ 'cached_asset_entries', 'assetCacheRegistry' ],
        onEntries
    );
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

var registerAssetSource = function(assetKey, dict) {
    var entry = assetSourceRegistry[assetKey] || {};
    for ( var prop in dict ) {
        if ( dict.hasOwnProperty(prop) === false ) { continue; }
        if ( dict[prop] === undefined ) {
            delete entry[prop];
        } else {
            entry[prop] = dict[prop];
        }
    }
    var contentURL = dict.contentURL;
    if ( contentURL !== undefined ) {
        if ( typeof contentURL === 'string' ) {
            contentURL = entry.contentURL = [ contentURL ];
        } else if ( Array.isArray(contentURL) === false ) {
            contentURL = entry.contentURL = [];
        }
        var remoteURLCount = 0;
        for ( var i = 0; i < contentURL.length; i++ ) {
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

var unregisterAssetSource = function(assetKey) {
    assetCacheRemove(assetKey);
    delete assetSourceRegistry[assetKey];
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

var updateAssetSourceRegistry = function(json, silent) {
    var newDict;
    try {
        newDict = JSON.parse(json);
    } catch (ex) {
    }
    if ( newDict instanceof Object === false ) { return; }

    var oldDict = assetSourceRegistry,
        assetKey;

    // Remove obsolete entries (only those which were built-in).
    for ( assetKey in oldDict ) {
        if (
            newDict[assetKey] === undefined &&
            oldDict[assetKey].submitter === undefined
        ) {
            unregisterAssetSource(assetKey);
        }
    }
    // Add/update existing entries. Notify of new asset sources.
    for ( assetKey in newDict ) {
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
        api.fetchText(
            µBlock.assetsBootstrapLocation || 'assets/assets.json',
            function(details) {
                updateAssetSourceRegistry(details.content, true);
                registryReady();
            }
        );
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

var assetCacheRegistryStatus,
    assetCacheRegistryStartTime = Date.now(),
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

    var migrationDone = function() {
        vAPI.cacheStorage.get('assetCacheRegistry', function(bin) {
            if ( bin && bin.assetCacheRegistry ) {
                assetCacheRegistry = bin.assetCacheRegistry;
            }
            registryReady();
        });
    };

    migrate(migrationDone);
};

var saveAssetCacheRegistry = (function() {
    var timer;
    var save = function() {
        timer = undefined;
        vAPI.cacheStorage.set({ assetCacheRegistry: assetCacheRegistry });
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

var assetCacheMarkAsDirty = function(pattern, exclude, callback) {
    var onReady = function() {
        var cacheDict = assetCacheRegistry,
            cacheEntry,
            mustSave = false;
        for ( var assetKey in cacheDict ) {
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
    if ( typeof exclude === 'function' ) {
        callback = exclude;
        exclude = undefined;
    }
    getAssetCacheRegistry(onReady);
};

/******************************************************************************/

var stringIsNotEmpty = function(s) {
    return typeof s === 'string' && s !== '';
};

/*******************************************************************************

    User assets are NOT persisted in the cache storage. User assets are
    recognized by the asset key which always starts with 'user-'.

    TODO(seamless migration):
    Can remove instances of old user asset keys when I am confident all users
    are using uBO v1.11 and beyond.

**/

var readUserAsset = function(assetKey, callback) {
    var reportBack = function(content) {
        callback({ assetKey: assetKey, content: content });
    };

    var onLoaded = function(bin) {
        if ( !bin ) { return reportBack(''); }
        var content = '';
        if ( typeof bin['cached_asset_content://assets/user/filters.txt'] === 'string' ) {
            content = bin['cached_asset_content://assets/user/filters.txt'];
            vAPI.cacheStorage.remove('cached_asset_content://assets/user/filters.txt');
        }
        if ( typeof bin['assets/user/filters.txt'] === 'string' ) {
            content = bin['assets/user/filters.txt'];
            // TODO(seamless migration):
            // Uncomment once all moved to v1.11+.
            //vAPI.storage.remove('assets/user/filters.txt');
        }
        if ( typeof bin[assetKey] === 'string' ) {
            // TODO(seamless migration):
            // Replace conditional with assignment once all moved to v1.11+
            if ( content !== bin[assetKey] ) {
                saveUserAsset(assetKey, content);
            }
        } else if ( content !== '' ) {
            saveUserAsset(assetKey, content);
        }
        return reportBack(content);
    };
    var toRead = assetKey;
    if ( assetKey === µBlock.userFiltersPath ) {
        toRead = [
            assetKey,
            'assets/user/filters.txt',
            'cached_asset_content://assets/user/filters.txt'
        ];
    }
    vAPI.storage.get(toRead, onLoaded);
};

var saveUserAsset = function(assetKey, content, callback) {
    var bin = {};
    bin[assetKey] = content;
    // TODO(seamless migration):
    // This is for forward compatibility. Only for a limited time. Remove when
    // everybody moved to 1.11.0 and beyond.
    // >>>>>>>>
    if ( assetKey === µBlock.userFiltersPath ) {
        bin['assets/user/filters.txt'] = content;
    }
    // <<<<<<<<
    var onSaved = function() {
        if ( callback instanceof Function ) {
            callback({ assetKey: assetKey, content: content });
        }
    };
    vAPI.storage.set(bin, onSaved);
};

/******************************************************************************/

api.get = function(assetKey, options, callback) {
    if ( typeof options === 'function' ) {
        callback = options;
        options = {};
    } else if ( typeof callback !== 'function' ) {
        callback = noopfunc;
    }

    if ( assetKey === µBlock.userFiltersPath ) {
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
        api.fetchText(contentURL, onContentLoaded, onContentNotLoaded);
    };

    var onContentLoaded = function(details) {
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
        api.fetchText(contentURL, onRemoteContentLoaded, onRemoteContentError);
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
var updaterStatus,
    updaterTimer,
    updaterAssetDelayDefault = 120000,
    updaterAssetDelay = updaterAssetDelayDefault,
    updaterUpdated = [],
    updaterFetched = new Set(),
    noRemoteResources;

var updateFirst = function() {
    // Firefox extension reviewers do not want uBO/webext to fetch its own
    // scriptlets/resources asset from the project's own repo (github.com).
    // See: https://github.com/gorhill/uBlock/commit/126110c9a0a0630cd556f5cb215422296a961029
    if ( noRemoteResources === undefined ) {
        noRemoteResources =
            typeof vAPI.webextFlavor === 'string' &&
            vAPI.webextFlavor.startsWith('Mozilla-Firefox-');
    }
    // This is to ensure the packaged version will always be used (in case
    // there is a cache remnant from a pre-stable webext era).
    // See https://github.com/uBlockOrigin/uAssets/commit/a6c77af4afb45800d4fd7c268a2a5eab5a64daf3#commitcomment-24642912
    if ( noRemoteResources ) {
        api.remove('ublock-resources');
    }
    updaterStatus = 'updating';
    updaterFetched.clear();
    updaterUpdated = [];
    fireNotification('before-assets-updated');
    updateNext();
};

var updateNext = function() {
    var assetDict, cacheDict;

    // This will remove a cached asset when it's no longer in use.
    var garbageCollectOne = function(assetKey) {
        var cacheEntry = cacheDict[assetKey];
        if ( cacheEntry && cacheEntry.readTime < assetCacheRegistryStartTime ) {
            assetCacheRemove(assetKey);
        }
    };

    var findOne = function() {
        var now = Date.now(),
            assetEntry, cacheEntry;
        for ( var assetKey in assetDict ) {
            assetEntry = assetDict[assetKey];
            if ( assetEntry.hasRemoteURL !== true ) { continue; }
            if ( updaterFetched.has(assetKey) ) { continue; }
            cacheEntry = cacheDict[assetKey];
            if ( cacheEntry && (cacheEntry.writeTime + assetEntry.updateAfter * 86400000) > now ) {
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
                ) !== false
            ) {
                return assetKey;
            }
            garbageCollectOne(assetKey);
        }
    };

    var updatedOne = function(details) {
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

    var updateOne = function() {
        var assetKey = findOne();
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

    getAssetCacheRegistry(function(dict) {
        cacheDict = dict;
        if ( !assetDict ) { return; }
        updateOne();
    });
};

var updateDone = function() {
    var assetKeys = updaterUpdated.slice(0);
    updaterFetched.clear();
    updaterUpdated = [];
    updaterStatus = undefined;
    updaterAssetDelay = updaterAssetDelayDefault;
    fireNotification('after-assets-updated', { assetKeys: assetKeys });
};

api.updateStart = function(details) {
    var oldUpdateDelay = updaterAssetDelay,
        newUpdateDelay = details.delay || updaterAssetDelayDefault;
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

/******************************************************************************/

return api;

/******************************************************************************/

})();

/******************************************************************************/

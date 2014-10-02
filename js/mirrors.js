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

/* jshint bitwise: false */
/* global chrome, YaMD5, µBlock */

/******************************************************************************/

// Low-level asset files manager

µBlock.mirrors = (function() {

/******************************************************************************/

// To show keys in local storage from console:
// chrome.storage.local.get(null, function (data) { console.log(Object.keys(data)) });

// To cleanup cached items from console:
// chrome.storage.local.get(null, function (data) { chrome.storage.local.remove(Object.keys(data).filter(function(a){ return a.indexOf('mirrors_item_') === 0; })); });


var exports = {
    bytesInUseMax: 5 * 1024 * 1024,
    ttl: 21 * 24 * 60 * 60 * 1000,
    bytesInUse: 0,
    hitCount: 0
};

/******************************************************************************/

var nullFunc = function() {};

// TODO: need to come up with something better. Key shoud be domain. More
// control over what significant part(s) of a URL is to be used as key.
var mirrorCandidates = {
          'ajax.googleapis.com': /^ajax\.googleapis\.com\/ajax\/libs\//,
         'fonts.googleapis.com': /^fonts\.googleapis\.com/,
            'fonts.gstatic.com': /^fonts\.gstatic\.com/,
         'cdnjs.cloudflare.com': /^cdnjs\.cloudflare\.com\/ajax\/libs\//,
              'code.jquery.com': /^code\.jquery\.com/,
                  's0.2mdn.net': /(2mdn\.net\/instream\/html5\/ima3\.js)/,
    'www.googletagservices.com': /(www\.googletagservices\.com\/tag\/js\/gpt\.js)/,
      'maxcdn.bootstrapcdn.com': /^maxcdn\.bootstrapcdn\.com\/font-awesome\//,
      'b.scorecardresearch.com': /^b\.scorecardresearch\.com\/beacon\.js/,
         'platform.twitter.com': /^platform\.twitter\.com\/widgets\.js/,
        'cdn.quilt.janrain.com': /^cdn\.quilt\.janrain\.com\//
};

var magicId = 'rmwwgwkzcgfv';
var metadataPersistTimer = null;
var bytesInUseMercy = 1 * 1024 * 1024;

var metadata = {
    magicId: magicId,
    urlKeyToHashMap: {}
};

var hashToContentMap = {};

var loaded = false;

/******************************************************************************/

// Ideally, URL keys and access time would be attached to the data URL entry 
// itself, but then this would mean the need to persist the whole data URL 
// every time a new URL key is added or the data URL is accessed, and given the
// data URL can be quite large, that would make no sense efficiency-wise to 
// re-persist the whole thing.
// So, ContentEntry persisted once, MetadataEntry persisted often.

var MetadataEntry = function(hash) {
    this.accessTime = Date.now();
    this.hash = hash;
};

var ContentEntry = function(dataURL) {
    this.createTime = Date.now();
    this.dataURL = dataURL;
};

/******************************************************************************/

var getTextFileFromURL = function(url, onLoad, onError) {
    if ( typeof onLoad !== 'function' ) {
        onLoad = nullFunc;
    }
    if ( typeof onError !== 'function' ) {
        onError = onLoad;
    }
    var xhr = new XMLHttpRequest();
    xhr.responseType = 'text';
    xhr.timeout = 10000;
    xhr.onload = onLoad;
    xhr.onerror = onError;
    xhr.ontimeout = onError;
    xhr.open('get', url, true);
    xhr.send();
};

/******************************************************************************/

// Safe binary-to-base64. Because window.btoa doesn't work for binary data...
//
// This implementation doesn't require the creation of a full-length 
// intermediate buffer. I expect less short-term memory use will translate in 
// more efficient conversion. Hopefully I will get time to confirm with 
// benchmarks in the future.

var btoaMap = (function(){
    var out = new Uint8Array(64);
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var i = chars.length;
    while ( i-- ) {
        out[i] = chars.charCodeAt(i);
    }
    return out;
})();

var btoaSafe = function(input) {
    var output = [];
    var bamap = btoaMap;
    var n = Math.floor(input.length / 3) * 3;
    var b1, b2, b3;
    for ( var ii = 0; ii < n; ii += 3 ) {
        b1 = input.charCodeAt(ii  );
        b2 = input.charCodeAt(ii+1);
        b3 = input.charCodeAt(ii+2);
        output.push(String.fromCharCode(
            bamap[                   b1 >>> 2],
            bamap[(b1 & 0x03) << 4 | b2 >>> 4],
            bamap[(b2 & 0x0F) << 2 | b3 >>> 6],
            bamap[ b3 & 0x3F                 ]
        ));
    }
    // Leftover
    var m = input.length - n;
    if ( m > 1 ) {
        b1 = input.charCodeAt(ii  );
        b2 = input.charCodeAt(ii+1);
        output.push(String.fromCharCode(
            bamap[                   b1 >>> 2],
            bamap[(b1 & 0x03) << 4 | b2 >>> 4],
            bamap[(b2 & 0x0F) << 2],
            0x3D
        ));
    } else if ( m !== 0 ) {
        b1 = input.charCodeAt(ii);
        output.push(String.fromCharCode(
            bamap[                   b1 >>>2],
            bamap[(b1 & 0x03) << 4          ],
            0x3D,
            0x3D
        ));
    }
    return output.join('');
};

/******************************************************************************/

// Extract a `key` from a URL.

var toUrlKey = function(url) {
    if ( url.slice(0, 4) !== 'http' ) {
        return '';
    }
    var pos = url.indexOf('://');
    if ( pos === -1 ) {
        return '';
    }
    url = url.slice(pos + 3);
    pos = url.indexOf('/');
    if ( pos === -1 ) {
        return '';
    }
    var re = mirrorCandidates[url.slice(0, pos)];
    if ( typeof re !== 'object' || typeof re.exec !== 'function' ) {
        return '';
    }
    var matches = re.exec(url);
    if ( matches === null ) {
        return '';
    }
    return matches.length === 1 ? url : matches[1];
};

/******************************************************************************/

// Ref: http://www.iana.org/assignments/media-types/media-types.xhtml

var normalizeContentType = function(ctin) {
    var ctout;
    var encoding;
    var pos = ctin.indexOf(';');
    if ( pos === -1 ) {
        ctout = ctin.trim();
        encoding = '';
    } else {
        ctout = ctin.slice(0, pos).trim();
        encoding = ctin.slice(pos + 1).trim();
    }
    if ( encoding !== '' ) {
        ctout += ';' + encoding;
    }
    return ctout;
};

/******************************************************************************/

var metadataExists = function(urlKey) {
    return typeof urlKey === 'string' &&
           metadata.urlKeyToHashMap.hasOwnProperty(urlKey);
};

/******************************************************************************/

var contentExists = function(hash) {
    return typeof hash === 'string' &&
           hashToContentMap.hasOwnProperty(hash);
};

/******************************************************************************/

var storageKeyFromHash = function(hash) {
    return 'mirrors_item_' + hash;
};

/******************************************************************************/

// Given that a single data URL can be shared by many URL keys, pruning is a
// bit hairy. So the steps are:
// - Collate information about each data URL:
//   - Last time they were used
//   - Which URL keys reference them
// This will allow us to flush from memory the ones least recently used first.

var pruneToSize = function(toSize) {
    if ( exports.bytesInUse < toSize ) {
        return;
    }
    var k2hMap = metadata.urlKeyToHashMap;
    var h2cMap = hashToContentMap;
    var urlKey, hash;
    var mdEntry, ctEntry, prEntry;
    var pruneMap = {};
    for ( urlKey in k2hMap ) {
        if ( k2hMap.hasOwnProperty(urlKey) === false ) {
            continue;
        }
        mdEntry = k2hMap[urlKey];
        hash = mdEntry.hash;
        if ( pruneMap.hasOwnProperty(hash) === false ) {
            pruneMap[hash] = {
                urlKeys: [urlKey],
                accessTime: mdEntry.accessTime
            };
            continue;
        }
        prEntry = pruneMap[hash];
        prEntry.urlKeys.push(urlKey);
        prEntry.accessTime = Math.max(prEntry.accessTime, mdEntry.accessTime);
    }
    // Least recent at the end of array
    var compare = function(a, b) {
        return pruneMap[b].accessTime - pruneMap[a].accessTime;
    };
    var hashes = Object.keys(pruneMap).sort(compare);
    var toRemove = [];
    var i = hashes.length;
    while ( i-- ) {
        hash = hashes[i];
        prEntry = pruneMap[hash];
        ctEntry = h2cMap[hash];
        delete h2cMap[hash];
        toRemove.push(storageKeyFromHash(hash));
        exports.bytesInUse -= ctEntry.dataURL.length;
        while ( urlKey = prEntry.urlKeys.pop() ) {
            delete k2hMap[urlKey];
        }
        if ( exports.bytesInUse < toSize ) {
            break;
        }
    }
    if ( toRemove.length !== 0 ) {
        //console.debug('mirrors.pruneToSize(%d): removing %o', toSize, toRemove);
        removeContent(toRemove);
        updateMetadataNow();
    }
};

/******************************************************************************/

var updateMetadata = function() {
    metadataPersistTimer = null;
    chrome.storage.local.set({ 'mirrors_metadata': metadata });
};

/******************************************************************************/

var updateMetadataNow = function() {
    if ( metadataPersistTimer !== null ) {
        clearTimeout(metadataPersistTimer);
    }
    updateMetadata();
};

/******************************************************************************/

var updateMetadataAsync = function() {
    if ( metadataPersistTimer === null ) {
        setTimeout(updateMetadata, 60 * 1000);
    }
};

/******************************************************************************/

var addMetadata = function(urlKey, hash) {
    metadata.urlKeyToHashMap[urlKey] = new MetadataEntry(hash);
    updateMetadataNow();
};

/******************************************************************************/

var removeMetadata = function(urlKey) {
    delete metadata.urlKeyToHashMap[urlKey];
};

/******************************************************************************/

var addContent = function(hash, dataURL) {
    if ( contentExists(hash) ) {
        return;
    }
    var contentEntry = hashToContentMap[hash] = new ContentEntry(dataURL);
    exports.bytesInUse += dataURL.length;
    var bin = {};
    bin[storageKeyFromHash(hash)] = contentEntry;
    chrome.storage.local.set(bin);
    if ( exports.bytesInUse >= exports.bytesInUseMax + bytesInUseMercy ) {
        pruneToSize(exports.bytesInUseMax);
    }
};

/******************************************************************************/

var removeContent = function(what) {
    chrome.storage.local.remove(what);
};

/******************************************************************************/

var cacheAsset = function(url) {
    var urlKey = toUrlKey(url);
    if ( metadataExists(urlKey) ) {
        return;
    }

    var onRemoteAssetLoaded = function() {
        this.onload = this.onerror = null;
        if ( this.status !== 200 ) {
            return;
        }
        var contentType = normalizeContentType(this.getResponseHeader('Content-Type'));
        if ( contentType === '' ) {
            //console.debug('mirrors.cacheAsset(): no good content type available');
            return;
        }
        var yamd5 = new YaMD5();
        yamd5.appendAsciiStr(contentType);
        yamd5.appendAsciiStr(this.response);
        var hash = yamd5.end();
        addMetadata(urlKey, hash);
        if ( contentExists(hash) ) {
            //console.debug('mirrors.cacheAsset(): reusing existing content for "%s"', urlKey);
            return;
        }
        //console.debug('mirrors.cacheAsset(): caching new content for "%s"', urlKey);
        // Keep original encoding if there was one, otherwise use base64 --
        // as the result is somewhat more compact I believe
        var dataUrl = null;
        try {
            dataUrl = contentType.indexOf(';') !== -1 ?
                'data:' + contentType + ',' + encodeURIComponent(this.responseText) :
                'data:' + contentType + ';base64,' + btoa(this.response);
        } catch (e) {
            //console.debug(e);
        }
        if ( dataUrl === null ) {
            dataUrl = 'data:' + contentType + ';base64,' + btoaSafe(this.response);
        }
        addContent(hash, dataUrl);
    };

    var onRemoteAssetError = function() {
        this.onload = this.onerror = null;
    };

    getTextFileFromURL(
        url,
        onRemoteAssetLoaded,
        onRemoteAssetError
    );
};

/******************************************************************************/

var toURL = function(url, cache) {
    var urlKey = toUrlKey(url);
    if ( urlKey === '' ) {
        return '';
    }
    if ( metadataExists(urlKey) === false ) {
        if ( cache === true ) {
            cacheAsset(url);
        }
        return '';
    }
    var dataURL = '';
    var metadataEntry = metadata.urlKeyToHashMap[urlKey];
    if ( contentExists(metadataEntry.hash) ) {
        dataURL = hashToContentMap[metadataEntry.hash].dataURL;
        metadataEntry.accessTime = Date.now();
        exports.hitCount += 1;
    } else {
        //console.debug('mirrors.toURL(): content not found "%s"', url);
        delete metadata.urlKeyToHashMap[urlKey];
    }
    updateMetadataAsync();
    return dataURL;
};

/******************************************************************************/

var load = function() {
    loaded = true;

    var loadContent = function(urlKey, hash) {
        var binKey = storageKeyFromHash(hash);
        var onContentReady = function(bin) {
            if ( chrome.runtime.lastError || bin.hasOwnProperty(binKey) === false ) {
                //console.debug('mirrors.load(): failed to load content "%s"', binKey);
                removeMetadata(urlKey);
                removeContent(binKey);
                return;
            }
            //console.debug('mirrors.load(): loaded content "%s"', binKey);
            var ctEntry = hashToContentMap[hash] = bin[binKey];
            exports.bytesInUse += ctEntry.dataURL.length;
        };
        chrome.storage.local.get(binKey, onContentReady);
    };

    var onMetadataReady = function(bin) {
        //console.debug('mirrors.load(): loaded metadata');
        metadata = bin.mirrors_metadata;
        var toRemove = [];
        var u2hmap = metadata.urlKeyToHashMap;
        var hash;
        for ( var urlKey in u2hmap ) {
            if ( u2hmap.hasOwnProperty(urlKey) === false ) {
                continue;
            }
            hash = u2hmap[urlKey].hash;
            if ( metadata.magicId !== magicId ) {
                toRemove.push(storageKeyFromHash(hash));
                removeMetadata(urlKey);
                continue;
            }
            loadContent(urlKey, hash);
        }
        if ( toRemove.length !== 0 ) {
            removeContent(toRemove);
            updateMetadataNow();
        }
    };

    chrome.storage.local.get({ 'mirrors_metadata': metadata }, onMetadataReady);
};

/******************************************************************************/

var unload = function() {
    updateMetadataNow();
    metadata.urlKeyToHashMap = {};
    hashToContentMap = {};
    exports.bytesInUse = 0;
    exports.hitCount = 0;

    loaded = false;
};

/******************************************************************************/

exports.toggle = function(on) {
    if ( on && loaded !== true ) {
        load();
    } else if ( on !== true && loaded ) {
        unload();
    }
};

/******************************************************************************/

// Export API

exports.toURL = toURL;
exports.pruneToSize = pruneToSize;

return exports;

/******************************************************************************/

})();

/******************************************************************************/

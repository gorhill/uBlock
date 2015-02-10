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
/* global vAPI, µBlock, YaMD5 */

/******************************************************************************/

// Low-level asset files manager

µBlock.mirrors = (function() {

'use strict';

/******************************************************************************/

// To show keys in local storage from console:
// vAPI.storage.get(null, function (data) { console.log(Object.keys(data)) });

// To cleanup cached items from console:
// vAPI.storage.get(null, function (data) { vAPI.storage.remove(Object.keys(data).filter(function(a){ return a.indexOf('mirrors_item_') === 0; })); });


var exports = {
    bytesInUseMax: 5 * 1024 * 1024,
    ttl: 21 * 24 * 60 * 60 * 1000,
    bytesInUse: 0,
    tryCount: 0,
    hitCount: 0
};

/******************************************************************************/

var nullFunc = function() {};

// TODO: need to come up with something better. Key shoud be domain. More
// control over what significant part(s) of a URL is to be used as key.
var mirrorCandidates = Object.create(null);

var magicId = 'yawqboypxuhs';
var metadataPersistTimer = null;
var bytesInUseMercy = 1 * 1024 * 1024;

var metadata = {
    magicId: magicId,
    urlKeyToHashMap: {}
};

var hashToContentMap = {};
var urlKeyPendingMap = {};

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
    xhr.open('get', url, true);
    xhr.timeout = 10000;
    xhr.onload = onLoad;
    xhr.onerror = onError;
    xhr.ontimeout = onError;
    xhr.responseType = 'arraybuffer';
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
        b1 = input[ii  ];
        b2 = input[ii+1];
        b3 = input[ii+2];
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
        b1 = input[ii  ];
        b2 = input[ii+1];
        output.push(String.fromCharCode(
            bamap[                   b1 >>> 2],
            bamap[(b1 & 0x03) << 4 | b2 >>> 4],
            bamap[(b2 & 0x0F) << 2           ],
            0x3D
        ));
    } else if ( m !== 0 ) {
        b1 = input[ii  ];
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
    var regexes = mirrorCandidates[url.slice(0, pos)];
    if ( regexes === undefined ) {
        return '';
    }
    var i = regexes.length;
    var matches;
    while ( i-- ) {
        matches = regexes[i].exec(url);
        if ( matches === null ) {
            continue;
        }
        // https://github.com/gorhill/uBlock/issues/301
        // Use whole URL as key when no regex capture
        return matches.length === 1 ? url : matches[1];
    }
    return '';
};

/******************************************************************************/

// Ref: http://www.iana.org/assignments/media-types/media-types.xhtml

// https://github.com/gorhill/uBlock/issues/362
// 
// Using http://dev.w3.org/2006/webapi/FileAPI/#enctype logic, at least it's
// something... It looks like this is what the browser should be doing with
// `data:` URI, but it's not happening, so i will do it manually for now.
// 
// ...
// 5. If the "getting an encoding" steps above return failure, then set 
//    encoding to null.
// 6. If encoding is null, then set encoding to utf-8.

var extractMimeType = function(ctin) {
    var pos = ctin.indexOf(';');
    var type = pos === -1 ? ctin.trim() : ctin.slice(0, pos).trim();
    var charset = pos === -1 ? '' : ctin.slice(pos + 1).trim();
    if ( charset !== '' ) {
        return type + ';' + charset;
    }
    // http://en.wikipedia.org/wiki/Internet_media_type#List_of_common_media_types
    if ( type.slice(0, 4) === 'text' || /^application\/[a-z-]+script$/.test(type) ) {
        return type + ';charset=utf-8';
    }
    return type;
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
    vAPI.storage.set({ 'mirrors_metadata': metadata });
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
        metadataPersistTimer = setTimeout(updateMetadata, 60 * 1000);
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
    vAPI.storage.set(bin);
    if ( exports.bytesInUse >= exports.bytesInUseMax + bytesInUseMercy ) {
        pruneToSize(exports.bytesInUseMax);
    }
};

/******************************************************************************/

var removeContent = function(what) {
    vAPI.storage.remove(what);
};

/******************************************************************************/

var cacheAsset = function(url) {
    var urlKey = toUrlKey(url);
    if ( metadataExists(urlKey) ) {
        return;
    }
    // Avoid re-entrancy
    if ( urlKeyPendingMap.hasOwnProperty(urlKey) ) {
        return;
    }
    urlKeyPendingMap[urlKey] = true;

    var onRemoteAssetLoaded = function() {
        delete urlKeyPendingMap[urlKey];
        this.onload = this.onerror = null;
        if ( this.status !== 200 ) {
            return;
        }
        //console.log('headers for "%s" = %o', url, this.getAllResponseHeaders());
        var mimeType = extractMimeType(this.getResponseHeader('Content-Type'));
        var uint8Buffer = new Uint8Array(this.response);
        var yamd5 = new YaMD5();
        yamd5.appendAsciiStr(mimeType);
        yamd5.appendByteArray(uint8Buffer);
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
            dataUrl = 'data:' + mimeType + ';base64,' + btoaSafe(uint8Buffer);
        } catch (e) {
            //console.debug('"%s":', url, e);
        }
        if ( dataUrl !== null ) {
            addContent(hash, dataUrl);
        }
    };

    var onRemoteAssetError = function() {
        delete urlKeyPendingMap[urlKey];
        this.onload = this.onerror = null;
    };

    getTextFileFromURL(
        url,
        onRemoteAssetLoaded,
        onRemoteAssetError
    );
};

/******************************************************************************/

var toURL = function(url, type, cache) {
    // Unsupported types
    if ( type === 'font' ) {
        return '';
    }
    exports.tryCount += 1;
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

var parseMirrorCandidates = function(rawText) {
    var rawTextEnd = rawText.length;
    var lineBeg = 0, lineEnd;
    var line;
    var key = '', re;
    while ( lineBeg < rawTextEnd ) {
        lineEnd = rawText.indexOf('\n', lineBeg);
        if ( lineEnd === -1 ) {
            lineEnd = rawText.indexOf('\r', lineBeg);
            if ( lineEnd === -1 ) {
                lineEnd = rawTextEnd;
            }
        }
        line = rawText.slice(lineBeg, lineEnd);
        lineBeg = lineEnd + 1;
        if ( line.charAt(0) === '#' ) {
            continue;
        }
        if ( line.charAt(0) !== ' ' ) {
            key = line.trim();
            continue;
        }
        if ( key === '' ) {
            continue;
        }
        re = new RegExp(line.trim());
        if ( mirrorCandidates[key] === undefined ) {
            mirrorCandidates[key] = [];
        }
        mirrorCandidates[key].push(re);
    }
};

/******************************************************************************/

var load = function() {
    loaded = true;

    var onMirrorCandidatesReady = function(details) {
        if ( details.content !== '' ) {
            parseMirrorCandidates(details.content);
        }
    };

    var loadContent = function(urlKey, hash) {
        var binKey = storageKeyFromHash(hash);
        var onContentReady = function(bin) {
            if ( vAPI.lastError() || bin.hasOwnProperty(binKey) === false ) {
                //console.debug('mirrors.load(): failed to load content "%s"', binKey);
                removeMetadata(urlKey);
                removeContent(binKey);
                return;
            }
            //console.debug('mirrors.load(): loaded content "%s"', binKey);
            var ctEntry = hashToContentMap[hash] = bin[binKey];
            exports.bytesInUse += ctEntry.dataURL.length;
        };
        vAPI.storage.get(binKey, onContentReady);
    };

    var onMetadataReady = function(bin) {
        //console.debug('mirrors.load(): loaded metadata');
        var u2hmap = metadata.urlKeyToHashMap = bin.mirrors_metadata.urlKeyToHashMap;
        var mustReset = bin.mirrors_metadata.magicId !== magicId;
        var toRemove = [];
        var hash;
        for ( var urlKey in u2hmap ) {
            if ( u2hmap.hasOwnProperty(urlKey) === false ) {
                continue;
            }
            hash = u2hmap[urlKey].hash;
            if ( mustReset ) {
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

    vAPI.storage.get({ 'mirrors_metadata': metadata }, onMetadataReady);
    µBlock.assets.get('assets/ublock/mirror-candidates.txt', onMirrorCandidatesReady);
};

/******************************************************************************/

var unload = function() {
    pruneToSize(0);
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

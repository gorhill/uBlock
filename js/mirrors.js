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

/* global chrome, YaMD5, µBlock */

/******************************************************************************/

// Low-level asset files manager

µBlock.mirrors = (function() {

/******************************************************************************/

var exports = {
    bytesInUse: 0,
    hitCount: 0
};

/******************************************************************************/

var nullFunc = function() {};

var mirrorCandidates = {
          'ajax.googleapis.com': /^ajax\.googleapis\.com\/ajax\/libs\//,
         'fonts.googleapis.com': /^fonts\.googleapis\.com/,
            'fonts.gstatic.com': /^fonts\.gstatic\.com/,
         'cdnjs.cloudflare.com': /^cdnjs\.cloudflare\.com\/ajax\/libs\//,
              'code.jquery.com': /^code\.jquery\.com/,
                  's0.2mdn.net': /(2mdn\.net\/instream\/html5\/ima3\.js)/,
         'connect.facebook.net': /(connect\.facebook\.net\/[^\/]+\/all\.js)/,
    'www.googletagservices.com': /(www\.googletagservices\.com\/tag\/js\/gpt\.js)/
};


var magicId = 'rmwwgwkzcgfv';
var bytesInUseMax = 20 * 1024 * 1024;
var ttl = 30 * 24 * 60 * 60 * 1000;
var metadataPersistTimer = null;

var metadata = {
    magicId: magicId,
    urlKeyToHashMap: {}
};

// Hash to content map
var hashToDataUrlMap = {};

var loaded = false;

/******************************************************************************/

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
        return -1;
    }
    var re = mirrorCandidates[url.slice(0, pos)];
    if ( typeof re !== 'object' || typeof re.test !== 'function' ) {
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
    return typeof urlKey === 'string' && metadata.urlKeyToHashMap.hasOwnProperty(urlKey);
};

/******************************************************************************/

var contentExists = function(hash) {
    return typeof hash === 'string' && hashToDataUrlMap.hasOwnProperty(hash);
};

/******************************************************************************/

var updateMetadata = function() {
    metadataPersistTimer = null;
    chrome.storage.local.set({ 'mirrors_metadata': metadata });
};

/******************************************************************************/

var updateMetadataAsync = function(urlKey, hash) {
    var doesExist = metadataExists(urlKey);
    if ( doesExist ) {
        metadata.urlKeyToHashMap[urlKey].accessTime = Date.now();
        if ( metadataPersistTimer === null ) {
            setTimeout(updateMetadata, 60 * 1000);
        }
        return;
    }
    metadata.urlKeyToHashMap[urlKey] = new MetadataEntry(hash);
    if ( metadataPersistTimer !== null ) {
        clearTimeout(metadataPersistTimer);
    }
    updateMetadata();
};

/******************************************************************************/

var updateContent = function(hash, dataURL) {
    if ( contentExists(hash) !== false ) {
        return;
    }
    var contentEntry = hashToDataUrlMap[hash] = new ContentEntry(dataURL);
    exports.bytesInUse += dataURL.length;
    var key = 'mirrors_item_' + hash;
    var bin = {};
    bin[key] = contentEntry;
    chrome.storage.local.set(bin);
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
        updateMetadataAsync(urlKey, hash);
        if ( contentExists(hash) ) {
            //console.debug('mirrors.cacheAsset(): reusing existing content for "%s"', urlKey);
            return;
        }
        //console.debug('mirrors.cacheAsset(): caching new content for "%s"', urlKey);
        // Keep original encoding if there was one, otherwise use base64 --
        // as the result is somewhat more compact I believe
        var dataUrl = contentType.indexOf(';') !== -1 ?
            'data:' + contentType + ',' + encodeURIComponent(this.responseText) :
            'data:' + contentType + ';base64,' + btoa(this.response);
        updateContent(hash, dataUrl);
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
    var metadataEntry = metadata.urlKeyToHashMap[urlKey];
    if ( contentExists(metadataEntry.hash) === false ) {
        return '';
    }
    var contentEntry = hashToDataUrlMap[metadataEntry.hash];
    updateMetadataAsync(urlKey);
    exports.hitCount += 1;
    return contentEntry.dataURL;
};

/******************************************************************************/

var load = function() {
    loaded = true;

    var loadContent = function(hash) {
        var key = 'mirrors_item_' + hash;
        var onContentReady = function(bin) {
            if ( chrome.runtime.lastError ) {
                return;
            }
            var contentEntry = bin[key];
            hashToDataUrlMap[hash] = contentEntry;
            exports.bytesInUse += contentEntry.dataURL.length;
        };
        var bin = {};
        bin[key] = '';
        chrome.storage.local.get(bin, onContentReady);
    };

    var onMetadataReady = function(bin) {
        if ( chrome.runtime.lastError ) {
            return;
        }
        metadata = bin.mirrors_metadata;
        var hemap = metadata.urlKeyToHashMap;
        for ( var urlKey in hemap ) {
            if ( hemap.hasOwnProperty(urlKey) === false ) {
                continue;
            }
            loadContent(hemap[urlKey].hash);
        }
    };

    chrome.storage.local.get({ 'mirrors_metadata' : metadata }, onMetadataReady);
};

/******************************************************************************/

var unload = function() {
    if ( metadataPersistTimer !== null ) {
        updateMetadata();
    }
    metadata.urlKeyToHashMap = {};
    hashToDataUrlMap = {};
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

return exports;

/******************************************************************************/

})();

/******************************************************************************/

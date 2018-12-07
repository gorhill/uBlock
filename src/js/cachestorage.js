/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2016-present The uBlock Origin authors

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

/* global IDBDatabase, indexedDB */

'use strict';

/******************************************************************************/

// The code below has been originally manually imported from:
// Commit: https://github.com/nikrolls/uBlock-Edge/commit/d1538ea9bea89d507219d3219592382eee306134
// Commit date: 29 October 2016
// Commit author: https://github.com/nikrolls
// Commit message: "Implement cacheStorage using IndexedDB"

// The original imported code has been subsequently modified as it was not
// compatible with Firefox.
// (a Promise thing, see https://github.com/dfahlander/Dexie.js/issues/317)
// Furthermore, code to migrate from browser.storage.local to vAPI.cacheStorage
// has been added, for seamless migration of cache-related entries into
// indexedDB.

µBlock.cacheStorage = (function() {

    const STORAGE_NAME = 'uBlock0CacheStorage';

    // https://bugzilla.mozilla.org/show_bug.cgi?id=1371255
    //   Firefox-specific: we use indexedDB because chrome.storage.local() has
    //   poor performance in Firefox.
    // https://github.com/uBlockOrigin/uBlock-issues/issues/328
    //   Use IndexedDB for Chromium as well, to take advantage of LZ4
    //   compression.
    if (
        vAPI.webextFlavor.soup.has('firefox') === false &&
        vAPI.webextFlavor.soup.has('chromium') === false
    ) {
        // In case IndexedDB was used as cache storage, remove it.
        indexedDB.deleteDatabase(STORAGE_NAME);
        return vAPI.cacheStorage;
    }

    let db;
    let pendingInitialization;
    let dbBytesInUse;

    const get = function get(input, callback) {
        if ( typeof callback !== 'function' ) { return; }
        if ( input === null ) {
            return getAllFromDb(callback);
        }
        var toRead, output = {};
        if ( typeof input === 'string' ) {
            toRead = [ input ];
        } else if ( Array.isArray(input) ) {
            toRead = input;
        } else /* if ( typeof input === 'object' ) */ {
            toRead = Object.keys(input);
            output = input;
        }
        return getFromDb(toRead, output, callback);
    };

    const set = function set(input, callback) {
        putToDb(input, callback);
    };

    const remove = function remove(key, callback) {
        deleteFromDb(key, callback);
    };

    const clear = function clear(callback) {
        clearDb(callback);
    };

    const getBytesInUse = function getBytesInUse(keys, callback) {
        getDbSize(callback);
    };

    const api = {
        get,
        set,
        remove,
        clear,
        getBytesInUse,
        error: undefined
    };

    const genericErrorHandler = function(ev) {
        let error = ev.target && ev.target.error;
        if ( error && error.name === 'QuotaExceededError' ) {
            api.error = error.name;
        }
        console.error('[%s]', STORAGE_NAME, error && error.name);
    };

    const noopfn = function () {
    };

    const disconnect = function() {
        if ( dbTimer !== undefined ) {
            clearTimeout(dbTimer);
            dbTimer = undefined;
        }
        if ( db instanceof IDBDatabase ) { 
            db.close();
            db = undefined;
        }
    };

    let dbTimer;

    const keepAlive = function() {
        if ( dbTimer !== undefined ) {
            clearTimeout(dbTimer);
        }
        dbTimer = vAPI.setTimeout(
            ( ) => {
                dbTimer = undefined;
                disconnect();
            },
            Math.max(
                µBlock.hiddenSettings.autoUpdateAssetFetchPeriod * 2 * 1000,
                180000
            )
        );
    };

    const getDb = function getDb() {
        if ( db === null ) {
            return Promise.resolve(null);
        }
        keepAlive();
        if ( db instanceof IDBDatabase ) {
            return Promise.resolve(db);
        }
        if ( pendingInitialization !== undefined ) {
            return pendingInitialization;
        }
        // https://github.com/gorhill/uBlock/issues/3156
        //   I have observed that no event was fired in Tor Browser 7.0.7 +
        //   medium security level after the request to open the database was
        //   created. When this occurs, I have also observed that the `error`
        //   property was already set, so this means uBO can detect here whether
        //   the database can be opened successfully. A try-catch block is
        //   necessary when reading the `error` property because we are not
        //   allowed to read this propery outside of event handlers in newer
        //   implementation of IDBRequest (my understanding).
        pendingInitialization = new Promise(resolve => {
            let req;
            try {
                req = indexedDB.open(STORAGE_NAME, 1);
                if ( req.error ) {
                    console.log(req.error);
                    req = undefined;
                }
            } catch(ex) {
            }
            if ( req === undefined ) {
                pendingInitialization = undefined;
                db = null;
                resolve(null);
                return;
            }
            req.onupgradeneeded = function(ev) {
                req = undefined;
                let db = ev.target.result;
                db.onerror = db.onabort = genericErrorHandler;
                let table = db.createObjectStore(STORAGE_NAME, { keyPath: 'key' });
                table.createIndex('value', 'value', { unique: false });
            };
            req.onsuccess = function(ev) {
                pendingInitialization = undefined;
                req = undefined;
                db = ev.target.result;
                db.onerror = db.onabort = genericErrorHandler;
                resolve(db);
            };
            req.onerror = req.onblocked = function() {
                pendingInitialization = undefined;
                req = undefined;
                db = null;
                console.log(this.error);
                resolve(null);
            };
        });
        return pendingInitialization;
    };

    const getFromDb = function(keys, keyvalStore, callback) {
        if ( typeof callback !== 'function' ) { return; }
        if ( keys.length === 0 ) { return callback(keyvalStore); }
        let promises = [];
        let gotOne = function() {
            if ( typeof this.result !== 'object' ) { return; }
            keyvalStore[this.result.key] = this.result.value;
            if ( this.result.value instanceof Blob === false ) { return; }
            promises.push(
                µBlock.lz4Codec.decode(
                    this.result.key,
                    this.result.value
                ).then(result => {
                    keyvalStore[result.key] = result.data;
                })
            );
        };
        getDb().then(( ) => {
            if ( !db ) { return callback(); }
            let transaction = db.transaction(STORAGE_NAME);
            transaction.oncomplete =
            transaction.onerror =
            transaction.onabort = ( ) => {
                Promise.all(promises).then(( ) => {
                    callback(keyvalStore);
                });
            };
            let table = transaction.objectStore(STORAGE_NAME);
            for ( let key of keys ) {
                let req = table.get(key);
                req.onsuccess = gotOne;
                req.onerror = noopfn;
                req = undefined;
            }
        });
    };

    const visitAllFromDb = function(visitFn) {
        getDb().then(( ) => {
            if ( !db ) { return visitFn(); }
            let transaction = db.transaction(STORAGE_NAME);
            transaction.oncomplete =
            transaction.onerror =
            transaction.onabort = ( ) => visitFn();
            let table = transaction.objectStore(STORAGE_NAME);
            let req = table.openCursor();
            req.onsuccess = function(ev) {
                let cursor = ev.target && ev.target.result;
                if ( !cursor ) { return; }
                let entry = cursor.value;
                visitFn(entry);
                cursor.continue();
            };
        });
    };

    const getAllFromDb = function(callback) {
        if ( typeof callback !== 'function' ) { return; }
        let promises = [];
        let keyvalStore = {};
        visitAllFromDb(entry => {
            if ( entry === undefined ) {
                Promise.all(promises).then(( ) => {
                    callback(keyvalStore);
                });
                return;
            }
            keyvalStore[entry.key] = entry.value;
            if ( entry.value instanceof Blob === false ) { return; }
            promises.push(
                µBlock.lz4Codec.decode(
                    entry.key,
                    entry.value
                ).then(result => {
                    keyvalStore[result.key] = result.value;
                })
            );
        });
    };

    const getDbSize = function(callback) {
        if ( typeof callback !== 'function' ) { return; }
        if ( typeof dbBytesInUse === 'number' ) {
            return Promise.resolve().then(( ) => {
                callback(dbBytesInUse);
            });
        }
        const textEncoder = new TextEncoder();
        let totalByteLength = 0;
        visitAllFromDb(entry => {
            if ( entry === undefined ) {
                dbBytesInUse = totalByteLength;
                return callback(totalByteLength);
            }
            let value = entry.value;
            if ( typeof value === 'string' ) {
                totalByteLength += textEncoder.encode(value).byteLength;
            } else if ( value instanceof Blob ) {
                totalByteLength += value.size;
            } else {
                totalByteLength += textEncoder.encode(JSON.stringify(value)).byteLength;
            }
            if ( typeof entry.key === 'string' ) {
                totalByteLength += textEncoder.encode(entry.key).byteLength;
            }
        });
    };


    // https://github.com/uBlockOrigin/uBlock-issues/issues/141
    //   Mind that IDBDatabase.transaction() and IDBObjectStore.put()
    //   can throw:
    //   https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction
    //   https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore/put

    const putToDb = function(keyvalStore, callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        let keys = Object.keys(keyvalStore);
        if ( keys.length === 0 ) { return callback(); }
        let promises = [ getDb() ];
        let entries = [];
        let dontCompress = µBlock.hiddenSettings.cacheStorageCompression !== true;
        let handleEncodingResult = result => {
            entries.push({ key: result.key, value: result.data });
        };
        for ( let key of keys ) {
            let data = keyvalStore[key];
            if ( typeof data !== 'string' || dontCompress ) {
                entries.push({ key, value: data });
                continue;
            }
            promises.push(
                µBlock.lz4Codec.encode(key, data).then(handleEncodingResult)
            );
        }
        Promise.all(promises).then(( ) => {
            if ( !db ) { return callback(); }
            let finish = ( ) => {
                dbBytesInUse = undefined;
                if ( callback === undefined ) { return; }
                let cb = callback;
                callback = undefined;
                cb();
            };
            try {
                let transaction = db.transaction(STORAGE_NAME, 'readwrite');
                transaction.oncomplete =
                transaction.onerror =
                transaction.onabort = finish;
                let table = transaction.objectStore(STORAGE_NAME);
                for ( let entry of entries ) {
                    table.put(entry);
                }
            } catch (ex) {
                finish();
            }
        });
    };

    const deleteFromDb = function(input, callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        let keys = Array.isArray(input) ? input.slice() : [ input ];
        if ( keys.length === 0 ) { return callback(); }
        getDb().then(db => {
            if ( !db ) { return callback(); }
            let finish = ( ) => {
                dbBytesInUse = undefined;
                if ( callback === undefined ) { return; }
                let cb = callback;
                callback = undefined;
                cb();
            };
            try {
                let transaction = db.transaction(STORAGE_NAME, 'readwrite');
                transaction.oncomplete =
                transaction.onerror =
                transaction.onabort = finish;
                let table = transaction.objectStore(STORAGE_NAME);
                for ( let key of keys ) {
                    table.delete(key);
                }
            } catch (ex) {
                finish();
            }
        });
    };

    const clearDb = function(callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        getDb().then(db => {
            if ( !db ) { return callback(); }
            let finish = ( ) => {
                disconnect();
                indexedDB.deleteDatabase(STORAGE_NAME);
                dbBytesInUse = 0;
                if ( callback === undefined ) { return; }
                let cb = callback;
                callback = undefined;
                cb();
            };
            try {
                let req = db.transaction(STORAGE_NAME, 'readwrite')
                            .objectStore(STORAGE_NAME)
                            .clear();
                req.onsuccess = req.onerror = finish;
            } catch (ex) {
                finish();
            }
        });
    };

    // prime the db so that it's ready asap for next access.
    getDb(noopfn);

    // https://github.com/uBlockOrigin/uBlock-issues/issues/328
    //   Detect whether browser.storage.local was used as cache storage,
    //   and if so, move cache-related entries to the new storage.
    {
        const srcStorage = vAPI.cacheStorage;
        const desStorage = api;
        srcStorage.get(
            [ 'assetCacheRegistry', 'assetSourceRegistry' ],
            bin => {
                if (
                    bin instanceof Object === false ||
                    bin.assetSourceRegistry instanceof Object === false
                ) {
                    return;
                }
                desStorage.set(bin);
                const toRemove = [
                    'assetCacheRegistry',
                    'assetSourceRegistry',
                    'resourcesSelfie',
                    'selfie'
                ];
                let toMigrate = 0;
                const setEntry = function(assetKey, bin) {
                    if (
                        bin instanceof Object &&
                        bin[assetKey] !== undefined
                    ) {
                        desStorage.set(bin);
                    }
                    toMigrate -= 1;
                    if ( toMigrate === 0 ) {
                        srcStorage.remove(toRemove);
                    }
                };
                for ( const key in bin.assetCacheRegistry ) {
                    if ( bin.assetCacheRegistry.hasOwnProperty(key) === false ) {
                        continue;
                    }
                    const assetKey = 'cache/' + key;
                    srcStorage.get(assetKey, setEntry.bind(null, assetKey));
                    toMigrate += 1;
                    toRemove.push(assetKey);
                }
                if ( toMigrate === 0 ) {
                    srcStorage.remove(toRemove);
                }
            }
        );
    }

    return api;
}());

/******************************************************************************/

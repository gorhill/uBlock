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

vAPI.cacheStorage = (function() {

    // Firefox-specific: we use indexedDB because chrome.storage.local() has
    // poor performance in Firefox. See:
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1371255
    if ( vAPI.webextFlavor.soup.has('firefox') === false ) {
        return vAPI.cacheStorage;
    }

    const STORAGE_NAME = 'uBlock0CacheStorage';
    let db;
    let pendingInitialization;

    let get = function get(input, callback) {
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

    let set = function set(input, callback) {
        putToDb(input, callback);
    };

    let remove = function remove(key, callback) {
        deleteFromDb(key, callback);
    };

    let clear = function clear(callback) {
        clearDb(callback);
    };

    let getBytesInUse = function getBytesInUse(keys, callback) {
        // TODO: implement this
        callback(0);
    };

    let api = { get, set, remove, clear, getBytesInUse, error: undefined };

    let genericErrorHandler = function(ev) {
        let error = ev.target && ev.target.error;
        if ( error && error.name === 'QuotaExceededError' ) {
            api.error = error.name;
        }
        console.error('[%s]', STORAGE_NAME, error && error.name);
    };

    function noopfn() {
    }

    let getDb = function getDb() {
        if ( db instanceof IDBDatabase ) {
            return Promise.resolve(db);
        }
        if ( db === null ) {
            return Promise.resolve(null);
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

    let getFromDb = function(keys, keystore, callback) {
        if ( typeof callback !== 'function' ) { return; }
        if ( keys.length === 0 ) { return callback(keystore); }
        let gotOne = function() {
            if ( typeof this.result === 'object' ) {
                keystore[this.result.key] = this.result.value;
            }
        };
        getDb().then(( ) => {
            if ( !db ) { return callback(); }
            let transaction = db.transaction(STORAGE_NAME);
            transaction.oncomplete =
            transaction.onerror =
            transaction.onabort = ( ) => callback(keystore);
            let table = transaction.objectStore(STORAGE_NAME);
            for ( let key of keys ) {
                let req = table.get(key);
                req.onsuccess = gotOne;
                req.onerror = noopfn;
                req = undefined;
            }
        });
    };

    let getAllFromDb = function(callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        getDb().then(( ) => {
            if ( !db ) { return callback(); }
            let keystore = {};
            let transaction = db.transaction(STORAGE_NAME);
            transaction.oncomplete =
            transaction.onerror =
            transaction.onabort = ( ) => callback(keystore);
            let table = transaction.objectStore(STORAGE_NAME),
                req = table.openCursor();
            req.onsuccess = function(ev) {
                let cursor = ev.target.result;
                if ( !cursor ) { return; }
                keystore[cursor.key] = cursor.value;
                cursor.continue();
            };
        });
    };

    // https://github.com/uBlockOrigin/uBlock-issues/issues/141
    //   Mind that IDBDatabase.transaction() and IDBObjectStore.put()
    //   can throw:
    //   https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction
    //   https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore/put

    let putToDb = function(keystore, callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        let keys = Object.keys(keystore);
        if ( keys.length === 0 ) { return callback(); }
        getDb().then(( ) => {
            if ( !db ) { return callback(); }
            let finish = ( ) => {
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
                    let entry = {};
                    entry.key = key;
                    entry.value = keystore[key];
                    table.put(entry);
                    entry = undefined;
                }
            } catch (ex) {
                finish();
            }
        });
    };

    let deleteFromDb = function(input, callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        let keys = Array.isArray(input) ? input.slice() : [ input ];
        if ( keys.length === 0 ) { return callback(); }
        getDb().then(db => {
            if ( !db ) { return callback(); }
            let finish = ( ) => {
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

    let clearDb = function(callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        getDb().then(db => {
            if ( !db ) { return callback(); }
            let finish = ( ) => {
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

    return api;
}());

/******************************************************************************/

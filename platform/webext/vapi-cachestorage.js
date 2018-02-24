/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2016-2017 The uBlock Origin authors

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

/* global indexedDB, IDBDatabase */

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
    const STORAGE_NAME = 'uBlock0CacheStorage';
    var db;
    var pending = [];

    // prime the db so that it's ready asap for next access.
    getDb(noopfn);

    return { get, set, remove, clear, getBytesInUse };

    function get(input, callback) {
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
    }

    function set(input, callback) {
        putToDb(input, callback);
    }

    function remove(key, callback) {
        deleteFromDb(key, callback);
    }

    function clear(callback) {
        clearDb(callback);
    }

    function getBytesInUse(keys, callback) {
        // TODO: implement this
        callback(0);
    }

    function genericErrorHandler(error) {
        console.error('[%s]', STORAGE_NAME, error);
    }

    function noopfn() {
    }

    function processPendings() {
        var cb;
        while ( (cb = pending.shift()) ) {
            cb(db);
        }
    }

    function getDb(callback) {
        if ( pending === undefined ) {
            return callback();
        }
        if ( pending.length !== 0 ) {
            return pending.push(callback);
        }
        if ( db instanceof IDBDatabase ) {
            return callback(db);
        }
        pending.push(callback);
        if ( pending.length !== 1 ) { return; }
        // https://github.com/gorhill/uBlock/issues/3156
        //   I have observed that no event was fired in Tor Browser 7.0.7 +
        //   medium security level after the request to open the database was
        //   created. When this occurs, I have also observed that the `error`
        //   property was already set, so this means uBO can detect here whether
        //   the database can be opened successfully. A try-catch block is
        //   necessary when reading the `error` property because we are not
        //   allowed to read this propery outside of event handlers in newer
        //   implementation of IDBRequest (my understanding).
        var req;
        try {
            req = indexedDB.open(STORAGE_NAME, 1);
            if ( req.error ) {
                console.log(req.error);
                req = undefined;
            }
        } catch(ex) {
        }
        if ( req === undefined ) {
            processPendings();
            pending = undefined;
            return;
        }
        req.onupgradeneeded = function(ev) {
            req = undefined;
            db = ev.target.result;
            db.onerror = db.onabort = genericErrorHandler;
            var table = db.createObjectStore(STORAGE_NAME, { keyPath: 'key' });
            table.createIndex('value', 'value', { unique: false });
        };
        req.onsuccess = function(ev) {
            req = undefined;
            db = ev.target.result;
            db.onerror = db.onabort = genericErrorHandler;
            processPendings();
        };
        req.onerror = req.onblocked = function() {
            req = undefined;
            console.log(this.error);
            processPendings();
            pending = undefined;
        };
    }

    function getFromDb(keys, store, callback) {
        if ( typeof callback !== 'function' ) { return; }
        if ( keys.length === 0 ) { return callback(store); }
        var gotOne = function() {
            if ( typeof this.result === 'object' ) {
                store[this.result.key] = this.result.value;
            }
        };
        getDb(function(db) {
            if ( !db ) { return callback(); }
            var transaction = db.transaction(STORAGE_NAME);
            transaction.oncomplete =
            transaction.onerror =
            transaction.onabort = function() {
                return callback(store);
            };
            var table = transaction.objectStore(STORAGE_NAME);
            for ( var key of keys ) {
                var req = table.get(key);
                req.onsuccess = gotOne;
                req.onerror = noopfn;
                req = undefined;
            }
        });
    }

    function getAllFromDb(callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        getDb(function(db) {
            if ( !db ) { return callback(); }
            var output = {};
            var transaction = db.transaction(STORAGE_NAME);
            transaction.oncomplete =
            transaction.onerror =
            transaction.onabort = function() {
                callback(output);
            };
            var table = transaction.objectStore(STORAGE_NAME),
                req = table.openCursor();
            req.onsuccess = function(ev) {
                var cursor = ev.target.result;
                if ( !cursor ) { return; }
                output[cursor.key] = cursor.value;
                cursor.continue();
            };
        });
    }

    function putToDb(input, callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        var keys = Object.keys(input);
        if ( keys.length === 0 ) { return callback(); }
        getDb(function(db) {
            if ( !db ) { return callback(); }
            var transaction = db.transaction(STORAGE_NAME, 'readwrite');
            transaction.oncomplete =
            transaction.onerror =
            transaction.onabort = callback;
            var table = transaction.objectStore(STORAGE_NAME);
            for ( var key of keys ) {
                var entry = {};
                entry.key = key;
                entry.value = input[key];
                table.put(entry);
                entry = undefined;
            }
        });
    }

    function deleteFromDb(input, callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        var keys = Array.isArray(input) ? input.slice() : [ input ];
        if ( keys.length === 0 ) { return callback(); }
        getDb(function(db) {
            if ( !db ) { return callback(); }
            var transaction = db.transaction(STORAGE_NAME, 'readwrite');
            transaction.oncomplete =
            transaction.onerror =
            transaction.onabort = callback;
            var table = transaction.objectStore(STORAGE_NAME);
            for ( var key of keys ) {
                table.delete(key);
            }
        });
    }

    function clearDb(callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        getDb(function(db) {
            if ( !db ) { return callback(); }
            var req = db.transaction(STORAGE_NAME, 'readwrite')
                        .objectStore(STORAGE_NAME)
                        .clear();
            req.onsuccess = req.onerror = callback;
        });
    }
}());

/******************************************************************************/

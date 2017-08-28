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

'use strict';

/******************************************************************************/

// The code below has been originally manually imported from:
// Commit: https://github.com/nikrolls/uBlock-Edge/commit/d1538ea9bea89d507219d3219592382eee306134
// Commit date: 29 October 2016
// Commit author: https://github.com/nikrolls
// Commit message: "Implement cacheStorage using IndexedDB"

vAPI.cacheStorage = (function() {
    const STORAGE_NAME = 'uBlockStorage';
    const db = getDb();

    return {get, set, remove, clear, getBytesInUse};

    function get(key, callback) {
        let promise;

        if (key === null) {
            promise = getAllFromDb();
        } else if (typeof key === 'string') {
            promise = getFromDb(key).then(result => [result]);
        } else if (typeof key === 'object') {
            const keys = Array.isArray(key) ? [].concat(key) : Object.keys(key);
            const requests = keys.map(key => getFromDb(key));
            promise = Promise.all(requests);
        } else {
            promise = Promise.resolve([]);
        }

        promise.then(results => convertResultsToHash(results))
            .then((converted) => {
                if (typeof key === 'object' && !Array.isArray(key)) {
                    callback(Object.assign({}, key, converted));
                } else {
                    callback(converted);
                }
            })
            .catch((e) => {
                browser.runtime.lastError = e;
                callback(null);
            });
    }

    function set(data, callback) {
        const requests = Object.keys(data).map(
            key => putToDb(key, data[key])
        );

        Promise.all(requests)
            .then(() => callback && callback())
            .catch(e => (browser.runtime.lastError = e, callback && callback()));
    }

    function remove(key, callback) {
        const keys = [].concat(key);
        const requests = keys.map(key => deleteFromDb(key));

        Promise.all(requests)
            .then(() => callback && callback())
            .catch(e => (browser.runtime.lastError = e, callback && callback()));
    }

    function clear(callback) {
        clearDb()
            .then(() => callback && callback())
            .catch(e => (browser.runtime.lastError = e, callback && callback()));
    }

    function getBytesInUse(keys, callback) {
        // TODO: implement this
        callback(0);
    }

    function getDb() {
        const openRequest = window.indexedDB.open(STORAGE_NAME, 1);
        openRequest.onupgradeneeded = upgradeSchema;
        return convertToPromise(openRequest).then((db) => {
            db.onerror = console.error;
            return db;
        });
    }

    function upgradeSchema(event) {
        const db = event.target.result;
        db.onerror = (error) => console.error('[storage] Error updating IndexedDB schema:', error);

        const objectStore = db.createObjectStore(STORAGE_NAME, {keyPath: 'key'});
        objectStore.createIndex('value', 'value', {unique: false});
    }

    function getNewTransaction(mode = 'readonly') {
        return db.then(db => db.transaction(STORAGE_NAME, mode).objectStore(STORAGE_NAME));
    }

    function getFromDb(key) {
        return getNewTransaction()
            .then(store => store.get(key))
            .then(request => convertToPromise(request));
    }

    function getAllFromDb() {
        return getNewTransaction()
            .then((store) => {
                return new Promise((resolve, reject) => {
                    const request = store.openCursor();
                    const output = [];

                    request.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            output.push(cursor.value);
                            cursor.continue();
                        } else {
                            resolve(output);
                        }
                    };

                    request.onerror = reject;
                });
            });
    }

    function putToDb(key, value) {
        return getNewTransaction('readwrite')
            .then(store => store.put({key, value}))
            .then(request => convertToPromise(request));
    }

    function deleteFromDb(key) {
        return getNewTransaction('readwrite')
            .then(store => store.delete(key))
            .then(request => convertToPromise(request));
    }

    function clearDb() {
        return getNewTransaction('readwrite')
            .then(store => store.clear())
            .then(request => convertToPromise(request));
    }

    function convertToPromise(eventTarget) {
        return new Promise((resolve, reject) => {
            eventTarget.onsuccess = () => resolve(eventTarget.result);
            eventTarget.onerror = reject;
        });
    }

    function convertResultsToHash(results) {
        return results.reduce((output, item) => {
            if (item) {
                output[item.key] = item.value;
            }
            return output;
        }, {});
    }
}());

/******************************************************************************/

/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2019-present Raymond Hill

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

// `webext` is a promisified api of `chrome`. Entries are added as
// the promisification of uBO progress.

const webext = {    // jshint ignore:line
    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage
    storage: {
        // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local
        local: {
            clear: function() {
                return new Promise((resolve, reject) => {
                    chrome.storage.local.clear(( ) => {
                        const lastError = chrome.runtime.lastError;
                        if ( lastError instanceof Object ) {
                            return reject(lastError.message);
                        }
                        resolve();
                    });
                });
            },
            get: function() {
                return new Promise((resolve, reject) => {
                    chrome.storage.local.get(...arguments, result => {
                        const lastError = chrome.runtime.lastError;
                        if ( lastError instanceof Object ) {
                            return reject(lastError.message);
                        }
                        resolve(result);
                    });
                });
            },
            getBytesInUse: function() {
                return new Promise((resolve, reject) => {
                    chrome.storage.local.getBytesInUse(...arguments, result => {
                        const lastError = chrome.runtime.lastError;
                        if ( lastError instanceof Object ) {
                            return reject(lastError.message);
                        }
                        resolve(result);
                    });
                });
            },
            remove: function() {
                return new Promise((resolve, reject) => {
                    chrome.storage.local.remove(...arguments, ( ) => {
                        const lastError = chrome.runtime.lastError;
                        if ( lastError instanceof Object ) {
                            return reject(lastError.message);
                        }
                        resolve();
                    });
                });
            },
            set: function() {
                return new Promise((resolve, reject) => {
                    chrome.storage.local.set(...arguments, ( ) => {
                        const lastError = chrome.runtime.lastError;
                        if ( lastError instanceof Object ) {
                            return reject(lastError.message);
                        }
                        resolve();
                    });
                });
            },
        },
    },
    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs
    tabs: {
        get: function() {
            return new Promise(resolve => {
                chrome.tabs.get(...arguments, tab => {
                    void chrome.runtime.lastError;
                    resolve(tab instanceof Object ? tab : null);
                });
            });
        },
        executeScript: function() {
            return new Promise(resolve => {
                chrome.tabs.executeScript(...arguments, result => {
                    void chrome.runtime.lastError;
                    resolve(result);
                });
            });
        },
        insertCSS: function() {
            return new Promise(resolve => {
                chrome.tabs.insertCSS(...arguments, ( ) => {
                    void chrome.runtime.lastError;
                    resolve();
                });
            });
        },
        query: function() {
            return new Promise(resolve => {
                chrome.tabs.query(...arguments, tabs => {
                    void chrome.runtime.lastError;
                    resolve(Array.isArray(tabs) ? tabs : []);
                });
            });
        },
        update: function() {
            return new Promise(resolve => {
                chrome.tabs.update(...arguments, tab => {
                    void chrome.runtime.lastError;
                    resolve(tab instanceof Object ? tab : null);
                });
            });
        },
    },
    // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows
    windows: {
        get: function() {
            return new Promise(resolve => {
                chrome.windows.get(...arguments, win => {
                    void chrome.runtime.lastError;
                    resolve(win instanceof Object ? win : null);
                });
            });
        },
        create: function() {
            return new Promise(resolve => {
                chrome.windows.create(...arguments, win => {
                    void chrome.runtime.lastError;
                    resolve(win instanceof Object ? win : null);
                });
            });
        },
        update: function() {
            return new Promise(resolve => {
                chrome.windows.update(...arguments, win => {
                    void chrome.runtime.lastError;
                    resolve(win instanceof Object ? win : null);
                });
            });
        },
    },
};

// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync
if ( chrome.storage.sync instanceof Object ) {
    webext.storage.sync = {
        QUOTA_BYTES: chrome.storage.sync.QUOTA_BYTES,
        QUOTA_BYTES_PER_ITEM: chrome.storage.sync.QUOTA_BYTES_PER_ITEM,
        MAX_ITEMS: chrome.storage.sync.MAX_ITEMS,
        MAX_WRITE_OPERATIONS_PER_HOUR: chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR,
        MAX_WRITE_OPERATIONS_PER_MINUTE: chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE,

        clear: function() {
            return new Promise((resolve, reject) => {
                chrome.storage.sync.clear(( ) => {
                    const lastError = chrome.runtime.lastError;
                    if ( lastError instanceof Object ) {
                        return reject(lastError.message);
                    }
                    resolve();
                });
            });
        },
        get: function() {
            return new Promise((resolve, reject) => {
                chrome.storage.sync.get(...arguments, result => {
                    const lastError = chrome.runtime.lastError;
                    if ( lastError instanceof Object ) {
                        return reject(lastError.message);
                    }
                    resolve(result);
                });
            });
        },
        getBytesInUse: function() {
            return new Promise((resolve, reject) => {
                chrome.storage.sync.getBytesInUse(...arguments, result => {
                    const lastError = chrome.runtime.lastError;
                    if ( lastError instanceof Object ) {
                        return reject(lastError.message);
                    }
                    resolve(result);
                });
            });
        },
        remove: function() {
            return new Promise((resolve, reject) => {
                chrome.storage.sync.remove(...arguments, ( ) => {
                    const lastError = chrome.runtime.lastError;
                    if ( lastError instanceof Object ) {
                        return reject(lastError.message);
                    }
                    resolve();
                });
            });
        },
        set: function() {
            return new Promise((resolve, reject) => {
                chrome.storage.sync.set(...arguments, ( ) => {
                    const lastError = chrome.runtime.lastError;
                    if ( lastError instanceof Object ) {
                        return reject(lastError.message);
                    }
                    resolve();
                });
            });
        },
    };
}

// https://bugs.chromium.org/p/chromium/issues/detail?id=608854
if ( chrome.tabs.removeCSS instanceof Function ) {
    webext.tabs.removeCSS = function() {
        return new Promise(resolve => {
            chrome.tabs.removeCSS(...arguments, ( ) => {
                void chrome.runtime.lastError;
                resolve();
            });
        });
    };
}

// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/managed
if ( chrome.storage.managed instanceof Object ) {
    webext.storage.managed = {
        get: function() {
            return new Promise((resolve, reject) => {
                chrome.storage.local.get(...arguments, result => {
                    const lastError = chrome.runtime.lastError;
                    if ( lastError instanceof Object ) {
                        return reject(lastError.message);
                    }
                    resolve(result);
                });
            });
        },
    };
}

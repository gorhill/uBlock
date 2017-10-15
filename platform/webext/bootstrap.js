/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2017 The uBlock Origin authors

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

/* exported startup, shutdown, install, uninstall */

'use strict';

/******************************************************************************/

const hostName = 'ublock0';

/******************************************************************************/

function startup({ webExtension }, reason) {
    webExtension.startup(reason).then(api => {
        let { browser } = api,
            storageMigrator;
        let onMessage = function(message, sender, callback) {
            if ( message.what === 'webext:storageMigrateNext' ) {
                storageMigrator = storageMigrator || getStorageMigrator();
                storageMigrator.getNext((key, value) => {
                    if ( key === undefined ) {
                        storageMigrator.markAsDone();
                        storageMigrator = undefined;
                        browser.runtime.onMessage.removeListener(onMessage);
                    }
                    callback({ key: key, value: JSON.stringify(value) });
                });
                return true;
            }
            if ( message.what === 'webext:storageMigrateDone' ) {
                browser.runtime.onMessage.removeListener(onMessage);
            }
            if ( typeof callback === 'function' ) {
                callback();
            }
        };
        browser.runtime.onMessage.addListener(onMessage);
    });
}

function shutdown() {
}

function install() {
}

function uninstall() {
}

/******************************************************************************/

var getStorageMigrator = function() {
    var db = null;
    var dbOpenError = '';

    var close = function() {
        if ( db !== null ) {
            db.asyncClose();
        }
        db = null;
    };

    var open = function() {
        if ( db !== null ) {
            return db;
        }

        // Create path
        var { Services } = Components.utils.import('resource://gre/modules/Services.jsm', null),
            path = Services.dirsvc.get('ProfD', Components.interfaces.nsIFile);
        path.append('extension-data');
        path.append(hostName + '.sqlite');
        if ( !path.exists() || !path.isFile() ) {
            return null;
        }

        // Open database.
        try {
            db = Services.storage.openDatabase(path);
            if ( db.connectionReady === false ) {
                db.asyncClose();
                db = null;
            }
        } catch (ex) {
            if ( dbOpenError === '' ) {
                dbOpenError = ex.name;
                if ( ex.name === 'NS_ERROR_FILE_CORRUPTED' ) {
                    close();
                }
            }
        }

        if ( db === null ) {
            return null;
        }

        // Since database could be opened successfully, reset error flag (its
        // purpose is to avoid spamming console with error messages).
        dbOpenError = '';

        return db;
    };

    // Execute a query
    var runStatement = function(stmt, callback) {
        var result = {};

        stmt.executeAsync({
            handleResult: function(rows) {
                if ( !rows || typeof callback !== 'function' ) {
                    return;
                }

                var row;

                while ( (row = rows.getNextRow()) ) {
                    // we assume that there will be two columns, since we're
                    // using it only for preferences
                    result[row.getResultByIndex(0)] = row.getResultByIndex(1);
                }
            },
            handleCompletion: function(reason) {
                if ( typeof callback === 'function' && reason === 0 ) {
                    callback(result);
                }
                result = null;
            },
            handleError: function(error) {
                // Caller expects an answer regardless of failure.
                if ( typeof callback === 'function' ) {
                    callback({});
                }
                result = null;
                // https://github.com/gorhill/uBlock/issues/1768
                // Error cases which warrant a removal of the SQL file, so far:
                // - SQLLite error 11 database disk image is malformed
                // Can't find doc on MDN about the type of error.result, so I
                // force a string comparison.
                if ( error.result.toString() === '11' ) {
                    close();
                }
            }
        });
    };

    var bindNames = function(stmt, names) {
        if ( Array.isArray(names) === false || names.length === 0 ) {
            return;
        }
        var params = stmt.newBindingParamsArray();
        var i = names.length, bp;
        while ( i-- ) {
            bp = params.newBindingParams();
            bp.bindByName('name', names[i]);
            params.addParams(bp);
        }
        stmt.bindParameters(params);
    };

    var read = function(details, callback) {
        if ( typeof callback !== 'function' ) {
            return;
        }

        var prepareResult = function(result) {
            var key;
            for ( key in result ) {
                if ( result.hasOwnProperty(key) === false ) {
                    continue;
                }
                result[key] = JSON.parse(result[key]);
            }
            if ( typeof details === 'object' && details !== null ) {
                for ( key in details ) {
                    if ( result.hasOwnProperty(key) === false ) {
                        result[key] = details[key];
                    }
                }
            }
            callback(result);
        };

        if ( open() === null ) {
            prepareResult({});
            return;
        }

        var names = [];
        if ( details !== null ) {
            if ( Array.isArray(details) ) {
                names = details;
            } else if ( typeof details === 'object' ) {
                names = Object.keys(details);
            } else {
                names = [details.toString()];
            }
        }

        var stmt;
        if ( names.length === 0 ) {
            stmt = db.createAsyncStatement('SELECT * FROM "settings"');
        } else {
            stmt = db.createAsyncStatement('SELECT * FROM "settings" WHERE "name" = :name');
            bindNames(stmt, names);
        }

        runStatement(stmt, prepareResult);
    };

    let allKeys;

    let readNext = function(key, callback) {
        if ( key === undefined ) {
            callback();
            return;
        }
        read(key, bin => {
            if ( bin instanceof Object && bin.hasOwnProperty(key) ) {
                callback(key, bin[key]);
            } else {
                callback(key);
            }
        });
    };

    let getNext = function(callback) {
        if ( Array.isArray(allKeys) ) {
            readNext(allKeys.pop(), callback);
            return;
        }
        if ( open() === null ) {
            callback();
            return;
        }
        let stmt = db.createAsyncStatement('SELECT "name",\'dummy\' FROM "settings"');
        runStatement(stmt, result => {
            allKeys = [];
            for ( let key in result ) {
                if ( result.hasOwnProperty(key) ) {
                    allKeys.push(key);
                }
            }
            readNext(allKeys.pop(), callback);
        });
    };

    let markAsDone = function() {
        close();
    };

    return {
        getNext: getNext,
        markAsDone: markAsDone,
    };
};

/******************************************************************************/

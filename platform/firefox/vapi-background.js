/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
    Copyright (C) 2014 The µBlock authors

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

/* global Services */

// For background page

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu['import']('resource://gre/modules/Services.jsm');

/******************************************************************************/

self.vAPI = self.vAPI || {};

vAPI.firefox = true;

/******************************************************************************/

var SQLite = {
    open: function() {
        var path = Services.dirsvc.get('ProfD', Ci.nsIFile);
        path.append('extension-data');

        if (!path.exists()) {
            path.create(Ci.nsIFile.DIRECTORY_TYPE, parseInt('0774', 8));
        }

        if (!path.isDirectory()) {
            throw Error('Should be a directory...');
        }

        path.append('uBlock.sqlite');
        this.db = Services.storage.openDatabase(path);
        this.db.executeSimpleSQL(
            'CREATE TABLE IF NOT EXISTS settings' +
            '(name TEXT PRIMARY KEY NOT NULL, value TEXT);'
        );
    },
    close: function() {
        this.run('VACUUM');
        this.db.asyncClose();
    },
    run: function(query, values, callback) {
        if (!this.db) {
            this.open();
        }

        var result = {};

        query = this.db.createAsyncStatement(query);

        if (Array.isArray(values) && values.length) {
            var i = values.length;

            while (i--) {
                query.bindByIndex(i, values[i]);
            }
        }

        query.executeAsync({
            handleResult: function(rows) {
                if (!rows || typeof callback !== 'function') {
                    return;
                }

                var row;

                while (row = rows.getNextRow()) {
                    // we assume that there will be two columns, since we're
                    // using it only for preferences
                    result[row.getResultByIndex(0)] = row.getResultByIndex(1);
                }
            },
            handleCompletion: function(reason) {
                if (typeof callback === 'function' && reason === 0) {
                    callback(result);
                }
            },
            handleError: function(error) {
                console.error('SQLite error ', error.result, error.message);
            }
        });
    }
};

/******************************************************************************/

vAPI.storage = {
    QUOTA_BYTES: 100 * 1024 * 1024,
    sqlWhere: function(col, valNum) {
        if (valNum > 0) {
            valNum = Array(valNum + 1).join('?, ').slice(0, -2);
            return ' WHERE ' + col + ' IN (' + valNum + ')';
        }

        return '';
    },
    get: function(details, callback) {
        if (typeof callback !== 'function') {
            return;
        }

        var values = [], defaults = false;

        if (details !== null) {
            if (Array.isArray(details)) {
                values = details;
            }
            else if (typeof details === 'object') {
                defaults = true;
                values = Object.keys(details);
            }
            else {
                values = [details.toString()];
            }
        }

        SQLite.run(
            'SELECT * FROM settings' + this.sqlWhere('name', values.length),
            values,
            function(result) {
                var key;

                for (key in result) {
                    result[key] = JSON.parse(result[key]);
                }

                if (defaults) {
                    for (key in details) {
                        if (!result[key]) {
                            result[key] = details[key];
                        }
                    }
                }

                callback(result);
            }
        );
    },
    set: function(details, callback) {
        var key, values = [], questionmarks = [];

        for (key in details) {
            values.push(key);
            values.push(JSON.stringify(details[key]));
            questionmarks.push('?, ?');
        }

        if (!values.length) {
            return;
        }

        SQLite.run(
            'INSERT OR REPLACE INTO settings (name, value) SELECT ' +
                questionmarks.join(' UNION SELECT '),
            values,
            callback
        );
    },
    remove: function(keys, callback) {
        if (typeof keys === 'string') {
            keys = [keys];
        }

        SQLite.run(
            'DELETE FROM settings' + this.sqlWhere('name', keys.length),
            keys,
            callback
        );
    },
    clear: function(callback) {
        SQLite.run('DELETE FROM settings', null, callback);
        SQLite.run('VACUUM');
    },
    getBytesInUse: function(keys, callback) {
        if (typeof callback !== 'function') {
            return;
        }

        SQLite.run(
            "SELECT 'size' AS size, SUM(LENGTH(value)) FROM settings" +
                this.sqlWhere('name', Array.isArray(keys) ? keys.length : 0),
            keys,
            function(result) {
                callback(result.size);
            }
        );
    }
};

/******************************************************************************/

vAPI.messaging = {
    gmm: Cc['@mozilla.org/globalmessagemanager;1'].getService(Ci.nsIMessageListenerManager),
    frameScript: 'chrome://ublock/content/frameScript.js',
    listeners: {},
    defaultHandler: null,
    NOOPFUNC: function(){},
    UNHANDLED: 'vAPI.messaging.notHandled'
};

/******************************************************************************/

vAPI.messaging.gmm.loadFrameScript(vAPI.messaging.frameScript, true);

/******************************************************************************/

vAPI.messaging.listen = function(listenerName, callback) {
    this.listeners[listenerName] = callback;
};

/******************************************************************************/

vAPI.messaging.onMessage = function(request) {
    var messageManager = request.target.messageManager;
    var listenerId = request.data.portName.split('|');
    var portName = listenerId[1];
    listenerId = listenerId[0];

    var callback = vAPI.messaging.NOOPFUNC;
    if ( request.data.requestId !== undefined ) {
        callback = function(response) {
            messageManager.sendAsyncMessage(
                listenerId,
                JSON.stringify({
                    requestId: request.data.requestId,
                    portName: portName,
                    msg: response !== undefined ? response : null
                })
            );
        };
    }

    // TODO:
    var sender = {
        tab: {
            id: 0
        }
    };

    // Specific handler
    var r = vAPI.messaging.UNHANDLED;
    var listener = vAPI.messaging.listeners[portName];
    if ( typeof listener === 'function' ) {
        r = listener(request.data.msg, sender, callback);
    }
    if ( r !== vAPI.messaging.UNHANDLED ) {
        return;
    }

    // Default handler
    r = vAPI.messaging.defaultHandler(request.data.msg, sender, callback);
    if ( r !== vAPI.messaging.UNHANDLED ) {
        return;
    }

    console.error('µBlock> messaging > unknown request: %o', request.data);

    // Unhandled:
    // Need to callback anyways in case caller expected an answer, or
    // else there is a memory leak on caller's side
    callback();
};

/******************************************************************************/

vAPI.messaging.setup = function(defaultHandler) {
    // Already setup?
    if ( this.defaultHandler !== null ) {
        return;
    }

    if ( typeof defaultHandler !== 'function' ) {
        defaultHandler = function(){ return vAPI.messaging.UNHANDLED; };
    }
    this.defaultHandler = defaultHandler;

    this.gmm.addMessageListener(vAPI.app.name + ':background', this.onMessage);
};

/******************************************************************************/

vAPI.messaging.broadcast = function(message) {
    this.gmm.broadcastAsyncMessage(
        vAPI.app.name + ':broadcast',
        JSON.stringify({broadcast: true, msg: message})
    );
};

/******************************************************************************/

vAPI.lastError = function() {
    return null;
};

/******************************************************************************/

// clean up when the extension is disabled

window.addEventListener('unload', function() {
    SQLite.close();
    vAPI.messaging.gmm.removeMessageListener(
        vAPI.app.name + ':background',
        vAPI.messaging.postMessage
    );
    vAPI.messaging.gmm.removeDelayedFrameScript(vAPI.messaging.frameScript);

    // close extension tabs
    var enumerator = Services.wm.getEnumerator('navigator:browser');
    var host = 'ublock';
    var gBrowser, tabs, i, extURI;

    while (enumerator.hasMoreElements()) {
        gBrowser = enumerator.getNext().gBrowser;
        tabs = gBrowser.tabs;
        i = tabs.length;

        while (i--) {
            extURI = tabs[i].linkedBrowser.currentURI;

            if (extURI.scheme === 'chrome' && extURI.host === host) {
                gBrowser.removeTab(tabs[i]);
            }
        }
    }
});

/******************************************************************************/

})();

/******************************************************************************/

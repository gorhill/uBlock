/*******************************************************************************

    uBlock - a browser extension to block requests.
    Copyright (C) 2015 Raymond Hill

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

/* global µBlock */

/******************************************************************************/

µBlock.staticFilteringReverseLookup = (function() {

'use strict';

/******************************************************************************/

var worker = null;
var workerTTL = 11 * 60 * 1000;
var workerTTLTimer = null;
var needLists = true;
var messageId = 1;
var pendingResponses = Object.create(null);

/******************************************************************************/

var onWorkerMessage = function(e) {
    var msg = e.data;
    var callback = pendingResponses[msg.id];
    delete pendingResponses[msg.id];
    callback(msg.response);
};

/******************************************************************************/

var stopWorker = function() {
    workerTTLTimer = null;
    if ( worker === null ) {
        return;
    }
    worker.terminate();
    worker = null;
    needLists = true;
    pendingResponses = Object.create(null);
};

/******************************************************************************/

var initWorker = function(callback) {
    if ( worker === null ) {
        worker = new Worker('js/reverselookup-worker.js');
        worker.onmessage = onWorkerMessage;
    }

    if ( needLists === false ) {
        callback();
        return;
    }

    needLists = false;

    var entries = Object.create(null);
    var countdown = 0;
    var path, entry;

    var onListLoaded = function(details) {
        var entry = entries[details.path];
        worker.postMessage({
            what: 'setList',
            details: {
                path: details.path,
                title: entry.title || '',
                supportURL: entry.supportURL,
                content: details.content
            }
        });
        countdown -= 1;
        if ( countdown === 0 ) {
            callback();
        }
    };

    var µb = µBlock;

    for ( path in µb.remoteBlacklists ) {
        if ( µb.remoteBlacklists.hasOwnProperty(path) === false ) {
            continue;
        }
        entry = µb.remoteBlacklists[path];
        if ( entry.off === true ) {
            continue;
        }
        entries[path] = {
            title: entry.title,
            supportURL: entry.supportURL || ''
        };
        countdown += 1;
    }

    if ( countdown === 0 ) {
        callback();
        return;
    }

    for ( path in entries ) {
        µb.getCompiledFilterList(path, onListLoaded);
    }
};

/******************************************************************************/

var lookup = function(compiledFilter, callback) {
    if ( typeof callback !== 'function' ) {
        return;
    }

    if ( workerTTLTimer !== null ) {
        clearTimeout(workerTTLTimer);
        workerTTLTimer = null;
    }

    var onWorkerReady = function() {
        var id = messageId++;
        var message = {
            what: 'reverseLookup',
            id: id,
            filter: compiledFilter
        };
        pendingResponses[id] = callback;
        worker.postMessage(message);

        // The worker will be shutdown after n minutes without being used.
        workerTTLTimer = vAPI.setTimeout(stopWorker, workerTTL);
    };

    initWorker(onWorkerReady);
};

/******************************************************************************/

// This tells the worker that filter lists may have changed.

var resetLists = function() {
    needLists = true;
    if ( worker === null ) {
        return;
    }
    worker.postMessage({ what: 'resetLists' });
};

/******************************************************************************/

return {
    lookup: lookup,
    resetLists: resetLists,
    shutdown: stopWorker
};

/******************************************************************************/

})();

/******************************************************************************/

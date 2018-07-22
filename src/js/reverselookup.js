/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2015-present Raymond Hill

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

µBlock.staticFilteringReverseLookup = (function() {

/******************************************************************************/

var worker = null;
var workerTTL = 5 * 60 * 1000;
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

    var onListLoaded = function(details) {
        var entry = entries[details.assetKey];

        // https://github.com/gorhill/uBlock/issues/536
        // Use assetKey when there is no filter list title.

        worker.postMessage({
            what: 'setList',
            details: {
                assetKey: details.assetKey,
                title: entry.title || details.assetKey,
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
    var listKey, entry;

    for ( listKey in µb.availableFilterLists ) {
        if ( µb.availableFilterLists.hasOwnProperty(listKey) === false ) {
            continue;
        }
        entry = µb.availableFilterLists[listKey];
        if ( entry.off === true ) { continue; }
        entries[listKey] = {
            title: listKey !== µb.userFiltersPath ?
                entry.title :
                vAPI.i18n('1pPageName'),
            supportURL: entry.supportURL || ''
        };
        countdown += 1;
    }

    if ( countdown === 0 ) {
        callback();
        return;
    }

    for ( listKey in entries ) {
        µb.getCompiledFilterList(listKey, onListLoaded);
    }
};

/******************************************************************************/

var fromNetFilter = function(compiledFilter, rawFilter, callback) {
    if ( typeof callback !== 'function' ) {
        return;
    }

    if ( compiledFilter === '' || rawFilter === '' ) {
        callback();
        return;
    }

    if ( workerTTLTimer !== null ) {
        clearTimeout(workerTTLTimer);
        workerTTLTimer = null;
    }

    var onWorkerReady = function() {
        var id = messageId++;
        var message = {
            what: 'fromNetFilter',
            id: id,
            compiledFilter: compiledFilter,
            rawFilter: rawFilter
        };
        pendingResponses[id] = callback;
        worker.postMessage(message);

        // The worker will be shutdown after n minutes without being used.
        workerTTLTimer = vAPI.setTimeout(stopWorker, workerTTL);
    };

    initWorker(onWorkerReady);
};

/******************************************************************************/

var fromCosmeticFilter = function(details, callback) {
    if ( typeof callback !== 'function' ) { return; }

    if ( details.rawFilter === '' ) {
        callback();
        return;
    }

    if ( workerTTLTimer !== null ) {
        clearTimeout(workerTTLTimer);
        workerTTLTimer = null;
    }

    let onWorkerReady = function() {
        let id = messageId++;
        let hostname = µBlock.URI.hostnameFromURI(details.url);
        pendingResponses[id] = callback;
        worker.postMessage({
            what: 'fromCosmeticFilter',
            id: id,
            domain: µBlock.URI.domainFromHostname(hostname),
            hostname: hostname,
            ignoreGeneric: µBlock.staticNetFilteringEngine
                                 .matchStringGenericHide(details.url) === 2,
            rawFilter: details.rawFilter
        });

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
    fromNetFilter: fromNetFilter,
    fromCosmeticFilter: fromCosmeticFilter,
    resetLists: resetLists,
    shutdown: stopWorker
};

/******************************************************************************/

})();

/******************************************************************************/

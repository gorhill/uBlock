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

import staticNetFilteringEngine from './static-net-filtering.js';
import µb from './background.js';
import { CompiledListWriter } from './static-filtering-io.js';
import { StaticFilteringParser } from './static-filtering-parser.js';

import {
    domainFromHostname,
    hostnameFromURI,
} from './uri-utils.js';

/******************************************************************************/

const workerTTL = 5 * 60 * 1000;
const pendingResponses = new Map();

let worker = null;
let workerTTLTimer;
let needLists = true;
let messageId = 1;

const onWorkerMessage = function(e) {
    const msg = e.data;
    const resolver = pendingResponses.get(msg.id);
    pendingResponses.delete(msg.id);
    resolver(msg.response);
};

const stopWorker = function() {
    if ( workerTTLTimer !== undefined ) {
        clearTimeout(workerTTLTimer);
        workerTTLTimer = undefined;
    }
    if ( worker === null ) { return; }
    worker.terminate();
    worker = null;
    needLists = true;
    for ( const resolver of pendingResponses.values() ) {
        resolver();
    }
    pendingResponses.clear();
};

const initWorker = function() {
    if ( worker === null ) {
        worker = new Worker('js/reverselookup-worker.js');
        worker.onmessage = onWorkerMessage;
    }

    // The worker will be shutdown after n minutes without being used.
    if ( workerTTLTimer !== undefined ) {
        clearTimeout(workerTTLTimer);
    }
    workerTTLTimer = vAPI.setTimeout(stopWorker, workerTTL);

    if ( needLists === false ) {
        return Promise.resolve();
    }
    needLists = false;

    const entries = new Map();

    const onListLoaded = function(details) {
        const entry = entries.get(details.assetKey);

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
    };

    for ( const listKey in µb.availableFilterLists ) {
        if ( µb.availableFilterLists.hasOwnProperty(listKey) === false ) {
            continue;
        }
        const entry = µb.availableFilterLists[listKey];
        if ( entry.off === true ) { continue; }
        entries.set(listKey, {
            title: listKey !== µb.userFiltersPath ?
                entry.title :
                vAPI.i18n('1pPageName'),
            supportURL: entry.supportURL || ''
        });
    }
    if ( entries.size === 0 ) {
        return Promise.resolve();
    }

    const promises = [];
    for ( const listKey of entries.keys() ) {
        promises.push(
            µb.getCompiledFilterList(listKey).then(details => {
                onListLoaded(details);
            })
        );
    }
    return Promise.all(promises);
};

const fromNetFilter = async function(rawFilter) {
    if ( typeof rawFilter !== 'string' || rawFilter === '' ) { return; }

    const writer = new CompiledListWriter();
    const parser = new StaticFilteringParser();
    parser.setMaxTokenLength(staticNetFilteringEngine.MAX_TOKEN_LENGTH);
    parser.analyze(rawFilter);

    const compiler = staticNetFilteringEngine.createCompiler(parser);
    if ( compiler.compile(writer) === false ) { return; }

    await initWorker();

    const id = messageId++;
    worker.postMessage({
        what: 'fromNetFilter',
        id: id,
        compiledFilter: writer.last(),
        rawFilter: rawFilter
    });

    return new Promise(resolve => {
        pendingResponses.set(id, resolve);
    });
};

const fromCosmeticFilter = async function(details) {
    if (
        typeof details.rawFilter !== 'string' ||
        details.rawFilter === ''
    ) {
        return;
    }

    await initWorker();

    const id = messageId++;
    const hostname = hostnameFromURI(details.url);

    worker.postMessage({
        what: 'fromCosmeticFilter',
        id: id,
        domain: domainFromHostname(hostname),
        hostname: hostname,
        ignoreGeneric:
            staticNetFilteringEngine.matchRequestReverse(
                'generichide',
                details.url
            ) === 2,
        ignoreSpecific:
            staticNetFilteringEngine.matchRequestReverse(
                'specifichide',
                details.url
            ) === 2,
        rawFilter: details.rawFilter
    });

    return new Promise(resolve => {
        pendingResponses.set(id, resolve);
    });
};

// This tells the worker that filter lists may have changed.

const resetLists = function() {
    needLists = true;
    if ( worker === null ) { return; }
    worker.postMessage({ what: 'resetLists' });
};

/******************************************************************************/

const staticFilteringReverseLookup = {
    fromNetFilter,
    fromCosmeticFilter,
    resetLists,
    shutdown: stopWorker
};

export default staticFilteringReverseLookup;

/******************************************************************************/

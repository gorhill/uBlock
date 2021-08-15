/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-present Raymond Hill

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

/* eslint-disable-next-line no-redeclare */
/* globals process */

'use strict';

/******************************************************************************/

import { strict as assert } from 'assert';
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

import { enableWASM, StaticNetFilteringEngine } from './index.js';

/******************************************************************************/

const FLAGS = process.argv.slice(2);
const COMPARE = FLAGS.includes('compare');
const MAXCOST = FLAGS.includes('maxcost');
const MINCOST = FLAGS.includes('mincost');
const RECORD = FLAGS.includes('record');
const WASM = FLAGS.includes('wasm');
const NEED_RESULTS = COMPARE || MAXCOST || MINCOST || RECORD;

/******************************************************************************/

function nanoToMilli(bigint) {
    return (Number(bigint) / 1000000).toFixed(2) + ' ms';
}

function nanoToMicro(bigint) {
    return (Number(bigint) / 1000).toFixed(2) + ' µs';
}

async function read(path) {
    return readFileSync(resolve(__dirname, path), 'utf8');
}

async function write(path, data) {
    return writeFileSync(resolve(__dirname, path), data, 'utf8');
}

/******************************************************************************/

async function compare(results) {
    let before;
    try {
        const raw = await read('data/snfe.json');
        before = new Map(JSON.parse(raw));
    } catch(ex) {
        console.log(ex);
        console.log('Nothing to compare');
        return;
    }
    const after = new Map(results);
    const diffs = [];
    for ( let i = 0; i < results.length; i++ ) {
        const a = before.get(i);
        const b = after.get(i);
        if ( a.r === b.r ) { continue; }
        diffs.push([ i, { before: a, after: b } ]);
    }
    return diffs;
}

/******************************************************************************/

async function bench() {
    if ( WASM ) {
        try {
            const result = await enableWASM();
            if ( result === true ) {
                console.log('WASM code paths enabled');
            }
        } catch(ex) {
            console.log(ex);
        }
    }

    // This maps puppeteer types to WebRequest types
    const WEBREQUEST_OPTIONS = {
        // Consider document requests as sub_document. This is because the request
        // dataset does not contain sub_frame or main_frame but only 'document' and
        // different blockers have different behaviours.
        document: 'sub_frame',
        stylesheet: 'stylesheet',
        image: 'image',
        media: 'media',
        font: 'font',
        script: 'script',
        xhr: 'xmlhttprequest',
        fetch: 'xmlhttprequest',
        websocket: 'websocket',
        ping: 'ping',
        // other
        other: 'other',
        eventsource: 'other',
        manifest: 'other',
        texttrack: 'other',
    };

    const require = createRequire(import.meta.url); // jshint ignore:line
    const requests = await require('./node_modules/scaling-palm-tree/requests.json');
    const engine = await StaticNetFilteringEngine.create();

    let start = process.hrtime.bigint();
    await engine.useLists([
        read('assets/ublock/badware.txt')
            .then(raw => ({ name: 'badware', raw })),
        read('assets/ublock/filters.txt')
            .then(raw => ({ name: 'filters', raw })),
        read('assets/ublock/filters-2020.txt')
            .then(raw => ({ name: 'filters-2020', raw })),
        read('assets/ublock/filters-2021.txt')
            .then(raw => ({ name: 'filters-2021', raw })),
        read('assets/ublock/privacy.txt')
            .then(raw => ({ name: 'privacy', raw })),
        read('assets/ublock/resource-abuse.txt')
            .then(raw => ({ name: 'resource-abuse', raw })),
        read('assets/ublock/unbreak.txt')
            .then(raw => ({ name: 'unbreak.txt', raw })),
        read('assets/thirdparties/easylist-downloads.adblockplus.org/easylist.txt')
            .then(raw => ({ name: 'easylist', raw })),
        read('assets/thirdparties/easylist-downloads.adblockplus.org/easyprivacy.txt')
            .then(raw => ({ name: 'easyprivacy', raw })),
        read('assets/thirdparties/pgl.yoyo.org/as/serverlist')
            .then(raw => ({ name: 'PGL', raw })),
        read('assets/thirdparties/urlhaus-filter/urlhaus-filter-online.txt')
            .then(raw => ({ name: 'urlhaus', raw })),
    ]);
    let stop = process.hrtime.bigint();
    console.log(`Filter lists parsed-compiled-loaded in ${nanoToMilli(stop - start)}`);

    const details = {
        r: 0,
        f: undefined,
        type: '',
        url: '',
        originURL: '',
        t: 0,
    };

    // Dry run to let JS engine optimize hot JS code paths
    for ( let i = 0; i < requests.length; i++ ) {
        const request = requests[i];
        details.type = WEBREQUEST_OPTIONS[request.cpt];
        details.url = request.url;
        details.originURL = request.frameUrl;
        void engine.matchRequest(details);
    }

    const results = [];
    let notBlockedCount = 0;
    let blockedCount = 0;
    let unblockedCount = 0;

    start = process.hrtime.bigint();
    for ( let i = 0; i < requests.length; i++ ) {
        const request = requests[i];
        const reqstart = process.hrtime.bigint();
        details.type = WEBREQUEST_OPTIONS[request.cpt];
        details.url = request.url;
        details.originURL = request.frameUrl;
        const r = engine.matchRequest(details);
        if ( r === 0 ) {
            notBlockedCount += 1;
        } else if ( r === 1 ) {
            blockedCount += 1;
        } else {
            unblockedCount += 1;
        }
        if ( NEED_RESULTS !== true ) { continue; }
        const reqstop = process.hrtime.bigint();
        details.r = r;
        details.f = r !== 0 ? engine.toLogData().raw : undefined;
        details.t = Math.round(Number(reqstop - reqstart) / 10) / 100;
        results.push([ i, Object.assign({}, details) ]);
    }
    stop = process.hrtime.bigint();

    console.log(`Matched ${requests.length} requests in ${nanoToMilli(stop - start)}`);
    console.log(`\tNot blocked: ${notBlockedCount} requests`);
    console.log(`\tBlocked: ${blockedCount} requests`);
    console.log(`\tUnblocked: ${unblockedCount} requests`);
    console.log(`\tAverage: ${nanoToMicro((stop - start) / BigInt(requests.length))} per request`);

    if ( RECORD ) {
        write('data/snfe.json', JSON.stringify(results, null, 2));
    }

    if ( COMPARE ) {
        const diffs = await compare(results);
        if ( Array.isArray(diffs) ) {
            write('data/snfe.diffs.json', JSON.stringify(diffs, null, 2));
        }
        console.log(`Compare: ${diffs.length} requests differ`);
    }

    if ( MAXCOST ) {
        const costly = results.sort((a,b) => b[1].t - a[1].t).slice(0, 100);
        write('data/snfe.maxcost.json', JSON.stringify(costly, null, 2));
    }

    if ( MINCOST ) {
        const costly = results.sort((a,b) => a[1].t - b[1].t).slice(0, 100);
        write('data/snfe.mincost.json', JSON.stringify(costly, null, 2));
    }

    StaticNetFilteringEngine.release();
}

bench();

/******************************************************************************/

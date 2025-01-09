/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
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

/* globals process */

import { StaticNetFilteringEngine, enableWASM } from './index.js';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { createRequire } from 'module';
import { dirname } from 'path';

/******************************************************************************/

const FLAGS = process.argv.slice(2);
const COMPARE = FLAGS.includes('compare');
const MAXCOST = FLAGS.includes('maxcost');
const MEDCOST = FLAGS.includes('medcost');
const MINCOST = FLAGS.includes('mincost');
const MODIFIERS = FLAGS.includes('modifiers');
const RECORD = FLAGS.includes('record');
const WASM = FLAGS.includes('wasm');
const NEED_RESULTS = COMPARE || MAXCOST || MEDCOST || MINCOST || RECORD;

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

/******************************************************************************/

function nanoToMilli(bigint) {
    return (Number(bigint) / 1000000).toFixed(2) + ' ms';
}

function nanoToMicro(bigint) {
    return (Number(bigint) / 1000).toFixed(2) + ' µs';
}

async function read(path) {
    return readFile(path, 'utf8');
}

async function write(path, data) {
    await mkdir(dirname(path), { recursive: true });
    return writeFile(path, data, 'utf8');
}

/******************************************************************************/

async function matchRequests(engine, requests) {
    const results = [];
    const details = {
        r: 0,
        f: undefined,
        type: '',
        url: '',
        originURL: '',
        t: 0,
    };

    let notBlockedCount = 0;
    let blockedCount = 0;
    let unblockedCount = 0;

    const start = process.hrtime.bigint();

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

    const stop = process.hrtime.bigint();

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
        const costly = results.slice().sort((a,b) => b[1].t - a[1].t).slice(0, 1000);
        write('data/snfe.maxcost.json', JSON.stringify(costly, null, 2));
    }

    if ( MEDCOST ) {
        const median = results.length >>> 1;
        const costly = results.slice().sort((a,b) => b[1].t - a[1].t).slice(median - 500, median + 500);
        write('data/snfe.medcost.json', JSON.stringify(costly, null, 2));
    }

    if ( MINCOST ) {
        const costly = results.slice().sort((a,b) => b[1].t - a[1].t).slice(-1000);
        write('data/snfe.mincost.json', JSON.stringify(costly, null, 2));
    }
}

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
        diffs.push([ i, {
            type: a.type,
            url: a.url,
            originURL: a.originURL,
            before: { r: a.r, f: a.f, t: a.t },
            after: { r: b.r, f: b.f, t: b.t },
        }]);
    }
    return diffs;
}

/******************************************************************************/

async function matchRequestModifiers(engine, requests) {
    const results = {
        'csp': [],
        'redirect-rule': [],
        'removeparam': [],
    };

    const details = {
        f: undefined,
        type: '',
        url: '',
        originURL: '',
        t: 0,
    };

    let modifiedCount = 0;

    const start = process.hrtime.bigint();
    for ( let i = 0; i < requests.length; i++ ) {
        const request = requests[i];
        details.type = WEBREQUEST_OPTIONS[request.cpt];
        details.url = request.url;
        details.originURL = request.frameUrl;
        const r = engine.matchRequest(details);
        let modified = false;
        if ( r !== 1 && details.type === 'sub_frame' ) {
            const reqstart = process.hrtime.bigint();
            const directives = engine.matchAndFetchModifiers(details, 'csp');
            if ( directives !== undefined ) {
                modified = true;
                if ( NEED_RESULTS ) {
                    const reqstop = process.hrtime.bigint();
                    details.f = directives.map(a => `${a.result}:${a.logData().raw}`).sort();
                    details.t = Math.round(Number(reqstop - reqstart) / 10) / 100;
                    results['csp'].push([ i, Object.assign({}, details) ]);
                }
            }
        }
        if ( r === 1 ) {
            const reqstart = process.hrtime.bigint();
            const directives = engine.matchAndFetchModifiers(details, 'redirect-rule');
            if ( directives !== undefined ) {
                modified = true;
                if ( NEED_RESULTS ) {
                    const reqstop = process.hrtime.bigint();
                    details.f = directives.map(a => `${a.result}:${a.logData().raw}`).sort();
                    details.t = Math.round(Number(reqstop - reqstart) / 10) / 100;
                    results['redirect-rule'].push([ i, Object.assign({}, details) ]);
                }
            }
        }
        if ( r !== 1 && engine.hasQuery(details) ) {
            const reqstart = process.hrtime.bigint();
            const directives = engine.matchAndFetchModifiers(details, 'removeparam');
            if ( directives !== undefined ) {
                modified = true;
                if ( NEED_RESULTS ) {
                    const reqstop = process.hrtime.bigint();
                    details.f = directives.map(a => `${a.result}:${a.logData().raw}`).sort();
                    details.t = Math.round(Number(reqstop - reqstart) / 10) / 100;
                    results['removeparam'].push([ i, Object.assign({}, details) ]);
                }
            }
        }
        if ( modified ) {
            modifiedCount += 1;
        }
    }
    const stop = process.hrtime.bigint();

    console.log(`Matched-modified ${requests.length} requests in ${nanoToMilli(stop - start)}`);
    console.log(`\t${modifiedCount} modifiers found`);
    console.log(`\tAverage: ${nanoToMicro((stop - start) / BigInt(requests.length))} per request`);

    if ( RECORD ) {
        write('data/snfe.modifiers.json', JSON.stringify(results, null, 2));
    }

    if ( COMPARE ) {
        const diffs = await compareModifiers(results);
        if ( Array.isArray(diffs) ) {
            write('data/snfe.modifiers.diffs.json', JSON.stringify(diffs, null, 2));
        }
        console.log(`Compare: ${diffs.length} modified requests differ`);
    }
}

async function compareModifiers(afterResults) {
    let beforeResults;
    try {
        const raw = await read('data/snfe.modifiers.json');
        beforeResults = JSON.parse(raw);
    } catch(ex) {
        console.log(ex);
        console.log('Nothing to compare');
        return;
    }
    const diffs = [];
    for ( const modifier of [ 'csp', 'redirect-rule', 'removeparam' ] ) {
        const before = new Map(beforeResults[modifier]);
        const after = new Map(afterResults[modifier]);
        for ( const [ i, b ] of before ) {
            const a = after.get(i);
            if ( a !== undefined && JSON.stringify(a.f) === JSON.stringify(b.f) ) { continue; }
            diffs.push([ i, {
                type: b.type,
                url: b.url,
                originURL: b.originURL,
                before: { f: b.f, t: b.t },
                after: a !== undefined ? { f: a.f, t: a.t } : null,
            }]);
        }
        for ( const [ i, a ] of after ) {
            const b = before.get(i);
            if ( b !== undefined ) { continue; }
            diffs.push([ i, {
                type: a.type,
                url: a.url,
                originURL: a.originURL,
                before: null,
                after: { f: a.f, t: a.t },
            }]);
        }
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

    const require = createRequire(import.meta.url); // jshint ignore:line
    const requests = await require('./node_modules/scaling-palm-tree/requests.json');
    const engine = await StaticNetFilteringEngine.create();

    let start = process.hrtime.bigint();
    await engine.useLists([
        read('assets/ublock/filters.min.txt')
            .then(raw => ({ name: 'filters', raw })),
        read('assets/ublock/badware.txt')
            .then(raw => ({ name: 'badware', raw })),
        read('assets/ublock/privacy.min.txt')
            .then(raw => ({ name: 'privacy', raw })),
        read('assets/ublock/quick-fixes.txt')
            .then(raw => ({ name: 'quick-fixes.txt', raw })),
        read('assets/ublock/unbreak.txt')
            .then(raw => ({ name: 'unbreak.txt', raw })),
        read('assets/thirdparties/easylist/easylist.txt')
            .then(raw => ({ name: 'easylist', raw })),
        read('assets/thirdparties/easylist/easyprivacy.txt')
            .then(raw => ({ name: 'easyprivacy', raw })),
        read('assets/thirdparties/pgl.yoyo.org/as/serverlist')
            .then(raw => ({ name: 'PGL', raw })),
        read('assets/thirdparties/urlhaus-filter/urlhaus-filter-online.txt')
            .then(raw => ({ name: 'urlhaus', raw })),
    ]);
    let stop = process.hrtime.bigint();
    console.log(`Filter lists parsed-compiled-loaded in ${nanoToMilli(stop - start)}`);

    // Dry run to let JS engine optimize hot JS code paths
    for ( let i = 0; i < requests.length; i += 8 ) {
        const request = requests[i];
        void engine.matchRequest({
            type: WEBREQUEST_OPTIONS[request.cpt],
            url: request.url,
            originURL: request.frameUrl,
        });
    }

    if ( MODIFIERS === false ) {
        matchRequests(engine, requests);
    } else {
        matchRequestModifiers(engine, requests);
    }

    StaticNetFilteringEngine.release();
}

bench();

/******************************************************************************/

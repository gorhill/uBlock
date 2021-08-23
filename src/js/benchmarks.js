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

'use strict';

/******************************************************************************/

import cosmeticFilteringEngine from './cosmetic-filtering.js';
import io from './assets.js';
import scriptletFilteringEngine from './scriptlet-filtering.js';
import staticNetFilteringEngine from './static-net-filtering.js';
import µb from './background.js';
import { FilteringContext } from './filtering-context.js';
import { LineIterator } from './text-utils.js';
import { sessionFirewall } from './filtering-engines.js';

import {
    domainFromHostname,
    entityFromDomain,
    hostnameFromURI,
} from './uri-utils.js';

/******************************************************************************/

// The requests.json.gz file can be downloaded from:
//   https://cdn.cliqz.com/adblocking/requests_top500.json.gz
//
// Which is linked from:
//   https://whotracks.me/blog/adblockers_performance_study.html
//
// Copy the file into ./tmp/requests.json.gz
//
// If the file is present when you build uBO using `make-[target].sh` from
// the shell, the resulting package will have `./assets/requests.json`, which
// will be looked-up by the method below to launch a benchmark session.
//
// From uBO's dev console, launch the benchmark:
//   µBlock.staticNetFilteringEngine.benchmark();
//
// The usual browser dev tools can be used to obtain useful profiling
// data, i.e. start the profiler, call the benchmark method from the
// console, then stop the profiler when it completes.
//
// Keep in mind that the measurements at the blog post above where obtained
// with ONLY EasyList. The CPU reportedly used was:
//   https://www.cpubenchmark.net/cpu.php?cpu=Intel+Core+i7-6600U+%40+2.60GHz&id=2608
//
// Rename ./tmp/requests.json.gz to something else if you no longer want
// ./assets/requests.json in the build.

const loadBenchmarkDataset = (( ) => {
    let datasetPromise;
    let ttlTimer;

    return function() {
        if ( ttlTimer !== undefined ) {
            clearTimeout(ttlTimer);
            ttlTimer = undefined;
        }

        setTimeout(( ) => {
            ttlTimer = undefined;
            datasetPromise = undefined;
        }, 5 * 60 * 1000);

        if ( datasetPromise !== undefined ) {
            return datasetPromise;
        }

        const datasetURL = µb.hiddenSettings.benchmarkDatasetURL;
        if ( datasetURL === 'unset' ) {
            console.info(`No benchmark dataset available.`);
            return Promise.resolve();
        }
        console.info(`Loading benchmark dataset...`);
        datasetPromise = io.fetchText(datasetURL).then(details => {
            console.info(`Parsing benchmark dataset...`);
            const requests = [];
            const lineIter = new LineIterator(details.content);
            while ( lineIter.eot() === false ) {
                let request;
                try {
                    request = JSON.parse(lineIter.next());
                } catch(ex) {
                }
                if ( request instanceof Object === false ) { continue; }
                if ( !request.frameUrl || !request.url ) { continue; }
                if ( request.cpt === 'document' ) {
                    request.cpt = 'main_frame';
                } else if ( request.cpt === 'xhr' ) {
                    request.cpt = 'xmlhttprequest';
                }
                requests.push(request);
            }
            return requests;
        }).catch(details => {
            console.info(`Not found: ${details.url}`);
            datasetPromise = undefined;
        });

        return datasetPromise;
    };
})();

/******************************************************************************/

// action: 1=test

µb.benchmarkStaticNetFiltering = async function(options = {}) {
    const { target, redirectEngine } = options;

    const requests = await loadBenchmarkDataset();
    if ( Array.isArray(requests) === false || requests.length === 0 ) {
        const text = 'No dataset found to benchmark';
        console.info(text);
        return text;
    }

    console.info(`Benchmarking staticNetFilteringEngine.matchRequest()...`);

    const fctxt = new FilteringContext();

    if ( typeof target === 'number' ) {
        const request = requests[target];
        fctxt.setURL(request.url);
        fctxt.setDocOriginFromURL(request.frameUrl);
        fctxt.setType(request.cpt);
        const r = staticNetFilteringEngine.matchRequest(fctxt);
        console.info(`Result=${r}:`);
        console.info(`\ttype=${fctxt.type}`);
        console.info(`\turl=${fctxt.url}`);
        console.info(`\tdocOrigin=${fctxt.getDocOrigin()}`);
        if ( r !== 0 ) {
            console.info(staticNetFilteringEngine.toLogData());
        }
        return;
    }

    const t0 = performance.now();
    let matchCount = 0;
    let blockCount = 0;
    let allowCount = 0;
    for ( let i = 0; i < requests.length; i++ ) {
        const request = requests[i];
        fctxt.setURL(request.url);
        fctxt.setDocOriginFromURL(request.frameUrl);
        fctxt.setType(request.cpt);
        staticNetFilteringEngine.redirectURL = undefined;
        const r = staticNetFilteringEngine.matchRequest(fctxt);
        matchCount += 1;
        if ( r === 1 ) { blockCount += 1; }
        else if ( r === 2 ) { allowCount += 1; }
        if ( r !== 1 ) {
            if ( staticNetFilteringEngine.hasQuery(fctxt) ) {
                staticNetFilteringEngine.filterQuery(fctxt, 'queryprune');
            }
            if ( fctxt.type === 'main_frame' || fctxt.type === 'sub_frame' ) {
                staticNetFilteringEngine.matchAndFetchModifiers(fctxt, 'csp');
            }
            staticNetFilteringEngine.matchHeaders(fctxt, []);
        } else if ( redirectEngine !== undefined ) {
            staticNetFilteringEngine.redirectRequest(redirectEngine, fctxt);
        }
    }
    const t1 = performance.now();
    const dur = t1 - t0;

    const output = [
        'Benchmarked static network filtering engine:',
        `\tEvaluated ${matchCount} match calls in ${dur.toFixed(0)} ms`,
        `\tAverage: ${(dur / matchCount).toFixed(3)} ms per request`,
        `\tNot blocked: ${matchCount - blockCount - allowCount}`,
        `\tBlocked: ${blockCount}`,
        `\tUnblocked: ${allowCount}`,
    ];
    const s = output.join('\n');
    console.info(s);
    return s;
};

/******************************************************************************/

µb.tokenHistograms = async function() {
    const requests = await loadBenchmarkDataset();
    if ( Array.isArray(requests) === false || requests.length === 0 ) {
        console.info('No requests found to benchmark');
        return;
    }

    console.info(`Computing token histograms...`);

    const fctxt = new FilteringContext();
    const missTokenMap = new Map();
    const hitTokenMap = new Map();
    const reTokens = /[0-9a-z%]{2,}/g;

    for ( let i = 0; i < requests.length; i++ ) {
        const request = requests[i];
        fctxt.setURL(request.url);
        fctxt.setDocOriginFromURL(request.frameUrl);
        fctxt.setType(request.cpt);
        const r = staticNetFilteringEngine.matchRequest(fctxt);
        for ( let [ keyword ] of request.url.toLowerCase().matchAll(reTokens) ) {
            const token = keyword.slice(0, 7);
            if ( r === 0 ) {
                missTokenMap.set(token, (missTokenMap.get(token) || 0) + 1);
            } else if ( r === 1 ) {
                hitTokenMap.set(token, (hitTokenMap.get(token) || 0) + 1);
            }
        }
    }
    const customSort = (a, b) => b[1] - a[1];
    const topmisses = Array.from(missTokenMap).sort(customSort).slice(0, 100);
    for ( const [ token ] of topmisses ) {
        hitTokenMap.delete(token);
    }
    const tophits = Array.from(hitTokenMap).sort(customSort).slice(0, 100);
    console.info('Misses:', JSON.stringify(topmisses));
    console.info('Hits:', JSON.stringify(tophits));
};

/******************************************************************************/

µb.benchmarkDynamicNetFiltering = async function() {
    const requests = await loadBenchmarkDataset();
    if ( Array.isArray(requests) === false || requests.length === 0 ) {
        console.info('No requests found to benchmark');
        return;
    }
    console.info(`Benchmarking sessionFirewall.evaluateCellZY()...`);
    const fctxt = new FilteringContext();
    const t0 = performance.now();
    for ( const request of requests ) {
        fctxt.setURL(request.url);
        fctxt.setTabOriginFromURL(request.frameUrl);
        fctxt.setType(request.cpt);
        sessionFirewall.evaluateCellZY(
            fctxt.getTabHostname(),
            fctxt.getHostname(),
            fctxt.type
        );
    }
    const t1 = performance.now();
    const dur = t1 - t0;
    console.info(`Evaluated ${requests.length} requests in ${dur.toFixed(0)} ms`);
    console.info(`\tAverage: ${(dur / requests.length).toFixed(3)} ms per request`);
};

/******************************************************************************/

µb.benchmarkCosmeticFiltering = async function() {
    const requests = await loadBenchmarkDataset();
    if ( Array.isArray(requests) === false || requests.length === 0 ) {
        console.info('No requests found to benchmark');
        return;
    }
    console.info('Benchmarking cosmeticFilteringEngine.retrieveSpecificSelectors()...');
    const details = {
        tabId: undefined,
        frameId: undefined,
        hostname: '',
        domain: '',
        entity: '',
    };
    const options = {
        noSpecificCosmeticFiltering: false,
        noGenericCosmeticFiltering: false,
    };
    let count = 0;
    const t0 = performance.now();
    for ( let i = 0; i < requests.length; i++ ) {
        const request = requests[i];
        if ( request.cpt !== 'main_frame' ) { continue; }
        count += 1;
        details.hostname = hostnameFromURI(request.url);
        details.domain = domainFromHostname(details.hostname);
        details.entity = entityFromDomain(details.domain);
        void cosmeticFilteringEngine.retrieveSpecificSelectors(details, options);
    }
    const t1 = performance.now();
    const dur = t1 - t0;
    console.info(`Evaluated ${count} requests in ${dur.toFixed(0)} ms`);
    console.info(`\tAverage: ${(dur / count).toFixed(3)} ms per request`);
};

/******************************************************************************/

µb.benchmarkScriptletFiltering = async function() {
    const requests = await loadBenchmarkDataset();
    if ( Array.isArray(requests) === false || requests.length === 0 ) {
        console.info('No requests found to benchmark');
        return;
    }
    console.info('Benchmarking scriptletFilteringEngine.retrieve()...');
    const details = {
        domain: '',
        entity: '',
        hostname: '',
        tabId: 0,
        url: '',
    };
    let count = 0;
    const t0 = performance.now();
    for ( let i = 0; i < requests.length; i++ ) {
        const request = requests[i];
        if ( request.cpt !== 'main_frame' ) { continue; }
        count += 1;
        details.url = request.url;
        details.hostname = hostnameFromURI(request.url);
        details.domain = domainFromHostname(details.hostname);
        details.entity = entityFromDomain(details.domain);
        void scriptletFilteringEngine.retrieve(details);
    }
    const t1 = performance.now();
    const dur = t1 - t0;
    console.info(`Evaluated ${count} requests in ${dur.toFixed(0)} ms`);
    console.info(`\tAverage: ${(dur / count).toFixed(3)} ms per request`);
};

/******************************************************************************/

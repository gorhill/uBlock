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

import io from './assets.js';
import µb from './background.js';
import { LineIterator } from './text-iterators.js';

/******************************************************************************/

µb.formatCount = function(count) {
    if ( typeof count !== 'number' ) {
        return '';
    }
    let s = count.toFixed(0);
    if ( count >= 1000 ) {
        if ( count < 10000 ) {
            s = '>' + s.slice(0,1) + 'k';
        } else if ( count < 100000 ) {
            s = s.slice(0,2) + 'k';
        } else if ( count < 1000000 ) {
            s = s.slice(0,3) + 'k';
        } else if ( count < 10000000 ) {
            s = s.slice(0,1) + 'M';
        } else {
            s = s.slice(0,-6) + 'M';
        }
    }
    return s;
};

// https://www.youtube.com/watch?v=DyvzfyqYm_s

/******************************************************************************/

µb.dateNowToSensibleString = function() {
    const now = new Date(Date.now() - (new Date()).getTimezoneOffset() * 60000);
    return now.toISOString().replace(/\.\d+Z$/, '')
                            .replace(/:/g, '.')
                            .replace('T', '_');
};

/******************************************************************************/

µb.openNewTab = function(details) {
    if ( details.url.startsWith('logger-ui.html') ) {
        if ( details.shiftKey ) {
            this.changeUserSettings(
                'alwaysDetachLogger',
                !this.userSettings.alwaysDetachLogger
            );
        }
        if ( this.userSettings.alwaysDetachLogger ) {
            details.popup = this.hiddenSettings.loggerPopupType;
            const url = new URL(vAPI.getURL(details.url));
            url.searchParams.set('popup', '1');
            details.url = url.href;
            let popupLoggerBox;
            try {
                popupLoggerBox = JSON.parse(
                    vAPI.localStorage.getItem('popupLoggerBox')
                );
            } catch(ex) {
            }
            if ( popupLoggerBox !== undefined ) {
                details.box = popupLoggerBox;
            }
        }
    }
    vAPI.tabs.open(details);
};

/******************************************************************************/

µb.MRUCache = class {
    constructor(size) {
        this.size = size;
        this.array = [];
        this.map = new Map();
        this.resetTime = Date.now();
    }
    add(key, value) {
        const found = this.map.has(key);
        this.map.set(key, value);
        if ( !found ) {
            if ( this.array.length === this.size ) {
                this.map.delete(this.array.pop());
            }
            this.array.unshift(key);
        }
    }
    remove(key) {
        if ( this.map.has(key) ) {
            this.array.splice(this.array.indexOf(key), 1);
        }
    }
    lookup(key) {
        const value = this.map.get(key);
        if ( value !== undefined && this.array[0] !== key ) {
            let i = this.array.indexOf(key);
            do {
                this.array[i] = this.array[i-1];
            } while ( --i );
            this.array[0] = key;
        }
        return value;
    }
    reset() {
        this.array = [];
        this.map.clear();
        this.resetTime = Date.now();
    }
};

/******************************************************************************/

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions

µb.escapeRegex = function(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/******************************************************************************/

µb.decomposeHostname = (( ) => {
    // For performance purpose, as simple tests as possible
    const reHostnameVeryCoarse = /[g-z_-]/;
    const reIPv4VeryCoarse = /\.\d+$/;

    const toBroaderHostname = function(hostname) {
        const pos = hostname.indexOf('.');
        if ( pos !== -1 ) {
            return hostname.slice(pos + 1);
        }
        return hostname !== '*' && hostname !== '' ? '*' : '';
    };

    const toBroaderIPv4Address = function(ipaddress) {
        if ( ipaddress === '*' || ipaddress === '' ) { return ''; }
        const pos = ipaddress.lastIndexOf('.');
        if ( pos === -1 ) { return '*'; }
        return ipaddress.slice(0, pos);
    };

    const toBroaderIPv6Address = function(ipaddress) {
        return ipaddress !== '*' && ipaddress !== '' ? '*' : '';
    };

    return function decomposeHostname(hostname, decomposed) {
        if ( decomposed.length === 0 || decomposed[0] !== hostname ) {
            let broaden;
            if ( reHostnameVeryCoarse.test(hostname) === false ) {
                if ( reIPv4VeryCoarse.test(hostname) ) {
                    broaden = toBroaderIPv4Address;
                } else if ( hostname.startsWith('[') ) {
                    broaden = toBroaderIPv6Address;
                }
            }
            if ( broaden === undefined ) {
                broaden = toBroaderHostname;
            }
            decomposed[0] = hostname;
            let i = 1;
            for (;;) {
                hostname = broaden(hostname);
                if ( hostname === '' ) { break; }
                decomposed[i++] = hostname;
            }
            decomposed.length = i;
        }
        return decomposed;
    };
})();

/******************************************************************************/

// TODO: evaluate using TextEncoder/TextDecoder

µb.orphanizeString = function(s) {
    return JSON.parse(JSON.stringify(s));
};

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

µb.loadBenchmarkDataset = (( ) => {
    let datasetPromise;
    let ttlTimer;

    return function() {
        if ( ttlTimer !== undefined ) {
            clearTimeout(ttlTimer);
            ttlTimer = undefined;
        }

        vAPI.setTimeout(( ) => {
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

µb.fireDOMEvent = function(name) {
    if (
        window instanceof Object &&
        window.dispatchEvent instanceof Function &&
        window.CustomEvent instanceof Function
    ) {
        window.dispatchEvent(new CustomEvent(name));
    }
};

/******************************************************************************/

// TODO: properly compare arrays

µb.getModifiedSettings = function(edit, orig = {}) {
    const out = {};
    for ( const prop in edit ) {
        if ( orig.hasOwnProperty(prop) && edit[prop] !== orig[prop] ) {
            out[prop] = edit[prop];
        }
    }
    return out;
};

µb.settingValueFromString = function(orig, name, s) {
    if ( typeof name !== 'string' || typeof s !== 'string' ) { return; }
    if ( orig.hasOwnProperty(name) === false ) { return; }
    let r;
    switch ( typeof orig[name] ) {
    case 'boolean':
        if ( s === 'true' ) {
            r = true;
        } else if ( s === 'false' ) {
            r = false;
        }
        break;
    case 'string':
        r = s.trim();
        break;
    case 'number':
        if ( s.startsWith('0b') ) {
            r = parseInt(s.slice(2), 2);
        } else if ( s.startsWith('0x') ) {
            r = parseInt(s.slice(2), 16);
        } else {
            r = parseInt(s, 10);
        }
        if ( isNaN(r) ) { r = undefined; }
        break;
    default:
        break;
    }
    return r;
};

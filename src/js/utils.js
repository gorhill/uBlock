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

µBlock.formatCount = function(count) {
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

µBlock.dateNowToSensibleString = function() {
    const now = new Date(Date.now() - (new Date()).getTimezoneOffset() * 60000);
    return now.toISOString().replace(/\.\d+Z$/, '')
                            .replace(/:/g, '.')
                            .replace('T', '_');
};

/******************************************************************************/

µBlock.LineIterator = class {
    constructor(text, offset) {
        this.text = text;
        this.textLen = this.text.length;
        this.offset = offset || 0;
    }
    next(offset) {
        if ( offset !== undefined ) {
            this.offset += offset;
        }
        let lineEnd = this.text.indexOf('\n', this.offset);
        if ( lineEnd === -1 ) {
            lineEnd = this.text.indexOf('\r', this.offset);
            if ( lineEnd === -1 ) {
                lineEnd = this.textLen;
            }
        }
        const line = this.text.slice(this.offset, lineEnd);
        this.offset = lineEnd + 1;
        return line;
    }
    peek(n) {
        const offset = this.offset;
        return this.text.slice(offset, offset + n);
    }
    charCodeAt(offset) {
        return this.text.charCodeAt(this.offset + offset);
    }
    eot() {
        return this.offset >= this.textLen;
    }
};

/******************************************************************************/

// The field iterator is less CPU-intensive than when using native
// String.split().

µBlock.FieldIterator = class {
    constructor(sep) {
        this.text = '';
        this.sep = sep;
        this.sepLen = sep.length;
        this.offset = 0;
    }
    first(text) {
        this.text = text;
        this.offset = 0;
        return this.next();
    }
    next() {
        let end = this.text.indexOf(this.sep, this.offset);
        if ( end === -1 ) {
            end = this.text.length;
        }
        const field = this.text.slice(this.offset, end);
        this.offset = end + this.sepLen;
        return field;
    }
    remainder() {
        return this.text.slice(this.offset);
    }
};

/******************************************************************************/

µBlock.CompiledLineIO = {
    serialize: JSON.stringify,
    unserialize: JSON.parse,
    blockStartPrefix: '#block-start-',  // ensure no special regex characters
    blockEndPrefix: '#block-end-',      // ensure no special regex characters

    Writer: class {
        constructor() {
            this.io = µBlock.CompiledLineIO;
            this.blockId = undefined;
            this.block = undefined;
            this.stringifier = this.io.serialize;
            this.blocks = new Map();
            this.properties = new Map();
        }
        push(args) {
            this.block.push(this.stringifier(args));
        }
        last() {
            if ( Array.isArray(this.block) && this.block.length !== 0 ) {
                return this.block[this.block.length - 1];
            }
        }
        select(blockId) {
            if ( blockId === this.blockId ) { return; }
            this.blockId = blockId;
            this.block = this.blocks.get(blockId);
            if ( this.block === undefined ) {
                this.blocks.set(blockId, (this.block = []));
            }
            return this;
        }
        toString() {
            let result = [];
            for ( let [ id, lines ] of this.blocks ) {
                if ( lines.length === 0 ) { continue; }
                result.push(
                    this.io.blockStartPrefix + id,
                    lines.join('\n'),
                    this.io.blockEndPrefix + id
                );
            }
            return result.join('\n');
        }
    },

    Reader: class {
        constructor(raw, blockId) {
            this.io = µBlock.CompiledLineIO;
            this.block = '';
            this.len = 0;
            this.offset = 0;
            this.line = '';
            this.parser = this.io.unserialize;
            this.blocks = new Map();
            this.properties = new Map();
            let reBlockStart = new RegExp(
                `^${this.io.blockStartPrefix}(\\d+)\\n`,
                'gm'
            );
            let match = reBlockStart.exec(raw);
            while ( match !== null ) {
                let beg = match.index + match[0].length;
                let end = raw.indexOf(this.io.blockEndPrefix + match[1], beg);
                this.blocks.set(parseInt(match[1], 10), raw.slice(beg, end));
                reBlockStart.lastIndex = end;
                match = reBlockStart.exec(raw);
            }
            if ( blockId !== undefined ) {
                this.select(blockId);
            }
        }
        next() {
            if ( this.offset === this.len ) {
                this.line = '';
                return false;
            }
            let pos = this.block.indexOf('\n', this.offset);
            if ( pos !== -1 ) {
                this.line = this.block.slice(this.offset, pos);
                this.offset = pos + 1;
            } else {
                this.line = this.block.slice(this.offset);
                this.offset = this.len;
            }
            return true;
        }
        select(blockId) {
            this.block = this.blocks.get(blockId) || '';
            this.len = this.block.length;
            this.offset = 0;
            return this;
        }
        fingerprint() {
            return this.line;
        }
        args() {
            return this.parser(this.line);
        }
    }
};

/******************************************************************************/

µBlock.openNewTab = function(details) {
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

µBlock.MRUCache = class {
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

µBlock.escapeRegex = function(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/******************************************************************************/

µBlock.decomposeHostname = (( ) => {
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

µBlock.orphanizeString = function(s) {
    return JSON.parse(JSON.stringify(s));
};

/******************************************************************************/

// Custom base64 codecs. These codecs are meant to encode/decode typed arrays
// to/from strings.

// https://github.com/uBlockOrigin/uBlock-issues/issues/461
//   Provide a fallback encoding for Chromium 59 and less by issuing a plain
//   JSON string. The fallback can be removed once min supported version is
//   above 59.

// TODO: rename µBlock.base64 to µBlock.SparseBase64, now that
//       µBlock.DenseBase64 has been introduced.
// TODO: Should no longer need to test presence of TextEncoder/TextDecoder.

{
    const valToDigit = new Uint8Array(64);
    const digitToVal = new Uint8Array(128);
    {
        const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@%';
        for ( let i = 0, n = chars.length; i < n; i++ ) {
            const c = chars.charCodeAt(i);
            valToDigit[i] = c;
            digitToVal[c] = i;
        }
    }

    // The sparse base64 codec is best for buffers which contains a lot of
    // small u32 integer values. Those small u32 integer values are better
    // represented with stringified integers, because small values can be
    // represented with fewer bits than the usual base64 codec. For example,
    // 0 become '0 ', i.e. 16 bits instead of 48 bits with official base64
    // codec.

    µBlock.base64 = {
        magic: 'Base64_1',

        encode: function(arrbuf, arrlen) {
            const inputLength = (arrlen + 3) >>> 2;
            const inbuf = new Uint32Array(arrbuf, 0, inputLength);
            const outputLength = this.magic.length + 7 + inputLength * 7;
            const outbuf = new Uint8Array(outputLength);
            // magic bytes
            let j = 0;
            for ( let i = 0; i < this.magic.length; i++ ) {
                outbuf[j++] = this.magic.charCodeAt(i);
            }
            // array size
            let v = inputLength;
            do {
                outbuf[j++] = valToDigit[v & 0b111111];
                v >>>= 6;
            } while ( v !== 0 );
            outbuf[j++] = 0x20 /* ' ' */;
            // array content
            for ( let i = 0; i < inputLength; i++ ) {
                v = inbuf[i];
                do {
                    outbuf[j++] = valToDigit[v & 0b111111];
                    v >>>= 6;
                } while ( v !== 0 );
                outbuf[j++] = 0x20 /* ' ' */;
            }
            if ( typeof TextDecoder === 'undefined' ) {
                return JSON.stringify(
                    Array.from(new Uint32Array(outbuf.buffer, 0, j >>> 2))
                );
            }
            const textDecoder = new TextDecoder();
            return textDecoder.decode(new Uint8Array(outbuf.buffer, 0, j));
        },

        decode: function(instr, arrbuf) {
            if ( instr.charCodeAt(0) === 0x5B /* '[' */ ) {
                const inbuf = JSON.parse(instr);
                if ( arrbuf instanceof ArrayBuffer === false ) {
                    return new Uint32Array(inbuf);
                }
                const outbuf = new Uint32Array(arrbuf);
                outbuf.set(inbuf);
                return outbuf;
            }
            if ( instr.startsWith(this.magic) === false ) {
                throw new Error('Invalid µBlock.base64 encoding');
            }
            const inputLength = instr.length;
            const outputLength = this.decodeSize(instr) >> 2;
            const outbuf = arrbuf instanceof ArrayBuffer === false
                ? new Uint32Array(outputLength)
                : new Uint32Array(arrbuf);
            let i = instr.indexOf(' ', this.magic.length) + 1;
            if ( i === -1 ) {
                throw new Error('Invalid µBlock.base64 encoding');
            }
            // array content
            let j = 0;
            for (;;) {
                if ( j === outputLength || i >= inputLength ) { break; }
                let v = 0, l = 0;
                for (;;) {
                    const c = instr.charCodeAt(i++);
                    if ( c === 0x20 /* ' ' */ ) { break; }
                    v += digitToVal[c] << l;
                    l += 6;
                }
                outbuf[j++] = v;
            }
            if ( i < inputLength || j < outputLength ) {
                throw new Error('Invalid µBlock.base64 encoding');
            }
            return outbuf;
        },

        decodeSize: function(instr) {
            if ( instr.startsWith(this.magic) === false ) { return 0; }
            let v = 0, l = 0, i = this.magic.length;
            for (;;) {
                const c = instr.charCodeAt(i++);
                if ( c === 0x20 /* ' ' */ ) { break; }
                v += digitToVal[c] << l;
                l += 6;
            }
            return v << 2;
        },
    };

    // The dense base64 codec is best for typed buffers which values are
    // more random. For example, buffer contents as a result of compression
    // contain less repetitive values and thus the content is more
    // random-looking.

    // TODO: Investigate that in Firefox, creating a new Uint8Array from the
    //       ArrayBuffer fails, the content of the resulting Uint8Array is
    //       non-sensical. WASM-related?

    µBlock.denseBase64 = {
        magic: 'DenseBase64_1',

        encode: function(input) {
            const m = input.length % 3;
            const n = input.length - m;
            let outputLength = n / 3 * 4;
            if ( m !== 0 ) {
                outputLength += m + 1;
            }
            const output = new Uint8Array(outputLength);
            let j = 0;
            for ( let i = 0; i < n; i += 3) {
                const i1 = input[i+0];
                const i2 = input[i+1];
                const i3 = input[i+2];
                output[j+0] = valToDigit[                     i1 >>> 2];
                output[j+1] = valToDigit[i1 << 4 & 0b110000 | i2 >>> 4];
                output[j+2] = valToDigit[i2 << 2 & 0b111100 | i3 >>> 6];
                output[j+3] = valToDigit[i3      & 0b111111           ];
                j += 4;
            }
            if ( m !== 0 ) {
                const i1 = input[n];
                output[j+0] = valToDigit[i1 >>> 2];
                if ( m === 1 ) {    // 1 value
                    output[j+1] = valToDigit[i1 << 4 & 0b110000];
                } else {            // 2 values
                    const i2 = input[n+1];
                    output[j+1] = valToDigit[i1 << 4 & 0b110000 | i2 >>> 4];
                    output[j+2] = valToDigit[i2 << 2 & 0b111100           ];
                }
            }
            const textDecoder = new TextDecoder();
            const b64str = textDecoder.decode(output);
            return this.magic + b64str;
        },

        decode: function(instr, arrbuf) {
            if ( instr.startsWith(this.magic) === false ) {
                throw new Error('Invalid µBlock.denseBase64 encoding');
            }
            const outputLength = this.decodeSize(instr);
            const outbuf = arrbuf instanceof ArrayBuffer === false
                ? new Uint8Array(outputLength)
                : new Uint8Array(arrbuf);
            const inputLength = instr.length - this.magic.length;
            let i = this.magic.length;
            let j = 0;
            const m = inputLength & 3;
            const n = i + inputLength - m;
            while ( i < n ) {
                const i1 = digitToVal[instr.charCodeAt(i+0)];
                const i2 = digitToVal[instr.charCodeAt(i+1)];
                const i3 = digitToVal[instr.charCodeAt(i+2)];
                const i4 = digitToVal[instr.charCodeAt(i+3)];
                i += 4;
                outbuf[j+0] = i1 << 2              | i2 >>> 4;
                outbuf[j+1] = i2 << 4 & 0b11110000 | i3 >>> 2;
                outbuf[j+2] = i3 << 6 & 0b11000000 | i4;
                j += 3;
            }
            if ( m !== 0 ) {
                const i1 = digitToVal[instr.charCodeAt(i+0)];
                const i2 = digitToVal[instr.charCodeAt(i+1)];
                outbuf[j+0] = i1 << 2 | i2 >>> 4;
                if ( m === 3 ) {
                    const i3 = digitToVal[instr.charCodeAt(i+2)];
                    outbuf[j+1] = i2 << 4 & 0b11110000 | i3 >>> 2;
                }
            }
            return outbuf;
        },

        decodeSize: function(instr) {
            if ( instr.startsWith(this.magic) === false ) { return 0; }
            const inputLength = instr.length - this.magic.length;
            const m = inputLength & 3;
            const n = inputLength - m;
            let outputLength = (n >>> 2) * 3;
            if ( m !== 0 ) {
                outputLength += m - 1;
            }
            return outputLength;
        },
    };
}

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
// The advanced setting `consoleLogLevel` must be set to `info` to see the
// results in uBO's dev console, see:
//   https://github.com/gorhill/uBlock/wiki/Advanced-settings#consoleloglevel
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

µBlock.loadBenchmarkDataset = (( ) => {
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

        const datasetURL = µBlock.hiddenSettings.benchmarkDatasetURL;
        if ( datasetURL === 'unset' ) {
            console.info(`No benchmark dataset available.`);
            return Promise.resolve();
        }
        console.info(`Loading benchmark dataset...`);
        datasetPromise = µBlock.assets.fetchText(datasetURL).then(details => {
            console.info(`Parsing benchmark dataset...`);
            const requests = [];
            const lineIter = new µBlock.LineIterator(details.content);
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

µBlock.fireDOMEvent = function(name) {
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

µBlock.getModifiedSettings = function(edit, orig = {}) {
    const out = {};
    for ( const prop in edit ) {
        if ( orig.hasOwnProperty(prop) && edit[prop] !== orig[prop] ) {
            out[prop] = edit[prop];
        }
    }
    return out;
};

µBlock.settingValueFromString = function(orig, name, s) {
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

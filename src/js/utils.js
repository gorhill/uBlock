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

// A standalone URL tokenizer will allow us to use URL tokens in more than
// just static filtering engine. This opens the door to optimize other
// filtering engine parts aside static filtering. This also allows:
// - Tokenize only on demand.
// - To potentially avoid tokenizing when same URL is fed to tokenizer.
//   - Benchmarking shows this to be a common occurrence.
//
// https://github.com/gorhill/uBlock/issues/2630
// Slice input URL into a list of safe-integer token values, instead of a list
// of substrings. The assumption is that with dealing only with numeric
// values, less underlying memory allocations, and also as a consequence
// less work for the garbage collector down the road.
// Another assumption is that using a numeric-based key value for Map() is
// more efficient than string-based key value (but that is something I would
// have to benchmark).
// Benchmark for string-based tokens vs. safe-integer token values:
//   https://gorhill.github.io/obj-vs-set-vs-map/tokenize-to-str-vs-to-int.html

µBlock.urlTokenizer = new (class {
    constructor() {
        this._chars = '0123456789%abcdefghijklmnopqrstuvwxyz';
        this._validTokenChars = new Uint8Array(128);
        for ( let i = 0, n = this._chars.length; i < n; i++ ) {
            this._validTokenChars[this._chars.charCodeAt(i)] = i + 1;
        }
        // Four upper bits of token hash are reserved for built-in predefined
        // token hashes, which should never end up being used when tokenizing
        // any arbitrary string.
             this.dotTokenHash = 0x10000000;
             this.anyTokenHash = 0x20000000;
        this.anyHTTPSTokenHash = 0x30000000;
         this.anyHTTPTokenHash = 0x40000000;
              this.noTokenHash = 0x50000000;
           this.emptyTokenHash = 0xF0000000;

        this._urlIn = '';
        this._urlOut = '';
        this._tokenized = false;
        // https://www.reddit.com/r/uBlockOrigin/comments/dzw57l/
        //   Remember: 1 token needs two slots
        this._tokens = new Uint32Array(2064);

        this.knownTokens = new Uint8Array(65536);
        this.resetKnownTokens();
        this.MAX_TOKEN_LENGTH = 7;
    }

    setURL(url) {
        if ( url !== this._urlIn ) {
            this._urlIn = url;
            this._urlOut = url.toLowerCase();
            this._tokenized = false;
        }
        return this._urlOut;
    }

    resetKnownTokens() {
        this.knownTokens.fill(0);
        this.addKnownToken(this.dotTokenHash);
        this.addKnownToken(this.anyTokenHash);
        this.addKnownToken(this.anyHTTPSTokenHash);
        this.addKnownToken(this.anyHTTPTokenHash);
        this.addKnownToken(this.noTokenHash);
    }

    addKnownToken(th) {
        this.knownTokens[th & 0xFFFF ^ th >>> 16] = 1;
    }

    // Tokenize on demand.
    getTokens(encodeInto) {
        if ( this._tokenized ) { return this._tokens; }
        let i = this._tokenize(encodeInto);
        this._tokens[i+0] = this.anyTokenHash;
        this._tokens[i+1] = 0;
        i += 2;
        if ( this._urlOut.startsWith('https://') ) {
            this._tokens[i+0] = this.anyHTTPSTokenHash;
            this._tokens[i+1] = 0;
            i += 2;
        } else if ( this._urlOut.startsWith('http://') ) {
            this._tokens[i+0] = this.anyHTTPTokenHash;
            this._tokens[i+1] = 0;
            i += 2;
        }
        this._tokens[i+0] = this.noTokenHash;
        this._tokens[i+1] = 0;
        this._tokens[i+2] = 0;
        this._tokenized = true;
        return this._tokens;
    }

    tokenHashFromString(s) {
        const l = s.length;
        if ( l === 0 ) { return this.emptyTokenHash; }
        const vtc = this._validTokenChars;
        let th = vtc[s.charCodeAt(0)];
        for ( let i = 1; i !== 7 && i !== l; i++ ) {
            th = th << 4 ^ vtc[s.charCodeAt(i)];
        }
        return th;
    }

    stringFromTokenHash(th) {
        if ( th === 0 ) { return ''; }
        return th.toString(16);
    }

    toSelfie() {
        return µBlock.base64.encode(
            this.knownTokens.buffer,
            this.knownTokens.byteLength
        );
    }

    fromSelfie(selfie) {
        return µBlock.base64.decode(selfie, this.knownTokens.buffer);
    }

    // https://github.com/chrisaljoudi/uBlock/issues/1118
    // We limit to a maximum number of tokens.

    _tokenize(encodeInto) {
        const tokens = this._tokens;
        let url = this._urlOut;
        let l = url.length;
        if ( l === 0 ) { return 0; }
        if ( l > 2048 ) {
            url = url.slice(0, 2048);
            l = 2048;
        }
        encodeInto.haystackLen = l;
        const knownTokens = this.knownTokens;
        const vtc = this._validTokenChars;
        const charCodes = encodeInto.haystack;
        let i = 0, j = 0, n, ti, th;
        for (;;) {
            for (;;) {
                if ( i === l ) { return j; }
                th = vtc[(charCodes[i] = url.charCodeAt(i))];
                i += 1;
                if ( th !== 0 ) { break; }
            }
            ti = i - 1; n = 1;
            for (;;) {
                if ( i === l ) { break; }
                const v = vtc[(charCodes[i] = url.charCodeAt(i))];
                i += 1;
                if ( v === 0 ) { break; }
                if ( n === 7 ) { continue; }
                th = th << 4 ^ v;
                n += 1;
            }
            if ( knownTokens[th & 0xFFFF ^ th >>> 16] !== 0 ) {
                tokens[j+0] = th;
                tokens[j+1] = ti;
                j += 2;
            }
        }
    }
})();

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
                '^' + this.io.blockStartPrefix + '(\\d+)\\n',
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

// Custom base64 encoder/decoder
//
// TODO:
//   Could expand the LZ4 codec API to be able to return UTF8-safe string
//   representation of a compressed buffer, and thus the code below could be
//   moved LZ4 codec-side.
// https://github.com/uBlockOrigin/uBlock-issues/issues/461
//   Provide a fallback encoding for Chromium 59 and less by issuing a plain
//   JSON string. The fallback can be removed once min supported version is
//   above 59.

µBlock.base64 = new (class {
    constructor() {
        this.valToDigit = new Uint8Array(64);
        this.digitToVal = new Uint8Array(128);
        const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@%";
        for ( let i = 0, n = chars.length; i < n; i++ ) {
            const c = chars.charCodeAt(i);
            this.valToDigit[i] = c;
            this.digitToVal[c] = i;
        }
        this.magic = 'Base64_1';
    }

    encode(arrbuf, arrlen) {
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
            outbuf[j++] = this.valToDigit[v & 0b111111];
            v >>>= 6;
        } while ( v !== 0 );
        outbuf[j++] = 0x20 /* ' ' */;
        // array content
        for ( let i = 0; i < inputLength; i++ ) {
            v = inbuf[i];
            do {
                outbuf[j++] = this.valToDigit[v & 0b111111];
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
    }

    decode(instr, arrbuf) {
        if (  instr.charCodeAt(0) === 0x5B /* '[' */ ) {
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
                v += this.digitToVal[c] << l;
                l += 6;
            }
            outbuf[j++] = v;
        }
        if ( i < inputLength || j < outputLength ) {
            throw new Error('Invalid µBlock.base64 encoding');
        }
        return outbuf;
    }

    decodeSize(instr) {
        if ( instr.startsWith(this.magic) === false ) { return 0; }
        let v = 0, l = 0, i = this.magic.length;
        for (;;) {
            const c = instr.charCodeAt(i++);
            if ( c === 0x20 /* ' ' */ ) { break; }
            v += this.digitToVal[c] << l;
            l += 6;
        }
        return v << 2;
    }
})();

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

µBlock.getMessageSenderDetails = function(sender) {
    const r = {};
    if ( sender instanceof Object ) {
        r.url = sender.url;
        r.frameId = sender.frameId;
        const tab = sender.tab;
        if ( tab instanceof Object ) {
            r.tabId = tab.id;
        }
    }
    return r;
};

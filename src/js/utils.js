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

µBlock.urlTokenizer = {
    setURL: function(url) {
        if ( url !== this._urlIn ) {
            this._urlIn = url;
            this._urlOut = url.toLowerCase();
            this._tokenized = false;
        }
        return this._urlOut;
    },

    // Tokenize on demand.
    getTokens: function() {
        if ( this._tokenized === false ) {
            this._tokenize();
            this._tokenized = true;
        }
        return this._tokens;
    },

    tokenHashFromString: function(s) {
        var l = s.length;
        if ( l === 0 ) { return 0; }
        if ( l === 1 ) {
            if ( s === '*' ) { return 63; }
            if ( s === '.' ) { return 62; }
        }
        var vtc = this._validTokenChars,
            th = vtc[s.charCodeAt(0)];
        for ( var i = 1; i !== 8 && i !== l; i++ ) {
            th = th * 64 + vtc[s.charCodeAt(i)];
        }
        return th;
    },

    // https://github.com/chrisaljoudi/uBlock/issues/1118
    // We limit to a maximum number of tokens.

    _tokenize: function() {
        var tokens = this._tokens,
            url = this._urlOut,
            l = url.length;
        if ( l === 0 ) { tokens[0] = 0; return; }
        if ( l > 2048 ) {
            url = url.slice(0, 2048);
            l = 2048;
        }
        var i = 0, j = 0, v, n, ti, th,
            vtc = this._validTokenChars;
        for (;;) {
            for (;;) {
                if ( i === l ) { tokens[j] = 0; return; }
                v = vtc[url.charCodeAt(i++)];
                if ( v !== 0 ) { break; }
            }
            th = v; ti = i - 1; n = 1;
            for (;;) {
                if ( i === l ) { break; }
                v = vtc[url.charCodeAt(i++)];
                if ( v === 0 ) { break; }
                if ( n === 8 ) { continue; }
                th = th * 64 + v;
                n += 1;
            }
            tokens[j++] = th;
            tokens[j++] = ti;
        }
    },

    _urlIn: '',
    _urlOut: '',
    _tokenized: false,
    _tokens: [ 0 ],
    _validTokenChars: (function() {
        var vtc = new Uint8Array(128),
            chars = '0123456789%abcdefghijklmnopqrstuvwxyz',
            i = chars.length;
        while ( i-- ) {
            vtc[chars.charCodeAt(i)] = i + 1;
        }
        return vtc;
    })()
};

/******************************************************************************/

µBlock.formatCount = function(count) {
    if ( typeof count !== 'number' ) {
        return '';
    }
    var s = count.toFixed(0);
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
    var now = new Date(Date.now() - (new Date()).getTimezoneOffset() * 60000);
    return now.toISOString().replace(/\.\d+Z$/, '')
                            .replace(/:/g, '.')
                            .replace('T', '_');
};

/******************************************************************************/

µBlock.LineIterator = function(text, offset) {
    this.text = text;
    this.textLen = this.text.length;
    this.offset = offset || 0;
};

µBlock.LineIterator.prototype.next = function(offset) {
    if ( offset !== undefined ) {
        this.offset += offset;
    }
    var lineEnd = this.text.indexOf('\n', this.offset);
    if ( lineEnd === -1 ) {
        lineEnd = this.text.indexOf('\r', this.offset);
        if ( lineEnd === -1 ) {
            lineEnd = this.textLen;
        }
    }
    var line = this.text.slice(this.offset, lineEnd);
    this.offset = lineEnd + 1;
    return line;
};

µBlock.LineIterator.prototype.charCodeAt = function(offset) {
    return this.text.charCodeAt(this.offset + offset);
};

µBlock.LineIterator.prototype.eot = function() {
    return this.offset >= this.textLen;
};

/******************************************************************************/

// The field iterator is less CPU-intensive than when using native
// String.split().

µBlock.FieldIterator = function(sep) {
    this.text = '';
    this.sep = sep;
    this.sepLen = sep.length;
    this.offset = 0;
};

µBlock.FieldIterator.prototype.first = function(text) {
    this.text = text;
    this.offset = 0;
    return this.next();
};

µBlock.FieldIterator.prototype.next = function() {
    var end = this.text.indexOf(this.sep, this.offset);
    if ( end === -1 ) {
        end = this.text.length;
    }
    var field = this.text.slice(this.offset, end);
    this.offset = end + this.sepLen;
    return field;
};

µBlock.FieldIterator.prototype.remainder = function() {
    return this.text.slice(this.offset);
};

/******************************************************************************/

µBlock.CompiledLineIO = {
    serialize: JSON.stringify,
    unserialize: JSON.parse,
    blockStartPrefix: '#block-start-',  // ensure no special regex characters
    blockEndPrefix: '#block-end-',      // ensure no special regex characters

    Writer: function() {
        this.io = µBlock.CompiledLineIO;
        this.blockId = undefined;
        this.block = undefined;
        this.stringifier = this.io.serialize;
        this.blocks = new Map();
        this.properties = new Map();
    },

    Reader: function(raw, blockId) {
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
};

µBlock.CompiledLineIO.Writer.prototype = {
    push: function(args) {
        this.block[this.block.length] = this.stringifier(args);
    },
    select: function(blockId) {
        if ( blockId === this.blockId ) { return; }
        this.blockId = blockId;
        this.block = this.blocks.get(blockId);
        if ( this.block === undefined ) {
            this.blocks.set(blockId, (this.block = []));
        }
    },
    toString: function() {
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
};

µBlock.CompiledLineIO.Reader.prototype = {
    next: function() {
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
    },
    select: function(blockId) {
        this.block = this.blocks.get(blockId) || '';
        this.len = this.block.length;
        this.offset = 0;
        return this;
    },
    fingerprint: function() {
        return this.line;
    },
    args: function() {
        return this.parser(this.line);
    }
};

/******************************************************************************/

// I want this helper to be self-maintained, callers must not worry about
// this helper cleaning after itself by asking them to reset it when it is no
// longer needed. A timer will be used for self-garbage-collect.
// Cleaning up 10s after last hit sounds reasonable.

µBlock.stringDeduplicater = {
    strings: new Map(),
    timer: undefined,
    last: 0,

    lookup: function(s) {
        let t = this.strings.get(s);
        if ( t === undefined ) {
            t = this.strings.set(s, s).get(s);
            if ( this.timer === undefined ) {
                this.timer = vAPI.setTimeout(() => { this.cleanup(); }, 10000);
            }
        }
        this.last = Date.now();
        return t;
    },

    cleanup: function() {
        if ( (Date.now() - this.last) < 10000 ) {
            this.timer = vAPI.setTimeout(() => { this.cleanup(); }, 10000);
        } else {
            this.timer = undefined;
            this.strings.clear();
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
        details.popup = this.userSettings.alwaysDetachLogger;
        if ( details.popup ) {
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

µBlock.MRUCache = function(size) {
    this.size = size;
    this.array = [];
    this.map = new Map();
    this.resetTime = Date.now();
};

µBlock.MRUCache.prototype = {
    add: function(key, value) {
        var found = this.map.has(key);
        this.map.set(key, value);
        if ( !found ) {
            if ( this.array.length === this.size ) {
                this.map.delete(this.array.pop());
            }
            this.array.unshift(key);
        }
    },
    remove: function(key) {
        if ( this.map.has(key) ) {
            this.array.splice(this.array.indexOf(key), 1);
        }
    },
    lookup: function(key) {
        var value = this.map.get(key);
        if ( value !== undefined && this.array[0] !== key ) {
            var i = this.array.indexOf(key);
            do {
                this.array[i] = this.array[i-1];
            } while ( --i );
            this.array[0] = key;
        }
        return value;
    },
    reset: function() {
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

µBlock.decomposeHostname = (function() {
    // For performance purpose, as simple tests as possible
    let reHostnameVeryCoarse = /[g-z_-]/;
    let reIPv4VeryCoarse = /\.\d+$/;

    let toBroaderHostname = function(hostname) {
        let pos = hostname.indexOf('.');
        if ( pos !== -1 ) {
            return hostname.slice(pos + 1);
        }
        return hostname !== '*' && hostname !== '' ? '*' : '';
    };

    let toBroaderIPv4Address = function(ipaddress) {
        if ( ipaddress === '*' || ipaddress === '' ) { return ''; }
        let pos = ipaddress.lastIndexOf('.');
        if ( pos === -1 ) { return '*'; }
        return ipaddress.slice(0, pos);
    };

    let toBroaderIPv6Address = function(ipaddress) {
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

// Custom base128 encoder/decoder
//
// TODO:
//   Could expand the LZ4 codec API to be able to return UTF8-safe string
//   representation of a compressed buffer, and thus the code below could be
//   moved LZ4 codec-side.
// https://github.com/uBlockOrigin/uBlock-issues/issues/461
//   Provide a fallback encoding for Chromium 59 and less by issuing a plain
//   JSON string. The fallback can be removed once min supported version is
//   above 59.

µBlock.base128 = {
    encode: function(arrbuf, arrlen) {
        if (
            vAPI.webextFlavor.soup.has('chromium') &&
            vAPI.webextFlavor.major < 60
        ) {
            return this.encodeJSON(arrbuf);
        }
        return this.encodeBase128(arrbuf, arrlen);
    },
    encodeBase128: function(arrbuf, arrlen) {
        const inbuf = new Uint8Array(arrbuf, 0, arrlen);
        const inputLength = arrlen;
        let _7cnt = Math.floor(inputLength / 7);
        let outputLength = _7cnt * 8;
        let _7rem = inputLength % 7;
        if ( _7rem !== 0 ) {
            outputLength += 1 + _7rem;
        }
        const outbuf = new Uint8Array(outputLength);
        let msbits, v;
        let i = 0, j = 0;
        while ( _7cnt--  ) {
            v = inbuf[i+0];
            msbits  = (v & 0x80) >>> 7;
            outbuf[j+1] = v & 0x7F;
            v = inbuf[i+1];
            msbits |= (v & 0x80) >>> 6;
            outbuf[j+2] = v & 0x7F;
            v = inbuf[i+2];
            msbits |= (v & 0x80) >>> 5;
            outbuf[j+3] = v & 0x7F;
            v = inbuf[i+3];
            msbits |= (v & 0x80) >>> 4;
            outbuf[j+4] = v & 0x7F;
            v = inbuf[i+4];
            msbits |= (v & 0x80) >>> 3;
            outbuf[j+5] = v & 0x7F;
            v = inbuf[i+5];
            msbits |= (v & 0x80) >>> 2;
            outbuf[j+6] = v & 0x7F;
            v = inbuf[i+6];
            msbits |= (v & 0x80) >>> 1;
            outbuf[j+7] = v & 0x7F;
            outbuf[j+0] = msbits;
            i += 7; j += 8;
        }
        if ( _7rem > 0 ) {
            msbits = 0;
            for ( let ir = 0; ir < _7rem; ir++ ) {
                v = inbuf[i+ir];
                msbits |= (v & 0x80) >>> (7 - ir);
                outbuf[j+ir+1] = v & 0x7F;
            }
            outbuf[j+0] = msbits;
        }
        const textDecoder = new TextDecoder();
        return textDecoder.decode(outbuf);
    },
    encodeJSON: function(arrbuf) {
        return JSON.stringify(Array.from(new Uint32Array(arrbuf)));
    },
    // TODO:
    //   Surprisingly, there does not seem to be any performance gain when
    //   first converting the input string into a Uint8Array through
    //   TextEncoder. Investigate again to confirm original findings and
    //   to find out whether results have changed. Not using TextEncoder()
    //   to create an intermediate input buffer lower peak memory usage
    //   at selfie load time.
    //
    //   const textEncoder = new TextEncoder();
    //   const inbuf = textEncoder.encode(instr);
    //   const inputLength = inbuf.byteLength;
    decode: function(instr, arrbuf) {
        if ( instr.length === 0 ) { return; }
        if ( instr.charCodeAt(0) === 0x5B /* '[' */ ) {
            const outbuf = this.decodeJSON(instr, arrbuf);
            if ( outbuf !== undefined ) {
                return outbuf;
            }
        }
        if (
            vAPI.webextFlavor.soup.has('chromium') &&
            vAPI.webextFlavor.major < 60
        ) {
            throw new Error('Unexpected µBlock.base128 encoding');
        }
        return this.decodeBase128(instr, arrbuf);
    },
    decodeBase128: function(instr, arrbuf) {
        const inputLength = instr.length;
        let _8cnt = inputLength >>> 3;
        let outputLength = _8cnt * 7;
        let _8rem = inputLength % 8;
        if ( _8rem !== 0 ) {
            outputLength += _8rem - 1;
        }
        const outbuf = arrbuf instanceof ArrayBuffer === false
            ? new Uint8Array(outputLength)
            : new Uint8Array(arrbuf);
        let msbits;
        let i = 0, j = 0;
        while ( _8cnt-- ) {
            msbits = instr.charCodeAt(i+0);
            outbuf[j+0] = msbits << 7 & 0x80 | instr.charCodeAt(i+1);
            outbuf[j+1] = msbits << 6 & 0x80 | instr.charCodeAt(i+2);
            outbuf[j+2] = msbits << 5 & 0x80 | instr.charCodeAt(i+3);
            outbuf[j+3] = msbits << 4 & 0x80 | instr.charCodeAt(i+4);
            outbuf[j+4] = msbits << 3 & 0x80 | instr.charCodeAt(i+5);
            outbuf[j+5] = msbits << 2 & 0x80 | instr.charCodeAt(i+6);
            outbuf[j+6] = msbits << 1 & 0x80 | instr.charCodeAt(i+7);
            i += 8; j += 7;
        }
        if ( _8rem > 1 ) {
            msbits = instr.charCodeAt(i+0);
            for ( let ir = 1; ir < _8rem; ir++ ) {
                outbuf[j+ir-1] = msbits << (8-ir) & 0x80 | instr.charCodeAt(i+ir);
            }
        }
        return outbuf;
    },
    decodeJSON: function(instr, arrbuf) {
        let buf;
        try {
            buf = JSON.parse(instr);
        } catch (ex) {
        }
        if ( Array.isArray(buf) === false ) { return; }
        const outbuf = arrbuf instanceof ArrayBuffer === false
            ? new Uint32Array(buf.length << 2)
            : new Uint32Array(arrbuf);
        outbuf.set(buf);
        return new Uint8Array(outbuf.buffer);
    },
    decodeSize: function(instr) {
        if ( instr.length === 0 ) { return 0; }
        if ( instr.charCodeAt(0) === 0x5B /* '[' */ ) {
            let buf;
            try {
                buf = JSON.parse(instr);
            } catch (ex) {
            }
            if ( Array.isArray(buf) ) {
                return buf.length << 2;
            }
        }
        if (
            vAPI.webextFlavor.soup.has('chromium') &&
            vAPI.webextFlavor.major < 60
        ) {
            throw new Error('Unexpected µBlock.base128 encoding');
        }
        const size = (instr.length >>> 3) * 7;
        const rem = instr.length & 7;
        return rem === 0 ? size : size + rem - 1;
    },
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

µBlock.loadBenchmarkDataset = (function() {
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
        }, 60000);

        if ( datasetPromise !== undefined ) {
            return datasetPromise;
        }

        datasetPromise = new Promise(resolve => {
            console.info(`Loading benchmark dataset...`);
            const url = vAPI.getURL('/assets/requests.json');
            µBlock.assets.fetchText(url, details => {
                if ( details.error !== undefined ) {
                    datasetPromise = undefined;
                    console.info(`Not found: ${url}`);
                    resolve();
                    return;
                }
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
                resolve(requests);
            });
        });

        return datasetPromise;
    };
})();

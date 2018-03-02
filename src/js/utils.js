/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2017 Raymond Hill

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

µBlock.CompiledLineWriter = function() {
    this.output = [];
    this.stringifier = JSON.stringify;
};

µBlock.CompiledLineWriter.fingerprint = function(args) {
    return JSON.stringify(args);
};

µBlock.CompiledLineWriter.prototype = {
    push: function(args) {
        this.output[this.output.length] = this.stringifier(args);
    },
    toString: function() {
        return this.output.join('\n');
    }
};

µBlock.CompiledLineReader = function(raw) {
    this.reset(raw);
    this.parser = JSON.parse;
};

µBlock.CompiledLineReader.prototype = {
    reset: function(raw) {
        this.input = raw;
        this.len = raw.length;
        this.offset = 0;
        this.s = '';
        return this;
    },
    next: function() {
        if ( this.offset === this.len ) {
            this.s = '';
            return false;
        }
        var pos = this.input.indexOf('\n', this.offset);
        if ( pos !== -1 ) {
            this.s = this.input.slice(this.offset, pos);
            this.offset = pos + 1;
        } else {
            this.s = this.input.slice(this.offset);
            this.offset = this.len;
        }
        return true;
    },
    fingerprint: function() {
        return this.s;
    },
    args: function() {
        return this.parser(this.s);
    }
};

/******************************************************************************/

// I want this helper to be self-maintained, callers must not worry about
// this helper cleaning after itself by asking them to reset it when it is no
// longer needed. A timer will be used for self-garbage-collect.
// Cleaning up 10s after last hit sounds reasonable.

// https://github.com/gorhill/uBlock/issues/2656
// Can't use chained calls if we want to support legacy Map().

µBlock.stringDeduplicater = {
    strings: new Map(),
    timer: undefined,
    last: 0,

    lookup: function(s) {
        var t = this.strings.get(s);
        if ( t === undefined ) {
            this.strings.set(s, s);
            t = this.strings.get(s);
            if ( this.timer === undefined ) { this.cleanupAsync(); }
        }
        this.last = Date.now();
        return t;
    },

    cleanupAsync: function() {
        this.timer = vAPI.setTimeout(this.cleanup.bind(this), 10000);
    },

    cleanup: function() {
        if ( (Date.now() - this.last) < 10000 ) {
            this.timer = vAPI.setTimeout(this.cleanup.bind(this), 10000);
        } else {
            this.timer = undefined;
            this.strings.clear();
        }
    }
};

/******************************************************************************/

µBlock.arrayFrom = typeof Array.from === 'function'
    ? Array.from
    : function(iterable) {
        var out = [], i = 0;
        for ( var value of iterable ) {
            out[i++] = value;
        }
        return out;
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
    }
    vAPI.tabs.open(details);
};

/******************************************************************************/

µBlock.MRUCache = function(size) {
    this.size = size;
    this.array = [];
    this.map = new Map();
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
            this.array.splice(this.array.indexOf(key), 1);
            this.array.unshift(key);
        }
        return value;
    },
    reset: function() {
        this.array = [];
        this.map.clear();
    }
};

/******************************************************************************/

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions

µBlock.escapeRegex = function(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/******************************************************************************/

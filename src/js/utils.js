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

    _tokenize: function() {
        var tokens = this._tokens,
            url = this._urlOut,
            l = url.length;
        if ( l === 0 ) { tokens[0] = 0; return; }
        // https://github.com/chrisaljoudi/uBlock/issues/1118
        // We limit to a maximum number of tokens.
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

µBlock.CompiledOutput = function() {
    this.bufferLen = 8192;
    this.buffer = new Uint8Array(this.bufferLen);
    this.offset = 0;
};

µBlock.CompiledOutput.prototype.push = function(lineBits, line) {
    var lineLen = line.length,
        offset = this.offset,
        need = offset + 2 + lineLen; // lineBits, line, \n
    if ( need > this.bufferLen ) {
        this.grow(need);
    }
    var buffer = this.buffer;
    if ( offset !== 0 ) {
        buffer[offset++] = 0x0A /* '\n' */;
    }
    buffer[offset++] = 0x61 /* 'a' */ + lineBits;
    for ( var i = 0, c; i < lineLen; i++ ) {
        c = line.charCodeAt(i);
        if ( c > 0x7F ) {
            return this.push(lineBits | 0x02, encodeURIComponent(line));
        }
        buffer[offset++] = c;
    }
    this.offset = offset;
};

µBlock.CompiledOutput.prototype.grow = function(need) {
    var newBufferLen = Math.min(
        2097152,
        1 << Math.ceil(Math.log(need) / Math.log(2))
    );
    while ( newBufferLen < need ) {
        newBufferLen += 1048576;
    }
    var newBuffer = new Uint8Array(newBufferLen);
    newBuffer.set(this.buffer);
    this.buffer = newBuffer;
    this.bufferLen = newBufferLen;
};

µBlock.CompiledOutput.prototype.toString = function() {
    var decoder = new TextDecoder();
    return decoder.decode(new Uint8Array(this.buffer.buffer, 0, this.offset));
};

/******************************************************************************/

µBlock.mapToArray = typeof Array.from === 'function'
    ? Array.from
    : function(map) {
        var out = [];
        for ( var entry of map ) {
            out.push(entry);
        }
        return out;
    };

µBlock.mapFromArray = function(arr) {
    return new Map(arr);
};

µBlock.setToArray = typeof Array.from === 'function'
    ? Array.from
    : function(dict) {
        var out = [];
        for ( var value of dict ) {
            out.push(value);
        }
        return out;
    };

µBlock.setFromArray = function(arr) {
    return new Set(arr);
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

// https://github.com/gorhill/uBlock/issues/2344

µBlock.matchCurrentLanguage = function(s) {
    if ( typeof s !== 'string' ) { return false; }
    if ( this.matchCurrentLanguage.reLang === undefined ) {
        this.matchCurrentLanguage.reLang = new RegExp('\\b' + self.navigator.language.slice(0, 2) + '\\b');
    }
    return this.matchCurrentLanguage.reLang.test(s);
};

/******************************************************************************/

/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2016 Raymond Hill

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
            if ( this._gcAfter === undefined ) {
                this._gcAfter = Date.now() + 1499;
            }
            this._tokenize();
            this._tokenized = true;
        }
        return this._tokens;
    },

    isTokenized: function() {
        return this._tokens !== null && this._tokens[0].token !== '';
    },

    _Entry: function() {
        this.beg = 0;
        this.token = undefined;
    },

    // https://github.com/chrisaljoudi/uBlock/issues/1118
    // We limit to a maximum number of tokens.
    _init: function() {
        this._tokens = new Array(2048);
        for ( var i = 0; i < 2048; i++ ) {
            this._tokens[i] = new this._Entry();
        }
        this._init = null;
    },

    _tokenize: function() {
        var tokens = this._tokens,
            re = this._reAnyToken,
            url = this._urlOut;
        var matches, entry;
        re.lastIndex = 0;
        for ( var i = 0; i < 2047; i++ ) {
            matches = re.exec(url);
            if ( matches === null ) { break; }
            entry = tokens[i];
            entry.beg = matches.index;
            entry.token = matches[0];
        }
        tokens[i].token = ''; // Sentinel
        // Could no-longer-used-but-still-referenced string fragments 
        // contribute to memory fragmentation in the long-term? The code below
        // is to address this: left over unused string fragments are removed at
        // regular interval.
        if ( Date.now() < this._gcAfter ) { return; }
        this._gcAfter = undefined;
        for ( i += 1; i < 2047; i++ ) {
            entry = tokens[i];
            if ( entry.token === undefined ) { break; }
            entry.token = undefined;
        }
    },

    _urlIn: '',
    _urlOut: '',
    _tokenized: false,
    _tokens: null,
    _reAnyToken: /[%0-9a-z]+/g,
    _gcAfter: undefined
};

µBlock.urlTokenizer._init();

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

µBlock.LineIterator.prototype.next = function() {
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

/******************************************************************************/

µBlock.mapToArray = function(map) {
    var out = [],
        entries = map.entries(),
        entry;
    for (;;) {
        entry = entries.next();
        if ( entry.done ) { break; }
        out.push([ entry.value[0], entry.value[1] ]);
    }
    return out;
};

µBlock.mapFromArray = function(arr) {
    return new Map(arr);
};

µBlock.setToArray = function(dict) {
    var out = [],
        entries = dict.values(),
        entry;
    for (;;) {
        entry = entries.next();
        if ( entry.done ) { break; }
        out.push(entry.value);
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

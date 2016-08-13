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
        this.token = '';
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
            if ( matches === null ) {
                break;
            }
            entry = tokens[i];
            entry.beg = matches.index;
            entry.token = matches[0];
        }
        tokens[i].token = ''; // Sentinel
    },

    _urlIn: '',
    _urlOut: '',
    _tokenized: false,
    _tokens: null,
    _reAnyToken: /[%0-9a-z]+/g
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

µBlock.LineIterator = function(text, offset) {
    this.text = text;
    this.offset = offset || 0;
};

µBlock.LineIterator.prototype.next = function() {
    if ( this.offset >= this.text.length ) {
        return undefined;
    }
    var lineEnd = this.text.indexOf('\n', this.offset);
    if ( lineEnd === -1 ) {
        lineEnd = this.text.indexOf('\r', this.offset);
        if ( lineEnd === -1 ) {
            lineEnd = this.text.length;
        }
    }
    var line = this.text.slice(this.offset, lineEnd);
    this.offset = lineEnd + 1;
    return line;
};

µBlock.LineIterator.prototype.eot = function() {
    return this.offset >= this.text.length;
};

/******************************************************************************/
